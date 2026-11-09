import { mkdir, mkdtemp, readFile, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { expect, test } from 'vitest';
import {
  DemoCandidatesResponseSchema, PreviewResponseSchema, VerificationJobSchema, VerificationReportSchema,
  FinancialReservationV1Schema, canonicalJson, hashActivationTrustPolicy, hashCanonical, type ActivationTrustPolicyEntryV1,
} from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService, readManifest } from '@eapr/sources';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { deriveFinancialCapture } from '@eapr/evaluator/financial-attestation-verify';
import { createFinancialCaptureReader, type FinancialSourceDependencies } from '../../apps/control/src/financial-capture.js';
import { createFinancialAttestationJobs } from '@eapr/evaluator/financial-attestation-jobs';
import { createVerificationPlugin } from '../../apps/control/src/routes/verification.js';
import { composeVerification, type LocalVerificationOptions } from '../../apps/control/src/verification-composition.js';
import { createLocalComposition, localSourceCatalog } from '../../apps/control/src/composition.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { assembleEvidenceVerificationInput } from '../../scripts/evidence-verification-input.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

const webOrigin = 'http://127.0.0.1:5176';

test('local reviewer verifies both registered metadata-bearing subjects with financial provenance', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-financial-composition-'));
  const visibleRoot = join(directory, 'visible');
  const truthRoot = join(directory, 'truth');
  const evidenceRoot = join(directory, 'evidence');
  const registryRoot = join(directory, 'registry');
  const roots = {
    evidencePinRoot: join(directory, 'protected-evaluator'),
    servedRoots: [visibleRoot, evidenceRoot, registryRoot],
  };
  let restart: ((override?: Partial<LocalVerificationOptions>) => Promise<FastifyInstance>) | undefined;
  let sources: FinancialSourceDependencies | undefined;
  const pinPaths = new Map<string, string>();
  const bundleHashes = new Map<string, string>();
  try {
    const system = await createTestSystem({
      modelMode: 'disabled', dbNamespace: testNamespace('fincompose'),
      async controlPluginFactory(services) {
        const store = await createEvidenceStore(evidenceRoot);
        const dependencies = { ...services, store };
        const { captures } = await loadDemo(dependencies, { visibleRoot, truthRoot });
        const service = createSourceService(dependencies, localSourceCatalog);
        sources = { dependencies, service, catalog: localSourceCatalog };
        const pins = await Promise.all(captures.map(async ({ companyId, manifestId }) => {
          const company = companyId === 'company-a' ? 'a' : 'b';
          const source = localSourceCatalog.get(companyId)!;
          const manifest = await readManifest(services.db, companyId, manifestId);
          const snapshot = await service.getSnapshot('snapshot:' + manifestId);
          const events = await service.getSnapshotRecords(snapshot.id);
          const truthJson = await readFile(join(truthRoot, 'expected-' + company + '.json'), 'utf8');
          const producerJson = await readFile(join(truthRoot, 'evidence-' + company + '.json'), 'utf8');
          const producer = decodeEvidenceProducer(producerJson);
          const evidence = await assembleEvidenceVerificationInput(
            services.db, store, { source, manifest, snapshot, events }, truthJson, producerJson, producer,
          );
          await pinProtectedEvidenceFixture(evidence, pathToFileURL(roots.evidencePinRoot + '/'));
          const pinPath = join(roots.evidencePinRoot, hashCanonical([producer.fixtureSetId, '2']) + '.json');
          pinPaths.set(companyId, pinPath);
          bundleHashes.set(companyId, JSON.parse(await readFile(pinPath, 'utf8')).bundleHash);
          return {
            companyId, manifestId, sourceRef: manifest.sourceRef, manifestHash: manifest.hash,
            fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2', purpose: 'construction' as const,
            snapshotHash: snapshot.contentHash,
          };
        }));
        const verification = { pins, registryRoot, roots, expectedMigrations: migrationIdentities(readMigrationCatalog().control) };
        const local = (override?: Partial<LocalVerificationOptions>) =>
          createLocalComposition(dependencies, { webOrigin, captures, verification: { ...verification, ...override } });
        restart = async override => {
          const app = Fastify();
          for (const plugin of (await local(override)).featurePlugins) app.register(plugin, services);
          await app.ready();
          return app;
        };
        return (await local()).featurePlugins;
      },
    });
    try {
      const session = await fetch(system.control.origin + '/api/local-session', {
        method: 'POST', headers: { origin: webOrigin, 'x-eapr-local-ui': '1', 'content-type': 'application/json' }, body: '{}',
      });
      expect(session.status).toBe(200);
      const cookie = session.headers.getSetCookie()[0]!.split(';', 1)[0]!;
      const headers = { cookie, origin: webOrigin, 'x-eapr-csrf': (await session.json()).csrfToken as string };
      const catalog = DemoCandidatesResponseSchema.parse((await system.control.request('/api/demo/candidates', { headers })).body);
      expect(catalog.verificationAvailable).toBe(true);
      expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(['company-a', 'company-b']);

      const db = system.db.control;
      const runtimeState = async () => {
        const { rows: tables } = await system.db.runtime.query<{ identifier: string }>(
          "SELECT quote_ident(tablename) AS identifier FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        );
        return Promise.all(tables.map(async ({ identifier }) => ({
          identifier,
          rows: (await system.db.runtime.query('SELECT to_jsonb(t) AS row FROM public.' + identifier + ' AS t ORDER BY to_jsonb(t)')).rows,
        })));
      };
      const runtimeTables = await runtimeState();
      const registry = createCandidateRegistry(db, registryRoot);
      const readCapture = createFinancialCaptureReader({ ...sources!, registry }).readCapture;
      for (const candidate of catalog.candidates) {
        expect(candidate.request.profiles.every(profile => profile.bootstrap)).toBe(true);
        const preview = await system.control.request('/api/connectors/preview', { method: 'POST', headers, body: candidate.request });
        expect(preview.status).toBe(200);
        const { artifact, parentWrites } = PreviewResponseSchema.parse(preview.body);
        expect(parentWrites).toBe(0);
        const path = '/api/connectors/' + candidate.request.spec.id + '/verify';
        const body = {
          artifactHash: artifact!.hash, profileHashes: candidate.request.profiles.map(profile => profile.hash),
          manifestId: candidate.snapshotId.slice('snapshot:'.length),
        };
        const post = (payload: unknown = body, authorization: Record<string, string> = headers) =>
          system.control.request(path, { method: 'POST', headers: authorization, body: payload });
        expect((await post(body, {})).status).toBe(401);
        expect((await post(body, { cookie, origin: webOrigin })).status).toBe(403);
        for (const field of ['fixtureSetId', 'evaluatorBuildHash', 'actor', 'events', 'report', 'attestation']) {
          expect((await post({ ...body, [field]: 'untrusted' })).status).toBe(400);
        }
        expect((await post({ ...body, profileHashes: [hashCanonical('foreign profile')] })).status).toBe(409);
        expect((await post({ ...body, manifestId: 'wrong-manifest' })).status).toBe(404);

        const capture = await readCapture(body);
        const pinPath = pinPaths.get(candidate.companyId)!;
        const original = join(evidenceRoot, capture.manifest.files[0]!.sha256);
        for (const pathToPark of [pinPath, original]) {
          await rename(pathToPark, pathToPark + '.parked');
          try {
            const failure = await post();
            expect(failure.status).toBe(503);
            expect(failure.body).toMatchObject({
              code: 'VERIFICATION_UNAVAILABLE', message: 'A verification dependency is unavailable', diagnostics: [],
            });
            expect(JSON.stringify(failure.body)).not.toContain(directory);
          } finally {
            await rename(pathToPark + '.parked', pathToPark);
          }
        }
        if (candidate.companyId === 'company-a') {
          const foreignPin = pinPaths.get('company-b')!;
          await rename(pinPath, pinPath + '.parked');
          await rename(foreignPin, pinPath);
          try {
            const failure = await post();
            expect(failure.status).toBe(503);
            expect(failure.body).toMatchObject({ code: 'VERIFICATION_UNAVAILABLE', diagnostics: [] });
          } finally {
            await rename(pinPath, foreignPin);
            await rename(pinPath + '.parked', pinPath);
          }
        }
        const queued = await post();
        expect(queued.status).toBe(202);
        const { jobId } = VerificationJobSchema.parse(queued.body);
        await expect.poll(async () => {
          const job = await system.control.request('/api/verification-jobs/' + jobId, { headers: { cookie } });
          return VerificationJobSchema.parse(job.body).state;
        }, { timeout: 10_000 }).toBe('completed');
        const report = VerificationReportSchema.parse((await system.db.control.query(
          'SELECT report FROM verification_reports WHERE job_id = $1', [jobId],
        )).rows[0]?.report);
        expect(report.checks).toHaveLength(13);
        expect(report.checks.every(check => check.status === 'passed' && check.cases > 0)).toBe(true);
        expect(report.eligible).toBe(true);
        expect(report.evaluatorBuildHash).toBe(await readFixedFinancialBuildHash());
        const reopened = await restart!();
        const completed = await (async () => {
          try {
            const auth = await reopened.inject({
              method: 'POST', url: '/api/local-session', headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
            });
            expect(auth.statusCode).toBe(200);
            const cookie = auth.cookies[0]!.name + '=' + auth.cookies[0]!.value;
            return await reopened.inject({ url: '/api/verification-jobs/' + jobId, headers: { cookie } });
          } finally {
            await reopened.close();
          }
        })();
        expect(completed.statusCode).toBe(200);
        expect(VerificationJobSchema.parse(completed.json()).summary).toMatchObject({ eligible: true, coverageComplete: true });
        const { rows: [stored] } = await db.query(
          'SELECT report_bytes, attestation_bytes FROM financial_verification_attestations WHERE report_id = $1', [report.id],
        );
        const { rows: [reserved] } = await db.query(
          'SELECT reservation_bytes FROM financial_verification_reservations WHERE job_id = $1', [jobId],
        );
        const reservation = FinancialReservationV1Schema.parse(JSON.parse(reserved.reservation_bytes.toString()));
        const captureBinding = deriveFinancialCapture(capture);
        expect(reservation.capture).toEqual(captureBinding);
        expect(reservation.evidencePin.bundleHash).toBe(bundleHashes.get(candidate.companyId));
        expect(reservation.evaluatorBuildHash).toBe(report.evaluatorBuildHash);
        for (const value of [directory, reservation.evidencePin.bundleHash, report.fixtureSetId, report.evaluatorBuildHash]) {
          expect(completed.body).not.toContain(value);
        }
        const profile = capture.profiles[0]!;
        const entry: ActivationTrustPolicyEntryV1 = {
          issuerId: reservation.issuerId, artifactHash: body.artifactHash, capture: captureBinding,
          requiredProfileHashes: body.profileHashes, selectedProfileHash: profile.hash, scope: profile.scope,
          financial: {
            runnerId: reservation.runnerId, protocolVersion: reservation.protocolVersion,
            harnessVersion: reservation.harnessVersion, evidencePin: reservation.evidencePin,
            evaluatorBuildHash: reservation.evaluatorBuildHash,
          },
          bootstrapPin: {
            runnerId: 'eapr-bootstrap-1', protocolVersion: '1', evaluatorBuildHash: hashCanonical('unused evaluator'),
            subjectBuildHash: hashCanonical('unused subject'), fixtureSetId: 'test-only', fixtureSetVersion: '1',
            fixtureHash: hashCanonical('unused fixture'),
          },
        };
        const policy = { schemaVersion: '1' as const, policyId: 'composition-test-only', entries: [entry] };
        const expected = {
          artifactHash: body.artifactHash, requiredProfileHashes: body.profileHashes, capture: captureBinding,
          policy: { ...policy, hash: hashActivationTrustPolicy(policy) },
        };
        const reader = createFinancialAttestationRegistry(db, createCandidateRegistry(db, registryRoot));
        const proof = await reader.readRegisteredFinancialAttestation(report.id, expected);
        expect(stored.report_bytes).toEqual(Buffer.from(canonicalJson(proof.report)));
        expect(stored.attestation_bytes).toEqual(Buffer.from(canonicalJson(proof.attestation)));
        expect(proof.report).toEqual(report);

        if (candidate.companyId !== 'company-a') continue;
        // Simulate corrupted reads at the source service boundary after real discovery capture validation.
        const sourceService = sources!.service;
        for (const service of [
          { ...sourceService, getSnapshot: async () => ({ ...capture.snapshot, capturedAt: '2026-01-01T00:00:00.000Z' }) },
          { ...sourceService, getSnapshotRecords: async () => capture.events.slice(1) },
          { ...sourceService, getSnapshotRecords: async () => [{ ...capture.events[0]!, sequence: 999 }, ...capture.events.slice(1)] },
        ]) {
          await expect(createFinancialCaptureReader({ ...sources!, registry, service }).readCapture(body))
            .rejects.toThrow('FINANCIAL_ATTESTATION_MISMATCH');
        }
        await expect(readCapture({ ...body, manifestId: 'wrong-manifest' })).rejects.toMatchObject({ statusCode: 404 });

        const launcher = createProtectedFinancialLauncher({ registry, roots });
        let captureCalls = 0;
        let probeCalls = 0;
        const jobs = createFinancialAttestationJobs({
          db, candidates: registry,
          captures: { async readCapture(input) { captureCalls++; return readCapture(input); } },
          launcher: {
            async probe(input) { probeCalls++; return launcher.probe(input); },
            launch: launcher.launch,
          },
          selectFixture: async () => ({
            fixtureSetId: report.fixtureSetId, fixtureSetVersion: '2', purpose: 'construction', snapshotHash: capture.snapshot.contentHash,
          }),
          readBuildHash: readFixedFinancialBuildHash,
        });
        const app = Fastify();
        app.register(createVerificationPlugin({
          registry, jobs,
          async authorizeVerification(request) {
            const mode = request.headers.authorization;
            const accountId = mode === 'foreign-account' ? 'foreign-account' : profile.scope.accountId;
            return {
              caller: 'task', accountId,
              task: {
                taskId: 'test-task', role: 'connector', runId: mode === 'foreign-run' ? 'foreign-run' : 'test-run',
                allowedSourceRefs: [mode === 'foreign-source' ? 'foreign-source' : capture.manifest.sourceRef],
                allowedAccountIds: [accountId],
              },
            };
          },
        }), { ...sources!.dependencies, workerClient: system.worker });
        try {
          for (const mode of ['foreign-source', 'foreign-account']) {
            expect((await app.inject({ method: 'POST', url: path, headers: { authorization: mode }, payload: body })).statusCode).toBe(403);
          }
          expect((await app.inject({ url: '/api/verification-jobs/' + jobId, headers: { authorization: 'foreign-run' } })).statusCode).toBe(403);
          expect({ captureCalls, probeCalls }).toEqual({ captureCalls: 0, probeCalls: 0 });
          // A preexisting durable budget uses the accepted three-attempt limit.
          await db.query('INSERT INTO verification_attempt_budgets VALUES ($1, $2, 2)', ['test-run', profile.scope.accountId]);
          const taskJob = await app.inject({ method: 'POST', url: path, payload: body });
          expect(taskJob.statusCode).toBe(202);
          const taskJobId = VerificationJobSchema.parse(taskJob.json()).jobId;
          expect((await app.inject({ url: '/api/verification-jobs/' + taskJobId, headers: { authorization: 'foreign-run' } })).statusCode).toBe(403);
          expect((await app.inject({ method: 'POST', url: path, payload: body })).statusCode).toBe(409);
          await jobs.drain();
          expect((await jobs.get(taskJobId)).job.state).toBe('completed');
          expect((await db.query('SELECT attempts FROM verification_attempt_budgets')).rows).toEqual([{ attempts: 3 }]);
        } finally {
          await app.close();
        }
      }
      expect(await runtimeState()).toEqual(runtimeTables);
      expect((await db.query('SELECT count(*)::int AS count FROM financial_verification_reservations')).rows).toEqual([{ count: 3 }]);
      expect((await db.query('SELECT count(*)::int AS count FROM financial_verification_attestations')).rows).toEqual([{ count: 3 }]);
      expect((await system.control.request('/api/activation', { method: 'POST', headers, body: {} })).status).toBe(404);
      for (const override of [
        { expectedMigrations: migrationIdentities(readMigrationCatalog({ throughVersion: 5 }).control) },
        { roots: { ...roots, evidencePinRoot: visibleRoot } },
        { roots: { ...roots, evidencePinRoot: join(directory, 'absent') } },
      ]) {
        const app = await restart!(override);
        try {
          const auth = await app.inject({
            method: 'POST', url: '/api/local-session', headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
          });
          const cookie = auth.cookies[0]!.name + '=' + auth.cookies[0]!.value;
          const result = await app.inject({ url: '/api/demo/candidates', headers: { cookie } });
          expect(result.json()).toMatchObject({
            verificationAvailable: false, diagnostics: [expect.objectContaining({ code: 'VERIFICATION_FIXTURE_CONFLICT' })],
          });
          expect((await app.inject({ url: '/api/verification-jobs/missing', headers: { cookie } })).statusCode).toBe(404);
        } finally {
          await app.close();
        }
      }
    } finally {
      await system.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test('the exact pre-006 ledger cannot mount financial verification', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-financial-pre006-'));
  const evidencePinRoot = join(directory, 'protected');
  const registryRoot = join(directory, 'registry');
  try {
    const store = await createEvidenceStore(join(directory, 'evidence'));
    await mkdir(evidencePinRoot, { mode: 0o700 });
    const system = await createTestSystem({
      modelMode: 'disabled', dbNamespace: testNamespace('finpre006'), migrationThroughVersion: 5,
      async controlPluginFactory(services) {
        const dependencies = { ...services, store };
        const catalog = localSourceCatalog;
        const sourceService = createSourceService(dependencies, catalog);
        const pins = [...catalog.values()].map(({ companyId, sourceRef }) => ({
          companyId, sourceRef, manifestId: 'test-manifest:' + companyId, manifestHash: hashCanonical(companyId),
          snapshotHash: hashCanonical(sourceRef), fixtureSetId: 'test-fixture:' + companyId,
          fixtureSetVersion: '2', purpose: 'construction' as const,
        }));
        await expect(composeVerification({ dependencies, catalog, service: sourceService }, {
          pins, registryRoot, roots: { evidencePinRoot, servedRoots: [registryRoot] },
          expectedMigrations: migrationIdentities(readMigrationCatalog({ throughVersion: 5 }).control),
        }, pins, async () => { throw new Error('Unexpected authorizer call'); })).rejects.toThrow('migration is unavailable');
        return [];
      },
    });
    await system.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
