import { expect, test } from 'vitest';
import type { SourceReadGrant } from '../../contracts/src/index.js';
import type { PublishFindingInput } from '../../contracts/src/discovery-construction-tools.js';
import { SourceError } from '../../sources/src/errors.js';
import { prepareFindingEvidence } from '../src/construction-evidence.js';
import type { DiscoveryReadTools } from '../src/read-tools.js';
import type { CaptureFacts } from '../src/tasks.js';

const hash = '11'.repeat(32);
const binding = {
  companyId: 'company-a', sourceRef: 'source-a', manifestId: 'manifest-a', manifestHash: hash,
  snapshotId: 'snapshot-a', snapshotHash: hash,
};
const account = { kind: 'source_account' as const, sellerEntityId: 'seller-a', sourceAccountId: 'account-a' };
const otherAccount = { kind: 'source_account' as const, sellerEntityId: 'seller-a', sourceAccountId: 'account-b' };
const otherSeller = { kind: 'source_account' as const, sellerEntityId: 'seller-b', sourceAccountId: 'account-a' };
const contract = {
  resource: 'invoices', kind: 'invoice' as const, schemaVersion: '1', fields: {}, additionalProperties: false as const,
  currency: 'USD' as const, timezone: 'UTC' as const, recordIdField: 'id', recordVersionField: 'version',
  accountIdField: null, semantics: 'append-only-events' as const, moneyUpdates: 'full-reversal-only' as const,
};
const stream = {
  streamId: 'stream-a', transport: 'api' as const, resources: ['invoices'],
  cursorStrategy: 'positive-safe-integer' as const, pageSize: 50,
};

function evidenceIds(count: number) {
  return Array.from({ length: count }, (_, index) => `ev-${String(index).padStart(3, '0')}`);
}

function factsFor(ids: readonly string[], sourceAccounts: CaptureFacts['sourceAccounts'] = [account]): CaptureFacts {
  return { binding, sourceAccounts, evidenceIds: [...ids] };
}

function grant(sourceWide: boolean): SourceReadGrant {
  return {
    companyId: binding.companyId, sourceRef: binding.sourceRef, sourceWide,
    accounts: [{ sellerEntityId: account.sellerEntityId, sourceAccountId: account.sourceAccountId }],
  };
}

function finding(overrides: Partial<PublishFindingInput> = {}): PublishFindingInput {
  return {
    expectedRevision: 0, subject: account, fieldPath: '/terms', value: 'net-30',
    provenanceClass: 'observed', evidenceStatus: 'supported', evidenceRefs: ['ev-file'],
    derivationInputs: [], alternatives: [], unresolvedQuestions: [], ...overrides,
  };
}

function association(evidenceId: string, subject = account) {
  return {
    evidenceId, fileId: 'file-a', documentId: 'document-a', documentVersion: 1, originalHash: '22'.repeat(32),
    locator: { kind: 'pdf' as const, page: 1, start: 0, end: 8 }, subject,
  };
}

function applicability(
  batch: readonly string[], facts: CaptureFacts, associated: ReturnType<typeof association>[] = [],
) {
  const associatedIds = new Set(associated.map(item => item.evidenceId));
  return {
    facts, derivation: 'captured-agreement-association-v1' as const,
    associations: associated.toSorted((left, right) => left.evidenceId < right.evidenceId ? -1 : left.evidenceId > right.evidenceId ? 1 : 0),
    unresolvedEvidenceIds: batch.filter(id => !associatedIds.has(id)),
  };
}

function readResult(id: string) {
  return {
    ok: true as const, mediaType: 'application/pdf' as const,
    evidence: {
      id, snapshotId: binding.snapshotId, sourceId: 'file-a', sha256: hash,
      locator: { kind: 'pdf' as const, page: 1, start: 0, end: 1 },
    },
    text: { value: 'a', unit: 'utf16' as const, startInclusive: 0, endExclusive: 1, sha256: hash },
  };
}

function capturedEvent(subject: { sellerEntityId: string; sourceAccountId: string }) {
  return {
    id: 'event-a', sourceRef: binding.sourceRef, resource: 'invoices', streamId: 'stream-a', sequence: 1,
    recordId: 'record-a', recordVersion: 1, kind: 'invoice' as const,
    rawIdentity: { companyId: binding.companyId, sellerEntityId: subject.sellerEntityId, sourceAccountId: subject.sourceAccountId },
    effectiveAt: '2026-11-08T00:00:00.000Z', observedAt: '2026-11-08T00:00:00.000Z',
    schemaVersion: '1', semanticVersion: '1', contentHash: hash, payload: { cents: 1250 },
  };
}

function reader(options: {
  facts: CaptureFacts;
  producer?: (batch: readonly string[]) => unknown;
  eventEvidenceIds?: readonly string[];
  eventSubject?: { sellerEntityId: string; sourceAccountId: string };
}) {
  const names: string[] = [];
  const batches: string[][] = [];
  const tools: DiscoveryReadTools = {
    async prepare(input) {
      names.push(input.name);
      if (input.name === 'describeSource') {
        return { facts: options.facts, result: { ok: true, binding, contracts: [contract], streams: [stream] } };
      }
      if (input.name === 'readEvidence') return { facts: options.facts, result: readResult(input.arguments.evidenceId) };
      if (input.name === 'querySnapshot') {
        const evidenceIds = [...(options.eventEvidenceIds ?? [])].sort();
        const events = evidenceIds.length === 0 ? [] : [{
          event: capturedEvent(options.eventSubject ?? account), evidenceIds,
        }];
        return { facts: options.facts, result: { ok: true as const, events, nextAfterEventId: null } };
      }
      throw new Error(`unexpected ${input.name}`);
    },
    prepareDocumentApplicability: (async request => {
      batches.push([...request.evidenceIds]);
      if (!options.producer) throw new Error('producer must not be called');
      return options.producer(request.evidenceIds);
    }) as DiscoveryReadTools['prepareDocumentApplicability'],
  };
  return { tools, names, batches };
}

