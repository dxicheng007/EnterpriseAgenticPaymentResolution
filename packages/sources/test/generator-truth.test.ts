import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  BootstrapManifestSchema, CustomerProfileSchema, RawSourceEventSchema, canonicalJson,
  hashBytes, hashCanonical, hashProfile,
} from '@eapr/contracts';
import { generateFixtures } from '../../../scripts/generate-fixtures.js';
import { bindTruth, decodeTruth, verifyTruthMembers } from '../../evaluator/src/fixtures.js';
import { extractDocument } from '../../evidence/src/extract.js';
import { decodeBatch } from '../src/company-b.js';
import { profileA, profileB } from '../../../tests/fixtures/index.js';

const seed = 'baseline-v1';
const asOf = '2026-11-08T12:00:00.000Z';
let root:string;
type Company = 'a'|'b';

async function generate(name:string, fixtureSeed = seed) {
  const visible = join(root,name,'visible');
  const privateRoot = join(root,name,'truth');
  const summary = await generateFixtures({seed:fixtureSeed,asOf,visibleRoot:visible,truthRoot:privateRoot});
  return {visible,privateRoot,summary};
}

async function readCompany(fixture:Awaited<ReturnType<typeof generate>>, company:Company) {
  const {visible,privateRoot} = fixture;
  const path = join(privateRoot,'expected-' + company + '.json');
  const text = await readFile(path,'utf8');
  const truth = decodeTruth(text);
  const manifest = BootstrapManifestSchema.parse(JSON.parse(await readFile(join(visible,'manifest-' + company + '.json'),'utf8')));
  const events = RawSourceEventSchema.array().parse(JSON.parse(await readFile(join(visible,'api-' + company + '.json'),'utf8')));
  const uploads: {metadata:{kind:'contract_pdf'|'amendment_pdf'|'email_json'|'event_csv'};path:string}[] =
    JSON.parse(await readFile(join(visible,'uploads-' + company + '.json'),'utf8'));
  for (const upload of uploads.filter(upload=>upload.metadata.kind === 'event_csv')) {
    const {document} = await extractDocument('event_csv',await readFile(join(visible,upload.path)));
    events.push(...decodeBatch('b-files',document));
  }
  const accounts: {accountId:string}[] = JSON.parse(await readFile(join(visible,'accounts-' + company + '.json'),'utf8'));
  const snapshot = {eventIds:manifest.streams.flatMap(stream=>stream.eventIds)};
  return {path,text,truth,manifest,events,uploads,accounts,snapshot};
}

let original:Awaited<ReturnType<typeof generate>>;
beforeAll(async ()=>{
  root = await mkdtemp(join(tmpdir(),'eapr-generator-truth-'));
  original = await generate('original');
});
afterAll(async ()=>{ if (root) await rm(root,{recursive:true,force:true}); });

it('generator_truth_v1_both_companies',async ()=>{
  const buildPaths = ['scripts/generate-fixtures.ts','packages/sources/src/canonical-fixtures.ts','package-lock.json'];
  const buildHash = hashCanonical(await Promise.all(buildPaths.map(async path=>({
    path,sha256:hashBytes(await readFile(path)),
  }))));
  for (const company of ['a','b'] as const) {
    const {truth,path,text,manifest,uploads} = await readCompany(original,company);
    expect(truth).toMatchObject({schemaVersion:1,fixtureSetVersion:'1',purpose:'construction',
      companyId:manifest.companyId,sourceRef:manifest.sourceRef,asOf,generator:{seed,buildHash}});
    const {hash,...preimage} = truth;
    expect(hashCanonical(preimage)).toBe(hash);
    expect(canonicalJson(truth)).toBe(text);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    const knownEvidence = uploads.filter(upload=>upload.metadata.kind !== 'event_csv');
    expect(truth.evidence.map(item=>item.originalSha256).toSorted()).toEqual((await Promise.all(
      knownEvidence.map(async upload=>hashBytes(await readFile(join(original.visible,upload.path)))),
    )).toSorted());
    expect(truth.evidence.every(item=>item.text.length > 0)).toBe(true);
  }
  const {privateRoot,summary} = original;
  expect(Object.keys(summary).toSorted()).toEqual(['eventCount','fileCount','manifestHashes','manifestIds','visiblePaths']);
  expect(JSON.stringify(summary)).not.toContain(privateRoot);
  expect(JSON.stringify(summary)).not.toContain('expected-');
  const {stdout} = await promisify(execFile)(process.execPath,['--import','tsx','scripts/generate-fixtures.ts',
    '--seed',seed,'--as-of',asOf,'--visible-root',join(root,'cli','visible'),'--truth-root',join(root,'cli','truth')]);
  expect(JSON.parse(stdout)).toEqual(summary);
});

