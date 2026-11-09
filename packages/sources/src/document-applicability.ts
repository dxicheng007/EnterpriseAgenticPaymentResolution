import type {
  DiscoveryBinding, DiscoverySubject, EvidenceRef, Hash, Id, IsoInstant, SourceReadGrant, Version,
} from '@eapr/contracts';
import type { ValidatedDiscoveryCapture } from './discovery-reads.js';
import type { SourceDefinition } from './records.js';
import type { StoredSourceFile } from './uploads.js';

export type DocumentApplicabilityRequest = {
  binding: DiscoveryBinding;
  sourceRead: SourceReadGrant;
  evidenceIds: readonly Id[];
};

export type DocumentAssociation = {
  evidenceId: Id;
  fileId: Id;
  documentId: Id;
  documentVersion: Version;
  originalHash: Hash;
  locator: Extract<EvidenceRef['locator'], { kind: 'pdf' }>;
  subject: Extract<DiscoverySubject, { kind: 'source_account' }>;
};

export type PreparedDocumentApplicability = {
  facts: ValidatedDiscoveryCapture;
  derivation: 'captured-agreement-association-v1';
  associations: readonly DocumentAssociation[];
  unresolvedEvidenceIds: readonly Id[];
};

export type DocumentApplicabilityCapture = {
  facts: ValidatedDiscoveryCapture;
  files: readonly StoredSourceFile[];
  fileCitations: readonly EvidenceRef[];
  apiCitations: readonly { evidence: EvidenceRef }[];
  manifest: { asOf: IsoInstant };
};

export function validateDocumentApplicabilityRequest(
  input: DocumentApplicabilityRequest,
): DocumentApplicabilityRequest {
  return input;
}

export function partitionDocumentApplicability(
  _capture: DocumentApplicabilityCapture,
  _source: SourceDefinition,
  _evidenceIds: readonly Id[],
): Pick<PreparedDocumentApplicability, 'associations' | 'unresolvedEvidenceIds'> {
  return { associations: [], unresolvedEvidenceIds: [] };
}
