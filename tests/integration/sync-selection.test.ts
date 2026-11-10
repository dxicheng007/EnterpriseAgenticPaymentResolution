import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ChangePageSchema, VerificationCheckIdSchema, bootstrapRequiredAssertions, bootstrapRequiredCases,
  hashBytes, hashCanonical, hashFinancialAttestation, hashFinancialReport, hashFinancialReservation, hashProfile,
  targetRecordId, type CaptureProgressV1, type TargetState,
} from '@eapr/contracts';
import { planBatch } from '@eapr/compiler/plan-batch';
import { computeBalance } from '@eapr/finance/balance';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import * as controlDb from '@eapr/storage/control-db';
import * as runtimeDb from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import type { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as activationComposition from '../../apps/control/src/activation-composition.js';
import * as workerServer from '../../apps/worker/src/server.js';
import { createSyncApplier } from '../../apps/worker/src/sync/apply.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { createCurrentAuthority } from '../../apps/worker/src/sync/current-authority.js';
import { readAuthoritySnapshotInTransaction } from '../../apps/worker/src/sync/current-authority-store.js';
import { createSelectionReadAdmission, readSelectionCatalog } from '../../apps/worker/src/sync/selection-read.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import * as nativeDb from '../../scripts/native-db.js';
import * as evidenceCapture from '../fixtures/evidence-v2-capture.js';
import { createSyncSelectionFixture } from '../fixtures/sync-selection.js';
import { createSyncApplyFixture, syncApplyClock, type SyncApplyFixture } from '../fixtures/sync-apply.js';
import { createSyncSelectionBaselinesFixture } from '../fixtures/sync-selection-baselines.js';
import { createSyncSelectionBundledFixture } from '../fixtures/sync-selection-bundled.js';
import { createSyncSelectionCatalogCsvFixture } from '../fixtures/sync-selection-catalog-csv.js';
import { createSyncSelectionCatalogNineFixture } from '../fixtures/sync-selection-catalog-nine.js';

type Fixture = Awaited<ReturnType<typeof createSyncSelectionFixture>>;
type EvidenceInput = Awaited<ReturnType<typeof evidenceCapture.captureEvidenceFixture>>['input'];
type Captured = Pick<EvidenceInput, 'manifest' | 'snapshot' | 'events' | 'citations'>;
type Roots = Parameters<typeof evidenceCapture.captureEvidenceFixture>[1];

const root = fileURLToPath(new URL('../../', import.meta.url));
const clock = () => new Date('2026-11-09T08:00:00.000Z');
const manifestId = 'manifest-sync-selection-peers-v1';
const mandatory = [...VerificationCheckIdSchema.options].sort();
const expectedPeers = [
  {
    accountId: 'company-a.seller-a.sync-selection-one', sourceAccountId: 'sync-selection-one',
    buyerId: 'sync-selection-buyer-one', legalName: 'Selection One', contractId: 'sync-selection-contract-one',
    documentId: 'doc-sync-selection-one', invoiceId: 'sync-selection-invoice-one', eventId: 'evt:sync-selection-invoice-one',
    profileId: 'sync-selection-profile-one', approvalKey: 'sync-selection-approve-one',
    sidecarVersion: 'bootstrap-peer-one-v1',
  },
  {
    accountId: 'company-a.seller-a.sync-selection-two', sourceAccountId: 'sync-selection-two',
    buyerId: 'sync-selection-buyer-two', legalName: 'Selection Two', contractId: 'sync-selection-contract-two',
    documentId: 'doc-sync-selection-two', invoiceId: 'sync-selection-invoice-two', eventId: 'evt:sync-selection-invoice-two',
    profileId: 'sync-selection-profile-two', approvalKey: 'sync-selection-approve-two',
    sidecarVersion: 'bootstrap-peer-two-v1',
  },
] as const;
const expectedFiles = [
  'visible/api-a.json', 'visible/api-originals-a.json', 'visible/manifest-a.json', 'visible/uploads-a.json',
  'visible/contract-1.pdf', 'visible/contract-2.pdf', 'truth/expected-a.json', 'truth/evidence-a.json',
  'visible/api-a/' + hashCanonical('evt:sync-selection-invoice-one') + '.json',
  'visible/api-a/' + hashCanonical('evt:sync-selection-invoice-two') + '.json',
].sort();
const protectedPaths = [
  'tests/fixtures', 'tests/integration/sync-capture.test.ts', 'scripts/generate-fixtures.ts',
  'packages/sources/src', 'packages/evaluator/src', 'package-lock.json', '.local/protected-evaluator',
  '.local/protected-bootstrap', '.local/activation-policy', '.local/artifacts',
];
const nonCaptureTables = [
  'parent_scopes', 'parent_snapshots', 'parent_targets', 'parent_metadata', 'parent_financial_records',
  'runtime_activation_imports', 'runtime_import_lineage', 'runtime_financial_origins',
  'runtime_authority_heads', 'runtime_authority_commands', 'runtime_economic_outcomes', 'runtime_delivery_outcomes',
  'runtime_sync_receipts', 'runtime_sync_economic_outcomes', 'runtime_sync_delivery_outcomes',
  'runtime_sync_event_outcomes', 'runtime_sync_units', 'runtime_sync_application_heads',
];
const captureTables = [
  'runtime_capture_lanes', 'runtime_capture_checkpoints', 'runtime_capture_pages', 'runtime_source_positions',
  'runtime_deliveries', 'runtime_inbox', 'runtime_capture_incidents', 'activity_events', 'activity_counter',
];

type InventoryEntry = { path: string; sha256: string; bytes: number } | { path: string; absent: true };
async function inventory(path: string, label: string, skip?: string): Promise<InventoryEntry[]> {
  const stats = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!stats) return [{ path: label, absent: true }];
  if (label === skip) return [];
  if (!stats.isDirectory()) {
    const bytes = await readFile(path);
    return [{ path: label, sha256: hashBytes(bytes), bytes: bytes.length }];
  }
  const result: InventoryEntry[] = [];
  for (const child of (await readdir(path)).sort()) {
    result.push(...await inventory(join(path, child), label + '/' + child, skip));
  }
  return result;
}
const inputInventory = async ({ visibleRoot, truthRoot }: Roots) =>
  [...await inventory(visibleRoot, 'visible'), ...await inventory(truthRoot, 'truth')];
const protectedInventory = async () => (await Promise.all(protectedPaths.map(path =>
  inventory(join(root, path), path, 'tests/fixtures/sync-selection.ts')))).flat();

