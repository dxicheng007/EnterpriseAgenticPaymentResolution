import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  canonicalJson, hashBytes, hashCanonical, hashEvent, hashManifest, QuerySnapshotResultSchema,
  type BootstrapManifest, type DiscoveryBinding, type DiscoveryReadToolCall, type ManifestFile,
  type RawSourceEvent, type SourceReadGrant,
} from '@eapr/contracts';
import { createEvidenceStore, type EvidenceStore } from '@eapr/evidence';
import {
  captureBaseline, companyA, companyB, createDiscoveryReadTools, prepareApiRecord, publishManifest,
  streamContentHash, uploadSource, type DiscoveryReadTools, type SourceDefinition,
} from '@eapr/sources';
import { eventA } from '../../packages/sources/src/company-a.js';
import { encodeBatch, eventB } from '../../packages/sources/src/company-b.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

const catalog = new Map<string, SourceDefinition>([[companyA.companyId, companyA], [companyB.companyId, companyB]]);
const now = '2026-10-01T00:00:00.000Z';
const date = '2026-10-01';
const namespace = testNamespace('readtools');
const body = 'shared needle 😀' + 'x'.repeat(10_000);
let root: string;
let provisioned = false;
let db: Pool;
let admin: Pool;
let runtime: Pool;
let store: EvidenceStore;
let tools: DiscoveryReadTools;
let a: Fixture;
let b: Fixture;

type Fixture = {
  binding: DiscoveryBinding;
  events: RawSourceEvent[];
  emailId: string;
  emailHash: string;
  fileId: string;
  csvId?: string;
};
function citationId(snapshotId: string, sourceId: string, locator: object) {
  return 'ev:' + hashCanonical({ snapshotId, sourceId, locator });
}

function apiCitation(fixture: Fixture, event: RawSourceEvent) {
  const { companyId, sourceRef, snapshotId } = fixture.binding;
  const original = 'api:' + hashCanonical({ companyId, sourceRef, eventId: event.id });
  return citationId(snapshotId, original, { kind: 'json', pointer: '' });
}

async function capture(
  source: SourceDefinition, events: RawSourceEvent[], epoch = 1, includeBatch = true,
): Promise<Fixture> {
  const dependencies = { db, store, clock: () => new Date(now) };
  const { companyId, sourceRef } = source;
  const id = 'manifest-tools-' + companyId + '-' + epoch;
  const snapshotId = 'snapshot:' + id;
  const bytes = Buffer.from(JSON.stringify({ messageId: 'email', body }));
  const email = await uploadSource(dependencies, {
    companyId, sourceRef, documentId: 'email', documentVersion: 1, kind: 'email_json', originalName: 'email.json',
  }, bytes);
  const files: ManifestFile[] = [{
    fileId: email.fileId, documentId: 'email', documentVersion: 1, kind: 'email_json', sha256: email.contentHash,
  }];
  let csvId: string | undefined;
  const csv = events.filter(event => event.streamId === 'b-files');
  if (csv.length && includeBatch) {
    const batch = { streamId: 'b-files', batchId: 'batch', sequence: 1 };
    const upload = await uploadSource(dependencies, {
      companyId, sourceRef, documentId: 'batch', documentVersion: 1, kind: 'event_csv', originalName: 'batch.csv', batch,
    }, encodeBatch(csv));
    files.push({
      fileId: upload.fileId, documentId: 'batch', documentVersion: 1, kind: 'event_csv',
      sha256: upload.contentHash, ...batch,
    });
    csvId = citationId(snapshotId, upload.fileId, { kind: 'csv', row: 1, column: 'payload_json' });
  }
  const draft = {
    id, epoch, asOf: now, companyId, sourceRef, files,
    schemaVersions: Object.fromEntries(source.contracts.map(contract => [contract.resource, contract.schemaVersion])),
    semanticVersions: Object.fromEntries(events.filter(event => event.rawIdentity.sellerEntityId)
      .map(event => [event.rawIdentity.sellerEntityId + '/' + event.rawIdentity.sourceAccountId, event.semanticVersion])),
    streams: source.streams.map(({ streamId }) => {
      const members = events.filter(event => event.streamId === streamId);
      const resumeAfter = String(members.length);
      return {
        streamId, resumeAfter, snapshotId: id + ':' + streamId, eventIds: members.map(event => event.id),
        snapshotHash: streamContentHash(sourceRef, streamId, resumeAfter, members),
      };
    }),
  };
  const manifest: BootstrapManifest = { ...draft, hash: hashManifest(draft) };
  const prepared = await Promise.all(events.filter(event => event.streamId !== 'b-files').map(event =>
    prepareApiRecord(source, store, event, Buffer.from(JSON.stringify(event.payload)))));
  await publishManifest(dependencies, catalog, manifest, prepared);
  const capture = await captureBaseline(dependencies, manifest.id);
  if (!capture.ok) throw new Error('Expected complete test fixture');
  return {
    binding: { companyId, sourceRef, manifestId: id, snapshotId, manifestHash: manifest.hash, snapshotHash: capture.snapshot.contentHash },
    events, fileId: email.fileId, emailHash: email.contentHash, csvId,
    emailId: citationId(snapshotId, email.fileId, { kind: 'email', messageId: 'email', start: 0, end: body.length }),
  };
}

