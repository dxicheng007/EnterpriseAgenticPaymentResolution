import type { FullReversal } from '@eapr/contracts';
import { FinanceError, referenceId, sameScope, type FinancialRecord } from './validate.js';

export function indexReversals(
  reversals: readonly FullReversal[],
  records: ReadonlyMap<string, FinancialRecord>,
): Map<string, FullReversal> {
  const byFunding = new Map<string, FullReversal>();
  for (const reversal of reversals) {
    const fundingId = referenceId(reversal, reversal.reversedKind, reversal.reversedRecordId);
    const funding = records.get(fundingId);
    if (!funding || funding.kind !== reversal.reversedKind || !sameScope(funding.scope, reversal.scope) ||
      funding.currency !== reversal.currency) {
      throw new FinanceError('REVERSAL_PREREQUISITE', 'Reversal requires the original payment or credit in the same scope');
    }
    if (funding.effectiveAt > reversal.effectiveAt) {
      throw new FinanceError('EFFECTIVE_PREREQUISITE', 'Reversal predates the effective funding');
    }
    if (byFunding.has(fundingId)) throw new FinanceError('REVERSAL_CONFLICT', 'Funding has more than one full reversal');
    byFunding.set(fundingId, reversal);
  }
  return byFunding;
}
