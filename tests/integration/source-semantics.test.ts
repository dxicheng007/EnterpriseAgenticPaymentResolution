import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  ApiErrorSchema, BootstrapManifestSchema, SemanticPreflightSchema, canonicalJson, hashBytes, hashEvent, hashManifest,
  type BootstrapManifest, type ManifestFile, type RawSourceEvent, type SemanticVersionMap,
} from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import {
  companyA, companyB, createSourceService, prepareApiRecord, publishBaseline, readDossier, streamContentHash, SourceError, lockSource,
  type SourceDefinition, type UploadDependencies,
} from '@eapr/sources';
import { withTransaction } from '@eapr/storage/transaction';
import { composeSourceSemantics } from '../../apps/control/src/source-semantics-composition.js';
import { createLocalSessionService, LocalSessionError } from '../../apps/control/src/local-session.js';
import { createSourcePlugin } from '../../apps/control/src/routes/sources.js';
import { buildControl, createWorkerClient } from '../../apps/control/src/server.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import { insertSourceRecord, validateSourceEvent } from '../../packages/sources/src/records.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

const asOf = '2026-10-01T00:00:00.000Z';
const sourceToken = 'separate-source-capability';
const operatorToken = 'separate-operator-capability';
const workerToken = 'separate-health-capability';
const allowedUnknown = 'unregistered-but-allowed';
const account = 'shared-account';
const aKey = 'seller-a/' + account;
const bKey = 'seller-b/' + account;
const controlOrigin = 'http://127.0.0.1:' + localPort('EAPR_CONTROL_PORT',3001);
const webOrigin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT',5173);
let namespace:string;
const synthetic:SourceDefinition = {
  companyId:'company-independent',sourceRef:'legacy-independent',sellerEntityId:'seller-a',
  contracts:['first','second'].map(resource=>({
    ...companyA.contracts.find(contract=>contract.kind === 'semantic_change')!,resource,
  })),
  streams:['first','second'].map(streamId=>({
    ...companyA.streams[1]!,streamId,resources:[streamId],
  })),
};
const foreign = {...companyA,companyId:'company-foreign',sourceRef:'foreign-source'};
const catalog = new Map([companyA,companyB,synthetic,foreign].map(source=>[source.companyId,source]));
const allowed = [companyA.sourceRef,companyB.sourceRef,synthetic.sourceRef,allowedUnknown];
const capability = {token:sourceToken,sourceRefs:allowed};

let dependencies:UploadDependencies;
let admin:Pool;
let runtimeAdmin:Pool;
let runtime:Pool;
let control:FastifyInstance;
let worker:FastifyInstance;
let semantics:ReturnType<typeof composeSourceSemantics>;
let operator:ReturnType<typeof createScenarioAdmin>;
let root:string;
let provisioned = false;
let sourcePoolEnded = false;
let checkedAt = new Date(asOf);
let clockReads = 0;

