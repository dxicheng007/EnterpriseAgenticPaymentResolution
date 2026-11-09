import {
  DiscoveryBindingSchema, IdSchema, SourceReadGrantSchema,
  type DiscoveryBinding, type DiscoverySubject, type EvidenceRef, type Hash, type Id, type IsoInstant,
  type SourceReadGrant, type Version,
} from '@eapr/contracts';
import { CitationError, locate } from '@eapr/evidence';
import { parseAgreement, parseDirectory } from './document-identity.js';
import type { ValidatedDiscoveryCapture } from './discovery-reads.js';
import { SourceError } from './errors.js';
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

type PdfLocator = Extract<EvidenceRef['locator'], { kind: 'pdf' }>;

function invalidRequest(): never {
  throw new SourceError(400, 'SOURCE_CONTENT_INVALID', 'Document applicability request is invalid');
}

function forbiddenGrant(): never {
  throw new SourceError(403, 'SOURCE_FORBIDDEN', 'Document applicability grant is forbidden');
}

function tupleKey(sellerEntityId: Id, sourceAccountId: Id) {
  return JSON.stringify([sellerEntityId, sourceAccountId]);
}

function parsedIdsValid(ids: readonly string[]) {
  return ids.every(value => IdSchema.safeParse(value).success);
}

function pageOneText(file: StoredSourceFile) {
  const { document } = file.extraction;
  return document.kind === 'pdf' ? document.pages[0] : undefined;
}

function emailBody(file: StoredSourceFile) {
  const { document } = file.extraction;
  return document.kind === 'email' ? document.body : undefined;
}

function isFullPageOneLocator(locator: EvidenceRef['locator'], page: string): locator is PdfLocator {
  return locator.kind === 'pdf' && locator.page === 1 && locator.start === 0 && locator.end === page.length;
}

function conflictedTuples(capture: DocumentApplicabilityCapture) {
  const agreements = new Map<string, { sourceBuyerId: Id; displayName: string }[]>();
  const directories = new Map<string, Id[]>();
  for (const file of capture.files) {
    if (file.metadata.kind === 'contract_pdf') {
      const text = pageOneText(file);
      if (!text) continue;
      const parsed = parseAgreement({ text, citationId: file.file_id }, capture.manifest.asOf);
      if (!parsed || !parsedIdsValid([
        parsed.contractId, parsed.sellerEntityId, parsed.sourceBuyerId, parsed.sourceAccountId,
      ])) continue;
      const key = tupleKey(parsed.sellerEntityId, parsed.sourceAccountId);
      agreements.set(key, [...(agreements.get(key) ?? []), parsed]);
    } else if (file.metadata.kind === 'email_json') {
      const text = emailBody(file);
      if (text === undefined) continue;
      for (const claim of parseDirectory({ text, citationId: file.file_id })) {
        if (!parsedIdsValid([claim.sellerEntityId, claim.sourceBuyerId, claim.sourceAccountId])) continue;
        const key = tupleKey(claim.sellerEntityId, claim.sourceAccountId);
        directories.set(key, [...(directories.get(key) ?? []), claim.sourceBuyerId]);
      }
    }
  }
  const conflicted = new Set<string>();
  for (const [key, claims] of agreements) {
    const first = claims[0]!;
    if (claims.some(claim => claim.sourceBuyerId !== first.sourceBuyerId || claim.displayName !== first.displayName) ||
        (directories.get(key) ?? []).some(buyer => buyer !== first.sourceBuyerId)) {
      conflicted.add(key);
    }
  }
  return conflicted;
}

function associateCitation(
  capture: DocumentApplicabilityCapture,
  source: SourceDefinition,
  citation: EvidenceRef,
  observed: ReadonlySet<string>,
  conflicted: ReadonlySet<string>,
): DocumentAssociation | undefined {
  const file = capture.files.find(entry => entry.file_id === citation.sourceId);
  if (!file || file.metadata.kind !== 'contract_pdf') return;
  const { document } = file.extraction;
  if (document.kind !== 'pdf' || document.pages.length !== 1) return;
  const page = document.pages[0];
  const { locator } = citation;
  if (!page || !isFullPageOneLocator(locator, page)) return;
  try {
    if (locate(document, locator).excerpt !== page) return;
  } catch (error) {
    if (error instanceof CitationError) return;
    throw error;
  }
  const parsed = parseAgreement({ text: page, citationId: citation.id }, capture.manifest.asOf);
  if (!parsed || !parsedIdsValid([
    parsed.contractId, parsed.sellerEntityId, parsed.sourceBuyerId, parsed.sourceAccountId,
  ])) return;
  if (parsed.sellerEntityId !== source.sellerEntityId) return;
  const key = tupleKey(parsed.sellerEntityId, parsed.sourceAccountId);
  if (!observed.has(key) || conflicted.has(key)) return;
  return {
    evidenceId: citation.id,
    fileId: file.file_id,
    documentId: file.metadata.documentId,
    documentVersion: file.metadata.documentVersion,
    originalHash: file.content_hash,
    locator,
    subject: {
      kind: 'source_account',
      sellerEntityId: parsed.sellerEntityId,
      sourceAccountId: parsed.sourceAccountId,
    },
  };
}

export function validateDocumentApplicabilityRequest(
  input: DocumentApplicabilityRequest,
): DocumentApplicabilityRequest {
  const binding = DiscoveryBindingSchema.safeParse(input?.binding);
  const sourceRead = SourceReadGrantSchema.safeParse(input?.sourceRead);
  const evidenceIds = IdSchema.array().max(50).safeParse(input?.evidenceIds);
  if (!binding.success || !sourceRead.success || !evidenceIds.success ||
      new Set(evidenceIds.data).size !== evidenceIds.data.length) {
    invalidRequest();
  }
  if (binding.data.companyId !== sourceRead.data.companyId ||
      binding.data.sourceRef !== sourceRead.data.sourceRef) {
    forbiddenGrant();
  }
  if (!sourceRead.data.sourceWide) forbiddenGrant();
  return { binding: binding.data, sourceRead: sourceRead.data, evidenceIds: evidenceIds.data };
}

export function partitionDocumentApplicability(
  capture: DocumentApplicabilityCapture,
  source: SourceDefinition,
  evidenceIds: readonly Id[],
): Pick<PreparedDocumentApplicability, 'associations' | 'unresolvedEvidenceIds'> {
  const captured = new Set(capture.facts.evidenceIds);
  for (const evidenceId of evidenceIds) {
    if (!captured.has(evidenceId)) {
      throw new SourceError(400, 'SOURCE_CONTENT_INVALID', 'Document applicability citation is not in the capture');
    }
  }
  const citations = new Map<Id, EvidenceRef>();
  for (const citation of capture.fileCitations) citations.set(citation.id, citation);
  for (const { evidence } of capture.apiCitations) citations.set(evidence.id, evidence);
  const observed = new Set(
    capture.facts.sourceAccounts.map(account => tupleKey(account.sellerEntityId, account.sourceAccountId)),
  );
  const conflicted = conflictedTuples(capture);
  const associations: DocumentAssociation[] = [];
  const unresolvedEvidenceIds: Id[] = [];
  for (const evidenceId of [...new Set(evidenceIds)].toSorted()) {
    const citation = citations.get(evidenceId);
    const associated = citation && associateCitation(capture, source, citation, observed, conflicted);
    if (associated) associations.push(associated);
    else unresolvedEvidenceIds.push(evidenceId);
  }
  return { associations, unresolvedEvidenceIds };
}
