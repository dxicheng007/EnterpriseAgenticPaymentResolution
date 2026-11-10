import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  BootstrapManifestSchema, LocalSessionResponseSchema, RawSourceEventSchema, ReviewPackageSchema,
  canonicalJson, hashBytes, hashCanonical, hashEvent, hashFinancialReservation, hashManifest, hashProfile,
  type BootstrapManifest, type ChangePage, type CommittedCaptureIdentityV1, type RawSourceEvent,
} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { createEvidenceStore } from '@eapr/evidence';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { lockImportIdentities, lockParentKeys } from '@eapr/parent/persistence';
import { encodeCanonical } from '@eapr/parent/snapshots';
import { createSourceService, streamContentHash } from '@eapr/sources';
import { createRegisteredScopeReader, readActivationBundle } from '@eapr/storage/activation-registry';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createControlDb } from '@eapr/storage/control-db';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import { createConnectionReads } from '../../apps/worker/src/connections.js';
import { createRegisteredScopePublication } from '../../apps/control/src/activation-publication.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
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
import { fixtureA, textPdf } from '../../packages/sources/src/canonical-fixtures.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { prepareAndPublishActivationPolicy } from '../../scripts/prepare-activation-policy.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { captureEvidenceFixture } from '../fixtures/evidence-v2-capture.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { activationCutover, issueActivationProofs, verifyOriginals } from '../fixtures/activation-proof.js';
import { testNamespace } from '../fixtures/harness.js';

const namespace = testNamespace('capture');
const firstInstant = '2026-11-09T08:00:00.000Z';
let instant = firstInstant;
const clock = () => new Date(instant);
const webOrigin = 'http://127.0.0.1:5182';
const serviceToken = 'capture-test-worker';
const operatorToken = 'capture-test-operator';

let pair: Awaited<ReturnType<typeof provisionTest>>;
let root: string;
let runtime: Pool;
let owner: Pool;
let control: Pool;
type Proofs = Awaited<ReturnType<typeof issueActivationProofs>>;
type FixtureContext = Pick<Proofs, 'candidates' | 'dependencies' | 'registryRoot' | 'scopeReader' | 'bootstrapRoots'>;
type Subject = { accountId: string };
type Committed = { identity: CommittedCaptureIdentityV1; manifest: BootstrapManifest; events: RawSourceEvent[] };
const peerNamespace = testNamespace('capturepeer');
const sharedNamespace = testNamespace('captureshare');
let peerPair: Awaited<ReturnType<typeof provisionTest>>;
let peer: Pool;
let peerControl: Pool;
let sharedPair: Awaited<ReturnType<typeof provisionTest>>;
let sharedDb: Pool;
let fixture: { a: Committed; b: Committed; source: ReturnType<typeof createSourceService>;
  operator: ReturnType<typeof createScenarioAdmin> };
let sharedA: Committed;
let sharedB: Committed;
let sharedScopes: ReturnType<typeof createRegisteredScopeReader>;
let peerSource: ReturnType<typeof createSourceService>;
let peerOperator: ReturnType<typeof createScenarioAdmin>;
let peerA: Committed;
let peerB: Committed;
let bound: Awaited<ReturnType<ReturnType<typeof createRuntimeCapture>['openCommitted']>>;
let baseline: BootstrapManifest;
let accepted: ChangePage;

async function activateSubjects(
  db: Pool, context: FixtureContext, subjects: { subject: Subject; key: string }[],
  setup: { policyPath: string; selectionPath: string },
) {
  const migrations = readMigrationCatalog();
  const { candidates, dependencies, registryRoot, scopeReader, bootstrapRoots } = context;
  const source = createSourceService(dependencies, localSourceCatalog);
  const worker = await launchWorker({
    db, serviceToken, clock, expectedMigrations: migrationIdentities(migrations.runtime),
    featurePlugins: [composeWorkerParentReads(registryRoot)],
  }, 0);
  const address = worker.server.address();
  if (!address || typeof address === 'string') throw new Error('No worker listener');
  const origin = 'http://127.0.0.1:' + address.port;
  const workerActivation = createWorkerActivation({
    db, clock, registered: scopeReader, policy: await loadActivationPolicy(setup),
    readBundle: hash => readActivationBundle({ registryRoot }, hash),
    observe: source.readCurrentSemantics,
  });
  const repository = createReviewRepository(dependencies.db, clock);
  const reviewer = createLocalSessionService({
    webOrigin, reviewerId: 'capture-test-reviewer', allowedSourceRefs: [...localSourceCatalog.values()].map(source => source.sourceRef),
    allowedAccountIds: subjects.map(({ subject }) => subject.accountId),
  });
  const review = await composeActivationReview({ dependencies, catalog: localSourceCatalog, service: source }, {
    registryRoot, ...setup, bootstrapRoots, candidates, observe: source.readCurrentSemantics,
    parent: createParentReadClient(origin, serviceToken, registryRoot), authorize: reviewer.authorizeReviewer,
  });
  const app = buildControl({
    db: dependencies.db, clock, expectedMigrations: migrationIdentities(migrations.control),
    workerClient: createWorkerClient(origin, serviceToken), featurePlugins: [reviewer.plugin, ...review],
  });
  async function activate(subject: Subject, key: string, headers: Record<string, string>): Promise<Committed> {
    const url = '/api/review/' + subject.accountId;
    const prepared = await app.inject({ method: 'POST', url: url + '/prepare', headers, payload: {} });
    expect(prepared.statusCode, prepared.body).toBe(200);
    const review = ReviewPackageSchema.parse(prepared.json());
    const approved = await app.inject({ method: 'POST', url: url + '/activate', headers, payload: {
      reviewPackageId: review.id, expectedPackageHash: review.hash, expectedArtifactHash: review.artifactHash,
      expectedProfileHash: review.profileHash, expectedTargetVersion: review.expectedTargetVersion, idempotencyKey: key,
    } });
    expect(approved.statusCode, approved.body).toBe(202);
    const intent = await repository.readIntentByKey(key);
    if (!intent) throw new Error('No committed review intent');
    const { receipt } = await workerActivation.activate({ idempotencyKey: key, bundleHash: intent.bundleHash });
    const stored = await withTransaction(db, client => readStoredActivation(client, receipt.scope));
    if (!stored) throw new Error('No A5 activation');
    if (key === 'capture-approve-a' || key === 'capture-approve-b') {
      verifyOriginals(stored.approvedTarget.records, key.endsWith('-a') ? 'a' : 'b');
    }
    return {
      identity: { scope: receipt.scope, activationId: receipt.activationId, bundleHash: intent.bundleHash },
      manifest: stored.bundle.manifest, events: stored.bundle.bootstrapEvents,
    };
  }
  try {
    const session = await app.inject({
      method: 'POST', url: '/api/local-session', headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
    });
    expect(session.statusCode).toBe(200);
    const cookie = session.cookies[0]!;
    const headers = {
      origin: webOrigin, cookie: cookie.name + '=' + cookie.value,
      'x-eapr-csrf': LocalSessionResponseSchema.parse(session.json()).csrfToken,
    };
    const committed: Committed[] = [];
    for (const { subject, key } of subjects) committed.push(await activate(subject, key, headers));
    return committed;
  } finally {
    await app.close();
    await worker.close();
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-capture-'));
  await startNativeDb();
  pair = await provisionTest(namespace);
  runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  owner = createRuntimeDb({ connectionString: pair.runtime.migrationUrl });
  control = createControlDb({ connectionString: pair.control.appUrl });
  await migrate(pair, migrationStreams, readMigrationCatalog());
  const proofs = await issueActivationProofs(root, control);
  const source = createSourceService(proofs.dependencies, localSourceCatalog);
  const operator = createScenarioAdmin(proofs.dependencies, { DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operatorToken });
  const [a, b] = await activateSubjects(runtime, proofs, [
    { subject: proofs.a, key: 'capture-approve-a' }, { subject: proofs.b, key: 'capture-approve-b' },
  ], proofs);
  fixture = { a: a!, b: b!, source, operator };
  baseline = a!.manifest;

  await preparePeerFixtures();
}, 90_000);

