import {
  TargetStateSchema, targetRecordId,
  type Allocation, type FinancialKind, type FullReversal, type Funding, type Invoice, type Scope, type TargetState,
} from '@eapr/contracts';
import { validateAllocations } from './allocations.js';
import { indexReversals } from './reversals.js';

export type FinancialRecord = Invoice | Funding | Allocation | FullReversal;

export class FinanceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'FinanceError';
  }
}

export function checkedAdd(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || !Number.isSafeInteger(sum)) {
    throw new FinanceError('MONEY_RANGE', 'Monetary total exceeds the exact integer range');
  }
  return sum;
}

export function sameScope(left: Scope, right: Scope): boolean {
  return left.companyId === right.companyId && left.sellerEntityId === right.sellerEntityId && left.accountId === right.accountId;
}

export function referenceId(record: FinancialRecord, kind: FinancialKind, recordId: string): string {
  return targetRecordId({ ...record.identity, kind, recordId });
}

export function financialRecords(state: TargetState): FinancialRecord[] {
  return [...state.invoices, ...state.payments, ...state.credits, ...state.allocations, ...state.reversals];
}

export function validateTarget(input: TargetState) {
  const parsed = TargetStateSchema.safeParse(input);
  if (!parsed.success) throw new FinanceError('TARGET_STATE_INVALID', 'Target records, amounts or scope are invalid');
  const state = parsed.data;
  const records = new Map<string, FinancialRecord>();
  for (const record of financialRecords(state)) {
    if (record.id !== targetRecordId(record.identity) || record.identity.sellerEntityId !== state.scope.sellerEntityId) {
      throw new FinanceError('TARGET_IDENTITY_INVALID', 'Target record identity is inconsistent with its scope');
    }
    if (records.has(record.id)) throw new FinanceError('ECONOMIC_CONFLICT', 'Target contains duplicate economic records');
    records.set(record.id, record);
  }
  const reversals = indexReversals(state.reversals, records);
  validateAllocations(state.allocations, records, reversals);
  return { state, records, reversals };
}
