import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActivationRequestSchema, ChangePageSchema, VerificationCheckIdSchema, bootstrapRequiredAssertions, bootstrapRequiredCases,
  canonicalJson, hashBootstrapVerificationResult, hashBytes, hashCanonical, hashFinancialAttestation, hashFinancialReport,
  hashFinancialReservation, hashPlan, hashProfile, hashTargetSnapshot, targetRecordId,
  type ChangePage, type CustomerProfile, type TargetState,
} from '@eapr/contracts';
import { parseMinorUnits } from '@eapr/compiler/operations';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import * as controlDb from '@eapr/storage/control-db';
import * as runtimeDb from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as activationComposition from '../../apps/control/src/activation-composition.js';
import * as localSession from '../../apps/control/src/local-session.js';
import { loadReviewSelection } from '../../apps/control/src/review-proof-selection.js';
import * as workerServer from '../../apps/worker/src/server.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { readAuthoritySnapshotInTransaction } from '../../apps/worker/src/sync/current-authority-store.js';
import { readBootstrapExpectation } from '../../packages/evaluator/src/bootstrap-fixtures.js';
import * as bootstrapRunner from '../../packages/evaluator/src/bootstrap-runner.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import * as financialRunner from '../../packages/evaluator/src/financial-attestation-runner.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import * as nativeDb from '../../scripts/native-db.js';
import * as evidenceCapture from '../fixtures/evidence-v2-capture.js';
import { createSyncSelectionBundledFixture } from '../fixtures/sync-selection-bundled.js';
import {
  inventory, measureBootstrapOuter, measureFinancialOuter, originalsAt, resolveEvidenceDirectory, statIfPresent,
  writePrivateEvidence, type InventoryEntry, type Measurement,
} from '../fixtures/sync-selection-evidence.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const clock = () => new Date('2026-11-09T08:00:00.000Z');
const scope = { companyId: 'company-a', sellerEntityId: 'seller-a', accountId: 'company-a.seller-a.sync-bundle-selected' };
const otherScope = { ...scope, accountId: 'company-a.seller-a.sync-bundle-other' };
const manifestId = 'manifest-sync-bundled-v1';
const fixtureSetId = 'truth-sync-bundled-v1';
const approvalKey = 'sync-bundle-approve-selected';
const mandatory = [...VerificationCheckIdSchema.options].sort();
const invoiceIds = ['evt:sync-bundle-invoice-selected', 'evt:sync-bundle-invoice-other'] as const;
const documentLines = [
  'Currency USD applies to both agreements below.',
  'Fixed monthly agreement sync-bundle-contract-selected',
  'Seller seller-a; buyer sync-bundle-buyer-selected; account sync-bundle-selected',
  'Legal name Bundle Selected',
  'Monthly fee USD 3000.00 for sync-bundle-selected',
  'Effective 2026-09-01; monthly invoice anchor day 1.',
  'Fixed monthly agreement sync-bundle-contract-other',
  'Seller seller-a; buyer sync-bundle-buyer-other; account sync-bundle-other',
  'Legal name Bundle Other',
  'Monthly fee USD 3000.00 for sync-bundle-other',
  'Effective 2026-09-01; monthly invoice anchor day 1.',
];
const sourcePaths = [
  'tests/fixtures', 'tests/integration/sync-selection.test.ts', 'tests/integration/sync-selection-baselines-fixture.test.ts',
  'tests/integration/sync-selection-bundled-fixture.test.ts', 'tests/integration/sync-capture.test.ts',
  'scripts/generate-fixtures.ts', 'packages/sources/src', 'packages/evaluator/src', 'db/control', 'db/runtime', 'package-lock.json',
  '.local/protected-evaluator', '.local/protected-bootstrap', '.local/activation-policy', '.local/artifacts',
];
const nonCaptureTables = [
  'migration_ledger', 'seed_ledger', 'parent_scopes', 'parent_snapshots', 'parent_targets', 'parent_metadata',
  'parent_financial_records', 'runtime_activation_imports', 'runtime_import_lineage', 'runtime_financial_origins',
  'runtime_authority_heads', 'runtime_authority_commands', 'runtime_economic_outcomes', 'runtime_delivery_outcomes',
  'runtime_sync_receipts', 'runtime_sync_economic_outcomes', 'runtime_sync_delivery_outcomes', 'runtime_sync_event_outcomes',
  'runtime_sync_units', 'runtime_sync_application_heads',
];
const captureTables = [
  'runtime_capture_lanes', 'runtime_capture_checkpoints', 'runtime_capture_pages', 'runtime_source_positions',
  'runtime_deliveries', 'runtime_inbox', 'runtime_capture_incidents', 'activity_events', 'activity_counter',
];
const controlTables = [
  'migration_ledger', 'seed_ledger', 'activity_events', 'activity_counter', 'review_heads', 'prepared_reviews', 'activation_intents',
  'activation_receipt_observations', 'review_bootstrap_selections', 'artifact_objects', 'artifact_captures',
  'verification_jobs', 'verification_reports', 'verification_attempt_budgets', 'financial_verification_reservations',
  'financial_verification_attestations', 'bootstrap_verification_jobs', 'bootstrap_verification_results',
  'source_files', 'source_events', 'source_manifests', 'source_snapshots', 'source_dossiers', 'source_evidence',
];
const unchangedSources = async () => (await Promise.all(sourcePaths.map(path => inventory(join(root, path), path)))).flat();

