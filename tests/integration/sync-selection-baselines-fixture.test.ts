import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ChangePageSchema, VerificationCheckIdSchema, bootstrapRequiredAssertions, bootstrapRequiredCases,
  canonicalJson, hashBootstrapVerificationResult, hashBytes, hashCanonical, hashFinancialAttestation, hashFinancialReport, hashFinancialReservation, hashPlan, hashProfile, hashTargetSnapshot,
  targetRecordId, type RawSourceEvent, type CaptureProgressV1, type TargetState,
} from '@eapr/contracts';
import { parseMinorUnits } from '@eapr/compiler/operations';
import { computeBalance } from '@eapr/finance/balance';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import * as controlDb from '@eapr/storage/control-db';
import * as runtimeDb from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as activationComposition from '../../apps/control/src/activation-composition.js';
import * as workerServer from '../../apps/worker/src/server.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import * as nativeDb from '../../scripts/native-db.js';
import * as evidenceCapture from '../fixtures/evidence-v2-capture.js';
import { createSyncSelectionBaselinesFixture } from '../fixtures/sync-selection-baselines.js';
import {
  inventory, measureBootstrapOuter, measureFinancialOuter, originalsAt, resolveEvidenceDirectory, statIfPresent,
  writePrivateEvidence, type InventoryEntry, type Measurement,
} from '../fixtures/sync-selection-evidence.js';

import * as bootstrapRunner from '../../packages/evaluator/src/bootstrap-runner.js';
import * as financialRunner from '../../packages/evaluator/src/financial-attestation-runner.js';

type Fixture = Awaited<ReturnType<typeof createSyncSelectionBaselinesFixture>>;
type EvidenceInput = Awaited<ReturnType<typeof evidenceCapture.captureEvidenceFixture>>['input'];
type Captured = Pick<EvidenceInput, 'manifest' | 'snapshot' | 'events' | 'citations' | 'originals'>;
type Roots = Parameters<typeof evidenceCapture.captureEvidenceFixture>[1];

const root = fileURLToPath(new URL('../../', import.meta.url));
const clock = () => new Date('2026-11-09T08:00:00.000Z');
const mandatory = [...VerificationCheckIdSchema.options].sort();
const expectedPeers = [
  {
    accountId: 'company-a.seller-a.sync-base-old', sourceAccountId: 'sync-base-old',
    buyerId: 'sync-base-buyer-old', legalName: 'Baseline Old', contractId: 'sync-base-contract-old',
    documentId: 'doc-sync-base-old', invoiceId: 'sync-base-invoice-old', eventId: 'evt:sync-base-invoice-old',
    profileId: 'sync-base-profile-old', approvalKey: 'sync-base-approve-old',
    sidecarVersion: 'bootstrap-baselines-old-v1', manifestId: 'manifest-sync-baselines-old-v1',
    fixtureId: 'truth-sync-baselines-old-v1', asOf: '2026-10-01T00:00:00.000Z', cursor: '2', epoch: 1,
  },
  {
    accountId: 'company-a.seller-a.sync-base-new', sourceAccountId: 'sync-base-new',
    buyerId: 'sync-base-buyer-new', legalName: 'Baseline New', contractId: 'sync-base-contract-new',
    documentId: 'doc-sync-base-new', invoiceId: 'sync-base-invoice-new', eventId: 'evt:sync-base-invoice-new',
    profileId: 'sync-base-profile-new', approvalKey: 'sync-base-approve-new',
    sidecarVersion: 'bootstrap-baselines-new-v1', manifestId: 'manifest-sync-baselines-new-v1',
    fixtureId: 'truth-sync-baselines-new-v1', asOf: '2026-10-02T00:00:00.000Z', cursor: '3', epoch: 2,
  },
] as const;
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
    scope, version: 1, asOf: peer.asOf,
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
  expect(computeBalance(records, peer.asOf)).toBe(300000);
  return { scope, recordId };
}