function invoice(sequence: number, sellerEntityId?: string) {
  const base = eventA({
    kind: 'invoice', recordId: 'a-invoice-' + sequence, sourceAccountId: 'shared', effectiveDate: date,
    fields: { amount: '1.00', due_date: date },
  }, sequence, now);
  const { companyId, sourceAccountId } = base.rawIdentity;
  const rawIdentity = sellerEntityId ? { companyId, sourceAccountId, sellerEntityId } : { companyId, sourceAccountId };
  const event = { ...base, rawIdentity };
  return { ...event, contentHash: hashEvent(event) };
}

function semantic(sequence: number, revision: string) {
  return eventA({
    kind: 'semantic_change', recordId: 'a-semantic-' + sequence, sourceAccountId: 'shared', effectiveDate: date,
    fields: { revision },
  }, sequence, now);
}

function wide({ binding: { companyId, sourceRef } }: Fixture): SourceReadGrant {
  return { companyId, sourceRef, sourceWide: true, accounts: [] };
}
function account(fixture: Fixture, sellerEntityId: string, sourceAccountId: string): SourceReadGrant {
  return { ...wide(fixture), sourceWide: false, accounts: [{ sellerEntityId, sourceAccountId }] };
}
async function read(fixture: Fixture, call: DiscoveryReadToolCall, sourceRead = wide(fixture)) {
  return (await tools.prepare({ binding: fixture.binding, sourceRead, ...call })).result;
}
async function page(fixture: Fixture, args: Extract<DiscoveryReadToolCall, { name: 'querySnapshot' }>['arguments'], grant?: SourceReadGrant) {
  return QuerySnapshotResultSchema.parse(await read(fixture, { name: 'querySnapshot', arguments: args }, grant));
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'eapr-discovery-tools-'));
  await startNativeDb();
  const pair = await provisionTest(namespace);
  provisioned = true;
  await migrate(pair, migrationStreams, readMigrationCatalog());
  db = new Pool({ connectionString: pair.control.appUrl });
  admin = new Pool({ connectionString: pair.control.migrationUrl, statement_timeout: 2000 });
  runtime = new Pool({ connectionString: pair.runtime.migrationUrl });
  store = await createEvidenceStore(root);
  tools = createDiscoveryReadTools({ db, store }, catalog);
  a = await capture(companyA, [
    invoice(1, 'seller-z'), invoice(2, 'seller-a'), invoice(3), invoice(4, 'seller-a'),
    semantic(1, 'a'.repeat(35_000)), semantic(2, 'b'.repeat(35_000)), semantic(3, '😀'.repeat(20_000)),
  ]);
  b = await capture(companyB, [
    eventB({ kind: 'invoice', recordId: 'b-invoice', sourceAccountId: 'b-account', effectiveDate: date,
      fields: { amount_minor: 100, due_on: date } }, 1, now),
    eventB({ kind: 'payment', recordId: 'b-payment', sourceAccountId: 'b-account', effectiveDate: date,
      fields: { amount_minor: 100 } }, 1, now),
  ]);
});

afterAll(async () => {
  await Promise.all([db?.end(), admin?.end(), runtime?.end()]);
  if (provisioned) await dropTest(namespace);
  if (root) await rm(root, { recursive: true, force: true });
});

