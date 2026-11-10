import { afterAll, beforeAll, expect, test } from 'vitest';
import { createParentReads } from '../../apps/worker/src/parent-reads.js';
import { CompanyADemoSyncError, createCompanyADemoSync } from '../../apps/worker/src/demo-sync.js';
import { createSyncApplier } from '../../apps/worker/src/sync/apply.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { companyADemo } from '../../packages/contracts/src/demo-company-a.js';
import {
  applyBaseline, applyFinancialStream, createSyncApplyFixture, syncApplyClock, syncApplyInstant,
  type SyncApplyFixture,
} from '../fixtures/sync-apply.js';

let data: SyncApplyFixture;

beforeAll(async () => {
  data = await createSyncApplyFixture(undefined, undefined, { seed: companyADemo.seed });
}, 120_000);

afterAll(async () => {
  await data?.close();
});

function serviceFor(fixture: SyncApplyFixture, registered = fixture.scopeReader) {
  return createCompanyADemoSync({
    db: fixture.db,
    clock: syncApplyClock,
    registered,
    fetchChanges: fixture.source.fetchChanges,
    observe: fixture.source.readCurrentSemantics,
  });
}

function service(registered = data.scopeReader) {
  return serviceFor(data, registered);
}

test('fixed Company A sync applies once and recovers the immutable receipt', async () => {
  expect(data.identity.scope.accountId).toBe(companyADemo.accountId);
  expect(data.stored.bundle.manifest.id).toBe(companyADemo.manifestId);
  expect(data.stored.approvedTarget.records.version).toBe(1);
  const initialReceipt = data.stored.receipt;
  const initialSnapshotHash = data.stored.approvedTarget.snapshotHash;
  expect(data.stored.bundle.snapshot.eventIds).not.toContain(companyADemo.scenario.paymentEventId);
  expect(data.stored.bundle.snapshot.eventIds).not.toContain(companyADemo.scenario.allocationEventId);

  const unavailable = {
    readSnapshot: async () => ({
      index: { schemaVersion: '1' as const, hash: '0'.repeat(64), entries: [] },
      resolveRegisteredScope: () => null,
    }),
  };
  await expect(service(unavailable).runOnce()).rejects.toMatchObject<Partial<CompanyADemoSyncError>>({
    code: 'DEMO_BINDING_INVALID',
  });
  expect((await data.db.query('SELECT count(*)::int AS count FROM runtime_sync_receipts')).rows[0]!.count).toBe(0);

  await data.operator.freshPaymentA(data.operatorToken, {
    id: companyADemo.scenario.id,
    accountId: companyADemo.sourceAccountId,
    invoiceId: companyADemo.scenario.invoiceId,
    amount: companyADemo.scenario.amount,
    effectiveDate: companyADemo.scenario.effectiveDate,
    observedAt: companyADemo.scenario.observedAt,
  });

  const applied = await service().runOnce();
  expect(applied).toMatchObject({
    replayed: false,
    receipt: {
      scope: { accountId: companyADemo.accountId },
      eventIds: [companyADemo.scenario.paymentEventId, companyADemo.scenario.allocationEventId],
      beforeBalanceCents: 80000,
      afterBalanceCents: 50000,
    },
  });

  const replayed = await service().runOnce();
  expect(replayed.replayed).toBe(true);
  expect(replayed.receipt.id).toBe(applied.receipt.id);
  const effects = await data.db.query<{ receipts: number; records: number; units: number }>(`
    SELECT
      (SELECT count(*)::int FROM runtime_sync_receipts) AS receipts,
      (SELECT count(*)::int FROM runtime_sync_economic_outcomes) AS records,
      (SELECT count(*)::int FROM runtime_sync_units WHERE receipt_id IS NOT NULL) AS units
  `);
  expect(effects.rows[0]).toEqual({ receipts: 1, records: 2, units: 1 });

  const parent = createParentReads(data.db, syncApplyClock, data.scopeReader);
  const current = await parent.readParent(companyADemo.accountId, {});
  expect(current.balanceCents).toBe(50000);
  expect(current.version).toBe(data.stored.approvedTarget.records.version + 1);
  expect((await parent.readParent(companyADemo.accountId, { asOf: companyADemo.scenario.asOf })).balanceCents).toBe(50000);
  expect((await parent.readParent(companyADemo.accountId, { asOf: companyADemo.cutover })).balanceCents).toBe(80000);
  expect((await parent.readActivation(companyADemo.accountId)).initialReceipt).toEqual(initialReceipt);
  const initialSnapshot = await data.db.query<{ snapshot_hash: string }>(`
    SELECT snapshot_hash FROM parent_snapshots
    WHERE account_id = $1 AND target_version = $2
  `, [companyADemo.accountId, data.stored.approvedTarget.records.version]);
  expect(initialSnapshot.rows).toEqual([{ snapshot_hash: initialSnapshotHash }]);
}, 120_000);

