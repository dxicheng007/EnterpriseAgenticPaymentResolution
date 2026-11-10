import { z } from 'zod';
import {
  BootstrapManifestSchema, CompiledArtifactSchema, CustomerProfileSchema, HashSchema,
  MutationPlanSchema, ParentViewSchema, RawSourceEventSchema, SemanticPreflightSchema, SourceSnapshotSchema,
  TargetStateSchema, canonicalJson, hashCanonical, hashPlan, hashTargetSnapshot, strict,
  ReviewDetailsV1Schema, reviewEvidenceIds, reviewSafetyRulesV1, type ReviewDetailsV1,
} from '@eapr/contracts';
import { deriveFinancialCapture } from '@eapr/evaluator/financial-attestation-verify';
import type { LocalReviewerContext } from './local-session.js';
import { requireAccount, requireSource } from './review-preparation.js';
import { ReviewError, type ReviewRepository, type StoredPreparation } from './review-repository.js';

const captureSchema = strict({
  artifact: CompiledArtifactSchema, profiles: CustomerProfileSchema.array(), manifest: BootstrapManifestSchema,
  snapshot: SourceSnapshotSchema, events: RawSourceEventSchema.array(),
});
const companionSchema = z.object({
  authorityDigest: HashSchema, observation: SemanticPreflightSchema, authorityContent: z.unknown(),
});
const authoritySchema = z.object({
  fields: z.unknown(), capture: captureSchema, captureAttestation: z.unknown(),
  parentView: ParentViewSchema, recordedTargetHash: HashSchema, plannerTarget: TargetStateSchema,
  plannerTargetHash: HashSchema, plan: MutationPlanSchema, planBytesHash: HashSchema, observedPlanBytesHash: HashSchema,
});

const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const unavailable = () => new ReviewError(503, 'REVIEW_DETAILS_UNAVAILABLE');

function project({ review, companion, sourceRef }: StoredPreparation) {
  const { authorityDigest, authorityContent: originalAuthority, observation } = companionSchema.parse(companion);
  if (hashCanonical(originalAuthority) !== authorityDigest || observation.sourceRef !== sourceRef) throw unavailable();
  const authorityContent = authoritySchema.parse(originalAuthority);
  const { id: _id, revision: _revision, hash: _hash, ...fields } = review;
  if (!equal(fields, authorityContent.fields)) throw unavailable();

  const { capture, parentView: baseline, plannerTarget, plan } = authorityContent;
  const { manifest, snapshot, artifact, profiles } = capture;
  const captureBinding = deriveFinancialCapture(capture);
  const [selected, duplicate] = profiles.filter(profile => profile.hash === review.profileHash);
  if (!selected?.bootstrap || duplicate || !equal(selected.scope, review.scope) ||
      !artifact.requiredProfileHashes.includes(selected.hash) || artifact.id !== 'artifact:' + artifact.hash ||
      manifest.sourceRef !== sourceRef ||
      manifest.companyId !== review.scope.companyId || !equal(captureBinding, authorityContent.captureAttestation) ||
      manifest.asOf !== plan.asOf) throw unavailable();

  const planBytesHash = hashCanonical(plan);
  if (hashPlan(plan) !== plan.hash || planBytesHash !== authorityContent.planBytesHash ||
      planBytesHash !== authorityContent.observedPlanBytesHash ||
      hashTargetSnapshot(baseline.records) !== baseline.snapshotHash ||
      baseline.snapshotHash !== authorityContent.recordedTargetHash ||
      !equal(plannerTarget, { ...baseline.records, asOf: manifest.asOf }) ||
      hashTargetSnapshot(plannerTarget) !== authorityContent.plannerTargetHash) throw unavailable();

  const eventIds = new Set(snapshot.eventIds);
  if (plan.eventIds.some(id => !eventIds.has(id)) ||
      plan.lineage.some(item => item.sourceEventIds.some(id => !eventIds.has(id))) ||
      plan.operations.some(({ record }) => 'sourceEventId' in record && !eventIds.has(record.sourceEventId))) throw unavailable();

  const profile = {
    id: selected.id, version: selected.version, hash: selected.hash, sourceRef: selected.sourceRef, scope: selected.scope,
    parentCustomerId: selected.parentCustomerId, sourceAccountIds: selected.sourceAccountIds,
    approvedLookups: selected.approvedLookups, contractTerms: selected.contractTerms,
    semanticVersion: selected.semanticVersion, bootstrap: selected.bootstrap,
  };
  const referencedEvidenceIds = reviewEvidenceIds(profile, plan);
  const capturedEvidence = new Set(snapshot.evidenceIds);
  if (referencedEvidenceIds.some(id => !capturedEvidence.has(id))) throw unavailable();

  const { allowedKinds, limits, validators, runtimeModelCalls } = artifact.normalizedPlan;
  return ReviewDetailsV1Schema.parse({
    schemaVersion: '1', reviewPackage: review, sourceRef,
    capture: { manifestId: manifest.id, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotHash: snapshot.contentHash },
    artifact: {
      id: artifact.id, hash: artifact.hash, specHash: artifact.specHash, compilerVersion: artifact.compilerVersion,
      runtimeVersion: artifact.runtimeVersion, targetSchemaVersion: artifact.targetSchemaVersion,
    },
    profile, baseline, proposedImport: plan,
    futureScope: {
      allowedKinds, limits, validators, runtimeModelCalls, safetyRulesVersion: 'frozen-v1', safetyRules: reviewSafetyRulesV1,
    },
    evidence: { snapshotId: snapshot.id, referencedEvidenceIds },
    parentWrites: 0,
  });
}

export function createReviewDetails(repository: Pick<ReviewRepository, 'readPrepared'>) {
  return {
    async get(accountId: string, packageHash: string, grants: LocalReviewerContext): Promise<ReviewDetailsV1> {
      requireAccount(accountId, grants);
      const stored = await repository.readPrepared(accountId, packageHash).catch(() => { throw unavailable(); });
      if (!stored) throw new ReviewError(404, 'REVIEW_NOT_FOUND');
      requireSource(stored.sourceRef, grants);
      try {
        if (stored.review.scope.accountId !== accountId || stored.review.hash !== packageHash) throw unavailable();
        return project(stored);
      } catch {
        throw unavailable();
      }
    },
  };
}