afterAll(async () => {
  await Promise.all([runtime?.end(), owner?.end(), control?.end(), peer?.end(), peerControl?.end(), sharedDb?.end()]);
  if (sharedPair) await dropTest(sharedNamespace);
  if (peerPair) await dropTest(peerNamespace);
  if (pair) await dropTest(namespace);
  if (root) await rm(root, { recursive: true, force: true });
});

const service = () => createRuntimeCapture({ db: runtime, clock });
const sourceRef = () => baseline.sourceRef;
const api = 'a-finance';
const semantic = 'a-semantics';
const initial = (streamId = api) => baseline.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
const fetchPage = (after = initial(), streamId = api) => fixture.source.fetchChanges(sourceRef(), streamId, after);
const addInvoice = (id: string, accountId = 'unknown-capture-account') => fixture.operator.freshInvoiceA(operatorToken, {
  id, accountId, amount: '5.00', dueDate: '2026-10-31', effectiveDate: '2026-10-01', observedAt: firstInstant,
});
const failure = (code: string, statusCode: number) => ({ code: 'CAPTURE_' + code, statusCode });
const count = async (name: string) => (await runtime.query<{ count: string }>('SELECT count(*) FROM ' + name)).rows[0]!.count;
const captureTables = [
  'runtime_capture_lanes', 'runtime_capture_checkpoints', 'runtime_source_positions', 'runtime_capture_pages',
  'runtime_inbox', 'runtime_capture_incidents',
] as const;

async function state(tableNames: readonly string[]) {
  return Object.fromEntries(await Promise.all(tableNames.map(async table => [
    table, (await runtime.query('SELECT to_jsonb(t)::text AS row FROM ' + table + ' t ORDER BY to_jsonb(t)::text')).rows,
  ])));
}

async function immutableParent() {
  const tables = (await runtime.query<{ name: string }>(`
    SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'
    AND (tablename LIKE 'parent_%' OR tablename IN
      ('runtime_activation_imports', 'runtime_delivery_outcomes', 'runtime_economic_outcomes', 'runtime_import_lineage'))
    ORDER BY tablename
  `)).rows;
  return state(tables.map(({ name }) => name));
}

function changed(event: RawSourceEvent, patch: Partial<RawSourceEvent>): RawSourceEvent {
  const result = { ...event, ...patch };
  return { ...result, contentHash: hashEvent(result) };
}

test('applies the additive runtime catalog and reapplies it without changing original SQL identities', async () => {
  const read = () => runtime.query('SELECT version, sha256 FROM migration_ledger ORDER BY version').then(result => result.rows);
  const before = await read();
  expect(before).toEqual([
    { version: 1, sha256: 'c09e49970e4fc3394294f643035acba224b9f19bdc4f6e46b66c6679fd82c2f3' },
    { version: 2, sha256: 'a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56' },
    { version: 3, sha256: 'aedc4cdec78c5d4cecf02a41f5f68e0e706bb195cf36182890e3af0f5e039b8c' },
    { version: 4, sha256: 'f232c9e552362618e785cc0bb23e847e4d7f319e0c0fae9084fb9aebc98deab7' },
    { version: 5, sha256: '7c35563ed3504766153aa6b7706c4a448dd4c50f3f1d0203345525c215f3ef96' },
    { version: 6, sha256: '3bad0cc496ff74aa4a480e9bdc5783a1f4fd2326401c4452ee3f8976558d6836' },
  ]);
  await migrate(pair, ['runtime'], readMigrationCatalog());
  expect(await read()).toEqual(before);

  const { rows } = await runtime.query<{ table_name: string; definition: string }>(`
    SELECT r.relname AS table_name, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    WHERE r.relnamespace = 'public'::regnamespace AND r.relname = ANY($1::text[]) AND c.contype IN ('p', 'u', 'f')
  `, [captureTables]);
  const constraints = (table: string) => rows.filter(row => row.table_name === table).map(row => row.definition).sort();
  expect(constraints('runtime_capture_lanes')).toEqual([
    'FOREIGN KEY (initial_activation_id) REFERENCES runtime_activation_imports(activation_id)',
    'PRIMARY KEY (source_ref, manifest_hash)',
  ]);
  expect(constraints('runtime_capture_checkpoints')).toEqual([
    'FOREIGN KEY (source_ref, manifest_hash) REFERENCES runtime_capture_lanes(source_ref, manifest_hash)',
    'PRIMARY KEY (source_ref, manifest_hash, stream_id)',
    'UNIQUE (source_ref, manifest_hash, stream_id, baseline_cursor)',
  ]);
  expect(constraints('runtime_source_positions')).toEqual([
    'FOREIGN KEY (source_ref, event_id) REFERENCES runtime_deliveries(source_ref, event_id)',
    'PRIMARY KEY (source_ref, stream_id, sequence)',
    'UNIQUE (source_ref, event_id)',
    'UNIQUE (source_ref, stream_id, sequence, event_id)',
  ]);
  const checkpoint = 'FOREIGN KEY (source_ref, manifest_hash, stream_id) ' +
    'REFERENCES runtime_capture_checkpoints(source_ref, manifest_hash, stream_id)';
  expect(constraints('runtime_capture_pages')).toEqual([checkpoint,
    'PRIMARY KEY (source_ref, manifest_hash, stream_id, after_cursor)',
  ]);
  expect(constraints('runtime_inbox')).toEqual([
    'FOREIGN KEY (source_ref, manifest_hash, stream_id, after_cursor) ' +
      'REFERENCES runtime_capture_pages(source_ref, manifest_hash, stream_id, after_cursor)',
    'FOREIGN KEY (source_ref, stream_id, sequence, event_id) ' +
      'REFERENCES runtime_source_positions(source_ref, stream_id, sequence, event_id)',
    'PRIMARY KEY (source_ref, manifest_hash, stream_id, sequence)',
    'UNIQUE (source_ref, manifest_hash, event_id)',
    'UNIQUE (source_ref, manifest_hash, stream_id, sequence, event_id)',
  ]);
  expect(constraints('runtime_capture_incidents')).toEqual([checkpoint,
    'PRIMARY KEY (source_ref, manifest_hash, stream_id, incident_hash)',
  ]);
});

test('requires exact committed identity and rejects all of a genuine CSV-bearing lane before writes', async () => {
  const { a, b } = fixture;
  const capture = service();
  await expect(capture.openCommitted({ ...a.identity, scope: { ...a.identity.scope, accountId: 'missing' } }))
    .rejects.toMatchObject(failure('ACTIVATION_NOT_FOUND', 404));
  await expect(capture.openCommitted({ ...a.identity, activationId: 'activation:wrong' }))
    .rejects.toMatchObject(failure('ACTIVATION_NOT_FOUND', 404));
  await expect(capture.openCommitted({ ...a.identity, bundleHash: '0'.repeat(64) }))
    .rejects.toMatchObject(failure('ACTIVATION_NOT_FOUND', 404));
  await expect(capture.openCommitted({ ...a.identity, bundleHash: 'not-a-hash' }))
    .rejects.toMatchObject(failure('INPUT_INVALID', 400));
  expect(b.manifest.files.some(file => file.kind === 'event_csv')).toBe(true);
  const deliveries = await count('runtime_deliveries');
  await expect(capture.openCommitted(b.identity)).rejects.toMatchObject(failure('TRANSPORT_UNSUPPORTED', 422));
  expect(await Promise.all(captureTables.map(count))).toEqual(['0', '0', '0', '0', '0', '0']);
  expect(await count('runtime_deliveries')).toBe(deliveries);
});

