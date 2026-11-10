import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer, request, type OutgoingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { inspect } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import {
  ApiErrorSchema, AuthorityAdmissionCheckV1Schema, AuthorityStatusResponseV1Schema, canonicalJson, ConnectionStateV1Schema,
  CurrentAuthorityV1Schema, CustomerProfileSchema, hashProfile, LocalSessionResponseSchema, ReviewPackageSchema,
  type AuthorityAdmissionCheckV1, type CurrentAuthorityV1,

} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { createSourceService, readEvidence } from '@eapr/sources';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { readActivationBundle } from '@eapr/storage/activation-registry';
import { createControlDb } from '@eapr/storage/control-db';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import { composeActivationReview } from '../../apps/control/src/activation-composition.js';
import { createRegisteredScopePublication } from '../../apps/control/src/activation-publication.js';
import { composeAuthorityOperations } from '../../apps/control/src/authority-composition.js';
import { createAuthorityWorkerClient } from '../../apps/control/src/authority-worker-client.js';
import { createLocalComposition, localSourceCatalog } from '../../apps/control/src/composition.js';
import { createLocalSessionService, type LocalReviewerContext } from '../../apps/control/src/local-session.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { createReviewRepository } from '../../apps/control/src/review-repository.js';
import { createParentProxyPlugin } from '../../apps/control/src/routes/parent.js';
import { composeSourceSemantics } from '../../apps/control/src/source-semantics-composition.js';
import { buildControl, createWorkerClient } from '../../apps/control/src/server.js';
import { createWorkerActivation } from '../../apps/worker/src/activation.js';
import { composeWorkerAuthority } from '../../apps/worker/src/authority-composition.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { buildWorker } from '../../apps/worker/src/server.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { issueActivationProofs, verifyOriginals } from '../fixtures/activation-proof.js';
import { testNamespace } from '../fixtures/harness.js';

const namespace = testNamespace('authorityin');
const controlPort = localPort('EAPR_CONTROL_PORT', 3001);
const controlOrigin = 'http://127.0.0.1:' + controlPort;
const webOrigin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
const serviceToken = 'fixture-authority-worker';
const sourceToken = 'fixture-authority-source';
const admissionToken = 'fixture-authority-admission';
const approvedAt = '2026-11-09T08:00:00.000Z';
let now = approvedAt;
const clock = () => new Date(now);
const migrations = readMigrationCatalog();

let pair: Awaited<ReturnType<typeof provisionTest>> | undefined;
let root: string | undefined;
let db: Pool;
let runtime: Pool;
let owner: Pool;
let proofs: Awaited<ReturnType<typeof issueActivationProofs>>;
let worker: FastifyInstance | undefined;
let control: FastifyInstance | undefined;
let workerOrigin: string;
let subjects: Record<'a' | 'b', CurrentAuthorityV1>;
let publishedOnly: string;
let initialFinancialState: Awaited<ReturnType<typeof financialState>>;
let initialControlState: Awaited<ReturnType<typeof controlHistory>>;
const unknown = 'authority-missing-fixture-account';
const callbackPath = '/internal/authority-admissions/check';
const secrets = new Set([serviceToken, sourceToken, admissionToken]);
const auditSessions = new Set<string>();
const safeOutput: string[] = [];
const capturedLogs: string[] = [];
const nativeFetch = globalThis.fetch;
type Trace = { checkedOut: number; open: number; steps: string[] };
const traceContext = new AsyncLocalStorage<Trace>();
const traces: Trace[] = [];
const boundaryViolations: string[] = [];
let lastCheck: AuthorityAdmissionCheckV1 | undefined;
let beforeObservation: (() => Promise<void>) | undefined;
let beforeScopeLock: (() => Promise<void>) | undefined;
let onWorkerSignal: ((signal: AbortSignal) => void) | undefined;
let onCallbackReply: ((response: Response) => Promise<void>) | undefined;
let sourceOutage = false;
let callbackOutage = false;


function captureAuthorityLogs(app: FastifyInstance) {
  app.setChildLoggerFactory((_parent, _bindings, _options, raw) => {
    const record = (...args: unknown[]) => {
      // Apply the request/response projections used by Fastify's logger. A raw inspection
      // of its log arguments would capture the in-memory socket and session request.
      const serialized = args.map(value => {
        if (!value || typeof value !== 'object') return value;
        const { req, res, ...fields } = value as { req?: FastifyRequest; res?: FastifyReply };
        if (req === undefined && res === undefined) return value;
        return { ...fields,
          ...(req === undefined ? {} : { req: req.raw === raw ? { method: req.method, url: req.url } : req }),
          ...(res === undefined ? {} : { res: res.request?.raw === raw ? { statusCode: res.statusCode } : res }),
        };
      });
      capturedLogs.push(inspect(serialized, { customInspect: false, depth: 4 }));
    };
    const logger: FastifyBaseLogger = {
      level: 'info', fatal: record, error: record, warn: record, info: record,
      debug: record, trace: record, silent: record, child: () => logger,
    };
    return logger;
  });
  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/api/connections/') || req.url.startsWith('/internal/connections/') || req.url === callbackPath) {
      req.log.info({ statusCode: reply.statusCode }, 'Authority fixture response');
    }
  });
}

function closeControlConnections(app: FastifyInstance) {
  // Each fixture restart reuses the leased origin. Retire the old HTTP connections before rebinding.
  app.addHook('onRequest', async (_req, reply) => { reply.header('Connection', 'close'); });
}

function controlApp(featurePlugins: Parameters<typeof buildControl>[0]['featurePlugins']) {
  const app = buildControl({ db, clock, workerClient: createWorkerClient(workerOrigin, serviceToken),
    expectedMigrations: migrationIdentities(migrations.control), featurePlugins });
  closeControlConnections(app);
  return app;
}

async function bootstrap(origin = controlOrigin) {
  const response = await fetch(origin + '/api/local-session', {
    method: 'POST', headers: { origin: webOrigin, 'x-eapr-local-ui': '1', 'content-type': 'application/json' },
    body: '{}',
  });
  expect(response.status).toBe(200);
  const session = LocalSessionResponseSchema.parse(await response.json());
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Missing fixture reviewer cookie');
  secrets.add(cookie.slice(cookie.indexOf('=') + 1));
  secrets.add(session.csrfToken);
  auditSessions.add(session.reviewer.sessionId);
  return { session, headers: { origin: webOrigin, cookie, 'x-eapr-csrf': session.csrfToken } };
}

async function post(path: string, headers: Record<string, string>, value: unknown) {
  return fetch(controlOrigin + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value),
  });
}

