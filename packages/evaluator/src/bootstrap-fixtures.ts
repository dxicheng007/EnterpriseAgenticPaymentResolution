import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  BootstrapManifestSchema, CompiledArtifactSchema, CustomerProfileSchema, HashSchema, IdSchema, RawSourceEventSchema,
  ScopeSchema, SourceSnapshotSchema, canonicalJson, hashArtifact, hashCanonical, hashManifest, hashProfile, strict,
} from '@eapr/contracts';
import { decodeProtectedEvidenceBundle, type EvidenceInputV1 } from './evidence-fixtures.js';
import { verifyCaptureBinding } from './fixture-store.js';

const maxBytes = 10 * 1024 * 1024;
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const defaultRoots = {
  sidecarRoot: join(repository, '.local/protected-bootstrap'),
  evidencePinRoot: join(repository, '.local/protected-evaluator'),
  servedRoots: ['.local/demo/visible', '.local/demo/evidence', '.local/artifacts', 'apps/web', 'fixtures/visible'].map(path => join(repository, path)),
};

function invalid(): never {
  throw new Error('Protected bootstrap fixture invalid');
}

export function compareBootstrapKeys(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unique<T>(items: readonly T[], key: (item: T) => string) {
  return new Set(items.map(key)).size === items.length;
}

function ascending<T>(items: readonly T[], key: (item: T) => string) {
  return items.every((item, index) => index === 0 || key(items[index - 1]!) < key(item));
}

const refs = IdSchema.array().min(1).refine(values => ascending(values, id => id));
const subjectSchema = strict({
  profileHash: HashSchema, profileId: IdSchema, scope: ScopeSchema, identityFactId: IdSchema,
  customerId: IdSchema, customerEvidenceRefs: refs,
  terms: strict({ factId: IdSchema, termId: IdSchema, configurationId: IdSchema, evidenceRefs: refs }).array().min(1)
    .refine(terms => ascending(terms, term => term.termId) && unique(terms, term => term.factId) &&
      unique(terms, term => term.configurationId)),
});
const evidencePinSchema = strict({ fixtureSetId: IdSchema, fixtureSetVersion: z.literal('2'), bundleHash: HashSchema });
const pinSchema = strict({ fixtureSetId: IdSchema, fixtureSetVersion: IdSchema, hash: HashSchema });
const descriptorSchema = strict({
  schemaVersion: z.literal('1'), fixtureSetId: IdSchema, fixtureSetVersion: IdSchema, purpose: z.literal('construction'),
  evidencePin: evidencePinSchema, manifestHash: HashSchema, snapshotHash: HashSchema, recipeVersion: z.literal('demo-bootstrap-1'),
  subjects: subjectSchema.array().min(1).refine(subjects => ascending(subjects, subject => subject.profileHash)),
  hash: HashSchema,
});

const captureSchema = strict({
  artifact: CompiledArtifactSchema, profiles: CustomerProfileSchema.array().min(1), manifest: BootstrapManifestSchema,
  snapshot: SourceSnapshotSchema, events: RawSourceEventSchema.array(),
  registration: strict({ artifactHash: HashSchema, manifestHash: HashSchema, snapshotId: IdSchema, snapshotObjectHash: HashSchema }),
});

export type BootstrapExpectationV1 = z.infer<typeof descriptorSchema>;
export type BootstrapReviewedSubject = z.infer<typeof subjectSchema>;
export type BootstrapEvidencePin = z.infer<typeof evidencePinSchema>;
export type BootstrapCapture = z.infer<typeof captureSchema>;
type BootstrapFixturePin = z.infer<typeof pinSchema>;
type BootstrapRoots = typeof defaultRoots;

function equal(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameSet(left: string[], right: string[]) {
  return unique(left, id => id) && unique(right, id => id) && equal([...left].sort(), [...right].sort());
}

export function decodeBootstrapExpectation(text: string): BootstrapExpectationV1 {
  try {
    if (Buffer.byteLength(text) > maxBytes) invalid();
    const result = descriptorSchema.parse(JSON.parse(text));
    const { hash, ...preimage } = result;
    if (hashCanonical(preimage) !== hash) invalid();
    return result;
  } catch {
    return invalid();
  }
}

function contains(root: string, path: string) {
  const difference = relative(root, path);
  return !isAbsolute(difference) && difference !== '..' && !difference.startsWith('..' + sep);
}

function overlapping(a: string, b: string) {
  return contains(a, b) || contains(b, a);
}

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

// Resolve even a currently absent served root via its closest existing ancestor.
async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!missing(error) || dirname(path) === path) throw error;
    return join(await physicalPath(dirname(path)), relative(dirname(path), path));
  }
}

