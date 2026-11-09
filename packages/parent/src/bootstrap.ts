import {
  canonicalJson, MutationOperationSchema, TargetStateSchema, unique,
  type MutationOperation, type Scope, type TargetState,
} from '@eapr/contracts';
import { projectTarget, type FinancialMutation } from './state.js';

export class BootstrapProjectionError extends Error {
  constructor(readonly code: 'invalid_state' | 'invalid_operation' | 'metadata_conflict', message: string) {
    super(message);
    this.name = 'BootstrapProjectionError';
  }
}

function canonicalInput(input: unknown, code: 'invalid_state' | 'invalid_operation') {
  try {
    canonicalJson(input);
  } catch {
    throw new BootstrapProjectionError(code, 'Bootstrap projection input is not canonical JSON');
  }
}

function ensureRecord<T extends { id: string }>(records: T[], record: T) {
  const existing = records.find(item => item.id === record.id);
  if (!existing) {
    records.push(record);
  } else if (canonicalJson(existing) !== canonicalJson(record)) {
    throw new BootstrapProjectionError('metadata_conflict', 'Existing metadata differs from the reviewed record');
  }
}

function inScope(record: Scope, target: Scope) {
  return record.companyId === target.companyId && record.sellerEntityId === target.sellerEntityId &&
    record.accountId === target.accountId;
}

/** Projects scoped bootstrap operations onto copied arrays at the same version and instant. */
export function projectBootstrapTarget(state: TargetState, operations: readonly MutationOperation[]): TargetState {
  canonicalInput(state, 'invalid_state');
  if (!TargetStateSchema.safeParse(state).success) {
    throw new BootstrapProjectionError('invalid_state', 'Bootstrap target records or scopes are invalid');
  }
  const { customers, accounts, billingConfigurations } = state;
  if (![customers, accounts, billingConfigurations].every(records => unique<{ id: string }>(records, record => record.id))) {
    throw new BootstrapProjectionError('invalid_state', 'Bootstrap target contains duplicate metadata IDs');
  }

  canonicalInput(operations, 'invalid_operation');
  if (!Array.isArray(operations)) {
    throw new BootstrapProjectionError('invalid_operation', 'Bootstrap operations must be an array');
  }
  const metadata = {
    customers: [...customers], accounts: [...accounts], billingConfigurations: [...billingConfigurations],
  };
  const financial: FinancialMutation[] = [];
  for (const operation of operations) {
    if (!MutationOperationSchema.safeParse(operation).success ||
      ('scope' in operation.record && !inScope(operation.record.scope, state.scope))) {
      throw new BootstrapProjectionError('invalid_operation', 'Bootstrap operation record or scope is invalid');
    }
    switch (operation.op) {
      case 'ensure_customer': ensureRecord(metadata.customers, operation.record); break;
      case 'ensure_account': ensureRecord(metadata.accounts, operation.record); break;
      case 'ensure_billing_configuration': ensureRecord(metadata.billingConfigurations, operation.record); break;
      default: financial.push(operation);
    }
  }

  return projectTarget({ ...state, ...metadata }, financial);
}
