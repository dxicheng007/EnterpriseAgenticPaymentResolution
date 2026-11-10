/**
 * V6 harness: replay, restart, and revoke recovery against real apps/worker
 * sync/activation surfaces. Does not invent packages/runtime apply/run-cycle;
 * monetary application and joint G6 remain Platform-blocked / pending.
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
import { readStoredActivation } from '@eapr/parent/activation-store';
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
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import {
  createCurrentAuthority, type AuthorityAdmissionGrants,
} from '../../apps/worker/src/sync/current-authority.js';
import { AuthorityError } from '../../apps/worker/src/sync/current-authority-errors.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { issueActivationProofs, verifyOriginals } from '../fixtures/activation-proof.js';
import { testNamespace } from '../fixtures/harness.js';
import { committedFinancialFingerprint } from '../fixtures/v6-containment.js';

const namespace = testNamespace('v6recov');
const approvedAt = '2026-11-09T10:00:00.000Z';
const clock = () => new Date(approvedAt);
const webOrigin = 'http://127.0.0.1:5185';
const serviceToken = 'v6-recovery-worker';
const operatorToken = 'v6-recovery-operator';
const request = Object.freeze({});
const reviewer = { reviewerId: 'v6-recovery-reviewer', sessionId: 'v6-recovery-session' };

type Proofs = Awaited<ReturnType<typeof issueActivationProofs>>;
type Committed = {
  identity: CommittedCaptureIdentityV1;
  manifest: BootstrapManifest;
  events: RawSourceEvent[];
  receiptId: string;
};

let pair: Awaited<ReturnType<typeof provisionTest>>;
let root: string;
let runtime: Pool;
let control: Pool;
let proofs: Proofs;
let source: ReturnType<typeof createSourceService>;
let operator: ReturnType<typeof createScenarioAdmin>;
let committed: Committed;
let baselineFinancial: Awaited<ReturnType<typeof committedFinancialFingerprint>>;

beforeAll(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-v6-recovery-'));
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
  committed = await activateOne(runtime, proofs, proofs.a, 'v6-recovery-approve-a');
  baselineFinancial = await committedFinancialFingerprint(runtime);
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
      const replay = await workerActivation.activate({ idempotencyKey: key, bundleHash: intent.bundleHash });
      expect(replay).toEqual({ receipt, replayed: true });
      return {
        identity: { scope: receipt.scope, activationId: receipt.activationId, bundleHash: intent.bundleHash },
        manifest: stored.bundle.manifest, events: stored.bundle.bootstrapEvents,
        receiptId: receipt.id,
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

function authority() {
  return createCurrentAuthority<object>({
    db: runtime, clock, observe: source.readCurrentSemantics,
    admission: { authorize: async (handle, mode) => {
      if (handle !== request) throw new AuthorityError(401, 'AUTHORITY_UNAUTHORIZED');
      expect(mode === 'read' || mode === 'mutation').toBe(true);
      return grants();
    } },
  });
}

test('exact activation replay and capture restart preserve committed financial rows', async () => {
  expect(await committedFinancialFingerprint(runtime)).toEqual(baselineFinancial);

  const capture = createRuntimeCapture({ db: runtime, clock });
  const bound = await capture.openCommitted(committed.identity);
  const streamId = 'a-finance';
  const after = committed.manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
  await operator.freshInvoiceA(operatorToken, {
    id: 'v6-recovery-postactivation-invoice',
    accountId: 'unknown-v6-recovery-account',
    amount: '9.00', dueDate: '2026-10-31', effectiveDate: '2026-10-02', observedAt: approvedAt,
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

  const afterCapture = await committedFinancialFingerprint(runtime);
  expect(afterCapture).toEqual(baselineFinancial);

  const restarted = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  try {
    const reopened = await createRuntimeCapture({ db: restarted, clock }).openCommitted(committed.identity);
    expect(await reopened.capturePage(page)).toEqual({
      disposition: 'replayed', captured: 0, cursor: page.next, replayed: true,
    });
    expect(await committedFinancialFingerprint(restarted)).toEqual(baselineFinancial);
  } finally {
    await restarted.end();
  }
});

test('revoke fences stale epochs while replaying earlier pause and leaving financial rows intact', async () => {
  const service = authority();
  const pause = {
    schemaVersion: '1' as const,
    identity: committed.identity,
    action: 'pause' as const,
    expectedEpoch: 1,
    idempotencyKey: 'v6-recovery-pause',
  };
  const first = await service.command(request, pause);
  expect(first).toMatchObject({
    replayed: false,
    result: { beforeStatus: 'active', beforeEpoch: 1, changed: true, state: { status: 'paused', epoch: 2 } },
  });
  expect(await committedFinancialFingerprint(runtime)).toEqual(baselineFinancial);

  const revoke = await service.command(request, {
    schemaVersion: '1', identity: committed.identity, action: 'revoke',
    expectedEpoch: 2, idempotencyKey: 'v6-recovery-revoke',
  });
  expect(revoke).toMatchObject({
    replayed: false,
    result: { beforeStatus: 'paused', beforeEpoch: 2, changed: true, state: { status: 'revoked', epoch: 3 } },
  });
  expect(await service.command(request, pause)).toEqual({ result: first.result, replayed: true });
  expect(await service.read(request, committed.identity)).toMatchObject({ status: 'revoked', epoch: 3 });

  await expect(service.command(request, {
    schemaVersion: '1', identity: committed.identity, action: 'pause',
    expectedEpoch: 2, idempotencyKey: 'v6-recovery-stale-epoch',
  })).rejects.toMatchObject({ code: 'AUTHORITY_STALE', statusCode: 409 });
  await expect(service.command(request, {
    schemaVersion: '1', identity: committed.identity, action: 'resume',
    expectedEpoch: 3, idempotencyKey: 'v6-recovery-resume-after-revoke',
  })).rejects.toMatchObject({ code: 'AUTHORITY_REVOKED', statusCode: 409 });

  expect(await committedFinancialFingerprint(runtime)).toEqual(baselineFinancial);
  expect(committed.receiptId.length).toBeGreaterThan(0);
});
