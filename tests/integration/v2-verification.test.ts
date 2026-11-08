import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { createPreviewPlugin } from '../../apps/control/src/routes/preview.js';
import { createVerificationPlugin } from '../../apps/control/src/routes/verification.js';
import { createProtectedVerificationLauncher } from '../../packages/evaluator/src/verify.js';
import { pinProtectedFixture } from '../../packages/evaluator/src/fixture-store.js';
import { publicTruthFixture } from '../../packages/evaluator/test/public-truth-fixture.js';
import { canonicalJson, hashBytes, hashCanonical, hashManifest, type PreviewResponse, type VerificationJob } from '@eapr/contracts';
import { createCandidateRegistry, createVerificationJobs } from '../../packages/evaluator/src/registry.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import { baselineEventsA, baselineManifestA, emailFixturesA, emptyTargetA, profileA, validSpecA } from '../fixtures/index.js';

test('registry_immutable_republish, registry_hash_binding, registry_same_id_conflict, registry_parallel_republish', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eapr-candidate-'));
  const system = await createTestSystem({ modelMode: 'disabled', dbNamespace: testNamespace('verification') });
  try {
    const spec = validSpecA;
    const result = compile(spec, [profileA]);
    if (!result.ok) throw new Error('Public fixture must compile');
    const manifest = baselineManifestA;
    const eventIds = baselineEventsA.map(event => event.id).sort();
    const evidenceIds: string[] = [];
    const snapshot = {
      id: 'snapshot:' + manifest.id, sourceRef: manifest.sourceRef, manifestId: manifest.id,
      capturedAt: manifest.asOf, eventIds, evidenceIds,
      contentHash: hashCanonical({
        manifestHash: manifest.hash,
        streams: [...manifest.streams].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
          .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash })),
        files: [...manifest.files].sort((a, b) => a.fileId < b.fileId ? -1 : 1)
          .map(({ fileId, sha256 }) => ({ fileId, sha256 })),
        eventIds, evidenceIds,
      }),
    };
    const registration = { spec, artifact: result.value, manifest, snapshot, profiles: [profileA] };
    const registry = createCandidateRegistry(system.db.control, root);
    const orphan = Buffer.from(canonicalJson(result.value));
    const orphanPath = join(root, hashBytes(orphan));
    await writeFile(orphanPath, orphan, { mode: 0o400 });
    await expect(registry.getArtifact(result.value.hash)).rejects.toMatchObject({ statusCode: 404 });
    let release!: () => void;
    const start = new Promise<void>(resolve => { release = resolve; });
    const writers = Array.from({ length: 4 }, async () => {
      await start;
      await registry.registerCandidate(registration);
    });
    release();
    await Promise.all(writers);
    const restarted = createCandidateRegistry(system.db.control, root);
    expect(await restarted.getArtifact(result.value.hash)).toEqual({ artifact: result.value, spec });
    expect(await restarted.getProfile(profileA.hash)).toEqual(profileA);
    expect(await restarted.getManifest(manifest.id)).toEqual(manifest);
    await expect(registry.registerCandidate({ ...registration, artifact: { ...result.value, id: 'forged' } })).rejects.toThrow();
    const changed = { ...manifest, asOf: '2026-01-01T00:00:00.000Z' };
    changed.hash = hashManifest(changed);
    const conflictingSnapshot = { ...snapshot, capturedAt: changed.asOf, contentHash: hashCanonical({
      manifestHash: changed.hash,
      streams: [...changed.streams].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
        .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash })),
      files: [...changed.files].sort((a, b) => a.fileId < b.fileId ? -1 : 1)
        .map(({ fileId, sha256 }) => ({ fileId, sha256 })),
      eventIds, evidenceIds,
    }) };
    await expect(registry.registerCandidate({ ...registration, manifest: changed, snapshot: conflictingSnapshot })).rejects.toThrow();
    expect(await restarted.getManifest(manifest.id)).toEqual(manifest);
    await expect(system.db.control.query('UPDATE artifact_objects SET identity = identity')).rejects.toMatchObject({ code: '42501' });
    await rm(orphanPath);
    await writeFile(orphanPath, '{}');
    await expect(restarted.getArtifact(result.value.hash)).rejects.toMatchObject({ statusCode: 409 });
  } finally {
    await system.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('verification_route_scope, verification_job_scope, forged_report_rejected, verification_async_failure_redacted, attempt_budget_reserved_atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eapr-verification-'));
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const context = {
    taskId: 'fixture-task', role: 'connector' as const, runId: 'fixture-run',
    allowedSourceRefs: [profileA.sourceRef], allowedAccountIds: [profileA.scope.accountId],
  };
  const manifest = baselineManifestA;
  const evidence = emailFixturesA.flatMap(file => file.refs);
  const eventIds = baselineEventsA.map(event => event.id).sort();
  const evidenceIds = evidence.map(ref => ref.id).sort();
  const snapshot = {
    id: 'snapshot:' + manifest.id, sourceRef: manifest.sourceRef, manifestId: manifest.id,
    capturedAt: manifest.asOf, eventIds, evidenceIds,
    contentHash: hashCanonical({
      manifestHash: manifest.hash,
      streams: [...manifest.streams].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
        .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash })),
      files: [...manifest.files].sort((a, b) => a.fileId < b.fileId ? -1 : 1)
        .map(({ fileId, sha256 }) => ({ fileId, sha256 })),
      eventIds, evidenceIds,
    }),
  };
  const { hash: _hash, ...publicFixture } = publicTruthFixture();
  const truth = { ...publicFixture, fixtureSetId: 'public-http-' + randomUUID() };
  const truthPath = new URL('../../.local/protected-evaluator/' +
    hashCanonical([truth.fixtureSetId, truth.fixtureSetVersion]) + '.json', import.meta.url);
  const pin = await pinProtectedFixture({
    truthJson: JSON.stringify({ ...truth, hash: hashCanonical(truth) }), snapshot, manifest, events: baselineEventsA,
  });
  const protectedLauncher = createProtectedVerificationLauncher(async () => pin);
  let useRealEvaluator = false;
  const system = await createTestSystem({
    modelMode: 'disabled', dbNamespace: testNamespace('verifyroute'),
    controlPluginFactory(services) {
      const registry = createCandidateRegistry(services.db, root);
      return [
        createPreviewPlugin({
          async authorizeRead() { return { caller: 'reviewer', ...context }; },
          async readSnapshot() {
            return {
              manifest, events: baselineEventsA, snapshot, evidence,
              dossier: { companyId: manifest.companyId, manifestId: manifest.id, snapshotIds: [snapshot.id],
                evidenceIds, complete: true, missingMembers: [], diagnostics: [] },
            };
          },
          async readTarget() { return emptyTargetA; },
          registerCandidate: registry.registerCandidate,
        }),
        createVerificationPlugin({
          registry,
          jobs: createVerificationJobs(services.db, {
            resolve: protectedLauncher.resolve,
            async launch(...args) {
              if (useRealEvaluator) return protectedLauncher.launch(...args);
              await barrier;
              throw new Error('protected-expected-value /protected/path');
            },
          }),
          async authorizeVerification(request) {
            const token = request.headers.authorization;
            if (!token) throw Object.assign(new Error('private auth failure'), { statusCode: 401 });
            if (token === 'reviewer') return {
              caller: 'reviewer', reviewer: { reviewerId: 'test-reviewer', sessionId: 'test-session' }, ...context,
            };
            const task = { ...context, runId: token === 'other-run' ? 'other-run' : context.runId };
            if (token === 'wrong-source') task.allowedSourceRefs = ['wrong-source'];
            return { caller: 'task', task, accountId: profileA.scope.accountId };
          },
        }),
      ];
    },
  });
  try {
    const runtimeTables = async () => (await system.db.runtime.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    )).rows;
    const runtimeBefore = await runtimeTables();
    const ledgerBefore = await system.db.runtime.query('SELECT * FROM activity_events ORDER BY sequence');
    const preview = await system.control.request<PreviewResponse>('/api/connectors/preview', {
      method: 'POST', body: { spec: validSpecA, profiles: [profileA], asOf: manifest.asOf, snapshotId: snapshot.id },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.parentWrites).toBe(0);
    const artifact = preview.body.artifact;
    if (!artifact) throw new Error('Expected compiled public fixture');
    const path = '/api/connectors/' + validSpecA.id + '/verify';
    const body = { artifactHash: artifact.hash, profileHashes: [profileA.hash], manifestId: manifest.id };
    const headers = { authorization: 'task' };
    const post = (payload: unknown, authorization = headers) =>
      system.control.request<VerificationJob>(path, { method: 'POST', body: payload, headers: authorization });
    expect((await system.control.request(path, { method: 'POST', body })).status).toBe(401);
    expect((await post(body, { authorization: 'wrong-source' })).status).toBe(403);
    expect((await post({ ...body, report: { eligible: true } })).status).toBe(400);
    expect((await post({ ...body, fixtureSetId: 'protected' })).status).toBe(400);
    expect((await post({ ...body, profileHashes: [] })).status).toBe(409);
    const attempts = await Promise.all(Array.from({ length: 6 }, () => post(body)));
    expect(attempts.map(attempt => attempt.status).sort()).toEqual([202, 202, 202, 409, 409, 409]);
    const accepted = attempts.filter(attempt => attempt.status === 202);
    const jobId = accepted[0].body.jobId;
    const jobPath = '/api/verification-jobs/' + jobId;
    expect((await system.control.request(jobPath, { headers: { authorization: 'other-run' } })).status).toBe(403);
    expect((await system.control.request(jobPath, { headers: { authorization: 'wrong-source' } })).status).toBe(403);
    release();
    for (const attempt of accepted) {
      await expect.poll(async () => (await system.control.request<VerificationJob>(
        '/api/verification-jobs/' + attempt.body.jobId, { headers },
      )).body.state).toBe('failed');
    }
    const job = await system.control.request<VerificationJob>(jobPath, { headers });
    expect(job.body.diagnostics).toMatchObject([{ code: 'VERIFICATION_FAILED' }]);
    expect(JSON.stringify(job.body)).not.toMatch(/protected-expected-value|protected\/path/);
    expect(await runtimeTables()).toEqual(runtimeBefore);
    expect((await system.db.runtime.query('SELECT * FROM activity_events ORDER BY sequence')).rows).toEqual(ledgerBefore.rows);
    expect((await system.db.control.query('SELECT * FROM verification_reports')).rows).toHaveLength(0);
    useRealEvaluator = true;
    const reviewerHeaders = { authorization: 'reviewer' };
    const review = await post(body, reviewerHeaders);
    expect(review.status).toBe(202);
    const reviewPath = '/api/verification-jobs/' + review.body.jobId;
    expect((await system.control.request(reviewPath, { headers })).status).toBe(403);
    await expect.poll(async () =>
      (await system.control.request<VerificationJob>(reviewPath, { headers: reviewerHeaders })).body.state,
    ).toBe('completed');
    const completed = await system.control.request<VerificationJob>(reviewPath, { headers: reviewerHeaders });
    expect(completed.body.summary).toMatchObject({ eligible: false, coverageComplete: false });
    expect(completed.body.summary?.checks.find(check => check.id === 'baseline_reconcile')).toMatchObject({ status: 'passed' });
    expect(JSON.stringify(completed.body)).not.toContain(truth.fixtureSetId);
    const stored = await system.db.control.query('SELECT * FROM verification_reports WHERE job_id = $1', [review.body.jobId]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].report.eligible).toBe(false);
    await expect(system.db.control.query('UPDATE verification_reports SET report = report')).rejects.toMatchObject({ code: '42501' });
  } finally {
    release();
    await system.close();
    await rm(truthPath, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});