async function approveBoth() {
  const reviewer = createLocalSessionService({ webOrigin, reviewerId: 'activation-reviewer',
    allowedAccountIds: [proofs.a.accountId, proofs.b.accountId],
    allowedSourceRefs: [proofs.a.sourceRef, proofs.b.sourceRef],
  });
  const dependencies = { ...proofs.dependencies, clock };
  const source = createSourceService(dependencies, localSourceCatalog);
  const parent = createParentReadClient(workerOrigin, serviceToken, proofs.registryRoot);
  const review = await composeActivationReview({ dependencies, catalog: localSourceCatalog, service: source }, {
    ...proofs, parent, observe: source.readCurrentSemantics, authorize: reviewer.authorizeReviewer,
  });
  const activation = createWorkerActivation({ db: runtime, clock, registered: proofs.scopeReader,
    policy: await loadActivationPolicy(proofs), readBundle: hash => readActivationBundle(proofs, hash),
    observe: source.readCurrentSemantics,
  });
  const repository = createReviewRepository(db, clock);
  const app = controlApp([reviewer.plugin, ...review]);
  try {
    await app.listen({ host: '127.0.0.1', port: controlPort });
    const { headers } = await bootstrap();
    async function approve(company: 'a' | 'b'): Promise<CurrentAuthorityV1> {
      const path = '/api/review/' + proofs[company].accountId;
      const prepared = await post(path + '/prepare', headers, {});
      expect(prepared.status).toBe(200);
      const reviewPackage = ReviewPackageSchema.parse(await prepared.json());
      const idempotencyKey = 'ingress-initial-' + company;
      const approval = await post(path + '/activate', headers, {
        reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash,
        expectedArtifactHash: reviewPackage.artifactHash, expectedProfileHash: reviewPackage.profileHash,
        expectedTargetVersion: reviewPackage.expectedTargetVersion, idempotencyKey,
      });
      expect(approval.status).toBe(202);
      await approval.body?.cancel();
      const intent = await repository.readIntentByKey(idempotencyKey);
      if (!intent) throw new Error('Missing committed approval intent');
      const { receipt } = await activation.activate({ idempotencyKey, bundleHash: intent.bundleHash });
      const stored = await withTransaction(runtime, client => readStoredActivation(client, receipt.scope));
      if (!stored) throw new Error('Missing real A5 import');
      verifyOriginals(stored.approvedTarget.records, company);
      const { scope, id: activationId, artifactHash, profileHash, manifestHash, approvedAt: changedAt } = stored.activation;
      return { schemaVersion: '1', identity: { scope, activationId, bundleHash: intent.bundleHash },
        sourceRef: stored.bundle.manifest.sourceRef, artifactHash, profileHash, manifestHash, changedAt, epoch: 1, status: 'active' };
    }
    return { a: await approve('a'), b: await approve('b') };
  } finally {
    await app.close();
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-authority-ingress-'));
  await startNativeDb();
  pair = await provisionTest(namespace);
  db = createControlDb({ connectionString: pair.control.appUrl });
  runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  owner = createRuntimeDb({ connectionString: pair.runtime.migrationUrl });
  await migrate(pair, migrationStreams, migrations);
  proofs = await issueActivationProofs(root, db);
  publishedOnly = await publishThird();
  installFetchTrace();
  worker = buildWorker({ db: instrumentRuntime(runtime), clock, serviceToken, expectedMigrations: migrationIdentities(migrations.runtime),
    featurePlugins: [composeWorkerParentReads(proofs.registryRoot),
      composeWorkerAuthority({ admissionOrigin: controlOrigin, admissionToken,
        source: { origin: controlOrigin, token: sourceToken, sourceRefs: sourceRefs() } })],
  });
  captureAuthorityLogs(worker);
  worker.addHook('onRequest', (req, _reply, done) => {
    if (!req.url.startsWith('/internal/connections/')) return done();
    const trace: Trace = { checkedOut: 0, open: 0, steps: [] };
    traces.push(trace);
    traceContext.run(trace, done);
  });
  workerOrigin = await worker.listen({ host: '127.0.0.1', port: 0 });
  subjects = await approveBoth();
  initialFinancialState = await financialState();
  initialControlState = await controlHistory();
}, 90_000);

beforeEach(async () => {
  await owner.query('TRUNCATE runtime_authority_commands, runtime_authority_heads');
  now = approvedAt;
  traces.length = 0;
});

afterEach(async () => {
  beforeObservation = undefined;
  beforeScopeLock = undefined;
  onWorkerSignal = undefined;
  onCallbackReply = undefined;
  sourceOutage = callbackOutage = false;
  await stopControl();
  expect(boundaryViolations).toEqual([]);
  await assertSafeSurfaces();
  safeOutput.length = 0;
  capturedLogs.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await control?.close();
  await worker?.close();
  try {
    if (initialFinancialState) {
      expect(await financialState()).toEqual(initialFinancialState);
      expect(await controlHistory()).toEqual(initialControlState);
    }
  } finally {
    await Promise.all([db?.end(), runtime?.end(), owner?.end()]);
    if (pair) await dropTest(namespace);
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test('local_composition_mounts_real_committed_authority', async () => {
  const localOptions = {
    webOrigin, captures: [proofs.a.capture, proofs.b.capture],
    authorityOperations: { worker: createAuthorityWorkerClient(workerOrigin, serviceToken), admissionToken },
  };
  const composed = await createLocalComposition({ ...proofs.dependencies, clock }, localOptions);
  control = buildControl({ db, clock, workerClient: createWorkerClient(workerOrigin, serviceToken),
    expectedMigrations: migrationIdentities(migrations.control), ...composed });
  closeControlConnections(control);
  captureAuthorityLogs(control);
  try {
    await control.listen({ host: '127.0.0.1', port: controlPort });
    const { headers } = await bootstrap();
    const response = await fetch(controlOrigin + '/api/connections/' + proofs.a.accountId + '/authority', { headers });
    expect(response.status).toBe(200);
    expect(CurrentAuthorityV1Schema.parse(await response.json())).toEqual(subjects.a);
  } finally {
    await control.close();
    control = undefined;
  }
});

function sourceRefs() {
  return [proofs.a.sourceRef, proofs.b.sourceRef];
}

async function publishThird() {
  const registration = await proofs.candidates.getCandidate(proofs.b.selection.artifactHash, proofs.b.selection.manifestId);
  const { manifest, snapshot } = registration;
  const agreement = manifest.files.find(file => file.kind === 'contract_pdf' && file.documentId.endsWith('-b-contract-2'));
  if (!agreement) throw new Error('Missing the separate B2 original agreement');
  const definition = localSourceCatalog.get(manifest.companyId);
  if (!definition) throw new Error('Missing Company B source definition');
  const source = createSourceService(proofs.dependencies, localSourceCatalog);
  const citations = await Promise.all(snapshot.evidenceIds.map(id => readEvidence(db, id, async binding => {
    if (binding.companyId !== manifest.companyId || binding.sourceRef !== manifest.sourceRef) {
      throw new Error('B2 citation escapes its source boundary');
    }
  })));
  const citation = citations.find(({ evidence }) =>
    evidence.sourceId === agreement.fileId && evidence.locator.kind === 'pdf' && evidence.locator.page === 1);
  const built = buildDemoCandidate({ source: definition, capture: { ...proofs.b.capture, contractFileId: agreement.fileId },
    manifest, snapshot, events: await source.getSnapshotRecords(snapshot.id), citation });
  if (!('candidate' in built)) throw new Error('Could not build the separately captured B2 candidate');
  const [builtProfile] = built.candidate.request.profiles;
  if (!builtProfile) throw new Error('Missing B2 profile');
  expect(builtProfile.sourceAccountIds).toEqual([expect.stringMatching(/^cust-b-[a-f0-9]+-2$/)]);
  expect([proofs.a.accountId, proofs.b.accountId]).not.toContain(builtProfile.scope.accountId);
  const spec = { ...built.candidate.request.spec, id: 'authority-fixture-b2-spec' };
  const profileInput = { ...builtProfile, id: 'authority-fixture-b2-profile' };
  const profile = CustomerProfileSchema.parse({ ...profileInput, hash: hashProfile(profileInput) });
  const compiled = compile(spec, [profile]);
  if (!compiled.ok) throw new Error('B2 candidate failed compilation');
  await proofs.candidates.registerCandidate({ spec, artifact: compiled.value, profiles: [profile], manifest, snapshot });
  await createRegisteredScopePublication({ registryRoot: proofs.registryRoot, candidates: proofs.candidates })
    .publishRegisteredScopes([{ artifactHash: compiled.value.hash, manifestId: manifest.id, selectedProfileHash: profile.hash }]);
  const { resolveRegisteredScope } = await proofs.scopeReader.readSnapshot();
  for (const id of [proofs.a.accountId, proofs.b.accountId, profile.scope.accountId]) expect(resolveRegisteredScope(id)).not.toBeNull();
  return profile.scope.accountId;
}

function instrumentRuntime(pool: Pool): Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') return async () => {
        const trace = traceContext.getStore();
        const client = await target.connect();
        if (!trace) return client;
        trace.checkedOut++;
        let phase = '';
        let inTransaction = false;
        return new Proxy(client, {
          get(connection, member) {
            if (member === 'release') return (discard?: boolean) => {
              trace.checkedOut--;
              trace.steps.push(phase + ':release');
              connection.release(discard);
            };
            if (member === 'query') return async (sql: string, values?: unknown[]) => {
              if (sql === 'BEGIN') {
                phase = 'mutation';
                trace.steps.push('mutation:begin');
              } else if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
                trace.steps.push('lock');
                await beforeScopeLock?.();
              } else if (sql.includes('FROM runtime_activation_imports') && /LIMIT\s+2/i.test(sql)) {
                phase = 'identity';
              }
              const result = await connection.query(sql, values);
              if (sql.startsWith('BEGIN')) {
                inTransaction = true;
                trace.open++;
                if (sql !== 'BEGIN') phase = 'snapshot';
              } else if (sql === 'COMMIT' || sql === 'ROLLBACK') {
                if (inTransaction) trace.open--;
                inTransaction = false;
                trace.steps.push(phase + ':' + sql.toLowerCase());
              }
              return result;
            };
            const value: unknown = Reflect.get(connection, member);
            return typeof value === 'function' ? value.bind(connection) : value;
          },
        }) satisfies PoolClient;
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function installFetchTrace() {
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const callback = url.origin === controlOrigin && url.pathname === callbackPath;
    const observe = url.origin === controlOrigin && url.pathname.startsWith('/internal/sources/');
    if (url.origin === workerOrigin && url.pathname.startsWith('/internal/connections/') && init?.signal) {
      onWorkerSignal?.(init.signal);
    }
    if (callback || observe) {
      const trace = traceContext.getStore();
      if (!trace || trace.checkedOut !== 0 || trace.open !== 0) {
        boundaryViolations.push(callback ? 'admission overlapped runtime checkout' : 'source observation overlapped runtime checkout');
      }
      trace?.steps.push(callback ? 'admission' : 'observe');
      if (callback && typeof init?.body === 'string') {
        lastCheck = AuthorityAdmissionCheckV1Schema.parse(JSON.parse(init.body));
        secrets.add(lastCheck.ticket);
      }
      if (observe) await beforeObservation?.();
    }
    const response = await nativeFetch(input, init);
    if (callback && onCallbackReply) await onCallbackReply(response.clone());
    return response;
  });
}

