import { expect, test } from 'vitest';
import type { SourceReadGrant } from '../../contracts/src/index.js';
import type { DraftConnectorInput } from '../../contracts/src/discovery-construction-tools.js';
import type { PreparedDocumentApplicability } from '../../sources/src/document-applicability.js';
import { SourceError } from '../../sources/src/errors.js';
import { prepareProposalEvidence } from '../src/proposal-evidence.js';
import type { DiscoveryReadTools } from '../src/read-tools.js';
import type { CaptureFacts } from '../src/tasks.js';

const hash = '11'.repeat(32);
const binding = {
  companyId: 'company-a', sourceRef: 'source-a', manifestId: 'manifest-a', manifestHash: hash,
  snapshotId: 'snapshot-a', snapshotHash: hash,
};
const account = { kind: 'source_account' as const, sellerEntityId: 'seller-a', sourceAccountId: 'account-a' };
const sibling = { kind: 'source_account' as const, sellerEntityId: 'seller-a', sourceAccountId: 'account-b' };
const contract = {
  resource: 'invoices', kind: 'invoice' as const, schemaVersion: '1', fields: {}, additionalProperties: false as const,
  currency: 'USD' as const, timezone: 'UTC' as const, recordIdField: 'id', recordVersionField: 'version',
  accountIdField: null, semantics: 'append-only-events' as const, moneyUpdates: 'full-reversal-only' as const,
};
const stream = {
  streamId: 'stream-a', transport: 'api' as const, resources: ['invoices'],
  cursorStrategy: 'positive-safe-integer' as const, pageSize: 50,
};

function factsFor(ids: readonly string[], sourceAccounts = [account, sibling]): CaptureFacts {
  return { binding, sourceAccounts, evidenceIds: [...ids] };
}

function grant(sourceWide = true): SourceReadGrant {
  return { companyId: binding.companyId, sourceRef: binding.sourceRef, sourceWide, accounts: [] };
}

function association(evidenceId: string, subject = account) {
  return {
    evidenceId, fileId: 'file-a', documentId: 'document-a', documentVersion: 1, originalHash: '22'.repeat(32),
    locator: { kind: 'pdf' as const, page: 1, start: 0, end: 8 }, subject,
  };
}

function applicability(
  batch: readonly string[], facts: CaptureFacts, associated: ReturnType<typeof association>[] = [],
): PreparedDocumentApplicability {
  const associatedIds = new Set(associated.map(item => item.evidenceId));
  return {
    facts, derivation: 'captured-agreement-association-v1',
    associations: associated.toSorted((left, right) =>
      left.evidenceId < right.evidenceId ? -1 : left.evidenceId > right.evidenceId ? 1 : 0),
    unresolvedEvidenceIds: batch.filter(id => !associatedIds.has(id)),
  };
}

function draft(evidenceId: string, extras: Record<string, unknown> = {}): DraftConnectorInput {
  return {
    expectedRevision: 0, findingRefs: [],
    spec: {
      id: 'spec', version: 1, sourceRef: binding.sourceRef, sourceContracts: [contract], capture: [stream],
      mappings: [{ resource: 'invoices', kind: 'invoice', fields: {
        currency: { op: 'constant', value: 'USD', evidenceRef: evidenceId },
        effectiveAt: { op: 'field', path: '/effective_date' },
        amountCents: { op: 'field', path: '/amount_minor' },
        dueDate: { op: 'field', path: '/due_date' },
      } }],
      allowedKinds: ['invoice'], runtimeModelCalls: 'forbidden', maxTransactionCents: 5000000,
      maxRecordsPerCycle: 1000, targetSchemaVersion: '1', requiredValidators: [], evidenceRefs: [evidenceId],
    },
    profiles: [{
      id: 'profile', version: 1, sourceRef: binding.sourceRef,
      scope: { companyId: binding.companyId, sellerEntityId: account.sellerEntityId, accountId: 'parent' },
      parentCustomerId: 'customer', sourceAccountIds: [account.sourceAccountId], semanticVersion: 'v1',
      approvedLookups: [{ id: 'alias-map', valueType: 'parent-account', entries: [{
        source: account.sourceAccountId, target: 'parent', evidenceRefs: [evidenceId],
      }] }],
      contractTerms: [{ id: 'term', contractId: 'contract', validFrom: '2026-01-01', validToExclusive: null,
        fixedMonthlyFeeCents: 100, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs: [evidenceId] }],
      findings: [],
      bootstrap: { customer: { id: 'customer', displayName: 'Customer', evidenceRefs: [evidenceId] },
        billingConfigurationIds: [{ termId: 'term', id: 'config' }] },
      ...extras,
    }],
  } as DraftConnectorInput;
}

