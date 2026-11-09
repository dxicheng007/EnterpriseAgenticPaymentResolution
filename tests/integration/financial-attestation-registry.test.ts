import { mkdtemp, readFile, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import {
  BootstrapManifestSchema, CustomerProfileSchema, RawSourceEventSchema, UploadMetadataSchema,
  canonicalJson, hashActivationTrustPolicy, hashCanonical, hashFinancialReport, hashFinancialReservation, hashProfile,
  type ActivationTrustPolicyEntryV1,
} from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService, prepareApiRecord, publishManifest, sourceFileId, storeSourceUpload } from '@eapr/sources';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationJobs } from '@eapr/evaluator/financial-attestation-jobs';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import type { FinancialEvaluatorInputV1, FinancialEvaluatorCompletionV1 } from '@eapr/evaluator/financial-attestation-launcher';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { createCandidateRegistry } from '../../packages/evaluator/src/registry.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../../packages/storage/src/runtime-db.js';
import { assembleEvidenceVerificationInput } from '../../scripts/evidence-verification-input.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

const asOf = '2026-10-01T00:00:00.000Z';
const pinPath = (root: string, id: string, version: string) => join(root, hashCanonical([id, version]) + '.json');
const signProfile = (profile: Parameters<typeof hashProfile>[0]) =>
  CustomerProfileSchema.parse({ ...profile, hash: hashProfile(profile) });

