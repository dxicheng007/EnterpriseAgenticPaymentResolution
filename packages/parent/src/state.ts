import type { IsoInstant, MutationOperation, Scope, TargetState } from '@eapr/contracts';

export type FinancialMutation = Exclude<MutationOperation, {
  op: 'ensure_customer' | 'ensure_account' | 'ensure_billing_configuration';
}>;

export interface ParentStateReader {
  readTarget(scope: Scope, asOf: IsoInstant): Promise<TargetState>;
}

/** Apply proposed operations to a copy for validation and preview. The persisted version is unchanged. */
export function projectTarget(state: TargetState, operations: readonly FinancialMutation[]): TargetState {
  const result = {
    ...state, invoices: [...state.invoices], payments: [...state.payments], credits: [...state.credits],
    allocations: [...state.allocations], reversals: [...state.reversals],
  };
  for (const operation of operations) {
    switch (operation.op) {
      case 'insert_invoice': result.invoices.push(operation.record); break;
      case 'insert_payment': result.payments.push(operation.record); break;
      case 'insert_credit': result.credits.push(operation.record); break;
      case 'add_allocation': result.allocations.push(operation.record); break;
      case 'full_reverse': result.reversals.push(operation.record); break;
    }
  }
  return result;
}
