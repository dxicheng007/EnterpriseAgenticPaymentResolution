import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import {
  LocalSessionResponseSchema, ReviewPackageSchema, VerificationCheckIdSchema, bootstrapRequiredAssertions,
  bootstrapRequiredCases, canonicalJson, hashFinancialReservation, type CommittedAuthorityIdentityV1, type Id,
} from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { createSourceService, type UploadDependencies } from '@eapr/sources';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createRegisteredScopeReader, readActivationBundle } from '@eapr/storage/activation-registry';
import { createControlDb } from '@eapr/storage/control-db';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import { composeActivationReview } from '../../apps/control/src/activation-composition.js';
import { createRegisteredScopePublication, type RegisteredScopeSelection } from '../../apps/control/src/activation-publication.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import type { BootstrapRoots, loadReviewSelection } from '../../apps/control/src/review-proof-selection.js';
import { createReviewRepository } from '../../apps/control/src/review-repository.js';
import { buildControl, createWorkerClient } from '../../apps/control/src/server.js';
import { createWorkerActivation } from '../../apps/worker/src/activation.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import type { BootstrapExpectationReview } from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest } from '../../scripts/native-db.js';
import { prepareAndPublishActivationPolicy } from '../../scripts/prepare-activation-policy.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { testNamespace } from './harness.js';

const clock = () => new Date('2026-11-09T08:00:00.000Z');
const mandatoryChecks = [...VerificationCheckIdSchema.options].sort();

export type SelectionSubject = { identity: CommittedAuthorityIdentityV1; stored: StoredActivation };
type FinancialProof = Awaited<ReturnType<ReturnType<typeof createFinancialAttestationRegistry>['complete']>>;
export type SelectionProof = {
  report: FinancialProof['report'];
  attestation: FinancialProof['attestation'];
  entry: Awaited<ReturnType<typeof loadReviewSelection>>['entries'][number];
};

function requireStatus(response: { statusCode: number; json(): unknown }, status: number, stage: string) {
  if (response.statusCode === status) return;
  const error = response.json() as { code?: unknown };
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'UNKNOWN';
  throw new Error(stage + ' returned HTTP ' + response.statusCode + ' (' + code + ')');
}

