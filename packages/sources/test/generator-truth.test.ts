import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
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
