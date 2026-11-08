import type { Allocation, FullReversal, Invoice, IsoInstant } from '@eapr/contracts';
import { checkedAdd, FinanceError, referenceId, sameScope, type FinancialRecord } from './validate.js';

export function fundingIdFor(allocation: Allocation): string {
  return referenceId(allocation, allocation.fundingKind, allocation.fundingRecordId);
}

export function invoiceIdFor(allocation: Allocation): string {
  return referenceId(allocation, 'invoice', allocation.invoiceRecordId);
}

export function allocationEffectiveAt(
  allocation: Allocation, asOf: IsoInstant, reversals: ReadonlyMap<string, FullReversal>,
): boolean {
  const reversal = reversals.get(fundingIdFor(allocation));
  return allocation.effectiveAt <= asOf && (!reversal || reversal.effectiveAt > asOf);
}

export function validateAllocations(
  allocations: readonly Allocation[],
  records: ReadonlyMap<string, FinancialRecord>,
  reversals: ReadonlyMap<string, FullReversal>,
) {
  const byFunding = new Map<string, number>();
  const byInvoice = new Map<Invoice, Map<IsoInstant, number>>();

  for (const allocation of allocations) {
    const funding = records.get(fundingIdFor(allocation));
    const invoice = records.get(invoiceIdFor(allocation));
    if (!funding || funding.kind !== allocation.fundingKind || !sameScope(funding.scope, allocation.scope) ||
      funding.currency !== allocation.currency) {
      throw new FinanceError('ALLOCATION_FUNDING', 'Allocation requires matching funding in the same scope');
    }
    if (!invoice || invoice.kind !== 'invoice' || !sameScope(invoice.scope, allocation.scope) ||
      invoice.currency !== allocation.currency) {
      throw new FinanceError('ALLOCATION_INVOICE', 'Allocation requires an invoice in the same scope');
    }
    if (funding.effectiveAt > allocation.effectiveAt || invoice.effectiveAt > allocation.effectiveAt) {
      throw new FinanceError('EFFECTIVE_PREREQUISITE', 'Allocation predates an effective prerequisite');
    }
    const reversal = reversals.get(funding.id);
    // An existing allocation with no active interval remains in history after a backdated reversal.
    if (reversal && reversal.effectiveAt <= allocation.effectiveAt) continue;
    const funded = checkedAdd(byFunding.get(funding.id) ?? 0, allocation.amountCents);
    if (funded > funding.amountCents) {
      throw new FinanceError('FUNDING_OVERALLOCATION', 'Allocations exceed the original funding amount');
    }
    byFunding.set(funding.id, funded);
    const timeline = byInvoice.get(invoice) ?? new Map<IsoInstant, number>();
    const at = allocation.effectiveAt;
    timeline.set(at, checkedAdd(timeline.get(at) ?? 0, allocation.amountCents));
    if (reversal) {
      const until = reversal.effectiveAt;
      timeline.set(until, checkedAdd(timeline.get(until) ?? 0, -allocation.amountCents));
    }
    byInvoice.set(invoice, timeline);
  }

  for (const [invoice, timeline] of byInvoice) {
    let allocated = 0;
    for (const at of [...timeline.keys()].sort()) {
      allocated = checkedAdd(allocated, timeline.get(at)!);
      if (allocated > invoice.amountCents) {
        throw new FinanceError('INVOICE_OVERALLOCATION', 'Effective allocations exceed the invoice amount');
      }
    }
  }
}
