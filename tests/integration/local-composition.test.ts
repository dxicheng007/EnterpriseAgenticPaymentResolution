import Fastify from 'fastify';
import { expect, test } from 'vitest';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';

const origin = 'http://127.0.0.1:5173';
const headers = { origin, 'X-EAPR-Local-UI': '1', 'Sec-Fetch-Site': 'same-origin', 'content-type': 'application/json' };

test('bootstraps a transparent session and requires its CSRF token for mutations', async () => {
  const service = createLocalSessionService({
    webOrigin: origin, reviewerId: 'demo-reviewer',
    allowedSourceRefs: ['source-a'], allowedAccountIds: ['company-a.seller-a.account-a'],
  });
  const app = Fastify();
  await app.register(service.plugin);
  app.get('/api/read', request => service.authorizeReviewer(request, { mutation: false }));
  app.post('/api/mutate', request => service.authorizeReviewer(request, { mutation: true }));
  try {
    const bootstrap = (extra = {}, payload: unknown = {}, requestHeaders = headers) =>
      app.inject({ method: 'POST', url: '/api/local-session', headers: { ...requestHeaders, ...extra }, payload: JSON.stringify(payload) });
    const first = await bootstrap();
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.json()).toMatchObject({ demoOnly: true, reviewer: { reviewerId: 'demo-reviewer' } });
    const cookieHeader = first.cookies[0]!;
    expect(cookieHeader).toMatchObject({ name: 'eapr_local_reviewer', httpOnly: true, sameSite: 'Strict', path: '/api' });
    expect(cookieHeader).not.toHaveProperty('maxAge');
    expect(cookieHeader).not.toHaveProperty('domain');
    expect(first.body).not.toContain(cookieHeader.value);
    const cookie = cookieHeader.name + '=' + cookieHeader.value;
    const repeated = await bootstrap({ cookie });
    expect(repeated.json()).toEqual(first.json());
    expect(repeated.cookies).toHaveLength(0);
    expect((await bootstrap({ origin: 'http://127.0.0.1:5555' })).statusCode).toBe(403);
    expect((await bootstrap({}, {}, { ...headers, origin: '' })).statusCode).toBe(403);
    expect((await bootstrap({ 'Sec-Fetch-Site': 'cross-site' })).statusCode).toBe(403);
    expect((await bootstrap({}, { reviewerId: 'other' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'OPTIONS', url: '/api/local-session', headers: { origin: 'http://127.0.0.1:5555', 'access-control-request-method': 'POST' } })).headers['access-control-allow-origin']).toBeUndefined();
    for (const badCookie of ['', 'eapr_local_reviewer=forged']) {
      expect((await app.inject({ url: '/api/read', headers: { cookie: badCookie } })).statusCode).toBe(401);
    }
    expect((await app.inject({ url: '/api/read', headers: { cookie } })).statusCode).toBe(200);
    for (const name of ['authorization', 'x-eapr-service-token', 'x-eapr-task-token']) {
      expect((await app.inject({ url: '/api/read', headers: { cookie, [name]: 'present' } })).statusCode).toBe(403);
      expect((await bootstrap({ cookie, [name]: 'present' })).statusCode).toBe(403);
    }
    const mutate = (token: string, requestOrigin = origin) => app.inject({
      method: 'POST', url: '/api/mutate', headers: { cookie, origin: requestOrigin, 'x-eapr-csrf': token },
    });
    expect((await mutate('wrong')).statusCode).toBe(403);
    expect((await mutate(first.json().csrfToken, '')).statusCode).toBe(403);
    expect((await mutate(first.json().csrfToken)).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
