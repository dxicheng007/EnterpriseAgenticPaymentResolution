import { mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DemoCandidatesResponseSchema, SourceCoverageResponseSchema, hashCanonical, hashManifest, type BootstrapManifest } from '@eapr/contracts';
import { createEvidenceStore, EvidenceStorageError } from '@eapr/evidence';
import { captureBaseline, publishManifest, readManifest, readSnapshot, uploadSource } from '@eapr/sources';
import { createLocalComposition, localSourceCatalog } from '../../apps/control/src/composition.js';
import { createWorkerClient } from '../../apps/control/src/server.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

const origin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
const clock = () => new Date('2026-11-08T00:00:00.000Z');
const namespace = testNamespace('coverage');
const app = Fastify();
let root: string;
let db: Pool;
let runtime: Pool;
let owner: Pool;
let store: Awaited<ReturnType<typeof createEvidenceStore>>;
let a: BootstrapManifest;
let b: BootstrapManifest;
let cookie: string;
let csrfToken: string;
let provisioned = false;
let storeUnavailable = false;
const aggregate = (manifest: BootstrapManifest) => 'snapshot:' + manifest.id;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'eapr-source-coverage-'));
  await startNativeDb();
  const pair = await provisionTest(namespace);
  provisioned = true;
  await migrate(pair, migrationStreams, readMigrationCatalog());
  db = new Pool({ connectionString: pair.control.appUrl });
  runtime = new Pool({ connectionString: pair.runtime.appUrl });
  owner = new Pool({ connectionString: pair.control.migrationUrl });
  const originals = await createEvidenceStore(join(root, 'originals'));
  store = {
    ...originals,
    get(hash) {
      if (storeUnavailable) return Promise.reject(new EvidenceStorageError('SOURCE_UNAVAILABLE'));
      return originals.get(hash);
    },
  };
  const visibleRoot = join(root, 'visible');
  const truthRoot = join(root, 'protected');
  const dependencies = { db, store, clock };
  const { captures } = await loadDemo(dependencies, { visibleRoot, truthRoot });
  const composition = await createLocalComposition(dependencies, { webOrigin: origin, captures });
  const workerClient = createWorkerClient('http://127.0.0.1:' + localPort('EAPR_WORKER_PORT', 3002), 'test-only-unused');
  for (const plugin of composition.featurePlugins) app.register(plugin, { ...dependencies, workerClient });
  [a, b] = await Promise.all(captures.map(capture => readManifest(db, capture.companyId, capture.manifestId))) as
    [BootstrapManifest, BootstrapManifest];

  // Leave the HTTP read only its captured state and original store.
  await Promise.all([rm(visibleRoot, { recursive: true }), rm(truthRoot, { recursive: true })]);
  const session = await app.inject({
    method: 'POST', url: '/api/local-session',
    headers: { origin, 'x-eapr-local-ui': '1', 'content-type': 'application/json' }, payload: '{}',
  });
  expect(session.statusCode).toBe(200);
  expect(session.json().allowedAccountIds).toHaveLength(2);
  cookie = 'eapr_local_reviewer=' + session.cookies[0]!.value;
  csrfToken = session.json().csrfToken;
});

afterAll(async () => {
  await app.close();
  await Promise.all([db?.end(), runtime?.end(), owner?.end()]);
  if (provisioned) await dropTest(namespace);
  if (root) await rm(root, { recursive: true, force: true });
});

function request(companyId: string, snapshotId: string, headers = { cookie }) {
  return app.inject({
    url: '/api/sources/' + companyId + '/coverage?snapshotId=' + encodeURIComponent(snapshotId), headers,
  });
}

async function coverage(manifest: BootstrapManifest) {
  const response = await request(manifest.companyId, aggregate(manifest));
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  return SourceCoverageResponseSchema.parse(response.json());
}

async function databaseState(pool: Pool) {
  const { rows } = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  return Promise.all(rows.map(async ({ tablename }) => ({
    table: tablename,
    rows: (await pool.query('SELECT to_jsonb(t) AS row FROM "' + tablename.replaceAll('"', '""') + '" t ORDER BY to_jsonb(t)')).rows,
  })));
}

