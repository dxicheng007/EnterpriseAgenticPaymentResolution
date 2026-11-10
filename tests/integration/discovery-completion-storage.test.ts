import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, type Pool, type PoolClient } from 'pg';
import { beforeAll, expect, test } from 'vitest';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { sqlState, withTransaction } from '../../packages/storage/src/transaction.js';
import { migrate, migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb, type DatabasePair } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

const immutableMigrations = {
  '001_base.sql': 'b2f5e5ce3a689ecb1ccef3c51dd90db6485fffe33bcdffec6d94d2984f11284f',
  '002_sources.sql': '3b8df852acf97a5fde560eb53329e974bd6f7914e531da2081117fd44a033fed',
  '003_artifacts.sql': '2c996c8f7b87581f303762bdbef80abb6137d293c0d686268776b5d57b98a22c',
  '004_discovery.sql': '5cbfbc573a337414d3e544aa3e70ceac4313db5dc08ff163d6012f6d433546fb',
  '005_bootstrap_verification.sql': 'ce373f832bd5cce6f77386411de423876a043807fee4a3763a9c8396e6188b31',
  '006_financial_provenance.sql': 'a01d43772e40e3c1a8d29425707fe5109d2a0db06c2adbfa5e04bebeee692e45',
  '007_discovery_construction.sql': 'f9c0883a6da0e5ae25c04c8fe566682c72e2acfcc9f22a88e2e0105a83b9f35b',
  '008_review_activation_intents.sql': '956127c4414c86ab5ffe4bd630cabd333662fb61688af540a8b19184b97b0a54',
  '009_discovery_verification_requests.sql': '5080b0c7cec1c0a6eb366aa650f01e87d50183d5de3fa490691bf0f8085c1ab0',
};
const immutableIdentities = Object.entries(immutableMigrations).map(([file, sha256]) => ({
  version: Number(file.slice(0, 3)), sha256,
}));

const requests = 'discovery_investigation_requests';
const findings = 'discovery_investigation_request_findings';
const delegations = 'discovery_investigation_request_delegations';
const newColumns = {
  [requests]: ['request_id', 'run_id', 'requester_task_id', 'seller_entity_id', 'source_account_id', 'question'],
  [findings]: ['run_id', 'request_id', 'finding_id', 'finding_revision'],
  [delegations]: ['run_id', 'request_id', 'coordinator_task_id', 'delegation_step_id', 'delegated_task_id'],
};
const newTables = Object.keys(newColumns);
const preexistingTables = [
  'discovery_runs', 'discovery_investigations', 'discovery_tasks', 'discovery_dispatches', 'discovery_tool_steps',
  'discovery_finding_identities', 'discovery_finding_revisions', 'discovery_finding_blockers',
  'activity_counter', 'activity_events',
];
const insertRequest = 'INSERT INTO ' + requests +
  ' (run_id, requester_task_id, request_id, seller_entity_id, source_account_id, question) VALUES ($1,$2,$3,$4,$5,$6)';
const insertFinding = 'INSERT INTO ' + findings +
  ' (run_id, request_id, finding_id, finding_revision) VALUES ($1,$2,$3,$4)';
const insertDelegation = 'INSERT INTO ' + delegations +
  ' (run_id, request_id, coordinator_task_id, delegation_step_id, delegated_task_id) VALUES ($1,$2,$3,$4,$5)';
const updateRun = "UPDATE discovery_runs SET status=$1 WHERE id='a' RETURNING status";
const updateInvestigation = "UPDATE discovery_investigations SET repair_count=$1 WHERE id='a-source' RETURNING repair_count";
const updateTask = "UPDATE discovery_tasks SET repair_round=$1 WHERE id='a-requester' RETURNING repair_round";

beforeAll(startNativeDb);

async function withDatabases(label: string, check: (pair: DatabasePair, app: Pool, closeApp: () => Promise<void>) => Promise<void>) {
  const namespace = testNamespace(label);
  const pair = await provisionTest(namespace);
  const app = createControlDb({ connectionString: pair.control.appUrl });
  let closed: Promise<void> | undefined;
  const closeApp = () => closed ??= app.end();
  try {
    expect((await app.query('SELECT current_user AS role')).rows).toEqual([{ role: pair.control.appRole }]);
    await check(pair, app, closeApp);
  } finally {
    await closeApp();
    await dropTest(namespace);
  }
}

