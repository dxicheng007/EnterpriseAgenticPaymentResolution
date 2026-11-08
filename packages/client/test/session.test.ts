import { afterEach, expect, test, vi } from 'vitest';
import { clearCsrfToken } from '../src/http.js';
import { getLocalSession } from '../src/session.js';
import { getDossier } from '../src/sources.js';

afterEach(() => {
  clearCsrfToken();
  vi.unstubAllGlobals();
});

const session = {
  demoOnly: true, reviewer: { reviewerId: 'reviewer', sessionId: 'session-1' },
  allowedSourceRefs: ['legacy-a'], allowedAccountIds: ['account-a'], csrfToken: 'token-1',
};

test('shares the bootstrap request and keeps CSRF out of the returned reviewer state', async () => {
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => Response.json(session));
  vi.stubGlobal('fetch', fetch);
  const [first, second] = await Promise.all([getLocalSession(), getLocalSession()]);
  expect(first).toBe(second);
  expect(first).toMatchObject({ demoOnly: true, reviewer: { reviewerId: 'reviewer' } });
  expect(first).not.toHaveProperty('csrfToken');
  expect(fetch).toHaveBeenCalledTimes(1);
  const [[url, options]] = fetch.mock.calls;
  expect(url).toBe('/api/local-session');
  expect(options).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{}' });
  const headers = new Headers(options.headers);
  expect(headers.get('Content-Type')).toBe('application/json');
  expect(headers.get('X-EAPR-Local-UI')).toBe('1');
  for (const header of ['Origin', 'Authorization', 'X-EAPR-CSRF']) expect(headers.has(header)).toBe(false);
});

test('allows explicit bootstrap retry after a malformed session response', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ ...session, csrfToken: '' }))
    .mockResolvedValueOnce(Response.json(session));
  vi.stubGlobal('fetch', fetch);
  await expect(getLocalSession()).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  await expect(getLocalSession()).resolves.toMatchObject({ demoOnly: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('bootstraps a fresh session after a protected read reports expiration', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(Response.json({
      code: 'LOCAL_SESSION_REQUIRED', message: 'Session expired', diagnostics: [], correlationId: 'req-1',
    }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ ...session, reviewer: { ...session.reviewer, sessionId: 'session-2' } }));
  vi.stubGlobal('fetch', fetch);
  await getLocalSession();
  await expect(getDossier('company-a')).rejects.toMatchObject({ status: 401 });
  await expect(getLocalSession()).resolves.toMatchObject({ reviewer: { sessionId: 'session-2' } });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/local-session', '/api/sources/company-a/dossier', '/api/local-session',
  ]);
});