function expectTarget(records: TargetState, index: 0 | 1, captured: Captured) {
  const peer = expectedPeers[index];
  const member = captured.manifest.files.find(file => file.documentId === peer.documentId);
  const citation = captured.citations.find(({ evidence }) =>
    evidence.sourceId === member?.fileId && evidence.locator.kind === 'pdf' && evidence.locator.page === 1);
  expect(member).toBeDefined();
  expect(citation).toBeDefined();
  const evidenceRefs = [citation!.evidence.id];
  const scope = { companyId: 'company-a', sellerEntityId: 'seller-a', accountId: peer.accountId };
  const identity = { sourceRef: 'legacy-a', sellerEntityId: 'seller-a', kind: 'invoice' as const, recordId: peer.invoiceId };
  const recordId = targetRecordId(identity);
  expect(records).toEqual({
    scope, version: 1, asOf: '2026-10-01T00:00:00.000Z',
    invoices: [{
      id: recordId, identity, scope, kind: 'invoice', sourceEventId: peer.eventId, sourceRecordVersion: 1,
      amountCents: 300000, currency: 'USD', effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
    }],
    payments: [], credits: [], allocations: [], reversals: [],
    customers: [{ id: peer.buyerId, displayName: peer.legalName, evidenceRefs }],
    accounts: [{
      id: peer.accountId, scope, parentCustomerId: peer.buyerId, sourceRef: 'legacy-a', sourceAccountIds: [peer.sourceAccountId],
    }],
    billingConfigurations: [{
      id: 'configuration:demo-term-a', scope, contractTerm: {
        id: 'demo-term-a', contractId: peer.contractId, validFrom: '2026-09-01', validToExclusive: null,
        fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs,
      },
    }],
  });
  expect(computeBalance(records, '2026-10-01T00:00:00.000Z')).toBe(300000);
  return { scope, recordId };
}

async function qualify({ db, subjects }: Fixture, captured: Captured) {
  expect(captured.manifest.id).toBe(manifestId);
  expect(captured.events.map(event => event.id).sort()).toEqual(expectedPeers.map(peer => peer.eventId));
  const capturedEvents = captured.events.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const captureBinding = {
    sourceRef: 'legacy-a', companyId: 'company-a', manifestId, manifestHash: captured.manifest.hash,
    snapshotId: 'snapshot:manifest-sync-selection-peers-v1', snapshotHash: captured.snapshot.contentHash,
    snapshotObjectHash: hashCanonical(captured.snapshot), eventsHash: hashCanonical(capturedEvents),
  };
  for (const index of [0, 1] as const) {
    const { identity, stored } = subjects[index];
    const peer = expectedPeers[index];
    const { bundle, activation, plan, receipt, request } = stored;
    const { verificationReport: report, bootstrapVerification: bootstrap, financialAttestation: financial } = bundle;
    const { artifact } = bundle;
    const [profile] = bundle.profiles;
    expect(bundle.profiles).toHaveLength(1);
    expect(profile!.id).toBe(peer.profileId);
    expect(profile!.hash).toBe(hashProfile(profile!));
    expect(artifact.requiredProfileHashes).toEqual([profile!.hash]);
    expect(activation.profileHash).toBe(profile!.hash);
    expect(bundle.manifest).toEqual(captured.manifest);
    expect(bundle.snapshot).toEqual(captured.snapshot);
    expect(bundle.bootstrapEvents.toSorted((a, b) => a.sequence - b.sequence))
      .toEqual(captured.events.toSorted((a, b) => a.sequence - b.sequence));
    expect(report.eligible).toBe(true);
    expect(report.unexplainedDifferenceCents).toBe(0);
    expect(report.coverage.required.toSorted()).toEqual(mandatory);
    expect(report.coverage.executed.toSorted()).toEqual(mandatory);
    expect(report.checks.map(check => check.id).toSorted()).toEqual(mandatory);
    expect(report.checks.every(check => check.status === 'passed' && check.cases > 0)).toBe(true);
    expect(report).toMatchObject({
      artifactHash: artifact.hash, profileHashes: [profile!.hash], manifestHash: captured.manifest.hash,
      fixtureSetId: 'truth-sync-selection-peers-v1', fixtureSetVersion: '2',
    });
    expect(report.coverage.profileHashes).toEqual([profile!.hash]);
    expect(report.coverage.sourceRefs).toEqual(['legacy-a']);
    expect(report.coverage.eventKinds.toSorted()).toEqual(['allocation', 'credit', 'invoice', 'payment', 'reversal']);
    expect(financial).toMatchObject({ reportId: report.id, reportHash: hashFinancialReport(report) });
    expect(financial.hash).toBe(hashFinancialAttestation(financial));
    expect(financial.reservation.hash).toBe(hashFinancialReservation(financial.reservation));
    expect(financial.reservation).toMatchObject({
      artifactHash: artifact.hash, requiredProfileHashes: [profile!.hash], capture: captureBinding,
      evaluatorBuildHash: report.evaluatorBuildHash,
      evidencePin: { fixtureSetId: 'truth-sync-selection-peers-v1', fixtureSetVersion: '2' },
    });
    expect(bootstrap.passed).toBe(true);
    expect(bootstrap.pin.fixtureSetId).toBe('truth-sync-selection-peers-v1');
    expect(bootstrap.pin.fixtureSetVersion).toBe(peer.sidecarVersion);
    expect(bootstrap.cases.map(item => item.id)).toEqual([...bootstrapRequiredCases]);
    expect(bootstrap.assertions.map(item => item.id)).toEqual([...bootstrapRequiredAssertions]);
    expect(bootstrap.cases.every(item => item.status === 'passed')).toBe(true);
    expect(bootstrap.assertions.every(item => item.status === 'passed')).toBe(true);
    const { scope, recordId } = expectTarget(stored.approvedTarget.records, index, captured);
    expect(bootstrap.binding).toMatchObject({
      scope, artifactHash: artifact.hash, profileHash: profile!.hash, requiredProfileHashes: [profile!.hash],
      manifestId, manifestHash: captured.manifest.hash, snapshotId: captured.snapshot.id,
      snapshotHash: captured.snapshot.contentHash, eventsHash: captureBinding.eventsHash, expectedTargetVersion: 0,
    });
    expect(bootstrap.planHash).toBe(plan.hash);
    expect(bundle.previewPlan).toEqual(plan);
    expect(plan.eventIds).toEqual([peer.eventId]);
    expect(plan.operations.filter(operation => 'identity' in operation.record)).toEqual([
      { op: 'insert_invoice', record: stored.approvedTarget.records.invoices[0] },
    ]);
    expect(request.idempotencyKey).toBe(peer.approvalKey);
    expect(request.reviewPackageId).toBe(bundle.reviewPackage.id);
    expect(receipt).toMatchObject({
      scope, planHash: plan.hash, activationId: activation.id, artifactHash: artifact.hash,
      eventIds: [peer.eventId], targetRecordIds: [recordId], beforeBalanceCents: 0, afterBalanceCents: 300000,
    });
    expect(identity).toEqual({ scope, activationId: activation.id, bundleHash: bundle.hash });
    await withTransaction(db, async client => {
      expect(await readStoredActivation(client, scope)).toEqual(stored);
      const target = await readStoredTarget(client, scope);
      expect(target).toEqual(stored.approvedTarget);
      expectTarget(target!.records, index, captured);
      expect(await readFinancialOrigins(client, scope, target!.records.invoices)).toEqual([
        { kind: 'initial', recordId, importKey: peer.approvalKey, receipt },
      ]);
    });
  }
  const [one, two] = subjects.map(({ stored }) => [
    stored.request.reviewPackageId, stored.request.idempotencyKey, stored.activation.artifactHash,
    stored.activation.profileHash, stored.bundleHash, stored.activation.id, stored.receipt.id,
  ]);
  for (const [index, value] of one!.entries()) expect(value).not.toBe(two![index]);
  expect(subjects[0].stored.bundle.bootstrapEvents).toEqual(subjects[1].stored.bundle.bootstrapEvents);
  expect(subjects[0].stored.bundle.financialAttestation.reservation.evidencePin)
    .toEqual(subjects[1].stored.bundle.financialAttestation.reservation.evidencePin);
}