type Fixture = Awaited<ReturnType<typeof createSyncSelectionBundledFixture>>;
type EvidenceInput = Awaited<ReturnType<typeof evidenceCapture.captureEvidenceFixture>>['input'];
type Captured = Pick<EvidenceInput, 'manifest' | 'snapshot' | 'events'> & {
  citationId: string; factIds: string[]; originalBytes: number; originalHash: string;
};
type Worker = Awaited<ReturnType<typeof workerServer.launchWorker>>;
type PoolHandle = { pool: Pool; role: 'control' | 'runtime'; ended: boolean };
type Attempt = {
  name: 'primary' | 'fresh' | 'failure'; namespace?: string; root?: string; dropped: boolean; worker?: Worker;
  databaseNames?: Record<PoolHandle['role'], string>; workerPort?: number;
  workerWasListening: boolean; workerClosed: boolean; composed: boolean;
  pools: PoolHandle[]; measurements: Measurement[]; control?: Pool; reviewerAccounts?: string[];
  before?: InventoryEntry[]; captured?: Captured; elapsedMs?: number;
};
const attemptFor = (name: Attempt['name']): Attempt => ({
  name, dropped: false, workerWasListening: false, workerClosed: false, composed: false, pools: [], measurements: [],
});

function captureBinding(input: EvidenceInput, fileId: string): Captured {
  const { manifest, snapshot, events, citations, originals, resolvedSupport, producerJson } = input;
  expect(manifest.id).toBe(manifestId);
  expect(manifest.files).toHaveLength(1);
  expect(manifest.files[0]).toMatchObject({ fileId, documentId: 'doc-sync-bundle-agreements', documentVersion: 1, kind: 'contract_pdf' });
  expect(events.toSorted((a, b) => a.sequence - b.sequence).map(event => event.id)).toEqual(invoiceIds);
  const documentCitations = citations.filter(({ evidence }) => evidence.sourceId === fileId);
  expect(documentCitations).toHaveLength(1);
  const { evidence, text, original, mediaType } = documentCitations[0]!;
  const expectedText = documentLines.join(' ');
  const originalPdf = originals.find(item => item.sourceId === fileId);
  expect(originalPdf?.binding).toEqual({ kind: 'document', fileId });
  const bytes = Buffer.from(originalPdf!.bytesBase64, 'base64');
  expect(mediaType).toBe('application/pdf');
  expect(evidence.locator).toEqual({ kind: 'pdf', page: 1, start: 0, end: expectedText.length });
  expect(evidence.snapshotId).toBe(snapshot.id);
  expect(snapshot.evidenceIds).toContain(evidence.id);
  expect(text.startInclusive).toBe(0);
  expect(text.endExclusive).toBe(expectedText.length);
  expect(text.unit).toBe('utf16');
  expect(text.value === expectedText && evidence.excerpt === expectedText).toBe(true);
  expect(text.sha256).toBe(hashBytes(Buffer.from(expectedText)));
  expect(original.byteLength).toBe(bytes.length);
  expect(original.sha256).toBe(hashBytes(bytes));
  expect(evidence.sha256).toBe(original.sha256);
  expect(manifest.files[0]!.sha256).toBe(original.sha256);
  const producer = decodeEvidenceProducer(producerJson);
  const facts = [
    { sourceAccountId: 'sync-bundle-selected', contractId: 'sync-bundle-contract-selected' },
    { sourceAccountId: 'sync-bundle-other', contractId: 'sync-bundle-contract-other' },
  ];
  const factIds = facts.map(({ sourceAccountId, contractId }) => {
    const id = 'term:' + hashCanonical({
      companyId: 'company-a', sourceRef: 'legacy-a', sellerEntityId: 'seller-a', sourceAccountId, contractId, validFrom: '2026-09-01',
    });
    expect(producer.contracts.some(fact => fact.id === id && fact.sourceAccountId === sourceAccountId &&
      fact.contractId === contractId && fact.support.some(row =>
        row.field === 'currency' && row.fileId === fileId && row.expectedLiteral === documentLines[0]))).toBe(true);
    return id;
  });
  expect(new Set(factIds).size).toBe(2);
  const rows = resolvedSupport.filter(row => row.field === 'currency');
  expect(rows.map(row => row.factId).sort()).toEqual([...factIds].sort());
  expect(rows.every(row => row.evidenceId === evidence.id && row.fileId === fileId &&
    row.expectedLiteral === documentLines[0] && text.value.slice(text.startInclusive, text.endExclusive).startsWith(row.expectedLiteral)))
    .toBe(true);
  return { manifest, snapshot, events, citationId: evidence.id, factIds, originalBytes: bytes.length, originalHash: original.sha256 };
}

