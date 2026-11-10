import { beforeEach, expect, test, vi } from 'vitest';
import { canonicalJson, hashCanonical, targetRecordId, type ChangePage, type ReceiptResponse } from '@eapr/contracts';
import { eventA } from '../../../packages/sources/src/company-a.js';
import { companyADemo } from '../../../packages/contracts/src/demo-company-a.js';

const mocks = vi.hoisted(() => ({
  ingress: vi.fn(),
  stored: vi.fn(),
  openCommitted: vi.fn(),
  prepare: vi.fn(),
  applyBatch: vi.fn(),
  readReceipt: vi.fn(),
  readUnit: vi.fn(),
}));

vi.mock('../src/authority-identity.js', () => ({ readIngressAuthorityIdentity: mocks.ingress }));
vi.mock('@eapr/parent/activation-store', () => ({ readStoredActivation: mocks.stored }));
vi.mock('@eapr/parent/sync-store', async importOriginal => ({
  ...await importOriginal<typeof import('@eapr/parent/sync-store')>(),
  readSyncReceipt: mocks.readReceipt,
  readSyncUnit: mocks.readUnit,
}));
vi.mock('../src/sync/capture.js', () => ({
  createRuntimeCapture: () => ({ openCommitted: mocks.openCommitted }),
}));
vi.mock('../src/sync/apply.js', () => ({
  createSyncApplier: () => ({ prepare: mocks.prepare, applyBatch: mocks.applyBatch }),
}));

import { CompanyADemoSyncError, createCompanyADemoSync } from '../src/demo-sync.js';

const scope = {
  accountId: companyADemo.accountId,
  companyId: companyADemo.companyId,
  sellerEntityId: companyADemo.sellerEntityId,
};
const identity = { scope, activationId: 'activation:demo-a', bundleHash: 'a'.repeat(64) };
const artifactHash = 'b'.repeat(64);
const profileHash = 'c'.repeat(64);
const manifestHash = 'd'.repeat(64);
const profile = {
  id: companyADemo.profileId, version: companyADemo.profileVersion, hash: profileHash,
  sourceRef: companyADemo.sourceRef, scope, parentCustomerId: companyADemo.parentCustomerId,
  sourceAccountIds: [companyADemo.sourceAccountId],
};
const manifest = {
  id: companyADemo.manifestId, companyId: companyADemo.companyId, sourceRef: companyADemo.sourceRef,
  epoch: companyADemo.manifestEpoch, asOf: companyADemo.cutover, hash: manifestHash,
};
const registered = {
  readSnapshot: async () => ({
    resolveRegisteredScope: () => ({
      entry: {
        accountId: companyADemo.accountId, scope, profileHash,
        manifestId: companyADemo.manifestId, manifestHash, manifestAsOf: companyADemo.cutover,
      },
      profile,
      manifest,
    }),
  }),
};

function financialEvents() {
  return [
    eventA({
      kind: 'payment',
      recordId: companyADemo.scenario.paymentRecordId,
      sourceAccountId: companyADemo.sourceAccountId,
      effectiveDate: companyADemo.scenario.effectiveDate,
      fields: { amount: companyADemo.scenario.amount },
    }, 1, companyADemo.scenario.observedAt),
    eventA({
      kind: 'allocation',
      recordId: companyADemo.scenario.allocationRecordId,
      sourceAccountId: companyADemo.sourceAccountId,
      effectiveDate: companyADemo.scenario.effectiveDate,
      fields: {
        amount: companyADemo.scenario.amount,
        funding_kind: 'payment',
        funding_id: companyADemo.scenario.paymentRecordId,
        invoice_id: companyADemo.scenario.invoiceId,
      },
    }, 2, companyADemo.scenario.observedAt),
  ];
}

function targetId(kind: 'payment' | 'allocation', recordId: string) {
  return targetRecordId({ sourceRef: companyADemo.sourceRef, sellerEntityId: companyADemo.sellerEntityId, kind, recordId });
}