async function snapshotRows(db: Pool, tables: readonly string[]) {
  return withTransaction(db, async client => {
    const result: Record<string, unknown[]> = {};
    for (const table of tables) {
      // Table names come only from the fixed snapshot lists above.
      result[table] = (await client.query('SELECT saved.* FROM ' + table + ' AS saved ORDER BY to_jsonb(saved)::text')).rows;
    }
    return result;
  });
}

function expectProgress(progress: CaptureProgressV1, manifestHash: string, captured: boolean) {
  expect(progress).toEqual({
    schemaVersion: '1', lane: { schemaVersion: '1', sourceRef: 'legacy-a', manifestHash },
    streams: [
      {
        streamId: 'a-finance', transport: 'api', baselineCursor: '2', captureCursor: captured ? '4' : '2',
        capturedRecords: captured ? 2 : 0, capturedPages: captured ? 1 : 0,
        lastCapturedAt: captured ? '2026-11-09T08:00:00.000Z' : null, lastIncident: null,
      },
      {
        streamId: 'a-semantics', transport: 'semantic', baselineCursor: '0', captureCursor: '0',
        capturedRecords: 0, capturedPages: 0, lastCapturedAt: null, lastIncident: null,
      },
    ],
  });
}

describe('same-feed fixture qualification', () => {
  let primary: Fixture | undefined;
  let protectedBefore: InventoryEntry[];
  const attempts: { roots: Roots; before: InventoryEntry[]; captured?: Captured }[] = [];
  const namespaces: string[] = [];
  let restoreObservers = () => {};

  beforeAll(async () => {
    protectedBefore = await protectedInventory();
    const capture = evidenceCapture.captureEvidenceFixture;
    const provision = nativeDb.provisionTest;
    const captureObserver = vi.spyOn(evidenceCapture, 'captureEvidenceFixture').mockImplementation(async (...args) => {
      const roots = args[1];
      const before = await inputInventory(roots);
      expect(before.map(item => item.path).sort()).toEqual(expectedFiles);
      const attempt: typeof attempts[number] = { roots, before };
      attempts.push(attempt);
      const result = await capture(...args);
      const { manifest, snapshot, events, citations } = result.input;
      attempt.captured = { manifest, snapshot, events, citations };
      return result;
    });
    const provisionObserver = vi.spyOn(nativeDb, 'provisionTest').mockImplementation(async namespace => {
      const pair = await provision(namespace);
      namespaces.push(namespace);
      return pair;
    });
    restoreObservers = () => { captureObserver.mockRestore(); provisionObserver.mockRestore(); };
    primary = await createSyncSelectionFixture();
  }, 180000);

  afterAll(async () => {
    try {
      if (primary) {
        await primary.close();
        await primary.close();
      }
    } finally {
      restoreObservers();
    }
  }, 180000);

  test('both subjects pass real producers and separate reviewer imports', async () => {
    await qualify(primary!, attempts[0]!.captured!);
    expect(await inputInventory(attempts[0]!.roots)).toEqual(attempts[0]!.before);
    console.info('Original input inventory SHA-256 ' + hashCanonical(attempts[0]!.before));
    for (const { stored } of primary!.subjects) {
      const { verificationReport, bootstrapVerification } = stored.bundle;
      console.info('Qualified peer ' + JSON.stringify({
        accountId: stored.activation.scope.accountId, manifestHash: stored.activation.manifestHash,
        artifactHash: stored.activation.artifactHash, profileHash: stored.activation.profileHash,
        reportId: verificationReport.id, reportHash: hashFinancialReport(verificationReport),
        financialAttestationHash: stored.bundle.financialAttestation.hash,
        financialChecks: verificationReport.coverage.executed.length, bootstrapResultId: bootstrapVerification.id,
        bootstrapResultHash: bootstrapVerification.hash,
        bootstrapCases: bootstrapVerification.cases.length, bootstrapAssertions: bootstrapVerification.assertions.length,
        reviewPackageId: stored.request.reviewPackageId, requestKey: stored.request.idempotencyKey,
        activationId: stored.activation.id, bundleHash: stored.bundleHash, receiptId: stored.receipt.id,
      }));
    }
  });

  test('shared capture replays without changing parent state', async () => {
    const { db, subjects: [one, two], capture } = primary!;
    const captured = attempts[0]!.captured!;
    const runtimeCapture = createRuntimeCapture({ db, clock });
    const first = await runtimeCapture.openCommitted(one.identity);
    const second = await runtimeCapture.openCommitted(two.identity);
    expectProgress(await first.readProgress(), captured.manifest.hash, false);
    expect(await second.readProgress()).toEqual(await first.readProgress());
    expect((await db.query('SELECT initial_activation_id FROM runtime_capture_lanes')).rows)
      .toEqual([{ initial_activation_id: one.identity.activationId }]);

    const page = ChangePageSchema.parse({
      sourceRef: 'legacy-a', streamId: 'a-finance', after: '2', next: '4', complete: true,
      events: [
        eventA({
          kind: 'payment', recordId: 'sync-selection-payment-one', sourceAccountId: 'sync-selection-one',
          effectiveDate: '2026-10-01', semanticVersion: 'sem-a-1', fields: { amount: '100.00' },
        }, 3, '2026-11-09T08:00:00.000Z'),
        eventA({
          kind: 'payment', recordId: 'sync-selection-payment-two', sourceAccountId: 'sync-selection-two',
          effectiveDate: '2026-10-01', semanticVersion: 'sem-a-1', fields: { amount: '100.00' },
        }, 4, '2026-11-09T08:00:00.000Z'),
      ],
    });
    const before = await snapshotRows(db, nonCaptureTables);
    expect(await capture(one.identity, page)).toEqual({ disposition: 'captured', captured: 2, cursor: '4', replayed: false });
    expect(await snapshotRows(db, nonCaptureTables)).toEqual(before);
    const afterFirst = await snapshotRows(db, captureTables);
    expect(await capture(two.identity, page)).toEqual({ disposition: 'replayed', captured: 0, cursor: '4', replayed: true });
    expect(await snapshotRows(db, captureTables)).toEqual(afterFirst);
    expect(await snapshotRows(db, nonCaptureTables)).toEqual(before);
    expectProgress(await first.readProgress(), captured.manifest.hash, true);
    expect(await second.readProgress()).toEqual(await first.readProgress());
    await withTransaction(db, async client => {
      expectTarget((await readStoredTarget(client, one.identity.scope))!.records, 0, captured);
      expectTarget((await readStoredTarget(client, two.identity.scope))!.records, 1, captured);
    });
    expect(await inputInventory(attempts[0]!.roots)).toEqual(attempts[0]!.before);
  });

  test('fresh independent construction preserves all original inputs', async () => {
    const fresh = await createSyncSelectionFixture();
    try {
      expect(attempts).toHaveLength(2);
      expect(namespaces).toHaveLength(2);
      const [first, second] = attempts;
      expect(second!.roots.visibleRoot).not.toBe(first!.roots.visibleRoot);
      expect(second!.roots.truthRoot).not.toBe(first!.roots.truthRoot);
      expect(namespaces[1]).not.toBe(namespaces[0]);
      expect(second!.before).toEqual(first!.before);
      await qualify(fresh, second!.captured!);
      expect(await inputInventory(second!.roots)).toEqual(second!.before);
      expect(await inputInventory(first!.roots)).toEqual(first!.before);
      expect(await protectedInventory()).toEqual(protectedBefore);
    } finally {
      await fresh.close();
    }
  });

  test('partial construction failure releases owned resources and preserves its error', async () => {
    const failure = new Error('Deliberate same-feed fixture failure after real review composition');
    const startingAttempt = attempts.length;
    const startingNamespace = namespaces.length;
    const poolClosures: { finish: () => Promise<void>; ended: boolean }[] = [];
    let worker: Awaited<ReturnType<typeof workerServer.launchWorker>> | undefined;
    let workerClosed = false;
    let composed = false;
    const dropped: string[] = [];
    const launch = workerServer.launchWorker;
    const createControl = controlDb.createControlDb;
    const createRuntime = runtimeDb.createRuntimeDb;
    const compose = activationComposition.composeActivationReview;
    const drop = nativeDb.dropTest;
    const restore: (() => void)[] = [];
    function observePool(pool: Pool) {
      const end = pool.end.bind(pool);
      const closure = { finish: end, ended: false };
      poolClosures.push(closure);
      const spy = vi.spyOn(pool, 'end').mockImplementation((async () => {
        await end();
        closure.ended = true;
      }) as Pool['end']);
      restore.push(() => spy.mockRestore());
      return pool;
    }
    const controlSpy = vi.spyOn(controlDb, 'createControlDb').mockImplementation(options => observePool(createControl(options)));
    const runtimeSpy = vi.spyOn(runtimeDb, 'createRuntimeDb').mockImplementation(options => observePool(createRuntime(options)));
    const workerSpy = vi.spyOn(workerServer, 'launchWorker').mockImplementation(async (...args) => {
      worker = await launch(...args);
      expect(worker.server.listening).toBe(true);
      const close = worker.close.bind(worker);
      const closeSpy = vi.spyOn(worker, 'close').mockImplementation((async () => {
        await close();
        workerClosed = true;
      }) as typeof worker.close);
      restore.push(() => closeSpy.mockRestore());
      return worker;
    });
    const composeSpy = vi.spyOn(activationComposition, 'composeActivationReview').mockImplementation(async (...args) => {
      await compose(...args);
      composed = true;
      throw failure;
    });
    const dropSpy = vi.spyOn(nativeDb, 'dropTest').mockImplementation(async namespace => {
      expect(namespaces.slice(startingNamespace)).toEqual([namespace]);
      await drop(namespace);
      dropped.push(namespace);
    });
    restore.push(
      () => controlSpy.mockRestore(), () => runtimeSpy.mockRestore(), () => workerSpy.mockRestore(),
      () => composeSpy.mockRestore(), () => dropSpy.mockRestore(),
    );

    try {
      // Close an unexpected successful return before asserting that this attempt must reject.
      await expect(createSyncSelectionFixture().then(async fixture => { await fixture.close(); })).rejects.toBe(failure);
      expect(composed).toBe(true);
      expect(attempts).toHaveLength(startingAttempt + 1);
      expect(workerClosed).toBe(true);
      expect(worker?.server.listening).toBe(false);
      expect(poolClosures.map(pool => pool.ended)).toEqual([true, true]);
      expect(namespaces).toHaveLength(startingNamespace + 1);
      expect(dropped).toEqual([namespaces[startingNamespace]]);
      const { roots } = attempts[startingAttempt]!;
      await expect(lstat(dirname(roots.visibleRoot))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await protectedInventory()).toEqual(protectedBefore);
    } finally {
      for (const undo of restore.toReversed()) undo();
      const attempt = attempts[startingAttempt];
      const ownedNamespace = namespaces[startingNamespace];
      const results = await Promise.allSettled([
        ...(worker?.server.listening ? [worker.close()] : []),
        ...poolClosures.filter(pool => !pool.ended).map(pool => pool.finish()),
      ]);
      if (ownedNamespace && !dropped.includes(ownedNamespace)) results.push(...await Promise.allSettled([drop(ownedNamespace)]));
      if (attempt) results.push(...await Promise.allSettled([rm(dirname(attempt.roots.visibleRoot), { recursive: true, force: true })]));
      expect(results.filter(result => result.status === 'rejected')).toEqual([]);
    }
  });
});