async function checkedRoots(roots: BootstrapRoots) {
  const sidecar = resolve(roots.sidecarRoot);
  const evidence = resolve(roots.evidencePinRoot);
  const served = await Promise.all([...defaultRoots.servedRoots, ...roots.servedRoots].map(path => physicalPath(resolve(path))));
  if (sidecar !== await physicalPath(sidecar) || evidence !== await physicalPath(evidence) ||
    overlapping(sidecar, evidence) || served.some(path => overlapping(path, sidecar) || overlapping(path, evidence))) invalid();
  return { sidecar, evidence };
}

function filename(id: string, version: string) {
  return hashCanonical([IdSchema.parse(id), IdSchema.parse(version)]) + '.json';
}

async function privateDirectory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700 || await realpath(path) !== path) invalid();
}

async function readPrivate(root: string, name: string) {
  await privateDirectory(root);
  const file = await open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o400 || stat.size > maxBytes) invalid();
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) invalid();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally {
    await file.close();
  }
}

export type BootstrapSourceFacts = Pick<EvidenceInputV1, 'demoBindings' | 'resolvedSupport'> & {
  producer: Pick<EvidenceInputV1['producer'], 'contracts' | 'identities'>;
};

type Fact = EvidenceInputV1['producer']['identities'][number] | EvidenceInputV1['producer']['contracts'][number];

function supports(evidence: BootstrapSourceFacts, fact: Fact, citations: string[]) {
  const support = evidence.resolvedSupport.filter(row => row.factId === fact.id && citations.includes(row.evidenceId));
  return citations.every(id => support.some(row => row.evidenceId === id)) &&
    fact.support.every(item => support.some(row => row.field === item.field && row.fileId === item.fileId &&
      row.expectedLiteral === item.expectedLiteral));
}

export function resolveBootstrapSubject(
  descriptor: Pick<BootstrapExpectationV1, 'manifestHash'>, evidence: BootstrapSourceFacts, manifest: BootstrapCapture['manifest'],
  subject: BootstrapReviewedSubject,
) {
  const { producer } = evidence;
  const identity = producer.identities.find(fact => fact.id === subject.identityFactId);
  const binding = evidence.demoBindings.find(row => row.identityFactId === subject.identityFactId);
  if (!identity || !binding || binding.policy !== 'generated-demo-buyer-account-v1' ||
    identity.buyerId !== subject.customerId || binding.parentCustomerId !== identity.buyerId ||
    subject.scope.companyId !== manifest.companyId || subject.scope.sellerEntityId !== identity.sellerEntityId ||
    subject.scope.accountId !== binding.accountId ||
    binding.accountId !== [manifest.companyId, identity.sellerEntityId, identity.sourceAccountId].join('.') ||
    !supports(evidence, identity, subject.customerEvidenceRefs) || descriptor.manifestHash !== manifest.hash) invalid();

  const scoped = producer.contracts.filter(fact => fact.sourceAccountId === identity.sourceAccountId &&
    fact.sellerEntityId === identity.sellerEntityId);
  const terms = subject.terms.map(reviewed => {
    const fact = scoped.find(candidate => candidate.id === reviewed.factId);
    if (!fact || !supports(evidence, fact, reviewed.evidenceRefs)) invalid();
    // The validated producer chain derives the terminal null. An earlier end is
    // observed through the amendment fact, whose citation is checked by supports().
    const next = scoped.filter(item => item.contractId === fact.contractId && item.validFrom > fact.validFrom)
      .sort((left, right) => compareBootstrapKeys(left.validFrom, right.validFrom))[0];
    if (fact.validToExclusive !== (next?.validFrom ?? null) ||
      fact.support.some(row => row.field === 'validToExclusive') !== (next !== undefined)) invalid();
    const { id: _factId, sourceAccountId: _account, sellerEntityId: _seller, support: _support, ...values } = fact;
    return {
      id: reviewed.configurationId,
      term: { ...values, id: reviewed.termId, evidenceRefs: reviewed.evidenceRefs },
      endProvenance: next === undefined ? 'derived-terminal' as const : 'observed-amendment' as const,
    };
  });
  const asOfDate = manifest.asOf.slice(0, 10);
  const active = scoped.filter(fact => fact.validFrom <= asOfDate &&
    (fact.validToExclusive === null || asOfDate < fact.validToExclusive));
  if (!active.length || active.some(fact => !subject.terms.some(term => term.factId === fact.id))) invalid();
  return { identity, binding, terms };
}