function prepared(events = financialEvents()) {
  const paymentId = targetId('payment', companyADemo.scenario.paymentRecordId);
  const allocationId = targetId('allocation', companyADemo.scenario.allocationRecordId);
  return {
    events,
    expectedEpoch: 1,
    plan: {
      hash: 'e'.repeat(64), scope, artifactHash, profileHash, expectedTargetVersion: 1,
      eventIds: events.map(event => event.id),
      expectedBalanceCents: 50000,
      asOf: companyADemo.scenario.asOf,
      operations: [
        {
          op: 'insert_payment',
          record: {
            id: paymentId,
            identity: {
              sourceRef: companyADemo.sourceRef, sellerEntityId: companyADemo.sellerEntityId,
              kind: 'payment', recordId: companyADemo.scenario.paymentRecordId,
            },
            sourceRecordVersion: 1, scope, effectiveAt: companyADemo.scenario.asOf,
            sourceEventId: companyADemo.scenario.paymentEventId, currency: 'USD', amountCents: 30000, kind: 'payment',
          },
        },
        {
          op: 'add_allocation',
          record: {
            id: allocationId,
            identity: {
              sourceRef: companyADemo.sourceRef, sellerEntityId: companyADemo.sellerEntityId,
              kind: 'allocation', recordId: companyADemo.scenario.allocationRecordId,
            },
            sourceRecordVersion: 1, scope, effectiveAt: companyADemo.scenario.asOf,
            sourceEventId: companyADemo.scenario.allocationEventId, currency: 'USD', amountCents: 30000,
            kind: 'allocation', fundingKind: 'payment',
            fundingRecordId: companyADemo.scenario.paymentRecordId, invoiceRecordId: companyADemo.scenario.invoiceId,
          },
        },
      ],
      lineage: [],
    },
  };
}

const receipt: ReceiptResponse = {
  replayed: false,
  receipt: {
    id: 'receipt:demo-company-a', scope, activationId: identity.activationId, epoch: 1, artifactHash,
    planHash: 'e'.repeat(64), eventIds: [...companyADemoEventIds()],
    targetRecordIds: [
      targetId('payment', companyADemo.scenario.paymentRecordId),
      targetId('allocation', companyADemo.scenario.allocationRecordId),
    ],
    beforeBalanceCents: 80000, afterBalanceCents: 50000, status: 'applied',
    committedAt: '2026-11-10T00:00:00.000Z',
  },
};

function companyADemoEventIds() {
  return [companyADemo.scenario.paymentEventId, companyADemo.scenario.allocationEventId] as const;
}

function historyLocator(candidateCount = '1') {
  const plan = prepared().plan;
  return {
    unit_hash: 'f'.repeat(64), receipt_id: receipt.receipt.id,
    plan_hash: receipt.receipt.planHash, plan: canonicalJson(plan),
    plan_digest: hashCanonical(plan), candidate_count: candidateCount,
  };
}

function fakeDb(history: object[] = []) {
  const client = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes('FROM runtime_sync_units u') ? history : [],
      rowCount: 0,
    })),
    release: vi.fn(),
  };
  return { connect: vi.fn(async () => client), query: client.query };
}

function progressAt(financeCursor = '0') {
  return {
    schemaVersion: '1' as const,
    lane: { schemaVersion: '1' as const, sourceRef: companyADemo.sourceRef, manifestHash },
    streams: [
      { streamId: 'a-finance', transport: 'api' as const, baselineCursor: '0', captureCursor: financeCursor,
        capturedRecords: Number(financeCursor), capturedPages: financeCursor === '0' ? 0 : 1,
        lastCapturedAt: financeCursor === '0' ? null : '2026-11-10T00:00:00.000Z', lastIncident: null },
      { streamId: 'a-semantics', transport: 'semantic' as const, baselineCursor: '0', captureCursor: '0',
        capturedRecords: 0, capturedPages: 0, lastCapturedAt: null, lastIncident: null },
    ],
  };
}

