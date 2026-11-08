import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { canonicalJson, FindingSchema, hashArtifact, hashBytes, hashCanonical, hashManifest, hashPlan, hashProfile, VerificationReportSchema,
  type CompiledArtifact, type CustomerProfile, type EvidenceResponse, type PlanOutcome } from '@eapr/contracts';
import { createEvidenceStore, extractDocument } from '@eapr/evidence';
import { decodeBatch, encodeBatch } from '../../packages/sources/src/company-b.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { decodeEvidenceProducer, decodeProtectedEvidenceBundle, type EvidenceFixtureInput, type EvidenceInputV1 } from '../../packages/evaluator/src/evidence-fixtures.js';
import { buildCasePlan, runCasePlan } from '../../packages/evaluator/src/cases.js';
import { checkContractTerms, checkEvidenceSupport, type CapturedEvidenceRun } from '../../packages/evaluator/src/evidence-support.js';
import { pinProtectedEvidenceFixture, pinProtectedFixture, readProtectedFixture } from '../../packages/evaluator/src/fixture-store.js';
import { bindTruth, decodeTruth } from '../../packages/evaluator/src/fixtures.js';
import { createProtectedVerificationLauncher, validateReport } from '../../packages/evaluator/src/verify.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { captureEvidenceFixture } from '../fixtures/evidence-v2-capture.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

const fixedRoot = new URL('../../.local/protected-evaluator/', import.meta.url);
const pathFor = (root: URL, id: string, version: string) => new URL(hashCanonical([id, version]) + '.json', root);

function recalcAggregate(input: EvidenceFixtureInput) {
  const { manifest, snapshot } = input;
  const sort = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const streams = [...manifest.streams].sort((a, b) => sort(a.streamId, b.streamId))
    .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash }));
  const files = [...manifest.files].sort((a, b) => sort(a.fileId, b.fileId)).map(({ fileId, sha256 }) => ({ fileId, sha256 }));
  snapshot.contentHash = hashCanonical({
    manifestHash: manifest.hash, streams, files, eventIds: [...snapshot.eventIds].sort(sort),
    evidenceIds: [...snapshot.evidenceIds].sort(sort),
  });
}

function updateCitationRange(input: EvidenceFixtureInput, citation: EvidenceResponse, start: number, end: number) {
  const ref = citation.evidence;
  if (ref.locator.kind !== 'pdf') throw new Error('Expected PDF evidence for range mutation');
  const oldId = ref.id;
  const locator = { ...ref.locator, start, end };
  ref.locator = locator;
  ref.id = 'ev:' + hashCanonical({ snapshotId: ref.snapshotId, sourceId: ref.sourceId, locator });
  ref.excerpt = citation.text.value.slice(start, end);
  citation.original.url = '/api/evidence/' + ref.id + '/content';
  citation.text.startInclusive = start;
  citation.text.endExclusive = end;
  citation.text.sha256 = hashBytes(Buffer.from(citation.text.value));
  input.snapshot.evidenceIds = input.snapshot.evidenceIds.map(id => id === oldId ? ref.id : id);
  for (const support of input.resolvedSupport) if (support.evidenceId === oldId) support.evidenceId = ref.id;
  recalcAggregate(input);
}

function replaceOriginalBytes(input: EvidenceFixtureInput, sourceId: string, bytes: Uint8Array, textFor: (citation: EvidenceResponse) => string) {
  const item = input.originals.find(original => original.sourceId === sourceId)!;
  const sha256 = hashBytes(bytes);
  item.bytesBase64 = Buffer.from(bytes).toString('base64');
  item.sha256 = sha256;
  for (const citation of input.citations.filter(row => row.evidence.sourceId === sourceId)) {
    const value = textFor(citation);
    citation.text = { ...citation.text, value, sha256: hashBytes(Buffer.from(value)), startInclusive: 0, endExclusive: value.length };
    citation.original = { ...citation.original, sha256, byteLength: bytes.length };
    citation.evidence = { ...citation.evidence, sha256, excerpt: value };
  }
}

