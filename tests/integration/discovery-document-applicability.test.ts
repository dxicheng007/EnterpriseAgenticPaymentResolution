import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  hashCanonical, hashManifest, QuerySnapshotResultSchema,
  type BootstrapManifest, type DiscoveryBinding, type ManifestFile, type RawSourceEvent, type SourceReadGrant,
} from '@eapr/contracts';
import { createEvidenceStore, type EvidenceStore } from '@eapr/evidence';
import {
  captureBaseline, companyA, companyB, createDiscoveryReadTools, prepareApiRecord, publishManifest,
  streamContentHash, uploadSource, type SourceDefinition,
} from '@eapr/sources';
import { textPdf } from '../../packages/sources/src/canonical-fixtures.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import { encodeBatch, eventB } from '../../packages/sources/src/company-b.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

const catalog = new Map<string, SourceDefinition>([[companyA.companyId, companyA], [companyB.companyId, companyB]]);
const now = '2026-10-01T00:00:00.000Z';
const date = '2026-10-01';
const namespace = testNamespace('docapply');
let root: string;
let provisioned = false;
let db: Pool;
let admin: Pool;
let runtime: Pool;
let store: EvidenceStore;
let blobReads = 0;
let tools: ReturnType<typeof createDiscoveryReadTools>;
let a1: Fixture;
let a2: Fixture;
let b: Fixture;

type UploadedPdf = { fileId: string; contentHash: string; documentId: string };
type Fixture = {
  binding: DiscoveryBinding;
  events: RawSourceEvent[];
  agreement: UploadedPdf;
  extra?: UploadedPdf;
};

async function agreementBytes(format: 'a' | 'b', fields: {
  contract: string; seller: string; buyer: string; account: string; name: string; extra?: string;
}) {
  const title = 'Fixed monthly agreement ' + fields.contract;
  const parties = 'Seller ' + fields.seller + '; buyer ' + fields.buyer + '; account ' + fields.account;
  const legal = 'Legal name ' + fields.name;
  const lines = format === 'a'
    ? [title, parties, legal, 'Monthly fee USD 1234.56', 'Effective 2026-07-01; monthly invoice anchor day 1.']
    : [title, parties, legal, 'Monthly fee USD 1800.00 effective 2026-07-01.', 'Monthly invoice anchor day 1.'];
  if (fields.extra) lines.push(fields.extra);
  return Buffer.from(await textPdf(lines, now, title));
}

async function multipageAgreementBytes(fields: {
  contract: string; seller: string; buyer: string; account: string; name: string;
}) {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setCreationDate(new Date(now));
  pdf.setModificationDate(new Date(now));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageOne = pdf.addPage();
  const lines = [
    'Fixed monthly agreement ' + fields.contract,
    'Seller ' + fields.seller + '; buyer ' + fields.buyer + '; account ' + fields.account,
    'Legal name ' + fields.name,
    'Monthly fee USD 1234.56',
    'Effective 2026-07-01; monthly invoice anchor day 1.',
  ];
  for (const [index, line] of lines.entries()) {
    pageOne.drawText(line, { x: 45, y: 750 - index * 22, size: 11, font });
  }
  pdf.addPage().drawText('Extra page that keeps the document unsupported.', { x: 45, y: 750, size: 11, font });
  return Buffer.from(await pdf.save());
}

function invoiceA(account: string, recordId: string) {
  return eventA({
    kind: 'invoice', recordId, sourceAccountId: account, effectiveDate: date,
    fields: { amount: '1.00', due_date: date },
  }, 1, now);
}

function invoiceB(account: string) {
  return eventB({
    kind: 'invoice', recordId: 'b-invoice-apply', sourceAccountId: account, effectiveDate: date,
    fields: { amount_minor: 100, due_on: date },
  }, 1, now);
}

function wide(fixture: Fixture): SourceReadGrant {
  return { companyId: fixture.binding.companyId, sourceRef: fixture.binding.sourceRef, sourceWide: true, accounts: [] };
}