test('fails closed on a corrupt committed A5 row', async () => {
  const { activationId } = fixture.a.identity;
  const read = await owner.query<{ bundle_digest: string }>(
    'SELECT bundle_digest FROM runtime_activation_imports WHERE activation_id = $1', [activationId],
  );
  await owner.query('ALTER TABLE runtime_activation_imports DISABLE TRIGGER runtime_activation_imports_immutable');
  try {
    await owner.query('UPDATE runtime_activation_imports SET bundle_digest = $1 WHERE activation_id = $2', ['0'.repeat(64), activationId]);
    await expect(service().openCommitted(fixture.a.identity)).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    expect(await count('runtime_capture_lanes')).toBe('0');
  } finally {
    await owner.query('UPDATE runtime_activation_imports SET bundle_digest = $1 WHERE activation_id = $2',
      [read.rows[0]!.bundle_digest, activationId]);
    await owner.query('ALTER TABLE runtime_activation_imports ENABLE TRIGGER runtime_activation_imports_immutable');
  }
});

test('a conflicting unimported baseline delivery prevents all initialization writes', async () => {
  const event = fixture.a.events.find(({ rawIdentity }) => rawIdentity.sourceAccountId?.endsWith('-2'))!;
  const collision = changed(event, { observedAt: '2026-11-09T08:00:03.000Z' });
  await runtime.query(`
    INSERT INTO runtime_deliveries (source_ref, event_id, content_hash, canonical, digest) VALUES ($1, $2, $3, $4, $5)
  `, [collision.sourceRef, collision.id, collision.contentHash, ...encodeCanonical(collision)]);
  const before = await state([...captureTables, 'runtime_deliveries', 'activity_events']);
  try {
    await expect(service().openCommitted(fixture.a.identity)).rejects.toMatchObject(failure('IDENTITY_CONFLICT', 409));
    expect(await state([...captureTables, 'runtime_deliveries', 'activity_events'])).toEqual(before);
  } finally {
    await withTransaction(owner, async client => {
      await client.query('ALTER TABLE runtime_deliveries DISABLE TRIGGER runtime_deliveries_immutable');
      await client.query('DELETE FROM runtime_deliveries WHERE source_ref = $1 AND event_id = $2', [event.sourceRef, event.id]);
      await client.query('ALTER TABLE runtime_deliveries ENABLE TRIGGER runtime_deliveries_immutable');
    });
  }
});

test('seeds exact baseline vectors and full global identity without recording new capture or outcomes', async () => {
  const before = await immutableParent();
  const activity = await count('activity_events');
  const { identity, events } = fixture.a;
  const applied = await runtime.query('SELECT event_id FROM runtime_delivery_outcomes WHERE account_id = $1', [identity.scope.accountId]);
  expect(applied.rowCount).toBeLessThan(events.length);
  bound = await service().openCommitted(identity);
  expect(bound.lane).toEqual({ schemaVersion: '1', sourceRef: sourceRef(), manifestHash: baseline.hash });
  const progress = await bound.readProgress();
  expect(progress).toEqual({ schemaVersion: '1', lane: bound.lane, streams: [
    { streamId: api, transport: 'api', baselineCursor: initial(), captureCursor: initial(), capturedRecords: 0,
      capturedPages: 0, lastCapturedAt: null, lastIncident: null },
    { streamId: semantic, transport: 'semantic', baselineCursor: initial(semantic), captureCursor: initial(semantic),
      capturedRecords: 0, capturedPages: 0, lastCapturedAt: null, lastIncident: null },
  ] });
  expect((await runtime.query(`
    SELECT stream_id AS "streamId", sequence::integer, event_id AS id FROM runtime_source_positions
    WHERE source_ref = $1 ORDER BY stream_id, sequence
  `, [sourceRef()])).rows).toEqual(events.map(({ streamId, sequence, id }) => ({ streamId, sequence, id })));
  expect(await count('runtime_capture_pages')).toBe('0');
  expect(await count('runtime_inbox')).toBe('0');
  expect(await count('activity_events')).toBe(activity);
  expect(await immutableParent()).toEqual(before);
});

test('captures real complete API and semantic pages after empty at head, then replays exactly', async () => {
  const before = await immutableParent();
  const empty = await fetchPage();
  expect(await bound.capturePage(empty)).toEqual({ disposition: 'empty', captured: 0, cursor: initial(), replayed: false });
  expect(await count('runtime_capture_pages')).toBe('0');
  await addInvoice('capture-invoice-one');
  await fixture.operator.semanticChangeA(operatorToken, {
    id: 'capture-semantic-one', accountId: 'unknown-capture-account', revision: 'capture-v2',
    effectiveDate: '2026-10-01', observedAt: firstInstant,
  });
  accepted = await fetchPage();
  const semanticPage = await fetchPage(initial(semantic), semantic);
  expect(accepted.events[0]?.rawIdentity.sourceAccountId).toBe('unknown-capture-account');
  expect(semanticPage.events[0]?.payload.revision).toBe('capture-v2');
  for (const page of [accepted, semanticPage]) {
    expect(await bound.capturePage(page)).toEqual({ disposition: 'captured', captured: 1, cursor: page.next, replayed: false });
    expect(await bound.capturePage(page)).toEqual({ disposition: 'replayed', captured: 0, cursor: page.next, replayed: true });
  }
  expect(await count('runtime_capture_pages')).toBe('2');
  expect(await count('runtime_inbox')).toBe('2');
  const result = await runtime.query<{ event: unknown }>(
    "SELECT event - 'sequence' AS event FROM activity_events WHERE event->>'type' = 'source.captured' ORDER BY sequence",
  );
  expect(result.rows.map(row => row.event)).toEqual(Array.from({ length: 2 }, () => ({
    stream: 'runtime', phase: 'run', type: 'source.captured', at: firstInstant,
    payload: { sourceRef: sourceRef(), manifestHash: baseline.hash, captured: 1 },
  })));
  const current = await bound.readProgress();
  expect(await (await service().openCommitted(fixture.a.identity)).readProgress()).toEqual(current);
  expect(await immutableParent()).toEqual(before);
});

test('rejects malformed, unbound, oversized and incorrectly hashed input without writing incidents', async () => {
  const event = accepted.events[0]!;
  const before = await state(captureTables);
  for (const page of [
    { ...accepted, sourceRef: 'other-source' }, { ...accepted, streamId: 'unknown-stream' },
    { ...accepted, events: [{ ...event, contentHash: '0'.repeat(64) }] },
    { ...accepted, events: [changed(event, { resource: 'a-semantics' })] },
    { ...accepted, events: [changed(event, { rawIdentity: { companyId: 'other-company' } })] },
    { ...accepted, events: [event, event] },
    { ...accepted, events: Array.from({ length: 101 }, (_, index) => changed(event, {
      id: 'oversize-' + index, sequence: event.sequence + index,
    })), next: String(event.sequence + 100) },
    { ...accepted, after: '9007199254740992' }, { ...accepted, extra: true },
  ]) await expect(bound.capturePage(page)).rejects.toMatchObject(failure('INPUT_INVALID', 400));
  await expect(bound.capturePage({ ...accepted, complete: undefined } as unknown as ChangePage))
    .rejects.toMatchObject(failure('INPUT_INVALID', 400));
  expect(await state(captureTables)).toEqual(before);
});

