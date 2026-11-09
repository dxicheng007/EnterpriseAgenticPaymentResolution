import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  BootstrapManifestSchema, hashBytes, hashCanonical, hashEvent, hashManifest,
  type BootstrapManifest, type EvidenceRef, type ManifestFile, type RawSourceEvent, type SourceSnapshot,
} from '@eapr/contracts';
import { createEvidenceStore, type EvidenceStore } from '@eapr/evidence';
import * as sources from '@eapr/sources';
import { eventA } from '../../packages/sources/src/company-a.js';
import { encodeBatch, eventB } from '../../packages/sources/src/company-b.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

const {companyA,companyB,uploadSource,publishManifest,captureBaseline,streamContentHash,prepareApiRecord} = sources;
const catalog = new Map([[companyA.companyId,companyA],[companyB.companyId,companyB]]);
const now = '2026-10-01T00:00:00.000Z';
const date = '2026-10-01';
const namespace = testNamespace('capture');
let root:string;
let db:Pool;
let admin:Pool;
let runtime:Pool;
let store:EvidenceStore;
let a:Fixture;
let b:Fixture;
let provisioned = false;

type Fixture = {
  manifest:BootstrapManifest;
  snapshot:SourceSnapshot;
  events:RawSourceEvent[];
  email:ManifestFile;
  citationIds:string[];
};

function buildManifest(company:typeof companyA, events:RawSourceEvent[], files:ManifestFile[], epoch:number) {
  const id = 'manifest-' + company.companyId + '-' + epoch;
  const draft = {
    id, epoch, asOf:now, schemaVersions:Object.fromEntries(events.map(e=>[e.resource,e.schemaVersion])),
    semanticVersions:Object.fromEntries(events.filter(e=>e.rawIdentity.sellerEntityId && e.rawIdentity.sourceAccountId)
      .map(e=>[e.rawIdentity.sellerEntityId + '/' + e.rawIdentity.sourceAccountId,e.semanticVersion])), companyId:company.companyId, sourceRef:company.sourceRef, files,
    streams:company.streams.map(({streamId}) => {
      const members = events.filter(event=>event.streamId === streamId);
      const resumeAfter = String(members.length);
      return {streamId,resumeAfter,snapshotId:id + ':' + streamId,eventIds:members.map(event=>event.id),
        snapshotHash:streamContentHash(company.sourceRef,streamId,resumeAfter,members)};
    }),
  };
  return BootstrapManifestSchema.parse({...draft,hash:hashManifest(draft)});
}

function dependencies() {
  return {db,store,clock:()=>new Date(now)};
}

async function capture(company:typeof companyA, events:RawSourceEvent[]) {
  const deps = dependencies();
  const input = {companyId:company.companyId,sourceRef:company.sourceRef,documentId:'email',documentVersion:1,
    kind:'email_json' as const,originalName:'email.json'};
  const body = 'Identical original across companies';
  const emailBytes = Buffer.from(JSON.stringify({messageId:'m-1',body}));
  const uploaded = await uploadSource(deps,input,emailBytes);
  const email:ManifestFile = {fileId:uploaded.fileId,kind:input.kind,documentId:input.documentId,
    documentVersion:input.documentVersion,sha256:hashBytes(emailBytes)};
  const files = [email];
  const prepared = await Promise.all(events.filter(event=>event.streamId !== 'b-files').map(event=>
    prepareApiRecord(company,store,event,Buffer.from(JSON.stringify(event.payload)))));
  if (company === companyB) {
    const bytes = encodeBatch(events.filter(event=>event.streamId === 'b-files'));
    const batch = {streamId:'b-files',batchId:'b-batch',sequence:1};
    const result = await uploadSource(deps,{...input,kind:'event_csv',documentId:'batch',originalName:'batch.csv',batch},bytes);
    files.push({fileId:result.fileId,documentId:'batch',documentVersion:1,kind:'event_csv',
      sha256:hashBytes(bytes),...batch});
  }
  const manifest = buildManifest(company,events,files,1);
  await publishManifest(deps,catalog,manifest,prepared);
  const result = await captureBaseline(deps,manifest.id);
  if (!result.ok) throw new Error('Test fixture capture did not complete');
  const citationId = (sourceId:string, locator:EvidenceRef['locator']) =>
    'ev:' + hashCanonical({snapshotId:'snapshot:' + manifest.id,sourceId,locator});
  const citationIds = [
    citationId(email.fileId,{kind:'email',messageId:'m-1',start:0,end:body.length}),
    ...prepared.map(({event})=>citationId('api:' + hashCanonical({
      companyId:company.companyId,sourceRef:company.sourceRef,eventId:event.id,
    }),{kind:'json',pointer:''})),
  ];
  if (company === companyB) citationIds.push(citationId(files[1]!.fileId,{kind:'csv',row:1,column:'payload_json'}));
  return {manifest,events,email,citationIds:citationIds.sort(),snapshot:result.snapshot};
}

