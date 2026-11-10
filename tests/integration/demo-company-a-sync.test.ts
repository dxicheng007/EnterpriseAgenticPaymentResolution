import { expect, test, vi } from 'vitest';
import { companyADemo as demo } from '../../packages/contracts/src/demo-company-a.js';
import { createCompanyADemoSync } from '../../apps/worker/src/demo-sync.js';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createControlDb } from '@eapr/storage/control-db';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { migrate } from '../../scripts/migrate.js';
import { dropTest, provisionTest } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';
import { selectedProfile } from '../../apps/worker/src/activation-validation.js';
import { createParentReads } from '../../apps/worker/src/parent-reads.js';
import { createSyncApplier } from '../../apps/worker/src/sync/apply.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { createCurrentAuthority } from '../../apps/worker/src/sync/current-authority.js';
import { applyBaseline, captureApplyEvents, createSyncApplyFixture, syncApplyClock, syncApplyInstant, type SyncApplyFixture } from '../fixtures/sync-apply.js';

async function fixture(run: (data: SyncApplyFixture) => Promise<void>) {
  const data = await createSyncApplyFixture(undefined, undefined, { seed: demo.seed });
  try { await run(data); } finally { await data.close(); }
}

function service(data: SyncApplyFixture, overrides: Partial<Parameters<typeof createCompanyADemoSync>[0]> = {}) {
  return createCompanyADemoSync({
    db: data.db, clock: syncApplyClock, registered: data.scopeReader,
    fetchChanges: data.source.fetchChanges, observe: data.source.readCurrentSemantics, ...overrides,
  });
}

function readParent(data: SyncApplyFixture, asOf: string, snapshotHash?: string) {
  return createParentReads(data.db, syncApplyClock, data.scopeReader).readParent(demo.scope.accountId, { asOf, snapshotHash });
}

const inject = (data: SyncApplyFixture, changes: Partial<Parameters<SyncApplyFixture['operator']['freshPaymentA']>[1]> = {}) =>
  data.operator.freshPaymentA(data.operatorToken, { ...demo.scenario, ...changes });

async function assertNoApply(data: SyncApplyFixture) {
  expect((await data.db.query('SELECT receipt_id FROM runtime_sync_receipts')).rowCount).toBe(0);
  expect(await readParent(data, demo.scenario.observedAt)).toMatchObject({ balanceCents: 80000 });
}

function changeAuthority(data: SyncApplyFixture, action: 'pause' | 'revoke') {
  const api = createCurrentAuthority({
    db: data.db, clock: syncApplyClock, observe: data.source.readCurrentSemantics,
    admission: { authorize: async () => ({
      reviewer: { reviewerId: 'demo-test-reviewer', sessionId: 'demo-test-session' },
      allowedAccountIds: [demo.scope.accountId], allowedSourceRefs: [demo.sourceRef],
    }) },
  });
  return api.command({}, { schemaVersion: '1', identity: data.identity, action, expectedEpoch: 1, idempotencyKey: 'demo-' + action });
}

test('genuine fixed approval applies actual source changes once and recovers the same receipt after revoke', () => fixture(async data => {
  const { stored, identity } = data;
  expect(identity.scope).toEqual(demo.scope);
  expect(stored.bundle.manifest).toMatchObject({ id: demo.manifestId, sourceRef: demo.sourceRef, asOf: demo.cutover });
  expect(stored.receipt.afterBalanceCents).toBe(80000);
  expect(selectedProfile(stored.bundle)).toMatchObject({
    id: demo.profileId, version: demo.profileVersion, sourceAccountIds: [demo.scenario.accountId],
    parentCustomerId: demo.parentCustomerId,
  });
  const control = createControlDb({ connectionString: data.pair.control.appUrl });
  try {
    const { spec } = await createCandidateRegistry(control, data.registryRoot).getArtifact(stored.bundle.artifact.hash);
    expect(spec).toMatchObject({ id: demo.connectorId, version: demo.connectorVersion, runtimeModelCalls: 'forbidden' });
  } finally {
    await control.end();
  }
  expect(stored.bundle.snapshot.eventIds.filter(id => demo.eventIds.some(eventId => id === eventId))).toEqual([]);
  const approvedHash = stored.approvedTarget.snapshotHash;
  const currentBefore = await readParent(data, demo.scenario.observedAt);
  expect(currentBefore.balanceCents).toBe(80000);
  await inject(data);
  const first = await service(data).runOnce();
  expect(first).toMatchObject({ replayed: false, receipt: {
    activationId: identity.activationId, beforeBalanceCents: 80000, afterBalanceCents: 50000,
    eventIds: [...demo.eventIds], targetRecordIds: expect.any(Array),
  } });
  expect(first.receipt.targetRecordIds).toHaveLength(2);
  await changeAuthority(data, 'revoke');
  const fetchChanges = vi.fn(data.source.fetchChanges);
  expect(await service(data, { fetchChanges }).runOnce()).toEqual({ receipt: first.receipt, replayed: true });
  expect(fetchChanges).not.toHaveBeenCalled();
  expect((await data.db.query('SELECT unit_hash FROM runtime_sync_units')).rowCount).toBe(1);
  expect((await data.db.query('SELECT receipt_id FROM runtime_sync_receipts')).rowCount).toBe(1);
  expect(await readParent(data, demo.scenario.observedAt)).toMatchObject({
    balanceCents: 50000, version: currentBefore.version + 1,
    records: {
      payments: expect.arrayContaining([expect.objectContaining({ sourceEventId: demo.eventIds[0], amountCents: 30000 })]),
      allocations: expect.arrayContaining([expect.objectContaining({ sourceEventId: demo.eventIds[1], amountCents: 30000 })]),
    },
  });
  expect(await readParent(data, demo.cutover)).toMatchObject({ balanceCents: 80000 });
  expect(await readParent(data, demo.cutover, approvedHash)).toMatchObject({
    balanceCents: 80000, snapshotHash: approvedHash, records: stored.approvedTarget.records,
  });
}), 120_000);

