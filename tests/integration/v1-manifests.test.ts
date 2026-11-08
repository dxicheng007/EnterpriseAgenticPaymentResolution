import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  BootstrapManifestSchema, RawSourceEventSchema, UploadMetadataSchema, canonicalJson, hashBytes, hashCanonical,
  hashEvent, hashManifest, type BootstrapManifest, type ManifestFile, type RawSourceEvent,
} from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import {
  companyA, companyB, createSourceService, prepareApiRecord, publishManifest, readEvidence, readEvidenceBytes,
  requireCoverage, streamContentHash, uploadSource,
} from '@eapr/sources';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { eventB, encodeBatch } from '../../packages/sources/src/company-b.js';
import { lockSource } from '../../packages/sources/src/uploads.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

const asOf = '2026-10-01T00:00:00.000Z';
const token = 'leased-operator-token';

it('pins a B epoch and serializes publication with live append across all three streams', async () => {
  const root = await mkdtemp(join(tmpdir(),'eapr-manifest-'));
  const visible = join(root,'visible');
  const store = await createEvidenceStore(join(root,'originals'));
  const system = await createTestSystem({modelMode:'disabled',dbNamespace:testNamespace('manifest')});
  try {
    await generateFixtures({seed:'coordinated',asOf,visibleRoot:visible,truthRoot:join(root,'truth')});
    const manifest = BootstrapManifestSchema.parse(JSON.parse(await readFile(join(visible,'manifest-b.json'),'utf8')));
    const events = RawSourceEventSchema.array().parse(JSON.parse(await readFile(join(visible,'api-b.json'),'utf8')));
    const uploads: {metadata:object;path:string}[] = JSON.parse(await readFile(join(visible,'uploads-b.json'),'utf8'));
    const catalog = new Map([[companyA.companyId,companyA],[companyB.companyId,companyB]]);
    const dependencies = {db:system.db.control,store,clock:()=>new Date(asOf)};
    const source = createSourceService(dependencies,catalog);
    const operator = createScenarioAdmin(dependencies,{DEMO_OPERATOR_ENABLED:'true',DEMO_OPERATOR_TOKEN:token});
    for (const {metadata,path} of uploads) {
      await uploadSource(dependencies,UploadMetadataSchema.parse(metadata),await readFile(join(visible,path)));
    }
    const prepared = await Promise.all(events.map(async event=>prepareApiRecord(companyB,store,event,
      await readFile(join(visible,'api-b',hashCanonical(event.id) + '.json')))));
    const baselineReceipt = manifest.streams.find(stream=>stream.streamId === 'b-receipts')!;
    const live = {id:'after-epoch',accountId:'cust-b-unknown',effectiveDate:'2026-10-03',
      observedAt:'2026-10-03T00:00:00.000Z',amountMinor:30000};
    expect(() => operator.unknownAccountB('invalid',live)).toThrow('authorization');
    expect(() => createScenarioAdmin(dependencies,{DEMO_OPERATOR_ENABLED:'false',DEMO_OPERATOR_TOKEN:token}).unknownAccountB(token,live)).toThrow('authorization');

    // Register each real PostgreSQL waiter before releasing the publication barrier.
    const blocker = await dependencies.db.connect();
    async function waitForWaiters(expected:number) {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const result = await dependencies.db.query<{count:string}>(
          "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted " +
          "AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
        );
        if (Number(result.rows[0]?.count) === expected) return;
      }
      throw new Error('Source publication barrier did not observe expected advisory-lock waiters');
    }
    let publish: Promise<BootstrapManifest> | undefined;
    let inject: Promise<RawSourceEvent[]> | undefined;
    try {
      await blocker.query('BEGIN');
      await lockSource(blocker,companyB.sourceRef);
      publish = publishManifest(dependencies,catalog,manifest,prepared);
      await waitForWaiters(1);
      inject = operator.unknownAccountB(token,live);
      await waitForWaiters(2);
      expect((await dependencies.db.query('SELECT manifest_id FROM source_manifests')).rowCount).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect(await publish).toEqual(manifest);
    const [late] = (await inject)!;
    expect(late.sequence).toBe(Number(baselineReceipt.resumeAfter) + 1);
    expect(late.rawIdentity.sourceAccountId).toBe('cust-b-unknown');
    expect(Object.hasOwn(late,'scope')).toBe(false);
    const page = await source.fetchChanges(companyB.sourceRef,'b-receipts',baselineReceipt.resumeAfter);
    expect(page.events).toEqual([late]);
    expect(await operator.unknownAccountB(token,live)).toEqual([late]);
    expect(await source.fetchChanges(companyB.sourceRef,'b-receipts',page.next))
      .toMatchObject({complete:true,next:page.next,events:[]});
    await expect(source.fetchChanges(companyB.sourceRef,'b-receipts',String(Number(page.next)+1)))
      .rejects.toMatchObject({code:'SOURCE_GAP'});

    expect(manifest.streams.map(stream=>stream.streamId).sort()).toEqual(['b-files','b-receipts','b-semantics']);
    for (const member of manifest.streams) {
      const snapshot = await source.getSnapshot(member.snapshotId);
      const records = await source.getSnapshotRecords(member.snapshotId);
      expect(snapshot.manifestId).toBe(manifest.id);
      expect(snapshot.contentHash).toBe(hashCanonical({
        sourceRef:manifest.sourceRef,streamId:member.streamId,resumeAfter:member.resumeAfter,
        events:records.map(({id,contentHash})=>({id,contentHash})),
      }));
      expect(snapshot.eventIds.toSorted()).toEqual(member.eventIds.toSorted());
    }
    const [initial,repeated] = await Promise.all([source.captureSnapshot(manifest.id),source.captureSnapshot(manifest.id)]);
    expect(initial.ok).toBe(true);
    expect(repeated).toEqual(initial);
    if (!initial.ok) throw new Error('Baseline capture incomplete');
    expect(initial.snapshot.contentHash).toBe(hashCanonical({
      manifestHash:manifest.hash,
      streams:manifest.streams.map(({streamId,snapshotId,snapshotHash})=>({streamId,snapshotId,snapshotHash}))
        .sort((a,b)=>a.streamId < b.streamId ? -1 : 1),
      files:manifest.files.map(({fileId,sha256})=>({fileId,sha256})).sort((a,b)=>a.fileId < b.fileId ? -1 : 1),
      eventIds:initial.snapshot.eventIds.toSorted(),evidenceIds:initial.snapshot.evidenceIds.toSorted(),
    }));
    const reconstructed = createSourceService({
      ...dependencies,store:await createEvidenceStore(join(root,'originals')),
      clock:()=>new Date('2026-10-10T00:00:00.000Z'),
    },catalog);
    expect(await reconstructed.captureSnapshot(manifest.id)).toEqual(initial);
    expect(await reconstructed.fetchChanges(companyB.sourceRef,'b-receipts',baselineReceipt.resumeAfter)).toEqual(page);
    expect((await reconstructed.getSnapshotRecords(initial.snapshot.id)).some(event=>event.id === late.id)).toBe(false);

    const changedFile = {...manifest.files[0]!,sha256:hashBytes(Buffer.from('different pinned bytes'))};
    const missingFile:ManifestFile = {fileId:'missing-source-file',documentId:'missing-source-document',
      documentVersion:1,kind:'email_json',sha256:hashBytes(Buffer.from('unavailable'))};
    const nextEpoch = (epoch:number,files:ManifestFile[]) => {
      const id = 'manifest-b-epoch-' + epoch;
      const input = {
        ...manifest,id,epoch,files,
        streams:manifest.streams.map(member=>{
          const current = {...member,snapshotId:id + ':' + member.streamId};
          if (member.streamId !== 'b-receipts') return current;
          return {...current,resumeAfter:page.next,eventIds:[...member.eventIds,late.id],
            snapshotHash:streamContentHash(companyB.sourceRef,member.streamId,page.next,[...events,late])};
        }),
      };
      return BootstrapManifestSchema.parse({...input,hash:hashManifest(input)});
    };
    const stale = nextEpoch(2,manifest.files);
    const staleInput = {...stale,streams:stale.streams.map(member=>member.streamId === 'b-receipts'
      ? {...baselineReceipt,snapshotId:member.snapshotId} : member)};
    await expect(publishManifest(dependencies,catalog,{...staleInput,hash:hashManifest(staleInput)},[]))
      .rejects.toMatchObject({code:'SOURCE_EPOCH_CONFLICT'});
    const missing = nextEpoch(2,[...manifest.files,missingFile]);
    await publishManifest(dependencies,catalog,missing,[]);
    expect(await reconstructed.captureSnapshot(missing.id)).toMatchObject({
      ok:false,dossier:{complete:false,missingMembers:[missingFile.fileId],diagnostics:[{code:'MANIFEST_MEMBER_MISSING'}]},
    });
    const changed = nextEpoch(3,[changedFile,...manifest.files.slice(1)]);
    await publishManifest(dependencies,catalog,changed,[]);
    expect(await reconstructed.captureSnapshot(changed.id)).toMatchObject({
      ok:false,dossier:{complete:false,missingMembers:[],diagnostics:[{code:'SOURCE_HASH_CONFLICT'}]},
    });
    await expect(reconstructed.getSnapshot('snapshot:' + changed.id)).rejects.toMatchObject({status:404});
    expect((await reconstructed.getManifest(companyB.companyId)).id).toBe(changed.id);

    const batch = uploads.find(upload=>upload.path === 'b-batch-3.csv')!;
    const batchMeta = UploadMetadataSchema.parse(batch.metadata);
    const batchBytes = await readFile(join(visible,batch.path));
    const citations = await Promise.all(initial.snapshot.evidenceIds.map(id=>
      readEvidence(dependencies.db,id,async()=>{})));
    const csv = citations.find(item=>item.evidence.locator.kind === 'csv' &&
      item.original.sha256 === hashBytes(batchBytes))!;
    expect(csv.evidence.locator).toMatchObject({kind:'csv',column:'payload_json'});
    expect(csv.evidence.excerpt).toMatch(/"amount_minor":/);
    const accountCapability = {companyId:companyB.companyId,sourceRef:companyB.sourceRef,
      sourceWide:false,accounts:[{sellerEntityId:'seller-b',sourceAccountId:late.rawIdentity.sourceAccountId!}]};
    await expect(readEvidenceBytes(dependencies.db,store,csv.evidence.id,
      async binding=>requireCoverage(accountCapability,binding))).rejects.toMatchObject({status:403});
    expect((await readEvidenceBytes(dependencies.db,store,csv.evidence.id,
      async binding=>requireCoverage({...accountCapability,sourceWide:true},binding))).bytes).toEqual(batchBytes);
    expect((await uploadSource(dependencies,batchMeta,batchBytes)).duplicate).toBe(true);
    await expect(uploadSource(dependencies,batchMeta,Buffer.concat([batchBytes,Buffer.from('\n')])))
      .rejects.toMatchObject({code:'SOURCE_HASH_CONFLICT'});
    const cursor = manifest.streams.find(stream=>stream.streamId === 'b-files')!.resumeAfter;
    const record = eventB({kind:'invoice',recordId:'next-invoice-b',sourceAccountId:'cust-b-unknown',
      effectiveDate:'2026-10-03',semanticVersion:'sem-b-2',fields:{amount_minor:300000,due_on:'2026-10-31'}},
      Number(cursor)+1,live.observedAt);
    const futureMeta = UploadMetadataSchema.parse({...batchMeta,documentId:'next-b-batch',originalName:'next-b-batch.csv',
      batch:{batchId:'batch-b-next',sequence:5,streamId:'b-files'}});
    await expect(uploadSource(dependencies,futureMeta,encodeBatch([record]))).rejects.toMatchObject({code:'SOURCE_GAP'});
    expect((await source.fetchChanges(companyB.sourceRef,'b-files',cursor)).next).toBe(cursor);
    const readyMeta = UploadMetadataSchema.parse({...futureMeta,batch:{...futureMeta.batch,sequence:4}});
    await expect(uploadSource(dependencies,readyMeta,encodeBatch([{...record,id:manifest.streams
      .find(stream=>stream.streamId === 'b-files')!.eventIds[0]!}]))).rejects.toMatchObject({code:'SOURCE_HASH_CONFLICT'});
    const [semantic] = await operator.semanticChangeB(token,{...live,id:'semantic-b-2',revision:'sem-b-2'});
    const semanticPage = await source.fetchChanges(companyB.sourceRef,'b-semantics','0');
    expect(semanticPage.events).toEqual([semantic]);
    expect(semantic).toMatchObject({kind:'semantic_change',semanticVersion:'sem-b-2',payload:{revision:'sem-b-2'}});
    const {sellerEntityId: _seller, ...missingSeller} = record.rawIdentity;
    for (const rawIdentity of [{...record.rawIdentity,sellerEntityId:'different-seller'},missingSeller]) {
      const draft = {...record,rawIdentity};
      const rejected = {...draft,contentHash:hashEvent(draft)};
      const original = structuredClone(rejected);
      await expect(operator.batchB(token,readyMeta,[rejected]))
        .rejects.toMatchObject({status:422,code:'SOURCE_CONTENT_INVALID'});
      expect(rejected).toEqual(original);
      expect((await source.fetchChanges(companyB.sourceRef,'b-files',cursor)))
        .toMatchObject({after:cursor,next:cursor,events:[]});
      expect((await dependencies.db.query('SELECT file_id FROM source_files WHERE batch_id = $1',
        [readyMeta.batch!.batchId])).rowCount).toBe(0);
    }
    const added = await operator.batchB(token,readyMeta,[record]);
    expect(added.events).toEqual([record]);
    expect((await source.fetchChanges(companyB.sourceRef,'b-files',cursor)).events).toEqual([record]);
    const knownAccount = (await source.getSnapshotRecords(initial.snapshot.id))
      .find(event=>event.streamId === 'b-files')!.rawIdentity.sourceAccountId!;
    const known = eventB({kind:'invoice',recordId:'known-invoice-b',sourceAccountId:knownAccount,
      effectiveDate:'2026-10-03',fields:{amount_minor:100,due_on:'2026-10-31'}},record.sequence+1,live.observedAt);
    const knownMeta = UploadMetadataSchema.parse({...readyMeta,documentId:'known-b-batch',
      batch:{...readyMeta.batch,batchId:'batch-b-known',sequence:5}});
    expect((await operator.batchB(token,knownMeta,[known])).events).toEqual([known]);
    expect((await source.fetchChanges(companyB.sourceRef,'b-files',String(record.sequence))).events).toEqual([known]);
    expect(record.semanticVersion).toBe('sem-b-2');
    expect(canonicalJson((await source.getSnapshot(initial.snapshot.id)))).toBe(canonicalJson(initial.snapshot));

    const scenarioA = {id:'a-missing-dependency',accountId:'raw-a-one',amount:'300.00',
      effectiveDate:'2026-10-03',observedAt:live.observedAt};
    const [payment,allocation] = await operator.missingDependencyA(token,{...scenarioA,invoiceId:'inv-a:a-late-invoice'});
    expect(allocation.payload).toMatchObject({funding_id:payment.recordId,invoice_id:'inv-a:a-late-invoice'});
    await expect(operator.freshPaymentA(token,{...scenarioA,amount:'301.00',invoiceId:'inv-a:a-late-invoice'}))
      .rejects.toMatchObject({code:'SOURCE_HASH_CONFLICT'});
    const [invoice] = await operator.freshInvoiceA(token,{
      ...scenarioA,id:'a-late-invoice',amount:'3000.00',dueDate:'2026-10-31',
    });
    const [rename] = await operator.schemaRenameA(token,{
      ...scenarioA,id:'a-schema-rename',amount:'3100.00',dueDate:'2026-10-31',
    });
    expect(rename).toMatchObject({schemaVersion:'schema-a-2',payload:{gross_amount:'3100.00'}});
    expect(Object.hasOwn(rename.payload,'amount')).toBe(false);
    expect((await source.fetchChanges(companyA.sourceRef,'a-finance','0')).events).toEqual([payment,allocation,invoice,rename]);
    expect([payment,allocation,invoice,rename].map(event=>event.sequence)).toEqual([1,2,3,4]);
  } finally {
    await system.close();
    await rm(root,{recursive:true,force:true});
  }
});
