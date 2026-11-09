import { z } from 'zod';
import {
  IdSchema, ScopeSchema, strict, type Scope,
} from '../../contracts/src/common.js';
import {
  CustomerActivationSchema, ParentReadQuerySchema, ParentViewSchema, SyncReceiptSchema,
  type ParentReadQuery, type ParentView,
} from '../../contracts/src/runtime.js';
import { LocalApiError, requestLocal } from './http.js';

function sameScope(left: Scope, right: Scope) {
  return left.companyId === right.companyId && left.sellerEntityId === right.sellerEntityId &&
    left.accountId === right.accountId;
}

// Browser-safe copy of ActivationStateV1Schema. That module imports node:crypto.
const ActivationResponseSchema = strict({
  schemaVersion: z.literal('1'), scope: ScopeSchema,
  activation: CustomerActivationSchema.nullable(), initialReceipt: SyncReceiptSchema.nullable(),
}).refine(({ scope, activation, initialReceipt }) => {
  if (activation === null || initialReceipt === null) return activation === null && initialReceipt === null;
  return sameScope(scope, activation.scope) && sameScope(scope, initialReceipt.scope)
    && initialReceipt.activationId === activation.id && initialReceipt.epoch === activation.epoch
    && initialReceipt.artifactHash === activation.artifactHash;
}, 'Activation and initial receipt must be paired and match the scope and activation identity');

function invalid(message: string): never {
  throw new LocalApiError(400, 'PARENT_READ_INVALID', message);
}

function accountIdOf(accountId: string) {
  const parsed = IdSchema.safeParse(accountId);
  if (!parsed.success) invalid('Parent account ID is invalid.');
  return parsed.data;
}

function selectionOf(selection: ParentReadQuery) {
  const parsed = ParentReadQuerySchema.safeParse(selection);
  if (!parsed.success) invalid('Parent read selectors are invalid.');
  return parsed.data;
}

export async function readParentAccount(
  accountId: string, selection: ParentReadQuery = {}, signal?: AbortSignal,
): Promise<ParentView> {
  const id = accountIdOf(accountId);
  const query = selectionOf(selection);
  const params = new URLSearchParams();
  if (query.asOf !== undefined) params.set('asOf', query.asOf);
  if (query.snapshotHash !== undefined) params.set('snapshotHash', query.snapshotHash);
  const suffix = params.size === 0 ? '' : '?' + params.toString();
  const view = await requestLocal('/api/parent/' + encodeURIComponent(id) + suffix, ParentViewSchema, { signal });
  if (view.scope.accountId !== id ||
    (query.snapshotHash !== undefined && view.snapshotHash !== query.snapshotHash) ||
    (query.asOf !== undefined && view.asOf !== query.asOf)) {
    throw new LocalApiError(200, 'MALFORMED_RESPONSE', 'The parent view did not match the selected account.');
  }
  return view;
}

export async function readAccountActivation(accountId: string, signal?: AbortSignal) {
  const id = accountIdOf(accountId);
  const state = await requestLocal(
    '/api/accounts/' + encodeURIComponent(id) + '/activation', ActivationResponseSchema, { signal },
  );
  if (state.scope.accountId !== id) {
    throw new LocalApiError(200, 'MALFORMED_RESPONSE', 'The activation state did not match the selected account.');
  }
  return state;
}