function aEvent(sequence:number, account:string, sellerEntityId = companyA.sellerEntityId) {
  const event = eventA({kind:'invoice',recordId:'invoice-a-' + sequence,sourceAccountId:account,
    effectiveDate:date,fields:{amount:'1.00',due_date:date}},sequence,now);
  const draft = {...event,rawIdentity:{...event.rawIdentity,sellerEntityId}};
  return {...draft,contentHash:hashEvent(draft)};
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(),'eapr-capture-read-'));
  await startNativeDb();
  const pair = await provisionTest(namespace);
  provisioned = true;
  await migrate(pair,migrationStreams,readMigrationCatalog());
  db = new Pool({connectionString:pair.control.appUrl});
  admin = new Pool({connectionString:pair.control.migrationUrl,statement_timeout:2000});
  runtime = new Pool({connectionString:pair.runtime.migrationUrl});
  store = await createEvidenceStore(root);
  const unknown = aEvent(4,'seller-unknown');
  const unscoped = {...unknown,rawIdentity:{companyId:companyA.companyId,sourceAccountId:'seller-unknown'}};
  a = await capture(companyA,[aEvent(1,'shared','seller-z'),aEvent(2,'shared'),aEvent(3,'shared'),
    {...unscoped,contentHash:hashEvent(unscoped)}]);
  b = await capture(companyB,[
    eventB({kind:'invoice',recordId:'b-invoice',sourceAccountId:'b-account',effectiveDate:date,
      fields:{amount_minor:100,due_on:date}},1,now),
    eventB({kind:'payment',recordId:'b-payment',sourceAccountId:'b-receipt',effectiveDate:date,
      fields:{amount_minor:100}},1,now),
  ]);
});

afterAll(async () => {
  await Promise.all([db?.end(),admin?.end(),runtime?.end()]);
  if (provisioned) await dropTest(namespace);
  if (root) await rm(root,{recursive:true,force:true});
});

async function persisted(pool:Pool) {
  const tables = (await pool.query<{tablename:string}>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )).rows;
  const schema = (await pool.query(
    "SELECT * FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
  )).rows;
  const contents = await Promise.all(tables.map(async ({tablename})=>{
    if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error('Unexpected test table name');
    return (await pool.query('SELECT row_to_json(t)::text AS row FROM ' + tablename + ' t ORDER BY 1')).rows;
  }));
  return hashCanonical({tables,schema,contents});
}

async function state() {
  return Promise.all([persisted(admin),persisted(runtime)]);
}

function read(fixture:Fixture, evidence:Pick<EvidenceStore,'get'> = store) {
  return sources.readDiscoveryCapture({db,store:{get:evidence.get}},catalog,{
    companyId:fixture.manifest.companyId,manifestId:fixture.manifest.id,
  });
}

