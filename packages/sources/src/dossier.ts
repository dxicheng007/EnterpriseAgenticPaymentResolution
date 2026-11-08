import {
  BootstrapManifestSchema, IdSchema, SourceDossierSchema, SourceSnapshotSchema, canonicalJson, hashCanonical, hashEvent, hashManifest,
  type BootstrapManifest, type CaptureSnapshotResult, type Cursor, type Diagnostic, type EvidenceRef, type Hash, type Id, type ManifestStream,
  type RawSourceEvent, type SourceDossier, type SourceSnapshot,
} from '@eapr/contracts';
import type { Pool } from 'pg';
import { EvidenceStorageError, type Extraction } from '@eapr/evidence';
import { publishActivity } from '@eapr/storage/activity';
import { sqlState, withTransaction } from '@eapr/storage/transaction';
import { citeEvidence } from './evidence-records.js';
import { insertSourceRecord, validateSourceEvent, type PreparedSourceRecord, type SourceDefinition } from './records.js';
import { lockSource, type StoredSourceFile, type UploadDependencies } from './uploads.js';
import { SourceError } from './errors.js';

export async function readManifest(db: Pool, companyId: Id, manifestId?: Id): Promise<BootstrapManifest> {
  const rows = manifestId === undefined
    ? (await db.query<{manifest:BootstrapManifest}>(
      'SELECT manifest FROM source_manifests WHERE company_id = $1 ORDER BY epoch DESC LIMIT 1',[companyId],
    )).rows
    : (await db.query<{manifest:BootstrapManifest}>(
      'SELECT manifest FROM source_manifests WHERE company_id = $1 AND manifest_id = $2',[companyId,manifestId],
    )).rows;
  if (!rows[0]) throw new SourceError(404,'MANIFEST_NOT_FOUND','Manifest was not found');
  return BootstrapManifestSchema.parse(rows[0].manifest);
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
  event:RawSourceEvent; api_source_id:Id|null; api_original_hash:Hash|null; api_extraction:Extraction|null;
};

export function streamContentHash(sourceRef:Id,streamId:Id,resumeAfter:Cursor,events:readonly RawSourceEvent[]) {
  return hashCanonical({sourceRef,streamId,resumeAfter,events:events.map(({id,contentHash})=>({id,contentHash}))});
}

async function streamRecords(
  db:Pick<Pool,'query'>,sourceRef:Id,streamId:Id,resumeAfter:Cursor,
):Promise<StreamRecord[]> {
  return (await db.query<StreamRecord>(
    'SELECT event,api_source_id,api_original_hash,api_extraction FROM source_events ' +
    'WHERE source_ref = $1 AND stream_id = $2 AND sequence <= $3 ORDER BY sequence',
    [sourceRef,streamId,resumeAfter],
  )).rows;
}

function validateManifestStreams(manifest:BootstrapManifest,source:SourceDefinition) {
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

export async function readSnapshot(db:Pool, id:Id) {
  const row = (await db.query<{snapshot:SourceSnapshot}>(
    'SELECT snapshot FROM source_snapshots WHERE snapshot_id = $1',[id],
  )).rows[0];
  if (!row) throw new SourceError(404,'SNAPSHOT_NOT_FOUND','Source snapshot was not found');
  return SourceSnapshotSchema.parse(row.snapshot);
}

function issue(code:string,message:string,id:Id):Diagnostic {
  return {code,severity:'blocker',message,sourceIds:[id],fieldPaths:[]};
}

async function inspectBaseline(
  {db,store}:CaptureDependencies, manifest:BootstrapManifest, snapshotId:Id,
) {
  const diagnostics: Diagnostic[] = [];
  const missingMembers: Id[] = [];
  const citations: EvidenceRef[] = [];
  const files: StoredSourceFile[] = [];
  const eventIds: Id[] = [];
  function missing(id:Id) {
    missingMembers.push(id);
    diagnostics.push(issue('MANIFEST_MEMBER_MISSING','A pinned source member is missing',id));
  }
  function conflict(id:Id) {
    diagnostics.push(issue('SOURCE_HASH_CONFLICT','A pinned source member hash conflicts',id));
  }
  async function verifyBytes(id:Id,hash:Hash) {
    try {
      await store.get(hash);
      return true;
    } catch (error) {
      if (sqlState(error) === 'ENOENT') missing(id);
      else if (error instanceof EvidenceStorageError && error.code === 'SOURCE_HASH_CONFLICT') conflict(id);
      else throw new SourceError(503,'SOURCE_UNAVAILABLE','Original source byte storage is unavailable');
      return false;
    }
  }
  for (const member of manifest.files) {
    const row = (await db.query<StoredSourceFile>('SELECT * FROM source_files WHERE file_id = $1',[member.fileId])).rows[0];
    if (!row) {
      missing(member.fileId);
      continue;
    }
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
    if (await verifyBytes(member.fileId,member.sha256)) files.push(row);
  }
  for (const member of manifest.streams) {
    let pinned: SourceSnapshot;
    try {
      pinned = await readSnapshot(db,member.snapshotId);
    } catch (error) {
      if (!(error instanceof SourceError) || error.status !== 404) throw error;
      missing(member.snapshotId);
      continue;
    }
    if (pinned.manifestId !== manifest.id || pinned.sourceRef !== manifest.sourceRef) {
      diagnostics.push(issue('SOURCE_EPOCH_CONFLICT','Stream snapshot does not belong to the pinned epoch',member.snapshotId));
      continue;
    }
    const records = await streamRecords(db,manifest.sourceRef,member.streamId,member.resumeAfter);
    const events = records.map(row=>row.event);
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
    for (const row of records) {
      if (row.api_source_id && row.api_original_hash && row.api_extraction &&
          await verifyBytes(row.api_source_id,row.api_original_hash)) {
        citations.push(citeEvidence({snapshotId,sourceId:row.api_source_id,contentHash:row.api_original_hash,
          extraction:row.api_extraction,locator:{kind:'json',pointer:''}}));
      }
    }
  }
  return {diagnostics,missingMembers:[...new Set(missingMembers)].sort(),citations,eventIds:[...new Set(eventIds)].sort(),files};
}

async function loadManifestById(db:Pool,manifestId:Id) {
  const row = (await db.query<{manifest:BootstrapManifest}>(
    'SELECT manifest FROM source_manifests WHERE manifest_id = $1',[manifestId],
  )).rows[0];
  if (!row) throw new SourceError(404,'MANIFEST_NOT_FOUND','Manifest was not found');
  return BootstrapManifestSchema.parse(row.manifest);
}

function aggregateHash(manifest:BootstrapManifest,eventIds:Id[],evidenceIds:Id[]) {
  const compare = (a:string,b:string) => a < b ? -1 : a > b ? 1 : 0;
  return hashCanonical({
    manifestHash:manifest.hash,
    streams:manifest.streams.map(({streamId,snapshotId,snapshotHash})=>({streamId,snapshotId,snapshotHash}))
      .sort((a,b)=>compare(a.streamId,b.streamId)),
    files:manifest.files.map(({fileId,sha256})=>({fileId,sha256})).sort((a,b)=>compare(a.fileId,b.fileId)),
    eventIds:[...eventIds].sort(),evidenceIds:[...evidenceIds].sort(),
  });
}

function documentCitations(snapshotId:Id,files:readonly StoredSourceFile[]): EvidenceRef[] {
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

  const inspected = await inspectBaseline(dependencies,manifest,snapshotId);
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
