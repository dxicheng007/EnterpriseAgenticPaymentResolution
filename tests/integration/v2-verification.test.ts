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
      { timeout: 12000 },
    ).toBe('completed');
    const completed = await system.control.request<VerificationJob>(reviewPath, { headers: reviewerHeaders });
    expect(completed.body.summary).toMatchObject({ eligible: false, coverageComplete: false });
    expect(completed.body.summary?.checks.find(check => check.id === 'baseline_reconcile')).toMatchObject({ status: 'passed' });
    expect(JSON.stringify(completed.body)).not.toContain(truth.fixtureSetId);
    const stored = await system.db.control.query('SELECT * FROM verification_reports WHERE job_id = $1', [review.body.jobId]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].report.eligible).toBe(false);
    expect(stored.rows[0].report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'new_record', status: 'passed', cases: 4 }),
      expect.objectContaining({ id: 'duplicate_delivery', status: 'passed', cases: 3 }),
      expect.objectContaining({ id: 'retry_restart', status: 'passed', cases: 3 }),
      expect.objectContaining({ id: 'invalid_money', status: 'passed', cases: 3 }),
      expect.objectContaining({ id: 'allocation_scope', status: 'passed', cases: 4 }),
      expect.objectContaining({ id: 'unknown_identity', status: 'passed', cases: 2 }),
    ]));
    await expect(system.db.control.query('UPDATE verification_reports SET report = report')).rejects.toMatchObject({ code: '42501' });
  } finally {
    release();
    await system.close();
    await rm(truthPath, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('generated_b_zero_is_not_f8_balance, same_candidate_f8_transposition, different_artifact_pass_not_reused', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createLocalComposition, localSourceCatalog } = await import('../../apps/control/src/composition.js');
  const { createEvidenceStore } = await import('@eapr/evidence');
  const { createSourceService, readManifest } = await import('@eapr/sources');
  const { DemoCandidatesResponseSchema, VerificationReportSchema } = await import('@eapr/contracts');
  const { loadDemo } = await import('../../scripts/load-demo.js');
  const { decodeTruth } = await import('../../packages/evaluator/src/fixtures.js');
  const { buildCasePlan, runCasePlan } = await import('../../packages/evaluator/src/cases.js');

  const origin = 'http://127.0.0.1:5176';
  const directory = await mkdtemp(join(tmpdir(), 'eapr-verification-captures-'));
  const roots = { visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'private') };
  const store = await createEvidenceStore(join(directory, 'evidence'));
  type CaptureFacts = {
    manifest: Awaited<ReturnType<typeof readManifest>>;
    events: Awaited<ReturnType<ReturnType<typeof createSourceService>['getSnapshotRecords']>>;
    truth: ReturnType<typeof decodeTruth>;
    pin: Awaited<ReturnType<typeof pinProtectedFixture>>;
  };
  const captureFacts = new Map<string, CaptureFacts>();
  const pinPaths: URL[] = [];
  try {
    const system = await createTestSystem({
      modelMode: 'disabled', dbNamespace: testNamespace('verifyactual'),
      async controlPluginFactory(services) {
        const dependencies = { ...services, store };
        const loaded = await loadDemo(dependencies, roots);
        const sources = createSourceService(dependencies, localSourceCatalog);
        for (const capture of loaded.captures) {
          const manifest = await readManifest(services.db, capture.companyId, capture.manifestId);
          const snapshot = await sources.getSnapshot('snapshot:' + capture.manifestId);
          const events = await sources.getSnapshotRecords(snapshot.id);
          const company = capture.companyId === 'company-a' ? 'a' : 'b';
          const truthJson = await readFile(join(roots.truthRoot, 'expected-' + company + '.json'), 'utf8');
          const truth = decodeTruth(truthJson);
          const pin = await pinProtectedFixture({ truthJson, snapshot, manifest, events });
          pinPaths.push(new URL('../../.local/protected-evaluator/' +
            hashCanonical([pin.fixtureSetId, pin.fixtureSetVersion]) + '.json', import.meta.url));
          captureFacts.set(capture.manifestId, { manifest, events, truth, pin });
        }
        const registry = createCandidateRegistry(services.db, join(directory, 'registry'));
        const composition = await createLocalComposition(dependencies, { webOrigin: origin, captures: loaded.captures, registry });
        const launcher = createProtectedVerificationLauncher(async candidate => {
          const facts = captureFacts.get(candidate.manifest.id);
          if (!facts || facts.manifest.hash !== candidate.manifest.hash) throw new Error('Fixture unavailable');
          return facts.pin;
        });
        return [
          ...composition.featurePlugins,
          createVerificationPlugin({
            registry, jobs: createVerificationJobs(services.db, launcher),
            async authorizeVerification(request) {
              const context = await composition.authorizeReviewer(request, { mutation: request.method === 'POST' });
              return { caller: 'reviewer', ...context };
            },
          }),
        ];
      },
    });
    try {
      const session = await fetch(system.control.origin + '/api/local-session', {
        method: 'POST', headers: { origin, 'X-EAPR-Local-UI': '1', 'Sec-Fetch-Site': 'same-origin', 'content-type': 'application/json' },
        body: '{}',
      });
      expect(session.status).toBe(200);
      const cookie = session.headers.getSetCookie()[0].split(';', 1)[0];
      const csrf = (await session.json()).csrfToken as string;
      const headers = { cookie, origin, 'x-eapr-csrf': csrf };
      const catalog = DemoCandidatesResponseSchema.parse(
        (await system.control.request('/api/demo/candidates', { headers })).body,
      );
      expect(catalog.verificationAvailable).toBe(false);
      expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(['company-a', 'company-b']);
      const runtimeBefore = await system.db.runtime.query('SELECT * FROM activity_events ORDER BY sequence');
      const subjects = await Promise.all(catalog.candidates.map(async candidate => {
        const preview = await system.control.request<PreviewResponse>('/api/connectors/preview', {
          method: 'POST', headers, body: candidate.request,
        });
        expect(preview.status).toBe(200);
        expect(preview.body.parentWrites).toBe(0);
        const artifact = preview.body.artifact!;
        const facts = [...captureFacts.values()].find(value => 'snapshot:' + value.manifest.id === candidate.snapshotId)!;
        const { manifest, events, truth, pin } = facts;
        const profiles = candidate.request.profiles;
        const plan = buildCasePlan({ artifact, profiles, manifest }, truth, events);
        const generatedBalance = candidate.companyId === 'company-a' ? 80000 : 0;
        expect(preview.body.diffs[0].afterBalanceCents).toBe(generatedBalance);
        expect(plan.find(check => check.id === 'baseline_reconcile')?.cases[0].expected.balanceCents).toBe(generatedBalance);
        const newRecords = plan.find(check => check.id === 'new_record')!.cases;
        expect(newRecords.map(probe => [probe.provenance, probe.expected.balanceCents])).toEqual([
          ['independent-F8-probe', 80000], ['independent-F8-probe', 80000], ['independent-F8-probe', 50000],
          ['captured-baseline', generatedBalance],
        ]);
        for (const check of plan) {
          for (const probe of check.cases) expect(probe.facts).toMatchObject({ artifactHash: artifact.hash, profileHash: profiles[0].hash });
        }
        if (candidate.companyId === 'company-b') {
          const unresolved = events.find(event => event.rawIdentity.sourceAccountId?.startsWith('cust-b-unknown-'))!;
          const unknown = plan.find(check => check.id === 'unknown_identity')!.cases[0];
          expect(unknown.events).toEqual([unresolved]);
          expect(unknown.holds).toEqual([{ code: 'UNKNOWN_ACCOUNT', eventIds: [unresolved.id] }]);
        }
        return { candidate, artifact, manifest, profiles, pin, plan };
      }));

      async function verify(
        subject: typeof subjects[number], connectorId = subject.candidate.request.spec.id, artifactHash = subject.artifact.hash,
      ) {
        const requested = await system.control.request<VerificationJob>('/api/connectors/' + connectorId + '/verify', {
          method: 'POST', headers, body: { artifactHash, manifestId: subject.manifest.id, profileHashes: subject.profiles.map(profile => profile.hash) },
        });
        expect(requested.status).toBe(202);
        const path = '/api/verification-jobs/' + requested.body.jobId;
        await expect.poll(async () => (await system.control.request<VerificationJob>(path, { headers })).body.state,
          { timeout: 16000 }).toBe('completed');
        const { body } = await system.control.request<VerificationJob>(path, { headers });
        expect(body.summary).toMatchObject({ eligible: false, coverageComplete: false, artifactHash });
        const text = JSON.stringify(body);
        expect(text).not.toContain(subject.pin.fixtureSetId);
        expect(text).not.toMatch(/expectedFactHash|recipeVersion|captured-baseline|independent-F8-probe|inputHash|targetHash|planner-fresh-process/);
        const { rows } = await system.db.control.query('SELECT report FROM verification_reports WHERE job_id = $1', [requested.body.jobId]);
        return VerificationReportSchema.parse(rows[0].report);
      }

      const verified = await Promise.all(subjects.map(subject => verify(subject)));
      for (const [index, report] of verified.entries()) {
        const subject = subjects[index];
        expect(report.profileHashes).toEqual(subject.profiles.map(profile => profile.hash));
        expect(report.eligible).toBe(false);
        expect(report.unexplainedDifferenceCents).toBe(0);
        expect(report.coverage.eventKinds).toEqual(['allocation', 'credit', 'invoice', 'payment']);
        expect(report.checks.map(check => [check.id, check.status, check.cases])).toEqual(subject.plan.map(check =>
          [check.id, check.cases.length ? 'passed' : 'unavailable', check.cases.length]));
        expect(report.coverage.executed).toEqual([
          'baseline_reconcile', 'new_record', 'duplicate_delivery', 'retry_restart', 'invalid_money',
          'allocation_scope', 'unknown_identity',
        ]);
        expect(report.checks.filter(check => check.status === 'passed').map(check => check.cases))
          .toEqual([1, 4, 3, 3, subject.candidate.companyId === 'company-a' ? 3 : 5, 4, 2]);
      }

      const b = subjects.find(subject => subject.candidate.companyId === 'company-b')!;
      const bad = structuredClone(b.candidate.request);
      bad.spec.id += '-bad-relationship';
      // Captured B allocates payments only. Redirecting credit allocation funding is visible in the unequal F8 probe.
      bad.spec.mappings.find(mapping => mapping.kind === 'allocation')!.fields.fundingKind = {
        op: 'enum_lookup', path: '/receipt_type', values: { payment: 'payment', credit: 'payment' },
      };
      const badPreview = await system.control.request<PreviewResponse>('/api/connectors/preview', { method: 'POST', headers, body: bad });
      expect(badPreview.status).toBe(200);
      const badArtifact = badPreview.body.artifact!;
      expect(badArtifact.hash).not.toBe(b.artifact.hash);
      const wrong = await verify(b, bad.spec.id, badArtifact.hash);
      expect(wrong.checks.find(check => check.id === 'baseline_reconcile')).toMatchObject({ status: 'passed', cases: 1 });
      expect(wrong.checks.find(check => check.id === 'new_record')).toMatchObject({ status: 'failed', cases: 4 });
      // The bad relationship blocks the connected invoice/payment/allocation group.
      // The independent 20,000 credit survives as a standalone source record.
      expect(wrong.unexplainedDifferenceCents).toBe(300000 + 200000 + 200000 + 20000);

      const wrongDate = structuredClone(b.candidate.request.spec);
      wrongDate.mappings.find(mapping => mapping.kind === 'invoice')!.fields.dueDate = { op: 'field', path: '/posted_on' };
      const dateResult = compile(wrongDate, b.profiles);
      if (!dateResult.ok) throw new Error('Expected B due-date mutation to compile');
      const facts = captureFacts.get(b.manifest.id)!;
      const wrongDatePlan = buildCasePlan({ artifact: dateResult.value, profiles: b.profiles, manifest: b.manifest }, facts.truth, facts.events);
      const wrongDateResult = await runCasePlan(dateResult.value, wrongDatePlan.filter(check => check.id === 'baseline_reconcile'));
      expect(wrongDateResult.checks).toMatchObject([{ id: 'baseline_reconcile', status: 'failed', cases: 1 }]);
      expect(wrongDateResult.difference).toBe(0);
      expect(subjects[0].profiles[0].parentCustomerId).toBe(b.profiles[0].parentCustomerId);
      expect(subjects[0].profiles[0].scope.sellerEntityId).not.toBe(b.profiles[0].scope.sellerEntityId);
      expect((await system.db.runtime.query('SELECT * FROM activity_events ORDER BY sequence')).rows).toEqual(runtimeBefore.rows);
    } finally {
      await system.close();
    }
  } finally {
    await Promise.all(pinPaths.map(path => rm(path, { force: true })));
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);
