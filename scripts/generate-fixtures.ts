import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  BootstrapManifestSchema, UploadMetadataSchema, canonicalJson, hashBytes, hashCanonical, hashManifest,
  type Id, type IsoInstant, type ManifestFile, type UploadMetadata,
} from '@eapr/contracts';
import { companyA } from '../packages/sources/src/company-a.js';
import { sourceFileId } from '../packages/sources/src/uploads.js';
import { fixtureA, fixtureB, textPdf } from '../packages/sources/src/canonical-fixtures.js';

import { companyB, encodeBatch } from '../packages/sources/src/company-b.js';
import { streamContentHash } from '../packages/sources/src/dossier.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
function contains(parent: string, child: string) {
  const rel = relative(parent,child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}

async function physicalDestination(path: string): Promise<string> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Fixture output must be a directory');
    const physical = await realpath(path);
    return physical;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    return join(await physicalDestination(resolve(path,'..')),relative(resolve(path,'..'),path));
  }
}

function disjoint(a: string,b: string) {
  if (contains(a,b) || contains(b,a)) throw new Error('Visible and protected fixture roots must be disjoint');
}

export async function generateFixtures(input: {seed:Id; asOf:IsoInstant; visibleRoot:string; truthRoot:string}) {
  if (!input.visibleRoot || !input.truthRoot) throw new Error('Both output roots are required');
  const visible = await physicalDestination(resolve(input.visibleRoot));
  const truth = await physicalDestination(resolve(input.truthRoot));
  disjoint(visible,truth);
  for (const served of ['fixtures/visible','apps/web','fixtures/truth']) {
    const servedRoot = await physicalDestination(join(repositoryRoot,served));
    if (served === 'fixtures/truth') disjoint(visible,servedRoot);
    else disjoint(truth,servedRoot);
  }
  const fixture = fixtureA(input.seed,input.asOf);
  await mkdir(visible,{recursive:true,mode:0o700});
  await mkdir(truth,{recursive:true,mode:0o700});
  const files: ManifestFile[] = [];
  const uploads: {metadata:UploadMetadata; path:string}[] = [];
  const expectedEvidence: {fileId:Id; text:string}[] = [];
  async function emit(name:string, bytes:Uint8Array, kind:UploadMetadata['kind'], text:string) {
    const documentId = 'doc-a-' + fixture.tag + '-' + name.split('.')[0];
    const metadata = UploadMetadataSchema.parse({
      companyId:companyA.companyId,sourceRef:companyA.sourceRef,documentId,documentVersion:1,kind,originalName:name,
    });
    const fileId = sourceFileId(metadata);
    const sha256 = hashBytes(bytes);
    await writeFile(join(visible,name),bytes,{flag:'wx'});
    files.push({fileId,documentId,documentVersion:1,kind,sha256});
    uploads.push({metadata,path:name});
    expectedEvidence.push({fileId,text});
  }
  for (const [index,account] of fixture.accounts.entries()) {
    const title = 'Fixed monthly agreement ' + account.contractId;
    const lines = [title, 'Seller seller-a; buyer ' + account.entityId + '; account ' + account.accountId,
      'Legal name ' + account.displayName, 'Monthly fee USD ' + fixture.initialRates[index],
      'Effective ' + fixture.month(-3) + '; monthly invoice anchor day 1.'];
    await emit('contract-' + (index+1) + '.pdf',await textPdf(lines,fixture.asOf,title),'contract_pdf',lines.join(' '));
  }
  const amended = fixture.accounts[1]!;
  const amendment = ['Executed amendment to ' + amended.contractId,
    'Seller seller-a and buyer ' + amended.entityId + ' agree.',
    'Effective ' + fixture.amendmentEffective + ', replace monthly fee with USD ' + fixture.amendedRate + '.',
    'Signed by both parties.'];
  await emit('amendment.pdf', await textPdf(amendment,fixture.asOf,amendment[0]!),'amendment_pdf',amendment.join(' '));
  const body = 'Seller seller-a reports separate customer accounts: ' +
    fixture.accounts.map(account => account.accountId + ' belongs to ' + account.entityId).join('; ') + '. Currency USD.';
  await emit('account-directory.json',Buffer.from(canonicalJson({messageId:'msg-a-' + fixture.tag,body})),'email_json',body);
  const id = 'manifest-a-' + fixture.tag + '-' + hashCanonical(fixture.asOf).slice(0,12);
  const manifest = {
    id, companyId:companyA.companyId, sourceRef:companyA.sourceRef, epoch:1, asOf:fixture.asOf,
    schemaVersions:Object.fromEntries(companyA.contracts.map(contract=>[contract.resource,contract.schemaVersion])),
    semanticVersions:Object.fromEntries(fixture.accounts.map((account,index) =>
      ['seller-a/' + account.accountId,index === 1 ? 'sem-a-2' : 'sem-a-1'])),
    streams:companyA.streams.map(({streamId}) => {
      const events = fixture.events.filter(event => event.streamId === streamId);
      const resumeAfter = String(events.length);
      const eventIds = events.map(event => event.id);
      const snapshotHash = hashCanonical({sourceRef:companyA.sourceRef,streamId,resumeAfter,
        events:events.map(({id,contentHash})=>({id,contentHash}))});
      return {streamId,snapshotId:'member:' + id + ':' + streamId,resumeAfter,eventIds,snapshotHash};
    }),
    files,
  };
  const pinned = BootstrapManifestSchema.parse({...manifest,hash:hashManifest(manifest)});
  const apiOriginals: {eventId:Id;path:string}[] = [];
  await mkdir(join(visible,'api-a'),{mode:0o700});
  for (const event of fixture.events) {
    const path = 'api-a/' + hashCanonical(event.id) + '.json';
    const bytes = Buffer.from(canonicalJson(event.payload));
    await writeFile(join(visible,path),bytes,{flag:'wx'});
    apiOriginals.push({eventId:event.id,path});
  }
  const jsonFiles = {
    'api-a.json': fixture.events, 'api-originals-a.json':apiOriginals, 'accounts-a.json':fixture.accounts, 'manifest-a.json':pinned, 'uploads-a.json':uploads,
  };
  for (const [name,value] of Object.entries(jsonFiles)) {
    await writeFile(join(visible,name),canonicalJson(value),{flag:'wx'});
  }
  await writeFile(join(truth,'expected-a.json'),canonicalJson({
    seed:input.seed, asOf:fixture.asOf, expectedEvidence,
    expectedExplainedAccount:fixture.accounts[0]!.accountId, expectedOutstandingCents:80000,
  }),{flag:'wx',mode:0o600});
  const b = await writeCompanyB(visible,truth,input.seed,input.asOf);
  return {
    manifestIds:[pinned.id,b.id], manifestHashes:[pinned.hash,b.hash], fileCount:files.length+b.fileCount,eventCount:fixture.events.length+b.eventCount,
    visiblePaths:[...uploads.map(upload=>upload.path),...Object.keys(jsonFiles),...apiOriginals.map(item=>item.path),...b.paths],
  };
}