async function sha256(file: string) {
  const bytes = await readFile(new URL('../../db/control/' + file, import.meta.url));
  return createHash('sha256').update(bytes).digest('hex');
}

async function seedDiscovery(app: Pool) {
  await withTransaction(app, async client => {
    for (const run of ['a', 'b']) {
      await client.query(`
        INSERT INTO discovery_runs
          (id, reviewer_id, start_key, start_hash, start_response, binding, mode, model_id, policy, grants,
           status, revision, model_calls)
        VALUES ($1,'test-reviewer',$1,'start-hash','{}','{}','scripted','synthetic','{}','{}',$2,4,2)
      `, [run, run === 'a' ? 'running' : 'paused']);
      await client.query(`
        INSERT INTO discovery_investigations (run_id,id,specialist_count,repair_count) VALUES ($1,$2,3,1)
      `, [run, run + '-source']);
      for (const [task, role] of [
        ['coordinator', 'coordinator'], ['requester', 'identity'], ['child1', 'contract'], ['child2', 'connector'],
      ]) {
        await client.query(`
          INSERT INTO discovery_tasks (run_id,id,investigation_id,role,question,grants,status,revision,attempt,repair_round)
          VALUES ($1,$2,$3,$4,'Synthetic question','{}','running',2,1,1)
        `, [run, run + '-' + task, run + '-source', role]);
      }
      for (const [task, attempt, steps] of [
        ['requester', 1, ['publish', 'revise', 'request1', 'request2']],
        ['requester', 2, ['request3', 'request4']],
        ['coordinator', 1, ['delegate1', 'delegate2']],
      ] as const) {
        const taskId = run + '-' + task;
        const dispatch = taskId + '-' + attempt;
        await client.query(`
          INSERT INTO discovery_dispatches
            (id,run_id,task_id,attempt,generation,task_revision,state,request_hash,result_hash,accepted,accounting)
          VALUES ($1,$2,$3,$4,1,2,'returned','request-hash','result-hash','{}','known')
        `, [dispatch, run, taskId, attempt]);
        for (const [ordinal, step] of steps.entries()) {
          const name = step.startsWith('request') ? 'requestInvestigation' :
            step.startsWith('delegate') ? 'delegate' : 'publishFinding';
          await client.query(`
            INSERT INTO discovery_tool_steps
              (id,dispatch_id,run_id,task_id,native_id,ordinal,name,input_hash,arguments,generation,state,result)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'input-hash','{}',1,'succeeded','{}')
          `, [run + '-' + step, dispatch, run, taskId, step, ordinal, name]);
        }
      }
      await client.query(`
        INSERT INTO discovery_finding_identities (run_id,id,investigation_id,current_revision) VALUES ($1,$2,$3,2)
      `, [run, run + '-finding', run + '-source']);
      await client.query(`
        INSERT INTO discovery_finding_revisions
          (run_id,finding_id,revision,investigation_id,task_id,tool_step_id,payload)
        VALUES ($1,$2,1,$3,$4,$5,'{"summary":"first revision"}'), ($1,$2,2,$3,$4,$6,'{"summary":"current revision"}')
      `, [run, run + '-finding', run + '-source', run + '-requester', run + '-publish', run + '-revise']);
      await client.query(`
        INSERT INTO discovery_finding_blockers (run_id,finding_id,origin_revision,investigation_id,code)
        VALUES ($1,$2,1,$3,'FINDING_RESOLUTION_PENDING')
      `, [run, run + '-finding', run + '-source']);
    }
    await client.query("UPDATE activity_counter SET sequence=1 WHERE singleton");
    await client.query(`INSERT INTO activity_events (sequence,event)
      VALUES (1,'{"stream":"control","sequence":1,"type":"system.status"}')`);
  });
}

