import {
  hashCanonical, type CaptureStream, type DiscoveryBinding, type DiscoveryReadToolCall, type DiscoveryReadToolFailure, type DiscoverySubject,
  type SourceContract, type SourceReadGrant,
} from '../../contracts/src/index.js';
import type { DraftConnectorInput, ReviseConnectorInput } from '../../contracts/src/discovery-construction-tools.js';
import {
  parseReadResult, prepareDocumentAssociations, prepareRead, type DiscoveryReadTools, type DocumentAssociations,
} from './read-tools.js';
import type { CaptureFacts } from './tasks.js';

function isDocumentAssociations(
  value: DocumentAssociations | DiscoveryReadToolFailure,
): value is DocumentAssociations {
  return value instanceof Map;
}

export type ProposalInput = DraftConnectorInput | ReviseConnectorInput;
export type AccountSubject = Extract<DiscoverySubject, { kind: 'source_account' }>;
export type PreparedProposalEvidence = {
  facts: CaptureFacts;
  contracts: SourceContract[];
  streams: CaptureStream[];
  accountSubjects: AccountSubject[];
  diagnosticCodes: string[];
};

export function tupleKey(account: Pick<AccountSubject, 'sellerEntityId' | 'sourceAccountId'>) {
  return JSON.stringify([account.sellerEntityId, account.sourceAccountId]);
}

export function profileSubjects(profile: ProposalInput['profiles'][number]): AccountSubject[] {
  return profile.sourceAccountIds.map(sourceAccountId => ({
    kind: 'source_account', sellerEntityId: profile.scope.sellerEntityId, sourceAccountId,
  }));
}

type CitationFields = Pick<ProposalInput, 'spec' | 'profiles'>;

function accountEvidenceIds(profile: CitationFields['profiles'][number]) {
  return [
    ...profile.contractTerms.flatMap(term => term.evidenceRefs),
    ...profile.findings.flatMap(finding => finding.evidenceRefs),
    ...(profile.bootstrap?.customer.evidenceRefs ?? []),
  ];
}

export function proposalCitationIds({ spec, profiles }: CitationFields): string[] {
  const profile = profiles[0]!;
  const citations = new Set([
    ...spec.evidenceRefs, ...accountEvidenceIds(profile),
    ...profile.approvedLookups.flatMap(lookup => lookup.entries.flatMap(entry => entry.evidenceRefs)),
  ]);
  for (const mapping of spec.mappings) {
    for (const operation of Object.values(mapping.fields)) {
      if (operation.op === 'constant') citations.add(operation.evidenceRef);
    }
  }
  return [...citations];
}

