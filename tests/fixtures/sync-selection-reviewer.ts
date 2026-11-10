import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import {
  LocalSessionResponseSchema, ReviewPackageSchema, bootstrapRequiredAssertions, bootstrapRequiredCases,
  canonicalJson, hashActivationTrustPolicy, type CommittedAuthorityIdentityV1, type Id, type RegisteredScopeIndexEntryV1,
} from '@eapr/contracts';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import type { createCandidateRegistry } from '@eapr/evaluator/registry';
import { readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import type { createSourceService, UploadDependencies } from '@eapr/sources';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createRegisteredScopeReader, readActivationBundle } from '@eapr/storage/activation-registry';
import { withTransaction } from '@eapr/storage/transaction';
import { composeActivationReview } from '../../apps/control/src/activation-composition.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { loadReviewSelection, type BootstrapRoots } from '../../apps/control/src/review-proof-selection.js';
import { createReviewRepository } from '../../apps/control/src/review-repository.js';
import { buildControl, createWorkerClient } from '../../apps/control/src/server.js';
import { createWorkerActivation } from '../../apps/worker/src/activation.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';

const clock = () => new Date('2026-11-09T08:00:00.000Z');
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

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

export async function openInstalledSelectionReviewer(input: {
  db: Pool;
  dependencies: UploadDependencies;
  candidates: ReturnType<typeof createCandidateRegistry>;
  service: ReturnType<typeof createSourceService>;
  registryRoot: string;
  bootstrapRoots: BootstrapRoots;
  policyPath: string;
  selectionPath: string;
  proofs: readonly SelectionProof[];
}): Promise<{
  approve(proof: SelectionProof, idempotencyKey: Id): Promise<SelectionSubject>;
  stop(): Promise<void>;
}> {
  const { db, dependencies, candidates, service, registryRoot, bootstrapRoots, policyPath, selectionPath, proofs } = input;
  const controlDb = dependencies.db;
  const sourceDependencies = { dependencies, catalog: localSourceCatalog, service };
  const policy = await loadActivationPolicy({ policyPath });
  const selection = await loadReviewSelection(selectionPath);
  assert(policy.policyId === selection.policyId, 'Installed selection and policy IDs differ');
  const entries = new Map(selection.entries.map(entry => [canonicalJson(entry), entry]));
  assert(entries.size === selection.entries.length && proofs.length > 0, 'Missing or ambiguous installed selection');
  const registered = createRegisteredScopeReader({ registryRoot });
  const scopes = await registered.readSnapshot();
  const financial = createFinancialAttestationRegistry(controlDb, candidates);
  const installed = new Map<string, SelectionProof & { member: RegisteredScopeIndexEntryV1 }>();
  const accounts = new Set<Id>();
  const sources = new Set<Id>();
  for (const { entry: suppliedEntry, report, attestation } of proofs) {
    const key = canonicalJson(suppliedEntry);
    const entry = entries.get(key);
    assert(entry, 'Proof entry was not installed for this reviewer');
    const [selected, duplicate] = policy.entries.filter(candidate => candidate.artifactHash === entry.artifactHash &&
      candidate.capture.manifestId === entry.manifestId && candidate.selectedProfileHash === entry.selectedProfileHash &&
      candidate.bootstrapPin.fixtureSetId === entry.bootstrapFixture.fixtureSetId &&
      candidate.bootstrapPin.fixtureSetVersion === entry.bootstrapFixture.fixtureSetVersion &&
      candidate.bootstrapPin.fixtureHash === entry.bootstrapFixture.fixtureHash);
    assert(selected && !duplicate, 'Proof entry does not resolve to one installed policy entry');
    const member = scopes.resolveRegisteredScope(selected.scope.accountId);
    assert(member && equal(member.entry.scope, selected.scope) && member.entry.profileHash === selected.selectedProfileHash &&
      member.entry.manifestId === selected.capture.manifestId && member.entry.manifestHash === selected.capture.manifestHash &&
      member.profile.sourceRef === selected.capture.sourceRef, 'Installed policy entry does not match the registered scope');
    assert(!accounts.has(member.entry.accountId), 'Ambiguous proof account for this reviewer');

    // The financial reader accepts any matching policy entry. Bind to this entry's issuer, pin and selected candidate.
    const selectedPolicy = { schemaVersion: policy.schemaVersion, policyId: policy.policyId, entries: [selected] };
    const proof = await financial.readRegisteredFinancialAttestation(entry.financialReportId, {
      artifactHash: selected.artifactHash, requiredProfileHashes: selected.requiredProfileHashes, capture: selected.capture,
      policy: { ...selectedPolicy, hash: hashActivationTrustPolicy(selectedPolicy) },
    });
    assert(equal(proof.report, report) && equal(proof.attestation, attestation), 'Supplied proof differs from installed proof');
    installed.set(key, { ...proof, entry, member: member.entry });
    accounts.add(member.entry.accountId);
    sources.add(member.profile.sourceRef);
  }

  const migrations = readMigrationCatalog();
  const listeners: (() => Promise<unknown>)[] = [];
  let stopped: Promise<void> | undefined;
  async function closeListeners() {
    const failures: unknown[] = [];
    for (const close of listeners.toReversed()) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Selection reviewer cleanup failed');
  }
  const stop = () => stopped ??= closeListeners();
  try {
    const serviceToken = randomBytes(32).toString('hex');
    const worker = await launchWorker({
      db, clock, serviceToken, expectedMigrations: migrationIdentities(migrations.runtime),
      featurePlugins: [composeWorkerParentReads(registryRoot)],
    }, 0);
    listeners.push(() => worker.close());
    const address = worker.server.address();
    assert(address && typeof address !== 'string', 'Worker listener has no loopback address');
    const origin = 'http://127.0.0.1:' + address.port;
    const webOrigin = 'http://127.0.0.1:5182';
    const reviewer = createLocalSessionService({
      webOrigin, reviewerId: 'sync-selection-reviewer',
      allowedSourceRefs: [...sources], allowedAccountIds: [...accounts],
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
      db, clock, policy,
      registered,
      readBundle: hash => readActivationBundle({ registryRoot }, hash), observe: service.readCurrentSemantics,
    });

    return {
      stop,
      async approve({ report, attestation, entry: suppliedEntry }, idempotencyKey) {
        const proof = installed.get(canonicalJson(suppliedEntry));
        assert(proof && equal(proof.report, report) && equal(proof.attestation, attestation),
          'Proof was not installed for this reviewer');
        const { member, entry, report: installedReport, attestation: installedAttestation } = proof;
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
          assert.deepEqual(committed.bundle.verificationReport, installedReport);
          assert.deepEqual(committed.bundle.financialAttestation, installedAttestation);
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
  } catch (error) {
    try { await stop(); } catch {
      console.error('Selection reviewer cleanup failed while preserving the original construction error');
    }
    throw error;
  }
}
