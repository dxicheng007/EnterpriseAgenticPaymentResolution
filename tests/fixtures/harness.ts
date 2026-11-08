import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createWorkerClient, launchControl, type ControlServices } from '../../apps/control/src/server.js';
import { launchWorker, type WorkerServices } from '../../apps/worker/src/server.js';
import { HealthResponseSchema } from '../../packages/contracts/src/activity.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../../packages/storage/src/runtime-db.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb, testLeasePrefix } from '../../scripts/native-db.js';

export function testNamespace(label: string) {
  const prefix = testLeasePrefix();
  if (!/^[a-z0-9]{1,12}$/.test(label)) {
    throw new Error('Invalid test database lease');
  }
  return prefix + '_' + label + randomBytes(6).toString('hex');
}

type ControlRequestOptions = { method?: string; body?: unknown; headers?: Record<string, string> };

export async function createTestSystem(options: {
  modelMode: 'stub' | 'disabled' | 'live';
  dbNamespace: string;
  failpoint?: string;
  migrationThroughVersion?: number;
  controlPlugins?: FastifyPluginAsync<ControlServices>[];
  workerPlugins?: FastifyPluginAsync<WorkerServices>[];
  controlPluginFactory?: (services: ControlServices) =>
    FastifyPluginAsync<ControlServices>[] | Promise<FastifyPluginAsync<ControlServices>[]>;
}) {
  if (options.modelMode === 'live') {
    throw new Error(process.env.OPENAI_API_KEY
      ? 'Live model execution is unavailable in V0'
      : 'Live model configuration unavailable. A genuine provider requires OPENAI_API_KEY and the live slice.');
  }
  if (options.failpoint !== undefined) throw new Error('Failpoints are unavailable in V0');

  const catalog = readMigrationCatalog({ throughVersion: options.migrationThroughVersion });
  await startNativeDb();
  const pair = await provisionTest(options.dbNamespace);
  const controlDb = createControlDb({ connectionString: pair.control.appUrl });
  const runtimeDb = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  const workerPort = localPort('EAPR_WORKER_PORT', 3002);
  const controlPort = localPort('EAPR_CONTROL_PORT', 3001);
  const controlOrigin = 'http://127.0.0.1:' + controlPort;
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
    workerServer = await launchWorker({
      db: runtimeDb, clock, serviceToken,
      expectedMigrations: migrationIdentities(catalog.runtime), featurePlugins: options.workerPlugins,
    }, workerPort);
  }
  async function close() {
    if (closed) return;
    closed = true;
    const results = await Promise.allSettled([stopWorker(), controlServer?.close()]);
    await Promise.all([controlDb.end(), runtimeDb.end()]);
    await dropTest(options.dbNamespace);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  async function request<T>(path: string, { method, body, headers }: ControlRequestOptions = {}) {
    if (!path.startsWith('/api/') || /[\\#\s]/.test(path)) throw new Error('Invalid control API path');
    const url = new URL(path, controlOrigin);
    if (url.origin !== controlOrigin || !url.pathname.startsWith('/api/') || /%(?:2f|5c)/i.test(url.pathname)) {
      throw new Error('Invalid control API path');
    }
    const requestHeaders = new Headers(headers);
    if (body !== undefined && !requestHeaders.has('content-type')) requestHeaders.set('content-type', 'application/json');
    const response = await fetch(url, {
      method, body: body === undefined ? undefined : JSON.stringify(body), headers: requestHeaders,
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() as T };
  }

  try {
    await migrate(pair, migrationStreams, catalog);
    await startWorker();
    const services = { db: controlDb, workerClient, clock };
    const suppliedPlugins = await options.controlPluginFactory?.(services) ?? [];
    controlServer = await launchControl({
      ...services, expectedMigrations: migrationIdentities(catalog.control),
      featurePlugins: [...(options.controlPlugins ?? []), ...suppliedPlugins],
    }, controlPort);
    return {
      control: {
        origin: controlOrigin,
        request,
        async getHealth() {
          const response = await request('/api/health');
          return { status: response.status, body: HealthResponseSchema.parse(response.body) };
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