async function changeCsv(input: EvidenceFixtureInput, duplicate: boolean) {
  const file = input.manifest.files.find(item => item.kind === 'event_csv')!;
  const item = input.originals.find(original => original.sourceId === file.fileId)!;
  const extraction = await extractDocument('event_csv', Buffer.from(item.bytesBase64, 'base64'));
  const rows = decodeBatch(file.streamId!, extraction.document);
  rows[0] = duplicate ? rows[1] : { ...rows[0], sequence: rows[0].sequence + 100 };
  const replacement = encodeBatch(rows);
  replaceOriginalBytes(input, item.sourceId, replacement, ({ evidence: { locator } }) =>
    locator.kind === 'csv' ? canonicalJson(rows[locator.row - 1].payload) : '');
  file.sha256 = hashBytes(replacement);
  input.manifest.hash = hashManifest(input.manifest);
  const { hash: _truth, ...original } = decodeTruth(input.producerTruthJson);
  original.manifestHash = input.manifest.hash;
  const producerTruthHash = hashCanonical(original);
  input.producerTruthJson = canonicalJson({ ...original, hash: producerTruthHash });
  const { hash: _producer, ...producer } = decodeEvidenceProducer(input.producerJson);
  const rebound = { ...producer, producerTruthHash, manifestHash: input.manifest.hash };
  input.producerJson = canonicalJson({ ...rebound, hash: hashCanonical(rebound) });
  recalcAggregate(input);
}

async function rejectChangedRebound(text: string, manifest: EvidenceFixtureInput['manifest']) {
  const { bundleHash: _bundleHash, ...bundle } = JSON.parse(text);
  const { hash: _financialHash, ...truth } = JSON.parse(bundle.truthJson);
  truth.generator.buildHash = '0'.repeat(64);
  const hash = hashCanonical(truth);
  bundle.pin.hash = hash;
  bundle.truthJson = canonicalJson({ ...truth, hash });
  const { hash: _evidenceHash, ...evidence } = bundle.evidence;
  evidence.financialTruthHash = hash;
  bundle.evidence = { ...evidence, hash: hashCanonical(evidence) };
  await expect(decodeProtectedEvidenceBundle(canonicalJson({ ...bundle, bundleHash: hashCanonical(bundle) }), manifest))
    .rejects.toThrow('Protected evidence fixture invalid');
}

