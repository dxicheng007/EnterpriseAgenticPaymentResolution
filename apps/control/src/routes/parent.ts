import type { FastifyPluginAsync } from 'fastify';
import { parseParentRead, sendParentReadError } from '../../../worker/src/routes/parent.js';
import type { createLocalSessionService } from '../local-session.js';
import type { ParentReadClient } from '../parent-read-client.js';

export function createParentProxyPlugin(client: ParentReadClient, authorize: ReturnType<typeof createLocalSessionService>['authorizeReviewer']): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendParentReadError);
    app.get<{ Params: { accountId: string } }>('/api/parent/:accountId', async (request, reply) => {
      const reviewer = await authorize(request, { mutation: false });
      const { accountId, query } = parseParentRead(request);
      return reply.header('Cache-Control', 'no-store').send(await client.readParent(accountId, query, reviewer));
    });
    app.get<{ Params: { accountId: string } }>('/api/accounts/:accountId/activation', async (request, reply) => {
      const reviewer = await authorize(request, { mutation: false });
      const { accountId } = parseParentRead(request, true);
      return reply.header('Cache-Control', 'no-store').send(await client.readActivation(accountId, reviewer));
    });
  };
}
