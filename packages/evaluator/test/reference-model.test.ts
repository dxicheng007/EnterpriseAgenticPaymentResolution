import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { targetRecordId, type FullReversal, type TargetState } from '@eapr/contracts';
import { afterLatePaymentA, baselineA } from '../../../tests/fixtures/index.js';
import {
  addReferenceCents, compareReferenceRecords, evaluateReferenceState,
} from '../src/reference-model.js';

const invoice = baselineA.invoices[0];
const payment = baselineA.payments[0];
const credit = baselineA.credits[0];
const [paymentAllocation, creditAllocation] = baselineA.allocations;
const latePayment = afterLatePaymentA.payments[1];
const lateAllocation = afterLatePaymentA.allocations[2];

const reversedAt = '2026-10-04T00:00:00.000Z';
const reversalIdentity = { ...payment.identity, kind: 'reversal', recordId: 'reverse-pay-a-1' } as const;
const paymentReversal: FullReversal = {
  id: targetRecordId(reversalIdentity),
  identity: reversalIdentity,
  kind: 'reversal',
  scope: payment.scope,
  sourceRecordVersion: 1,
  sourceEventId: 'evt-reverse-pay-a-1',
  currency: 'USD',
  effectiveAt: reversedAt,
  reversedKind: 'payment',
  reversedRecordId: 'pay-a-1',
};
const reversedState: TargetState = {
  ...afterLatePaymentA,
  asOf: reversedAt,
  reversals: [paymentReversal],
};

