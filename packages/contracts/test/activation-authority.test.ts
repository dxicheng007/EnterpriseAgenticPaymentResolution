import { expect, test } from 'vitest';
import {
  ActivationAuthorityDiagnosticCodeSchema, ActivationStateV1Schema, ActivationTrustPolicyV1Schema,
  FinancialAttestationV1Schema, FinancialReservationV1Schema, RegisteredScopeIndexV1Schema, ScopedReceiptQuerySchema,
  type ActivationTrustPolicyEntryV1, type FinancialReservationV1,
} from '@eapr/contracts/activation-authority';

const hash = (digit: string) => digit.repeat(64);
const scope = { companyId: 'company', sellerEntityId: 'seller', accountId: 'account' };
const instant = '2026-11-08T00:00:00Z';
const capture = {
  companyId: scope.companyId, sourceRef: 'source', manifestId: 'manifest', manifestHash: hash('1'),
  snapshotId: 'snapshot:manifest', snapshotHash: hash('2'), snapshotObjectHash: hash('3'), eventsHash: hash('4'),
};
const financial = {
  runnerId: 'eapr-financial-1', protocolVersion: '1', harnessVersion: '1',
  evaluatorBuildHash: hash('5'), evidencePin: { fixtureSetId: 'fixture', fixtureSetVersion: '2', bundleHash: hash('6') },
} as const;
const reservation: FinancialReservationV1 = {
  schemaVersion: '1', jobId: 'job', issuerId: 'eapr-control-registry-1', ...financial,
  purpose: 'construction', capture, artifactHash: hash('7'), requiredProfileHashes: [hash('9'), hash('8')], hash: hash('a'),
};
const entry: ActivationTrustPolicyEntryV1 = {
  issuerId: reservation.issuerId, financial, capture, artifactHash: reservation.artifactHash,
  requiredProfileHashes: reservation.requiredProfileHashes, selectedProfileHash: hash('8'), scope,
  bootstrapPin: {
    runnerId: 'eapr-bootstrap-1', protocolVersion: '1', evaluatorBuildHash: hash('b'), subjectBuildHash: hash('c'),
    fixtureSetId: 'bootstrap', fixtureSetVersion: '1', fixtureHash: hash('d'),
  },
};
const indexEntry = {
  accountId: scope.accountId, scope, profileHash: hash('8'), manifestId: capture.manifestId,
  manifestHash: capture.manifestHash, manifestAsOf: instant,
};

test('reservation accepts separate snapshot hashes and normalizes only unique required profile sets', () => {
  expect(FinancialReservationV1Schema.parse(reservation)).toEqual({
    ...reservation, requiredProfileHashes: [hash('8'), hash('9')],
  });
  expect(FinancialReservationV1Schema.safeParse({
    ...reservation, capture: { ...capture, snapshotObjectHash: capture.snapshotHash },
  }).success).toBe(true);
  for (const change of [
    { schemaVersion: '2' }, { issuerId: 'other' }, { runnerId: 'other' }, { protocolVersion: '2' },
    { harnessVersion: '2' }, { purpose: 'holdout' }, { jobId: '' }, { artifactHash: 'bad' },
    { extra: true }, { requiredProfileHashes: [] }, { requiredProfileHashes: [hash('8'), hash('8')] },
    { capture: { ...capture, snapshotId: 'snapshot:wrong' } },
    { capture: { ...capture, snapshotObjectHash: undefined } },
    { capture: { ...capture, snapshotHash: undefined } },
    { evidencePin: { ...financial.evidencePin, fixtureSetVersion: '1' } },
    { evidencePin: { ...financial.evidencePin, extra: true } },
    { capture: { ...capture, ...JSON.parse('{"__proto__":{}}') } },
    { capture: { ...capture, ...JSON.parse('{"constructor":{}}') } },
    { capture: { ...capture, ...JSON.parse('{"prototype":{}}') } },
  ]) {
    expect(FinancialReservationV1Schema.safeParse({ ...reservation, ...change }).success, JSON.stringify(change)).toBe(false);
  }
});

test('financial attestation binds its report ID structurally to its reservation job', () => {
  const attestation = { schemaVersion: '1', reservation, reportId: 'report:job', reportHash: hash('b'), hash: hash('c') };
  expect(FinancialAttestationV1Schema.safeParse(attestation).success).toBe(true);
  expect(FinancialAttestationV1Schema.safeParse({ ...attestation, reportId: 'report:other' }).success).toBe(false);
});

