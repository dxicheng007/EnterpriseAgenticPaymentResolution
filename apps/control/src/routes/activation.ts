import { ActivationRequestSchema } from '@eapr/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { ActivationReview } from '../activation-review.js';
import { ReviewError } from '../review-repository.js';
import { parseReviewAccount, sendReviewError, type ReviewAuthorize, type ReviewParams } from './review.js';

export function createActivationReviewPlugin(activate: ActivationReview, authorize: ReviewAuthorize): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendReviewError);
    app.post<ReviewParams>('/api/review/:accountId/activate', async (request, reply) => {
      const grants = await authorize(request, { mutation: true });
      const accountId = parseReviewAccount(request);
      const approval = ActivationRequestSchema.safeParse(request.body);
      if (!approval.success) throw new ReviewError(400, 'REVIEW_REQUEST_INVALID');
      return reply.header('Cache-Control', 'no-store').code(202).send(await activate(accountId, approval.data, grants));
    });
  };
}