function expected(fixture:Fixture, pairs:[string,string][]) {
  return {
    binding:{companyId:fixture.manifest.companyId,sourceRef:fixture.manifest.sourceRef,
      manifestId:fixture.manifest.id,manifestHash:fixture.manifest.hash,
      snapshotId:fixture.snapshot.id,snapshotHash:fixture.snapshot.contentHash},
    sourceAccounts:pairs.map(([sellerEntityId,sourceAccountId])=>({kind:'source_account',sellerEntityId,sourceAccountId})),
    evidenceIds:fixture.citationIds,
  };
}

it('reads both complete captures and returns only exact pinned account tuples and citations', async () => {
  const before = await state();
  expect(await read(a)).toEqual(expected(a,[['seller-a','shared'],['seller-z','shared']]));
  expect(await state()).toEqual(before);
  expect(await read(b)).toEqual(expected(b,[['seller-b','b-account'],['seller-b','b-receipt']]));
  expect(await state()).toEqual(before);
  expect(await read(a)).toEqual(expected(a,[['seller-a','shared'],['seller-z','shared']]));
  expect(await state()).toEqual(before);
});

async function rejectsWithoutWrites(operation:()=>Promise<unknown>, status:number, code:string) {
  const before = await state();
  const result = operation();
  await expect(result).rejects.toBeInstanceOf(sources.SourceError);
  await expect(result).rejects.toMatchObject({status,code,diagnostics:expect.any(Array)});
  expect(await state()).toEqual(before);
}

async function corrupt(
  table:string, key:string, id:string, change:string, restore:string,
  fixture:Fixture, code = 'SOURCE_HASH_CONFLICT', status = 409,
) {
  const where = ' WHERE ' + key + ' = $1';
  const original = (await admin.query<{row:string}>(
    'SELECT row_to_json(t)::text AS row FROM ' + table + ' t' + where,[id],
  )).rows[0]!.row;
  try {
    const result = await admin.query(change + where,[id]);
    expect(result.rowCount).toBe(1);
    await rejectsWithoutWrites(()=>read(fixture),status,code);
  } finally {
    await admin.query(restore,[original]);
  }
}

const missing = 'MANIFEST_MEMBER_MISSING';
const epochConflict = 'SOURCE_EPOCH_CONFLICT';
const hashConflict = 'SOURCE_HASH_CONFLICT';

it('rejects missing or inconsistent dossier and aggregate rows', async () => {
  const manifestId = a.manifest.id;
  const snapshotId = a.snapshot.id;
  for (const [change,code] of [
    ["dossier = dossier || '{\"complete\":false}'",missing],
    ["dossier = dossier || '{\"missingMembers\":[\"missing-id\"]}'",missing],
    ["dossier = dossier || '{\"snapshotIds\":[]}'",epochConflict],
    ["dossier = dossier || '{\"evidenceIds\":[]}'",hashConflict],
  ]) {
    await corrupt('source_dossiers','manifest_id',manifestId,'UPDATE source_dossiers SET ' + change,
      'UPDATE source_dossiers SET dossier = r.dossier FROM jsonb_populate_record(NULL::source_dossiers,$1) r ' +
      'WHERE source_dossiers.manifest_id = r.manifest_id',a,code);
  }
  await corrupt('source_dossiers','manifest_id',manifestId,'DELETE FROM source_dossiers',
    'INSERT INTO source_dossiers SELECT * FROM jsonb_populate_record(NULL::source_dossiers,$1)',a,missing);
  await corrupt('source_snapshots','snapshot_id',snapshotId,'DELETE FROM source_snapshots',
    'INSERT INTO source_snapshots SELECT * FROM jsonb_populate_record(NULL::source_snapshots,$1)',a,'SNAPSHOT_NOT_FOUND',404);
  await corrupt('source_snapshots','snapshot_id',snapshotId,"UPDATE source_snapshots SET stream_id = 'other'",
    'UPDATE source_snapshots SET stream_id = r.stream_id FROM jsonb_populate_record(NULL::source_snapshots,$1) r ' +
    'WHERE source_snapshots.snapshot_id = r.snapshot_id',a,epochConflict);
});

