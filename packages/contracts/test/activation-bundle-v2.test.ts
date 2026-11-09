import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { planBootstrap } from '@eapr/compiler/plan-bootstrap';
import {
  ActivationBundleSchema, bootstrapAssertionCases, bootstrapRequiredAssertions, bootstrapRequiredCases,
  hashBootstrapVerificationResult, hashCanonical, hashProfile,
} from '@eapr/contracts';
import { hashFinancialAttestation, hashFinancialReport, hashFinancialReservation } from '@eapr/contracts/activation-authority-hash';
import { ActivationBundleV2Schema, hashBundleV2, type ActivationBundleV2 } from '@eapr/contracts/activation-bundle-v2';
import {
  baselineEventsA, baselineEventsB, baselineManifestA, baselineManifestB, emptyTargetA, emptyTargetB,
  profileA, profileB, validSpecA, validSpecB,
} from '../../../tests/fixtures/index.js';

const h = (digit: string) => digit.repeat(64);
const issuerId = 'eapr-control-registry-1' as const;

function vector(company: 'a' | 'b'): ActivationBundleV2 {
  const [base, spec, manifest, bootstrapEvents, emptyTarget] = company === 'a'
    ? [profileA, validSpecA, baselineManifestA, baselineEventsA, emptyTargetA] as const
    : [profileB, validSpecB, baselineManifestB, baselineEventsB, emptyTargetB] as const;
  const profile = {
    ...base,
    bootstrap: {
      customer: { id: base.parentCustomerId, displayName: ' Shared Buyer ', evidenceRefs: ['ev-name', 'ev-id'] },
      billingConfigurationIds: base.contractTerms.map(term => ({ termId: term.id, id: 'config:' + term.id })),
    },
  };
  profile.hash = hashProfile(profile);
  const compiled = compile(spec, [profile]);
  if (!compiled.ok) throw new Error('Expected a compiled public artifact');
  const artifact = compiled.value;
  const target = { ...emptyTarget, asOf: manifest.asOf };
  const previewPlan = planBootstrap(artifact, profile, bootstrapEvents, target).plans[0];
  if (!previewPlan) throw new Error('Expected public bootstrap preview plan');
  const jobId = 'financial:' + company;
  const verificationReport: ActivationBundleV2['verificationReport'] = {
    id: 'report:' + jobId, artifactHash: artifact.hash, profileHashes: [profile.hash], manifestHash: manifest.hash,
    harnessVersion: '1', evaluatorBuildHash: h('a'), fixtureSetId: 'financial-fixtures', fixtureSetVersion: '2',
    checks: [
      { id: 'new_record', status: 'unavailable', diagnosticCodes: ['FIRST', 'SECOND'], cases: 0 },
      { id: 'baseline_reconcile', status: 'unavailable', diagnosticCodes: [], cases: 0 },
    ],
    coverage: {
      required: ['new_record', 'baseline_reconcile'], executed: [], sourceRefs: [manifest.sourceRef],
      profileHashes: [profile.hash], eventKinds: ['payment', 'invoice'],
    },
    unexplainedDifferenceCents: 0, eligible: false, createdAt: manifest.asOf,
  };
  const snapshot = {
    id: 'snapshot:' + manifest.id, manifestId: manifest.id, sourceRef: manifest.sourceRef, capturedAt: manifest.asOf,
    contentHash: h('b'), evidenceIds: ['ev-id', 'ev-name'], eventIds: bootstrapEvents.map(event => event.id),
  };
  const reservation: ActivationBundleV2['financialAttestation']['reservation'] = {
    schemaVersion: '1', jobId, issuerId, runnerId: 'eapr-financial-1', protocolVersion: '1', harnessVersion: '1',
    evaluatorBuildHash: verificationReport.evaluatorBuildHash, purpose: 'construction',
    evidencePin: { fixtureSetId: verificationReport.fixtureSetId, fixtureSetVersion: '2', bundleHash: h('c') },
    artifactHash: artifact.hash, requiredProfileHashes: [profile.hash], hash: h('0'),
    capture: {
      companyId: profile.scope.companyId, sourceRef: manifest.sourceRef, manifestId: manifest.id, manifestHash: manifest.hash,
      snapshotId: snapshot.id, snapshotHash: snapshot.contentHash, snapshotObjectHash: h('d'), eventsHash: h('e'),
    },
  };
  reservation.hash = hashFinancialReservation(reservation);
  const financialAttestation: ActivationBundleV2['financialAttestation'] = {
    schemaVersion: '1', reservation, reportId: verificationReport.id, reportHash: hashFinancialReport(verificationReport), hash: h('0'),
  };
  financialAttestation.hash = hashFinancialAttestation(financialAttestation);
  const bootstrapVerification: ActivationBundleV2['bootstrapVerification'] = {
    schemaVersion: '1', id: 'bootstrap-result:bootstrap-' + company, jobId: 'bootstrap-' + company,
    pin: {
      runnerId: 'eapr-bootstrap-1', protocolVersion: '1', evaluatorBuildHash: h('1'), subjectBuildHash: h('2'),
      fixtureSetId: 'bootstrap-fixtures', fixtureSetVersion: '1', fixtureHash: h('3'),
    },
    binding: {
      artifactHash: artifact.hash, profileHash: profile.hash, requiredProfileHashes: [profile.hash], scope: profile.scope,
      manifestId: manifest.id, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotHash: snapshot.contentHash,
      eventsHash: reservation.capture.eventsHash, targetSnapshotHash: h('4'), expectedTargetVersion: 0, asOf: manifest.asOf,
    },
    planHash: previewPlan.hash, passed: true, createdAt: manifest.asOf, hash: h('0'),
    assertions: bootstrapRequiredAssertions.map(id => ({ id, status: 'passed', caseIds: [...bootstrapAssertionCases[id]] })),
    cases: bootstrapRequiredCases.map(id => ({ id, status: 'passed' })),
  };
  bootstrapVerification.hash = hashBootstrapVerificationResult(bootstrapVerification);
  const reviewPackage = {
    id: 'review:' + company, revision: 1, hash: h('5'), scope: profile.scope,
    artifactHash: artifact.hash, profileHash: profile.hash, manifestHash: manifest.hash,
    verificationReportId: verificationReport.id, previewPlanHash: previewPlan.hash, expectedTargetVersion: 0,
    ready: false, diagnostics: [],
  };
  return {
    schemaVersion: '2', hash: h('0'), artifact, manifest, previewPlan, snapshot, profiles: [profile],
    bootstrapEvents, reviewPackage, verificationReport, bootstrapVerification, financialAttestation,
    request: {
      reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash, expectedArtifactHash: artifact.hash,
      expectedProfileHash: profile.hash, expectedTargetVersion: 0, idempotencyKey: 'development-request:' + company,
    },
    reviewer: { reviewerId: 'development-reviewer', sessionId: 'development-session' },
    semanticPreflight: { sourceRef: manifest.sourceRef, checkedAt: manifest.asOf, versions: manifest.semanticVersions },
    authorityPolicy: { issuerId, policyId: 'public-policy', policyHash: h('6') },
  };
}

