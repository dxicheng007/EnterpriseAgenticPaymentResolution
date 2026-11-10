import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  VerificationCheckIdSchema, bootstrapAssertionCases, bootstrapRequiredAssertions, bootstrapRequiredCases,
  canonicalJson, hashActivationTrustPolicy, hashArtifact, hashBootstrapVerificationResult, hashBundleV2, hashBytes,
  hashCanonical, hashFinancialAttestation, hashFinancialReport, hashFinancialReservation, hashManifest, hashPlan,
  hashProfile, hashReviewPackage, hashSpec, hashTargetSnapshot, targetRecordId, type RawSourceEvent, type TargetState,
} from '@eapr/contracts';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { extractDocument } from '@eapr/evidence';
import { lookupReceiptAssociation, readStoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import { createSourceService, readEvidence, readEvidenceBytes, sourceFileId, streamContentHash } from '@eapr/sources';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { readActivationBundle } from '@eapr/storage/activation-registry';
import * as controlDb from '@eapr/storage/control-db';
import * as runtimeDb from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import * as composition from '../../apps/control/src/activation-composition.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import * as session from '../../apps/control/src/local-session.js';
import { loadReviewSelection } from '../../apps/control/src/review-proof-selection.js';
import { createReviewRepository } from '../../apps/control/src/review-repository.js';
import * as controlServer from '../../apps/control/src/server.js';
import * as workerServer from '../../apps/worker/src/server.js';
import * as bootstrapRunner from '../../packages/evaluator/src/bootstrap-runner.js';
import * as financialRunner from '../../packages/evaluator/src/financial-attestation-runner.js';
import { decodeBatch } from '../../packages/sources/src/company-b.js';
import * as generator from '../../scripts/generate-fixtures.js';
import * as nativeDb from '../../scripts/native-db.js';
import * as sidecar from '../../scripts/prepare-bootstrap-verification.js';
import * as proofAuthor from '../fixtures/activation-proof.js';
import * as capture from '../fixtures/evidence-v2-capture.js';
import { createSyncSelectionCatalogCsvFixture } from '../fixtures/sync-selection-catalog-csv.js';
import {
  inventory, measureBootstrapOuter, measureFinancialOuter, originalsAt, statIfPresent, writePrivateEvidence,
  type InventoryEntry, type Measurement,
} from '../fixtures/sync-selection-evidence.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const tag = hashCanonical('activation-policy').slice(0, 12);
const sourceAccount = 'cust-b-' + tag + '-1';
const scope = { companyId: 'company-b', sellerEntityId: 'seller-b', accountId: 'company-b.seller-b.' + sourceAccount };
const aScope = { companyId: 'company-a', sellerEntityId: 'seller-a', accountId: 'company-a.seller-a.cust-a-' + tag + '-1' };
const asOf = '2026-10-01T00:00:00.000Z';
const approvedAt = '2026-11-09T08:00:00.000Z';
const approvalKey = 'sync-catalog-csv-approve-b';
const months = [['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30']] as const;
const kinds = ['allocation', 'credit', 'invoice', 'payment', 'reversal'];
const checks = [...VerificationCheckIdSchema.options].sort();
const header = [
  'event_id', 'sequence', 'resource', 'kind', 'record_id', 'record_version', 'effective_at', 'observed_at',
  'account_id', 'schema_version', 'semantic_version', 'payload_json',
];
const truthFiles = ['evidence-a.json', 'evidence-b.json', 'expected-a.json', 'expected-b.json'];
const sourcePaths = [
  'tests/fixtures', 'tests/integration/sync-selection.test.ts',
  'tests/integration/sync-selection-baselines-fixture.test.ts', 'tests/integration/sync-selection-bundled-fixture.test.ts',
  'tests/integration/sync-selection-catalog-nine-fixture.test.ts', 'tests/integration/sync-selection-catalog-csv-fixture.test.ts',
  'tests/integration/sync-capture.test.ts', 'scripts/generate-fixtures.ts', 'packages/sources/src', 'packages/evaluator/src',
  'db/control', 'db/runtime', 'package-lock.json', '.local/protected-evaluator', '.local/protected-bootstrap', '.local/activation-policy',
  '.local/artifacts', 'tests/fixtures/sync-selection-catalog-csv.ts',
];
const noCapture = [
  'runtime_capture_lanes', 'runtime_capture_checkpoints', 'runtime_capture_pages', 'runtime_source_positions',
  'runtime_inbox', 'runtime_capture_incidents', 'runtime_sync_units', 'runtime_sync_application_heads',
  'runtime_sync_receipts', 'runtime_sync_economic_outcomes', 'runtime_sync_delivery_outcomes', 'runtime_sync_event_outcomes',
];
const runtimeTables = [
  ...noCapture, 'runtime_authority_heads', 'runtime_authority_commands', 'activity_counter', 'activity_events', 'parent_scopes',
  'parent_snapshots', 'parent_targets', 'parent_metadata', 'parent_financial_records', 'runtime_deliveries',
  'runtime_activation_imports', 'runtime_economic_outcomes', 'runtime_delivery_outcomes', 'runtime_import_lineage',
  'runtime_financial_origins',
];
const controlTables = [
  'review_heads', 'prepared_reviews', 'activation_intents', 'activation_receipt_observations', 'review_bootstrap_selections',
  'bootstrap_verification_jobs', 'bootstrap_verification_results', 'verification_jobs', 'verification_reports',
  'financial_verification_reservations', 'financial_verification_attestations', 'artifact_captures',
  'source_manifests', 'source_events', 'source_files', 'source_snapshots', 'source_evidence', 'source_dossiers',
  'activity_counter', 'activity_events',
];
const same = (actual: unknown, expected: unknown, label: string) => {
  assert(actual !== undefined && expected !== undefined && canonicalJson(actual) === canonicalJson(expected), label);
};
const eventOrder = (a: RawSourceEvent, b: RawSourceEvent) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const count = async (db: Pool, table: string) =>
  (await db.query<{ count: number }>('SELECT count(*)::int AS count FROM ' + table)).rows[0]!.count;

type Fixture = Awaited<ReturnType<typeof createSyncSelectionCatalogCsvFixture>>;
type Proofs = Awaited<ReturnType<typeof proofAuthor.issueActivationProofs>>;
type Capture = Awaited<ReturnType<typeof capture.captureEvidenceFixture>>;
type Worker = Awaited<ReturnType<typeof workerServer.launchWorker>>;
type Control = ReturnType<typeof controlServer.buildControl>;
type PreparedPin = Awaited<ReturnType<typeof sidecar.prepareBootstrapVerification>>;
type Attempt = {
  label: 'primary' | 'fresh' | 'failure'; root?: string; namespace?: string; dropped: boolean;
  visiblePaths?: string[]; before?: InventoryEntry[]; captures: Map<'a' | 'b', Capture>; proofs?: Proofs;
  pools: { pool: Pool; role: 'control' | 'runtime'; ended: boolean }[];
  worker?: Worker; workerClosed: boolean; control?: Control; controlClosed: boolean; composed: boolean;
  grants?: { sources: string[]; accounts: string[] }; elapsedMs?: number; measurements: Measurement[];
  sidecars: (PreparedPin & { bytes: number })[];
};
const attemptFor = (label: Attempt['label']): Attempt => ({
  label, dropped: false, captures: new Map(), pools: [], workerClosed: false, controlClosed: false,
  composed: false, measurements: [], sidecars: [],
});

async function evidenceDirectory() {
  let parent = await realpath(repository);
  for (const component of ['.superpowers', 'sdd', '2026-11-10-sync-selection-catalog-fixtures', 'evidence', 'task-C2']) {
    parent = join(parent, component);
    const info = await statIfPresent(parent);
    if (!info) await mkdir(parent, { mode: 0o700 });
    else assert(info.isDirectory(), 'Unexpected C2 evidence parent type');
    assert(await realpath(parent) === parent, 'C2 evidence parent traverses a symlink');
  }
  const configured = process.env.EAPR_SELECTION_FIXTURE_EVIDENCE_DIR;
  if (!configured) return mkdtemp(join(parent, 'run-'));
  const directory = resolve(configured);
  assert(isAbsolute(configured) && directory === configured && dirname(directory) === parent &&
    /^run-[a-zA-Z0-9_-]+$/.test(basename(directory)), 'Expected a direct C2 evidence run directory');
  const info = await statIfPresent(directory);
  if (!info) await mkdir(directory, { mode: 0o700 });
  else assert(info.isDirectory(), 'Unexpected C2 evidence run type');
  assert(await realpath(directory) === directory, 'C2 evidence run traverses a symlink');
  return directory;
}

async function sourceInventory() {
  const entries = (await Promise.all(sourcePaths.map(path => inventory(join(repository, path), path)))).flat();
  return [...new Map(entries.map(entry => [entry.path, entry])).values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function readProofs(attempt: Attempt) {
  assert(attempt.proofs && attempt.captures.size === 2, 'Missing both real proof inputs');
  const { proofs } = attempt;
  const { db } = proofs.dependencies;
  const [policy, installed, buildHash, bootstrapBuilds, registered] = await Promise.all([
    loadActivationPolicy({ policyPath: proofs.policyPath }), loadReviewSelection(proofs.selectionPath),
    readFixedFinancialBuildHash(), readFixedBootstrapBuildPins(), proofs.scopeReader.readSnapshot(),
  ]);
  assert(policy.hash === hashActivationTrustPolicy(policy) && policy.entries.length === 2, 'Installed A/B trust policy');
  same(installed, { policyId: policy.policyId, entries: [proofs.a.selection, proofs.b.selection] }, 'Installed A/B selection');
  const registry = createFinancialAttestationRegistry(db, proofs.candidates);
  const load = async (company: 'a' | 'b') => {
    const issued = proofs[company];
    const { input } = attempt.captures.get(company)!;
    const expectedScope = company === 'a' ? aScope : scope;
    const sourceRef = company === 'a' ? 'legacy-a' : 'legacy-b';
    const { artifactHash, manifestId, selectedProfileHash, financialReportId, bootstrapFixture } = issued.selection;
    const candidate = await proofs.candidates.getCandidate(artifactHash, manifestId);
    const profile = candidate.profiles[0]!;
    const [entry, duplicate] = policy.entries.filter(item => item.scope.accountId === expectedScope.accountId &&
      item.artifactHash === artifactHash && item.selectedProfileHash === selectedProfileHash && item.capture.manifestId === manifestId);
    assert(entry && !duplicate && candidate.profiles.length === 1 && profile.hash === selectedProfileHash &&
      profile.hash === hashProfile(profile) && artifactHash === hashArtifact(candidate.artifact) &&
      candidate.artifact.specHash === hashSpec(candidate.spec) && input.manifest.hash === hashManifest(input.manifest),
    'Exact registered candidate and policy entry ' + company);
    same(profile.scope, expectedScope, 'Selected profile scope ' + company);
    same(entry.scope, expectedScope, 'Policy scope ' + company);
    same(registered.resolveRegisteredScope(expectedScope.accountId)?.profile, profile, 'Published scope ' + company);
    same(candidate.manifest, input.manifest, 'Registered capture manifest ' + company);
    same(candidate.snapshot, input.snapshot, 'Registered capture snapshot ' + company);
    same(entry.capture, {
      companyId: expectedScope.companyId, sourceRef, manifestId, manifestHash: input.manifest.hash,
      snapshotId: input.snapshot.id, snapshotHash: input.snapshot.contentHash, snapshotObjectHash: hashCanonical(input.snapshot),
      eventsHash: hashCanonical(input.events.toSorted(eventOrder)),
    }, 'Exact full capture binding ' + company);
    same(entry.requiredProfileHashes, [profile.hash], 'Policy required profile set ' + company);
    same(candidate.artifact.requiredProfileHashes, [profile.hash], 'Artifact required profile set ' + company);
    same(candidate.artifact.normalizedPlan.allowedKinds.toSorted(), kinds, 'Five financial mapping kinds ' + company);
    same(entry.bootstrapPin, {
      runnerId: 'eapr-bootstrap-1', protocolVersion: '1', ...bootstrapBuilds, ...bootstrapFixture,
    }, 'Installed bootstrap pin and builds ' + company);
    const { report, attestation } = await registry.readRegisteredFinancialAttestation(financialReportId, {
      artifactHash, requiredProfileHashes: candidate.artifact.requiredProfileHashes, capture: entry.capture, policy,
    });
    const { reservation } = attestation;
    const jobId = 'activation-policy:' + company + ':first';
    assert(report.eligible && report.unexplainedDifferenceCents === 0 && report.checks.every(item =>
      item.status === 'passed' && item.cases > 0 && item.diagnosticCodes.length === 0), 'Complete passing financial report ' + company);
    same(report.checks.map(item => item.id).sort(), checks, 'Exact mandatory financial checks ' + company);
    same({
      required: report.coverage.required.toSorted(), executed: report.coverage.executed.toSorted(),
      profileHashes: report.coverage.profileHashes, sourceRefs: report.coverage.sourceRefs,
      eventKinds: report.coverage.eventKinds.toSorted(),
    }, { required: checks, executed: checks, profileHashes: [profile.hash], sourceRefs: [sourceRef], eventKinds: kinds },
    'Exact financial coverage ' + company);
    assert(report.id === 'report:' + jobId && report.id === financialReportId && attestation.reportId === report.id &&
      report.artifactHash === artifactHash && report.manifestHash === input.manifest.hash &&
      report.evaluatorBuildHash === buildHash && report.fixtureSetId === bootstrapFixture.fixtureSetId &&
      report.fixtureSetId === reservation.evidencePin.fixtureSetId && report.fixtureSetVersion === '2' &&
      reservation.evidencePin.fixtureSetVersion === '2' && reservation.evaluatorBuildHash === buildHash &&
      reservation.jobId === jobId && reservation.artifactHash === artifactHash && reservation.purpose === 'construction' &&
      attestation.reportHash === hashFinancialReport(report) && attestation.hash === hashFinancialAttestation(attestation) &&
      reservation.hash === hashFinancialReservation(reservation), 'Immutable financial report and reservation ' + company);
    same(report.profileHashes, [profile.hash], 'Financial report profile set ' + company);
    same(reservation.requiredProfileHashes, [profile.hash], 'Financial reservation profile set ' + company);
    same(reservation.capture, entry.capture, 'Attestation capture ' + company);
    same(entry.financial, {
      runnerId: reservation.runnerId, protocolVersion: reservation.protocolVersion, harnessVersion: reservation.harnessVersion,
      evaluatorBuildHash: buildHash, evidencePin: reservation.evidencePin,
    }, 'Financial trust binding ' + company);
    assert(entry.issuerId === reservation.issuerId, 'Financial trust issuer ' + company);
    return { candidate, profile, entry, report, attestation };
  };
  const [a, b] = await Promise.all([load('a'), load('b')]);
  return { a, b, policy };
}
type ProofRead = Awaited<ReturnType<typeof readProofs>>;

function expectedTarget(citation: string): TargetState {
  const base = (kind: 'invoice' | 'payment' | 'allocation', recordId: string, day: string) => {
    const identity = { sourceRef: 'legacy-b', sellerEntityId: 'seller-b', kind, recordId };
    return {
      id: targetRecordId(identity), identity, scope, sourceEventId: 'evt:' + recordId, sourceRecordVersion: 1,
      effectiveAt: day + 'T00:00:00.000Z', amountCents: 300000, currency: 'USD' as const,
    };
  };
  const monthly = months.map(([day, dueDate]) => {
    const suffix = sourceAccount + '-' + day;
    const bill = 'inv-b:' + suffix;
    const receipt = 'pay-b:' + suffix;
    return {
      invoice: { ...base('invoice', bill, day), kind: 'invoice' as const, dueDate },
      payment: { ...base('payment', receipt, day), kind: 'payment' as const },
      allocation: { ...base('allocation', 'alloc-b:' + suffix, day), kind: 'allocation' as const,
        fundingKind: 'payment' as const, fundingRecordId: receipt, invoiceRecordId: bill },
    };
  });
  return {
    scope, asOf, version: 1, invoices: monthly.map(item => item.invoice), payments: monthly.map(item => item.payment),
    allocations: monthly.map(item => item.allocation), credits: [], reversals: [],
    customers: [{ id: 'buyer-shared-' + tag, displayName: 'Shared Buyer ' + tag, evidenceRefs: [citation] }],
    accounts: [{ id: scope.accountId, scope, parentCustomerId: 'buyer-shared-' + tag, sourceRef: 'legacy-b', sourceAccountIds: [sourceAccount] }],
    billingConfigurations: [{ id: 'configuration:demo-term-b', scope, contractTerm: {
      id: 'demo-term-b', contractId: 'contract-b-' + tag + '-1', validFrom: '2026-07-01', validToExclusive: null,
      fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs: [citation],
    } }],
  };
}

async function qualifyCsv(fixture: Fixture, attempt: Attempt) {
  assert(attempt.root && attempt.before && attempt.proofs, 'Missing retained original input observations');
  const { dependencies } = attempt.proofs;
  const b = attempt.captures.get('b')!;
  const { bundle, activation, plan } = fixture.subject.stored;
  const { manifest, snapshot, events } = b.input;
  same(bundle.manifest, manifest, 'Imported exact Company B manifest');
  same(bundle.snapshot, snapshot, 'Imported exact Company B snapshot');
  same(bundle.bootstrapEvents.toSorted(eventOrder), events.toSorted(eventOrder), 'Imported whole captured event set');
  same(bundle.artifact.normalizedPlan.capture.map(({ streamId, transport }) => [streamId, transport]).sort(),
    [['b-files', 'csv'], ['b-receipts', 'api'], ['b-semantics', 'semantic']], 'Actual compiled CSV/API/semantic transports');
  const baselines = [['b-files', '18'], ['b-receipts', '10'], ['b-semantics', '0']] as const;
  same(activation.baselineCursors, baselines.map(([streamId, resumeAfter]) => ({ streamId, resumeAfter })), 'Complete activation baseline');
  assert(manifest.streams.length === 3 && events.length === 28 && snapshot.eventIds.length === 28, 'Complete B event cardinality');
  const readEvents = await createSourceService(dependencies, localSourceCatalog).getSnapshotRecords(snapshot.id);
  same(readEvents.toSorted(eventOrder), events.toSorted(eventOrder), 'Committed source snapshot records');
  for (const [streamId, resumeAfter] of baselines) {
    const stream = manifest.streams.find(item => item.streamId === streamId);
    assert(stream, 'Missing B stream ' + streamId);
    const members = events.filter(event => event.streamId === streamId).sort((a, b) => a.sequence - b.sequence);
    assert(stream.resumeAfter === resumeAfter && members.length === Number(resumeAfter) &&
      stream.snapshotId === 'member:' + manifest.id + ':' + streamId &&
      stream.snapshotHash === streamContentHash('legacy-b', streamId, resumeAfter, members), 'Exact B stream binding ' + streamId);
    same(stream.eventIds, members.map(event => event.id), 'Exact B stream membership ' + streamId);
  }
  const unresolved = events.find(event => event.id === 'evt:pay-b:unresolved-' + tag);
  assert(unresolved?.streamId === 'b-receipts' && unresolved.kind === 'payment' &&
    unresolved.payload.amount_minor === 30000 && unresolved.rawIdentity.sourceAccountId === 'cust-b-unknown-' + tag &&
    !plan.eventIds.includes(unresolved.id), 'Unknown account receipt is retained only as source evidence');
  const authorized = async (binding: { companyId: string; sourceRef: string }) => {
    assert(binding.companyId === 'company-b' && binding.sourceRef === 'legacy-b', 'Evidence scope differs');
  };
  const files = [
    ...[1, 2, 3].map(sequence => ({ name: 'b-batch-' + sequence + '.csv', kind: 'event_csv' as const, sequence })),
    ...[1, 2, 3].map(sequence => ({ name: 'b-contract-' + sequence + '.pdf', kind: 'contract_pdf' as const, sequence: 0 })),
    { name: 'b-remittance.json', kind: 'email_json', sequence: 0 },
  ] as const;
  assert(manifest.files.length === files.length, 'Complete B file count');
  const selectedCsv = [];
  const csvEvidence = [];
  let firstContractCitation: string | undefined;
  for (const { name, kind, sequence } of files) {
    const documentId = 'doc-b-' + tag + '-' + name.split('.')[0];
    const fileId = sourceFileId({ companyId: 'company-b', sourceRef: 'legacy-b', documentId, documentVersion: 1, kind, originalName: name });
    const file = manifest.files.find(item => item.fileId === fileId);
    const initial: InventoryEntry | undefined = attempt.before.find(item => item.path === 'visible/' + name);
    const local: Buffer = await readFile(join(attempt.root, 'visible', name));
    assert(file && initial && 'sha256' in initial && file.sha256 === initial.sha256 &&
      file.sha256 === hashBytes(local) && local.length === initial.bytes, 'Original manifest bytes ' + name);
    same(file, { fileId, documentId, documentVersion: 1, kind, sha256: initial.sha256,
      ...(sequence ? { batchId: 'batch-b-' + tag + '-' + sequence, streamId: 'b-files', sequence } : {}),
    }, 'Exact B document/batch metadata ' + name);
    const citation = b.input.citations.find(({ evidence }) => evidence.sourceId === fileId &&
      (kind !== 'contract_pdf' || evidence.locator.kind === 'pdf' && evidence.locator.page === 1));
    assert(citation && snapshot.evidenceIds.includes(citation.evidence.id), 'Captured file citation ' + name);
    const [evidence, original] = await Promise.all([
      readEvidence(dependencies.db, citation.evidence.id, authorized),
      readEvidenceBytes(dependencies.db, dependencies.store, citation.evidence.id, authorized),
    ]);
    assert(evidence.evidence.sourceId === fileId && evidence.evidence.snapshotId === snapshot.id &&
      evidence.original.sha256 === file.sha256 && evidence.original.byteLength === local.length &&
      local.equals(Buffer.from(original.bytes)), 'Authoritative original readback ' + name);
    if (name === 'b-contract-1.pdf') {
      assert(fileId === b.contractFileId, 'Own captured agreement');
      firstContractCitation = citation.evidence.id;
    }
    if (kind !== 'event_csv') continue;
    const { document } = await extractDocument('event_csv', original.bytes);
    assert(document.kind === 'csv' && document.rows.length === 6 && original.mediaType === 'text/csv', 'Six genuine CSV rows ' + name);
    same(document.headers, header, 'Exact Company B CSV header');
    const decoded = decodeBatch('b-files', document);
    const day = months[sequence - 1]![0];
    const literalIds = [1, 2, 3].flatMap(index => ['inv-b:', 'alloc-b:'].map(prefix =>
      'evt:' + prefix + 'cust-b-' + tag + '-' + index + '-' + day));
    same(decoded.map(event => event.id), literalIds, 'All six literal monthly CSV members ' + name);
    same(decoded, readEvents.filter(event => event.streamId === 'b-files' &&
      event.sequence > (sequence - 1) * 6 && event.sequence <= sequence * 6), 'All decoded rows are exact captured members ' + name);
    assert(decoded.every(event => event.schemaVersion === 'schema-b-1' && event.semanticVersion === 'sem-b-1' &&
      event.recordVersion === 1 && event.effectiveAt === day + 'T00:00:00.000Z'), 'Literal CSV event identity ' + name);
    selectedCsv.push(...decoded.filter(event => event.rawIdentity.sourceAccountId === sourceAccount).map(event => event.id));
    csvEvidence.push({ fileId, batchId: file.batchId, sha256: file.sha256, bytes: local.length, eventIds: literalIds });
  }
  assert(firstContractCitation, 'Missing own page-one contract citation');
  const target = expectedTarget(firstContractCitation);
  same(selectedCsv.sort(), [...target.invoices, ...target.allocations].map(record => record.sourceEventId).sort(),
    'Every selected invoice and allocation belongs to its actual CSV batch');
  return { target, csvEvidence };
}

async function qualifyImport(fixture: Fixture, attempt: Attempt, proofs: ProofRead) {
  const { db, subject: { stored, identity } } = fixture;
  const { bundle, receipt, activation, request, plan, approvedTarget } = stored;
  const { reviewPackage, bootstrapVerification: bootstrap } = bundle;
  const { b, policy } = proofs;
  const { target, csvEvidence } = await qualifyCsv(fixture, attempt);
  const sortedTarget = (value: TargetState) => ({
    ...value, invoices: value.invoices.toSorted((a, b) => a.sourceEventId.localeCompare(b.sourceEventId)),
    payments: value.payments.toSorted((a, b) => a.sourceEventId.localeCompare(b.sourceEventId)),
    allocations: value.allocations.toSorted((a, b) => a.sourceEventId.localeCompare(b.sourceEventId)),
  });
  same(sortedTarget(approvedTarget.records), sortedTarget(target), 'Full independently authored B target');
  try { proofAuthor.verifyOriginals(approvedTarget.records, 'b'); }
  catch { throw new Error('Company B original-record compatibility failed'); }
  const records = [...target.invoices, ...target.payments, ...target.allocations];
  same(receipt.eventIds.toSorted(), records.map(record => record.sourceEventId).sort(), 'Exactly nine selected receipt events');
  same(receipt.targetRecordIds.toSorted(), records.map(record => record.id).sort(), 'Exactly nine selected receipt targets');
  same({ ...receipt, eventIds: [], targetRecordIds: [] }, {
    id: receipt.id, scope, activationId: activation.id, epoch: 1, artifactHash: b.candidate.artifact.hash,
    planHash: plan.hash, eventIds: [], targetRecordIds: [], beforeBalanceCents: 0, afterBalanceCents: 0,
    status: 'applied', committedAt: approvedAt,
  }, 'Own first receipt and literal zero balances');
  same(identity, { scope, activationId: activation.id, bundleHash: stored.bundleHash }, 'Committed authority identity');
  same(bundle.artifact, b.candidate.artifact, 'Exact imported registered artifact');
  same(bundle.profiles, b.candidate.profiles, 'Exact imported registered profiles');
  same(bundle.verificationReport, b.report, 'Exact imported financial report');
  same(bundle.financialAttestation, b.attestation, 'Exact imported financial attestation');
  same(bundle.authorityPolicy, { issuerId: b.entry.issuerId, policyId: policy.policyId, policyHash: policy.hash }, 'Exact imported policy');
  same(bundle.previewPlan, plan, 'Committed plan is the reviewed plan');
  same(request, bundle.request, 'Stored exact activation request');
  same(request, {
    reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash, expectedArtifactHash: b.candidate.artifact.hash,
    expectedProfileHash: b.profile.hash, expectedTargetVersion: 0, idempotencyKey: approvalKey,
  }, 'Exact prepared-package activation request');
  same(bootstrap.pin, b.entry.bootstrapPin, 'Selected real bootstrap pin');
  same(bootstrap.binding, {
    artifactHash: b.candidate.artifact.hash, profileHash: b.profile.hash, requiredProfileHashes: [b.profile.hash],
    scope, manifestId: bundle.manifest.id, manifestHash: bundle.manifest.hash, snapshotId: bundle.snapshot.id,
    snapshotHash: bundle.snapshot.contentHash, eventsHash: b.entry.capture.eventsHash,
    targetSnapshotHash: hashTargetSnapshot(stored.plannerTarget), expectedTargetVersion: 0, asOf,
  }, 'Exact selected bootstrap target/capture binding');
  same(bootstrap.cases, bootstrapRequiredCases.map(id => ({ id, status: 'passed' })), 'All real bootstrap cases passed');
  same(bootstrap.assertions, bootstrapRequiredAssertions.map(id => ({
    id, status: 'passed', caseIds: bootstrapRequiredCases.filter(caseId => bootstrapAssertionCases[id].includes(caseId)),
  })), 'All real bootstrap assertions passed with exact case coverage');
  assert(bootstrap.passed && bootstrap.planHash === plan.hash && bootstrap.hash === hashBootstrapVerificationResult(bootstrap) &&
    reviewPackage.ready && reviewPackage.revision === 1 && reviewPackage.hash === hashReviewPackage(reviewPackage) &&
    reviewPackage.verificationReportId === b.report.id && reviewPackage.previewPlanHash === plan.hash &&
    reviewPackage.manifestHash === bundle.manifest.hash && plan.hash === hashPlan(plan) && plan.asOf === asOf &&
    plan.expectedBalanceCents === 0 && approvedTarget.snapshotHash === hashTargetSnapshot(approvedTarget.records) &&
    bundle.hash === hashBundleV2(bundle) && bundle.hash === stored.bundleHash && stored.requestHash === hashCanonical(request),
  'Immutable bootstrap, plan, review, request and bundle digests');
  const selectedEvents = new Map(bundle.bootstrapEvents.map(event => [event.id, event]));
  for (const record of records) {
    const event = selectedEvents.get(record.sourceEventId);
    const index = plan.operations.findIndex(operation => operation.record.id === record.id);
    const lineage = plan.lineage.filter(item => item.operationIndex === index);
    assert(event && event.rawIdentity.sourceAccountId === sourceAccount && event.rawIdentity.companyId === 'company-b' &&
      event.rawIdentity.sellerEntityId === 'seller-b' && event.schemaVersion === 'schema-b-1' && event.semanticVersion === 'sem-b-1' &&
      event.recordId === record.identity.recordId && event.recordVersion === 1 && event.effectiveAt === record.effectiveAt &&
      index >= 0 && lineage.some(item => item.targetField === '/amountCents' &&
        item.sourceEventIds.includes(event.id) && item.sourcePaths.includes('/amount_minor')),
    'Own captured financial lineage');
  }
  const ownCitation = target.customers[0]!.evidenceRefs[0]!;
  for (const op of ['ensure_customer', 'ensure_account', 'ensure_billing_configuration']) {
    const index = plan.operations.findIndex(operation => operation.op === op);
    assert(index >= 0 && plan.lineage.some(item => item.operationIndex === index && item.evidenceRefs.includes(ownCitation)),
      'Own first-contract citation in metadata lineage');
  }

  const { dependencies, registryRoot } = attempt.proofs!;
  const repository = createReviewRepository(dependencies.db, dependencies.clock);
  const [prepared, intent, published] = await Promise.all([
    repository.readPrepared(scope.accountId, reviewPackage.hash),
    repository.readIntentByKey(approvalKey),
    readActivationBundle({ registryRoot }, stored.bundleHash),
  ]);
  assert(prepared?.sourceRef === 'legacy-b' && intent?.sourceRef === 'legacy-b' && intent.accountId === scope.accountId &&
    intent.bundleHash === stored.bundleHash && intent.requestHash === stored.requestHash, 'Real prepare and committed intent');
  same(prepared.review, reviewPackage, 'Read-back prepared package');
  same(intent.request, request, 'Read-back committed request');
  same(intent.bundle, bundle, 'Read-back committed bundle');
  same(published, bundle, 'Read-back published bundle');
  await withTransaction(db, async client => {
    same(await readStoredActivation(client, scope), stored, 'A5 durable activation readback');
    same(await readStoredTarget(client, scope), approvedTarget, 'A5 durable target readback');
    const found = await lookupReceiptAssociation(client, approvalKey, { scope, requestHash: stored.requestHash, bundleHash: stored.bundleHash });
    assert(found.status === 'exact', 'Exact durable B receipt association');
    same(found.stored.receipt, receipt, 'Authoritative runtime receipt');
    const origins = await readFinancialOrigins(client, scope, records);
    same(origins.toSorted((a, b) => a.recordId.localeCompare(b.recordId)), records.map(record => ({
      kind: 'initial', recordId: record.id, importKey: approvalKey, receipt,
    })).sort((a, b) => a.recordId.localeCompare(b.recordId)), 'All nine own initial financial origins');
  });
  return { csvEvidence, intentId: intent.intentId };
}

async function durableDigest(db: Pool, tables: string[]) {
  return withTransaction(db, async client => {
    const digests = [];
    for (const table of tables) {
      const { rows } = await client.query<{ json: string }>('SELECT to_jsonb(saved)::text AS json FROM ' + table + ' AS saved ORDER BY json');
      digests.push(hashCanonical(rows.map(item => item.json)));
    }
    return hashCanonical(digests);
  });
}

async function qualifyInventory(fixture: Fixture, attempt: Attempt) {
  const { db, subject: { stored } } = fixture;
  const control = attempt.proofs!.dependencies.db;
  same(attempt.grants, { sources: ['legacy-b'], accounts: [scope.accountId] }, 'Only B reviewer grants');
  const { rows } = await db.query(
    'SELECT capture_source_ref, account_id, company_id, seller_entity_id, idempotency_key, activation_id, receipt_id, ' +
    'bundle_hash, capture_manifest_hash, request_digest, plan_hash FROM runtime_activation_imports ORDER BY capture_source_ref, account_id',
  );
  same(rows, [{
    capture_source_ref: 'legacy-b', account_id: scope.accountId, company_id: scope.companyId, seller_entity_id: scope.sellerEntityId,
    idempotency_key: approvalKey, activation_id: stored.activation.id, receipt_id: stored.receipt.id, bundle_hash: stored.bundleHash,
    capture_manifest_hash: stored.bundle.manifest.hash, request_digest: stored.requestHash, plan_hash: stored.plan.hash,
  }], 'Entire scalar runtime selecting inventory contains exactly one B import');
  assert(await count(db, 'runtime_activation_imports') === 1 && await count(db, 'runtime_financial_origins') === 9,
    'Independent exact selecting and origin counts');
  for (const table of noCapture) assert(await count(db, table) === 0, 'Unexpected capture or sync rows in ' + table);
  for (const table of ['parent_scopes', 'parent_targets', 'parent_snapshots', 'parent_metadata', 'parent_financial_records',
    'runtime_financial_origins', 'runtime_authority_heads', 'runtime_authority_commands', 'runtime_activation_imports']) {
    const { rowCount } = await db.query('SELECT 1 FROM ' + table + ' WHERE company_id = $1 OR account_id = $2', ['company-a', aScope.accountId]);
    assert(rowCount === 0, 'Incidental A has durable selecting state in ' + table);
  }
  same((await control.query('SELECT account_id, source_ref FROM prepared_reviews ORDER BY account_id')).rows,
    [{ account_id: scope.accountId, source_ref: 'legacy-b' }], 'Only B selecting review request');
  same((await control.query('SELECT account_id, source_ref, idempotency_key FROM activation_intents ORDER BY account_id')).rows,
    [{ account_id: scope.accountId, source_ref: 'legacy-b', idempotency_key: approvalKey }], 'Only B selecting intent');
  same((await control.query('SELECT account_id FROM review_heads ORDER BY account_id')).rows,
    [{ account_id: scope.accountId }], 'No incidental A review head');
  assert(await count(control, 'verification_reports') === 2 && await count(control, 'bootstrap_verification_results') === 1,
    'Two genuine financial proofs and only the selected bootstrap result');
  const before = await Promise.all([durableDigest(db, runtimeTables), durableDigest(control, controlTables)]);
  await withTransaction(db, async client => {
    assert(await readStoredActivation(client, aScope) === null && await readStoredTarget(client, aScope) === null,
      'Incidental A has no A5 activation or target');
    same(await readStoredActivation(client, scope), stored, 'Own durable activation');
    same(await readStoredTarget(client, scope), stored.approvedTarget, 'Own durable target');
  });
  await qualifyCsv(fixture, attempt);
  same(await Promise.all([durableDigest(db, runtimeTables), durableDigest(control, controlTables)]), before,
    'Actual source and A5 readback preserved durable state');
}

function financialEvidence({ report, attestation }: ProofRead['b']) {
  return {
    reportId: report.id, reportHash: attestation.reportHash, attestationHash: attestation.hash,
    reservationHash: attestation.reservation.hash, artifactHash: report.artifactHash, manifestHash: report.manifestHash,
    profileHashes: report.profileHashes, capture: attestation.reservation.capture, evidencePin: attestation.reservation.evidencePin,
    evaluatorBuildHash: report.evaluatorBuildHash, checks: report.checks.map(({ id, status, cases }) => ({ id, status, cases })),
    coverage: report.coverage, eligible: report.eligible,
  };
}

function qualifyMeasurements(attempt: Attempt, proofs: ProofRead, fixture?: Fixture) {
  const observed = attempt.measurements;
  const expected = [proofs.a, proofs.b].flatMap(proof => ['financial-probe', 'financial-launch'].map(stage => ({
    stage, jobId: proof.attestation.reservation.jobId, manifestHash: proof.report.manifestHash,
  })));
  if (fixture) expected.push({
    stage: 'bootstrap', jobId: fixture.subject.stored.bundle.bootstrapVerification.jobId, manifestHash: proofs.b.report.manifestHash,
  });
  same(observed.map(({ stage, jobId, manifestHash }) => ({ stage, jobId, manifestHash })), expected, 'Exact same-run evaluator invocations');
  assert(observed.every(item => item.status === 'ok' && item.elapsedMs > 0 && item.elapsedMs <= 120000 &&
    item.requestJsonBytes > 0 && item.framedRequestBytes === item.requestJsonBytes + 1 && item.framedRequestBytes <= 10485760 &&
    item.framedContextBytes > 1 && item.framedContextBytes <= 10485760 && (item.returnedResponseObjectJsonBytes ?? 0) > 0),
  'Complete successful outer measurements');
  for (const index of [0, 2]) {
    const bytes = observed[index]!.evidencePinBytes ?? 0;
    assert(bytes > 0 && bytes <= 10485760 && observed[index + 1]!.evidencePinBytes === bytes, 'Exact evidence pin for financial pair');
  }
  same(attempt.sidecars.map(({ fixtureSetId, fixtureSetVersion, hash }) => ({ fixtureSetId, fixtureSetVersion, fixtureHash: hash })),
    [proofs.a, proofs.b].map(({ entry: { bootstrapPin: pin } }) => ({
      fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, fixtureHash: pin.fixtureHash,
    })), 'Both genuine prepared sidecars');
  assert(attempt.sidecars.every(pin => pin.bytes > 0 && pin.bytes <= 10485760) &&
    (!fixture || observed[4]!.sidecarBytes === attempt.sidecars[1]!.bytes), 'Actual sidecar lengths and B reuse');
}

describe('csv catalog fixture qualification', () => {
  const primaryAttempt = attemptFor('primary');
  const freshAttempt = attemptFor('fresh');
  const failureAttempt = attemptFor('failure');
  const attempts = [primaryAttempt, freshAttempt, failureAttempt];
  const sentinel = new Error('Deliberate C2 failure after real review composition');
  const restore: (() => void)[] = [];
  let active = primaryAttempt;
  let primary: Fixture | undefined;
  let directory: string;
  let sources: InventoryEntry[];
  let failedProofs: ProofRead;
  const save = (attempt: Attempt, phase: string, data: unknown) =>
    writePrivateEvidence(join(directory, attempt.label + '-' + phase + '.json'), data);

  async function saveOriginals(attempt: Attempt, phase: string) {
    assert(attempt.root && attempt.before, 'Missing original file inventory');
    const entries = await originalsAt(attempt.root);
    await save(attempt, phase, entries);
    same(entries, attempt.before, 'All original A/B input bytes preserved');
  }

  function saveMeasurements(attempt: Attempt) {
    return save(attempt, 'outer-measurements', {
      invocations: attempt.measurements, sidecars: attempt.sidecars, constructionElapsedMs: attempt.elapsedMs,
      requestAndContext: 'UTF-8 schema-normalized request JSON and actual context JSON, each plus one LF',
      response: 'UTF-8 JSON serialization of parsed successful response value',
      rawResponseWireBytes: 'unobserved', individualNestedBytesAndElapsedMs: 'unobserved',
      unchangedEnforcement: {
        transportRejectsFramedInputContextAndCombinedOutputGreaterThanBytes: 10485760,
        financialRegistryRejectsCanonicalBytesGreaterThanOrEqualTo: 10485760,
        outerTimeoutMs: 120000, nestedTimeoutMs: 5000,
      },
    });
  }

  async function construct(attempt: Attempt) {
    active = attempt;
    const start = performance.now();
    try { return await createSyncSelectionCatalogCsvFixture(); }
    finally { attempt.elapsedMs = performance.now() - start; }
  }

  async function cleanupEvidence(attempt: Attempt) {
    assert(attempt.namespace && attempt.root && attempt.worker && attempt.pools.length === 2, 'Incomplete acquired-resource observations');
    const cleanup = {
      namespace: attempt.namespace, dropped: attempt.dropped, rootAbsent: !await statIfPresent(attempt.root),
      listenerStopped: !attempt.worker.server.listening, workerClosed: attempt.workerClosed,
      controlCreated: !!attempt.control, controlClosed: attempt.controlClosed,
      pools: attempt.pools.map(({ role, ended }) => ({ role, ended })),
    };
    await save(attempt, 'cleanup', cleanup);
    assert(cleanup.dropped && cleanup.rootAbsent && cleanup.listenerStopped && cleanup.workerClosed &&
      cleanup.pools.every(pool => pool.ended) && (attempt.label === 'failure' ? !cleanup.controlCreated :
        cleanup.controlCreated && cleanup.controlClosed), 'Complete awaited resource cleanup');
    same(cleanup.pools.map(pool => pool.role).sort(), ['control', 'runtime'], 'Both application pools ended');
  }

  async function fallback(attempt: Attempt) {
    const failures = [];
    const tryCleanup = async (action: () => Promise<unknown>) => {
      try { await action(); } catch (error) { failures.push(error); }
    };
    if (attempt.control && !attempt.controlClosed) await tryCleanup(() => attempt.control!.close());
    if (attempt.worker?.server.listening) await tryCleanup(() => attempt.worker!.close());
    for (const pool of attempt.pools.toReversed()) if (!pool.ended) await tryCleanup(() => pool.pool.end());
    if (attempt.namespace && !attempt.dropped) await tryCleanup(() => nativeDb.dropTest(attempt.namespace!));
    if (attempt.root && await statIfPresent(attempt.root)) await tryCleanup(() => rm(attempt.root!, { recursive: true, force: true }));
    assert(failures.length === 0, 'Fallback owned-resource cleanup failed');
  }

  async function closeSuccess(attempt: Attempt, fixture: Fixture, twice = false) {
    try { await saveOriginals(attempt, 'before-cleanup'); }
    finally {
      const first = fixture.close();
      const second = twice ? fixture.close() : first;
      await Promise.all([first, second]);
      assert(first === second, 'Idempotent close shares the cleanup promise');
    }
    await cleanupEvidence(attempt);
  }

  function observePool(pool: Pool, role: 'control' | 'runtime') {
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

  async function savePassing(fixture: Fixture, attempt: Attempt) {
    const proofs = await readProofs(attempt);
    const { csvEvidence, intentId } = await qualifyImport(fixture, attempt, proofs);
    qualifyMeasurements(attempt, proofs, fixture);
    await saveOriginals(attempt, 'after-proof-import');
    const { stored } = fixture.subject;
    const { bootstrapVerification: bootstrap, reviewPackage } = stored.bundle;
    await save(attempt, 'proofs', {
      a: financialEvidence(proofs.a), b: financialEvidence(proofs.b), policyHash: proofs.policy.hash,
      bootstrap: { id: bootstrap.id, hash: bootstrap.hash, pin: bootstrap.pin, binding: bootstrap.binding,
        cases: bootstrap.cases, assertions: bootstrap.assertions },
      csv: csvEvidence, intentId, reviewPackageId: reviewPackage.id, reviewPackageHash: reviewPackage.hash,
      requestKey: approvalKey, requestHash: stored.requestHash, planHash: stored.plan.hash, bundleHash: stored.bundleHash,
      activationId: stored.activation.id, receiptId: stored.receipt.id, approvedTargetHash: stored.approvedTarget.snapshotHash,
      receiptEventIds: stored.receipt.eventIds, receiptTargetIds: stored.receipt.targetRecordIds,
    });
    await saveMeasurements(attempt);
  }

  beforeAll(async () => {
    directory = await evidenceDirectory();
    sources = await sourceInventory();
    const generate = generator.generateFixtures;
    const generateSpy = vi.spyOn(generator, 'generateFixtures').mockImplementation(async input => {
      const attempt = active;
      const output = await generate(input);
      attempt.visiblePaths = output.visiblePaths;
      return output;
    });
    restore.push(() => generateSpy.mockRestore());

    const captureReal = capture.captureEvidenceFixture;
    const captureSpy = vi.spyOn(capture, 'captureEvidenceFixture').mockImplementation(async (...args) => {
      const attempt = active;
      const [dependencies, { visibleRoot, truthRoot }, company] = args;
      if (!attempt.root) {
        assert(company === 'a' && attempt.visiblePaths, 'Observe both original sets before first real publication');
        attempt.root = dirname(visibleRoot);
        assert(visibleRoot === join(attempt.root, 'visible') && truthRoot === join(attempt.root, 'truth') &&
          await realpath(attempt.root) === attempt.root, 'Exact owned canonical input roots');
        attempt.before = await originalsAt(attempt.root);
        same(attempt.before.map(item => item.path).sort(),
          [...attempt.visiblePaths.map(name => 'visible/' + name), ...truthFiles.map(name => 'truth/' + name)].sort(),
          'Complete A/B original path inventory');
        const visible = attempt.visiblePaths;
        for (const name of ['a', 'b']) for (const type of ['manifest', 'accounts', 'uploads', 'api', 'api-originals']) {
          assert(visible.includes(type + '-' + name + '.json'), 'Missing A/B generated source index');
        }
        assert(visible.filter(path => path.startsWith('api-a/')).length === 30 &&
          visible.filter(path => path.startsWith('api-b/')).length === 10 && attempt.before.length === 66 &&
          attempt.before.every(item => 'bytes' in item && item.bytes > 0), 'Complete nonempty generated input corpus');
        await save(attempt, 'before-publication', attempt.before);
        for (const table of ['source_manifests', 'source_files', 'source_events', 'artifact_captures']) {
          assert(await count(dependencies.db, table) === 0, 'Inventory precedes source publication');
        }
      }
      assert(!attempt.captures.has(company), 'Unexpected second capture');
      const captured = await captureReal(...args);
      attempt.captures.set(company, captured);
      return captured;
    });
    restore.push(() => captureSpy.mockRestore());

    const issue = proofAuthor.issueActivationProofs;
    const issueSpy = vi.spyOn(proofAuthor, 'issueActivationProofs').mockImplementation(async (...args) => {
      const attempt = active;
      assert(!attempt.proofs, 'Unexpected second proof author invocation');
      const proofs = await issue(...args);
      assert(proofs.dependencies.db === args[1] && args[0] === attempt.root, 'Observed owned proof and control dependencies');
      attempt.proofs = proofs;
      return proofs;
    });
    restore.push(() => issueSpy.mockRestore());

    const provision = nativeDb.provisionTest;
    const provisionSpy = vi.spyOn(nativeDb, 'provisionTest').mockImplementation(async namespace => {
      const attempt = active;
      assert(!attempt.namespace, 'Attempt already has a namespace');
      const pair = await provision(namespace);
      attempt.namespace = namespace;
      return pair;
    });
    restore.push(() => provisionSpy.mockRestore());
    const drop = nativeDb.dropTest;
    const dropSpy = vi.spyOn(nativeDb, 'dropTest').mockImplementation(async namespace => {
      const owner = attempts.find(attempt => attempt.namespace === namespace);
      assert(owner && !owner.dropped && owner.pools.every(pool => pool.ended) &&
        !owner.worker?.server.listening && (!owner.control || owner.controlClosed), 'Drop only the owned namespace after listener and pool cleanup');
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
    const workerSpy = vi.spyOn(workerServer, 'launchWorker').mockImplementation(async (...args) => {
      const attempt = active;
      const worker = await launch(...args);
      attempt.worker = worker;
      const close = worker.close.bind(worker);
      const spy = vi.spyOn(worker, 'close').mockImplementation((async () => {
        await close();
        attempt.workerClosed = true;
      }) as Worker['close']);
      restore.push(() => spy.mockRestore());
      return worker;
    });
    restore.push(() => workerSpy.mockRestore());
    const build = controlServer.buildControl;
    const buildSpy = vi.spyOn(controlServer, 'buildControl').mockImplementation((...args) => {
      const attempt = active;
      const control = build(...args);
      attempt.control = control;
      const close = control.close.bind(control);
      const spy = vi.spyOn(control, 'close').mockImplementation((async () => {
        await close();
        attempt.controlClosed = true;
      }) as Control['close']);
      restore.push(() => spy.mockRestore());
      return control;
    });
    restore.push(() => buildSpy.mockRestore());

    const createSession = session.createLocalSessionService;
    const sessionSpy = vi.spyOn(session, 'createLocalSessionService').mockImplementation(options => {
      const result = createSession(options);
      active.grants = { sources: [...options.allowedSourceRefs], accounts: [...options.allowedAccountIds] };
      return result;
    });
    restore.push(() => sessionSpy.mockRestore());

    const prepareSidecar = sidecar.prepareBootstrapVerification;
    const sidecarSpy = vi.spyOn(sidecar, 'prepareBootstrapVerification').mockImplementation(async (...args) => {
      const attempt = active;
      const pin = await prepareSidecar(...args);
      const root = args[3]?.sidecarRoot;
      assert(root, 'Missing real sidecar directory');
      const stats = await statIfPresent(join(root, hashCanonical([pin.fixtureSetId, pin.fixtureSetVersion]) + '.json'));
      assert(stats && stats.isFile(), 'Missing prepared private sidecar');
      attempt.sidecars.push({ ...pin, bytes: stats.size });
      return pin;
    });
    restore.push(() => sidecarSpy.mockRestore());

    const runFinancial = financialRunner.runFinancialEvaluator;
    const financialSpy = vi.spyOn(financialRunner, 'runFinancialEvaluator').mockImplementation(async (...args) => {
      const attempt = active;
      const { result, measurement } = await measureFinancialOuter(runFinancial, ...args);
      attempt.measurements.push(measurement);
      return result;
    });
    restore.push(() => financialSpy.mockRestore());
    const runBootstrap = bootstrapRunner.runBootstrapEvaluator;
    const bootstrapSpy = vi.spyOn(bootstrapRunner, 'runBootstrapEvaluator').mockImplementation(async (...args) => {
      const attempt = active;
      const { result, measurement } = await measureBootstrapOuter(runBootstrap, ...args);
      attempt.measurements.push(measurement);
      return result;
    });
    restore.push(() => bootstrapSpy.mockRestore());

    const compose = composition.composeActivationReview;
    const composeSpy = vi.spyOn(composition, 'composeActivationReview').mockImplementation(async (...args) => {
      const attempt = active;
      const result = await compose(...args);
      assert(attempt.worker?.server.listening && attempt.proofs?.dependencies === args[0].dependencies,
        'Real review composed with an active worker and the returned proof dependencies');
      attempt.composed = true;
      if (attempt === failureAttempt) {
        failedProofs = await readProofs(attempt);
        const control = args[0].dependencies.db;
        const runtime = attempt.pools.find(pool => pool.role === 'runtime')!.pool;
        for (const table of ['prepared_reviews', 'activation_intents', 'bootstrap_verification_results']) {
          assert(await count(control, table) === 0, 'No selecting authority before post-composition sentinel');
        }
        assert(await count(runtime, 'runtime_activation_imports') === 0, 'No import before post-composition sentinel');
        await saveOriginals(attempt, 'before-cleanup');
        await save(attempt, 'financial-before-sentinel', { a: financialEvidence(failedProofs.a), b: financialEvidence(failedProofs.b) });
        throw sentinel;
      }
      return result;
    });
    restore.push(() => composeSpy.mockRestore());

    primary = await construct(primaryAttempt);
  }, 180000);

  afterAll(async () => {
    try {
      if (primary) await closeSuccess(primaryAttempt, primary, true);
    } finally {
      try {
        const cleanups = await Promise.allSettled(attempts.map(fallback));
        assert(cleanups.every(item => item.status === 'fulfilled'), 'One or more C2 attempts retained owned resources');
      } finally {
        for (const undo of restore.toReversed()) undo();
      }
    }
  }, 180000);

  test('real B proof review and CSV-bearing first import', async () => {
    assert(primary && primaryAttempt.composed && primaryAttempt.workerClosed && primaryAttempt.controlClosed,
      'Successful fixture returned after stopping the installed reviewer');
    await savePassing(primary, primaryAttempt);
  });

  test('only B is enrolled and original CSV remains immutable', async () => {
    await qualifyInventory(primary!, primaryAttempt);
    await saveOriginals(primaryAttempt, 'after-readback');
  });

  test('fresh B construction preserves all inputs', async () => {
    let fresh: Fixture | undefined;
    try {
      fresh = await construct(freshAttempt);
      assert(freshAttempt.root !== primaryAttempt.root && freshAttempt.namespace !== primaryAttempt.namespace,
        'Fresh attempt has independent owned resources');
      same(freshAttempt.before, primaryAttempt.before, 'Independent fresh A/B original bytes');
      await savePassing(fresh, freshAttempt);
      await qualifyInventory(fresh, freshAttempt);
      same(await sourceInventory(), sources, 'Source inventory preserved across fresh construction');
    } finally {
      try { if (fresh) await closeSuccess(freshAttempt, fresh); }
      finally { await fallback(freshAttempt); }
    }
  });

  test('partial B construction releases owned resources', async () => {
    try {
      await expect(construct(failureAttempt).then(fixture => fixture.close())).rejects.toBe(sentinel);
      assert(failureAttempt.composed && attempts.filter(attempt => attempt.namespace === failureAttempt.namespace).length === 1 &&
        attempts.filter(attempt => attempt.root === failureAttempt.root).length === 1, 'Independent real post-composition failure');
      same(failureAttempt.before, primaryAttempt.before, 'Failed attempt retained both original sets');
      qualifyMeasurements(failureAttempt, failedProofs);
      await saveMeasurements(failureAttempt);
      await cleanupEvidence(failureAttempt);
      assert(primaryAttempt.namespace && !primaryAttempt.dropped && await statIfPresent(primaryAttempt.root!),
        'Failed attempt preserved primary ownership');
      same(await sourceInventory(), sources, 'Source inventory preserved across failure cleanup');
    } finally {
      await fallback(failureAttempt);
    }
  });
});
