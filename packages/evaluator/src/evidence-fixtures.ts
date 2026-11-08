import { z } from 'zod';
import {
  BootstrapManifestSchema, EvidenceResponseSchema, HashSchema, IdSchema, IsoDateSchema, MoneyCentsSchema,
  RawSourceEventSchema, SourceSnapshotSchema, canonicalJson, guardKeys, hashBytes, hashCanonical, strict,
  type BootstrapManifest, type EvidenceResponse,
} from '@eapr/contracts';
import { extractDocument } from '../../evidence/src/extract.js';
import { locate } from '../../evidence/src/locate.js';
import { companyA } from '../../sources/src/company-a.js';
import { companyB, decodeBatch } from '../../sources/src/company-b.js';
import { verifyCaptureBinding } from './fixture-store.js';
import { decodeTruth, verifyTruthMembers, type ProtectedFixtureSet } from './fixtures.js';

const maxBytes = 10 * 1024 * 1024;
const nonempty = z.string().min(1);
const supportField = z.enum([
  'sourceAccountId', 'sellerEntityId', 'buyerId', 'legalName', 'contractId', 'validFrom', 'validToExclusive',
  'fixedMonthlyFeeCents', 'currency', 'cadence', 'anchorDay',
]);
const supportFields = { field: supportField, fileId: IdSchema, expectedLiteral: nonempty };
const factFields = {
  id: IdSchema, sourceAccountId: IdSchema, sellerEntityId: IdSchema, support: strict(supportFields).array(),
};
const identitySchema = strict({ ...factFields, buyerId: IdSchema, legalName: nonempty });
const contractSchema = strict({
  ...factFields, contractId: IdSchema, validFrom: IsoDateSchema, validToExclusive: IsoDateSchema.nullable(),
  fixedMonthlyFeeCents: MoneyCentsSchema, currency: z.literal('USD'), cadence: z.literal('monthly'), anchorDay: z.int().min(1).max(31),
});
const producerSchema = strict({
  schemaVersion: z.literal(1), kind: z.literal('evidence-facts'), fixtureSetId: IdSchema,
  producerFixtureSetVersion: z.literal('1'), producerTruthHash: HashSchema,
  generator: strict({ seed: IdSchema, buildHash: HashSchema }),
  companyId: IdSchema, sourceRef: IdSchema, sellerEntityId: IdSchema, manifestId: IdSchema, manifestHash: HashSchema,
  identities: identitySchema.array(), contracts: contractSchema.array(), hash: HashSchema,
});
const evidenceMembers = {
  demoBindings: strict({
    identityFactId: IdSchema, policy: z.literal('generated-demo-buyer-account-v1'), parentCustomerId: IdSchema, accountId: IdSchema,
  }).array(),
  originals: strict({
    sourceId: IdSchema, companyId: IdSchema, sourceRef: IdSchema, sha256: HashSchema, bytesBase64: nonempty,
    binding: guardKeys(z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('document'), fileId: IdSchema }),
      z.strictObject({ kind: z.literal('api-json'), eventId: IdSchema }),
    ])),
  }).array(),
  citations: EvidenceResponseSchema.array(),
  resolvedSupport: strict({ factId: IdSchema, ...supportFields, evidenceId: IdSchema }).array(),
};
const pinInputSchema = strict({
  producerTruthJson: nonempty, producerJson: nonempty, manifest: BootstrapManifestSchema, snapshot: SourceSnapshotSchema,
  events: RawSourceEventSchema.array(), ...evidenceMembers,
});
const evidenceSchema = strict({
  schemaVersion: z.literal(1), fixtureSetId: IdSchema, fixtureSetVersion: z.literal('2'),
  producer: producerSchema, producerTruthJson: nonempty, financialTruthHash: HashSchema,
  manifestId: IdSchema, manifestHash: HashSchema, snapshotId: IdSchema, snapshotHash: HashSchema,
  ...evidenceMembers, hash: HashSchema,
});
const bundleSchema = strict({
  schemaVersion: z.literal(2), pin: strict({ fixtureSetId: IdSchema, fixtureSetVersion: z.literal('2'), hash: HashSchema }),
  truthJson: nonempty, snapshot: SourceSnapshotSchema, events: RawSourceEventSchema.array(),
  evidence: evidenceSchema, bundleHash: HashSchema,
});

