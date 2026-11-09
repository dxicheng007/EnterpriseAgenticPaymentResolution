import { describe, expect, test } from 'vitest';
import { canonicalJson } from '../src/canonical.js';
import {
  DescribeSourceInputSchema, DescribeSourceResultSchema, DiscoveryCitationIdentitySchema,
  DiscoveryReadToolCallSchema, DiscoveryReadToolFailureSchema, DiscoveryReadToolNameSchema,
  QuerySnapshotInputSchema, QuerySnapshotResultSchema, ReadEvidenceInputSchema, ReadEvidenceResultSchema,
  SearchEvidenceInputSchema, SearchEvidenceResultSchema, discoveryReadToolSchemas,
} from '../src/discovery-tools.js';

const sha256 = 'a'.repeat(64);
const evidence = { id: 'citation', snapshotId: 'snapshot', sourceId: 'file', locator: { kind: 'csv', row: 1, column: 'column' }, sha256 };
const read = {
  ok: true, evidence, mediaType: 'text/csv',
  text: { value: 'a😀', unit: 'utf16', startInclusive: 100, endExclusive: 103, sha256 },
};
const binding = { companyId: 'company', sourceRef: 'source', manifestId: 'manifest', snapshotId: 'snapshot', manifestHash: sha256, snapshotHash: sha256 };
const stream = { streamId: 'stream-a', transport: 'api', resources: ['invoices'], cursorStrategy: 'positive-safe-integer', pageSize: 50 };
const contract = {
  resource: 'invoices', kind: 'invoice', schemaVersion: '1', fields: {}, additionalProperties: false, currency: 'USD',
  timezone: 'UTC', recordIdField: 'id', recordVersionField: 'version', accountIdField: null,
  semantics: 'append-only-events', moneyUpdates: 'full-reversal-only',
};
const event = {
  id: 'event-a', sourceRef: 'source', resource: 'invoices', streamId: 'stream-a', sequence: 1,
  recordId: 'record', recordVersion: 1, rawIdentity: { companyId: 'company' }, kind: 'invoice',
  effectiveAt: '2026-11-08T00:00:00.000Z', observedAt: '2026-11-08T00:00:00.000Z',
  schemaVersion: '1', semanticVersion: '1', contentHash: sha256, payload: { cents: 1250, price: '12.50' },
};
const row = { event, evidenceIds: ['citation-a', 'citation-b'] };