async function databaseContents(pool: Pool) {
  const { rows } = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const contents = await Promise.all(rows.map(async ({ tablename }) => {
    if (!/^[a-z_][a-z_0-9]*$/.test(tablename)) throw new Error('Unexpected table identifier');
    return [tablename, (await pool.query('SELECT row_to_json(t)::text AS row FROM ' + tablename + ' t ORDER BY 1')).rows];
  }));
  return hashCanonical(contents);
}

test('describes both pinned sources and reads with zero parent accounts without changing either database', async () => {
  const state = () => Promise.all([databaseContents(admin), databaseContents(runtime)]);
  const before = await state();
  for (const fixture of [a, b]) {
    const result = await tools.prepare({
      binding: fixture.binding, sourceRead: wide(fixture), name: 'describeSource', arguments: {},
    });
    const source = catalog.get(fixture.binding.companyId)!;
    expect(result.facts).toMatchObject({ binding: fixture.binding, evidenceIds: expect.arrayContaining([fixture.emailId]) });
    expect(result.result).toEqual({
      ok: true, binding: fixture.binding,
      contracts: source.contracts.toSorted((l, r) => l.resource < r.resource ? -1 : 1),
      streams: source.streams.toSorted((l, r) => l.streamId < r.streamId ? -1 : 1),
    });
    expect(await read(fixture, { name: 'readEvidence', arguments: { evidenceId: fixture.emailId, range: { start: 0, end: 12 } } }))
      .toMatchObject({ ok: true, evidence: { id: fixture.emailId }, text: { value: 'shared needl' } });
    expect(await read(fixture, { name: 'searchEvidence', arguments: { query: 'needle', limit: 1 } }))
      .toMatchObject({ ok: true, hits: [{ id: fixture.emailId }] });
    expect(await page(fixture, { limit: 1 })).toMatchObject({ ok: true, events: [{ event: fixture.events[0] }] });
  }
  expect(await state()).toEqual(before);
});

test('enforces exact account tuples, excludes sellerless events, and uses current filtered cursor membership', async () => {
  const scoped = account(a, 'seller-a', 'shared');
  const ids = a.events.slice(0, 4).map(event => event.id);
  const collected: string[] = [];
  let cursor: string | null = null;
  do {
    const result = await page(a, { resource: 'a-invoices', limit: 1, ...(cursor ? { afterEventId: cursor } : {}) });
    if (!result.ok) throw new Error(result.code);
    collected.push(...result.events.map(row => row.event.id));
    cursor = result.nextAfterEventId;
  } while (cursor !== null);
  expect(collected).toEqual(ids);
  const scopedPage = await page(a, { resource: 'a-invoices', limit: 50 }, scoped);
  expect(scopedPage).toEqual({
    ok: true, events: [a.events[1]!, a.events[3]!].map(event => ({ event, evidenceIds: [apiCitation(a, event)] })),
    nextAfterEventId: null,
  });
  expect(await page(a, { limit: 1, afterEventId: ids[1], account: scoped.accounts[0] }))
    .toMatchObject({ ok: true, events: [{ event: a.events[3] }], nextAfterEventId: ids[3] });
  expect(await page(a, { limit: 1, afterEventId: ids[1], resource: 'a-invoices' }))
    .toMatchObject({ ok: true, events: [{ event: a.events[2] }] });
  expect(await page(a, { limit: 1, afterEventId: ids[0] }, scoped)).toEqual({ ok: false, code: 'DISCOVERY_INVALID' });
  expect(await page(a, { limit: 1, afterEventId: ids[1], resource: 'a-semantics' })).toEqual({ ok: false, code: 'DISCOVERY_INVALID' });
  expect(await page(a, { limit: 1, resource: 'foreign-resource' })).toEqual({ ok: false, code: 'DISCOVERY_INVALID' });
  for (const sellerEntityId of ['seller-z', 'absent']) {
    expect(await page(a, { limit: 1, account: { sellerEntityId, sourceAccountId: 'shared' } }, scoped))
      .toEqual({ ok: false, code: 'DISCOVERY_FORBIDDEN' });
  }
  const sellerless = a.events[2]!;
  expect(await read(a, { name: 'readEvidence', arguments: { evidenceId: apiCitation(a, sellerless) } }))
    .toMatchObject({ ok: true, evidence: { id: apiCitation(a, sellerless) } });
  expect(await read(a, { name: 'readEvidence', arguments: { evidenceId: apiCitation(a, sellerless) } }, scoped))
    .toEqual({ ok: false, code: 'DISCOVERY_FORBIDDEN' });
});