function checkProfiles(descriptor: BootstrapExpectationV1, evidence: EvidenceInputV1, capture: BootstrapCapture) {
  const { profiles, manifest } = capture;
  for (const subject of descriptor.subjects) {
    const profile = profiles.find(item => item.hash === subject.profileHash);
    const { identity, binding, terms } = resolveBootstrapSubject(descriptor, evidence, manifest, subject);
    const metadata = profile?.bootstrap;
    if (!profile || !metadata || profile.id !== subject.profileId || !equal(profile.scope, subject.scope) ||
      profile.parentCustomerId !== binding.parentCustomerId || profile.sourceRef !== manifest.sourceRef ||
      !equal(profile.sourceAccountIds, [identity.sourceAccountId]) ||
      profile.semanticVersion !== manifest.semanticVersions[identity.sellerEntityId + '/' + identity.sourceAccountId] ||
      profile.findings.length || profile.approvedLookups.some(table => table.valueType !== 'parent-account') ||
      metadata.customer.id !== identity.buyerId || metadata.customer.displayName !== identity.legalName ||
      !sameSet(metadata.customer.evidenceRefs, subject.customerEvidenceRefs) ||
      !sameSet(profile.contractTerms.map(term => term.id), terms.map(({ term }) => term.id))) invalid();
    const entries = profile.approvedLookups.flatMap(table => table.entries);
    if (entries.length !== 1 || entries[0]!.source !== identity.sourceAccountId || entries[0]!.target !== binding.accountId ||
      !supports(evidence, identity, entries[0]!.evidenceRefs)) invalid();
    for (const { id, term } of terms) {
      const approved = profile.contractTerms.find(item => item.id === term.id)!;
      if (!equal({ ...approved, evidenceRefs: [...approved.evidenceRefs].sort() }, term) ||
        !metadata.billingConfigurationIds.some(config => config.id === id && config.termId === term.id)) invalid();
    }
  }
}

async function validateCapture(evidenceRoot: string, evidencePin: BootstrapEvidencePin, input: BootstrapCapture) {
  const capture = captureSchema.parse(input);
  const { artifact, profiles, manifest, snapshot, registration } = capture;
  const { fixtureSetId, fixtureSetVersion, bundleHash } = evidencePinSchema.parse(evidencePin);
  const events = [...capture.events].sort((a, b) => compareBootstrapKeys(a.id, b.id));
  if (manifest.hash !== hashManifest(manifest) || artifact.hash !== hashArtifact(artifact) ||
    registration.artifactHash !== artifact.hash || registration.manifestHash !== manifest.hash ||
    registration.snapshotId !== snapshot.id || registration.snapshotObjectHash !== hashCanonical(snapshot) ||
    artifact.sourceRef !== manifest.sourceRef || artifact.normalizedPlan.sourceRef !== manifest.sourceRef || !sameSet(artifact.requiredProfileHashes, profiles.map(profile => profile.hash)) ||
    profiles.some(profile => profile.hash !== hashProfile(profile) || profile.scope.companyId !== manifest.companyId) ||
    !unique(events, event => event.id)) invalid();
  verifyCaptureBinding(manifest, snapshot);
  const text = await readPrivate(evidenceRoot, filename(fixtureSetId, fixtureSetVersion));
  const bundle = await decodeProtectedEvidenceBundle(text, manifest);
  if (JSON.parse(text).bundleHash !== bundleHash || bundle.truth.fixtureSetId !== fixtureSetId ||
    bundle.truth.purpose !== 'construction' || !equal(bundle.events, events) ||
    !equal(bundle.snapshot, { ...snapshot, evidenceIds: [...snapshot.evidenceIds].sort(), eventIds: [...snapshot.eventIds].sort() })) invalid();
  return { ...capture, ...bundle, snapshot, events };
}