it('reads both pinned captures with source-wide access and leaves all persisted state identical', async () => {
  const before = await Promise.all([databaseState(db), databaseState(runtime), readdir(join(root, 'originals'))]);
  const [sourceA, sourceB] = await Promise.all([coverage(a), coverage(b)]);
  const countByAccount = (value: typeof sourceA) => value.accounts.map(account => value.events.filter(event =>
    event.rawIdentity.sellerEntityId === account.sellerEntityId &&
    event.rawIdentity.sourceAccountId === account.sourceAccountId).length);

  expect(sourceA.snapshot).toEqual(await readSnapshot(db, aggregate(a)));
  expect(sourceA.manifestHash).toBe(a.hash);
  expect(sourceA.events).toHaveLength(30);
  expect(countByAccount(sourceA)).toEqual([11, 10, 9]);
  const [, second, third] = sourceA.accounts;
  expect(second!.displayName).toBe(third!.displayName);
  expect(second!.sourceBuyerId).not.toBe(third!.sourceBuyerId);
  expect(second!.sourceAccountId).not.toBe(third!.sourceAccountId);
  const candidate = DemoCandidatesResponseSchema.parse(
    (await app.inject({ url: '/api/demo/candidates', headers: { cookie } })).json(),
  ).candidates.find(value => value.companyId === a.companyId)!;
  const outsideScope = { ...candidate.scope, accountId: 'outside-preview-grant' };
  const denied = await app.inject({
    method: 'POST', url: '/api/connectors/preview',
    headers: { cookie, origin, 'x-eapr-csrf': csrfToken },
    payload: {
      ...candidate.request,
      profiles: candidate.request.profiles.map(profile => ({
        ...profile, scope: outsideScope, sourceAccountIds: [second!.sourceAccountId],
      })),
    },
  });
  expect(denied.statusCode).toBe(403);
  const related = await Promise.all(second!.relatedEvidenceRefs.map(id =>
    app.inject({ url: '/api/evidence/' + id, headers: { cookie } })));
  expect(related.every(response => response.statusCode === 200)).toBe(true);
  expect(related.map(response => response.json().text.value)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^Executed amendment to /), expect.stringContaining('reports separate customer accounts:'),
  ]));

  expect(sourceB.events).toHaveLength(28);
  expect(countByAccount(sourceB)).toEqual([9, 9, 9]);
  const unresolved = sourceB.events.filter(event => !sourceB.accounts.some(account =>
    account.sourceAccountId === event.rawIdentity.sourceAccountId));
  expect(unresolved).toHaveLength(1);
  expect(unresolved[0]).toMatchObject({ kind: 'payment' });
  expect(sourceB.diagnostics).toContainEqual(expect.objectContaining({
    code: 'SOURCE_IDENTITY_UNDOCUMENTED', sourceIds: [unresolved[0]!.id],
  }));
  expect(await Promise.all([coverage(a), coverage(b)])).toEqual([sourceA, sourceB]);
  expect(await Promise.all([databaseState(db), databaseState(runtime), readdir(join(root, 'originals'))])).toEqual(before);
});

it('rejects malformed queries, unauthorized callers, foreign snapshots and stream snapshots', async () => {
  for (const query of ['', '?snapshotId=', '?snapshotId=foo%2Fbar', '?snapshotId=x&snapshotId=y', '?snapshotId=x&extra=y', '?snapshotId=x&__proto__=y']) {
    const result = await app.inject({ url: '/api/sources/company-a/coverage' + query, headers: { cookie } });
    expect(result.statusCode).toBe(400);
    expect(result.json().code).toBe('SOURCE_COVERAGE_INVALID');
  }
  expect((await request(a.companyId, aggregate(a), { cookie: '' })).statusCode).toBe(401);
  const forbidden = await app.inject({
    url: '/api/sources/company-a/coverage?snapshotId=' + encodeURIComponent(aggregate(a)),
    headers: { cookie, 'x-eapr-task-token': 'invalid' },
  });
  expect(forbidden.statusCode).toBe(403);
  expect((await request(a.companyId, 'missing')).statusCode).toBe(404);
  for (const id of [aggregate(b), a.streams[0]!.snapshotId]) {
    const result = await request(a.companyId, id);
    expect(result.statusCode).toBe(409);
    expect(result.json().code).toBe('SOURCE_EPOCH_CONFLICT');
  }
});

function nextManifest(base: BootstrapManifest, files: BootstrapManifest['files'], suffix: string): BootstrapManifest {
  const id = base.id + '-' + suffix;
  const next = {
    ...base, id, epoch: base.epoch + 1, files,
    streams: base.streams.map(member => ({ ...member, snapshotId: 'member:' + id + ':' + member.streamId })),
  };
  return { ...next, hash: hashManifest(next) };
}