test('records safe deduplicated incidents for conflicting overlap, page changes and gaps', async () => {
  const event = accepted.events[0]!;
  const before = await state(captureTables.filter(table => table !== 'runtime_capture_incidents'));
  const conflict = { ...accepted, events: [changed(event, { observedAt: '2026-11-09T08:00:01.000Z',
    payload: { secret: '/tmp/never-persist/token' },
  })] };
  await expect(bound.capturePage(conflict)).rejects.toMatchObject(failure('IDENTITY_CONFLICT', 409));
  instant = '2026-11-09T08:10:00.000Z';
  await expect(bound.capturePage(conflict)).rejects.toMatchObject(failure('IDENTITY_CONFLICT', 409));
  expect((await bound.readProgress()).streams[0]!.lastIncident).toMatchObject({
    code: 'CAPTURE_IDENTITY_CONFLICT', sourceIds: [event.id], observedAt: firstInstant,
  });
  await expect(bound.capturePage({ ...accepted, events: [changed(event, { id: 'different-delivery' })] }))
    .rejects.toMatchObject(failure('IDENTITY_CONFLICT', 409));
  await expect(bound.capturePage({ ...accepted, after: accepted.next, next: String(event.sequence + 1),
    events: [changed(event, { sequence: event.sequence + 1 })],
  })).rejects.toMatchObject(failure('IDENTITY_CONFLICT', 409));
  await expect(bound.capturePage({ ...accepted, complete: false }))
    .rejects.toMatchObject(failure('PAGE_CONFLICT', 409));
  const head = await fetchPage(accepted.next);
  await expect(bound.capturePage({ ...head, complete: false })).rejects.toMatchObject(failure('GAP', 409));
  await expect(bound.capturePage({ ...head, next: String(event.sequence + 1) })).rejects.toMatchObject(failure('GAP', 409));
  const skipped = changed(event, { id: 'capture-skipped-position', sequence: event.sequence + 2 });
  await expect(bound.capturePage({ ...head, next: String(skipped.sequence), events: [skipped] }))
    .rejects.toMatchObject(failure('GAP', 409));
  await expect(bound.capturePage({ ...head, after: String(event.sequence + 1), next: String(event.sequence + 1) }))
    .rejects.toMatchObject(failure('GAP', 409));
  expect(await count('runtime_capture_incidents')).toBe('8');
  expect(JSON.stringify(await state(['runtime_capture_incidents', 'activity_events']))).not.toContain('/tmp/never-persist/token');
  expect(await state(captureTables.filter(table => table !== 'runtime_capture_incidents'))).toEqual(before);
});

async function waitForBlocked(db: Pool, expected: number) {
  const end = performance.now() + 1200;
  do {
    const { rows: [row] } = await db.query<{ count: string }>(`
      SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
      AND pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0
    `);
    if (Number(row?.count) >= expected) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  } while (performance.now() < end);
  throw new Error('Expected capture transaction lock was never observed');
}

function settled<T>(promise: Promise<T>) {
  return promise.then(value => ({ value }), (error: unknown) => ({ error }));
}

async function pageRace(
  db: Pool,
  lock: (client: PoolClient) => Promise<unknown>,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  const blocker = await db.connect();
  let a: ReturnType<typeof settled> | undefined;
  let b: ReturnType<typeof settled> | undefined;
  try {
    await blocker.query('BEGIN');
    await lock(blocker);
    a = settled(first());
    await waitForBlocked(db, 1);
    b = settled(second());
    await waitForBlocked(db, 2);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  return Promise.all([a!, b!]);
}

const lockCheckpoint = (client: PoolClient) => client.query(`
  SELECT 1 FROM runtime_capture_checkpoints WHERE source_ref = $1 AND manifest_hash = $2 AND stream_id = $3 FOR UPDATE
`, [sourceRef(), baseline.hash, api]);

function currentPage() {
  return bound.readProgress().then(progress => fetchPage(progress.streams[0]!.captureCursor));
}

function prefix(page: ChangePage): ChangePage {
  return { ...page, next: String(page.events[0]!.sequence), events: [page.events[0]!] };
}

test('rejects a stale racing loser with a changed overlap and never inserts its suffix', async () => {
  const head = await currentPage();
  await addInvoice('conflict-race-winner');
  await addInvoice('conflict-race-suffix');
  const long = await fetchPage(head.after);
  const first = prefix(long);
  const before = await count('runtime_capture_incidents');
  const loser = { ...long, events: [
    changed(first.events[0]!, { observedAt: '2026-11-09T08:00:04.000Z' }), long.events[1]!,
  ] };
  expect(await pageRace(runtime, lockCheckpoint, () => bound.capturePage(first), () => bound.capturePage(loser)))
    .toEqual([
      { value: { disposition: 'captured', captured: 1, cursor: first.next, replayed: false } },
      { error: expect.objectContaining(failure('IDENTITY_CONFLICT', 409)) },
    ]);
  expect((await bound.readProgress()).streams[0]!.captureCursor).toBe(first.next);
  expect(Number(await count('runtime_capture_incidents'))).toBe(Number(before) + 1);
  expect((await runtime.query('SELECT 1 FROM runtime_deliveries WHERE event_id = $1', [long.events[1]!.id])).rowCount).toBe(0);
  expect(await bound.capturePage(await fetchPage(first.next))).toMatchObject({ disposition: 'captured', captured: 1 });
});

test('a harmless longer stale racing page refetches and captures its suffix once', async () => {
  const head = await currentPage();
  await addInvoice('refetch-race-winner');
  await addInvoice('refetch-race-suffix');
  const longer = await fetchPage(head.after);
  const first = prefix(longer);
  const before = await count('runtime_capture_incidents');
  expect(await pageRace(runtime, lockCheckpoint, () => bound.capturePage(first), () => bound.capturePage(longer)))
    .toEqual([
      { value: { disposition: 'captured', captured: 1, cursor: first.next, replayed: false } },
      { value: { disposition: 'refetch', captured: 0, cursor: first.next, replayed: false } },
    ]);
  expect((await runtime.query('SELECT 1 FROM runtime_deliveries WHERE event_id = $1', [longer.events[1]!.id])).rowCount).toBe(0);
  expect(await count('runtime_capture_incidents')).toBe(before);
  const suffix = await fetchPage(first.next);
  expect(await bound.capturePage(suffix)).toMatchObject({ disposition: 'captured', captured: 1 });
  expect(await bound.capturePage(suffix)).toMatchObject({ disposition: 'replayed', captured: 0 });
  expect(await bound.capturePage(head)).toMatchObject({ disposition: 'refetch', captured: 0, cursor: suffix.next });
  const historical = fixture.a.events.find(event => event.streamId === api && event.sequence === 1)!;
  expect(await bound.capturePage({ sourceRef: sourceRef(), streamId: api, complete: true,
    after: '0', next: '1', events: [historical],
  })).toMatchObject({ disposition: 'refetch', captured: 0, cursor: suffix.next });
});

async function failInsert(table: 'activity_events' | 'runtime_capture_incidents', check: () => Promise<void>) {
  await owner.query(`
    CREATE FUNCTION fail_capture_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'capture failure injected by integration'; END;
    $$;
    CREATE TRIGGER fail_capture_test BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_capture_test();
  `);
  try {
    await check();
  } finally {
    await owner.query('DROP FUNCTION fail_capture_test() CASCADE');
  }
}

test('activity failure rolls back deliveries, positions, page, inbox and checkpoint, then restart recovers exact replay', async () => {
  const head = await currentPage();
  await fixture.operator.schemaRenameA(operatorToken, {
    id: 'capture-new-schema', accountId: 'unknown-capture-account', amount: '5.00',
    dueDate: '2026-10-31', effectiveDate: '2026-10-01', observedAt: firstInstant,
  });
  const page = await fetchPage(head.after);
  expect(page.events[0]?.schemaVersion).toBe('schema-a-2');
  const tables = [...captureTables, 'activity_events', 'activity_counter', 'runtime_deliveries'];
  const before = await state(tables);
  const progress = await bound.readProgress();
  await failInsert('activity_events', async () => {
    await expect(bound.capturePage(page)).rejects.toMatchObject(failure('UNAVAILABLE', 503));
    expect(await state(tables)).toEqual(before);
    expect(await bound.readProgress()).toEqual(progress);
  });
  const at = instant = '2026-11-09T08:15:00.000Z';
  expect(await bound.capturePage(page)).toEqual({ disposition: 'captured', captured: 1, cursor: page.next, replayed: false });
  const current = await bound.readProgress();
  expect(current.streams[0]).toMatchObject({
    captureCursor: page.next, capturedRecords: progress.streams[0]!.capturedRecords + 1,
    capturedPages: progress.streams[0]!.capturedPages + 1, lastCapturedAt: at,
    lastIncident: progress.streams[0]!.lastIncident,
  });
  const restarted = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  try {
    const reopened = await createRuntimeCapture({ db: restarted, clock }).openCommitted(fixture.a.identity);
    expect(await reopened.readProgress()).toEqual(current);
    expect(await reopened.capturePage(page)).toEqual({ disposition: 'replayed', captured: 0, cursor: page.next, replayed: true });
  } finally {
    await restarted.end();
  }
});

test('incident-write failure returns unavailable without a false durable incident', async () => {
  const head = await currentPage();
  const before = await state([...captureTables, 'activity_events']);
  const invalid = { ...head, after: String(Number(head.after) + 1), next: String(Number(head.after) + 1) };
  await failInsert('runtime_capture_incidents', async () => {
    await expect(bound.capturePage(invalid)).rejects.toMatchObject(failure('UNAVAILABLE', 503));
    expect(await state([...captureTables, 'activity_events'])).toEqual(before);
  });
  await expect(bound.capturePage(invalid)).rejects.toMatchObject(failure('GAP', 409));
});

test('incident summaries retain only the lexically first 20 conflicting IDs', async () => {
  const head = await currentPage();
  for (let index = 21; index >= 1; index--) await addInvoice('capture-conflict-' + String(index).padStart(2, '0'));
  const page = await fetchPage(head.after);
  expect(page.events.length).toBe(21);
  expect(await bound.capturePage(page)).toMatchObject({ disposition: 'captured', captured: 21 });
  instant = '2026-11-09T08:20:00.000Z';
  const conflict = { ...page, events: page.events.map(event =>
    changed(event, { observedAt: '2026-11-09T08:00:05.000Z' })) };
  await expect(bound.capturePage(conflict)).rejects.toMatchObject(failure('IDENTITY_CONFLICT', 409));
  const { lastIncident } = (await bound.readProgress()).streams[0]!;
  expect(lastIncident).toEqual({
    code: 'CAPTURE_IDENTITY_CONFLICT', observedAt: instant, pageHash: hashCanonical(conflict),
    sourceIds: page.events.map(event => event.id).sort().slice(0, 20),
  });
});

test('app-role grants and foreign keys protect the persisted capture history', async () => {
  for (const table of captureTables.filter(table => table !== 'runtime_capture_checkpoints')) {
    await expect(runtime.query('UPDATE ' + table + ' SET source_ref = source_ref')).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('DELETE FROM ' + table)).rejects.toMatchObject({ code: '42501' });
    await expect(owner.query('UPDATE ' + table + ' SET source_ref = source_ref')).rejects.toMatchObject({ code: '55000' });
  }
  for (const column of ['source_ref', 'manifest_hash', 'stream_id', 'transport', 'baseline_cursor']) {
    await expect(runtime.query(`UPDATE runtime_capture_checkpoints SET ${column} = ${column}`))
      .rejects.toMatchObject({ code: '42501' });
  }
  await expect(runtime.query('DELETE FROM runtime_capture_checkpoints')).rejects.toMatchObject({ code: '42501' });
  await expect(runtime.query('CREATE TABLE capture_forbidden(id text)')).rejects.toMatchObject({ code: '42501' });
  await expect(runtime.query(`
    INSERT INTO runtime_source_positions VALUES ($1, $2, 1, 'missing-event')
  `, ['missing-source', api])).rejects.toMatchObject({ code: '23503' });
  await expect(runtime.query(`
    INSERT INTO runtime_capture_checkpoints (source_ref, manifest_hash, stream_id, transport, baseline_cursor, capture_cursor, captured_pages)
    VALUES ($1, $2, $3, 'api', 0, 0, 0)
  `, [sourceRef(), '0'.repeat(64), api])).rejects.toMatchObject({ code: '23503' });
  await expect(runtime.query('INSERT INTO runtime_inbox SELECT * FROM runtime_inbox LIMIT 1'))
    .rejects.toMatchObject({ code: '23505' });
  await expect(runtime.query('INSERT INTO runtime_capture_pages SELECT * FROM runtime_capture_pages LIMIT 1'))
    .rejects.toMatchObject({ code: '23505' });
  await expect(runtime.query('INSERT INTO runtime_capture_lanes SELECT * FROM runtime_capture_lanes LIMIT 1'))
    .rejects.toMatchObject({ code: '23505' });
  await expect(runtime.query('INSERT INTO runtime_capture_incidents SELECT * FROM runtime_capture_incidents LIMIT 1'))
    .rejects.toMatchObject({ code: '23505' });
  await expect(runtime.query('INSERT INTO runtime_capture_checkpoints SELECT * FROM runtime_capture_checkpoints LIMIT 1'))
    .rejects.toMatchObject({ code: '23505' });
  await expect(runtime.query(`
    INSERT INTO runtime_capture_incidents
      (source_ref, manifest_hash, stream_id, incident_hash, code, page_hash, source_ids_canonical, source_ids_digest, observed_at)
    VALUES ($1, $2, $3, $4, 'CAPTURE_GAP', $5, $6, $7, $8)
  `, [sourceRef(), baseline.hash, api, '0'.repeat(64), '1'.repeat(64), ...encodeCanonical(['z', 'a']), firstInstant]))
    .rejects.toMatchObject({ code: '23514' });
  const event = accepted.events[0]!;
  await expect(runtime.query('INSERT INTO runtime_source_positions VALUES ($1, $2, $3, $4)',
    [sourceRef(), api, event.sequence + 1000, event.id])).rejects.toMatchObject({ code: '23505' });
  await expect(runtime.query('INSERT INTO runtime_source_positions VALUES ($1, $2, $3, $4)',
    [sourceRef(), api, event.sequence, 'another-event'])).rejects.toMatchObject({ code: '23505' });
});

