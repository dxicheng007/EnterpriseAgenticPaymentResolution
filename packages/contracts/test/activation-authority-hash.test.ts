import { expect, test } from 'vitest';
import { hashCanonical } from '@eapr/contracts';
import {
  hashActivationTrustPolicy, hashFinancialAttestation, hashFinancialReservation, hashRegisteredScopeIndex,
  matchesActivationTrustPolicyEntry,
} from '@eapr/contracts/activation-authority-hash';
import type { ActivationTrustPolicyEntryV1, FinancialReservationV1 } from '@eapr/contracts/activation-authority';

const hash = (digit: string) => digit.repeat(64);
const financial = {
  runnerId: 'eapr-financial-1', protocolVersion: '1', harnessVersion: '1', evaluatorBuildHash: hash('a'),
  evidencePin: { fixtureSetId: 'fixture', fixtureSetVersion: '2', bundleHash: hash('b') },
} as const;
const reservation: Omit<FinancialReservationV1, 'hash'> = {
  schemaVersion: '1', jobId: 'job', issuerId: 'eapr-control-registry-1', purpose: 'construction',
  ...financial, artifactHash: hash('c'), requiredProfileHashes: [hash('d'), hash('e')],
  capture: {
    companyId: 'company', sourceRef: 'source', manifestId: 'manifest', manifestHash: hash('1'),
    snapshotId: 'snapshot:manifest', snapshotHash: hash('2'), snapshotObjectHash: hash('3'), eventsHash: hash('4'),
  },
};
const attestation = {
  schemaVersion: '1', reservation: { ...reservation, hash: hash('5') },
  reportId: 'report:job', reportHash: hash('6'),
} as const;
const scope = { companyId: 'company', sellerEntityId: 'seller', accountId: 'account' };
const entry: ActivationTrustPolicyEntryV1 = {
  issuerId: reservation.issuerId, financial, capture: reservation.capture, artifactHash: reservation.artifactHash,
  requiredProfileHashes: reservation.requiredProfileHashes, selectedProfileHash: hash('e'), scope,
  bootstrapPin: {
    runnerId: 'eapr-bootstrap-1', protocolVersion: '1', evaluatorBuildHash: hash('7'),
    subjectBuildHash: hash('8'), fixtureSetId: 'bootstrap', fixtureSetVersion: '1', fixtureHash: hash('9'),
  },
};
const other = {
  ...entry, financial: { ...financial, evaluatorBuildHash: hash('f'),
    evidencePin: { ...financial.evidencePin, bundleHash: hash('f') } },
};
const policy = { schemaVersion: '1', policyId: 'policy', entries: [other, entry] } as const;

test('reservation and attestation omit only their own hashes', () => {
  expect(hashFinancialReservation(reservation)).toBe(hashCanonical(reservation));
  const permuted = Object.fromEntries(Object.entries(reservation).reverse()) as typeof reservation;
  expect(hashFinancialReservation({
    ...permuted, hash: hash('0'), requiredProfileHashes: [...reservation.requiredProfileHashes].reverse(),
  })).toBe(hashCanonical(reservation));
  expect(hashFinancialAttestation(attestation)).toBe(hashCanonical(attestation));
  expect(hashFinancialAttestation({ ...attestation, hash: hash('0') })).toBe(hashCanonical(attestation));
  for (const change of [
    { jobId: 'other' }, { evaluatorBuildHash: hash('0') }, { artifactHash: hash('0') },
    { requiredProfileHashes: [hash('e')] },
    { evidencePin: { ...financial.evidencePin, fixtureSetId: 'other' } },
    { evidencePin: { ...financial.evidencePin, bundleHash: hash('0') } },
    ...['companyId', 'sourceRef'].map(key => ({ capture: { ...reservation.capture, [key]: 'other' } })),
    { capture: { ...reservation.capture, manifestId: 'other', snapshotId: 'snapshot:other' } },
    ...['manifestHash', 'snapshotHash', 'snapshotObjectHash', 'eventsHash']
      .map(key => ({ capture: { ...reservation.capture, [key]: hash('0') } })),
  ]) {
    const changed = { ...reservation, ...change };
    expect(hashFinancialReservation(changed)).not.toBe(hashCanonical(reservation));
    expect(hashFinancialAttestation({
      ...attestation, reservation: { ...changed, hash: attestation.reservation.hash }, reportId: 'report:' + changed.jobId,
    })).not.toBe(hashCanonical(attestation));
  }
  for (const changed of [
    { ...attestation, reportHash: hash('0') },
    { ...attestation, reservation: { ...attestation.reservation, hash: hash('0') } },
  ]) expect(hashFinancialAttestation(changed)).not.toBe(hashCanonical(attestation));
  expect(() => hashFinancialReservation({ ...reservation, requiredProfileHashes: [hash('d'), hash('d')] })).toThrow();
});