function accountGrant(fixture: Fixture, sellerEntityId: string, sourceAccountId: string): SourceReadGrant {
  return { ...wide(fixture), sourceWide: false, accounts: [{ sellerEntityId, sourceAccountId }] };
}

async function fileEvidenceIds(fileId: string) {
  const { rows } = await admin.query<{ evidence_id: string }>(
    'SELECT evidence_id FROM source_evidence WHERE file_id=$1 ORDER BY evidence_id', [fileId],
  );
  return rows.map(row => row.evidence_id);
}

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

async function capture(
  source: SourceDefinition, events: RawSourceEvent[], pdfs: { documentId: string; bytes: Buffer }[], epoch: number,
): Promise<Fixture> {
  const dependencies = { db, store, clock: () => new Date(now) };
  const { companyId, sourceRef } = source;
  const id = 'manifest-apply-' + companyId + '-' + epoch;
  const snapshotId = 'snapshot:' + id;
  const files: ManifestFile[] = [];
  const uploaded: UploadedPdf[] = [];
  for (const pdf of pdfs) {
    const result = await uploadSource(dependencies, {
      companyId, sourceRef, documentId: pdf.documentId, documentVersion: 1, kind: 'contract_pdf',
      originalName: pdf.documentId + '.pdf',
    }, pdf.bytes);
    files.push({
      fileId: result.fileId, documentId: pdf.documentId, documentVersion: 1, kind: 'contract_pdf',
      sha256: result.contentHash,
    });
    uploaded.push({ fileId: result.fileId, contentHash: result.contentHash, documentId: pdf.documentId });
  }
  const csv = events.filter(event => event.streamId === 'b-files');
  if (csv.length) {
    const batch = { streamId: 'b-files', batchId: 'batch-apply-' + epoch, sequence: epoch };
    const upload = await uploadSource(dependencies, {
      companyId, sourceRef, documentId: 'batch-apply-' + epoch, documentVersion: 1, kind: 'event_csv',
      originalName: 'batch.csv', batch,
    }, encodeBatch(csv));
    files.push({
      fileId: upload.fileId, documentId: 'batch-apply-' + epoch, documentVersion: 1, kind: 'event_csv',
      sha256: upload.contentHash, ...batch,
    });
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
  const captured = await captureBaseline(dependencies, manifest.id);
  if (!captured.ok) throw new Error('Expected complete test fixture');
  return {
    binding: {
      companyId, sourceRef, manifestId: id, snapshotId, manifestHash: manifest.hash,
      snapshotHash: captured.snapshot.contentHash,
    },
    events, agreement: uploaded[0]!, extra: uploaded[1],
  };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'eapr-doc-apply-'));
  await startNativeDb();
  const pair = await provisionTest(namespace);
  provisioned = true;
  await migrate(pair, migrationStreams, readMigrationCatalog());
  db = new Pool({ connectionString: pair.control.appUrl });
  admin = new Pool({ connectionString: pair.control.migrationUrl, statement_timeout: 2000 });
  runtime = new Pool({ connectionString: pair.runtime.migrationUrl });
  store = await createEvidenceStore(root);
  const reads: Pick<EvidenceStore, 'get'> = {
    async get(hash) {
      blobReads++;
      return store.get(hash);
    },
  };
  tools = createDiscoveryReadTools({ db, store: reads }, catalog);
  const aBytes = await agreementBytes('a', {
    contract: 'contract-a-1', seller: companyA.sellerEntityId, buyer: 'buyer-a-1',
    account: 'acct-a-1', name: 'Northstar Studio',
  });
  const unsupportedBytes = await agreementBytes('a', {
    contract: 'contract-a-1', seller: companyA.sellerEntityId, buyer: 'buyer-a-1',
    account: 'acct-a-1', name: 'Northstar Studio', extra: 'Authorize buyer other.',
  });
  const bBytes = await agreementBytes('b', {
    contract: 'contract-b-1', seller: companyB.sellerEntityId, buyer: 'buyer-b-1',
    account: 'acct-b-1', name: 'Northstar Studio',
  });
  const laterA = await agreementBytes('a', {
    contract: 'contract-a-2', seller: companyA.sellerEntityId, buyer: 'buyer-a-2',
    account: 'acct-a-1', name: 'Northstar Studio',
  });
  a1 = await capture(companyA, [invoiceA('acct-a-1', 'a-invoice-1')], [
    { documentId: 'agreement-a-1', bytes: aBytes },
    { documentId: 'agreement-a-unsupported', bytes: unsupportedBytes },
  ], 1);
  a2 = await capture(companyA, a1.events, [{ documentId: 'agreement-a-2', bytes: laterA }], 2);
  b = await capture(companyB, [invoiceB('acct-b-1')], [
    { documentId: 'agreement-b-1', bytes: bBytes },
    { documentId: 'copied-a-agreement', bytes: aBytes },
  ], 1);
});