async function rowSnapshot(app: Pool, tables: string[]) {
  return Object.fromEntries(await Promise.all(tables.map(async table => [
    table, (await app.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t ORDER BY to_jsonb(t)')).rows,
  ])));
}

const readLedger = async (app: Pool) => (await app.query<{ version: number; sha256: string; applied_at: Date }>(
  'SELECT version, sha256, applied_at FROM migration_ledger ORDER BY version',
)).rows;

async function schema(db: Pool | Client) {
  const relations = (await db.query<{ name: string; kind: string }>(`
    SELECT c.relname AS name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY name
  `)).rows;
  const columns = (await db.query<{ name: string; column: string; type: string; required: boolean; default: string | null }>(`
    SELECT c.relname AS name, a.attname AS "column", format_type(a.atttypid,a.atttypmod) AS type,
           a.attnotnull AS required, pg_get_expr(d.adbin,d.adrelid) AS "default"
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY name,a.attnum
  `)).rows;
  const constraints = (await db.query<{ name: string; relation: string; kind: string; definition: string }>(`
    SELECT k.conname AS name, c.relname AS relation, k.contype AS kind, pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY relation,name
  `)).rows;
  const indexes = (await db.query<{ name: string; relation: string; definition: string; backing_constraint: boolean }>(`
    SELECT i.indexname AS name, i.tablename AS relation, i.indexdef AS definition,
      EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid=ic.oid AND k.contype IN ('p','u','x')) AS backing_constraint
    FROM pg_indexes i JOIN pg_class ic ON ic.oid=to_regclass('public.' || quote_ident(i.indexname))
    WHERE i.schemaname='public' ORDER BY name
  `)).rows;
  const routines = (await db.query(`
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments, p.prokind AS kind
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY name,arguments
  `)).rows;
  const triggers = (await db.query(`
    SELECT c.relname AS relation, pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY relation,definition
  `)).rows;
  return { relations, columns, constraints, indexes, routines, triggers };
}

async function runtimeFingerprint(pair: DatabasePair) {
  const runtime = new Client({ connectionString: pair.runtime.migrationUrl });
  try {
    await runtime.connect();
    const catalog = await schema(runtime);
    const { rows: [presence] } = await runtime.query<{ ledger: boolean }>(
      "SELECT to_regclass('public.migration_ledger') IS NOT NULL AS ledger",
    );
    const ledger = presence.ledger
      ? (await runtime.query('SELECT version, sha256, applied_at FROM migration_ledger ORDER BY version')).rows : null;
    return { catalog, ledger };
  } finally {
    await runtime.end();
  }
}

async function grants(app: Pool) {
  const { rows } = await app.query<{ table: string; allowed: string[]; columnOnly: string[] }>(`
    SELECT c.relname AS "table",
      ARRAY(SELECT privilege FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])
        AS privileges(privilege) WHERE has_table_privilege(c.oid,privilege)) AS allowed,
      ARRAY(SELECT a.attname || ':' || privilege FROM pg_attribute a
        CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS privileges(privilege)
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
          AND has_column_privilege(c.oid,a.attnum,privilege) AND NOT has_table_privilege(c.oid,privilege)
        ORDER BY a.attname,privilege) AS "columnOnly"
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname
  `);
  return Object.fromEntries(rows.map(({ table, allowed, columnOnly }) => [table, { allowed, columnOnly }]));
}

async function rejected(client: PoolClient, code: string, sql: string, values: unknown[] = []) {
  await client.query('SAVEPOINT storage_probe');
  try {
    await expect(client.query(sql, values), sql).rejects.toMatchObject({ code });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT storage_probe');
    await client.query('RELEASE SAVEPOINT storage_probe');
  }
}

function expectSchemaDelta(before: Awaited<ReturnType<typeof schema>>, after: Awaited<ReturnType<typeof schema>>) {
  const isNew = (table: string) => newTables.includes(table);
  const oldRelations = new Set(before.relations.map(row => row.name));
  expect(after.relations.filter(row => oldRelations.has(row.name))).toEqual(before.relations);
  const additions = after.relations.filter(row => !oldRelations.has(row.name));
  expect(additions.filter(row => row.kind !== 'i')).toEqual(newTables.toSorted().map(name => ({ name, kind: 'r' })));

  expect(after.columns.filter(row => !isNew(row.name))).toEqual(before.columns);
  expect(after.columns.filter(row => isNew(row.name))).toEqual(
    Object.entries(newColumns).toSorted(([left], [right]) => left.localeCompare(right)).flatMap(([name, columns]) =>
      columns.map(column => ({
        name, column, type: column === 'finding_revision' ? 'integer' : 'text',
        required: !['seller_entity_id', 'source_account_id'].includes(column), default: null,
      }))),
  );

  const statusCheck = 'discovery_runs_status_check';
  expect(before.constraints.find(row => row.name === statusCheck)?.definition).toContain("'failed'");
  expect(before.constraints.find(row => row.name === statusCheck)?.definition).not.toContain("'completed'");
  expect(after.constraints.find(row => row.name === statusCheck)?.definition).toContain("'completed'");
  expect(after.constraints.filter(row => !isNew(row.relation) && row.name !== statusCheck))
    .toEqual(before.constraints.filter(row => row.name !== statusCheck));
  expect(before.constraints).toEqual(expect.arrayContaining([
    expect.objectContaining({ relation: 'discovery_tasks', definition: 'UNIQUE (run_id, id)' }),
    expect.objectContaining({ relation: 'discovery_tool_steps', definition: 'UNIQUE (run_id, task_id, id)' }),
    expect.objectContaining({ relation: 'discovery_finding_revisions', definition: 'PRIMARY KEY (run_id, finding_id, revision)' }),
  ]));
  const newConstraints = after.constraints.filter(row => isNew(row.relation));
  expect(newConstraints.map(({ relation, definition }) => [relation, definition]))
    .toEqual(expect.arrayContaining([
      [requests, 'PRIMARY KEY (request_id)'],
      [requests, 'UNIQUE (run_id, request_id)'],
      [requests, 'FOREIGN KEY (run_id, requester_task_id, request_id) REFERENCES discovery_tool_steps(run_id, task_id, id)'],
      [findings, 'PRIMARY KEY (run_id, request_id, finding_id, finding_revision)'],
      [findings, 'FOREIGN KEY (run_id, request_id) REFERENCES discovery_investigation_requests(run_id, request_id)'],
      [findings, 'FOREIGN KEY (run_id, finding_id, finding_revision) REFERENCES discovery_finding_revisions(run_id, finding_id, revision)'],
      [delegations, 'PRIMARY KEY (run_id, request_id)'],
      [delegations, 'UNIQUE (delegation_step_id)'],
      [delegations, 'UNIQUE (delegated_task_id)'],
      [delegations, 'FOREIGN KEY (run_id, request_id) REFERENCES discovery_investigation_requests(run_id, request_id)'],
      [delegations, 'FOREIGN KEY (run_id, coordinator_task_id, delegation_step_id) REFERENCES discovery_tool_steps(run_id, task_id, id)'],
      [delegations, 'FOREIGN KEY (run_id, delegated_task_id) REFERENCES discovery_tasks(run_id, id)'],
    ]));
  // PostgreSQL 18 also records the 13 required columns as NOT NULL constraints.
  expect(newConstraints.map(row => row.kind).sort()).toEqual([
    'c', 'c', 'f', 'f', 'f', 'f', 'f', 'f', ...Array<string>(13).fill('n'), 'p', 'p', 'p', 'u', 'u', 'u',
  ]);
  expect(after.indexes.filter(row => !isNew(row.relation))).toEqual(before.indexes);
  const newIndexes = after.indexes.filter(row => isNew(row.relation));
  expect(newIndexes.filter(row => row.backing_constraint)).toHaveLength(6);
  expect(newIndexes.filter(row => !row.backing_constraint)).toEqual([{
    name: 'discovery_investigation_requests_task', relation: requests, backing_constraint: false,
    definition: 'CREATE INDEX discovery_investigation_requests_task ON public.discovery_investigation_requests USING btree (run_id, requester_task_id, request_id)',
  }]);
  expect(additions.filter(row => row.kind === 'i').map(row => row.name)).toEqual(newIndexes.map(row => row.name));
  expect(after.routines).toEqual(before.routines);
  expect(after.triggers).toEqual(before.triggers);
}

test('control010 upgrades populated 009 and agrees with a fresh control database', async () => {
  for (const [file, pin] of Object.entries(immutableMigrations)) expect(await sha256(file), file).toBe(pin);
  const through009 = readMigrationCatalog({ throughVersion: 9 });
  const through010 = readMigrationCatalog({ throughVersion: 10 });
  expect(migrationIdentities(through009.control)).toEqual(immutableIdentities);
  expect(migrationIdentities(through010.control).slice(0, 9)).toEqual(immutableIdentities);

  await withDatabases('completeup', async (upgrade, app) => {
    const runtimeBefore = await runtimeFingerprint(upgrade);
    expect(runtimeBefore).toEqual({
      catalog: { relations: [], columns: [], constraints: [], indexes: [], routines: [], triggers: [] }, ledger: null,
    });
    await migrate(upgrade, ['control'], through009);
    await seedDiscovery(app);
    const previousRows = await rowSnapshot(app, preexistingTables);
    const previousSchema = await schema(app);
    const previousGrants = await grants(app);
    const previousLedger = await readLedger(app);
    expect(previousLedger.map(({ version, sha256 }) => ({ version, sha256 }))).toEqual(immutableIdentities);

    await withTransaction(app, async client => {
      await rejected(client, '23514', updateRun, ['completed']);
      await rejected(client, '42501', updateInvestigation, [2]);
      await rejected(client, '42501', updateTask, [2]);
    });

    await migrate(upgrade, ['control'], through010);
    expect(await rowSnapshot(app, preexistingTables)).toEqual(previousRows);
    const ledger010 = await readLedger(app);
    expect(ledger010.slice(0, 9)).toEqual(previousLedger);

    // The same valid app mutations rejected at 009 must now reach and update real rows.
    expect((await app.query(updateRun, ['completed'])).rows).toEqual([{ status: 'completed' }]);
    expect((await app.query(updateInvestigation, [2])).rows).toEqual([{ repair_count: 2 }]);
    expect((await app.query(updateTask, [2])).rows).toEqual([{ repair_round: 2 }]);

    const newIdentity = { version: 10, sha256: await sha256('010_discovery_completion.sql') };
    const expectedLedger = [...immutableIdentities, newIdentity];
    expect(migrationIdentities(through010.control)).toEqual(expectedLedger);
    expect(ledger010.map(({ version, sha256 }) => ({ version, sha256 }))).toEqual(expectedLedger);

    const upgradedSchema = await schema(app);
    expectSchemaDelta(previousSchema, upgradedSchema);
    const upgradedGrants = await grants(app);
    expect(previousGrants.discovery_investigations).toEqual({ allowed: ['SELECT', 'INSERT'], columnOnly: ['specialist_count:UPDATE'] });
    expect(previousGrants.discovery_tasks).toEqual({
      allowed: ['SELECT', 'INSERT'], columnOnly: ['attempt:UPDATE', 'diagnostics:UPDATE', 'revision:UPDATE', 'status:UPDATE', 'tool_rounds:UPDATE'],
    });
    expect(upgradedGrants).toEqual({
      ...previousGrants,
      discovery_investigations: { allowed: ['SELECT', 'INSERT'], columnOnly: ['repair_count:UPDATE', 'specialist_count:UPDATE'] },
      discovery_tasks: { allowed: ['SELECT', 'INSERT'], columnOnly: ['attempt:UPDATE', 'diagnostics:UPDATE', 'repair_round:UPDATE', 'revision:UPDATE', 'status:UPDATE', 'tool_rounds:UPDATE'] },
      [requests]: { allowed: ['SELECT', 'INSERT'], columnOnly: [] },
      [findings]: { allowed: ['SELECT', 'INSERT'], columnOnly: [] },
      [delegations]: { allowed: ['SELECT', 'INSERT'], columnOnly: [] },
    });

    await withDatabases('completion', async (fresh, freshApp) => {
      const freshRuntime = await runtimeFingerprint(fresh);
      expect(freshRuntime).toEqual(runtimeBefore);
      await migrate(fresh, ['control'], through010);
      expect((await readLedger(freshApp)).map(({ version, sha256 }) => ({ version, sha256 }))).toEqual(expectedLedger);
      expect(await schema(freshApp)).toEqual(upgradedSchema);
      expect(await grants(freshApp)).toEqual(upgradedGrants);
      expect(await runtimeFingerprint(fresh)).toEqual(freshRuntime);
    });

    await app.query(insertRequest, ['a', 'a-requester', 'a-request1', null, null, 'Preserve after migrate?']);
    const afterWrites = await rowSnapshot(app, [...preexistingTables, ...newTables]);
    await migrate(upgrade, ['control'], through010);
    expect(await readLedger(app)).toEqual(ledger010);
    expect(await rowSnapshot(app, [...preexistingTables, ...newTables])).toEqual(afterWrites);
    expect(await schema(app)).toEqual(upgradedSchema);
    expect(await grants(app)).toEqual(upgradedGrants);
    expect(await runtimeFingerprint(upgrade)).toEqual(runtimeBefore);
  });
});

async function checkRequestConstraints(client: PoolClient) {
  const scope = ['synthetic-seller', 'synthetic-account'];
  const maxQuestion = 'é'.repeat(4096);
  expect(Buffer.byteLength(maxQuestion, 'utf8')).toBe(8192);
  expect((await client.query(insertRequest, ['a', 'a-requester', 'a-request1', null, null, 'Source?'])).rowCount).toBe(1);
  expect((await client.query(insertRequest, ['a', 'a-requester', 'a-request2', ...scope, maxQuestion])).rowCount).toBe(1);
  expect((await client.query(insertRequest, ['a', 'a-requester', 'a-request3', ...scope, 'Same subject?'])).rowCount).toBe(1);
  expect((await client.query(insertRequest, ['b', 'b-requester', 'b-request1', null, null, 'Other run?'])).rowCount).toBe(1);

  for (const [seller, account, question] of [
    [null, null, ''], [null, null, maxQuestion + 'a'], ['seller', null, 'Partial?'], [null, 'account', 'Partial?'],
  ]) {
    await rejected(client, '23514', insertRequest, ['a', 'a-requester', 'a-request4', seller, account, question]);
  }
  for (const [task, step] of [
    ['a-requester', 'missing-step'], ['a-requester', 'b-request2'],
    ['b-requester', 'b-request2'], ['a-coordinator', 'a-request4'],
  ]) {
    await rejected(client, '23503', insertRequest, ['a', task, step, null, null, 'Valid question?']);
  }
  await rejected(client, '23505', insertRequest, ['a', 'a-requester', 'a-request1', null, null, 'Duplicate?']);

  expect((await client.query(insertFinding, ['a', 'a-request1', 'a-finding', 1])).rowCount).toBe(1);
  for (const [request, finding, revision] of [
    ['missing-request', 'a-finding', 1], ['b-request1', 'a-finding', 1], ['a-request1', 'missing-finding', 1],
    ['a-request1', 'b-finding', 1], ['a-request1', 'a-finding', 3],
  ]) {
    await rejected(client, '23503', insertFinding, ['a', request, finding, revision]);
  }
  await rejected(client, '23505', insertFinding, ['a', 'a-request1', 'a-finding', 1]);

  for (const args of [
    ['a', 'missing-request', 'a-coordinator', 'a-delegate1', 'a-child1'],
    ['a', 'b-request1', 'a-coordinator', 'a-delegate1', 'a-child1'],
    ['a', 'a-request1', 'a-coordinator', 'missing-step', 'a-child1'],
    ['a', 'a-request1', 'b-coordinator', 'b-delegate1', 'a-child1'],
    ['a', 'a-request1', 'a-requester', 'a-delegate1', 'a-child1'],
    ['a', 'a-request1', 'a-coordinator', 'a-delegate1', 'missing-child'],
    ['a', 'a-request1', 'a-coordinator', 'a-delegate1', 'b-child1'],
  ]) {
    await rejected(client, '23503', insertDelegation, args);
  }
  expect((await client.query(insertDelegation, ['a', 'a-request1', 'a-coordinator', 'a-delegate1', 'a-child1'])).rowCount).toBe(1);
  for (const [request, step, child] of [
    ['a-request1', 'a-delegate2', 'a-child2'],
    ['a-request2', 'a-delegate1', 'a-child2'],
    ['a-request2', 'a-delegate2', 'a-child1'],
  ]) {
    await rejected(client, '23505', insertDelegation, ['a', request, 'a-coordinator', step, child]);
  }

  const { rows } = await client.query(`
    SELECT r.request_id, octet_length(r.question) AS question_bytes, r.seller_entity_id, r.source_account_id,
      CASE WHEN d.request_id IS NULL THEN 'pending' ELSE 'delegated' END AS state
    FROM discovery_investigation_requests r LEFT JOIN discovery_investigation_request_delegations d USING (run_id,request_id)
    WHERE r.run_id='a' ORDER BY r.request_id
  `);
  expect(rows).toEqual([
    { request_id: 'a-request1', question_bytes: 7, seller_entity_id: null, source_account_id: null, state: 'delegated' },
    { request_id: 'a-request2', question_bytes: 8192, seller_entity_id: scope[0], source_account_id: scope[1], state: 'pending' },
    { request_id: 'a-request3', question_bytes: 13, seller_entity_id: scope[0], source_account_id: scope[1], state: 'pending' },
  ]);
}

async function checkAppMutations(client: PoolClient) {
  for (const status of ['queued', 'running', 'paused', 'blocked', 'failed', 'completed']) {
    expect((await client.query(updateRun, [status])).rows).toEqual([{ status }]);
  }
  for (const count of [0, 1, 2]) {
    expect((await client.query(updateInvestigation, [count])).rows).toEqual([{ repair_count: count }]);
    expect((await client.query(updateTask, [count])).rows).toEqual([{ repair_round: count }]);
  }
  await rejected(client, '23514', updateRun, ['unrecognized']);
  for (const count of [-1, 3]) {
    await rejected(client, '23514', updateInvestigation, [count]);
    await rejected(client, '23514', updateTask, [count]);
  }

  for (const [table, columns] of Object.entries(newColumns)) {
    expect((await client.query('SELECT 1 FROM ' + table + ' LIMIT 1')).rowCount).toBe(1);
    for (const column of columns) await rejected(client, '42501', 'UPDATE ' + table + ' SET ' + column + '=' + column);
    await rejected(client, '42501', 'DELETE FROM ' + table);
    await rejected(client, '42501', 'TRUNCATE ' + table);
  }
  const unchangedIdentities = {
    discovery_investigations: ['id', 'run_id', 'seller_entity_id', 'source_account_id'],
    discovery_tasks: ['id', 'run_id', 'investigation_id', 'role', 'grants'],
    discovery_finding_blockers: ['run_id', 'finding_id', 'origin_revision', 'investigation_id', 'code'],
  };
  for (const [table, columns] of Object.entries(unchangedIdentities)) {
    expect((await client.query('SELECT 1 FROM ' + table + ' LIMIT 1')).rowCount).toBe(1);
    for (const column of columns) await rejected(client, '42501', 'UPDATE ' + table + ' SET ' + column + '=' + column);
  }
  await rejected(client, '42501', 'DELETE FROM discovery_finding_blockers');
  await rejected(client, '42501', 'CREATE TABLE public.unexpected (id integer)');
  await rejected(client, '42501', 'ALTER TABLE ' + requests + ' ADD COLUMN unexpected integer');
  await rejected(client, '42501', 'DROP TABLE ' + delegations);
}

async function expectCrossDatabaseDenial(pair: DatabasePair) {
  for (const [own, other] of [[pair.control, pair.runtime], [pair.runtime, pair.control]]) {
    const url = new URL(own.appUrl);
    url.pathname = '/' + other.name;
    const remote = new Client({ connectionString: url.href, connectionTimeoutMillis: 1500 });
    try {
      // Retain only SQLSTATE from the connection failure.
      expect(await remote.connect().then(() => undefined, sqlState)).toBe('42501');
    } finally {
      await remote.end();
    }
  }
}

test('the app role can persist request provenance and cannot mutate it or bypass the storage checks', async () => {
  await withDatabases('completerole', async (pair, app, closeApp) => {
    await migrate(pair, ['control'], readMigrationCatalog({ throughVersion: 10 }));
    await seedDiscovery(app);
    await withTransaction(app, async client => {
      await checkRequestConstraints(client);
      await checkAppMutations(client);
    });
    const saved = await rowSnapshot(app, newTables);
    expect(saved[requests]).toHaveLength(4);
    expect(saved[findings]).toEqual([{ row: {
      run_id: 'a', request_id: 'a-request1', finding_id: 'a-finding', finding_revision: 1,
    } }]);
    expect(saved[delegations]).toEqual([{ row: {
      run_id: 'a', request_id: 'a-request1', coordinator_task_id: 'a-coordinator',
      delegation_step_id: 'a-delegate1', delegated_task_id: 'a-child1',
    } }]);
    await expectCrossDatabaseDenial(pair);

    await closeApp();
    const reopened = createControlDb({ connectionString: pair.control.appUrl });
    try {
      expect(await rowSnapshot(reopened, newTables)).toEqual(saved);
    } finally {
      await reopened.end();
    }
  });
});
