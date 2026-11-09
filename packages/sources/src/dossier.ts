import {
  BootstrapManifestSchema, HashSchema, IdSchema, SourceDossierSchema, SourceSnapshotSchema, UploadMetadataSchema, canonicalJson, hashBytes, hashCanonical, hashEvent, hashManifest,
  type BootstrapManifest, type CaptureSnapshotResult, type Cursor, type Diagnostic, type EvidenceRef, type Hash, type Id, type ManifestStream,
  type RawSourceEvent, type SourceDossier, type SourceSnapshot,
} from '@eapr/contracts';
import type { Pool, QueryResultRow } from 'pg';
import { EvidenceStorageError, extractDocument, type EvidenceStore, type Extraction } from '@eapr/evidence';
import { publishActivity } from '@eapr/storage/activity';
import { sqlState, withTransaction } from '@eapr/storage/transaction';
import { citeEvidence } from './evidence-records.js';
import { insertSourceRecord, validateSourceEvent, type PreparedSourceRecord, type SourceDefinition } from './records.js';
import { lockSource, sourceFileId, type StoredSourceFile, type UploadDependencies } from './uploads.js';
import { SourceError } from './errors.js';

export type CaptureRead = <Row extends QueryResultRow>(sql:string, values:(Id|Id[])[]) => Promise<Row[]>;

type ManifestRow = {manifest_id:Id;company_id:Id;source_ref:Id;epoch:string;manifest:BootstrapManifest};

export async function readManifestEntry(read:CaptureRead, companyId:Id, manifestId?:Id) {
  const rows = manifestId === undefined
    ? await read<ManifestRow>(
      'SELECT * FROM source_manifests WHERE company_id = $1 ORDER BY epoch DESC LIMIT 1',[companyId])
    : await read<ManifestRow>(
      'SELECT * FROM source_manifests WHERE company_id = $1 AND manifest_id = $2',[companyId,manifestId]);
  if (!rows[0]) throw new SourceError(404,'MANIFEST_NOT_FOUND','Manifest was not found');
  return {...rows[0],manifest:BootstrapManifestSchema.parse(rows[0].manifest)};
}

export async function readManifest(db: Pool, companyId: Id, manifestId?: Id): Promise<BootstrapManifest> {
  return (await readManifestEntry(async (sql,values)=>(await db.query(sql,values)).rows,companyId,manifestId)).manifest;
}

export async function readDossier(db: Pool, companyId: Id, manifestId?: Id): Promise<SourceDossier> {
  const manifest = await readManifest(db,companyId,manifestId);
  const result = await db.query<{dossier:SourceDossier}>(
    'SELECT dossier FROM source_dossiers WHERE manifest_id = $1',[manifest.id],
  );
  return SourceDossierSchema.parse(result.rows[0]?.dossier ?? {
    companyId,manifestId:manifest.id,snapshotIds:[],evidenceIds:[],complete:false,missingMembers:[],diagnostics:[],
  });
}

type CaptureDependencies = UploadDependencies;

type StreamRecord = {
  event:RawSourceEvent; source_ref:Id; stream_id:Id; sequence:string; event_id:Id; content_hash:Hash;
  api_source_id:Id|null; api_original_hash:Hash|null; api_extraction:Extraction|null; api_byte_length:number|null;
};

export function streamContentHash(sourceRef:Id,streamId:Id,resumeAfter:Cursor,events:readonly RawSourceEvent[]) {
  return hashCanonical({sourceRef,streamId,resumeAfter,events:events.map(({id,contentHash})=>({id,contentHash}))});
}

async function streamRecords(
  db:Pick<Pool,'query'>,sourceRef:Id,streamId:Id,resumeAfter:Cursor,
):Promise<StreamRecord[]> {
  return readStreamRecords(async (sql,values)=>(await db.query(sql,values)).rows,sourceRef,streamId,resumeAfter);
}

function readStreamRecords(read:CaptureRead,sourceRef:Id,streamId:Id,resumeAfter:Cursor) {
  return read<StreamRecord>(
    'SELECT * FROM source_events WHERE source_ref = $1 AND stream_id = $2 AND sequence <= $3 ORDER BY sequence',
    [sourceRef,streamId,resumeAfter],
  );
}

