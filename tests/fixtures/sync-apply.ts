import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';
import { expect } from 'vitest';
import { hashEvent, hashTargetSnapshot, LocalSessionResponseSchema, ReviewPackageSchema, type RawSourceEvent, type TargetState } from '@eapr/contracts';
import { encodeCanonical, scopeValues } from '@eapr/parent/snapshots';
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
  source: ReturnType<typeof createSourceService>, runtimeThrough?: number, seed?: string,
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
      verifyOriginals(stored.approvedTarget.records, 'a', seed);
      return { stored, identity: { scope: receipt.scope, activationId: receipt.activationId, bundleHash: intent.bundleHash } };
    } finally {
      await control.close();
    }
  } finally {
    await worker.close();
  }
}

export async function createSyncApplyFixture(runtimeThrough?: number, baselineVersion?: number, { seed }: { seed?: string } = {}) {
  const cleanupActions: Array<() => Promise<void>> = [];
  let closePromise: Promise<void> | undefined;
  function close(): Promise<void> {
    closePromise ??= Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      for (const cleanup of cleanupActions.toReversed()) {
        try {
          await cleanup();
        } catch (failure) {
          failures.push(failure);
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Sync apply fixture cleanup failed');
    });
    return closePromise;
  }

  try {
    const namespace = testNamespace('apply');
    const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-sync-apply-'));
    cleanupActions.push(() => rm(root, { recursive: true, force: true }));
    await startNativeDb();
    const pair = await provisionTest(namespace);
    cleanupActions.push(() => dropTest(namespace));
    const db = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    cleanupActions.push(() => db.end());
    const owner = createRuntimeDb({ connectionString: pair.runtime.migrationUrl });
    cleanupActions.push(() => owner.end());
    const control = createControlDb({ connectionString: pair.control.appUrl });
    cleanupActions.push(() => control.end());

    const catalog = readMigrationCatalog();
    await migrate(pair, ['control', 'runtime'], {
      ...catalog, runtime: catalog.runtime.filter(row => row.version <= (runtimeThrough ?? Infinity)),
    });
    const proofs = await issueActivationProofs(root, control, seed);
    const source = createSourceService(proofs.dependencies, localSourceCatalog);
    const operator = createScenarioAdmin(proofs.dependencies, {
      DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operatorToken,
    });
    if (baselineVersion !== undefined) {
      const entry = (await proofs.scopeReader.readSnapshot()).resolveRegisteredScope(proofs.a.accountId)!.entry;
      const target: TargetState = {
        scope: entry.scope, version: baselineVersion, asOf: entry.manifestAsOf,
        invoices: [], payments: [], credits: [], allocations: [], reversals: [],
        customers: [], accounts: [], billingConfigurations: [],
      };
      const values = scopeValues(entry.scope);
      const snapshotHash = hashTargetSnapshot(target);
      await withTransaction(owner, async client => {
        await client.query('INSERT INTO parent_scopes (account_id, company_id, seller_entity_id) VALUES ($1,$2,$3)', values);
        await client.query(`
          INSERT INTO parent_snapshots (account_id, company_id, seller_entity_id, target_version, snapshot_hash, recorded_as_of, canonical, digest)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [...values, baselineVersion, snapshotHash, target.asOf, ...encodeCanonical(target)]);
        await client.query(`
          INSERT INTO parent_targets (account_id, company_id, seller_entity_id, target_version, snapshot_hash)
          VALUES ($1,$2,$3,$4,$5)
        `, [...values, baselineVersion, snapshotHash]);
      });
    }
    const activation = await activate(db, proofs, source, runtimeThrough, seed);
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
    return {
      db, owner, pair, close, source, operator, operatorToken, registryRoot: proofs.registryRoot,
      addInvoice, addPayment, addSemantic, dependencies: proofs.dependencies, scopeReader: proofs.scopeReader, ...activation,
      processSetup: {
        captures: [proofs.a.capture, proofs.b.capture],
        evidenceRoot: join(root, 'originals'),
        selectionPath: proofs.selectionPath,
        workerPaths: { registryRoot: proofs.registryRoot, policyPath: proofs.policyPath },
        controlPaths: {
          registryRoot: proofs.registryRoot, policyPath: proofs.policyPath,
          evidencePinRoot: proofs.bootstrapRoots.evidencePinRoot, sidecarRoot: proofs.bootstrapRoots.sidecarRoot,
          visibleRoot: join(root, 'visible'), webRoot: resolve('apps/web'),
        },
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      const failures = cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
      throw new AggregateError(failures, 'Sync apply fixture construction and cleanup failed', { cause: error });
    }
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
