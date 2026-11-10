import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  VerificationCheckIdSchema, bootstrapAssertionCases, bootstrapRequiredAssertions, bootstrapRequiredCases,
  canonicalJson, hashArtifact, hashBootstrapVerificationResult, hashBundleV2, hashCanonical, hashFinancialAttestation,
  hashFinancialReport, hashFinancialReservation, hashManifest, hashPlan, hashProfile, hashReviewPackage,
  hashSpec, hashTargetSnapshot, targetRecordId, type TargetState,
} from '@eapr/contracts';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { lookupReceiptAssociation, readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import * as controlDb from '@eapr/storage/control-db';
import * as runtimeDb from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import * as activationComposition from '../../apps/control/src/activation-composition.js';
import { loadReviewSelection } from '../../apps/control/src/review-proof-selection.js';
import * as workerServer from '../../apps/worker/src/server.js';
import * as bootstrapRunner from '../../packages/evaluator/src/bootstrap-runner.js';
import * as financialRunner from '../../packages/evaluator/src/financial-attestation-runner.js';
import * as nativeDb from '../../scripts/native-db.js';
import * as evidenceCapture from '../fixtures/evidence-v2-capture.js';
import { createSyncSelectionCatalogNineFixture } from '../fixtures/sync-selection-catalog-nine.js';
import {
  inventory, measureBootstrapOuter, measureFinancialOuter, originalsAt, statIfPresent, writePrivateEvidence,
  type InventoryEntry, type Measurement,
} from '../fixtures/sync-selection-evidence.js';
import type { SelectionProof } from '../fixtures/sync-selection-enrollment.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const manifestId = 'manifest-sync-catalog-nine-v1';
const fixtureSetId = 'truth-sync-catalog-nine-v1';
const asOf = '2026-10-01T00:00:00.000Z';
const checks = [...VerificationCheckIdSchema.options].sort();
const expected = ([
  ['01', 'Catalog One'], ['02', 'Catalog Two'], ['03', 'Catalog Three'], ['04', 'Catalog Four'], ['05', 'Catalog Five'],
  ['06', 'Catalog Six'], ['07', 'Catalog Seven'], ['08', 'Catalog Eight'], ['09', 'Catalog Nine'],
] as const).map(([suffix, name], index) => ({
  suffix, name, sequence: index + 1, accountId: 'company-a.seller-a.sync-catalog-' + suffix,
  sourceAccount: 'sync-catalog-' + suffix, buyer: 'sync-catalog-buyer-' + suffix,
  contract: 'sync-catalog-contract-' + suffix, document: 'doc-sync-catalog-' + suffix,
  invoice: 'sync-catalog-invoice-' + suffix, event: 'evt:sync-catalog-invoice-' + suffix,
  spec: 'sync-catalog-spec-' + suffix, profile: 'sync-catalog-profile-' + suffix,
  approval: 'sync-catalog-approve-' + suffix, job: 'sync-catalog-financial:' + suffix,
  sidecar: 'bootstrap-catalog-' + suffix + '-v1',
}));
type Expected = typeof expected[number];
const expectedFiles = [
  ...expected.map(subject => 'visible/contract-' + subject.sequence + '.pdf'),
  ...expected.map(subject => 'visible/api-a/' + hashCanonical(subject.event) + '.json'),
  'visible/api-a.json', 'visible/api-originals-a.json', 'visible/manifest-a.json', 'visible/uploads-a.json',
  'truth/expected-a.json', 'truth/evidence-a.json',
].sort();
const sourcePaths = [
  'tests/fixtures', 'tests/integration/sync-selection.test.ts',
  'tests/integration/sync-selection-baselines-fixture.test.ts', 'tests/integration/sync-selection-bundled-fixture.test.ts',
  'tests/integration/sync-selection-catalog-nine-fixture.test.ts', 'tests/integration/sync-selection-catalog-csv-fixture.test.ts',
  'tests/integration/sync-capture.test.ts', 'scripts/generate-fixtures.ts', 'packages/sources/src', 'packages/evaluator/src',
  'db/control', 'db/runtime', 'package-lock.json', '.local/protected-evaluator', '.local/protected-bootstrap',
  '.local/activation-policy', '.local/artifacts', 'tests/fixtures/sync-selection-catalog-csv.ts',
];
const emptyTables = [
  'runtime_capture_lanes', 'runtime_capture_checkpoints', 'runtime_capture_pages', 'runtime_source_positions',
  'runtime_inbox', 'runtime_capture_incidents', 'runtime_authority_heads', 'runtime_authority_commands',
  'runtime_sync_receipts', 'runtime_sync_economic_outcomes', 'runtime_sync_delivery_outcomes',
  'runtime_sync_event_outcomes', 'runtime_sync_units', 'runtime_sync_application_heads',
];
const durableTables = [
  ...emptyTables, 'migration_ledger', 'seed_ledger', 'activity_counter', 'activity_events', 'parent_scopes',
  'parent_snapshots', 'parent_targets', 'parent_metadata', 'parent_financial_records', 'runtime_deliveries',
  'runtime_activation_imports', 'runtime_economic_outcomes', 'runtime_delivery_outcomes',
  'runtime_import_lineage', 'runtime_financial_origins',
];
const same = (actual: unknown, required: unknown, label: string) =>
  assert(canonicalJson(actual) === canonicalJson(required), label);
const scopeFor = (row: Expected) => ({ accountId: row.accountId, companyId: 'company-a', sellerEntityId: 'seller-a' });
const sortEvents = <T extends { id: string }>(events: readonly T[]) =>
  events.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type Fixture = Awaited<ReturnType<typeof createSyncSelectionCatalogNineFixture>>;
type Capture = Awaited<ReturnType<typeof evidenceCapture.captureEvidenceFixture>>['input'];
type Captured = Pick<Capture, 'manifest' | 'snapshot' | 'events'> & { citations: Map<string, string> };
type Worker = Awaited<ReturnType<typeof workerServer.launchWorker>>;
type OwnedPool = { pool: Pool; role: 'control' | 'runtime'; ended: boolean };
type Attempt = {
  label: 'primary' | 'fresh' | 'failure'; root?: string; namespace?: string; dropped: boolean;
  pools: OwnedPool[]; worker?: Worker; workerClosed: boolean; composed: boolean;
  before?: InventoryEntry[]; captured?: Captured; measurements: Measurement[]; elapsedMs?: number;
  proofs: Map<string, SelectionProof>; sidecars: { version: string; hash: string; bytes: number }[];
};
const attemptFor = (label: Attempt['label']): Attempt => ({
  label, dropped: false, pools: [], workerClosed: false, composed: false, measurements: [], proofs: new Map(), sidecars: [],
});

async function evidenceDirectory() {
  const root = await realpath(repository);
  const components = ['.superpowers', 'sdd', '2026-11-10-sync-selection-catalog-fixtures', 'evidence', 'task-C1'];
  let parent = root;
  for (const component of components) {
    parent = join(parent, component);
    const info = await statIfPresent(parent);
    if (!info) await mkdir(parent, { mode: 0o700 });
    else assert(info.isDirectory(), 'Unexpected catalog evidence parent type');
    assert(await realpath(parent) === parent, 'Unexpected catalog evidence parent symlink');
  }
  const configured = process.env.EAPR_SELECTION_FIXTURE_EVIDENCE_DIR;
  if (!configured) return mkdtemp(join(parent, 'run-'));
  const path = resolve(configured);
  assert(isAbsolute(configured) && dirname(path) === parent && /^run-[a-zA-Z0-9_-]+$/.test(basename(path)),
    'Unexpected C1 evidence run directory');
  const info = await statIfPresent(path);
  if (!info) await mkdir(path, { mode: 0o700 });
  else assert(info.isDirectory() && (info.mode & 0o077) === 0, 'C1 evidence directory must be private');
  assert(await realpath(path) === path, 'Unexpected C1 evidence run symlink');
  return path;
}

async function sourceInventory() {
  return (await Promise.all(sourcePaths.map(path => inventory(join(repository, path), path))))
    .flat().sort((a, b) => a.path.localeCompare(b.path));
}

function inspectCapture({ manifest, snapshot, events, citations }: Capture, before: InventoryEntry[]): Captured {
  same({
    id: manifest.id, company: manifest.companyId, source: manifest.sourceRef, epoch: manifest.epoch, asOf: manifest.asOf,
    cursors: Object.fromEntries(manifest.streams.map(item => [item.streamId, item.resumeAfter])),
    schema: manifest.schemaVersions, semantics: manifest.semanticVersions,
  }, {
    id: manifestId, company: 'company-a', source: 'legacy-a', epoch: 1, asOf,
    cursors: { 'a-finance': '9', 'a-semantics': '0' },
    schema: {
      'a-invoices': 'schema-a-1', 'a-payments': 'schema-a-1', 'a-credits': 'schema-a-1',
      'a-allocations': 'schema-a-1', 'a-reversals': 'schema-a-1', 'a-semantics': 'schema-a-1',
    },
    semantics: Object.fromEntries(expected.map(row => ['seller-a/' + row.sourceAccount, 'sem-a-1'])),
  }, 'Literal catalog capture manifest');
  assert(manifest.hash === hashManifest(manifest) && manifest.files.length === 9 &&
    snapshot.id === 'snapshot:' + manifestId && snapshot.manifestId === manifestId && snapshot.sourceRef === 'legacy-a',
  'Catalog capture provenance');
  same(manifest.streams.find(member => member.streamId === 'a-finance')?.eventIds, expected.map(row => row.event),
    'Manifest finance membership');
  same(manifest.streams.find(member => member.streamId === 'a-semantics')?.eventIds, [], 'Manifest semantic membership');
  same(snapshot.eventIds.toSorted(), expected.map(row => row.event), 'Snapshot event membership');
  same(sortEvents(events).map(event => [
    event.id, event.sequence, event.recordId, event.rawIdentity.sourceAccountId, event.recordVersion, event.effectiveAt,
    event.observedAt, event.sourceRef, event.streamId, event.schemaVersion, event.semanticVersion, event.kind,
  ]), expected.map(row => [
    row.event, row.sequence, row.invoice, row.sourceAccount, 1, '2026-09-01T00:00:00.000Z', asOf,
    'legacy-a', 'a-finance', 'schema-a-1', 'sem-a-1', 'invoice',
  ]), 'Literal captured event bindings');
  const ownCitations = new Map<string, string>();
  for (const row of expected) {
    const file = manifest.files.find(member => member.documentId === row.document);
    const original = before.find(item => item.path === 'visible/contract-' + row.sequence + '.pdf');
    assert(file && file.kind === 'contract_pdf' && file.documentVersion === 1 && original && 'sha256' in original &&
      file.sha256 === original.sha256, 'Own original agreement ' + row.accountId);
    const matches = citations.filter(item => item.evidence.sourceId === file.fileId &&
      item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1);
    const citation = matches[0];
    assert(matches.length === 1 && citation && citation.original.sha256 === original.sha256 &&
      citation.evidence.sha256 === original.sha256 && citation.evidence.snapshotId === snapshot.id &&
      snapshot.evidenceIds.includes(citation.evidence.id) && citation.text.startInclusive === 0 &&
      citation.text.endExclusive === citation.text.value.length, 'Own captured page-one evidence ' + row.accountId);
    ownCitations.set(row.accountId, citation.evidence.id);
  }
  assert(new Set(ownCitations.values()).size === 9, 'Nine distinct page-one citations required');
  return { manifest, snapshot, events, citations: ownCitations };
}

function financialMatrix(row: Expected, proof: SelectionProof, capture: Captured, buildHash: string) {
  const { report, attestation, entry } = proof;
  const { reservation } = attestation;
  const { manifest, snapshot, events } = capture;
  const profileHash = entry.selectedProfileHash;
  assert(report.eligible && report.unexplainedDifferenceCents === 0 &&
    report.checks.every(item => item.status === 'passed' && item.cases > 0), 'Financial pass and case counts ' + row.job);
  same(report.checks.map(item => item.id).sort(), checks, 'Exact mandatory checks ' + row.job);
  same({
    ...report.coverage, required: report.coverage.required.toSorted(), executed: report.coverage.executed.toSorted(),
    eventKinds: report.coverage.eventKinds.toSorted(),
  }, {
    required: checks, executed: checks, sourceRefs: ['legacy-a'], profileHashes: [profileHash],
    eventKinds: ['allocation', 'credit', 'invoice', 'payment', 'reversal'],
  }, 'Exact financial coverage ' + row.job);
  same({
    id: report.id, artifact: report.artifactHash, profiles: report.profileHashes, manifest: report.manifestHash,
    fixture: report.fixtureSetId, fixtureVersion: report.fixtureSetVersion, build: report.evaluatorBuildHash, harness: report.harnessVersion,
  }, {
    id: 'report:' + row.job, artifact: entry.artifactHash, profiles: [profileHash], manifest: manifest.hash,
    fixture: fixtureSetId, fixtureVersion: '2', build: buildHash, harness: '1',
  }, 'Financial report binding ' + row.job);
  same(reservation, {
    schemaVersion: '1', jobId: row.job, issuerId: 'eapr-control-registry-1', runnerId: 'eapr-financial-1',
    protocolVersion: '1', harnessVersion: '1', purpose: 'construction', evaluatorBuildHash: buildHash,
    artifactHash: entry.artifactHash, requiredProfileHashes: [profileHash], evidencePin: reservation.evidencePin,
    capture: {
      companyId: 'company-a', sourceRef: 'legacy-a', manifestId, manifestHash: manifest.hash,
      snapshotId: snapshot.id, snapshotHash: snapshot.contentHash, snapshotObjectHash: hashCanonical(snapshot),
      eventsHash: hashCanonical(sortEvents(events)),
    },
    hash: hashFinancialReservation(reservation),
  }, 'Financial reservation binding ' + row.job);
  assert(attestation.hash === hashFinancialAttestation(attestation) && attestation.reportId === report.id &&
    attestation.reportHash === hashFinancialReport(report) && entry.financialReportId === report.id &&
    entry.manifestId === manifestId && reservation.evidencePin.fixtureSetId === fixtureSetId &&
    reservation.evidencePin.fixtureSetVersion === '2' && entry.bootstrapFixture.fixtureSetId === fixtureSetId &&
    entry.bootstrapFixture.fixtureSetVersion === row.sidecar, 'Financial attestation and pin bindings ' + row.job);
}

async function inspectInstalledProofs(attempt: Attempt, source: Parameters<typeof activationComposition.composeActivationReview>[0],
  options: Parameters<typeof activationComposition.composeActivationReview>[1]) {
  const policy = await loadActivationPolicy({ policyPath: options.policyPath });
  assert(options.selectionPath && attempt.captured && attempt.root, 'Missing C1 installed proof inputs');
  const selection = await loadReviewSelection(options.selectionPath);
  assert(policy.policyId === 'sync-catalog-nine-policy-v1' && selection.policyId === policy.policyId &&
    policy.entries.length === 9 && selection.entries.length === 9, 'Nine-entry reviewer installation required');
  const registry = createFinancialAttestationRegistry(source.dependencies.db, options.candidates);
  const [financialBuild, bootstrapBuilds] = await Promise.all([readFixedFinancialBuildHash(), readFixedBootstrapBuildPins()]);
  for (const row of expected) {
    const member = policy.entries.find(item => item.scope.accountId === row.accountId);
    const entry = selection.entries.find(item => item.financialReportId === 'report:' + row.job);
    assert(member && entry, 'Missing selecting policy member ' + row.accountId);
    same(member.scope, scopeFor(row), 'Installed selecting scope ' + row.accountId);
    assert(entry.artifactHash === member.artifactHash && entry.selectedProfileHash === member.selectedProfileHash &&
      member.capture.manifestId === entry.manifestId, 'Installed selecting artifact ' + row.accountId);
    const candidate = await options.candidates.getCandidate(entry.artifactHash, entry.manifestId);
    assert(candidate.spec.id === row.spec && hashSpec(candidate.spec) === candidate.artifact.specHash &&
      candidate.profiles.length === 1 && candidate.profiles[0]?.id === row.profile &&
      candidate.profiles[0].hash === entry.selectedProfileHash, 'Exact registered candidate ' + row.accountId);
    const proof = { ...await registry.readRegisteredFinancialAttestation(entry.financialReportId, {
      artifactHash: member.artifactHash, requiredProfileHashes: member.requiredProfileHashes, capture: member.capture, policy,
    }), entry };
    financialMatrix(row, proof, attempt.captured, financialBuild);
    same(member.financial.evidencePin, proof.attestation.reservation.evidencePin, 'Installed evidence pin ' + row.accountId);
    same(member.bootstrapPin, {
      runnerId: 'eapr-bootstrap-1', protocolVersion: '1', ...bootstrapBuilds, ...entry.bootstrapFixture,
    }, 'Installed bootstrap build and fixture ' + row.accountId);
    const file = await statIfPresent(join(options.bootstrapRoots.sidecarRoot, hashCanonical([fixtureSetId, row.sidecar]) + '.json'));
    assert(file && file.isFile() && file.size > 0 && (file.mode & 0o777) === 0o400, 'Owned sidecar file ' + row.sidecar);
    attempt.sidecars.push({ version: row.sidecar, hash: entry.bootstrapFixture.fixtureHash, bytes: file.size });
    attempt.proofs.set(row.accountId, proof);
  }
  assert(new Set([...attempt.proofs.values()].map(proof => proof.attestation.reservation.evidencePin.bundleHash)).size === 1,
    'Shared evidence pin required');
}

function targetLiteral(records: TargetState, row: Expected, citation: string) {
  const scope = scopeFor(row);
  const identity = { sourceRef: 'legacy-a', sellerEntityId: 'seller-a', kind: 'invoice' as const, recordId: row.invoice };
  const id = targetRecordId(identity);
  const refs = [citation];
  same(records, {
    scope, version: 1, asOf: '2026-10-01T00:00:00.000Z',
    invoices: [{
      id, identity, scope, kind: 'invoice', sourceEventId: row.event, sourceRecordVersion: 1, amountCents: 300000,
      currency: 'USD', effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
    }],
    payments: [], credits: [], allocations: [], reversals: [],
    customers: [{ id: row.buyer, displayName: row.name, evidenceRefs: refs }],
    accounts: [{ id: row.accountId, scope, parentCustomerId: row.buyer, sourceRef: 'legacy-a', sourceAccountIds: [row.sourceAccount] }],
    billingConfigurations: [{
      id: 'configuration:demo-term-a', scope,
      contractTerm: {
        id: 'demo-term-a', contractId: row.contract, validFrom: '2026-09-01', validToExclusive: null,
        fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs: refs,
      },
    }],
  }, 'Entire literal target ' + row.accountId);
  return id;
}

async function readDurable(fixture: Fixture, capture: Captured) {
  await withTransaction(fixture.db, async client => {
    for (const [index, row] of expected.entries()) {
      const { stored } = fixture.subjects[index]!;
      const scope = scopeFor(row);
      const activation = await readStoredActivation(client, scope);
      const target = await readStoredTarget(client, scope);
      assert(activation && target, 'Missing durable selecting import ' + row.accountId);
      same(activation, stored, 'Durable activation, receipt and bundle ' + row.accountId);
      same(target, stored.approvedTarget, 'Durable approved target ' + row.accountId);
      const recordId = targetLiteral(target.records, row, capture.citations.get(row.accountId)!);
      same(await lookupReceiptAssociation(client, row.approval, { scope, requestHash: stored.requestHash, bundleHash: stored.bundleHash }),
        { status: 'exact', stored }, 'Authoritative receipt association ' + row.accountId);
      same(await readFinancialOrigins(client, scope, target.records.invoices), [
        { kind: 'initial', recordId, importKey: row.approval, receipt: activation.receipt },
      ], 'Own initial financial origin ' + row.accountId);
    }
  });
}

function qualifyMeasurements(attempt: Attempt, fixture?: Fixture) {
  const stages = expected.flatMap(() => ['financial-probe', 'financial-launch']);
  const jobs = expected.flatMap(row => [row.job, row.job]);
  if (fixture) {
    stages.push(...expected.map(() => 'bootstrap'));
    jobs.push(...fixture.subjects.map(subject => subject.stored.bundle.bootstrapVerification.jobId));
  }
  same(attempt.measurements.map(item => item.stage), stages, 'Real outer producer call sequence');
  same(attempt.measurements.map(item => item.jobId), jobs, 'Exact outer producer job association');
  assert(attempt.elapsedMs && attempt.elapsedMs > 0 && attempt.sidecars.length === 9 && attempt.proofs.size === 9,
    'Missing construction, sidecar or registered proof observation');
  const limit = financialRunner.financialMessageLimit;
  const pinSizes = new Set<number>();
  for (const [index, item] of attempt.measurements.entries()) {
    assert(item.status === 'ok' && item.manifestHash === attempt.captured?.manifest.hash &&
      item.framedRequestBytes === item.requestJsonBytes + 1 && item.framedRequestBytes <= limit &&
      item.framedContextBytes > 1 && item.framedContextBytes <= limit &&
      item.returnedResponseObjectJsonBytes && item.returnedResponseObjectJsonBytes > 0 && item.elapsedMs > 0,
    'Incomplete successful outer measurement ' + item.jobId);
    if (item.stage === 'bootstrap') {
      assert(item.sidecarBytes === attempt.sidecars[index - 18]?.bytes, 'Selected sidecar size association ' + item.jobId);
    } else {
      assert(item.evidencePinBytes && item.evidencePinBytes <= limit, 'Common evidence pin size ' + item.jobId);
      pinSizes.add(item.evidencePinBytes);
    }
  }
  assert(pinSizes.size === 1, 'Expected one common evidence-pin size');
}

async function qualifyProofs(fixture: Fixture, attempt: Attempt) {
  const capture = attempt.captured;
  assert(capture && fixture.subjects.length === 9, 'Missing nine captured proof subjects');
  const [financialBuild, bootstrapBuilds] = await Promise.all([readFixedFinancialBuildHash(), readFixedBootstrapBuildPins()]);
  const identities: string[][] = [];
  for (const [index, row] of expected.entries()) {
    const { stored, identity } = fixture.subjects[index]!;
    const { activation, bundle, plan, receipt, request } = stored;
    const { artifact, profiles: [profile], bootstrapVerification: bootstrap } = bundle;
    const scope = scopeFor(row);
    const proof = attempt.proofs.get(row.accountId);
    assert(proof && profile && bundle.profiles.length === 1, 'Missing selected artifact or proof ' + row.accountId);
    assert(artifact.hash === hashArtifact(artifact) &&
      profile.id === row.profile && profile.hash === hashProfile(profile) && profile.semanticVersion === 'sem-a-1',
    'Exact immutable candidate ' + row.accountId);
    same(profile.sourceAccountIds, [row.sourceAccount], 'Selected source account ' + row.accountId);
    same(profile.scope, scope, 'Selected profile scope ' + row.accountId);
    same(artifact.requiredProfileHashes, [profile.hash], 'Single required profile ' + row.accountId);
    same(bundle.manifest, capture.manifest, 'Common immutable manifest ' + row.accountId);
    same(bundle.snapshot, capture.snapshot, 'Common immutable snapshot ' + row.accountId);
    same(sortEvents(bundle.bootstrapEvents), sortEvents(capture.events), 'Nine complete bootstrap events ' + row.accountId);
    same(activation.baselineCursors, [
      { streamId: 'a-finance', resumeAfter: '9' }, { streamId: 'a-semantics', resumeAfter: '0' },
    ], 'Committed baseline cursor vector ' + row.accountId);
    same([bundle.verificationReport, bundle.financialAttestation], [proof.report, proof.attestation], 'Registered financial proof readback');
    financialMatrix(row, { ...proof, report: bundle.verificationReport, attestation: bundle.financialAttestation }, capture, financialBuild);

    assert(bootstrap.passed && bootstrap.hash === hashBootstrapVerificationResult(bootstrap) &&
      bootstrap.id === 'bootstrap-result:' + bootstrap.jobId && bootstrap.planHash === plan.hash, 'Selected bootstrap result ' + row.accountId);
    same(bootstrap.cases.map(item => [item.id, item.status]), bootstrapRequiredCases.map(id => [id, 'passed']), 'Bootstrap case matrix');
    same(bootstrap.assertions.map(item => [item.id, item.status, item.caseIds]),
      bootstrapRequiredAssertions.map(id => [id, 'passed', bootstrapAssertionCases[id]]), 'Bootstrap assertion matrix');
    same(bootstrap.pin, { runnerId: 'eapr-bootstrap-1', protocolVersion: '1', ...bootstrapBuilds, ...proof.entry.bootstrapFixture },
      'Selected bootstrap pin ' + row.accountId);
    same(bootstrap.binding, {
      scope, artifactHash: artifact.hash, profileHash: profile.hash, requiredProfileHashes: [profile.hash],
      manifestId, manifestHash: capture.manifest.hash, snapshotId: capture.snapshot.id, snapshotHash: capture.snapshot.contentHash,
      eventsHash: hashCanonical(sortEvents(capture.events)), targetSnapshotHash: hashTargetSnapshot(stored.plannerTarget),
      expectedTargetVersion: 0, asOf,
    }, 'Selected bootstrap input binding ' + row.accountId);
    const empty = {
      scope, version: 0, asOf, invoices: [], payments: [], credits: [], allocations: [], reversals: [],
      customers: [], accounts: [], billingConfigurations: [],
    };
    same(stored.recordedTarget, empty, 'Recorded empty target ' + row.accountId);
    same(stored.plannerTarget, empty, 'Planner empty target ' + row.accountId);
    same(bundle.previewPlan, plan, 'Stored selected plan ' + row.accountId);
    same(plan.eventIds, [row.event], 'Only own selected event ' + row.accountId);
    assert(plan.hash === hashPlan(plan) && plan.profileHash === profile.hash && plan.artifactHash === artifact.hash &&
      plan.expectedTargetVersion === 0 && plan.expectedBalanceCents === 300000, 'Selected plan linkage ' + row.accountId);
    const records = stored.approvedTarget.records;
    const id = targetLiteral(records, row, capture.citations.get(row.accountId)!);
    same(plan.operations, [
      { op: 'ensure_customer', record: records.customers[0] }, { op: 'ensure_account', record: records.accounts[0] },
      { op: 'ensure_billing_configuration', record: records.billingConfigurations[0] }, { op: 'insert_invoice', record: records.invoices[0] },
    ], 'Only own selected operations ' + row.accountId);
    same(receipt, {
      id: receipt.id, scope, activationId: activation.id, epoch: 1, artifactHash: artifact.hash, planHash: plan.hash,
      eventIds: [row.event], targetRecordIds: [id], beforeBalanceCents: 0, afterBalanceCents: 300000,
      status: 'applied', committedAt: '2026-11-09T08:00:00.000Z',
    }, 'Entire first receipt ' + row.accountId);
    const review = bundle.reviewPackage;
    same(request, {
      idempotencyKey: row.approval, reviewPackageId: review.id, expectedPackageHash: review.hash,
      expectedArtifactHash: artifact.hash, expectedProfileHash: profile.hash, expectedTargetVersion: 0,
    }, 'Exact selecting request ' + row.accountId);
    same(bundle.request, request, 'Bound selecting request ' + row.accountId);
    same(stored.reviewer, bundle.reviewer, 'Bound reviewer identity ' + row.accountId);
    assert(stored.requestHash === hashCanonical(request) && review.hash === hashReviewPackage(review) &&
      review.verificationReportId === proof.report.id && review.previewPlanHash === plan.hash &&
      review.manifestHash === capture.manifest.hash && review.ready && activation.epoch === 1 && activation.status === 'active' &&
      activation.artifactHash === artifact.hash && activation.profileHash === profile.hash && activation.manifestHash === capture.manifest.hash &&
      activation.reviewerId === bundle.reviewer.reviewerId && stored.bundleHash === bundle.hash && bundle.hash === hashBundleV2(bundle) &&
      stored.approvedTarget.snapshotHash === hashTargetSnapshot(records), 'Immutable selecting import bindings ' + row.accountId);
    same([review.scope, activation.scope, plan.scope], [scope, scope, scope], 'Exact selecting scope ' + row.accountId);
    same(identity, { scope, activationId: activation.id, bundleHash: bundle.hash }, 'Returned committed identity ' + row.accountId);
    identities.push([row.approval, stored.requestHash, review.id, artifact.hash, profile.hash, bundle.hash, activation.id, receipt.id]);
  }
  for (const column of identities[0]!.keys()) {
    assert(new Set(identities.map(row => row[column])).size === 9, 'Selecting identity collision at column ' + column);
  }
  await readDurable(fixture, capture);
  qualifyMeasurements(attempt, fixture);
}

async function stateDigest(db: Pool) {
  return withTransaction(db, async client => {
    const digests = [];
    for (const table of durableTables) {
      // PostgreSQL JSON text preserves timestamp rows without introducing JavaScript Date objects.
      const { rows } = await client.query<{ row_json: string }>(
        'SELECT to_jsonb(saved)::text AS row_json FROM ' + table + ' AS saved ORDER BY row_json',
      );
      digests.push(hashCanonical(rows.map(row => row.row_json)));
    }
    return hashCanonical(digests);
  });
}

async function qualifyInventory(fixture: Fixture, capture: Captured) {
  const { db } = fixture;
  const { rows } = await db.query(
    'SELECT account_id, company_id, seller_entity_id, idempotency_key, activation_id, receipt_id, bundle_hash, capture_manifest_hash ' +
    'FROM runtime_activation_imports WHERE capture_source_ref = $1 ORDER BY account_id LIMIT 9', ['legacy-a'],
  );
  same(rows, expected.map((row, index) => {
    const { stored, identity } = fixture.subjects[index]!;
    return {
      account_id: row.accountId, company_id: 'company-a', seller_entity_id: 'seller-a', idempotency_key: row.approval,
      activation_id: identity.activationId, receipt_id: stored.receipt.id, bundle_hash: identity.bundleHash,
      capture_manifest_hash: capture.manifest.hash,
    };
  }), 'Exactly the nine source-rooted scalar selecting rows');
  const count = async (table: string) => (await db.query<{ count: number }>('SELECT count(*)::int FROM ' + table)).rows[0]!.count;
  expect(await count('runtime_activation_imports')).toBe(9);
  expect(await count('runtime_financial_origins')).toBe(9);
  for (const table of emptyTables) assert(await count(table) === 0, 'Unexpected catalog enrollment rows in ' + table);
  const before = await stateDigest(db);
  await readDurable(fixture, capture);
  assert(await stateDigest(db) === before, 'Catalog fixture readback changed durable state');
}

function proofEvidence(stored: StoredActivation) {
  const { activation, receipt, request, bundle, approvedTarget } = stored;
  const { verificationReport: report, financialAttestation, bootstrapVerification } = bundle;
  return {
    accountId: activation.scope.accountId, manifestHash: activation.manifestHash, artifactHash: activation.artifactHash,
    profileHash: activation.profileHash, reportId: report.id, reportHash: financialAttestation.reportHash,
    reservationHash: financialAttestation.reservation.hash, attestationHash: financialAttestation.hash,
    financialBuildHash: report.evaluatorBuildHash, capture: financialAttestation.reservation.capture,
    evidencePin: financialAttestation.reservation.evidencePin,
    financialChecks: report.checks.map(({ id, status, cases }) => ({ id, status, cases })),
    bootstrapResultId: bootstrapVerification.id, bootstrapResultHash: bootstrapVerification.hash,
    bootstrapPin: bootstrapVerification.pin, bootstrapCases: bootstrapVerification.cases,
    bootstrapAssertions: bootstrapVerification.assertions,
    planHash: stored.plan.hash, requestKey: request.idempotencyKey, requestHash: stored.requestHash,
    reviewPackageId: request.reviewPackageId, reviewPackageHash: bundle.reviewPackage.hash,
    activationId: activation.id, bundleHash: stored.bundleHash, approvedTargetHash: approvedTarget.snapshotHash, receiptId: receipt.id,
  };
}

describe('nine-subject catalog fixture qualification', () => {
  const primaryAttempt = attemptFor('primary');
  const freshAttempt = attemptFor('fresh');
  const failureAttempt = attemptFor('failure');
  const attempts = [primaryAttempt, freshAttempt, failureAttempt];
  const sentinel = new Error('Deliberate C1 failure after real review composition');
  const restore: (() => void)[] = [];
  let active = primaryAttempt;
  let primary: Fixture | undefined;
  let evidenceDir: string;
  let sources: InventoryEntry[];

  const save = (attempt: Attempt, phase: string, data: unknown) =>
    writePrivateEvidence(join(evidenceDir, attempt.label + '-' + phase + '.json'), data);

  async function saveOriginals(attempt: Attempt, phase: string) {
    assert(attempt.root && attempt.before, 'Missing authored input inventory');
    const observed = await originalsAt(attempt.root);
    await save(attempt, phase, observed);
    same(observed, attempt.before, 'Original visible and truth input bytes changed');
  }

  async function construct(attempt: Attempt) {
    active = attempt;
    const start = performance.now();
    try { return await createSyncSelectionCatalogNineFixture(); }
    finally { attempt.elapsedMs = performance.now() - start; }
  }

  async function cleanupEvidence(attempt: Attempt) {
    assert(attempt.root && attempt.namespace && attempt.worker && attempt.pools.length === 2, 'Missing owned resource observation');
    const cleanup = {
      namespace: attempt.namespace, dropped: attempt.dropped, rootAbsent: !await statIfPresent(attempt.root),
      workerClosed: attempt.workerClosed, listenerStopped: !attempt.worker.server.listening,
      pools: attempt.pools.map(({ role, ended }) => ({ role, ended })),
    };
    await save(attempt, 'cleanup', cleanup);
    assert(cleanup.dropped && cleanup.rootAbsent && cleanup.workerClosed && cleanup.listenerStopped &&
      cleanup.pools.every(pool => pool.ended), 'Owned catalog resources remain after close');
    same(cleanup.pools.map(pool => pool.role).sort(), ['control', 'runtime'], 'Both application pools ended');
  }

  async function fallback(attempt: Attempt) {
    const failures: unknown[] = [];
    async function tryCleanup(action: () => Promise<unknown>) {
      try { await action(); } catch (error) { failures.push(error); }
    }
    if (attempt.worker?.server.listening) await tryCleanup(() => attempt.worker!.close());
    for (const owned of attempt.pools.toReversed()) {
      if (!owned.ended) await tryCleanup(() => owned.pool.end());
    }
    if (attempt.namespace && !attempt.dropped) await tryCleanup(() => nativeDb.dropTest(attempt.namespace!));
    if (attempt.root && await statIfPresent(attempt.root)) await tryCleanup(() => rm(attempt.root!, { recursive: true, force: true }));
    assert(failures.length === 0, 'Fallback catalog resource cleanup failed');
  }

  async function closeSuccess(attempt: Attempt, fixture: Fixture, repeat = false) {
    try { await saveOriginals(attempt, 'before-cleanup'); }
    finally {
      const closed = fixture.close();
      if (repeat) {
        const repeated = fixture.close();
        await Promise.all([closed, repeated]);
        assert(closed === repeated, 'Repeated close did not share the owned cleanup result');
      } else {
        await closed;
      }
    }
    await cleanupEvidence(attempt);
  }

  function observePool(pool: Pool, role: OwnedPool['role']) {
    const owned = { pool, role, ended: false };
    active.pools.push(owned);
    const end = pool.end.bind(pool);
    const spy = vi.spyOn(pool, 'end').mockImplementation((async () => {
      await end();
      owned.ended = true;
    }) as Pool['end']);
    restore.push(() => spy.mockRestore());
    return pool;
  }

  async function savePassing(attempt: Attempt, fixture: Fixture) {
    await saveOriginals(attempt, 'after-proof-import');
    await save(attempt, 'proofs', fixture.subjects.map(subject => proofEvidence(subject.stored)));
    await saveMeasurements(attempt);
  }

  function saveMeasurements(attempt: Attempt) {
    return save(attempt, 'outer-measurements', {
      outer: attempt.measurements, constructionElapsedMs: attempt.elapsedMs, sidecars: attempt.sidecars,
      requestAndContext: 'UTF-8 schema-validated request JSON and actual context JSON, each plus one LF',
      response: 'UTF-8 JSON serialization of parsed success value only',
      rawResponseWireBytes: 'unobserved', individualNestedBytesAndElapsedMs: 'unobserved',
      unchangedEnforcement: {
        transportRejectsFramedInputContextAndCombinedOutputGreaterThanBytes: 10485760,
        financialRegistryRejectsCanonicalBytesGreaterThanOrEqualTo: 10485760,
        outerTimeoutMs: 120000, nestedTimeoutMs: 5000,
      },
    });
  }

  beforeAll(async () => {
    evidenceDir = await evidenceDirectory();
    sources = await sourceInventory();
    const capture = evidenceCapture.captureEvidenceFixture;
    const captureSpy = vi.spyOn(evidenceCapture, 'captureEvidenceFixture').mockImplementation(async (...args) => {
      const attempt = active;
      const { visibleRoot, truthRoot } = args[1];
      assert(!attempt.root && args[2] === 'a', 'Unexpected capture attempt');
      attempt.root = dirname(visibleRoot);
      assert(visibleRoot === join(attempt.root, 'visible') && truthRoot === join(attempt.root, 'truth') &&
        await realpath(attempt.root) === attempt.root, 'Unexpected owned capture roots');
      attempt.before = await originalsAt(attempt.root);
      same(attempt.before.map(item => item.path).sort(), expectedFiles, 'Complete authored input inventory');
      assert(attempt.before.every(item => 'bytes' in item && item.bytes > 0), 'Missing authored input bytes');
      await save(attempt, 'before-publication', attempt.before);
      const { rows: [counts] } = await args[0].db.query(
        'SELECT (SELECT count(*)::int FROM source_manifests) AS manifests, ' +
        '(SELECT count(*)::int FROM source_events) AS events, (SELECT count(*)::int FROM artifact_captures) AS captures',
      );
      same(counts, { manifests: 0, events: 0, captures: 0 }, 'Inputs observed before source publication');
      const result = await capture(...args);
      attempt.captured = inspectCapture(result.input, attempt.before);
      return result;
    });
    restore.push(() => captureSpy.mockRestore());
    const provision = nativeDb.provisionTest;
    const provisionSpy = vi.spyOn(nativeDb, 'provisionTest').mockImplementation(async namespace => {
      const attempt = active;
      assert(!attempt.namespace, 'Attempt already owns a namespace');
      const pair = await provision(namespace);
      attempt.namespace = namespace;
      return pair;
    });
    restore.push(() => provisionSpy.mockRestore());
    const drop = nativeDb.dropTest;
    const dropSpy = vi.spyOn(nativeDb, 'dropTest').mockImplementation(async namespace => {
      const owner = attempts.find(attempt => attempt.namespace === namespace);
      assert(owner && !owner.dropped, 'Unexpected catalog namespace drop');
      await drop(namespace);
      owner.dropped = true;
    });
    restore.push(() => dropSpy.mockRestore());
    const createControl = controlDb.createControlDb;
    const controlSpy = vi.spyOn(controlDb, 'createControlDb').mockImplementation(options => observePool(createControl(options), 'control'));
    restore.push(() => controlSpy.mockRestore());
    const createRuntime = runtimeDb.createRuntimeDb;
    const runtimeSpy = vi.spyOn(runtimeDb, 'createRuntimeDb').mockImplementation(options => observePool(createRuntime(options), 'runtime'));
    restore.push(() => runtimeSpy.mockRestore());

    const launch = workerServer.launchWorker;
    const launchSpy = vi.spyOn(workerServer, 'launchWorker').mockImplementation(async (...args) => {
      const attempt = active;
      const worker = await launch(...args);
      attempt.worker = worker;
      const close = worker.close.bind(worker);
      const closeSpy = vi.spyOn(worker, 'close').mockImplementation((async () => {
        await close();
        attempt.workerClosed = true;
      }) as Worker['close']);
      restore.push(() => closeSpy.mockRestore());
      return worker;
    });
    restore.push(() => launchSpy.mockRestore());
    const compose = activationComposition.composeActivationReview;
    const composeSpy = vi.spyOn(activationComposition, 'composeActivationReview').mockImplementation(async (...args) => {
      const attempt = active;
      const result = await compose(...args);
      attempt.composed = true;
      assert(attempt.worker?.server.listening, 'Parent-read worker did not listen during real composition');
      await inspectInstalledProofs(attempt, ...args);
      if (attempt === failureAttempt) {
        await saveOriginals(attempt, 'before-cleanup');
        await save(attempt, 'financial-before-sentinel', [...attempt.proofs.values()].map(({ report, attestation }) => ({
          reportId: report.id, reportHash: attestation.reportHash, reservationHash: attestation.reservation.hash,
          attestationHash: attestation.hash, checks: report.checks.map(({ id, status, cases }) => ({ id, status, cases })),
        })));
        throw sentinel;
      }
      return result;
    });
    restore.push(() => composeSpy.mockRestore());

    const financial = financialRunner.runFinancialEvaluator;
    const financialSpy = vi.spyOn(financialRunner, 'runFinancialEvaluator').mockImplementation(async (...args) => {
      const attempt = active;
      const { result, measurement } = await measureFinancialOuter(financial, ...args);
      attempt.measurements.push(measurement);
      return result;
    });
    restore.push(() => financialSpy.mockRestore());
    const bootstrap = bootstrapRunner.runBootstrapEvaluator;
    const bootstrapSpy = vi.spyOn(bootstrapRunner, 'runBootstrapEvaluator').mockImplementation(async (...args) => {
      const attempt = active;
      const { result, measurement } = await measureBootstrapOuter(bootstrap, ...args);
      attempt.measurements.push(measurement);
      return result;
    });
    restore.push(() => bootstrapSpy.mockRestore());
    primary = await construct(primaryAttempt);
  }, 300000);

  afterAll(async () => {
    try {
      if (primary) await closeSuccess(primaryAttempt, primary, true);
    } finally {
      try {
        const cleanup = await Promise.allSettled(attempts.map(fallback));
        assert(cleanup.every(item => item.status === 'fulfilled'), 'One or more catalog attempts retained resources');
      } finally {
        for (const undo of restore.toReversed()) undo();
      }
    }
  }, 300000);

  test('nine real proofs and selecting first imports', async () => {
    await qualifyProofs(primary!, primaryAttempt);
    await savePassing(primaryAttempt, primary!);
  }, 300000);

  test('complete source inventory without capture enrollment', async () => {
    await qualifyInventory(primary!, primaryAttempt.captured!);
  }, 300000);

  test('fresh construction preserves original inputs', async () => {
    let fresh: Fixture | undefined;
    try {
      fresh = await construct(freshAttempt);
      assert(freshAttempt.root !== primaryAttempt.root && freshAttempt.namespace !== primaryAttempt.namespace, 'Fresh ownership overlaps primary');
      same(freshAttempt.before, primaryAttempt.before, 'Deterministic fresh authored bytes');
      await qualifyProofs(fresh, freshAttempt);
      await qualifyInventory(fresh, freshAttempt.captured!);
      await savePassing(freshAttempt, fresh);
      await saveOriginals(primaryAttempt, 'after-fresh-construction');
      same(await sourceInventory(), sources, 'Source inventory changed during fresh qualification');
    } finally {
      try { if (fresh) await closeSuccess(freshAttempt, fresh); }
      finally { await fallback(freshAttempt); }
    }
  }, 300000);

  test('partial construction releases owned resources', async () => {
    try {
      await expect(construct(failureAttempt).then(fixture => fixture.close())).rejects.toBe(sentinel);
      assert(failureAttempt.composed && failureAttempt.namespace !== primaryAttempt.namespace &&
        failureAttempt.namespace !== freshAttempt.namespace && failureAttempt.root !== primaryAttempt.root &&
        failureAttempt.root !== freshAttempt.root, 'Failure did not reach independent real composition');
      same(failureAttempt.before, primaryAttempt.before, 'Failed attempt retained deterministic input inventory');
      qualifyMeasurements(failureAttempt);
      await saveMeasurements(failureAttempt);
      await cleanupEvidence(failureAttempt);
      expect((await primary!.db.query('SELECT count(*)::int AS count FROM runtime_activation_imports')).rows[0]!.count).toBe(9);
      same(await sourceInventory(), sources, 'Source inventory changed during failure qualification');
    } finally {
      await fallback(failureAttempt);
    }
  }, 300000);
});