function capture() {
  const cursors = new Map([['a-finance', '0'], ['a-semantics', '0']]);
  return {
    lane: { schemaVersion: '1' as const, sourceRef: companyADemo.sourceRef, manifestHash },
    readProgress: vi.fn(async () => progressAt(cursors.get('a-finance'))),
    capturePage: vi.fn(async (page: ChangePage) => {
      cursors.set(page.streamId, page.next);
      return { disposition: 'captured' as const, captured: page.events.length, cursor: page.next, replayed: false };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ingress.mockResolvedValue({ identity, sourceRef: companyADemo.sourceRef, artifactHash, profileHash, manifestHash });
  mocks.stored.mockResolvedValue({
    bundleHash: identity.bundleHash,
    activation: { id: identity.activationId, artifactHash, profileHash, manifestHash },
    bundle: {
      request: { expectedProfileHash: profileHash },
      profiles: [profile],
      manifest,
      artifact: {
        hash: artifactHash, sourceRef: companyADemo.sourceRef, requiredProfileHashes: [profileHash],
        normalizedPlan: {
          runtimeModelCalls: 'forbidden',
          capture: [
            { streamId: 'a-finance', transport: 'api', pageSize: 100 },
            { streamId: 'a-semantics', transport: 'semantic', pageSize: 100 },
          ],
        },
      },
    },
  });
  mocks.openCommitted.mockResolvedValue(capture());
  mocks.prepare.mockResolvedValue(prepared());
  mocks.applyBatch.mockResolvedValue(receipt);
  mocks.readReceipt.mockResolvedValue(null);
  mocks.readUnit.mockResolvedValue(null);
});

test('drains both streams with terminal probes and dispatches the fixed prepared plan', async () => {
  const events = financialEvents();
  const fetchChanges = vi.fn(async (_sourceRef: string, streamId: string, after: string): Promise<ChangePage> => ({
    sourceRef: companyADemo.sourceRef, streamId, after,
    next: streamId === 'a-finance' && after === '0' ? '2' : after,
    complete: true,
    events: streamId === 'a-finance' && after === '0' ? events : [],
  }));
  const result = await createCompanyADemoSync({
    db: fakeDb() as never, clock: () => new Date('2026-11-10T00:00:00.000Z'),
    registered, fetchChanges, observe: vi.fn(),
  }).runOnce();
  expect(result).toEqual(receipt);
  expect(fetchChanges.mock.calls.map(([, streamId, after]) => [streamId, after])).toEqual([
    ['a-finance', '0'], ['a-finance', '2'], ['a-semantics', '0'],
  ]);
  expect(mocks.prepare).toHaveBeenCalledWith(companyADemo.scenario.asOf);
  expect(mocks.applyBatch).toHaveBeenCalledWith(expect.objectContaining({
    eventIds: [...companyADemoEventIds()],
  }), 1);
});

test('recovers the exact validated pair before opening capture', async () => {
  const locator = historyLocator();
  const events = financialEvents();
  mocks.readReceipt.mockResolvedValue(receipt.receipt);
  mocks.readUnit.mockResolvedValue({
    receiptId: receipt.receipt.id,
    planHash: receipt.receipt.planHash,
    asOf: companyADemo.scenario.asOf,
    lane: { sourceRef: companyADemo.sourceRef },
    identity,
    members: companyADemoEventIds().map(eventId => ({ event: { eventId } })),
    coverage: { deliveries: events.map(event => ({ event })) },
  });
  const result = await createCompanyADemoSync({
    db: fakeDb([locator]) as never, clock: () => new Date(), registered,
    fetchChanges: vi.fn(), observe: vi.fn(),
  }).runOnce();
  expect(result).toEqual({ receipt: receipt.receipt, replayed: true });
  expect(mocks.openCommitted).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.applyBatch).not.toHaveBeenCalled();
});

test('rejects a partial historical association instead of treating it as replay', async () => {
  const locator = historyLocator();
  mocks.readReceipt.mockResolvedValue(receipt.receipt);
  mocks.readUnit.mockResolvedValue({
    receiptId: receipt.receipt.id,
    planHash: receipt.receipt.planHash,
    asOf: companyADemo.scenario.asOf,
    lane: { sourceRef: companyADemo.sourceRef },
    identity,
    members: [{ event: { eventId: companyADemo.scenario.paymentEventId } }],
    coverage: { deliveries: [{ event: financialEvents()[0] }] },
  });
  await expect(createCompanyADemoSync({
    db: fakeDb([locator]) as never, clock: () => new Date(), registered,
    fetchChanges: vi.fn(), observe: vi.fn(),
  }).runOnce()).rejects.toMatchObject<Partial<CompanyADemoSyncError>>({ code: 'DEMO_HISTORY_INVALID' });
  expect(mocks.openCommitted).not.toHaveBeenCalled();
  expect(mocks.applyBatch).not.toHaveBeenCalled();
});

test('rejects multiple overlapping historical candidates before validation', async () => {
  await expect(createCompanyADemoSync({
    db: fakeDb([historyLocator('2')]) as never, clock: () => new Date(), registered,
    fetchChanges: vi.fn(), observe: vi.fn(),
  }).runOnce()).rejects.toMatchObject<Partial<CompanyADemoSyncError>>({ code: 'DEMO_HISTORY_INVALID' });
  expect(mocks.readReceipt).not.toHaveBeenCalled();
  expect(mocks.readUnit).not.toHaveBeenCalled();
  expect(mocks.openCommitted).not.toHaveBeenCalled();
});

test('fails closed when a source never reaches a terminal empty probe', async () => {
  const fetchChanges = vi.fn(async (_sourceRef: string, streamId: string, after: string): Promise<ChangePage> => {
    const event = eventA({
      kind: 'payment', recordId: 'pay-a:stall-' + (Number(after) + 1),
      sourceAccountId: companyADemo.sourceAccountId, effectiveDate: companyADemo.scenario.effectiveDate,
      fields: { amount: '1.00' },
    }, Number(after) + 1, companyADemo.scenario.observedAt);
    return { sourceRef: companyADemo.sourceRef, streamId, after, next: String(Number(after) + 1), complete: true, events: [event] };
  });
  await expect(createCompanyADemoSync({
    db: fakeDb() as never, clock: () => new Date(), registered, fetchChanges, observe: vi.fn(),
  }).runOnce()).rejects.toMatchObject<Partial<CompanyADemoSyncError>>({ code: 'DEMO_CAPTURE_INCOMPLETE' });
  expect(fetchChanges).toHaveBeenCalledTimes(24);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.applyBatch).not.toHaveBeenCalled();
});

