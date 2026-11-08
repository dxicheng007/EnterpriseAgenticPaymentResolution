import { afterEach, expect, test, vi } from 'vitest';
import { getSourceCoverage } from '../src/sources.js';

const snapshotId = 'snapshot:manifest-1';
const coverage = {
  companyId: 'company:a',
  sourceRef: 'source:a',
  manifestHash: 'a'.repeat(64),
  snapshot: {
    id: snapshotId, manifestId: 'manifest-1', sourceRef: 'source:a',
    capturedAt: '2026-11-08T00:00:00.000Z', contentHash: 'b'.repeat(64),
    evidenceIds: ['citation-1'], eventIds: ['event-1'],
  },
  derivation: 'captured-source-rules-v1',
  accounts: [],
  events: [{ id: 'event-1', kind: 'payment', rawIdentity: { companyId: 'company:a' } }],
  diagnostics: [],
};

afterEach(() => vi.unstubAllGlobals());

test('reads exactly the requested aggregate using the same-origin abortable GET', async () => {
  const signal = new AbortController().signal;
  const fetch = vi.fn(async () => Response.json(coverage));
  vi.stubGlobal('fetch', fetch);
  await expect(getSourceCoverage('company:a', snapshotId, signal)).resolves.toEqual(coverage);
  expect(fetch).toHaveBeenCalledWith('/api/sources/company%3Aa/coverage?snapshotId=snapshot%3Amanifest-1',
    expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', signal }));
});

test.each([
  ['foreign company', { ...coverage, companyId: 'company:b', events: [
    { ...coverage.events[0], rawIdentity: { companyId: 'company:b' } },
  ] }],
  ['foreign source in the snapshot', { ...coverage, snapshot: { ...coverage.snapshot, sourceRef: 'source:b' } }],
  ['foreign aggregate', { ...coverage, snapshot: { ...coverage.snapshot, id: 'snapshot:other', manifestId: 'other' } }],
  ['non-aggregate binding', { ...coverage, snapshot: { ...coverage.snapshot, manifestId: 'other' } }],
  ['missing event membership', { ...coverage, events: [] }],
  ['duplicate event membership', { ...coverage, events: [...coverage.events, ...coverage.events] }],
])('rejects a successful response with %s', async (_name, body) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));
  await expect(getSourceCoverage('company:a', snapshotId)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
});

test('preserves a service failure instead of returning empty coverage', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    code: 'SOURCE_UNAVAILABLE', message: 'Source coverage is unavailable', diagnostics: [], correlationId: 'request-1',
  }, { status: 503 })));
  await expect(getSourceCoverage('company:a', snapshotId)).rejects.toMatchObject({
    status: 503, code: 'SOURCE_UNAVAILABLE',
  });
});