test('a progress read during a blocked write pairs only the last committed cursor and counts', async () => {
  const head = await currentPage();
  await addInvoice('capture-progress-snapshot');
  const page = await fetchPage(head.after);
  const old = await bound.readProgress();
  const activityBlocker = await runtime.connect();
  let operation: ReturnType<typeof settled> | undefined;
  try {
    await activityBlocker.query('BEGIN');
    await activityBlocker.query('SELECT 1 FROM activity_counter WHERE singleton FOR UPDATE');
    operation = settled(bound.capturePage(page));
    await waitForBlocked(runtime, 1);
    expect(await bound.readProgress()).toEqual(old);
  } finally {
    await activityBlocker.query('ROLLBACK');
    activityBlocker.release();
  }
  expect(await operation).toMatchObject({ value: { disposition: 'captured', captured: 1, cursor: page.next } });
  const progress = await bound.readProgress();
  expect(progress.streams[0]).toMatchObject({ captureCursor: page.next, capturedPages: old.streams[0]!.capturedPages + 1,
    capturedRecords: old.streams[0]!.capturedRecords + 1 });
});

// A second real reviewer subject comes from the third visible agreement. Use the
// existing protected producers and trusted activation path, including on epoch 2.
type EvidenceRoots = { visibleRoot: string; truthRoot: string };