test('allows exactly 1000 fetched events plus both terminal probes', async () => {
  const fetchChanges = vi.fn(async (_sourceRef: string, streamId: string, after: string): Promise<ChangePage> => {
    if (streamId === 'a-semantics' || Number(after) === 1000) {
      return { sourceRef: companyADemo.sourceRef, streamId, after, next: after, complete: true, events: [] };
    }
    const start = Number(after);
    const events = Array.from({ length: 100 }, (_, index) => {
      const sequence = start + index + 1;
      return eventA({
        kind: 'invoice', recordId: 'inv-a:budget-' + sequence,
        sourceAccountId: companyADemo.sourceAccountId, effectiveDate: companyADemo.scenario.effectiveDate,
        fields: { amount: '1.00', due_date: '2026-10-31' },
      }, sequence, companyADemo.scenario.observedAt);
    });
    return {
      sourceRef: companyADemo.sourceRef, streamId, after, next: String(start + events.length), complete: true, events,
    };
  });
  await expect(createCompanyADemoSync({
    db: fakeDb() as never, clock: () => new Date(), registered, fetchChanges, observe: vi.fn(),
  }).runOnce()).resolves.toEqual(receipt);
  expect(fetchChanges).toHaveBeenCalledTimes(12);
});

test('fails when capture reports success without advancing its persisted checkpoint', async () => {
  mocks.openCommitted.mockResolvedValue({
    lane: { schemaVersion: '1', sourceRef: companyADemo.sourceRef, manifestHash },
    readProgress: vi.fn(async () => progressAt('0')),
    capturePage: vi.fn(async () => ({ disposition: 'captured', captured: 1, cursor: '1', replayed: false })),
  });
  const [event] = financialEvents();
  const fetchChanges = vi.fn(async (_sourceRef: string, streamId: string, after: string): Promise<ChangePage> => ({
    sourceRef: companyADemo.sourceRef, streamId, after, next: '1', complete: true, events: [event!],
  }));
  await expect(createCompanyADemoSync({
    db: fakeDb() as never, clock: () => new Date(), registered, fetchChanges, observe: vi.fn(),
  }).runOnce()).rejects.toMatchObject<Partial<CompanyADemoSyncError>>({ code: 'DEMO_CAPTURE_INCOMPLETE' });
  expect(fetchChanges).toHaveBeenCalledTimes(1);
  expect(mocks.prepare).not.toHaveBeenCalled();
});