beforeEach(async ()=>{
  namespace = testNamespace('semantics');
  checkedAt = new Date(asOf);
  clockReads = 0;
  sourcePoolEnded = false;
  await startNativeDb();
  const pair = await provisionTest(namespace);
  provisioned = true;
  const migrations = readMigrationCatalog();
  await migrate(pair,migrationStreams,migrations);
  admin = new Pool({connectionString:pair.control.migrationUrl});
  runtimeAdmin = new Pool({connectionString:pair.runtime.migrationUrl});
  runtime = new Pool({connectionString:pair.runtime.appUrl});
  root = await mkdtemp(join(tmpdir(),'eapr-source-semantics-'));
  dependencies = {
    db:new Pool({connectionString:pair.control.appUrl}),
    clock:()=>{clockReads++;return checkedAt;},
    store:await createEvidenceStore(root),
  };
  operator = createScenarioAdmin(dependencies,{DEMO_OPERATOR_ENABLED:'true',DEMO_OPERATOR_TOKEN:operatorToken});
  semantics = composeSourceSemantics(dependencies,{catalog,capability});
  const session = createLocalSessionService({webOrigin,reviewerId:'reviewer',allowedSourceRefs:allowed,allowedAccountIds:[]});
  const upload = createSourcePlugin({catalog,store:dependencies.store,authorizeSource:async (request,scope)=>{
    try {
      await session.authorizeReviewer(request,{mutation:scope.operation === 'upload'});
    } catch (error) {
      if (error instanceof LocalSessionError) throw new SourceError(error.statusCode,error.code,error.message);
      throw error;
    }
  }});
  const workerPort = localPort('EAPR_WORKER_PORT',3002);
  worker = await launchWorker({
    db:runtime,clock:dependencies.clock,serviceToken:workerToken,
    expectedMigrations:migrationIdentities(migrations.runtime),
  },workerPort);
  control = buildControl({
    ...dependencies,workerClient:createWorkerClient('http://127.0.0.1:' + workerPort,workerToken),
    expectedMigrations:migrationIdentities(migrations.control),featurePlugins:[semantics.plugin,session.plugin,upload],
  });
  await control.listen({host:'127.0.0.1',port:localPort('EAPR_CONTROL_PORT',3001)});
});

afterEach(async ()=>{
  await Promise.all([control?.close(),worker?.close()]);
  await Promise.all([sourcePoolEnded ? undefined : dependencies?.db.end(),runtime?.end(),admin?.end(),runtimeAdmin?.end()]);
  if (provisioned) {
    await dropTest(namespace);
    provisioned = false;
  }
  if (root) await rm(root,{recursive:true,force:true});
});

function manifest(
  source:SourceDefinition,epoch:number,versions:SemanticVersionMap,
  events:readonly RawSourceEvent[] = [],files:ManifestFile[] = [],
):BootstrapManifest {
  const id = source.sourceRef + ':epoch:' + epoch;
  const input = {
    id,sourceRef:source.sourceRef,companyId:source.companyId,epoch,asOf,semanticVersions:versions,files,
    schemaVersions:Object.fromEntries(source.contracts.map(contract=>[contract.resource,contract.schemaVersion])),
    streams:source.streams.map(({streamId})=>{
      const members = events.filter(event=>event.streamId === streamId);
      const resumeAfter = String(members.at(-1)?.sequence ?? 0);
      return {streamId,resumeAfter,snapshotId:id + ':' + streamId,eventIds:members.map(event=>event.id),
        snapshotHash:streamContentHash(source.sourceRef,streamId,resumeAfter,members)};
    }),
  };
  return BootstrapManifestSchema.parse({...input,hash:hashManifest(input)});
}

function scenario(id:string, revision:string) {
  return {id,accountId:account,effectiveDate:'2026-10-01',observedAt:asOf,revision};
}

function route(sourceRef:string) {
  return '/internal/sources/' + sourceRef + '/semantics';
}

function get(sourceRef:string,headers:Record<string,string> = {Authorization:'Bearer ' + sourceToken},suffix = '') {
  return fetch(controlOrigin + route(sourceRef) + suffix,{headers,signal:AbortSignal.timeout(8000)});
}

async function observe(sourceRef:string) {
  const response = await get(sourceRef);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.status).toBe(200);
  return SemanticPreflightSchema.parse(await response.json());
}

async function errorResponse(response:Response,status:number,code:string) {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.status).toBe(status);
  const payload = ApiErrorSchema.parse(await response.json());
  expect(payload).toMatchObject({code,diagnostics:[]});
  expect(JSON.stringify(payload)).not.toMatch(/postgres|SELECT|secret-marker|separate-.*-capability/i);
  return payload;
}

