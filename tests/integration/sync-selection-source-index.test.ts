import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { escapeIdentifier, type Pool, type PoolClient } from 'pg';
import { expect, test } from 'vitest';
import { migrate, migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';
import { createSyncApplyFixture } from '../fixtures/sync-apply.js';

const indexName = 'runtime_activation_imports_source_account_idx';
const sourceKeys = ['capture_source_ref', 'account_id'];
const absentSource = 'source-index-absent-source';
const enrollmentQuery = `SELECT account_id, company_id, seller_entity_id, idempotency_key,
       activation_id, receipt_id, bundle_hash, plan_hash,
       recorded_snapshot_hash, planner_snapshot_hash, approved_snapshot_hash,
       target_version, capture_source_ref, capture_manifest_hash
FROM runtime_activation_imports
WHERE capture_source_ref = $1
ORDER BY account_id
LIMIT 9`;

const catalog = readMigrationCatalog();
const through007 = { ...catalog, runtime: catalog.runtime.filter(migration => migration.version <= 7) };
const ledgerQuery = 'SELECT version, sha256 FROM public.migration_ledger ORDER BY version';

type IndexMetadata = {
  index_name: string;
  amname: string;
  indisvalid: boolean;
  indisready: boolean;
  indisunique: boolean;
  indisprimary: boolean;
  indnkeyatts: number;
  indnatts: number;
  indpred: string | null;
  indexprs: string | null;
  key_names: (string | null)[];
  default_collations: (boolean | null)[];
  definition: string;
};

async function readIndexes(app: Pool) {
  const result = await app.query<IndexMetadata>(`
    SELECT idx.relname AS index_name, am.amname,
           i.indisvalid, i.indisready, i.indisunique, i.indisprimary, i.indnkeyatts, i.indnatts,
           pg_get_expr(i.indpred, i.indrelid) AS indpred, pg_get_expr(i.indexprs, i.indrelid) AS indexprs,
           keys.key_names, keys.default_collations, pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index AS i
    JOIN pg_class AS tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace AS tbl_schema ON tbl_schema.oid = tbl.relnamespace
    JOIN pg_class AS idx ON idx.oid = i.indexrelid
    JOIN pg_namespace AS idx_schema ON idx_schema.oid = idx.relnamespace
    JOIN pg_am AS am ON am.oid = idx.relam
    CROSS JOIN LATERAL (
      SELECT array_agg(a.attname::text ORDER BY k.position) AS key_names,
             array_agg(i.indcollation[k.position::int - 1] = a.attcollation ORDER BY k.position) AS default_collations
      FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
      LEFT JOIN pg_attribute AS a ON a.attrelid = tbl.oid AND a.attnum = k.attnum
      WHERE k.position <= i.indnkeyatts
    ) AS keys
    WHERE tbl_schema.nspname = 'public' AND idx_schema.nspname = 'public'
      AND tbl.relname = 'runtime_activation_imports'
  `);
  return result.rows;
}

async function assertSourceIndex(app: Pool) {
  const named = (await readIndexes(app)).filter(row => row.index_name === indexName);
  expect(named, 'runtime source enrollment index metadata').toHaveLength(1);
  expect(named[0]).toMatchObject({
    amname: 'btree', indisvalid: true, indisready: true, indisunique: false, indisprimary: false,
    indnkeyatts: 2, indnatts: 2, indpred: null, indexprs: null,
    key_names: sourceKeys, default_collations: [true, true],
  });
  expect(named[0].definition).toMatch(/ USING btree \(capture_source_ref, account_id\)$/);
  return named[0].definition;
}

async function snapshotTables(owner: Pool) {
  const { rows: tables } = await owner.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migration_ledger'
    ORDER BY table_name
  `);
  const snapshot = new Map<string, string[]>();
  for (const { table_name: table } of tables) {
    const { rows } = await owner.query<{ bytes: string }>(`
      SELECT bytes FROM (
        SELECT row_to_json(t)::text AS bytes FROM public.${escapeIdentifier(table)} AS t
      ) AS serialized ORDER BY bytes COLLATE "C"
    `);
    snapshot.set(table, rows.map(row => row.bytes));
  }
  return snapshot;
}

async function assertTablesUnchanged(owner: Pool, before: Map<string, string[]>) {
  const after = await snapshotTables(owner);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [table, rows] of before) {
    const current = after.get(table)!;
    expect(current.length, table + ' row count').toBe(rows.length);
    expect(rows.every((row, index) => row === current[index]), table + ' row bytes').toBe(true);
  }
}

async function checkAppTransaction(
  app: Pool, begin: 'BEGIN' | 'BEGIN READ ONLY', cleanupFailures: unknown[],
  check: (client: PoolClient) => Promise<void>,
) {
  const client = await app.connect();
  let rollbackFailed = false;
  try {
    await client.query(begin);
    await check(client);
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      rollbackFailed = true;
      cleanupFailures.push(error);
    } finally {
      try {
        client.release(rollbackFailed);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  }
}

type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Plans?: PlanNode[];
};

function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}

async function assertCompatiblePlan(app: Pool, sourceRef: string, cleanupFailures: unknown[]) {
  await checkAppTransaction(app, 'BEGIN READ ONLY', cleanupFailures, async client => {
    await client.query('SET LOCAL enable_seqscan = off');
    await client.query('SET LOCAL enable_bitmapscan = off');
    const { rows } = await client.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
      'EXPLAIN (FORMAT JSON) ' + enrollmentQuery, [sourceRef],
    );
    const nodes = planNodes(rows[0]['QUERY PLAN'][0].Plan);
    const shape = nodes.map(node => ({
      type: node['Node Type'],
      index: node['Index Name'],
      sourceEquality: /\bcapture_source_ref\s*=\s*/.test(node['Index Cond'] ?? ''),
    }));
    expect(shape.map(node => node.type)).toContain('Limit');
    expect(shape).toContainEqual({
      type: expect.stringMatching(/^Index (?:Only )?Scan$/), index: indexName, sourceEquality: true,
    });
    expect(shape.filter(node => ['Sort', 'Incremental Sort'].includes(node.type))).toEqual([]);
  });
}

test('source_index_upgrades_genuine_runtime006_without_changing_rows', async () => {
  const data = await createSyncApplyFixture(6);
  const cleanupFailures: unknown[] = [];
  let failure: { error: unknown } | undefined;
  try {
    const { db, owner, pair, stored, identity } = data;
    const sourceRef = stored.bundle.manifest.sourceRef;
    const { rows: originalLedger } = await db.query(ledgerQuery);
    expect(originalLedger.map(row => row.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(originalLedger).toEqual(migrationIdentities(through007.runtime.slice(0, 6)));
    const { rows: original } = await db.query(enrollmentQuery, [sourceRef]);
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({
      account_id: identity.scope.accountId, activation_id: identity.activationId,
      receipt_id: stored.receipt.id, capture_source_ref: sourceRef,
    });

    const priorIndexes = await readIndexes(db);
    expect(priorIndexes.some(row => row.index_name === indexName)).toBe(false);
    expect(priorIndexes.some(row => row.amname === 'btree' && row.indisvalid &&
      row.key_names[0] === sourceKeys[0] && row.key_names[1] === sourceKeys[1])).toBe(false);
    const snapshot = await snapshotTables(owner);
    expect(snapshot.get('runtime_activation_imports')?.length).toBe(1);
    expect(snapshot.get('parent_targets')?.length).toBeGreaterThan(0);
    expect(snapshot.get('parent_financial_records')?.length).toBeGreaterThan(0);

    await migrate(pair, ['runtime'], through007);
    const definition = await assertSourceIndex(db);
    const { rows: upgradedLedger } = await db.query(ledgerQuery);
    expect(upgradedLedger.map(row => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(upgradedLedger).toEqual(migrationIdentities(through007.runtime));
    expect(upgradedLedger.slice(0, 6)).toEqual(originalLedger);
    await assertTablesUnchanged(owner, snapshot);
    expect((await db.query(enrollmentQuery, [sourceRef])).rows).toEqual(original);
    expect((await db.query(enrollmentQuery, [absentSource])).rows).toEqual([]);
    await assertCompatiblePlan(db, sourceRef, cleanupFailures);

    await migrate(pair, ['runtime'], through007);
    expect((await db.query(ledgerQuery)).rows).toEqual(upgradedLedger);
    expect(await assertSourceIndex(db)).toBe(definition);
    await assertTablesUnchanged(owner, snapshot);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    try {
      await data.close();
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length) {
      throw new AggregateError(cleanupFailures, 'Source index upgrade cleanup failed', failure && { cause: failure.error });
    }
  }
}, 120_000);

test('source_index_fresh_schema_supports_app_reads_without_ddl_authority', async () => {
  let ownedNamespace: string | undefined;
  let app: Pool | undefined;
  let failure: { error: unknown } | undefined;
  const cleanupFailures: unknown[] = [];
  try {
    await startNativeDb();
    const namespace = testNamespace('srcidx');
    const pair = await provisionTest(namespace);
    ownedNamespace = namespace;
    await migrate(pair, ['runtime'], through007);
    app = createRuntimeDb({ connectionString: pair.runtime.appUrl });

    await assertSourceIndex(app);
    const { rows: ledger } = await app.query(ledgerQuery);
    expect(ledger.map(row => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ledger).toEqual(migrationIdentities(through007.runtime));
    expect((await app.query(enrollmentQuery, [absentSource])).rows).toEqual([]);
    await assertCompatiblePlan(app, absentSource, cleanupFailures);
    await checkAppTransaction(app, 'BEGIN', cleanupFailures, async client => {
      const { rows } = await client.query<{ current_user: string }>('SELECT current_user');
      expect(rows[0].current_user).toBe(pair.runtime.appRole);
      await expect(client.query(
        'CREATE INDEX source_index_app_forbidden ON runtime_activation_imports (capture_source_ref)',
      )).rejects.toMatchObject({ code: '42501' });
    });
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    try {
      await app?.end();
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      if (ownedNamespace) await dropTest(ownedNamespace);
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length) {
      throw new AggregateError(cleanupFailures, 'Fresh source index test cleanup failed', failure && { cause: failure.error });
    }
  }
});