export type ProducerV1 = z.infer<typeof producerSchema>;
export type EvidenceInputV1 = z.infer<typeof evidenceSchema>;
export type EvidenceFixtureInput = z.infer<typeof pinInputSchema>;
export type DemoBinding = EvidenceInputV1['demoBindings'][number];
export type Original = EvidenceInputV1['originals'][number];
export type ResolvedSupport = EvidenceInputV1['resolvedSupport'][number];

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type Support = z.infer<typeof factFields.support>[number];
const supportKey = ({ field, fileId, expectedLiteral }: Support) => canonicalJson([field, fileId, expectedLiteral]);
const resolvedKey = ({ factId, field, fileId, expectedLiteral, evidenceId }: ResolvedSupport) =>
  canonicalJson([factId, field, fileId, expectedLiteral, evidenceId]);

function invalid(): never {
  throw new Error('Protected evidence fixture invalid');
}

function bound(text: string): string {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) invalid();
  return text;
}

function ordered<T>(items: readonly T[], key: (item: T) => string): T[] {
  if (new Set(items.map(key)).size !== items.length) invalid();
  return [...items].sort((a, b) => compare(key(a), key(b)));
}

function equal(a: unknown, b: unknown) {
  return canonicalJson(a) === canonicalJson(b);
}

function exactKeys(expected: Iterable<string>, actual: Iterable<string>) {
  const wanted = [...expected].sort(compare);
  const found = [...actual].sort(compare);
  if (!equal(wanted, found)) invalid();
}

function supportFieldsMatch(support: Support[], fields: Support['field'][]) {
  exactKeys(fields, new Set(support.map(row => row.field)));
}

function normalizeProducer(input: ProducerV1): ProducerV1 {
  const { hash, ...producer } = input;
  const { companyId, sourceRef, sellerEntityId } = producer;
  const source = { companyId, sourceRef, sellerEntityId };
  const identities = ordered(producer.identities, fact => fact.id).map(fact => ({ ...fact, support: ordered(fact.support, supportKey) }));
  const contracts = ordered(producer.contracts, fact => fact.id).map(fact => ({ ...fact, support: ordered(fact.support, supportKey) }));
  const accountIds = new Set(ordered(identities, fact => fact.sourceAccountId).map(fact => fact.sourceAccountId));
  for (const fact of identities) {
    const { sourceAccountId } = fact;
    if (fact.sellerEntityId !== sellerEntityId || fact.id !== 'identity:' + hashCanonical({ ...source, sourceAccountId })) invalid();
    supportFieldsMatch(fact.support, ['sourceAccountId', 'sellerEntityId', 'buyerId', 'legalName']);
  }
  const termsByContract = new Map<string, typeof contracts>();
  for (const fact of contracts) {
    const { sourceAccountId, contractId, validFrom, validToExclusive } = fact;
    if (!accountIds.has(sourceAccountId) || fact.sellerEntityId !== sellerEntityId ||
      fact.id !== 'term:' + hashCanonical({ ...source, sourceAccountId, contractId, validFrom }) ||
      (validToExclusive !== null && validToExclusive <= validFrom)) invalid();
    const required: Support['field'][] = [
      'sourceAccountId', 'sellerEntityId', 'contractId', 'validFrom', 'fixedMonthlyFeeCents', 'currency', 'cadence', 'anchorDay',
    ];
    if (validToExclusive !== null) required.push('validToExclusive');
    supportFieldsMatch(fact.support, required);
    const key = canonicalJson([sourceAccountId, contractId]);
    const terms = termsByContract.get(key) ?? [];
    terms.push(fact);
    termsByContract.set(key, terms);
  }
  for (const terms of termsByContract.values()) {
    const sorted = ordered(terms, term => term.validFrom);
    for (const [index, term] of sorted.entries()) {
      if (term.validToExclusive !== (sorted[index + 1]?.validFrom ?? null)) invalid();
    }
  }
  const normalized = { ...producer, identities, contracts };
  if (hashCanonical(normalized) !== hash) invalid();
  return { ...normalized, hash };
}

