import {
  BootstrapManifestSchema, HashSchema, IsoDateSchema, SourceCoverageResponseSchema, SourceDossierSchema,
  SourceSnapshotSchema, UploadMetadataSchema, canonicalJson, hashBytes, hashCanonical, hashManifest,
  type BootstrapManifest, type Diagnostic, type EvidenceRef, type Hash, type Id, type IsoInstant,
  type RawIdentity, type RawSourceEvent, type SourceAccountCoverage, type SourceCoverageEvent,
  type SourceCoverageResponse, type SourceSnapshot,
} from '@eapr/contracts';
import { EvidenceStorageError, SourceContentError, extractDocument, type Extraction } from '@eapr/evidence';
import { sqlState } from '@eapr/storage/transaction';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import { aggregateHash, documentCitations, streamContentHash } from './dossier.js';
import { citeEvidence, readEvidence, type EvidenceAuthorization } from './evidence-records.js';
import { SourceError } from './errors.js';
import { validateSourceEvent, type SourceDefinition } from './records.js';
import { sourceFileId, type StoredSourceFile, type UploadDependencies } from './uploads.js';

export type CapturedIdentityText = {
  kind: 'contract_pdf' | 'amendment_pdf' | 'email_json';
  citationId: Id;
  text: string;
};

const idPattern = '([A-Za-z0-9][A-Za-z0-9._:-]{0,159})';
const datePattern = '(\\d{4}-\\d{2}-\\d{2})';
const amountPattern = '(?:0|[1-9]\\d*)\\.\\d{2}';
// PDF.js joins text items with spaces, including empty items at line breaks.
const agreementHeader = 'Fixed monthly agreement ' + idPattern + ' +Seller ' + idPattern +
  '; buyer ' + idPattern + '; account ' + idPattern +
  ' +Legal name ([A-Za-z0-9]+(?: [A-Za-z0-9]+)*) +Monthly fee USD ' + amountPattern;
const agreementFormats = [
  new RegExp('^' + agreementHeader + ' +Effective ' + datePattern + '; monthly invoice anchor day 1\\.$'),
  new RegExp('^' + agreementHeader + ' effective ' + datePattern + '\\. +Monthly invoice anchor day 1\\.$'),
];
const directoryHeader = new RegExp('^Seller ' + idPattern + ' reports separate customer accounts: (.+)\\. Currency USD\\.$');
const directoryEntry = new RegExp('^' + idPattern + ' belongs to ' + idPattern + '$');
const amendmentFormat = new RegExp('^Executed amendment to ' + idPattern + ' +Seller ' + idPattern +
  ' and buyer ' + idPattern + ' agree\\. +Effective ' + datePattern + ', replace monthly fee with USD ' +
  amountPattern + '\\. +Signed by both parties\\.$');

function fullMatch(pattern: RegExp, text: string) {
  const match = pattern.exec(text);
  return match?.[0] === text ? match : undefined;
}

type Party = { sellerEntityId: Id; sourceBuyerId: Id; citationId: Id };
type DirectoryClaim = Party & { sourceAccountId: Id };
type Agreement = DirectoryClaim & { contractId: Id; displayName: string };
type Amendment = Party & { contractId: Id };

function accountKey({ sellerEntityId, sourceAccountId }: Pick<RawIdentity, 'sellerEntityId' | 'sourceAccountId'>) {
  return (sellerEntityId ?? '') + '/' + (sourceAccountId ?? '');
}

function parseAgreement({ text, citationId }: CapturedIdentityText, asOf: IsoInstant): Agreement | undefined {
  for (const format of agreementFormats) {
    const match = fullMatch(format, text);
    if (!match) continue;
    const [, contractId, sellerEntityId, sourceBuyerId, sourceAccountId, displayName, effective] = match;
    if (IsoDateSchema.safeParse(effective).success && effective <= asOf.slice(0, 10)) {
      return { contractId, sellerEntityId, sourceBuyerId, sourceAccountId, displayName, citationId };
    }
  }
}

function parseDirectory({ text, citationId }: CapturedIdentityText): DirectoryClaim[] {
  const match = fullMatch(directoryHeader, text);
  if (!match) return [];
  const [, sellerEntityId, entries] = match;
  const claims: DirectoryClaim[] = [];
  for (const entry of entries.split('; ')) {
    const parsed = fullMatch(directoryEntry, entry);
    if (!parsed) return [];
    const [, sourceAccountId, sourceBuyerId] = parsed;
    claims.push({ sellerEntityId, sourceAccountId, sourceBuyerId, citationId });
  }
  return claims;
}