async function rejectInvalidInputs(a: EvidenceFixtureInput, b: EvidenceFixtureInput, root: URL) {
  const mutations: [string, (input: EvidenceFixtureInput) => void][] = [
    ['changed original bytes', input => { input.originals[0].bytesBase64 = 'AA=='; }],
    ['noncanonical base64', input => { input.originals[0].bytesBase64 += '\n'; }],
    ['wrong original byte length', input => { input.citations[0].original.byteLength++; }],
    ['wrong extracted text hash', input => { input.citations[0].text.sha256 = '0'.repeat(64); }],
    ['wrong original scope', input => { input.originals[0].sourceRef = 'unrelated-source'; }],
    ['wrong seller in producer', input => {
      const { hash: _hash, ...producer } = decodeEvidenceProducer(input.producerJson);
      const changed = { ...producer, sellerEntityId: 'unrelated-seller' };
      input.producerJson = canonicalJson({ ...changed, hash: hashCanonical(changed) });
    }],
    ['wrong citation snapshot', input => { input.citations[0].evidence.snapshotId = 'stale-snapshot'; }],
    ['incomplete citations', input => { input.citations.pop(); }],
    ['duplicate citation', input => { input.citations.push(input.citations[0]); }],
    ['incomplete originals', input => { input.originals.pop(); }],
    ['extra original', input => { input.originals.push({ ...input.originals[0], sourceId: 'extraneous-original' }); }],
    ['duplicate support resolution', input => { input.resolvedSupport.push(input.resolvedSupport[0]); }],
    ['wrong buyer binding', input => { input.demoBindings[0].parentCustomerId = input.demoBindings[1].parentCustomerId; }],
    ['wrong document association', input => {
      const original = input.originals.find(item => item.binding.kind === 'document')!;
      original.binding = { kind: 'document', fileId: 'other-file' };
    }],
    ['swapped API event association', input => {
      const [first, second] = input.originals.filter(item => item.binding.kind === 'api-json');
      [first.binding, second.binding] = [second.binding, first.binding];
    }],
    ['substituted API payload and recomputed byte hashes', input => {
      const [first, second] = input.originals.filter(item => item.binding.kind === 'api-json');
      const bytes = Buffer.from(second.bytesBase64, 'base64');
      replaceOriginalBytes(input, first.sourceId, bytes, () => canonicalJson(JSON.parse(bytes.toString('utf8'))));
    }],
    ['locator narrows away from support literal', input => {
      const fileId = input.resolvedSupport[0].fileId;
      const citation = input.citations.find(row => row.evidence.sourceId === fileId)!;
      updateCitationRange(input, citation, 0, 1);
    }],
    ['locator splits UTF-16 surrogate', input => {
      const citation = input.citations.find(row => row.evidence.locator.kind === 'pdf')!;
      citation.text.value = '😀' + citation.text.value;
      updateCitationRange(input, citation, 0, 1);
    }],
    ['recomputed citation ID with invalid extraction locator', input => {
      const citation = input.citations.find(row => row.evidence.locator.kind === 'pdf')!;
      if (citation.evidence.locator.kind !== 'pdf') throw new Error('Expected PDF locator');
      citation.evidence.locator.page += 100;
      updateCitationRange(input, citation, 0, 1);
    }],
  ];
  for (const [label, mutate] of mutations) {
    const input = structuredClone(a);
    mutate(input);
    await expect(pinProtectedEvidenceFixture(input, root), label).rejects.toThrow('Protected evidence fixture invalid');
  }
  for (const duplicate of [false, true]) {
    const input = structuredClone(b);
    await changeCsv(input, duplicate);
    await expect(pinProtectedEvidenceFixture(input, root), duplicate ? 'duplicate CSV row' : 'changed CSV sequence')
      .rejects.toThrow('Protected evidence fixture invalid');
  }
  const unknownInput = structuredClone(b);
  const { hash: _hash, ...producer } = decodeEvidenceProducer(b.producerJson);
  const known = new Set(producer.identities.map(identity => identity.sourceAccountId));
  const sourceAccountId = decodeTruth(b.producerTruthJson).accounts.find(account => !known.has(account.sourceAccountId))!.sourceAccountId;
  const { companyId, sourceRef, sellerEntityId } = producer;
  const identity = {
    ...producer.identities[0], sourceAccountId,
    id: 'identity:' + hashCanonical({ companyId, sourceRef, sellerEntityId, sourceAccountId }),
  };
  producer.identities.push(identity);
  producer.identities.sort((a, b) => a.id < b.id ? -1 : 1);
  unknownInput.producerJson = canonicalJson({ ...producer, hash: hashCanonical(producer) });
  unknownInput.demoBindings.push({
    identityFactId: identity.id, policy: 'generated-demo-buyer-account-v1',
    parentCustomerId: identity.buyerId, accountId: [companyId, sellerEntityId, sourceAccountId].join('.'),
  });
  const supports = unknownInput.resolvedSupport.filter(row => row.factId === decodeEvidenceProducer(b.producerJson).identities[0].id);
  unknownInput.resolvedSupport.push(...supports.map(row => ({ ...row, factId: identity.id })));
  await expect(pinProtectedEvidenceFixture(unknownInput, root), 'an unresolved B receipt cannot invent a known identity')
    .rejects.toThrow('Protected evidence fixture invalid');
  await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
}