const authorityTables = [
  'runtime_authority_heads', 'runtime_authority_commands', 'activity_counter', 'activity_events',
] as const;

async function withAuthorityFixture(run: (data: SyncApplyFixture) => Promise<void>) {
  const data = await createSyncApplyFixture();
  try { await run(data); } finally { await data.close(); }
}

async function authorityCommand(data: SyncApplyFixture, action: 'pause' | 'revoke', expectedEpoch: number) {
  const api = createCurrentAuthority({
    db: data.db, clock: syncApplyClock, observe: data.source.readCurrentSemantics,
    admission: { authorize: async () => ({
      reviewer: { reviewerId: 'selection-authority-reviewer', sessionId: 'selection-authority-session' },
      allowedAccountIds: [data.identity.scope.accountId], allowedSourceRefs: [data.stored.bundle.manifest.sourceRef],
    }) },
  });
  const response = await api.command({}, {
    schemaVersion: '1', identity: data.identity, action, expectedEpoch, idempotencyKey: 'selection-authority-' + action,
  });
  expect(response).toMatchObject({ replayed: false, result: { changed: true, state: {
    status: action === 'pause' ? 'paused' : 'revoked', epoch: expectedEpoch + 1,
  } } });
  return response.result.state;
}

type ReadAuthority = () => ReturnType<typeof readAuthoritySnapshotInTransaction>;

