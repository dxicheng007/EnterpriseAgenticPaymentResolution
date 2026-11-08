import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { hashBytes, hashCanonical, hashEvent, hashProfile, type ConnectorSpec } from '@eapr/contracts';
import {
  baselineEventsA, baselineEventsB, baselineManifestA, emptyTargetB, profileA, profileB, validSpecA, validSpecB,
} from '../../../tests/fixtures/index.js';
import { buildCasePlan, runCasePlan } from '../src/cases.js';
import { decodeTruth } from '../src/fixtures.js';
import { evaluateReferenceState } from '../src/reference-model.js';
import { evaluatorBuildHash } from '../src/launcher.js';
import { runVerificationSubject } from '../src/subject-comparison.js';
import { publicTruthFixture } from './public-truth-fixture.js';

function artifactFor(spec: ConnectorSpec, profiles = [profileA]) {
  const result = compile(spec, profiles);
  if (!result.ok) throw new Error('Test subject did not compile');
  return result.value;
}

test('inapplicable_matrix_launches_nothing for the entire requested profile matrix', async () => {
  const { hash: _hash, ...truth } = publicTruthFixture();
  const otherSourceAccount = 'cust-a-unsupported';
  const other = {
    ...profileA, id: 'profile-unsupported', scope: { ...profileA.scope, accountId: 'parent-unsupported' },
    sourceAccountIds: [otherSourceAccount], contractTerms: [], approvedLookups: [],
  };
  other.hash = hashProfile(other);
  const profiles = [profileA, other];
  const artifact = artifactFor(validSpecA, profiles);
  const multi = {
    ...truth, accounts: [...truth.accounts, { sourceAccountId: otherSourceAccount, records: [], balanceAnchorCents: null }],
  };
  const fixture = decodeTruth(JSON.stringify({ ...multi, hash: hashCanonical(multi) }));
  const plan = buildCasePlan({ artifact, profiles, manifest: baselineManifestA }, fixture, baselineEventsA);
  const planned = plan.find(check => check.id === 'new_record');
  expect(planned).toEqual({
    id: 'new_record', cases: [], requiredCases: [], unavailable: [{ profileHash: other.hash, reason: 'NO_COMPATIBLE_RECIPE' }],
  });
  const executed = await runCasePlan(artifact, plan);
  expect(executed.eventKinds).toEqual([]);
  expect(executed.privateResults.every(check => !check.plannerExecutions && !check.captureValidationExecutions)).toBe(true);
  expect(executed.checks).toHaveLength(13);
  expect(executed.checks.every(check => check.status === 'unavailable' && check.cases === 0)).toBe(true);
});

test('unsupported source contract has no synthetic cases and a case plan rejects another artifact', async () => {
  const truth = decodeTruth(JSON.stringify(publicTruthFixture()));
  const subject = { artifact: artifactFor(validSpecA), profiles: [profileA], manifest: baselineManifestA };
  const plan = buildCasePlan(subject, truth, baselineEventsA);
  const changed = structuredClone(validSpecA);
  changed.sourceContracts.find(contract => contract.kind === 'invoice')!.fields.extra = {
    type: 'string', required: false, nullable: false, format: 'text',
  };
  const unsupported = artifactFor(changed);
  const different = buildCasePlan({ ...subject, artifact: unsupported }, truth, baselineEventsA);
  expect(different.filter(check => check.cases.length).map(check => check.id)).toEqual(['baseline_reconcile']);
  await expect(runCasePlan(unsupported, plan)).rejects.toThrow('Verification case binding failed');
});

test('B fractional and unsafe numbers fail their respective pre-money validation boundaries', async () => {
  const artifact = artifactFor(validSpecB, [profileB]);
  const event = baselineEventsB.find(value => value.kind === 'payment')!;
  const fractional = { ...event, payload: { ...event.payload, amount_minor: 1.5 } };
  const unsafe = { ...event, payload: { ...event.payload, amount_minor: Number.MAX_SAFE_INTEGER + 1 } };
  expect(() => hashEvent(fractional)).toThrow();
  expect(() => hashEvent(unsafe)).toThrow();
  expect(await runVerificationSubject(artifact, profileB, [fractional], emptyTargetB)).toMatchObject({
    ok: true, value: { outcome: { plans: [], holds: [{ code: 'SOURCE_SCHEMA', eventIds: [] }] } },
  });
  expect(await runVerificationSubject(artifact, profileB, [unsafe], emptyTargetB))
    .toEqual({ ok: false, code: 'INPUT_INVALID' });
});

test('negative_mapping_rejected for an alternate B amount field or unsupported amount constant', () => {
  for (const op of [
    { op: 'field', path: '/revision_no' },
    { op: 'constant', value: 300000, evidenceRef: validSpecB.evidenceRefs[0] },
  ] as const) {
    const bad = structuredClone(validSpecB);
    const payment = bad.mappings.find(mapping => mapping.kind === 'payment');
    if (payment?.kind !== 'payment') throw new Error('Missing public payment mapping');
    payment.fields.amountCents = op;
    const result = compile(bad, [profileB]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map(diagnostic => diagnostic.code))
      .toContain(op.op === 'field' ? 'MAPPING_TYPE' : 'EVIDENCE_SUPPORT');
  }
});

