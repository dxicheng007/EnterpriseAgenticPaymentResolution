import type { FastifyPluginAsync } from 'fastify';
import type { createConnectionReads } from '../connections.js';
import { parseParentRead, sendParentReadError, type AuthorizeParentRead } from './parent.js';

export function createConnectionReadPlugin(reads: ReturnType<typeof createConnectionReads>, authorize: AuthorizeParentRead): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendParentReadError);
    app.get<{ Params: { accountId: string } }>('/internal/connections/:accountId', async (request, reply) => {
      await authorize(request);
      const { accountId } = parseParentRead(request, true);
      return reply.header('Cache-Control', 'no-store').send(await reads.readConnection(accountId));
    });
  };
}
