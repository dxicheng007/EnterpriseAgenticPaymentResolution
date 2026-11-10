import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  canonicalJson, hashBootstrapVerificationResult, hashBundleV2, hashCanonical, hashEvent,
  hashPlan, hashReviewPackage, hashTargetSnapshot, targetRecordId, type RawSourceEvent, type TargetState,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { lockFirstImport, lookupReceiptAssociation, readStoredActivation } from '@eapr/parent/activation-store';
import { projectBootstrapTarget } from '@eapr/parent/bootstrap';
import { projectStoredParentView, readStoredTarget } from '@eapr/parent/snapshots';
import { withTransaction } from '@eapr/storage/transaction';
import { migrate, migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb, type DatabasePair } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';
import {
  baselineA, baselineEventsA, baselineEventsB, emptyTargetA, emptyTargetB, validSpecA,
} from '../fixtures/index.js';

import {
  parentStorageFixture as fixture, persistParentStorageFixture as store, refreshCapture, type ParentStorageFixture as Fixture,
} from '../fixtures/parent-storage.js';

const h = (digit: string) => digit.repeat(64);

let pair: DatabasePair;
let runtime: Pool;
let admin: Pool;
let control: Pool;
const namespace = testNamespace('parent');
const catalog = readMigrationCatalog();

beforeAll(async () => {
  await startNativeDb();
  pair = await provisionTest(namespace);
  await migrate(pair);
  runtime = new Pool({ connectionString: pair.runtime.appUrl });
  admin = new Pool({ connectionString: pair.runtime.migrationUrl });
  control = new Pool({ connectionString: pair.control.appUrl });
});

afterAll(async () => {
  await Promise.all([runtime?.end(), admin?.end(), control?.end()]);
  if (pair) await dropTest(namespace);
});

const tables = [
  'parent_scopes', 'parent_snapshots', 'parent_targets', 'parent_metadata', 'parent_financial_records',
  'runtime_deliveries', 'runtime_activation_imports', 'runtime_economic_outcomes', 'runtime_delivery_outcomes',
  'runtime_import_lineage', 'activity_events', 'activity_counter',
];

async function counts() {
  const result = await runtime.query(
    'SELECT ' + tables.map(table => `(SELECT count(*)::int FROM ${table}) AS ${table}`).join(', ') +
    ', (SELECT sequence::int FROM activity_counter) AS sequence',
  );
  return result.rows[0];
}

async function reset() {
  const captureDependents = [
    'runtime_capture_lanes', 'runtime_capture_checkpoints', 'runtime_source_positions',
    'runtime_capture_pages', 'runtime_inbox', 'runtime_capture_incidents',
  ];
  await admin.query('TRUNCATE ' + [...tables.filter(table => table !== 'activity_counter'), ...captureDependents].join(', '));
  await admin.query('UPDATE activity_counter SET sequence = 0');
}


function expectation(input: Fixture) {
  return {
    scope: input.activation.scope, requestHash: hashCanonical(input.request), bundleHash: input.bundle.hash,
  };
}