// Independent path-based encoding for the public vectors. Bootstrap result and financial reservation
// sets in these vectors are constructed in their specified order.
const sortKeys: Record<string, string> = {
  profiles: 'id',
  'profiles[].bootstrap.customer.evidenceRefs': '',
  'profiles[].bootstrap.billingConfigurationIds': 'termId',
  'profiles[].sourceAccountIds': '',
  'profiles[].approvedLookups': 'id',
  'profiles[].approvedLookups[].entries': 'source',
  'profiles[].approvedLookups[].entries[].evidenceRefs': '',
  'profiles[].contractTerms': 'id',
  'profiles[].contractTerms[].evidenceRefs': '',
  'profiles[].findings': 'id',
  'profiles[].findings[].evidenceRefs': '',
  'manifest.streams': 'streamId',
  'manifest.files': 'fileId',
  'artifact.normalizedPlan.sourceContracts': 'resource',
  'artifact.normalizedPlan.capture': 'streamId',
  'artifact.normalizedPlan.capture[].resources': '',
  'artifact.normalizedPlan.mappings': 'resource',
  'artifact.normalizedPlan.allowedKinds': '',
  'artifact.normalizedPlan.validators': '',
  'artifact.sourceContractHashes': 'resource',
  'artifact.requiredProfileHashes': '',
  'verificationReport.profileHashes': '',
  'verificationReport.checks': 'id',
  'verificationReport.coverage.profileHashes': '',
  'verificationReport.coverage.required': '',
  'verificationReport.coverage.executed': '',
  'verificationReport.coverage.sourceRefs': '',
  'verificationReport.coverage.eventKinds': '',
};