describe('discovery read tool inputs', () => {
  test('accepts exactly the four named calls and their own strict arguments', () => {
    const calls = [
      { name: 'describeSource', arguments: {} },
      { name: 'querySnapshot', arguments: {
        resource: 'invoices', account: { sellerEntityId: 'seller', sourceAccountId: 'account' }, afterEventId: 'event-a', limit: 50,
      } },
      { name: 'searchEvidence', arguments: { query: 'payment', limit: 1 } },
      { name: 'readEvidence', arguments: { evidenceId: 'citation' } },
    ];
    for (const call of calls) {
      expect(DiscoveryReadToolCallSchema.parse(call)).toEqual(call);
      expect(DiscoveryReadToolNameSchema.parse(call.name)).toBe(call.name);
      expect(DiscoveryReadToolCallSchema.safeParse({ ...call, dispatchId: 'dispatch' }).success).toBe(false);
    }
    expect(DiscoveryReadToolCallSchema.safeParse({ ...calls[1], arguments: calls[2]!.arguments }).success).toBe(false);
    expect(DiscoveryReadToolCallSchema.safeParse({ name: 'delegateTask', arguments: {} }).success).toBe(false);
    expect(DescribeSourceInputSchema.safeParse({ binding }).success).toBe(false);
    expect(QuerySnapshotInputSchema.safeParse({ limit: 1, account: { sellerEntityId: 'seller' } }).success).toBe(false);
    expect(QuerySnapshotInputSchema.safeParse({ limit: 1, account: { sellerEntityId: 'seller', sourceAccountId: 'account', companyId: 'company' } }).success).toBe(false);
  });

  test('rejects prototype keys and inherited arguments', () => {
    expect(DescribeSourceInputSchema.safeParse(JSON.parse('{"__proto__":{}}')).success).toBe(false);
    expect(QuerySnapshotInputSchema.safeParse(JSON.parse('{"limit":1,"account":{"sellerEntityId":"s","sourceAccountId":"a","constructor":{}}}')).success).toBe(false);
    expect(DiscoveryReadToolCallSchema.safeParse(JSON.parse('{"name":"describeSource","arguments":{},"__proto__":{}}')).success).toBe(false);
    expect(SearchEvidenceInputSchema.safeParse(Object.create({ query: 'text', limit: 1 })).success).toBe(false);
  });

  test('checks limits, range order and safe integers', () => {
    for (const limit of [0, 51, 1.5, '1']) expect(QuerySnapshotInputSchema.safeParse({ limit }).success).toBe(false);
    for (const limit of [0, 21, 1.5, '1']) expect(SearchEvidenceInputSchema.safeParse({ query: 'x', limit }).success).toBe(false);
    expect(Array.from('😀'.repeat(129))).toHaveLength(129);
    expect(SearchEvidenceInputSchema.safeParse({ query: '😀'.repeat(128), limit: 20 }).success).toBe(true);
    for (const query of ['', '😀'.repeat(129)]) expect(SearchEvidenceInputSchema.safeParse({ query, limit: 1 }).success).toBe(false);
    for (const range of [
      { start: 0, end: 0 }, { start: 2, end: 1 }, { start: -1, end: 1 }, { start: -0, end: 1 },
      { start: 0, end: 1.5 }, { start: 0, end: Number.MAX_SAFE_INTEGER + 1 }, { start: 0, end: 1, unit: 'utf16' },
    ]) expect(ReadEvidenceInputSchema.safeParse({ evidenceId: 'citation', range }).success).toBe(false);
    expect(ReadEvidenceInputSchema.safeParse({ evidenceId: 'citation', range: { start: 0, end: Number.MAX_SAFE_INTEGER } }).success).toBe(true);
  });

  test('advertises the closed tool set with nested strict JSON Schema and parser bounds', () => {
    expect(discoveryReadToolSchemas.map(tool => tool.name)).toEqual([
      'describeSource', 'querySnapshot', 'searchEvidence', 'readEvidence',
    ]);
    expect(discoveryReadToolSchemas[0].inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    const query = discoveryReadToolSchemas[1].inputSchema;
    expect(query).toMatchObject({ type: 'object', required: ['limit'], additionalProperties: false });
    expect(query.properties).toMatchObject({
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      account: { additionalProperties: false, required: ['sellerEntityId', 'sourceAccountId'] },
    });
    const id = new RegExp(query.properties.resource.pattern);
    for (const resource of ['good:id', 'a'.repeat(160), '_bad', 'a'.repeat(161), '']) {
      expect(id.test(resource)).toBe(QuerySnapshotInputSchema.safeParse({ resource, limit: 1 }).success);
    }
    expect(discoveryReadToolSchemas[2].inputSchema.properties).toMatchObject({
      query: { type: 'string', minLength: 1, maxLength: 256, description: expect.stringContaining('UTF-16') }, limit: { type: 'integer', minimum: 1, maximum: 20 },
    });
    expect(discoveryReadToolSchemas[3].inputSchema.properties.range).toMatchObject({
      additionalProperties: false, required: ['start', 'end'],
      properties: { start: { minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, end: { minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
    });
  });
});

describe('discovery read tool results', () => {
  test('accepts exactly the safe failure codes and no extra detail', () => {
    for (const code of [
      'DISCOVERY_INVALID', 'DISCOVERY_FORBIDDEN', 'DISCOVERY_CONFLICT', 'SOURCE_UNAVAILABLE',
      'TOOL_RESULT_LIMIT', 'TOOL_FORBIDDEN', 'TOOL_UNAVAILABLE',
    ]) {
      const failure = { ok: false, code };
      for (const schema of [
        DiscoveryReadToolFailureSchema, DescribeSourceResultSchema, QuerySnapshotResultSchema, SearchEvidenceResultSchema, ReadEvidenceResultSchema,
      ]) expect(schema.parse(failure)).toEqual(failure);
    }
    expect(DiscoveryReadToolFailureSchema.safeParse({ ok: false, code: 'UNEXPECTED' }).success).toBe(false);
    expect(ReadEvidenceResultSchema.safeParse({ ok: false, code: 'TOOL_FORBIDDEN', message: 'raw exception' }).success).toBe(false);
  });

  test('checks unique lexical contract and stream ordering', () => {
    const description = { ok: true, binding, contracts: [contract, { ...contract, resource: 'payments' }], streams: [stream, { ...stream, streamId: 'stream-b' }] };
    expect(DescribeSourceResultSchema.parse(description)).toEqual(description);
    for (const invalid of [
      { ...description, contracts: [contract, contract] },
      { ...description, contracts: [...description.contracts].reverse() },
      { ...description, streams: [stream, stream] },
      { ...description, streams: [...description.streams].reverse() },
      { ...description, binding: { ...binding, companyName: 'name' } },
    ]) expect(DescribeSourceResultSchema.safeParse(invalid).success).toBe(false);
  });

  test('checks ordered raw events, unique citations and continuation shape', () => {
    const second = { event: { ...event, id: 'event-b', sequence: 10 }, evidenceIds: ['citation-a'] };
    const third = { event: { ...event, id: 'event-c', streamId: 'stream-b' }, evidenceIds: [] };
    const page = { ok: true, events: [row, second, third], nextAfterEventId: 'event-c' };
    expect(QuerySnapshotResultSchema.parse(page)).toEqual(page);
    expect(QuerySnapshotResultSchema.safeParse({ ok: true, events: [], nextAfterEventId: null }).success).toBe(true);
    for (const invalid of [
      { ...page, events: [second, row] }, { ...page, events: [third, row] },
      { ...page, events: [row, { ...second, event: { ...second.event, id: event.id } }] },
      { ...page, events: [row, { ...second, event: { ...second.event, sequence: event.sequence } }] },
      { ...page, events: [{ ...row, evidenceIds: ['citation-b', 'citation-a'] }] },
      { ...page, events: [{ ...row, evidenceIds: ['citation-a', 'citation-a'] }] },
      { ...page, events: [{ ...row, event: { ...event, payload: { cents: -0 } } }] },
      { ...page, events: [{ ...row, event: { ...event, payload: { cents: 0.5 } } }] },
      { ...page, nextAfterEventId: 'event-a' }, { ...page, events: [] },
      { ...page, events: [{ ...row, event: { ...event, payload: JSON.parse('{"record":{"prototype":1}}') } }] },
    ]) expect(QuerySnapshotResultSchema.safeParse(invalid).success).toBe(false);
  });

  test('checks lexical search hits and preserves only helper fields', () => {
    const hits = [{ id: 'citation-a', excerpt: 'abc' }, { id: 'citation-b', excerpt: 'def' }];
    expect(SearchEvidenceResultSchema.parse({ ok: true, hits })).toEqual({ ok: true, hits });
    for (const invalid of [hits.toReversed(), [hits[0], hits[0]], [{ ...hits[0], locator: evidence.locator }], [{ id: 'citation-a', excerpt: '😀'.repeat(1001) }]]) {
      expect(SearchEvidenceResultSchema.safeParse({ ok: true, hits: invalid }).success).toBe(false);
    }
  });

  test('accepts an excerpt with absolute UTF-16 offsets and a strict citation projection', () => {
    expect(ReadEvidenceResultSchema.parse(read)).toEqual(read);
    expect(DiscoveryCitationIdentitySchema.parse(evidence)).toEqual(evidence);
    expect(DiscoveryCitationIdentitySchema.safeParse({ ...evidence, excerpt: 'original full citation' }).success).toBe(false);
    for (const invalid of [
      { ...read, evidence: { ...evidence, excerpt: 'original full citation' } },
      { ...read, evidence: { ...evidence, locator: { kind: 'pdf', page: 1, start: 5, end: 5 } } },
      { ...read, text: { ...read.text, endExclusive: 102 } },
      { ...read, text: { ...read.text, value: '', endExclusive: 100 } },
      { ...read, text: { ...read.text, value: '😀'.repeat(4097), endExclusive: 8294 } },
      { ...read, original: { url: 'forbidden' } },
    ]) expect(ReadEvidenceResultSchema.safeParse(invalid).success).toBe(false);
    expect(ReadEvidenceResultSchema.safeParse({ ...read, text: { ...read.text, value: '😀'.repeat(4096), endExclusive: 8292 } }).success).toBe(true);
  });

  test('caps complete canonical UTF-8 bytes including a large locator', () => {
    const withColumn = (column: string) => ({ ...read, evidence: { ...evidence, locator: { ...evidence.locator, column } } });
    const prefix = '😀';
    const exact = prefix + 'a'.repeat(65_536 - Buffer.byteLength(canonicalJson(withColumn(prefix))));
    expect(Buffer.byteLength(canonicalJson(withColumn(exact)))).toBe(65_536);
    expect(ReadEvidenceResultSchema.safeParse(withColumn(exact)).success).toBe(true);
    expect(ReadEvidenceResultSchema.safeParse(withColumn(exact + 'a')).success).toBe(false);
  });
});
