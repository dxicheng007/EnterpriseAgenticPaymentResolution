import { afterEach, expect, test, vi } from 'vitest';
import { clearCsrfToken, setCsrfToken } from '../src/http.js';
import { getDossier, getEvidence, uploadSource } from '../src/sources.js';

afterEach(() => {
  clearCsrfToken();
  vi.unstubAllGlobals();
});

test('preserves the requested manifest and an incomplete dossier', async () => {
  const fetch = vi.fn(async () => Response.json({
    companyId: 'company-a', manifestId: 'missing:member', snapshotIds: [], evidenceIds: [],
    complete: false, missingMembers: ['contract-1'], diagnostics: [],
  }));
  vi.stubGlobal('fetch', fetch);
  const result = await getDossier('company-a', 'missing:member');
  expect(fetch).toHaveBeenCalledWith('/api/sources/company-a/dossier?manifestId=missing%3Amember',
    expect.objectContaining({ credentials: 'same-origin' }));
  expect(result.complete).toBe(false);
  expect(result.missingMembers).toEqual(['contract-1']);
});

test('rejects malformed evidence with an external original URL', async () => {
  const hash = 'a'.repeat(64);
  vi.stubGlobal('fetch', async () => Response.json({
    evidence: { id: 'ev-1', snapshotId: 'snap-1', sourceId: 'file-1',
      locator: { kind: 'json', pointer: '/text' }, excerpt: 'A', sha256: hash },
    mediaType: 'application/json',
    original: { url: 'https://example.invalid/', sha256: hash, byteLength: 1 },
    text: { value: 'A', sha256: hash, unit: 'utf16', startInclusive: 0, endExclusive: 1 },
  }));
  await expect(getEvidence('ev-1')).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
});

test('retains a structured API error and hides an unstructured response body', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({
      code: 'FORBIDDEN', message: 'Evidence unavailable for this scope', diagnostics: [], correlationId: 'request-1',
    }, { status: 403 }))
    .mockResolvedValueOnce(new Response('<html>private server detail</html>', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  await expect(getEvidence('ev-1')).rejects.toMatchObject({
    status: 403, code: 'FORBIDDEN', message: 'Evidence unavailable for this scope', correlationId: 'request-1',
  });
  await expect(getEvidence('ev-1')).rejects.toMatchObject({
    status: 503, message: 'The local service returned an unreadable response.',
  });
});

test('sends one metadata string and the original File with CSRF and no explicit boundary', async () => {
  const file = new File(['data'], 'contract.pdf', { type: 'application/pdf' });
  const metadata = { companyId: 'company-a', sourceRef: 'legacy-a', documentId: 'contract',
    documentVersion: 1, kind: 'contract_pdf' as const, originalName: 'contract.pdf' };
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => Response.json({
    fileId: 'file-1', documentId: 'contract', documentVersion: 1,
    contentHash: 'a'.repeat(64), duplicate: true, evidenceIds: [], diagnostics: [],
  }));
  vi.stubGlobal('fetch', fetch);
  setCsrfToken('token-1');
  await expect(uploadSource(metadata, file)).resolves.toMatchObject({ duplicate: true, evidenceIds: [] });
  const [[url, options]] = fetch.mock.calls;
  expect(url).toBe('/api/sources/uploads');
  expect(options.credentials).toBe('same-origin');
  expect(options.method).toBe('POST');
  const headers = new Headers(options.headers);
  expect(headers.get('X-EAPR-CSRF')).toBe('token-1');
  expect(headers.has('Content-Type')).toBe(false);
  expect(headers.has('Authorization')).toBe(false);
  const form = options.body as FormData;
  expect([...form.keys()]).toEqual(['metadata', 'file']);
  expect(form.get('metadata')).toBe(JSON.stringify(metadata));
  expect(form.get('file')).toBe(file);
});

test('clears an expired session token without replaying an upload', async () => {
  const file = new File(['data'], 'contract.pdf');
  const metadata = { companyId: 'company-a', sourceRef: 'legacy-a', documentId: 'contract',
    documentVersion: 1, kind: 'contract_pdf' as const, originalName: file.name };
  const fetch = vi.fn(async () => Response.json({
    code: 'UNAUTHORIZED', message: 'Session expired', diagnostics: [], correlationId: 'request-1',
  }, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  setCsrfToken('token-1');
  await expect(uploadSource(metadata, file)).rejects.toMatchObject({ status: 401 });
  await expect(uploadSource(metadata, file)).rejects.toMatchObject({ status: 401, code: 'SESSION_REQUIRED' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