test('changed_case_code_changes_build_hash', async () => {
  const oldPaths = [
    './evaluator-runner.ts', './fixture-store.ts', './fixtures.ts', './jobs.ts', './launcher.ts', './protocol.ts',
    './reference-model.ts', './registry.ts', './runner.ts', './subject-comparison.ts', './subject-runner.ts', './verify.ts', '../../../package-lock.json',
  ];
  const root = new URL('../src/', import.meta.url);
  const parts = async (paths: string[]) => Promise.all(paths.map(async name => ({
    name, hash: hashBytes(await readFile(new URL(name, root))),
  })));
  const oldHash = hashCanonical(await parts(oldPaths));
  const newDependencies = [
    '../../evidence/src/extract.ts', '../../evidence/src/index.ts', '../../evidence/src/locate.ts',
    '../../evidence/src/search.ts', '../../evidence/src/store.ts',
    '../../sources/src/company-a.ts', '../../sources/src/company-b.ts', '../../sources/src/errors.ts', '../../sources/src/records.ts',
  ];
  const now = await evaluatorBuildHash();
  const paths = ['./capture-boundary.ts', './case-recipes.ts', './cases.ts', oldPaths[0], './evidence-fixtures.ts',
    ...oldPaths.slice(1, -1), ...newDependencies, oldPaths.at(-1)!];
  expect(now).toBe(hashCanonical(await parts(paths)));
  expect(now).not.toBe(oldHash);
});

function fixturePlan(profile = profileA) {
  const truth = decodeTruth(JSON.stringify(publicTruthFixture()));
  const artifact = artifactFor(validSpecA, [profile]);
  const manifest = baselineManifestA;
  const eventIds = baselineEventsA.map(event => event.id).sort();
  const evidenceIds: string[] = [];
  const streams = [...manifest.streams].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
    .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash }));
  const files = [...manifest.files].sort((a, b) => a.fileId < b.fileId ? -1 : 1).map(({ fileId, sha256 }) => ({ fileId, sha256 }));
  const snapshot = {
    id: 'snapshot:' + manifest.id, sourceRef: manifest.sourceRef, manifestId: manifest.id,
    capturedAt: manifest.asOf, eventIds, evidenceIds,
    contentHash: hashCanonical({ manifestHash: manifest.hash, streams, files, eventIds, evidenceIds }),
  };
  return { artifact, plan: buildCasePlan({ artifact, profiles: [profile], manifest }, truth, baselineEventsA, snapshot) };
}

test('full_reversal and reversal_preserves_prior_asof with original records and allocations', async () => {
  const { artifact, plan } = fixturePlan();
  const check = plan.find(entry => entry.id === 'full_reversal')!;
  const [earlier, payment, credit, replay] = check.cases.filter(test => test.kind === 'planner');
  expect([earlier.expected.balanceCents, payment.expected.balanceCents, credit.expected.balanceCents, replay.expected.balanceCents])
    .toEqual([80000, 280000, 100000, 280000]);
  expect(earlier.target.asOf < payment.target.asOf).toBe(true);
  expect(evaluateReferenceState(earlier.target).balanceCents).toBe(80000);
  expect(payment.expected.records.filter(record => record.kind !== 'reversal')).toEqual(evaluateReferenceState(payment.target).records);
  const result = await runCasePlan(artifact, [check]);
  expect(result.checks).toMatchObject([{ id: 'full_reversal', status: 'passed', cases: 8 }]);
  expect(result.difference).toBe(0);
});

test.each([['dependency_order', 4], ['schema_drift', 3], ['semantic_drift', 3]] as const)(
  '%s exercises the exact supplied artifact in the real planner',
  async (id, cases) => {
    const { artifact, plan } = fixturePlan();
    const result = await runCasePlan(artifact, plan.filter(check => check.id === id));
    expect(result.checks).toMatchObject([{ id, status: 'passed', cases }]);
    expect(result.privateResults).toMatchObject([{ id, plannerExecutions: cases, captureValidationExecutions: 0 }]);
    expect(result.difference).toBe(0);
  },
);

test('snapshot_boundary uses each stream cursor and boundary_validation_not_counted_as_planner', async () => {
  const { artifact, plan } = fixturePlan();
  const check = plan.find(entry => entry.id === 'snapshot_boundary')!;
  const result = await runCasePlan(artifact, [check]);
  expect(result.checks).toMatchObject([{ id: 'snapshot_boundary', status: 'passed', cases: 11 }]);
  expect(result.privateResults).toMatchObject([{ plannerExecutions: 3, captureValidationExecutions: 8, passed: 11, failed: 0 }]);
  expect(result.eventKinds).toEqual(['payment']);
  const planner = check.cases.filter(test => test.kind === 'planner');
  for (const { events } of planner) {
    const stream = baselineManifestA.streams.find(member => member.streamId === events[0].streamId)!;
    expect(events[0].sequence).toBe(Number(stream.resumeAfter) + 1);
  }
});

test('missing_required_case_prevents_pass before any subject launches', async () => {
  const { artifact, plan } = fixturePlan();
  const check = plan.find(entry => entry.id === 'dependency_order')!;
  check.cases.pop();
  await expect(runCasePlan(artifact, [check])).rejects.toThrow('Verification case binding failed');
});

test('reversal is unavailable if the reviewed term supplies no supported later dates', async () => {
  const profile = { ...profileA, contractTerms: profileA.contractTerms.map(term => ({ ...term, validToExclusive: '2026-09-02' })) };
  profile.hash = hashProfile(profile);
  const { artifact, plan } = fixturePlan(profile);
  const result = await runCasePlan(artifact, plan.filter(check => check.id === 'full_reversal'));
  expect(result.checks).toMatchObject([{ id: 'full_reversal', status: 'unavailable', cases: 0 }]);
  expect(result.privateResults).toMatchObject([{ plannerExecutions: 0, captureValidationExecutions: 0 }]);
});
