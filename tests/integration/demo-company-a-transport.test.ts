import type { Pool } from 'pg';
import { expect, test } from 'vitest';
import { ReceiptResponseSchema } from '@eapr/contracts';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { composeDemoSource } from '../../apps/control/src/demo-source-composition.js';
import { launchControl } from '../../apps/control/src/server.js';
import { composeSourceSemantics } from '../../apps/control/src/source-semantics-composition.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { composeWorkerDemoSync } from '../../apps/worker/src/demo-sync-composition.js';
import { createParentReads } from '../../apps/worker/src/parent-reads.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { companyADemo as demo } from '../../packages/contracts/src/demo-company-a.js';
import { migrate } from '../../scripts/migrate.js';
import { dropTest, provisionTest } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';
import { createSyncApplyFixture, syncApplyClock, type SyncApplyFixture } from '../fixtures/sync-apply.js';

const serviceToken = 'test-demo-service';
const sourceToken = 'test-demo-reader';
const operator = { enabled: true, token: 'test-demo-operator' } as const;
const payment = '/internal/demo/company-a/payment';
const sync = '/internal/demo/company-a/sync';
const financeFeed = '/internal/demo/company-a/changes/a-finance';

function post(origin: string, path: string, token?: string, body = '{}', extra: Record<string, string> = {}) {
  return fetch(origin + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }), ...extra }, body,
  });
}

async function fixture(run: (data: SyncApplyFixture) => Promise<void>) {
  const data = await createSyncApplyFixture(undefined, undefined, { seed: demo.seed });
  try { await run(data); } finally { await data.close(); }
}

async function controlServer(data: SyncApplyFixture, enabled = true) {
  const sourceReads: string[] = [];
  const app = await launchControl({
    db: data.dependencies.db, clock: data.dependencies.clock, expectedMigrations: [],
    workerClient: { getHealth: async () => { throw new Error('Unexpected health request'); } },
    featurePlugins: [
      async (control, services) => {
        control.addHook('onRequest', async request => {
          if (request.headers.authorization === 'Bearer ' + sourceToken) sourceReads.push(request.url);
        });
        control.register(composeDemoSource({
          source: data.source, sourceToken, serviceToken,
          operator: enabled ? { ...operator, dependencies: data.dependencies } : { enabled: false },
        }));
        control.register(composeSourceSemantics(data.dependencies, {
          catalog: localSourceCatalog, capability: { token: sourceToken, sourceRefs: [demo.sourceRef] },
        }).plugin, services);
      },
    ],
  }, 0);
  return { app, origin: app.listeningOrigin, sourceReads };
}

async function workerServer(data: SyncApplyFixture, origin: string, {
  db = data.db, enabled = true, loseResponse = false,
}: { db?: Pool; enabled?: boolean; loseResponse?: boolean } = {}) {
  const app = await launchWorker({
    db, clock: syncApplyClock, expectedMigrations: [], serviceToken,
    featurePlugins: [async (worker, services) => {
      if (loseResponse) {
        worker.addHook('onSend', async (request, reply) => {
          if (request.url === sync && reply.statusCode === 200) reply.raw.destroy();
        });
      }
      worker.register(composeWorkerDemoSync({
        registered: data.scopeReader, source: { origin, token: sourceToken },
        operator: enabled ? operator : { enabled: false },
      }), services);
    }],
  }, 0);
  return { app, origin: app.listeningOrigin };
}

function readParent(data: SyncApplyFixture, asOf: string) {
  return createParentReads(data.db, syncApplyClock, data.scopeReader).readParent(demo.scope.accountId, { asOf });
}

