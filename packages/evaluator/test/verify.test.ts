import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { hashCanonical, type ConnectorSpec, type VerificationReport } from '@eapr/contracts';
import { baselineA, baselineEventsA, baselineManifestA, emptyTargetA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { evaluateReferenceState } from '../src/reference-model.js';
import { mandatoryChecks, validateReport } from '../src/verify.js';
import { compareSubjectBaseline } from '../src/subject-comparison.js';

function candidate(spec: ConnectorSpec = validSpecA) {
  const result = compile(spec, [profileA]);
  if (!result.ok) throw new Error('Expected public fixture to compile');
  return result.value;
}

test('real_subject_wrong_mapping_rejected despite identical cents', async () => {
  const expected = evaluateReferenceState(baselineA);
  const target = { ...emptyTargetA, asOf: baselineA.asOf };
  expect(await compareSubjectBaseline(candidate(), profileA, baselineEventsA, target, expected)).toMatchObject({ matches: true });
  const wrong = structuredClone(validSpecA);
  const invoice = wrong.mappings.find(mapping => mapping.kind === 'invoice')!;
  invoice.fields.dueDate = { op: 'field', path: '/effective_date' };
  expect(await compareSubjectBaseline(candidate(wrong), profileA, baselineEventsA, target, expected))
    .toEqual({ matches: false, unexplainedDifferenceCents: 0 });
});

function reportFixture() {
  const artifact = candidate();
  const subject = { artifact, profiles: [profileA], manifest: baselineManifestA };
  const pin = {
    fixtureSetId: 'public-fixture', fixtureSetVersion: '1',
    evaluatorBuildHash: hashCanonical('test build'),
  };
  const report: VerificationReport = {
    id: 'report:job-test', artifactHash: artifact.hash, manifestHash: baselineManifestA.hash, profileHashes: [profileA.hash],
    harnessVersion: '1', ...pin, createdAt: '2026-11-08T00:00:00.000Z',
    eligible: true, unexplainedDifferenceCents: 0,
    checks: mandatoryChecks.map(id => ({ id, status: 'passed', cases: 1, diagnosticCodes: [] })),
    coverage: { required: [...mandatoryChecks], executed: [...mandatoryChecks], eventKinds: [...artifact.normalizedPlan.allowedKinds],
      sourceRefs: [artifact.sourceRef], profileHashes: [profileA.hash] },
  };
  return { subject, pin, report };
}

test('report_binding rejects any different job, immutable fixture version, or build hash', () => {
  const { subject, pin, report } = reportFixture();
  expect(() => validateReport('job-test', subject, pin, report)).not.toThrow();
  expect(() => validateReport('different-job', subject, pin, report)).toThrow();
  expect(() => validateReport('job-test', subject, { ...pin, fixtureSetVersion: '2' }, report)).toThrow();
  expect(() => validateReport('job-test', subject, { ...pin, evaluatorBuildHash: '0'.repeat(64) }, report)).toThrow();
});

test('mandatory_checks_required prevents forged eligibility and strips raw diagnostics', () => {
  const { subject, pin, report } = reportFixture();
  report.checks.pop();
  report.coverage.executed.pop();
  expect(() => validateReport('job-test', subject, pin, report)).toThrow();
  report.eligible = false;
  report.checks[0].diagnosticCodes.push('private-expected-value');
  const validated = validateReport('job-test', subject, pin, report);
  expect(validated.summary).toMatchObject({ eligible: false, coverageComplete: false });
  expect(JSON.stringify(validated)).not.toContain('private-expected-value');
});
