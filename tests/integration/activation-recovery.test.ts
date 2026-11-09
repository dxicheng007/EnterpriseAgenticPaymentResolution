import { expect, it } from 'vitest';
import type { Pool } from 'pg';
import { composeWorkerActivation } from '../../apps/worker/src/activation-composition.js';
import { buildWorker } from '../../apps/worker/src/server.js';

it('requires service authentication before a malformed receipt key can reach storage', async () => {
  let reads = 0;
  const db = { connect: async () => { reads++; throw new Error('Storage unavailable'); } } as unknown as Pool;
  const app = buildWorker({
    db, serviceToken: 'worker-service', clock: () => new Date(), expectedMigrations: [],
    featurePlugins: [composeWorkerActivation({
      registryRoot: '/unavailable', policyPath: '/unavailable', sourceOrigin: 'http://127.0.0.1:1',
      sourceReadToken: 'source-service', sourceRefs: ['source-a'],
    })],
  });
  try {
    const key = 'x'.repeat(161);
    const unauthorized = await app.inject({ url: '/internal/receipts/' + key });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers['cache-control']).toBe('no-store');
    for (const url of ['/internal/receipts/' + key, '/internal/receipts/%zz', '/internal/receipts/key?companyId=a&companyId=b']) {
      const invalid = await app.inject({ url, headers: { authorization: 'Bearer worker-service' } });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.headers['cache-control']).toBe('no-store');
    }
    expect(reads).toBe(0);
  } finally {
    await app.close();
  }
});
