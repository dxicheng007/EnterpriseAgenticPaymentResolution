import type { Pool } from 'pg';
import {
  IdSchema, UploadMetadataSchema, canonicalJson, hashBytes, type EvidenceRef, type RawSourceEvent,
} from '@eapr/contracts';
import type { EvidenceStore } from '@eapr/evidence';
import { readEvidence, readEvidenceBytes, sourceFileId, type EvidenceAuthorization, type SourceDefinition } from '@eapr/sources';
import type { EvidenceFixtureInput, Original, ProducerV1 } from '../packages/evaluator/src/evidence-fixtures.js';

type Capture = Pick<EvidenceFixtureInput, 'manifest' | 'snapshot' | 'events'> & { source: SourceDefinition };
type Association = {
  evidence: EvidenceRef;
  file_id: string | null;
  api_source_id: string | null;
  file_company_id: string | null;
  file_source_ref: string | null;
  document_id: string | null;
  document_version: string | null;
  batch_id: string | null;
  batch_stream_id: string | null;
  batch_sequence: string | null;
  metadata: unknown;
  event_id: string | null;
  event_source_ref: string | null;
  event: RawSourceEvent | null;
  content_hash: string;
  byte_length: number;
};

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

function invalid(): never {
  throw new Error('Captured evidence conflicts');
}

async function association(db: Pool, { source, manifest, snapshot }: Capture, events: Map<string, RawSourceEvent>,
  evidence: EvidenceRef, sha256: string, byteLength: number,
): Promise<Original['binding']> {
  const { rows } = await db.query<Association>(`
    SELECT e.evidence, e.file_id, e.api_source_id, f.company_id AS file_company_id, f.source_ref AS file_source_ref,
      f.document_id, f.document_version::text, f.batch_id, f.batch_stream_id, f.batch_sequence::text, f.metadata,
      s.event_id, s.source_ref AS event_source_ref, s.event,
      COALESCE(f.content_hash, s.api_original_hash) AS content_hash,
      COALESCE(f.byte_length, s.api_byte_length) AS byte_length
    FROM source_evidence e
    LEFT JOIN source_files f ON f.file_id = e.file_id
    LEFT JOIN source_events s ON s.api_source_id = e.api_source_id
    WHERE e.evidence_id = $1 AND e.snapshot_id = $2
  `, [evidence.id, snapshot.id]);
  const row = rows[0];
  if (rows.length !== 1 || !row || !equal(row.evidence, evidence) ||
      row.content_hash !== sha256 || row.byte_length !== byteLength) invalid();

  if (row.file_id === evidence.sourceId && row.api_source_id === null) {
    const member = manifest.files.find(file => file.fileId === row.file_id);
    const metadata = UploadMetadataSchema.parse(row.metadata);
    if (!member || row.file_company_id !== source.companyId || row.file_source_ref !== source.sourceRef ||
        metadata.companyId !== source.companyId || metadata.sourceRef !== source.sourceRef ||
        sourceFileId(metadata) !== member.fileId || metadata.kind !== member.kind || member.sha256 !== sha256 ||
        metadata.documentId !== member.documentId || row.document_id !== member.documentId ||
        metadata.documentVersion !== member.documentVersion || row.document_version !== String(member.documentVersion) ||
        metadata.batch?.batchId !== member.batchId || row.batch_id !== (member.batchId ?? null) ||
        metadata.batch?.streamId !== member.streamId || row.batch_stream_id !== (member.streamId ?? null) ||
        metadata.batch?.sequence !== member.sequence || row.batch_sequence !== (member.sequence === undefined ? null : String(member.sequence))) {
      invalid();
    }
    return { kind: 'document', fileId: row.file_id };
  }

  if (row.file_id === null && row.api_source_id === evidence.sourceId && row.event_id && row.event &&
      row.event_source_ref === source.sourceRef && row.event.sourceRef === source.sourceRef &&
      row.event.rawIdentity.companyId === source.companyId && row.event.rawIdentity.sellerEntityId === source.sellerEntityId) {
    const event = events.get(row.event_id);
    if (event && equal(row.event, event)) return { kind: 'api-json', eventId: row.event_id };
  }
  return invalid();
}

export async function assembleEvidenceVerificationInput(
  db: Pool, store: EvidenceStore, capture: Capture, producerTruthJson: string, producerJson: string, producer: ProducerV1,
): Promise<EvidenceFixtureInput> {
  const { source, manifest, snapshot, events } = capture;
  const { companyId, sourceRef, sellerEntityId } = source;
  const authorize: EvidenceAuthorization = async binding => {
    if (binding.companyId !== companyId || binding.sourceRef !== sourceRef ||
        binding.identities.some(identity => identity.companyId !== companyId || identity.sellerEntityId !== sellerEntityId)) invalid();
  };

  const byEventId = new Map(events.map(event => [event.id, event]));
  const originals = new Map<string, Original>();
  const citations: EvidenceFixtureInput['citations'] = [];
  for (const id of [...snapshot.evidenceIds].sort(compare)) {
    const [response, { bytes, mediaType }] = await Promise.all([
      readEvidence(db, id, authorize), readEvidenceBytes(db, store, id, authorize),
    ]);
    const { evidence } = response;
    const sha256 = hashBytes(bytes);
    if (evidence.id !== id || evidence.snapshotId !== snapshot.id ||
        sha256 !== evidence.sha256 || sha256 !== response.original.sha256 ||
        bytes.byteLength !== response.original.byteLength || mediaType !== response.mediaType) invalid();
    const binding = await association(db, capture, byEventId, evidence, sha256, bytes.byteLength);
    const original = {
      sourceId: evidence.sourceId, companyId, sourceRef, sha256, binding, bytesBase64: Buffer.from(bytes).toString('base64'),
    };
    const previous = originals.get(original.sourceId);
    if (previous && !equal(previous, original)) invalid();
    originals.set(original.sourceId, original);
    citations.push(response);
  }

  const resolvedSupport = [...producer.identities, ...producer.contracts].flatMap(fact => fact.support.map(support => {
    const citation = citations.find(({ evidence, text }) => evidence.sourceId === support.fileId &&
      text.value.slice(text.startInclusive, text.endExclusive).includes(support.expectedLiteral));
    if (!citation) return invalid();
    return { ...support, factId: fact.id, evidenceId: citation.evidence.id };
  }));
  const supportKey = ({ factId, field, fileId, expectedLiteral, evidenceId }: EvidenceFixtureInput['resolvedSupport'][number]) =>
    canonicalJson([factId, field, fileId, expectedLiteral, evidenceId]);
  return {
    producerTruthJson, producerJson, manifest,
    snapshot: { ...snapshot, eventIds: [...snapshot.eventIds].sort(compare), evidenceIds: [...snapshot.evidenceIds].sort(compare) },
    events: [...events].sort((a, b) => compare(a.id, b.id)),
    originals: [...originals.values()].sort((a, b) => compare(a.sourceId, b.sourceId)),
    citations,
    resolvedSupport: resolvedSupport.sort((a, b) => compare(supportKey(a), supportKey(b))),
    demoBindings: producer.identities.map(identity => ({
      identityFactId: identity.id, policy: 'generated-demo-buyer-account-v1', parentCustomerId: identity.buyerId,
      accountId: IdSchema.parse([companyId, sellerEntityId, identity.sourceAccountId].join('.')),
    })),
  };
}
