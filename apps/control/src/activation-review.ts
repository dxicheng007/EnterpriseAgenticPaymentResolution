import { z } from 'zod';
import {
  ActivationBundleV2Schema, HashSchema, canonicalJson, hashBundleV2,
  type ActivationRequest,
} from '@eapr/contracts';
import type { createActivationPublication } from './activation-publication.js';
import type { LocalReviewerContext } from './local-session.js';
import { requireAccount, requireSource, type ReviewPreparation } from './review-preparation.js';
import { headToken, requestMatchesReview, ReviewError, type ReviewRepository } from './review-repository.js';

const savedAuthority = z.object({ authorityDigest: HashSchema, authorityContent: z.unknown() });
export function createActivationReview({ repository, preparation, publisher, publicationFailed }: {
  repository: ReviewRepository;
  preparation: ReviewPreparation;
  publisher: ReturnType<typeof createActivationPublication>;
  publicationFailed: () => void;
}) {
  return async function activate(accountId: string, request: ActivationRequest, grants: LocalReviewerContext) {
    requireAccount(accountId, grants);
    const existing = await repository.readIntentByKey(request.idempotencyKey);
    let intent;
    if (existing?.accountId === accountId) {
      requireSource(existing.sourceRef, grants);
      if (canonicalJson(existing.request) !== canonicalJson(request)) {
        throw new ReviewError(409, 'IDEMPOTENCY_CONFLICT');
      }
      intent = existing;
    } else {
      const head = await repository.readHead(accountId);
      if (!head) throw new ReviewError(404, 'REVIEW_NOT_FOUND');
      requireSource(head.sourceRef, grants);
      if (existing) throw new ReviewError(409, 'IDEMPOTENCY_CONFLICT');
      if (!requestMatchesReview(request, head.review)) throw new ReviewError(409, 'REVIEW_STALE');
      const fresh = await preparation.revalidate(accountId, grants, 'activate');
      const saved = savedAuthority.parse(head.companion);
      if (saved.authorityDigest !== fresh.authorityDigest ||
          canonicalJson(saved.authorityContent) !== canonicalJson(fresh.companion.authorityContent)) {
        throw new ReviewError(409, 'REVIEW_STALE');
      }
      const { capture, report, plan, attestation, bootstrapVerification, authorityPolicy } = fresh.companion.authorityContent;
      const draft = {
        schemaVersion: '2' as const, request, reviewer: grants.reviewer, reviewPackage: head.review,
        artifact: capture.artifact, profiles: capture.profiles, manifest: capture.manifest, snapshot: capture.snapshot,
        verificationReport: report, bootstrapEvents: capture.events, previewPlan: plan,
        semanticPreflight: fresh.companion.observation, financialAttestation: attestation,
        bootstrapVerification, authorityPolicy,
      };
      const bundle = ActivationBundleV2Schema.parse({ ...draft, hash: hashBundleV2(draft) });
      intent = await repository.commitIntent(headToken(head.review), bundle);
    }
    try {
      await publisher.publishIntent(intent.intentId);
    } catch {
      publicationFailed();
    }
    return { state: 'pending' as const, reviewPackageId: request.reviewPackageId, idempotencyKey: request.idempotencyKey };
  };
}

export type ActivationReview = ReturnType<typeof createActivationReview>;