async function closeAll(actions: readonly (() => Promise<unknown>)[]) {
  const failures: unknown[] = [];
  for (const action of actions.toReversed()) {
    try { await action(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Selection fixture cleanup failed');
}

export async function createSelectionEnrollment(): Promise<{
  db: Pool;
  root: string;
  roots: { visibleRoot: string; truthRoot: string };
  dependencies: UploadDependencies;
  service: ReturnType<typeof createSourceService>;
  candidates: ReturnType<typeof createCandidateRegistry>;
  bootstrapRoots: BootstrapRoots;
  prove(input: {
    selection: RegisteredScopeSelection;
    jobId: Id;
    review: Omit<BootstrapExpectationReview, 'evidencePin'>;
  }): Promise<SelectionProof>;
  openReviewer(input: {
    policyId: Id;
    proofs: readonly SelectionProof[];
  }): Promise<{
    approve(proof: SelectionProof, idempotencyKey: Id): Promise<SelectionSubject>;
    stop(): Promise<void>;
  }>;
  close(): Promise<void>;
}> {
  const cleanup: (() => Promise<unknown>)[] = [];
  let closed: Promise<void> | undefined;
  const close = () => closed ??= closeAll(cleanup);

  try {
    const namespace = testNamespace('selpeers');
    const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-sync-selection-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const pair = await provisionTest(namespace);
    cleanup.push(() => dropTest(namespace));
    const controlDb = createControlDb({ connectionString: pair.control.appUrl });
    cleanup.push(() => controlDb.end());
    const db = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    cleanup.push(() => db.end());
    const migrations = readMigrationCatalog();
    await migrate(pair, migrationStreams, migrations);
    const roots = { visibleRoot: join(root, 'visible'), truthRoot: join(root, 'truth') };
    const registryRoot = join(root, 'registry');
    const storeRoot = join(root, 'originals');
    const bootstrapRoots: BootstrapRoots = {
      sidecarRoot: join(root, 'bootstrap'), evidencePinRoot: join(root, 'evaluator'),
      servedRoots: [roots.visibleRoot, storeRoot, registryRoot],
    };
    const dependencies = { db: controlDb, clock, store: await createEvidenceStore(storeRoot) };
    const service = createSourceService(dependencies, localSourceCatalog);
    const candidates = createCandidateRegistry(controlDb, registryRoot);
    const sourceDependencies = { dependencies, catalog: localSourceCatalog, service };
    const captureReader = createFinancialCaptureReader({ ...sourceDependencies, registry: candidates });
    const financialRegistry = createFinancialAttestationRegistry(controlDb, candidates);
    const launcher = createProtectedFinancialLauncher({
      registry: candidates, roots: { evidencePinRoot: bootstrapRoots.evidencePinRoot, servedRoots: bootstrapRoots.servedRoots },
    });
    let buildHash: Promise<string> | undefined;
    let reviewerOpened = false;

    return {
      db, root, roots, dependencies, service, candidates, bootstrapRoots, close,
      async prove({ selection, jobId, review }) {
        const evaluatorBuildHash = await (buildHash ??= readFixedFinancialBuildHash());
        const capture = await captureReader.readCapture(selection);
        const probe = await launcher.probe({
          protocolVersion: 'financial-attestation-probe-1', jobId, capture, evaluatorBuildHash,
          selection: {
            fixtureSetId: review.fixtureSetId, fixtureSetVersion: '2', purpose: 'construction',
            snapshotHash: capture.snapshot.contentHash,
          },
        });
        const pin = await prepareBootstrapVerification(candidates, service, {
          ...selection, review: { ...review, evidencePin: probe.evidencePin },
        }, bootstrapRoots);
        const { artifact } = capture;
        const reservation = {
          schemaVersion: '1', jobId, issuerId: 'eapr-control-registry-1', runnerId: 'eapr-financial-1',
          protocolVersion: '1', harnessVersion: '1', purpose: 'construction', evaluatorBuildHash,
          artifactHash: artifact.hash, requiredProfileHashes: artifact.requiredProfileHashes,
          capture: probe.capture, evidencePin: probe.evidencePin,
        } as const;
        await financialRegistry.reserve({
          protocolVersion: 'financial-attestation-1', jobId, capture,
          reservation: { ...reservation, hash: hashFinancialReservation(reservation) },
        });
        const request = await financialRegistry.start(jobId);
        const { report, attestation } = await financialRegistry.complete(jobId, await launcher.launch(request));
        const gaps = report.checks.filter(check => check.status !== 'passed' || check.cases === 0)
          .map(({ id, status, cases }) => id + '=' + status + '(' + cases + ')');
        assert(report.eligible && report.unexplainedDifferenceCents === 0 && gaps.length === 0,
          'Financial proof failed for ' + jobId + ' (' + report.id + '): ' + gaps.join(', '));
        assert.deepEqual(report.coverage.required.toSorted(), mandatoryChecks);
        assert.deepEqual(report.coverage.executed.toSorted(), mandatoryChecks);
        return {
          report, attestation, entry: {
            ...selection, financialReportId: report.id,
            bootstrapFixture: { fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, fixtureHash: pin.hash },
          },
        };
      },
      async openReviewer({ policyId, proofs }) {
        assert(!reviewerOpened, 'Selection fixture reviewer already opened');
        reviewerOpened = true;
        const entries = proofs.map(proof => proof.entry);
        const index = await createRegisteredScopePublication({ registryRoot, candidates }).publishRegisteredScopes(entries);
        assert.equal(index.entries.length, entries.length, 'Unexpected registered scope count');
        const members = new Map(entries.map(entry => {
          const member = index.entries.find(item => item.profileHash === entry.selectedProfileHash &&
            item.manifestId === entry.manifestId);
          assert(member, 'Selected profile is missing from the registered scope index');
          return [canonicalJson(entry), member] as const;
        }));
        const selection = { policyId, entries };
        const policyRoot = join(root, 'policy');
        await prepareAndPublishActivationPolicy({
          candidates, captureReader, financialRegistry, bootstrapRoots,
          readFinancialBuildHash: readFixedFinancialBuildHash, readBootstrapBuildPins: readFixedBootstrapBuildPins,
        }, selection, { policyRoot, install: true });
        const policyPath = join(policyRoot, 'current.json');
        const selectionPath = join(root, 'selection.json');
        await writeFile(selectionPath, canonicalJson(selection), { flag: 'wx', mode: 0o600 });

        const serviceToken = randomBytes(32).toString('hex');
        const worker = await launchWorker({
          db, clock, serviceToken, expectedMigrations: migrationIdentities(migrations.runtime),
          featurePlugins: [composeWorkerParentReads(registryRoot)],
        }, 0);
        const listeners = [() => worker.close()];
        let stopped: Promise<void> | undefined;
        const stop = () => stopped ??= closeAll(listeners);
        cleanup.push(stop);
        const address = worker.server.address();
        assert(address && typeof address !== 'string', 'Worker listener has no loopback address');
        const origin = 'http://127.0.0.1:' + address.port;
        const webOrigin = 'http://127.0.0.1:5182';
        const reviewer = createLocalSessionService({
          webOrigin, reviewerId: 'sync-selection-reviewer', allowedSourceRefs: ['legacy-a'],
          allowedAccountIds: [...members.values()].map(member => member.accountId),
        });
        const review = await composeActivationReview(sourceDependencies, {
          registryRoot, policyPath, selectionPath, bootstrapRoots, candidates, observe: service.readCurrentSemantics,
          parent: createParentReadClient(origin, serviceToken, registryRoot), authorize: reviewer.authorizeReviewer,
        });
        const app = buildControl({
          db: controlDb, clock, expectedMigrations: migrationIdentities(migrations.control),
          workerClient: createWorkerClient(origin, serviceToken), featurePlugins: [reviewer.plugin, ...review],
        });
        listeners.push(() => app.close());
        const session = await app.inject({
          method: 'POST', url: '/api/local-session', headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
        });
        requireStatus(session, 200, 'Reviewer session');
        const [cookie] = session.cookies;
        assert(cookie, 'Missing reviewer session cookie');
        const headers = {
          origin: webOrigin, cookie: cookie.name + '=' + cookie.value,
          'x-eapr-csrf': LocalSessionResponseSchema.parse(session.json()).csrfToken,
        };
        const repository = createReviewRepository(controlDb, clock);
        const activation = createWorkerActivation({
          db, clock, policy: await loadActivationPolicy({ policyPath }),
          registered: createRegisteredScopeReader({ registryRoot }),
          readBundle: hash => readActivationBundle({ registryRoot }, hash), observe: service.readCurrentSemantics,
        });

        return {
          stop,
          async approve({ report, attestation, entry }, idempotencyKey) {
            const member = members.get(canonicalJson(entry));
            assert(member, 'Proof entry was not installed for this reviewer');
            const { scope } = member;
            const url = '/api/review/' + scope.accountId;
            const prepared = await app.inject({ method: 'POST', url: url + '/prepare', headers, payload: {} });
            requireStatus(prepared, 200, 'Reviewer preparation for ' + scope.accountId);
            const reviewPackage = ReviewPackageSchema.parse(prepared.json());
            assert(reviewPackage.ready, 'Review package is not ready for ' + scope.accountId);
            assert.equal(reviewPackage.artifactHash, entry.artifactHash);
            assert.equal(reviewPackage.profileHash, entry.selectedProfileHash);
            assert.equal(reviewPackage.manifestHash, member.manifestHash);
            assert.equal(reviewPackage.verificationReportId, entry.financialReportId);
            assert.deepEqual(reviewPackage.scope, scope);
            const approved = await app.inject({
              method: 'POST', url: url + '/activate', headers, payload: {
                reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash,
                expectedArtifactHash: reviewPackage.artifactHash, expectedProfileHash: reviewPackage.profileHash,
                expectedTargetVersion: reviewPackage.expectedTargetVersion, idempotencyKey,
              },
            });
            requireStatus(approved, 202, 'Reviewer activation for ' + scope.accountId);
            const intent = await repository.readIntentByKey(idempotencyKey);
            assert(intent, 'Missing committed reviewer intent for ' + scope.accountId);
            const { receipt, replayed } = await activation.activate({
              idempotencyKey: intent.request.idempotencyKey, bundleHash: intent.bundleHash,
            });
            assert.equal(replayed, false);
            const stored = await withTransaction(db, async client => {
              const committed = await readStoredActivation(client, scope);
              const target = await readStoredTarget(client, scope);
              assert(committed && target, 'Missing A5 readback for ' + scope.accountId);
              assert.deepEqual(committed.receipt, receipt);
              assert.deepEqual(target, committed.approvedTarget);
              assert.deepEqual(committed.bundle.verificationReport, report);
              assert.deepEqual(committed.bundle.financialAttestation, attestation);
              return committed;
            });
            const bootstrap = stored.bundle.bootstrapVerification;
            assert(bootstrap.passed, 'Bootstrap proof failed for ' + scope.accountId);
            assert.deepEqual(bootstrap.cases.map(item => item.id), [...bootstrapRequiredCases]);
            assert.deepEqual(bootstrap.assertions.map(item => item.id), [...bootstrapRequiredAssertions]);
            assert(bootstrap.cases.every(item => item.status === 'passed') &&
              bootstrap.assertions.every(item => item.status === 'passed'));
            assert.equal(bootstrap.binding.profileHash, entry.selectedProfileHash);
            assert.equal(bootstrap.pin.fixtureSetId, entry.bootstrapFixture.fixtureSetId);
            assert.equal(bootstrap.pin.fixtureSetVersion, entry.bootstrapFixture.fixtureSetVersion);
            assert.equal(bootstrap.pin.fixtureHash, entry.bootstrapFixture.fixtureHash);
            assert.equal(bootstrap.planHash, stored.plan.hash);
            return { identity: { scope, activationId: receipt.activationId, bundleHash: intent.bundleHash }, stored };
          },
        };
      },
    };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      try {
        if (!(error instanceof Error) || !Reflect.defineProperty(error, 'cleanupError', { value: cleanupError })) {
          console.error('Selection fixture cleanup failed while preserving the original construction error');
        }
      } catch {
        console.error('Selection fixture cleanup failed while preserving the original construction error');
      }
    }
    throw error;
  }
}