it('rejects incomplete pinned captures even when the dossier says complete', async () => {
  await corrupt('source_snapshots','snapshot_id',a.manifest.streams[0]!.snapshotId,'DELETE FROM source_snapshots',
    'INSERT INTO source_snapshots SELECT * FROM jsonb_populate_record(NULL::source_snapshots,$1)',a,missing);
  await corrupt('source_events','event_id',b.events[0]!.id,'DELETE FROM source_events',
    'INSERT INTO source_events SELECT * FROM jsonb_populate_record(NULL::source_events,$1)',b,missing);
  await corrupt('source_evidence','evidence_id',a.citationIds[0]!,'DELETE FROM source_evidence',
    'INSERT INTO source_evidence SELECT * FROM jsonb_populate_record(NULL::source_evidence,$1)',a,missing);

  // Remove one document citation and its original metadata while preserving the completed dossier.
  const document = (await admin.query<{id:string;row:string}>(
    'SELECT evidence_id AS id,row_to_json(e)::text AS row FROM source_evidence e WHERE file_id=$1',[a.email.fileId],
  )).rows[0]!;
  await admin.query('DELETE FROM source_evidence WHERE evidence_id=$1',[document.id]);
  try {
    await corrupt('source_files','file_id',a.email.fileId,'DELETE FROM source_files',
      'INSERT INTO source_files SELECT * FROM jsonb_populate_record(NULL::source_files,$1)',a,missing);
  } finally {
    await admin.query('INSERT INTO source_evidence SELECT * FROM jsonb_populate_record(NULL::source_evidence,$1)',[document.row]);
  }
});

it('rejects hash, identity, and membership corruption in pinned rows', async () => {
  const cases = [
    ['source_manifests','manifest_id',a.manifest.id,'manifest',"manifest || jsonb_build_object('hash',repeat('0',64))",hashConflict],
    ['source_manifests','manifest_id',a.manifest.id,'epoch','2',epochConflict],
    ['source_manifests','manifest_id',a.manifest.id,'manifest',"manifest || '{\"id\":\"wrong-manifest\"}'",epochConflict],
    ['source_manifests','manifest_id',a.manifest.id,'manifest',"'{}'",hashConflict],
    ['source_snapshots','snapshot_id',a.manifest.streams[0]!.snapshotId,'snapshot',
      "snapshot || jsonb_build_object('contentHash',repeat('0',64))",hashConflict],
    ['source_snapshots','snapshot_id',a.manifest.streams[0]!.snapshotId,'snapshot',
      "snapshot || '{\"eventIds\":[\"unknown-member\"]}'",hashConflict],
    ['source_events','event_id',a.events[0]!.id,'event',"jsonb_set(event,'{payload,amount}','\"2.00\"')",hashConflict],
    ['source_events','event_id',a.events[0]!.id,'event',"event || '{\"streamId\":\"wrong-stream\"}'",epochConflict],
    ['source_events','event_id',a.events[0]!.id,'content_hash',"repeat('0',64)",hashConflict],
    ['source_events','event_id',a.events[0]!.id,'api_byte_length','api_byte_length + 1',hashConflict],
    ['source_events','event_id',a.events[0]!.id,'api_extraction',
      "jsonb_set(api_extraction,'{document,value,amount}','\"2.00\"')",hashConflict],
    ['source_snapshots','snapshot_id',a.snapshot.id,'snapshot',"snapshot || '{\"eventIds\":[]}'",hashConflict],
    ['source_snapshots','snapshot_id',a.snapshot.id,'snapshot',
      "snapshot || jsonb_build_object('eventIds',(snapshot->'eventIds') || (snapshot->'eventIds'))",hashConflict],
    ['source_snapshots','snapshot_id',a.snapshot.id,'snapshot',
      "snapshot || jsonb_build_object('evidenceIds',(snapshot->'evidenceIds') || '\"foreign-id\"'::jsonb)",hashConflict],
    ['source_snapshots','snapshot_id',a.snapshot.id,'snapshot',
      "snapshot || jsonb_build_object('contentHash',repeat('0',64))",hashConflict],
    ['source_files','file_id',a.email.fileId,'extraction_hash',"repeat('0',64)",hashConflict],
    ['source_files','file_id',a.email.fileId,'byte_length','byte_length + 1',hashConflict],
  ];
  for (const [table,key,id,column,expression,code] of cases) {
    await corrupt(table,key,id,'UPDATE ' + table + ' SET ' + column + ' = ' + expression,
      'UPDATE ' + table + ' SET ' + column + ' = r.' + column +
      ' FROM jsonb_populate_record(NULL::' + table + ',$1) r WHERE ' + table + '.' + key + ' = r.' + key,a,code);
  }
});