async function qualify({ db, subjects }: Fixture, captures: readonly Captured[]) {
  expect(captures).toHaveLength(2);
  const [oldCapture, newCapture] = captures as [Captured, Captured];
  const prefix = oldCapture.events.toSorted((a, b) => a.sequence - b.sequence);
  const newer = newCapture.events.toSorted((a, b) => a.sequence - b.sequence);
  const invoiceIds = expectedPeers.map(peer => peer.eventId);
  expect(prefix.map(event => event.id)).toEqual(invoiceIds);
  expect(newer.map(event => event.id)).toEqual([...invoiceIds, 'evt:sync-base-window-pay']);
  expect(newer.slice(0, 2).map(canonicalJson)).toEqual(prefix.map(canonicalJson));
  expect(prefix.map(event => event.observedAt)).toEqual(['2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
  for (const original of oldCapture.originals) {
    const retained = newCapture.originals.find(candidate => candidate.sourceId === original.sourceId);
    expect(retained?.sha256).toBe(original.sha256);
    expect(hashBytes(Buffer.from(retained!.bytesBase64, 'base64'))).toBe(original.sha256);
    expect(hashBytes(Buffer.from(original.bytesBase64, 'base64'))).toBe(original.sha256);
  }
  expect(oldCapture.originals.map(item => item.binding.kind).toSorted()).toEqual(['api-json', 'api-json', 'document', 'document']);
  expect(newCapture.originals.map(item => item.binding.kind).toSorted()).toEqual(['api-json', 'api-json', 'api-json', 'document', 'document']);
  const window = newer[2]!;
  const raw = { account: 'sync-base-old', amount: '100.00', effective_date: '2026-10-01', id: 'sync-base-window-pay', version: 1 };
  expect(window).toEqual(eventA({
    kind: 'payment', sourceAccountId: 'sync-base-old', recordId: 'sync-base-window-pay',
    effectiveDate: '2026-10-01', fields: raw,
  }, 3, '2026-10-02T00:00:00.000Z'));
  const windowOriginal = newCapture.originals.find(item => item.binding.kind === 'api-json' && item.binding.eventId === window.id);
  expect(windowOriginal?.sha256).toBe(hashBytes(Buffer.from(canonicalJson(raw))));
  expect(hashBytes(Buffer.from(windowOriginal!.bytesBase64, 'base64'))).toBe(windowOriginal?.sha256);
  expect(parseMinorUnits(raw.amount)).toEqual({ ok: true, cents: 10000 });

  for (const index of [0, 1] as const) {
    const captured = index === 0 ? oldCapture : newCapture;
    const { manifestId, fixtureId, asOf, epoch, cursor } = expectedPeers[index];
    const capturedEvents = captured.events.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const captureBinding = {
      sourceRef: 'legacy-a', companyId: 'company-a', manifestId, manifestHash: captured.manifest.hash,
      snapshotId: 'snapshot:' + manifestId, snapshotHash: captured.snapshot.contentHash,
      snapshotObjectHash: hashCanonical(captured.snapshot), eventsHash: hashCanonical(capturedEvents),
    };
    expect(captured.manifest).toMatchObject({ id: manifestId, asOf, epoch });
    expect(captured.snapshot.id).toBe('snapshot:' + manifestId);
    expect(captured.manifest.streams).toMatchObject([
      { streamId: 'a-finance', resumeAfter: cursor, snapshotId: 'member:' + manifestId + ':a-finance',
        eventIds: index === 0 ? invoiceIds : [...invoiceIds, window.id] },
      { streamId: 'a-semantics', resumeAfter: '0', snapshotId: 'member:' + manifestId + ':a-semantics', eventIds: [] },
    ]);
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
      fixtureSetId: fixtureId, fixtureSetVersion: '2',
    });
    expect(report.coverage.profileHashes).toEqual([profile!.hash]);
    expect(report.coverage.sourceRefs).toEqual(['legacy-a']);
    expect(report.coverage.eventKinds.toSorted()).toEqual(['allocation', 'credit', 'invoice', 'payment', 'reversal']);
    expect(financial).toMatchObject({ reportId: report.id, reportHash: hashFinancialReport(report) });
    expect(financial.hash).toBe(hashFinancialAttestation(financial));
    expect(financial.reservation.hash).toBe(hashFinancialReservation(financial.reservation));
    expect(financial.reservation).toMatchObject({
      artifactHash: artifact.hash, requiredProfileHashes: [profile!.hash], capture: captureBinding,
      schemaVersion: '1', issuerId: 'eapr-control-registry-1', runnerId: 'eapr-financial-1',
      protocolVersion: '1', harnessVersion: '1', purpose: 'construction', evaluatorBuildHash: report.evaluatorBuildHash,
      evidencePin: { fixtureSetId: fixtureId, fixtureSetVersion: '2' },
    });
    expect(report.id).toBe('report:' + financial.reservation.jobId);
    expect(bootstrap.passed).toBe(true);
    expect(bootstrap.pin.fixtureSetId).toBe(fixtureId);
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
      targetSnapshotHash: hashTargetSnapshot(stored.plannerTarget), asOf,
    });
    expect(bootstrap.planHash).toBe(plan.hash);
    expect(bootstrap.hash).toBe(hashBootstrapVerificationResult(bootstrap));
    expect(plan.hash).toBe(hashPlan(plan));
    expect(bundle.previewPlan).toEqual(plan);
    expect(plan.eventIds).toEqual([peer.eventId]);
    expect(plan.operations.filter(operation => 'identity' in operation.record)).toEqual([
      { op: 'insert_invoice', record: stored.approvedTarget.records.invoices[0] },
    ]);
    expect(stored.reviewer.reviewerId).toBe('sync-selection-reviewer');
    expect(hashCanonical(stored.reviewer)).toBe(hashCanonical(bundle.reviewer));
    expect(activation.reviewerId).toBe(stored.reviewer.reviewerId);
    expect(activation.baselineCursors).toEqual([
      { streamId: 'a-finance', resumeAfter: cursor }, { streamId: 'a-semantics', resumeAfter: '0' },
    ]);
    expect(request.idempotencyKey).toBe(peer.approvalKey);
    expect(request.reviewPackageId).toBe(bundle.reviewPackage.id);
    expect(receipt).toMatchObject({
      scope, planHash: plan.hash, activationId: activation.id, artifactHash: artifact.hash,
      eventIds: [peer.eventId], targetRecordIds: [recordId], beforeBalanceCents: 0, afterBalanceCents: 300000,
      epoch: 1, status: 'applied', committedAt: '2026-11-09T08:00:00.000Z',
    });
    expect(identity).toEqual({ scope, activationId: activation.id, bundleHash: bundle.hash });
    await withTransaction(db, async client => {
      expect(hashCanonical(await readStoredActivation(client, scope))).toBe(hashCanonical(stored));
      const target = await readStoredTarget(client, scope);
      expect(target).toEqual(stored.approvedTarget);
      expectTarget(target!.records, index, captured);
      expect(await readFinancialOrigins(client, scope, target!.records.invoices)).toEqual([
        { kind: 'initial', recordId, importKey: peer.approvalKey, receipt },
      ]);
    });
  }
  const [one, two] = subjects.map(({ stored }) => [
    stored.requestHash, stored.request.reviewPackageId, stored.request.idempotencyKey, stored.activation.artifactHash,
    stored.activation.profileHash, stored.bundleHash, stored.activation.id, stored.receipt.id,
  ]);
  for (const [index, value] of one!.entries()) expect(value).not.toBe(two![index]);
  expect(subjects[0].stored.bundle.manifest.hash).not.toBe(subjects[1].stored.bundle.manifest.hash);
  expect(subjects[0].stored.bundle.financialAttestation.reservation.evidencePin.bundleHash)
    .not.toBe(subjects[1].stored.bundle.financialAttestation.reservation.evidencePin.bundleHash);
  expect((await db.query('SELECT count(*)::int AS count FROM runtime_financial_origins')).rows)
    .toEqual([{ count: 2 }]);
}