async function writeCompanyB(visible:string,truth:string,seed:Id,asOf:IsoInstant) {
  const fixture = fixtureB(seed,asOf);
  const files: ManifestFile[] = [];
  const uploads: {metadata:UploadMetadata;path:string}[] = [];
  const expectedEvidence: {fileId:Id;text:string}[] = [];
  async function emit(
    name:string,bytes:Uint8Array,kind:UploadMetadata['kind'],batch?:UploadMetadata['batch'],text?:string,
  ) {
    const documentId = 'doc-b-' + fixture.tag + '-' + name.split('.')[0];
    const metadata = UploadMetadataSchema.parse({
      companyId:companyB.companyId,sourceRef:companyB.sourceRef,
      documentId,documentVersion:1,kind,originalName:name,...(batch ? {batch} : {}),
    });
    const fileId = sourceFileId(metadata);
    const sha256 = hashBytes(bytes);
    const manifestBatch = batch ? {batchId:batch.batchId,streamId:batch.streamId,sequence:batch.sequence} : {};
    files.push({fileId,documentId,documentVersion:1,kind,sha256,...manifestBatch});
    uploads.push({metadata,path:name});
    if (text !== undefined) expectedEvidence.push({fileId,text});
    await writeFile(join(visible,name),bytes,{flag:'wx'});
  }
  for (const [index,batch] of fixture.files.entries()) {
    const sequence = index + 1;
    await emit('b-batch-' + sequence + '.csv',encodeBatch(batch),'event_csv',
      {batchId:'batch-b-' + fixture.tag + '-' + sequence,sequence,streamId:'b-files'});
  }
  for (const [index,account] of fixture.accounts.entries()) {
    const title = 'Fixed monthly agreement ' + account.contractId;
    const lines = [title,'Seller seller-b; buyer ' + account.entityId + '; account ' + account.accountId,
      'Legal name ' + account.displayName,
      'Monthly fee USD ' + (fixture.fees[index]!/100).toFixed(2) + ' effective ' + fixture.month(-3) + '.',
      'Monthly invoice anchor day 1.'];
    await emit('b-contract-' + (index+1) + '.pdf',await textPdf(lines,fixture.asOf,title),
      'contract_pdf',undefined,lines.join(' '));
  }
  const body = 'Wire receipt ' + fixture.ambiguous.recordId + ', USD 300.00; client code ' +
    fixture.ambiguous.rawIdentity.sourceAccountId + '. Buyer and invoice reference absent.';
  await emit('b-remittance.json',Buffer.from(canonicalJson({messageId:'msg-b-remittance-' + fixture.tag,body})),
    'email_json',undefined,body);

  const id = 'manifest-b-' + fixture.tag + '-' + hashCanonical(fixture.asOf).slice(0,12);
  const events = [...fixture.files.flat(),...fixture.receipts];
  const manifest = {
    id,companyId:companyB.companyId,sourceRef:companyB.sourceRef,epoch:1,asOf:fixture.asOf,
    schemaVersions:Object.fromEntries(companyB.contracts.map(contract=>[contract.resource,contract.schemaVersion])),
    semanticVersions:Object.fromEntries(fixture.accounts.map(account=>['seller-b/' + account.accountId,'sem-b-1'])),
    streams:companyB.streams.map(({streamId})=>{
      const members = events.filter(event=>event.streamId === streamId);
      const resumeAfter = String(members.length);
      return {streamId,snapshotId:'member:' + id + ':' + streamId,resumeAfter,eventIds:members.map(event=>event.id),
        snapshotHash:streamContentHash(companyB.sourceRef,streamId,resumeAfter,members)};
    }),
    files,
  };
  const pinned = BootstrapManifestSchema.parse({...manifest,hash:hashManifest(manifest)});
  const apiOriginals: {eventId:Id;path:string}[] = [];
  await mkdir(join(visible,'api-b'),{mode:0o700});
  for (const event of fixture.receipts) {
    const path = 'api-b/' + hashCanonical(event.id) + '.json';
    await writeFile(join(visible,path),canonicalJson(event.payload),{flag:'wx'});
    apiOriginals.push({eventId:event.id,path});
  }
  const jsonFiles = {
    'api-b.json':fixture.receipts,'api-originals-b.json':apiOriginals,'accounts-b.json':fixture.accounts,
    'manifest-b.json':pinned,'uploads-b.json':uploads,
  };
  for (const [name,value] of Object.entries(jsonFiles)) {
    await writeFile(join(visible,name),canonicalJson(value),{flag:'wx'});
  }
  await writeFile(join(truth,'expected-b.json'),canonicalJson({
    seed,asOf:fixture.asOf,expectedEvidence,
    expectedUnresolvedEventId:fixture.ambiguous.id,expectedUnresolvedDiagnostic:'UNKNOWN_ACCOUNT',
  }),{flag:'wx',mode:0o600});
  return {
    id:pinned.id,hash:pinned.hash,fileCount:files.length,eventCount:events.length,
    paths:[...uploads.map(upload=>upload.path),...Object.keys(jsonFiles),...apiOriginals.map(item=>item.path)],
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const {values} = parseArgs({options:{
    seed:{type:'string'},'as-of':{type:'string'},'visible-root':{type:'string'},'truth-root':{type:'string'},
  }});
  if (!values.seed || !values['as-of'] || !values['visible-root'] || !values['truth-root']) {
    throw new Error('Required options: --seed --as-of --visible-root --truth-root');
  }
  console.log(JSON.stringify(await generateFixtures({
    seed:values.seed,asOf:values['as-of'],visibleRoot:values['visible-root'],truthRoot:values['truth-root'],
  })));
}