test('policy digest and matching bind complete normalized tuples', () => {
  const expectedOrder = [entry, other].map(tuple => [hashCanonical(tuple), tuple] as const)
    .sort(([a], [b]) => a < b ? -1 : 1).map(([, tuple]) => tuple);
  const expected = hashCanonical({ ...policy, entries: expectedOrder });
  expect(hashActivationTrustPolicy({ ...policy, entries: [other, entry] })).toBe(expected);
  expect(hashActivationTrustPolicy({ ...policy, entries: [entry, other], hash: hash('0') })).toBe(expected);
  expect(hashActivationTrustPolicy({ ...policy, entries: [entry, other], policyId: 'other' })).not.toBe(expected);
  expect(matchesActivationTrustPolicyEntry(entry, {
    ...entry, requiredProfileHashes: [...entry.requiredProfileHashes].reverse(),
  })).toBe(true);
  const recombined = { ...entry, financial: { ...financial, evaluatorBuildHash: other.financial.evaluatorBuildHash } };
  expect(policy.entries.some(tuple => matchesActivationTrustPolicyEntry(tuple, recombined))).toBe(false);
  const empty = { ...policy, entries: [] };
  expect(empty.entries.some(tuple => matchesActivationTrustPolicyEntry(tuple, entry))).toBe(false);
  for (const modified of [
    recombined, { ...entry, artifactHash: hash('0') }, { ...entry, requiredProfileHashes: [entry.selectedProfileHash] },
    { ...entry, selectedProfileHash: hash('d') },
    { ...entry, scope: { ...scope, sellerEntityId: 'other' } },
    { ...entry, scope: { ...scope, accountId: 'other' } },
    { ...entry, scope: { ...scope, companyId: 'other' }, capture: { ...entry.capture, companyId: 'other' } },
    ...['evaluatorBuildHash', 'subjectBuildHash', 'fixtureHash'].map(key => ({
      ...entry, bootstrapPin: { ...entry.bootstrapPin, [key]: hash('0') },
    })),
    ...['fixtureSetId', 'fixtureSetVersion'].map(key => ({
      ...entry, bootstrapPin: { ...entry.bootstrapPin, [key]: 'other' },
    })),
    ...['bundleHash', 'fixtureSetId'].map(key => ({
      ...entry, financial: { ...financial, evidencePin: { ...financial.evidencePin, [key]: hash('0') } },
    })),
    ...['manifestHash', 'snapshotHash', 'snapshotObjectHash', 'eventsHash'].map(key => ({
      ...entry, capture: { ...entry.capture, [key]: hash('0') },
    })),
    { ...entry, capture: { ...entry.capture, sourceRef: 'other' } },
    { ...entry, capture: { ...entry.capture, manifestId: 'other', snapshotId: 'snapshot:other' } },
  ]) {
    expect(matchesActivationTrustPolicyEntry(entry, modified)).toBe(false);
    expect(hashActivationTrustPolicy({ ...policy, entries: [modified, other] })).not.toBe(expected);
  }
  expect(() => matchesActivationTrustPolicyEntry(entry, { ...entry, requiredProfileHashes: [] })).toThrow();
  expect(() => hashActivationTrustPolicy({ ...policy, entries: [entry, entry] })).toThrow();
});

test('scope index digest sorts accounts and binds complete entry contents', () => {
  const scopeEntry = {
    accountId: scope.accountId, scope, profileHash: hash('e'), manifestId: 'manifest',
    manifestHash: hash('1'), manifestAsOf: '2026-11-08T00:00:00.000Z',
  };
  const first = { ...scopeEntry, accountId: 'A', scope: { ...scope, accountId: 'A' } };
  const index = { schemaVersion: '1', entries: [first, scopeEntry] } as const;
  const expected = hashCanonical(index);
  expect(hashRegisteredScopeIndex({ ...index, entries: [first, scopeEntry] })).toBe(expected);
  expect(hashRegisteredScopeIndex({
    ...index, hash: hash('0'), entries: [{ ...scopeEntry, manifestAsOf: '2026-11-08T00:00:00Z' }, first],
  })).toBe(expected);
  for (const changed of [
    { accountId: 'B', scope: { ...scope, accountId: 'B' } }, { scope: { ...scope, companyId: 'other' } },
    { profileHash: hash('0') }, { manifestId: 'other' }, { manifestHash: hash('0') },
    { manifestAsOf: '2026-11-08T01:00:00Z' },
  ]) expect(hashRegisteredScopeIndex({ ...index, entries: [first, { ...scopeEntry, ...changed }] })).not.toBe(expected);
  expect(() => hashRegisteredScopeIndex({ ...index, entries: [first, first] })).toThrow();
});