export function decodeEvidenceProducer(text: string): ProducerV1 {
  try {
    return normalizeProducer(producerSchema.parse(JSON.parse(bound(text))));
  } catch {
    return invalid();
  }
}

function reboundTruth(original: ProtectedFixtureSet, producer: ProducerV1): ProtectedFixtureSet {
  const { hash: producerTruthHash, fixtureSetVersion: producerFixtureSetVersion, fixtureSetId,
    generator, companyId, sourceRef, sellerEntityId, manifestId, manifestHash, ...facts } = original;
  const binding = { producerTruthHash, producerFixtureSetVersion, fixtureSetId, generator, companyId, sourceRef,
    sellerEntityId, manifestId, manifestHash };
  const { schemaVersion: _schema, kind: _kind, identities: _identities, contracts: _contracts, hash: _hash, ...metadata } = producer;
  if (!equal(metadata, binding)) invalid();
  const preimage = { ...facts, fixtureSetId, generator, companyId, sourceRef, sellerEntityId, manifestId, manifestHash,
    fixtureSetVersion: '2' };
  return decodeTruth(canonicalJson({ ...preimage, hash: hashCanonical(preimage) }));
}

function normalizeMembers<T extends Pick<EvidenceInputV1, keyof typeof evidenceMembers>>(value: T): T {
  return {
    ...value,
    demoBindings: ordered(value.demoBindings, item => item.identityFactId),
    originals: ordered(value.originals, item => item.sourceId),
    citations: ordered(value.citations, item => item.evidence.id),
    resolvedSupport: ordered(value.resolvedSupport, resolvedKey),
  };
}

function normalizeSnapshot(snapshot: EvidenceFixtureInput['snapshot']) {
  return {
    ...snapshot, evidenceIds: ordered(snapshot.evidenceIds, id => id), eventIds: ordered(snapshot.eventIds, id => id),
  };
}

function verifyCitations(
  responses: EvidenceResponse[], original: Original, extraction: Awaited<ReturnType<typeof extractDocument>>,
  snapshotId: string, byteLength: number,
) {
  for (const response of responses) {
    const { evidence, text } = response;
    const { sourceId, locator } = evidence;
    const located = locate(extraction.document, locator);
    if (evidence.id !== 'ev:' + hashCanonical({ snapshotId, sourceId, locator }) ||
      evidence.snapshotId !== snapshotId || evidence.sha256 !== original.sha256 ||
      response.original.sha256 !== original.sha256 || response.original.byteLength !== byteLength ||
      response.mediaType !== extraction.mediaType || text.value !== located.value ||
      text.startInclusive !== located.startInclusive || text.endExclusive !== located.endExclusive ||
      evidence.excerpt !== located.excerpt || text.sha256 !== hashBytes(Buffer.from(located.value, 'utf8'))) invalid();
  }
}