function checkCheckerNegatives(
  input: EvidenceFixtureInput, evidence: EvidenceInputV1, artifact: CompiledArtifact, profile: CustomerProfile,
  run: CapturedEvidenceRun, company: 'a' | 'b',
) {
  const check = (changedArtifact = artifact, changedProfile = profile, witness: CapturedEvidenceRun | null = run,
    changedEvidence: EvidenceInputV1 | undefined = evidence) =>
    checkEvidenceSupport({
      artifact: changedArtifact, profiles: [changedProfile], manifest: input.manifest, snapshot: input.snapshot,
      events: input.events, evidence: changedEvidence, capturedRuns: new Map(witness ? [[witness.profileHash, witness]] : []),
    });
  function changeProfile(mutate: (profile: CustomerProfile) => void) {
    const changed = structuredClone(profile);
    mutate(changed);
    changed.hash = hashProfile(changed);
    const rebound = { ...artifact, requiredProfileHashes: [changed.hash] };
    rebound.hash = hashArtifact(rebound);
    return { changed, rebound };
  }
  function changeArtifact(mutate: (artifact: CompiledArtifact) => void) {
    const changed = structuredClone(artifact);
    mutate(changed);
    changed.hash = hashArtifact(changed);
    return changed;
  }

  expect(check()).toMatchObject({ status: 'passed', cases: 4 });
  expect(check(artifact, profile, { ...run, outcome: null })).toMatchObject({ status: 'failed', cases: 4 });
  const differentPrior = structuredClone(run);
  differentPrior.target.version = 1;
  const differentPriorPlan = differentPrior.outcome!.plans[0];
  differentPriorPlan.expectedTargetVersion = 1;
  differentPriorPlan.hash = hashPlan(differentPriorPlan);
  expect(check(artifact, profile, differentPrior)).toMatchObject({ status: 'failed', cases: 4 });
  expect(checkEvidenceSupport({
    artifact, profiles: [profile], manifest: input.manifest, snapshot: input.snapshot, events: input.events,
    evidence, capturedRuns: new Map(),
  })).toMatchObject({ status: 'unavailable', cases: 0 });
  expect(checkEvidenceSupport({
    artifact, profiles: [profile], manifest: input.manifest, snapshot: input.snapshot, events: input.events,
    evidence: undefined, capturedRuns: new Map([[profile.hash, run]]),
  })).toMatchObject({ status: 'unavailable', cases: 0 });

  const mutations: [string, (profile: CustomerProfile) => void][] = [
    ['buyer mismatch', value => { value.parentCustomerId = 'different-buyer'; }],
    ['canonical account mismatch', value => { value.scope.accountId = 'different-account'; }],
    ['approved account lookup mismatch', value => { value.approvedLookups[0].entries[0].target = 'different-account'; }],
    ['omitted active term', value => { value.contractTerms = []; }],
    ['unsupported fee', value => { value.contractTerms[0].fixedMonthlyFeeCents += 100; }],
    ['wrong active interval', value => { value.contractTerms[0].validFrom = '2025-01-01'; }],
    ['wrong invoice anchor', value => { value.contractTerms[0].anchorDay = 2; }],
    ['unrelated valid term citation', value => {
      const other = evidence.producer.contracts.find(fact => !profile.sourceAccountIds.includes(fact.sourceAccountId))!;
      value.contractTerms[0].evidenceRefs = [evidence.resolvedSupport.find(item => item.factId === other.id)!.evidenceId];
    }],
  ];
  for (const [label, mutate] of mutations) {
    const { changed, rebound } = changeProfile(mutate);
    expect(check(rebound, changed), label).toMatchObject({ status: 'failed', cases: 3 });
  }

  const wrongCurrency = changeArtifact(changed => {
    changed.normalizedPlan.mappings[0].fields.currency = { op: 'constant', value: 'EUR', evidenceRef: profile.contractTerms[0].evidenceRefs[0] };
  });
  expect(check(wrongCurrency)).toMatchObject({ status: 'failed', cases: 3 });
  const wrongReference = changeArtifact(changed => {
    const currency = changed.normalizedPlan.mappings[0].fields.currency;
    if (currency.op !== 'constant') throw new Error('Expected constant currency');
    const other = evidence.producer.contracts.find(fact => !profile.sourceAccountIds.includes(fact.sourceAccountId))!;
    currency.evidenceRef = evidence.resolvedSupport.find(item => item.factId === other.id && item.field === 'currency')!.evidenceId;
  });
  expect(check(wrongReference, profile, null)).toMatchObject({ status: 'failed', cases: 3 });

  const confirmed = FindingSchema.parse({
    id: 'confirmed-example', scope: profile.scope, taskId: 'private-test', fieldPath: '/amountCents',
    value: 300000, origin: 'reviewer', provenanceClass: 'observed', evidenceStatus: 'supported',
    reviewDisposition: 'confirmed', evidenceRefs: profile.contractTerms[0].evidenceRefs, derivationInputs: [], revision: 1,
  });
  const { changed: withFinding, rebound } = changeProfile(value => { value.findings.push(confirmed); });
  expect(check(rebound, withFinding)).toMatchObject({ status: 'unavailable', cases: 0 });
  const money = structuredClone(rebound);
  const invoice = money.normalizedPlan.mappings.find(mapping => mapping.kind === 'invoice')!;
  invoice.fields.amountCents = { op: 'constant', value: confirmed.value, evidenceRef: confirmed.evidenceRefs[0] };
  money.hash = hashArtifact(money);
  expect(check(money, withFinding)).toMatchObject({ status: 'failed', cases: 1 });
  expect(check(artifact, { ...profile, bootstrap: {} } as CustomerProfile)).toMatchObject({ status: 'unavailable', cases: 0 });

  const unknownOperation = changeArtifact(changed => {
    const mapping = changed.normalizedPlan.mappings.find(item => item.kind === 'invoice')!;
    mapping.fields.dueDate = { op: 'normalize_text', path: '/due_date', mode: 'trim' };
  });
  expect(check(unknownOperation)).toMatchObject({ status: 'unavailable', cases: 0 });

  const lineageMutations: [string, (plan: PlanOutcome['plans'][number]) => void][] = [
    ['wrong source event', plan => { plan.lineage[0].sourceEventIds = ['other-event']; }],
    ['wrong source field', plan => { plan.lineage[0].sourcePaths = ['/observedAt']; }],
    ['wrong derivation ID', plan => {
      plan.lineage.find(item => item.targetField === '/invoiceRecordId')!.derivationInputs = ['other-record'];
    }],
    ['wrong citation', plan => { plan.lineage.find(item => item.targetField === '/currency')!.evidenceRefs = ['other-citation']; }],
    ['wrong mapping operation', plan => { plan.lineage.find(item => item.targetField === '/currency')!.mapping = { op: 'field', path: '/other' }; }],
    ['wrong operation index', plan => { plan.lineage[0].operationIndex = plan.operations.length; }],
    ['duplicate lineage row', plan => { plan.lineage.push(plan.lineage[0]); }],
    ['missing lineage row', plan => { plan.lineage.pop(); }],
  ];
  for (const [label, mutate] of lineageMutations) {
    const changed = structuredClone(run);
    const plan = changed.outcome!.plans[0];
    mutate(plan);
    plan.hash = hashPlan(plan);
    expect(check(artifact, profile, changed), label).toMatchObject({ status: 'failed', cases: 4 });
  }
  const configuration = structuredClone(run);
  const plan = configuration.outcome!.plans[0];
  plan.operations.push({
    op: 'ensure_customer', record: {
      id: profile.parentCustomerId, displayName: 'Unrepresented configuration operation',
      evidenceRefs: profile.contractTerms[0].evidenceRefs,
    },
  });
  plan.hash = hashPlan(plan);
  expect(check(artifact, profile, configuration)).toMatchObject({ status: 'unavailable', cases: 0 });

  if (company === 'b') {
    const known = new Set(evidence.producer.identities.map(identity => identity.sourceAccountId));
    const unknown = decodeTruth(input.producerTruthJson).accounts.find(account => !known.has(account.sourceAccountId))!;
    const { changed, rebound: unknownArtifact } = changeProfile(value => { value.sourceAccountIds = [unknown.sourceAccountId]; });
    expect(check(unknownArtifact, changed)).toMatchObject({ status: 'failed', cases: 1 });
  }
}

