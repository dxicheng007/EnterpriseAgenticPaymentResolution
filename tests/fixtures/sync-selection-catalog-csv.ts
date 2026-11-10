import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import {
  VerificationCheckIdSchema, canonicalJson, hashCanonical, targetRecordId, type TargetState,
} from '@eapr/contracts';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import { createSourceService } from '@eapr/sources';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createControlDb } from '@eapr/storage/control-db';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { decodeBatch } from '../../packages/sources/src/company-b.js';
import { readDiscoveryCaptureContents } from '../../packages/sources/src/discovery-reads.js';
import { migrate } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { issueActivationProofs, verifyOriginals } from './activation-proof.js';
import { testNamespace } from './harness.js';
import { originalsAt } from './sync-selection-evidence.js';
import { openInstalledSelectionReviewer, type SelectionProof, type SelectionSubject } from './sync-selection-reviewer.js';

const tag = hashCanonical('activation-policy').slice(0, 12);
const sourceAccountId = 'cust-b-' + tag + '-1';
const sourceRef = 'legacy-b';
const scope = { companyId: 'company-b', sellerEntityId: 'seller-b', accountId: 'company-b.seller-b.' + sourceAccountId };
const asOf = '2026-10-01T00:00:00.000Z';
const key = 'sync-catalog-csv-approve-b';
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

async function assertLiteralImport(db: Pool, { stored, identity }: SelectionSubject, citationId: string) {
  const base = (kind: 'invoice' | 'payment' | 'allocation', recordId: string, date: string) => {
    const identity = { sourceRef, sellerEntityId: 'seller-b', kind, recordId };
    return { id: targetRecordId(identity), identity, scope, sourceRecordVersion: 1, sourceEventId: 'evt:' + recordId,
      effectiveAt: date + 'T00:00:00.000Z', currency: 'USD' as const, amountCents: 300000 };
  };
  const dates = [['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30']] as const;
  const monthly = dates.map(([date, dueDate]) => {
    const suffix = sourceAccountId + '-' + date;
    return {
      invoice: { ...base('invoice', 'inv-b:' + suffix, date), kind: 'invoice' as const, dueDate },
      payment: { ...base('payment', 'pay-b:' + suffix, date), kind: 'payment' as const },
      allocation: { ...base('allocation', 'alloc-b:' + suffix, date), kind: 'allocation' as const,
        fundingKind: 'payment' as const, fundingRecordId: 'pay-b:' + suffix, invoiceRecordId: 'inv-b:' + suffix },
    };
  });
  const buyer = 'buyer-shared-' + tag;
  const evidenceRefs = [citationId];
  const expected: TargetState = {
    scope, version: 1, asOf, invoices: monthly.map(item => item.invoice), payments: monthly.map(item => item.payment),
    allocations: monthly.map(item => item.allocation), credits: [], reversals: [],
    customers: [{ id: buyer, displayName: 'Shared Buyer ' + tag, evidenceRefs }],
    accounts: [{ id: scope.accountId, scope, parentCustomerId: buyer, sourceRef, sourceAccountIds: [sourceAccountId] }],
    billingConfigurations: [{ id: 'configuration:demo-term-b', scope, contractTerm: {
      id: 'demo-term-b', contractId: 'contract-b-' + tag + '-1', validFrom: '2026-07-01', validToExclusive: null,
      fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs,
    } }],
  };
  const order = (a: { sourceEventId: string }, b: { sourceEventId: string }) => a.sourceEventId.localeCompare(b.sourceEventId);
  const records = stored.approvedTarget.records;
  assert(equal({ ...records, invoices: records.invoices.toSorted(order), payments: records.payments.toSorted(order),
    allocations: records.allocations.toSorted(order) }, expected), 'Unexpected literal Company B target');
  // The compatibility helper uses Vitest rich equality. Limit any private failure to its safe stage label.
  try { verifyOriginals(records, 'b'); }
  catch { throw new Error('Company B original-record compatibility failed'); }

  const { receipt, activation, plan, request } = stored;
  const financial = [...expected.invoices, ...expected.payments, ...expected.allocations];
  assert(equal(identity, { scope, activationId: activation.id, bundleHash: stored.bundleHash }) &&
    request.idempotencyKey === key && equal({ ...receipt, eventIds: receipt.eventIds.toSorted(), targetRecordIds: receipt.targetRecordIds.toSorted() }, {
      id: receipt.id, scope, activationId: activation.id, epoch: 1, artifactHash: activation.artifactHash, planHash: plan.hash,
      eventIds: financial.map(record => record.sourceEventId).sort(), targetRecordIds: financial.map(record => record.id).sort(),
      beforeBalanceCents: 0, afterBalanceCents: 0, status: 'applied', committedAt: '2026-11-09T08:00:00.000Z',
    }), 'Unexpected first Company B receipt');
  await withTransaction(db, async client => {
    assert(equal(await readStoredTarget(client, scope), stored.approvedTarget), 'Unexpected current Company B target');
    const origins = await readFinancialOrigins(client, scope, financial);
    const orderOrigin = (a: { recordId: string }, b: { recordId: string }) => a.recordId.localeCompare(b.recordId);
    assert(equal(origins.toSorted(orderOrigin), financial.map(record => ({
      kind: 'initial', recordId: record.id, importKey: key, receipt,
    })).sort(orderOrigin)), 'Unexpected Company B financial origins');
  });
}