export function validateManifestStreams(manifest:BootstrapManifest,source:SourceDefinition) {
  if (manifest.companyId !== source.companyId || manifest.sourceRef !== source.sourceRef ||
      manifest.streams.length !== source.streams.length ||
      manifest.streams.some(stream=>!source.streams.some(defined=>defined.streamId === stream.streamId)) ||
      !IdSchema.safeParse('snapshot:' + manifest.id).success) {
    throw new SourceError(409,'SOURCE_EPOCH_CONFLICT','Manifest does not match its registered source');
  }
}

export async function publishBaseline(
  {db,clock}: CaptureDependencies, source: SourceDefinition, input: BootstrapManifest,
  prepared: readonly PreparedSourceRecord[],
) {
  const manifest = BootstrapManifestSchema.parse(input);
  validateManifestStreams(manifest,source);
  if (hashManifest(manifest) !== manifest.hash) throw new SourceError(409,'SOURCE_HASH_CONFLICT','Manifest hash conflicts');
  return withTransaction(db,async client => {
    await lockSource(client,manifest.sourceRef);
    const existing = (await client.query<{manifest:BootstrapManifest}>(
      'SELECT manifest FROM source_manifests WHERE manifest_id = $1',[manifest.id],
    )).rows[0]?.manifest;
    if (existing) {
      if (existing.hash !== manifest.hash) throw new SourceError(409,'SOURCE_HASH_CONFLICT','Manifest identity conflicts');
      for (const item of prepared) {
        const event = validateSourceEvent(source,item.event);
        const stored = (await client.query<{content_hash:Hash;api_original_hash:Hash|null}>(
          'SELECT content_hash,api_original_hash FROM source_events WHERE source_ref = $1 AND event_id = $2',
          [event.sourceRef,event.id],
        )).rows[0];
        if (!stored || stored.content_hash !== event.contentHash || stored.api_original_hash !== (item.original?.hash ?? null)) {
          throw new SourceError(409,'SOURCE_HASH_CONFLICT','Published manifest records conflict');
        }
      }
      return existing;
    }
    const latest = (await client.query<{epoch:string}>(
      'SELECT epoch FROM source_manifests WHERE source_ref = $1 ORDER BY epoch DESC LIMIT 1',[manifest.sourceRef],
    )).rows[0];
    if (latest && Number(latest.epoch) >= manifest.epoch) {
      throw new SourceError(409,'SOURCE_EPOCH_CONFLICT','Manifest epoch is out of order');
    }
    for (const item of prepared) await insertSourceRecord(client,{...item,event:validateSourceEvent(source,item.event)});
    const snapshots: {snapshot:SourceSnapshot;streamId:Id}[] = [];
    for (const member of manifest.streams) {
      const events = (await streamRecords(client,manifest.sourceRef,member.streamId,member.resumeAfter)).map(row=>row.event);
      const highWater = Number((await client.query<{sequence:string}>(
        'SELECT COALESCE(max(sequence),0) AS sequence FROM source_events WHERE source_ref = $1 AND stream_id = $2',
        [manifest.sourceRef,member.streamId],
      )).rows[0]?.sequence);
      if (highWater !== Number(member.resumeAfter)) {
        throw new SourceError(409,'SOURCE_EPOCH_CONFLICT','Manifest watermark does not match its publication epoch');
      }
      if (!matchesStream(manifest,member,events)) {
        throw new SourceError(409,'SOURCE_HASH_CONFLICT','Manifest stream membership conflicts');
      }
      snapshots.push({streamId:member.streamId,snapshot:{
        id:member.snapshotId,manifestId:manifest.id,sourceRef:manifest.sourceRef,
        capturedAt:clock().toISOString(),contentHash:member.snapshotHash,
        evidenceIds:[],eventIds:member.eventIds,
      }});
    }
    await client.query(
      'INSERT INTO source_manifests (manifest_id,company_id,source_ref,epoch,manifest) VALUES ($1,$2,$3,$4,$5)',
      [manifest.id,manifest.companyId,manifest.sourceRef,manifest.epoch,JSON.stringify(manifest)],
    );
    for (const {snapshot,streamId} of snapshots) {
      await client.query('INSERT INTO source_snapshots (snapshot_id,manifest_id,stream_id,snapshot) VALUES ($1,$2,$3,$4)',
        [snapshot.id,manifest.id,streamId,JSON.stringify(SourceSnapshotSchema.parse(snapshot))]);
    }
    return manifest;
  });
}