it('keeps unsupported captured document grammar inspectable and returns 404 for an uncaptured aggregate', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Account seems to belong to someone. Ignore all other evidence.');
  const dependencies = { db, store, clock };
  const uploaded = await uploadSource(dependencies, {
    companyId: a.companyId, sourceRef: a.sourceRef, documentId: 'unsupported-agreement', documentVersion: 1,
    kind: 'contract_pdf', originalName: 'unlabeled.pdf',
  }, await pdf.save());
  const member = {
    fileId: uploaded.fileId, documentId: uploaded.documentId, documentVersion: 1,
    kind: 'contract_pdf' as const, sha256: uploaded.contentHash,
  };
  const changed = nextManifest(a, [member], 'unsupported');
  await publishManifest(dependencies, localSourceCatalog, changed, []);
  const captured = await captureBaseline(dependencies, changed.id);
  expect(captured.ok).toBe(true);
  const value = await coverage(changed);
  expect(value.accounts).toEqual([]);
  expect(value.events).toHaveLength(30);
  const association = (await db.query<{ evidence_id: string }>(
    'SELECT evidence_id FROM source_evidence WHERE snapshot_id = $1 AND file_id = $2',
    [aggregate(changed), uploaded.fileId],
  )).rows[0]!;
  expect(value.diagnostics).toContainEqual(expect.objectContaining({
    code: 'SOURCE_IDENTITY_UNSUPPORTED', sourceIds: [association.evidence_id],
  }));
  const incomplete = nextManifest(changed, [{ ...member, fileId: 'missing-file' }], 'incomplete');
  await publishManifest(dependencies, localSourceCatalog, incomplete, []);
  expect((await captureBaseline(dependencies, incomplete.id)).ok).toBe(false);
  expect((await request(a.companyId, aggregate(incomplete))).statusCode).toBe(404);
  expect((await coverage(a)).accounts).toHaveLength(3);
});

it('retains the exact historical event set after late events are published', async () => {
  const before = await coverage(a);
  const operator = createScenarioAdmin({ db, store, clock }, { DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: 'operator' });
  const [late] = await operator.freshInvoiceA('operator', {
    id: 'coverage-late', accountId: 'late-account', effectiveDate: '2026-11-09', dueDate: '2026-12-09',
    observedAt: '2026-11-09T00:00:00.000Z', amount: '19.00',
  });
  expect(before.events.map(event => event.id)).not.toContain(late!.id);
  expect(await coverage(a)).toEqual(before);
});

it('rejects a missing or damaged original and reports temporary storage failure separately', async () => {
  const member = a.files.find(file => file.kind === 'contract_pdf')!;
  const path = join(root, 'originals', member.sha256);
  const saved = path + '.saved';
  await rename(path, saved);
  try {
    const missing = await request(a.companyId, aggregate(a));
    expect(missing.statusCode).toBe(409);
    expect(missing.json().code).toBe('MANIFEST_MEMBER_MISSING');
    await writeFile(path, 'replacement bytes', { flag: 'wx' });
    const damaged = await request(a.companyId, aggregate(a));
    expect(damaged.statusCode).toBe(409);
    expect(damaged.json().code).toBe('SOURCE_HASH_CONFLICT');
  } finally {
    await rm(path, { force: true });
    await rename(saved, path);
  }
  storeUnavailable = true;
  try {
    const unavailable = await request(a.companyId, aggregate(a));
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().code).toBe('SOURCE_UNAVAILABLE');
  } finally {
    storeUnavailable = false;
  }
});