type SessionService = ReturnType<typeof createLocalSessionService>;
type SessionAdjust = (grants: LocalReviewerContext, request: FastifyRequest) => Promise<LocalReviewerContext>;

function fixtureSession(reviewerId: string) {
  return createLocalSessionService({ reviewerId, webOrigin, allowedSourceRefs: sourceRefs(),
    allowedAccountIds: [proofs.a.accountId, proofs.b.accountId, publishedOnly, unknown],
  });
}

async function startControl(options: {
  reviewerId?: string; adjust?: SessionAdjust; sessionFor?: (request: FastifyRequest) => SessionService | undefined;
  overviewOnly?: boolean;
} = {}) {
  const reviewer = fixtureSession(options.reviewerId ?? 'authority-reviewer');
  const session = { ...reviewer, async authorizeReviewer(req: FastifyRequest, mode: { mutation: boolean }) {
    const actual = options.sessionFor?.(req) ?? reviewer;
    const grants = await actual.authorizeReviewer(req, mode);
    return options.adjust ? options.adjust(grants, req) : grants;
  } };
  const parent = createParentReadClient(workerOrigin, serviceToken, proofs.registryRoot);
  const semantics = composeSourceSemantics({ db, clock }, { catalog: localSourceCatalog,
    capability: { token: sourceToken, sourceRefs: sourceRefs() } });
  const authority = composeAuthorityOperations({ session, admissionToken, worker: createAuthorityWorkerClient(workerOrigin, serviceToken) });
  control = buildControl({ db, clock, workerClient: createWorkerClient(workerOrigin, serviceToken),
    expectedMigrations: migrationIdentities(migrations.control),
    authorityInvalidRequest: authority.invalidRequest,
    featurePlugins: [session.plugin, semantics.plugin, createParentProxyPlugin(parent, session.authorizeReviewer),
      ...(options.overviewOnly ? [] : [authority.plugin])],
  });
  closeControlConnections(control);
  captureAuthorityLogs(control);
  control.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/connections/') && typeof payload === 'string') safeOutput.push(payload);
    if ((callbackOutage && req.url === callbackPath) || (sourceOutage && req.url.startsWith('/internal/sources/'))) {
      reply.code(503);
      return JSON.stringify({ code: 'AUTHORITY_UNAVAILABLE', message: 'Fixture route unavailable',
        correlationId: req.id, diagnostics: [] });
    }
    return payload;
  });
  await control.listen({ host: '127.0.0.1', port: controlPort });
  return bootstrap();
}

async function stopControl() {
  if (!control) return;
  await control.close();
  control = undefined;
}

function publicPath(action = 'authority', account = proofs.a.accountId) {
  return '/api/connections/' + account + '/' + action;
}

function read(headers: Record<string, string>, account?: string) {
  return fetch(controlOrigin + publicPath('authority', account), { headers });
}

function command(headers: Record<string, string>, action: string, expectedEpoch: number, idempotencyKey: string, account?: string) {
  return post(publicPath(action, account), headers, { expectedEpoch, idempotencyKey });
}

async function result(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const text = await response.text();
  safeOutput.push(text);
  return AuthorityStatusResponseV1Schema.parse(JSON.parse(text));
}

async function denied(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const text = await response.text();
  safeOutput.push(text);
  expect(ApiErrorSchema.parse(JSON.parse(text))).toMatchObject({ code, diagnostics: [] });
}

async function tableState(pool: Pool, tables: string[]) {
  return Object.fromEntries(await Promise.all(tables.map(async table => [
    table, (await pool.query('SELECT to_jsonb(t) AS record FROM ' + table + ' t ORDER BY to_jsonb(t)::text')).rows,
  ])));
}