async function preparePeerSubject(context: FixtureContext, roots: EvidenceRoots, label: string, account: 1 | 3) {
  const { candidates, dependencies, bootstrapRoots } = context;
  const { source, input } = await captureEvidenceFixture(dependencies, roots, 'a');
  const { manifest, snapshot, events } = input;
  const producer = decodeEvidenceProducer(input.producerJson);
  const identity = producer.identities.find(candidate => candidate.sourceAccountId.endsWith('-' + account))!;
  const contractFileId = identity.support[0]!.fileId;
  const citation = input.citations.find(item => item.evidence.sourceId === contractFileId &&
    item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1)!;
  const capture = { companyId: manifest.companyId, manifestId: manifest.id, contractFileId };
  const built = buildDemoCandidate({ source, capture, manifest, snapshot, events, citation });
  if (!('candidate' in built)) throw new Error('Synthetic visible agreement did not yield a candidate');
  const candidate = built.candidate.request;
  const spec = { ...candidate.spec, id: 'capture-spec-' + label };
  const draftProfile = { ...candidate.profiles[0]!, id: 'capture-profile-' + label };
  const profiles = [{ ...draftProfile, hash: hashProfile(draftProfile) }];
  const [profile] = profiles;
  const compiled = compile(spec, profiles);
  if (!compiled.ok || !profile?.bootstrap) throw new Error('Synthetic visible agreement did not compile');
  const { value: artifact } = compiled;
  await candidates.registerCandidate({ spec, profiles, artifact, manifest, snapshot });
  const selection = { artifactHash: artifact.hash, manifestId: manifest.id, selectedProfileHash: profile.hash };
  await pinProtectedEvidenceFixture(input, pathToFileURL(bootstrapRoots.evidencePinRoot + '/'));
  const captureReader = createFinancialCaptureReader({
    dependencies, service: peerSource, catalog: localSourceCatalog, registry: candidates,
  });
  const captureInput = await captureReader.readCapture(selection);
  const financialRegistry = createFinancialAttestationRegistry(dependencies.db, candidates);
  const launcher = createProtectedFinancialLauncher({
    registry: candidates, roots: { evidencePinRoot: bootstrapRoots.evidencePinRoot, servedRoots: bootstrapRoots.servedRoots },
  });
  const evaluatorBuildHash = await readFixedFinancialBuildHash();
  const jobId = 'capture-financial:' + label;
  const probe = await launcher.probe({
    protocolVersion: 'financial-attestation-probe-1', jobId, capture: captureInput, evaluatorBuildHash,
    selection: { fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2', purpose: 'construction',
      snapshotHash: snapshot.contentHash },
  });
  const term = producer.contracts.find(candidate => candidate.sourceAccountId === identity.sourceAccountId)!;
  const pin = await prepareBootstrapVerification(candidates, peerSource, { ...selection, review: {
    fixtureSetId: producer.fixtureSetId, fixtureSetVersion: 'bootstrap-capture-' + label, evidencePin: probe.evidencePin,
    subjects: [{
      profileHash: profile.hash, profileId: profile.id, scope: profile.scope, identityFactId: identity.id,
      customerId: identity.buyerId, customerEvidenceRefs: [citation.evidence.id],
      terms: profile.bootstrap.billingConfigurationIds.map(({ termId, id }) => ({
        factId: term.id, termId, configurationId: id, evidenceRefs: [citation.evidence.id],
      })),
    }],
  } }, bootstrapRoots);
  const reservation = {
    schemaVersion: '1', jobId, issuerId: 'eapr-control-registry-1', runnerId: 'eapr-financial-1',
    protocolVersion: '1', harnessVersion: '1', purpose: 'construction', evaluatorBuildHash,
    artifactHash: artifact.hash, requiredProfileHashes: artifact.requiredProfileHashes,
    capture: probe.capture, evidencePin: probe.evidencePin,
  } as const;
  await financialRegistry.reserve({
    protocolVersion: 'financial-attestation-1', jobId, capture: captureInput,
    reservation: { ...reservation, hash: hashFinancialReservation(reservation) },
  });
  const request = await financialRegistry.start(jobId);
  const { report } = await financialRegistry.complete(jobId, await launcher.launch(request));
  expect(report.eligible, JSON.stringify(report.checks)).toBe(true);
  const install = {
    policyId: 'capture-policy-' + label, entries: [{
      ...selection, financialReportId: report.id, bootstrapFixture: {
        fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, fixtureHash: pin.hash,
      },
    }],
  };
  const policyRoot = join(root, 'policy-' + label);
  await prepareAndPublishActivationPolicy({
    candidates, captureReader, financialRegistry, bootstrapRoots,
    readFinancialBuildHash: readFixedFinancialBuildHash, readBootstrapBuildPins: readFixedBootstrapBuildPins,
  }, install, { policyRoot, install: true });
  const selectionPath = join(root, 'selection-' + label + '.json');
  await writeFile(selectionPath, canonicalJson(install), { mode: 0o600 });
  return { policyPath: join(policyRoot, 'current.json'), selectionPath,
    selection, subject: { accountId: profile.scope.accountId } };
}

async function extendEpoch(originalRoots: EvidenceRoots, added: RawSourceEvent): Promise<EvidenceRoots> {
  const visibleRoot = join(root, 'visible-epoch-2');
  const truthRoot = join(root, 'truth-epoch-2');
  await cp(originalRoots.visibleRoot, visibleRoot, { recursive: true });
  await cp(originalRoots.truthRoot, truthRoot, { recursive: true });
  const read = async (directory: string, name: string): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(join(directory, name), 'utf8'));
  const write = (directory: string, name: string, value: unknown) =>
    writeFile(join(directory, name), canonicalJson(value));
  const manifest = BootstrapManifestSchema.parse(await read(visibleRoot, 'manifest-a.json'));
  const events = [...RawSourceEventSchema.array().parse(await read(visibleRoot, 'api-a.json')), added];
  const id = manifest.id + '-epoch-2';
  const { hash: _oldManifestHash, ...original } = manifest;
  const draft = { ...original, id, epoch: manifest.epoch + 1, streams: manifest.streams.map(stream => {
    const members = events.filter(event => event.streamId === stream.streamId);
    const resumeAfter = String(members.length);
    return { streamId: stream.streamId, snapshotId: 'member:' + id + ':' + stream.streamId, resumeAfter,
      eventIds: members.map(event => event.id),
      snapshotHash: streamContentHash(manifest.sourceRef, stream.streamId, resumeAfter, members),
    };
  }) };
  const manifestHash = hashManifest(draft);
  const path = 'api-a/' + hashCanonical(added.id) + '.json';
  const originals: unknown = JSON.parse(await readFile(join(visibleRoot, 'api-originals-a.json'), 'utf8'));
  if (!Array.isArray(originals)) throw new Error('Expected generated originals');
  await Promise.all([
    write(visibleRoot, 'manifest-a.json', { ...draft, hash: manifestHash }), write(visibleRoot, 'api-a.json', events),
    write(visibleRoot, path, added.payload), write(visibleRoot, 'api-originals-a.json', [...originals, { eventId: added.id, path }]),
  ]);
  const { hash: _oldTruthHash, ...truth } = await read(truthRoot, 'expected-a.json');
  const { hash: _oldProducerHash, ...producer } = await read(truthRoot, 'evidence-a.json');
  if (typeof truth.fixtureSetId !== 'string') throw new Error('Expected generated truth ID');
  const fixtureSetId = truth.fixtureSetId + ':epoch-2';
  // The extra semantic envelope adds no financial fact to the generated truth.
  const refreshedTruth = { ...truth, fixtureSetId, manifestId: id, manifestHash,
    inputEvents: events.map(({ id, contentHash }) => ({ id, contentHash })).sort((a, b) => a.id < b.id ? -1 : 1) };
  const producerTruthHash = hashCanonical(refreshedTruth);
  const refreshedProducer = { ...producer, fixtureSetId, manifestId: id, manifestHash, producerTruthHash };
  await Promise.all([
    write(truthRoot, 'expected-a.json', { ...refreshedTruth, hash: producerTruthHash }),
    write(truthRoot, 'evidence-a.json', { ...refreshedProducer, hash: hashCanonical(refreshedProducer) }),
  ]);
  return { visibleRoot, truthRoot };
}

test('serializes first initialization and keeps each genuine manifest baseline vector', async () => {
  const capture = createRuntimeCapture({ db: peer, clock });
  const lockLane = (client: PoolClient) => lockParentKeys(client, [canonicalJson(['capture-lane', peerA.manifest.sourceRef, peerA.manifest.hash])]);
  const [first, second] = await pageRace(peer, lockLane, () => capture.openCommitted(peerA.identity),
    () => capture.openCommitted(peerA.identity));
  expect(first).toMatchObject({ value: { lane: { manifestHash: peerA.manifest.hash } } });
  expect(second).toMatchObject({ value: { lane: { manifestHash: peerA.manifest.hash } } });
  const old = await capture.openCommitted(peerA.identity);
  const current = await capture.openCommitted(peerB.identity);
  expect(old.lane.manifestHash).not.toBe(current.lane.manifestHash);
  expect(peerB.manifest.hash).toBe(current.lane.manifestHash);
  const vector = async (lane: typeof bound) => (await lane.readProgress()).streams.map(stream =>
    [stream.streamId, stream.baselineCursor, stream.captureCursor, stream.capturedRecords]);
  expect(peerCursor(semantic)).toBe('0');
  const nextSemantic = String(Number(peerCursor(semantic)) + 1);
  expect(await vector(old)).toEqual([[api, peerCursor(api), peerCursor(api), 0], [semantic, peerCursor(semantic), peerCursor(semantic), 0]]);
  expect(await vector(current)).toEqual([[api, peerCursor(api), peerCursor(api), 0], [semantic, nextSemantic, nextSemantic, 0]]);
  const activity = await peer.query("SELECT * FROM activity_events WHERE event->>'type' = 'source.captured'");
  expect(activity.rowCount).toBe(0);
  const memberships = await peer.query('SELECT * FROM runtime_inbox');
  expect(memberships.rowCount).toBe(0);
});