function expectedTarget(citationId: string): TargetState {
  const evidenceRefs = [citationId];
  const identity = { sourceRef: 'legacy-a', sellerEntityId: 'seller-a', kind: 'invoice' as const, recordId: 'sync-bundle-invoice-selected' };
  return {
    scope, version: 1, asOf: '2026-10-01T00:00:00.000Z',
    invoices: [{ id: targetRecordId(identity), identity, scope, kind: 'invoice', sourceEventId: 'evt:sync-bundle-invoice-selected',
      sourceRecordVersion: 1, amountCents: 300000, currency: 'USD', effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30' }],
    payments: [], credits: [], allocations: [], reversals: [],
    customers: [{ id: 'sync-bundle-buyer-selected', displayName: 'Bundle Selected', evidenceRefs }],
    accounts: [{ id: scope.accountId, scope, parentCustomerId: 'sync-bundle-buyer-selected',
      sourceRef: 'legacy-a', sourceAccountIds: ['sync-bundle-selected'] }],
    billingConfigurations: [{ id: 'configuration:sync-bundle-term-selected', scope, contractTerm: {
      id: 'sync-bundle-term-selected', contractId: 'sync-bundle-contract-selected', validFrom: '2026-09-01', validToExclusive: null,
      fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs,
    } }],
  };
}

function expectProfile(profile: CustomerProfile, selected: boolean, citationId: string) {
  const suffix = selected ? 'selected' : 'other';
  const evidenceRefs = [citationId];
  const account = 'sync-bundle-' + suffix;
  const buyer = 'sync-bundle-buyer-' + suffix;
  const termId = 'sync-bundle-term-' + suffix;
  const expectedScope = selected ? scope : otherScope;
  expect(profile).toEqual({
    id: 'sync-bundle-profile-' + suffix, hash: hashProfile(profile), version: 2, scope: expectedScope, sourceRef: 'legacy-a',
    parentCustomerId: buyer, sourceAccountIds: [account], semanticVersion: 'sem-a-1', findings: [],
    approvedLookups: [{ id: 'account-map', valueType: 'parent-account', entries: [{ source: account, target: expectedScope.accountId, evidenceRefs }] }],
    contractTerms: [{ id: termId, contractId: 'sync-bundle-contract-' + suffix, validFrom: '2026-09-01', validToExclusive: null,
      fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs }],
    bootstrap: { customer: { id: buyer, displayName: selected ? 'Bundle Selected' : 'Bundle Other', evidenceRefs },
      billingConfigurationIds: [{ id: 'configuration:' + termId, termId }] },
  });
}

async function snapshotRows(db: Pool, tables: readonly string[]) {
  return withTransaction(db, async client => {
    const digests: Record<string, string> = {};
    for (const table of tables) {
      const rows = (await client.query('SELECT to_jsonb(saved)::text AS row FROM ' + table + ' AS saved ORDER BY 1')).rows;
      digests[table] = hashCanonical(rows);
    }
    return digests;
  });
}

async function qualifyCatalog({ db, selected }: Fixture, attempt: Attempt, target: TargetState) {
  const { identity, stored } = selected;
  const { bundle, receipt, activation, plan, request } = stored;
  const { bootstrapVerification: bootstrap, financialAttestation: financial } = bundle;
  const control = attempt.control!;
  await withTransaction(control, async client => {
    expect((await client.query('SELECT account_id, package_id FROM review_heads')).rows)
      .toEqual([{ account_id: scope.accountId, package_id: request.reviewPackageId }]);
    expect((await client.query('SELECT account_id, id, source_ref FROM prepared_reviews')).rows)
      .toEqual([{ account_id: scope.accountId, id: request.reviewPackageId, source_ref: 'legacy-a' }]);
    const { rows: intents } = await client.query<{
      id: string; account_id: string; package_id: string; idempotency_key: string; request_hash: string; request_canonical: string; bundle_hash: string;
    }>('SELECT id, account_id, package_id, idempotency_key, request_hash, request_canonical, bundle_hash FROM activation_intents');
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ account_id: scope.accountId, package_id: request.reviewPackageId,
      idempotency_key: approvalKey, request_hash: stored.requestHash, bundle_hash: bundle.hash });
    expect(ActivationRequestSchema.parse(JSON.parse(intents[0]!.request_canonical))).toEqual(request);
    for (const row of (await client.query('SELECT intent_id, receipt_id FROM activation_receipt_observations')).rows) {
      expect(row).toEqual({ intent_id: intents[0]!.id, receipt_id: receipt.id });
    }
    expect((await client.query('SELECT result_id FROM review_bootstrap_selections')).rows).toEqual([{ result_id: bootstrap.id }]);
    expect((await client.query('SELECT id FROM bootstrap_verification_jobs')).rows).toEqual([{ id: bootstrap.jobId }]);
    expect((await client.query('SELECT id FROM bootstrap_verification_results')).rows).toEqual([{ id: bootstrap.id }]);
    expect((await client.query('SELECT job_id FROM financial_verification_reservations')).rows)
      .toEqual([{ job_id: financial.reservation.jobId }]);
    expect((await client.query('SELECT report_id FROM financial_verification_attestations')).rows)
      .toEqual([{ report_id: financial.reportId }]);
    expect((await client.query('SELECT artifact_hash, manifest_id FROM artifact_captures')).rows)
      .toEqual([{ artifact_hash: bundle.artifact.hash, manifest_id: manifestId }]);
  });

  const registryRoot = join(attempt.root!, 'registry');
  const registry = await createRegisteredScopeReader({ registryRoot }).readSnapshot();
  expect(registry.index.entries.map(entry => [entry.accountId, entry.profileHash])).toEqual([[scope.accountId, activation.profileHash]]);
  expect(registry.resolveRegisteredScope(otherScope.accountId)).toBeNull();
  const policy = await loadActivationPolicy({ policyPath: join(attempt.root!, 'policy/current.json') });
  expect(policy.entries).toHaveLength(1);
  expect(policy.entries[0]).toMatchObject({ scope, selectedProfileHash: activation.profileHash, requiredProfileHashes: bundle.artifact.requiredProfileHashes });
  expect(bundle.authorityPolicy).toEqual({
    issuerId: 'eapr-control-registry-1', policyId: policy.policyId, policyHash: policy.hash,
  });
  const selection = await loadReviewSelection(join(attempt.root!, 'selection.json'));
  expect(selection.entries).toEqual([{ artifactHash: bundle.artifact.hash, manifestId, selectedProfileHash: activation.profileHash,
    financialReportId: financial.reportId, bootstrapFixture: {
      fixtureSetId, fixtureSetVersion: 'bootstrap-bundled-selected-v1', fixtureHash: bootstrap.pin.fixtureHash,
    } }]);
  expect(attempt.reviewerAccounts).toEqual([scope.accountId]);

  await withTransaction(db, async client => {
    const { rows: imports } = await client.query('SELECT account_id, company_id, seller_entity_id, activation_id, receipt_id, idempotency_key FROM runtime_activation_imports');
    expect(imports).toEqual([{ account_id: scope.accountId, company_id: scope.companyId, seller_entity_id: scope.sellerEntityId,
      activation_id: activation.id, receipt_id: receipt.id, idempotency_key: approvalKey }]);
    expect(await readStoredActivation(client, scope)).toEqual(stored);
    expect(await readStoredActivation(client, otherScope)).toBeNull();
    expect(await readStoredTarget(client, otherScope)).toBeNull();
    expect(await readStoredTarget(client, scope)).toEqual(stored.approvedTarget);
    expect((await readStoredTarget(client, scope, hashTargetSnapshot(target)))?.records).toEqual(target);
    const authority = await readAuthoritySnapshotInTransaction(client, identity);
    expect(authority.state).toMatchObject({ identity, status: 'active', epoch: 1, profileHash: activation.profileHash });
    expect(authority.command).toBeNull();
    for (const table of ['runtime_authority_heads', 'runtime_authority_commands', 'runtime_sync_receipts']) {
      expect((await client.query('SELECT 1 FROM ' + table)).rowCount).toBe(0);
    }
    for (const table of ['parent_scopes', 'parent_targets', 'parent_financial_records', 'runtime_financial_origins',
      'runtime_economic_outcomes', 'runtime_delivery_outcomes']) {
      expect((await client.query('SELECT account_id FROM ' + table)).rows).toEqual([{ account_id: scope.accountId }]);
    }
    expect((await client.query('SELECT DISTINCT account_id FROM parent_snapshots')).rows).toEqual([{ account_id: scope.accountId }]);
    expect((await client.query('SELECT account_id, family, record_id FROM parent_metadata ORDER BY family')).rows).toEqual([
      { account_id: scope.accountId, family: 'account', record_id: scope.accountId },
      { account_id: scope.accountId, family: 'billing_configuration', record_id: 'configuration:sync-bundle-term-selected' },
      { account_id: scope.accountId, family: 'customer', record_id: 'sync-bundle-buyer-selected' },
    ]);
    expect(await readFinancialOrigins(client, scope, target.invoices)).toEqual([
      { kind: 'initial', recordId: target.invoices[0]!.id, importKey: approvalKey, receipt },
    ]);
    expect(plan.eventIds).toEqual(['evt:sync-bundle-invoice-selected']);
  });
}