afterAll(async () => {
  await Promise.all([db?.end(), admin?.end(), runtime?.end()]);
  if (provisioned) await dropTest(namespace);
  if (root) await rm(root, { recursive: true, force: true });
});

async function apply(fixture: Fixture, evidenceIds: readonly string[], sourceRead = wide(fixture)) {
  return tools.prepareDocumentApplicability({ binding: fixture.binding, sourceRead, evidenceIds });
}

async function snapshotEvidence(fixture: Fixture) {
  const result = QuerySnapshotResultSchema.parse(
    (await tools.prepare({
      binding: fixture.binding, sourceRead: wide(fixture), name: 'querySnapshot', arguments: { limit: 50 },
    })).result,
  );
  if (!result.ok) throw new Error(result.code);
  return result.events.flatMap(row => row.evidenceIds);
}

test('associates captured A and B agreements and keeps PDF IDs out of snapshot evidence', async () => {
  const state = () => Promise.all([databaseContents(admin), databaseContents(runtime)]);
  const before = await state();
  const aIds = (await tools.prepare({
    binding: a1.binding, sourceRead: wide(a1), name: 'describeSource', arguments: {},
  })).facts.evidenceIds;
  const aResult = await apply(a1, aIds);
  const aCitation = (await fileEvidenceIds(a1.agreement.fileId))[0]!;
  const unsupported = (await fileEvidenceIds(a1.extra!.fileId))[0]!;
  const aStored = (await admin.query<{ evidence: { locator: { kind: string; page: number; start: number; end: number } } }>(
    'SELECT evidence FROM source_evidence WHERE evidence_id=$1', [aCitation],
  )).rows[0]!.evidence;
  expect(aResult.derivation).toBe('captured-agreement-association-v1');
  expect(aResult.facts.binding).toEqual(a1.binding);
  expect(aStored.locator).toMatchObject({ kind: 'pdf', page: 1, start: 0 });
  expect(aStored.locator.end).toBeGreaterThan(0);
  expect(aResult.associations).toEqual([{
    evidenceId: aCitation, fileId: a1.agreement.fileId, documentId: 'agreement-a-1', documentVersion: 1,
    originalHash: a1.agreement.contentHash, locator: aStored.locator,
    subject: { kind: 'source_account', sellerEntityId: companyA.sellerEntityId, sourceAccountId: 'acct-a-1' },
  }]);
  expect(aResult.unresolvedEvidenceIds).toEqual(aIds.filter(id => id !== aCitation).sort());
  expect(aResult.unresolvedEvidenceIds).toContain(unsupported);
  expect(await snapshotEvidence(a1)).not.toContain(aCitation);

  const bIds = (await tools.prepare({
    binding: b.binding, sourceRead: wide(b), name: 'describeSource', arguments: {},
  })).facts.evidenceIds;
  const bResult = await apply(b, bIds);
  const bCitation = (await fileEvidenceIds(b.agreement.fileId))[0]!;
  const copied = (await fileEvidenceIds(b.extra!.fileId))[0]!;
  const bStored = (await admin.query<{ evidence: { locator: object } }>(
    'SELECT evidence FROM source_evidence WHERE evidence_id=$1', [bCitation],
  )).rows[0]!.evidence;
  expect(b.extra!.contentHash).toBe(a1.agreement.contentHash);
  expect(bResult.facts.binding).toEqual(b.binding);
  expect(bResult.associations).toEqual([{
    evidenceId: bCitation, fileId: b.agreement.fileId, documentId: 'agreement-b-1', documentVersion: 1,
    originalHash: b.agreement.contentHash, locator: bStored.locator,
    subject: { kind: 'source_account', sellerEntityId: companyB.sellerEntityId, sourceAccountId: 'acct-b-1' },
  }]);
  expect(bResult.unresolvedEvidenceIds).toContain(copied);
  expect(bResult.associations[0]!.originalHash).not.toBe(a1.agreement.contentHash);
  await expect(apply(b, [aCitation])).rejects.toMatchObject({ status: 403, code: 'SOURCE_FORBIDDEN' });
  expect(await snapshotEvidence(b)).not.toContain(bCitation);
  expect(await state()).toEqual(before);
});