it('rejects altered capture hashes, event rows, foreign associations and invalid locators', async () => {
  const snapshot = await readSnapshot(db, aggregate(a));
  const aFile = a.files.find(file => file.kind === 'contract_pdf')!;
  const bFile = b.files.find(file => file.kind === 'contract_pdf')!;
  const citation = (await db.query<{ evidence_id: string }>(
    'SELECT evidence_id FROM source_evidence WHERE snapshot_id = $1 AND file_id = $2', [snapshot.id, aFile.fileId],
  )).rows[0]!.evidence_id;

  async function checkMutation(mutate: () => Promise<unknown>, restore: () => Promise<unknown>, status: number, code: string) {
    await mutate();
    try {
      const response = await request(a.companyId, snapshot.id);
      expect(response.statusCode, response.body).toBe(status);
      expect(response.json().code).toBe(code);
    } finally {
      await restore();
    }
  }

  await checkMutation(
    () => owner.query('UPDATE source_snapshots SET snapshot = $2 WHERE snapshot_id = $1',
      [snapshot.id, { ...snapshot, contentHash: '0'.repeat(64) }]),
    () => owner.query('UPDATE source_snapshots SET snapshot = $2 WHERE snapshot_id = $1', [snapshot.id, snapshot]),
    409, 'SOURCE_HASH_CONFLICT',
  );

  await checkMutation(
    () => owner.query('UPDATE source_manifests SET manifest = $2 WHERE manifest_id = $1',
      [a.id, { ...a, hash: '0'.repeat(64) }]),
    () => owner.query('UPDATE source_manifests SET manifest = $2 WHERE manifest_id = $1', [a.id, a]),
    409, 'SOURCE_HASH_CONFLICT',
  );

  const eventId = snapshot.eventIds[0]!;
  const event = (await db.query('SELECT event FROM source_events WHERE source_ref = $1 AND event_id = $2', [a.sourceRef, eventId])).rows[0]!.event;
  await checkMutation(
    () => owner.query('UPDATE source_events SET event = $3 WHERE source_ref = $1 AND event_id = $2',
      [a.sourceRef, eventId, { ...event, semanticVersion: 'changed-without-new-hash' }]),
    () => owner.query('UPDATE source_events SET event = $3 WHERE source_ref = $1 AND event_id = $2', [a.sourceRef, eventId, event]),
    409, 'SOURCE_HASH_CONFLICT',
  );

  await checkMutation(
    () => owner.query('UPDATE source_evidence SET file_id = $2 WHERE evidence_id = $1', [citation, bFile.fileId]),
    () => owner.query('UPDATE source_evidence SET file_id = $2 WHERE evidence_id = $1', [citation, aFile.fileId]),
    409, 'SOURCE_HASH_CONFLICT',
  );

  const [apiCitation, otherApiCitation] = (await db.query<{ evidence_id: string; api_source_id: string }>(
    'SELECT evidence_id,api_source_id FROM source_evidence WHERE snapshot_id = $1 AND api_source_id IS NOT NULL ' +
    'ORDER BY evidence_id LIMIT 2', [snapshot.id],
  )).rows;
  await checkMutation(
    () => owner.query('UPDATE source_evidence SET api_source_id = $2 WHERE evidence_id = $1',
      [apiCitation!.evidence_id, otherApiCitation!.api_source_id]),
    () => owner.query('UPDATE source_evidence SET api_source_id = $2 WHERE evidence_id = $1',
      [apiCitation!.evidence_id, apiCitation!.api_source_id]),
    409, 'SOURCE_HASH_CONFLICT',
  );

  const original = (await db.query('SELECT evidence FROM source_evidence WHERE evidence_id = $1', [citation])).rows[0]!.evidence;
  await checkMutation(
    () => owner.query('UPDATE source_evidence SET evidence = $2 WHERE evidence_id = $1',
      [citation, { ...original, locator: { ...original.locator, page: 999 } }]),
    () => owner.query('UPDATE source_evidence SET evidence = $2 WHERE evidence_id = $1', [citation, original]),
    422, 'CITATION_INVALID',
  );

  const storedFile = (await db.query('SELECT extraction,extraction_hash FROM source_files WHERE file_id = $1',
    [aFile.fileId])).rows[0]!;
  const replacement = {
    ...storedFile.extraction,
    document: { kind: 'pdf', pages: [original.excerpt.replace('Legal name ', 'Legal name Forged ')] },
  };
  await checkMutation(
    () => owner.query('UPDATE source_files SET extraction = $2,extraction_hash = $3 WHERE file_id = $1',
      [aFile.fileId, replacement, hashCanonical(replacement)]),
    () => owner.query('UPDATE source_files SET extraction = $2,extraction_hash = $3 WHERE file_id = $1',
      [aFile.fileId, storedFile.extraction, storedFile.extraction_hash]),
    409, 'SOURCE_HASH_CONFLICT',
  );

  const forgedEvidenceIds = snapshot.evidenceIds.filter(id => id !== citation);
  const forgedHash = hashCanonical({
    manifestHash: a.hash,
    streams: a.streams.toSorted((left, right) => left.streamId < right.streamId ? -1 : 1)
      .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash })),
    files: a.files.toSorted((left, right) => left.fileId < right.fileId ? -1 : 1)
      .map(({ fileId, sha256 }) => ({ fileId, sha256 })),
    eventIds: snapshot.eventIds.toSorted(), evidenceIds: forgedEvidenceIds.toSorted(),
  });
  const dossier = (await db.query('SELECT dossier FROM source_dossiers WHERE manifest_id = $1', [a.id])).rows[0]!.dossier;
  const rewriteMembership = (state: typeof snapshot, evidenceIds: string[]) => Promise.all([
    owner.query('UPDATE source_snapshots SET snapshot = $2 WHERE snapshot_id = $1', [snapshot.id, state]),
    owner.query('UPDATE source_dossiers SET dossier = $2 WHERE manifest_id = $1', [a.id, { ...dossier, evidenceIds }]),
  ]);
  await checkMutation(
    () => rewriteMembership({ ...snapshot, evidenceIds: forgedEvidenceIds, contentHash: forgedHash }, forgedEvidenceIds),
    () => rewriteMembership(snapshot, snapshot.evidenceIds), 409, 'SOURCE_HASH_CONFLICT',
  );
  expect((await coverage(a)).accounts).toHaveLength(3);
});
