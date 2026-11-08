import { afterEach, expect, test, vi } from 'vitest';
import { baselineManifestA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { clearCsrfToken, setCsrfToken } from '../src/http.js';
import { previewConnector } from '../src/preview.js';
import { getVerificationJob, requestVerification } from '../src/verification.js';

afterEach(() => {
  clearCsrfToken();
  vi.unstubAllGlobals();
});

test('returns compile blockers from a valid preview response without synthesizing a plan', async () => {
  const fetch = vi.fn(async () => Response.json({
    artifact: null, outcome: { plans: [], holds: [] }, diffs: [], unsupportedRows: [], parentWrites: 0,
    diagnostics: [{ code: 'UNSUPPORTED', severity: 'blocker', message: 'Unsupported mapping', sourceIds: [], fieldPaths: [] }],
  }));
  vi.stubGlobal('fetch', fetch);
  setCsrfToken('demo-csrf');
  const input = { spec: validSpecA, profiles: [profileA], snapshotId: 'snapshot-a', asOf: baselineManifestA.asOf };
  const response = await previewConnector(input);
  expect(response.artifact).toBeNull();
  expect(response.outcome.plans).toEqual([]);
  expect(response.diagnostics[0].code).toBe('UNSUPPORTED');
  expect(fetch).toHaveBeenCalledWith('/api/connectors/preview', expect.objectContaining({
    method: 'POST', credentials: 'same-origin', body: JSON.stringify(input),
  }));
});

test('uses the encoded connector spec ID and rejects a poll result for another job', async () => {
  const hash = 'a'.repeat(64);
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ jobId: 'job:1', state: 'queued', diagnostics: [] }, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ jobId: 'job:2', state: 'queued', diagnostics: [] }));
  vi.stubGlobal('fetch', fetch);
  setCsrfToken('demo-csrf');
  const input = { artifactHash: hash, profileHashes: [hash], manifestId: 'manifest-a' };
  await expect(requestVerification('connector:a', input)).resolves.toMatchObject({ jobId: 'job:1', state: 'queued' });
  await expect(getVerificationJob('job:1')).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  expect(fetch).toHaveBeenNthCalledWith(1, '/api/connectors/connector%3Aa/verify',
    expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }));
  expect(fetch).toHaveBeenNthCalledWith(2, '/api/verification-jobs/job%3A1',
    expect.objectContaining({ credentials: 'same-origin' }));
});