async function inAuthoritySnapshot(data: SyncApplyFixture, run: (read: ReadAuthority) => Promise<void>) {
  const client = await data.db.connect();
  let discard = false;
  const reader = new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'query') return (sql: string, values?: unknown[]) => {
        const statement = sql.trim().replace(/\s+/g, ' ');
        expect(statement).toMatch(/^SELECT (?:\*|s\.\*|1) FROM (?:runtime_activation_imports|parent_snapshots|runtime_authority_heads|runtime_authority_commands)\b/);
        expect(statement).not.toMatch(/;|\bFOR (?:UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)\b|\bpg_advisory/i);
        return target.query(sql, values);
      };
      expect(['connect', 'release', 'end']).not.toContain(key);
      return Reflect.get(target, key, receiver);
    },
  }) satisfies PoolClient;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await run(async () => {
      const connect = vi.spyOn(data.db, 'connect');
      try {
        return await readAuthoritySnapshotInTransaction(reader, data.identity);
      } finally {
        try { expect(connect).not.toHaveBeenCalled(); } finally { connect.mockRestore(); }
      }
    });
    expect((await client.query('SHOW transaction_isolation')).rows).toEqual([{ transaction_isolation: 'repeatable read' }]);
    expect((await client.query('SHOW transaction_read_only')).rows).toEqual([{ transaction_read_only: 'on' }]);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}

test('authority_same_client retains the initial A5 snapshot across a committed pause', () => withAuthorityFixture(async data => {
  const before = await snapshotRows(data.db, authorityTables);
  expect(before.runtime_authority_heads).toEqual([]);
  expect(before.runtime_authority_commands).toEqual([]);
  let paused!: Awaited<ReturnType<typeof authorityCommand>>;
  await inAuthoritySnapshot(data, async read => {
    const initial = await read();
    const { activation, bundle } = data.stored;
    expect(initial).toEqual({ stored: data.stored, command: null, state: {
      schemaVersion: '1', identity: data.identity, sourceRef: bundle.manifest.sourceRef,
      artifactHash: activation.artifactHash, profileHash: activation.profileHash, manifestHash: activation.manifestHash,
      status: 'active', epoch: 1, changedAt: activation.approvedAt,
    } });
    expect(await snapshotRows(data.db, authorityTables)).toEqual(before);

    // The first read pins the snapshot. The service resolves only after its separate writer commits.
    paused = await authorityCommand(data, 'pause', 1);
    const afterPause = await snapshotRows(data.db, authorityTables);
    expect(await read()).toEqual(initial);
    expect(await snapshotRows(data.db, authorityTables)).toEqual(afterPause);
  });

  const beforeFresh = await snapshotRows(data.db, authorityTables);
  await inAuthoritySnapshot(data, async read => {
    expect((await read()).state).toEqual(paused);
  });
  expect(await snapshotRows(data.db, authorityTables)).toEqual(beforeFresh);
}), 90_000);

test('authority_inactive_recognition retains paused authority and sees a revoke on a fresh snapshot', () => withAuthorityFixture(async data => {
  const paused = await authorityCommand(data, 'pause', 1);
  let revoked!: Awaited<ReturnType<typeof authorityCommand>>;
  await inAuthoritySnapshot(data, async read => {
    const initial = await read();
    expect(initial.state).toEqual(paused);
    expect(initial.command).toBeNull();
    revoked = await authorityCommand(data, 'revoke', 2);
    expect(await read()).toEqual(initial);
  });
  await inAuthoritySnapshot(data, async read => {
    const current = await read();
    expect(current.state).toEqual(revoked);
    expect(current.command).toBeNull();
  });
}), 90_000);

test('authority_missing_head_with_history fails closed after a genuine pause', () => withAuthorityFixture(async data => {
  await authorityCommand(data, 'pause', 1);
  await withTransaction(data.owner, async client => {
    // Simulate head loss only in this disposable test database, while retaining the real command.
    const { rows } = await client.query<{ name: string }>(`
      SELECT quote_ident(conname) AS name FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'runtime_authority_commands'::regclass
        AND confrelid = 'runtime_authority_heads'::regclass
    `);
    expect(rows).toHaveLength(1);
    await client.query('ALTER TABLE runtime_authority_commands DROP CONSTRAINT ' + rows[0]!.name);
    await client.query('ALTER TABLE runtime_authority_heads DISABLE TRIGGER USER');
    const removed = await client.query('DELETE FROM runtime_authority_heads WHERE account_id = $1', [data.identity.scope.accountId]);
    expect(removed.rowCount).toBe(1);
    await client.query('ALTER TABLE runtime_authority_heads ENABLE TRIGGER USER');
  });
  const before = await snapshotRows(data.db, authorityTables);
  expect(before.runtime_authority_heads).toEqual([]);
  expect(before.runtime_authority_commands).toEqual([expect.objectContaining({ idempotency_key: 'selection-authority-pause' })]);
  await inAuthoritySnapshot(data, async read => {
    await expect(read().then(({ state }) => state.status)).rejects.toMatchObject({
      code: 'AUTHORITY_STORAGE_INVALID', statusCode: 503,
    });
  });
  expect(await snapshotRows(data.db, authorityTables)).toEqual(before);
}), 90_000);

const catalogTables = [
  ...authorityTables, 'runtime_activation_imports', 'parent_targets', 'parent_snapshots',
  'parent_metadata', 'parent_financial_records',
] as const;
const catalogInput = { sourceRef: 'legacy-a', asOf: '2026-11-09T08:00:00.000Z' };
const bodyFields = new Set([
  'canonical', 'request', 'reviewer', 'bundle', 'plan', 'activation', 'receipt', 'recorded_target', 'planner_target',
  'grant_canonical', 'command_canonical', 'reviewer_canonical', 'result_canonical', 'resume_canonical',
]);
type CatalogQuery = { sql: string; returned: number; fields: string[]; values: unknown[] | undefined };