function financialState() {
  return tableState(runtime, ['parent_scopes', 'parent_snapshots', 'parent_targets', 'parent_metadata', 'parent_financial_records',
    'runtime_deliveries', 'runtime_activation_imports', 'runtime_economic_outcomes', 'runtime_delivery_outcomes', 'runtime_import_lineage']);
}

function controlHistory() {
  return tableState(db, ['review_heads', 'prepared_reviews', 'review_bootstrap_selections',
    'activation_intents', 'activation_receipt_observations']);
}

function authorityState() {
  return tableState(runtime, ['runtime_authority_commands', 'runtime_authority_heads', 'activity_events', 'activity_counter']);
}

async function assertSafeSurfaces() {
  const persisted = await authorityState();
  const publicSurface = canonicalJson({ safeOutput, capturedLogs, events: persisted.activity_events });
  const auditSurface = canonicalJson(persisted);
  expect([...secrets].every(secret => !publicSurface.includes(secret)), 'public and log credential absence').toBe(true);
  expect([...secrets].every(secret => !auditSurface.includes(secret)), 'persisted credential absence').toBe(true);
  expect([...auditSessions].every(session => !publicSurface.includes(session)), 'audit session stays private').toBe(true);
}

async function unchangedDenial(run: () => Promise<Response>, status: number, code: string) {
  const before = await authorityState();
  await denied(await run(), status, code);
  expect(await authorityState()).toEqual(before);
}

function barrier() {
  return Promise.withResolvers<void>();
}

async function atBarrier(entered: Promise<void>, pending: Promise<unknown>) {
  await Promise.race([entered, pending.then(() => { throw new Error('Operation completed before reaching its barrier'); })]);
}

async function overrideFixture(table: 'runtime_activation_imports' | 'runtime_authority_heads', sql: string, values: unknown[]) {
  await withTransaction(owner, async client => {
    await client.query('ALTER TABLE ' + table + ' DISABLE TRIGGER USER');
    await client.query(sql, values);
    await client.query('ALTER TABLE ' + table + ' ENABLE TRIGGER USER');
  });
}

test('committed_a5_identity_is_the_only_subject', async () => {
  const { headers } = await startControl();
  const before = await authorityState();
  console.info('Authority fixture identity ' + canonicalJson({
    committed: Object.values(subjects).map(({ identity, sourceRef, artifactHash, profileHash, manifestHash }) =>
      ({ identity, sourceRef, artifactHash, profileHash, manifestHash })),
    manifests: [proofs.a.capture.manifestId, proofs.b.capture.manifestId],
    publishedOnly,
  }));
  for (const expected of Object.values(subjects)) {
    const response = await read(headers, expected.identity.scope.accountId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(CurrentAuthorityV1Schema.parse(await response.json())).toEqual(expected);
  }
  for (const id of [publishedOnly, unknown]) {
    await unchangedDenial(() => read(headers, id), 404, 'AUTHORITY_NOT_FOUND');
    await unchangedDenial(() => command(headers, 'pause', 1, 'uncommitted', id), 404, 'AUTHORITY_NOT_FOUND');
  }
  const overview = await fetch(controlOrigin + '/api/connections/' + publishedOnly, { headers });
  expect(ConnectionStateV1Schema.parse(await overview.json())).toMatchObject({ status: 'inactive', epoch: 0 });
  const { rows: [original] } = await runtime.query('SELECT bundle_digest FROM runtime_activation_imports WHERE account_id = $1',
    [proofs.a.accountId]);
  const replaceDigest = (digest: string) => overrideFixture('runtime_activation_imports',
    'UPDATE runtime_activation_imports SET bundle_digest = $2 WHERE account_id = $1', [proofs.a.accountId, digest]);
  await replaceDigest('0'.repeat(64));
  try {
    await unchangedDenial(() => read(headers), 503, 'AUTHORITY_STORAGE_INVALID');
    await unchangedDenial(() => command(headers, 'pause', 1, 'corrupt'), 503, 'AUTHORITY_STORAGE_INVALID');
  } finally {
    await replaceDigest(original!.bundle_digest);
  }
  expect(await authorityState()).toEqual(before);
  expect(await financialState()).toEqual(initialFinancialState);
});

function rawRequest(origin: string, method: string, path: string, headers: OutgoingHttpHeaders = {}, body?: string) {
  const target = new URL(origin);
  const outcome = Promise.withResolvers<Response>();
  const req = request({ hostname: target.hostname, port: target.port, method, path, headers }, async res => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of res) chunks.push(Buffer.from(chunk));
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      outcome.resolve(new Response(chunks.length ? Buffer.concat(chunks) : null, { status: res.statusCode!, headers: responseHeaders }));
    } catch (error) {
      outcome.reject(error);
    }
  });
  req.once('error', outcome.reject);
  req.end(body);
  return { req, response: outcome.promise };
}

function privateCheck(check: AuthorityAdmissionCheckV1, bearer?: string) {
  return nativeFetch(controlOrigin + callbackPath, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
    body: JSON.stringify(check),
  });
}

test('registry_and_new_activation_setup_do_not_strand_authority', async () => {
  const overviewPath = '/api/connections/' + proofs.a.accountId;
  const activationPath = '/api/accounts/' + proofs.a.accountId + '/activation';
  let { headers } = await startControl({ overviewOnly: true });
  const originalOverview = await (await fetch(controlOrigin + overviewPath, { headers })).text();
  ConnectionStateV1Schema.parse(JSON.parse(originalOverview));
  const originalActivation = await (await fetch(controlOrigin + activationPath, { headers })).text();
  await stopControl();
  ({ headers } = await startControl());
  expect(await (await fetch(controlOrigin + overviewPath, { headers })).text()).toBe(originalOverview);
  expect(await (await fetch(controlOrigin + activationPath, { headers })).text()).toBe(originalActivation);
  await stopControl();
  const parked: string[] = [];
  try {
    for (const path of [join(proofs.registryRoot, 'activation-registry', 'current.json'), proofs.policyPath,
      proofs.bootstrapRoots.evidencePinRoot, proofs.bootstrapRoots.sidecarRoot]) {
      await rename(path, path + '.parked');
      parked.push(path);
    }
    ({ headers } = await startControl());
    sourceOutage = true;
    expect((await fetch(controlOrigin + overviewPath, { headers })).status).toBe(503);
    expect(CurrentAuthorityV1Schema.parse(await (await read(headers)).json())).toEqual(subjects.a);
    const activeNoop = await result(await command(headers, 'resume', 1, 'offline-active-noop'));
    expect(activeNoop.result).toMatchObject({ changed: false, state: subjects.a });
    const pause = await result(await command(headers, 'pause', 1, 'offline-pause'));
    expect(pause.result.state).toMatchObject({ status: 'paused', epoch: 2 });
    await unchangedDenial(() => command(headers, 'resume', 2, 'offline-resume'), 503, 'AUTHORITY_SEMANTICS_UNAVAILABLE');
    expect((await result(await command(headers, 'pause', 2, 'offline-noop'))).result.changed).toBe(false);
    expect((await result(await command(headers, 'revoke', 2, 'offline-revoke'))).result.state.status).toBe('revoked');
    expect(await result(await command(headers, 'pause', 1, 'offline-pause'))).toEqual({ result: pause.result, replayed: true });
    expect(traces.filter(trace => trace.steps.includes('observe'))).toHaveLength(1);
    expect(capturedLogs.some(line => line.includes('Authority fixture response'))).toBe(true);
  } finally {
    for (const path of parked.reverse()) await rename(path + '.parked', path);
  }
  expect(await (await fetch(controlOrigin + activationPath, { headers })).text()).toBe(originalActivation);
  expect(await financialState()).toEqual(initialFinancialState);
});