it('generator_truth_repeatable',async ()=>{
  const repeated = await generate('repeated');
  for (const company of ['a','b'] as const) {
    const first = await readCompany(original,company);
    const second = await readCompany(repeated,company);
    expect(second.text).toBe(first.text);
    expect(await readFile(second.path,'utf8')).toBe(first.text);
  }
  const unusedVisible = join(root,'must-not-be-written');
  await expect(generateFixtures({seed,asOf,visibleRoot:unusedVisible,truthRoot:repeated.privateRoot}))
    .rejects.toThrow('Protected fixture output already exists');
  await expect(lstat(unusedVisible)).rejects.toMatchObject({code:'ENOENT'});
  for (const company of ['a','b'] as const) {
    expect((await readCompany(repeated,company)).text).toBe((await readCompany(original,company)).text);
  }
});

it('generator_truth_seed_changes_facts',async ()=>{
  const other = await generate('other','baseline-v1-other');
  for (const company of ['a','b'] as const) {
    const {truth:first} = await readCompany(original,company);
    const {truth:second,text} = await readCompany(other,company);
    const amounts = (truth:typeof first)=>truth.accounts.flatMap(account=>account.records
      .flatMap(record=>record.kind === 'invoice' ? [record.amountCents] : [])).toSorted();
    expect(amounts(second)).not.toEqual(amounts(first));
    expect(second.generator.buildHash).toBe(first.generator.buildHash);
    const {hash,fixtureSetId,fixtureSetVersion} = first;
    expect(()=>decodeTruth(text,{hash,fixtureSetId,fixtureSetVersion})).toThrow('Protected fixture invalid');
    expect(()=>decodeTruth(canonicalJson({...second,fixtureSetId,fixtureSetVersion}),{hash,fixtureSetId,fixtureSetVersion}))
      .toThrow('Protected fixture invalid');
  }
});

it('generator_truth_covers_exact_manifest_events',async ()=>{
  for (const company of ['a','b'] as const) {
    const {truth,manifest,events,snapshot} = await readCompany(original,company);
    expect(()=>verifyTruthMembers(truth,manifest,snapshot,events)).not.toThrow();
    expect(()=>verifyTruthMembers(truth,{...manifest,hash:'0'.repeat(64)},snapshot,events)).toThrow('Protected fixture invalid');
    const [event,...rest] = events;
    expect(()=>verifyTruthMembers(truth,manifest,snapshot,[{...event!,contentHash:'0'.repeat(64)},...rest]))
      .toThrow('Protected fixture invalid');
  }
});