it('requires complete canonical citation rows including source and epoch associations', async () => {
  const id = (await admin.query<{id:string}>(
    'SELECT evidence_id AS id FROM source_evidence WHERE file_id=$1',[a.email.fileId],
  )).rows[0]!.id;
  const cases = [
    ['evidence',"jsonb_set(evidence,'{locator,end}','2')",hashConflict],
    ['evidence',"evidence || '{\"excerpt\":\"other excerpt\"}'",hashConflict],
    ['evidence',"evidence || jsonb_build_object('sha256',repeat('0',64))",hashConflict],
    ['evidence',"evidence || '{\"id\":\"other-id\"}'",hashConflict],
    ['evidence',"evidence || '{\"sourceId\":\"other-source\"}'",hashConflict],
    ['file_id',"(SELECT file_id FROM source_files WHERE source_ref = 'legacy-b' AND document_id = 'email')",epochConflict],
    ['snapshot_id',"(SELECT snapshot_id FROM source_snapshots WHERE stream_id IS NULL AND manifest_id = 'manifest-company-b-1')",epochConflict],
  ];
  expect(a.email.sha256).toBe(b.email.sha256);
  for (const [column,expression,code] of cases) {
    await corrupt('source_evidence','evidence_id',id,'UPDATE source_evidence SET ' + column + ' = ' + expression,
      'UPDATE source_evidence SET ' + column + ' = r.' + column +
      ' FROM jsonb_populate_record(NULL::source_evidence,$1) r WHERE source_evidence.evidence_id = r.evidence_id',a,code);
  }

  const extraId = 'unexpected-citation';
  await admin.query(
    'INSERT INTO source_evidence (evidence_id,snapshot_id,file_id,evidence) ' +
    "SELECT $2,snapshot_id,file_id,evidence || jsonb_build_object('id',$2::text) FROM source_evidence WHERE evidence_id=$1",
    [id,extraId],
  );
  try {
    await rejectsWithoutWrites(()=>read(a),409,hashConflict);
  } finally {
    await admin.query('DELETE FROM source_evidence WHERE evidence_id=$1',[extraId]);
  }
});

it('fails closed for unavailable or corrupt original bytes', async () => {
  const file = join(root,a.email.sha256);
  const bytes = await store.get(a.email.sha256);
  await unlink(file);
  try {
    await rejectsWithoutWrites(()=>read(a),409,missing);
    await writeFile(file,'other bytes');
    await rejectsWithoutWrites(()=>read(a),409,hashConflict);
  } finally {
    await unlink(file).catch((error:NodeJS.ErrnoException)=>{if (error.code !== 'ENOENT') throw error;});
    await store.put(bytes);
  }
  await rejectsWithoutWrites(()=>read(a,{get:async()=>{throw new Error('private/test/path');}}),503,'SOURCE_UNAVAILABLE');
});

