import { describe, expect, it, vi } from 'vitest';
import { hashArtifact, hashCanonical, type CompiledArtifact } from '@eapr/contracts';
import { baselineEventsA, baselineManifestA, emptyTargetA, profileA } from '../../../tests/fixtures/index.js';
import { runEvaluator, runSubject } from '../src/runner.js';

const subjectChild = new URL('./children/scripted-subject-transport.mjs', import.meta.url);
const evaluatorChild = new URL('./children/scripted-evaluator-transport.mjs', import.meta.url);
const hashableArtifact: Omit<CompiledArtifact, 'hash'> = {
  id: 'artifact-transport',
  sourceRef: 'legacy-a',
  specHash: hashCanonical('transport-test-spec'),
  compilerVersion: '1',
  runtimeVersion: '1',
  targetSchemaVersion: '1',
  normalizedPlan: {
    sourceRef: 'legacy-a',
    sourceContracts: [],
    capture: [],
    mappings: [],
    validators: [],
    allowedKinds: [],
    limits: { maxTransactionCents: 5_000_000, maxRecordsPerCycle: 1000 },
    runtimeModelCalls: 'forbidden',
  },
  sourceContractHashes: [],
  requiredProfileHashes: [profileA.hash],
};
const artifact = { ...hashableArtifact, hash: hashArtifact(hashableArtifact) };
const subjectInput = {
  protocolVersion: 1, requestId: 'public-input', artifact, profile: profileA,
  events: [baselineEventsA[0]], target: emptyTargetA,
};
const evaluatorInput = {
  protocolVersion: 1, jobId: 'job-transport', artifact, profiles: [profileA], manifest: baselineManifestA,
  fixtureSetId: 'public-transport', fixtureSetVersion: '1', evaluatorBuildHash: hashCanonical('transport-test-build'),
};

describe('bounded evaluator process protocol', () => {
  it.each([
    ['malformed', 'OUTPUT_INVALID'],
    ['truncated', 'OUTPUT_INVALID'],
    ['multiple', 'OUTPUT_INVALID'],
    ['extra-field', 'OUTPUT_INVALID'],
    ['invalid-outcome', 'OUTPUT_INVALID'],
    ['wrong-request-id', 'REQUEST_MISMATCH'],
    ['invalid-utf8', 'OUTPUT_INVALID'],
    ['stdout-limit', 'OUTPUT_TOO_LARGE'],
    ['stderr-limit', 'OUTPUT_TOO_LARGE'],
    ['combined-limit', 'OUTPUT_TOO_LARGE'],
    ['abnormal-exit', 'EXIT_FAILED'],
    ['timeout', 'TIMED_OUT'],
  ])('subject_protocol_fail_closed (%s)', async (requestId, code) => {
    const limits = requestId === 'timeout' ? { timeoutMs: 250 } : { maxBytes: 4096 };
    const result = await runSubject(subjectChild, { ...subjectInput, requestId }, limits);
    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain('child-stderr-redaction-sentinel');
  });

  it('subject_protocol_fail_closed (oversized and malformed stdin)', async () => {
    await expect(runSubject(subjectChild, subjectInput, { maxBytes: 32 }))
      .resolves.toEqual({ ok: false, code: 'INPUT_TOO_LARGE' });
    await expect(runSubject(subjectChild, { ...subjectInput, protocolVersion: 2 }))
      .resolves.toEqual({ ok: false, code: 'INPUT_INVALID' });
    await expect(runSubject(subjectChild, { ...subjectInput, events: [{ ...baselineEventsA[0], extra: true }] }))
      .resolves.toEqual({ ok: false, code: 'INPUT_INVALID' });
  });

  it('subject_protocol_fail_closed (limits cannot be raised)', async () => {
    const hugeEvent = { ...baselineEventsA[0], payload: { filler: 'x'.repeat(10 * 1024 * 1024) } };
    await expect(runSubject(subjectChild, { ...subjectInput, events: [hugeEvent] }, { maxBytes: 20 * 1024 * 1024 }))
      .resolves.toEqual({ ok: false, code: 'INPUT_TOO_LARGE' });
  });

  it('subject_input_excludes_truth', async () => {
    vi.stubEnv('EAPR_C1_TEST_PROVIDER_TOKEN', 'provider-token-sentinel');
    try {
      await expect(runSubject(subjectChild, subjectInput)).resolves.toEqual({
        ok: true, value: { requestId: subjectInput.requestId, outcome: { plans: [], holds: [] } },
      });
    } finally {
      vi.unstubAllEnvs();
    }
    await expect(runSubject(subjectChild, { ...subjectInput, expected: 'truth-redaction-sentinel' }))
      .resolves.toEqual({ ok: false, code: 'INPUT_INVALID' });
    await expect(runSubject(subjectChild, {
      ...subjectInput, target: { ...subjectInput.target, expected: 'truth-redaction-sentinel' },
    })).resolves.toEqual({ ok: false, code: 'INPUT_INVALID' });
  });

  it('evaluator transport accepts one strictly framed report', async () => {
    const result = await runEvaluator(evaluatorChild, evaluatorInput);
    expect(result).toMatchObject({
      ok: true,
      value: {
        id: 'report-transport-public', artifactHash: artifact.hash, profileHashes: [profileA.hash],
        manifestHash: baselineManifestA.hash, evaluatorBuildHash: evaluatorInput.evaluatorBuildHash,
        fixtureSetId: 'public-transport', eligible: false,
      },
    });
  });

  it('evaluator transport rejects extra fields and extra or truncated lines', async () => {
    await expect(runEvaluator(evaluatorChild, { ...evaluatorInput, extra: true }))
      .resolves.toEqual({ ok: false, code: 'INPUT_INVALID' });
    for (const jobId of ['missing-line', 'multiple-lines']) {
      await expect(runEvaluator(evaluatorChild, { ...evaluatorInput, jobId }))
        .resolves.toEqual({ ok: false, code: 'OUTPUT_INVALID' });
    }
  });
});