async function installSnapshot(state: TargetState) {
  const { accountId, companyId, sellerEntityId } = state.scope;
  await withTransaction(admin, async client => {
    const scope = [accountId, companyId, sellerEntityId];
    await client.query('INSERT INTO parent_scopes VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', scope);
    await client.query(
      `INSERT INTO parent_snapshots (account_id, company_id, seller_entity_id, target_version, snapshot_hash, recorded_as_of, canonical, digest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [...scope, state.version, hashTargetSnapshot(state), state.asOf, canonicalJson(state), hashCanonical(state)],
    );
    await client.query(
      `INSERT INTO parent_targets (account_id, company_id, seller_entity_id, target_version, snapshot_hash)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (account_id) DO UPDATE
       SET target_version = EXCLUDED.target_version, snapshot_hash = EXCLUDED.snapshot_hash`,
      [...scope, state.version, hashTargetSnapshot(state)],
    );
  });
}

test('fresh and repeated migrations preserve hashes and enforce separate roles', async () => {
  const ledger = (await runtime.query('SELECT version, sha256 FROM migration_ledger ORDER BY version')).rows;
  expect(ledger).toEqual(migrationIdentities(catalog.runtime));
  await migrate(pair);
  expect((await runtime.query('SELECT version, sha256 FROM migration_ledger ORDER BY version')).rows).toEqual(ledger);
  for (const statement of [
    'CREATE TABLE no_ddl(id integer)', 'ALTER TABLE parent_targets ADD COLUMN no_ddl integer',
    'DROP TABLE parent_targets', 'TRUNCATE parent_scopes',
    'UPDATE parent_scopes SET company_id = company_id', 'DELETE FROM parent_snapshots',
    'UPDATE runtime_activation_imports SET receipt = receipt', 'UPDATE parent_targets SET company_id = company_id',
  ]) await expect(runtime.query(statement)).rejects.toMatchObject({ code: '42501' });
  for (const [identity, foreign] of [[pair.runtime, pair.control], [pair.control, pair.runtime]]) {
    const url = new URL(identity.appUrl);
    url.pathname = '/' + foreign.name;
    const pool = new Pool({ connectionString: url.toString() });
    try { await expect(pool.query('SELECT 1')).rejects.toMatchObject({ code: '42501' }); }
    finally { await pool.end(); }
  }
});

test('absence and scoped reads leave the database unchanged', async () => {
  await reset();
  const input = fixture();
  const before = await counts();
  await withTransaction(runtime, async client => {
    await client.query('SET TRANSACTION READ ONLY');
    expect(await readStoredTarget(client, input.activation.scope)).toBeNull();
    expect(await readStoredActivation(client, input.activation.scope)).toBeNull();
    expect(await lookupReceiptAssociation(client, input.request.idempotencyKey, expectation(input))).toEqual({ status: 'absent' });
  });
  expect(await counts()).toEqual(before);
});

test('exact canonical aggregates, records, selected deliveries and ordered lineage survive a new connection pool', async () => {
  await reset();
  const input = fixture();
  const unrelated = baselineEventsB[0];
  input.bundle.bootstrapEvents.push(unrelated);
  refreshCapture(input.bundle);
  const applied = await withTransaction(runtime, client => store(client, input));
  expect(applied.receipt).toEqual(input.receipt);
  expect(applied.approvedTarget.records).toEqual(input.approvedTarget);
  expect(applied.activation.baselineCursors.some(cursor => cursor.resumeAfter === '0')).toBe(true);
  const financial = (await runtime.query('SELECT canonical FROM parent_financial_records')).rows.map(row => row.canonical).sort();
  expect(financial).toEqual(input.plan.operations.flatMap(({ record }) => 'identity' in record ? [canonicalJson(record)] : []).sort());
  const metadata = (await runtime.query('SELECT canonical FROM parent_metadata')).rows.map(row => row.canonical).sort();
  expect(metadata).toEqual(input.plan.operations.flatMap(({ record }) => 'identity' in record ? [] : [canonicalJson(record)]).sort());
  const row = (await runtime.query('SELECT * FROM runtime_activation_imports')).rows[0];
  for (const [key, value] of Object.entries({
    activation: input.activation, receipt: input.receipt, request: input.request, reviewer: input.reviewer,
    bundle: input.bundle, plan: input.plan, recorded_target: input.recordedTarget, planner_target: input.plannerTarget,
  })) {
    expect(row[key]).toBe(canonicalJson(value));
    expect(row[key + '_digest']).toBe(hashCanonical(value));
  }
  expect((await runtime.query('SELECT event_id FROM runtime_delivery_outcomes ORDER BY event_id')).rows.map(row => row.event_id))
    .toEqual([...input.plan.eventIds].sort());
  expect((await runtime.query('SELECT canonical FROM runtime_import_lineage ORDER BY ordinal')).rows.map(row => row.canonical))
    .toEqual(input.plan.lineage.map(row => canonicalJson(row)));
  const deliveries = (await runtime.query('SELECT canonical FROM runtime_deliveries')).rows.map(row => row.canonical).sort();
  expect(deliveries).toEqual(baselineEventsA.map(row => canonicalJson(row)).sort());

  const before = await counts();
  await runtime.end();
  runtime = new Pool({ connectionString: pair.runtime.appUrl });
  await withTransaction(runtime, async client => {
    await client.query('SET TRANSACTION READ ONLY');
    expect(await lookupReceiptAssociation(client, input.request.idempotencyKey, expectation(input)))
      .toEqual({ status: 'exact', stored: applied });
    const foreign = { ...input.activation.scope, sellerEntityId: 'foreign-seller' };
    expect(await readStoredTarget(client, foreign, applied.approvedTarget.snapshotHash)).toBeNull();
    expect(await readStoredTarget(client, input.activation.scope, h('f'))).toBeNull();
    expect(await readStoredActivation(client, foreign)).toBeNull();
    expect(await lookupReceiptAssociation(client, input.request.idempotencyKey, { ...expectation(input), scope: foreign }))
      .toEqual({ status: 'conflict' });
    const snapshot = await readStoredTarget(client, input.activation.scope);
    expect(projectStoredParentView(snapshot!.records, input.plan.asOf).balanceCents).toBe(input.receipt.afterBalanceCents);
  });
  expect(await counts()).toEqual(before);
});

test('same customer IDs can coexist with distinct exact metadata in separate scopes', async () => {
  await reset();
  const a = fixture('a');
  const b = fixture('b', { customerName: 'Second scope buyer' });
  await withTransaction(runtime, client => store(client, a));
  await withTransaction(runtime, client => store(client, b));
  const customers = (await runtime.query(
    "SELECT record_id, canonical FROM parent_metadata WHERE family = 'customer' ORDER BY canonical",
  )).rows;
  expect(customers).toHaveLength(2);
  expect(customers[0].record_id).toBe(customers[1].record_id);
  expect(customers[0].canonical).not.toBe(customers[1].canonical);
  const before = await counts();
  await expect(withTransaction(runtime, client =>
    lockFirstImport(client, { ...a.activation.scope, companyId: 'foreign-company' }, 'foreign-request'),
  )).rejects.toThrow('scope mapping');
  expect(await counts()).toEqual(before);
});

test('historical snapshots remain exact after a test-only latest pointer advance', async () => {
  await reset();
  const input = fixture();
  const approved = (await withTransaction(runtime, client => store(client, input))).approvedTarget;
  const prior = input.approvedTarget;
  const latest = { ...prior, version: prior.version + 1, asOf: '2026-11-09T00:00:00.000Z',
    invoices: [...prior.invoices, {
      ...prior.invoices[0], ...baselineA.invoices[0], id: 'placeholder',
      identity: { ...prior.invoices[0].identity, recordId: 'test-backdated-invoice' },
    }] };
  latest.invoices[latest.invoices.length - 1].id = targetRecordId(latest.invoices.at(-1)!.identity);
  await installSnapshot(latest);
  await withTransaction(runtime, async client => {
    const current = await readStoredTarget(client, prior.scope);
    expect(current?.records).toEqual(latest);
    expect(projectStoredParentView(current!.records, prior.asOf).balanceCents).toBeGreaterThan(input.receipt.afterBalanceCents);
    expect(await readStoredTarget(client, prior.scope, approved.snapshotHash)).toEqual(approved);
    expect((await readStoredActivation(client, prior.scope))?.approvedTarget).toEqual(approved);
  });
});

function barrier() {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  return { waiting, release };
}

async function waitForAppLock(pid: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = (await admin.query('SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted', [pid])).rowCount;
    if (waiting) return;
    await delay(10);
  }
  throw new Error('Expected competing app transaction to block');
}

for (const mode of ['same-key', 'different-key', 'global-economic', 'global-key'] as const) {
  test(`serializes the ${mode} race as the runtime app role`, async () => {
    await reset();
    const winner = fixture();
    const contender = mode === 'same-key' ? winner : mode === 'global-key'
      ? fixture('b', { key: winner.request.idempotencyKey })
      : fixture('a', {
        key: 'competing-request', ...(mode === 'global-economic' ? { accountId: 'competing-account', eventSuffix: ':alias' } : {}),
      });
    const held = barrier();
    const proceed = barrier();
    const ready = barrier();
    let pid = 0;
    const first = withTransaction(runtime, async client => {
      const result = await store(client, winner);
      held.release();
      await proceed.waiting;
      return result;
    });
    await Promise.race([held.waiting, first]);
    const second = withTransaction(runtime, async client => {
      pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      ready.release();
      return store(client, contender);
    }).then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      await ready.waiting;
      await waitForAppLock(pid);
      expect((await counts()).runtime_activation_imports).toBe(0);
    } finally {
      proceed.release();
      await first;
    }
    const result = await second;
    if (mode === 'same-key') {
      expect(result).toEqual({ value: await first });
    } else {
      expect(result).toEqual({ error: expect.objectContaining({
        message: expect.stringContaining(mode === 'global-economic' ? 'global economic identity' : 'existing activation or key'),
      }) });
    }
    expect(await counts()).toMatchObject({
      parent_scopes: 1, parent_snapshots: 1, parent_targets: 1, runtime_activation_imports: 1,
      parent_financial_records: winner.receipt.targetRecordIds.length, activity_events: 1, sequence: 1,
    });
  });
}

test('a failure after each logical write rolls back every effect and counter', async () => {
  await reset();
  const input = fixture();
  const before = await counts();
  await admin.query(`CREATE FUNCTION test_abort_parent_import() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected failure' USING ERRCODE = 'P0001'; END; $$`);
  try {
    for (const table of tables) {
      const action = table === 'activity_counter' ? 'UPDATE' : 'INSERT';
      await admin.query(`CREATE TRIGGER test_abort_write AFTER ${action} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION test_abort_parent_import()`);
      try {
        await expect(withTransaction(runtime, client => store(client, input))).rejects.toThrow('injected failure');
        expect(await counts()).toEqual(before);
      } finally {
        await admin.query(`DROP TRIGGER test_abort_write ON ${table}`);
      }
    }
  } finally {
    await admin.query('DROP FUNCTION test_abort_parent_import()');
  }
});

test('retries the whole transaction after a real PostgreSQL serialization error', async () => {
  await reset();
  const input = fixture();
  const stale = barrier();
  const changed = barrier();
  let attempts = 0;
  const write = withTransaction(runtime, async client => {
    attempts += 1;
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await client.query('SELECT sequence FROM activity_counter WHERE singleton');
    if (attempts === 1) {
      stale.release();
      await changed.waiting;
    }
    return store(client, input);
  });
  await Promise.race([stale.waiting, write]);
  try {
    await runtime.query('UPDATE activity_counter SET sequence = sequence + 1 WHERE singleton');
  } finally {
    changed.release();
  }
  await expect(write).resolves.toMatchObject({ receipt: input.receipt });
  expect(attempts).toBe(2);
  expect(await counts()).toMatchObject({ parent_scopes: 1, parent_snapshots: 1, runtime_activation_imports: 1, activity_events: 1, sequence: 2 });
});

test('imports onto a nonempty baseline while preserving its instant, ensures and old economic records', async () => {
  await reset();
  const full = fixture();
  const { customers, accounts, billingConfigurations, invoices } = full.approvedTarget;
  const recordedTarget: TargetState = {
    ...emptyTargetA, version: 4, asOf: '2026-09-30T00:00:00.000Z',
    customers, accounts, billingConfigurations, invoices,
  };
  await installSnapshot(recordedTarget);
  const scope = full.activation.scope;
  const scoped = [scope.accountId, scope.companyId, scope.sellerEntityId];
  for (const [family, record, customerId] of [
    ['customer', customers[0], null],
    ['account', accounts[0], customers[0].id],
    ['billing_configuration', billingConfigurations[0], null],
  ] as const) {
    await admin.query(
      `INSERT INTO parent_metadata (account_id, company_id, seller_entity_id, family, record_id, customer_id, canonical, digest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [...scoped, family, record.id, customerId, canonicalJson(record), hashCanonical(record)],
    );
  }
  const input = fixture('a', { recordedTarget });
  expect(input.plan.eventIds).toContain(invoices[0].sourceEventId);
  expect(input.receipt.targetRecordIds).not.toContain(invoices[0].id);
  const invoice = invoices[0];
  await admin.query(
    `INSERT INTO parent_financial_records (account_id, company_id, seller_entity_id, record_id, source_ref, kind,
      source_record_id, source_record_version, event_id, canonical, digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [...scoped, invoice.id, invoice.identity.sourceRef, invoice.kind, invoice.identity.recordId,
      invoice.sourceRecordVersion, invoice.sourceEventId, canonicalJson(invoice), hashCanonical(invoice)],
  );
  const beforeMetadata = (await runtime.query('SELECT * FROM parent_metadata ORDER BY family')).rows;
  const stored = await withTransaction(runtime, client => store(client, input));
  expect(stored.approvedTarget.records.version).toBe(5);
  expect(stored.recordedTarget).toEqual(recordedTarget);
  expect(stored.plannerTarget).toEqual({ ...recordedTarget, asOf: input.plan.asOf });
  expect(hashTargetSnapshot(stored.recordedTarget)).not.toBe(hashTargetSnapshot(stored.plannerTarget));
  expect(stored.approvedTarget.records.invoices).toEqual(invoices);
  expect((await runtime.query('SELECT * FROM parent_metadata ORDER BY family')).rows).toEqual(beforeMetadata);
  expect(await counts()).toMatchObject({ parent_metadata: 3, parent_snapshots: 2, runtime_economic_outcomes: 4 });
});

for (const field of ['displayName', 'evidenceRefs', 'contractTerm'] as const) {
  test(`rejects a conflicting stored metadata ${field} ensure without partial writes`, async () => {
    await reset();
    const input = fixture();
    const scope = input.activation.scope;
    await installSnapshot(emptyTargetA);
    const customer = input.approvedTarget.customers[0];
    const config = input.approvedTarget.billingConfigurations[0];
    const record = field === 'contractTerm'
      ? { ...config, contractTerm: { ...config.contractTerm, anchorDay: config.contractTerm.anchorDay + 1 } }
      : field === 'displayName' ? { ...customer, displayName: 'Different name' } : { ...customer, evidenceRefs: ['different-citation'] };
    await admin.query(
      `INSERT INTO parent_metadata (account_id, company_id, seller_entity_id, family, record_id, canonical, digest)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [scope.accountId, scope.companyId, scope.sellerEntityId, 'scope' in record ? 'billing_configuration' : 'customer',
        record.id, canonicalJson(record), hashCanonical(record)],
    );
    const before = await counts();
    await expect(withTransaction(runtime, client => store(client, input))).rejects.toThrow('existing metadata bytes');
    expect(await counts()).toEqual(before);
  });
}

for (const change of ['none', 'observedAt', 'payload'] as const) {
  test(`compares existing delivery bytes including ${change === 'none' ? 'an identical replay' : change}`, async () => {
    await reset();
    const input = fixture();
    const [first] = input.bundle.bootstrapEvents;
    const original = structuredClone(first);
    if (change === 'observedAt') original.observedAt = '2026-11-08T00:00:00.000Z';
    if (change === 'payload') original.payload = { ...original.payload, tampered: 1 };
    original.contentHash = hashEvent(original);
    await admin.query('INSERT INTO runtime_deliveries VALUES ($1, $2, $3, $4, $5)',
      [original.sourceRef, original.id, original.contentHash, canonicalJson(original), hashCanonical(original)]);
    const before = await counts();
    const attempt = withTransaction(runtime, client => store(client, input));
    if (change === 'none') {
      await expect(attempt).resolves.toMatchObject({ receipt: input.receipt });
      expect((await counts()).runtime_deliveries).toBe(input.plan.eventIds.length);
    } else {
      await expect(attempt).rejects.toThrow('existing delivery bytes');
      expect(await counts()).toEqual(before);
    }
    expect((await runtime.query('SELECT canonical FROM runtime_deliveries WHERE source_ref = $1 AND event_id = $2',
      [original.sourceRef, original.id])).rows[0].canonical).toBe(canonicalJson(original));
  });
}

test('rejects cross-scope references in SQL under the application role', async () => {
  await reset();
  const a = fixture('a');
  const b = fixture('b');
  const stored = await withTransaction(runtime, client => store(client, a));
  const { accountId, companyId, sellerEntityId } = b.activation.scope;
  await runtime.query('INSERT INTO parent_scopes VALUES ($1, $2, $3)', [accountId, companyId, sellerEntityId]);
  await expect(runtime.query(
    'INSERT INTO parent_targets VALUES ($1, $2, $3, $4, $5)',
    [accountId, companyId, sellerEntityId, stored.approvedTarget.records.version, stored.approvedTarget.snapshotHash],
  )).rejects.toMatchObject({ code: '23503' });
  const account = b.approvedTarget.accounts[0];
  await expect(runtime.query(
    `INSERT INTO parent_metadata (account_id, company_id, seller_entity_id, family, record_id, customer_id, canonical, digest)
     VALUES ($1, $2, $3, 'account', $1, $4, $5, $6)`,
    [accountId, companyId, sellerEntityId, account.parentCustomerId, canonicalJson(account), hashCanonical(account)],
  )).rejects.toMatchObject({ code: '23503' });
  const configuration = a.approvedTarget.billingConfigurations[0];
  await expect(runtime.query(
    `INSERT INTO parent_metadata (account_id, company_id, seller_entity_id, family, record_id, canonical, digest)
     VALUES ($1, $2, $3, 'billing_configuration', $4, $5, $6)`,
    [accountId, companyId, sellerEntityId, configuration.id, canonicalJson(configuration), hashCanonical(configuration)],
  )).rejects.toMatchObject({ code: '23514' });
});

test('stored aggregate reads reject a corrupt digest despite valid SQL shape and key columns', async () => {
  await reset();
  const input = fixture();
  await withTransaction(runtime, client => store(client, input));
  await expect(admin.query('UPDATE runtime_activation_imports SET plan_digest = plan_digest'))
    .rejects.toMatchObject({ code: '55000' });
  await withTransaction(admin, async client => {
    await client.query('ALTER TABLE runtime_activation_imports DISABLE TRIGGER runtime_activation_imports_immutable');
    await client.query('UPDATE runtime_activation_imports SET plan_digest = $1', [h('f')]);
    await client.query('ALTER TABLE runtime_activation_imports ENABLE TRIGGER runtime_activation_imports_immutable');
  });
  await expect(withTransaction(runtime, client => readStoredActivation(client, input.activation.scope)))
    .rejects.toThrow('Stored canonical digest differs');
});

function refreshPlan(input: Fixture) {
  input.plan.hash = hashPlan(input.plan);
  input.bundle.bootstrapVerification.planHash = input.plan.hash;
  input.bundle.bootstrapVerification.hash = hashBootstrapVerificationResult(input.bundle.bootstrapVerification);
  input.bundle.reviewPackage.previewPlanHash = input.plan.hash;
  input.bundle.reviewPackage.hash = hashReviewPackage(input.bundle.reviewPackage);
  input.request.expectedPackageHash = input.bundle.reviewPackage.hash;
  input.receipt.planHash = input.plan.hash;
  input.bundle.hash = hashBundleV2(input.bundle);
}

test('rejects receipt IDs that include metadata or alter financial operation order', async () => {
  await reset();
  const before = await counts();
  for (const mode of ['metadata', 'reorder']) {
    const input = fixture();
    if (mode === 'metadata') input.receipt.targetRecordIds.push(input.approvedTarget.customers[0].id);
    else input.receipt.targetRecordIds.reverse();
    await expect(withTransaction(runtime, client => store(client, input))).rejects.toThrow('receipt bindings');
    expect(await counts()).toEqual(before);
  }
});

test('rejects target ID, financial scope and allocation errors without committing storage', async () => {
  await reset();
  const before = await counts();
  for (const mode of ['id', 'scope', 'allocation']) {
    const input = fixture();
    const invoice = input.plan.operations.find(operation => operation.op === 'insert_invoice')!.record;
    const allocation = input.plan.operations.find(operation => operation.op === 'add_allocation')!.record;
    if (mode === 'id') invoice.id = 'unexpected-target-id';
    if (mode === 'scope') invoice.scope = emptyTargetB.scope;
    if (mode === 'allocation') allocation.amountCents = 5_000_000;
    refreshPlan(input);
    await expect(withTransaction(runtime, client => store(client, input))).rejects.toThrow();
    expect(await counts()).toEqual(before);
  }
});

test('preserves canonical Unicode escape bytes in reviewed customer text', async () => {
  await reset();
  const customerName = 'Shared Buyer\u0000\ud800\\u0000\\\u0000 \u{1F600}';
  const input = fixture('a', { customerName });
  const stored = await withTransaction(runtime, client => store(client, input));
  expect(stored.approvedTarget.records.customers[0].displayName).toBe(customerName);
});

function reversalEvent(): RawSourceEvent {
  const original = baselineEventsA[1];
  const contract = validSpecA.sourceContracts.find(candidate => candidate.kind === 'reversal')!;
  const reversed = {
    ...original, resource: contract.resource, id: 'evt-test-reversal', kind: 'reversal' as const,
    sequence: 6, recordId: 'test-reversal', effectiveAt: '2026-10-01T00:00:00.000Z',
    payload: {
      [contract.recordIdField]: 'test-reversal', [contract.recordVersionField!]: 1,
      [contract.accountIdField!]: original.rawIdentity.sourceAccountId!, effective_date: '2026-10-01',
      reversed_kind: 'payment', reversed_id: original.recordId,
    },
  };
  return { ...reversed, contentHash: hashEvent(reversed) };
}

test('stores a full reversal without changing the original payment or allocation bytes', async () => {
  await reset();
  const event = reversalEvent();
  const input = fixture('a', { events: [...baselineEventsA, event] });
  const stored = await withTransaction(runtime, client => store(client, input));
  expect(stored.approvedTarget.records.payments).toEqual(baselineA.payments);
  expect(stored.approvedTarget.records.allocations).toEqual(baselineA.allocations);
  expect(stored.approvedTarget.records.reversals).toHaveLength(1);
  expect(stored.receipt.afterBalanceCents).toBe(280000);
  const originals = (await runtime.query(
    "SELECT canonical FROM parent_financial_records WHERE kind IN ('payment', 'allocation')",
  )).rows.map(row => row.canonical).sort();
  expect(originals).toEqual([...baselineA.payments, ...baselineA.allocations].map(canonicalJson).sort());
});

test('rejects a reversal of nonexistent funding and leaves no partial writes', async () => {
  await reset();
  const input = fixture('a', { events: [...baselineEventsA, reversalEvent()] });
  const reversal = input.plan.operations.find(operation => operation.op === 'full_reverse')!;
  reversal.record.reversedRecordId = 'unrelated-funding';
  refreshPlan(input);
  const before = await counts();
  await expect(withTransaction(runtime, client => store(client, input))).rejects.toMatchObject({ code: 'REVERSAL_PREREQUISITE' });
  expect(await counts()).toEqual(before);
});

test('a matching domain hash does not allow differently ordered canonical replay bytes', async () => {
  await reset();
  const original = fixture();
  const applied = await withTransaction(runtime, client => store(client, original));
  const changed = structuredClone(original);
  changed.bundle.manifest.streams.reverse();
  expect(hashBundleV2(changed.bundle)).toBe(original.bundle.hash);
  expect(canonicalJson(changed.bundle)).not.toBe(canonicalJson(original.bundle));
  const before = await counts();
  await expect(withTransaction(runtime, client => store(client, changed))).rejects.toThrow('replay request or bundle bytes');
  expect(await counts()).toEqual(before);
  expect(await withTransaction(runtime, client => store(client, original))).toEqual(applied);
});

test('a persistent retryable SQL error aborts after three complete attempts', async () => {
  await reset();
  const input = fixture();
  const before = await counts();
  let attempts = 0;
  await admin.query(`CREATE FUNCTION test_retry_parent_import() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected serialization failure' USING ERRCODE = '40001'; END; $$`);
  await admin.query(`CREATE TRIGGER test_retry_write AFTER INSERT ON activity_events
    FOR EACH ROW EXECUTE FUNCTION test_retry_parent_import()`);
  try {
    await expect(withTransaction(runtime, client => {
      attempts += 1;
      return store(client, input);
    })).rejects.toMatchObject({ code: '40001' });
    expect(attempts).toBe(3);
    expect(await counts()).toEqual(before);
  } finally {
    await admin.query('DROP TRIGGER test_retry_write ON activity_events');
    await admin.query('DROP FUNCTION test_retry_parent_import()');
  }
});
