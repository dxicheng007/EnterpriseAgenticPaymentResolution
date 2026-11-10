import { z } from 'zod';
import { IdSchema, HashSchema, strict, type Id } from '../../contracts/src/common.js';
import { ReviewDetailsV1Schema, type ReviewDetailsV1 } from '../../contracts/src/review-details.js';
import { ActivationRequestSchema, ReviewPackageSchema, type ActivationRequest, type ReviewPackage } from '../../contracts/src/review.js';
import { ReceiptResponseSchema, type ReceiptResponse } from '../../contracts/src/runtime.js';
import { jsonPost, LocalApiError, requestLocal } from './http.js';

const PendingActivationSchema = strict({
  state: z.literal('pending'), reviewPackageId: IdSchema, idempotencyKey: IdSchema,
});
const ActivationResponseSchema = z.union([ReceiptResponseSchema, PendingActivationSchema]);

export type ActivationOutcome =
  | { state: 'applied'; receipt: ReceiptResponse['receipt']; replayed: boolean }
  | { state: 'pending'; reviewPackageId: Id; idempotencyKey: Id };

function accountPath(accountId: string) {
  const parsed = IdSchema.safeParse(accountId);
  if (!parsed.success) throw new LocalApiError(400, 'REVIEW_REQUEST_INVALID', 'The review account ID is invalid.');
  return '/api/review/' + encodeURIComponent(parsed.data);
}

function checkPackage(accountId: string, value: ReviewPackage) {
  if (value.scope.accountId !== accountId) {
    throw new LocalApiError(200, 'MALFORMED_RESPONSE', 'The review package did not match the selected account.');
  }
  return value;
}

export async function readReview(accountId: string, signal?: AbortSignal): Promise<ReviewPackage> {
  const path = accountPath(accountId);
  return checkPackage(accountId, await requestLocal(path, ReviewPackageSchema, { signal }));
}

export async function prepareReview(accountId: string, signal?: AbortSignal): Promise<ReviewPackage> {
  const path = accountPath(accountId);
  return checkPackage(accountId, await requestLocal(path + '/prepare', ReviewPackageSchema, jsonPost({}, signal), true));
}

export async function readReviewDetails(
  accountId: string, reviewPackage: ReviewPackage, signal?: AbortSignal,
): Promise<ReviewDetailsV1> {
  const path = accountPath(accountId) + '/packages/' + encodeURIComponent(HashSchema.parse(reviewPackage.hash)) + '/details';
  const details = await requestLocal(path, ReviewDetailsV1Schema, { signal });
  if (details.reviewPackage.scope.accountId !== accountId || details.reviewPackage.id !== reviewPackage.id ||
    details.reviewPackage.hash !== reviewPackage.hash) {
    throw new LocalApiError(200, 'MALFORMED_RESPONSE', 'The review details did not match the selected package.');
  }
  return details;
}

export function activationRequestFor(reviewPackage: ReviewPackage, idempotencyKey: string): ActivationRequest {
  return ActivationRequestSchema.parse({
    reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash,
    expectedArtifactHash: reviewPackage.artifactHash, expectedProfileHash: reviewPackage.profileHash,
    expectedTargetVersion: reviewPackage.expectedTargetVersion, idempotencyKey,
  });
}

export async function activateReview(
  accountId: string, request: ActivationRequest, signal?: AbortSignal,
): Promise<ActivationOutcome> {
  const path = accountPath(accountId);
  const body = ActivationRequestSchema.parse(request);
  const result = await requestLocal(path + '/activate', ActivationResponseSchema, jsonPost(body, signal), true);
  if ('state' in result) {
    if (result.reviewPackageId !== body.reviewPackageId || result.idempotencyKey !== body.idempotencyKey) {
      throw new LocalApiError(202, 'MALFORMED_RESPONSE', 'The pending response did not match the approval request.');
    }
    return result;
  }
  if (result.receipt.scope.accountId !== accountId) {
    throw new LocalApiError(200, 'MALFORMED_RESPONSE', 'The receipt did not match the selected account.');
  }
  return { state: 'applied', receipt: result.receipt, replayed: result.replayed };
}