test('missing_admission_wiring_fails_closed_after_authentication', async () => {
  const local = await createLocalComposition({ ...proofs.dependencies, clock }, {
    webOrigin, captures: [proofs.a.capture, proofs.b.capture],
  });
  control = buildControl({ db, clock, workerClient: createWorkerClient(workerOrigin, serviceToken),
    expectedMigrations: migrationIdentities(migrations.control), ...local });
  closeControlConnections(control);
  captureAuthorityLogs(control);
  await control.listen({ host: '127.0.0.1', port: controlPort });
  const { headers } = await bootstrap();
  await unchangedDenial(() => read({}), 401, 'LOCAL_SESSION_REQUIRED');
  await unchangedDenial(() => read(headers), 503, 'AUTHORITY_UNAVAILABLE');
  await unchangedDenial(() => command(headers, 'pause', 1, 'missing-worker'), 503, 'AUTHORITY_UNAVAILABLE');
  const workerWithoutAdmission = buildWorker({ db: runtime, clock, serviceToken,
    expectedMigrations: migrationIdentities(migrations.runtime), featurePlugins: [composeWorkerAuthority({})],
  });
  try {
    const origin = await workerWithoutAdmission.listen({ host: '127.0.0.1', port: 0 });
    const path = '/internal/connections/' + proofs.a.accountId + '/authority';
    await unchangedDenial(() => fetch(origin + path), 401, 'AUTHORITY_UNAUTHORIZED');
    await unchangedDenial(() => fetch(origin + path, { headers: {
      authorization: 'Bearer ' + serviceToken, 'x-eapr-authority-admission': '0'.repeat(64),
    } }), 503, 'AUTHORITY_UNAVAILABLE');
  } finally {
    await workerWithoutAdmission.close();
  }
});

test('real_http_authenticates_before_ingress_input_diagnostics', async () => {
  const { headers } = await startControl();
  const json = { 'content-type': 'application/json' };
  const pause = publicPath('pause');
  const malformed = (credential: OutgoingHttpHeaders) => rawRequest(controlOrigin, 'POST', pause, { ...json, ...credential }, '{').response;
  const positive = { ...headers, ...json };
  await unchangedDenial(() => malformed({}), 401, 'LOCAL_SESSION_REQUIRED');
  for (const field of ['authorization', 'x-eapr-task-token', 'x-eapr-service-token', 'x-eapr-source-operator-token']) {
    await unchangedDenial(() => malformed({ ...headers, [field]: 'fixture-masquerade' }), 403, 'LOCAL_SESSION_FORBIDDEN');
  }
  const { origin: _origin, 'x-eapr-csrf': _csrf, ...cookieOnly } = headers;
  for (const bad of [cookieOnly, { ...headers, origin: 'http://127.0.0.1:1' },
    { ...headers, 'x-eapr-csrf': '0'.repeat(64) }, { ...cookieOnly, origin: webOrigin }]) {
    await unchangedDenial(() => malformed(bad), 403, 'LOCAL_SESSION_FORBIDDEN');
  }
  await unchangedDenial(() => read(headers, 'foreign-account'), 403, 'AUTHORITY_FORBIDDEN');
  await unchangedDenial(() => malformed(headers), 400, 'AUTHORITY_INPUT_INVALID');
  for (const value of [{ reviewer: {} }, { allowedSourceRefs: [] }, { action: 'revoke' }, { identity: {} }, { sessionId: 'fake' }]) {
    await unchangedDenial(() => post(pause, headers, { expectedEpoch: 1, idempotencyKey: 'invalid', ...value }),
      400, 'AUTHORITY_INPUT_INVALID');
  }
  for (const [path, extra, body] of [
    [pause, {}, '{"expectedEpoch":1,"idempotencyKey":"x","__proto__":{}}'],
    [pause, {}, ' '.repeat(4095) + '{}'],
    [pause, { 'content-type': 'text/plain' }, '{}'],
    [pause, { 'x-eapr-authority-admission': '0'.repeat(64) }, '{}'],
    [pause + '?', {}, '{}'],
    [pause + '?unexpected=1', {}, '{}'],
  ] as const) {
    await unchangedDenial(() => rawRequest(controlOrigin, 'POST', path, { ...positive, ...extra }, body).response,
      400, 'AUTHORITY_INPUT_INVALID');
  }
  await unchangedDenial(() => rawRequest(controlOrigin, 'GET', publicPath(), {
    ...headers, 'content-length': '2',
  }, '{}').response, 400, 'AUTHORITY_INPUT_INVALID');
  await unchangedDenial(() => rawRequest(controlOrigin, 'GET', publicPath() + '#', headers).response, 400, 'AUTHORITY_INPUT_INVALID');
  const beforeHead = await authorityState();
  expect((await rawRequest(controlOrigin, 'HEAD', publicPath(), headers).response).status).toBe(404);
  expect(await authorityState()).toEqual(beforeHead);
  for (const account of ['%ZZ', 'x'.repeat(161)]) {
    for (const [method, action] of [['GET', 'authority'], ['POST', 'pause'], ['POST', 'resume'], ['POST', 'revoke']] as const) {
      const path = publicPath(action, account);
      await unchangedDenial(() => rawRequest(controlOrigin, method, path).response, 401, 'LOCAL_SESSION_REQUIRED');
      if (method === 'POST') {
        await unchangedDenial(() => rawRequest(controlOrigin, method, path, cookieOnly).response, 403, 'LOCAL_SESSION_FORBIDDEN');
      }
      await unchangedDenial(() => rawRequest(controlOrigin, method, path, headers).response, 400, 'AUTHORITY_INPUT_INVALID');
      const privatePath = path.replace('/api/', '/internal/');
      for (const bearer of [undefined, 'incorrect', serviceToken]) {
        await unchangedDenial(() => rawRequest(workerOrigin, method, privatePath,
          bearer ? { authorization: 'Bearer ' + bearer } : {}).response,
        bearer === serviceToken ? 400 : 401, bearer === serviceToken ? 'AUTHORITY_INPUT_INVALID' : 'AUTHORITY_UNAUTHORIZED');
      }
    }
  }
  expect(traces.flatMap(trace => trace.steps)).toEqual([]);
});

test('current_account_and_source_denials_do_not_disclose_saved_result', async () => {
  let restriction: 'account' | 'source' | undefined;
  const { headers } = await startControl({ adjust: async grants => ({
    ...grants,
    allowedAccountIds: restriction === 'account' ? [proofs.b.accountId] : grants.allowedAccountIds,
    allowedSourceRefs: restriction === 'source' ? [proofs.b.sourceRef] : grants.allowedSourceRefs,
  }) });
  await result(await command(headers, 'pause', 1, 'saved-pause'));
  for (restriction of ['account', 'source'] as const) {
    await unchangedDenial(() => read(headers), 403, 'AUTHORITY_FORBIDDEN');
    await unchangedDenial(() => command(headers, 'pause', 1, 'saved-pause'), 403, 'AUTHORITY_FORBIDDEN');
  }
});