it('generator_truth_unknown_b_stays_unbound',async ()=>{
  for (const company of ['a','b'] as const) {
    const {truth,manifest,events,accounts,snapshot} = await readCompany(original,company);
    const {hash:_,...base} = company === 'a' ? profileA : profileB;
    const sourceAccountId = accounts[0]!.accountId;
    const profileInput = {...base,sourceAccountIds:[sourceAccountId],
      approvedLookups:base.approvedLookups.map(lookup=>({...lookup,entries:lookup.entries.map(entry=>({...entry,source:sourceAccountId}))}))};
    const profile = CustomerProfileSchema.parse({...profileInput,hash:hashProfile(profileInput)});
    const [binding] = bindTruth(truth,[profile]);
    expect(binding?.reference.balanceCents).toBe(company === 'a' ? 80000 : 0);
    if (company === 'a') continue;

    const unknown = events.find(event=>event.recordId.startsWith('pay-b:unresolved-'))!;
    const rawId = unknown.rawIdentity.sourceAccountId!;
    expect(accounts.map(account=>account.accountId)).not.toContain(rawId);
    const bucket = truth.accounts.find(account=>account.sourceAccountId === rawId)!;
    expect(bucket.balanceAnchorCents).toBeNull();
    expect(bucket.records).toEqual([expect.objectContaining({kind:'payment',amountCents:30000,sourceEventId:unknown.id})]);
    expect(binding?.target.payments.map(payment=>payment.sourceEventId)).not.toContain(unknown.id);
    const known = truth.accounts.filter(account=>account !== bucket);
    expect(()=>verifyTruthMembers({...truth,accounts:known},manifest,snapshot,events)).toThrow('Protected fixture invalid');
    const guessed = known.map(account=>account.sourceAccountId === sourceAccountId
      ? {...account,records:[...account.records,...bucket.records]} : account);
    expect(()=>verifyTruthMembers({...truth,accounts:guessed},manifest,snapshot,events)).toThrow('Protected fixture invalid');
  }
});

it('generator_truth_preserves_visible_bytes',async ()=>{
  const files = (await readdir(original.visible,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile());
  const byteHashes = Object.fromEntries(await Promise.all(files.map(async entry=>{
    const path = join(entry.parentPath,entry.name);
    return [path.slice(original.visible.length + 1),hashBytes(await readFile(path))];
  })));
  // Frozen before the refactor from c926c35, whose generator sources match 851e80d.
  expect(files).toHaveLength(62);
  expect(hashCanonical(byteHashes)).toBe('19baef7b9c245c52e6f0282f17c99ecdd691d8456f53ea29874072c1daa3b4f7');
});

it('generator_truth_roots_disjoint',async ()=>{
  await expect(generateFixtures({seed,asOf,visibleRoot:original.visible,truthRoot:join(original.visible,'protected')}))
    .rejects.toThrow('must be disjoint');
  await expect(generateFixtures({seed,asOf,visibleRoot:join(root,'unused'),truthRoot:'apps/web/public/protected'}))
    .rejects.toThrow('must be disjoint');
  const links = join(root,'links');
  await mkdir(links);
  await symlink(original.visible,join(links,'visible'),'dir');
  await expect(generateFixtures({seed,asOf,visibleRoot:original.visible,truthRoot:join(links,'visible','protected')}))
    .rejects.toThrow();
});

it('generator_truth_no_subject_imports',async ()=>{
  for (const path of ['scripts/generate-fixtures.ts','packages/sources/src/canonical-fixtures.ts']) {
    expect(await readFile(path,'utf8')).not.toMatch(/from\s+['"][^'"]*(?:evaluator|compiler|finance|runtime)(?:[/.'"])/);
  }
});