async function databaseState(db:Pool) {
  const tables = (await db.query<{tablename:string}>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )).rows;
  return Promise.all(tables.map(async ({tablename})=>{
    if (!/^[a-z0-9_]+$/.test(tablename)) throw new Error('Unexpected test table name');
    const rows = (await db.query('SELECT to_jsonb(t) AS row FROM public."' + tablename + '" t ORDER BY 1')).rows;
    return [tablename,rows];
  }));
}

async function rawBodyRequest() {
  return new Promise<{status:number|undefined;cache:string|undefined;body:unknown}>((resolve,reject)=>{
    const body = '{"sourceRef":"legacy-b"}';
    const req = request(controlOrigin + route(companyA.sourceRef),{
      method:'GET',headers:{
        authorization:'Bearer ' + sourceToken,'content-type':'application/json','content-length':String(body.length),
      },
    },res=>{
      let data = '';
      res.setEncoding('utf8').on('data',part=>{data += part;});
      res.on('end',()=>resolve({status:res.statusCode,cache:res.headers['cache-control'],body:JSON.parse(data)}));
      res.on('error',reject);
    });
    req.on('error',reject).end(body);
  });
}

async function waitForLock(type:'advisory'|'relation',relation?:string) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const result = await admin.query(
      "SELECT 1 FROM pg_locks WHERE locktype = $1 AND NOT granted AND database = " +
      "(SELECT oid FROM pg_database WHERE datname = current_database()) " +
      "AND ($2::text IS NULL OR relation = to_regclass($2))",[type,relation ?? null],
    );
    if (result.rowCount) return;
  }
  throw new Error('Did not observe blocked ' + type + ' lock' + (relation ? ' on ' + relation : ''));
}