function matchesStream(manifest:BootstrapManifest,member:ManifestStream,events:readonly RawSourceEvent[]) {
  const ids = new Set(member.eventIds);
  return events.length === Number(member.resumeAfter) && ids.size === events.length &&
    events.every((event,index)=>event.sequence === index+1 && ids.has(event.id) && hashEvent(event) === event.contentHash) &&
    streamContentHash(manifest.sourceRef,member.streamId,member.resumeAfter,events) === member.snapshotHash;
}

type SnapshotRow = {snapshot_id:Id;manifest_id:Id;stream_id:Id|null;snapshot:SourceSnapshot};

export async function readSnapshotEntry(read:CaptureRead,id:Id) {
  const row = (await read<SnapshotRow>('SELECT * FROM source_snapshots WHERE snapshot_id = $1',[id]))[0];
  if (!row) throw new SourceError(404,'SNAPSHOT_NOT_FOUND','Source snapshot was not found');
  return {...row,snapshot:SourceSnapshotSchema.parse(row.snapshot)};
}

export async function readSnapshot(db:Pool, id:Id) {
  return (await readSnapshotEntry(async (sql,values)=>(await db.query(sql,values)).rows,id)).snapshot;
}

function issue(code:string,message:string,id:Id):Diagnostic {
  return {code,severity:'blocker',message,sourceIds:[id],fieldPaths:[]};
}

type FileRow = StoredSourceFile & {
  company_id:Id;source_ref:Id;document_id:Id;document_version:string;
  batch_id:Id|null;batch_sequence:string|null;batch_stream_id:Id|null;
};

function validateFileRow(row:FileRow, manifest:BootstrapManifest) {
  const metadata = UploadMetadataSchema.parse(row.metadata);
  if (row.company_id !== manifest.companyId || row.source_ref !== manifest.sourceRef) {
    throw new SourceError(409,'SOURCE_EPOCH_CONFLICT','Document row does not belong to the pinned source');
  }
  if (row.file_id !== sourceFileId(metadata) || row.document_id !== metadata.documentId ||
      row.document_version !== String(metadata.documentVersion) || row.batch_id !== (metadata.batch?.batchId ?? null) ||
      row.batch_stream_id !== (metadata.batch?.streamId ?? null) ||
      row.batch_sequence !== (metadata.batch ? String(metadata.batch.sequence) : null)) {
    throw new SourceError(409,'SOURCE_HASH_CONFLICT','Pinned document metadata conflicts');
  }
}

function validateEventRow(row:StreamRecord,source:SourceDefinition,streamId:Id) {
  const {event} = row;
  if (event?.sourceRef !== row.source_ref || event?.streamId !== streamId ||
      event?.rawIdentity?.companyId !== source.companyId || event?.id !== row.event_id ||
      String(event?.sequence) !== row.sequence) {
    throw new SourceError(409,'SOURCE_EPOCH_CONFLICT','Event does not match its pinned source identity');
  }
  if (event.contentHash !== row.content_hash) {
    throw new SourceError(409,'SOURCE_HASH_CONFLICT','Pinned event row hash conflicts');
  }
  return validateSourceEvent(source,event);
}

async function verifyExtraction(bytes:Uint8Array,kind:StoredSourceFile['metadata']['kind']|'api_json',expected:Extraction) {
  const extracted = await extractDocument(kind,bytes);
  // The persisted extractor version identifies the original capture. Compare its output with the original bytes.
  if (extracted.mediaType !== expected?.mediaType ||
      canonicalJson(extracted.document) !== canonicalJson(expected.document ?? null)) {
    throw new SourceError(409,'SOURCE_HASH_CONFLICT','Pinned extraction conflicts with its original');
  }
  return extracted;
}