test('private HTTP applies the fixed source events once and recovers a lost worker response', () => fixture(async data => {
  const control = await controlServer(data);
  try {
    const worker = await workerServer(data, control.origin, { loseResponse: true });
    let receiptId: string;
    try {
      const before = await readParent(data, demo.scenario.observedAt);
      expect(before.balanceCents).toBe(80000);
      for (const token of [undefined, sourceToken, serviceToken]) {
        expect((await post(control.origin, payment, token, 'malformed')).status).toBe(401);
        expect((await post(worker.origin, sync, token, 'malformed')).status).toBe(401);
      }
      expect((await post(control.origin, payment, operator.token, '{}', { 'x-eapr-csrf': 'reviewer' })).status).toBe(401);
      expect((await post(control.origin, payment + '?amount=1', operator.token)).status).toBe(400);
      expect((await post(control.origin, payment, operator.token, '{"amount":"1.00"}')).status).toBe(400);
      expect((await post(worker.origin, sync, operator.token, '{"accountId":"other"}')).status).toBe(400);
      const feed = await fetch(control.origin + financeFeed + '?after=0', { headers: { authorization: 'Bearer ' + operator.token } });
      expect(feed.status).toBe(401);
      expect((await data.dependencies.db.query('SELECT 1 FROM source_events WHERE event_id = ANY($1)', [demo.eventIds])).rowCount).toBe(0);
      expect((await data.db.query('SELECT 1 FROM runtime_sync_receipts')).rowCount).toBe(0);
      expect(await readParent(data, demo.scenario.observedAt)).toEqual(before);
      const injected = await post(control.origin, payment, operator.token);
      expect(injected.status).toBe(200);
      expect(injected.headers.get('cache-control')).toBe('no-store');
      expect(await injected.json()).toEqual({ sourceRef: 'legacy-a', eventIds: [...demo.eventIds] });
      expect(await readParent(data, demo.scenario.observedAt)).toEqual(before);

      await expect(post(worker.origin, sync, operator.token)).rejects.toThrow('fetch failed');
      const receipts = await data.db.query<{ receipt_id: string }>('SELECT receipt_id FROM runtime_sync_receipts');
      expect(receipts.rowCount).toBe(1);
      receiptId = receipts.rows[0]!.receipt_id;
      expect(control.sourceReads).toEqual(expect.arrayContaining([
        expect.stringMatching(/^\/internal\/demo\/company-a\/changes\/a-finance\?after=\d+$/),
        expect.stringMatching(/^\/internal\/demo\/company-a\/changes\/a-semantics\?after=\d+$/),
        '/internal/sources/legacy-a/semantics',
      ]));
      expect(await readParent(data, demo.scenario.observedAt)).toMatchObject({ balanceCents: 50000, version: before.version + 1 });
      expect(await readParent(data, demo.cutover)).toMatchObject({ balanceCents: 80000 });
    } finally { await worker.app.close(); }

    const reconstructed = await workerServer(data, control.origin);
    try {
      expect((await post(control.origin, payment, operator.token)).status).toBe(200);
      const reads = control.sourceReads.length;
      const retry = await post(reconstructed.origin, sync, operator.token);
      expect(retry.status).toBe(200);
      expect(retry.headers.get('cache-control')).toBe('no-store');
      expect(ReceiptResponseSchema.parse(await retry.json())).toMatchObject({
        replayed: true, receipt: { id: receiptId, beforeBalanceCents: 80000, afterBalanceCents: 50000, eventIds: [...demo.eventIds] },
      });
      expect(control.sourceReads).toHaveLength(reads);
      expect((await data.db.query('SELECT 1 FROM runtime_sync_receipts')).rowCount).toBe(1);
      expect((await data.dependencies.db.query('SELECT 1 FROM source_events WHERE event_id = ANY($1)', [demo.eventIds])).rowCount).toBe(2);
    } finally { await reconstructed.app.close(); }
  } finally { await control.app.close(); }
}), 120_000);

test('disabled and unapproved private commands cannot write parent state', () => fixture(async data => {
  const disabledControl = await controlServer(data, false);
  try {
    const disabledWorker = await workerServer(data, disabledControl.origin, { enabled: false });
    try {
      expect((await post(disabledControl.origin, payment, operator.token)).status).toBe(404);
      expect((await post(disabledWorker.origin, sync, operator.token)).status).toBe(404);
    } finally { await disabledWorker.app.close(); }
  } finally { await disabledControl.app.close(); }

  const namespace = testNamespace('unapproved');
  const pair = await provisionTest(namespace);
  const db = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  try {
    await migrate(pair, ['runtime']);
    const control = await controlServer(data);
    try {
      const worker = await workerServer(data, control.origin, { db });
      try {
        expect((await post(control.origin, payment, operator.token)).status).toBe(200);
        const result = await post(worker.origin, sync, operator.token);
        expect(result.status).toBe(404);
        expect(await result.json()).toMatchObject({ code: 'AUTHORITY_NOT_FOUND' });
        expect(control.sourceReads).toEqual([]);
        expect((await db.query('SELECT 1 FROM parent_targets')).rowCount).toBe(0);
        expect((await db.query('SELECT 1 FROM runtime_sync_receipts')).rowCount).toBe(0);
      } finally { await worker.app.close(); }
    } finally { await control.app.close(); }
  } finally { await db.end(); await dropTest(namespace); }
}), 120_000);

test('foreign source events remain in the real feed and block the fixed apply', () => fixture(async data => {
  const control = await controlServer(data);
  try {
    const worker = await workerServer(data, control.origin);
    try {
      const before = await readParent(data, demo.scenario.observedAt);
      expect((await post(control.origin, payment, operator.token)).status).toBe(200);
      const foreign = await data.addInvoice('demo-foreign-http', 'cust-a-d22feb38e846-2');
      const result = await post(worker.origin, sync, operator.token);
      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({ code: 'SYNC_COVERAGE_UNSUPPORTED' });
      expect((await data.db.query('SELECT 1 FROM runtime_sync_receipts')).rowCount).toBe(0);
      expect((await data.db.query('SELECT 1 FROM runtime_deliveries WHERE event_id = $1', [foreign[0]!.id])).rowCount).toBe(1);
      expect(await readParent(data, demo.scenario.observedAt)).toEqual(before);
    } finally { await worker.app.close(); }
  } finally { await control.app.close(); }
}), 120_000);
