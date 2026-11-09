import { expect, test } from 'vitest';
import type { SourceReadGrant } from '../../contracts/src/index.js';
import { SourceError } from '../../sources/src/errors.js';
import { prepareDocumentAssociations, type DiscoveryReadTools } from '../src/read-tools.js';
import type { CaptureFacts } from '../src/tasks.js';
import { toolSchemas } from '../src/roles.js';

test('advertises source and finding tools to each role only with a reader', () => {
  for (const role of ['coordinator', 'identity', 'contract', 'receivables', 'connector'] as const) {
    const existing = role === 'coordinator' ? ['delegateTask'] : [];
    expect(toolSchemas(role).map(tool => tool.name)).toEqual(existing);
    expect(toolSchemas(role, true).map(tool => tool.name)).toEqual([
      ...existing, 'describeSource', 'querySnapshot', 'searchEvidence', 'readEvidence', 'publishFinding', 'readFinding',
      ...(role === 'connector' ? ['draftConnector', 'reviseConnector'] : []),
    ]);
  }
});

const hash = '11'.repeat(32);
const binding = {
  companyId: 'company-a', sourceRef: 'source-a', manifestId: 'manifest-a', manifestHash: hash,
  snapshotId: 'snapshot-a', snapshotHash: hash,
};
const subject = { kind: 'source_account' as const, sellerEntityId: 'seller-a', sourceAccountId: 'account-a' };
const outsideAccount = { kind: 'source_account' as const, sellerEntityId: 'seller-b', sourceAccountId: 'account-b' };

function evidenceIds(count: number) {
  return Array.from({ length: count }, (_, index) => `ev-${String(index).padStart(3, '0')}`);
}

function factsFor(ids: readonly string[]): CaptureFacts {
  return { binding, sourceAccounts: [subject], evidenceIds: [...ids] };
}

function grant(sourceWide: boolean): SourceReadGrant {
  return {
    companyId: binding.companyId, sourceRef: binding.sourceRef, sourceWide,
    accounts: [{ sellerEntityId: subject.sellerEntityId, sourceAccountId: subject.sourceAccountId }],
  };
}

function association(evidenceId: string, account = subject) {
  return {
    evidenceId, fileId: 'file-a', documentId: 'document-a', documentVersion: 1, originalHash: '22'.repeat(32),
    locator: { kind: 'pdf' as const, page: 1, start: 0, end: 8 }, subject: account,
  };
}

function prepared(
  batch: readonly string[], facts: CaptureFacts,
  associations: ReturnType<typeof association>[] = [], unresolved = [...batch],
) {
  return { facts, derivation: 'captured-agreement-association-v1' as const, associations, unresolvedEvidenceIds: unresolved };
}

function reader(respond: (evidenceIds: readonly string[]) => unknown): DiscoveryReadTools {
  return {
    async prepare() { throw new Error('prepare is unused'); },
    prepareDocumentApplicability: (async request => respond(request.evidenceIds)) as DiscoveryReadTools['prepareDocumentApplicability'],
  };
}

function shuffle<T>(items: readonly T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = (index * 17) % (index + 1);
    const current = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = current;
  }
  return copy;
}

test('document associations sort and dedupe the complete set into bounded batches', async () => {
  const distinct = evidenceIds(120);
  const shuffled = shuffle([...distinct, distinct[0]!, distinct[60]!]);
  expect([...new Set(shuffled)]).not.toEqual(distinct);
  const facts = factsFor(distinct);
  const calls: string[][] = [];
  const tools = reader(batch => {
    calls.push([...batch]);
    return prepared(batch, facts);
  });
  const result = await prepareDocumentAssociations(tools, { binding, sourceRead: grant(true), facts }, shuffled);
  expect(calls).toEqual([distinct.slice(0, 50), distinct.slice(50, 100), distinct.slice(100)]);
  expect(result).toEqual(new Map());
});

test('document associations make no producer call for an empty set or account-only grant', async () => {
  let calls = 0;
  const tools = reader(() => { calls += 1; throw new Error('producer must not be called'); });
  const ids = ['ev-001'];
  const facts = factsFor(ids);
  const wide = { binding, sourceRead: grant(true), facts };
  expect(await prepareDocumentAssociations(tools, wide, [])).toEqual(new Map());
  expect(await prepareDocumentAssociations(tools, wide, new Set<string>())).toEqual(new Map());
  expect(await prepareDocumentAssociations(tools, { binding, sourceRead: grant(false), facts }, ids)).toEqual(new Map());
  expect(calls).toBe(0);
  const absent = { async prepare() { throw new Error('prepare is unused'); } } as unknown as DiscoveryReadTools;
  expect(await prepareDocumentAssociations(absent, { binding, sourceRead: grant(false), facts }, ids)).toEqual(new Map());
  expect(await prepareDocumentAssociations(absent, wide, [])).toEqual(new Map());
});

