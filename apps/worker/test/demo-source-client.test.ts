import Fastify from 'fastify';
import { expect, test } from 'vitest';
import { createDemoSourceClient } from '../src/demo-source-client.js';

test('the private source client bounds and validates real HTTP responses', async () => {
  const app = Fastify();
  let mode = 'valid';
  let redirected = false;
  app.get('/redirected', () => { redirected = true; return {}; });
  app.get('/internal/demo/company-a/changes/a-finance', async (request, reply) => {
    expect(request.headers.authorization).toBe('Bearer reader');
    expect(request.query).toEqual({ after: '7' });
    const page = { sourceRef: 'legacy-a', streamId: 'a-finance', after: '7', next: '7', complete: true, events: [] };
    switch (mode) {
      case 'redirect': return reply.redirect('/redirected');
      case 'malformed': return reply.type('application/json').send('{');
      case 'oversize': return reply.type('application/json').send(' '.repeat(1024 * 1024 + 1));
      case 'stream oversize':
        reply.hijack();
        reply.raw.writeHead(200, { 'content-type': 'application/json' });
        reply.raw.write(' '.repeat(600 * 1024));
        reply.raw.end(' '.repeat(600 * 1024));
        return;
      case 'wrong page': return { ...page, after: '8', next: '8' };
      case 'incomplete': return { ...page, complete: false };
      case 'timeout':
        reply.hijack();
        reply.raw.writeHead(200, { 'content-type': 'application/json' });
        reply.raw.write('{');
        return;
      default: return page;
    }
  });
  try {
    const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    const fetchChanges = createDemoSourceClient({ baseUrl, token: 'reader' });
    expect(await fetchChanges('legacy-a', 'a-finance', '7')).toMatchObject({ next: '7', events: [] });
    for (mode of ['redirect', 'malformed', 'oversize', 'stream oversize', 'wrong page', 'incomplete', 'timeout']) {
      await expect(fetchChanges('legacy-a', 'a-finance', '7')).rejects.toMatchObject({ code: 'SYNC_SOURCE_UNAVAILABLE' });
    }
    expect(redirected).toBe(false);
    for (const [source, stream, after] of [['legacy-b', 'a-finance', '7'], ['legacy-a', 'b-files', '7'], ['legacy-a', 'a-finance', '07']] as const) {
      await expect(fetchChanges(source, stream, after)).rejects.toMatchObject({ code: 'SYNC_SOURCE_UNAVAILABLE' });
    }
  } finally { await app.close(); }
}, 10_000);