function encode(value: unknown, path = '', order = 1): string {
  if (Array.isArray(value)) {
    const key = sortKeys[path];
    const rows = key === undefined ? value : [...value].sort((a, b) => {
      const first = key === '' ? a : a[key];
      const second = key === '' ? b : b[key];
      return first < second ? -order : first > second ? order : 0;
    });
    return '[' + rows.map(row => encode(row, path + '[]', order)).join(',') + ']';
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort()
    .map(key => JSON.stringify(key) + ':' + encode(object[key], path ? path + '.' + key : key, order)).join(',') + '}';
}

test.each([
  ['a', '5ae8a8327262b62003583028679c8252f7c5b1ebcdae91a04845b9a836b49bdd'],
  ['b', '3e3fefed06c0ae5bf691886631a87d094464f1bbd1e2feff9ebbf7cb9426f7c4'],
] as const)('company %s v2 hash matches a fixed independently encoded preimage', (company, golden) => {
  const { hash: _hash, ...input } = vector(company);
  const preimage = encode(input);
  expect(JSON.parse(preimage)).toMatchObject({
    schemaVersion: '2', bootstrapVerification: input.bootstrapVerification,
    financialAttestation: input.financialAttestation, authorityPolicy: input.authorityPolicy,
    bootstrapEvents: input.bootstrapEvents, previewPlan: input.previewPlan,
  });
  expect(JSON.parse(preimage)).not.toHaveProperty('hash');
  const independent = createHash('sha256').update(preimage).digest('hex');
  expect(independent).toBe(golden);
  expect(hashBundleV2(input)).toBe(independent);
  expect(hashBundleV2({ ...input, hash: h('f') })).toBe(independent);
  expect(hashBundleV2(JSON.parse(encode(input, '', -1)))).toBe(independent);
});

test('v1 and v2 remain distinct strict parsers', () => {
  const bundle = vector('a');
  const { bootstrapVerification, financialAttestation, authorityPolicy, ...inherited } = bundle;
  const old = { ...inherited, schemaVersion: '1' };
  expect(ActivationBundleSchema.safeParse(old).success).toBe(true);
  expect(ActivationBundleSchema.safeParse(bundle).success).toBe(false);
  expect(ActivationBundleV2Schema.safeParse(old).success).toBe(false);
  for (const invalid of [
    { ...bundle, bootstrapVerification: undefined }, { ...bundle, financialAttestation: undefined },
    { ...bundle, authorityPolicy: undefined }, { ...bundle, profiles: [bundle.profiles[0], bundle.profiles[0]] },
    { ...bundle, authorityPolicy: { ...authorityPolicy, issuerId: 'other' } },
    { ...bundle, authorityPolicy: { ...authorityPolicy, extra: true } },
    { ...bundle, bootstrapVerification: { ...bootstrapVerification, extra: true } },
    { ...bundle, financialAttestation: { ...financialAttestation, ...JSON.parse('{"__proto__":{}}') } },
  ]) expect(ActivationBundleV2Schema.safeParse(invalid).success).toBe(false);
});

test('stored financial report arrays retain order independently of v2 bundle report-set ordering', () => {
  const bundle = vector('a');
  const report = bundle.verificationReport;
  const reportHash = hashFinancialReport(report);
  expect(reportHash).toBe(hashCanonical(report));
  const reordered = {
    ...report, checks: [...report.checks].reverse(),
    coverage: { ...report.coverage, required: [...report.coverage.required].reverse() },
  };
  for (const change of [
    { ...report, checks: reordered.checks }, { ...report, coverage: reordered.coverage },
    { ...report, id: 'other' }, { ...report, createdAt: '2026-11-08T00:00:00Z' },
    { ...report, checks: [{ ...report.checks[0], diagnosticCodes: ['SECOND', 'FIRST'] }, report.checks[1]] },
  ]) expect(hashFinancialReport(change)).not.toBe(reportHash);
  expect(hashBundleV2({ ...bundle, verificationReport: reordered })).toBe(hashBundleV2(bundle));
  expect(hashBundleV2({ ...bundle, verificationReport: reordered,
    financialAttestation: { ...bundle.financialAttestation, reportHash: hashFinancialReport(reordered) },
  })).not.toBe(hashBundleV2(bundle));
});

test('v2 binds full result, reservation, policy, plan and event contents', () => {
  const bundle = vector('b');
  const { bootstrapVerification, financialAttestation, authorityPolicy, previewPlan } = bundle;
  const { reservation } = financialAttestation;
  const changed = h('f');
  const withReservation = (patch: Partial<typeof reservation>) => ({
    financialAttestation: { ...financialAttestation, reservation: { ...reservation, ...patch } },
  });
  const ensure = previewPlan.operations[0];
  if (ensure.op !== 'ensure_customer') throw new Error('Expected initial customer ensure');
  const [lineage, ...tail] = previewPlan.lineage;
  const [assertion, ...assertions] = bootstrapVerification.assertions;
  const [firstCase, ...cases] = bootstrapVerification.cases;
  const baseline = hashBundleV2(bundle);
  expect(hashBundleV2({
    ...bundle,
    bootstrapVerification: {
      ...bootstrapVerification, cases: [...bootstrapVerification.cases].reverse(),
      assertions: [...bootstrapVerification.assertions].reverse().map(item => ({ ...item, caseIds: [...item.caseIds].reverse() })),
    },
  })).toBe(baseline);
  for (const patch of [
    { bootstrapVerification: { ...bootstrapVerification, hash: changed } },
    { bootstrapVerification: { ...bootstrapVerification, planHash: changed } },
    { bootstrapVerification: { ...bootstrapVerification, id: 'bootstrap-result:other', jobId: 'other' } },
    { bootstrapVerification: { ...bootstrapVerification, createdAt: '2026-11-08T00:00:00Z' } },
    { bootstrapVerification: { ...bootstrapVerification, passed: false, assertions: [
      { ...assertion, status: 'failed' }, ...assertions,
    ] } },
    { bootstrapVerification: { ...bootstrapVerification, passed: false, cases: [
      { ...firstCase, status: 'failed' }, ...cases,
    ], assertions: bootstrapVerification.assertions.map(item =>
      item.caseIds.includes(firstCase.id) ? { ...item, status: 'failed' } : item),
    } },
    { bootstrapVerification: { ...bootstrapVerification, pin: { ...bootstrapVerification.pin, fixtureHash: changed } } },
    { bootstrapVerification: { ...bootstrapVerification, binding: { ...bootstrapVerification.binding, targetSnapshotHash: changed } } },
    { financialAttestation: { ...financialAttestation, hash: changed } },
    { financialAttestation: { ...financialAttestation, reportHash: changed } },
    withReservation({ hash: changed }),
    withReservation({ evidencePin: { ...reservation.evidencePin, bundleHash: changed } }),
    ...['snapshotHash', 'snapshotObjectHash', 'eventsHash'].map(key =>
      withReservation({ capture: { ...reservation.capture, [key]: changed } })),
    { authorityPolicy: { ...authorityPolicy, policyId: 'other' } },
    { authorityPolicy: { ...authorityPolicy, policyHash: changed } },
    { previewPlan: { ...previewPlan, hash: changed } },
    { previewPlan: { ...previewPlan, eventIds: [...previewPlan.eventIds].reverse() } },
    { previewPlan: { ...previewPlan, operations: [...previewPlan.operations].reverse() } },
    { previewPlan: { ...previewPlan, lineage: [...previewPlan.lineage].reverse() } },
    { previewPlan: { ...previewPlan, operations: [
      { ...ensure, record: { ...ensure.record, displayName: 'Different Buyer' } }, ...previewPlan.operations.slice(1),
    ] } },
    { previewPlan: { ...previewPlan, lineage: [{ ...lineage, derivationInputs: ['other'] }, ...tail] } },
    { bootstrapEvents: [...bundle.bootstrapEvents].reverse() },
  ] satisfies Partial<ActivationBundleV2>[]) {
    expect(hashBundleV2({ ...bundle, ...patch })).not.toBe(baseline);
  }
});
