import {
  ActivationBundleV2Schema, CaptureAttestationV1Schema, VerificationCheckIdSchema,
  canonicalJson, hashArtifact, hashBootstrapVerificationResult, hashBundleV2, hashCanonical, hashEvent,
  hashFinancialAttestation, hashFinancialReport, hashFinancialReservation, hashManifest, hashPlan, hashProfile,
  hashReviewPackage, matchesActivationTrustPolicyEntry, type ActivationBundleV2,
  type ActivationTrustPolicyV1, type CustomerProfile, type SemanticPreflight,
} from '@eapr/contracts';

export class ActivationError extends Error {
  constructor(readonly statusCode: 400 | 401 | 403 | 404 | 409 | 503, readonly code: string) { super(code); }
}

export const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const equalSet = (a: readonly string[], b: readonly string[]) => equal([...a].sort(), [...b].sort());
function mismatch(): never { throw new ActivationError(409, 'ACTIVATION_BUNDLE_MISMATCH'); }

// Mirrors the safe capture checks of financial issuance without bringing its launcher into the worker.
function deriveCapture(bundle: ActivationBundleV2) {
  try {
    const { artifact, profiles, manifest, snapshot } = bundle;
    const events = [...bundle.bootstrapEvents].sort((a, b) => compare(a.id, b.id));
    const { companyId, sourceRef } = manifest;
    const profileHashes = profiles.map(profile => profile.hash).sort();
    const eventIds = events.map(event => event.id);
    if (artifact.hash !== hashArtifact(artifact) || artifact.sourceRef !== sourceRef || artifact.normalizedPlan.sourceRef !== sourceRef ||
      manifest.hash !== hashManifest(manifest) || snapshot.sourceRef !== sourceRef || snapshot.manifestId !== manifest.id ||
      new Set(profiles.map(profile => profile.id)).size !== profiles.length ||
      new Set(profileHashes).size !== profiles.length ||
      !equal(profileHashes, [...artifact.requiredProfileHashes].sort()) ||
      profiles.some(profile => profile.hash !== hashProfile(profile) || profile.sourceRef !== sourceRef ||
        profile.scope.companyId !== companyId) ||
      new Set(eventIds).size !== events.length || !equal(eventIds, [...snapshot.eventIds].sort())) mismatch();

    const memberSnapshotIds = manifest.streams.map(stream => stream.snapshotId);
    if (new Set(memberSnapshotIds).size !== memberSnapshotIds.length || memberSnapshotIds.includes(snapshot.id)) mismatch();
    const streams = new Map(artifact.normalizedPlan.capture.map(stream => [stream.streamId, stream]));
    const byId = new Map(events.map(event => [event.id, event]));
    const streamMembers = manifest.streams.flatMap(({ streamId, resumeAfter, eventIds: members, snapshotHash }) => {
      const stream = streams.get(streamId);
      if (!stream || members.length !== Number(resumeAfter)) mismatch();
      const records = members.map((id, index) => {
        const event = byId.get(id);
        if (!event || event.sequence !== index + 1 || event.streamId !== streamId || event.sourceRef !== sourceRef ||
          event.rawIdentity.companyId !== companyId || !stream.resources.includes(event.resource) ||
          !Object.hasOwn(manifest.schemaVersions, event.resource) || manifest.schemaVersions[event.resource] !== event.schemaVersion ||
          event.contentHash !== hashEvent(event)) mismatch();
        return { id, contentHash: event.contentHash };
      });
      if (snapshotHash !== hashCanonical({ sourceRef, streamId, resumeAfter, events: records })) mismatch();
      return members;
    });
    const evidenceIds = [...snapshot.evidenceIds].sort();
    if (!equal(eventIds, streamMembers.sort()) || new Set(evidenceIds).size !== evidenceIds.length ||
      snapshot.contentHash !== hashCanonical({
        manifestHash: manifest.hash, eventIds, evidenceIds,
        streams: [...manifest.streams].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
          .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash })),
        files: [...manifest.files].sort((a, b) => a.fileId < b.fileId ? -1 : 1).map(({ fileId, sha256 }) => ({ fileId, sha256 })),
      })) mismatch();

    return CaptureAttestationV1Schema.parse({
      companyId, sourceRef, manifestId: manifest.id, manifestHash: manifest.hash,
      snapshotId: snapshot.id, snapshotHash: snapshot.contentHash, snapshotObjectHash: hashCanonical(snapshot),
      eventsHash: hashCanonical(events),
    });
  } catch {
    return mismatch();
  }
}

export function selectedProfile(bundle: ActivationBundleV2): CustomerProfile {
  const profile = bundle.profiles.find(candidate => candidate.hash === bundle.request.expectedProfileHash);
  return profile ?? mismatch();
}

export function validateSemantics(bundle: ActivationBundleV2, profile: CustomerProfile, observation: SemanticPreflight) {
  const { manifest } = bundle;
  if (observation.sourceRef !== manifest.sourceRef || Object.hasOwn(observation.versions, '*') ||
      Object.hasOwn(manifest.semanticVersions, '*') || profile.sourceAccountIds.some(id => {
        const key = profile.scope.sellerEntityId + '/' + id;
        return !Object.hasOwn(observation.versions, key) || !Object.hasOwn(manifest.semanticVersions, key) ||
          observation.versions[key] !== profile.semanticVersion || manifest.semanticVersions[key] !== profile.semanticVersion;
      })) throw new ActivationError(409, 'SOURCE_SEMANTICS_MISMATCH');
}

