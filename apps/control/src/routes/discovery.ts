import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  ApiErrorSchema, DiscoveryActionRequestV2Schema, IdSchema, StartDiscoveryRequestV2Schema,
} from '@eapr/contracts';
import { SourceError } from '@eapr/sources';
import type { z } from 'zod';
import { discoveryError } from '../../../../packages/discovery/src/repository.js';
import type { createDiscoveryService, DiscoveryReviewer } from '../../../../packages/discovery/src/service.js';
import { LocalSessionError } from '../local-session.js';

type Service = Awaited<ReturnType<typeof createDiscoveryService>>;
type Authorize = (request: FastifyRequest, access: { mutation: boolean }) => Promise<DiscoveryReviewer>;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw discoveryError(400, 'DISCOVERY_INVALID');
  return result.data;
}

const errors = {
  DISCOVERY_INVALID: [400, 'Discovery request is invalid.'],
  DISCOVERY_FORBIDDEN: [403, 'Discovery access is forbidden.'],
  DISCOVERY_NOT_FOUND: [404, 'The discovery resource was not found.'],
  DISCOVERY_CONFLICT: [409, 'Discovery state or capture conflicts with the request.'],
  MODEL_UNAVAILABLE: [503, 'Discovery model configuration is unavailable.'],
  DISCOVERY_UNAVAILABLE: [503, 'The discovery service is unavailable.'],
} as const;

export function mountDiscovery(service: Service, authorizeReviewer: Authorize): FastifyPluginAsync {
  return async app => {
    // onRequest precedes body parsing, including invalid JSON errors.
    const reviewers = new WeakMap<FastifyRequest, DiscoveryReviewer>();
    app.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reviewers.set(request, await authorizeReviewer(request, { mutation: request.method === 'POST' }));
    });
    app.addHook('preHandler', async request => {
      if (Object.keys(request.query as object).length || (request.method !== 'POST' && request.body !== undefined)) {
        throw discoveryError(400, 'DISCOVERY_INVALID');
      }
    });
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof SourceError || error instanceof LocalSessionError) {
        const mapped = error instanceof SourceError ? Object.assign(error, { statusCode: error.status }) : error;
        return reply.code(mapped.statusCode).send(ApiErrorSchema.parse({
          code: mapped.code, message: mapped.message, correlationId: request.id,
          diagnostics: error instanceof SourceError ? error.diagnostics : [],
        }));
      }
      const raw = error instanceof Error && 'code' in error ? error.code : undefined;
      const code = typeof raw === 'string' && Object.hasOwn(errors, raw) ? raw as keyof typeof errors :
        typeof raw === 'string' && raw.startsWith('FST_ERR_CTP_') ? 'DISCOVERY_INVALID' : 'DISCOVERY_UNAVAILABLE';
      const [status, message] = errors[code];
      return reply.code(status).send(ApiErrorSchema.parse({ code, message, diagnostics: [], correlationId: request.id }));
    });
    app.addHook('onClose', () => service.close());

    app.get('/api/discovery/capabilities', () => service.capabilities());
    app.post('/api/discovery/runs', async (request, reply) => {
      const response = await service.startDiscovery(reviewers.get(request)!, parse(StartDiscoveryRequestV2Schema, request.body));
      return reply.code(202).send(response);
    });
    app.get<{ Params: { runId: string } }>('/api/discovery/runs/:runId', request =>
      service.readState(reviewers.get(request)!, parse(IdSchema, request.params.runId)));
    for (const action of ['pause', 'resume'] as const) {
      app.post<{ Params: { runId: string } }>('/api/discovery/runs/:runId/' + action, request =>
        service[action](reviewers.get(request)!, parse(IdSchema, request.params.runId), parse(DiscoveryActionRequestV2Schema, request.body)));
    }
  };
}
