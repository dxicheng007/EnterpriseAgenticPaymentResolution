import type { FastifyPluginAsync } from 'fastify';
import type { createParentReads } from '../parent-reads.js';
import { parseParentRead, sendParentReadError, type AuthorizeParentRead } from './parent.js';

export function createActivationReadPlugin(reads: ReturnType<typeof createParentReads>, authorize: AuthorizeParentRead): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendParentReadError);
    app.get<{ Params: { accountId: string } }>('/internal/activations/:accountId', async (request, reply) => {
      await authorize(request);
      const { accountId } = parseParentRead(request, true);
      return reply.header('Cache-Control', 'no-store').send(await reads.readActivation(accountId));
    });
  };
}