test('the_real_callback_requires_its_own_capability_and_live_binding', async () => {
  const entered = barrier();
  const release = barrier();
  let waitForFirstReply = true;
  const { headers } = await startControl();
  onCallbackReply = async response => {
    await response.text();
    if (!waitForFirstReply) return;
    waitForFirstReply = false;
    entered.resolve();
    await release.promise;
  };
  const pending = read(headers);
  try {
    await atBarrier(entered.promise, pending);
    if (!lastCheck) throw new Error('Missing real callback check');
    const check = lastCheck;
    for (const bearer of [undefined, sourceToken, serviceToken, 'wrong']) {
      await unchangedDenial(() => privateCheck(check, bearer), 401, 'AUTHORITY_UNAUTHORIZED');
    }
    for (const mismatched of [{ ...check, ticket: '0'.repeat(64) }, { ...check, requestHash: '0'.repeat(64) },
      { ...check, mode: 'mutation' as const }]) {
      await unchangedDenial(() => privateCheck(mismatched, admissionToken), 403, 'AUTHORITY_FORBIDDEN');
    }
  } finally {
    release.resolve();
  }
  expect((await pending).status).toBe(200);
  await unchangedDenial(() => privateCheck(lastCheck!, admissionToken), 403, 'AUTHORITY_FORBIDDEN');
});

const changes = ['account', 'source', 'reviewer', 'session', 'absent'] as const;
type GrantChange = typeof changes[number] | 'unrelated';

function adjustGrants(grants: LocalReviewerContext, change: GrantChange) {
  if (change === 'account') return { ...grants, allowedAccountIds: [proofs.b.accountId] };
  if (change === 'source') return { ...grants, allowedSourceRefs: [proofs.b.sourceRef] };
  if (change === 'reviewer') return { ...grants, reviewer: { ...grants.reviewer, reviewerId: 'changed-reviewer' } };
  if (change === 'session') return { ...grants, reviewer: { ...grants.reviewer, sessionId: 'changed-session' } };
  if (change === 'unrelated') return { ...grants,
    allowedAccountIds: [unknown, 'new-unrelated-account', proofs.a.accountId],
    allowedSourceRefs: ['new-unrelated-source', proofs.a.sourceRef],
  };
  return grants;
}

const snapshotPrefix = [
  'admission', 'identity:commit', 'identity:release', 'admission', 'snapshot:commit', 'snapshot:release',
];
const mutationTrace = ['mutation:begin', 'lock', 'mutation:commit', 'mutation:release'];

test.each(changes)('fresh_resume_denies_simulated_%s_change', async change => {
  const empty = fixtureSession('empty-reviewer');
  let changed = false;
  const { headers } = await startControl({
    sessionFor: () => changed && change === 'absent' ? empty : undefined,
    adjust: async grants => changed ? adjustGrants(grants, change) : grants,
  });
  await result(await command(headers, 'pause', 1, 'setup-pause'));
  const saved = await authorityState();
  const entered = barrier();
  const release = barrier();
  beforeObservation = async () => {
    entered.resolve();
    await release.promise;
  };
  const pending = command(headers, 'resume', 2, 'denied-resume');
  try {
    await atBarrier(entered.promise, pending);
    changed = true;
  } finally {
    release.resolve();
  }
  await denied(await pending, change === 'absent' ? 401 : 403,
    change === 'absent' ? 'AUTHORITY_UNAUTHORIZED' : 'AUTHORITY_FORBIDDEN');
  expect(traces.at(-1)?.steps).toEqual([...snapshotPrefix, 'observe', 'admission']);
  expect(await authorityState()).toEqual(saved);
});

test.each([...changes, 'unrelated'] as const)('failed_observation_rechecks_%s_before_winner_recovery', async change => {
  const empty = fixtureSession('empty-reviewer');
  let changed = false;
  let loserCookie: string | undefined;
  const applies = (req: FastifyRequest) => changed && req.headers.cookie === loserCookie;
  const loser = await startControl({
    sessionFor: req => applies(req) && change === 'absent' ? empty : undefined,
    adjust: async (grants, req) => applies(req) ? adjustGrants(grants, change) : grants,
  });
  loserCookie = loser.headers.cookie;
  const winner = await bootstrap();
  await result(await command(winner.headers, 'pause', 1, 'setup-pause'));
  const entered = barrier();
  const release = barrier();
  beforeObservation = async () => {
    beforeObservation = undefined;
    entered.resolve();
    await release.promise;
  };
  const pending = command(loser.headers, 'resume', 2, 'concurrent-resume');
  let winningResponse;
  let committed;
  try {
    await atBarrier(entered.promise, pending);
    winningResponse = await result(await command(winner.headers, 'resume', 2, 'concurrent-resume'));
    committed = await authorityState();
    changed = true;
    sourceOutage = true;
  } finally {
    release.resolve();
  }
  const trace = traces.at(-2);
  if (change === 'unrelated') {
    const recovered = await result(await pending);
    expect(recovered.replayed).toBe(true);
    expect(canonicalJson(recovered.result)).toBe(canonicalJson(winningResponse.result));
    expect(trace?.steps).toEqual([...snapshotPrefix, 'observe', 'admission', 'snapshot:commit', 'snapshot:release']);
  } else {
    await denied(await pending, change === 'absent' ? 401 : 403,
      change === 'absent' ? 'AUTHORITY_UNAUTHORIZED' : 'AUTHORITY_FORBIDDEN');
    expect(trace?.steps).toEqual([...snapshotPrefix, 'observe', 'admission']);
  }
  expect(await authorityState()).toEqual(committed);
});

test('observes_admission_and_source_only_between_released_runtime_transactions', async () => {
  let changed = false;
  const { headers } = await startControl({ adjust: async grants => changed ? adjustGrants(grants, 'unrelated') : grants });
  expect(CurrentAuthorityV1Schema.parse(await (await read(headers)).json())).toEqual(subjects.a);
  const pause = await result(await command(headers, 'pause', 1, 'trace-pause'));
  const entered = barrier();
  const release = barrier();
  beforeObservation = async () => {
    entered.resolve();
    await release.promise;
  };
  const pending = command(headers, 'resume', 2, 'trace-resume');
  try {
    await atBarrier(entered.promise, pending);
    changed = true;
  } finally {
    release.resolve();
  }
  expect((await result(await pending)).result.state).toMatchObject({ status: 'active', epoch: 3 });
  expect(await result(await command(headers, 'pause', 1, 'trace-pause'))).toEqual({ result: pause.result, replayed: true });
  callbackOutage = true;
  await unchangedDenial(() => command(headers, 'revoke', 3, 'trace-unavailable'), 503, 'AUTHORITY_UNAVAILABLE');
  expect(traces.map(trace => trace.steps)).toEqual([
    snapshotPrefix,
    [...snapshotPrefix, 'admission', ...mutationTrace],
    [...snapshotPrefix, 'observe', 'admission', ...mutationTrace],
    snapshotPrefix,
    ['admission'],
  ]);
  expect(traces.every(trace => trace.checkedOut === 0 && trace.open === 0)).toBe(true);
});

