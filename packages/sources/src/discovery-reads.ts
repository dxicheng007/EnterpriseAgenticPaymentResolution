import {
  DiscoveryBindingSchema, DiscoverySubjectSchema, EvidenceRefSchema, IdSchema, SourceDossierSchema,
  canonicalJson, hashCanonical, hashManifest,
  type DiscoveryBinding, type DiscoverySubject, type EvidenceRef, type Id, type RawSourceEvent,
} from '@eapr/contracts';
import { CitationError, SourceContentError, type EvidenceStore } from '@eapr/evidence';
import type { Pool, QueryResultRow } from 'pg';
import {
  aggregateHash, documentCitations, inspectBaseline, readManifestEntry, readSnapshotEntry,
  validateManifestStreams, type CaptureRead,
} from './dossier.js';
import { SourceError } from './errors.js';
import type { SourceDefinition } from './records.js';

type SourceAccount = Extract<DiscoverySubject,{kind:'source_account'}>;

export type ValidatedDiscoveryCapture = {
  readonly binding: DiscoveryBinding;
  readonly sourceAccounts: readonly SourceAccount[];
  readonly evidenceIds: readonly Id[];
};

function unavailable(): SourceError {
  return new SourceError(503,'SOURCE_UNAVAILABLE','Source capture storage is unavailable');
}

function missing(): SourceError {
  return new SourceError(409,'MANIFEST_MEMBER_MISSING','The pinned source capture is incomplete');
}

function conflict(): SourceError {
  return new SourceError(409,'SOURCE_HASH_CONFLICT','Pinned source capture content conflicts');
}

function epochConflict(): SourceError {
  return new SourceError(409,'SOURCE_EPOCH_CONFLICT','Pinned source capture identity conflicts');
}

async function readDossierProof(read:CaptureRead,companyId:Id,manifestId:Id,snapshotId:Id) {
  const row = (await read<{dossier:unknown}>(
    'SELECT dossier FROM source_dossiers WHERE manifest_id = $1',[manifestId],
  ))[0];
  if (!row) throw missing();
  const dossier = SourceDossierSchema.parse(row.dossier);
  if (dossier.companyId !== companyId || dossier.manifestId !== manifestId ||
      (dossier.complete && (dossier.snapshotIds.length !== 1 || dossier.snapshotIds[0] !== snapshotId))) {
    throw epochConflict();
  }
  if (!dossier.complete || dossier.missingMembers.length || dossier.diagnostics.some(d=>d.severity === 'blocker')) {
    throw missing();
  }
  return dossier;
}

type CitationRow = {evidence_id:Id;snapshot_id:Id;file_id:Id|null;api_source_id:Id|null;evidence:unknown};

async function verifyCitations(
  read:CaptureRead,snapshotId:Id,expected:ReadonlyMap<Id,EvidenceRef>,fileIds:ReadonlySet<Id>,
) {
  const ids = [...expected.keys()];
  // Query both ways to detect an expected citation moved to another epoch and extras attached to this one.
  const rows = await read<CitationRow>(
    'SELECT * FROM source_evidence WHERE snapshot_id = $1 OR evidence_id = ANY($2) ORDER BY evidence_id',[snapshotId,ids],
  );
  const seen = new Set<Id>();
  for (const row of rows) {
    const citation = EvidenceRefSchema.parse(row.evidence);
    const required = expected.get(row.evidence_id);
    if (!required || seen.has(row.evidence_id)) throw conflict();
    if (row.snapshot_id !== snapshotId || citation.snapshotId !== snapshotId) throw epochConflict();
    if (fileIds.has(required.sourceId)
      ? row.file_id !== required.sourceId || row.api_source_id !== null
      : row.file_id !== null || row.api_source_id !== required.sourceId) throw epochConflict();
    if (canonicalJson(citation) !== canonicalJson(required)) throw conflict();
    seen.add(row.evidence_id);
  }
  if (seen.size !== expected.size) throw missing();
}

function sourceAccounts(events:readonly RawSourceEvent[]):SourceAccount[] {
  const entries = new Map<string,SourceAccount>();
  for (const {rawIdentity:{sellerEntityId,sourceAccountId}} of events) {
    // Incomplete raw identities still contribute evidence to the capture.
    if (sellerEntityId === undefined || sourceAccountId === undefined) continue;
    const subject = DiscoverySubjectSchema.parse({kind:'source_account',sellerEntityId,sourceAccountId});
    if (subject.kind === 'source_account') entries.set(JSON.stringify([sellerEntityId,sourceAccountId]),subject);
  }
  return [...entries.keys()].sort().map(key=>entries.get(key)!);
}

type CaptureDependencies = {db:Pool;store:Pick<EvidenceStore,'get'>};
type CaptureSelector = {companyId:Id;manifestId:Id};

export async function readDiscoveryCapture(
  dependencies:CaptureDependencies, catalog:ReadonlyMap<Id,SourceDefinition>, input:CaptureSelector,
):Promise<ValidatedDiscoveryCapture> {
  return (await readDiscoveryCaptureContents(dependencies,catalog,input)).facts;
}