it('keeps a selected capture pinned across later publication while outside database locks', async () => {
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const operation = read(a,{get:async hash=>{
    reached.resolve();
    await resume.promise;
    return store.get(hash);
  }});
  const next = aEvent(5,'later-account');
  const manifest = buildManifest(companyA,[...a.events,next],a.manifest.files,2);
  let afterPublication:Awaited<ReturnType<typeof state>>;
  try {
    await Promise.race([reached.promise,operation.then(()=>{throw new Error('Expected an original read');})]);
    expect(db.idleCount).toBe(db.totalCount);
    const prepared = await prepareApiRecord(companyA,store,next,Buffer.from(JSON.stringify(next.payload)));
    await publishManifest(dependencies(),catalog,manifest,[prepared]);
    afterPublication = await state();
  } finally {
    resume.resolve();
  }
  expect(await operation).toEqual(expected(a,[['seller-a','shared'],['seller-z','shared']]));
  expect(await state()).toEqual(afterPublication);
  await rejectsWithoutWrites(()=>read({...a,manifest}),409,missing);

  const nextCapture = await captureBaseline(dependencies(),manifest.id);
  if (!nextCapture.ok) throw new Error('Later test fixture did not complete');
  const id = (await admin.query<{id:string}>(
    'SELECT evidence_id AS id FROM source_evidence WHERE file_id=$1 AND snapshot_id=$2',[a.email.fileId,a.snapshot.id],
  )).rows[0]!.id;
  await corrupt('source_evidence','evidence_id',id,
    "UPDATE source_evidence SET snapshot_id = 'snapshot:manifest-company-a-2'",
    'UPDATE source_evidence SET snapshot_id = r.snapshot_id FROM jsonb_populate_record(NULL::source_evidence,$1) r ' +
    'WHERE source_evidence.evidence_id = r.evidence_id',a,epochConflict);
});

it('rechecks dossier completion after external reads', async () => {
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const operation = read(b,{get:async hash=>{
    reached.resolve();
    await resume.promise;
    return store.get(hash);
  }});
  const assertion = expect(operation).rejects.toMatchObject({status:409,code:missing});
  try {
    await Promise.race([reached.promise,operation.then(()=>{throw new Error('Expected an original read');})]);
    expect(db.idleCount).toBe(db.totalCount);
    await admin.query("UPDATE source_dossiers SET dossier = dossier || '{\"complete\":false}' WHERE manifest_id=$1",[b.manifest.id]);
    const changed = await state();
    resume.resolve();
    await assertion;
    expect(await state()).toEqual(changed);
  } finally {
    resume.resolve();
    await admin.query("UPDATE source_dossiers SET dossier = dossier || '{\"complete\":true}' WHERE manifest_id=$1",[b.manifest.id]);
  }
});

it('uses safe errors for malformed, unavailable, unknown, and mixed company selectors', async () => {
  const request = (companyId:string,manifestId:string, pool = db) =>
    sources.readDiscoveryCapture({db:pool,store},catalog,{companyId,manifestId});
  await rejectsWithoutWrites(()=>request('company-a','../private/test/path'),400,'SOURCE_CONTENT_INVALID');
  await rejectsWithoutWrites(()=>request('unknown-company',a.manifest.id),404,'SOURCE_NOT_FOUND');
  await rejectsWithoutWrites(()=>request(companyB.companyId,a.manifest.id),404,'MANIFEST_NOT_FOUND');
  await rejectsWithoutWrites(()=>request(companyA.companyId,a.manifest.streams[0]!.snapshotId),404,'MANIFEST_NOT_FOUND');
  const unavailable = new Pool();
  await unavailable.end();
  await rejectsWithoutWrites(()=>request(companyA.companyId,a.manifest.id,unavailable),503,'SOURCE_UNAVAILABLE');
  for (const operation of [
    ()=>request(companyA.companyId,'../private/test/path'),
    ()=>request(companyA.companyId,a.manifest.id,unavailable),
    ()=>read(a,{get:async()=>{throw new Error('private/test/path');}}),
  ]) {
    await expect(operation()).rejects.toMatchObject({
      message:expect.not.stringContaining('private/test/path'),diagnostics:[],
    });
  }
});