function parseAmendment({ text, citationId }: CapturedIdentityText): Amendment | undefined {
  const match = fullMatch(amendmentFormat, text);
  if (!match) return;
  const [, contractId, sellerEntityId, sourceBuyerId, effective] = match;
  if (IsoDateSchema.safeParse(effective).success) return { contractId, sellerEntityId, sourceBuyerId, citationId };
}

function diagnostic(code: string, message: string, sourceIds: Id[]): Diagnostic {
  return { code, severity: 'warning', message, sourceIds: [...new Set(sourceIds)].sort(), fieldPaths: [] };
}

export function deriveSourceCoverageObservations(
  asOf: IsoInstant, documents: readonly CapturedIdentityText[], events: readonly SourceCoverageEvent[],
): { accounts: SourceAccountCoverage[]; diagnostics: Diagnostic[] } {
  const agreements = new Map<string, Agreement[]>();
  const directory = new Map<string, DirectoryClaim[]>();
  const amendments: Amendment[] = [];
  const diagnostics: Diagnostic[] = [];
  const unsupported = (citationId: Id) => diagnostics.push(diagnostic(
    'SOURCE_IDENTITY_UNSUPPORTED', 'Captured document has no applicable identity claim in a supported format.', [citationId],
  ));
  for (const document of documents.toSorted((a, b) => a.citationId < b.citationId ? -1 : 1)) {
    if (document.kind === 'contract_pdf') {
      const agreement = parseAgreement(document, asOf);
      if (!agreement) { unsupported(document.citationId); continue; }
      const key = accountKey(agreement);
      agreements.set(key, [...(agreements.get(key) ?? []), agreement]);
    } else if (document.kind === 'amendment_pdf') {
      const amendment = parseAmendment(document);
      if (amendment) amendments.push(amendment);
      else unsupported(document.citationId);
    } else {
      // A directory can corroborate an agreement. Other email exports, such as remittances, supply no identity claim.
      for (const claim of parseDirectory(document)) {
        const key = accountKey(claim);
        directory.set(key, [...(directory.get(key) ?? []), claim]);
      }
    }
  }

  const accounts: SourceAccountCoverage[] = [];
  for (const key of [...agreements.keys()].sort()) {
    const claims = agreements.get(key)!;
    const { sellerEntityId, sourceAccountId, sourceBuyerId, displayName } = claims[0]!;
    const identityEvidenceRefs = claims.map(claim => claim.citationId).sort();
    const corroborations = directory.get(key) ?? [];
    if (claims.some(claim => claim.sourceBuyerId !== sourceBuyerId || claim.displayName !== displayName) ||
        corroborations.some(claim => claim.sourceBuyerId !== sourceBuyerId)) {
      diagnostics.push(diagnostic(
        'SOURCE_IDENTITY_CONFLICT', 'Captured identity claims conflict for this seller and source account.',
        [...identityEvidenceRefs, ...corroborations.map(claim => claim.citationId)],
      ));
      continue;
    }
    const matchingAmendments = amendments.filter(amendment =>
      amendment.sellerEntityId === sellerEntityId && amendment.sourceBuyerId === sourceBuyerId &&
      claims.some(claim => claim.contractId === amendment.contractId));
    accounts.push({
      sellerEntityId, sourceAccountId, sourceBuyerId, displayName, identityEvidenceRefs,
      relatedEvidenceRefs: [...new Set([...corroborations, ...matchingAmendments].map(claim => claim.citationId))].sort(),
    });
  }

  const documented = new Set(accounts.map(accountKey));
  const unresolved = new Map<string, Id[]>();
  for (const { id, rawIdentity } of events) {
    const key = accountKey(rawIdentity);
    if (documented.has(key)) continue;
    const ids = unresolved.get(key) ?? [];
    ids.push(id);
    unresolved.set(key, ids);
  }
  for (const key of [...unresolved.keys()].sort()) {
    diagnostics.push(diagnostic(
      'SOURCE_IDENTITY_UNDOCUMENTED', 'The source account identity is not established by this supported evidence read.',
      unresolved.get(key)!,
    ));
  }
  return { accounts, diagnostics };
}

type CoverageDependencies = Pick<UploadDependencies, 'db' | 'store'>;

function epochConflict(): never {
  throw new SourceError(409, 'SOURCE_EPOCH_CONFLICT', 'Snapshot does not match the captured source epoch');
}
function hashConflict(): never {
  throw new SourceError(409, 'SOURCE_HASH_CONFLICT', 'A pinned source member or hash conflicts');
}
function memberMissing(): never {
  throw new SourceError(409, 'MANIFEST_MEMBER_MISSING', 'A pinned source member is missing');
}
function citationInvalid(): never {
  throw new SourceError(422, 'CITATION_INVALID', 'Citation locator is invalid');
}

