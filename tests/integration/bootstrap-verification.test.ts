import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { BootstrapManifestSchema, CustomerProfileSchema, RawSourceEventSchema, UploadMetadataSchema, canonicalJson, hashBootstrapVerificationResult, hashBytes, hashCanonical, hashPlan, hashProfile, type TargetState } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService, prepareApiRecord, publishManifest, sourceFileId, storeSourceUpload } from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createProtectedBootstrapLauncher, readFixedBootstrapBuildPins } from '../../packages/evaluator/src/bootstrap-launcher.js';
import {
  type BootstrapExpectationReview,
} from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { exchangeBootstrapEvaluator } from '../../packages/evaluator/src/bootstrap-runner.js';
import { validateBootstrapCompletion } from '../../packages/evaluator/src/bootstrap-verify.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { createBootstrapVerificationJobs } from '@eapr/evaluator/bootstrap-jobs';
import { createBootstrapVerificationRegistry } from '@eapr/evaluator/bootstrap-registry';
import type { BootstrapEvaluatorCompletionV1, BootstrapLauncher } from '@eapr/evaluator/bootstrap-launcher';
import { createCandidateRegistry } from '../../packages/evaluator/src/registry.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { assembleEvidenceVerificationInput } from '../../scripts/evidence-verification-input.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { testNamespace } from '../fixtures/harness.js';

const asOf = '2026-10-01T00:00:00.000Z';
const pinPath = (root: string, id: string, version: string) => join(root, hashCanonical([id, version]) + '.json');
const signProfile = (profile: Parameters<typeof hashProfile>[0]) =>
  CustomerProfileSchema.parse({ ...profile, hash: hashProfile(profile) });