test.each(['pause', 'revoke'] as const)('%s blocks new writes', action => fixture(async data => {
  await inject(data);
  await changeAuthority(data, action);
  await expect(service(data).runOnce()).rejects.toMatchObject({ code: 'AUTHORITY_INACTIVE' });
  await assertNoApply(data);
}), 120_000);

test.each(['selected', 'foreign'] as const)('extra %s input fails without applying the scenario', scope => fixture(async data => {
  await inject(data);
  await data.addInvoice('extra', scope === 'selected' ? demo.scenario.accountId : 'cust-a-d22feb38e846-2');
  await expect(service(data).runOnce()).rejects.toMatchObject({ code: 'SYNC_COVERAGE_UNSUPPORTED' });
  await assertNoApply(data);
}), 120_000);

test.each(['wrong instant', 'wrong amount', 'partial', 'extra', 'conflicting'] as const)(
  'valid P1 history with %s cannot be recovered as the fixed scenario',
  mismatch => fixture(async data => {
    await inject(data, mismatch === 'wrong amount' ? { amount: '200.00' } : {});
    const capture = await createRuntimeCapture({ db: data.db, clock: syncApplyClock }).openCommitted(data.identity);
    let page = await data.source.fetchChanges(demo.sourceRef, demo.streams[0], applyBaseline(data));
    if (mismatch === 'partial' || mismatch === 'conflicting') page = { ...page, events: page.events.slice(0, 1), next: String(Number(page.after) + 1) };
    if (mismatch === 'extra') {
      const allocation = page.events[1]!;
      await captureApplyEvents(data, page.after, [...page.events, { ...allocation, id: 'extra-allocation-alias' }]);
    } else {
      await capture.capturePage(page);
    }
    const applier = createSyncApplier({ db: data.db, clock: syncApplyClock, identity: data.identity, observe: data.source.readCurrentSemantics });
    const prepared = await applier.prepare(mismatch === 'wrong instant' ? syncApplyInstant : demo.scenario.observedAt);
    expect((await applier.applyBatch(prepared.plan!, prepared.expectedEpoch)).replayed).toBe(false);
    if (mismatch === 'conflicting') {
      await capture.capturePage(await data.source.fetchChanges(demo.sourceRef, demo.streams[0], page.next));
      const remaining = await applier.prepare(demo.scenario.observedAt);
      expect((await applier.applyBatch(remaining.plan!, remaining.expectedEpoch)).replayed).toBe(false);
    }
    const fetchChanges = vi.fn(data.source.fetchChanges);
    await expect(service(data, { fetchChanges }).runOnce()).rejects.toMatchObject({ code: 'SYNC_STORAGE_INVALID' });
    expect(fetchChanges).not.toHaveBeenCalled();
  }), 120_000);

test('genuine registration without an A5 import cannot capture or apply', () => fixture(async data => {
  const namespace = testNamespace('noapply');
  const pair = await provisionTest(namespace);
  const db = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  try {
    await migrate(pair, ['runtime']);
    const fetchChanges = vi.fn(data.source.fetchChanges);
    await expect(service(data, { db, fetchChanges }).runOnce()).rejects.toMatchObject({ code: 'AUTHORITY_NOT_FOUND' });
    expect(fetchChanges).not.toHaveBeenCalled();
    expect((await db.query('SELECT 1 FROM runtime_capture_lanes')).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM parent_targets')).rowCount).toBe(0);
  } finally {
    await db.end();
    await dropTest(namespace);
  }
}), 120_000);

test('valid pending events with the fixed IDs and a different amount are ineligible', () => fixture(async data => {
  await inject(data, { amount: '200.00' });
  await expect(service(data).runOnce()).rejects.toMatchObject({ code: 'DEMO_SYNC_SCENARIO_MISMATCH' });
  await assertNoApply(data);
}), 120_000);