test('rejects an empty probe when the persisted checkpoint moved after the request', async () => {
  const readProgress = vi.fn()
    .mockResolvedValueOnce(progressAt('0'))
    .mockResolvedValueOnce(progressAt('1'));
  mocks.openCommitted.mockResolvedValue({
    lane: { schemaVersion: '1', sourceRef: companyADemo.sourceRef, manifestHash },
    readProgress,
    capturePage: vi.fn(),
  });
  const fetchChanges = vi.fn(async (_sourceRef: string, streamId: string, after: string): Promise<ChangePage> => ({
    sourceRef: companyADemo.sourceRef, streamId, after, next: after, complete: true, events: [],
  }));
  await expect(createCompanyADemoSync({
    db: fakeDb() as never, clock: () => new Date(), registered, fetchChanges, observe: vi.fn(),
  }).runOnce()).rejects.toMatchObject<Partial<CompanyADemoSyncError>>({ code: 'DEMO_CAPTURE_INCOMPLETE' });
  expect(fetchChanges).toHaveBeenCalledTimes(1);
  expect(mocks.prepare).not.toHaveBeenCalled();
});

test('rejects foreign pending input before apply dispatch', async () => {
  const events = financialEvents();
  const foreign = eventA({
    kind: 'invoice', recordId: 'inv-a:foreign', sourceAccountId: companyADemo.sourceAccountId,
    effectiveDate: companyADemo.scenario.effectiveDate, fields: { amount: '12.00', due_date: '2026-10-31' },
  }, 3, companyADemo.scenario.observedAt);
  const all = [...events, foreign];
  mocks.prepare.mockResolvedValue(prepared(all));
  const fetchChanges = vi.fn(async (_sourceRef: string, streamId: string, after: string): Promise<ChangePage> => ({
    sourceRef: companyADemo.sourceRef, streamId, after,
    next: streamId === 'a-finance' && after === '0' ? '3' : after,
    complete: true, events: streamId === 'a-finance' && after === '0' ? all : [],
  }));
  await expect(createCompanyADemoSync({
    db: fakeDb() as never, clock: () => new Date(), registered, fetchChanges, observe: vi.fn(),
  }).runOnce()).rejects.toMatchObject<Partial<CompanyADemoSyncError>>({ code: 'DEMO_SCENARIO_INVALID' });
  expect(mocks.applyBatch).not.toHaveBeenCalled();
});