test('rejects fixed IDs previously applied by the generic November path', async () => {
  const fixture = await createSyncApplyFixture(undefined, undefined, { seed: companyADemo.seed });
  try {
    await fixture.operator.freshPaymentA(fixture.operatorToken, {
      id: companyADemo.scenario.id,
      accountId: companyADemo.sourceAccountId,
      invoiceId: companyADemo.scenario.invoiceId,
      amount: companyADemo.scenario.amount,
      effectiveDate: companyADemo.scenario.effectiveDate,
      observedAt: companyADemo.scenario.observedAt,
    });
    const capture = await createRuntimeCapture({ db: fixture.db, clock: syncApplyClock }).openCommitted(fixture.identity);
    const page = await fixture.source.fetchChanges(
      companyADemo.sourceRef, applyFinancialStream, applyBaseline(fixture),
    );
    await capture.capturePage(page);
    const generic = createSyncApplier({
      db: fixture.db, clock: syncApplyClock, identity: fixture.identity, observe: fixture.source.readCurrentSemantics,
    });
    const prepared = await generic.prepare(syncApplyInstant);
    expect(prepared.plan).not.toBeNull();
    const genericReceipt = await generic.applyBatch(prepared.plan!, prepared.expectedEpoch);
    expect(genericReceipt.receipt.afterBalanceCents).toBe(50000);

    const parent = createParentReads(fixture.db, syncApplyClock, fixture.scopeReader);
    const before = await parent.readParent(companyADemo.accountId, {});
    await expect(serviceFor(fixture).runOnce()).rejects.toMatchObject<Partial<CompanyADemoSyncError>>({
      code: 'DEMO_HISTORY_INVALID',
    });
    const after = await parent.readParent(companyADemo.accountId, {});
    expect(after.balanceCents).toBe(before.balanceCents);
    expect(after.version).toBe(before.version);
    expect((await fixture.db.query('SELECT count(*)::int AS count FROM runtime_sync_receipts')).rows[0]!.count).toBe(1);
  } finally {
    await fixture.close();
  }
}, 120_000);

test('foreign pending input fails without a parent write', async () => {
  const fixture = await createSyncApplyFixture(undefined, undefined, { seed: companyADemo.seed });
  try {
    await fixture.addInvoice('demo-company-a-foreign', companyADemo.sourceAccountId);
    await fixture.operator.freshPaymentA(fixture.operatorToken, {
      id: companyADemo.scenario.id,
      accountId: companyADemo.sourceAccountId,
      invoiceId: companyADemo.scenario.invoiceId,
      amount: companyADemo.scenario.amount,
      effectiveDate: companyADemo.scenario.effectiveDate,
      observedAt: companyADemo.scenario.observedAt,
    });
    const parent = createParentReads(fixture.db, syncApplyClock, fixture.scopeReader);
    const before = await parent.readParent(companyADemo.accountId, {});
    await expect(serviceFor(fixture).runOnce()).rejects.toMatchObject({ code: 'SYNC_COVERAGE_UNSUPPORTED' });
    const after = await parent.readParent(companyADemo.accountId, {});
    expect(after.balanceCents).toBe(80000);
    expect(after.version).toBe(before.version);
    expect((await fixture.db.query('SELECT count(*)::int AS count FROM runtime_sync_receipts')).rows[0]!.count).toBe(0);
  } finally {
    await fixture.close();
  }
}, 120_000);