function sameOrder(left: readonly Id[], right: readonly Id[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
function sameMembers(left: readonly Id[], right: readonly Id[]) {
  return new Set(left).size === left.length && sameOrder(left.toSorted(), right.toSorted());
}

async function loadCapture(db: Pool, source: SourceDefinition, snapshotId: Id) {
  const row = (await db.query<{
    snapshot: unknown; manifest_id: Id; stream_id: Id | null;
    company_id: Id; source_ref: Id; epoch: string; manifest: unknown; dossier: unknown;
  }>(
    'SELECT s.snapshot,s.manifest_id,s.stream_id,m.company_id,m.source_ref,m.epoch,m.manifest,d.dossier ' +
    'FROM source_snapshots s JOIN source_manifests m ON s.manifest_id = m.manifest_id ' +
    'LEFT JOIN source_dossiers d ON m.manifest_id = d.manifest_id WHERE s.snapshot_id = $1',
    [snapshotId],
  )).rows[0];
  if (!row) throw new SourceError(404, 'SNAPSHOT_NOT_FOUND', 'Source snapshot was not found');
  const snapshot = SourceSnapshotSchema.safeParse(row.snapshot);
  const manifest = BootstrapManifestSchema.safeParse(row.manifest);
  const dossier = SourceDossierSchema.safeParse(row.dossier);
  if (!snapshot.success || !manifest.success || !dossier.success) epochConflict();
  const { data: pinned } = manifest;
  const { data: aggregate } = snapshot;
  const { data: status } = dossier;
  if (row.stream_id !== null || row.company_id !== source.companyId || row.source_ref !== source.sourceRef ||
      pinned.companyId !== source.companyId || pinned.sourceRef !== source.sourceRef || String(pinned.epoch) !== row.epoch ||
      pinned.id !== row.manifest_id || aggregate.manifestId !== pinned.id || aggregate.sourceRef !== pinned.sourceRef ||
      aggregate.id !== snapshotId || snapshotId !== 'snapshot:' + pinned.id || status.companyId !== pinned.companyId ||
      status.manifestId !== pinned.id || !status.complete || status.missingMembers.length > 0 ||
      !sameOrder(status.snapshotIds, [snapshotId])) epochConflict();
  if (!sameMembers(pinned.streams.map(stream => stream.streamId), source.streams.map(stream => stream.streamId))) epochConflict();
  if (hashManifest(pinned) !== pinned.hash || !sameMembers(aggregate.evidenceIds, status.evidenceIds) ||
      aggregateHash(pinned, aggregate.eventIds, aggregate.evidenceIds) !== aggregate.contentHash) hashConflict();
  return { manifest: pinned, snapshot: aggregate };
}

type EventRow = {
  event_id: Id; sequence: string; content_hash: Hash; event: RawSourceEvent;
  api_source_id: Id | null; api_original_hash: Hash | null; api_byte_length: number | null; api_extraction: Extraction | null;
};

async function loadEvents(db: Pool, source: SourceDefinition, manifest: BootstrapManifest, snapshot: SourceSnapshot) {
  const rows: EventRow[] = [];
  for (const stream of manifest.streams) {
    const member = (await db.query<{ snapshot: unknown; manifest_id: Id; stream_id: Id | null }>(
      'SELECT snapshot,manifest_id,stream_id FROM source_snapshots WHERE snapshot_id = $1', [stream.snapshotId],
    )).rows[0];
    if (!member) memberMissing();
    const pinned = SourceSnapshotSchema.safeParse(member.snapshot);
    if (!pinned.success || pinned.data.id !== stream.snapshotId || pinned.data.sourceRef !== manifest.sourceRef ||
        pinned.data.manifestId !== manifest.id || member.manifest_id !== manifest.id || member.stream_id !== stream.streamId) {
      epochConflict();
    }
    if (pinned.data.contentHash !== stream.snapshotHash || !sameOrder(pinned.data.eventIds, stream.eventIds) ||
        pinned.data.evidenceIds.length !== 0) hashConflict();

    const { rows: streamRows } = await db.query<EventRow>(
      'SELECT event_id,sequence,content_hash,event,api_source_id,api_original_hash,api_byte_length,api_extraction ' +
      'FROM source_events WHERE source_ref = $1 AND stream_id = $2 AND sequence <= $3 ORDER BY sequence',
      [manifest.sourceRef, stream.streamId, stream.resumeAfter],
    );
    const foundIds = new Set(streamRows.map(row => row.event_id));
    if (stream.eventIds.some(id => !foundIds.has(id))) memberMissing();
    if (streamRows.length !== Number(stream.resumeAfter) ||
        !sameOrder(streamRows.map(row => row.event_id), stream.eventIds)) hashConflict();
    const events = streamRows.map((row, index) => {
      let event: RawSourceEvent;
      try {
        event = validateSourceEvent(source, row.event);
      } catch (error) {
        if (error instanceof SourceError && error.code === 'SOURCE_CONTENT_INVALID') epochConflict();
        throw error;
      }
      if (!Object.hasOwn(manifest.schemaVersions, event.resource) ||
          manifest.schemaVersions[event.resource] !== event.schemaVersion) epochConflict();
      if (event.id !== row.event_id || event.contentHash !== row.content_hash ||
          event.streamId !== stream.streamId || event.sequence !== index + 1 ||
          String(event.sequence) !== row.sequence) hashConflict();
      return event;
    });
    if (streamContentHash(manifest.sourceRef, stream.streamId, stream.resumeAfter, events) !== stream.snapshotHash) hashConflict();
    rows.push(...streamRows);
  }
  if (!sameMembers(snapshot.eventIds, rows.map(row => row.event_id))) hashConflict();
  return rows;
}

async function verifiedExtraction(
  store: CoverageDependencies['store'], kind: StoredSourceFile['metadata']['kind'] | 'api_json',
  hash: Hash, byteLength: number, extraction: Extraction,
) {
  if (!HashSchema.safeParse(hash).success) hashConflict();
  let bytes: Buffer;
  try {
    bytes = await store.get(hash);
  } catch (error) {
    if (error instanceof EvidenceStorageError && error.code === 'SOURCE_HASH_CONFLICT') hashConflict();
    if (sqlState(error) === 'ENOENT' && error instanceof Error && 'syscall' in error && error.syscall === 'open') memberMissing();
    throw new SourceError(503, 'SOURCE_UNAVAILABLE', 'Original source byte storage is unavailable');
  }
  if (hashBytes(bytes) !== hash || bytes.byteLength !== byteLength) hashConflict();
  let fromBytes: Extraction;
  try {
    fromBytes = await extractDocument(kind, bytes);
  } catch (error) {
    if (error instanceof SourceContentError) hashConflict();
    throw error;
  }
  // The stored extractor version is capture metadata. Check the extracted data against the actual original.
  if (fromBytes.mediaType !== extraction?.mediaType ||
      canonicalJson(fromBytes.document) !== canonicalJson(extraction.document ?? null)) hashConflict();
  return fromBytes;
}

type FileRow = StoredSourceFile & {
  company_id: Id; source_ref: Id; document_id: Id; document_version: string;
  batch_id: Id | null; batch_sequence: string | null; batch_stream_id: Id | null;
};

type ExpectedEvidence = { ref: EvidenceRef; fileId: Id | null; apiSourceId: Id | null };

async function expectedEvidence(
  { db, store }: CoverageDependencies, manifest: BootstrapManifest, snapshot: SourceSnapshot, events: EventRow[],
) {
  const expected: ExpectedEvidence[] = [];
  const identityPages = new Map<Id, CapturedIdentityText['kind']>();
  const { rows: files } = await db.query<FileRow>(
    'SELECT * FROM source_files WHERE file_id = ANY($1)', [manifest.files.map(file => file.fileId)],
  );
  const byId = new Map(files.map(file => [file.file_id, file]));
  for (const member of manifest.files) {
    const file = byId.get(member.fileId);
    if (!file) memberMissing();
    const metadata = UploadMetadataSchema.safeParse(file.metadata);
    if (!metadata.success) hashConflict();
    const { data } = metadata;
    if (file.company_id !== manifest.companyId || file.source_ref !== manifest.sourceRef ||
        data.companyId !== manifest.companyId || data.sourceRef !== manifest.sourceRef) epochConflict();
    if (sourceFileId(data) !== member.fileId || file.content_hash !== member.sha256 ||
        file.document_id !== member.documentId || file.document_version !== String(member.documentVersion) ||
        data.documentId !== member.documentId || data.documentVersion !== member.documentVersion || data.kind !== member.kind ||
        file.batch_id !== (member.batchId ?? null) || file.batch_stream_id !== (member.streamId ?? null) ||
        file.batch_sequence !== (member.sequence === undefined ? null : String(member.sequence)) ||
        data.batch?.batchId !== member.batchId || data.batch?.streamId !== member.streamId ||
        data.batch?.sequence !== member.sequence || hashCanonical(file.extraction) !== file.extraction_hash) hashConflict();
    const extraction = await verifiedExtraction(store, member.kind, member.sha256, file.byte_length, file.extraction);
    const refs = documentCitations(snapshot.id, [{ ...file, extraction }]);
    for (const ref of refs) expected.push({ ref, fileId: file.file_id, apiSourceId: null });
    if (member.kind !== 'event_csv') {
      const page = refs.find(ref => ref.locator.kind === 'pdf' && ref.locator.page === 1) ?? refs[0];
      if (page) identityPages.set(page.id, member.kind);
    }
  }
  for (const row of events) {
    if (row.api_source_id === null) continue;
    const { api_source_id: id, api_original_hash: hash, api_byte_length: length, api_extraction: extraction } = row;
    if (!hash || length === null || !extraction ||
        id !== 'api:' + hashCanonical({ companyId: manifest.companyId, sourceRef: manifest.sourceRef, eventId: row.event_id })) {
      hashConflict();
    }
    const original = await verifiedExtraction(store, 'api_json', hash, length, extraction);
    if (original.document.kind !== 'json' || canonicalJson(original.document.value) !== canonicalJson(row.event.payload)) hashConflict();
    const ref = citeEvidence({ snapshotId: snapshot.id, sourceId: id, contentHash: hash, extraction: original,
      locator: { kind: 'json', pointer: '' } });
    expected.push({ ref, fileId: null, apiSourceId: id });
  }
  return { expected, identityPages };
}

async function loadIdentityDocuments(
  dependencies: CoverageDependencies, manifest: BootstrapManifest, snapshot: SourceSnapshot, events: EventRow[],
  authorize: EvidenceAuthorization,
) {
  const { db } = dependencies;
  const { expected, identityPages } = await expectedEvidence(dependencies, manifest, snapshot, events);
  if (!sameMembers(snapshot.evidenceIds, expected.map(({ ref }) => ref.id))) hashConflict();
  const { rows } = await db.query<{ evidence_id: Id; snapshot_id: Id; file_id: Id | null; api_source_id: Id | null }>(
    'SELECT evidence_id,snapshot_id,file_id,api_source_id FROM source_evidence WHERE snapshot_id = $1 OR evidence_id = ANY($2)',
    [snapshot.id, snapshot.evidenceIds],
  );
  const byId = new Map(rows.map(row => [row.evidence_id, row]));
  if (snapshot.evidenceIds.some(id => !byId.has(id))) memberMissing();
  if (!sameMembers(snapshot.evidenceIds, rows.map(row => row.evidence_id))) hashConflict();

  const documents: CapturedIdentityText[] = [];
  for (const { ref, fileId, apiSourceId } of expected) {
    const row = byId.get(ref.id)!;
    if (row.snapshot_id !== snapshot.id || row.file_id !== fileId || row.api_source_id !== apiSourceId) hashConflict();
    const response = await readEvidence(db, ref.id, async binding => {
      if (binding.companyId !== manifest.companyId || binding.sourceRef !== manifest.sourceRef) hashConflict();
      await authorize(binding);
    }).catch(error => {
      if (error instanceof SourceError && error.status === 404) memberMissing();
      if (error instanceof ZodError) {
        if (error.issues.some(issue => issue.path[0] === 'locator')) citationInvalid();
        hashConflict();
      }
      throw error;
    });
    if (canonicalJson(response.evidence) !== canonicalJson(ref)) hashConflict();
    const kind = identityPages.get(ref.id);
    if (kind) {
      const { locator } = ref;
      const text = locator.kind === 'pdf' && locator.page !== 1 ? '' : response.text.value;
      documents.push({ kind, citationId: ref.id, text });
    }
  }
  return documents;
}

export async function readSourceCoverage(
  dependencies: CoverageDependencies, source: SourceDefinition, snapshotId: Id, authorize: EvidenceAuthorization,
): Promise<SourceCoverageResponse> {
  const { manifest, snapshot } = await loadCapture(dependencies.db, source, snapshotId);
  const rows = await loadEvents(dependencies.db, source, manifest, snapshot);
  const documents = await loadIdentityDocuments(dependencies, manifest, snapshot, rows, authorize);
  const events = rows.map(({ event: { id, kind, rawIdentity } }) => ({ id, kind, rawIdentity }));
  return SourceCoverageResponseSchema.parse({
    companyId: manifest.companyId, sourceRef: manifest.sourceRef, manifestHash: manifest.hash, snapshot,
    derivation: 'captured-source-rules-v1', events, ...deriveSourceCoverageObservations(manifest.asOf, documents, events),
  });
}