test('disconnect_while_callback_authorization_awaits_rejects_the_ticket', async () => {
  const entered = barrier();
  const release = barrier();
  const aborted = barrier();
  const callbackDone = barrier();
  let authorizations = 0;
  let armed = false;
  const { headers } = await startControl({ adjust: async grants => {
    if (armed && ++authorizations === 5) {
      entered.resolve();
      await release.promise;
    }
    return grants;
  } });
  await result(await command(headers, 'pause', 1, 'disconnect-setup'));
  armed = true;
  const saved = await authorityState();
  onWorkerSignal = signal => signal.addEventListener('abort', () => aborted.resolve(), { once: true });
  let callbackStatus: number | undefined;
  onCallbackReply = async response => {
    if (authorizations === 5) {
      try {
        callbackStatus = response.status;
        const body = ApiErrorSchema.parse(await response.json());
        expect(body.code).toBe('AUTHORITY_FORBIDDEN');
        safeOutput.push(JSON.stringify(body));
        callbackDone.resolve();
      } catch (error) {
        callbackDone.reject(error);
      }
    } else {
      await response.text();
    }
  };
  const body = JSON.stringify({ expectedEpoch: 2, idempotencyKey: 'disconnect-resume' });
  const pending = rawRequest(controlOrigin, 'POST', publicPath('resume'), {
    ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
  }, body);
  const outcome = pending.response.then(() => 'received', () => 'disconnected');
  try {
    await atBarrier(entered.promise, outcome);
    pending.req.destroy();
    expect(await outcome).toBe('disconnected');
    await aborted.promise;
  } finally {
    release.resolve();
  }
  await callbackDone.promise;
  expect(callbackStatus).toBe(403);
  expect(traces.at(-1)?.steps).toEqual([...snapshotPrefix, 'observe', 'admission']);
  expect(await authorityState()).toEqual(saved);
});

async function activityFault(body: string, run: () => Promise<void>) {
  await withTransaction(owner, async client => {
    await client.query('CREATE FUNCTION test_ingress_activity_fault() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN ' +
      body + ' RETURN NEW; END; $$');
    await client.query('CREATE TRIGGER test_ingress_activity_fault BEFORE INSERT ON activity_events ' +
      'FOR EACH ROW EXECUTE FUNCTION test_ingress_activity_fault()');
  });
  try {
    await run();
  } finally {
    await withTransaction(owner, async client => {
      await client.query('DROP TRIGGER test_ingress_activity_fault ON activity_events');
      await client.query('DROP FUNCTION test_ingress_activity_fault()');
    });
  }
}

test('serialization_retry_reacquires_runtime_locks_without_reopening_admission', async () => {
  const { headers } = await startControl();
  const initial = await authorityState();
  await owner.query('CREATE SEQUENCE test_ingress_retry_once');
  try {
    await owner.query('GRANT USAGE ON SEQUENCE test_ingress_retry_once TO "' + pair!.runtime.appRole + '"');
    await activityFault("IF NEW.event->>'type' = 'connection.paused' AND nextval('test_ingress_retry_once') = 1 THEN " +
      "RAISE EXCEPTION 'test serialization' USING ERRCODE = '40001'; END IF;", async () => {
      const entered = barrier();
      const release = barrier();
      let attempts = 0;
      beforeScopeLock = async () => {
        if (++attempts === 2) {
          entered.resolve();
          await release.promise;
        }
      };
      const pending = command(headers, 'pause', 1, 'serialization-retry');
      try {
        await atBarrier(entered.promise, pending);
        expect(await authorityState()).toEqual(initial);
      } finally {
        release.resolve();
      }
      expect((await result(await pending)).result.state).toMatchObject({ status: 'paused', epoch: 2 });
      expect(attempts).toBe(2);
      expect(traces.at(-1)?.steps).toEqual([...snapshotPrefix, 'admission',
        'mutation:begin', 'lock', 'mutation:rollback', 'mutation:release', ...mutationTrace]);
      const after = await authorityState();
      expect(after.runtime_authority_commands).toHaveLength(1);
      expect(after.runtime_authority_heads).toHaveLength(1);
      expect(after.activity_events).toHaveLength(initial.activity_events.length + 1);
    });
  } finally {
    await owner.query('DROP SEQUENCE test_ingress_retry_once');
  }
});

test('terminal_runtime_failure_rolls_back_and_exact_retry_commits_once', async () => {
  const { headers } = await startControl();
  const initial = await authorityState();
  await activityFault("RAISE EXCEPTION 'private fixture diagnostic';", async () => {
    await unchangedDenial(() => command(headers, 'pause', 1, 'terminal-rollback'), 503, 'AUTHORITY_UNAVAILABLE');
    expect(traces.at(-1)?.steps).toEqual([...snapshotPrefix, 'admission',
      'mutation:begin', 'lock', 'mutation:rollback', 'mutation:release']);
  });
  expect((await result(await command(headers, 'pause', 1, 'terminal-rollback'))).replayed).toBe(false);
  const after = await authorityState();
  expect(after.runtime_authority_commands).toHaveLength(1);
  expect(after.activity_events).toHaveLength(initial.activity_events.length + 1);
  expect(safeOutput.every(text => !text.includes('private fixture diagnostic'))).toBe(true);
});

test('a_change_after_final_admission_does_not_cancel_the_admitted_transaction', async () => {
  const empty = fixtureSession('empty-reviewer');
  let changed = false;
  const { headers } = await startControl({ sessionFor: () => changed ? empty : undefined });
  const entered = barrier();
  const release = barrier();
  beforeScopeLock = async () => {
    entered.resolve();
    await release.promise;
  };
  const pending = command(headers, 'pause', 1, 'already-admitted');
  try {
    await atBarrier(entered.promise, pending);
    changed = true;
  } finally {
    release.resolve();
  }
  expect((await result(await pending)).result.state).toMatchObject({ status: 'paused', epoch: 2 });
  expect(traces.at(-1)?.steps).toEqual([...snapshotPrefix, 'admission', ...mutationTrace]);
  await unchangedDenial(() => read(headers), 401, 'LOCAL_SESSION_REQUIRED');
  expect((await authorityState()).runtime_authority_commands).toHaveLength(1);
});

