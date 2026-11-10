import Fastify from 'fastify';
import { expect, test, vi } from 'vitest';
import { composeDemoSource } from '../src/demo-source-composition.js';

test('the source feed uses a distinct bearer and accepts only a canonical fixed-stream query', async () => {
  const app = Fastify();
  const fetchChanges = vi.fn(async () => ({
    sourceRef: 'legacy-a', streamId: 'a-finance', after: '0', next: '0', complete: true, events: [],
  }));
  app.register(composeDemoSource({
    source: { fetchChanges }, sourceToken: 'reader',
    operator: { enabled: false }, serviceToken: 'service',
  }));
  const url = '/internal/demo/company-a/changes/a-finance';
  try {
    expect((await app.inject({ url: url + '?after=0', headers: { authorization: 'Bearer service' } })).statusCode).toBe(401);
    for (const query of ['', '?after=00', '?after=%30', '?after=0&after=0', '?after=0&sourceRef=legacy-b']) {
      expect((await app.inject({ url: url + query, headers: { authorization: 'Bearer reader' } })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: url + '?after=0', headers: {
      authorization: 'Bearer reader', 'content-type': 'application/json',
    }, payload: '{}' })).statusCode).toBe(400);
    expect((await app.inject({ url: url.replace('a-finance', 'b-files') + '?after=0',
      headers: { authorization: 'Bearer reader' } })).statusCode).toBe(404);
    expect(fetchChanges).not.toHaveBeenCalled();
    const result = await app.inject({ url: url + '?after=0', headers: { authorization: 'Bearer reader' } });
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(fetchChanges).toHaveBeenCalledWith('legacy-a', 'a-finance', '0');
    expect((await app.inject({ method: 'POST', url: '/internal/demo/company-a/payment', payload: {} })).statusCode).toBe(404);
  } finally { await app.close(); }
});
