import { timingSafeEqual } from 'node:crypto';
import { InternalActivationRequestSchema, ReceiptResponseSchema } from '@eapr/contracts';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { createWorkerActivation } from '../activation.js';
import { ActivationError } from '../activation-validation.js';
import { SourceSemanticsError } from '../source-semantics-client.js';

export function authorizeActivationService(request: FastifyRequest, serviceToken: string) {
  const expected = Buffer.from('Bearer ' + serviceToken);
  const supplied = Buffer.from(request.headers.authorization ?? '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ActivationError(401, 'SERVICE_UNAUTHORIZED');
  }
}

export function invalidActivationRequest() {
  return new ActivationError(400, 'ACTIVATION_REQUEST_INVALID');
}

export function sendActivationError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  const safe = error instanceof ActivationError || error instanceof SourceSemanticsError ? error
    : error && typeof error === 'object' && 'statusCode' in error && [400, 413, 415].includes(Number(error.statusCode))
      ? invalidActivationRequest() : new ActivationError(503, 'ACTIVATION_UNAVAILABLE');
  return reply.header('Cache-Control', 'no-store').code(safe.statusCode).send({
    code: safe.code, message: 'The activation request could not be completed.', diagnostics: [], correlationId: request.id,
  });
}

export function createWorkerActivationPlugin(service: Pick<ReturnType<typeof createWorkerActivation>, 'activate'>,
  serviceToken: string): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendActivationError);
    app.post('/internal/activate', {
      bodyLimit: 4096,
      onRequest: async request => authorizeActivationService(request, serviceToken),
    }, async (request, reply) => {
      const body = InternalActivationRequestSchema.safeParse(request.body);
      if (!body.success || request.url.includes('?')) throw invalidActivationRequest();
      return reply.header('Cache-Control', 'no-store').send(ReceiptResponseSchema.parse(await service.activate(body.data)));
    });
  };
}
