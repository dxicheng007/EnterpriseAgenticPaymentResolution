import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { canonicalJson, hashCanonical } from '@eapr/contracts';
import { baselineEventsA, baselineManifestA, emptyTargetA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import {
  BootstrapEvaluatorInputV1Schema, bootstrapMessageLimit, type BootstrapSubjectInputV1,
} from '../src/bootstrap-protocol.js';
import { exchangeBootstrapEvaluator, exchangeBootstrapSubject } from '../src/bootstrap-runner.js';

const child = new URL('./children/bootstrap-transport.mjs', import.meta.url);
const compiled = compile(validSpecA, [profileA]);
if (!compiled.ok) throw new Error('Public test input unavailable');
const artifact = compiled.value;
const fixtureHash = hashCanonical('public-test-fixture');
const publicInput = BootstrapEvaluatorInputV1Schema.parse({
  protocolVersion: 'bootstrap-1', jobId: 'normal', artifact, profiles: [profileA],
  selectedProfileHash: profileA.hash, manifest: baselineManifestA,
  snapshot: {
    id: 'snapshot:' + baselineManifestA.id, manifestId: baselineManifestA.id, sourceRef: baselineManifestA.sourceRef,
    contentHash: fixtureHash, capturedAt: baselineManifestA.asOf, evidenceIds: [],
    eventIds: baselineEventsA.map(event => event.id),
  },
  pin: {
    runnerId: 'eapr-bootstrap-1', protocolVersion: '1', fixtureSetId: 'public-fixture', fixtureSetVersion: '1',
    evaluatorBuildHash: fixtureHash, subjectBuildHash: fixtureHash, fixtureHash,
  },
  events: baselineEventsA, target: { ...emptyTargetA, asOf: baselineManifestA.asOf },
});

function run(jobId: string, sidecarRoot = 'private-sentinel', timeoutMs = 5_000, contextBytes?: Buffer) {
  const request = { ...publicInput, jobId };
  const context = {
    protocolVersion: 'bootstrap-launch-context-1', requestHash: hashCanonical(request),
    roots: { sidecarRoot, evidencePinRoot: 'private-sentinel', servedRoots: [] },
    registration: { artifactHash: artifact.hash, manifestHash: request.manifest.hash, snapshotId: request.snapshot.id,
      snapshotObjectHash: hashCanonical(request.snapshot) },
  };
  return exchangeBootstrapEvaluator(child, request, contextBytes ?? Buffer.from(canonicalJson(context)),
    { maxBytes: contextBytes ? bootstrapMessageLimit : 64 * 1024, timeoutMs });
}

test.each([
  ['wrong-job', 'REQUEST_MISMATCH'], ['wrong-request', 'REQUEST_MISMATCH'], ['wrong-protocol', 'OUTPUT_INVALID'],
  ['result-only', 'OUTPUT_INVALID'], ['extra-line', 'OUTPUT_INVALID'], ['failed-exit', 'EXIT_FAILED'],
  ['stderr-limit', 'OUTPUT_TOO_LARGE'], ['stdout-limit', 'OUTPUT_TOO_LARGE'],
])('rejects malformed bootstrap evaluator exchanges (%s)', async (mode, code) => {
  const result = await run(mode);
  expect(result).toEqual({ ok: false, code });
  expect(JSON.stringify(result).includes('private-sentinel')).toBe(false);
});

test('returns only the completion when the child emits bounded private stderr', async () => {
  const result = await run('normal');
  expect(result.ok).toBe(true);
  expect(JSON.stringify(result).includes('private-sentinel')).toBe(false);
});

test('rejects oversized private input before spawning', async () => {
  await expect(run('normal', undefined, undefined, Buffer.alloc(bootstrapMessageLimit + 1)))
    .resolves.toEqual({ ok: false, code: 'INPUT_TOO_LARGE' });
});

test('timeout terminates the evaluator process group before a descendant writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bootstrap-transport-'));
  try {
    await expect(run('timeout', dir, 1200)).resolves.toEqual({ ok: false, code: 'TIMED_OUT' });
    await expect(stat(join(dir, 'grandchild-started'))).resolves.toBeDefined();
    await setTimeout(1600);
    await expect(stat(join(dir, 'grandchild-leak'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each([
  ['normal', null], ['wrong-id', 'REQUEST_MISMATCH'], ['wrong-protocol', 'OUTPUT_INVALID'],
])('subject transport passes no private fields, environment or fd 3 (%s)', async (requestId, failure) => {
  const request: BootstrapSubjectInputV1 = {
    protocolVersion: 'bootstrap-subject-1', requestId, artifact, profile: profileA, events: baselineEventsA,
    target: emptyTargetA,
  };
  const result = await exchangeBootstrapSubject(child, request);
  expect(result.ok ? null : result.code).toBe(failure);
});
