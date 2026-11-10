/**
 * V5 harness: post-activation capture and authority admission against real
 * apps/worker sync surfaces. Does not invent packages/runtime apply/run-cycle;
 * monetary application and joint G5 remain Platform-blocked / pending.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  LocalSessionResponseSchema, ReviewPackageSchema, type BootstrapManifest, type CommittedCaptureIdentityV1,
  type RawSourceEvent,
} from '@eapr/contracts';
import { planBatch } from '@eapr/compiler/plan-batch';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { createSourceService } from '@eapr/sources';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { readActivationBundle } from '@eapr/storage/activation-registry';
import { createControlDb } from '@eapr/storage/control-db';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import { composeActivationReview } from '../../apps/control/src/activation-composition.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { createReviewRepository } from '../../apps/control/src/review-repository.js';
import { buildControl, createWorkerClient } from '../../apps/control/src/server.js';
import { createWorkerActivation } from '../../apps/worker/src/activation.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { selectedProfile } from '../../apps/worker/src/activation-validation.js';
import { createSyncApplier } from '../../apps/worker/src/sync/apply.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import {
  createCurrentAuthority, type AuthorityAdmissionGrants,
} from '../../apps/worker/src/sync/current-authority.js';
import { AuthorityError } from '../../apps/worker/src/sync/current-authority-errors.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { issueActivationProofs, verifyOriginals } from '../fixtures/activation-proof.js';
import { createSyncApplyFixture, syncApplyClock, syncApplyInstant } from '../fixtures/sync-apply.js';
import { testNamespace } from '../fixtures/harness.js';
import {
  assertModelCredentialsAbsent, createModelCallTrap, scrubModelCredentials,
} from '../fixtures/v5-ai-off.js';

const namespace = testNamespace('v5sync');
const approvedAt = '2026-11-09T08:00:00.000Z';
const clock = () => new Date(approvedAt);
const webOrigin = 'http://127.0.0.1:5183';
const serviceToken = 'v5-sync-worker';
const operatorToken = 'v5-sync-operator';
const request = Object.freeze({});
const reviewer = { reviewerId: 'v5-sync-reviewer', sessionId: 'v5-sync-session' };

type Proofs = Awaited<ReturnType<typeof issueActivationProofs>>;
type Committed = { identity: CommittedCaptureIdentityV1; manifest: BootstrapManifest; events: RawSourceEvent[] };

let pair: Awaited<ReturnType<typeof provisionTest>>;
let root: string;
let runtime: Pool;
let control: Pool;
let proofs: Proofs;
let source: ReturnType<typeof createSourceService>;
let operator: ReturnType<typeof createScenarioAdmin>;
let committed: Committed;
let trap = createModelCallTrap();

beforeAll(async () => {
  scrubModelCredentials();
  assertModelCredentialsAbsent();
  root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-v5-sync-'));
  await startNativeDb();
  pair = await provisionTest(namespace);
  runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  control = createControlDb({ connectionString: pair.control.appUrl });
  await migrate(pair, migrationStreams, readMigrationCatalog());
  proofs = await issueActivationProofs(root, control);
  source = createSourceService(proofs.dependencies, localSourceCatalog);
  operator = createScenarioAdmin(proofs.dependencies, {
    DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operatorToken,
  });
  committed = await activateOne(runtime, proofs, proofs.a, 'v5-sync-approve-a');
}, 120_000);

afterAll(async () => {
  await Promise.all([runtime?.end(), control?.end()]);
  if (pair) await dropTest(namespace);
  if (root) await rm(root, { recursive: true, force: true });
});

async function activateOne(
  db: Pool, context: Proofs, subject: Proofs['a'], key: string,
): Promise<Committed> {
  const migrations = readMigrationCatalog();
  const worker = await launchWorker({
    db, serviceToken, clock, expectedMigrations: migrationIdentities(migrations.runtime),
    featurePlugins: [composeWorkerParentReads(context.registryRoot)],
  }, 0);
  try {
    const address = worker.server.address();
    if (!address || typeof address === 'string') throw new Error('No worker listener');
    const origin = 'http://127.0.0.1:' + address.port;
    const workerActivation = createWorkerActivation({
      db, clock, registered: context.scopeReader, policy: await loadActivationPolicy(context),
      readBundle: hash => readActivationBundle({ registryRoot: context.registryRoot }, hash),
      observe: source.readCurrentSemantics,
    });
    const repository = createReviewRepository(context.dependencies.db, clock);
    const sessionService = createLocalSessionService({
      webOrigin, reviewerId: reviewer.reviewerId,
      allowedSourceRefs: [...localSourceCatalog.values()].map(entry => entry.sourceRef),
      allowedAccountIds: [subject.accountId],
    });
    const review = await composeActivationReview({
      dependencies: context.dependencies, catalog: localSourceCatalog, service: source,
    }, {
      registryRoot: context.registryRoot, policyPath: context.policyPath, selectionPath: context.selectionPath,
      bootstrapRoots: context.bootstrapRoots, candidates: context.candidates,
      observe: source.readCurrentSemantics,
      parent: createParentReadClient(origin, serviceToken, context.registryRoot),
      authorize: sessionService.authorizeReviewer,
    });
    const app = buildControl({
      db: context.dependencies.db, clock, expectedMigrations: migrationIdentities(migrations.control),
      workerClient: createWorkerClient(origin, serviceToken),
      featurePlugins: [sessionService.plugin, ...review],
    });
    try {
      const session = await app.inject({
        method: 'POST', url: '/api/local-session',
        headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
      });
      expect(session.statusCode).toBe(200);
      const cookie = session.cookies[0]!;
      const headers = {
        origin: webOrigin, cookie: cookie.name + '=' + cookie.value,
        'x-eapr-csrf': LocalSessionResponseSchema.parse(session.json()).csrfToken,
      };
      const url = '/api/review/' + subject.accountId;
      const prepared = await app.inject({ method: 'POST', url: url + '/prepare', headers, payload: {} });
      expect(prepared.statusCode, prepared.body).toBe(200);
      const reviewPackage = ReviewPackageSchema.parse(prepared.json());
      const approved = await app.inject({
        method: 'POST', url: url + '/activate', headers, payload: {
          reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash,
          expectedArtifactHash: reviewPackage.artifactHash, expectedProfileHash: reviewPackage.profileHash,
          expectedTargetVersion: reviewPackage.expectedTargetVersion, idempotencyKey: key,
        },
      });
      expect(approved.statusCode, approved.body).toBe(202);
      const intent = await repository.readIntentByKey(key);
      if (!intent) throw new Error('No committed review intent');
      const { receipt } = await workerActivation.activate({ idempotencyKey: key, bundleHash: intent.bundleHash });
      const stored = await withTransaction(db, client => readStoredActivation(client, receipt.scope));
      if (!stored) throw new Error('No A5 activation');
      verifyOriginals(stored.approvedTarget.records, 'a');
      expect(stored.bundle.artifact.normalizedPlan.runtimeModelCalls).toBe('forbidden');
      return {
        identity: { scope: receipt.scope, activationId: receipt.activationId, bundleHash: intent.bundleHash },
        manifest: stored.bundle.manifest, events: stored.bundle.bootstrapEvents,
      };
    } finally {
      await app.close();
    }
  } finally {
    await worker.close();
  }
}

function grants(overrides: Partial<AuthorityAdmissionGrants> = {}): AuthorityAdmissionGrants {
  return {
    reviewer, allowedAccountIds: [committed.identity.scope.accountId],
    allowedSourceRefs: [committed.manifest.sourceRef], ...overrides,
  };
}

async function parentFinancialFingerprint() {
  const tables = [
    'parent_financial_records', 'parent_targets', 'parent_snapshots',
    'runtime_economic_outcomes', 'runtime_delivery_outcomes', 'runtime_import_lineage',
    'runtime_sync_receipts', 'runtime_sync_economic_outcomes', 'runtime_sync_delivery_outcomes',
  ];
  return Object.fromEntries(await Promise.all(tables.map(async table => [
    table, (await runtime.query('SELECT to_jsonb(t)::text AS row FROM ' + table + ' t ORDER BY to_jsonb(t)::text')).rows,
  ])));
}

test('admits standing authority for the activated customer and denies unknown accounts', async () => {
  assertModelCredentialsAbsent();
  expect(trap.attempts).toBe(0);
  const observe = async (sourceRef: string) => {
    // Authority reads must not invoke model providers; trap stays at zero for this path.
    expect(typeof sourceRef).toBe('string');
    return source.readCurrentSemantics(sourceRef);
  };
  const admitted = createCurrentAuthority<object>({
    db: runtime, clock, observe,
    admission: { authorize: async (handle, mode) => {
      if (handle !== request) throw new AuthorityError(401, 'AUTHORITY_UNAUTHORIZED');
      expect(mode).toBe('read');
      return grants();
    } },
  });
  await expect(admitted.read(request, committed.identity)).resolves.toMatchObject({
    schemaVersion: '1', identity: committed.identity, status: 'active', epoch: 1,
    sourceRef: committed.manifest.sourceRef,
  });
  const denied = createCurrentAuthority<object>({
    db: runtime, clock, observe,
    admission: { authorize: async () => grants({ allowedAccountIds: ['unknown-customer'] }) },
  });
  await expect(denied.read(request, committed.identity)).rejects.toMatchObject({
    code: 'AUTHORITY_FORBIDDEN', statusCode: 403,
  });
  expect(() => trap.call('sync-harness')).toThrow(/WORKER_MODEL_CALL_FORBIDDEN/);
  expect(trap.attempts).toBe(1);
});

test('captures a fresh post-activation API page without parent writes or model credentials', async () => {
  assertModelCredentialsAbsent();
  const before = await parentFinancialFingerprint();
  const capture = createRuntimeCapture({ db: runtime, clock });
  const bound = await capture.openCommitted(committed.identity);
  expect(bound.lane).toEqual({
    schemaVersion: '1', sourceRef: committed.manifest.sourceRef, manifestHash: committed.manifest.hash,
  });
  const streamId = 'a-finance';
  const after = committed.manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
  await operator.freshInvoiceA(operatorToken, {
    id: 'v5-sync-postactivation-invoice',
    accountId: 'unknown-v5-sync-account',
    amount: '12.00', dueDate: '2026-10-31', effectiveDate: '2026-10-02', observedAt: approvedAt,
  });
  const page = await source.fetchChanges(committed.manifest.sourceRef, streamId, after);
  expect(page.complete).toBe(true);
  expect(page.events.length).toBeGreaterThan(0);
  expect(await bound.capturePage(page)).toEqual({
    disposition: 'captured', captured: page.events.length, cursor: page.next, replayed: false,
  });
  expect(await bound.capturePage(page)).toEqual({
    disposition: 'replayed', captured: 0, cursor: page.next, replayed: true,
  });
  const progress = await bound.readProgress();
  expect(progress.streams.find(stream => stream.streamId === streamId)?.captureCursor).toBe(page.next);
  expect(await parentFinancialFingerprint()).toEqual(before);
  assertModelCredentialsAbsent();
});

test('applies a captured invoice once, recovers its receipt and fences stale input', async () => {
  // This lane starts at its approved baseline. The previous capture-only test deliberately
  // retained an unknown-account event, which would block all application on that lane.
  const data = await createSyncApplyFixture();
  try {
    const { db, identity, source, stored } = data;
    const { manifest, artifact } = stored.bundle;
    const profile = selectedProfile(stored.bundle);
    const target = stored.approvedTarget.records;
    const streamId = 'a-finance';
    const baseline = manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
    const bound = await createRuntimeCapture({ db, clock: syncApplyClock }).openCommitted(identity);
    const apply = createSyncApplier({ db, clock: syncApplyClock, identity, observe: source.readCurrentSemantics });
    await data.addInvoice('v5-apply-invoice-1', profile.sourceAccountIds[0]!);
    const page = await source.fetchChanges(manifest.sourceRef, streamId, baseline);
    expect(await bound.capturePage(page)).toMatchObject({ captured: 1 });
    const { plan } = await apply.prepare(syncApplyInstant);
    if (!plan) throw new Error('Expected a new invoice plan');

    const first = await apply.applyBatch(plan, 1);
    expect(first.replayed).toBe(false);
    expect(first.receipt.afterBalanceCents - first.receipt.beforeBalanceCents).toBe(1200);
    expect(first.receipt.targetRecordIds).toHaveLength(1);
    const moved = await withTransaction(db, client => readStoredTarget(client, identity.scope));
    expect(moved?.records.version).toBe(target.version + 1);

    await data.addInvoice('v5-apply-invoice-2', profile.sourceAccountIds[0]!);
    const pending = await source.fetchChanges(manifest.sourceRef, streamId, page.next);
    expect(await bound.capturePage(pending)).toMatchObject({ captured: 1 });
    const stale = planBatch(artifact, profile, pending.events, { ...target, asOf: syncApplyInstant }).plans[0]!;
    await expect(apply.applyBatch(stale, 1)).rejects.toMatchObject({ code: 'SYNC_TARGET_STALE' });
    await expect(apply.applyBatch(stale, 2)).rejects.toMatchObject({ code: 'AUTHORITY_STALE' });
    expect(await apply.applyBatch(plan, 1)).toEqual({ receipt: first.receipt, replayed: true });
    expect((await db.query('SELECT receipt_id FROM runtime_sync_receipts')).rows).toEqual([{ receipt_id: first.receipt.id }]);
  } finally {
    await data.close();
  }
}, 120_000);
