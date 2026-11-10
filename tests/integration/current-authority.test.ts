import { mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import {
  AuthorityResumeObservationV1Schema, AuthorityStatusResultV1Schema, LocalSessionResponseSchema,
  ReviewerContextSchema, ReviewPackageSchema, canonicalJson, hashCanonical,
  type AuthorityStatusCommandV1, type CommittedAuthorityIdentityV1, type SemanticPreflight,
} from '@eapr/contracts';
import { readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
import { lockParentKeys } from '@eapr/parent/persistence';
import { decodeCanonical, encodeCanonical } from '@eapr/parent/snapshots';
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
import { createParentReads } from '../../apps/worker/src/parent-reads.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import * as authorityModule from '../../apps/worker/src/sync/current-authority.js';
import { createCurrentAuthority, type AuthorityAdmissionGrants,
  type TrustedAuthorityAdmission } from '../../apps/worker/src/sync/current-authority.js';
import { AuthorityError } from '../../apps/worker/src/sync/current-authority-errors.js';
import { assertActiveAuthority, lockCurrentAuthority } from '../../apps/worker/src/sync/current-authority-store.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { issueActivationProofs, verifyOriginals } from '../fixtures/activation-proof.js';
import { testNamespace } from '../fixtures/harness.js';

const namespace = testNamespace('authority');
const approvedAt = '2026-11-09T08:00:00.000Z';
let now = approvedAt;
const clock = () => new Date(now);
const webOrigin = 'http://127.0.0.1:5182';
const serviceToken = 'authority-fixture-worker';
type Proofs = Awaited<ReturnType<typeof issueActivationProofs>>;
type Source = ReturnType<typeof createSourceService>;
type Subject = { identity: CommittedAuthorityIdentityV1; stored: StoredActivation };

let pair: Awaited<ReturnType<typeof provisionTest>>;
let root: string;
let runtime: Pool;
let owner: Pool;
let control: Pool;
let source: Source;
let proofs: Proofs;
let a: Subject;
let b: Subject;
let publishedOnly: PromiseSettledResult<unknown>[];
let originalFinancialState: Awaited<ReturnType<typeof financialState>>;

async function activateBoth() {
  const catalog = readMigrationCatalog();
  const worker = await launchWorker({
    db: runtime, serviceToken, clock, expectedMigrations: migrationIdentities(catalog.runtime),
    featurePlugins: [composeWorkerParentReads(proofs.registryRoot)],
  }, 0);
  try {
    const address = worker.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing worker listener');
    const origin = 'http://127.0.0.1:' + address.port;
    const reviewer = createLocalSessionService({
      webOrigin, reviewerId: 'original-reviewer', allowedAccountIds: [proofs.a.accountId, proofs.b.accountId],
      allowedSourceRefs: [proofs.a.sourceRef, proofs.b.sourceRef],
    });
    const workerActivation = createWorkerActivation({
      db: runtime, clock, registered: proofs.scopeReader, policy: await loadActivationPolicy(proofs),
      readBundle: hash => readActivationBundle(proofs, hash), observe: source.readCurrentSemantics,
    });
    const repository = createReviewRepository(control, clock);
    const review = await composeActivationReview({
      dependencies: proofs.dependencies, catalog: localSourceCatalog, service: source,
    }, {
      ...proofs, observe: source.readCurrentSemantics, authorize: reviewer.authorizeReviewer,
      parent: createParentReadClient(origin, serviceToken, proofs.registryRoot),
    });
    const app = buildControl({
      db: control, clock, expectedMigrations: migrationIdentities(catalog.control),
      workerClient: createWorkerClient(origin, serviceToken), featurePlugins: [reviewer.plugin, ...review],
    });
    try {
      const session = await app.inject({ method: 'POST', url: '/api/local-session',
        headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {} });
      expect(session.statusCode, session.body).toBe(200);
      const cookie = session.cookies[0]!;
      const headers = { origin: webOrigin, cookie: cookie.name + '=' + cookie.value,
        'x-eapr-csrf': LocalSessionResponseSchema.parse(session.json()).csrfToken };
      async function activate(company: 'a' | 'b'): Promise<Subject> {
        const url = '/api/review/' + proofs[company].accountId;
        const prepared = await app.inject({ method: 'POST', url: url + '/prepare', headers, payload: {} });
        expect(prepared.statusCode, prepared.body).toBe(200);
        const review = ReviewPackageSchema.parse(prepared.json());
        const key = 'initial-authority-' + company;
        const approval = await app.inject({ method: 'POST', url: url + '/activate', headers, payload: {
          reviewPackageId: review.id, expectedPackageHash: review.hash, expectedArtifactHash: review.artifactHash,
          expectedProfileHash: review.profileHash, expectedTargetVersion: review.expectedTargetVersion, idempotencyKey: key,
        } });
        expect(approval.statusCode, approval.body).toBe(202);
        const intent = await repository.readIntentByKey(key);
        if (!intent) throw new Error('Missing committed review intent');
        const { receipt } = await workerActivation.activate({ idempotencyKey: key, bundleHash: intent.bundleHash });
        const stored = await withTransaction(runtime, client => readStoredActivation(client, receipt.scope));
        if (!stored) throw new Error('Missing committed A5 import');
        verifyOriginals(stored.approvedTarget.records, company);
        return { identity: { scope: receipt.scope, activationId: receipt.activationId, bundleHash: intent.bundleHash }, stored };
      }
      return [await activate('a'), await activate('b')] as const;
    } finally {
      await app.close();
    }
  } finally {
    await worker.close();
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-authority-'));
  await startNativeDb();
  pair = await provisionTest(namespace);
  runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  owner = createRuntimeDb({ connectionString: pair.runtime.migrationUrl });
  control = createControlDb({ connectionString: pair.control.appUrl });
  await migrate(pair, migrationStreams, readMigrationCatalog());
  proofs = await issueActivationProofs(root, control);
  source = createSourceService(proofs.dependencies, localSourceCatalog);
  const published = (await proofs.scopeReader.readSnapshot()).resolveRegisteredScope(proofs.a.accountId);
  if (!published) throw new Error('Missing genuine fixture scope publication');
  const identity = { scope: published.entry.scope, activationId: 'not-yet-imported', bundleHash: 'a'.repeat(64) };
  const authority = createCurrentAuthority<object>({
    db: runtime, clock, observe: source.readCurrentSemantics,
    admission: { authorize: async handle => {
      if (handle !== request) throw new AuthorityError(401, 'AUTHORITY_UNAUTHORIZED');
      return { reviewer, allowedAccountIds: [identity.scope.accountId], allowedSourceRefs: [published.manifest.sourceRef] };
    } },
  });
  publishedOnly = await Promise.allSettled([
    authority.read(request, identity),
    authority.command(request, { schemaVersion: '1', identity, action: 'pause', expectedEpoch: 1, idempotencyKey: 'before-import' }),
  ]);
  [a, b] = await activateBoth();
  originalFinancialState = await financialState();
}, 90_000);

beforeEach(async () => {
  await owner.query('TRUNCATE runtime_authority_commands, runtime_authority_heads');
  now = approvedAt;
});

afterAll(async () => {
  try {
    if (originalFinancialState) expect(await financialState()).toEqual(originalFinancialState);
  } finally {
    await Promise.all([runtime?.end(), owner?.end(), control?.end()]);
    if (pair) await dropTest(namespace);
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function financialState() {
  const tables = [
    'parent_scopes', 'parent_snapshots', 'parent_targets', 'parent_metadata', 'parent_financial_records',
    'runtime_deliveries', 'runtime_activation_imports', 'runtime_economic_outcomes',
    'runtime_delivery_outcomes', 'runtime_import_lineage',
  ];
  return Object.fromEntries(await Promise.all(tables.map(async table => [
    table, (await runtime.query('SELECT to_jsonb(t) AS record FROM ' + table + ' t ORDER BY to_jsonb(t)::text')).rows,
  ])));
}

// Internal trust fixture. Object identity stands in for future ingress/session authentication.
const request = Object.freeze({});
const retryRequest = Object.freeze({});
const differentReviewerRequest = Object.freeze({});
const reviewer = { reviewerId: 'authority-reviewer', sessionId: 'authority-session' };
function grants(handle: object = request): AuthorityAdmissionGrants {
  const actor = handle === retryRequest ? { ...reviewer, sessionId: 'retry-session' }
    : handle === differentReviewerRequest ? { ...reviewer, reviewerId: 'different-reviewer' } : { ...reviewer };
  return { reviewer: actor, allowedAccountIds: [a.identity.scope.accountId, b.identity.scope.accountId],
    allowedSourceRefs: [a.stored.bundle.manifest.sourceRef, b.stored.bundle.manifest.sourceRef] };
}
function command(subject: Subject, action: AuthorityStatusCommandV1['action'], expectedEpoch: number, idempotencyKey: string) {
  return { schemaVersion: '1', identity: subject.identity, action, expectedEpoch, idempotencyKey } as const;
}
function service(options: {
  db?: Pool;
  authorize?: TrustedAuthorityAdmission<object>['authorize'];
  observe?: (sourceRef: string) => Promise<SemanticPreflight>;
} = {}) {
  return createCurrentAuthority<object>({
    db: options.db ?? runtime, clock, observe: options.observe ?? source.readCurrentSemantics,
    admission: { authorize: async (handle, mode) => {
      if (![request, retryRequest, differentReviewerRequest].includes(handle)) {
        throw new AuthorityError(401, 'AUTHORITY_UNAUTHORIZED');
      }
      return options.authorize ? options.authorize(handle, mode) : grants(handle);
    } },
  });
}

function failure(name: string, statusCode: number) {
  return { code: 'AUTHORITY_' + name, statusCode };
}

function barrier() {
  return Promise.withResolvers<void>();
}

test('projects the original committed authority without creating a head', async () => {
  const current = await service().read(request, a.identity);
  expect(current).toEqual({
    schemaVersion: '1', identity: a.identity, sourceRef: a.stored.bundle.manifest.sourceRef,
    artifactHash: a.stored.activation.artifactHash, profileHash: a.stored.activation.profileHash,
    manifestHash: a.stored.activation.manifestHash, status: 'active', epoch: 1, changedAt: approvedAt,
  });
  expect((await runtime.query('SELECT 1 FROM runtime_authority_heads')).rows).toEqual([]);
  expect((await runtime.query('SELECT 1 FROM runtime_authority_commands')).rows).toEqual([]);
});

test('commits a pause and recovers the exact result after a later revoke', async () => {
  const authority = service();
  const pause = command(a, 'pause', 1, 'first-pause');
  const first = await authority.command(request, pause);
  expect(first).toMatchObject({ replayed: false, result: { beforeStatus: 'active', beforeEpoch: 1,
    changed: true, state: { status: 'paused', epoch: 2 } } });
  await authority.command(request, command(a, 'revoke', 2, 'later-revoke'));
  expect(await authority.command(request, pause)).toEqual({ result: first.result, replayed: true });
  expect(await authority.read(request, a.identity)).toMatchObject({ status: 'revoked', epoch: 3 });
});

test('checks admitted grants before parsing input or opening a database connection', async () => {
  const connect = vi.spyOn(runtime, 'connect');
  try {
    const malformed = { ...command(a, 'pause', 1, 'untrusted'), reviewer, allowedAccountIds: grants().allowedAccountIds };
    const modes: string[] = [];
    const authority = service({ authorize: async (_handle, mode) => {
      modes.push(mode);
      return grants();
    } });
    await expect(authority.read(JSON.parse('{}'), a.identity)).rejects.toMatchObject(failure('UNAUTHORIZED', 401));
    await expect(authority.command(request, malformed)).rejects.toMatchObject(failure('INPUT_INVALID', 400));
    await expect(service({ authorize: async () => ({ ...grants(), reviewer: { ...reviewer, extra: 'not allowed' } }) })
      .command(request, malformed)).rejects.toMatchObject(failure('FORBIDDEN', 403));
    await expect(service({ authorize: async () => ({ ...grants(), allowedAccountIds: [] }) })
      .read(request, a.identity)).rejects.toMatchObject(failure('FORBIDDEN', 403));
    await expect(service({ authorize: async () => { throw new Error('private authorizer diagnostic'); } })
      .read(request, a.identity)).rejects.toMatchObject({
      ...failure('UNAVAILABLE', 503), message: 'Current authority is unavailable',
    });
    expect(modes).toEqual(['mutation']);
    expect(connect).not.toHaveBeenCalled();
  } finally {
    connect.mockRestore();
  }
  const deniedSource = service({ authorize: async () => ({ ...grants(), allowedSourceRefs: [] }) });
  await expect(deniedSource.read(request, a.identity)).rejects.toMatchObject(failure('FORBIDDEN', 403));
  await expect(deniedSource.command(request, command(a, 'pause', 1, 'source-denied')))
    .rejects.toMatchObject(failure('FORBIDDEN', 403));
  expect((await runtime.query('SELECT 1 FROM runtime_authority_heads')).rows).toEqual([]);
});

test('requires an exact committed import rather than a published or runtime-registered scope', async () => {
  expect(publishedOnly).toEqual(Array.from({ length: 2 }, () => ({
    status: 'rejected', reason: expect.objectContaining(failure('NOT_FOUND', 404)),
  })));
  const scope = { ...a.identity.scope, accountId: 'registry-only-account' };
  await owner.query('INSERT INTO parent_scopes (account_id, company_id, seller_entity_id) VALUES ($1, $2, $3)',
    [scope.accountId, scope.companyId, scope.sellerEntityId]);
  try {
    const authority = service({ authorize: async () => ({ ...grants(), allowedAccountIds: [scope.accountId] }) });
    const identity = { ...a.identity, scope };
    await expect(authority.read(request, identity)).rejects.toMatchObject(failure('NOT_FOUND', 404));
    await expect(authority.command(request, { ...command(a, 'pause', 1, 'registry-only'), identity }))
      .rejects.toMatchObject(failure('NOT_FOUND', 404));
  } finally {
    // parent_scopes is immutable even for the ordinary owner; this row is test-only.
    await withTransaction(owner, async client => {
      await client.query('ALTER TABLE parent_scopes DISABLE TRIGGER USER');
      await client.query('DELETE FROM parent_scopes WHERE account_id = $1', [scope.accountId]);
      await client.query('ALTER TABLE parent_scopes ENABLE TRIGGER USER');
    });
  }
});

test('applies every status transition and retains changedAt, pins and original activation history', async () => {
  let observations = 0;
  const authority = service({ observe: async sourceRef => {
    observations++;
    return source.readCurrentSemantics(sourceRef);
  } });
  const priorActivity = Number((await runtime.query('SELECT sequence FROM activity_counter')).rows[0]!.sequence);
  const cases = [
    [a, 'resume', 1, 'active', 1, false],
    [a, 'pause', 1, 'paused', 2, true],
    [a, 'pause', 2, 'paused', 2, false],
    [a, 'resume', 2, 'active', 3, true],
    [a, 'pause', 3, 'paused', 4, true],
    [a, 'revoke', 4, 'revoked', 5, true],
    [a, 'revoke', 5, 'revoked', 5, false],
    [b, 'revoke', 1, 'revoked', 2, true],
  ] as const;
  const original = new Map<Subject, { status: string; changedAt: string }>([
    [a, { status: 'active', changedAt: approvedAt }], [b, { status: 'active', changedAt: approvedAt }],
  ]);
  for (const [index, [subject, action, epoch, status, nextEpoch, changed]] of cases.entries()) {
    now = new Date(Date.parse(approvedAt) + (index + 1) * 1000).toISOString();
    const key = 'transition-' + index;
    const before = original.get(subject)!;
    const result = (await authority.command(request, command(subject, action, epoch, key))).result;
    expect(result).toEqual({
      schemaVersion: '1', identity: subject.identity, idempotencyKey: key, action,
      beforeStatus: before.status, beforeEpoch: epoch, changed, committedAt: now,
      state: {
        schemaVersion: '1', identity: subject.identity, sourceRef: subject.stored.bundle.manifest.sourceRef,
        artifactHash: subject.stored.activation.artifactHash, profileHash: subject.stored.activation.profileHash,
        manifestHash: subject.stored.activation.manifestHash, status, epoch: nextEpoch, changedAt: changed ? now : before.changedAt,
      },
    });
    expect(await authority.read(request, subject.identity)).toEqual(result.state);
    original.set(subject, result.state);
  }
  await expect(authority.command(request, command(a, 'revoke', 4, 'stale-no-op'))).rejects.toMatchObject(failure('STALE', 409));
  for (const action of ['pause', 'resume'] as const) {
    await expect(authority.command(request, command(a, action, 5, 'revoked-' + action)))
      .rejects.toMatchObject(failure('REVOKED', 409));
  }
  const rows = (await runtime.query('SELECT * FROM runtime_authority_commands ORDER BY idempotency_key')).rows;
  expect(rows.map(row => row.idempotency_key)).toEqual(cases.map((_, index) => 'transition-' + index));
  const [resume] = rows.filter(row => row.resume_canonical !== null);
  expect(rows.filter(row => row.resume_canonical !== null)).toHaveLength(1);
  const observation = decodeCanonical(AuthorityResumeObservationV1Schema, resume.resume_canonical, resume.resume_digest);
  expect(observation.observation).toEqual(await source.readCurrentSemantics(a.stored.bundle.manifest.sourceRef));
  expect(observation.startedAt).toBe(observation.completedAt);
  expect(observations).toBe(1);
  const { rows: activity } = await runtime.query('SELECT event FROM activity_events WHERE sequence > $1 ORDER BY sequence', [priorActivity]);
  expect(activity.map(({ event }) => event.type)).toEqual([
    'connection.paused', 'system.status', 'connection.paused', 'connection.revoked', 'connection.revoked',
  ]);
  for (const { event } of activity) {
    const { stored } = event.scope.accountId === a.identity.scope.accountId ? a : b;
    expect(event).toMatchObject({ phase: 'run', stream: 'runtime' });
    expect(event.payload).toEqual({
      status: event.type === 'system.status' ? 'active' : event.type === 'connection.revoked' ? 'revoked' : 'paused',
      artifactHash: stored.activation.artifactHash, profileHash: stored.activation.profileHash, manifestHash: stored.activation.manifestHash,
    });
  }
  expect(await withTransaction(runtime, client => readStoredActivation(client, a.identity.scope))).toEqual(a.stored);
  expect(await withTransaction(runtime, client => readStoredActivation(client, b.identity.scope))).toEqual(b.stored);
  const originalRead = createParentReads(runtime, clock, proofs.scopeReader);
  for (const subject of [a, b]) {
    expect(await originalRead.readActivation(subject.identity.scope.accountId)).toEqual({
      schemaVersion: '1', scope: subject.identity.scope, activation: subject.stored.activation, initialReceipt: subject.stored.receipt,
    });
  }
});

test('binds an occupied key to the full command and reviewer but recovers the original session audit', async () => {
  const authority = service();
  const pause = command(a, 'pause', 1, 'same-account-key');
  const first = await authority.command(request, pause);
  expect(await authority.command(retryRequest, pause)).toEqual({ result: first.result, replayed: true });
  await expect(authority.command(differentReviewerRequest, pause)).rejects.toMatchObject(failure('IDEMPOTENCY_CONFLICT', 409));
  await expect(authority.command(request, { ...pause, action: 'revoke' })).rejects.toMatchObject(failure('IDEMPOTENCY_CONFLICT', 409));
  await expect(authority.command(request, { ...pause, expectedEpoch: 2 })).rejects.toMatchObject(failure('IDEMPOTENCY_CONFLICT', 409));
  expect(await authority.command(request, command(b, 'revoke', 1, pause.idempotencyKey))).toMatchObject({
    replayed: false, result: { identity: b.identity, state: { status: 'revoked', epoch: 2 } },
  });
  const [audit] = (await runtime.query('SELECT * FROM runtime_authority_commands WHERE account_id = $1',
    [a.identity.scope.accountId])).rows;
  expect(decodeCanonical(ReviewerContextSchema, audit.reviewer_canonical, audit.reviewer_digest)).toEqual(reviewer);
  expect(audit.binding_digest).toBe(hashCanonical({ command: pause, reviewerId: reviewer.reviewerId }));
  expect(decodeCanonical(AuthorityStatusResultV1Schema, audit.result_canonical, audit.result_digest)).toEqual(first.result);
  expect(JSON.stringify(first)).not.toContain(reviewer.sessionId);
  expect(Object.keys(authorityModule)).toEqual(['createCurrentAuthority']);
  expect(Object.keys(authority).sort()).toEqual(['command', 'read']);
});

test.each(['activationId', 'bundleHash', 'scope'] as const)(
  'checks the real stored source before exposing occupied-key conflict for a different %s', async field => {
    const authority = service();
    const pause = command(a, 'pause', 1, 'occupied-key');
    await authority.command(request, pause);
    const identity = field === 'activationId' ? { ...a.identity, activationId: 'different-activation' }
      : field === 'bundleHash' ? { ...a.identity, bundleHash: 'f'.repeat(64) }
      : { ...a.identity, scope: { ...a.identity.scope, companyId: 'different-company', sellerEntityId: 'different-seller' } };
    const denied = service({ authorize: async () => ({ ...grants(), allowedSourceRefs: [b.stored.bundle.manifest.sourceRef] }) });
    await expect(denied.command(request, pause)).rejects.toMatchObject(failure('FORBIDDEN', 403));
    await expect(denied.command(request, { ...pause, identity })).rejects.toMatchObject(failure('FORBIDDEN', 403));
    await expect(authority.command(request, { ...pause, identity })).rejects.toMatchObject(failure('IDEMPOTENCY_CONFLICT', 409));
    await expect(authority.command(request, { ...pause, identity, idempotencyKey: 'unused' }))
      .rejects.toMatchObject(failure('NOT_FOUND', 404));
    await expect(authority.read(request, identity)).rejects.toMatchObject(failure('NOT_FOUND', 404));
  },
);

test('retains parsed command, original actor and scope pins across an observer barrier', async () => {
  const pause = await service().command(request, command(a, 'pause', 1, 'pause'));
  const raw = structuredClone(command(a, 'resume', 2, 'resume'));
  const entered = barrier();
  const release = barrier();
  const mutableGrants = grants();
  let admissionCalls = 0;
  const authorize = async () => ++admissionCalls === 1 ? mutableGrants : grants();
  const authority = service({ authorize, observe: async sourceRef => {
    expect(sourceRef).toBe(pause.result.state.sourceRef);
    entered.resolve();
    await release.promise;
    return source.readCurrentSemantics(sourceRef);
  } });
  const pending = authority.command(request, raw);
  try {
    await awaitBarrier(entered.promise, pending);
    // The caller owns these originals, which were already parsed by the service.
    Object.assign(raw, command(b, 'revoke', 1, 'mutated-key'));
    mutableGrants.reviewer.reviewerId = 'mutated-reviewer';
    mutableGrants.reviewer.sessionId = 'mutated-session';
    mutableGrants.allowedSourceRefs.length = 0;
    mutableGrants.allowedAccountIds.length = 0;
  } finally {
    release.resolve();
  }
  expect(await pending).toMatchObject({ replayed: false, result: { action: 'resume', idempotencyKey: 'resume',
    identity: a.identity, state: { status: 'active', epoch: 3 } } });
  expect(admissionCalls).toBe(2);
  const [audit] = (await runtime.query('SELECT * FROM runtime_authority_commands WHERE idempotency_key = $1', ['resume'])).rows;
  expect(decodeCanonical(ReviewerContextSchema, audit.reviewer_canonical, audit.reviewer_digest)).toEqual(reviewer);
  expect(await service().read(request, b.identity)).toMatchObject({ status: 'active', epoch: 1 });
});

function awaitBarrier(entered: Promise<void>, pending: Promise<unknown>) {
  return Promise.race([entered, pending.then(() => { throw new Error('Operation finished before reaching its barrier'); })]);
}

function semanticKey(subject: Subject) {
  const profile = subject.stored.bundle.profiles.find(item => item.hash === subject.stored.activation.profileHash)!;
  return profile.scope.sellerEntityId + '/' + profile.sourceAccountIds[0];
}

async function expectNoRuntimeTransaction() {
  const { rows: [row] } = await runtime.query(
    `SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND usename = $1 AND pid <> pg_backend_pid() AND xact_start IS NOT NULL`,
    [pair.runtime.appRole],
  );
  expect(row.count).toBe(0);
}

test('resume requires the pinned source and approved account revisions, and runs observation and admission outside runtime SQL', async () => {
  const authority = service();
  await authority.command(request, command(a, 'pause', 1, 'pause'));
  const resume = command(a, 'resume', 2, 'resume');
  const actual = await source.readCurrentSemantics(a.stored.bundle.manifest.sourceRef);
  const approvedKey = semanticKey(a);
  expect(actual.versions[approvedKey]).toBe(a.stored.bundle.manifest.semanticVersions[approvedKey]);
  const missing = { ...actual.versions };
  delete missing[approvedKey];
  for (const observed of [
    { ...actual, sourceRef: b.stored.bundle.manifest.sourceRef },
    { ...actual, versions: { ...actual.versions, '*': 'unknown' } },
    { ...actual, versions: missing },
    { ...actual, versions: { ...actual.versions, [approvedKey]: 'changed-approval' } },
  ]) {
    await expect(service({ observe: async () => observed }).command(request, resume))
      .rejects.toMatchObject(failure('SEMANTICS_MISMATCH', 409));
  }
  const malformed = { ...actual, extra: true };
  await expect(service({ observe: async () => malformed }).command(request, resume))
    .rejects.toMatchObject(failure('SEMANTICS_UNAVAILABLE', 503));
  await expect(service({ observe: async () => { throw new Error('private source diagnostic'); } }).command(request, resume))
    .rejects.toMatchObject({ ...failure('SEMANTICS_UNAVAILABLE', 503), message: 'Current source semantics are unavailable' });
  expect(await authority.read(request, a.identity)).toMatchObject({ status: 'paused', epoch: 2 });
  expect((await runtime.query('SELECT idempotency_key FROM runtime_authority_commands')).rows).toEqual([{ idempotency_key: 'pause' }]);

  const independent = Object.keys(actual.versions).find(key => key !== approvedKey && key !== '*');
  expect(independent).toBeDefined();
  const operatorToken = 'authority-test-source-operator';
  const operator = createScenarioAdmin(proofs.dependencies, { DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operatorToken });
  await operator.semanticChangeA(operatorToken, {
    id: 'authority-independent-change', accountId: independent!.split('/')[1]!,
    observedAt: approvedAt, effectiveDate: '2026-11-01', revision: 'changed-other-account',
  });
  const observedModes: string[] = [];
  const allowed = service({
    authorize: async (_handle, mode) => {
      await expectNoRuntimeTransaction();
      observedModes.push(mode);
      return grants();
    },
    observe: async sourceRef => {
      await expectNoRuntimeTransaction();
      expect(sourceRef).toBe(actual.sourceRef);
      const current = await source.readCurrentSemantics(sourceRef);
      expect(current.versions[independent!]).toBe('changed-other-account');
      return current;
    },
  });
  expect(await allowed.command(request, resume)).toMatchObject({ replayed: false,
    result: { state: { status: 'active', epoch: 3 } } });
  expect(observedModes).toEqual(['mutation', 'mutation']);
});

test('pause, revoke, no-op and replay survive source outage and missing activation setup files', async () => {
  const publication = join(proofs.registryRoot, 'activation-registry', 'current.json');
  await rename(proofs.policyPath, proofs.policyPath + '.parked');
  try {
    await rename(publication, publication + '.parked');
    try {
      let observations = 0;
      const authority = service({ observe: async () => { observations++; throw new Error('source unavailable'); } });
      await authority.command(request, command(a, 'resume', 1, 'active-no-op'));
      const pause = command(a, 'pause', 1, 'pause');
      const first = await authority.command(request, pause);
      await authority.command(request, command(a, 'revoke', 2, 'revoke'));
      expect(await authority.command(request, pause)).toEqual({ result: first.result, replayed: true });
      expect(await authority.read(request, a.identity)).toMatchObject({ status: 'revoked', epoch: 3 });
      expect(observations).toBe(0);
    } finally {
      await rename(publication + '.parked', publication);
    }
  } finally {
    await rename(proofs.policyPath + '.parked', proofs.policyPath);
  }
});

test.each(['account', 'source', 'session'] as const)(
  'checks fresh %s permission before committing after a paused resume observation', async permission => {
    await service().command(request, command(a, 'pause', 1, 'pause'));
    const entered = barrier();
    const release = barrier();
    const current = grants();
    const authority = service({
      authorize: async () => current,
      observe: async sourceRef => { entered.resolve(); await release.promise; return source.readCurrentSemantics(sourceRef); },
    });
    const pending = authority.command(request, command(a, 'resume', 2, 'resume'));
    try {
      await awaitBarrier(entered.promise, pending);
      if (permission === 'account') current.allowedAccountIds = [];
      else if (permission === 'source') current.allowedSourceRefs = [];
      else current.reviewer.sessionId = 'changed-session';
    } finally {
      release.resolve();
    }
    await expect(pending).rejects.toMatchObject(failure('FORBIDDEN', 403));
    expect(await service().read(request, a.identity)).toMatchObject({ status: 'paused', epoch: 2 });
    expect((await runtime.query('SELECT idempotency_key FROM runtime_authority_commands')).rows).toEqual([{ idempotency_key: 'pause' }]);
  },
);

test.each(['allowed', 'account', 'source', 'session', 'conflict'] as const)(
  'checks fresh admission for %s recovery after a failed observation and concurrent winner', async permission => {
    const healthy = service();
    await healthy.command(request, command(a, 'pause', 1, 'pause'));
    const resume = command(a, 'resume', 2, 'resume');
    const entered = barrier();
    const release = barrier();
    const current = grants();
    const flaky = service({
      authorize: async () => current,
      observe: async () => { entered.resolve(); await release.promise; throw new Error('source unavailable'); },
    });
    const pending = flaky.command(request, resume);
    let winner;
    try {
      await awaitBarrier(entered.promise, pending);
      winner = await healthy.command(permission === 'conflict' ? differentReviewerRequest : retryRequest, resume);
      if (permission === 'account') current.allowedAccountIds = [];
      else if (permission === 'source') current.allowedSourceRefs = [];
      else if (permission === 'session') current.reviewer.sessionId = 'changed-session';
    } finally {
      release.resolve();
    }
    if (permission === 'allowed') expect(await pending).toEqual({ result: winner.result, replayed: true });
    else await expect(pending).rejects.toMatchObject(permission === 'conflict'
      ? failure('IDEMPOTENCY_CONFLICT', 409) : failure('FORBIDDEN', 403));
    expect((await runtime.query('SELECT count(*)::int AS count FROM runtime_authority_commands')).rows[0].count).toBe(2);
  },
);

test('cannot restore a revoked grant using the earlier resume observation', async () => {
  const healthy = service();
  await healthy.command(request, command(a, 'pause', 1, 'pause'));
  const entered = barrier();
  const release = barrier();
  const authority = service({ observe: async sourceRef => {
    const observed = await source.readCurrentSemantics(sourceRef);
    entered.resolve();
    await release.promise;
    return observed;
  } });
  const pending = authority.command(request, command(a, 'resume', 2, 'resume'));
  try {
    await awaitBarrier(entered.promise, pending);
    await healthy.command(request, command(a, 'revoke', 2, 'revoke'));
  } finally {
    release.resolve();
  }
  await expect(pending).rejects.toMatchObject(failure('STALE', 409));
  expect(await healthy.read(request, a.identity)).toMatchObject({ status: 'revoked', epoch: 3 });
  expect((await runtime.query('SELECT idempotency_key FROM runtime_authority_commands ORDER BY idempotency_key')).rows)
    .toEqual([{ idempotency_key: 'pause' }, { idempotency_key: 'revoke' }]);
});

async function waitForBlocked(expected: number) {
  const end = performance.now() + 1200;
  do {
    const { rows: [row] } = await runtime.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0`,
    );
    if (row!.count >= expected) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  } while (performance.now() < end);
  throw new Error('Expected runtime transaction lock was never observed');
}

function settled<T>(pending: Promise<T>) {
  return pending.then(value => ({ value }), (error: unknown) => ({ error }));
}

test.each(['duplicate', 'conflict', 'stale'] as const)(
  'serializes concurrent first commands with a %s waiter under the actual account lock', async variant => {
    const authority = service();
    const firstCommand = command(a, 'pause', 1, 'first');
    const secondCommand = variant === 'duplicate' ? firstCommand
      : command(a, 'revoke', 1, variant === 'conflict' ? firstCommand.idempotencyKey : 'second');
    const blocker = await runtime.connect();
    let first;
    let second;
    try {
      await blocker.query('BEGIN');
      await lockParentKeys(blocker, [canonicalJson(['parent-scope', a.identity.scope.accountId])]);
      first = settled(authority.command(request, firstCommand));
      await waitForBlocked(1);
      second = settled(authority.command(request, secondCommand));
      await waitForBlocked(2);
      expect((await runtime.query('SELECT 1 FROM runtime_authority_heads')).rows).toEqual([]);
    } finally {
      try { await blocker.query('ROLLBACK'); } finally { blocker.release(); }
    }
    const winner = await first;
    expect(winner).toMatchObject({ value: { replayed: false, result: { state: { status: 'paused', epoch: 2 } } } });
    if (variant === 'duplicate' && 'value' in winner) {
      expect(await second).toEqual({ value: { result: winner.value.result, replayed: true } });
    } else {
      expect(await second).toMatchObject({ error: failure(variant === 'conflict' ? 'IDEMPOTENCY_CONFLICT' : 'STALE', 409) });
    }
    expect((await runtime.query('SELECT count(*)::int AS count FROM runtime_authority_heads')).rows[0].count).toBe(1);
    expect((await runtime.query('SELECT count(*)::int AS count FROM runtime_authority_commands')).rows[0].count).toBe(1);
  },
);

test('rechecks a newly occupied key under the lock before reporting a stale epoch', async () => {
  const healthy = service();
  const entry = barrier();
  const release = barrier();
  let authorizations = 0;
  const delayed = service({
    authorize: async () => {
      if (++authorizations === 2) {
        entry.resolve();
        await release.promise;
      }
      return grants();
    },
  });
  const input = command(a, 'pause', 1, 'appears-under-lock');
  const pending = delayed.command(request, input);
  try {
    await awaitBarrier(entry.promise, pending);
    await healthy.command(request, { ...input, action: 'revoke' });
  } finally {
    release.resolve();
  }
  await expect(pending).rejects.toMatchObject(failure('IDEMPOTENCY_CONFLICT', 409));
  expect(await healthy.read(request, a.identity)).toMatchObject({ status: 'revoked', epoch: 2 });
});

test('the future writer fence holds scope and head through transaction end and revoke fences an old epoch', async () => {
  const authority = service();
  const client = await runtime.connect();
  let revoke;
  try {
    await client.query('BEGIN');
    const locked = await lockCurrentAuthority(client, a.identity);
    expect(assertActiveAuthority(client, locked, 1)).toMatchObject({ status: 'active', epoch: 1 });
    expect(() => assertActiveAuthority(client, locked, 2)).toThrow(expect.objectContaining(failure('STALE', 409)));
    expect(() => assertActiveAuthority(client, { ...locked }, 1)).toThrow(expect.objectContaining(failure('UNAVAILABLE', 503)));
    const foreign = await runtime.connect();
    try {
      expect(() => assertActiveAuthority(foreign, locked, 1)).toThrow(expect.objectContaining(failure('UNAVAILABLE', 503)));
    } finally {
      foreign.release();
    }
    revoke = settled(authority.command(request, command(a, 'revoke', 1, 'revoke')));
    await waitForBlocked(1);
    expect(assertActiveAuthority(client, locked, 1)).toMatchObject({ status: 'active', epoch: 1 });
    expect((await runtime.query('SELECT 1 FROM runtime_authority_commands')).rows).toEqual([]);
  } finally {
    try { await client.query('COMMIT'); } finally { client.release(); }
  }
  expect(await revoke).toMatchObject({ value: { result: { state: { status: 'revoked', epoch: 2 } } } });
  await withTransaction(runtime, async transaction => {
    const locked = await lockCurrentAuthority(transaction, a.identity);
    expect(() => assertActiveAuthority(transaction, locked, 1)).toThrow(expect.objectContaining(failure('INACTIVE', 409)));
  });
});

function instrumentPool(
  pool: Pool, intercept: (client: PoolClient, sql: string, proceed: () => Promise<unknown>) => Promise<unknown>,
) {
  const wrapped = new WeakSet<PoolClient>();
  pool.on('acquire', client => {
    if (wrapped.has(client)) return;
    wrapped.add(client);
    client.query = new Proxy(client.query, {
      apply(query, receiver, args) {
        const proceed = () => Reflect.apply(query, receiver, args) as Promise<unknown>;
        return typeof args[0] === 'string' ? intercept(client, args[0], proceed) : proceed();
      },
    });
  });
}

test('a concurrent pause cannot split the import, target and head reads across snapshots', async () => {
  const pool = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  const entered = barrier();
  const release = barrier();
  const clients = new Set<PoolClient>();
  const tables: string[] = [];
  instrumentPool(pool, async (client, sql, proceed) => {
    clients.add(client);
    const table = /FROM (runtime_activation_imports|parent_snapshots|runtime_authority_heads|runtime_authority_commands)/.exec(sql)?.[1];
    if (table) tables.push(table);
    if (table === 'runtime_authority_heads') {
      const settings = await client.query('SHOW transaction_isolation');
      expect(settings.rows).toEqual([{ transaction_isolation: 'repeatable read' }]);
      expect((await client.query('SHOW transaction_read_only')).rows).toEqual([{ transaction_read_only: 'on' }]);
      entered.resolve();
      await release.promise;
    }
    return proceed();
  });
  const pending = service({ db: pool }).read(request, a.identity);
  try {
    await awaitBarrier(entered.promise, pending);
    await service().command(request, command(a, 'pause', 1, 'concurrent-pause'));
  } finally {
    release.resolve();
    await pool.end();
  }
  expect(await pending).toMatchObject({ status: 'active', epoch: 1, identity: a.identity });
  expect(tables).toEqual(['runtime_activation_imports', 'parent_snapshots', 'runtime_authority_heads', 'runtime_authority_commands']);
  expect(clients.size).toBe(1);
  expect(await service().read(request, a.identity)).toMatchObject({ status: 'paused', epoch: 2, identity: a.identity });
});

async function activityHead() {
  return (await runtime.query('SELECT sequence FROM activity_counter')).rows[0]!.sequence;
}

async function installActivityFailure(body: string) {
  await withTransaction(owner, async client => {
    await client.query(`CREATE FUNCTION test_authority_activity_failure() RETURNS TRIGGER LANGUAGE plpgsql
      AS $$ BEGIN ${body} RETURN NEW; END; $$`);
    await client.query(`CREATE TRIGGER test_authority_activity_failure BEFORE INSERT ON activity_events
      FOR EACH ROW EXECUTE FUNCTION test_authority_activity_failure()`);
  });
}

async function removeActivityFailure() {
  await withTransaction(owner, async client => {
    await client.query('DROP TRIGGER test_authority_activity_failure ON activity_events');
    await client.query('DROP FUNCTION test_authority_activity_failure()');
  });
}

test('activity failure rolls back first materialization, audit and counter, then a restarted pool recovers the retry', async () => {
  const initialCounter = await activityHead();
  const pause = command(a, 'pause', 1, 'rollback-pause');
  await installActivityFailure("RAISE EXCEPTION 'private DB diagnostic';");
  try {
    await expect(service().command(request, pause)).rejects.toMatchObject({
      ...failure('UNAVAILABLE', 503), message: 'Current authority is unavailable',
    });
    expect((await runtime.query('SELECT 1 FROM runtime_authority_heads')).rows).toEqual([]);
    expect((await runtime.query('SELECT 1 FROM runtime_authority_commands')).rows).toEqual([]);
    expect(await activityHead()).toBe(initialCounter);
  } finally {
    await removeActivityFailure();
  }
  const committed = await service().command(request, pause);
  const reopened = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  try {
    expect(await service({ db: reopened }).command(request, pause)).toEqual({ result: committed.result, replayed: true });
    expect(Number(await activityHead())).toBe(Number(initialCounter) + 1);
  } finally {
    await reopened.end();
  }
});

test('a SQL serialization retry reacquires the locks and observes an intervening committed epoch', async () => {
  const initialCounter = Number(await activityHead());
  await owner.query('CREATE SEQUENCE test_authority_retry_once');
  try {
    await installActivityFailure(`IF NEW.event->>'type' = 'connection.paused' AND
      nextval('test_authority_retry_once') = 1 THEN
      RAISE EXCEPTION 'one-shot serialization test' USING ERRCODE = '40001';
    END IF;`);
    try {
      await owner.query('GRANT USAGE ON SEQUENCE test_authority_retry_once TO "' + pair.runtime.appRole + '"');
      const pool = createRuntimeDb({ connectionString: pair.runtime.appUrl });
      const retrying = barrier();
      const release = barrier();
      let lockAttempts = 0;
      let rollbacks = 0;
      instrumentPool(pool, async (_client, sql, proceed) => {
        if (sql === 'ROLLBACK') rollbacks++;
        if (sql.startsWith('SELECT pg_advisory_xact_lock') && ++lockAttempts === 2) {
          retrying.resolve();
          await release.promise;
        }
        return proceed();
      });
      const pending = service({ db: pool }).command(request, command(a, 'pause', 1, 'serialization-loser'));
      try {
        await awaitBarrier(retrying.promise, pending);
        expect(rollbacks).toBe(1);
        expect(Number(await activityHead())).toBe(initialCounter);
        await service().command(request, command(a, 'revoke', 1, 'intervening-revoke'));
      } finally {
        release.resolve();
        await pool.end();
      }
      await expect(pending).rejects.toMatchObject(failure('STALE', 409));
      expect(lockAttempts).toBe(2);
      expect(rollbacks).toBe(2);
      expect(Number(await activityHead())).toBe(initialCounter + 1);
      expect((await runtime.query('SELECT idempotency_key FROM runtime_authority_commands')).rows)
        .toEqual([{ idempotency_key: 'intervening-revoke' }]);
      expect(await service().read(request, a.identity)).toMatchObject({ status: 'revoked', epoch: 2 });
    } finally {
      await removeActivityFailure();
    }
  } finally {
    await owner.query('DROP SEQUENCE test_authority_retry_once');
  }
});

async function fixtureOverride(table: string, statement: string, values: unknown[] = []) {
  return withTransaction(owner, async client => {
    await client.query('ALTER TABLE ' + table + ' DISABLE TRIGGER USER');
    const result = await client.query(statement, values);
    await client.query('ALTER TABLE ' + table + ' ENABLE TRIGGER USER');
    return result.rows;
  });
}

test('restricts app-role privileges to append-only commands and the three mutable head columns', async () => {
  await service().command(request, command(a, 'pause', 1, 'privilege-proof'));
  const { rows: privileges } = await runtime.query(`
    SELECT table_name, privilege, has_table_privilege(table_name, privilege) AS granted
    FROM unnest(ARRAY['runtime_authority_heads', 'runtime_authority_commands']) AS table_name,
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS privilege
    ORDER BY table_name, privilege
  `);
  expect(privileges.filter(row => row.granted).map(({ table_name, privilege }) => [table_name, privilege])).toEqual([
    ['runtime_authority_commands', 'INSERT'], ['runtime_authority_commands', 'SELECT'],
    ['runtime_authority_heads', 'INSERT'], ['runtime_authority_heads', 'SELECT'],
  ]);
  const { rows: columns } = await runtime.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name IN ('runtime_authority_heads', 'runtime_authority_commands')
      AND has_column_privilege(table_name, column_name, 'UPDATE')
    ORDER BY table_name, column_name
  `);
  expect(columns).toEqual(['changed_at', 'epoch', 'status'].map(column_name => ({ table_name: 'runtime_authority_heads', column_name })));
  for (const statement of [
    'DELETE FROM runtime_authority_heads',
    'DELETE FROM runtime_authority_commands',
    'TRUNCATE runtime_authority_commands, runtime_authority_heads',
    'UPDATE runtime_authority_heads SET grant_digest = grant_digest',
    'UPDATE runtime_authority_commands SET command_digest = command_digest',
  ]) {
    await expect(runtime.query(statement)).rejects.toMatchObject({ code: '42501' });
  }

  const { rows: foreignKeys } = await runtime.query(`
    SELECT conrelid::regclass::text AS table_name, confrelid::regclass::text AS parent,
           confupdtype AS update, confdeltype AS delete, cardinality(conkey) AS columns
    FROM pg_constraint WHERE contype = 'f' AND conrelid IN (
      'runtime_authority_heads'::regclass, 'runtime_authority_commands'::regclass
    ) ORDER BY table_name, parent
  `);
  expect(foreignKeys).toEqual([
    { table_name: 'runtime_authority_commands', parent: 'runtime_activation_imports', update: 'r', delete: 'r', columns: 5 },
    { table_name: 'runtime_authority_commands', parent: 'runtime_authority_heads', update: 'r', delete: 'r', columns: 5 },
    { table_name: 'runtime_authority_heads', parent: 'runtime_activation_imports', update: 'r', delete: 'r', columns: 5 },
  ]);
  await expect(owner.query('DELETE FROM runtime_authority_heads')).rejects.toMatchObject({ code: '23514' });
  await expect(owner.query('DELETE FROM runtime_authority_commands')).rejects.toMatchObject({ code: '55000' });
  await expect(fixtureOverride('runtime_authority_heads', 'DELETE FROM runtime_authority_heads'))
    .rejects.toMatchObject({ code: '23001' });
  const initial = await service().read(request, b.identity);
  await expect(runtime.query(
    `INSERT INTO runtime_authority_heads (account_id, company_id, seller_entity_id, initial_import_key,
      initial_receipt_id, grant_canonical, grant_digest, status, epoch, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 1, $8)`,
    [b.identity.scope.accountId, b.identity.scope.companyId, b.identity.scope.sellerEntityId,
      b.stored.request.idempotencyKey, a.stored.receipt.id, ...encodeCanonical(initial), initial.changedAt],
  )).rejects.toMatchObject({ code: '23503' });
});

test('retention fails closed for reads, fresh commands and exact retries after owner-simulated head loss', async () => {
  const authority = service();
  const pause = command(a, 'pause', 1, 'survives-missing-head');
  await authority.command(request, pause);
  const { rows: [constraint] } = await owner.query(`
    SELECT quote_ident(conname) AS name, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE contype = 'f' AND conrelid = 'runtime_authority_commands'::regclass
      AND confrelid = 'runtime_authority_heads'::regclass
  `);
  const [head] = await withTransaction(owner, async client => {
    // Model corruption inside this disposable owner fixture, outside normal app privileges.
    await client.query('ALTER TABLE runtime_authority_commands DROP CONSTRAINT ' + constraint.name);
    await client.query('ALTER TABLE runtime_authority_heads DISABLE TRIGGER USER');
    const { rows } = await client.query('DELETE FROM runtime_authority_heads RETURNING *');
    await client.query('ALTER TABLE runtime_authority_heads ENABLE TRIGGER USER');
    return rows;
  });
  try {
    await expect(authority.read(request, a.identity)).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    await expect(authority.command(request, pause)).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    await expect(authority.command(request, { ...pause, idempotencyKey: 'unused' }))
      .rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    await expect(withTransaction(runtime, client => lockCurrentAuthority(client, a.identity, pause.idempotencyKey)))
      .rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    expect((await runtime.query('SELECT 1 FROM runtime_authority_heads')).rows).toEqual([]);
    expect((await runtime.query('SELECT idempotency_key FROM runtime_authority_commands')).rows)
      .toEqual([{ idempotency_key: pause.idempotencyKey }]);
  } finally {
    await withTransaction(owner, async client => {
      await client.query('ALTER TABLE runtime_authority_heads DISABLE TRIGGER USER');
      await client.query(
        `INSERT INTO runtime_authority_heads
          (account_id, company_id, seller_entity_id, initial_import_key, initial_receipt_id,
           grant_canonical, grant_digest, status, epoch, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [head.account_id, head.company_id, head.seller_entity_id, head.initial_import_key, head.initial_receipt_id,
          head.grant_canonical, head.grant_digest, head.status, head.epoch, head.changed_at],
      );
      await client.query('ALTER TABLE runtime_authority_heads ENABLE TRIGGER USER');
      await client.query('ALTER TABLE runtime_authority_commands ADD CONSTRAINT ' + constraint.name + ' ' + constraint.definition);
    });
  }
});

test('rejects corrupt A5 bytes and authority grant pins rather than projecting initial authority', async () => {
  const authority = service();
  const { rows: [original] } = await runtime.query(
    'SELECT bundle_digest FROM runtime_activation_imports WHERE account_id = $1', [a.identity.scope.accountId],
  );
  const replaceBundleDigest = (digest: string) => fixtureOverride('runtime_activation_imports',
    'UPDATE runtime_activation_imports SET bundle_digest = $2 WHERE account_id = $1', [a.identity.scope.accountId, digest]);
  await replaceBundleDigest('0'.repeat(64));
  try {
    await expect(authority.read(request, a.identity)).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    await expect(authority.command(request, command(a, 'pause', 1, 'bad-bundle'))).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
  } finally {
    await replaceBundleDigest(original.bundle_digest);
  }
  const pause = command(a, 'pause', 1, 'bad-grant');
  await authority.command(request, pause);
  const [head] = (await runtime.query('SELECT grant_canonical, grant_digest FROM runtime_authority_heads')).rows;
  const invalidPin = { ...JSON.parse(head.grant_canonical), profileHash: 'f'.repeat(64) };
  const replaceGrant = (canonical: string, digest: string) => fixtureOverride('runtime_authority_heads',
    'UPDATE runtime_authority_heads SET grant_canonical = $1, grant_digest = $2', [canonical, digest]);
  await replaceGrant(...encodeCanonical(invalidPin));
  try {
    await expect(authority.read(request, a.identity)).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    await expect(authority.command(request, pause)).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
  } finally {
    await replaceGrant(head.grant_canonical, head.grant_digest);
  }
});

test('rejects occupied corrupt audit bindings before recovering an exact result or reporting conflict', async () => {
  const authority = service();
  const initialNoOp = command(a, 'resume', 1, 'initial-no-op');
  const noOpResult = (await authority.command(request, initialNoOp)).result;
  now = '2026-11-09T08:01:00.000Z';
  const pause = command(a, 'pause', 1, 'pause');
  const paused = (await authority.command(request, pause)).result;
  const pausedNoOp = command(a, 'pause', 2, 'paused-no-op');
  const pausedNoOpResult = (await authority.command(request, pausedNoOp)).result;
  const resume = command(a, 'resume', 2, 'resume');
  await authority.command(request, resume);
  await authority.command(request, command(a, 'revoke', 3, 'revoke'));
  expect((await authority.command(request, pausedNoOp)).result).toEqual(pausedNoOpResult);

  const [resumeRow] = (await runtime.query('SELECT resume_canonical FROM runtime_authority_commands WHERE idempotency_key = $1',
    [resume.idempotencyKey])).rows;
  const wrongResume = JSON.parse(resumeRow.resume_canonical);
  wrongResume.observation.sourceRef = b.stored.bundle.manifest.sourceRef;
  const cases = [
    { input: pause, columns: ['reviewer_digest'], values: ['f'.repeat(64)] },
    { input: pause, columns: ['binding_digest'], values: ['f'.repeat(64)] },
    { input: pause, columns: ['result_canonical', 'result_digest'],
      values: encodeCanonical({ ...paused, action: 'revoke', state: { ...paused.state, status: 'revoked' } }) },
    { input: pause, columns: ['result_canonical', 'result_digest'],
      values: encodeCanonical({ ...paused, beforeEpoch: 2, state: { ...paused.state, epoch: 3 } }) },
    { input: resume, columns: ['resume_canonical', 'resume_digest'], values: encodeCanonical(wrongResume) },
    { input: initialNoOp, columns: ['result_canonical', 'result_digest'],
      values: encodeCanonical({ ...noOpResult, state: { ...noOpResult.state, changedAt: now } }) },
    { input: pausedNoOp, columns: ['result_canonical', 'result_digest'],
      values: encodeCanonical({ ...pausedNoOpResult, state: { ...pausedNoOpResult.state, changedAt: approvedAt } }) },
  ];
  for (const { input, columns, values } of cases) {
    const original = (await runtime.query('SELECT * FROM runtime_authority_commands WHERE idempotency_key = $1', [input.idempotencyKey])).rows[0];
    const patch = (args: string[]) => fixtureOverride('runtime_authority_commands',
      'UPDATE runtime_authority_commands SET ' + columns.map((name, index) => name + ' = $' + (index + 2)).join(', ') +
      ' WHERE idempotency_key = $1', [input.idempotencyKey, ...args]);
    await patch(values);
    try {
      await expect(authority.command(request, input)).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
      await expect(authority.command(request, { ...input, identity: { ...a.identity, activationId: 'wrong-activation' } }))
        .rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    } finally {
      await patch(columns.map(name => original[name]));
    }
  }
});

test('head trigger prevents reset, impossible transitions and mutable changes on no-op', async () => {
  const authority = service();
  await authority.command(request, command(a, 'pause', 1, 'pause'));
  for (const statement of [
    'UPDATE runtime_authority_heads SET epoch = 1',
    'UPDATE runtime_authority_heads SET epoch = epoch + 1',
    "UPDATE runtime_authority_heads SET status = 'active'",
    "UPDATE runtime_authority_heads SET status = 'active', epoch = 1",
    "UPDATE runtime_authority_heads SET changed_at = '2026-11-10T00:00:00.000Z'",
  ]) {
    await expect(runtime.query(statement)).rejects.toMatchObject({ code: '23514' });
  }
  await authority.command(request, command(a, 'revoke', 2, 'revoke'));
  await expect(runtime.query("UPDATE runtime_authority_heads SET status = 'active', epoch = 4"))
    .rejects.toMatchObject({ code: '23514' });
  await expect(owner.query("UPDATE runtime_authority_heads SET grant_digest = repeat('f', 64)"))
    .rejects.toMatchObject({ code: '23514' });
  expect(await authority.read(request, a.identity)).toMatchObject({ status: 'revoked', epoch: 3 });
});

test('rejects transitions at the maximum safe epoch and retains same-epoch no-op results', async () => {
  const authority = service();
  await authority.command(request, command(a, 'resume', 1, 'seed-head'));
  const maximum = Number.MAX_SAFE_INTEGER;
  const replaceEpoch = (epoch: string | number) =>
    fixtureOverride('runtime_authority_heads', 'UPDATE runtime_authority_heads SET epoch = $1', [epoch]);
  await expect(replaceEpoch('9007199254740992')).rejects.toMatchObject({ code: '23514' });
  await expect(replaceEpoch(0)).rejects.toMatchObject({ code: '23514' });
  await replaceEpoch(maximum);
  now = '2026-11-09T08:02:00.000Z';
  await expect(authority.command(request, command(a, 'pause', maximum, 'reuse-after-failure')))
    .rejects.toMatchObject(failure('EPOCH_EXHAUSTED', 409));
  const noOp = command(a, 'resume', maximum, 'reuse-after-failure');
  const result = await authority.command(request, noOp);
  expect(result).toMatchObject({ replayed: false,
    result: { changed: false, committedAt: now, state: { status: 'active', epoch: maximum, changedAt: approvedAt } } });
  expect(await authority.command(request, noOp)).toEqual({ result: result.result, replayed: true });
});
