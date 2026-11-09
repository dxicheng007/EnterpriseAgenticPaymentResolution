import {
  DescribeSourceResultSchema, DiscoveryBindingSchema, DiscoveryReadToolCallSchema, QuerySnapshotResultSchema,
  ReadEvidenceResultSchema, SearchEvidenceResultSchema, SourceReadGrantSchema, canonicalJson, hashBytes,
  type DiscoveryBinding, type DiscoveryReadToolCall, type DiscoveryReadToolFailure, type DiscoveryReadToolResult,
  type EvidenceRef, type EvidenceResponse, type Id, type QuerySnapshotInput, type QuerySnapshotResult, type RawIdentity,
  type ReadEvidenceInput, type ReadEvidenceResult, type SourceReadGrant,
} from '@eapr/contracts';
import {
  locate, permitsEvidence, searchEvidence, type EvidenceStore, type Extraction, type SearchableCitation,
} from '@eapr/evidence';
import type { Pool } from 'pg';
import { decodeBatch } from './company-b.js';
import { readDiscoveryCaptureContents, type ValidatedDiscoveryCapture } from './discovery-reads.js';
import { SourceError } from './errors.js';
import type { SourceDefinition } from './records.js';

export type DiscoveryReadPreparationInput = {
  binding: DiscoveryBinding;
  sourceRead: SourceReadGrant;
} & DiscoveryReadToolCall;
export type PreparedDiscoveryRead = { facts: ValidatedDiscoveryCapture; result: DiscoveryReadToolResult };
export interface DiscoveryReadTools {
  prepare(input: DiscoveryReadPreparationInput): Promise<PreparedDiscoveryRead>;
}

type Capture = Awaited<ReturnType<typeof readDiscoveryCaptureContents>>;
type CapturedCitation = SearchableCitation & { extraction: Extraction };
type LocatedCitation = Pick<EvidenceResponse, 'evidence' | 'mediaType'> & {
  text: Pick<EvidenceResponse['text'], 'value' | 'startInclusive' | 'endExclusive'>;
};
type SnapshotPage = Extract<QuerySnapshotResult, { ok: true }>;
type Account = SourceReadGrant['accounts'][number];

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const sameAccount = (left: Account, right: Pick<RawIdentity, 'sellerEntityId' | 'sourceAccountId'>) =>
  left.sellerEntityId === right.sellerEntityId && left.sourceAccountId === right.sourceAccountId;
const fail = (code: DiscoveryReadToolFailure['code']): DiscoveryReadToolFailure => ({ ok: false, code });

function conflict(): never {
  throw new SourceError(409, 'SOURCE_HASH_CONFLICT', 'Pinned discovery source content conflicts');
}

function fitsResult(value: unknown) {
  try {
    return Buffer.byteLength(canonicalJson(value)) <= 65_536;
  } catch {
    conflict();
  }
}

function boundedResult<T extends DiscoveryReadToolResult>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  result: T,
): T | DiscoveryReadToolFailure {
  if (!fitsResult(result)) return fail('TOOL_RESULT_LIMIT');
  const checked = schema.safeParse(result);
  if (!checked.success) conflict();
  return checked.data;
}

export function selectDiscoveryExcerpt(
  response: LocatedCitation, range: ReadEvidenceInput['range'],
): ReadEvidenceResult {
  const { value, startInclusive: base, endExclusive: end } = response.text;
  const spanLength = end - base;
  const { start, end: relativeEnd } = range ?? { start: 0, end: spanLength };
  const absoluteStart = base + start;
  const absoluteEnd = base + relativeEnd;
  const splitsPair = (index: number) =>
    index > 0 && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(value.slice(index - 1, index + 1));
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(relativeEnd) || start < 0 ||
      start >= relativeEnd || relativeEnd > spanLength || splitsPair(absoluteStart) || splitsPair(absoluteEnd)) {
    return fail('DISCOVERY_INVALID');
  }
  if (relativeEnd - start > 8192) return fail('TOOL_RESULT_LIMIT');
  const { id, snapshotId, sourceId, locator, sha256 } = response.evidence;
  const selected = value.slice(absoluteStart, absoluteEnd);
  return boundedResult(ReadEvidenceResultSchema, {
    ok: true, evidence: { id, snapshotId, sourceId, locator, sha256 }, mediaType: response.mediaType,
    text: {
      value: selected, startInclusive: absoluteStart, endExclusive: absoluteEnd, unit: 'utf16',
      sha256: hashBytes(Buffer.from(selected, 'utf8')),
    },
  });
}

