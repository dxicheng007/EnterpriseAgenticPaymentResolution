import Fastify from 'fastify';
import { expect, test } from 'vitest';
import { demoSyncPlugin } from '../src/demo-sync-composition.js';

test('the fixed worker command authenticates before parsing and rejects overrides', async () => {
  const app = Fastify();
  let calls = 0;
  app.register(demoSyncPlugin('operator', async () => { calls++; throw new Error('secret'); }));
  const url = '/internal/demo/company-a/sync';
  const headers = { authorization: 'Bearer operator', 'content-type': 'application/json' };
  try {
    for (const token of ['service', 'reader', 'wrong']) {
      expect((await app.inject({ method: 'POST', url, headers: { ...headers, authorization: 'Bearer ' + token },
        payload: 'malformed' })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, cookie: 'session=reviewer' },
      payload: '{}' })).statusCode).toBe(401);
    for (const payload of [undefined, 'malformed', '{"amount":300}', '[]', ' '.repeat(5000) + '{}']) {
      expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: url + '?accountId=other', headers, payload: '{}' })).statusCode).toBe(400);
    expect(calls).toBe(0);
    const result = await app.inject({ method: 'POST', url, headers, payload: '{}' });
    expect(result.statusCode).toBe(503);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).not.toContain('secret');
    expect(calls).toBe(1);
  } finally { await app.close(); }
});