test('stores actual A/B financial proofs and enforces reservation, replay and restart boundaries', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-financial-'));
  const namespace = testNamespace('finregistry');
  try {
    await startNativeDb();
    const pair = await provisionTest(namespace);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    const admin = new Client({ connectionString: pair.control.migrationUrl });
    try {
      const catalog = readMigrationCatalog();
      await migrate(pair, migrationStreams, readMigrationCatalog({ throughVersion: 5 }));
      await migrate(pair, migrationStreams, catalog);
      await admin.connect();
      const runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
      try {
        await expect(runtime.query('SELECT * FROM financial_verification_attestations')).rejects.toMatchObject({ code: '42P01' });
      } finally {
        await runtime.end();
      }
      const visibleRoot = join(directory, 'visible');
      const truthRoot = join(directory, 'protected');
      const storeRoot = join(directory, 'served-evidence');
      const registryRoot = join(directory, 'registry');
      const roots = {
        evidencePinRoot: join(directory, 'protected-evaluator'),
        servedRoots: [visibleRoot, storeRoot, registryRoot],
      };
      const store = await createEvidenceStore(storeRoot);
      const dependencies = { db, store, clock: () => new Date('2026-11-08T00:00:00.000Z') };
      await generateFixtures({ seed: 'bootstrap-v1', asOf, visibleRoot, truthRoot });
      const service = createSourceService(dependencies, localSourceCatalog);
      const registry = createCandidateRegistry(db, registryRoot);
      for (const company of ['a', 'b'] as const) {
        const readVisible = (path: string) => readFile(join(visibleRoot, path));
        const json = async (path: string) => JSON.parse((await readVisible(path)).toString('utf8'));
        const manifest = BootstrapManifestSchema.parse(await json('manifest-' + company + '.json'));
        const source = localSourceCatalog.get(manifest.companyId)!;
        const uploads = await json('uploads-' + company + '.json') as { metadata: unknown; path: string }[];
        let contractFileId: string | null = null;
        for (const upload of uploads) {
          const metadata = UploadMetadataSchema.parse(upload.metadata);
          if (metadata.kind === 'contract_pdf' && contractFileId === null) contractFileId = sourceFileId(metadata);
          await storeSourceUpload(dependencies, metadata, await readVisible(upload.path));
        }
        const originals = await json('api-originals-' + company + '.json') as { eventId: string; path: string }[];
        const apiEvents = RawSourceEventSchema.array().parse(await json('api-' + company + '.json'));
        const prepared = await Promise.all(apiEvents.map(async event => prepareApiRecord(
          source, store, event, await readVisible(originals.find(item => item.eventId === event.id)!.path),
        )));
        await publishManifest(dependencies, localSourceCatalog, manifest, prepared);
        const captured = await service.captureSnapshot(manifest.id);
        if (!captured.ok || !captured.dossier.complete) throw new Error('Construction capture unavailable');
        const { snapshot } = captured;
        const capture = { companyId: manifest.companyId, manifestId: manifest.id, contractFileId };
        const events = await service.getSnapshotRecords(snapshot.id);
        const producerTruthJson = await readFile(join(truthRoot, 'expected-' + company + '.json'), 'utf8');
        const producerJson = await readFile(join(truthRoot, 'evidence-' + company + '.json'), 'utf8');
        const producer = decodeEvidenceProducer(producerJson);
        const evidence = await assembleEvidenceVerificationInput(
          db, store, { source, manifest, snapshot, events }, producerTruthJson, producerJson, producer,
        );
        await pinProtectedEvidenceFixture(evidence, new URL(roots.evidencePinRoot + '/', 'file:'));
        const existingPin = pinPath(roots.evidencePinRoot, producer.fixtureSetId, '2');
        const v2Bytes = await readFile(existingPin);
        const citation = evidence.citations.find(item => item.evidence.sourceId === capture.contractFileId &&
          item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1)!;
        const candidate = buildDemoCandidate({ source, capture, manifest, snapshot, events, citation });
        if (!('candidate' in candidate)) throw new Error('Designated candidate unavailable');
        const draft = candidate.candidate!.request;
        const originalProfile = draft.profiles[0]!;
        const profile = signProfile({
          ...originalProfile, version: originalProfile.version + 1,
          bootstrap: {
            customer: { id: originalProfile.parentCustomerId, displayName: /Legal name (.+?) Monthly fee/.exec(citation.text.value)![1]!, evidenceRefs: [citation.evidence.id] },
            billingConfigurationIds: [{ termId: originalProfile.contractTerms[0]!.id, id: 'bootstrap-config-' + company }],
          },
        });
        const spec = { ...draft.spec, version: draft.spec.version + 1 };
        const compiled = compile(spec, [profile]);
        if (!compiled.ok) throw new Error('Construction subject failed to compile');
        const artifact = compiled.value;
        await registry.registerCandidate({ spec, profiles: [profile], artifact, manifest, snapshot });
        const launcher = createProtectedFinancialLauncher({ registry, roots });
        const captureInput = { artifact, profiles: [profile], manifest, snapshot, events };
        const storage = createFinancialAttestationRegistry(db, registry);
        const selection = { fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2',
          purpose: 'construction', snapshotHash: snapshot.contentHash } as const;
        let executed: { input: FinancialEvaluatorInputV1; completion: FinancialEvaluatorCompletionV1 } | undefined;
        const options = {
          db, candidates: registry,
          captures: { readCapture: async () => captureInput },
          selectFixture: async () => selection, readBuildHash: readFixedFinancialBuildHash,
        };
        const jobs = createFinancialAttestationJobs({ ...options, launcher: {
          probe: launcher.probe,
          async launch(input) {
            const { rows: [reserved] } = await db.query(
              `SELECT r.request_bytes, j.state FROM financial_verification_reservations r
               JOIN verification_jobs j ON j.id = r.job_id WHERE r.job_id = $1`, [input.jobId],
            );
            expect(reserved.state).toBe('running');
            expect(reserved.request_bytes).toEqual(Buffer.from(canonicalJson(input)));
            const completion = await launcher.launch(input);
            executed = { input, completion };
            return completion;
          },
        } });
        const task = { runId: 'run-' + company, accountId: profile.scope.accountId };
        const accepted = await jobs.enqueue({ ...captureInput, spec }, task);
        await jobs.drain();
        expect((await jobs.get(accepted.jobId)).job.state).toBe('completed');
        if (!executed) throw new Error('Fixed evaluator did not execute');
        const { input, completion } = executed;
        const { reservation } = input;
        const { report } = completion;
        expect(report.eligible).toBe(true);
        expect(report.checks).toHaveLength(13);
        expect(report.checks.every(check => check.status === 'passed' && check.cases > 0)).toBe(true);
        expect(await readFile(existingPin)).toEqual(v2Bytes);

        const entry: ActivationTrustPolicyEntryV1 = {
          issuerId: reservation.issuerId, artifactHash: artifact.hash,
          capture: reservation.capture, requiredProfileHashes: [profile.hash], selectedProfileHash: profile.hash,
          scope: profile.scope,
          financial: { runnerId: reservation.runnerId, protocolVersion: reservation.protocolVersion,
            harnessVersion: reservation.harnessVersion, evidencePin: reservation.evidencePin,
            evaluatorBuildHash: reservation.evaluatorBuildHash },
          bootstrapPin: { runnerId: 'eapr-bootstrap-1', protocolVersion: '1',
            evaluatorBuildHash: hashCanonical('unused bootstrap evaluator'), subjectBuildHash: hashCanonical('unused bootstrap subject'),
            fixtureSetId: 'test-fixture', fixtureSetVersion: '1', fixtureHash: hashCanonical('unused bootstrap fixture') },
        };
        function policy(entries: ActivationTrustPolicyEntryV1[]) {
          const preimage = { schemaVersion: '1', policyId: 'test-policy', entries } as const;
          return { ...preimage, hash: hashActivationTrustPolicy(preimage) };
        }
        const expected = {
          artifactHash: artifact.hash, requiredProfileHashes: [profile.hash], capture: reservation.capture, policy: policy([entry]),
        };
        const restartDb = createControlDb({ connectionString: pair.control.appUrl });
        try {
          const reader = createFinancialAttestationRegistry(restartDb, createCandidateRegistry(restartDb, registryRoot));
          // Reopened persistence still resolves the original capture when the current fixture is unavailable.
          const parkedPin = existingPin + '.parked';
          await rename(existingPin, parkedPin);
          let proof;
          try {
            proof = await reader.readRegisteredFinancialAttestation(report.id, expected);
          } finally {
            await rename(parkedPin, existingPin);
          }
          expect(proof.report).toEqual(report);
          expect(proof.attestation.reportHash).toBe(hashFinancialReport(report));
          expect(await storage.complete(input.jobId, completion)).toEqual(proof);
          const { rows: [saved] } = await restartDb.query(
            'SELECT report_bytes, completion_bytes, attestation_bytes FROM financial_verification_attestations WHERE report_id = $1', [report.id],
          );
          expect(saved.report_bytes).toEqual(Buffer.from(canonicalJson(report)));
          expect(saved.completion_bytes).toEqual(Buffer.from(canonicalJson(completion)));
          expect(saved.attestation_bytes).toEqual(Buffer.from(canonicalJson(proof.attestation)));
          const mismatch = { message: 'FINANCIAL_ATTESTATION_MISMATCH', statusCode: 409 };
          const unavailable = { message: 'FINANCIAL_ATTESTATION_UNAVAILABLE', statusCode: 503 };
          await expect(storage.complete(input.jobId, { ...completion, report: { ...report, checks: [...report.checks].reverse() } }))
            .rejects.toMatchObject(mismatch);
          const wrongBuild = { ...entry, financial: { ...entry.financial, evaluatorBuildHash: hashCanonical('foreign build') } };
          const wrongScope = { ...entry, scope: { ...entry.scope, accountId: 'foreign-account' } };
          const wrongPin = { ...entry, financial: { ...entry.financial, evidencePin: {
            ...entry.financial.evidencePin, bundleHash: hashCanonical('foreign evidence'),
          } } };
          for (const altered of [
            { ...expected, policy: undefined }, { ...expected, policy: policy([]) },
            { ...expected, policy: { ...expected.policy, hash: hashCanonical('wrong policy') } },
            { ...expected, policy: policy([wrongBuild, wrongScope, wrongPin]) },
            { ...expected, capture: { ...expected.capture, eventsHash: hashCanonical('foreign events') } },
            { ...expected, requiredProfileHashes: [hashCanonical('foreign profile')] },
            { ...expected, artifactHash: hashCanonical('foreign artifact') },
          ]) await expect(reader.readRegisteredFinancialAttestation(report.id, altered as typeof expected)).rejects.toMatchObject(mismatch);
          const absentCandidate = createFinancialAttestationRegistry(restartDb, {
            async getCandidate() { throw new Error('missing immutable object'); },
          });
          await expect(absentCandidate.readRegisteredFinancialAttestation(report.id, expected)).rejects.toMatchObject(unavailable);
          if (company === 'b') continue;

          let launchCalls = 0;
          const unavailableProbe = createFinancialAttestationJobs({ ...options, launcher: {
            probe: async () => { throw new Error('PRIVATE_PROBE_FAILURE'); },
            launch: async () => { launchCalls++; throw new Error('unexpected launch'); },
          } });
          const blockedTask = { ...task, runId: 'probe-unavailable' };
          await expect(unavailableProbe.enqueue({ ...captureInput, spec }, blockedTask)).rejects.toMatchObject(unavailable);
          expect(launchCalls).toBe(0);
          expect((await db.query('SELECT id FROM verification_jobs WHERE task_run_id = $1', [blockedTask.runId])).rowCount).toBe(0);
          expect((await db.query('SELECT attempts FROM verification_attempt_budgets WHERE run_id = $1', [blockedTask.runId])).rowCount).toBe(0);

          const unavailableLaunch = createFinancialAttestationJobs({ ...options, launcher: {
            probe: launcher.probe,
            launch: async () => { launchCalls++; throw new Error('PRIVATE_LAUNCH_FAILURE'); },
          } });
          const failed = await unavailableLaunch.enqueue({ ...captureInput, spec });
          await unavailableLaunch.drain();
          expect(launchCalls).toBe(1);
          const failedJob = (await unavailableLaunch.get(failed.jobId)).job;
          expect(failedJob.state).toBe('failed');
          expect(failedJob.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['VERIFICATION_FAILED']);
          await expect(reader.readRegisteredFinancialAttestation('report:' + failed.jobId, expected)).rejects.toMatchObject(unavailable);

          await expect(db.query('UPDATE financial_verification_reservations SET capture_hash = $1 WHERE job_id = $2',
            [hashCanonical('forbidden'), input.jobId])).rejects.toMatchObject({ code: '42501' });
          await expect(db.query('DELETE FROM financial_verification_attestations WHERE job_id = $1', [input.jobId]))
            .rejects.toMatchObject({ code: '42501' });
          for (const [column, invalid] of [
            ['request_bytes', Buffer.from(canonicalJson({ ...input, capture: { ...input.capture, events: [] } }))],
            ['request_bytes', Buffer.from(canonicalJson(input) + '\n')],
            ['reservation_bytes', Buffer.from('{}')], ['capture_hash', hashCanonical('wrong capture')],
            ['snapshot_id', 'foreign-snapshot'], ['reservation_hash', hashCanonical('wrong reservation')],
          ] as const) {
            const { rows: [before] } = await admin.query('SELECT ' + column + ' FROM financial_verification_reservations WHERE job_id = $1', [input.jobId]);
            await admin.query('UPDATE financial_verification_reservations SET ' + column + ' = $1 WHERE job_id = $2', [invalid, input.jobId]);
            await expect(reader.readRegisteredFinancialAttestation(report.id, expected)).rejects.toMatchObject(mismatch);
            await admin.query('UPDATE financial_verification_reservations SET ' + column + ' = $1 WHERE job_id = $2', [before[column], input.jobId]);
          }

          const scripted = (jobId: string) => {
            const body = { ...reservation, jobId };
            const request = { ...input, jobId, reservation: { ...body, hash: hashFinancialReservation(body) } };
            const negative: FinancialEvaluatorCompletionV1 = {
              ...completion, jobId, requestHash: hashCanonical(request), reservationHash: request.reservation.hash,
              report: { ...report, id: 'report:' + jobId, eligible: false,
                checks: report.checks.map((check, index) => index === 0
                  ? { ...check, status: 'failed' as const, diagnosticCodes: ['PRIVATE_SENTINEL'] } : check).reverse() },
            };
            return { request, negative };
          };
          const legacyId = 'legacy-completed';
          const legacy = { ...report, id: 'report:' + legacyId };
          await db.query(
            `INSERT INTO verification_jobs (id, state, source_refs, account_ids, artifact_hash, manifest_id, summary)
             SELECT $1, state, source_refs, account_ids, artifact_hash, manifest_id,
                    jsonb_set(summary, '{reportId}', to_jsonb($3::text)) FROM verification_jobs WHERE id = $2`,
            [legacyId, input.jobId, legacy.id],
          );
          await db.query('INSERT INTO verification_reports VALUES ($1, $2, $3)', [legacy.id, legacyId, canonicalJson(legacy)]);
          expect((await jobs.get(legacyId)).job).toMatchObject({ state: 'completed', summary: { eligible: true } });
          await expect(reader.readRegisteredFinancialAttestation(legacy.id, expected)).rejects.toMatchObject(unavailable);

          const stalled = scripted('stalled');
          await storage.reserve(stalled.request);
          const freshJobs = createFinancialAttestationJobs({ ...options, db: restartDb, launcher: {
            probe: async () => { throw new Error('unexpected probe'); },
            launch: async () => { launchCalls++; throw new Error('unexpected launch'); },
          } });
          await freshJobs.drain();
          expect(launchCalls).toBe(1);
          expect((await freshJobs.get(stalled.request.jobId)).job.state).toBe('queued');
          await expect(storage.complete(stalled.request.jobId, stalled.negative)).rejects.toMatchObject(unavailable);
          await expect(reader.readRegisteredFinancialAttestation(stalled.negative.report.id, expected)).rejects.toMatchObject(unavailable);

          const otherAttempts = await Promise.allSettled([0, 1, 2, 3].map(index =>
            storage.reserve(scripted('budget-' + index).request, task)));
          expect(otherAttempts.filter(result => result.status === 'fulfilled')).toHaveLength(2);
          for (const outcome of otherAttempts) if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject(mismatch);
          expect((await db.query('SELECT attempts FROM verification_attempt_budgets WHERE run_id = $1', [task.runId])).rows)
            .toEqual([{ attempts: 3 }]);
          expect((await db.query(
            'SELECT COUNT(*)::int AS count FROM financial_verification_reservations WHERE job_id LIKE $1', ['budget-%'],
          )).rows).toEqual([{ count: 2 }]);

          const duplicateTask = { ...task, runId: 'atomic-reservation' };
          await expect(storage.reserve(stalled.request, duplicateTask)).rejects.toMatchObject(mismatch);
          expect((await db.query('SELECT * FROM verification_attempt_budgets WHERE run_id = $1', [duplicateTask.runId])).rowCount).toBe(0);

          const failpoint = scripted('rollback-proof');
          await storage.reserve(failpoint.request);
          await storage.start(failpoint.request.jobId);
          await admin.query(`ALTER TABLE verification_jobs ADD CONSTRAINT test_reject_completion
            CHECK (id <> 'rollback-proof' OR state <> 'completed')`);
          await expect(storage.complete(failpoint.request.jobId, failpoint.negative)).rejects.toMatchObject(unavailable);
          expect((await jobs.get(failpoint.request.jobId)).job.state).toBe('running');
          expect((await db.query('SELECT * FROM verification_reports WHERE job_id = $1', [failpoint.request.jobId])).rowCount).toBe(0);
          expect((await db.query('SELECT * FROM financial_verification_attestations WHERE job_id = $1', [failpoint.request.jobId])).rowCount).toBe(0);
          await admin.query('ALTER TABLE verification_jobs DROP CONSTRAINT test_reject_completion');
          const result = await storage.complete(failpoint.request.jobId, failpoint.negative);
          const { rows: [negativeRow] } = await db.query(
            'SELECT report_bytes, completion_bytes FROM financial_verification_attestations WHERE job_id = $1', [failpoint.request.jobId],
          );
          expect(negativeRow.report_bytes).toEqual(Buffer.from(canonicalJson(result.report)));
          expect(negativeRow.completion_bytes.toString()).not.toContain('PRIVATE_SENTINEL');
          expect(result.report.checks.at(-1)?.diagnosticCodes).toEqual(['CHECK_FAILED']);
          expect(result.report.checks.map(check => check.id)).toEqual([...report.checks].reverse().map(check => check.id));
          await expect(reader.readRegisteredFinancialAttestation(result.report.id, expected)).rejects.toMatchObject(unavailable);

          for (const winner of ['complete', 'fail'] as const) {
            const race = scripted('race-' + winner);
            await storage.reserve(race.request);
            await storage.start(race.request.jobId);
            await admin.query('BEGIN');
            try {
              await admin.query('SELECT id FROM verification_jobs WHERE id = $1 FOR UPDATE', [race.request.jobId]);
              const complete = () => storage.complete(race.request.jobId, race.negative);
              const fail = () => storage.fail(race.request.jobId);
              // Both operations queue behind the same row lock in observed order.
              const waitForBlocked = async (count: number) => {
                await expect.poll(async () => Number((await db.query(
                  `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
                    AND wait_event_type = 'Lock' AND query LIKE '%verification_jobs%'`,
                )).rows[0].count), { timeout: 5000 }).toBe(count);
              };
              const start = (action: () => Promise<unknown>) => action().then(() => null, error => error);
              const first = start(winner === 'complete' ? complete : fail);
              await waitForBlocked(1);
              const second = start(winner === 'complete' ? fail : complete);
              await waitForBlocked(2);
              await admin.query('COMMIT');
              expect(await first).toBeNull();
              if (winner === 'complete') expect(await second).toBeNull();
              else expect(await second).toMatchObject(unavailable);
              expect((await jobs.get(race.request.jobId)).job.state).toBe(winner === 'complete' ? 'completed' : 'failed');
            } finally {
              await admin.query('ROLLBACK');
            }
          }
        } finally {
          await restartDb.end();
        }
      }
    } finally {
      await admin.end();
      await db.end();
    }
  } finally {
    await dropTest(namespace);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