test('forbids account-only applicability and PDF reads before any blob I/O', async () => {
  const aCitation = (await fileEvidenceIds(a1.agreement.fileId))[0]!;
  const scoped = accountGrant(a1, companyA.sellerEntityId, 'acct-a-1');
  const reads = blobReads;
  await expect(apply(a1, [aCitation], scoped)).rejects.toMatchObject({ status: 403, code: 'SOURCE_FORBIDDEN' });
  expect(blobReads).toBe(reads);
  expect((await tools.prepare({
    binding: a1.binding, sourceRead: scoped, name: 'readEvidence',
    arguments: { evidenceId: aCitation, range: { start: 0, end: 1 } },
  })).result).toEqual({ ok: false, code: 'DISCOVERY_FORBIDDEN' });
  expect((await tools.prepare({
    binding: a1.binding, sourceRead: scoped, name: 'searchEvidence',
    arguments: { query: 'Fixed monthly', limit: 20 },
  })).result).toEqual({ ok: true, hits: [] });
});

test('returns only the older pinned capture after a later publication', async () => {
  const laterIds = (await tools.prepare({
    binding: a2.binding, sourceRead: wide(a2), name: 'describeSource', arguments: {},
  })).facts.evidenceIds;
  const later = await apply(a2, laterIds);
  const laterCitation = (await fileEvidenceIds(a2.agreement.fileId))[0]!;
  expect(later.facts.binding).toEqual(a2.binding);
  expect(later.associations.map(entry => entry.fileId)).toEqual([a2.agreement.fileId]);
  expect(later.associations[0]?.evidenceId).toBe(laterCitation);

  const olderIds = (await tools.prepare({
    binding: a1.binding, sourceRead: wide(a1), name: 'describeSource', arguments: {},
  })).facts.evidenceIds;
  const older = await apply(a1, olderIds);
  expect(older.facts.binding).toEqual(a1.binding);
  expect(older.facts.binding.manifestId).not.toBe(a2.binding.manifestId);
  expect(older.associations.map(entry => entry.fileId)).toEqual([a1.agreement.fileId]);
  expect(older.facts.evidenceIds).not.toContain(laterCitation);
  await expect(apply(a1, [laterCitation])).rejects.toMatchObject({ status: 403, code: 'SOURCE_FORBIDDEN' });
});

test('rejects oversized and duplicate citation lists without reading originals', async () => {
  const reads = blobReads;
  const fiftyOne = Array.from({ length: 51 }, (_, index) => 'ev:' + String(index).padStart(3, '0'));
  await expect(apply(a1, fiftyOne)).rejects.toMatchObject({ status: 400, code: 'SOURCE_CONTENT_INVALID' });
  const duplicate = 'ev:duplicate-id';
  await expect(apply(a1, [duplicate, duplicate])).rejects.toMatchObject({ status: 400, code: 'SOURCE_CONTENT_INVALID' });
  expect(blobReads).toBe(reads);
});

