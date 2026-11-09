import { z } from 'zod';
import {
  DescribeSourceResultSchema, DiscoveryBindingSchema, HashSchema, IdSchema, PdfLocatorSchema,
  QuerySnapshotResultSchema, ReadEvidenceResultSchema, SearchEvidenceResultSchema, VersionSchema,
  hashCanonical, strict,
  type DiscoveryBinding, type DiscoveryReadToolFailure, type DiscoveryReadToolName, type DiscoveryReadToolResult,
  type SourceReadGrant,
} from '../../contracts/src/index.js';
import type {
  DiscoveryDocumentApplicabilityTools, DiscoveryReadTools as SourceDiscoveryReadTools, PreparedDiscoveryRead,
} from '../../sources/src/discovery-tools.js';
import { SourceError } from '../../sources/src/errors.js';
import type { CaptureFacts } from './tasks.js';

export type DiscoveryReadTools = SourceDiscoveryReadTools & DiscoveryDocumentApplicabilityTools;
type AccountSubject = CaptureFacts['sourceAccounts'][number];
export type DocumentAssociations = ReadonlyMap<string, AccountSubject>;

const resultSchemas = {
  describeSource: DescribeSourceResultSchema,
  querySnapshot: QuerySnapshotResultSchema,
  searchEvidence: SearchEvidenceResultSchema,
  readEvidence: ReadEvidenceResultSchema,
};

export function parseReadResult(name: DiscoveryReadToolName, result: unknown): DiscoveryReadToolResult | undefined {
  const parsed = resultSchemas[name].safeParse(result);
  return parsed.success ? parsed.data : undefined;
}

export function captureFailure(error: unknown): DiscoveryReadToolFailure['code'] {
  if (!(error instanceof SourceError)) return 'SOURCE_UNAVAILABLE';
  switch (error.code) {
    case 'SOURCE_FORBIDDEN': return 'DISCOVERY_FORBIDDEN';
    case 'SOURCE_CONTENT_INVALID': return error.status === 400 ? 'DISCOVERY_INVALID' : 'DISCOVERY_CONFLICT';
    case 'SOURCE_NOT_FOUND':
    case 'SOURCE_EPOCH_CONFLICT':
    case 'SOURCE_HASH_CONFLICT':
    case 'MANIFEST_MEMBER_MISSING':
    case 'CITATION_INVALID': return 'DISCOVERY_CONFLICT';
    default: return 'SOURCE_UNAVAILABLE';
  }
}

export async function prepareRead(
  tools: DiscoveryReadTools,
  input: Parameters<DiscoveryReadTools['prepare']>[0],
): Promise<PreparedDiscoveryRead | { result: DiscoveryReadToolFailure }> {
  try {
    return await tools.prepare(input);
  } catch (error) {
    return { result: { ok: false, code: captureFailure(error) } };
  }
}

const DOCUMENT_BATCH = 50;
const sourceAccountSchema = strict({
  kind: z.literal('source_account'), sellerEntityId: IdSchema, sourceAccountId: IdSchema,
});
const applicabilityResultSchema = strict({
  facts: strict({
    binding: DiscoveryBindingSchema,
    sourceAccounts: z.array(sourceAccountSchema),
    evidenceIds: z.array(IdSchema),
  }),
  derivation: z.literal('captured-agreement-association-v1'),
  associations: z.array(strict({
    evidenceId: IdSchema, fileId: IdSchema, documentId: IdSchema, documentVersion: VersionSchema,
    originalHash: HashSchema, locator: PdfLocatorSchema, subject: sourceAccountSchema,
  })),
  unresolvedEvidenceIds: z.array(IdSchema),
});

function uniqueSorted(ids: readonly string[]) {
  return ids.every((id, index) => index === 0 || ids[index - 1]! < id);
}

function associationsFromBatch(batch: readonly string[], result: unknown, binding: DiscoveryBinding, facts: CaptureFacts) {
  const parsed = applicabilityResultSchema.safeParse(result);
  if (!parsed.success || hashCanonical(parsed.data.facts) !== hashCanonical(facts) ||
      hashCanonical(parsed.data.facts.binding) !== hashCanonical(binding)) return;
  const associatedIds = parsed.data.associations.map(association => association.evidenceId);
  const { unresolvedEvidenceIds } = parsed.data;
  if (!uniqueSorted(associatedIds) || !uniqueSorted(unresolvedEvidenceIds)) return;
  const combined = [...associatedIds, ...unresolvedEvidenceIds].sort();
  if (combined.length !== batch.length || combined.some((id, index) => id !== batch[index])) return;
  const capturedIds = new Set(facts.evidenceIds);
  for (const association of parsed.data.associations) {
    const knownAccount = facts.sourceAccounts.some(account =>
      account.sellerEntityId === association.subject.sellerEntityId &&
      account.sourceAccountId === association.subject.sourceAccountId);
    if (!capturedIds.has(association.evidenceId) || !knownAccount) return;
  }
  return parsed.data.associations;
}

export async function prepareDocumentAssociations(
  tools: DiscoveryReadTools,
  input: { binding: DiscoveryBinding; sourceRead: SourceReadGrant; facts: CaptureFacts },
  evidenceIds: Iterable<string>,
): Promise<DocumentAssociations | DiscoveryReadToolFailure> {
  const ids = [...new Set(evidenceIds)].sort();
  if (ids.length === 0 || !input.sourceRead.sourceWide) return new Map<string, AccountSubject>();
  if (typeof tools.prepareDocumentApplicability !== 'function') return { ok: false, code: 'SOURCE_UNAVAILABLE' };
  const entries: [string, AccountSubject][] = [];
  for (let start = 0; start < ids.length; start += DOCUMENT_BATCH) {
    const batch = ids.slice(start, start + DOCUMENT_BATCH);
    let result: unknown;
    try {
      result = await tools.prepareDocumentApplicability({
        binding: input.binding, sourceRead: input.sourceRead, evidenceIds: batch,
      });
    } catch (error) {
      return { ok: false, code: captureFailure(error) };
    }
    const associations = associationsFromBatch(batch, result, input.binding, input.facts);
    if (!associations) return { ok: false, code: 'DISCOVERY_CONFLICT' };
    for (const association of associations) entries.push([association.evidenceId, association.subject]);
  }
  return new Map(entries);
}
