import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { createConnectionReads } from './connections.js';
import { createParentReads } from './parent-reads.js';
import { createConnectionReadPlugin } from './routes/connections.js';
import { createActivationReadPlugin } from './routes/activation-reads.js';
import { createParentReadPlugin, ParentReadError } from './routes/parent.js';
import type { WorkerServices } from './server.js';

export function authorizeWorkerParentRead(request: FastifyRequest, serviceToken: string) {
  const expected = Buffer.from('Bearer ' + serviceToken);
  const supplied = Buffer.from(request.headers.authorization ?? '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ParentReadError(401);
}

export function composeWorkerParentReads(registryRoot: string): FastifyPluginAsync<WorkerServices> {
  return async (app, { db, clock, serviceToken }) => {
    const reads = createParentReads(db, clock, createRegisteredScopeReader({ registryRoot }));
    const authorize = (request: FastifyRequest) => authorizeWorkerParentRead(request, serviceToken);
    app.register(createParentReadPlugin(reads, authorize));
    app.register(createActivationReadPlugin(reads, authorize));
    app.register(createConnectionReadPlugin(createConnectionReads(db, createRegisteredScopeReader({ registryRoot })), authorize));
  };
}
