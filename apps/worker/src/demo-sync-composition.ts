import { ApiErrorSchema, ReceiptResponseSchema, type ReceiptResponse } from '@eapr/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { companyADemo as demo, CompanyADemoRequestSchema } from '../../../packages/contracts/src/demo-company-a.js';
import { createDemoSourceClient, validDemoBearer } from './demo-source-client.js';
import { createCompanyADemoSync, DemoSyncError } from './demo-sync.js';
import type { RegisteredScopeReader } from './parent-reads.js';
import { authorizeAuthorityService, sendAuthorityError } from './routes/authority.js';
import type { WorkerServices } from './server.js';
import { createSourceSemanticsClient } from './source-semantics-client.js';
import { SyncApplyError } from './sync/apply.js';
import { authorityError } from './sync/current-authority-errors.js';

type Operator = { enabled: false } | { enabled: true; token: string };

export function demoSyncPlugin(token: string, runOnce: () => Promise<ReceiptResponse>): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendAuthorityError);
    const path = '/internal/demo/company-a/sync';
    app.post(path, {
      bodyLimit: 4096,
      onRequest: async request => {
        authorizeAuthorityService(request, token);
        if (request.headers.cookie !== undefined || request.headers['x-eapr-csrf'] !== undefined) {
          throw authorityError('AUTHORITY_UNAUTHORIZED');
        }
        if (request.url !== path || request.mediaType !== 'application/json') {
          throw authorityError('AUTHORITY_INPUT_INVALID');
        }
      },
    }, async (request, reply) => {
      if (!CompanyADemoRequestSchema.safeParse(request.body).success) throw authorityError('AUTHORITY_INPUT_INVALID');
      reply.header('Cache-Control', 'no-store');
      try {
        return ReceiptResponseSchema.parse(await runOnce());
      } catch (error) {
        if (!(error instanceof DemoSyncError) && !(error instanceof SyncApplyError)) throw error;
        const status = ['SYNC_SOURCE_UNAVAILABLE', 'SYNC_STORAGE_INVALID', 'DEMO_SYNC_FEED_INVALID']
          .includes(error.code) ? 503 : 409;
        return reply.code(status).send(ApiErrorSchema.parse({
          code: error.code, message: 'Demo synchronization could not be completed', diagnostics: [], correlationId: request.id,
        }));
      }
    });
  };
}

export function composeWorkerDemoSync({ registered, source, operator }: {
  registered: RegisteredScopeReader; source: { origin: string; token: string }; operator: Operator;
}): FastifyPluginAsync<WorkerServices> {
  return async (app, { db, clock, serviceToken }) => {
    if (!operator.enabled) return;
    if (!validDemoBearer(operator.token) || operator.token === serviceToken ||
        source.token === serviceToken || source.token === operator.token) {
      throw new Error('Demo worker capabilities must be valid and distinct');
    }
    const config = { baseUrl: source.origin, token: source.token };
    const fetchChanges = createDemoSourceClient(config);
    const observe = createSourceSemanticsClient({ ...config, sourceRefs: [demo.sourceRef] });
    const service = createCompanyADemoSync({ db, clock, registered, fetchChanges, observe });
    app.register(demoSyncPlugin(operator.token, service.runOnce));
  };
}