async function verifyOriginals(
  evidence: EvidenceInputV1, truth: ProtectedFixtureSet, manifest: BootstrapManifest,
  snapshot: EvidenceFixtureInput['snapshot'], events: EvidenceFixtureInput['events'],
) {
  const source = [companyA, companyB].find(candidate => candidate.companyId === truth.companyId &&
    candidate.sourceRef === truth.sourceRef && candidate.sellerEntityId === truth.sellerEntityId);
  if (!source) invalid();
  const csvStreams = new Set(source.streams.filter(stream => stream.transport === 'csv').map(stream => stream.streamId));
  const streams = new Set(source.streams.map(stream => stream.streamId));
  if (manifest.streams.some(stream => !streams.has(stream.streamId)) ||
    events.some(event => event.rawIdentity.sellerEntityId !== truth.sellerEntityId)) invalid();
  const files = new Map(manifest.files.map(file => [file.fileId, file]));
  const byEventId = new Map(events.map(event => [event.id, event]));
  const expectedText = new Map(truth.evidence.map(item => [item.fileId, item]));
  const bySourceId = new Map<string, EvidenceResponse[]>();
  for (const citation of evidence.citations) {
    const responses = bySourceId.get(citation.evidence.sourceId) ?? [];
    responses.push(citation);
    bySourceId.set(citation.evidence.sourceId, responses);
  }
  exactKeys(snapshot.evidenceIds, evidence.citations.map(citation => citation.evidence.id));
  exactKeys(bySourceId.keys(), evidence.originals.map(original => original.sourceId));
  exactKeys(files.keys(), evidence.originals.flatMap(original => original.binding.kind === 'document' ? [original.binding.fileId] : []));
  const coveredEvents = new Set<string>();
  const verifiedText = new Set<string>();
  function coverEvent(id: string) {
    if (coveredEvents.has(id)) invalid();
    coveredEvents.add(id);
  }

  for (const original of evidence.originals) {
    const { sourceId, companyId, sourceRef, sha256, binding, bytesBase64 } = original;
    const bytes = Buffer.from(bytesBase64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== bytesBase64 || hashBytes(bytes) !== sha256 ||
      companyId !== truth.companyId || sourceRef !== truth.sourceRef) invalid();
    const responses = bySourceId.get(sourceId)!;
    if (binding.kind === 'api-json') {
      const event = byEventId.get(binding.eventId);
      if (!event || csvStreams.has(event.streamId) || sourceId !== 'api:' + hashCanonical({ companyId, sourceRef, eventId: event.id })) invalid();
      const extraction = await extractDocument('api_json', bytes);
      if (extraction.document.kind !== 'json' || !equal(extraction.document.value, event.payload)) invalid();
      verifyCitations(responses, original, extraction, snapshot.id, bytes.length);
      coverEvent(event.id);
      continue;
    }
    const file = files.get(binding.fileId);
    if (!file || sourceId !== file.fileId || sha256 !== file.sha256) invalid();
    const extraction = await extractDocument(file.kind, bytes);
    verifyCitations(responses, original, extraction, snapshot.id, bytes.length);
    const document = extraction.document;
    if (file.kind === 'event_csv') {
      if (!file.streamId || !csvStreams.has(file.streamId)) invalid();
      const rows = decodeBatch(file.streamId, document);
      exactKeys(rows.map((_, index) => String(index + 1)), responses.map(({ evidence: { locator } }) => {
        if (locator.kind !== 'csv' || locator.column !== 'payload_json') invalid();
        return String(locator.row);
      }));
      for (const row of rows) {
        const event = byEventId.get(row.id);
        if (!event || !equal(row, event)) invalid();
        coverEvent(row.id);
      }
    }
    const originalText = expectedText.get(file.fileId);
    if (originalText) {
      const value = document.kind === 'pdf' ? document.pages.join(' ') : document.kind === 'email' ? document.body : undefined;
      if (value !== originalText.text || sha256 !== originalText.originalSha256) invalid();
      verifiedText.add(file.fileId);
    }
  }
  exactKeys(events.map(event => event.id), coveredEvents);
  exactKeys(expectedText.keys(), verifiedText);
}

function verifySupport(evidence: EvidenceInputV1, truth: ProtectedFixtureSet, manifest: BootstrapManifest) {
  const { identities, contracts } = evidence.producer;
  const accounts = new Set(truth.accounts.map(account => account.sourceAccountId));
  const identitiesById = new Map(identities.map(identity => [identity.id, identity]));
  exactKeys(identitiesById.keys(), evidence.demoBindings.map(binding => binding.identityFactId));
  for (const binding of evidence.demoBindings) {
    const identity = identitiesById.get(binding.identityFactId)!;
    if (!accounts.has(identity.sourceAccountId) ||
      !Object.hasOwn(manifest.semanticVersions, identity.sellerEntityId + '/' + identity.sourceAccountId) ||
      binding.parentCustomerId !== identity.buyerId ||
      binding.accountId !== IdSchema.parse([truth.companyId, identity.sellerEntityId, identity.sourceAccountId].join('.'))) invalid();
  }
  const eligibleFiles = new Set(manifest.files.filter(file => file.kind === 'contract_pdf' || file.kind === 'amendment_pdf' ||
    file.kind === 'email_json').map(file => file.fileId));
  const producerEvidence = new Set(truth.evidence.map(item => item.fileId));
  const resolved: ResolvedSupport[] = [];
  for (const fact of [...identities, ...contracts]) {
    for (const item of fact.support) {
      if (!eligibleFiles.has(item.fileId) || !producerEvidence.has(item.fileId)) invalid();
      // Citation arrays are already ordered by ID. Match only the independently verified cited range.
      const citation = evidence.citations.find(({ evidence: ref, text }) => ref.sourceId === item.fileId &&
        text.value.slice(text.startInclusive, text.endExclusive).includes(item.expectedLiteral));
      if (!citation) invalid();
      resolved.push({ ...item, factId: fact.id, evidenceId: citation.evidence.id });
    }
  }
  if (!equal(ordered(resolved, resolvedKey), evidence.resolvedSupport)) invalid();
}