function tools(options: {
  facts: CaptureFacts;
  producer?: (ids: readonly string[]) => PreparedDocumentApplicability;
  events?: readonly string[];
}) {
  const batches: string[][] = [];
  const adapter: DiscoveryReadTools = {
    async prepare(input) {
      if (input.name === 'describeSource') {
        return { facts: options.facts, result: { ok: true, binding, contracts: [contract], streams: [stream] } };
      }
      if (input.name === 'readEvidence') {
        const evidenceId = String(input.arguments.evidenceId);
        return { facts: options.facts, result: {
          ok: true, mediaType: 'application/pdf',
          evidence: {
            id: evidenceId, snapshotId: binding.snapshotId, sourceId: 'file', sha256: hash,
            locator: { kind: 'pdf', page: 1, start: 0, end: 1 },
          },
          text: { value: 'a', unit: 'utf16', startInclusive: 0, endExclusive: 1, sha256: hash },
        } };
      }
      if (input.name === 'querySnapshot') {
        const evidenceIds = [...(options.events ?? [])];
        return { facts: options.facts, result: {
          ok: true as const,
          events: evidenceIds.length === 0 ? [] : [{
            event: {
              id: 'event-a', sourceRef: binding.sourceRef, resource: 'invoices', streamId: 'stream-a', sequence: 1,
              recordId: 'record-a', recordVersion: 1, kind: 'invoice' as const,
              rawIdentity: {
                companyId: binding.companyId, sellerEntityId: account.sellerEntityId,
                sourceAccountId: account.sourceAccountId,
              },
              effectiveAt: '2026-11-08T00:00:00.000Z', observedAt: '2026-11-08T00:00:00.000Z',
              schemaVersion: '1', semanticVersion: '1', contentHash: hash, payload: {},
            },
            evidenceIds,
          }],
          nextAfterEventId: null,
        } };
      }
      throw new Error('unexpected prepare ' + input.name);
    },
    prepareDocumentApplicability: (async request => {
      batches.push([...request.evidenceIds]);
      if (!options.producer) throw new Error('unexpected producer call');
      return options.producer(request.evidenceIds);
    }) as DiscoveryReadTools['prepareDocumentApplicability'],
  };
  return { adapter, batches };
}

test('agreement associations clear the proposal applicability diagnostic', async () => {
  const facts = factsFor(['ev-file']);
  const { adapter, batches } = tools({
    facts,
    producer: ids => applicability(ids, facts, [association('ev-file')]),
  });
  const prepared = await prepareProposalEvidence({
    binding, sourceRead: grant(), input: draft('ev-file'),
  }, adapter);
  expect(prepared).toMatchObject({ diagnosticCodes: [] });
  expect(batches).toEqual([['ev-file']]);
});

test('sibling-account agreement leaves the proposal applicability diagnostic', async () => {
  const facts = factsFor(['ev-file']);
  const { adapter } = tools({
    facts,
    producer: ids => applicability(ids, facts, [association('ev-file', sibling)]),
  });
  const prepared = await prepareProposalEvidence({
    binding, sourceRead: grant(), input: draft('ev-file'),
  }, adapter);
  expect(prepared).toMatchObject({ diagnosticCodes: ['PROPOSAL_EVIDENCE_APPLICABILITY_UNRESOLVED'] });
});

test('a failed later document batch rejects proposal preparation', async () => {
  const ids = Array.from({ length: 101 }, (_, index) => `ev-${String(index).padStart(3, '0')}`);
  const facts = factsFor(ids);
  const input = draft(ids[0]!, {
    contractTerms: [{ id: 'term', contractId: 'contract', validFrom: '2026-01-01', validToExclusive: null,
      fixedMonthlyFeeCents: 100, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs: ids }],
    approvedLookups: [{ id: 'alias-map', valueType: 'parent-account', entries: [{
      source: account.sourceAccountId, target: 'parent', evidenceRefs: [ids[0]!],
    }] }],
    bootstrap: { customer: { id: 'customer', displayName: 'Customer', evidenceRefs: [ids[0]!] },
      billingConfigurationIds: [{ termId: 'term', id: 'config' }] },
  });
  let calls = 0;
  const { adapter } = tools({
    facts,
    producer: batch => {
      calls += 1;
      if (calls === 3) throw new SourceError(503, 'SOURCE_UNAVAILABLE', 'forced');
      return applicability(batch, facts, batch.map(id => association(id)));
    },
  });
  const prepared = await prepareProposalEvidence({ binding, sourceRead: grant(), input }, adapter);
  expect(prepared).toEqual({ ok: false, code: 'SOURCE_UNAVAILABLE' });
  expect(calls).toBe(3);
});