async function inCatalogSnapshot(db: Pool, run: (read: (sourceRef?: string) => ReturnType<typeof readSelectionCatalog>,
  queries: CatalogQuery[]) => Promise<void>) {
  const client = await db.connect();
  const queries: CatalogQuery[] = [];
  let discard = false;
  const reader = new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'query') return async (sql: string, values?: unknown[]) => {
        const statement = sql.trim().replace(/\s+/g, ' ');
        expect(statement).toMatch(/^SELECT\b/i);
        expect(statement).not.toMatch(/;|\bFOR (?:UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)\b|\bpg_advisory/i);
        const result = values === undefined ? await target.query(sql) : await target.query(sql, values);
        queries.push({ sql: statement, returned: result.rows.length, fields: result.fields.map(({ name }) => name), values });
        return result;
      };
      expect(['connect', 'release', 'end']).not.toContain(key);
      return Reflect.get(target, key, receiver);
    },
  }) satisfies PoolClient;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const connect = vi.spyOn(db, 'connect');
    try {
      await run((sourceRef = catalogInput.sourceRef) => readSelectionCatalog(reader, { ...catalogInput, sourceRef }, {
        admission: createSelectionReadAdmission(), assertActive() {},
      }), queries);
    } finally {
      try { expect(connect).not.toHaveBeenCalled(); } finally { connect.mockRestore(); }
    }
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      discard = true;
      throw error;
    } finally {
      client.release(discard);
    }
  }
}

function expectNoCatalogBodies(queries: CatalogQuery[]) {
  expect(queries.length).toBeGreaterThan(0);
  expect(queries.flatMap(query => query.fields.filter(field => bodyFields.has(field)))).toEqual([]);
}

async function catalogByteInventory(db: Pool) {
  const { rows: [row] } = await db.query<{ imports: number; authority: number; snapshots: number; metadata: number; financial: number }>(`
    SELECT
      (SELECT COALESCE(sum(octet_length(request) + octet_length(reviewer) + octet_length(bundle) + octet_length(plan) +
        octet_length(activation) + octet_length(receipt) + octet_length(recorded_target) + octet_length(planner_target)), 0)::int
        FROM runtime_activation_imports) AS imports,
      (SELECT COALESCE(sum(octet_length(grant_canonical)), 0)::int FROM runtime_authority_heads) AS authority,
      (SELECT COALESCE(sum(octet_length(canonical)), 0)::int FROM parent_snapshots s
        WHERE EXISTS (SELECT 1 FROM runtime_activation_imports i
          WHERE i.account_id = s.account_id AND i.approved_snapshot_hash = s.snapshot_hash)
        OR EXISTS (SELECT 1 FROM parent_targets t
          WHERE t.account_id = s.account_id AND t.snapshot_hash = s.snapshot_hash)) AS snapshots,
      (SELECT COALESCE(sum(octet_length(canonical)), 0)::int FROM parent_metadata) AS metadata,
      (SELECT COALESCE(sum(octet_length(canonical)), 0)::int FROM parent_financial_records) AS financial
  `);
  return row!;
}

test('catalog_empty and exact enrollment account for only observed physical storage', () => withAuthorityFixture(async data => {
  const before = await snapshotRows(data.db, catalogTables);
  const bytes = await catalogByteInventory(data.db);
  expect((await data.db.query('SELECT recorded_target = planner_target AS same_bytes FROM runtime_activation_imports')).rows)
    .toEqual([{ same_bytes: true }]);
  await inCatalogSnapshot(data.db, async (read, queries) => {
    expect(await read('absent-source')).toEqual({
      kind: 'incomplete', reason: 'no_committed_subjects', boundedFacts: {
        counts: {}, canonicalBytes: 0, sourceContractChecksComplete: false, sourceContractObservations: [],
        causes: [{ reason: 'no_committed_subjects', identity: null, lane: null, streamId: null, event: null, family: null }],
      },
    });
    expect(queries).toHaveLength(1);
    expectNoCatalogBodies(queries);
    queries.length = 0;
    const catalog = await read();
    expect(catalog).toMatchObject({
      subjects: [{ identity: data.identity, stored: data.stored, target: data.stored.approvedTarget,
        authority: { status: 'active', epoch: 1 } }],
      boundedFacts: { counts: { import: 1, target: 2, metadata: before.parent_metadata!.length,
        financial: before.parent_financial_records!.length },
        canonicalBytes: Object.values(bytes).reduce((sum, size) => sum + size, 0), causes: [] },
    });
    if ('kind' in catalog) throw new Error('Expected admitted catalog');
    expect(catalog.boundedFacts.counts.receipt).toBeUndefined();
    expect(catalog.evidence.filter(ref => ref.family === 'target')).toHaveLength(2);
    expect(queries.filter(query => query.sql.includes('FROM parent_snapshots s WHERE')
      && query.fields.includes('canonical'))).toHaveLength(1);
    const firstBody = queries.findIndex(query => query.fields.some(field => bodyFields.has(field)));
    expect(firstBody).toBeGreaterThan(0);
    expect(queries.slice(0, firstBody).some(query => query.fields.includes('invoices'))).toBe(true);
    expect(queries.slice(firstBody).some(query => query.fields.includes('invoices'))).toBe(false);
  });
  expect(await snapshotRows(data.db, catalogTables)).toEqual(before);

  // Advance only the current pointer through the existing capture/apply path.
  const { db, identity, source, stored } = data;
  const { artifact, manifest, profiles } = stored.bundle;
  const profile = profiles.find(candidate => candidate.hash === stored.request.expectedProfileHash)!;
  const baseline = manifest.streams.find(stream => stream.streamId === 'a-finance')!.resumeAfter;
  const capture = await createRuntimeCapture({ db, clock: syncApplyClock }).openCommitted(identity);
  await data.addInvoice('selection-catalog-new-invoice', profile.sourceAccountIds[0]!);
  const page = await source.fetchChanges(manifest.sourceRef, 'a-finance', baseline);
  expect(await capture.capturePage(page)).toMatchObject({ captured: 1 });
  const plan = planBatch(artifact, profile, page.events, { ...stored.approvedTarget.records, asOf: catalogInput.asOf }).plans[0]!;
  const applier = createSyncApplier({ db, clock: syncApplyClock, identity, observe: source.readCurrentSemantics });
  await applier.applyBatch(plan, 1);
  const current = await withTransaction(db, client => readStoredTarget(client, identity.scope));
  expect(current?.records.version).toBe(stored.approvedTarget.records.version + 1);
  const advancedBytes = await catalogByteInventory(db);
  const beforeAdvanced = await snapshotRows(db, catalogTables);
  await inCatalogSnapshot(db, async (read, queries) => {
    const catalog = await read();
    expect(catalog).toMatchObject({
      subjects: [{ identity, stored, target: current }],
      boundedFacts: { counts: { import: 1, target: 3 },
        canonicalBytes: Object.values(advancedBytes).reduce((sum, size) => sum + size, 0) },
    });
    if ('kind' in catalog) throw new Error('Expected both admitted snapshot roles');
    expect(catalog.evidence.filter(ref => ref.family === 'target')).toHaveLength(3);
    expect(queries.filter(query => query.sql.includes('FROM parent_snapshots s WHERE')
      && query.fields.includes('canonical')).map(query => query.values?.[3]))
      .toEqual([stored.approvedTarget.snapshotHash, current!.snapshotHash]);
  });
  expect(await snapshotRows(db, catalogTables)).toEqual(beforeAdvanced);
}), 120_000);