test('a failed final batch rejects the whole preparation', async () => {
  const ids = evidenceIds(120);
  const facts = factsFor(ids);
  const calls: string[][] = [];
  const tools = reader(batch => {
    calls.push([...batch]);
    if (calls.length === 3) throw new SourceError(503, 'SOURCE_UNAVAILABLE', 'later batch failed');
    return prepared(batch, facts);
  });
  const result = await prepareDocumentAssociations(tools, { binding, sourceRead: grant(true), facts }, ids);
  expect(calls.map(batch => batch.length)).toEqual([50, 50, 20]);
  expect(result).toEqual({ ok: false, code: 'SOURCE_UNAVAILABLE' });
});

test('a later batch with different facts or binding fails closed', async () => {
  const ids = evidenceIds(51);
  const facts = factsFor(ids);
  const mutations = [
    (current: CaptureFacts): CaptureFacts => ({ ...current, evidenceIds: [...current.evidenceIds, 'ev-extra'] }),
    (current: CaptureFacts): CaptureFacts => ({ ...current, binding: { ...current.binding, snapshotId: 'snapshot-b' } }),
  ];
  for (const mutate of mutations) {
    let count = 0;
    const tools = reader(batch => {
      count += 1;
      return prepared(batch, count === 2 ? mutate(facts) : facts);
    });
    const result = await prepareDocumentAssociations(tools, { binding, sourceRead: grant(true), facts }, ids);
    expect(count).toBe(2);
    expect(result).toEqual({ ok: false, code: 'DISCOVERY_CONFLICT' });
  }
});

const pair = ['ev-001', 'ev-002'];
const pairFacts = factsFor(pair);
const captureMissFacts = factsFor(['ev-900']);

test.each<[string, readonly string[], CaptureFacts, unknown]>([
  ['a requested id is missing', pair, pairFacts, prepared(pair, pairFacts, [], ['ev-001'])],
  ['an id is in both associations and unresolved', pair, pairFacts, prepared(pair, pairFacts, [association('ev-001')], pair)],
  ['an id outside the batch is present', pair, pairFacts, prepared(pair, pairFacts, [], [...pair, 'ev-999'])],
  ['the derivation is wrong', pair, pairFacts, { ...prepared(pair, pairFacts), derivation: 'other-rule' }],
  ['the subject is outside the capture', pair, pairFacts, prepared(pair, pairFacts, [association('ev-001', outsideAccount)], ['ev-002'])],
  ['unresolved ids are not sorted', pair, pairFacts, prepared(pair, pairFacts, [], ['ev-002', 'ev-001'])],
  ['associated evidence is outside the capture', ['ev-001'], captureMissFacts, prepared(['ev-001'], captureMissFacts, [association('ev-001')], [])],
])('malformed partitions fail closed for %s', async (_defect, ids, facts, result) => {
  const tools = reader(() => result);
  expect(await prepareDocumentAssociations(tools, { binding, sourceRead: grant(true), facts }, ids))
    .toEqual({ ok: false, code: 'DISCOVERY_CONFLICT' });
});

test('a forbidden producer response maps to DISCOVERY_FORBIDDEN', async () => {
  const ids = ['ev-001'];
  const tools = reader(() => { throw new SourceError(403, 'SOURCE_FORBIDDEN', 'document applicability grant is forbidden'); });
  const result = await prepareDocumentAssociations(tools, { binding, sourceRead: grant(true), facts: factsFor(ids) }, ids);
  expect(result).toEqual({ ok: false, code: 'DISCOVERY_FORBIDDEN' });
});

test('missing installed producer never yields associations', async () => {
  const ids = ['ev-001'];
  const tools = { async prepare() { throw new Error('prepare is unused'); } } as unknown as DiscoveryReadTools;
  const result = await prepareDocumentAssociations(tools, { binding, sourceRead: grant(true), facts: factsFor(ids) }, ids);
  expect(result).toEqual({ ok: false, code: 'SOURCE_UNAVAILABLE' });
});

test('unresolved ids are absent from a successful result', async () => {
  const facts = factsFor(pair);
  const calls: string[][] = [];
  const tools = reader(batch => {
    calls.push([...batch]);
    return prepared(batch, facts, [association('ev-001')], ['ev-002']);
  });
  const result = await prepareDocumentAssociations(tools, { binding, sourceRead: grant(true), facts }, ['ev-002', 'ev-001', 'ev-002']);
  expect(calls).toEqual([pair]);
  expect(result).toEqual(new Map([['ev-001', subject]]));
});
