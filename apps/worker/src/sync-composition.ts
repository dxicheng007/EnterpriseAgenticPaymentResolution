import type { Id } from '@eapr/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { createWorkerSyncPlugin } from './routes/sync.js';
import type { WorkerServices } from './server.js';
import { createSourceSemanticsClient } from './source-semantics-client.js';
import { SyncApplyError } from './sync/apply.js';

export function composeWorkerSync({ source }: {
  source?: { origin: string; token: string; sourceRefs: readonly Id[] };
}): FastifyPluginAsync<WorkerServices> {
  return async (app, { db, clock, serviceToken }) => {
    if (source?.token === serviceToken) {
      throw new Error('Worker and source capabilities must be distinct');
    }
    const observe = source
      ? createSourceSemanticsClient({ baseUrl: source.origin, token: source.token, sourceRefs: source.sourceRefs })
      : async () => { throw new SyncApplyError('SYNC_SOURCE_UNAVAILABLE'); };
    app.register(createWorkerSyncPlugin({ db, clock, serviceToken, observe }));
  };
}