function bindDescriptor(descriptor: BootstrapExpectationV1, capture: Awaited<ReturnType<typeof validateCapture>>) {
  if (descriptor.manifestHash !== capture.manifest.hash || descriptor.snapshotHash !== capture.snapshot.contentHash) invalid();
  checkProfiles(descriptor, capture.evidence, capture);
  return { ...capture, descriptor };
}

export type ValidatedBootstrapExpectation = ReturnType<typeof bindDescriptor>;

export async function readBootstrapExpectation(pinInput: BootstrapFixturePin, input: BootstrapCapture, roots = defaultRoots) {
  try {
    const pin = pinSchema.parse(pinInput);
    const { sidecar, evidence } = await checkedRoots(roots);
    const descriptor = decodeBootstrapExpectation(await readPrivate(sidecar, filename(pin.fixtureSetId, pin.fixtureSetVersion)));
    if (descriptor.hash !== pin.hash || descriptor.fixtureSetId !== pin.fixtureSetId ||
      descriptor.fixtureSetVersion !== pin.fixtureSetVersion) invalid();
    return bindDescriptor(descriptor, await validateCapture(evidence, descriptor.evidencePin, input));
  } catch {
    return invalid();
  }
}

const reviewedSchema = strict({
  fixtureSetId: IdSchema, fixtureSetVersion: IdSchema, evidencePin: evidencePinSchema,
  subjects: subjectSchema.array().min(1),
});
export type BootstrapExpectationReview = z.infer<typeof reviewedSchema>;

/** Operator only. Publish validated, complete bytes with a no-replace link. */
export async function pinBootstrapExpectation(input: BootstrapExpectationReview, capture: BootstrapCapture, roots = defaultRoots) {
  try {
    const review = reviewedSchema.parse(input);
    const { sidecar, evidence } = await checkedRoots(roots);
    const verified = await validateCapture(evidence, review.evidencePin, capture);
    const preimage = {
      ...review, schemaVersion: '1', purpose: 'construction', recipeVersion: 'demo-bootstrap-1',
      manifestHash: verified.manifest.hash, snapshotHash: verified.snapshot.contentHash,
      subjects: [...review.subjects].sort((a, b) => compareBootstrapKeys(a.profileHash, b.profileHash)),
    };
    const bytes = canonicalJson({ ...preimage, hash: hashCanonical(preimage) });
    const descriptor = decodeBootstrapExpectation(bytes);
    bindDescriptor(descriptor, verified);
    await mkdir(sidecar, { recursive: true, mode: 0o700 });
    await privateDirectory(sidecar);
    const name = filename(descriptor.fixtureSetId, descriptor.fixtureSetVersion);
    const temporary = join(sidecar, '.' + randomUUID());
    try {
      await writeFile(temporary, bytes, { mode: 0o400, flag: 'wx', flush: true });
      try {
        await link(temporary, join(sidecar, name));
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST') ||
          await readPrivate(sidecar, name) !== bytes) invalid();
      }
    } finally {
      await unlink(temporary).catch(error => { if (!missing(error)) throw error; });
    }
    return { fixtureSetId: descriptor.fixtureSetId, fixtureSetVersion: descriptor.fixtureSetVersion, hash: descriptor.hash };
  } catch {
    return invalid();
  }
}