test('stores the fixed A/B proof and retains a distinct observed negative plan across restart', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-bootstrap-'));
  const namespace = testNamespace('bootstrap');
  try {
    await startNativeDb();
    const pair = await provisionTest(namespace);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    const restartChecks: ((pool: typeof db) => Promise<void>)[] = [];
    try {
      await migrate(pair, migrationStreams, readMigrationCatalog());
      const visibleRoot = join(directory, 'visible');
      const truthRoot = join(directory, 'protected');
      const storeRoot = join(directory, 'served-evidence');
      const registryRoot = join(directory, 'registry');
      const roots = {
        sidecarRoot: join(directory, 'protected-bootstrap'), evidencePinRoot: join(directory, 'protected-evaluator'),
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
        const v2 = JSON.parse(v2Bytes.toString('utf8'));
        const citation = evidence.citations.find(item => item.evidence.sourceId === capture.contractFileId &&
          item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1)!;
        const candidate = buildDemoCandidate({ source, capture, manifest, snapshot, events, citation });
        if (!('candidate' in candidate)) throw new Error('Designated candidate unavailable');
        const draft = candidate.candidate!.request;
        const originalProfile = draft.profiles[0]!;
        const identity = producer.identities.find(item => item.sourceAccountId === originalProfile.sourceAccountIds[0])!;
        const term = producer.contracts.find(item => item.sourceAccountId === identity.sourceAccountId)!;
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
        const review: BootstrapExpectationReview = {
          fixtureSetId: producer.fixtureSetId, fixtureSetVersion: 'bootstrap-v1',
          evidencePin: { fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2', bundleHash: v2.bundleHash },
          subjects: [{
            profileHash: profile.hash, profileId: profile.id, scope: profile.scope, identityFactId: identity.id,
            customerId: identity.buyerId, customerEvidenceRefs: [citation.evidence.id],
            terms: [{ factId: term.id, termId: profile.contractTerms[0]!.id, configurationId: 'bootstrap-config-' + company,
              evidenceRefs: [citation.evidence.id] }],
          }],
        };
        const prepare = () => prepareBootstrapVerification(registry, service, { artifactHash: artifact.hash, manifestId: manifest.id, review }, roots);
        const pin = await prepare();
        expect(await prepare()).toEqual(pin);
        const target: TargetState = {
          scope: profile.scope, asOf, version: 0, customers: [], accounts: [], billingConfigurations: [],
          invoices: [], credits: [], payments: [], allocations: [], reversals: [],
        };
        const builds = await readFixedBootstrapBuildPins();
        const runnerPin = { runnerId: 'eapr-bootstrap-1', protocolVersion: '1', ...builds,
          fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, fixtureHash: pin.hash } as const;
        const launch = createProtectedBootstrapLauncher({ registry, roots, pin: runnerPin });
        const bootstrap = createBootstrapVerificationRegistry(db, registry);
        const input = { artifactHash: artifact.hash, manifestId: manifest.id, selectedProfileHash: profile.hash, events, target };
        let completed: BootstrapEvaluatorCompletionV1 | undefined;
        const jobs = createBootstrapVerificationJobs({
          candidates: registry, registry: bootstrap, pin: runnerPin,
          launcher: { async launch(request) {
            completed = await launch.launch(request);
            return completed;
          } },
        });
        const { jobId } = await jobs.reserve({ ...input, ...{ jobId: 'caller-job' } });
        expect(jobId).not.toBe('caller-job');
        await jobs.execute(jobId);
        if (!completed?.observedBaselinePlan) throw new Error('Fixed A/B proof unavailable');
        const { result, observedBaselinePlan: plan } = completed;
        const expected = { pin: runnerPin, binding: result.binding, planHash: plan.hash };
        expect(result.passed).toBe(true);
        if (company === 'b') expect(plan.expectedBalanceCents).toBe(0);
        expect(plan.hash).toBe(hashPlan(plan));
        const stored = () => db.query<{
          completion_bytes: Buffer; result_bytes: Buffer; observed_plan_bytes: Buffer; observed_plan_bytes_hash: string;
        }>('SELECT * FROM bootstrap_verification_results WHERE job_id = $1', [jobId]).then(query => query.rows[0]!);
        const original = await stored();
        expect(original.completion_bytes.toString()).toBe(canonicalJson(completed));
        expect(original.result_bytes.toString()).toBe(canonicalJson(result));
        expect(original.observed_plan_bytes.toString()).toBe(canonicalJson(plan));
        expect(hashBytes(original.observed_plan_bytes)).toBe(completed.observedBaselinePlanBytesHash);
        if (company === 'a') {
          const pending = await jobs.reserve(input);
          const read = (id: string, proof = expected) => bootstrap.readRegisteredBootstrapResult(id, proof);
          const pendingId = 'bootstrap-result:' + pending.jobId;
          await expect(read(pendingId)).rejects.toThrow('BOOTSTRAP_VERIFICATION_UNAVAILABLE');
          await bootstrap.startBootstrapVerification(pending.jobId);
          await expect(read(pendingId)).rejects.toThrow('BOOTSTRAP_VERIFICATION_UNAVAILABLE');
          await expect(bootstrap.completeBootstrapVerification(pending.jobId, completed))
            .rejects.toThrow('BOOTSTRAP_VERIFICATION_MISMATCH');
          await bootstrap.failBootstrapVerification(pending.jobId);
          await expect(read(pendingId)).rejects.toThrow('BOOTSTRAP_VERIFICATION_UNAVAILABLE');

          const stale = hashCanonical('stale');
          for (const proof of [
            { ...expected, pin: { ...runnerPin, subjectBuildHash: stale } },
            { ...expected, binding: { ...result.binding, snapshotHash: hashCanonical(snapshot) } },
            { ...expected, binding: { ...result.binding, targetSnapshotHash: stale } },
            { ...expected, binding: { ...result.binding, scope: { ...result.binding.scope, accountId: 'foreign' } } },
            { ...expected, planHash: stale },
          ]) {
            await expect(read(result.id, proof)).rejects.toThrow('BOOTSTRAP_VERIFICATION_MISMATCH');
          }

          const seal = (patch: Partial<typeof result>) => {
            const changed = { ...result, ...patch };
            return { ...changed, hash: hashBootstrapVerificationResult(changed) };
          };
          const conflicting = { ...completed, result: seal({ createdAt: '2026-10-02T00:00:00.000Z' }) };
          for (const mutant of [
            result, { ...completed, protocolVersion: 'bootstrap-1' }, { ...completed, jobId: pending.jobId },
            { ...completed, requestHash: stale }, { ...completed, observedBaselinePlan: null },
            { ...completed, observedBaselinePlanBytesHash: null }, { ...completed, observedBaselinePlanBytesHash: stale },
            { ...completed, result: { ...result, hash: stale } }, { ...completed, result: seal({ planHash: stale }) },
            { ...completed, result: seal({ binding: { ...result.binding, targetSnapshotHash: stale } }) },
          ]) {
            await expect(bootstrap.completeBootstrapVerification(jobId, mutant as BootstrapEvaluatorCompletionV1))
              .rejects.toThrow('BOOTSTRAP_VERIFICATION_MISMATCH');
          }
          await expect(bootstrap.completeBootstrapVerification(jobId, completed)).resolves.toBeUndefined();
          await expect(bootstrap.completeBootstrapVerification(jobId, conflicting))
            .rejects.toThrow('BOOTSTRAP_VERIFICATION_MISMATCH');
          expect(await stored()).toEqual(original);

          const scripted = await scriptedLauncher(directory, roots);
          const negative = await jobs.reserve(input);
          const request = await bootstrap.startBootstrapVerification(negative.jobId);
          const observed = await scripted.launch(request);
          const negativePlan = observed.observedBaselinePlan!;
          expect(observed.result.passed).toBe(false);
          expect(negativePlan.expectedBalanceCents).toBe(plan.expectedBalanceCents + 17);
          expect(negativePlan.hash).toBe(hashPlan(negativePlan));
          for (const mutant of [
            { ...observed, observedBaselinePlanBytesHash: null },
            { ...observed, requestHash: stale },
            { ...observed, jobId },
            { ...observed, result: { ...observed.result, passed: true } },
          ]) {
            await expect(bootstrap.completeBootstrapVerification(negative.jobId, mutant))
              .rejects.toThrow('BOOTSTRAP_VERIFICATION_MISMATCH');
          }

          // A transition failure must roll back the preceding insert.
          const migrator = new Client({ connectionString: pair.control.migrationUrl });
          await migrator.connect();
          try {
            await migrator.query(`
              CREATE FUNCTION reject_bootstrap_completion() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN RAISE EXCEPTION 'test interruption'; END;
              $$;
              CREATE TRIGGER interrupt_bootstrap_completion BEFORE UPDATE ON bootstrap_verification_jobs
              FOR EACH ROW WHEN (NEW.state = 'completed') EXECUTE FUNCTION reject_bootstrap_completion();
            `);
            try {
              await expect(bootstrap.completeBootstrapVerification(negative.jobId, observed)).rejects.toThrow('test interruption');
              const check = await db.query(`
                SELECT j.state, r.id FROM bootstrap_verification_jobs j
                LEFT JOIN bootstrap_verification_results r ON r.job_id = j.id WHERE j.id = $1
              `, [negative.jobId]);
              expect(check.rows).toEqual([{ state: 'running', id: null }]);
            } finally {
              await migrator.query('DROP TRIGGER interrupt_bootstrap_completion ON bootstrap_verification_jobs');
            }
          } finally {
            await migrator.end();
          }

          const changed = { ...observed.result, createdAt: '2026-10-02T00:00:00.000Z' };
          const second = { ...observed, result: { ...changed, hash: hashBootstrapVerificationResult(changed) } };
          // Hold the exact job lock while submitting both competing completions.
          const blocker = await db.connect();
          let contenders: Promise<PromiseSettledResult<void>[]> | undefined;
          try {
            await blocker.query('BEGIN');
            await blocker.query('SELECT id FROM bootstrap_verification_jobs WHERE id = $1 FOR UPDATE', [negative.jobId]);
            contenders = Promise.allSettled([
              bootstrap.completeBootstrapVerification(negative.jobId, observed),
              bootstrap.completeBootstrapVerification(negative.jobId, second),
            ]);
            await blocker.query('COMMIT');
          } finally {
            blocker.release();
          }
          const outcomes = await contenders;
          expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
          expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({
            reason: { message: 'BOOTSTRAP_VERIFICATION_MISMATCH' },
          });
          const accepted = outcomes[0]?.status === 'fulfilled' ? observed : second;
          const negativeExpected = { pin: runnerPin, binding: accepted.result.binding, planHash: negativePlan.hash };
          restartChecks.push(async restartedDb => {
            const reopened = createBootstrapVerificationRegistry(restartedDb, createCandidateRegistry(restartedDb, registryRoot));
            const persisted = await restartedDb.query(
              'SELECT * FROM bootstrap_verification_results WHERE job_id = $1', [negative.jobId],
            );
            const row = persisted.rows[0]!;
            expect(row.result_bytes.toString()).toBe(canonicalJson(accepted.result));
            expect(row.completion_bytes.toString()).toBe(canonicalJson(accepted));
            expect(row.observed_plan_bytes.toString()).toBe(canonicalJson(negativePlan));
            expect(hashPlan(JSON.parse(row.observed_plan_bytes.toString()))).toBe(negativePlan.hash);
            expect(hashBytes(row.observed_plan_bytes)).toBe(observed.observedBaselinePlanBytesHash);
            expect(row.observed_plan_bytes_hash).toBe(observed.observedBaselinePlanBytesHash);
            await expect(reopened.readRegisteredBootstrapResult(accepted.result.id, negativeExpected))
              .rejects.toThrow('BOOTSTRAP_VERIFICATION_UNAVAILABLE');
          });
        }
        restartChecks.push(async restartedDb => {
          const reopened = createBootstrapVerificationRegistry(restartedDb, createCandidateRegistry(restartedDb, registryRoot));
          const loaded = await reopened.readRegisteredBootstrapResult(result.id, expected);
          expect(canonicalJson(loaded.result)).toBe(original.result_bytes.toString());
          expect(canonicalJson(loaded.plan)).toBe(original.observed_plan_bytes.toString());
        });
        restartChecks.push(async restartedDb => {
          const unavailableReader = createBootstrapVerificationRegistry(db, createCandidateRegistry(restartedDb, registryRoot));
          await expect(unavailableReader.readRegisteredBootstrapResult(result.id, expected))
            .rejects.toThrow('BOOTSTRAP_VERIFICATION_UNAVAILABLE');
        });
      }
    } finally {
      await db.end();
      try {
        const restartedDb = createControlDb({ connectionString: pair.control.appUrl });
        try {
          for (const check of restartChecks) await check(restartedDb);
        } finally {
          await restartedDb.end();
        }
      } finally {
        await dropTest(namespace);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 240_000);

async function scriptedLauncher(
  directory: string, roots: Parameters<typeof createProtectedBootstrapLauncher>[0]['roots'],
): Promise<BootstrapLauncher> {
  // The production evaluator entrypoint remains fixed. This test-local copy
  // preserves its comparison and completion code and swaps only subject transport.
  const evaluator = new URL('../../packages/evaluator/src/bootstrap-evaluator-runner.ts', import.meta.url);
  const runner = new URL('./bootstrap-runner.ts', evaluator);
  const subject = new URL('./bootstrap-subject-runner.ts', evaluator);
  const scriptedChild = join(directory, 'scripted-subject.mts');
  const adapter = join(directory, 'scripted-adapter.mts');
  const entrypoint = pathToFileURL(join(directory, 'scripted-evaluator.mts'));
  await symlink(resolve('node_modules'), join(directory, 'node_modules'));
  const childSource = await readFile(subject, 'utf8');
  const scriptedSource = childSource
    .replace(/from '\.\/([^']+)\.js'/g, (_, name: string) => "from '" + new URL(name + '.ts', subject).href + "'")
    .replace('try {', "import { hashPlan } from '@eapr/contracts';\ntry {")
    .replace('  process.stdout.write', `
  if (requestId === 'bootstrap-subject:captured_baseline') {
    const plan = outcome.plans[0];
    const changed = { ...plan, expectedBalanceCents: plan.expectedBalanceCents + 17 };
    outcome.plans = [{ ...changed, hash: hashPlan(changed) }];
  }
  process.stdout.write`);
  await writeFile(scriptedChild, scriptedSource);
  await writeFile(adapter, `
    import { exchangeBootstrapSubject } from '${runner.href}';
    export const runBootstrapSubject = input =>
      exchangeBootstrapSubject(new URL(${JSON.stringify(pathToFileURL(scriptedChild).href)}), input);
  `);
  const source = (await readFile(evaluator, 'utf8'))
    .replace('requireBootstrapBuildPins, runBootstrapSubject', 'requireBootstrapBuildPins')
    .replace(/from '\.\/([^']+)\.js'/g, (_, name: string) => "from '" + new URL(name + '.ts', evaluator).href + "'")
    .replace('try {', "import { runBootstrapSubject } from '" + pathToFileURL(adapter).href + "';\ntry {");
  await writeFile(entrypoint, source);
  return {
    async launch(request) {
      const response = await exchangeBootstrapEvaluator(entrypoint, request, Buffer.from(canonicalJson({
        protocolVersion: 'bootstrap-launch-context-1', requestHash: hashCanonical(request), roots,
        registration: {
          artifactHash: request.artifact.hash, manifestHash: request.manifest.hash,
          snapshotId: request.snapshot.id, snapshotObjectHash: hashCanonical(request.snapshot),
        },
      })));
      if (!response.ok) throw new Error(response.code);
      return validateBootstrapCompletion(request, response.value);
    },
  };
}