describe('independent public development oracle', () => {
  it('reference_baseline_80000', () => {
    expect(evaluateReferenceState(baselineA)).toEqual({
      records: [invoice, payment, credit, paymentAllocation, creditAllocation],
      effectiveAllocationIds: [paymentAllocation.id, creditAllocation.id],
      balanceCents: 80_000,
    });
  });

  it('reference_late_payment_50000', () => {
    expect(lateAllocation).toMatchObject({
      fundingKind: 'payment', fundingRecordId: 'pay-a-2', invoiceRecordId: 'inv-a-1', amountCents: 30_000,
    });
    expect(evaluateReferenceState(afterLatePaymentA)).toEqual({
      records: [invoice, payment, latePayment, credit, paymentAllocation, creditAllocation, lateAllocation],
      effectiveAllocationIds: [paymentAllocation.id, creditAllocation.id, lateAllocation.id],
      balanceCents: 50_000,
    });
    expect(evaluateReferenceState({ ...afterLatePaymentA, asOf: baselineA.asOf })).toMatchObject({
      effectiveAllocationIds: [paymentAllocation.id, creditAllocation.id],
      balanceCents: 80_000,
    });
  });

  it('reference_unallocated_funding_no_reduction', () => {
    expect(evaluateReferenceState({ ...afterLatePaymentA, allocations: baselineA.allocations })).toEqual({
      records: [invoice, payment, latePayment, credit, paymentAllocation, creditAllocation],
      effectiveAllocationIds: [paymentAllocation.id, creditAllocation.id],
      balanceCents: 80_000,
    });
  });

  it('reference_full_reversal_as_of', () => {
    const records = [invoice, payment, latePayment, credit, paymentAllocation, creditAllocation, lateAllocation, paymentReversal];
    const original = structuredClone(reversedState);
    expect(evaluateReferenceState(reversedState)).toEqual({
      records,
      effectiveAllocationIds: [creditAllocation.id, lateAllocation.id],
      balanceCents: 250_000,
    });
    expect(evaluateReferenceState({ ...reversedState, asOf: afterLatePaymentA.asOf })).toEqual({
      records,
      effectiveAllocationIds: [paymentAllocation.id, creditAllocation.id, lateAllocation.id],
      balanceCents: 50_000,
    });
    expect(reversedState).toEqual(original);

    const creditReversal: FullReversal = {
      ...paymentReversal,
      identity: { ...reversalIdentity, recordId: 'reverse-credit-a-1' },
      sourceEventId: 'evt-reverse-credit-a-1',
      reversedKind: 'credit',
      reversedRecordId: 'credit-a-1',
    };
    creditReversal.id = targetRecordId(creditReversal.identity);
    expect(evaluateReferenceState({ ...reversedState, reversals: [creditReversal] })).toEqual({
      records: [...records.slice(0, -1), creditReversal],
      effectiveAllocationIds: [paymentAllocation.id, lateAllocation.id],
      balanceCents: 70_000,
    });
  });

  it('reference_reversal_cannot_conceal_excessive_funding_allocation', () => {
    const excess = { ...paymentAllocation, amountCents: 200_001 };
    const invalid = { ...baselineA, allocations: [excess, creditAllocation] };
    expect(() => evaluateReferenceState(invalid)).toThrow('Reference allocation exceeds invoice or funding');
    expect(() => evaluateReferenceState({ ...invalid, asOf: reversedAt, reversals: [paymentReversal] }))
      .toThrow('Reference allocation exceeds invoice or funding');
  });

  it('reference_reversal_restores_invoice_capacity_for_other_funding', () => {
    const asOf = '2026-10-05T00:00:00.000Z';
    const replacementPayment = { ...latePayment, amountCents: 200_000, effectiveAt: asOf };
    const replacementAllocation = { ...lateAllocation, amountCents: 200_000, effectiveAt: asOf };
    expect(evaluateReferenceState({
      ...reversedState, asOf,
      payments: [payment, replacementPayment],
      allocations: [paymentAllocation, creditAllocation, replacementAllocation],
    })).toEqual({
      records: [invoice, payment, replacementPayment, credit, paymentAllocation, creditAllocation, replacementAllocation, paymentReversal],
      effectiveAllocationIds: [creditAllocation.id, replacementAllocation.id],
      balanceCents: 80_000,
    });
  });

  it('reference_scope_and_limits', () => {
    const otherSource = { ...payment, identity: { ...payment.identity, sourceRef: 'legacy-b' } };
    const otherSeller = { ...payment, identity: { ...payment.identity, sellerEntityId: 'seller-b' } };
    for (const funding of [otherSource, otherSeller]) {
      const aliased = { ...funding, id: targetRecordId(funding.identity) };
      expect(() => evaluateReferenceState({ ...baselineA, payments: [aliased] })).toThrow();
    }
    const otherAccount = { ...payment, scope: { ...payment.scope, accountId: 'a.seller-a.other' } };
    expect(() => evaluateReferenceState({ ...baselineA, payments: [otherAccount] })).toThrow();

    for (const amountCents of [0, -1, 1.005, Number.NaN, 5_000_001, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => evaluateReferenceState({ ...baselineA, invoices: [{ ...invoice, amountCents }] })).toThrow();
    }
    expect(() => addReferenceCents(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => addReferenceCents(Number.MIN_SAFE_INTEGER, -1)).toThrow();
    expect(addReferenceCents(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(Number.MAX_SAFE_INTEGER);

    const duplicateAllocation = { ...paymentAllocation, identity: { ...paymentAllocation.identity, recordId: 'alloc-a-extra' } };
    duplicateAllocation.id = targetRecordId(duplicateAllocation.identity);
    expect(() => evaluateReferenceState({
      ...baselineA, allocations: [...baselineA.allocations, { ...duplicateAllocation, amountCents: 1 }],
    })).toThrow();
    expect(() => evaluateReferenceState({
      ...baselineA, invoices: [{ ...invoice, amountCents: 219_999 }],
    })).toThrow();
    const partialReversal = { ...paymentReversal, amountCents: 1 };
    expect(() => evaluateReferenceState({ ...reversedState, reversals: [partialReversal] })).toThrow();
  });

  it('balance_preserving_swap_rejected', () => {
    const twoInvoiceIdentity = { ...invoice.identity, recordId: 'inv-a-2' };
    const secondInvoice = { ...invoice, id: targetRecordId(twoInvoiceIdentity), identity: twoInvoiceIdentity, amountCents: 250_000 };
    const expected = evaluateReferenceState({ ...baselineA, invoices: [invoice, secondInvoice] });
    const swappedAmounts = {
      ...baselineA,
      invoices: [{ ...invoice, amountCents: 250_000 }, { ...secondInvoice, amountCents: 300_000 }],
    };
    expect(expected.balanceCents).toBe(330_000);
    const sameBalance = evaluateReferenceState(swappedAmounts);
    expect(sameBalance.balanceCents).toBe(330_000);
    expect(compareReferenceRecords(expected.records, sameBalance.records)).toEqual({
      matches: false, unexplainedDifferenceCents: 100_000,
    });

    const reassigned = { ...paymentAllocation, invoiceRecordId: 'inv-a-2' };
    const sameAmounts = [invoice, secondInvoice, payment, credit, reassigned, creditAllocation];
    expect(compareReferenceRecords(expected.records, sameAmounts)).toEqual({
      matches: false, unexplainedDifferenceCents: 0,
    });
    expect(compareReferenceRecords(expected.records, [...expected.records].reverse())).toEqual({
      matches: true, unexplainedDifferenceCents: 0,
    });
    expect(compareReferenceRecords(expected.records, [...expected.records.slice(1), secondInvoice])).toEqual({
      matches: false, unexplainedDifferenceCents: 550_000,
    });
  });

  it('reference_model_independent', () => {
    const source = readFileSync(new URL('../src/reference-model.ts', import.meta.url), 'utf8');
    const dependencies = Array.from(
      source.matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g),
      match => match[1],
    );
    expect(new Set(dependencies)).toEqual(new Set(['@eapr/contracts']));
    const independent = evaluateReferenceState(baselineA);
    const wrongInvoice = { ...invoice, amountCents: 290_000 };
    expect(compareReferenceRecords(independent.records, [wrongInvoice, payment, credit, paymentAllocation, creditAllocation]))
      .toEqual({ matches: false, unexplainedDifferenceCents: 10_000 });
    expect(independent.balanceCents).toBe(80_000);
  });
});