test('leaves a conflict-free multipage agreement unresolved on its page-one citation', async () => {
  const multiBytes = await multipageAgreementBytes({
    contract: 'contract-a-multi', seller: companyA.sellerEntityId, buyer: 'buyer-a-1',
    account: 'acct-a-1', name: 'Northstar Studio',
  });
  const multi = await capture(companyA, a1.events, [
    { documentId: 'agreement-a-multi', bytes: multiBytes },
  ], 3);
  const pageOne = (await fileEvidenceIds(multi.agreement.fileId))[0]!;
  const pageCount = (await admin.query<{ pages: number }>(
    `SELECT jsonb_array_length(extraction->'document'->'pages')::int AS pages
     FROM source_files WHERE file_id=$1`, [multi.agreement.fileId],
  )).rows[0]!.pages;
  expect(pageCount).toBeGreaterThan(1);
  const result = await apply(multi, [pageOne]);
  expect(result.associations).toEqual([]);
  expect(result.unresolvedEvidenceIds).toEqual([pageOne]);
});

test('fails closed for wrong binding, corrupt extraction, and unavailable originals', async () => {
  const aCitation = (await fileEvidenceIds(a1.agreement.fileId))[0]!;
  await expect(tools.prepareDocumentApplicability({
    binding: { ...a1.binding, snapshotHash: 'a'.repeat(64) },
    sourceRead: wide(a1),
    evidenceIds: [aCitation],
  })).rejects.toMatchObject({ status: 409, code: 'SOURCE_EPOCH_CONFLICT' });

  const original = (await admin.query(
    'SELECT extraction, extraction_hash FROM source_files WHERE file_id=$1', [a1.agreement.fileId],
  )).rows[0]!;
  try {
    const forged = {
      ...original.extraction,
      document: { ...original.extraction.document, pages: ['forged agreement text'] },
    };
    await admin.query(
      'UPDATE source_files SET extraction=$2, extraction_hash=$3 WHERE file_id=$1',
      [a1.agreement.fileId, JSON.stringify(forged), hashCanonical(forged)],
    );
    await expect(apply(a1, [aCitation])).rejects.toMatchObject({ code: 'SOURCE_HASH_CONFLICT' });
  } finally {
    await admin.query(
      'UPDATE source_files SET extraction=$2, extraction_hash=$3 WHERE file_id=$1',
      [a1.agreement.fileId, JSON.stringify(original.extraction), original.extraction_hash],
    );
  }

  const unavailableTools = createDiscoveryReadTools({
    db,
    store: {
      async get() {
        throw new Error('private/test/path');
      },
    },
  }, catalog);
  await expect(unavailableTools.prepareDocumentApplicability({
    binding: a1.binding, sourceRead: wide(a1), evidenceIds: [aCitation],
  })).rejects.toMatchObject({ status: 503, code: 'SOURCE_UNAVAILABLE' });
});

test('rejects when a dossier changes during the original byte read', async () => {
  const aCitation = (await fileEvidenceIds(a1.agreement.fileId))[0]!;
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const gated = createDiscoveryReadTools({
    db,
    store: {
      async get(hash) {
        reached.resolve();
        await resume.promise;
        return store.get(hash);
      },
    },
  }, catalog);
  const operation = gated.prepareDocumentApplicability({
    binding: a1.binding, sourceRead: wide(a1), evidenceIds: [aCitation],
  });
  const assertion = expect(operation).rejects.toMatchObject({ status: 409, code: 'MANIFEST_MEMBER_MISSING' });
  try {
    await Promise.race([
      reached.promise,
      operation.then(() => { throw new Error('Expected an original read barrier'); }),
    ]);
    expect(db.idleCount).toBe(db.totalCount);
    await admin.query(
      "UPDATE source_dossiers SET dossier = dossier || '{\"complete\":false}' WHERE manifest_id=$1",
      [a1.binding.manifestId],
    );
    resume.resolve();
    await assertion;
  } finally {
    resume.resolve();
    await admin.query(
      "UPDATE source_dossiers SET dossier = dossier || '{\"complete\":true}' WHERE manifest_id=$1",
      [a1.binding.manifestId],
    );
  }
});
