import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { ServiceHealthSchema, type Diagnostic, type HealthResponse, type ServiceHealth } from '../../../packages/contracts/src/index.js';
import type { Clock } from '../../../packages/storage/src/control-db.js';
import { probeMigration, type MigrationIdentity } from '../../../packages/storage/src/transaction.js';

export interface WorkerClient {
  getHealth(): Promise<ServiceHealth>;
}

export function createWorkerClient(baseUrl: string, serviceToken: string): WorkerClient {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password) {
    throw new Error('Worker URL must use local HTTP');
  }
  const url = new URL('/internal/health', origin);
  return {
    async getHealth() {
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + serviceToken },
        signal: AbortSignal.timeout(2000),
        redirect: 'error',
      });
      if (response.status !== 200 && response.status !== 503) throw new Error('Worker health request failed');
      const health = ServiceHealthSchema.parse(await response.json());
      if ((response.status === 200) !== (health.status === 'ready')) throw new Error('Worker health is inconsistent');
      return health;
    },
  };
}

export type ControlServices = {
  db: Pool;
  workerClient: WorkerClient;
  clock: Clock;
};

type ControlDependencies = ControlServices & { expectedMigrations: readonly MigrationIdentity[]; featurePlugins?: FastifyPluginAsync<ControlServices>[] };

const unavailable: ServiceHealth = { status: 'not_ready', database: 'unavailable', migrationVersion: null };

export function buildControl({ db, workerClient, clock, expectedMigrations, featurePlugins = [] }: ControlDependencies): FastifyInstance {
  const control = Fastify();
  control.get('/api/health', async (_request, reply) => {
    const [local, remote] = await Promise.all([
      probeMigration(db, expectedMigrations),
      Promise.resolve().then(() => workerClient.getHealth()).catch(() => unavailable),
    ]);
    const diagnostics: Diagnostic[] = [];
    for (const [service, health] of [['CONTROL', local], ['RUNTIME', remote]] as const) {
      if (health.status !== 'ready') {
        diagnostics.push({
          code: service + '_' + health.database.toUpperCase(), severity: 'blocker',
          message: health.database === 'migration_required'
            ? service + ' database requires migration'
            : service + ' readiness could not be verified',
          sourceIds: [], fieldPaths: [],
        });
      }
    }
    const body: HealthResponse = {
      status: diagnostics.length ? 'not_ready' : 'ready',
      controlDb: local.database, runtimeDb: remote.database,
      migrationVersions: { control: local.migrationVersion, runtime: remote.migrationVersion },
      diagnostics,
    };
    return reply.code(body.status === 'ready' ? 200 : 503).header('Cache-Control', 'no-store').send(body);
  });
  for (const plugin of featurePlugins) control.register(plugin, { db, workerClient, clock });
  return control;
}

export async function launchControl(dependencies: ControlDependencies, port: number) {
  const control = buildControl(dependencies);
  try {
    await control.listen({ host: '127.0.0.1', port });
    return control;
  } catch (error) {
    await control.close();
    throw error;
  }
}
