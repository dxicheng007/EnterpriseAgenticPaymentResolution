import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createWorkerClient, launchControl } from '../../apps/control/src/server.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { HealthResponseSchema } from '../../packages/contracts/src/activity.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../../packages/storage/src/runtime-db.js';
import { migrate } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb } from '../../scripts/native-db.js';

export function testNamespace(label: string) {
  const prefix = process.env.EAPR_TEST_PREFIX ?? 'eapr_test_v0';
  if (!/^eapr_test_(?:review_)?v0$/.test(prefix) || !/^[a-z0-9]{1,12}$/.test(label)) {
    throw new Error('Invalid test database lease');
  }
  return prefix + '_' + label + randomBytes(6).toString('hex');
}

export async function createTestSystem(options: {
  modelMode: 'stub' | 'disabled' | 'live';
  dbNamespace: string;
  failpoint?: string;
}) {
  if (options.modelMode === 'live') {
    throw new Error(process.env.OPENAI_API_KEY
      ? 'Live model execution is unavailable in V0'
      : 'Live model configuration unavailable. A genuine provider requires OPENAI_API_KEY and the live slice.');
  }
  if (options.failpoint !== undefined) throw new Error('Failpoints are unavailable in V0');

  await startNativeDb();
  const pair = await provisionTest(options.dbNamespace);
  const controlDb = createControlDb({ connectionString: pair.control.appUrl });
  const runtimeDb = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  const workerPort = localPort('EAPR_WORKER_PORT', 3002);
  const controlPort = localPort('EAPR_CONTROL_PORT', 3001);
  const serviceToken = randomBytes(32).toString('hex');
  const clock = () => new Date('2026-11-08T00:00:00.000Z');
  const workerClient = createWorkerClient('http://127.0.0.1:' + workerPort, serviceToken);
  let workerServer: FastifyInstance | undefined;
  let controlServer: FastifyInstance | undefined;
  let closed = false;

  async function stopWorker() {
    await workerServer?.close();
    workerServer = undefined;
  }
  async function startWorker() {
    if (closed || workerServer) throw new Error('Worker cannot be started in its current state');
    workerServer = await launchWorker({ db: runtimeDb, clock, serviceToken }, workerPort);
  }
  async function close() {
    if (closed) return;
    closed = true;
    const results = await Promise.allSettled([stopWorker(), controlServer?.close()]);
    await Promise.all([controlDb.end(), runtimeDb.end()]);
    await dropTest(options.dbNamespace);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  try {
    await migrate(pair);
    await startWorker();
    controlServer = await launchControl({ db: controlDb, workerClient, clock }, controlPort);
    return {
      control: {
        async getHealth() {
          const response = await fetch('http://127.0.0.1:' + controlPort + '/api/health', { signal: AbortSignal.timeout(5000) });
          return { status: response.status, body: HealthResponseSchema.parse(await response.json()) };
        },
      },
      worker: { ...workerClient, start: startWorker, stop: stopWorker },
      sourceAdmin: {
        async inject(_scenario: string): Promise<never> {
          throw Object.assign(new Error('Source administration is unavailable in V0'), { code: 'FEATURE_NOT_IMPLEMENTED' });
        },
      },
      db: { control: controlDb, runtime: runtimeDb },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
