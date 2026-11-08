import { expect, test } from 'vitest';
import { targetRecordId, type FullReversal } from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { afterLatePaymentA, baselineA } from '../../../tests/fixtures/index.js';

const october1 = '2026-10-01T00:00:00.000Z';
const october3 = '2026-10-03T00:00:00.000Z';
const firstPayment = baselineA.payments[0];
const reversalIdentity = { ...firstPayment.identity, kind: 'reversal' as const, recordId: 'rev-a-1' };
const reversal: FullReversal = {
  id: targetRecordId(reversalIdentity), kind: 'reversal', identity: reversalIdentity, scope: firstPayment.scope,
  sourceRecordVersion: 1, sourceEventId: 'evt-a-rev-1', currency: 'USD', effectiveAt: october3,
  reversedKind: 'payment', reversedRecordId: firstPayment.identity.recordId,
};

test('preserves_source_money', () => {
  expect(computeBalance(baselineA, '2026-10-01T00:00:00Z')).toBe(80000);
  expect(computeBalance(afterLatePaymentA, october3)).toBe(50000);
  expect(computeBalance(afterLatePaymentA, october1)).toBe(80000);
  expect(computeBalance({
    ...baselineA, payments: afterLatePaymentA.payments,
  }, october3)).toBe(80000);
});

test('reverses_full_payment_once', () => {
  const state = { ...baselineA, reversals: [reversal] };
  expect(computeBalance(state, october1)).toBe(80000);
  expect(computeBalance(state, october3)).toBe(280000);
  const duplicate = { ...reversalIdentity, recordId: 'rev-a-2' };
  expect(() => computeBalance({
    ...state, reversals: [reversal, { ...reversal, id: targetRecordId(duplicate), identity: duplicate }],
  }, october3)).toThrow(/reversal/i);
});

test('rejects funding and invoice over-allocation', () => {
  const [first, second] = baselineA.allocations;
  expect(() => computeBalance({
    ...baselineA, allocations: [{ ...first, amountCents: first.amountCents + 1 }, second],
  }, october1)).toThrow(/funding/i);
  expect(() => computeBalance({
    ...baselineA,
    invoices: [{ ...baselineA.invoices[0], amountCents: 210000 }],
  }, october1)).toThrow(/invoice/i);
});

test('rejects wrong-source funding and invalid effective prerequisites', () => {
  const [payment] = baselineA.payments;
  const wrongSource = { ...payment.identity, sourceRef: 'another-source' };
  expect(() => computeBalance({
    ...baselineA, payments: [{ ...payment, id: targetRecordId(wrongSource), identity: wrongSource }],
  }, october1)).toThrow(/funding/i);
  expect(() => computeBalance({
    ...baselineA, payments: [{ ...payment, effectiveAt: october3 }],
  }, october3)).toThrow(/effective/i);
});

test('a backdated reversal voids an existing future-effective allocation and preserves older recorded state', () => {
  const lateFunding = afterLatePaymentA.payments[1];
  const lateReversalIdentity = { ...reversalIdentity, recordId: 'rev-late-payment' };
  const lateReversal: FullReversal = {
    ...reversal, identity: lateReversalIdentity, id: targetRecordId(lateReversalIdentity),
    reversedRecordId: lateFunding.identity.recordId, effectiveAt: '2026-10-02T00:00:00.000Z',
  };
  const state = {
    ...afterLatePaymentA,
    payments: [...baselineA.payments, { ...lateFunding, effectiveAt: october1 }],
    reversals: [lateReversal],
  };
  expect(computeBalance(state, october3)).toBe(80000);
  expect(computeBalance(afterLatePaymentA, october3)).toBe(50000);
});

test('full credit reversal restores its allocations at its effective instant', () => {
  const credit = baselineA.credits[0];
  const identity = { ...reversalIdentity, recordId: 'rev-credit' };
  const creditReversal: FullReversal = {
    ...reversal, identity, id: targetRecordId(identity), reversedKind: 'credit', reversedRecordId: credit.identity.recordId,
  };
  const state = { ...baselineA, reversals: [creditReversal] };
  expect(computeBalance(state, october1)).toBe(80000);
  expect(computeBalance(state, october3)).toBe(100000);
});