export function validateActivationBundle(input: unknown, policy: ActivationTrustPolicyV1 | undefined) {
  const parsed = ActivationBundleV2Schema.safeParse(input);
  const bundle = parsed.success ? parsed.data : mismatch();
  const { request, artifact, manifest, snapshot, reviewPackage: review, previewPlan: plan,
    verificationReport: report, financialAttestation: attestation, bootstrapVerification: bootstrap, authorityPolicy } = bundle;
  const profile = selectedProfile(bundle);
  const { scope } = profile;
  const capture = deriveCapture(bundle);
  if (bundle.hash !== hashBundleV2(bundle) || review.hash !== hashReviewPackage(review) ||
      plan.hash !== hashPlan(plan) || !equal(scope, review.scope) || !equal(scope, plan.scope) ||
      request.reviewPackageId !== review.id || request.expectedPackageHash !== review.hash ||
      request.expectedArtifactHash !== artifact.hash || review.artifactHash !== artifact.hash || plan.artifactHash !== artifact.hash ||
      review.profileHash !== profile.hash || plan.profileHash !== profile.hash || review.manifestHash !== manifest.hash ||
      request.expectedTargetVersion !== plan.expectedTargetVersion || review.expectedTargetVersion !== plan.expectedTargetVersion ||
      review.previewPlanHash !== plan.hash || plan.asOf !== manifest.asOf || review.verificationReportId !== report.id) mismatch();
  if (!review.ready || review.diagnostics.some(diagnostic => diagnostic.severity === 'blocker')) {
    throw new ActivationError(409, 'REVIEW_NOT_READY');
  }
  validateSemantics(bundle, profile, bundle.semanticPreflight);

  const { reservation } = attestation;
  const { issuerId, runnerId, protocolVersion, harnessVersion, evaluatorBuildHash, evidencePin } = reservation;
  const profileHashes = artifact.requiredProfileHashes;
  const mandatory = VerificationCheckIdSchema.options;
  if (reservation.hash !== hashFinancialReservation(reservation) || attestation.hash !== hashFinancialAttestation(attestation) ||
      attestation.reportId !== report.id || attestation.reportHash !== hashFinancialReport(report) ||
      reservation.artifactHash !== artifact.hash || !equalSet(reservation.requiredProfileHashes, profileHashes) ||
      !equal(reservation.capture, capture) || report.artifactHash !== artifact.hash || report.manifestHash !== manifest.hash ||
      report.evaluatorBuildHash !== evaluatorBuildHash || report.harnessVersion !== harnessVersion ||
      report.fixtureSetId !== evidencePin.fixtureSetId || report.fixtureSetVersion !== evidencePin.fixtureSetVersion ||
      !equalSet(report.profileHashes, profileHashes) || !equalSet(report.coverage.profileHashes, profileHashes) ||
      !equalSet(report.coverage.sourceRefs, [manifest.sourceRef]) ||
      !equalSet(report.coverage.eventKinds, artifact.normalizedPlan.allowedKinds) ||
      !equalSet(report.coverage.required, mandatory) || !equalSet(report.coverage.executed, mandatory) ||
      !equalSet(report.checks.map(check => check.id), mandatory) ||
      report.checks.some(check => check.status !== 'passed' || check.cases === 0 || check.diagnosticCodes.length !== 0) ||
      report.unexplainedDifferenceCents !== 0 || !report.eligible) {
    throw new ActivationError(409, 'FINANCIAL_ATTESTATION_MISMATCH');
  }

  const { binding } = bootstrap;
  if (!bootstrap.passed || bootstrap.hash !== hashBootstrapVerificationResult(bootstrap) ||
      bootstrap.planHash !== plan.hash || binding.artifactHash !== artifact.hash || binding.profileHash !== profile.hash ||
      !equalSet(binding.requiredProfileHashes, profileHashes) || !equal(binding.scope, scope) ||
      binding.manifestId !== manifest.id || binding.manifestHash !== manifest.hash || binding.snapshotId !== snapshot.id ||
      binding.snapshotHash !== capture.snapshotHash || binding.eventsHash !== capture.eventsHash ||
      binding.expectedTargetVersion !== plan.expectedTargetVersion || binding.asOf !== manifest.asOf) {
    throw new ActivationError(409, 'BOOTSTRAP_VERIFICATION_MISMATCH');
  }

  if (!policy) throw new ActivationError(503, 'ACTIVATION_POLICY_UNAVAILABLE');
  if (authorityPolicy.issuerId !== issuerId || authorityPolicy.policyId !== policy.policyId || authorityPolicy.policyHash !== policy.hash ||
      policy.entries.filter(entry => matchesActivationTrustPolicyEntry(entry, {
        issuerId, financial: { runnerId, protocolVersion, harnessVersion, evaluatorBuildHash, evidencePin },
        bootstrapPin: bootstrap.pin, capture, artifactHash: artifact.hash, requiredProfileHashes: profileHashes,
        selectedProfileHash: profile.hash, scope,
      })).length !== 1) throw new ActivationError(409, 'ACTIVATION_POLICY_MISMATCH');
  return { bundle, profile };
}