// Retain the exact content proved by the original reads for source-owned tools.
export async function readDiscoveryCaptureContents(
  {db,store}:CaptureDependencies, catalog:ReadonlyMap<Id,SourceDefinition>, input:CaptureSelector,
) {
  const company = IdSchema.safeParse(input?.companyId);
  const selected = IdSchema.safeParse(input?.manifestId);
  if (!company.success || !selected.success) {
    throw new SourceError(400,'SOURCE_CONTENT_INVALID','Discovery capture selector is invalid');
  }
  const companyId = company.data;
  const manifestId = selected.data;
  const source = catalog.get(companyId);
  if (!source) throw new SourceError(404,'SOURCE_NOT_FOUND','Registered source was not found');

  const query:CaptureRead = async <Row extends QueryResultRow>(sql:string,values:(Id|Id[])[]) => {
    try {
      return (await db.query<Row>(sql,values)).rows;
    } catch {
      throw unavailable();
    }
  };
  const checkedReads: {sql:string;values:(Id|Id[])[];count:number;hash:string}[] = [];
  const read:CaptureRead = async <Row extends QueryResultRow>(sql:string,values:(Id|Id[])[]) => {
    const rows = await query<Row>(sql,values);
    checkedReads.push({sql,values,count:rows.length,hash:hashCanonical(rows)});
    return rows;
  };

  try {
    const entry = await readManifestEntry(read,companyId,manifestId);
    const {manifest} = entry;
    validateManifestStreams(manifest,source);
    if (manifest.id !== manifestId || manifest.companyId !== companyId || entry.manifest_id !== manifestId ||
        entry.company_id !== companyId || entry.source_ref !== manifest.sourceRef || entry.epoch !== String(manifest.epoch)) throw epochConflict();
    if (hashManifest(manifest) !== manifest.hash) throw conflict();

    const snapshotId = 'snapshot:' + manifestId;
    const dossier = await readDossierProof(query,companyId,manifestId,snapshotId);
    const aggregate = await readSnapshotEntry(read,snapshotId);
    const {snapshot} = aggregate;
    if (aggregate.manifest_id !== manifestId || aggregate.stream_id !== null || snapshot.id !== snapshotId ||
        snapshot.manifestId !== manifestId || snapshot.sourceRef !== manifest.sourceRef) throw epochConflict();

    const inspected = await inspectBaseline(read,store,manifest,snapshotId,source);
    if (inspected.diagnostics.length) {
      const code = inspected.diagnostics.find(d=>d.code === 'SOURCE_EPOCH_CONFLICT')?.code ??
        inspected.diagnostics[0]!.code;
      throw new SourceError(409,code,'Pinned source members failed validation',inspected.diagnostics);
    }

    const fileCitations = documentCitations(snapshotId,inspected.files);
    const citations = [...inspected.citations,...fileCitations];
    const expected = new Map(citations.map(citation=>[citation.id,citation]));
    const evidenceIds = [...expected.keys()].sort();
    const equalIds = (actual:Id[], sorted:Id[]) => canonicalJson(actual.toSorted()) === canonicalJson(sorted);
    if (expected.size !== citations.length || inspected.validatedEvents.length !== inspected.eventIds.length ||
        !equalIds(snapshot.eventIds,inspected.eventIds) || !equalIds(snapshot.evidenceIds,evidenceIds) ||
        !equalIds(dossier.evidenceIds,evidenceIds) ||
        snapshot.contentHash !== aggregateHash(manifest,inspected.eventIds,evidenceIds)) throw conflict();

    await verifyCitations(read,snapshotId,expected,new Set(inspected.files.map(file=>file.file_id)));

    // Recheck exact selected rows after blob I/O. Each query releases the pool client before any external read.
    for (const check of checkedReads) {
      const rows = await query(check.sql,check.values);
      if (rows.length < check.count) throw missing();
      if (hashCanonical(rows) !== check.hash) throw conflict();
    }
    const currentDossier = await readDossierProof(query,companyId,manifestId,snapshotId);
    if (!equalIds(currentDossier.evidenceIds,evidenceIds)) throw conflict();
    const facts:ValidatedDiscoveryCapture = {
      binding:DiscoveryBindingSchema.parse({
        companyId,sourceRef:manifest.sourceRef,manifestId,manifestHash:manifest.hash,
        snapshotId,snapshotHash:snapshot.contentHash,
      }),
      sourceAccounts:sourceAccounts(inspected.validatedEvents),
      evidenceIds:IdSchema.array().parse(evidenceIds),
    };
    return {
      facts, manifest, events:inspected.validatedEvents, apiCitations:inspected.verifiedApiCitations,
      fileCitations, files:inspected.files,
    };
  } catch (error) {
    if (error instanceof SourceError) throw error;
    if (error instanceof CitationError) throw new SourceError(422,'CITATION_INVALID','Pinned citation locator is invalid');
    if (error instanceof SourceContentError) throw new SourceError(422,'SOURCE_CONTENT_INVALID','Pinned original content is invalid');
    throw conflict();
  }
}
