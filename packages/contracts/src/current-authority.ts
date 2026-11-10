import { z } from 'zod';
import { HashSchema, IdSchema, IsoInstantSchema, ScopeSchema, strict } from './common.js';
import { SemanticPreflightSchema } from './review.js';

const epoch = z.number().int().positive().refine(Number.isSafeInteger);
const status = z.enum(['active', 'paused', 'revoked']);
const action = z.enum(['pause', 'resume', 'revoke']);
const target = { pause: 'paused', resume: 'active', revoke: 'revoked' } as const;

export const CommittedAuthorityIdentityV1Schema = strict({
  scope: ScopeSchema, activationId: IdSchema, bundleHash: HashSchema,
});
export const CurrentAuthorityV1Schema = strict({
  schemaVersion: z.literal('1'), identity: CommittedAuthorityIdentityV1Schema, sourceRef: IdSchema,
  artifactHash: HashSchema, profileHash: HashSchema, manifestHash: HashSchema,
  status, epoch, changedAt: IsoInstantSchema,
});
export const AuthorityStatusCommandV1Schema = strict({
  schemaVersion: z.literal('1'), identity: CommittedAuthorityIdentityV1Schema,
  action, expectedEpoch: epoch, idempotencyKey: IdSchema,
});
export const AuthorityStatusResultV1Schema = strict({
  schemaVersion: z.literal('1'), identity: CommittedAuthorityIdentityV1Schema, idempotencyKey: IdSchema,
  action, beforeStatus: status, beforeEpoch: epoch, state: CurrentAuthorityV1Schema,
  changed: z.boolean(), committedAt: IsoInstantSchema,
}).refine(({ identity, state }) => (
  identity.activationId === state.identity.activationId && identity.bundleHash === state.identity.bundleHash &&
  identity.scope.accountId === state.identity.scope.accountId && identity.scope.companyId === state.identity.scope.companyId &&
  identity.scope.sellerEntityId === state.identity.scope.sellerEntityId
), 'Result identity must match state identity').refine(result => {
  const { action, beforeStatus, beforeEpoch, state, changed, committedAt } = result;
  if (state.status !== target[action] || changed !== (state.status !== beforeStatus)) return false;
  if (!changed) return state.epoch === beforeEpoch;
  return beforeStatus !== 'revoked' && beforeEpoch < Number.MAX_SAFE_INTEGER &&
    state.epoch === beforeEpoch + 1 && state.changedAt === committedAt;
}, 'Invalid status transition');
export const AuthorityStatusResponseV1Schema = strict({
  result: AuthorityStatusResultV1Schema, replayed: z.boolean(),
});
export const AuthorityResumeObservationV1Schema = strict({
  observation: SemanticPreflightSchema, startedAt: IsoInstantSchema, completedAt: IsoInstantSchema,
}).refine(({ startedAt, completedAt }) => startedAt <= completedAt, 'Inverted observation interval');

export type CommittedAuthorityIdentityV1 = z.infer<typeof CommittedAuthorityIdentityV1Schema>;
export type CurrentAuthorityV1 = z.infer<typeof CurrentAuthorityV1Schema>;
export type AuthorityStatusCommandV1 = z.infer<typeof AuthorityStatusCommandV1Schema>;
export type AuthorityStatusResultV1 = z.infer<typeof AuthorityStatusResultV1Schema>;
export type AuthorityStatusResponseV1 = z.infer<typeof AuthorityStatusResponseV1Schema>;
export type AuthorityResumeObservationV1 = z.infer<typeof AuthorityResumeObservationV1Schema>;
