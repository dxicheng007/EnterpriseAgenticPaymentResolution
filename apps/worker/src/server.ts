import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Clock } from '../../../packages/storage/src/control-db.js';
import { probeMigration } from '../../../packages/storage/src/transaction.js';

type WorkerServices = {
  db: Pool;
  serviceToken: string;
  clock: Clock;
};

type WorkerDependencies = WorkerServices & { featurePlugins?: FastifyPluginAsync<WorkerServices>[] };

export function buildWorker({ db, serviceToken, clock, featurePlugins = [] }: WorkerDependencies): FastifyInstance {
  if (!serviceToken) throw new Error('Worker service credential is required');
  const worker = Fastify();
  const expected = Buffer.from('Bearer ' + serviceToken);
  worker.get('/internal/health', async (request, reply) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({
        code: 'SERVICE_UNAUTHORIZED', message: 'A valid service credential is required',
        diagnostics: [], correlationId: request.id,
      });
    }
    const health = await probeMigration(db);
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