test('a residual agreement under a source-wide grant makes the finding applicable', async () => {
  const facts = factsFor(['ev-file']);
  const { tools, batches } = reader({
    facts, producer: batch => applicability(batch, facts, [association('ev-file')]),
  });
  const result = await prepareFindingEvidence(
    { binding, sourceRead: grant(true), input: finding() }, tools,
  );
  expect(batches).toEqual([['ev-file']]);
  expect(result).toEqual({ facts, applicable: true });
});

test.each([
  ['another account', otherAccount],
  ['another seller', otherSeller],
] as const)('a residual agreement for %s stays unresolved', async (_label, subject) => {
  const facts = factsFor(['ev-file'], [account, subject]);
  const { tools, batches } = reader({
    facts, producer: batch => applicability(batch, facts, [association('ev-file', subject)]),
  });
  const result = await prepareFindingEvidence(
    { binding, sourceRead: grant(true), input: finding() }, tools,
  );
  expect(batches).toEqual([['ev-file']]);
  expect(result).toEqual({ facts, applicable: false });
});

test('one associated citation does not clear an unresolved citation', async () => {
  const ids = ['ev-file', 'ev-open'];
  const facts = factsFor(ids);
  const { tools, batches } = reader({
    facts, producer: batch => applicability(batch, facts, [association('ev-file')]),
  });
  const result = await prepareFindingEvidence({
    binding, sourceRead: grant(true), input: finding({
      evidenceRefs: ['ev-open'], alternatives: [{ value: 'other', evidenceRefs: ['ev-file'] }],
    }),
  }, tools);
  expect(batches).toEqual([ids]);
  expect(result).toEqual({ facts, applicable: false });
});

test('residual citations from main refs and alternatives are sorted and deduped into bounded batches', async () => {
  const distinct = evidenceIds(101);
  const facts = factsFor(distinct);
  const { tools, batches } = reader({
    facts, producer: batch => applicability(batch, facts, batch.map(id => association(id))),
  });
  const result = await prepareFindingEvidence({
    binding, sourceRead: grant(true), input: finding({
      evidenceRefs: distinct.slice(0, 50),
      alternatives: [
        { value: 'alt-1', evidenceRefs: distinct.slice(40, 90) },
        { value: 'alt-2', evidenceRefs: distinct.slice(90) },
      ],
    }),
  }, tools);
  expect(batches).toEqual([distinct.slice(0, 50), distinct.slice(50, 100), distinct.slice(100)]);
  expect(result).toEqual({ facts, applicable: true });
});

test('a failed later batch rejects finding evidence preparation', async () => {
  const distinct = evidenceIds(101);
  const facts = factsFor(distinct);
  const { tools, batches } = reader({
    facts,
    producer: batch => {
      if (batches.length === 3) throw new SourceError(503, 'SOURCE_UNAVAILABLE', 'later batch failed');
      return applicability(batch, facts);
    },
  });
  const result = await prepareFindingEvidence({
    binding, sourceRead: grant(true), input: finding({
      evidenceRefs: distinct.slice(0, 50),
      alternatives: [
        { value: 'alt-1', evidenceRefs: distinct.slice(40, 90) },
        { value: 'alt-2', evidenceRefs: distinct.slice(90) },
      ],
    }),
  }, tools);
  expect(batches.map(batch => batch.length)).toEqual([50, 50, 1]);
  expect(result).toEqual({ ok: false, code: 'SOURCE_UNAVAILABLE' });
});

test('an account-only grant leaves residual citations unresolved without a producer call', async () => {
  const facts = factsFor(['ev-file']);
  const { tools, batches } = reader({ facts });
  const result = await prepareFindingEvidence(
    { binding, sourceRead: grant(false), input: finding() }, tools,
  );
  expect(batches).toEqual([]);
  expect(result).toEqual({ facts, applicable: false });
});

test('a source-subject finding stays applicable without a document association call', async () => {
  const facts = factsFor(['ev-file']);
  const { tools, names, batches } = reader({ facts });
  const result = await prepareFindingEvidence({
    binding, sourceRead: grant(true), input: finding({ subject: { kind: 'source' } }),
  }, tools);
  expect(names).toEqual(['readEvidence']);
  expect(batches).toEqual([]);
  expect(result).toEqual({ facts, applicable: true });
});

test('a source-account finding with no citations stays inapplicable without a document association call', async () => {
  const facts = factsFor([]);
  const { tools, names, batches } = reader({ facts });
  const result = await prepareFindingEvidence({
    binding, sourceRead: grant(true), input: finding({ evidenceRefs: [] }),
  }, tools);
  expect(names).toEqual(['describeSource']);
  expect(batches).toEqual([]);
  expect(result).toEqual({ facts, applicable: false });
});

test('an event citation is omitted from the residual document association call', async () => {
  const ids = ['ev-event', 'ev-file'];
  const facts = factsFor(ids);
  const { tools, batches } = reader({
    facts, eventEvidenceIds: ['ev-event'],
    producer: batch => applicability(batch, facts, batch.map(id => association(id))),
  });
  const result = await prepareFindingEvidence({
    binding, sourceRead: grant(true), input: finding({ evidenceRefs: ids }),
  }, tools);
  expect(batches).toEqual([['ev-file']]);
  expect(result).toEqual({ facts, applicable: true });
});
