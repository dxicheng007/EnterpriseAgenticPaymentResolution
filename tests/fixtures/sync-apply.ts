import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { expect } from 'vitest';
import { hashEvent, LocalSessionResponseSchema, ReviewPackageSchema, type RawSourceEvent } from '@eapr/contracts';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { createSourceService } from '@eapr/sources';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { readActivationBundle } from '@eapr/storage/activation-registry';
import { createControlDb } from '@eapr/storage/control-db';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import { composeActivationReview } from '../../apps/control/src/activation-composition.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { createReviewRepository } from '../../apps/control/src/review-repository.js';
import { buildControl, createWorkerClient } from '../../apps/control/src/server.js';
import { selectedProfile } from '../../apps/worker/src/activation-validation.js';
import { createWorkerActivation } from '../../apps/worker/src/activation.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { eventA, type RecordA } from '../../packages/sources/src/company-a.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { migrate, migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { issueActivationProofs, verifyOriginals } from './activation-proof.js';
import { testNamespace } from './harness.js';

export const syncApplyInstant = '2026-11-09T08:00:00.000Z';
const webOrigin = 'http://127.0.0.1:5182';
const serviceToken = 'sync-apply-test-worker';
const operatorToken = 'sync-apply-test-operator';
export const syncApplyClock = () => new Date(syncApplyInstant);

async function activate(
  db: Pool, proofs: Awaited<ReturnType<typeof issueActivationProofs>>,
  source: ReturnType<typeof createSourceService>, runtimeThrough?: number,
) {
  const { registryRoot, dependencies } = proofs;
  const catalog = readMigrationCatalog();
  const worker = await launchWorker({
    db, serviceToken, clock: syncApplyClock,
    expectedMigrations: migrationIdentities(catalog.runtime.filter(row => row.version <= (runtimeThrough ?? Infinity))),
    featurePlugins: [composeWorkerParentReads(registryRoot)],
  }, 0);
  try {
    const address = worker.server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture worker listener');
    const origin = 'http://127.0.0.1:' + address.port;
    const workerActivation = createWorkerActivation({
      db, clock: syncApplyClock, registered: proofs.scopeReader, policy: await loadActivationPolicy(proofs),
      readBundle: hash => readActivationBundle({ registryRoot }, hash), observe: source.readCurrentSemantics,
    });
    const session = createLocalSessionService({
      webOrigin, reviewerId: 'sync-apply-test-reviewer',
      allowedSourceRefs: [...localSourceCatalog.values()].map(entry => entry.sourceRef),
      allowedAccountIds: [proofs.a.accountId],
    });
    const review = await composeActivationReview({ dependencies, catalog: localSourceCatalog, service: source }, {
      registryRoot, policyPath: proofs.policyPath, selectionPath: proofs.selectionPath,
      bootstrapRoots: proofs.bootstrapRoots, candidates: proofs.candidates, observe: source.readCurrentSemantics,
      parent: createParentReadClient(origin, serviceToken, registryRoot), authorize: session.authorizeReviewer,
    });
    const control = buildControl({
      db: dependencies.db, clock: syncApplyClock, expectedMigrations: migrationIdentities(catalog.control),
      workerClient: createWorkerClient(origin, serviceToken), featurePlugins: [session.plugin, ...review],
    });
    try {
      const opened = await control.inject({
        method: 'POST', url: '/api/local-session',
        headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
      });
      expect(opened.statusCode).toBe(200);
      const cookie = opened.cookies[0]!;
      const headers = {
        origin: webOrigin, cookie: cookie.name + '=' + cookie.value,
        'x-eapr-csrf': LocalSessionResponseSchema.parse(opened.json()).csrfToken,
      };
      const url = '/api/review/' + proofs.a.accountId;
      const prepared = await control.inject({ method: 'POST', url: url + '/prepare', headers, payload: {} });
      expect(prepared.statusCode, prepared.body).toBe(200);
      const reviewPackage = ReviewPackageSchema.parse(prepared.json());
      const idempotencyKey = 'sync-apply-test-approval';
      const approved = await control.inject({
        method: 'POST', url: url + '/activate', headers, payload: {
          reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash,
          expectedArtifactHash: reviewPackage.artifactHash, expectedProfileHash: reviewPackage.profileHash,
          expectedTargetVersion: reviewPackage.expectedTargetVersion, idempotencyKey,
        },
      });
      expect(approved.statusCode, approved.body).toBe(202);
      const intent = await createReviewRepository(dependencies.db, syncApplyClock).readIntentByKey(idempotencyKey);
      if (!intent) throw new Error('No fixture approval intent');
      const { receipt } = await workerActivation.activate({ idempotencyKey, bundleHash: intent.bundleHash });
      const stored = await withTransaction(db, client => readStoredActivation(client, receipt.scope));
      if (!stored) throw new Error('No fixture activation');
      verifyOriginals(stored.approvedTarget.records, 'a');
      return { stored, identity: { scope: receipt.scope, activationId: receipt.activationId, bundleHash: intent.bundleHash } };
    } finally {
      await control.close();
    }
  } finally {
    await worker.close();
  }
}

export async function createSyncApplyFixture(runtimeThrough?: number) {
  const namespace = testNamespace('apply');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-sync-apply-'));
  await startNativeDb();
  const pair = await provisionTest(namespace);
  const db = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  const owner = createRuntimeDb({ connectionString: pair.runtime.migrationUrl });
  const control = createControlDb({ connectionString: pair.control.appUrl });
  async function close() {
    await Promise.all([db.end(), owner.end(), control.end()]);
    await dropTest(namespace);
    await rm(root, { recursive: true, force: true });
  }
  try {
    const catalog = readMigrationCatalog();
    await migrate(pair, ['control', 'runtime'], {
      ...catalog, runtime: catalog.runtime.filter(row => row.version <= (runtimeThrough ?? Infinity)),
    });
    const proofs = await issueActivationProofs(root, control);
    const source = createSourceService(proofs.dependencies, localSourceCatalog);
    const operator = createScenarioAdmin(proofs.dependencies, {
      DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operatorToken,
    });
    const activation = await activate(db, proofs, source, runtimeThrough);
    const addInvoice = (id: string, sourceAccountId: string) => operator.freshInvoiceA(operatorToken, {
      id, accountId: sourceAccountId, amount: '12.00', dueDate: '2026-10-31',
      effectiveDate: '2026-10-02', observedAt: syncApplyInstant,
    });
    const addPayment = (id: string, sourceAccountId: string, invoiceId: string) => operator.freshPaymentA(operatorToken, {
      id, accountId: sourceAccountId, invoiceId, amount: '12.00', effectiveDate: '2026-10-02', observedAt: syncApplyInstant,
    });
    const addSemantic = (id: string, sourceAccountId: string, revision: string) => operator.semanticChangeA(operatorToken, {
      id, accountId: sourceAccountId, revision, effectiveDate: '2026-10-02', observedAt: syncApplyInstant,
    });
    return { db, owner, pair, close, source, addInvoice, addPayment, addSemantic, ...activation };
  } catch (error) {
    await close();
    throw error;
  }
}

export type SyncApplyFixture = Awaited<ReturnType<typeof createSyncApplyFixture>>;
export const applyFinancialStream = 'a-finance';
export const applySemanticStream = 'a-semantics';

export function applyBaseline(data: SyncApplyFixture, streamId = applyFinancialStream) {
  return data.stored.bundle.manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
}

export function applyEvent(event: RawSourceEvent, changes: Partial<RawSourceEvent>) {
  const updated = { ...event, ...changes };
  return { ...updated, contentHash: hashEvent(updated) };
}

export async function captureApplyEvents(data: SyncApplyFixture, after: string, input: RawSourceEvent[]) {
  const capture = await createRuntimeCapture({ db: data.db, clock: syncApplyClock }).openCommitted(data.identity);
  const events = input.map((event, index) => applyEvent(event, { sequence: Number(after) + index + 1 }));
  const page = { sourceRef: capture.lane.sourceRef, streamId: applyFinancialStream, after,
    next: String(Number(after) + events.length), complete: true, events };
  expect(await capture.capturePage(page)).toEqual({
    disposition: 'captured', captured: events.length, cursor: page.next, replayed: false,
  });
  return { capture, page };
}

export function partialAllocationEvents(data: SyncApplyFixture) {
  const sourceAccountId = selectedProfile(data.stored.bundle).sourceAccountIds[0]!;
  const { approvedTarget, bundle } = data.stored;
  const suffix = sourceAccountId + '-2026-09-01';
  const invoice = approvedTarget.records.invoices.find(record => record.identity.recordId === 'inv-a:' + suffix)!;
  const payment = approvedTarget.records.payments.find(record => record.identity.recordId === 'pay-a:' + suffix)!;
  const allocation = approvedTarget.records.allocations.find(record => record.identity.recordId === 'alloc-payment-a:' + suffix)!;
  const originalEvent = (record: { sourceEventId: string }) => bundle.bootstrapEvents.find(event => event.id === record.sourceEventId)!;
  const fresh = (record: Omit<RecordA, 'sourceAccountId'>) => eventA({ ...record, sourceAccountId }, 1, syncApplyInstant);
  const p1 = fresh({ kind: 'payment', recordId: 'pay-a:sync-apply-partial', effectiveDate: '2026-10-02', fields: { amount: '40.00' } });
  const allocate = (n: 1 | 2, amount: string, effectiveDate: string) => fresh({
    kind: 'allocation', recordId: 'alloc-a:sync-apply-partial-' + n, effectiveDate,
    fields: { amount, funding_kind: 'payment', funding_id: p1.recordId, invoice_id: invoice.identity.recordId },
  });
  return {
    invoice, payment, allocation,
    invoiceEvent: originalEvent(invoice), paymentEvent: originalEvent(payment), allocationEvent: originalEvent(allocation),
    p1, a1: allocate(1, '20.00', '2026-10-02'), a2: allocate(2, '10.00', '2026-10-03'),
  };
}