async function snapshotRows(db: Pool, tables: readonly string[]) {
  return withTransaction(db, async client => {
    const result: Record<string, string> = {};
    for (const table of tables) {
      // Table names come only from the fixed snapshot lists above.
      result[table] = hashCanonical((await client.query('SELECT saved.* FROM ' + table + ' AS saved ORDER BY to_jsonb(saved)::text')).rows);
    }
    return result;
  });
}

function expectProgress(progress: CaptureProgressV1, manifestHash: string, baseline: string, captured: boolean) {
  expect(progress).toEqual({
    schemaVersion: '1', lane: { schemaVersion: '1', sourceRef: 'legacy-a', manifestHash },
    streams: [
      {
        streamId: 'a-finance', transport: 'api', baselineCursor: baseline, captureCursor: captured ? '5' : baseline,
        capturedRecords: captured ? 5 - Number(baseline) : 0, capturedPages: captured ? 1 : 0,
        lastCapturedAt: captured ? '2026-11-09T08:00:00.000Z' : null, lastIncident: null,
      },
      {
        streamId: 'a-semantics', transport: 'semantic', baselineCursor: '0', captureCursor: '0',
        capturedRecords: 0, capturedPages: 0, lastCapturedAt: null, lastIncident: null,
      },
    ],
  });
}

const sourcePaths = [
  'tests/fixtures', 'tests/integration/sync-selection.test.ts', 'tests/integration/sync-selection-bundled-fixture.test.ts',
  'tests/integration/sync-capture.test.ts', 'scripts/generate-fixtures.ts', 'packages/sources/src', 'packages/evaluator/src',
  'db/control', 'db/runtime', 'package-lock.json', '.local/protected-evaluator', '.local/protected-bootstrap',
  '.local/activation-policy', '.local/artifacts',
];

const unchangedSources = async () => (await Promise.all(sourcePaths.map(path => inventory(join(root, path), path))))
  .flat().filter(item => item.path !== 'tests/fixtures/sync-selection-baselines.ts');

