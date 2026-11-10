import Fastify, { type FastifyError, type FastifyInstance, type FastifyPluginAsync, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AuthorityInvalidRequest } from './authority-composition.js';
import { sendAuthorityError } from './routes/authority.js';
import { authorityError } from '../../worker/src/sync/current-authority-errors.js';
import { reviewDetailsRoute, sendReviewError } from './routes/review.js';
import { ReviewError } from './review-repository.js';
import { ParentReadError, sendParentReadError } from '../../worker/src/routes/parent.js';
import type { Pool } from 'pg';
import { ApiErrorSchema, ServiceHealthSchema, type Diagnostic, type HealthResponse, type ServiceHealth } from '../../../packages/contracts/src/index.js';
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

type ControlDependencies = ControlServices & {
  expectedMigrations: readonly MigrationIdentity[];
  featurePlugins?: FastifyPluginAsync<ControlServices>[];
  authorityInvalidRequest?: AuthorityInvalidRequest;
};

export const sourceSemanticsRoute = '/internal/sources/:sourceRef/semantics';
const sourceSemanticsPath = /^(?:https?:\/\/[^/?#]+)?\/internal\/sources\/[^/?#]+\/semantics(?:\?|$)/;
const unavailable: ServiceHealth = { status: 'not_ready', database: 'unavailable', migrationVersion: null };

function authorityFrameworkRoute(request: FastifyRequest) {
  const path = request.url.replace(/^https?:\/\/[^/?#]+/i, '').split(/[?#]/, 1)[0]!;
  const [root, api, connections, account, suffix, extra] = path.split('/', 6);
  if (root !== '' || !api || !connections || !account || !suffix || extra !== undefined) return;
  try {
    // The router decodes static segments before matching. The account may contain an invalid escape.
    if (decodeURI(api) !== 'api' || decodeURI(connections) !== 'connections') return;
    const action = decodeURI(suffix);
    if (request.method === 'GET' && action === 'authority') {
      return { method: 'GET' as const, url: '/api/connections/:accountId/authority' };
    }
    if (request.method === 'POST' && (action === 'pause' || action === 'resume' || action === 'revoke')) {
      return { method: 'POST' as const, url: '/api/connections/:accountId/' + action };
    }
  } catch {
    return;
  }
}

export function buildControl({
  db, workerClient, clock, expectedMigrations, featurePlugins = [], authorityInvalidRequest,
}: ControlDependencies): FastifyInstance {
  const control: FastifyInstance = Fastify({
    // Keep the router's shared parameter limit aligned with IdSchema.
    routerOptions: { maxParamLength: 160 },
    frameworkErrors(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
      // The router can reject a malformed URL before route-level hooks can sanitize it.
      if (error.code === 'FST_ERR_BAD_URL' || error.code === 'FST_ERR_MAX_PARAM_LENGTH') {
        const authorityRoute = authorityFrameworkRoute(request);
        if (authorityRoute && control.hasRoute(authorityRoute)) {
          if (authorityInvalidRequest) return authorityInvalidRequest(request, reply);
          return sendAuthorityError(authorityError('AUTHORITY_UNAVAILABLE'), request, reply);
        }
        if (request.method === 'GET' && sourceSemanticsPath.test(request.url) &&
            control.hasRoute({ method: 'GET', url: sourceSemanticsRoute })) {
          return reply.code(400).header('Cache-Control', 'no-store').send(ApiErrorSchema.parse({
            code: 'SOURCE_METADATA_INVALID', message: 'Source request is invalid', diagnostics: [], correlationId: request.id,
          }));
        }
        const parentPath = /^(?:https?:\/\/[^/?#]+)?\/api\/parent\/[^/?#]+(?:\?|$)/;
        const activationPath = /^(?:https?:\/\/[^/?#]+)?\/api\/accounts\/[^/?#]+\/activation(?:\?|$)/;
        if (request.method === 'GET' &&
            ((parentPath.test(request.url) && control.hasRoute({ method: 'GET', url: '/api/parent/:accountId' })) ||
             (activationPath.test(request.url) && control.hasRoute({ method: 'GET', url: '/api/accounts/:accountId/activation' })))) {
          return sendParentReadError(new ParentReadError(400), request, reply);
        }
        const detailsPath = /^(?:https?:\/\/[^/?#]+)?\/api\/review\/[^/?#]+\/packages\/[^/?#]+\/details(?:\?|$)/;
        if (request.method === 'GET' && detailsPath.test(request.url) &&
            control.hasRoute({ method: 'GET', url: reviewDetailsRoute })) {
          return sendReviewError(new ReviewError(400, 'REVIEW_REQUEST_INVALID'), request, reply);
        }
        const reviewPath = /^(?:https?:\/\/[^/?#]+)?\/api\/review\/[^/?#]+(?:\/(prepare|activate))?(?:\?|$)/;
        const reviewMatch = reviewPath.exec(request.url);
        if (reviewMatch) {
          const action = reviewMatch[1];
          const method = action ? 'POST' : 'GET';
          const route = '/api/review/:accountId' + (action ? '/' + action : '');
          if (request.method === method && control.hasRoute({ method, url: route })) {
            return reply.code(400).header('Cache-Control', 'no-store').send(ApiErrorSchema.parse({
              code: 'REVIEW_REQUEST_INVALID', message: 'Review request could not be completed.',
              diagnostics: [], correlationId: request.id,
            }));
          }
        }
        const statusCode = error.code === 'FST_ERR_BAD_URL' ? 400 : 414;
        return reply.code(statusCode).send({
          error: 'Bad Request', code: error.code, message: 'Request URL is invalid', statusCode,
        });
      }
      return reply.code(500).send({
        error: 'Internal Server Error', message: 'Unexpected error from async constraint', statusCode: 500,
      });
    },
  });
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
