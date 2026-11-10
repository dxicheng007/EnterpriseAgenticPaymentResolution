import { expect, test } from 'vitest';
import {
  AuthorityResumeObservationV1Schema, AuthorityStatusCommandV1Schema, AuthorityStatusResponseV1Schema,
  AuthorityStatusResultV1Schema, CurrentAuthorityV1Schema,
  type AuthorityStatusResultV1,
} from '../src/current-authority.js';

const identity = { scope: { accountId: 'account', companyId: 'company', sellerEntityId: 'seller' },
  activationId: 'activation', bundleHash: 'a'.repeat(64) };
const changedAt = '2026-11-09T08:00:00.000Z';
const state = { schemaVersion: '1', identity, sourceRef: 'source', artifactHash: 'b'.repeat(64),
  profileHash: 'c'.repeat(64), manifestHash: 'd'.repeat(64), status: 'paused', epoch: 2, changedAt } as const;
const command = { schemaVersion: '1', identity, action: 'pause', expectedEpoch: 1, idempotencyKey: 'key' } as const;
const result: AuthorityStatusResultV1 = {
  schemaVersion: '1', identity, idempotencyKey: 'key', action: 'pause', beforeStatus: 'active', beforeEpoch: 1,
  state, changed: true, committedAt: changedAt,
};

test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid epoch %s at every boundary', epoch => {
  expect(AuthorityStatusCommandV1Schema.safeParse({ ...command, expectedEpoch: epoch }).success).toBe(false);
  expect(CurrentAuthorityV1Schema.safeParse({ ...state, epoch }).success).toBe(false);
  expect(AuthorityStatusResultV1Schema.safeParse({ ...result, beforeEpoch: epoch }).success).toBe(false);
});

test('rejects actor fields, extra scope keys and prototype keys', () => {
  expect(AuthorityStatusCommandV1Schema.safeParse({ ...command, reviewer: { reviewerId: 'actor', sessionId: 'session' } }).success).toBe(false);
  expect(CurrentAuthorityV1Schema.safeParse({ ...state, identity: { ...identity, scope: { ...identity.scope, extra: true } } }).success).toBe(false);
  const malicious = JSON.parse(JSON.stringify(command).replace('"scope":{', '"scope":{"__proto__":{},'));
  expect(AuthorityStatusCommandV1Schema.safeParse(malicious).success).toBe(false);
});

test('accepts a complete response and max-epoch no-op with a previous changedAt', () => {
  expect(AuthorityStatusResponseV1Schema.parse({ result, replayed: false })).toEqual({ result, replayed: false });
  const noOp = { ...result, beforeStatus: 'paused', beforeEpoch: Number.MAX_SAFE_INTEGER,
    state: { ...state, epoch: Number.MAX_SAFE_INTEGER }, changed: false, committedAt: '2026-11-10T08:00:00.000Z' };
  expect(AuthorityStatusResultV1Schema.parse(noOp)).toEqual(noOp);
});

test.each([
  { identity: { ...identity, activationId: 'another' } },
  { action: 'resume' },
  { beforeStatus: 'revoked' },
  { beforeEpoch: Number.MAX_SAFE_INTEGER },
  { state: { ...state, epoch: 3 } },
  { state: { ...state, changedAt: '2026-11-10T08:00:00.000Z' } },
  { changed: false },
])('rejects inconsistent result %j', patch => {
  expect(AuthorityStatusResultV1Schema.safeParse({ ...result, ...patch }).success).toBe(false);
});

test('rejects an inverted resume observation interval regardless of source time', () => {
  const observation = { sourceRef: 'source', checkedAt: '2026-11-10T08:00:00.000Z', versions: { 'seller/account': 'v1' } };
  const completedAt = '2026-11-09T08:00:00.001Z';
  expect(AuthorityResumeObservationV1Schema.safeParse({ observation, startedAt: changedAt, completedAt }).success).toBe(true);
  expect(AuthorityResumeObservationV1Schema.safeParse({ observation, startedAt: completedAt, completedAt: changedAt }).success).toBe(false);
});