test('links exact Company B CSV rows to events and keeps file citations out of account-only results', async () => {
  const scoped = account(b, 'seller-b', 'b-account');
  expect(await page(b, { limit: 50 })).toEqual({
    ok: true, nextAfterEventId: null, events: [
      { event: b.events[0], evidenceIds: [b.csvId] },
      { event: b.events[1], evidenceIds: [apiCitation(b, b.events[1]!)] },
    ],
  });
  expect(await page(b, { limit: 50 }, scoped)).toMatchObject({
    ok: true, events: [{ evidenceIds: [] }, { evidenceIds: [apiCitation(b, b.events[1]!)] }],
  });
  expect(await read(b, { name: 'readEvidence', arguments: { evidenceId: b.csvId!, range: { start: 0, end: 3 } } }, scoped))
    .toEqual({ ok: false, code: 'DISCOVERY_FORBIDDEN' });
  expect(await read(b, { name: 'readEvidence', arguments: { evidenceId: apiCitation(b, b.events[1]!) } }, scoped))
    .toMatchObject({ ok: true, mediaType: 'application/json' });
});

test('shrinks a page for UTF-8 bytes without skipping an oversized following record', async () => {
  const resource = 'a-semantics';
  const first = a.events[4]!;
  const second = a.events[5]!;
  for (const [afterEventId, event] of [[undefined, first], [first.id, second]] as const) {
    const result = await page(a, { resource, afterEventId, limit: 50 });
    expect(result).toEqual({ ok: true, events: [{ event, evidenceIds: [apiCitation(a, event)] }], nextAfterEventId: event.id });
    expect(Buffer.byteLength(canonicalJson(result))).toBeLessThanOrEqual(65_536);
  }
  expect(await page(a, { resource, afterEventId: second.id, limit: 50 })).toEqual({ ok: false, code: 'TOOL_RESULT_LIMIT' });
});

test('searches only pinned authorized citation excerpts in lexical order', async () => {
  const query = '"account":"shared"';
  const result = await read(a, { name: 'searchEvidence', arguments: { query, limit: 20 } });
  expect(result).toEqual({
    ok: true, hits: a.events.map(event => ({
      id: apiCitation(a, event), excerpt: canonicalJson(event.payload).slice(0, 2000),
    })).sort((l, r) => l.id < r.id ? -1 : 1),
  });
  const scoped = account(a, 'seller-a', 'shared');
  expect(await read(a, { name: 'searchEvidence', arguments: { query: 'needle', limit: 20 } }, scoped))
    .toEqual({ ok: true, hits: [] });
  expect(await read(a, { name: 'searchEvidence', arguments: { query: 'NEEDLE', limit: 20 } }))
    .toEqual({ ok: true, hits: [] });
  expect(await read(a, { name: 'readEvidence', arguments: { evidenceId: a.emailId, range: { start: 0, end: 1 } } }, scoped))
    .toEqual({ ok: false, code: 'DISCOVERY_FORBIDDEN' });
});

test('projects a narrow range and preserves original citation and hash across same-byte captures', async () => {
  const later = await capture(companyA, a.events, 2);
  expect(a.emailHash).toBe(b.emailHash);
  expect(later.emailHash).toBe(b.emailHash);
  for (const foreign of [b.emailId, later.emailId]) {
    expect(await read(a, { name: 'readEvidence', arguments: { evidenceId: foreign } }))
      .toEqual({ ok: false, code: 'DISCOVERY_FORBIDDEN' });
  }
  const stored = async () => (await admin.query('SELECT evidence FROM source_evidence WHERE evidence_id=$1', [a.emailId])).rows[0]!.evidence;
  const original = await stored();
  const { excerpt, ...evidence } = original;
  const start = body.indexOf('😀');
  expect(await read(a, { name: 'readEvidence', arguments: { evidenceId: a.emailId, range: { start, end: start + 100 } } }))
    .toEqual({
      ok: true, evidence, mediaType: 'application/json', text: {
        value: excerpt.slice(start, start + 100), unit: 'utf16', startInclusive: start, endExclusive: start + 100,
        sha256: hashBytes(Buffer.from(body.slice(start, start + 100))),
      },
    });
  expect(await stored()).toEqual(original);
  expect(await read(a, { name: 'readEvidence', arguments: { evidenceId: a.emailId } }))
    .toEqual({ ok: false, code: 'TOOL_RESULT_LIMIT' });
  for (const range of [{ start: start + 1, end: start + 2 }, { start, end: start + 1 }, { start: 0, end: body.length + 1 }]) {
    expect(await read(a, { name: 'readEvidence', arguments: { evidenceId: a.emailId, range } }))
      .toEqual({ ok: false, code: 'DISCOVERY_INVALID' });
  }
});

