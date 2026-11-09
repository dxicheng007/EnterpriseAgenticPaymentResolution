import { compile } from '@eapr/compiler/compile';
import { planBootstrap } from '@eapr/compiler/plan-bootstrap';
import {
  bootstrapAssertionCases, bootstrapRequiredAssertions, bootstrapRequiredCases, canonicalJson, hashBootstrapVerificationResult,
  hashBundleV2, hashCanonical, hashEvent, hashFinancialAttestation, hashFinancialReport, hashFinancialReservation, hashManifest,
  hashProfile, hashReviewPackage, hashTargetSnapshot, type ActivationBundleV2, type CustomerActivation,
  type RawSourceEvent, type SyncReceipt, type TargetState,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { lockFirstImport, persistFirstImport } from '@eapr/parent/activation-store';
import { projectBootstrapTarget } from '@eapr/parent/bootstrap';
import { lockImportIdentities } from '@eapr/parent/persistence';
import type { PoolClient } from 'pg';
import {
  baselineEventsA, baselineEventsB, baselineManifestA, baselineManifestB, emptyTargetA, emptyTargetB,
  profileA, profileB, validSpecA, validSpecB,
} from './index.js';

const h = (digit: string) => digit.repeat(64);
const issuerId = 'eapr-control-registry-1' as const;

function capturedEventsHash(events: RawSourceEvent[]) {
  return hashCanonical([...events].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function refreshCapture(bundle: ActivationBundleV2) {
  const eventsHash = capturedEventsHash(bundle.bootstrapEvents);
  bundle.snapshot.eventIds = bundle.bootstrapEvents.map(event => event.id);
  const { reservation } = bundle.financialAttestation;
  reservation.capture.eventsHash = eventsHash;
  reservation.capture.snapshotObjectHash = hashCanonical(bundle.snapshot);
  reservation.hash = hashFinancialReservation(reservation);
  bundle.financialAttestation.hash = hashFinancialAttestation(bundle.financialAttestation);
  bundle.bootstrapVerification.binding.eventsHash = eventsHash;
  bundle.bootstrapVerification.hash = hashBootstrapVerificationResult(bundle.bootstrapVerification);
  bundle.hash = hashBundleV2(bundle);
}

// The public fixtures exercise storage contracts without asserting reviewer authority.
export function parentStorageFixture(company: 'a' | 'b' = 'a', options: {
  accountId?: string; key?: string; eventSuffix?: string; recordedTarget?: TargetState;
  events?: RawSourceEvent[]; customerName?: string;
} = {}) {
  const [original, originalSpec, originalManifest, originalEvents, emptyTarget] = company === 'a'
    ? [profileA, validSpecA, baselineManifestA, baselineEventsA, emptyTargetA] as const
    : [profileB, validSpecB, baselineManifestB, baselineEventsB, emptyTargetB] as const;
  const scope = { ...original.scope, accountId: options.accountId ?? original.scope.accountId };
  const base = { ...original, scope, approvedLookups: original.approvedLookups.map(lookup => ({
    ...lookup, entries: lookup.entries.map(entry => ({
      ...entry, target: entry.target === original.scope.accountId ? scope.accountId : entry.target,
    })),
  })) };
  const spec = originalSpec;
  const bootstrapEvents = (options.events ?? originalEvents).map(event => {
    if (!options.eventSuffix) return event;
    const versionField = spec.sourceContracts.find(contract => contract.resource === event.resource)!.recordVersionField!;
    const recordVersion = event.recordVersion + 1;
    const changed = { ...event, id: event.id + options.eventSuffix, recordVersion,
      payload: { ...event.payload, [versionField]: recordVersion } };
    return { ...changed, contentHash: hashEvent(changed) };
  });
  const manifest = structuredClone(originalManifest);
  manifest.streams.push({
    streamId: 'unused-zero-stream', snapshotId: 'zero-snapshot', snapshotHash: h('c'), resumeAfter: '0', eventIds: [],
  });
  manifest.hash = hashManifest(manifest);
  const profile = {
    ...base,
    bootstrap: {
      customer: { id: base.parentCustomerId, displayName: options.customerName ?? ' Shared Buyer ', evidenceRefs: ['ev-name', 'ev-id'] },
      billingConfigurationIds: base.contractTerms.map(term => ({ termId: term.id, id: 'config:' + term.id })),
    },
  };
  profile.hash = hashProfile(profile);
  const compiled = compile(spec, [profile]);
  if (!compiled.ok) throw new Error('Expected a compiled public artifact');
  const artifact = compiled.value;
  const recordedTarget = options.recordedTarget ?? { ...emptyTarget, scope };
  const target = { ...recordedTarget, asOf: manifest.asOf };
  const outcome = planBootstrap(artifact, profile, bootstrapEvents, target);
  const previewPlan = outcome.plans[0];
  if (!previewPlan) throw new Error('Expected public bootstrap preview plan: ' + JSON.stringify(outcome.holds));
  const jobId = 'financial:' + company;
  const verificationReport: ActivationBundleV2['verificationReport'] = {
    id: 'report:' + jobId, artifactHash: artifact.hash, profileHashes: [profile.hash], manifestHash: manifest.hash,
    harnessVersion: '1', evaluatorBuildHash: h('a'), fixtureSetId: 'financial-fixtures', fixtureSetVersion: '2',
    checks: [
      { id: 'new_record', status: 'unavailable', diagnosticCodes: ['FIRST', 'SECOND'], cases: 0 },
      { id: 'baseline_reconcile', status: 'unavailable', diagnosticCodes: [], cases: 0 },
    ],
    coverage: {
      required: ['new_record', 'baseline_reconcile'], executed: [], sourceRefs: [manifest.sourceRef],
      profileHashes: [profile.hash], eventKinds: ['payment', 'invoice'],
    },
    unexplainedDifferenceCents: 0, eligible: false, createdAt: manifest.asOf,
  };
  const snapshot = {
    id: 'snapshot:' + manifest.id, manifestId: manifest.id, sourceRef: manifest.sourceRef, capturedAt: manifest.asOf,
    contentHash: h('b'), evidenceIds: ['ev-id', 'ev-name'], eventIds: bootstrapEvents.map(event => event.id),
  };
  const reservation: ActivationBundleV2['financialAttestation']['reservation'] = {
    schemaVersion: '1', jobId, issuerId, runnerId: 'eapr-financial-1', protocolVersion: '1', harnessVersion: '1',
    evaluatorBuildHash: verificationReport.evaluatorBuildHash, purpose: 'construction',
    evidencePin: { fixtureSetId: verificationReport.fixtureSetId, fixtureSetVersion: '2', bundleHash: h('c') },
    artifactHash: artifact.hash, requiredProfileHashes: [profile.hash], hash: h('0'),
    capture: {
      companyId: profile.scope.companyId, sourceRef: manifest.sourceRef, manifestId: manifest.id, manifestHash: manifest.hash,
      snapshotId: snapshot.id, snapshotHash: snapshot.contentHash, snapshotObjectHash: hashCanonical(snapshot), eventsHash: capturedEventsHash(bootstrapEvents),
    },
  };
  reservation.hash = hashFinancialReservation(reservation);
  const financialAttestation: ActivationBundleV2['financialAttestation'] = {
    schemaVersion: '1', reservation, reportId: verificationReport.id, reportHash: hashFinancialReport(verificationReport), hash: h('0'),
  };
  financialAttestation.hash = hashFinancialAttestation(financialAttestation);
  const bootstrapVerification: ActivationBundleV2['bootstrapVerification'] = {
    schemaVersion: '1', id: 'bootstrap-result:bootstrap-' + company, jobId: 'bootstrap-' + company,
    pin: {
      runnerId: 'eapr-bootstrap-1', protocolVersion: '1', evaluatorBuildHash: h('1'), subjectBuildHash: h('2'),
      fixtureSetId: 'bootstrap-fixtures', fixtureSetVersion: '1', fixtureHash: h('3'),
    },
    binding: {
      artifactHash: artifact.hash, profileHash: profile.hash, requiredProfileHashes: [profile.hash], scope: profile.scope,
      manifestId: manifest.id, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotHash: snapshot.contentHash,
      eventsHash: reservation.capture.eventsHash, targetSnapshotHash: hashTargetSnapshot(target), expectedTargetVersion: target.version, asOf: manifest.asOf,
    },
    planHash: previewPlan.hash, passed: true, createdAt: manifest.asOf, hash: h('0'),
    assertions: bootstrapRequiredAssertions.map(id => ({ id, status: 'passed', caseIds: [...bootstrapAssertionCases[id]] })),
    cases: bootstrapRequiredCases.map(id => ({ id, status: 'passed' })),
  };
  bootstrapVerification.hash = hashBootstrapVerificationResult(bootstrapVerification);
  const reviewPackage = {
    id: 'review:' + company, revision: 1, hash: h('5'), scope: profile.scope,
    artifactHash: artifact.hash, profileHash: profile.hash, manifestHash: manifest.hash,
    verificationReportId: verificationReport.id, previewPlanHash: previewPlan.hash, expectedTargetVersion: target.version,
    ready: false, diagnostics: [],
  };
  reviewPackage.hash = hashReviewPackage(reviewPackage);
  const bundle: ActivationBundleV2 = {
    schemaVersion: '2', hash: h('0'), artifact, manifest, previewPlan, snapshot, profiles: [profile],
    bootstrapEvents, reviewPackage, verificationReport, bootstrapVerification, financialAttestation,
    request: {
      reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash, expectedArtifactHash: artifact.hash,
      expectedProfileHash: profile.hash, expectedTargetVersion: target.version, idempotencyKey: options.key ?? 'development-request:' + company,
    },
    reviewer: { reviewerId: 'development-reviewer', sessionId: 'development-session' },
    semanticPreflight: { sourceRef: manifest.sourceRef, checkedAt: manifest.asOf, versions: manifest.semanticVersions },
    authorityPolicy: { issuerId, policyId: 'public-policy', policyHash: h('6') },
  };
  bundle.hash = hashBundleV2(bundle);
  const activation: CustomerActivation = {
    id: 'activation:' + bundle.request.idempotencyKey, scope, artifactHash: artifact.hash, profileHash: profile.hash,
    manifestHash: manifest.hash, baselineCursors: manifest.streams.map(({ streamId, resumeAfter }) => ({ streamId, resumeAfter }))
      .sort((left, right) => left.streamId < right.streamId ? -1 : 1),
    allowedKinds: artifact.normalizedPlan.allowedKinds, limits: { maxTransactionCents: 5000000, maxRecordsPerCycle: 1000 },
    reviewerId: bundle.reviewer.reviewerId, epoch: 1, status: 'active', approvedAt: '2026-11-08T00:00:00.000Z',
  };
  const approvedTarget = { ...projectBootstrapTarget(target, previewPlan.operations), version: target.version + 1 };
  const receipt: SyncReceipt = {
    id: 'receipt:' + bundle.request.idempotencyKey, scope, activationId: activation.id, epoch: 1,
    artifactHash: artifact.hash, planHash: previewPlan.hash, eventIds: previewPlan.eventIds,
    targetRecordIds: previewPlan.operations.flatMap(({ record }) => 'identity' in record ? [record.id] : []),
    beforeBalanceCents: computeBalance(target, target.asOf), afterBalanceCents: computeBalance(approvedTarget, target.asOf),
    status: 'applied', committedAt: activation.approvedAt,
  };
  return { bundle, request: bundle.request, reviewer: bundle.reviewer, plan: previewPlan, activation, receipt,
    recordedTarget, plannerTarget: target, approvedTarget };

}


export type ParentStorageFixture = ReturnType<typeof parentStorageFixture>;
export async function persistParentStorageFixture(client: PoolClient, input: ParentStorageFixture) {
  const locked = await lockFirstImport(client, input.activation.scope, input.request.idempotencyKey);
  const identities = input.plan.operations.flatMap(({ record }) => 'identity' in record ? [record.identity] : []);
  const deliveries = input.bundle.bootstrapEvents.filter(event => input.plan.eventIds.includes(event.id));
  const identityLocks = await lockImportIdentities(client, identities, deliveries);
  return persistFirstImport(client, locked, { ...input, identityLocks });
}
