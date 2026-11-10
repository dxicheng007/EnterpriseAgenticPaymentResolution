/**
 * V6 harness: schema-gap and semantic-drift containment against real apps/worker
 * sync/activation surfaces. Capture may retain raw drifted facts; committed parent
 * financial rows must not change. Does not invent packages/runtime apply/quarantine;
 * joint G6 remains pending.
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
import { readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
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

const namespace = testNamespace('v6drift');
const approvedAt = '2026-11-09T11:00:00.000Z';
const clock = () => new Date(approvedAt);
const webOrigin = 'http://127.0.0.1:5186';
const serviceToken = 'v6-drift-worker';
const operatorToken = 'v6-drift-operator';
const request = Object.freeze({});
const reviewer = { reviewerId: 'v6-drift-reviewer', sessionId: 'v6-drift-session' };

type Proofs = Awaited<ReturnType<typeof issueActivationProofs>>;
type Subject = {
  identity: CommittedCaptureIdentityV1;
  manifest: BootstrapManifest;
  events: RawSourceEvent[];
  stored: StoredActivation;
  company: 'a' | 'b';
};

let pair: Awaited<ReturnType<typeof provisionTest>>;
let root: string;
let runtime: Pool;
let control: Pool;
let proofs: Proofs;
let source: ReturnType<typeof createSourceService>;
let operator: ReturnType<typeof createScenarioAdmin>;
let a: Subject;
let b: Subject;
let baselineFinancial: Awaited<ReturnType<typeof committedFinancialFingerprint>>;

beforeAll(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-v6-drift-'));
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
  [a, b] = await activateBoth();
  baselineFinancial = await committedFinancialFingerprint(runtime);
}, 180_000);

afterAll(async () => {
  await Promise.all([runtime?.end(), control?.end()]);
  if (pair) await dropTest(namespace);
  if (root) await rm(root, { recursive: true, force: true });
});

async function activateBoth(): Promise<[Subject, Subject]> {
  const migrations = readMigrationCatalog();
  const worker = await launchWorker({
    db: runtime, serviceToken, clock, expectedMigrations: migrationIdentities(migrations.runtime),
    featurePlugins: [composeWorkerParentReads(proofs.registryRoot)],
  }, 0);
  try {
    const address = worker.server.address();
    if (!address || typeof address === 'string') throw new Error('No worker listener');
    const origin = 'http://127.0.0.1:' + address.port;
    const workerActivation = createWorkerActivation({
      db: runtime, clock, registered: proofs.scopeReader, policy: await loadActivationPolicy(proofs),
      readBundle: hash => readActivationBundle({ registryRoot: proofs.registryRoot }, hash),
      observe: source.readCurrentSemantics,
    });
    const repository = createReviewRepository(proofs.dependencies.db, clock);
    const sessionService = createLocalSessionService({
      webOrigin, reviewerId: reviewer.reviewerId,
      allowedSourceRefs: [...localSourceCatalog.values()].map(entry => entry.sourceRef),
      allowedAccountIds: [proofs.a.accountId, proofs.b.accountId],
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
      async function activate(company: 'a' | 'b'): Promise<Subject> {
        const subject = proofs[company];
        const url = '/api/review/' + subject.accountId;
        const prepared = await app.inject({ method: 'POST', url: url + '/prepare', headers, payload: {} });
        expect(prepared.statusCode, prepared.body).toBe(200);
        const reviewPackage = ReviewPackageSchema.parse(prepared.json());
        const key = 'v6-drift-approve-' + company;
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
        verifyOriginals(stored.approvedTarget.records, company);
        return {
          identity: { scope: receipt.scope, activationId: receipt.activationId, bundleHash: intent.bundleHash },
          manifest: stored.bundle.manifest, events: stored.bundle.bootstrapEvents, stored, company,
        };
      }
      return [await activate('a'), await activate('b')];
    } finally {
      await app.close();
    }
  } finally {
    await worker.close();
  }
}

function grants(subject: Subject, overrides: Partial<AuthorityAdmissionGrants> = {}): AuthorityAdmissionGrants {
  return {
    reviewer,
    allowedAccountIds: [a.identity.scope.accountId, b.identity.scope.accountId],
    allowedSourceRefs: [a.manifest.sourceRef, b.manifest.sourceRef],
    ...overrides,
  };
}

function authority(subject: Subject = a) {
  return createCurrentAuthority<object>({
    db: runtime, clock, observe: source.readCurrentSemantics,
    admission: { authorize: async (handle, mode) => {
      if (handle !== request) throw new AuthorityError(401, 'AUTHORITY_UNAUTHORIZED');
      expect(mode === 'read' || mode === 'mutation').toBe(true);
      return grants(subject);
    } },
  });
}

test('schema-renamed capture stays out of committed financial rows while peer authority stays active', async () => {
  const before = await committedFinancialFingerprint(runtime);
  expect(before).toEqual(baselineFinancial);

  const capture = createRuntimeCapture({ db: runtime, clock });
  const bound = await capture.openCommitted(a.identity);
  const streamId = 'a-finance';
  const after = a.manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
  await operator.schemaRenameA(operatorToken, {
    id: 'v6-drift-schema-gap',
    accountId: 'unknown-v6-drift-account',
    amount: '7.00', dueDate: '2026-10-31', effectiveDate: '2026-10-03', observedAt: approvedAt,
  });
  const page = await source.fetchChanges(a.manifest.sourceRef, streamId, after);
  expect(page.complete).toBe(true);
  expect(page.events[0]?.schemaVersion).toBe('schema-a-2');
  expect(a.manifest.schemaVersions[page.events[0]!.resource]).not.toBe('schema-a-2');

  expect(await bound.capturePage(page)).toMatchObject({
    disposition: 'captured', captured: page.events.length, replayed: false,
  });
  expect(await committedFinancialFingerprint(runtime)).toEqual(before);

  const conflict = {
    ...page,
    events: page.events.map(event => ({ ...event, observedAt: '2026-11-09T11:00:01.000Z',
      contentHash: '0'.repeat(64) })),
  };
  await expect(bound.capturePage(conflict)).rejects.toMatchObject({
    code: 'CAPTURE_INPUT_INVALID', statusCode: 400,
  });
  expect(await committedFinancialFingerprint(runtime)).toEqual(before);

  expect(await authority(b).read(request, b.identity)).toMatchObject({
    status: 'active', epoch: 1, identity: b.identity,
  });
});

test('semantic drift blocks resume while independent peer connection remains active', async () => {
  const service = authority(a);
  const pause = await service.command(request, {
    schemaVersion: '1', identity: a.identity, action: 'pause',
    expectedEpoch: 1, idempotencyKey: 'v6-drift-pause-a',
  });
  expect(pause).toMatchObject({
    replayed: false, result: { state: { status: 'paused', epoch: 2 } },
  });
  expect(await committedFinancialFingerprint(runtime)).toEqual(baselineFinancial);

  const accountId = a.stored.bundle.profiles
    .find(profile => profile.hash === a.stored.activation.profileHash)!
    .sourceAccountIds[0]!;
  await operator.semanticChangeA(operatorToken, {
    id: 'v6-drift-semantic',
    accountId,
    observedAt: approvedAt, effectiveDate: '2026-10-04', revision: 'sem-a-drifted',
  });

  await expect(service.command(request, {
    schemaVersion: '1', identity: a.identity, action: 'resume',
    expectedEpoch: 2, idempotencyKey: 'v6-drift-resume-blocked',
  })).rejects.toMatchObject({ code: 'AUTHORITY_SEMANTICS_MISMATCH', statusCode: 409 });

  expect(await service.read(request, a.identity)).toMatchObject({ status: 'paused', epoch: 2 });
  expect(await authority(b).read(request, b.identity)).toMatchObject({
    status: 'active', epoch: 1, identity: b.identity,
  });
  expect(await committedFinancialFingerprint(runtime)).toEqual(baselineFinancial);
});
