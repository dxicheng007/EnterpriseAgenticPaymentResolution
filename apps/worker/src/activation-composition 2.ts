import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createRegisteredScopeReader, readActivationBundle } from '@eapr/storage/activation-registry';
import type { FastifyPluginAsync } from 'fastify';
import { createWorkerActivation } from './activation.js';
import { createWorkerActivationPlugin } from './routes/activation.js';
import { createWorkerReceiptPlugin } from './routes/receipts.js';
import type { WorkerServices } from './server.js';
import { createSourceSemanticsClient } from './source-semantics-client.js';

export function composeWorkerActivation({ registryRoot, policyPath, sourceOrigin, sourceReadToken, sourceRefs }: {
  registryRoot: string; policyPath: string; sourceOrigin: string; sourceReadToken: string; sourceRefs: readonly string[];
}): FastifyPluginAsync<WorkerServices> {
  const observe = createSourceSemanticsClient({ baseUrl: sourceOrigin, token: sourceReadToken, sourceRefs });
  return async (app, { db, clock, serviceToken }) => {
    if (serviceToken === sourceReadToken) throw new Error('Worker and source capabilities must be distinct');
    const policy = await loadActivationPolicy({ policyPath }).catch(() => undefined);
    const service = createWorkerActivation({
      db, clock, policy, registered: createRegisteredScopeReader({ registryRoot }),
      readBundle: hash => readActivationBundle({ registryRoot }, hash), observe,
    });
    app.register(createWorkerActivationPlugin(service, serviceToken));
    app.register(createWorkerReceiptPlugin(service, serviceToken));
  };
}