function checkAmendmentAndSameName(
  input: EvidenceFixtureInput, evidence: EvidenceInputV1, profile: CustomerProfile, artifact: CompiledArtifact,
) {
  const initial = evidence.producer.contracts.find(term => term.validToExclusive !== null)!;
  const terms = evidence.producer.contracts.filter(term => term.sourceAccountId === initial.sourceAccountId);
  const identity = evidence.producer.identities.find(fact => fact.sourceAccountId === initial.sourceAccountId)!;
  const sameName = evidence.producer.identities.find(fact => fact.id !== identity.id && fact.legalName === identity.legalName)!;
  const binding = evidence.demoBindings.find(item => item.identityFactId === identity.id)!;
  const references = (factId: string) => [...new Set(evidence.resolvedSupport.filter(item => item.factId === factId).map(item => item.evidenceId))];
  const reviewed = {
    ...profile, sourceAccountIds: [identity.sourceAccountId], parentCustomerId: binding.parentCustomerId,
    scope: { ...profile.scope, accountId: binding.accountId },
    semanticVersion: input.manifest.semanticVersions[identity.sellerEntityId + '/' + identity.sourceAccountId],
    approvedLookups: [{
      id: 'account-map', valueType: 'parent-account' as const,
      entries: [{ source: identity.sourceAccountId, target: binding.accountId, evidenceRefs: references(identity.id) }],
    }],
    contractTerms: terms.map(({ sourceAccountId: _account, sellerEntityId: _seller, support: _support, ...term }) =>
      ({ ...term, evidenceRefs: references(term.id) })),
  };
  reviewed.hash = hashProfile(reviewed);
  expect(terms).toHaveLength(2);
  expect(checkContractTerms(reviewed, terms, evidence, input.manifest.asOf)).toBe(true);
  const changed = structuredClone(reviewed);
  changed.contractTerms.find(term => term.validToExclusive !== null)!.validToExclusive = null;
  expect(checkContractTerms(changed, terms, evidence, input.manifest.asOf)).toBe(false);
  expect(sameName.buyerId).not.toBe(identity.buyerId);
  reviewed.parentCustomerId = sameName.buyerId;
  reviewed.hash = hashProfile(reviewed);
  const amendedArtifact = structuredClone(artifact);
  amendedArtifact.requiredProfileHashes = [reviewed.hash];
  const active = terms.find(term => term.validToExclusive === null)!;
  const currencyRef = evidence.resolvedSupport.find(item => item.factId === active.id && item.field === 'currency')!.evidenceId;
  for (const mapping of amendedArtifact.normalizedPlan.mappings) {
    mapping.fields.currency = { op: 'constant', value: 'USD', evidenceRef: currencyRef };
  }
  amendedArtifact.hash = hashArtifact(amendedArtifact);
  expect(checkEvidenceSupport({
    artifact: amendedArtifact, profiles: [reviewed], manifest: input.manifest, snapshot: input.snapshot,
    events: input.events, evidence, capturedRuns: new Map(),
  })).toMatchObject({ status: 'failed', cases: 3 });
}