test('catalog_inactive preserves paused and revoked subjects and counts their grant bytes', () => withAuthorityFixture(async data => {
  for (const [action, epoch] of [['pause', 1], ['revoke', 2]] as const) {
    const state = await authorityCommand(data, action, epoch);
    const bytes = await catalogByteInventory(data.db);
    const before = await snapshotRows(data.db, catalogTables);
    await inCatalogSnapshot(data.db, async read => {
      expect(await read()).toMatchObject({
        subjects: [{ identity: data.identity, authority: state }],
        boundedFacts: { counts: { import: 1, authority: 1, target: 2 },
          canonicalBytes: Object.values(bytes).reduce((sum, size) => sum + size, 0) },
      });
    });
    expect(await snapshotRows(data.db, catalogTables)).toEqual(before);
  }
}), 90_000);

test('catalog_ninth enrolled subject rejects on the indexed source sentinel', async () => {
  const fixture = await createSyncSelectionCatalogNineFixture();
  try {
    expect(fixture.subjects).toHaveLength(9);
    await inCatalogSnapshot(fixture.db, async (read, queries) => {
      expect(await read()).toMatchObject({ kind: 'incomplete', reason: 'limit', boundedFacts: {
        counts: { import: 9 }, canonicalBytes: 0, causes: [{ family: 'import', identity: null }],
      } });
      expect(queries).toHaveLength(1);
      expect(queries[0]).toMatchObject({ returned: 9, values: ['legacy-a'] });
      expect(queries[0]!.sql).toMatch(/capture_source_ref = \$1 ORDER BY account_id LIMIT 9$/i);
      expectNoCatalogBodies(queries);
    });
  } finally { await fixture.close(); }
}, 180_000);

test('catalog_csv rejects the genuine B enrollment as a whole cut', async () => {
  const fixture = await createSyncSelectionCatalogCsvFixture();
  try {
    await inCatalogSnapshot(fixture.db, async read => {
      expect(await read('legacy-b')).toMatchObject({ kind: 'incomplete', reason: 'unsupported_transport', boundedFacts: {
        counts: { import: 1 }, causes: [{ identity: fixture.subject.identity, family: 'import' }],
      } });
    });
  } finally { await fixture.close(); }
}, 120_000);

test('catalog_baselines retain both approved vectors when the older capture is approved later', async () => {
  const fixture = await createSyncSelectionBaselinesFixture();
  try {
    await inCatalogSnapshot(fixture.db, async (read, queries) => {
      const result = await read();
      expect(result).not.toHaveProperty('kind');
      if ('kind' in result) throw new Error('Expected both admitted baselines');
      const observed = result.subjects.map(({ identity, stored, target }) => ({
        identity, manifest: stored.bundle.manifest.id, vector: stored.activation.baselineCursors, target,
      }));
      expect(observed).toHaveLength(2);
      for (const { identity, stored } of fixture.subjects) {
        expect(observed).toContainEqual({ identity, manifest: stored.bundle.manifest.id,
          vector: stored.activation.baselineCursors, target: stored.approvedTarget });
      }
      expect(observed[0]!.manifest).not.toBe(observed[1]!.manifest);
      expect(observed[0]!.vector).not.toEqual(observed[1]!.vector);
      const firstBody = queries.findIndex(query => query.fields.some(field => bodyFields.has(field)));
      expect(firstBody).toBeGreaterThan(0);
      expect(queries.slice(0, firstBody).filter(query => query.fields.includes('invoices'))
        .map(query => query.returned)).toEqual([2, 1, 2, 1]);
      expect(queries.slice(firstBody).some(query => query.fields.includes('invoices'))).toBe(false);
    });
  } finally { await fixture.close(); }
}, 120_000);

test('catalog_bundled profile enrollment follows the exact committed request', async () => {
  const fixture = await createSyncSelectionBundledFixture();
  try {
    await inCatalogSnapshot(fixture.db, async read => {
      const result = await read();
      expect(result).not.toHaveProperty('kind');
      if ('kind' in result) throw new Error('Expected admitted selecting import');
      expect(result.subjects).toHaveLength(1);
      expect(result.subjects[0]).toMatchObject({
        identity: fixture.selected.identity,
        stored: { request: { expectedProfileHash: fixture.selected.stored.activation.profileHash } },
      });
      expect(result.subjects[0]!.stored.bundle.profiles).toContainEqual(fixture.unselected);
      expect(result.subjects[0]!.identity.scope).not.toEqual(fixture.unselected.scope);
    });
  } finally { await fixture.close(); }
}, 120_000);

test.each([
  ['recorded_snapshot_hash', "UPDATE runtime_activation_imports SET recorded_snapshot_hash = repeat('a', 64)"],
  ['request_digest', "UPDATE runtime_activation_imports SET request_digest = repeat('b', 64)"],
] as const)('catalog_forged %s fails safely after scalar admission', (_label, update) => withAuthorityFixture(async data => {
  // Owner-only corruption of one scalar in a disposable, genuinely activated database.
  await withTransaction(data.owner, async client => {
    await client.query('ALTER TABLE runtime_activation_imports DISABLE TRIGGER USER');
    expect((await client.query(update)).rowCount).toBe(1);
    await client.query('ALTER TABLE runtime_activation_imports ENABLE TRIGGER USER');
  });
  await inCatalogSnapshot(data.db, async read => {
    await expect(read()).rejects.toMatchObject({ code: 'SELECTION_STORAGE_INVALID' });
  });
}), 90_000);

async function seedCatalogMetadata(data: SyncApplyFixture, count: number, displayBytes = 0, first = 1) {
  const { accountId, companyId, sellerEntityId } = data.identity.scope;
  // Disposable corruption only. These rows deliberately have no snapshot membership.
  await data.owner.query(`
    INSERT INTO parent_metadata (account_id, company_id, seller_entity_id, family, record_id, canonical, digest)
    SELECT $1, $2, $3, 'customer', body.id, body.canonical, encode(sha256(convert_to(body.canonical, 'UTF8')), 'hex')
    FROM (
      SELECT id, jsonb_build_object('id', id, 'displayName', repeat('x', $5), 'evidenceRefs', '[]'::jsonb)::text AS canonical
      FROM (SELECT 'catalog-sentinel-' || n::text AS id FROM generate_series($6::int, $6::int + $4::int - 1) n) ids
    ) body
  `, [accountId, companyId, sellerEntityId, count, displayBytes, first]);
}