export async function inspectBaseline(
  read:CaptureRead, store:Pick<EvidenceStore,'get'>, manifest:BootstrapManifest, snapshotId:Id,
  source?:SourceDefinition,
) {
  const diagnostics: Diagnostic[] = [];
  const missingMembers: Id[] = [];
  const citations: EvidenceRef[] = [];
  const files: StoredSourceFile[] = [];
  const eventIds: Id[] = [];
  const validatedEvents:RawSourceEvent[] = [];
  function missing(id:Id) {
    missingMembers.push(id);
    diagnostics.push(issue('MANIFEST_MEMBER_MISSING','A pinned source member is missing',id));
  }
  function conflict(id:Id) {
    diagnostics.push(issue('SOURCE_HASH_CONFLICT','A pinned source member hash conflicts',id));
  }
  async function verifyBytes(id:Id,hash:Hash,byteLength?:number|null) {
    if (source) HashSchema.parse(hash);
    try {
      const bytes = await store.get(hash);
      if (source && (bytes.byteLength !== byteLength || hashBytes(bytes) !== hash)) {
        conflict(id);
        return;
      }
      return bytes;
    } catch (error) {
      if (sqlState(error) === 'ENOENT') missing(id);
      else if (error instanceof EvidenceStorageError && error.code === 'SOURCE_HASH_CONFLICT') conflict(id);
      else throw new SourceError(503,'SOURCE_UNAVAILABLE','Original source byte storage is unavailable');
      return undefined;
    }
  }
  for (const member of manifest.files) {
    const row = (await read<FileRow>('SELECT * FROM source_files WHERE file_id = $1',[member.fileId]))[0];
    if (!row) {
      missing(member.fileId);
      continue;
    }
    if (source) validateFileRow(row,manifest);
    const {metadata} = row;
    if (metadata.companyId !== manifest.companyId || metadata.sourceRef !== manifest.sourceRef) {
      diagnostics.push(issue('SOURCE_EPOCH_CONFLICT','Document does not belong to the pinned source',member.fileId));
      continue;
    }
    if (row.content_hash !== member.sha256 || metadata.documentId !== member.documentId ||
        metadata.documentVersion !== member.documentVersion || metadata.kind !== member.kind ||
        metadata.batch?.batchId !== member.batchId || metadata.batch?.streamId !== member.streamId ||
        metadata.batch?.sequence !== member.sequence || hashCanonical(row.extraction) !== row.extraction_hash) {
      conflict(member.fileId);
      continue;
    }
    const bytes = await verifyBytes(member.fileId,member.sha256,row.byte_length);
    if (bytes) {
      if (source) await verifyExtraction(bytes,metadata.kind,row.extraction);
      files.push(row);
    }
  }
  for (const member of manifest.streams) {
    let pinned: SourceSnapshot;
    try {
      const entry = await readSnapshotEntry(read,member.snapshotId);
      pinned = entry.snapshot;
      if (source && (entry.manifest_id !== manifest.id || entry.stream_id !== member.streamId ||
          pinned.id !== member.snapshotId)) {
        throw new SourceError(409,'SOURCE_EPOCH_CONFLICT','Stream snapshot does not match its pinned identity');
      }
    } catch (error) {
      if (!(error instanceof SourceError) || error.status !== 404) throw error;
      missing(member.snapshotId);
      continue;
    }
    if (pinned.manifestId !== manifest.id || pinned.sourceRef !== manifest.sourceRef) {
      diagnostics.push(issue('SOURCE_EPOCH_CONFLICT','Stream snapshot does not belong to the pinned epoch',member.snapshotId));
      continue;
    }
    if (source && (member.eventIds.length !== Number(member.resumeAfter) || pinned.evidenceIds.length !== 0)) {
      conflict(member.snapshotId);
      continue;
    }
    const records = await readStreamRecords(read,manifest.sourceRef,member.streamId,member.resumeAfter);
    const events = records.map(row=>source ? validateEventRow(row,source,member.streamId) : row.event);
    const ids = new Set(events.map(event=>event.id));
    const absent = member.eventIds.filter(id=>!ids.has(id));
    if (absent.length) {
      for (const id of absent) missing(id);
      continue;
    }
    if (pinned.contentHash !== member.snapshotHash ||
        canonicalJson([...pinned.eventIds].sort()) !== canonicalJson([...member.eventIds].sort()) ||
        !matchesStream(manifest,member,events)) {
      conflict(member.snapshotId);
      continue;
    }
    eventIds.push(...events.map(event=>event.id));
    if (source) validatedEvents.push(...events);
    const transport = source?.streams.find(stream=>stream.streamId === member.streamId)?.transport;
    for (const row of records) {
      if (!row.api_source_id || !row.api_original_hash || !row.api_extraction) {
        if (source && transport !== 'csv') missing(row.event_id);
        continue;
      }
      const bytes = await verifyBytes(row.api_source_id,row.api_original_hash,row.api_byte_length);
      if (bytes) {
        if (source) {
          const expectedId = 'api:' + hashCanonical({companyId:manifest.companyId,sourceRef:manifest.sourceRef,eventId:row.event_id});
          if (row.api_source_id !== expectedId) {
            throw new SourceError(409,'SOURCE_EPOCH_CONFLICT','API original does not match its pinned event identity');
          }
          const extraction = await verifyExtraction(bytes,'api_json',row.api_extraction);
          if (extraction.document.kind !== 'json' ||
              canonicalJson(extraction.document.value) !== canonicalJson(row.event.payload)) {
            throw new SourceError(409,'SOURCE_HASH_CONFLICT','API original does not match its pinned event content');
          }
        }
        citations.push(citeEvidence({snapshotId,sourceId:row.api_source_id,contentHash:row.api_original_hash,
          extraction:row.api_extraction,locator:{kind:'json',pointer:''}}));
      }
    }
  }
  return {diagnostics,missingMembers:[...new Set(missingMembers)].sort(),citations,eventIds:[...new Set(eventIds)].sort(),files,validatedEvents};
}