test('real generated A/B capture provenance survives immutable v2 roundtrips beside v1', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eapr-evidence-v2-store-'));
  const roots = { visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'private') };
  const store = await createEvidenceStore(join(directory, 'originals'));
  const owned = new Set<URL>();
  const system = await createTestSystem({ modelMode: 'disabled', dbNamespace: testNamespace('evidencev2') });
  try {
    await generateFixtures({ ...roots, seed: 'evidence-v2-test-' + randomUUID(), asOf: '2026-10-01T00:00:00.000Z' });
    const captures = [];
    for (const company of ['a', 'b'] as const) {
      const capture = await captureEvidenceFixture({ db: system.db.control, store, clock: () => new Date('2026-11-08T00:00:00.000Z') }, roots, company);
      captures.push(capture);
      const { input, source, contractFileId } = capture;
      const { producerTruthJson, manifest, snapshot, events } = input;
      const original = decodeTruth(producerTruthJson);
      const v1Path = pathFor(fixedRoot, original.fixtureSetId, '1');
      const v2Path = pathFor(fixedRoot, original.fixtureSetId, '2');
      await expect(lstat(v1Path)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(v2Path)).rejects.toMatchObject({ code: 'ENOENT' });
      const v1 = await pinProtectedFixture({ truthJson: producerTruthJson, manifest, snapshot, events });
      owned.add(v1Path);
      const v1Hash = hashBytes(await readFile(v1Path));
      const { hash: _originalHash, ...originalFacts } = original;
      const reservedTruth = { ...originalFacts, fixtureSetVersion: '2' };
      const reservedHash = hashCanonical(reservedTruth);
      const reservedJson = canonicalJson({ ...reservedTruth, hash: reservedHash });
      await expect(pinProtectedFixture({ truthJson: reservedJson, manifest, snapshot, events }))
        .rejects.toThrow('Protected fixture invalid');
      const schemaLess = { ...JSON.parse(await readFile(v1Path, 'utf8')),
        pin: { fixtureSetId: original.fixtureSetId, fixtureSetVersion: '2', hash: reservedHash }, truthJson: reservedJson };
      await writeFile(v2Path, canonicalJson(schemaLess), { flag: 'wx', mode: 0o400 });
      owned.add(v2Path);
      await expect(readProtectedFixture(original.fixtureSetId, '2', manifest)).rejects.toThrow('Protected fixture invalid');
      await rm(v2Path);
      owned.delete(v2Path);
      const pin = await pinProtectedEvidenceFixture(input);
      owned.add(v2Path);
      expect(pin).toEqual({ ...v1, fixtureSetVersion: '2' });
      expect(await pinProtectedEvidenceFixture({
        ...input, events: [...input.events].reverse(), originals: [...input.originals].reverse(),
        citations: [...input.citations].reverse(), demoBindings: [...input.demoBindings].reverse(),
        resolvedSupport: [...input.resolvedSupport].reverse(),
      })).toEqual(pin);
      expect(hashBytes(await readFile(v1Path))).toBe(v1Hash);
      const v1Read = await readProtectedFixture(v1.fixtureSetId, v1.fixtureSetVersion, manifest);
      expect(v1Read.evidence).toBeUndefined();
      expect(v1Read.snapshot.contentHash).toBe(snapshot.contentHash);

      const reader = await readProtectedFixture(pin.fixtureSetId, pin.fixtureSetVersion, manifest);
      const v2Text = await readFile(v2Path, 'utf8');
      const direct = await decodeProtectedEvidenceBundle(v2Text, manifest);
      if (company === 'a') await rejectChangedRebound(v2Text, manifest);
      expect(reader.evidence?.hash).toBe(direct.evidence.hash);
      expect(reader.snapshot.contentHash).toBe(snapshot.contentHash);
      expect(reader.truth.fixtureSetVersion).toBe('2');
      expect(reader.truth.hash).not.toBe(original.hash);
      expect(direct.evidence.financialTruthHash).toBe(reader.truth.hash);
      expect(direct.evidence.producer.producerTruthHash).toBe(original.hash);
      expect(direct.evidence.producerTruthJson === canonicalJson(original)).toBe(true);
      const { hash: _v1hash, fixtureSetVersion: _v1Version, ...v1Facts } = original;
      const { hash: _v2hash, fixtureSetVersion: _v2Version, ...v2Facts } = reader.truth;
      expect(hashCanonical(v2Facts)).toBe(hashCanonical(v1Facts));
      const identities = direct.evidence.producer.identities;
      expect(identities).toHaveLength(3);
      expect(new Set(identities.map(fact => fact.legalName)).size).toBe(2);
      expect(new Set(identities.map(fact => fact.buyerId)).size).toBe(3);
      expect(direct.evidence.producer.contracts.filter(term => term.validToExclusive !== null))
        .toHaveLength(company === 'a' ? 1 : 0);
      expect(original.accounts).toHaveLength(company === 'a' ? 3 : 4);
      expect(input.originals.some(item => item.binding.kind === 'api-json')).toBe(true);
      expect(input.citations.some(item => item.evidence.locator.kind === 'csv')).toBe(company === 'b');
      const v2Hash = hashBytes(await readFile(v2Path));
      await expect(pinProtectedEvidenceFixture({
        ...input, snapshot: { ...snapshot, capturedAt: '2026-11-08T00:00:01.000Z' },
      })).rejects.toThrow('Protected fixture invalid');
      expect(hashBytes(await readFile(v2Path))).toBe(v2Hash);

      const built = buildDemoCandidate({
        source, capture: { companyId: source.companyId, manifestId: manifest.id, contractFileId },
        manifest, snapshot, events, citation: input.citations.find(item => item.evidence.sourceId === contractFileId),
      });
      if (!('candidate' in built)) throw new Error('Expected real generated candidate');
      const { spec, profiles } = built.candidate.request;
      const result = compile(spec, profiles);
      if (!result.ok) throw new Error('Expected generated candidate to compile');
      expect(bindTruth(reader.truth, profiles)[0].reference.balanceCents).toBe(company === 'a' ? 80000 : 0);
      const candidate = { spec, profiles, artifact: result.value, manifest, snapshot };
      const launcher = createProtectedVerificationLauncher(async () => pin);
      const jobId = 'c2-evidence-' + company;
      const resolved = await launcher.resolve(candidate);
      const report = VerificationReportSchema.parse(await launcher.launch(jobId, candidate, resolved));
      expect(report.checks.filter(check => check.status === 'passed')).toHaveLength(13);
      expect(report.checks.find(check => check.id === 'evidence_support'))
        .toMatchObject({ status: 'passed', cases: 4 });
      expect(report).toMatchObject({ fixtureSetVersion: '2', eligible: true, unexplainedDifferenceCents: 0 });
      expect(report.checks.reduce((total, check) => total + check.cases, 0)).toBe(company === 'a' ? 53 : 57);
      expect(validateReport(jobId, candidate, resolved, report).summary).toMatchObject({ eligible: true, coverageComplete: true });

      const baseline = buildCasePlan(candidate, reader.truth, events, snapshot).filter(check => check.id === 'baseline_reconcile');
      let witness: CapturedEvidenceRun | undefined;
      await runCasePlan(candidate.artifact, baseline, run => { witness = run; });
      if (!witness) throw new Error('Expected exact captured subject witness');
      checkCheckerNegatives(input, direct.evidence, candidate.artifact, profiles[0], witness, company);
      if (company === 'a') {
        checkAmendmentAndSameName(input, direct.evidence, profiles[0], candidate.artifact);
        // The store establishes producer provenance and exact containment. The candidate checker
        // independently rejects the changed typed assertion even when its transport is valid.
        const { hash: _producerHash, ...producer } = decodeEvidenceProducer(input.producerJson);
        const claimed = producer.contracts.find(fact => fact.sourceAccountId === profiles[0].sourceAccountIds[0])!;
        claimed.fixedMonthlyFeeCents += 1;
        const producerJson = canonicalJson({ ...producer, hash: hashCanonical(producer) });
        const alternateRoot = pathToFileURL(join(directory, 'independent-typed-assertion') + '/');
        const changedPin = await pinProtectedEvidenceFixture({ ...input, producerJson }, alternateRoot);
        const changed = await decodeProtectedEvidenceBundle(
          await readFile(pathFor(alternateRoot, changedPin.fixtureSetId, '2'), 'utf8'), manifest,
        );
        expect(checkEvidenceSupport({
          ...candidate, events, evidence: changed.evidence, capturedRuns: new Map([[profiles[0].hash, witness]]),
        })).toMatchObject({ status: 'failed', cases: 4 });
      } else {
        // Generated B has only payment allocations. The baseline can pass despite a bad
        // credit branch, so the evidence template check must fail independently of it.
        const wrongSpec = structuredClone(spec);
        wrongSpec.mappings.find(mapping => mapping.kind === 'allocation')!.fields.fundingKind = {
          op: 'enum_lookup', path: '/receipt_type', values: { payment: 'payment', credit: 'payment' },
        };
        const wrong = compile(wrongSpec, profiles);
        if (!wrong.ok) throw new Error('Expected the deliberate B mapping to compile');
        const wrongCandidate = { ...candidate, spec: wrongSpec, artifact: wrong.value };
        const wrongPlan = buildCasePlan(wrongCandidate, reader.truth, events, snapshot).filter(check => check.id === 'baseline_reconcile');
        const observed = new Map<string, CapturedEvidenceRun>();
        const result = await runCasePlan(wrong.value, wrongPlan, run => { observed.set(run.profileHash, run); });
        expect(result.checks).toMatchObject([{ id: 'baseline_reconcile', status: 'passed' }]);
        expect(checkEvidenceSupport({
          ...wrongCandidate, events, evidence: direct.evidence, capturedRuns: observed,
        })).toMatchObject({ status: 'failed', cases: 3 });
      }
    }
    const rejectionRoot = pathToFileURL(join(directory, 'rejected-pins') + '/');
    await rejectInvalidInputs(captures[0].input, captures[1].input, rejectionRoot);
  } finally {
    try {
      await system.close();
    } finally {
      await Promise.all([...owned].map(path => rm(path, { force: true })));
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 60000);
