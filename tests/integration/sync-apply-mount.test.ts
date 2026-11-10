import { afterAll, beforeAll, expect, test } from 'vitest';
import { ApiErrorSchema, ParentViewSchema, ReceiptResponseSchema } from '@eapr/contracts';
import { selectedProfile } from '../../apps/worker/src/activation-validation.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { createWorkerSyncPlugin } from '../../apps/worker/src/routes/sync.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { composeWorkerSync } from '../../apps/worker/src/sync-composition.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';
import {
  applyBaseline, applyFinancialStream, createSyncApplyFixture, syncApplyClock, syncApplyInstant,
  type SyncApplyFixture,
} from '../fixtures/sync-apply.js';
import {
  assertModelCredentialsAbsent, scrubModelCredentials, workerProductionImportGraph,
} from '../fixtures/v5-ai-off.js';

const serviceToken = 'sync-apply-mount-worker';
let data: SyncApplyFixture;
let worker: Awaited<ReturnType<typeof launchWorker>>;
let origin: string;

beforeAll(async () => {
  scrubModelCredentials();
  assertModelCredentialsAbsent();
  data = await createSyncApplyFixture();
  // Money proof mounts the route plugin with the fixture's in-process semantics reader.
  // Production `composeWorkerSync` (HTTP source client) is wired in scripts/dev.ts and
  // covered for distinct-capability fail-closed behavior below; labeled partial AI-off evidence.
  worker = await launchWorker({
    db: data.db,
    clock: syncApplyClock,
    serviceToken,
    expectedMigrations: migrationIdentities(readMigrationCatalog().runtime),
    featurePlugins: [
      composeWorkerParentReads(data.registryRoot),
      async (app, services) => {
        app.register(createWorkerSyncPlugin({
          db: services.db,
          clock: services.clock,
          serviceToken: services.serviceToken,
          observe: data.source.readCurrentSemantics,
        }));
      },
    ],
  }, 0);
  const address = worker.server.address();
  if (!address || typeof address === 'string') throw new Error('No sync mount worker listener');
  origin = 'http://127.0.0.1:' + address.port;
}, 120_000);

afterAll(async () => {
  await worker?.close();
  await data?.close();
});

function post(accountId: string, token?: string) {
  return fetch(origin + '/internal/apply', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify({ accountId }),
  });
}

test('mount applies the demo payment once and preserves the cutover balance', async () => {
  assertModelCredentialsAbsent();
  const sourceAccountId = selectedProfile(data.stored.bundle).sourceAccountIds[0]!;
  await data.operator.freshPaymentA(data.operatorToken, {
    id: 'demo-pay-a-cutover-300',
    accountId: sourceAccountId,
    invoiceId: 'inv-a:' + sourceAccountId + '-2026-09-01',
    amount: '300.00',
    effectiveDate: '2026-10-03',
    observedAt: syncApplyInstant,
  });
  const capture = await createRuntimeCapture({ db: data.db, clock: syncApplyClock }).openCommitted(data.identity);
  const page = await data.source.fetchChanges(
    data.stored.bundle.manifest.sourceRef,
    applyFinancialStream,
    applyBaseline(data),
  );
  expect(await capture.capturePage(page)).toMatchObject({ disposition: 'captured', captured: 2, replayed: false });

  const unauthorized = await post(data.identity.scope.accountId);
  expect(unauthorized.status).toBe(401);
  expect(ApiErrorSchema.parse(await unauthorized.json()).code).toBe('AUTHORITY_UNAUTHORIZED');
  const wrongToken = await post(data.identity.scope.accountId, 'not-' + serviceToken);
  expect(wrongToken.status).toBe(401);
  expect(ApiErrorSchema.parse(await wrongToken.json()).code).toBe('AUTHORITY_UNAUTHORIZED');

  const response = await post(data.identity.scope.accountId, serviceToken);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const applied = await response.json() as Record<string, unknown>;
  expect(applied.status).toBe('applied');
  const receipt = ReceiptResponseSchema.parse({ receipt: applied.receipt, replayed: applied.replayed });
  expect(receipt).toMatchObject({
    replayed: false,
    receipt: { beforeBalanceCents: 80000, afterBalanceCents: 50000 },
  });

  const headers = { authorization: 'Bearer ' + serviceToken };
  const account = encodeURIComponent(data.identity.scope.accountId);
  const current = await fetch(origin + '/internal/parent/' + account, { headers });
  expect(ParentViewSchema.parse(await current.json()).balanceCents).toBe(50000);
  const cutover = data.stored.bundle.manifest.asOf;
  expect(cutover).toBe('2026-10-01T00:00:00.000Z');
  const historical = await fetch(origin + '/internal/parent/' + account + '?asOf=' + encodeURIComponent(cutover), { headers });
  expect(ParentViewSchema.parse(await historical.json()).balanceCents).toBe(80000);

  // Second trigger with no new captured suffix: no_work. Exact applyBatch receipt
  // recovery and applyReplay-only units remain covered by unmounted sync-apply suites.
  const second = await post(data.identity.scope.accountId, serviceToken);
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual({ status: 'no_work', replayed: false });
  expect((await data.db.query('SELECT receipt_id FROM runtime_sync_receipts')).rows).toEqual([
    { receipt_id: receipt.receipt.id },
  ]);
  expect(ParentViewSchema.parse(await (await fetch(origin + '/internal/parent/' + account, { headers })).json()).balanceCents).toBe(50000);

  const unknown = await post('unknown-sync-account', serviceToken);
  expect(unknown.status).toBe(404);
  expect(ApiErrorSchema.parse(await unknown.json()).code).toBe('AUTHORITY_NOT_FOUND');
  assertModelCredentialsAbsent();
}, 120_000);

test('production sync composition is model-free and rejects a shared capability', async () => {
  const graph = workerProductionImportGraph(['apps/worker/src/sync-composition.ts']);
  expect(graph).toContain('apps/worker/src/sync/apply.ts');
  expect(graph).toContain('apps/worker/src/routes/sync.ts');
  expect(graph.some(path => path.includes('packages/discovery/') || path.includes('packages/runtime/'))).toBe(false);
  await expect(launchWorker({
    db: data.db,
    clock: syncApplyClock,
    serviceToken,
    expectedMigrations: migrationIdentities(readMigrationCatalog().runtime),
    featurePlugins: [composeWorkerSync({
      source: {
        origin: 'http://127.0.0.1:1',
        token: serviceToken,
        sourceRefs: [data.stored.bundle.manifest.sourceRef],
      },
    })],
  }, 0)).rejects.toThrow('Worker and source capabilities must be distinct');
}, 120_000);