test('rejects pinned CSV events when the captured manifest omits their original batch', async () => {
  const withoutBatch = await capture(companyB, b.events, 2, false);
  expect(withoutBatch.csvId).toBeUndefined();
  await expect(page(withoutBatch, { limit: 50 }))
    .rejects.toMatchObject({ status: 409, code: 'MANIFEST_MEMBER_MISSING' });
});

test('fails closed on mismatched bindings, corrupt original extraction, and missing citation membership', async () => {
  const describe = { name: 'describeSource', arguments: {} } as const;
  await expect(tools.prepare({ ...describe, binding: a.binding, sourceRead: wide(b) }))
    .rejects.toMatchObject({ code: 'SOURCE_FORBIDDEN' });
  await expect(tools.prepare({ ...describe, binding: { ...a.binding, snapshotHash: 'a'.repeat(64) }, sourceRead: wide(a) }))
    .rejects.toMatchObject({ code: 'SOURCE_EPOCH_CONFLICT' });
  const original = (await admin.query('SELECT extraction FROM source_files WHERE file_id=$1', [a.fileId])).rows[0]!.extraction;
  const changeExtraction = (extraction: object) => admin.query(
    'UPDATE source_files SET extraction=$2, extraction_hash=$3 WHERE file_id=$1',
    [a.fileId, JSON.stringify(extraction), hashCanonical(extraction)],
  );
  try {
    await changeExtraction({ ...original, document: { ...original.document, body: 'forged' } });
    await expect(read(a, describe)).rejects.toMatchObject({ code: 'SOURCE_HASH_CONFLICT' });
  } finally {
    await changeExtraction(original);
  }
  const missing = (await admin.query(
    'DELETE FROM source_evidence WHERE evidence_id=$1 RETURNING row_to_json(source_evidence)::text AS row', [a.emailId],
  )).rows[0]!.row;
  try {
    await expect(read(a, describe)).rejects.toMatchObject({ code: 'MANIFEST_MEMBER_MISSING' });
  } finally {
    await admin.query('INSERT INTO source_evidence SELECT * FROM jsonb_populate_record(NULL::source_evidence,$1)', [missing]);
  }
});

test('uses detached validated extraction when a privileged mutation occurs after the final capture recheck', async () => {
  const checked = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const query = db.query.bind(db) as (sql: string, params: unknown[]) => Promise<unknown>;
  let dossierReads = 0;
  const spy = vi.spyOn(db, 'query').mockImplementation((async (sql: string, params: unknown[]) => {
    const result = await query(sql, params);
    if (sql.startsWith('SELECT dossier FROM source_dossiers') && ++dossierReads === 2) {
      checked.resolve();
      await resume.promise;
    }
    return result;
  }) as Pool['query']);
  const operation = read(a, { name: 'readEvidence', arguments: { evidenceId: a.emailId, range: { start: 0, end: 6 } } });
  try {
    await Promise.race([checked.promise, operation.then(() => { throw new Error('Capture recheck did not reach barrier'); })]);
    expect(db.idleCount).toBe(db.totalCount);
    await admin.query("UPDATE source_files SET extraction=jsonb_set(extraction,'{document,body}',to_jsonb(repeat('z',$2::integer))) WHERE file_id=$1",
      [a.fileId, body.length]);
    resume.resolve();
    expect(await operation).toMatchObject({ ok: true, text: { value: 'shared' } });
  } finally {
    resume.resolve();
    spy.mockRestore();
    await admin.query("UPDATE source_files SET extraction=jsonb_set(extraction,'{document,body}',to_jsonb($2::text)) WHERE file_id=$1",
      [a.fileId, body]);
  }
});
