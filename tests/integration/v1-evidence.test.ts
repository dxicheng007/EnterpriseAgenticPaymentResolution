import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, BootstrapManifestSchema, EvidenceResponseSchema, RawSourceEventSchema, SourceDossierSchema, UploadMetadataSchema,
  UploadResponseSchema, canonicalJson, hashBytes, hashManifest } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { MAX_UPLOAD_BYTES, SourceError, captureBaseline, companyA, prepareApiRecord, publishBaseline,
  streamContentHash } from '@eapr/sources';
import { createSourcePlugin } from '../../apps/control/src/routes/sources.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { textPdf } from '../../packages/sources/src/canonical-fixtures.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import { createTestSystem,testNamespace } from '../fixtures/harness.js';

const asOf = '2026-10-01T00:00:00.000Z';
const sourceB = {companyId:'company-b',sourceRef:'legacy-b'};

describe('V1 evidence', () => {
  it('generates repeatable original bytes, preserves distinct same-name identities and explicit links', async () => {
    const root = await mkdtemp(join(tmpdir(),'eapr-generator-'));
    try {
      const run = (prefix:string,seed:string) => generateFixtures({
        seed,asOf,visibleRoot:join(root,prefix+'-visible'),truthRoot:join(root,prefix+'-truth'),
      });
      const [one,two,other] = await Promise.all([run('one','seed1'),run('two','seed1'),run('other','seed2')]);
      expect(one).toEqual(two);
      expect(other.manifestHashes).not.toEqual(one.manifestHashes);
      for (const path of one.visiblePaths) {
        expect(hashBytes(await readFile(join(root,'one-visible',path))))
          .toBe(hashBytes(await readFile(join(root,'two-visible',path))));
      }
      const accounts = JSON.parse(await readFile(join(root,'one-visible','accounts-a.json'),'utf8'));
      expect(accounts[1].displayName).toBe(accounts[2].displayName);
      expect(accounts[1].entityId).not.toBe(accounts[2].entityId);
      const events = RawSourceEventSchema.array().parse(JSON.parse(await readFile(join(root,'one-visible','api-a.json'),'utf8')));
      const invoice = events.find(event => event.kind === 'invoice' && event.rawIdentity.sourceAccountId === accounts[0].accountId &&
        event.effectiveAt === '2026-09-01T00:00:00.000Z')!;
      expect(invoice.payload.amount).toBe('3000.00');
      const allocations = events.filter(event => event.kind === 'allocation' && event.payload.invoice_id === invoice.recordId);
      expect(allocations.map(event=>[event.payload.funding_kind,event.payload.amount])).toEqual([
        ['payment','2000.00'],['credit','200.00'],
      ]);
      expect(allocations.every(event => events.some(funding => funding.recordId === event.payload.funding_id))).toBe(true);
    } finally {
      await rm(root,{recursive:true,force:true});
    }
  });

  it('serializes repeated versions and authorizes uploads before publication', async () => {
    const root = await mkdtemp(join(tmpdir(),'eapr-uploads-'));
    const store = await createEvidenceStore(join(root,'originals'));
    const system = await createTestSystem({
      modelMode:'disabled',dbNamespace:testNamespace('evidence'),
      controlPluginFactory:() => [createSourcePlugin({
        catalog:new Map([[companyA.companyId,companyA],[sourceB.companyId,sourceB]]),
        store,
        authorizeSource:async (request,{companyId}) => {
          if (!request.headers.authorization) throw new SourceError(401,'SOURCE_UNAUTHENTICATED','Source authorization is required');
          if (request.headers.authorization !== 'Bearer ' + companyId) throw new SourceError(403,'SOURCE_FORBIDDEN','Source scope is forbidden');
        },

      })],
    });
    try {
      const metadata = {companyId:'company-a',sourceRef:'legacy-a',documentId:'one',documentVersion:1,
        kind:'email_json',originalName:'export.json'};
      const original = Buffer.from('{"messageId":"msg","body":"Fixed monthly fee USD 3000.00."}');
      function upload(meta:object, bytes:Uint8Array, authorization?:string) {
        const form = new FormData();
        form.append('metadata',JSON.stringify(meta));
        form.append('file',new Blob([Uint8Array.from(bytes)],{type:'application/json'}),'export.json');
        return fetch(system.control.origin + '/api/sources/uploads',{
          method:'POST',body:form,headers:authorization ? {authorization} : undefined,
        });
      }
      function rawMetadata(bytes:Buffer) {
        const boundary = 't1-test-boundary';
        const body = Buffer.concat([
          Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'),
          bytes,
          Buffer.from('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="export.json"\r\n' +
            'Content-Type: application/json\r\n\r\n'),
          original,Buffer.from('\r\n--' + boundary + '--\r\n'),
        ]);
        return fetch(system.control.origin + '/api/sources/uploads',{
          method:'POST',body,headers:{authorization:'Bearer company-a','content-type':'multipart/form-data; boundary=' + boundary},
        });
      }
      const longMetadata = Buffer.from(JSON.stringify({...metadata,originalName:'a'.repeat(16*1024)}));
      expect((await rawMetadata(longMetadata)).status).toBe(413);
      const malformedUtf8 = Buffer.concat([
        Buffer.from(JSON.stringify({...metadata,originalName:'invalid'}).replace('invalid"}','')),
        Buffer.from([0xc3,0x28]),Buffer.from('"}'),
      ]);
      expect((await rawMetadata(malformedUtf8)).status).toBe(400);
      const missingAuth = await upload(metadata,original);
      expect(missingAuth.status).toBe(401);
      expect(ApiErrorSchema.parse(await missingAuth.json()).code).toBe('SOURCE_UNAUTHENTICATED');
      expect((await upload(metadata,original,'Bearer company-b')).status).toBe(403);
      expect((await upload({...metadata,originalName:'../export.json'},original,'Bearer company-a')).status).toBe(400);
      expect((await upload(metadata,Buffer.alloc(MAX_UPLOAD_BYTES+1),'Bearer company-a')).status).toBe(413);
      const duplicates = await Promise.all([
        upload(metadata,original,'Bearer company-a'),upload(metadata,original,'Bearer company-a'),
      ]);
      expect(duplicates.map(response=>response.status).sort()).toEqual([200,201]);
      const [first,second] = await Promise.all(duplicates.map(async response=>UploadResponseSchema.parse(await response.json())));
      expect(first.fileId).toBe(second.fileId);
      expect(first.evidenceIds).toEqual([]);
      expect(second.evidenceIds).toEqual([]);
      expect(first.contentHash).toBe(hashBytes(original));
      const changed = Buffer.from('{"messageId":"msg","body":"Changed bytes."}');
      expect((await upload(metadata,changed,'Bearer company-a')).status).toBe(409);
      expect((await upload(metadata,Buffer.from('corrupt replacement'),'Bearer company-a')).status).toBe(409);
      expect((await upload({...metadata,documentId:'invalid'},Buffer.from('corrupt new document'),'Bearer company-a')).status).toBe(422);
      expect((await upload({...metadata,documentVersion:2},changed,'Bearer company-a')).status).toBe(201);
      const other = await upload({...metadata,...sourceB},original,'Bearer company-b');
      expect(other.status).toBe(201);
      const isolated = UploadResponseSchema.parse(await other.json());
      expect(isolated.contentHash).toBe(first.contentHash);
      expect(isolated.fileId).not.toBe(first.fileId);
      expect(Number((await system.db.control.query('SELECT count(*) FROM source_files')).rows[0].count)).toBe(3);
      expect(Number((await system.db.control.query("SELECT count(*) FROM activity_events WHERE event->>'type' = 'source.captured'")).rows[0].count)).toBe(3);
      const dependencies = {db:system.db.control,store,clock:()=>new Date(asOf)};
      const event = eventA({kind:'invoice',recordId:'invoice:a:one',sourceAccountId:'account-a-one',
        effectiveDate:'2026-09-01',fields:{amount:'3000.00',due_date:'2026-09-30'}},1,asOf);
      // Retain the source's exact JSON whitespace and key order in its original response.
      const apiOriginal = Buffer.from(JSON.stringify(event.payload,null,2) + '\n');
      const record = await prepareApiRecord(companyA,store,event,apiOriginal);
      function manifest(epoch:number,files:import('@eapr/contracts').ManifestFile[]) {
        const id = 'manifest-evidence-' + epoch;
        const input = {
          id,companyId:companyA.companyId,sourceRef:companyA.sourceRef,asOf,epoch,files,
          schemaVersions:{'a-invoices':'schema-a-1'},semanticVersions:{'seller-a/account-a-one':'sem-a-1'},
          streams:companyA.streams.map(({streamId})=>{
            const events = streamId === event.streamId ? [event] : [];
            const resumeAfter = String(events.length);
            return {streamId,snapshotId:id + ':' + streamId,resumeAfter,eventIds:events.map(item=>item.id),
              snapshotHash:streamContentHash(companyA.sourceRef,streamId,resumeAfter,events)};
          }),
        };
        return BootstrapManifestSchema.parse({...input,hash:hashManifest(input)});
      }
      const pdfBytes = await textPdf(['Monthly fee USD 3000.00'],asOf,'Contract example');
      const documents = [
        {metadata,bytes:original,kind:'email',excerpt:'Fixed monthly fee USD 3000.00.'},
        {metadata:{...metadata,documentId:'contract',originalName:'contract.pdf',kind:'contract_pdf'},
          bytes:pdfBytes,kind:'pdf',excerpt:'Monthly fee USD 3000.00'},
      ];
      const files: import('@eapr/contracts').ManifestFile[] = [];
      for (const document of documents) {
        const response = await upload(document.metadata,document.bytes,'Bearer company-a');
        expect([200,201]).toContain(response.status);
        const result = UploadResponseSchema.parse(await response.json());
        expect(result.evidenceIds).toEqual([]);
        const meta = UploadMetadataSchema.parse(document.metadata);
        files.push({fileId:result.fileId,documentId:result.documentId,documentVersion:result.documentVersion,
          sha256:result.contentHash,kind:meta.kind,...meta.batch});
      }
      const completeManifest = manifest(1,files);
      await publishBaseline(dependencies,companyA,completeManifest,[record]);
      expect((await system.db.control.query('SELECT evidence_id FROM source_evidence')).rowCount).toBe(0);
      const [captured,repeated] = await Promise.all([
        captureBaseline(dependencies,completeManifest.id),captureBaseline(dependencies,completeManifest.id),
      ]);
      expect(captured.ok).toBe(true);
      expect(repeated).toEqual(captured);
      const request = (path:string,company='company-a') => fetch(system.control.origin + path,{
        headers:{authorization:'Bearer ' + company},
      });
      const citations = await Promise.all(captured.dossier.evidenceIds.map(async evidenceId=>
        EvidenceResponseSchema.parse(await (await request('/api/evidence/' + evidenceId)).json())));
      for (const document of documents) {
        const citation = citations.find(item=>item.evidence.locator.kind === document.kind)!;
        expect(citation.evidence.snapshotId).toBe('snapshot:' + completeManifest.id);
        expect(citation.evidence.excerpt).toBe(document.excerpt);
        expect(citation.original.sha256).toBe(hashBytes(document.bytes));
        expect(citation.text.sha256).toBe(hashBytes(Buffer.from(citation.text.value)));
        expect(Buffer.from(await (await request(citation.original.url)).arrayBuffer())).toEqual(Buffer.from(document.bytes));
        expect((await request(citation.original.url,'company-b')).status).toBe(403);
      }
      const evidenceId = citations.find(item=>item.evidence.locator.kind === 'json')!.evidence.id;
      const evidencePath = '/api/evidence/' + evidenceId;
      const evidence = EvidenceResponseSchema.parse(await (await request(evidencePath)).json());
      expect(evidence.evidence.locator).toEqual({kind:'json',pointer:''});
      expect(evidence.evidence.excerpt).toBe(canonicalJson(event.payload));
      expect(evidence.original.sha256).toBe(hashBytes(apiOriginal));
      expect(evidence.text.sha256).toBe(hashBytes(Buffer.from(canonicalJson(event.payload))));
      expect(evidence.evidence.sourceId).toBe(record.original?.id);
      expect((await request(evidencePath,'company-b')).status).toBe(403);
      expect((await request(evidence.original.url,'company-b')).status).toBe(403);
      expect(Buffer.from(await (await request(evidence.original.url)).arrayBuffer())).toEqual(apiOriginal);
      expect((await request('/api/evidence/missing')).status).toBe(404);
      const missingManifest = manifest(2,[{
        fileId:'missing-pdf',documentId:'missing-doc',documentVersion:1,kind:'contract_pdf',sha256:hashBytes(original),
      }]);
      await publishBaseline(dependencies,companyA,missingManifest,[record]);
      const missing = await captureBaseline(dependencies,missingManifest.id);
      expect(missing.ok).toBe(false);
      const dossierPath = '/api/sources/company-a/dossier';
      const latest = SourceDossierSchema.parse(await (await request(dossierPath)).json());
      expect(latest.manifestId).toBe(missingManifest.id);
      expect(latest.complete).toBe(false);
      expect(latest.missingMembers).toEqual(['missing-pdf']);
      const pinned = SourceDossierSchema.parse(await (await request(dossierPath + '?manifestId=' + completeManifest.id)).json());
      expect(pinned.complete).toBe(true);
      expect(pinned.evidenceIds).toEqual(captured.dossier.evidenceIds);
      expect((await request('/api/sources/company-b/dossier?manifestId=' + completeManifest.id,'company-b')).status).toBe(404);

    } finally {
      await system.close();
      await rm(root,{recursive:true,force:true});
    }
  });
});
