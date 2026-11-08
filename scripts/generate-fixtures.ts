import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  BootstrapManifestSchema, UploadMetadataSchema, canonicalJson, hashBytes, hashCanonical, hashManifest,
  IsoDateSchema, MoneyCentsSchema, TransactionCentsSchema, type BootstrapManifest, type Id, type IsoInstant, type ManifestFile,
  type RawSourceEvent, type UploadMetadata,
} from '@eapr/contracts';
import { companyA } from '../packages/sources/src/company-a.js';
import { sourceFileId } from '../packages/sources/src/uploads.js';
import { fixtureA, fixtureB, textPdf, type ScenarioRecord } from '../packages/sources/src/canonical-fixtures.js';

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

async function requireNewTruthFile(path:string) {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Protected fixture output already exists');
}

type FixtureEvidence = {fileId:Id; originalSha256:string; text:string};

function ordered<T>(items:readonly T[], key:(item:T)=>string):T[] {
  if (new Set(items.map(key)).size !== items.length) throw new Error('Duplicate protected fixture member');
  return [...items].sort((a,b)=>key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

async function generatorBuildHash() {
  const paths = ['scripts/generate-fixtures.ts','packages/sources/src/canonical-fixtures.ts','package-lock.json'];
  return hashCanonical(await Promise.all(paths.map(async path=>({
    path, sha256:hashBytes(await readFile(join(repositoryRoot,path))),
  }))));
}

async function writeTruth(input:{
  path:string; company:'a'|'b'; seed:Id; tag:Id; buildHash:string; sellerEntityId:Id;
  manifest:BootstrapManifest; events:readonly RawSourceEvent[]; records:readonly ScenarioRecord[];
  evidence:readonly FixtureEvidence[]; anchoredAccount?:Id;
}) {
  const {manifest,events} = input;
  const inputEvents = ordered(events.map(({id,contentHash})=>({id,contentHash})),event=>event.id);
  const financial = new Map(ordered(events.filter(event=>event.kind !== 'semantic_change'),
    event=>event.kind + ':' + event.recordId).map(event=>[event.kind + ':' + event.recordId,event]));
  const records = ordered(input.records, record=>record.kind + ':' + record.recordId).map(record=>{
    const {sourceAccountId,effectiveDate,...facts} = record;
    const key = record.kind + ':' + record.recordId;
    const event = financial.get(key);
    if (!event || event.rawIdentity.sourceAccountId !== sourceAccountId ||
      event.effectiveAt !== effectiveDate + 'T00:00:00.000Z') throw new Error('Protected fixture member mismatch');
    financial.delete(key);
    return {sourceAccountId, record:{...facts,amountCents:TransactionCentsSchema.parse(facts.amountCents),
      sourceEventId:event.id,sourceRecordVersion:event.recordVersion,effectiveAt:event.effectiveAt,currency:'USD' as const}};
  });
  if (financial.size) throw new Error('Protected fixture member missing');
  const byAccount = new Map<Id, typeof records>();
  for (const item of records) {
    const bucket = byAccount.get(item.sourceAccountId) ?? [];
    bucket.push(item);
    byAccount.set(item.sourceAccountId,bucket);
  }
  const accounts = ordered([...byAccount].map(([sourceAccountId,bucket])=>({
    sourceAccountId, records:bucket.map(item=>item.record),
    balanceAnchorCents:sourceAccountId === input.anchoredAccount ? 80000 : null,
  })),account=>account.sourceAccountId);
  const preimage = {
    schemaVersion:1,fixtureSetId:'truth-' + input.company + ':' + input.tag + ':' + hashCanonical(manifest.asOf).slice(0,12),
    fixtureSetVersion:'1',purpose:'construction',generator:{seed:input.seed,buildHash:input.buildHash},
    companyId:manifest.companyId,sourceRef:manifest.sourceRef,sellerEntityId:input.sellerEntityId,asOf:manifest.asOf,
    manifestId:manifest.id,manifestHash:manifest.hash,inputEvents,accounts,
    evidence:ordered(input.evidence,evidence=>evidence.fileId),
  };
  const truth = {...preimage,hash:hashCanonical(preimage)};
  await writeFile(input.path,canonicalJson(truth),{flag:'wx',mode:0o600});
  return truth;
}

const currency = 'USD';
const cadence = 'monthly';
const anchorDay = 1;

type SupportField = 'sourceAccountId'|'sellerEntityId'|'buyerId'|'legalName'|'contractId'|
  'validFrom'|'validToExclusive'|'fixedMonthlyFeeCents'|'currency'|'cadence'|'anchorDay';
type Support = {field:SupportField;fileId:Id;expectedLiteral:string};
type Source = {companyId:Id;sourceRef:Id;sellerEntityId:Id};
type Account = ReturnType<typeof fixtureA>['accounts'][number];

function support(fileId:Id, expectedLiteral:string, ...fields:SupportField[]):Support[] {
  return fields.map(field=>({field,fileId,expectedLiteral}));
}

function identityFact(source:Source, account:Account, fileId:Id, partyLine:string, legalNameLine:string) {
  const {sellerEntityId} = source;
  const {accountId:sourceAccountId,entityId:buyerId,displayName:legalName} = account;
  return {
    id:'identity:' + hashCanonical({...source,sourceAccountId}),
    sourceAccountId,sellerEntityId,buyerId,legalName,
    support:[...support(fileId,partyLine,'sourceAccountId','sellerEntityId','buyerId'),
      ...support(fileId,legalNameLine,'legalName')],
  };
}

function contractFact(source:Source, account:Account, start:string, end:string|null, fee:number, support:Support[]) {
  const {sellerEntityId} = source;
  const {accountId:sourceAccountId,contractId} = account;
  const validFrom = IsoDateSchema.parse(start);
  const validToExclusive = end === null ? null : IsoDateSchema.parse(end);
  return {
    id:'term:' + hashCanonical({...source,sourceAccountId,contractId,validFrom}),
    sourceAccountId,sellerEntityId,contractId,validFrom,validToExclusive,
    fixedMonthlyFeeCents:MoneyCentsSchema.parse(fee),currency,cadence,anchorDay,support,
  };
}

async function writeEvidenceFacts(path:string, truth:Awaited<ReturnType<typeof writeTruth>>,
  identities:ReturnType<typeof identityFact>[], contracts:ReturnType<typeof contractFact>[]) {
  const {fixtureSetId,hash:producerTruthHash,generator,companyId,sourceRef,sellerEntityId,manifestId,manifestHash} = truth;
  function orderedFacts<T extends {id:Id;support:Support[]}>(facts:T[]) {
    return ordered(facts,fact=>fact.id).map(fact=>({...fact,support:ordered(fact.support,
      ({field,fileId,expectedLiteral})=>canonicalJson([field,fileId,expectedLiteral]))}));
  }
  const preimage = {
    schemaVersion:1,kind:'evidence-facts',fixtureSetId,producerFixtureSetVersion:'1',
    producerTruthHash,generator,companyId,sourceRef,sellerEntityId,manifestId,manifestHash,
    identities:orderedFacts(identities),contracts:orderedFacts(contracts),
  };
  const json = canonicalJson({...preimage,hash:hashCanonical(preimage)});
  if (Buffer.byteLength(json,'utf8') > 10*1024*1024) throw new Error('Protected evidence fixture exceeds size limit');
  await writeFile(path,json,{flag:'wx',mode:0o600});
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
  await Promise.all(['expected-a.json','expected-b.json','evidence-a.json','evidence-b.json'].map(name=>requireNewTruthFile(join(truth,name))));
  const buildHash = await generatorBuildHash();
  const fixture = fixtureA(input.seed,input.asOf);
  await mkdir(visible,{recursive:true,mode:0o700});
  await mkdir(truth,{recursive:true,mode:0o700});
  const files: ManifestFile[] = [];
  const uploads: {metadata:UploadMetadata; path:string}[] = [];
  const expectedEvidence: FixtureEvidence[] = [];
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
    expectedEvidence.push({fileId,originalSha256:sha256,text});
    return fileId;
  }
  const {companyId,sourceRef,sellerEntityId} = companyA;
  const source = {companyId,sourceRef,sellerEntityId};
  const identities: ReturnType<typeof identityFact>[] = [];
  const contracts: ReturnType<typeof contractFact>[] = [];
  const initialEffective = fixture.month(-3);
  const amended = fixture.accounts[1]!;
  const amendmentTitle = 'Executed amendment to ' + amended.contractId;
  const amendmentFee = 'Effective ' + fixture.amendmentEffective + ', replace ' + cadence + ' fee with ' +
    currency + ' ' + fixture.amendedRate + '.';
  const amendment = [amendmentTitle,'Seller ' + sellerEntityId + ' and buyer ' + amended.entityId + ' agree.',
    amendmentFee,'Signed by both parties.'];
  const initialAgreements = fixture.accounts.map((account,index)=>{
    const title = 'Fixed monthly agreement ' + account.contractId;
    const parties = 'Seller ' + sellerEntityId + '; buyer ' + account.entityId + '; account ' + account.accountId;
    const legalName = 'Legal name ' + account.displayName;
    const fee = 'Monthly fee ' + currency + ' ' + fixture.initialRates[index];
    const effective = 'Effective ' + initialEffective + '; ' + cadence + ' invoice anchor day ' + anchorDay + '.';
    return {account,title,parties,legalName,fee,effective,fixedMonthlyFeeCents:fixture.initialCents[index]!};
  });
  let amendedAgreement: {initial:ReturnType<typeof contractFact>; inherited:Support[]}|undefined;
  for (const [index,agreement] of initialAgreements.entries()) {
    const {account,title,parties,legalName,fee,effective,fixedMonthlyFeeCents} = agreement;
    const lines = [title,parties,legalName,fee,effective];
    const fileId = await emit('contract-' + (index+1) + '.pdf',
      await textPdf(lines,fixture.asOf,title),'contract_pdf',lines.join(' '));
    identities.push(identityFact(source,account,fileId,parties,legalName));
    const inherited = [...support(fileId,parties,'sourceAccountId','sellerEntityId'),
      ...support(fileId,effective,'cadence','anchorDay')];
    const isAmended = account === amended;
    const initial = contractFact(source,account,initialEffective,isAmended ? fixture.amendmentEffective : null,
      fixedMonthlyFeeCents,[...inherited,...support(fileId,title,'contractId'),...support(fileId,fee,'fixedMonthlyFeeCents','currency'),
        ...support(fileId,effective,'validFrom')]);
    contracts.push(initial);
    if (isAmended) amendedAgreement = {initial,inherited};
  }
  if (!amendedAgreement) throw new Error('Protected amendment agreement missing');
  const amendmentFileId = await emit('amendment.pdf',await textPdf(amendment,fixture.asOf,amendmentTitle),
    'amendment_pdf',amendment.join(' '));
  amendedAgreement.initial.support.push(...support(amendmentFileId,amendmentFee,'validToExclusive'));
  contracts.push(contractFact(source,amended,fixture.amendmentEffective,null,fixture.amendedCents,
    [...amendedAgreement.inherited,...support(amendmentFileId,amendmentTitle,'contractId'),
      ...support(amendmentFileId,amendmentFee,'validFrom','fixedMonthlyFeeCents','currency')]));
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
  const financialTruth = await writeTruth({
    path:join(truth,'expected-a.json'),company:'a',seed:input.seed,tag:fixture.tag,buildHash,
    sellerEntityId:companyA.sellerEntityId,manifest:pinned,events:fixture.events,records:fixture.records,
    evidence:expectedEvidence,anchoredAccount:fixture.accounts[0]!.accountId,
  });
  await writeEvidenceFacts(join(truth,'evidence-a.json'),financialTruth,identities,contracts);
  const b = await writeCompanyB(visible,truth,input.seed,input.asOf,buildHash);
  return {
    manifestIds:[pinned.id,b.id], manifestHashes:[pinned.hash,b.hash], fileCount:files.length+b.fileCount,eventCount:fixture.events.length+b.eventCount,
    visiblePaths:[...uploads.map(upload=>upload.path),...Object.keys(jsonFiles),...apiOriginals.map(item=>item.path),...b.paths],
  };
}


async function writeCompanyB(visible:string,truth:string,seed:Id,asOf:IsoInstant,buildHash:string) {
  const fixture = fixtureB(seed,asOf);
  const files: ManifestFile[] = [];
  const uploads: {metadata:UploadMetadata;path:string}[] = [];
  const expectedEvidence: FixtureEvidence[] = [];
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
    if (text !== undefined) expectedEvidence.push({fileId,originalSha256:sha256,text});
    await writeFile(join(visible,name),bytes,{flag:'wx'});
    return fileId;
  }
  for (const [index,batch] of fixture.files.entries()) {
    const sequence = index + 1;
    await emit('b-batch-' + sequence + '.csv',encodeBatch(batch),'event_csv',
      {batchId:'batch-b-' + fixture.tag + '-' + sequence,sequence,streamId:'b-files'});
  }
  const {companyId,sourceRef,sellerEntityId} = companyB;
  const source = {companyId,sourceRef,sellerEntityId};
  const identities: ReturnType<typeof identityFact>[] = [];
  const contracts: ReturnType<typeof contractFact>[] = [];
  const validFrom = fixture.month(-3);
  for (const [index,account] of fixture.accounts.entries()) {
    const title = 'Fixed monthly agreement ' + account.contractId;
    const parties = 'Seller ' + sellerEntityId + '; buyer ' + account.entityId + '; account ' + account.accountId;
    const legalName = 'Legal name ' + account.displayName;
    const fixedMonthlyFeeCents = fixture.fees[index]!;
    const fee = 'Monthly fee ' + currency + ' ' + (fixedMonthlyFeeCents/100).toFixed(2) + ' effective ' + validFrom + '.';
    const schedule = 'Monthly invoice anchor day ' + anchorDay + '.';
    const lines = [title,parties,legalName,fee,schedule];
    const fileId = await emit('b-contract-' + (index+1) + '.pdf',await textPdf(lines,fixture.asOf,title),
      'contract_pdf',undefined,lines.join(' '));
    identities.push(identityFact(source,account,fileId,parties,legalName));
    contracts.push(contractFact(source,account,validFrom,null,fixedMonthlyFeeCents,[
      ...support(fileId,title,'contractId'),...support(fileId,parties,'sourceAccountId','sellerEntityId'),
      ...support(fileId,fee,'fixedMonthlyFeeCents','currency','validFrom'),...support(fileId,schedule,'cadence','anchorDay'),
    ]));
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
  const financialTruth = await writeTruth({
    path:join(truth,'expected-b.json'),company:'b',seed,tag:fixture.tag,buildHash,
    sellerEntityId:companyB.sellerEntityId,manifest:pinned,events,records:fixture.records,evidence:expectedEvidence,
  });
  await writeEvidenceFacts(join(truth,'evidence-b.json'),financialTruth,identities,contracts);
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
