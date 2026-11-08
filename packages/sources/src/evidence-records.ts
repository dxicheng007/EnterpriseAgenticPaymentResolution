import {
  EvidenceRefSchema, EvidenceResponseSchema, hashBytes, hashCanonical, type EvidenceRef, type EvidenceResponse, type Hash, type Id, type RawIdentity,
} from '@eapr/contracts';
import {
  CitationError, locate, permitsEvidence, type EvidenceCapability, type EvidenceCoverage,
  type EvidenceStore, type Extraction,
} from '@eapr/evidence';
import type { Pool } from 'pg';
import { SourceError } from './errors.js';

export type EvidenceBinding = EvidenceCoverage;
export type EvidenceAuthorization = (binding: EvidenceBinding) => Promise<void>;

type StoredCitation = {
  evidence: EvidenceRef;
  extraction: Extraction;
  byte_length: number;
  content_hash: Hash;
};

async function evidenceBinding(db: Pool, evidenceId: Id): Promise<EvidenceBinding> {
  const result = await db.query<{company_id:Id;source_ref:Id;raw_identity:RawIdentity|null}>(
    'SELECT COALESCE(f.company_id, s.event #>> \'{rawIdentity,companyId}\') AS company_id, ' +
    'COALESCE(f.source_ref, s.source_ref) AS source_ref, s.event -> \'rawIdentity\' AS raw_identity ' +
    'FROM source_evidence e ' +
    'LEFT JOIN source_files f ON f.file_id = e.file_id ' +
    'LEFT JOIN source_events s ON s.api_source_id = e.api_source_id WHERE e.evidence_id = $1',
    [evidenceId],
  );
  if (!result.rows[0]) throw new SourceError(404,'EVIDENCE_NOT_FOUND','Evidence was not found');
  const {company_id,source_ref,raw_identity} = result.rows[0];
  return {companyId:company_id,sourceRef:source_ref,identities:raw_identity ? [raw_identity] : []};
}

async function loadCitation(db: Pool, evidenceId: Id) {
  const result = await db.query<StoredCitation>(
    'SELECT e.evidence, COALESCE(f.extraction, s.api_extraction) AS extraction, ' +
    'COALESCE(f.byte_length, s.api_byte_length) AS byte_length, COALESCE(f.content_hash,s.api_original_hash) AS content_hash ' +
    'FROM source_evidence e LEFT JOIN source_files f ON f.file_id = e.file_id ' +
    'LEFT JOIN source_events s ON s.api_source_id = e.api_source_id WHERE e.evidence_id = $1',
    [evidenceId],
  );
  if (!result.rows[0]) throw new SourceError(404,'EVIDENCE_NOT_FOUND','Evidence was not found');
  return result.rows[0];
}

export function requireCoverage(capability: EvidenceCapability, coverage: EvidenceCoverage) {
  if (!permitsEvidence(capability,coverage)) throw new SourceError(403,'SOURCE_FORBIDDEN','Evidence scope is forbidden');
}

export async function readEvidence(db: Pool, evidenceId: Id, authorize: EvidenceAuthorization): Promise<EvidenceResponse> {
  await authorize(await evidenceBinding(db,evidenceId));
  const row = await loadCitation(db,evidenceId);
  const evidence = EvidenceRefSchema.parse(row.evidence);
  try {
    const {value,startInclusive,endExclusive} = locate(row.extraction.document,evidence.locator);
    return EvidenceResponseSchema.parse({
      evidence,
      mediaType:row.extraction.mediaType,
      original:{url:'/api/evidence/' + evidenceId + '/content',sha256:row.content_hash,byteLength:row.byte_length},
      text:{value,sha256:hashBytes(Buffer.from(value)),unit:'utf16',startInclusive,endExclusive},
    });
  } catch (error) {
    if (error instanceof CitationError) throw new SourceError(422,'CITATION_INVALID','Citation locator is invalid');
    throw error;
  }
}

export async function readEvidenceBytes(db: Pool, store: EvidenceStore, evidenceId: Id, authorize: EvidenceAuthorization) {
  await authorize(await evidenceBinding(db,evidenceId));
  const row = await loadCitation(db,evidenceId);
  try {
    const bytes = await store.get(row.content_hash);
    if (bytes.byteLength !== row.byte_length) throw new Error('Original byte length conflicts');
    return {bytes,mediaType:row.extraction.mediaType};
  } catch {
    throw new SourceError(503,'SOURCE_UNAVAILABLE','Original bytes are unavailable');
  }
}

export function citeEvidence(input:{
  snapshotId:Id; sourceId:Id; contentHash:Hash; extraction:Extraction; locator:EvidenceRef['locator'];
}): EvidenceRef {
  const {snapshotId,sourceId,contentHash,extraction,locator} = input;
  const {excerpt} = locate(extraction.document,locator);
  return EvidenceRefSchema.parse({
    id:'ev:' + hashCanonical({snapshotId,sourceId,locator}),
    snapshotId,sourceId,locator,excerpt,sha256:contentHash,
  });
}
