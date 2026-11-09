import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { IdSchema, ParentReadQuerySchema } from '@eapr/contracts';
import type { createParentReads } from '../parent-reads.js';

const failures = {
  400: ['PARENT_READ_INVALID', 'Parent read request is invalid'],
  401: ['PARENT_READ_UNAUTHORIZED', 'Parent read requires an authorized caller'],
  403: ['PARENT_READ_FORBIDDEN', 'Parent read access is forbidden'],
  404: ['PARENT_READ_NOT_FOUND', 'The registered scope or snapshot was not found'],
  503: ['PARENT_READ_UNAVAILABLE', 'Parent records are unavailable'],
} as const;

export class ParentReadError extends Error {
  constructor(readonly statusCode: keyof typeof failures) {
    super(failures[statusCode][1]);
  }
}

export function sendParentReadError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  const candidate = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
  const status = candidate === 400 || candidate === 401 || candidate === 403 || candidate === 404 ? candidate : 503;
  const [code, message] = failures[status];
  return reply.header('Cache-Control', 'no-store').code(status).send({ code, message, diagnostics: [], correlationId: request.id });
}

export function parseParentRead(request: FastifyRequest<{ Params: { accountId: string } }>, activation = false) {
  const accountId = IdSchema.safeParse(request.params.accountId);
  const raw = request.url.split('?').slice(1).join('?');
  const entries = new Map<string, string>();
  try {
    for (const pair of raw ? raw.split('&') : []) {
      const separator = pair.indexOf('=');
      if (separator < 0) throw new ParentReadError(400);
      const key = decodeURIComponent(pair.slice(0, separator).replaceAll('+', ' '));
      const value = decodeURIComponent(pair.slice(separator + 1).replaceAll('+', ' '));
      if (activation || entries.has(key) || (key !== 'asOf' && key !== 'snapshotHash')) throw new ParentReadError(400);
      entries.set(key, value);
    }
  } catch {
    throw new ParentReadError(400);
  }
  const query = ParentReadQuerySchema.safeParse(Object.fromEntries(entries));
  if (!accountId.success || !query.success) throw new ParentReadError(400);
  return { accountId: accountId.data, query: query.data };
}

export type AuthorizeParentRead = (request: FastifyRequest) => void | Promise<void>;

export function createParentReadPlugin(reads: ReturnType<typeof createParentReads>, authorize: AuthorizeParentRead): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendParentReadError);
    app.get<{ Params: { accountId: string } }>('/internal/parent/:accountId', async (request, reply) => {
      await authorize(request);
      const { accountId, query } = parseParentRead(request);
      return reply.header('Cache-Control', 'no-store').send(await reads.readParent(accountId, query));
    });
  };
}