async function qualify(fixture: Fixture, attempt: Attempt) {
  const { selected: { identity, stored }, unselected } = fixture;
  const { citationId, manifest, snapshot, events } = attempt.captured!;
  const { bundle, activation, receipt, request, plan } = stored;
  const { artifact, profiles, financialAttestation: financial, verificationReport: report, bootstrapVerification: bootstrap } = bundle;
  expect(profiles).toHaveLength(2);
  const [chosen] = profiles.filter(profile => profile.id === 'sync-bundle-profile-selected');
  expectProfile(chosen!, true, citationId);
  expectProfile(unselected, false, citationId);
  const bundledOther = profiles.find(profile => profile.id === 'sync-bundle-profile-other');
  expect(bundledOther).toEqual(unselected);
  expect(bundledOther).not.toBe(unselected);
  const candidate = await createCandidateRegistry(attempt.control!, join(attempt.root!, 'registry')).getCandidate(artifact.hash, manifestId);
  expect(candidate.artifact).toEqual(artifact);
  expect(candidate.profiles).toEqual(profiles);
  const hashes = [chosen!.hash, unselected.hash].sort();
  expect(artifact.requiredProfileHashes).toEqual(hashes);
  expect(bundle.manifest).toEqual(manifest);
  expect(bundle.snapshot).toEqual(snapshot);
  expect(bundle.bootstrapEvents).toEqual(events.toSorted((a, b) => a.sequence - b.sequence));
  const eventsHash = hashCanonical(events.toSorted((a, b) => a.id < b.id ? -1 : 1));
  expect(report).toMatchObject({ artifactHash: artifact.hash, profileHashes: hashes, manifestHash: manifest.hash,
    fixtureSetId, fixtureSetVersion: '2', eligible: true, unexplainedDifferenceCents: 0 });
  expect(report.coverage.required.toSorted()).toEqual(mandatory);
  expect(report.coverage.executed.toSorted()).toEqual(mandatory);
  expect(report.coverage.profileHashes).toEqual(hashes);
  expect(report.coverage.sourceRefs).toEqual(['legacy-a']);
  expect(report.coverage.eventKinds.toSorted()).toEqual(['allocation', 'credit', 'invoice', 'payment', 'reversal']);
  expect(report.checks.map(item => item.id).sort()).toEqual(mandatory);
  expect(report.checks.every(item => item.status === 'passed' && item.cases > 0)).toBe(true);
  expect(report.checks.find(item => item.id === 'evidence_support')?.cases).toBe(8);
  expect(report.evaluatorBuildHash).toBe(await readFixedFinancialBuildHash());
  expect(financial.reportId).toBe(report.id);
  expect(financial.reportHash).toBe(hashFinancialReport(report));
  expect(financial.hash).toBe(hashFinancialAttestation(financial));
  expect(financial.reservation.hash).toBe(hashFinancialReservation(financial.reservation));
  expect(financial.reservation).toMatchObject({ artifactHash: artifact.hash, requiredProfileHashes: hashes,
    evaluatorBuildHash: report.evaluatorBuildHash, evidencePin: { fixtureSetId, fixtureSetVersion: '2' },
    capture: { sourceRef: 'legacy-a', companyId: 'company-a', manifestId, manifestHash: manifest.hash,
      snapshotId: 'snapshot:manifest-sync-bundled-v1', snapshotHash: snapshot.contentHash, snapshotObjectHash: hashCanonical(snapshot), eventsHash },
  });
  expect(bootstrap.passed).toBe(true);
  expect(bootstrap.hash).toBe(hashBootstrapVerificationResult(bootstrap));
  expect(bootstrap.pin).toMatchObject({
    fixtureSetId, fixtureSetVersion: 'bootstrap-bundled-selected-v1', ...await readFixedBootstrapBuildPins(),
  });
  const attemptRoot = attempt.root!;
  const validated = await readBootstrapExpectation({
    fixtureSetId, fixtureSetVersion: 'bootstrap-bundled-selected-v1', hash: bootstrap.pin.fixtureHash,
  }, {
    artifact, profiles, manifest, snapshot, events,
    registration: { artifactHash: artifact.hash, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotObjectHash: hashCanonical(snapshot) },
  }, {
    sidecarRoot: join(attemptRoot, 'bootstrap'), evidencePinRoot: join(attemptRoot, 'evaluator'),
    servedRoots: ['visible', 'originals', 'registry'].map(name => join(attemptRoot, name)),
  });
  expect(validated.descriptor.evidencePin).toEqual(financial.reservation.evidencePin);
  const selectedFactId = attempt.captured!.factIds[0]!;
  expect(validated.descriptor.subjects).toHaveLength(1);
  expect(validated.descriptor.subjects.map(subject => ({
    profileHash: subject.profileHash, profileId: subject.profileId, scope: subject.scope,
    customerId: subject.customerId, terms: subject.terms.map(({ factId, termId, configurationId, evidenceRefs }) =>
      ({ factId, termId, configurationId, evidenceRefs })),
  }))).toEqual([{
    profileHash: chosen!.hash, profileId: 'sync-bundle-profile-selected', scope, customerId: 'sync-bundle-buyer-selected',
    terms: [{ factId: selectedFactId, termId: 'sync-bundle-term-selected',
      configurationId: 'configuration:sync-bundle-term-selected', evidenceRefs: [citationId] }],
  }]);
  const pinnedCurrency = validated.evidence.resolvedSupport.filter(row => row.field === 'currency')
    .map(({ factId, evidenceId }) => [factId, evidenceId]).sort();
  expect(pinnedCurrency).toEqual(attempt.captured!.factIds.map(factId => [factId, citationId]).sort());
  expect(bootstrap.cases.map(item => item.id)).toEqual([...bootstrapRequiredCases]);
  expect(bootstrap.assertions.map(item => item.id)).toEqual([...bootstrapRequiredAssertions]);
  expect(bootstrap.cases.every(item => item.status === 'passed')).toBe(true);
  expect(bootstrap.assertions.every(item => item.status === 'passed')).toBe(true);
  expect(bootstrap.binding).toEqual({ artifactHash: artifact.hash, profileHash: chosen!.hash, requiredProfileHashes: hashes, scope,
    manifestId, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotHash: snapshot.contentHash, eventsHash,
    targetSnapshotHash: hashTargetSnapshot(stored.plannerTarget), expectedTargetVersion: 0, asOf: '2026-10-01T00:00:00.000Z' });
  expect(bootstrap.planHash).toBe(plan.hash);
  expect(plan.hash).toBe(hashPlan(plan));
  expect(plan).toEqual(bundle.previewPlan);
  const target = expectedTarget(citationId);
  expect(stored.approvedTarget.records).toEqual(target);
  expect(plan.operations.filter(operation => 'identity' in operation.record)).toEqual([{ op: 'insert_invoice', record: target.invoices[0] }]);
  expect(activation).toMatchObject({ scope, artifactHash: artifact.hash, profileHash: chosen!.hash, manifestHash: manifest.hash,
    baselineCursors: [{ streamId: 'a-finance', resumeAfter: '2' }, { streamId: 'a-semantics', resumeAfter: '0' }],
    status: 'active', epoch: 1 });
  expect(identity).toEqual({ scope, activationId: activation.id, bundleHash: bundle.hash });
  expect(request).toMatchObject({ idempotencyKey: approvalKey, reviewPackageId: bundle.reviewPackage.id,
    expectedArtifactHash: artifact.hash, expectedProfileHash: chosen!.hash, expectedTargetVersion: 0 });
  expect(receipt).toMatchObject({ scope, activationId: activation.id, planHash: plan.hash, artifactHash: artifact.hash, status: 'applied',
    eventIds: ['evt:sync-bundle-invoice-selected'], targetRecordIds: [target.invoices[0]!.id], beforeBalanceCents: 0, afterBalanceCents: 300000 });
  await qualifyCatalog(fixture, attempt, target);
}