it('rejects a validly hashed event using an unregistered resource', async () => {
  const event = a.events[0]!;
  const stream = a.manifest.streams.find(member=>member.streamId === event.streamId)!;
  const changed = {...event,resource:'unsupported-resource'};
  const forgedEvent = {...changed,contentHash:hashEvent(changed)};
  const forgedStream = {...stream,snapshotHash:streamContentHash(a.manifest.sourceRef,stream.streamId,
    stream.resumeAfter,[forgedEvent,...a.events.slice(1)])};
  const manifestDraft = {...a.manifest,streams:a.manifest.streams.map(member=>
    member.streamId === stream.streamId ? forgedStream : member)};
  const manifest = {...manifestDraft,hash:hashManifest(manifestDraft)};
  const hash = hashCanonical({
    manifestHash:manifest.hash,
    streams:manifest.streams.map(({streamId,snapshotId,snapshotHash})=>({streamId,snapshotId,snapshotHash})),
    files:manifest.files.map(({fileId,sha256})=>({fileId,sha256})),
    eventIds:a.snapshot.eventIds,evidenceIds:a.snapshot.evidenceIds,
  });
  const setProof = async (selected:BootstrapManifest, record:RawSourceEvent, streamHash:string, snapshotHash:string) => {
    await admin.query('UPDATE source_events SET event=$2,content_hash=$3 WHERE event_id=$1',
      [record.id,JSON.stringify(record),record.contentHash]);
    await admin.query('UPDATE source_manifests SET manifest=$2 WHERE manifest_id=$1',[selected.id,JSON.stringify(selected)]);
    await admin.query("UPDATE source_snapshots SET snapshot=jsonb_set(snapshot,'{contentHash}',to_jsonb($2::text)) WHERE snapshot_id=$1",
      [stream.snapshotId,streamHash]);
    await admin.query('UPDATE source_snapshots SET snapshot=$2 WHERE snapshot_id=$1',
      [a.snapshot.id,JSON.stringify({...a.snapshot,contentHash:snapshotHash})]);
  };
  try {
    await setProof(manifest,forgedEvent,forgedStream.snapshotHash,hash);
    await rejectsWithoutWrites(()=>read(a),422,'SOURCE_CONTENT_INVALID');
  } finally {
    await setProof(a.manifest,event,stream.snapshotHash,a.snapshot.contentHash);
  }
});

it('rejects rehashed watermark corruption that disagrees with its pinned membership', async () => {
  const manifest = {...b.manifest,streams:b.manifest.streams.map(member=>member.streamId === 'b-files'
    ? {...member,resumeAfter:'0'} : member)};
  const setManifest = (value:BootstrapManifest) => admin.query(
    'UPDATE source_manifests SET manifest=$2 WHERE manifest_id=$1',[value.id,JSON.stringify(value)],
  );
  try {
    await setManifest({...manifest,hash:hashManifest(manifest)});
    await rejectsWithoutWrites(()=>read(b),409,hashConflict);
  } finally {
    await setManifest(b.manifest);
  }
});

it('rejects missing API original metadata even after the stored citation is removed', async () => {
  const event = a.events[0]!;
  const id = 'api:' + hashCanonical({companyId:a.manifest.companyId,sourceRef:a.manifest.sourceRef,eventId:event.id});
  const result = await admin.query<{row:string}>(
    'DELETE FROM source_evidence WHERE api_source_id=$1 RETURNING row_to_json(source_evidence)::text AS row',
    [id],
  );
  expect(result.rowCount).toBeGreaterThan(0);
  try {
    await corrupt('source_events','event_id',event.id,
      'UPDATE source_events SET api_source_id=NULL,api_original_hash=NULL,api_byte_length=NULL,api_extraction=NULL',
      'UPDATE source_events SET api_source_id=r.api_source_id,api_original_hash=r.api_original_hash,' +
      'api_byte_length=r.api_byte_length,api_extraction=r.api_extraction ' +
      'FROM jsonb_populate_record(NULL::source_events,$1) r WHERE source_events.event_id=r.event_id',a,missing);
  } finally {
    for (const {row} of result.rows) {
      await admin.query('INSERT INTO source_evidence SELECT * FROM jsonb_populate_record(NULL::source_evidence,$1)',[row]);
    }
  }
});
