import { planBootstrap } from '@eapr/compiler/plan-bootstrap';
import {
  canonicalJson, hashCanonical, hashFinancialReport, hashTargetSnapshot,
  type ActivationTrustPolicyV1, type SemanticPreflight,
} from '@eapr/contracts';
import { hasFinancialBaseline } from '@eapr/evaluator/bootstrap-verify';
import { deriveFinancialCapture } from '@eapr/evaluator/financial-attestation-verify';
import type { FinancialCaptureReader } from '@eapr/evaluator/financial-attestation-launcher';
import type { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import type { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import type { LocalReviewerContext } from './local-session.js';
import type { ParentReadClient } from './parent-read-client.js';
import type { createReviewProofSelection, loadReviewSelection } from './review-proof-selection.js';
import { headToken, ReviewError, type ReviewRepository } from './review-repository.js';

const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
type Selection = Awaited<ReturnType<typeof loadReviewSelection>>;

export function createReviewPreparation(options: {
  repository: ReviewRepository;
  setup: { policy: ActivationTrustPolicyV1; selection: Selection } | undefined;
  registered: ReturnType<typeof createRegisteredScopeReader>;
  captureReader: FinancialCaptureReader;
  financial: ReturnType<typeof createFinancialAttestationRegistry>;
  selectBootstrap: ReturnType<typeof createReviewProofSelection>;
  parent: ParentReadClient;
  observe: (sourceRef: string) => Promise<SemanticPreflight>;
}) {
  const { repository, setup, registered, captureReader, financial, selectBootstrap, parent, observe } = options;

  function selectedEntry(reference: Selection['entries'][number], policy: ActivationTrustPolicyV1) {
    const { artifactHash, manifestId, selectedProfileHash, bootstrapFixture } = reference;
    const [entry, duplicate] = policy.entries.filter(candidate => candidate.artifactHash === artifactHash &&
      candidate.capture.manifestId === manifestId && candidate.selectedProfileHash === selectedProfileHash &&
      candidate.bootstrapPin.fixtureSetId === bootstrapFixture.fixtureSetId &&
      candidate.bootstrapPin.fixtureSetVersion === bootstrapFixture.fixtureSetVersion &&
      candidate.bootstrapPin.fixtureHash === bootstrapFixture.fixtureHash);
    if (!entry || duplicate) throw new ReviewError(503, 'ACTIVATION_POLICY_MISMATCH');
    return entry;
  }

  async function revalidate(accountId: string, grants: LocalReviewerContext, mode: 'prepare' | 'activate') {
    requireAccount(accountId, grants);
    if (!setup) throw new ReviewError(503, 'ACTIVATION_POLICY_UNAVAILABLE');
    const { selection, policy } = setup;
    if (selection.policyId !== policy.policyId) throw new ReviewError(503, 'ACTIVATION_POLICY_MISMATCH');
    const entries = selection.entries.map(reference => ({ reference, entry: selectedEntry(reference, policy) }));
    if (new Set(entries.map(({ entry }) => entry.scope.accountId)).size !== entries.length) {
      throw new ReviewError(503, 'ACTIVATION_POLICY_MISMATCH');
    }
    const selected = entries.find(({ entry }) => entry.scope.accountId === accountId);
    if (!selected) throw new ReviewError(404, 'REVIEW_SELECTION_NOT_FOUND');
    const { entry, reference } = selected;
    requireSource(entry.capture.sourceRef, grants);
    const member = await registered.readSnapshot().then(snapshot => snapshot.resolveRegisteredScope(accountId));
    if (!member) throw new ReviewError(404, 'REVIEW_SELECTION_NOT_FOUND');
    requireSource(member.profile.sourceRef, grants);
    if (!equal(member.entry.scope, entry.scope) || member.entry.profileHash !== entry.selectedProfileHash ||
        member.entry.manifestId !== entry.capture.manifestId || member.entry.manifestHash !== entry.capture.manifestHash ||
        member.profile.sourceRef !== entry.capture.sourceRef) throw new ReviewError(409, 'ACTIVATION_POLICY_MISMATCH');
    if (mode === 'activate') {
      const activation = await parent.readActivation(accountId, grants);
      if (!equal(activation.scope, entry.scope)) throw new ReviewError(409, 'ACTIVATION_POLICY_MISMATCH');
      if (activation.activation) throw new ReviewError(409, 'ALREADY_ACTIVE');
    }
    const capture = await captureReader.readCapture(reference);
    const { artifact, profiles, manifest, events } = capture;
    const captureAttestation = deriveFinancialCapture(capture);
    const profile = profiles.find(candidate => candidate.hash === entry.selectedProfileHash);
    if (!profile?.bootstrap || !equal(profile, member.profile) || !equal(manifest, member.manifest) ||
        !equal(entry.capture, captureAttestation) || !equal(entry.requiredProfileHashes, [...artifact.requiredProfileHashes].sort())) {
      throw new ReviewError(409, 'ACTIVATION_POLICY_MISMATCH');
    }
    const { report, attestation } = await financial.readRegisteredFinancialAttestation(reference.financialReportId, {
      artifactHash: artifact.hash, requiredProfileHashes: artifact.requiredProfileHashes, capture: captureAttestation, policy,
    });
    const { runnerId, protocolVersion, harnessVersion, evaluatorBuildHash, evidencePin, issuerId } = attestation.reservation;
    if (!report.eligible || issuerId !== entry.issuerId ||
        !equal(entry.financial, { runnerId, protocolVersion, harnessVersion, evaluatorBuildHash, evidencePin })) {
      throw new ReviewError(409, 'FINANCIAL_ATTESTATION_MISMATCH');
    }
    const parentView = await parent.readParent(accountId, { asOf: manifest.asOf }, grants, profile.scope);
    const recordedTarget = parentView.records;
    const plannerTarget = { ...recordedTarget, asOf: manifest.asOf };
    const { plans } = planBootstrap(artifact, profile, events, plannerTarget);
    const [plan] = plans;
    if (plans.length !== 1 || !plan || !hasFinancialBaseline(plan)) throw new ReviewError(409, 'REVIEW_NOT_READY');

    const observation = await observe(manifest.sourceRef);
    const selectedSemanticVersions = Object.fromEntries(profile.sourceAccountIds.map(id =>
      [profile.scope.sellerEntityId + '/' + id, profile.semanticVersion]));
    if (observation.sourceRef !== manifest.sourceRef || Object.hasOwn(observation.versions, '*') ||
        Object.hasOwn(manifest.semanticVersions, '*') ||
        Object.entries(selectedSemanticVersions).some(([key, version]) =>
          !Object.hasOwn(observation.versions, key) || !Object.hasOwn(manifest.semanticVersions, key) ||
          observation.versions[key] !== version || manifest.semanticVersions[key] !== version)) {
      throw new ReviewError(409, 'SOURCE_SEMANTICS_MISMATCH');
    }

    const proof = await selectBootstrap({
      capture, entry, policyHash: policy.hash, recordedTargetHash: parentView.snapshotHash,
      target: plannerTarget, plan, allowExecute: mode === 'prepare',
    });
    const fields = {
      scope: profile.scope, artifactHash: artifact.hash, profileHash: profile.hash, manifestHash: manifest.hash,
      verificationReportId: report.id, previewPlanHash: plan.hash, expectedTargetVersion: plannerTarget.version,
      diagnostics: [], ready: true,
    };
    const authorityPolicy = { issuerId, policyId: policy.policyId, policyHash: policy.hash };
    const authorityContent = {
      fields, capture, captureAttestation, parentView, recordedTargetHash: parentView.snapshotHash,
      plannerTarget, plannerTargetHash: hashTargetSnapshot(plannerTarget), plan, planBytesHash: hashCanonical(plan),
      observedPlanBytesHash: hashCanonical(proof.plan), report, reportHash: hashFinancialReport(report),
      attestation, bootstrapVerification: proof.result, authorityPolicy, entry, selectedSemanticVersions,
    };
    const semanticContent = { sourceRef: observation.sourceRef, versions: observation.versions };
    const fingerprint = hashCanonical({ authorityContent, semanticContent });
    const authorityDigest = hashCanonical(authorityContent);
    return { fields, fingerprint, authorityDigest, companion: { authorityContent, authorityDigest, observation } };
  }

  return {
    revalidate,
    async prepare(accountId: string, grants: LocalReviewerContext) {
      requireAccount(accountId, grants);
      const token = headToken((await repository.readHead(accountId))?.review);
      const { fields, fingerprint, companion } = await revalidate(accountId, grants, 'prepare');
      return repository.savePreparation(token, { fields, fingerprint, companion, sourceRef: companion.observation.sourceRef });
    },
    async get(accountId: string, grants: LocalReviewerContext) {
      requireAccount(accountId, grants);
      const head = await repository.readHead(accountId);
      if (!head) throw new ReviewError(404, 'REVIEW_NOT_FOUND');
      requireSource(head.sourceRef, grants);
      return head.review;
    },
  };
}

export function requireAccount(accountId: string, grants: LocalReviewerContext) {
  if (!grants.allowedAccountIds.includes(accountId)) throw new ReviewError(403, 'REVIEW_FORBIDDEN');
}

export function requireSource(sourceRef: string, grants: LocalReviewerContext) {
  if (!grants.allowedSourceRefs.includes(sourceRef)) throw new ReviewError(403, 'REVIEW_FORBIDDEN');
}

export type ReviewPreparation = ReturnType<typeof createReviewPreparation>;