test('catalog_extra metadata rejects admitted relational rows missing from the snapshot', () => withAuthorityFixture(async data => {
  await seedCatalogMetadata(data, 1);
  await inCatalogSnapshot(data.db, async read => {
    await expect(read()).rejects.toMatchObject({ code: 'SELECTION_STORAGE_INVALID' });
  });
}), 90_000);

test('catalog_target record cap counts the combined 10,001st observed row', () => withAuthorityFixture(async data => {
  const countRows = () => data.db.query<{ metadata: number; financial: number }>(`
    SELECT (SELECT count(*) FROM parent_metadata)::int AS metadata,
      (SELECT count(*) FROM parent_financial_records)::int AS financial
  `);
  const { rows: [initial] } = await countRows();
  expect(initial!.financial).toBeGreaterThan(1);
  const exactMetadata = 10_001 - initial!.financial;
  const exactAdded = exactMetadata - initial!.metadata;

  async function expectSentinel(metadata: number, financial: number) {
    await inCatalogSnapshot(data.db, async (read, queries) => {
      expect(await read()).toMatchObject({ kind: 'incomplete', reason: 'limit', boundedFacts: {
        counts: { metadata, financial }, causes: [{ identity: data.identity, family: 'financial' }],
      } });
      expect(queries.filter(query => /FROM parent_financial_records/i.test(query.sql))).toEqual([
        expect.objectContaining({ returned: financial,
          values: [data.identity.scope.accountId, data.identity.scope.companyId, data.identity.scope.sellerEntityId, financial] }),
      ]);
      expectNoCatalogBodies(queries);
    });
  }

  await seedCatalogMetadata(data, exactAdded);
  const { rows: [exact] } = await countRows();
  expect(exact!.metadata + exact!.financial).toBe(10_001);
  await expectSentinel(exactMetadata, initial!.financial);

  // At zero remaining capacity the SQL must still look for one financial row.
  await seedCatalogMetadata(data, 10_000 - exactMetadata, 0, exactAdded + 1);
  const { rows: [more] } = await countRows();
  expect(more).toEqual({ metadata: 10_000, financial: initial!.financial });
  await expectSentinel(10_000, 1);
}), 120_000);

test('catalog_per-value byte overflow rejects an actual 1,048,577-byte import column before canonical reads',
  () => withAuthorityFixture(async data => {
    await withTransaction(data.owner, async client => {
      await client.query('ALTER TABLE runtime_activation_imports DISABLE TRIGGER USER');
      const { rows } = await client.query(`
        UPDATE runtime_activation_imports SET activation = activation || repeat(' ', 1048577 - octet_length(activation))
        RETURNING octet_length(activation) AS bytes
      `);
      expect(rows).toEqual([{ bytes: 1_048_577 }]);
      await client.query('ALTER TABLE runtime_activation_imports ENABLE TRIGGER USER');
    });
    await inCatalogSnapshot(data.db, async (read, queries) => {
      expect(await read()).toMatchObject({ kind: 'incomplete', reason: 'limit', boundedFacts: {
        counts: { import: 1 }, canonicalBytes: 0, causes: [{ identity: data.identity, family: 'import' }],
      } });
      expectNoCatalogBodies(queries);
    });
  }), 90_000);

test('catalog_aggregate byte overflow stops at the first value that would cross 16 MiB', () => withAuthorityFixture(async data => {
  const before = await catalogByteInventory(data.db);
  await seedCatalogMetadata(data, 18, 999_000);
  const { rows } = await data.db.query<{ bytes: number }>('SELECT octet_length(canonical) AS bytes FROM parent_metadata ORDER BY family, record_id');
  expect(rows.every(row => row.bytes <= 1_048_576)).toBe(true);
  let admitted = before.imports + before.snapshots;
  const excess = rows.find(({ bytes }) => {
    if (admitted + bytes > 16_777_216) return true;
    admitted += bytes;
    return false;
  });
  expect(excess).toBeDefined();
  await inCatalogSnapshot(data.db, async (read, queries) => {
    expect(await read()).toMatchObject({ kind: 'incomplete', reason: 'limit', boundedFacts: {
      counts: { import: 1, target: 2, metadata: rows.length }, canonicalBytes: admitted,
      causes: [{ identity: data.identity, family: 'metadata' }],
    } });
    expect(queries.some(query => /FROM parent_financial_records/i.test(query.sql))).toBe(false);
    expectNoCatalogBodies(queries);
  });
}), 120_000);

test.each([10_000, 10_001])('catalog_embedded %i records are structurally checked before any body fetch', count =>
  withAuthorityFixture(async data => {
    await withTransaction(data.owner, async client => {
      await client.query('ALTER TABLE runtime_activation_imports DISABLE TRIGGER USER');
      // Only the embedded target changes. Its original hash stays pinned.
      const { rows } = await client.query(`
        UPDATE runtime_activation_imports SET recorded_target = jsonb_set(
          jsonb_set(recorded_target::jsonb, '{customers}',
            (SELECT jsonb_agg(jsonb_build_object('id', 'c' || n, 'displayName', '', 'evidenceRefs', '[]'::jsonb))
              FROM generate_series(1, $1::int - 1) n)), '{accounts}',
          jsonb_build_array(jsonb_build_object('id', account_id, 'scope', recorded_target::jsonb->'scope',
            'parentCustomerId', 'c1', 'sourceRef', 'legacy-a', 'sourceAccountIds', '[]'::jsonb)))::text
        RETURNING octet_length(recorded_target) AS bytes,
          jsonb_array_length(recorded_target::jsonb->'customers') + jsonb_array_length(recorded_target::jsonb->'accounts') AS count
      `, [count]);
      expect(rows).toEqual([{ bytes: expect.any(Number), count }]);
      expect(rows[0]!.bytes).toBeLessThan(1_048_576);
      await client.query('ALTER TABLE runtime_activation_imports ENABLE TRIGGER USER');
    });
    const before = await catalogByteInventory(data.db);
    await inCatalogSnapshot(data.db, async (read, queries) => {
      if (count === 10_000) {
        await expect(read()).rejects.toMatchObject({ code: 'SELECTION_STORAGE_INVALID' });
        expect(queries.some(query => query.fields.includes('recorded_target'))).toBe(true);
      } else {
        expect(await read()).toMatchObject({ kind: 'incomplete', reason: 'limit', boundedFacts: {
          counts: { import: 1, target: 2 }, canonicalBytes: Object.values(before).reduce((sum, size) => sum + size, 0),
          causes: [{ identity: data.identity, family: 'import' }],
        } });
        expectNoCatalogBodies(queries);
      }
      expect(queries.some(query => query.fields.includes('invoices'))).toBe(true);
    });
  }), 120_000);