export async function decodeProtectedEvidenceBundle(text: string, manifestInput: BootstrapManifest) {
  try {
    const { bundleHash, ...parsed } = bundleSchema.parse(JSON.parse(bound(text)));
    const manifest = BootstrapManifestSchema.parse(manifestInput);
    const evidence = normalizeMembers({ ...parsed.evidence, producer: normalizeProducer(parsed.evidence.producer) });
    const { hash, ...evidencePreimage } = evidence;
    const snapshot = normalizeSnapshot(parsed.snapshot);
    const events = ordered(parsed.events, event => event.id);
    const bundle = { ...parsed, evidence, snapshot, events };
    if (hashCanonical(bundle) !== bundleHash || hashCanonical(evidencePreimage) !== hash) invalid();
    const original = decodeTruth(bound(evidence.producerTruthJson));
    const expected = reboundTruth(original, evidence.producer);
    const truth = decodeTruth(bound(bundle.truthJson), bundle.pin);
    if (evidence.producerTruthJson !== canonicalJson(original) || bundle.truthJson !== canonicalJson(expected) ||
      evidence.fixtureSetId !== truth.fixtureSetId || evidence.financialTruthHash !== truth.hash ||
      evidence.manifestId !== manifest.id || evidence.manifestHash !== manifest.hash ||
      evidence.snapshotId !== snapshot.id || evidence.snapshotHash !== snapshot.contentHash) invalid();
    verifyTruthMembers(truth, manifest, snapshot, events);
    verifyCaptureBinding(manifest, snapshot);
    await verifyOriginals(evidence, truth, manifest, snapshot, events);
    verifySupport(evidence, truth, manifest);
    return { truth, snapshot, events, evidence };
  } catch {
    return invalid();
  }
}

/** Operator input is normalized and fully decoded before any immutable file is published. */
export async function prepareProtectedEvidenceBundle(input: EvidenceFixtureInput) {
  try {
    const { producerTruthJson, producerJson, manifest, snapshot: inputSnapshot, events: inputEvents, ...members } = pinInputSchema.parse(input);
    const original = decodeTruth(bound(producerTruthJson));
    const producer = decodeEvidenceProducer(producerJson);
    const truth = reboundTruth(original, producer);
    const snapshot = normalizeSnapshot(inputSnapshot);
    const events = ordered(inputEvents, event => event.id);
    const pin = { fixtureSetId: truth.fixtureSetId, fixtureSetVersion: '2' as const, hash: truth.hash };
    const evidence = normalizeMembers({
      ...members, schemaVersion: 1 as const, fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion,
      producer, producerTruthJson: canonicalJson(original), financialTruthHash: truth.hash,
      manifestId: manifest.id, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotHash: snapshot.contentHash,
    });
    const bundle = {
      schemaVersion: 2 as const, pin, truthJson: canonicalJson(truth), snapshot, events,
      evidence: { ...evidence, hash: hashCanonical(evidence) },
    };
    const bytes = bound(canonicalJson({ ...bundle, bundleHash: hashCanonical(bundle) }));
    const validated = await decodeProtectedEvidenceBundle(bytes, manifest);
    return { pin, bytes, purpose: validated.truth.purpose, snapshotHash: validated.snapshot.contentHash };
  } catch {
    return invalid();
  }
}
