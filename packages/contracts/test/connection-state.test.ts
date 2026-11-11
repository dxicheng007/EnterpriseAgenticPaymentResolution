import { expect, test } from 'vitest';
import { ConnectionStateV1Schema } from '../src/connection-state.js';

const base = {
  schemaVersion: '1' as const,
  scope: {
    companyId: 'company-a',
    sellerEntityId: 'seller-a',
    accountId: 'company-a.seller-a.cust-a-d22feb38e846-1',
  },
  status: 'active' as const,
  epoch: 1,
  activationId: 'activation:test',
  statusChangedAt: '2026-10-01T00:00:00.000Z',
  parentVersion: 1,
  streams: [],
  incidents: [],
  receipts: [],
  counts: { appliedBatches: 1, pendingEvents: null, quarantinedEvents: null },
  lastReceiptId: 'receipt:test',
};

test('ConnectionStateV1 treats runtime model calls as unmeasured null, never literal zero', () => {
  expect(ConnectionStateV1Schema.parse({ ...base, runtimeModelCalls: null }).runtimeModelCalls).toBeNull();
  expect(ConnectionStateV1Schema.safeParse({ ...base, runtimeModelCalls: 0 }).success).toBe(false);
  expect(ConnectionStateV1Schema.safeParse({ ...base, runtimeModelCalls: 'forbidden' }).success).toBe(false);
});