export async function createSyncSelectionCatalogCsvFixture(): Promise<{ db: Pool; subject: SelectionSubject; close(): Promise<void> }> {
  const owned: (() => Promise<void>)[] = [];
  let closing: Promise<void> | undefined;
  const close = () => closing ??= Promise.resolve().then(async () => {
    const failures: unknown[] = [];
    for (const cleanup of owned.toReversed()) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Company B catalog cleanup failed');
  });

  try {
    const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-catalog-csv-'));
    owned.push(() => rm(root, { recursive: true, force: true }));
    await startNativeDb();
    const namespace = testNamespace('catalogcsv');
    const pair = await provisionTest(namespace);
    owned.push(() => dropTest(namespace));
    const control = createControlDb({ connectionString: pair.control.appUrl });
    owned.push(() => control.end());
    const db = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    owned.push(() => db.end());
    await migrate(pair);

    const proofs = await issueActivationProofs(root, control);
    const originalInputs = await originalsAt(root);
    assert(originalInputs.length === 66 && originalInputs.every(item => 'bytes' in item && item.bytes > 0), 'Incomplete A/B original inputs');
    const { a, b, candidates, dependencies, registryRoot, bootstrapRoots, policyPath, selectionPath } = proofs;
    const [candidate, policy] = await Promise.all([
      candidates.getCandidate(b.selection.artifactHash, b.selection.manifestId), loadActivationPolicy({ policyPath }),
    ]);
    const [entry, duplicate] = policy.entries.filter(item => item.scope.accountId === b.accountId &&
      item.artifactHash === b.selection.artifactHash && item.selectedProfileHash === b.selection.selectedProfileHash &&
      item.capture.manifestId === b.selection.manifestId);
    const profile = candidate.profiles.find(item => item.hash === b.selection.selectedProfileHash);
    assert(entry && !duplicate && profile && equal(profile.scope, scope) && equal(entry.scope, scope) &&
      profile.sourceRef === sourceRef && equal(profile.sourceAccountIds, [sourceAccountId]) &&
      candidate.manifest.sourceRef === sourceRef && entry.capture.manifestHash === candidate.manifest.hash &&
      entry.capture.snapshotId === candidate.snapshot.id && entry.capture.snapshotHash === candidate.snapshot.contentHash,
    'Missing exact Company B registered candidate and policy entry');
    const { report, attestation } = await createFinancialAttestationRegistry(control, candidates)
      .readRegisteredFinancialAttestation(b.selection.financialReportId, {
        artifactHash: b.selection.artifactHash, requiredProfileHashes: candidate.artifact.requiredProfileHashes,
        capture: entry.capture, policy,
      });
    const mandatory = [...VerificationCheckIdSchema.options].sort();
    const kinds = ['allocation', 'credit', 'invoice', 'payment', 'reversal'];
    assert(report.eligible && report.unexplainedDifferenceCents === 0 &&
      equal(report.checks.map(item => item.id).sort(), mandatory) &&
      report.checks.every(item => item.status === 'passed' && item.cases > 0) &&
      equal(report.coverage.required.toSorted(), mandatory) && equal(report.coverage.executed.toSorted(), mandatory) &&
      equal(report.coverage.sourceRefs, [sourceRef]) && equal(report.coverage.eventKinds.toSorted(), kinds) &&
      equal(candidate.artifact.normalizedPlan.allowedKinds.toSorted(), kinds) &&
      equal(report.coverage.profileHashes, candidate.artifact.requiredProfileHashes),
    'Incomplete genuine Company B financial proof');
    const proof: SelectionProof = { report, attestation, entry: b.selection };
    const service = createSourceService(dependencies, localSourceCatalog);
    const reviewer = await openInstalledSelectionReviewer({
      db, dependencies, candidates, service, registryRoot, bootstrapRoots, policyPath, selectionPath, proofs: [proof],
    });
    owned.push(() => reviewer.stop());
    const subject = await reviewer.approve(proof, key);
    await reviewer.stop();

    const captured = await readDiscoveryCaptureContents(dependencies, localSourceCatalog, b.capture);
    const citation = captured.fileCitations.find(item =>
      item.sourceId === b.capture.contractFileId && item.locator.kind === 'pdf' && item.locator.page === 1);
    const files = captured.files.filter(file => file.metadata.kind === 'event_csv');
    const bundle = subject.stored.bundle;
    assert(citation && equal(bundle.manifest, captured.manifest) && equal(bundle.artifact.normalizedPlan.capture.map(item =>
      [item.streamId, item.transport]).sort(), [['b-files', 'csv'], ['b-receipts', 'api'], ['b-semantics', 'semantic']]) &&
      equal(bundle.manifest.streams.map(item => [item.streamId, item.resumeAfter, item.eventIds.length]).sort(),
        [['b-files', '18', 18], ['b-receipts', '10', 10], ['b-semantics', '0', 0]]) && files.length === 3 &&
      files.every(file => file.metadata.batch?.streamId === 'b-files' && decodeBatch('b-files', file.extraction.document).length === 6),
    'Company B import must be bound to the genuine CSV capture');
    const csv = files.flatMap(file => decodeBatch('b-files', file.extraction.document));
    assert(equal(csv.map(event => event.id).sort(), captured.manifest.streams.find(item => item.streamId === 'b-files')!.eventIds.toSorted()) &&
      equal(csv.filter(event => event.rawIdentity.sourceAccountId === sourceAccountId).map(event => event.id).sort(),
        [...subject.stored.approvedTarget.records.invoices, ...subject.stored.approvedTarget.records.allocations]
          .map(record => record.sourceEventId).sort()), 'Selected Company B financial records lack exact CSV membership');
    await assertLiteralImport(db, subject, citation.id);

    const [{ rows: imports }, { rows: [captureCount] }, { rows: [selecting] }] = await Promise.all([
      db.query('SELECT account_id, capture_source_ref, idempotency_key FROM runtime_activation_imports ORDER BY account_id'),
      db.query('SELECT (SELECT count(*)::int FROM runtime_capture_lanes) AS lanes, ' +
        '(SELECT count(*)::int FROM runtime_capture_pages) AS pages'),
      control.query('SELECT (SELECT count(*)::int FROM prepared_reviews WHERE account_id = $1 OR source_ref = $2) AS requests, ' +
        '(SELECT count(*)::int FROM activation_intents WHERE account_id = $1 OR source_ref = $2) AS intents', [a.accountId, a.sourceRef]),
    ]);
    assert(equal(imports, [{ account_id: scope.accountId, capture_source_ref: sourceRef, idempotency_key: key }]) &&
      equal(captureCount, { lanes: 0, pages: 0 }) && equal(selecting, { requests: 0, intents: 0 }) &&
      equal(await originalsAt(root), originalInputs), 'Unexpected enrollment, capture or input change');
    await withTransaction(db, async client => {
      const aScope = { companyId: 'company-a', sellerEntityId: 'seller-a', accountId: a.accountId };
      assert(await readStoredActivation(client, aScope) === null && await readStoredTarget(client, aScope) === null,
        'Incidental Company A cannot have an activation or target');
    });
    return { db, subject, close };
  } catch (error) {
    try { await close(); }
    catch { console.error('Company B catalog cleanup failed while preserving the original construction error'); }
    throw error;
  }
}