type AttemptName = 'primary' | 'fresh' | 'failure';
type Worker = Awaited<ReturnType<typeof workerServer.launchWorker>>;
type PoolHandle = { pool: Pool; role: 'control' | 'runtime'; ended: boolean };
type Attempt = {
  name: AttemptName; namespace?: string; root?: string; dropped: boolean; worker?: Worker;
  databaseNames?: Record<PoolHandle['role'], string>; workerPort?: number;
  workerWasListening: boolean; workerClosed: boolean; composed: boolean;
  pools: PoolHandle[]; captures: Captured[]; measurements: Measurement[];
  before?: InventoryEntry[]; elapsedMs?: number;
};
const attemptFor = (name: AttemptName): Attempt => ({
  name, dropped: false, workerWasListening: false, workerClosed: false, composed: false,
  pools: [], captures: [], measurements: [],
});

function proofBindings({ subjects }: Fixture) {
  return subjects.map(({ stored }) => {
    const { activation, receipt, requestHash, bundle, plan } = stored;
    const { verificationReport: report, financialAttestation: attestation, bootstrapVerification: bootstrap } = bundle;
    return {
      manifestId: bundle.manifest.id, manifestHash: bundle.manifest.hash, snapshotId: bundle.snapshot.id,
      snapshotHash: bundle.snapshot.contentHash, artifactHash: bundle.artifact.hash, profileHash: activation.profileHash,
      financial: {
        jobId: attestation.reservation.jobId, reportId: report.id, reportHash: attestation.reportHash,
        reservationHash: attestation.reservation.hash, attestationHash: attestation.hash, buildHash: report.evaluatorBuildHash,
        pin: attestation.reservation.evidencePin, capture: attestation.reservation.capture,
        checks: report.checks.map(({ id, status, cases }) => ({ id, status, cases })), coverage: report.coverage,
        eligible: report.eligible, unexplainedDifferenceCents: report.unexplainedDifferenceCents,
      },
      bootstrap: {
        jobId: bootstrap.jobId, id: bootstrap.id, hash: bootstrap.hash, planHash: bootstrap.planHash, pin: bootstrap.pin,
        binding: bootstrap.binding, passed: bootstrap.passed, cases: bootstrap.cases, assertions: bootstrap.assertions,
      },
      reviewerId: stored.reviewer.reviewerId, reviewerContextHash: hashCanonical(stored.reviewer),
      requestHash, reviewPackageId: bundle.reviewPackage.id, idempotencyKey: stored.request.idempotencyKey,
      bundleHash: bundle.hash, activationId: activation.id, receiptId: receipt.id, planHash: plan.hash,
      receiptStatus: receipt.status, receiptEventIds: receipt.eventIds, receiptTargetRecordIds: receipt.targetRecordIds,
    };
  });
}

