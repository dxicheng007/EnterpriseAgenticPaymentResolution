import { expect, test } from 'vitest';
import { hashBytes, type EvidenceResponse } from '@eapr/contracts';
import { selectDiscoveryExcerpt } from '../src/discovery-tools.js';

const value = 'prefix' + '😀' + 'x'.repeat(9998) + 'suffix';
const startInclusive = 6;
const endExclusive = 10006;
const sha256 = 'a'.repeat(64);
const response: EvidenceResponse = {
  evidence: {
    id: 'citation', snapshotId: 'snapshot', sourceId: 'source',
    locator: { kind: 'email', messageId: 'email', start: startInclusive, end: endExclusive },
    excerpt: value.slice(startInclusive, endExclusive), sha256,
  },
  mediaType: 'application/json',
  original: { url: '/api/evidence/citation/content', sha256, byteLength: Buffer.byteLength(value) },
  text: { value, sha256: hashBytes(Buffer.from(value)), unit: 'utf16', startInclusive, endExclusive },
};

test('selects a bounded relative range inside a larger citation at a nonzero base', () => {
  const selected = '😀' + 'x'.repeat(98);
  const { excerpt, ...evidence } = response.evidence;
  expect(selectDiscoveryExcerpt(response, { start: 0, end: 100 })).toEqual({
    ok: true, evidence, mediaType: 'application/json',
    text: { value: selected, sha256: hashBytes(Buffer.from(selected)), unit: 'utf16', startInclusive: 6, endExclusive: 106 },
  });
  expect(response.evidence.excerpt).toBe(excerpt);
  expect(selectDiscoveryExcerpt(response, undefined)).toEqual({ ok: false, code: 'TOOL_RESULT_LIMIT' });
});

test('rejects range endpoints splitting a surrogate, empty spans and out-of-range offsets', () => {
  for (const range of [
    { start: 1, end: 100 }, { start: 0, end: 1 }, { start: 0, end: 10001 }, { start: 2, end: 2 },
  ]) expect(selectDiscoveryExcerpt(response, range)).toEqual({ ok: false, code: 'DISCOVERY_INVALID' });
});

test('omitting a short range returns the cited span only', () => {
  const short: EvidenceResponse = {
    ...response,
    evidence: {
      ...response.evidence, locator: { kind: 'email', messageId: 'email', start: 6, end: 9 }, excerpt: '😀x',
    },
    text: { ...response.text, endExclusive: 9 },
  };
  expect(selectDiscoveryExcerpt(short, undefined)).toMatchObject({
    ok: true, text: { value: '😀x', startInclusive: 6, endExclusive: 9, sha256: hashBytes(Buffer.from('😀x')) },
  });
});

test('counts locator metadata in the full UTF-8 result limit', () => {
  const withLargeLocator: EvidenceResponse = {
    ...response,
    evidence: { ...response.evidence, locator: { kind: 'csv', row: 1, column: '😀'.repeat(16_384) } },
    text: { ...response.text, value: 'x', startInclusive: 0, endExclusive: 1 },
  };
  expect(selectDiscoveryExcerpt(withLargeLocator, { start: 0, end: 1 }))
    .toEqual({ ok: false, code: 'TOOL_RESULT_LIMIT' });
});
