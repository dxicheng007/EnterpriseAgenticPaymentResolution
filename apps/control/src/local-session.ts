import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { IdSchema, LocalSessionResponseSchema, type Id, type LocalSessionResponse, type ReviewerContext } from '@eapr/contracts';

export type LocalReviewerContext = {
  demoOnly: true;
  reviewer: ReviewerContext;
  allowedSourceRefs: Id[];
  allowedAccountIds: Id[];
};

const cookieName = 'eapr_local_reviewer';
const randomToken = () => randomBytes(32).toString('hex');
const forbiddenHeaders = new Set([
  'authorization', 'proxy-authorization', 'x-eapr-task-token', 'x-eapr-service-token',
  'x-eapr-source-operator-token', 'x-task-token', 'x-service-token', 'x-source-operator-token',
]);

const errors = {
  400: ['LOCAL_SESSION_INVALID', 'Local session request is malformed'],
  401: ['LOCAL_SESSION_REQUIRED', 'Local reviewer session is required'],
  403: ['LOCAL_SESSION_FORBIDDEN', 'Local reviewer access is forbidden'],
} as const;

export class LocalSessionError extends Error {
  readonly code: string;
  constructor(readonly statusCode: keyof typeof errors) {
    super(errors[statusCode][1]);
    this.code = errors[statusCode][0];
  }
}

function rejectCredentials(request: FastifyRequest) {
  if (Object.keys(request.headers).some(name => forbiddenHeaders.has(name))) throw new LocalSessionError(403);
}

function readCookie(request: FastifyRequest) {
  const matches = request.headers.cookie?.split(';').map(value => value.trim())
    .filter(value => value.startsWith(cookieName + '=')) ?? [];
  if (matches.length === 1) return matches[0]!.slice(cookieName.length + 1);
}

function equalToken(value: unknown, expected: string) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
}

export function createLocalSessionService({ webOrigin, reviewerId, allowedSourceRefs, allowedAccountIds }: {
  webOrigin: string;
  reviewerId: Id;
  allowedSourceRefs: Id[];
  allowedAccountIds: Id[];
}) {
  const url = new URL(webOrigin);
  if (url.origin !== webOrigin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Local reviewer session requires the configured loopback web origin');
  }
  const grants = {
    allowedSourceRefs: IdSchema.array().parse(allowedSourceRefs),
    allowedAccountIds: IdSchema.array().parse(allowedAccountIds),
  };
  IdSchema.parse(reviewerId);
  const sessions = new Map<string, LocalSessionResponse>();

  function findSession(request: FastifyRequest) {
    const credential = readCookie(request);
    return credential === undefined ? undefined : sessions.get(credential);
  }

  const plugin: FastifyPluginAsync = async app => {
    app.setErrorHandler((error, request, reply) => {
      const status = error instanceof LocalSessionError ? error.statusCode : 400;
      const [code, message] = errors[status];
      return reply.code(status).header('Cache-Control', 'no-store')
        .send({ code, message, correlationId: request.id, diagnostics: [] });
    });
    app.post('/api/local-session', {
      onRequest: async request => {
        rejectCredentials(request);
        if (request.headers.origin !== webOrigin || request.headers['x-eapr-local-ui'] !== '1' ||
          (request.headers['sec-fetch-site'] !== undefined && request.headers['sec-fetch-site'] !== 'same-origin')) {
          throw new LocalSessionError(403);
        }
        const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
        if (contentType !== 'application/json') throw new LocalSessionError(400);
      },
    }, async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
        throw new LocalSessionError(400);
      }
      reply.header('Cache-Control', 'no-store');
      const existing = findSession(request);
      if (existing) return existing;

      const credential = randomToken();
      const session = LocalSessionResponseSchema.parse({
        demoOnly: true, reviewer: { reviewerId, sessionId: randomToken() }, ...grants, csrfToken: randomToken(),
      });
      sessions.set(credential, session);
      // Local-demo only. Loopback HTTP cannot require a Secure cookie.
      reply.header('Set-Cookie', cookieName + '=' + credential + '; HttpOnly; SameSite=Strict; Path=/api');
      return session;
    });
  };

  async function authorizeReviewer(request: FastifyRequest, { mutation }: { mutation: boolean }): Promise<LocalReviewerContext> {
    rejectCredentials(request);
    const session = findSession(request);
    if (!session) throw new LocalSessionError(401);
    const origin = request.headers.origin;
    if ((origin !== undefined && origin !== webOrigin) ||
      (mutation && (origin !== webOrigin || !equalToken(request.headers['x-eapr-csrf'], session.csrfToken)))) {
      throw new LocalSessionError(403);
    }
    return {
      demoOnly: true, reviewer: { ...session.reviewer },
      allowedSourceRefs: [...session.allowedSourceRefs], allowedAccountIds: [...session.allowedAccountIds],
    };
  }

  return { plugin, authorizeReviewer };
}