describe('distinct-baseline fixture qualification', () => {
  const primaryAttempt = attemptFor('primary');
  const freshAttempt = attemptFor('fresh');
  const failedAttempt = attemptFor('failure');
  let active = primaryAttempt;
  let primary: Fixture | undefined;
  let sourceBefore: InventoryEntry[];
  let evidenceDir: string;
  const restore: (() => void)[] = [];
  const sentinel = new Error('Intentional post-composition construction failure');
  const save = (attempt: Attempt, phase: string, data: unknown) =>
    writePrivateEvidence(join(evidenceDir, attempt.name + '-' + phase + '.json'), data);

  async function saveOriginals(attempt: Attempt, phase: string) {
    const entries = await originalsAt(attempt.root!);
    expect(entries).toEqual(attempt.before);
    await save(attempt, phase, entries);
  }

  function observePool(pool: Pool, role: PoolHandle['role']) {
    const handle = { pool, role, ended: false };
    active.pools.push(handle);
    const end = pool.end.bind(pool);
    const spy = vi.spyOn(pool, 'end').mockImplementation((async () => {
      await end();
      handle.ended = true;
    }) as Pool['end']);
    restore.push(() => spy.mockRestore());
    return pool;
  }

  async function cleanupEvidence(attempt: Attempt) {
    const rootAbsent = !!attempt.root && !await statIfPresent(attempt.root);
    const evidence = {
      rootId: attempt.root && basename(attempt.root), rootAbsent, namespace: attempt.namespace,
      dropped: attempt.dropped, workerPort: attempt.workerPort,
      workerWasListening: attempt.workerWasListening, workerClosed: attempt.workerClosed,
      workerStillListening: attempt.worker?.server.listening ?? false, composed: attempt.composed,
      pools: attempt.pools.map(({ role, ended }) => ({ role, database: attempt.databaseNames?.[role], ended })),
    };
    await save(attempt, 'cleanup', evidence);
    expect(rootAbsent).toBe(true);
    expect(attempt.dropped).toBe(true);
    expect(attempt.workerWasListening).toBe(true);
    expect(attempt.workerClosed).toBe(true);
    expect(evidence.workerStillListening).toBe(false);
    expect(attempt.pools.map(({ role, ended }) => ({ role, ended })))
      .toEqual([{ role: 'control', ended: true }, { role: 'runtime', ended: true }]);
  }

  const drop = nativeDb.dropTest;
  async function fallback(attempt: Attempt) {
    const outcomes = await Promise.allSettled([
      ...(attempt.worker?.server.listening ? [attempt.worker.close()] : []),
      ...attempt.pools.filter(pool => !pool.ended).map(({ pool }) => pool.end()),
    ]);
    if (attempt.namespace && !attempt.dropped) outcomes.push(...await Promise.allSettled([drop(attempt.namespace)]));
    if (attempt.root) outcomes.push(...await Promise.allSettled([rm(attempt.root, { recursive: true, force: true })]));
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new Error('Fixture fallback cleanup failed');
  }

  async function construct(attempt: Attempt) {
    active = attempt;
    const start = performance.now();
    try { return await createSyncSelectionBaselinesFixture(); }
    finally { attempt.elapsedMs = performance.now() - start; }
  }

  async function saveProof(attempt: Attempt, fixture: Fixture) {
    const bindings = proofBindings(fixture);
    for (const binding of bindings) {
      const measured = attempt.measurements.filter(item => item.manifestHash === binding.manifestHash);
      expect(measured.map(item => item.stage)).toEqual(['financial-probe', 'financial-launch', 'bootstrap']);
      expect(measured.map(item => item.jobId)).toEqual([binding.financial.jobId, binding.financial.jobId, binding.bootstrap.jobId]);
      for (const item of measured) {
        expect(item.status).toBe('ok');
        expect(item.framedRequestBytes).toBe(item.requestJsonBytes + 1);
        expect(item.framedRequestBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
        expect(item.framedContextBytes).toBeGreaterThan(1);
        expect(item.framedContextBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
        expect(item.returnedResponseObjectJsonBytes).toBeGreaterThan(0);
        expect(item.elapsedMs).toBeGreaterThan(0);
      }
      expect(measured[0]!.evidencePinBytes).toBeGreaterThan(0);
      expect(measured[0]!.evidencePinBytes).toBe(measured[1]!.evidencePinBytes);
      expect(measured[2]!.sidecarBytes).toBeGreaterThan(0);
    }
    expect(attempt.measurements).toHaveLength(6);
    await save(attempt, 'proof', { bindings, outer: attempt.measurements, constructionElapsedMs: attempt.elapsedMs,
      returnedResponseObject: 'UTF-8 JSON serialization of parsed value without LF',
      outerRequest: 'schema-normalized UTF-8 JSON with one LF on stdin; context UTF-8 JSON with one LF on fd 3',
      rawResponseWireBytes: 'unobserved', individualNestedBytesAndElapsedMs: 'unobserved',
      nestedCompliance: 'unchanged runner cap of 10485760 bytes and 5000 ms deadline, with complete same-run passing reports' });
  }

  beforeAll(async () => {
    evidenceDir = await resolveEvidenceDirectory(root, 2);
    sourceBefore = await unchangedSources();
    const capture = evidenceCapture.captureEvidenceFixture;
    const provision = nativeDb.provisionTest;
    const createControl = controlDb.createControlDb;
    const createRuntime = runtimeDb.createRuntimeDb;
    const launchWorker = workerServer.launchWorker;
    const compose = activationComposition.composeActivationReview;
    const runFinancial = financialRunner.runFinancialEvaluator;
    const runBootstrap = bootstrapRunner.runBootstrapEvaluator;

    const captureSpy = vi.spyOn(evidenceCapture, 'captureEvidenceFixture').mockImplementation(async (...args) => {
      const attempt = active;
      const { visibleRoot, truthRoot } = args[1];
      const label = attempt.captures.length === 0 ? 'old' : 'new';
      const constructionRoot = dirname(dirname(visibleRoot));
      expect(visibleRoot).toBe(join(constructionRoot, 'visible', label));
      expect(truthRoot).toBe(join(constructionRoot, 'truth', label));
      if (label === 'old') {
        attempt.root = constructionRoot;
        attempt.before = await originalsAt(constructionRoot);
        expect(attempt.before).toHaveLength(21);
        expect(attempt.before.every(item => 'sha256' in item)).toBe(true);
        await save(attempt, 'before-publication', attempt.before);
      } else {
        expect(constructionRoot).toBe(attempt.root);
      }
      const expectedIds = ['evt:sync-base-invoice-old', 'evt:sync-base-invoice-new'];
      if (label === 'new') expectedIds.push('evt:sync-base-window-pay');
      const expectedFiles = [
        ...['api-a.json', 'api-originals-a.json', 'manifest-a.json', 'uploads-a.json', 'contract-1.pdf', 'contract-2.pdf']
          .map(path => 'visible/' + label + '/' + path),
        ...expectedIds.map(id => 'visible/' + label + '/api-a/' + hashCanonical(id) + '.json'),
        'truth/' + label + '/expected-a.json', 'truth/' + label + '/evidence-a.json',
      ].sort();
      const captureInput = [
        ...await inventory(visibleRoot, 'visible/' + label), ...await inventory(truthRoot, 'truth/' + label),
      ].sort((a, b) => a.path.localeCompare(b.path));
      expect(captureInput.map(item => item.path).sort()).toEqual(expectedFiles);
      expect(captureInput).toEqual(attempt.before!.filter(item => item.path.split('/')[1] === label));
      const { rows: [water] } = await args[0].db.query<{ high_water: number; epochs: number; registrations: number }>(`
        SELECT (SELECT COALESCE(max(sequence), 0)::int FROM source_events WHERE source_ref = 'legacy-a') AS high_water,
               (SELECT count(*)::int FROM source_manifests WHERE source_ref = 'legacy-a') AS epochs,
               (SELECT count(*)::int FROM artifact_captures) AS registrations`);
      expect(water).toEqual(label === 'old'
        ? { high_water: 0, epochs: 0, registrations: 0 }
        : { high_water: 2, epochs: 1, registrations: 1 });
      await save(attempt, 'capture-input-' + label, { entries: captureInput, publicationStateBefore: water });
      const result = await capture(...args);
      const { manifest, snapshot, events, citations, originals } = result.input;
      attempt.captures.push({ manifest, snapshot, events, citations, originals });
      return result;
    });
    restore.push(() => captureSpy.mockRestore());

    const provisionSpy = vi.spyOn(nativeDb, 'provisionTest').mockImplementation(async namespace => {
      expect(active.namespace).toBeUndefined();
      const pair = await provision(namespace);
      active.namespace = namespace;
      active.databaseNames = { control: pair.control.name, runtime: pair.runtime.name };
      return pair;
    });
    restore.push(() => provisionSpy.mockRestore());
    const dropSpy = vi.spyOn(nativeDb, 'dropTest').mockImplementation(async namespace => {
      const owner = [primaryAttempt, freshAttempt, failedAttempt].find(attempt => attempt.namespace === namespace);
      if (!owner || owner.dropped) throw new Error('Unexpected fixture namespace drop');
      await drop(namespace);
      owner.dropped = true;
    });
    restore.push(() => dropSpy.mockRestore());
    const controlSpy = vi.spyOn(controlDb, 'createControlDb').mockImplementation(options => observePool(createControl(options), 'control'));
    restore.push(() => controlSpy.mockRestore());
    const runtimeSpy = vi.spyOn(runtimeDb, 'createRuntimeDb').mockImplementation(options => observePool(createRuntime(options), 'runtime'));
    restore.push(() => runtimeSpy.mockRestore());

    const workerSpy = vi.spyOn(workerServer, 'launchWorker').mockImplementation(async (...args) => {
      const attempt = active;
      const worker = await launchWorker(...args);
      attempt.worker = worker;
      attempt.workerWasListening = worker.server.listening;
      const address = worker.server.address();
      if (address && typeof address !== 'string') attempt.workerPort = address.port;
      const close = worker.close.bind(worker);
      const closeSpy = vi.spyOn(worker, 'close').mockImplementation((async () => {
        await close();
        attempt.workerClosed = true;
      }) as Worker['close']);
      restore.push(() => closeSpy.mockRestore());
      return worker;
    });
    restore.push(() => workerSpy.mockRestore());
    const composeSpy = vi.spyOn(activationComposition, 'composeActivationReview').mockImplementation(async (...args) => {
      const result = await compose(...args);
      active.composed = true;
      if (active === failedAttempt) throw sentinel;
      return result;
    });
    restore.push(() => composeSpy.mockRestore());

    const financialSpy = vi.spyOn(financialRunner, 'runFinancialEvaluator').mockImplementation(async (request, context) => {
      const attempt = active;
      const { result, measurement } = await measureFinancialOuter(runFinancial, request, context);
      attempt.measurements.push(measurement);
      return result;
    });
    restore.push(() => financialSpy.mockRestore());

    const bootstrapSpy = vi.spyOn(bootstrapRunner, 'runBootstrapEvaluator').mockImplementation(async (request, context) => {
      const attempt = active;
      const { result, measurement } = await measureBootstrapOuter(runBootstrap, request, context);
      attempt.measurements.push(measurement);
      return result;
    });
    restore.push(() => bootstrapSpy.mockRestore());
    primary = await construct(primaryAttempt);
  });

  afterAll(async () => {
    try {
      if (primary) {
        await primary.close();
        await primary.close();
        await cleanupEvidence(primaryAttempt);
      }
    } finally {
      try { await fallback(primaryAttempt); }
      finally { for (const undo of restore.toReversed()) undo(); }
    }
  });

  test('real distinct proofs and first imports', async () => {
    await qualify(primary!, primaryAttempt.captures);
    await verifyInitialLanes(primary!);
    await saveOriginals(primaryAttempt, 'after-proof');
    await saveProof(primaryAttempt, primary!);
  });

  test('independent complete lane intervals', async () => {
    const { db, capture, subjects: [old, newer] } = primary!;
    const runtimeCapture = createRuntimeCapture({ db, clock });
    const [oldLane, newLane] = await Promise.all([runtimeCapture.openCommitted(old.identity), runtimeCapture.openCommitted(newer.identity)]);
    const events = ([
      { account: 'sync-base-old', id: 'sync-base-later-old', amount: '200.00', cents: 20000, sequence: 4 },
      { account: 'sync-base-new', id: 'sync-base-later-new', amount: '100.00', cents: 10000, sequence: 5 },
    ] as const).map(({ account, id, amount, cents, sequence }) => {
      expect(parseMinorUnits(amount)).toEqual({ ok: true, cents });
      return eventA({
        kind: 'payment', recordId: id, sourceAccountId: account, effectiveDate: '2026-10-02', fields: { amount },
      }, sequence, '2026-10-03T00:00:00.000Z');
    });
    const window = newer.stored.bundle.bootstrapEvents.find(item => item.id === 'evt:sync-base-window-pay')!;
    expect(window.sequence).toBe(3);
    const newPage = ChangePageSchema.parse({ sourceRef: 'legacy-a', streamId: 'a-finance', after: '3', next: '5', complete: true, events });
    const oldPage = ChangePageSchema.parse({
      sourceRef: 'legacy-a', streamId: 'a-finance', after: '2', next: '5', complete: true, events: [window, ...events],
    });
    const before = await snapshotRows(db, nonCaptureTables);
    expect(await capture(newer.identity, newPage)).toEqual({ disposition: 'captured', captured: 2, cursor: '5', replayed: false });
    expect(await capture(old.identity, oldPage)).toEqual({ disposition: 'captured', captured: 3, cursor: '5', replayed: false });
    const pages = [[oldLane.lane.manifestHash, oldPage], [newLane.lane.manifestHash, newPage]] as const;
    await verifyRetainedCapture(db, pages, [...old.stored.bundle.bootstrapEvents, window, ...events]);
    expectProgress(await oldLane.readProgress(), oldLane.lane.manifestHash, '2', true);
    expectProgress(await newLane.readProgress(), newLane.lane.manifestHash, '3', true);
    expect(await snapshotRows(db, nonCaptureTables)).toEqual(before);
    await saveOriginals(primaryAttempt, 'after-capture');
    const afterCapture = await snapshotRows(db, captureTables);
    expect(await capture(newer.identity, newPage)).toEqual({ disposition: 'replayed', captured: 0, cursor: '5', replayed: true });
    expect(await capture(old.identity, oldPage)).toEqual({ disposition: 'replayed', captured: 0, cursor: '5', replayed: true });
    expect(await snapshotRows(db, captureTables)).toEqual(afterCapture);
    expect(await snapshotRows(db, nonCaptureTables)).toEqual(before);
    await qualify(primary!, primaryAttempt.captures);
    await saveOriginals(primaryAttempt, 'after-replay');
    await save(primaryAttempt, 'capture-and-replay', {
      nonCaptureTableDigests: before, unchangedReplayTableDigests: afterCapture,
      lanes: pages.map(([manifestHash, page]) => ({
        manifestHash, after: page.after, next: page.next, eventIds: page.events.map(item => item.id), digest: hashCanonical(page),
      })),
    });
  });

  test('fresh construction and immutable inputs', async () => {
    let fixture: Fixture | undefined;
    try {
      fixture = await construct(freshAttempt);
      await qualify(fixture, freshAttempt.captures);
      await verifyInitialLanes(fixture);
      expect(freshAttempt.root).not.toBe(primaryAttempt.root);
      expect(freshAttempt.namespace).not.toBe(primaryAttempt.namespace);
      expect(freshAttempt.before).toEqual(primaryAttempt.before);
      for (const [index, binding] of proofBindings(fixture).entries()) {
        const original = proofBindings(primary!)[index]!;
        expect(binding.financial.jobId).not.toBe(original.financial.jobId);
        expect(binding.bootstrap.jobId).not.toBe(original.bootstrap.jobId);
        expect(binding.reviewPackageId).not.toBe(original.reviewPackageId);
        expect(binding.requestHash).not.toBe(original.requestHash);
        expect(binding.reviewerContextHash).not.toBe(original.reviewerContextHash);
        expect(binding.receiptId).not.toBe(original.receiptId);
        expect(binding.activationId).not.toBe(original.activationId);
        expect(binding.bundleHash).not.toBe(original.bundleHash);
      }
      await saveOriginals(freshAttempt, 'after-proof');
      await saveProof(freshAttempt, fixture);
      expect(await unchangedSources()).toEqual(sourceBefore);
    } finally {
      try {
        if (fixture) {
          await fixture.close();
          await cleanupEvidence(freshAttempt);
        }
      } finally {
        await fallback(freshAttempt);
      }
    }
  });

  test('partial construction cleanup', async () => {
    try {
      await expect(construct(failedAttempt).then(async fixture => { await fixture.close(); })).rejects.toBe(sentinel);
      expect(failedAttempt.composed).toBe(true);
      expect(failedAttempt.captures).toHaveLength(2);
      expect(failedAttempt.before).toEqual(primaryAttempt.before);
      expect(failedAttempt.namespace).not.toBe(primaryAttempt.namespace);
      expect(failedAttempt.namespace).not.toBe(freshAttempt.namespace);
      expect(failedAttempt.measurements.map(item => item.stage))
        .toEqual(['financial-probe', 'financial-launch', 'financial-probe', 'financial-launch']);
      await cleanupEvidence(failedAttempt);
      expect(await unchangedSources()).toEqual(sourceBefore);
    } finally {
      await fallback(failedAttempt);
    }
  });
});

async function verifyInitialLanes({ db, subjects }: Fixture) {
  const expected = subjects.map(({ identity, stored }) => ({
    manifest_hash: stored.bundle.manifest.hash, initial_activation_id: identity.activationId,
  }));
  expect((await db.query('SELECT manifest_hash, initial_activation_id FROM runtime_capture_lanes ORDER BY manifest_hash')).rows)
    .toEqual(expected.sort((a, b) => a.manifest_hash.localeCompare(b.manifest_hash)));
  expect((await db.query(`SELECT
    (SELECT count(*)::int FROM runtime_deliveries) AS deliveries,
    (SELECT count(*)::int FROM runtime_source_positions) AS positions,
    (SELECT count(*)::int FROM runtime_capture_checkpoints) AS checkpoints,
    (SELECT count(*)::int FROM runtime_capture_pages) AS pages,
    (SELECT count(*)::int FROM runtime_inbox) AS inbox`)).rows)
    .toEqual([{ deliveries: 3, positions: 3, checkpoints: 4, pages: 0, inbox: 0 }]);
  const runtime = createRuntimeCapture({ db, clock });
  for (const [index, { identity, stored }] of subjects.entries()) {
    const { readProgress } = await runtime.openCommitted(identity);
    expectProgress(await readProgress(), stored.bundle.manifest.hash, index === 0 ? '2' : '3', false);
  }
}

async function verifyRetainedCapture(db: Pool, pages: readonly (readonly [string, ReturnType<typeof ChangePageSchema.parse>])[],
  events: RawSourceEvent[]) {
  const { rows } = await db.query(`SELECT manifest_hash, after_cursor::text, next_cursor::text,
    event_count::int, canonical, digest FROM runtime_capture_pages ORDER BY after_cursor`);
  expect(rows).toEqual(pages.map(([manifestHash, page]) => ({
    manifest_hash: manifestHash, after_cursor: page.after, next_cursor: page.next,
    event_count: page.events.length, canonical: canonicalJson(page), digest: hashCanonical(page),
  })));
  expect((await db.query(`SELECT manifest_hash, after_cursor::text, sequence::int, event_id
    FROM runtime_inbox ORDER BY after_cursor, sequence`)).rows).toEqual(pages.flatMap(([manifestHash, page]) =>
    page.events.map(event => ({
      manifest_hash: manifestHash, after_cursor: page.after, sequence: event.sequence, event_id: event.id,
    }))));
  const { rows: deliveries } = await db.query(`SELECT sequence::int, d.event_id, d.canonical, d.content_hash, d.digest
    FROM runtime_source_positions p JOIN runtime_deliveries d USING (source_ref, event_id) ORDER BY sequence`);
  expect(deliveries).toEqual(events.toSorted((a, b) => a.sequence - b.sequence).map(event => ({
    sequence: event.sequence, event_id: event.id, canonical: canonicalJson(event), content_hash: event.contentHash,
    digest: hashCanonical(event),
  })));
  expect((await db.query('SELECT count(*)::int AS count FROM runtime_deliveries')).rows).toEqual([{ count: 5 }]);
}
