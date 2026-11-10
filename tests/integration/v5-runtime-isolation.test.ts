/**
 * V5 harness: model-free worker isolation against real apps/worker sync and
 * activation surfaces with credentials absent. Does not create packages/runtime.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  LocalSessionResponseSchema, ReviewPackageSchema, type CommittedCaptureIdentityV1,
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
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { issueActivationProofs, verifyOriginals } from '../fixtures/activation-proof.js';
import { testNamespace } from '../fixtures/harness.js';
import {
  assertModelCredentialsAbsent, assertWorkerSourcesModelFree, createModelCallTrap,
  modelCredentialEnvNames, scrubModelCredentials, workerProductionImportGraph, workerSourceFiles,
} from '../fixtures/v5-ai-off.js';

const namespace = testNamespace('v5iso');
const approvedAt = '2026-11-09T09:00:00.000Z';
const clock = () => new Date(approvedAt);
const webOrigin = 'http://127.0.0.1:5184';
const serviceToken = 'v5-iso-worker';

let pair: Awaited<ReturnType<typeof provisionTest>>;
let root: string;
let runtime: Pool;
let control: Pool;
let identity: CommittedCaptureIdentityV1;
let sourceRef: string;
let manifestHash: string;

beforeAll(async () => {
  for (const name of modelCredentialEnvNames) process.env[name] = 'must-be-scrubbed';
  expect(scrubModelCredentials().sort()).toEqual([...modelCredentialEnvNames].sort());
  assertModelCredentialsAbsent();
  root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-v5-iso-'));
  await startNativeDb();
  pair = await provisionTest(namespace);
  runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  control = createControlDb({ connectionString: pair.control.appUrl });
  await migrate(pair, migrationStreams, readMigrationCatalog());
  const proofs = await issueActivationProofs(root, control);
  const source = createSourceService(proofs.dependencies, localSourceCatalog);
  const migrations = readMigrationCatalog();
  const worker = await launchWorker({
    db: runtime, serviceToken, clock, expectedMigrations: migrationIdentities(migrations.runtime),
    featurePlugins: [composeWorkerParentReads(proofs.registryRoot)],
  }, 0);
  try {
    const address = worker.server.address();
    if (!address || typeof address === 'string') throw new Error('No worker listener');
    const origin = 'http://127.0.0.1:' + address.port;
    const health = await fetch(origin + '/internal/health', {
      headers: { Authorization: 'Bearer ' + serviceToken },
    });
    expect(health.status).toBe(200);
    const workerActivation = createWorkerActivation({
      db: runtime, clock, registered: proofs.scopeReader, policy: await loadActivationPolicy(proofs),
      readBundle: hash => readActivationBundle({ registryRoot: proofs.registryRoot }, hash),
      observe: source.readCurrentSemantics,
    });
    const repository = createReviewRepository(proofs.dependencies.db, clock);
    const sessionService = createLocalSessionService({
      webOrigin, reviewerId: 'v5-iso-reviewer',
      allowedSourceRefs: [...localSourceCatalog.values()].map(entry => entry.sourceRef),
      allowedAccountIds: [proofs.a.accountId],
    });
    const review = await composeActivationReview({
      dependencies: proofs.dependencies, catalog: localSourceCatalog, service: source,
    }, {
      registryRoot: proofs.registryRoot, policyPath: proofs.policyPath, selectionPath: proofs.selectionPath,
      bootstrapRoots: proofs.bootstrapRoots, candidates: proofs.candidates,
      observe: source.readCurrentSemantics,
      parent: createParentReadClient(origin, serviceToken, proofs.registryRoot),
      authorize: sessionService.authorizeReviewer,
    });
    const app = buildControl({
      db: proofs.dependencies.db, clock, expectedMigrations: migrationIdentities(migrations.control),
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
      const key = 'v5-iso-approve-a';
      const url = '/api/review/' + proofs.a.accountId;
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
      const stored = await withTransaction(runtime, client => readStoredActivation(client, receipt.scope));
      if (!stored) throw new Error('No A5 activation');
      verifyOriginals(stored.approvedTarget.records, 'a');
      expect(stored.bundle.artifact.normalizedPlan.runtimeModelCalls).toBe('forbidden');
      identity = { scope: receipt.scope, activationId: receipt.activationId, bundleHash: intent.bundleHash };
      sourceRef = stored.bundle.manifest.sourceRef;
      manifestHash = stored.bundle.manifest.hash;
    } finally {
      await app.close();
    }
  } finally {
    await worker.close();
  }
}, 120_000);

afterAll(async () => {
  await Promise.all([runtime?.end(), control?.end()]);
  if (pair) await dropTest(namespace);
  if (root) await rm(root, { recursive: true, force: true });
});

test('worker production sources and import graph stay free of model and discovery packages', () => {
  const files = workerSourceFiles();
  expect(files.some(name => name.startsWith('apps/worker/src/sync/'))).toBe(true);
  expect(files.some(name => name.startsWith('apps/worker/src/routes/'))).toBe(true);
  assertWorkerSourcesModelFree(files);
  const graph = workerProductionImportGraph([
    'apps/worker/src/server.ts',
    'apps/worker/src/activation-composition.ts',
    'apps/worker/src/parent-read-composition.ts',
    'apps/worker/src/sync/capture.ts',
    'apps/worker/src/sync/current-authority.ts',
  ]);
  expect(graph.some(name => name.includes('apps/worker/src/sync/capture.ts'))).toBe(true);
  expect(graph.every(name => !name.includes('packages/discovery') && !name.includes('packages/runtime'))).toBe(true);
  expect(graph.every(name => !/openai|anthropic/i.test(name))).toBe(true);
});

test('model-call trap fires on attempted provider use while capture remains model-free', async () => {
  assertModelCredentialsAbsent();
  const trap = createModelCallTrap();
  expect(() => trap.call('openai.chat.completions')).toThrow(/WORKER_MODEL_CALL_FORBIDDEN/);
  expect(trap.attempts).toBe(1);
  const capture = createRuntimeCapture({ db: runtime, clock });
  const bound = await capture.openCommitted(identity);
  expect(bound.lane).toEqual({ schemaVersion: '1', sourceRef, manifestHash });
  const progress = await bound.readProgress();
  expect(progress.lane).toEqual(bound.lane);
  expect(trap.attempts).toBe(1);
  assertModelCredentialsAbsent();
});