test('concurrent capture of one delivery across lanes adds one global fact and two distinct memberships', async () => {
  const capture = createRuntimeCapture({ db: peer, clock });
  const [a, b] = await Promise.all([capture.openCommitted(peerA.identity), capture.openCommitted(peerB.identity)]);
  const first = prefix(await peerPage());
  const lockDelivery = (client: PoolClient) => lockImportIdentities(client, [], first.events);
  const result = { disposition: 'captured', captured: 1, cursor: first.next, replayed: false };
  expect(await pageRace(peer, lockDelivery, () => a.capturePage(first), () => b.capturePage(first)))
    .toEqual([{ value: result }, { value: result }]);
  const key = [peerA.manifest.sourceRef, first.events[0]!.id];
  expect((await peer.query('SELECT * FROM runtime_deliveries WHERE source_ref = $1 AND event_id = $2', key)).rowCount).toBe(1);
  expect((await peer.query('SELECT * FROM runtime_source_positions WHERE source_ref = $1 AND event_id = $2', key)).rowCount).toBe(1);
  expect((await peer.query('SELECT * FROM runtime_inbox WHERE source_ref = $1 AND event_id = $2', key)).rowCount).toBe(2);
  expect((await peer.query("SELECT * FROM activity_events WHERE event->>'type' = 'source.captured'")).rowCount).toBe(2);
});

test('cross-lane different delivery IDs racing for one position yield one accepted binding and one typed conflict', async () => {
  const capture = createRuntimeCapture({ db: peer, clock });
  const [a, b] = await Promise.all([capture.openCommitted(peerA.identity), capture.openCommitted(peerB.identity)]);
  const progress = await a.readProgress();
  const first = prefix(await peerPage(progress.streams[0]!.captureCursor));
  const different = { ...first, events: [changed(first.events[0]!, { id: 'cross-lane-conflicting-id' })] };
  const lockStream = (client: PoolClient) => lockParentKeys(client, [canonicalJson(['capture-source-stream', peerA.manifest.sourceRef, api])]);
  expect(await pageRace(peer, lockStream, () => a.capturePage(first), () => b.capturePage(different)))
    .toEqual([
      { value: { disposition: 'captured', captured: 1, cursor: first.next, replayed: false } },
      { error: expect.objectContaining(failure('IDENTITY_CONFLICT', 409)) },
    ]);
  expect((await b.readProgress()).streams[0]).toMatchObject({
    captureCursor: first.after, capturedRecords: 1, capturedPages: 1,
    lastIncident: { code: 'CAPTURE_IDENTITY_CONFLICT', sourceIds: [different.events[0]!.id, first.events[0]!.id].sort() },
  });
  expect((await peer.query('SELECT 1 FROM runtime_deliveries WHERE event_id = $1', [different.events[0]!.id])).rowCount).toBe(0);
  expect((await peer.query('SELECT event_id FROM runtime_source_positions WHERE source_ref = $1 AND stream_id = $2 AND sequence = $3',
    [peerA.manifest.sourceRef, api, first.next])).rows).toEqual([{ event_id: first.events[0]!.id }]);
});

const peerCursor = (streamId: string) => peerA.manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
const peerPage = (after = peerCursor(api)) => peerSource.fetchChanges(peerA.manifest.sourceRef, api, after);

async function preparePeerFixtures() {
  peerPair = await provisionTest(peerNamespace);
  sharedPair = await provisionTest(sharedNamespace);
  peer = createRuntimeDb({ connectionString: peerPair.runtime.appUrl });
  peerControl = createControlDb({ connectionString: peerPair.control.appUrl });
  sharedDb = createRuntimeDb({ connectionString: sharedPair.runtime.appUrl });
  const catalog = readMigrationCatalog();
  await migrate(peerPair, migrationStreams, catalog);
  await migrate(sharedPair, ['runtime'], catalog);

  const roots = { visibleRoot: join(root, 'paired-visible'), truthRoot: join(root, 'paired-truth') };
  const registryRoot = join(root, 'paired-registry');
  const storeRoot = join(root, 'paired-originals');
  const store = await createEvidenceStore(storeRoot);
  const dependencies = { db: peerControl, store, clock };
  const context = {
    dependencies, registryRoot, candidates: createCandidateRegistry(peerControl, registryRoot),
    scopeReader: createRegisteredScopeReader({ registryRoot }),
    bootstrapRoots: { sidecarRoot: join(root, 'paired-bootstrap'), evidencePinRoot: join(root, 'paired-evaluator'),
      servedRoots: [roots.visibleRoot, storeRoot, registryRoot, join(root, 'visible-epoch-2')] },
  };
  sharedScopes = context.scopeReader;
  peerSource = createSourceService(dependencies, localSourceCatalog);
  peerOperator = createScenarioAdmin(dependencies, { DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operatorToken });
  await generateSecondQualifyingAccount(roots);
  const first = await preparePeerSubject(context, roots, 'peer-first', 1);
  const same = await preparePeerSubject(context, roots, 'peer-shared', 3);
  const publish = createRegisteredScopePublication(context).publishRegisteredScopes;
  await publish([first.selection, same.selection]);
  [peerA] = await activateSubjects(peer, context, [{ subject: first.subject, key: 'capture-approve-peer-a' }], first) as [Committed];
  [sharedA] = await activateSubjects(sharedDb, context, [
    { subject: first.subject, key: 'capture-approve-shared-a' },
  ], first) as [Committed];
  [sharedB] = await activateSubjects(sharedDb, context, [
    { subject: same.subject, key: 'capture-approve-shared-b' },
  ], same) as [Committed];

  const [added] = await peerOperator.semanticChangeA(operatorToken, {
    id: 'capture-peer-epoch-2', accountId: 'unknown-capture-account', revision: 'capture-v2',
    effectiveDate: '2026-10-01', observedAt: firstInstant,
  });
  const next = await preparePeerSubject(context, await extendEpoch(roots, added!), 'peer-extended', 3);
  await publish([first.selection, next.selection]);
  [peerB] = await activateSubjects(peer, context, [{ subject: next.subject, key: 'capture-approve-peer-b' }], next) as [Committed];

  for (const id of ['peer-first-page', 'peer-conflict-page']) {
    await peerOperator.freshInvoiceA(operatorToken, {
      id, accountId: 'unknown-capture-account', amount: '5.00', dueDate: '2026-10-31',
      effectiveDate: '2026-10-01', observedAt: firstInstant,
    });
  }
}

test('a second independently approved account on the same lane preserves existing capture progress', async () => {
  const capture = createRuntimeCapture({ db: sharedDb, clock });
  const first = await capture.openCommitted(sharedA.identity);
  const page = prefix(await peerPage());
  expect(await first.capturePage(page)).toMatchObject({ disposition: 'captured', captured: 1 });
  const progress = await first.readProgress();
  expect(sharedA.identity.scope).not.toEqual(sharedB.identity.scope);
  expect(sharedA.identity.activationId).not.toBe(sharedB.identity.activationId);
  const second = await capture.openCommitted(sharedB.identity);
  expect(second.lane).toEqual(first.lane);
  expect(await second.readProgress()).toEqual(progress);
  expect((await sharedDb.query('SELECT initial_activation_id FROM runtime_capture_lanes')).rows)
    .toEqual([{ initial_activation_id: sharedA.identity.activationId }]);

  // The operations read resolves the shared lane by each account's own committed source and manifest.
  const reads = createConnectionReads(sharedDb, sharedScopes);
  const [viewA, viewB] = await Promise.all([
    reads.readConnection(sharedA.identity.scope.accountId), reads.readConnection(sharedB.identity.scope.accountId),
  ]);
  expect(viewA.streams.length).toBeGreaterThan(0);
  expect(viewB.streams).toEqual(viewA.streams);
  expect(viewB.incidents).toEqual(viewA.incidents);
  expect(viewB.activationId).toBe(sharedB.identity.activationId);
});