test('committed_response_loss_replays_under_fresh_session', async () => {
  const original = await startControl();
  const initial = await authorityState();
  const account = proofs.a.accountId;
  const path = publicPath('pause', account);
  const body = { expectedEpoch: 1, idempotencyKey: 'lost-public-response' };
  const lostReply = Promise.withResolvers<ReturnType<typeof AuthorityStatusResponseV1Schema.parse>>();
  const relay = createServer(async (incoming, downstream) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const upstream = await nativeFetch(controlOrigin + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json', cookie: incoming.headers.cookie!,
          origin: incoming.headers.origin!, 'x-eapr-csrf': String(incoming.headers['x-eapr-csrf']),
        },
        body: Buffer.concat(chunks),
      });
      lostReply.resolve(await result(upstream));
    } catch (error) {
      lostReply.reject(error);
    } finally {
      downstream.destroy();
    }
  });
  let lost;
  try {
    relay.listen(0, '127.0.0.1');
    await once(relay, 'listening');
    const address = relay.address();
    if (!address || typeof address === 'string') throw new Error('Missing response relay port');
    const pending = rawRequest('http://127.0.0.1:' + address.port, 'POST', path,
      { ...original.headers, 'content-type': 'application/json' }, JSON.stringify(body));
    const [disconnect, upstream] = await Promise.all([
      pending.response.then(() => 'received', () => 'disconnected'), lostReply.promise,
    ]);
    expect(disconnect).toBe('disconnected');
    lost = upstream;
  } finally {
    await new Promise<void>((resolve, reject) => relay.close(error => error ? reject(error) : resolve()));
  }
  expect(lost.replayed).toBe(false);
  const committed = await authorityState();
  expect(committed.runtime_authority_commands).toHaveLength(1);
  expect(committed.runtime_authority_heads).toHaveLength(1);
  expect(committed.activity_events).toHaveLength(initial.activity_events.length + 1);
  const audit = () => runtime.query<{ reviewer_canonical: string; result_canonical: string }>(
    'SELECT reviewer_canonical, result_canonical FROM runtime_authority_commands WHERE account_id = $1 AND idempotency_key = $2',
    [account, body.idempotencyKey],
  ).then(({ rows }) => rows[0]!);
  const saved = await audit();
  expect(saved.reviewer_canonical === canonicalJson(original.session.reviewer)).toBe(true);
  expect(saved.result_canonical).toBe(canonicalJson(lost.result));
  const old = lastCheck!;
  await stopControl();
  const fresh = await startControl();
  expect(fresh.session.reviewer.sessionId !== original.session.reviewer.sessionId).toBe(true);
  await unchangedDenial(() => privateCheck(old, admissionToken), 403, 'AUTHORITY_FORBIDDEN');
  await unchangedDenial(() => post(path, original.headers, body), 401, 'LOCAL_SESSION_REQUIRED');
  const retry = await result(await post(path, fresh.headers, body));
  expect(retry.replayed).toBe(true);
  expect(canonicalJson(retry.result)).toBe(saved.result_canonical);
  expect(await audit()).toEqual(saved);
  expect(await authorityState()).toEqual(committed);

  await stopControl();
  const different = await startControl({ reviewerId: 'another-authorized-reviewer' });
  await unchangedDenial(() => post(path, different.headers, body), 409, 'AUTHORITY_IDEMPOTENCY_CONFLICT');
  expect((await result(await command(different.headers, 'revoke', 2, 'revoke-after-loss'))).result.state.status).toBe('revoked');
  await stopControl();
  const recovered = await startControl();
  expect(await result(await post(path, recovered.headers, body))).toEqual({ result: lost.result, replayed: true });
  const current = CurrentAuthorityV1Schema.parse(await (await read(recovered.headers)).json());
  expect(current).toMatchObject({ status: 'revoked', epoch: 3 });
  expect(await audit()).toEqual(saved);
  const final = await authorityState();
  expect(final.runtime_authority_commands).toHaveLength(2);
  expect(final.activity_events).toHaveLength(initial.activity_events.length + 2);
  expect(await financialState()).toEqual(initialFinancialState);
});

test('duplicate_delivery_conflict_stale_and_revoked_status_use_the_same_canonical_history', async () => {
  const { headers } = await startControl();
  const initial = await authorityState();
  now = '2026-11-09T08:01:00.000Z';
  const [first, second] = await Promise.all([
    command(headers, 'pause', 1, 'duplicate-pause').then(result),
    command(headers, 'pause', 1, 'duplicate-pause').then(result),
  ]);
  expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
  expect(canonicalJson(first.result)).toBe(canonicalJson(second.result));
  expect(first.result.state).toMatchObject({ status: 'paused', epoch: 2, changedAt: now });
  const paused = await authorityState();
  expect(paused.runtime_authority_commands).toHaveLength(1);
  expect(paused.activity_events).toHaveLength(initial.activity_events.length + 1);
  await unchangedDenial(() => command(headers, 'pause', 1, 'stale'), 409, 'AUTHORITY_STALE');
  await unchangedDenial(() => command(headers, 'revoke', 1, 'duplicate-pause'), 409, 'AUTHORITY_IDEMPOTENCY_CONFLICT');
  await unchangedDenial(() => command(headers, 'pause', 2, 'duplicate-pause'), 409, 'AUTHORITY_IDEMPOTENCY_CONFLICT');
  now = '2026-11-09T08:02:00.000Z';
  const noOp = await result(await command(headers, 'pause', 2, 'paused-noop'));
  expect(noOp.result).toMatchObject({ changed: false, committedAt: now, state: first.result.state });
  const afterNoop = await authorityState();
  expect(afterNoop.runtime_authority_heads).toEqual(paused.runtime_authority_heads);
  expect(afterNoop.activity_events).toEqual(paused.activity_events);
  expect(afterNoop.activity_counter).toEqual(paused.activity_counter);
  expect(afterNoop.runtime_authority_commands).toHaveLength(2);
  const revoked = await result(await command(headers, 'revoke', 2, 'revoke'));
  for (const action of ['pause', 'resume']) {
    await unchangedDenial(() => command(headers, action, 3, 'revoked-' + action), 409, 'AUTHORITY_REVOKED');
  }
  const before = await authorityState();
  now = '2026-11-09T08:03:00.000Z';
  expect((await result(await command(headers, 'revoke', 3, 'revoked-noop'))).result)
    .toMatchObject({ changed: false, committedAt: now, state: revoked.result.state });
  const after = await authorityState();
  expect(after.runtime_authority_heads).toEqual(before.runtime_authority_heads);
  expect(after.activity_events).toEqual(before.activity_events);
  expect(after.activity_counter).toEqual(before.activity_counter);
  expect(after.runtime_authority_commands).toHaveLength(4);
});

test('maximum_safe_epoch_rejects_transition_but_retains_noop', async () => {
  const { headers } = await startControl();
  await result(await command(headers, 'resume', 1, 'materialize-epoch-head'));
  const replace = (epoch: number) => overrideFixture('runtime_authority_heads',
    'UPDATE runtime_authority_heads SET epoch = $2 WHERE account_id = $1', [proofs.a.accountId, epoch]);
  const max = Number.MAX_SAFE_INTEGER;
  await replace(max);
  try {
    await unchangedDenial(() => command(headers, 'pause', max, 'epoch-boundary'), 409, 'AUTHORITY_EPOCH_EXHAUSTED');
    const initial = await authorityState();
    now = '2026-11-09T08:04:00.000Z';
    const noOp = await result(await command(headers, 'resume', max, 'epoch-boundary'));
    expect(noOp.result).toMatchObject({ changed: false, state: { ...subjects.a, epoch: max }, committedAt: now });
    expect(await result(await command(headers, 'resume', max, 'epoch-boundary')))
      .toEqual({ result: noOp.result, replayed: true });
    const final = await authorityState();
    expect(final.runtime_authority_heads).toEqual(initial.runtime_authority_heads);
    expect(final.activity_events).toEqual(initial.activity_events);
    expect(final.activity_counter).toEqual(initial.activity_counter);
    expect(final.runtime_authority_commands).toHaveLength(initial.runtime_authority_commands.length + 1);
    await assertSafeSurfaces();
  } finally {
    // The max-epoch audit intentionally refers to the fixture epoch and is removed with it.
    await owner.query('TRUNCATE runtime_authority_commands, runtime_authority_heads');
  }
});