async function loadManifestById(db:Pool,manifestId:Id) {
  const row = (await db.query<{manifest:BootstrapManifest}>(
    'SELECT manifest FROM source_manifests WHERE manifest_id = $1',[manifestId],
  )).rows[0];
  if (!row) throw new SourceError(404,'MANIFEST_NOT_FOUND','Manifest was not found');
  return BootstrapManifestSchema.parse(row.manifest);
}

export function aggregateHash(manifest:BootstrapManifest,eventIds:Id[],evidenceIds:Id[]) {
  const compare = (a:string,b:string) => a < b ? -1 : a > b ? 1 : 0;
  return hashCanonical({
    manifestHash:manifest.hash,
    streams:manifest.streams.map(({streamId,snapshotId,snapshotHash})=>({streamId,snapshotId,snapshotHash}))
      .sort((a,b)=>compare(a.streamId,b.streamId)),
    files:manifest.files.map(({fileId,sha256})=>({fileId,sha256})).sort((a,b)=>compare(a.fileId,b.fileId)),
    eventIds:[...eventIds].sort(),evidenceIds:[...evidenceIds].sort(),
  });
}

export function documentCitations(snapshotId:Id,files:readonly StoredSourceFile[]): EvidenceRef[] {
  return files.flatMap(file => {
    const {extraction} = file;
    const document = extraction.document;
    const locators: EvidenceRef['locator'][] = [];
    if (document.kind === 'pdf') {
      for (const [index,value] of document.pages.entries()) {
        if (value.length) locators.push({kind:'pdf',page:index+1,start:0,end:value.length});
      }
    } else if (document.kind === 'email') {
      locators.push({kind:'email',messageId:document.messageId,start:0,end:document.body.length});
    } else if (document.kind === 'csv') {
      const payloadColumn = document.headers.indexOf('payload_json');
      for (const [index,row] of document.rows.entries()) {
        const column = payloadColumn >= 0 && row[payloadColumn] ? payloadColumn : row.findIndex(Boolean);
        if (column >= 0) locators.push({kind:'csv',row:index+1,column:document.headers[column]!});
      }
    }
    return locators.map(locator=>citeEvidence({
      snapshotId,sourceId:file.file_id,contentHash:file.content_hash,extraction,locator,
    }));
  });
}