async function barrier(table:'source_manifests'|'source_snapshots'|'activity_counter',run:()=>Promise<void>) {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE ' + table + ' IN ACCESS EXCLUSIVE MODE');
    await run();
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function insertFixture(source:SourceDefinition,event:RawSourceEvent) {
  const original = await prepareApiRecord(source,dependencies.store,event,Buffer.from(canonicalJson(event.payload)));
  await withTransaction(dependencies.db,async client=>{
    await lockSource(client,source.sourceRef);
    await insertSourceRecord(client,{...original,event:validateSourceEvent(source,event)});
  });
}

it('uses the latest numeric epoch, ignores the watermark event, and folds numeric sequence through 10',async ()=>{
  await errorResponse(await get(companyA.sourceRef),503,'SOURCE_SEMANTICS_UNAVAILABLE');
  const older = manifest(companyA,2,{[aKey]:'old-complete'});
  await publishBaseline(dependencies,companyA,older,[]);
  const source = createSourceService(dependencies,catalog);
  expect((await source.captureSnapshot(older.id)).ok).toBe(true);
  const [first] = await operator.semanticChangeA(operatorToken,scenario('numeric-1','early'));
  const [watermark] = await operator.semanticChangeA(operatorToken,scenario('numeric-2','at-watermark'));
  const missingFile = {
    fileId:'missing-proof',documentId:'missing-document',documentVersion:1,
    kind:'contract_pdf' as const,sha256:hashBytes(Buffer.from('missing')),
  };
  const latest = manifest(companyA,10,{[aKey]:'new-baseline','seller-a/unrelated':'unchanged'},[first!,watermark!],[missingFile]);
  await publishBaseline(dependencies,companyA,latest,[]);
  expect(await source.captureSnapshot(latest.id)).toMatchObject({ok:false,dossier:{complete:false}});
  expect(await readDossier(dependencies.db,companyA.companyId)).toMatchObject({manifestId:latest.id,complete:false});
  const initial = await observe(companyA.sourceRef);
  const initialDirect = await semantics.readCurrentSemantics(companyA.sourceRef);
  expect(initialDirect).toEqual(initial);
  expect(initial).toEqual({sourceRef:companyA.sourceRef,checkedAt:asOf,versions:latest.semanticVersions});
  expect(await source.readCurrentSemantics(companyA.sourceRef)).toEqual(initial);

  for (let sequence=3;sequence<=10;sequence++) {
    const [event] = await operator.semanticChangeA(operatorToken,scenario('numeric-' + sequence,
      sequence === 10 ? 'a-opaque-revision' : 'z-opaque-revision'));
    expect(event?.sequence).toBe(sequence);
  }
  const [financial] = await operator.freshInvoiceA(operatorToken,{
    ...scenario('ordinary','unused'),amount:'5.00',dueDate:'2026-10-31',semanticVersion:'financial-only',
  });
  expect(financial?.semanticVersion).toBe('financial-only');
  checkedAt = new Date('2026-10-02T00:00:00.000Z');
  const count = clockReads;
  const direct = await semantics.readCurrentSemantics(companyA.sourceRef);
  expect(direct).toEqual({
    sourceRef:companyA.sourceRef,checkedAt:checkedAt.toISOString(),
    versions:{[aKey]:'a-opaque-revision','seller-a/unrelated':'unchanged'},
  });
  expect(clockReads).toBe(count + 1);
  checkedAt = new Date('2026-10-03T00:00:00.000Z');
  expect(await observe(companyA.sourceRef)).toEqual({...direct,checkedAt:checkedAt.toISOString()});
  expect(clockReads).toBe(count + 2);
  expect(initial.versions).toEqual(latest.semanticVersions);
  expect(initialDirect.versions).toEqual(latest.semanticVersions);
});

it('uses a private allowlist and rejects query, body, alternate paths and mutation authority without writes',async ()=>{
  await publishBaseline(dependencies,companyA,manifest(companyA,2,{[aKey]:'baseline'}),[]);
  const before = await Promise.all([databaseState(admin),databaseState(runtimeAdmin)]);
  const startClockReads = clockReads;
  const session = await fetch(controlOrigin + '/api/local-session',{
    method:'POST',headers:{origin:webOrigin,'x-eapr-local-ui':'1','content-type':'application/json'},body:'{}',
  });
  expect(session.status).toBe(200);
  const cookie = session.headers.get('set-cookie')!.split(';')[0]!;
  const {csrfToken} = await session.json() as {csrfToken:string};
  for (const headers of [
    {},{Authorization:'Bearer ' + 'x'.repeat(sourceToken.length)},{cookie,'x-eapr-csrf':csrfToken},
    {Authorization:'Bearer ' + operatorToken},{Authorization:'Bearer ' + workerToken},
  ] as Record<string,string>[]) {
    await errorResponse(await get(companyA.sourceRef,headers),403,'SOURCE_FORBIDDEN');
  }
  await errorResponse(await get(foreign.sourceRef),403,'SOURCE_FORBIDDEN');
  await errorResponse(await get(foreign.sourceRef,undefined,'?sourceRef=legacy-a'),403,'SOURCE_FORBIDDEN');
  await errorResponse(await get('foreign-unknown'),403,'SOURCE_FORBIDDEN');
  await errorResponse(await get(allowedUnknown),404,'SOURCE_NOT_FOUND');
  await expect(semantics.readCurrentSemantics('foreign-source')).rejects.toMatchObject({code:'SOURCE_FORBIDDEN'});
  await errorResponse(await get('https%3A%2F%2Fexample.com'),400,'SOURCE_METADATA_INVALID');
  await errorResponse(await get(companyA.sourceRef,undefined,'?sourceRef=legacy-b'),400,'SOURCE_METADATA_INVALID');
  await errorResponse(await get(companyA.sourceRef,undefined,'?__proto__=legacy-b'),400,'SOURCE_METADATA_INVALID');
  const body = await rawBodyRequest();
  expect(body).toMatchObject({status:400,cache:'no-store'});
  expect(ApiErrorSchema.parse(body.body).code).toBe('SOURCE_METADATA_INVALID');
  expect((await get(companyA.sourceRef,undefined,'/alternate')).status).toBe(404);
  expect((await fetch(controlOrigin + route(companyA.sourceRef),{method:'HEAD'})).status).toBe(404);
  const form = new FormData();
  form.set('metadata',JSON.stringify({
    sourceRef:companyA.sourceRef,companyId:companyA.companyId,documentId:'forbidden-document',
    documentVersion:1,kind:'contract_pdf',originalName:'forbidden.pdf',
  }));
  form.set('file',new Blob(['forbidden'],{type:'application/octet-stream'}),'forbidden.pdf');
  const upload = await fetch(controlOrigin + '/api/sources/uploads',{
    method:'POST',headers:{authorization:'Bearer ' + sourceToken},body:form,
  });
  expect(upload.status).toBe(403);
  expect(()=>operator.semanticChangeA(sourceToken,scenario('not-allowed','unchanged')))
    .toThrow(expect.objectContaining({code:'SOURCE_FORBIDDEN'}));
  expect(clockReads).toBe(startClockReads);
  await observe(companyA.sourceRef);
  await observe(companyA.sourceRef);
  await semantics.readCurrentSemantics(companyA.sourceRef);
  expect(await Promise.all([databaseState(admin),databaseState(runtimeAdmin)])).toEqual(before);
});

it('rejects invalid capability configuration and retains a detached allowlist',async ()=>{
  for (const invalid of [
    {token:'',sourceRefs:allowed},{token:'invalid token',sourceRefs:allowed},
    {token:'x'.repeat(1025),sourceRefs:allowed},{token:sourceToken,sourceRefs:[]},
    {token:sourceToken,sourceRefs:['foreign/path']},{token:sourceToken,sourceRefs:['repeat','repeat']},
  ]) expect(()=>composeSourceSemantics(dependencies,{catalog,capability:invalid})).toThrow();
  const refs = [companyA.sourceRef];
  const detached = composeSourceSemantics(dependencies,{catalog,capability:{token:sourceToken,sourceRefs:refs}});
  refs.push(allowedUnknown);
  await expect(detached.readCurrentSemantics(allowedUnknown)).rejects.toMatchObject({code:'SOURCE_FORBIDDEN'});
});

it('rejects corrupt manifest bindings, stream contracts and event rows without a partial observation',async ()=>{
  const [watermark] = await operator.semanticChangeA(operatorToken,scenario('first','watermark'));
  const latest = manifest(companyA,2,{[aKey]:'baseline'},[watermark!]);
  await publishBaseline(dependencies,companyA,latest,[]);
  for (const id of ['second','third','fourth','fifth']) {
    await operator.semanticChangeA(operatorToken,scenario(id,'late'));
  }
  const corrupt = [
    {...latest,hash:'0'.repeat(64)},
    {...latest,id:'row-id-mismatch'},
    {...latest,companyId:'wrong-company'},
    {...latest,sourceRef:'wrong-source'},
    {...latest,epoch:3},
    {...latest,semanticVersions:{'invalid-account-key':'bad'}},
    {...latest,schemaVersions:{...latest.schemaVersions,'a-semantics':'unknown-schema'}},
    {...latest,streams:latest.streams.map(member=>member.streamId === 'a-semantics'
      ? {...member,streamId:'unknown-stream'} : member)},
    {...latest,streams:latest.streams.map(member=>member.streamId === 'a-semantics'
      ? {...member,resumeAfter:'11'} : member)},
    {...latest,streams:latest.streams.filter(member=>member.streamId !== 'a-semantics')},
  ];
  for (const [index,manifest] of corrupt.entries()) {
    const altered = index === 0 ? manifest : {...manifest,hash:hashManifest(manifest)};
    await admin.query('UPDATE source_manifests SET manifest = $1 WHERE manifest_id = $2',[altered,latest.id]);
    try {
      await errorResponse(await get(companyA.sourceRef),503,'SOURCE_SEMANTICS_UNAVAILABLE');
    } finally {
      await admin.query('UPDATE source_manifests SET manifest = $1 WHERE manifest_id = $2',[latest,latest.id]);
    }
  }
  const [eventRow] = (await admin.query<{event:RawSourceEvent}>(
    "SELECT event FROM source_events WHERE source_ref = $1 AND stream_id = 'a-semantics' AND sequence = 4",[companyA.sourceRef],
  )).rows;
  const original = eventRow!.event;
  for (const altered of [
    {...original,semanticVersion:'tampered'},
    {...original,contentHash:'0'.repeat(64)},
    ...[
      {...original,id:'wrong-row-event-id'},
      {...original,sequence:3},
      {...original,streamId:'a-finance'},
      {...original,sourceRef:companyB.sourceRef},
      {...original,rawIdentity:{...original.rawIdentity,companyId:companyB.companyId}},
      {...original,schemaVersion:'unsupported-event-contract'},
    ].map(event=>({...event,contentHash:hashEvent(event)})),
  ]) {
    const before = await Promise.all([databaseState(admin),databaseState(runtimeAdmin)]);
    await admin.query('UPDATE source_events SET event = $1, content_hash = $2 WHERE source_ref = $3 AND event_id = $4',
      [altered,altered.contentHash,original.sourceRef,original.id]);
    const corrupted = await Promise.all([databaseState(admin),databaseState(runtimeAdmin)]);
    try {
      await errorResponse(await get(companyA.sourceRef),503,'SOURCE_SEMANTICS_UNAVAILABLE');
      expect(await Promise.all([databaseState(admin),databaseState(runtimeAdmin)])).toEqual(corrupted);
    } finally {
      await admin.query('UPDATE source_events SET event = $1, content_hash = $2 WHERE source_ref = $3 AND event_id = $4',
        [original,original.contentHash,original.sourceRef,original.id]);
    }
    expect(await Promise.all([databaseState(admin),databaseState(runtimeAdmin)])).toEqual(before);
  }
  await admin.query('UPDATE source_events SET content_hash = $1 WHERE source_ref = $2 AND event_id = $3',
    ['0'.repeat(64),original.sourceRef,original.id]);
  try {
    await errorResponse(await get(companyA.sourceRef),503,'SOURCE_SEMANTICS_UNAVAILABLE');
  } finally {
    await admin.query('UPDATE source_events SET content_hash = $1 WHERE source_ref = $2 AND event_id = $3',
      [original.contentHash,original.sourceRef,original.id]);
  }
  await admin.query('UPDATE source_events SET sequence = 14 WHERE source_ref = $1 AND event_id = $2',
    [original.sourceRef,original.id]);
  try {
    await errorResponse(await get(companyA.sourceRef),503,'SOURCE_SEMANTICS_UNAVAILABLE');
  } finally {
    await admin.query('UPDATE source_events SET sequence = 4 WHERE source_ref = $1 AND event_id = $2',
      [original.sourceRef,original.id]);
  }
  await expect(composeSourceSemantics(dependencies,{
    catalog:new Map([...catalog,['ambiguous-registration',companyA]]),capability,
  }).readCurrentSemantics(companyA.sourceRef)).rejects.toMatchObject({code:'SOURCE_SEMANTICS_UNAVAILABLE'});
  const unsupported = {...companyA,streams:companyA.streams.map(stream=>({
    ...stream,resources:stream.resources.filter(resource=>resource !== 'a-semantics'),
  }))};
  await expect(composeSourceSemantics(dependencies,{
    catalog:new Map([...catalog,[companyA.companyId,unsupported]]),capability,
  }).readCurrentSemantics(companyA.sourceRef)).rejects.toMatchObject({code:'SOURCE_SEMANTICS_UNAVAILABLE'});
});

function rawSemantic(
  source:SourceDefinition, streamId:string, sequence:number, revision:string, sellerEntityId?:string,
) {
  const template = eventA({
    kind:'semantic_change',recordId:'fixture:' + streamId + ':' + sequence,sourceAccountId:account,
    effectiveDate:'2026-10-01',semanticVersion:revision,fields:{revision:'payload-not-the-envelope'},
  },sequence,asOf);
  const stream = source.streams.find(stream=>stream.streamId === streamId)!;
  const draft = {...template,sourceRef:source.sourceRef,streamId,resource:stream.resources[0]!,rawIdentity:{
    companyId:source.companyId,sourceAccountId:account,...(sellerEntityId ? {sellerEntityId} : {}),
  }};
  return {...draft,contentHash:hashEvent(draft)};
}

it('keeps same-account sellers separate and retains a governing revision across a later scoped append',async ()=>{
  const versions = {[aKey]:'baseline','seller-a/unrelated':'unchanged'};
  await publishBaseline(dependencies,companyA,manifest(companyA,2,versions),[]);
  await insertFixture(companyA,rawSemantic(companyA,'a-semantics',1,'second-seller','seller-other'));
  await insertFixture(companyA,rawSemantic(companyA,'a-semantics',2,'governing'));
  await operator.semanticChangeA(operatorToken,scenario('after-governing','scoped'));
  expect((await observe(companyA.sourceRef)).versions).toEqual({
    [aKey]:'scoped',['seller-other/' + account]:'second-seller','seller-a/unrelated':'unchanged','*':'governing',
  });
});

it('combines disjoint semantic streams and fails closed on conflicting independent order',async ()=>{
  await publishBaseline(dependencies,synthetic,manifest(synthetic,2,{[aKey]:'baseline'}),[]);
  await insertFixture(synthetic,rawSemantic(synthetic,'first',1,'one','seller-a'));
  await insertFixture(synthetic,rawSemantic(synthetic,'second',1,'two','seller-b'));
  expect((await observe(synthetic.sourceRef)).versions).toEqual({[aKey]:'one',[bKey]:'two'});
  await insertFixture(synthetic,rawSemantic(synthetic,'second',2,'one','seller-a'));
  expect((await observe(synthetic.sourceRef)).versions).toEqual({[aKey]:'one',[bKey]:'two'});
  await insertFixture(synthetic,rawSemantic(synthetic,'second',3,'conflicting','seller-a'));
  await errorResponse(await get(synthetic.sourceRef),503,'SOURCE_SEMANTICS_UNSUPPORTED_ORDER');
});

async function allEvents(source:SourceDefinition) {
  return (await dependencies.db.query<{event:RawSourceEvent}>(
    'SELECT event FROM source_events WHERE source_ref = $1 ORDER BY stream_id,sequence',[source.sourceRef],
  )).rows.map(row=>row.event);
}

it('observes wholly new or wholly old publication depending on who acquires the source lock',async ()=>{
  await publishBaseline(dependencies,companyA,manifest(companyA,2,{[aKey]:'original'}),[]);
  await operator.semanticChangeA(operatorToken,scenario('before-publication','scoped'));
  const old = await observe(companyA.sourceRef);
  const members = await allEvents(companyA);
  const publicationFirst = manifest(companyA,11,{[aKey]:'publication-first'},members);
  let publish!:Promise<BootstrapManifest>;
  let read!:ReturnType<typeof observe>;
  await barrier('source_snapshots',async ()=>{
    publish = publishBaseline(dependencies,companyA,publicationFirst,[]);
    await waitForLock('relation','source_snapshots');
    // The publication has already written its manifest inside the uncommitted transaction.
    expect((await dependencies.db.query(
      'SELECT 1 FROM source_manifests WHERE manifest_id = $1',[publicationFirst.id],
    )).rowCount).toBe(0);
    read = observe(companyA.sourceRef);
    await waitForLock('advisory');
  });
  await publish;
  expect((await read).versions).toEqual(publicationFirst.semanticVersions);
  expect(old.versions[aKey]).toBe('scoped');

  const observationFirst = manifest(companyA,12,{[aKey]:'observation-first'},members);
  await barrier('source_manifests',async ()=>{
    read = observe(companyA.sourceRef);
    await waitForLock('relation','source_manifests');
    publish = publishBaseline(dependencies,companyA,observationFirst,[]);
    await waitForLock('advisory');
  });
  expect((await read).versions).toEqual(publicationFirst.semanticVersions);
  await publish;
  expect((await observe(companyA.sourceRef)).versions).toEqual(observationFirst.semanticVersions);
});

it('serializes before and after real A and B scenario appends, without replaying publication members',async ()=>{
  await publishBaseline(dependencies,companyA,manifest(companyA,2,{[aKey]:'a-baseline'}),[]);
  await publishBaseline(dependencies,companyB,manifest(companyB,2,{[bKey]:'b-baseline'}),[]);
  for (const {source,key,append,epoch} of [
    {source:companyA,key:aKey,append:operator.semanticChangeA,epoch:13},
    {source:companyB,key:bKey,append:operator.semanticChangeB,epoch:3},
  ]) {
    const before = await observe(source.sourceRef);
    let write!:Promise<RawSourceEvent[]>;
    let read!:ReturnType<typeof observe>;
    await barrier('source_manifests',async ()=>{
      read = observe(source.sourceRef);
      await waitForLock('relation','source_manifests');
      write = append(operatorToken,scenario('observation-first','after-first-append'));
      await waitForLock('advisory');
    });
    expect((await read).versions).toEqual(before.versions);
    await write;
    expect((await observe(source.sourceRef)).versions[key]).toBe('after-first-append');

    const members = await allEvents(source);
    const newBaseline = manifest(source,epoch,{[key]:'published-after-first'},members);
    await publishBaseline(dependencies,source,newBaseline,[]);
    expect((await observe(source.sourceRef)).versions).toEqual(newBaseline.semanticVersions);

    await barrier('activity_counter',async ()=>{
      write = append(operatorToken,scenario('append-first','after-second-append'));
      await waitForLock('relation','activity_counter');
      read = observe(source.sourceRef);
      await waitForLock('advisory');
    });
    const [appended] = await write;
    const watermark = newBaseline.streams.find(member=>member.streamId === appended!.streamId)!.resumeAfter;
    expect(appended!.sequence).toBe(Number(watermark) + 1);
    expect((await read).versions).toEqual({[key]:'after-second-append'});
  }
});

it('fails closed on a source database outage and leaves both databases unchanged',async ()=>{
  await publishBaseline(dependencies,companyA,manifest(companyA,2,{[aKey]:'before-outage'}),[]);
  const before = await Promise.all([databaseState(admin),databaseState(runtimeAdmin)]);
  await observe(companyA.sourceRef);
  await dependencies.db.end();
  sourcePoolEnded = true;
  await errorResponse(await get(companyA.sourceRef),503,'SOURCE_SEMANTICS_UNAVAILABLE');
  await errorResponse(await get(foreign.sourceRef),403,'SOURCE_FORBIDDEN');
  expect(await Promise.all([databaseState(admin),databaseState(runtimeAdmin)])).toEqual(before);
});

it('rejects a missing watermark row even when the post-watermark range is contiguous',async ()=>{
  const [watermark] = await operator.semanticChangeA(operatorToken,scenario('boundary','at-watermark'));
  await publishBaseline(dependencies,companyA,manifest(companyA,2,{[aKey]:'baseline'},[watermark!]),[]);
  await operator.semanticChangeA(operatorToken,scenario('late','post-watermark'));
  expect((await observe(companyA.sourceRef)).versions).toEqual({[aKey]:'post-watermark'});
  await admin.query('DELETE FROM source_events WHERE source_ref = $1 AND event_id = $2',
    [watermark!.sourceRef,watermark!.id]);
  await errorResponse(await get(companyA.sourceRef),503,'SOURCE_SEMANTICS_UNAVAILABLE');
});