function capturedCitations(capture: Capture) {
  const { companyId, sourceRef } = capture.facts.binding;
  const events = new Map(capture.events.map(event => [event.id, event]));
  const files = new Map(capture.files.map(file => [file.file_id, file]));
  const entries = new Map<Id, CapturedCitation>();
  function add(evidence: EvidenceRef, extraction: Extraction, identities: RawIdentity[]) {
    entries.set(evidence.id, { evidence, extraction, excerptCoverage: { companyId, sourceRef, identities } });
  }
  for (const { eventId, evidence, extraction } of capture.apiCitations) {
    const event = events.get(eventId);
    if (!event) conflict();
    add(evidence, extraction, [event.rawIdentity]);
  }
  for (const evidence of capture.fileCitations) {
    const file = files.get(evidence.sourceId);
    if (!file) conflict();
    add(evidence, file.extraction, []);
  }
  return entries;
}

function eventEvidence(capture: Capture) {
  const evidence = new Map<Id, Id[]>();
  const events = new Map(capture.events.map(event => [event.id, event]));
  for (const { eventId, evidence: ref } of capture.apiCitations) {
    evidence.set(eventId, [ref.id]);
  }
  const fileRows = new Map<Id, Map<number, Id>>();
  for (const ref of capture.fileCitations) {
    if (ref.locator.kind !== 'csv') continue;
    if (ref.locator.column !== 'payload_json') conflict();
    const rows = fileRows.get(ref.sourceId) ?? new Map<number, Id>();
    if (rows.has(ref.locator.row)) conflict();
    rows.set(ref.locator.row, ref.id);
    fileRows.set(ref.sourceId, rows);
  }
  const associated = new Set<Id>();
  for (const file of capture.files) {
    const batch = file.metadata.batch;
    if (!batch) continue;
    const rows = fileRows.get(file.file_id);
    // Link only existing citations to an exact event proved by the captured batch row.
    for (const [index, event] of decodeBatch(batch.streamId, file.extraction.document).entries()) {
      const pinned = events.get(event.id);
      const citationId = rows?.get(index + 1);
      if (!pinned || !citationId || associated.has(event.id) || canonicalJson(pinned) !== canonicalJson(event)) conflict();
      associated.add(event.id);
      evidence.set(event.id, [...(evidence.get(event.id) ?? []), citationId].sort());
    }
  }
  return evidence;
}

function querySnapshot(
  capture: Capture, source: SourceDefinition, grant: SourceReadGrant, input: QuerySnapshotInput,
): QuerySnapshotResult {
  const { account, resource, afterEventId, limit } = input;
  if (resource !== undefined && !source.contracts.some(contract => contract.resource === resource)) {
    return fail('DISCOVERY_INVALID');
  }
  if (account && (!capture.facts.sourceAccounts.some(candidate => sameAccount(account, candidate)) ||
      (!grant.sourceWide && !grant.accounts.some(candidate => sameAccount(account, candidate))))) {
    return fail('DISCOVERY_FORBIDDEN');
  }

  const filtered = capture.events.filter(event =>
    (resource === undefined || event.resource === resource) &&
    (!account || sameAccount(account, event.rawIdentity)) &&
    (grant.sourceWide || grant.accounts.some(candidate => sameAccount(candidate, event.rawIdentity))))
    .sort((left, right) => compare(left.streamId, right.streamId) || left.sequence - right.sequence);
  const position = afterEventId === undefined ? -1 : filtered.findIndex(event => event.id === afterEventId);
  if (afterEventId !== undefined && position === -1) return fail('DISCOVERY_INVALID');

  const citations = capturedCitations(capture);
  const byEvent = eventEvidence(capture);
  const page: SnapshotPage = { ok: true, events: [], nextAfterEventId: null };
  for (const [offset, event] of filtered.slice(position + 1, position + 1 + limit).entries()) {
    const evidenceIds = (byEvent.get(event.id) ?? []).filter(id => {
      const citation = citations.get(id);
      if (!citation) conflict();
      return permitsEvidence(grant, citation.excerptCoverage);
    });
    const nextAfterEventId = position + offset + 2 < filtered.length ? event.id : null;
    page.events.push({ event, evidenceIds });
    if (!fitsResult({ ...page, nextAfterEventId })) {
      page.events.pop();
      if (page.events.length === 0) return fail('TOOL_RESULT_LIMIT');
      break;
    }
    page.nextAfterEventId = nextAfterEventId;
  }
  return boundedResult(QuerySnapshotResultSchema, page);
}