async function generateSecondQualifyingAccount({ visibleRoot, truthRoot }: EvidenceRoots) {
  // The public generator has just one $3,000 account. Give its third account a
  // separate $3,000 agreement and matching original invoices/payments/allocations
  // before either source is published, so both subjects qualify independently.
  const seed = 'capture-two-accounts';
  await generateFixtures({ seed, asOf: activationCutover, visibleRoot, truthRoot });
  const generated = fixtureA(seed, activationCutover);
  const account = generated.accounts[2]!;
  const read = async (directory: string, name: string): Promise<unknown> =>
    JSON.parse(await readFile(join(directory, name), 'utf8'));
  const write = (directory: string, name: string, value: unknown) =>
    writeFile(join(directory, name), canonicalJson(value));
  // Start the semantic feed at zero while preserving the source's declared
  // current revisions and the original financial evidence.
  const priorEvents = RawSourceEventSchema.array().parse(await read(visibleRoot, 'api-a.json'))
    .filter(event => event.kind !== 'semantic_change');
  const events = priorEvents.map(event => event.rawIdentity.sourceAccountId === account.accountId
    ? changed(event, { payload: { ...event.payload, amount: '3000.00' } }) : event);
  for (const event of events.filter(candidate => candidate.rawIdentity.sourceAccountId === account.accountId)) {
    await write(visibleRoot, 'api-a/' + hashCanonical(event.id) + '.json', event.payload);
  }
  const title = 'Fixed monthly agreement ' + account.contractId;
  const fee = 'Monthly fee USD 3000.00';
  const lines = [title, 'Seller seller-a; buyer ' + account.entityId + '; account ' + account.accountId,
    'Legal name ' + account.displayName, fee, 'Effective ' + generated.month(-3) + '; monthly invoice anchor day 1.'];
  const agreement = await textPdf(lines, activationCutover, title);
  const agreementHash = hashBytes(agreement);
  await writeFile(join(visibleRoot, 'contract-3.pdf'), agreement);
  const { hash: _oldManifestHash, ...manifest } = BootstrapManifestSchema.parse(await read(visibleRoot, 'manifest-a.json'));
  const agreementFileId = manifest.files.find(file => file.documentId.endsWith('-contract-3'))!.fileId;
  const draft = { ...manifest,
    files: manifest.files.map(file => file.fileId === agreementFileId ? { ...file, sha256: agreementHash } : file),
    streams: manifest.streams.map(member => {
      const members = events.filter(event => event.streamId === member.streamId);
      const resumeAfter = String(members.length);
      return { ...member, resumeAfter, eventIds: members.map(event => event.id),
        snapshotHash: streamContentHash(manifest.sourceRef, member.streamId, resumeAfter, members) };
    }),
  };
  const manifestHash = hashManifest(draft);
  const originals = await read(visibleRoot, 'api-originals-a.json');
  if (!Array.isArray(originals)) throw new Error('Expected generated originals');
  const eventIds = new Set(events.map(event => event.id));
  await Promise.all([
    write(visibleRoot, 'api-a.json', events), write(visibleRoot, 'manifest-a.json', { ...draft, hash: manifestHash }),
    write(visibleRoot, 'api-originals-a.json', originals.filter(entry => eventIds.has(entry.eventId))),
  ]);

  const { hash: _oldTruthHash, ...truth } = await read(truthRoot, 'expected-a.json') as {
    hash: string; accounts: { sourceAccountId: string; records: Record<string, unknown>[] }[];
    evidence: { fileId: string; originalSha256: string; text: string }[];
  };
  const refreshedTruth = { ...truth, manifestHash,
    inputEvents: events.map(({ id, contentHash }) => ({ id, contentHash })).sort((a, b) => a.id < b.id ? -1 : 1),
    accounts: truth.accounts.map(entry => entry.sourceAccountId === account.accountId
      ? { ...entry, records: entry.records.map(record => ({ ...record, amountCents: 300000 })) } : entry),
    evidence: truth.evidence.map(file => file.fileId === agreementFileId
      ? { ...file, originalSha256: agreementHash, text: lines.join(' ') } : file),
  };
  const producerTruthHash = hashCanonical(refreshedTruth);
  const { hash: _oldProducerHash, ...producer } = decodeEvidenceProducer(await readFile(join(truthRoot, 'evidence-a.json'), 'utf8'));
  const refreshedProducer = { ...producer, manifestHash, producerTruthHash,
    contracts: producer.contracts.map(contract => contract.sourceAccountId === account.accountId ? {
      ...contract, fixedMonthlyFeeCents: 300000,
      support: contract.support.map(support => support.field === 'fixedMonthlyFeeCents' || support.field === 'currency'
        ? { ...support, expectedLiteral: fee } : support),
    } : contract),
  };
  await Promise.all([
    write(truthRoot, 'expected-a.json', { ...refreshedTruth, hash: producerTruthHash }),
    write(truthRoot, 'evidence-a.json', { ...refreshedProducer, hash: hashCanonical(refreshedProducer) }),
  ]);
}

test('a stale response fails closed when the accepted page points to a corrupt delivery digest', async () => {
  const eventId = accepted.events[0]!.id;
  const key = [sourceRef(), eventId];
  const read = await owner.query<{ digest: string }>(
    'SELECT digest FROM runtime_deliveries WHERE source_ref = $1 AND event_id = $2', key,
  );
  const replace = (digest: string) => withTransaction(owner, async client => {
    await client.query('ALTER TABLE runtime_deliveries DISABLE TRIGGER runtime_deliveries_immutable');
    await client.query('UPDATE runtime_deliveries SET digest = $3 WHERE source_ref = $1 AND event_id = $2', [...key, digest]);
    await client.query('ALTER TABLE runtime_deliveries ENABLE TRIGGER runtime_deliveries_immutable');
  });
  await replace('0'.repeat(64));
  try {
    await expect(bound.capturePage({ ...accepted, events: [], next: accepted.after }))
      .rejects.toMatchObject(failure('STORAGE_INVALID', 503));
  } finally {
    await replace(read.rows[0]!.digest);
  }
});

test('bound operations fail closed when saved lane definitions change even with a recomputed digest', async () => {
  const key = [sourceRef(), baseline.hash];
  const read = await owner.query<{ capture_canonical: string; capture_digest: string }>(
    'SELECT capture_canonical, capture_digest FROM runtime_capture_lanes WHERE source_ref = $1 AND manifest_hash = $2', key,
  );
  const saved = read.rows[0]!;
  const replace = (canonical: string, digest: string) => withTransaction(owner, async client => {
    await client.query('ALTER TABLE runtime_capture_lanes DISABLE TRIGGER runtime_capture_lanes_immutable');
    await client.query('UPDATE runtime_capture_lanes SET capture_canonical = $3, capture_digest = $4 WHERE source_ref = $1 AND manifest_hash = $2',
      [...key, canonical, digest]);
    await client.query('ALTER TABLE runtime_capture_lanes ENABLE TRIGGER runtime_capture_lanes_immutable');
  });
  const definition = JSON.parse(saved.capture_canonical) as { streamId: string; pageSize: number }[];
  definition.find(stream => stream.streamId === api)!.pageSize--;
  await replace(...encodeCanonical(definition));
  try {
    await expect(bound.readProgress()).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    await expect(bound.capturePage(accepted)).rejects.toMatchObject(failure('STORAGE_INVALID', 503));
    await expect(service().openCommitted(fixture.a.identity)).rejects.toMatchObject(failure('BINDING_CONFLICT', 409));
  } finally {
    await replace(saved.capture_canonical, saved.capture_digest);
  }
});
