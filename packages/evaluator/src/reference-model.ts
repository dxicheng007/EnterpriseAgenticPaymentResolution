import {
  TargetStateSchema, canonicalJson, targetRecordId,
  type Allocation, type FinancialKind, type FullReversal, type Funding, type Invoice, type TargetState,
} from '@eapr/contracts';

export type FinancialRecord = Invoice | Funding | Allocation | FullReversal;

export interface ReferenceView {
  records: FinancialRecord[];
  effectiveAllocationIds: string[];
  balanceCents: number;
}

export function addReferenceCents(left: number, right: number): number {
  const sum = left + right;
  if (![left, right, sum].every(Number.isSafeInteger)) throw new Error('Reference cents overflow or invalid integer');
  return sum;
}

function relatedRecordId(record: FinancialRecord, kind: FinancialKind, recordId: string): string {
  return targetRecordId({ ...record.identity, kind, recordId });
}

function countAllocation(
  totals: Map<string, number>,
  record: Invoice | Funding,
  allocation: Allocation,
): void {
  const total = addReferenceCents(totals.get(record.id) ?? 0, allocation.amountCents);
  if (total > record.amountCents) throw new Error('Reference allocation exceeds invoice or funding');
  totals.set(record.id, total);
}

/** Evaluate complete scenario facts at their explicit asOf, retaining originals in the record view. */
export function evaluateReferenceState(facts: TargetState): ReferenceView {
  const parsed = TargetStateSchema.safeParse(facts);
  if (!parsed.success) throw new Error('Invalid reference target state');
  const { scope, asOf, invoices, payments, credits, allocations, reversals } = parsed.data;
  const records = [...invoices, ...payments, ...credits, ...allocations, ...reversals];
  const recordIds = new Set<string>();
  for (const record of records) {
    if (record.identity.sellerEntityId !== scope.sellerEntityId ||
        record.id !== targetRecordId(record.identity) || recordIds.has(record.id)) {
      throw new Error('Invalid or repeated reference record identity');
    }
    recordIds.add(record.id);
  }

  const invoiceById = new Map(invoices.map(invoice => [invoice.id, invoice]));
  const fundingById = new Map([...payments, ...credits].map(funding => [funding.id, funding]));
  const voidedFunding = new Set<string>();
  for (const reversal of reversals) {
    const fundingId = relatedRecordId(reversal, reversal.reversedKind, reversal.reversedRecordId);
    if (!fundingById.has(fundingId)) throw new Error('Missing scoped funding for reference reversal');
    if (reversal.effectiveAt <= asOf) voidedFunding.add(fundingId);
  }

  const allocatedByFunding = new Map<string, number>();
  const allocatedByInvoice = new Map<string, number>();
  const effectiveAllocationIds: string[] = [];
  for (const allocation of allocations) {
    const invoice = invoiceById.get(relatedRecordId(allocation, 'invoice', allocation.invoiceRecordId));
    const funding = fundingById.get(relatedRecordId(allocation, allocation.fundingKind, allocation.fundingRecordId));
    if (!invoice || !funding) throw new Error('Missing scoped invoice or funding for reference allocation');
    // A reversal voids the balance effect and preserves the original funding and allocation facts.
    countAllocation(allocatedByFunding, funding, allocation);
    if (allocation.effectiveAt > asOf || invoice.effectiveAt > asOf || funding.effectiveAt > asOf ||
        voidedFunding.has(funding.id)) continue;

    countAllocation(allocatedByInvoice, invoice, allocation);
    effectiveAllocationIds.push(allocation.id);
  }

  let balanceCents = 0;
  for (const invoice of invoices) {
    if (invoice.effectiveAt > asOf) continue;
    const outstanding = addReferenceCents(invoice.amountCents, -(allocatedByInvoice.get(invoice.id) ?? 0));
    balanceCents = addReferenceCents(balanceCents, outstanding);
  }
  return { records, effectiveAllocationIds, balanceCents };
}

function cents(record: FinancialRecord): number {
  return record.kind === 'reversal' ? 0 : record.amountCents;
}

/** Compare full records by economic identity, with any duplicate actual record counted as extra. */
export function compareReferenceRecords(expected: readonly FinancialRecord[], actual: readonly FinancialRecord[]) {
  const remaining = new Map(expected.map(record => [targetRecordId(record.identity), record]));
  if (remaining.size !== expected.length) throw new Error('Repeated expected record identity');

  let matches = true;
  let unexplainedDifferenceCents = 0;
  for (const record of actual) {
    const key = targetRecordId(record.identity);
    const wanted = remaining.get(key);
    if (!wanted || canonicalJson(wanted) !== canonicalJson(record)) matches = false;
    remaining.delete(key);
    const difference = addReferenceCents(cents(record), -(wanted ? cents(wanted) : 0));
    unexplainedDifferenceCents = addReferenceCents(unexplainedDifferenceCents, Math.abs(difference));
  }
  for (const record of remaining.values()) {
    unexplainedDifferenceCents = addReferenceCents(unexplainedDifferenceCents, Math.abs(cents(record)));
  }
  return { matches: matches && remaining.size === 0, unexplainedDifferenceCents };
}
