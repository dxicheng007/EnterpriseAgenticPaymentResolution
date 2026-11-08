import { IsoInstantSchema, type IsoInstant, type TargetState } from '@eapr/contracts';
import { allocationEffectiveAt } from './allocations.js';
import { checkedAdd, FinanceError, validateTarget } from './validate.js';

export function computeBalance(input: TargetState, asOf: IsoInstant): number {
  const instant = IsoInstantSchema.safeParse(asOf);
  if (!instant.success) throw new FinanceError('EFFECTIVE_INSTANT_INVALID', 'Balance requires an exact UTC instant');
  const { state, reversals } = validateTarget(input);
  let balance = 0;
  for (const invoice of state.invoices) {
    if (invoice.effectiveAt <= instant.data) balance = checkedAdd(balance, invoice.amountCents);
  }
  for (const allocation of state.allocations) {
    if (allocationEffectiveAt(allocation, instant.data, reversals)) {
      balance = checkedAdd(balance, -allocation.amountCents);
    }
  }
  return balance;
}