export async function prepareProposalEvidence(
  { binding, sourceRead, input, retainedEvidenceIds = [] }: {
    binding: DiscoveryBinding; sourceRead: SourceReadGrant; input: ProposalInput; retainedEvidenceIds?: readonly string[];
  },
  tools: DiscoveryReadTools,
): Promise<PreparedProposalEvidence | DiscoveryReadToolFailure> {
  const conflict = { ok: false, code: 'DISCOVERY_CONFLICT' } as const;
  const forbidden = { ok: false, code: 'DISCOVERY_FORBIDDEN' } as const;
  const prepare = (call: DiscoveryReadToolCall) =>
    prepareRead(tools, { ...call, binding, sourceRead });
  const described = await prepare({ name: 'describeSource', arguments: {} });
  if (!described.result.ok) return described.result;
  const description = parseReadResult('describeSource', described.result);
  if (!description?.ok || !('binding' in description) || !('facts' in described) ||
      hashCanonical(description.binding) !== hashCanonical(binding) ||
      hashCanonical(described.facts.binding) !== hashCanonical(binding)) return conflict;
  const facts = structuredClone(described.facts);
  const factsHash = hashCanonical(facts);
  const sameFacts = (prepared: Awaited<ReturnType<typeof prepareRead>>) =>
    'facts' in prepared && hashCanonical(prepared.facts) === factsHash;
  const { contracts, streams } = description;
  const { spec } = input;
  const profile = input.profiles[0]!;
  if (spec.sourceRef !== binding.sourceRef || profile.sourceRef !== binding.sourceRef ||
      profile.scope.companyId !== binding.companyId) return forbidden;

  const orderedContracts = (items: SourceContract[]) => [...items].sort((a, b) => a.resource < b.resource ? -1 : 1)
    .map(contract => ({
      ...contract, fields: Object.fromEntries(Object.entries(contract.fields).map(([key, field]) =>
        [key, field.type === 'string' && field.enum ? { ...field, enum: [...field.enum].sort() } : field])),
    }));
  const orderedStreams = (items: CaptureStream[]) => [...items].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
    .map(stream => ({ ...stream, resources: [...stream.resources].sort() }));
  if (hashCanonical(orderedContracts(spec.sourceContracts)) !== hashCanonical(orderedContracts(contracts)) ||
      hashCanonical(orderedStreams(spec.capture)) !== hashCanonical(orderedStreams(streams))) return conflict;

  const accountSubjects = profileSubjects(profile);
  const captured = new Set(facts.sourceAccounts.map(tupleKey));
  const granted = new Set(sourceRead.accounts.map(tupleKey));
  for (const subject of accountSubjects) {
    const key = tupleKey(subject);
    if (!captured.has(key)) return conflict;
    if (!sourceRead.sourceWide && !granted.has(key)) return forbidden;
  }

  const boundRefs = [...new Set(accountEvidenceIds(profile))];
  const citations = new Set([...proposalCitationIds(input), ...retainedEvidenceIds]);
  for (const evidenceId of citations) {
    const read = (end: number) => prepare({ name: 'readEvidence', arguments: { evidenceId, range: { start: 0, end } } });
    let prepared = await read(1);
    if (!prepared.result.ok && prepared.result.code === 'DISCOVERY_INVALID') prepared = await read(2);
    if (!prepared.result.ok) return prepared.result;
    const result = parseReadResult('readEvidence', prepared.result);
    if (!result?.ok || !('evidence' in result) || result.evidence.id !== evidenceId ||
        !sameFacts(prepared) || !facts.evidenceIds.includes(evidenceId)) return conflict;
  }

  const profileKeys = new Set(accountSubjects.map(tupleKey));
  const associatedByTuple = new Map<string, Set<string>>(
    accountSubjects.map(subject => [tupleKey(subject), new Set<string>()]),
  );
  const qualifyingEntries = (sourceAccountId: string) => profile.approvedLookups
    .filter(lookup => lookup.valueType === 'parent-account')
    .flatMap(lookup => lookup.entries)
    .filter(entry =>
      entry.source === sourceAccountId && entry.target === profile.scope.accountId && entry.evidenceRefs.length > 0);

  for (const { sellerEntityId, sourceAccountId } of accountSubjects) {
    const associated = associatedByTuple.get(tupleKey({ sellerEntityId, sourceAccountId }))!;
    const needed = new Set([...boundRefs, ...qualifyingEntries(sourceAccountId).flatMap(entry => entry.evidenceRefs)]);
    const cursors = new Set<string>();
    let afterEventId: string | undefined;
    while (needed.size > 0) {
      const prepared = await prepare({
        name: 'querySnapshot', arguments: { account: { sellerEntityId, sourceAccountId }, limit: 25,
          ...(afterEventId === undefined ? {} : { afterEventId }) },
      });
      if (!prepared.result.ok) return prepared.result;
      const result = parseReadResult('querySnapshot', prepared.result);
      if (!result?.ok || !('events' in result) || !sameFacts(prepared)) return conflict;
      for (const { event, evidenceIds } of result.events) {
        if (event.rawIdentity.sellerEntityId !== sellerEntityId || event.rawIdentity.sourceAccountId !== sourceAccountId) {
          return conflict;
        }
        for (const id of evidenceIds) {
          associated.add(id);
          needed.delete(id);
        }
      }
      if (!result.nextAfterEventId) break;
      if (cursors.has(result.nextAfterEventId)) return conflict;
      cursors.add(result.nextAfterEventId);
      afterEventId = result.nextAfterEventId;
    }
  }

  const residual = new Set<string>();
  for (const ref of boundRefs) {
    if (![...associatedByTuple.values()].some(associated => associated.has(ref))) residual.add(ref);
  }
  for (const subject of accountSubjects) {
    const associated = associatedByTuple.get(tupleKey(subject))!;
    for (const entry of qualifyingEntries(subject.sourceAccountId)) {
      for (const ref of entry.evidenceRefs) {
        if (!associated.has(ref)) residual.add(ref);
      }
    }
  }

  if (residual.size > 0) {
    const associations = await prepareDocumentAssociations(tools, { binding, sourceRead, facts }, residual);
    if (!isDocumentAssociations(associations)) return associations;
    for (const [evidenceId, subject] of associations) {
      const key = tupleKey(subject);
      if (!profileKeys.has(key)) continue;
      associatedByTuple.get(key)!.add(evidenceId);
    }
  }

  const boundUnresolved = boundRefs.some(ref =>
    ![...associatedByTuple.values()].some(associated => associated.has(ref)));
  let identityUnresolved = accountSubjects.length === 0;
  for (const subject of accountSubjects) {
    const associated = associatedByTuple.get(tupleKey(subject))!;
    const entries = qualifyingEntries(subject.sourceAccountId);
    if (!entries.some(entry => entry.evidenceRefs.every(id => associated.has(id)))) identityUnresolved = true;
  }

  return { facts, contracts, streams, accountSubjects, diagnosticCodes:
    identityUnresolved || boundUnresolved ? ['PROPOSAL_EVIDENCE_APPLICABILITY_UNRESOLVED'] : [] };
}