export async function captureBaseline(
  dependencies:CaptureDependencies, manifestId:Id,
):Promise<CaptureSnapshotResult> {
  const {db,clock} = dependencies;
  const manifest = await loadManifestById(db,manifestId);
  const snapshotId = IdSchema.parse('snapshot:' + manifestId);
  const existing = await storedCapture(db,manifestId,snapshotId);
  if (existing) return existing;

  const inspected = await inspectBaseline(async (sql,values)=>(await db.query(sql,values)).rows,
    dependencies.store,manifest,snapshotId);
  const {eventIds,diagnostics,missingMembers} = inspected;
  const complete = diagnostics.length === 0;
  const citations = complete
    ? [...inspected.citations,...documentCitations(snapshotId,inspected.files)]
    : [];
  const evidenceIds = [...new Set(citations.map(citation=>citation.id))].sort();
  const dossier = SourceDossierSchema.parse({
    companyId:manifest.companyId,manifestId,
    snapshotIds:complete ? [snapshotId] : [],evidenceIds,complete,missingMembers,diagnostics,
  });
  return withTransaction(db,async client => {
    await lockSource(client,manifest.sourceRef);
    const raced = await storedCapture(client,manifestId,snapshotId);
    if (raced) return raced;
    await client.query(
      'INSERT INTO source_dossiers (manifest_id,dossier) VALUES ($1,$2) ' +
      'ON CONFLICT (manifest_id) DO UPDATE SET dossier = EXCLUDED.dossier',
      [manifestId,JSON.stringify(dossier)],
    );
    if (!complete) return {ok:false,dossier,diagnostics};
    const snapshot = SourceSnapshotSchema.parse({
      id:snapshotId,manifestId,sourceRef:manifest.sourceRef,capturedAt:clock().toISOString(),
      contentHash:aggregateHash(manifest,eventIds,evidenceIds),eventIds,evidenceIds,
    });
    await client.query(
      'INSERT INTO source_snapshots (snapshot_id,manifest_id,stream_id,snapshot) VALUES ($1,$2,NULL,$3)',
      [snapshot.id,manifest.id,JSON.stringify(snapshot)],
    );
    const fileIds = new Set(inspected.files.map(row=>row.file_id));
    for (const evidence of citations) {
      const isFile = fileIds.has(evidence.sourceId);
      await client.query(
        'INSERT INTO source_evidence (evidence_id,snapshot_id,file_id,api_source_id,evidence) VALUES ($1,$2,$3,$4,$5) ' +
        'ON CONFLICT (evidence_id) DO NOTHING',
        [evidence.id,evidence.snapshotId,isFile ? evidence.sourceId : null,isFile ? null : evidence.sourceId,JSON.stringify(evidence)],
      );
    }
    await publishActivity(client,{
      stream:'control',phase:'build',type:'source.captured',at:snapshot.capturedAt,
      payload:{sourceRef:manifest.sourceRef,manifestId,snapshotHash:snapshot.contentHash,captured:eventIds.length},
    });
    return {ok:true,snapshot,dossier};
  });
}

async function storedCapture(db:Pick<Pool,'query'>,manifestId:Id,snapshotId:Id):Promise<CaptureSnapshotResult | undefined> {
  const row = (await db.query<{snapshot:SourceSnapshot;dossier:SourceDossier}>(
    'SELECT s.snapshot,d.dossier FROM source_snapshots s JOIN source_dossiers d ON d.manifest_id = s.manifest_id ' +
    'WHERE s.snapshot_id = $1 AND s.manifest_id = $2 AND s.stream_id IS NULL',[snapshotId,manifestId],
  )).rows[0];
  return row && {ok:true,snapshot:SourceSnapshotSchema.parse(row.snapshot),dossier:SourceDossierSchema.parse(row.dossier)};
}
