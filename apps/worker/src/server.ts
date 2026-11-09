import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyPluginAsync, type FastifyReply, type FastifyRequest } from 'fastify';
import { authorizeWorkerParentRead } from './parent-read-composition.js';
import { authorizeActivationService, invalidActivationRequest, sendActivationError } from './routes/activation.js';
import { ParentReadError, sendParentReadError } from './routes/parent.js';
import type { Pool } from 'pg';
import type { Clock } from '../../../packages/storage/src/control-db.js';
import { probeMigration, type MigrationIdentity } from '../../../packages/storage/src/transaction.js';

export type WorkerServices = {
  db: Pool;
  serviceToken: string;
  clock: Clock;
};

type WorkerDependencies = WorkerServices & { expectedMigrations: readonly MigrationIdentity[]; featurePlugins?: FastifyPluginAsync<WorkerServices>[] };

export function buildWorker({ db, serviceToken, clock, expectedMigrations, featurePlugins = [] }: WorkerDependencies): FastifyInstance {
  if (!serviceToken) throw new Error('Worker service credential is required');
  const worker: FastifyInstance = Fastify({
    routerOptions: { maxParamLength: 160 },
    frameworkErrors(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
      if (error.code === 'FST_ERR_BAD_URL' || error.code === 'FST_ERR_MAX_PARAM_LENGTH') {
        if (request.method === 'GET' && /^(?:https?:\/\/[^/?#]+)?\/internal\/receipts\/[^/?#]+(?:\?|$)/.test(request.url) &&
            worker.hasRoute({ method: 'GET', url: '/internal/receipts/:key' })) {
          try {
            authorizeActivationService(request, serviceToken);
          } catch (failure) {
            return sendActivationError(failure, request, reply);
          }
          return sendActivationError(invalidActivationRequest(), request, reply);
        }
        const match = /^(?:https?:\/\/[^/?#]+)?(\/internal\/(?:parent|activations))\/[^/?#]+(?:\?|$)/.exec(request.url);
        if (request.method === 'GET' && match && worker.hasRoute({ method: 'GET', url: match[1] + '/:accountId' })) {
          try {
            authorizeWorkerParentRead(request, serviceToken);
          } catch (failure) {
            return sendParentReadError(failure, request, reply);
          }
          return sendParentReadError(new ParentReadError(400), request, reply);
        }
        const statusCode = error.code === 'FST_ERR_BAD_URL' ? 400 : 414;
        return reply.code(statusCode).send({ error: 'Bad Request', code: error.code, message: 'Request URL is invalid', statusCode });
      }
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Unexpected error from async constraint', statusCode: 500 });
    },
  });
  const expected = Buffer.from('Bearer ' + serviceToken);
  worker.get('/internal/health', async (request, reply) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({
        code: 'SERVICE_UNAUTHORIZED', message: 'A valid service credential is required',
        diagnostics: [], correlationId: request.id,
      });
    }
    const health = await probeMigration(db, expectedMigrations);
    return reply.code(health.status === 'ready' ? 200 : 503).header('Cache-Control', 'no-store').send(health);
  });
  for (const plugin of featurePlugins) worker.register(plugin, { db, clock, serviceToken });
  return worker;
}

export async function launchWorker(dependencies: WorkerDependencies, port: number) {
  const worker = buildWorker(dependencies);
  try {
    await worker.listen({ host: '127.0.0.1', port });
    return worker;
  } catch (error) {
    await worker.close();
    throw error;
  }
}