it('writes deterministic private identity and contract facts bound to freshly generated v1 truth',async ()=>{
  const repeated = await generate('evidence-repeat');
  for (const company of ['a','b'] as const) {
    const name = 'evidence-' + company + '.json';
    expect(await readdir(original.privateRoot)).toContain(name);
    const path = join(original.privateRoot,name);
    const json = await readFile(path,'utf8');
    const {hash,identities,contracts,...metadata} = JSON.parse(json);
    const {truth,events,accounts} = await readCompany(original,company);
    const {fixtureSetId,generator,companyId,sourceRef,sellerEntityId,manifestId,manifestHash} = truth;
    expect(metadata).toEqual({schemaVersion:1,kind:'evidence-facts',fixtureSetId,producerFixtureSetVersion:'1',
      producerTruthHash:truth.hash,generator,companyId,sourceRef,sellerEntityId,manifestId,manifestHash});
    expect(hash).toBe(hashCanonical({...metadata,identities,contracts}));
    expect(json).toBe(canonicalJson({...metadata,identities,contracts,hash}));
    expect(json).toBe(await readFile(join(repeated.privateRoot,name),'utf8'));
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    expect(original.summary.visiblePaths).not.toContain(name);
    expect(identities.map((fact:{sourceAccountId:string})=>fact.sourceAccountId).sort())
      .toEqual(accounts.map(account=>account.accountId).sort());
    const second = identities.find((fact:{sourceAccountId:string})=>fact.sourceAccountId === accounts[1]!.accountId);
    const third = identities.find((fact:{sourceAccountId:string})=>fact.sourceAccountId === accounts[2]!.accountId);
    expect(second.legalName).toBe(third.legalName);
    expect(second.buyerId).not.toBe(third.buyerId);
    const unknown = events.find(event=>event.recordId.startsWith('pay-b:unresolved-'));
    if (unknown) expect(contracts.map((fact:{sourceAccountId:string})=>fact.sourceAccountId))
      .not.toContain(unknown.rawIdentity.sourceAccountId);

    for (const facts of [identities,contracts]) {
      const ids = facts.map((fact:{id:string})=>fact.id);
      expect(ids).toEqual([...new Set(ids)].sort());
      for (const fact of facts) {
        const scope = {companyId,sourceRef,sellerEntityId,sourceAccountId:fact.sourceAccountId};
        expect(fact.sellerEntityId).toBe(sellerEntityId);
        expect(fact.id).toBe(fact.contractId
          ? 'term:' + hashCanonical({...scope,contractId:fact.contractId,validFrom:fact.validFrom})
          : 'identity:' + hashCanonical(scope));
        const keys = fact.support.map(({field,fileId,expectedLiteral}:{field:string;fileId:string;expectedLiteral:string})=>
          canonicalJson([field,fileId,expectedLiteral]));
        expect(keys).toEqual([...new Set(keys)].sort());
        for (const {fileId,expectedLiteral} of fact.support) {
          expect(truth.evidence.find(file=>file.fileId === fileId)?.text).toContain(expectedLiteral);
        }
        expect(fact.support.map(({field}:{field:string})=>field)).toEqual(fact.contractId
          ? ['anchorDay','cadence','contractId','currency','fixedMonthlyFeeCents','sellerEntityId','sourceAccountId',
            'validFrom',...(fact.validToExclusive === null ? [] : ['validToExclusive'])]
          : ['buyerId','legalName','sellerEntityId','sourceAccountId']);
      }
    }
    expect(contracts).toHaveLength(company === 'a' ? 4 : 3);
    const first = contracts.find((fact:{sourceAccountId:string})=>fact.sourceAccountId === accounts[0]!.accountId);
    expect(first).toMatchObject({validFrom:'2026-08-01',validToExclusive:null,fixedMonthlyFeeCents:300000,
      currency:'USD',cadence:'monthly',anchorDay:1});
    if (company === 'a') {
      const terms = contracts.filter((fact:{sourceAccountId:string})=>fact.sourceAccountId === accounts[1]!.accountId)
        .sort((a:{validFrom:string},b:{validFrom:string})=>a.validFrom < b.validFrom ? -1 : 1);
      const initialFee = 170000 + parseInt(hashCanonical(seed).slice(0,2),16)*100;
      expect(terms).toMatchObject([
        {validFrom:'2026-08-01',validToExclusive:'2026-10-01',fixedMonthlyFeeCents:initialFee},
        {validFrom:'2026-10-01',validToExclusive:null,fixedMonthlyFeeCents:initialFee + 20000},
      ]);
      expect(terms[0].support.find(({field}:{field:string})=>field === 'validToExclusive'))
        .toEqual({...terms[1].support.find(({field}:{field:string})=>field === 'validFrom'),field:'validToExclusive'});
    }
  }
});

it('preserves a pre-existing evidence companion before writing fixture outputs',async ()=>{
  const truthRoot = join(root,'existing-companion');
  const visibleRoot = join(root,'unused-visible');
  await mkdir(truthRoot);
  const path = join(truthRoot,'evidence-b.json');
  await writeFile(path,'previous private data');
  await expect(generateFixtures({seed,asOf,visibleRoot,truthRoot})).rejects.toThrow('Protected fixture output already exists');
  await expect(lstat(visibleRoot)).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(path,'utf8')).toBe('previous private data');
});