function prepareResult(
  call: DiscoveryReadToolCall, capture: Capture, source: SourceDefinition, grant: SourceReadGrant,
): DiscoveryReadToolResult {
  switch (call.name) {
    case 'describeSource':
      return boundedResult(DescribeSourceResultSchema, {
        ok: true, binding: capture.facts.binding,
        contracts: source.contracts.toSorted((left, right) => compare(left.resource, right.resource)),
        streams: source.streams.toSorted((left, right) => compare(left.streamId, right.streamId)),
      });
    case 'querySnapshot':
      return querySnapshot(capture, source, grant, call.arguments);
    case 'searchEvidence': {
      const entries = capturedCitations(capture);
      const ordered = capture.facts.evidenceIds.map(id => entries.get(id) ?? conflict());
      const { query, limit } = call.arguments;
      return boundedResult(SearchEvidenceResultSchema, { ok: true, hits: searchEvidence(ordered, grant, query, limit) });
    }
    case 'readEvidence': {
      const { evidenceId, range } = call.arguments;
      const selected = capturedCitations(capture).get(evidenceId);
      if (!selected || !permitsEvidence(grant, selected.excerptCoverage)) return fail('DISCOVERY_FORBIDDEN');
      const { evidence, extraction } = selected;
      const text = locate(extraction.document, evidence.locator);
      return selectDiscoveryExcerpt({ evidence, mediaType: extraction.mediaType, text }, range);
    }
  }
}

export function createDiscoveryReadTools(
  dependencies: { db: Pool; store: Pick<EvidenceStore, 'get'> },
  catalog: ReadonlyMap<Id, SourceDefinition>,
): DiscoveryReadTools {
  return {
    async prepare({ binding, sourceRead, ...call }) {
      const parsedBinding = DiscoveryBindingSchema.safeParse(binding);
      const parsedGrant = SourceReadGrantSchema.safeParse(sourceRead);
      if (!parsedBinding.success || !parsedGrant.success) {
        throw new SourceError(400, 'SOURCE_CONTENT_INVALID', 'Discovery source binding or grant is invalid');
      }
      const pinned = parsedBinding.data;
      const grant = parsedGrant.data;
      if (pinned.companyId !== grant.companyId || pinned.sourceRef !== grant.sourceRef) {
        throw new SourceError(403, 'SOURCE_FORBIDDEN', 'Discovery source grant is forbidden');
      }
      const registered = catalog.get(pinned.companyId);
      if (!registered) throw new SourceError(404, 'SOURCE_NOT_FOUND', 'Registered source was not found');
      const source = structuredClone(registered);
      const capture = await readDiscoveryCaptureContents(dependencies, new Map([[pinned.companyId, source]]), pinned);
      if (canonicalJson(capture.facts.binding) !== canonicalJson(pinned)) {
        throw new SourceError(409, 'SOURCE_EPOCH_CONFLICT', 'Discovery source binding conflicts');
      }
      const { schemaVersions } = capture.manifest;
      if (Object.entries(schemaVersions).some(([resource, schemaVersion]) =>
        !source.contracts.some(contract => contract.resource === resource && contract.schemaVersion === schemaVersion)) ||
        capture.events.some(event => schemaVersions[event.resource] !== event.schemaVersion)) conflict();
      const parsed = DiscoveryReadToolCallSchema.safeParse(call);
      const result = parsed.success ? prepareResult(parsed.data, capture, source, grant) : fail('DISCOVERY_INVALID');
      return { facts: capture.facts, result };
    },
  };
}