async function expectCapture(fixture: Fixture, page?: ChangePage) {
  const { db, selected } = fixture;
  const manifestHash = selected.stored.bundle.manifest.hash;
  const { lane, readProgress } = await createRuntimeCapture({ db, clock }).openCommitted(selected.identity);
  expect(lane).toEqual({ schemaVersion: '1', sourceRef: 'legacy-a', manifestHash });
  expect((await db.query('SELECT manifest_hash, initial_activation_id FROM runtime_capture_lanes')).rows)
    .toEqual([{ manifest_hash: manifestHash, initial_activation_id: selected.identity.activationId }]);
  expect((await readProgress()).streams).toEqual([
    { streamId: 'a-finance', transport: 'api', baselineCursor: '2', captureCursor: page ? '4' : '2',
      capturedRecords: page ? 2 : 0, capturedPages: page ? 1 : 0, lastCapturedAt: page ? clock().toISOString() : null, lastIncident: null },
    { streamId: 'a-semantics', transport: 'semantic', baselineCursor: '0', captureCursor: '0',
      capturedRecords: 0, capturedPages: 0, lastCapturedAt: null, lastIncident: null },
  ]);
  const { rows: deliveries } = await db.query(`
    SELECT p.sequence::int AS sequence, d.event_id, d.canonical, d.digest, d.content_hash FROM runtime_deliveries d
    JOIN runtime_source_positions p USING (source_ref, event_id) ORDER BY p.sequence`);
  const expected = [...selected.stored.bundle.bootstrapEvents, ...(page?.events ?? [])].sort((a, b) => a.sequence - b.sequence);
  expect(deliveries).toEqual(expected.map(event => ({
    sequence: event.sequence, event_id: event.id, canonical: canonicalJson(event), digest: hashCanonical(event), content_hash: event.contentHash,
  })));
  expect((await db.query('SELECT count(*)::int AS count FROM runtime_source_positions')).rows).toEqual([{ count: expected.length }]);
  expect((await db.query('SELECT count(*)::int AS count FROM runtime_capture_checkpoints')).rows).toEqual([{ count: 2 }]);
  expect((await db.query('SELECT count(*)::int AS count FROM runtime_capture_incidents')).rows).toEqual([{ count: 0 }]);
  const { rows: pages } = await db.query('SELECT manifest_hash, canonical, digest FROM runtime_capture_pages');
  expect(pages).toEqual(page ? [{ manifest_hash: manifestHash, canonical: canonicalJson(page), digest: hashCanonical(page) }] : []);
  const { rows: inbox } = await db.query('SELECT manifest_hash, stream_id, after_cursor::text, sequence::int, event_id FROM runtime_inbox ORDER BY sequence');
  expect(inbox).toEqual((page?.events ?? []).map(event => ({
    manifest_hash: manifestHash, stream_id: 'a-finance', after_cursor: '2', sequence: event.sequence, event_id: event.id,
  })));
}

