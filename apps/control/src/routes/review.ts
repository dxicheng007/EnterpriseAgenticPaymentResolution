import { IdSchema, strict } from '@eapr/contracts';
import { FinancialAttestationFailure } from '@eapr/evaluator/financial-attestation-registry';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { LocalSessionError, type createLocalSessionService } from '../local-session.js';
import { ParentReadError } from '../../../worker/src/routes/parent.js';
import type { ReviewPreparation } from '../review-preparation.js';
import { ReviewError } from '../review-repository.js';

export type ReviewAuthorize = ReturnType<typeof createLocalSessionService>['authorizeReviewer'];
export type ReviewParams = { Params: { accountId: string } };
const empty = strict({});

export function parseReviewAccount(request: FastifyRequest<ReviewParams>) {
  const account = IdSchema.safeParse(request.params.accountId);
  if (!account.success || request.url.includes('?')) throw new ReviewError(400, 'REVIEW_REQUEST_INVALID');
  return account.data;
}

export function sendReviewError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  let status = 503;
  let code = 'REVIEW_UNAVAILABLE';
  if (error instanceof ReviewError || error instanceof LocalSessionError) {
    status = error.statusCode;
    code = error.code;
  } else if (error instanceof FinancialAttestationFailure) {
    status = error.statusCode;
    code = error.message;
  } else if (error instanceof ParentReadError && (error.statusCode === 403 || error.statusCode === 404)) {
    status = error.statusCode;
    code = status === 403 ? 'REVIEW_FORBIDDEN' : 'REVIEW_NOT_FOUND';
  } else if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 400) {
    status = 400;
    code = 'REVIEW_REQUEST_INVALID';
  }
  return reply.header('Cache-Control', 'no-store').code(status).send({
    code, message: 'Review request could not be completed.', correlationId: request.id, diagnostics: [],
  });
}

export function createReviewPlugin(preparation: Pick<ReviewPreparation, 'prepare' | 'get'>, authorize: ReviewAuthorize): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendReviewError);
    app.get<ReviewParams>('/api/review/:accountId', async (request, reply) => {
      const grants = await authorize(request, { mutation: false });
      return reply.header('Cache-Control', 'no-store').send(await preparation.get(parseReviewAccount(request), grants));
    });
    app.post<ReviewParams>('/api/review/:accountId/prepare', async (request, reply) => {
      const grants = await authorize(request, { mutation: true });
      const accountId = parseReviewAccount(request);
      if (!empty.safeParse(request.body).success) throw new ReviewError(400, 'REVIEW_REQUEST_INVALID');
      return reply.header('Cache-Control', 'no-store').send(await preparation.prepare(accountId, grants));
    });
  };
}
