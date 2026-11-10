import { expect, test } from 'vitest';
import { hashCanonical } from '../src/canonical.js';
import {
  AuthorityAdmissionCheckV1Schema, AuthorityAdmissionGrantsV1Schema, AuthorityAdmissionResponseV1Schema,
  AuthorityAdmissionTicketSchema, AuthorityOperationBodyV1Schema, AuthorityOperationV1Schema,
} from '../src/authority-ingress.js';

const body = { expectedEpoch: 1, idempotencyKey: 'key-1' };
const operation = { schemaVersion: '1', accountId: 'a.account', action: 'pause', body };
const read = { ...operation, action: 'read', body: null };
const check = { ticket: 'a'.repeat(64), requestHash: 'b'.repeat(64), mode: 'mutation' };
const grants = {
  reviewer: { reviewerId: 'reviewer', sessionId: 'session' },
  allowedAccountIds: ['a.account'], allowedSourceRefs: ['source-a'],
};
const response = { requestHash: check.requestHash, grants };

test('strict_operation_body_and_descriptor', () => {
  expect(AuthorityOperationBodyV1Schema.parse(body)).toEqual(body);
  expect(AuthorityOperationBodyV1Schema.parse({ ...body, expectedEpoch: Number.MAX_SAFE_INTEGER }))
    .toEqual({ ...body, expectedEpoch: Number.MAX_SAFE_INTEGER });
  for (const expectedEpoch of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
    expect(AuthorityOperationBodyV1Schema.safeParse({ ...body, expectedEpoch }).success).toBe(false);
  }
  for (const idempotencyKey of ['', '/wrong', 'a'.repeat(161)]) {
    expect(AuthorityOperationBodyV1Schema.safeParse({ ...body, idempotencyKey }).success).toBe(false);
  }
  for (const key of ['extra', '__proto__', 'constructor', 'prototype']) {
    const invalid = { ...body, [key]: {} };
    expect(AuthorityOperationBodyV1Schema.safeParse(invalid).success).toBe(false);
    expect(AuthorityOperationV1Schema.safeParse({ ...operation, body: invalid }).success).toBe(false);
    expect(AuthorityOperationV1Schema.safeParse({ ...read, [key]: {} }).success).toBe(false);
  }
  expect(AuthorityOperationV1Schema.parse(read)).toEqual(read);
  for (const action of ['pause', 'resume', 'revoke']) {
    expect(AuthorityOperationV1Schema.parse({ ...operation, action })).toEqual({ ...operation, action });
    expect(AuthorityOperationV1Schema.safeParse({ ...operation, action, body: null }).success).toBe(false);
  }
  expect(AuthorityOperationV1Schema.safeParse({ ...read, body }).success).toBe(false);
  expect(AuthorityOperationV1Schema.safeParse({ ...read, body: undefined }).success).toBe(false);
  expect(AuthorityOperationV1Schema.safeParse({ ...operation, schemaVersion: 1 }).success).toBe(false);
  expect(AuthorityOperationV1Schema.safeParse({ ...operation, accountId: '/bad' }).success).toBe(false);
  expect(AuthorityOperationV1Schema.safeParse({ ...operation, action: 'activate' }).success).toBe(false);
});

test('request_hash_changes_with_each_operation_field', () => {
  const parsed = AuthorityOperationV1Schema.parse(operation);
  const requestHash = hashCanonical(parsed);
  expect(requestHash).toBe(hashCanonical({
    schemaVersion: '1', accountId: 'a.account', action: 'pause',
    body: { expectedEpoch: 1, idempotencyKey: 'key-1' },
  }));
  for (const modified of [
    { ...operation, accountId: 'b.account' },
    { ...operation, action: 'resume' },
    { ...operation, body: { ...body, expectedEpoch: 2 } },
    { ...operation, body: { ...body, idempotencyKey: 'key-2' } },
    read,
  ]) {
    expect(hashCanonical(AuthorityOperationV1Schema.parse(modified))).not.toBe(requestHash);
  }
  const readHash = hashCanonical(AuthorityOperationV1Schema.parse(read));
  expect(readHash).toBe(hashCanonical({ schemaVersion: '1', accountId: 'a.account', action: 'read', body: null }));
  expect(readHash).not.toBe(hashCanonical({ schemaVersion: '1', accountId: 'a.account', action: 'read' }));
  body.expectedEpoch = 2;
  try {
    expect(hashCanonical(parsed)).toBe(requestHash);
  } finally {
    body.expectedEpoch = 1;
  }
});

test('private_callback_shapes_are_strict', () => {
  expect(AuthorityAdmissionCheckV1Schema.parse(check)).toEqual(check);
  expect(AuthorityAdmissionCheckV1Schema.parse({ ...check, mode: 'read' }).mode).toBe('read');
  expect(AuthorityAdmissionGrantsV1Schema.parse(grants)).toEqual(grants);
  expect(AuthorityAdmissionResponseV1Schema.parse(response)).toEqual(response);
  for (const ticket of ['token', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'z'.repeat(64), check.ticket + '\n']) {
    expect(AuthorityAdmissionTicketSchema.safeParse(ticket).success).toBe(false);
    expect(AuthorityAdmissionCheckV1Schema.safeParse({ ...check, ticket }).success).toBe(false);
  }
  for (const invalid of [
    { ...check, mode: 'pause' }, { ...check, requestHash: 'hash' },
    { ...check, reviewer: grants.reviewer }, { ...check, ['__proto__']: {} },
  ]) {
    expect(AuthorityAdmissionCheckV1Schema.safeParse(invalid).success).toBe(false);
  }
  for (const invalid of [
    { ...grants, allowedAccountIds: [''] }, { ...grants, allowedSourceRefs: ['/bad'] },
    { ...grants, reviewer: { reviewerId: 'reviewer' } },
    { ...grants, reviewer: { ...grants.reviewer, role: 'operator' } },
    { ...grants, ['constructor']: {} },
  ]) {
    expect(AuthorityAdmissionGrantsV1Schema.safeParse(invalid).success).toBe(false);
    expect(AuthorityAdmissionResponseV1Schema.safeParse({ ...response, grants: invalid }).success).toBe(false);
  }
  expect(AuthorityAdmissionResponseV1Schema.safeParse({ ...response, ticket: check.ticket }).success).toBe(false);
  expect(AuthorityAdmissionResponseV1Schema.safeParse({ ...response, requestHash: 'hash' }).success).toBe(false);
});
