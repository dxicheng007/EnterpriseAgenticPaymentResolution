import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { validateActivationBundle } from '../../apps/worker/src/activation-validation.js';
import { createSourceSemanticsClient } from '../../apps/worker/src/source-semantics-client.js';

it('reads current semantics at the fixed authenticated origin and rejects a different source', async () => {
  const observed: unknown[] = [];
  const server = createServer((request, response) => {
    observed.push([request.url, request.headers.authorization]);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ sourceRef: 'other', checkedAt: '2026-11-09T00:00:00.000Z', versions: {} }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No loopback address');
    const read = createSourceSemanticsClient({
      baseUrl: 'http://127.0.0.1:' + address.port, token: 'source-read-token', sourceRefs: ['source-a'],
    });
    await expect(read('source-a')).rejects.toMatchObject({ statusCode: 503, code: 'SOURCE_SEMANTICS_UNAVAILABLE' });
    await expect(read('source-b')).rejects.toMatchObject({ statusCode: 403 });
    expect(observed).toEqual([['/internal/sources/source-a/semantics', 'Bearer source-read-token']]);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

it('rejects invalid authority without deriving eligibility from input flags', () => {
  expect(() => validateActivationBundle({ verificationReport: { eligible: true } }, undefined))
    .toThrow('ACTIVATION_BUNDLE_MISMATCH');
});

it('bounds source responses, preserves upstream denial status, and forbids redirects', async () => {
  let redirected = false;
  let status = 403;
  const server = createServer((request, response) => {
    if (request.url === '/redirected') redirected = true;
    response.statusCode = status;
    if (status === 302) response.setHeader('location', '/redirected');
    response.end(status === 200 ? ' '.repeat(257 * 1024) : '');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No loopback address');
    const read = createSourceSemanticsClient({
      baseUrl: 'http://127.0.0.1:' + address.port, token: 'source-read-token', sourceRefs: ['source-a'],
    });
    for (const upstream of [403, 404, 302, 200]) {
      status = upstream;
      const statusCode = upstream === 403 || upstream === 404 ? upstream : 503;
      await expect(read('source-a')).rejects.toMatchObject({ statusCode });
    }
    expect(redirected).toBe(false);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
