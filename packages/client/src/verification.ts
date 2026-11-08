import { IdSchema, type Id } from '../../contracts/src/common.js';
import {
  VerifyRequestSchema, VerificationJobSchema, type VerificationJob, type VerifyRequest,
} from '../../contracts/src/review.js';
import { jsonPost, LocalApiError, requestLocal } from './http.js';

export async function requestVerification(connectorId: Id, request: VerifyRequest): Promise<VerificationJob> {
  const connector = encodeURIComponent(IdSchema.parse(connectorId));
  return requestLocal('/api/connectors/' + connector + '/verify',
    VerificationJobSchema, jsonPost(VerifyRequestSchema.parse(request)), true);
}

export async function getVerificationJob(jobId: Id, signal?: AbortSignal): Promise<VerificationJob> {
  const result = await requestLocal('/api/verification-jobs/' + encodeURIComponent(IdSchema.parse(jobId)),
    VerificationJobSchema, { signal });
  if (result.jobId !== jobId) {
    throw new LocalApiError(200, 'MALFORMED_RESPONSE', 'The verification response did not match the selected job.');
  }
  return result;
}