describe('bundled-profile fixture qualification', () => {
  const primaryAttempt = attemptFor('primary');
  const freshAttempt = attemptFor('fresh');
  const failedAttempt = attemptFor('failure');
  const attempts = [primaryAttempt, freshAttempt, failedAttempt];
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

  async function saveProof(attempt: Attempt, { selected: { stored }, unselected }: Fixture) {
    const { bundle, activation, receipt, requestHash } = stored;
    const { verificationReport: report, financialAttestation: financial, bootstrapVerification: bootstrap } = bundle;
    const measurements = attempt.measurements;
    expect(measurements.map(item => item.stage)).toEqual(['financial-probe', 'financial-launch', 'bootstrap']);
    expect(measurements.map(item => item.jobId)).toEqual([financial.reservation.jobId, financial.reservation.jobId, bootstrap.jobId]);
    for (const measurement of measurements) {
      expect(measurement.status).toBe('ok');
      expect(measurement.manifestHash).toBe(bundle.manifest.hash);
      expect(measurement.framedRequestBytes).toBe(measurement.requestJsonBytes + 1);
      expect(measurement.framedRequestBytes).toBeLessThanOrEqual(10485760);
      expect(measurement.framedContextBytes).toBeGreaterThan(1);
      expect(measurement.framedContextBytes).toBeLessThanOrEqual(10485760);
      expect(measurement.returnedResponseObjectJsonBytes).toBeGreaterThan(0);
      expect(measurement.elapsedMs).toBeGreaterThan(0);
    }
    expect(measurements[0]!.evidencePinBytes).toBeGreaterThan(0);
    expect(measurements[0]!.evidencePinBytes).toBe(measurements[1]!.evidencePinBytes);
    expect(measurements[2]!.sidecarBytes).toBeGreaterThan(0);
    const { citationId, factIds, originalBytes, originalHash } = attempt.captured!;
    await save(attempt, 'proof', {
      citation: { id: citationId, currencyFactIds: factIds, originalBytes, originalHash },
      artifactHash: bundle.artifact.hash, selectedProfileHash: activation.profileHash, unselectedProfileHash: unselected.hash,
      financial: { jobId: financial.reservation.jobId, reportId: report.id, reportHash: financial.reportHash,
        attestationHash: financial.hash, reservationHash: financial.reservation.hash, evaluatorBuildHash: report.evaluatorBuildHash,
        pin: financial.reservation.evidencePin, capture: financial.reservation.capture, coverage: report.coverage,
        checks: report.checks.map(({ id, status, cases }) => ({ id, status, cases })),
        eligible: report.eligible, unexplainedDifferenceCents: report.unexplainedDifferenceCents },
      bootstrap: { id: bootstrap.id, jobId: bootstrap.jobId, resultHash: bootstrap.hash, planHash: bootstrap.planHash,
        pin: bootstrap.pin, binding: bootstrap.binding, cases: bootstrap.cases, assertions: bootstrap.assertions, passed: bootstrap.passed },
      approval: { approvalKey, requestHash, reviewPackageId: bundle.reviewPackage.id, bundleHash: bundle.hash,
        activationId: activation.id, receiptId: receipt.id, status: receipt.status, eventIds: receipt.eventIds, recordIds: receipt.targetRecordIds },
      outer: measurements, constructionElapsedMs: attempt.elapsedMs,
      returnedResponseObject: 'UTF-8 JSON serialization of parsed value without LF',
      outerRequest: 'schema-normalized UTF-8 JSON with one LF on stdin; context UTF-8 JSON with one LF on fd 3',
      rawResponseWireBytes: 'unobserved', individualNestedBytesAndElapsedMs: 'unobserved',
      nestedCompliance: 'unchanged 10485760-byte cap and 5000 ms deadline with complete same-run passing reports',
    });
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

  async function verifyCleanup(attempt: Attempt) {
    const rootAbsent = !!attempt.root && !await statIfPresent(attempt.root);
    const pools = attempt.pools.map(({ role, ended }) => ({ role, ended }));
    const workerStillListening = attempt.worker?.server.listening;
    await save(attempt, 'cleanup', {
      rootId: attempt.root && basename(attempt.root), rootAbsent, namespace: attempt.namespace, dropped: attempt.dropped,
      databases: attempt.databaseNames, workerPort: attempt.workerPort, workerWasListening: attempt.workerWasListening,
      workerClosed: attempt.workerClosed, workerStillListening, composed: attempt.composed, pools,
    });
    expect(rootAbsent).toBe(true);
    expect(attempt.dropped).toBe(true);
    expect(attempt.workerWasListening).toBe(true);
    expect(attempt.workerClosed).toBe(true);
    expect(workerStillListening).toBe(false);
    expect(pools).toEqual([{ role: 'control', ended: true }, { role: 'runtime', ended: true }]);
  }

  const drop = nativeDb.dropTest;
  async function fallback(attempt: Attempt) {
    const outcomes = await Promise.allSettled([
      ...(attempt.worker?.server.listening ? [attempt.worker.close()] : []),
      ...attempt.pools.filter(handle => !handle.ended).map(({ pool }) => pool.end()),
    ]);
    if (attempt.namespace && !attempt.dropped) outcomes.push(...await Promise.allSettled([drop(attempt.namespace)]));
    if (attempt.root) outcomes.push(...await Promise.allSettled([rm(attempt.root, { recursive: true, force: true })]));
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new Error('Bundled fixture fallback cleanup failed');
  }

  async function construct(attempt: Attempt) {
    active = attempt;
    const start = performance.now();
    try { return await createSyncSelectionBundledFixture(); }
    finally { attempt.elapsedMs = performance.now() - start; }
  }

  beforeAll(async () => {
    evidenceDir = await resolveEvidenceDirectory(root, 3);
    sourceBefore = await unchangedSources();
    const captureEvidence = evidenceCapture.captureEvidenceFixture;
    const provision = nativeDb.provisionTest;
    const createControl = controlDb.createControlDb;
    const createRuntime = runtimeDb.createRuntimeDb;
    const launchWorker = workerServer.launchWorker;
    const compose = activationComposition.composeActivationReview;
    const createSession = localSession.createLocalSessionService;
    const runFinancial = financialRunner.runFinancialEvaluator;
    const runBootstrap = bootstrapRunner.runBootstrapEvaluator;

    const captureSpy = vi.spyOn(evidenceCapture, 'captureEvidenceFixture').mockImplementation(async (...args) => {
      const attempt = active;
      const { visibleRoot, truthRoot } = args[1];
      expect(attempt.root).toBeUndefined();
      attempt.root = dirname(visibleRoot);
      expect(visibleRoot).toBe(join(attempt.root, 'visible'));
      expect(truthRoot).toBe(join(attempt.root, 'truth'));
      attempt.control = args[0].db;
      attempt.before = await originalsAt(attempt.root);
      const expectedPaths = [
        ...['api-a.json', 'api-originals-a.json', 'manifest-a.json', 'uploads-a.json', 'contract-1.pdf'].map(name => 'visible/' + name),
        ...invoiceIds.map(id => 'visible/api-a/' + hashCanonical(id) + '.json'),
        'truth/evidence-a.json', 'truth/expected-a.json',
      ];
      expect(attempt.before.map(item => item.path).sort()).toEqual(expectedPaths.sort());
      expect(attempt.before.every(item => 'bytes' in item && item.bytes > 0 && item.bytes <= 10485760)).toBe(true);
      await save(attempt, 'before-publication', attempt.before);
      const { rows: [before] } = await attempt.control.query(`SELECT
        (SELECT count(*)::int FROM source_manifests) AS manifests,
        (SELECT count(*)::int FROM source_events) AS events,
        (SELECT count(*)::int FROM artifact_captures) AS registrations`);
      expect(before).toEqual({ manifests: 0, events: 0, registrations: 0 });
      const result = await captureEvidence(...args);
      attempt.captured = captureBinding(result.input, result.contractFileId);
      return result;
    });
    restore.push(() => captureSpy.mockRestore());

    const provisionSpy = vi.spyOn(nativeDb, 'provisionTest').mockImplementation(async namespace => {
      const attempt = active;
      expect(attempt.namespace).toBeUndefined();
      const pair = await provision(namespace);
      attempt.namespace = namespace;
      attempt.databaseNames = { control: pair.control.name, runtime: pair.runtime.name };
      return pair;
    });
    restore.push(() => provisionSpy.mockRestore());
    const dropSpy = vi.spyOn(nativeDb, 'dropTest').mockImplementation(async namespace => {
      const owner = attempts.find(attempt => attempt.namespace === namespace);
      if (!owner || owner.dropped) throw new Error('Unexpected bundled fixture namespace drop');
      await drop(namespace);
      owner.dropped = true;
    });
    restore.push(() => dropSpy.mockRestore());
    const controlSpy = vi.spyOn(controlDb, 'createControlDb').mockImplementation(options => observePool(createControl(options), 'control'));
    const runtimeSpy = vi.spyOn(runtimeDb, 'createRuntimeDb').mockImplementation(options => observePool(createRuntime(options), 'runtime'));
    restore.push(() => controlSpy.mockRestore(), () => runtimeSpy.mockRestore());

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
      const attempt = active;
      const result = await compose(...args);
      attempt.composed = true;
      if (attempt === failedAttempt) throw sentinel;
      return result;
    });
    restore.push(() => composeSpy.mockRestore());
    const sessionSpy = vi.spyOn(localSession, 'createLocalSessionService').mockImplementation(options => {
      const result = createSession(options);
      active.reviewerAccounts = [...options.allowedAccountIds];
      return result;
    });
    restore.push(() => sessionSpy.mockRestore());

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
        const first = primary.close();
        const second = primary.close();
        expect(first).toBe(second);
        await first;
        await second;
        await verifyCleanup(primaryAttempt);
      }
    } finally {
      try { await fallback(primaryAttempt); }
      finally { for (const undo of restore.toReversed()) undo(); }
    }
  });

  test('full artifact proof with selected-only authority', async () => {
    await qualify(primary!, primaryAttempt);
    await expectCapture(primary!);
    await saveOriginals(primaryAttempt, 'after-proof');
    await saveProof(primaryAttempt, primary!);
  });

  test('unselected remains absent with captured input', async () => {
    const fixture = primary!;
    const { db, capture } = fixture;
    const { manifest, citationId } = primaryAttempt.captured!;
    const target = expectedTarget(citationId);
    await qualifyCatalog(fixture, primaryAttempt, target);
    const events = ([
      { account: 'sync-bundle-selected', id: 'sync-bundle-pay-selected', amount: '100.00', cents: 10000, sequence: 3 },
      { account: 'sync-bundle-other', id: 'sync-bundle-pay-other', amount: '100.00', cents: 10000, sequence: 4 },
    ] as const).map(({ account, id, amount, cents, sequence }) => {
      expect(parseMinorUnits(amount)).toEqual({ ok: true, cents });
      const event = eventA({ kind: 'payment', recordId: id, sourceAccountId: account, effectiveDate: '2026-10-01',
        fields: { account, id, amount, version: 1, effective_date: '2026-10-01' } }, sequence, '2026-10-02T00:00:00.000Z');
      expect(event).toMatchObject({ id: 'evt:' + id, recordId: id, recordVersion: 1, sequence, schemaVersion: 'schema-a-1',
        semanticVersion: 'sem-a-1', effectiveAt: '2026-10-01T00:00:00.000Z', observedAt: '2026-10-02T00:00:00.000Z',
        payload: { account, amount, id, version: 1, effective_date: '2026-10-01' } });
      expect(Object.keys(event.payload).sort()).toEqual(['account', 'amount', 'effective_date', 'id', 'version']);
      return event;
    });
    const page = ChangePageSchema.parse({ sourceRef: 'legacy-a', streamId: 'a-finance', after: '2', next: '4', complete: true, events });
    const nonCaptureBefore = await snapshotRows(db, nonCaptureTables);
    const controlBefore = await snapshotRows(primaryAttempt.control!, controlTables);
    const previousActivity = (await db.query('SELECT event FROM activity_events ORDER BY sequence')).rows;
    expect(await capture(page)).toEqual({ disposition: 'captured', captured: 2, cursor: '4', replayed: false });
    await expectCapture(fixture, page);
    const afterActivity = (await db.query('SELECT event FROM activity_events ORDER BY sequence')).rows;
    expect(afterActivity.slice(0, -1)).toEqual(previousActivity);
    expect(afterActivity.at(-1)).toMatchObject({ event: { type: 'source.captured', payload: { sourceRef: 'legacy-a', manifestHash: manifest.hash, captured: 2 } } });
    expect(await snapshotRows(db, nonCaptureTables)).toEqual(nonCaptureBefore);
    expect(await snapshotRows(primaryAttempt.control!, controlTables)).toEqual(controlBefore);
    await qualifyCatalog(fixture, primaryAttempt, target);
    await saveOriginals(primaryAttempt, 'after-capture');
    const afterCapture = await snapshotRows(db, captureTables);
    expect(await capture(page)).toEqual({ disposition: 'replayed', captured: 0, cursor: '4', replayed: true });
    expect(await snapshotRows(db, captureTables)).toEqual(afterCapture);
    expect(await snapshotRows(db, nonCaptureTables)).toEqual(nonCaptureBefore);
    expect(await snapshotRows(primaryAttempt.control!, controlTables)).toEqual(controlBefore);
    await qualifyCatalog(fixture, primaryAttempt, target);
    await saveOriginals(primaryAttempt, 'after-replay');
    await save(primaryAttempt, 'capture-and-replay', {
      manifestHash: manifest.hash, after: page.after, next: page.next, digest: hashCanonical(page),
      deliveries: events.map(event => ({ id: event.id, sequence: event.sequence, hash: event.contentHash })),
      nonCaptureTableDigests: nonCaptureBefore, controlTableDigests: controlBefore, unchangedReplayTableDigests: afterCapture,
    });
  });

  test('fresh construction and immutable inputs', async () => {
    let fixture: Fixture | undefined;
    try {
      fixture = await construct(freshAttempt);
      await qualify(fixture, freshAttempt);
      await expectCapture(fixture);
      expect(freshAttempt.root).not.toBe(primaryAttempt.root);
      expect(freshAttempt.namespace).not.toBe(primaryAttempt.namespace);
      expect(freshAttempt.before).toEqual(primaryAttempt.before);
      expect(fixture.selected.stored.receipt.id).not.toBe(primary!.selected.stored.receipt.id);
      expect(fixture.selected.stored.request.reviewPackageId).not.toBe(primary!.selected.stored.request.reviewPackageId);
      expect(fixture.selected.stored.bundleHash).not.toBe(primary!.selected.stored.bundleHash);
      await saveOriginals(primaryAttempt, 'after-fresh-construction');
      await saveOriginals(freshAttempt, 'after-proof');
      await saveProof(freshAttempt, fixture);
      expect(await unchangedSources()).toEqual(sourceBefore);
    } finally {
      try {
        if (fixture) {
          await fixture.close();
          await verifyCleanup(freshAttempt);
        }
      } finally {
        await fallback(freshAttempt);
      }
    }
  });

  test('partial construction cleanup', async () => {
    try {
      await expect(construct(failedAttempt).then(fixture => fixture.close())).rejects.toBe(sentinel);
      expect(failedAttempt.composed).toBe(true);
      expect(failedAttempt.before).toEqual(primaryAttempt.before);
      expect(failedAttempt.measurements.map(item => [item.stage, item.status])).toEqual([
        ['financial-probe', 'ok'], ['financial-launch', 'ok'],
      ]);
      await save(failedAttempt, 'financial-before-sentinel', { outer: failedAttempt.measurements, elapsedMs: failedAttempt.elapsedMs });
      await verifyCleanup(failedAttempt);
      expect(await unchangedSources()).toEqual(sourceBefore);
    } finally {
      await fallback(failedAttempt);
    }
  });
});
