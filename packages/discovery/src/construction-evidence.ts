import {
  hashCanonical, type DiscoveryBinding, type DiscoveryReadToolFailure, type QuerySnapshotInput, type SourceReadGrant,
} from '../../contracts/src/index.js';
import type { PublishFindingInput } from '../../contracts/src/discovery-construction-tools.js';
import {
  parseReadResult, prepareDocumentAssociations, prepareRead, type DiscoveryReadTools, type DocumentAssociations,
} from './read-tools.js';
import type { CaptureFacts } from './tasks.js';

export type PreparedFindingEvidence = {
  facts: CaptureFacts;
  applicable: boolean;
};

function isDocumentAssociations(
  value: DocumentAssociations | DiscoveryReadToolFailure,
): value is DocumentAssociations {
  return value instanceof Map;
}

export async function prepareFindingEvidence(
  { binding, sourceRead, input }: { binding: DiscoveryBinding; sourceRead: SourceReadGrant; input: PublishFindingInput },
  tools: DiscoveryReadTools,
): Promise<PreparedFindingEvidence | DiscoveryReadToolFailure> {
  const citations = new Set([...input.evidenceRefs, ...input.alternatives.flatMap(alternative => alternative.evidenceRefs)]);
  let facts: CaptureFacts | undefined;
  const conflict = { ok: false, code: 'DISCOVERY_CONFLICT' } as const;
  function accept(next: CaptureFacts) {
    if (hashCanonical(next.binding) !== hashCanonical(binding) ||
        (facts && hashCanonical(next) !== hashCanonical(facts))) return false;
    facts ??= structuredClone(next);
    return true;
  }

  if (citations.size === 0) {
    const prepared = await prepareRead(tools, { binding, sourceRead, name: 'describeSource', arguments: {} });
    if (!prepared.result.ok) return prepared.result;
    const result = parseReadResult('describeSource', prepared.result);
    if (!result?.ok || !('binding' in result) || hashCanonical(result.binding) !== hashCanonical(binding) ||
        !('facts' in prepared) || !accept(prepared.facts)) return conflict;
  }
  for (const evidenceId of citations) {
    const prepare = (end: number) => prepareRead(tools, {
      binding, sourceRead, name: 'readEvidence', arguments: { evidenceId, range: { start: 0, end } },
    });
    let prepared = await prepare(1);
    // The first Unicode character may be a UTF-16 surrogate pair.
    if (!prepared.result.ok && prepared.result.code === 'DISCOVERY_INVALID') prepared = await prepare(2);
    if (!prepared.result.ok) return prepared.result;
    const result = parseReadResult('readEvidence', prepared.result);
    if (!result?.ok || !('evidence' in result) || result.evidence.id !== evidenceId ||
        !('facts' in prepared) || !accept(prepared.facts)) return conflict;
  }

  if (input.subject.kind === 'source') return { facts: facts!, applicable: true };
  const { sellerEntityId, sourceAccountId } = input.subject;
  if (!facts!.sourceAccounts.some(account => account.sellerEntityId === sellerEntityId &&
      account.sourceAccountId === sourceAccountId)) return conflict;

  // Capture membership alone cannot establish an evidence-to-account association.
  const missing = new Set(citations);
  const cursors = new Set<string>();
  let afterEventId: string | undefined;
  while (missing.size > 0) {
    const args: QuerySnapshotInput = { account: { sellerEntityId, sourceAccountId }, limit: 25,
      ...(afterEventId ? { afterEventId } : {}) };
    const prepared = await prepareRead(tools, { binding, sourceRead, name: 'querySnapshot', arguments: args });
    if (!prepared.result.ok) return prepared.result;
    const result = parseReadResult('querySnapshot', prepared.result);
    if (!result?.ok || !('events' in result) || !('facts' in prepared) || !accept(prepared.facts)) return conflict;
    for (const { event, evidenceIds } of result.events) {
      if (event.rawIdentity.sellerEntityId !== sellerEntityId || event.rawIdentity.sourceAccountId !== sourceAccountId) return conflict;
      for (const id of evidenceIds) missing.delete(id);
    }
    if (!result.nextAfterEventId) break;
    if (cursors.has(result.nextAfterEventId)) return conflict;
    cursors.add(result.nextAfterEventId);
    afterEventId = result.nextAfterEventId;
  }
  if (missing.size > 0) {
    const associations = await prepareDocumentAssociations(tools, { binding, sourceRead, facts: facts! }, missing);
    if (!isDocumentAssociations(associations)) return associations;
    for (const evidenceId of [...missing]) {
      const associated = associations.get(evidenceId);
      if (associated?.sellerEntityId === sellerEntityId && associated.sourceAccountId === sourceAccountId) {
        missing.delete(evidenceId);
      }
    }
  }
  return { facts: facts!, applicable: citations.size > 0 && missing.size === 0 };
}