test('policy admits distinct complete tuples for one scope, with selected profile and matching company', () => {
  const policy = { schemaVersion: '1', policyId: 'policy', hash: hash('f'), entries: [entry] };
  const second = { ...entry, financial: { ...financial, evaluatorBuildHash: hash('e') } };
  expect(ActivationTrustPolicyV1Schema.parse({ ...policy, entries: [] }).entries).toEqual([]);
  expect(ActivationTrustPolicyV1Schema.parse({ ...policy, entries: [entry, second] }).entries)
    .toEqual(ActivationTrustPolicyV1Schema.parse({ ...policy, entries: [second, entry] }).entries);
  for (const entries of [
    [entry, { ...entry, requiredProfileHashes: [...entry.requiredProfileHashes].reverse() }],
    [{ ...entry, scope: { ...scope, companyId: 'other' } }],
    [{ ...entry, selectedProfileHash: hash('0') }],
  ]) expect(ActivationTrustPolicyV1Schema.safeParse({ ...policy, entries }).success).toBe(false);
});

test('scope index normalizes time and sorts unique account identities', () => {
  const other = { ...indexEntry, accountId: 'A', scope: { ...scope, accountId: 'A' } };
  const index = { schemaVersion: '1', hash: hash('a'), entries: [indexEntry, other] };
  expect(RegisteredScopeIndexV1Schema.parse(index).entries).toEqual([other, indexEntry].map(item => ({
    ...item, manifestAsOf: '2026-11-08T00:00:00.000Z',
  })));
  expect(RegisteredScopeIndexV1Schema.parse({ ...index, entries: [] }).entries).toEqual([]);
  for (const entries of [[indexEntry, indexEntry], [{ ...indexEntry, accountId: 'wrong' }],
    [{ ...indexEntry, manifestAsOf: '2026-11-08T00:00:00+00:00' }]]) {
    expect(RegisteredScopeIndexV1Schema.safeParse({ ...index, entries }).success).toBe(false);
  }
});

test('activation state pairs the initial receipt with the activation and the envelope scope', () => {
  const activation = {
    id: 'activation', scope, artifactHash: hash('7'), profileHash: hash('8'), manifestHash: hash('1'),
    baselineCursors: [], allowedKinds: [], limits: { maxTransactionCents: 5000000, maxRecordsPerCycle: 1000 },
    reviewerId: 'reviewer', epoch: 1, status: 'paused', approvedAt: instant,
  };
  const initialReceipt = {
    id: 'receipt', scope, activationId: activation.id, epoch: 1, artifactHash: activation.artifactHash,
    planHash: hash('a'), eventIds: [], targetRecordIds: [], beforeBalanceCents: 0, afterBalanceCents: 0,
    status: 'applied', committedAt: instant,
  };
  const state = { schemaVersion: '1', scope, activation, initialReceipt };
  const wrongScope = { ...scope, sellerEntityId: 'other' };
  expect(ActivationStateV1Schema.safeParse(state).success).toBe(true);
  expect(ActivationStateV1Schema.safeParse({ ...state, activation: null, initialReceipt: null }).success).toBe(true);
  for (const change of [
    { activation: null }, { initialReceipt: null }, { scope: wrongScope },
    { activation: { ...activation, scope: wrongScope } },
    ...[{ scope: wrongScope }, { activationId: 'other' }, { epoch: 2 }, { artifactHash: hash('f') }]
      .map(fields => ({ initialReceipt: { ...initialReceipt, ...fields } })),
  ]) expect(ActivationStateV1Schema.safeParse({ ...state, ...change }).success).toBe(false);
  const query = { scope, expectedRequestHash: hash('1'), expectedBundleHash: hash('2') };
  expect(ScopedReceiptQuerySchema.parse(query)).toEqual(query);
  expect(ScopedReceiptQuerySchema.safeParse({ ...query, expectedBundleHash: undefined }).success).toBe(false);
});

test('authority diagnostics expose exactly the frozen fixed codes', () => {
  expect(ActivationAuthorityDiagnosticCodeSchema.options).toEqual([
    'FINANCIAL_ATTESTATION_UNAVAILABLE', 'FINANCIAL_ATTESTATION_MISMATCH', 'BOOTSTRAP_VERIFICATION_UNAVAILABLE',
    'BOOTSTRAP_VERIFICATION_MISMATCH', 'ACTIVATION_POLICY_UNAVAILABLE', 'ACTIVATION_POLICY_MISMATCH',
    'ACTIVATION_BUNDLE_MISMATCH', 'REVIEW_NOT_READY', 'REVIEW_STALE', 'TARGET_STALE', 'IDEMPOTENCY_CONFLICT',
    'ALREADY_ACTIVE', 'SOURCE_SEMANTICS_UNAVAILABLE', 'SOURCE_SEMANTICS_MISMATCH', 'SOURCE_SEMANTICS_UNSUPPORTED_ORDER',
  ]);
  expect(ActivationAuthorityDiagnosticCodeSchema.safeParse('UNKNOWN').success).toBe(false);
});
