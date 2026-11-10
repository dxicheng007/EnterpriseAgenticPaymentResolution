import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  AuthorityAdmissionCheckV1Schema, AuthorityAdmissionResponseV1Schema, AuthorityOperationV1Schema, hashCanonical,
  type AuthorityAdmissionCheckV1, type AuthorityOperationV1,
} from '@eapr/contracts';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthorityWorkerClient } from './authority-worker-client.js';
import { LocalSessionError, type createLocalSessionService } from './local-session.js';
import {
  authorityBodyLimit, createAuthorityPublicPlugin, rejectAuthorityQuery, rejectPrivateAdmission,
  requireAuthorityJson, sendAuthorityError,
} from './routes/authority.js';
import { authorityError } from '../../worker/src/sync/current-authority-errors.js';

export type AuthorityInvalidRequest = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

type Session = ReturnType<typeof createLocalSessionService>;
type Pending = {
  readonly operation: Readonly<AuthorityOperationV1>;
  readonly requestHash: string;
  readonly mode: AuthorityAdmissionCheckV1['mode'];
  readonly reviewerId: string;
  readonly sessionId: string;
  readonly authorize: () => ReturnType<Session['authorizeReviewer']>;
  readonly deadline: number;
  readonly cleanup: () => void;
};

const capacity = 256;
const lifetimeMs = 8000;

export function composeAuthorityOperations({ session, worker, admissionToken }: {
  session: Session;
  worker?: AuthorityWorkerClient;
  admissionToken?: string;
}): { plugin: FastifyPluginAsync; invalidRequest: AuthorityInvalidRequest } {
  const expectedBearer = admissionToken && admissionToken.length <= 1024 && /^[A-Za-z0-9._~+/-]+=*$/.test(admissionToken)
    ? Buffer.from('Bearer ' + admissionToken) : undefined;
  const pending = new Map<string, Pending>();
  const publicResponses = new WeakMap<FastifyRequest, FastifyReply['raw']>();
  let closing = false;

  async function run(request: FastifyRequest, input: AuthorityOperationV1) {
    const operation = AuthorityOperationV1Schema.parse(input);
    if (operation.body) Object.freeze(operation.body);
    Object.freeze(operation);
    const mutation = operation.action !== 'read';
    const authorize = () => session.authorizeReviewer(request, { mutation });
    const { reviewer, allowedAccountIds } = await authorize();
    if (!allowedAccountIds.includes(operation.accountId)) throw authorityError('AUTHORITY_FORBIDDEN');
    const response = publicResponses.get(request);
    publicResponses.delete(request);
    if (!worker || !expectedBearer || !response || closing || pending.size >= capacity ||
        request.raw.aborted || response.destroyed) {
      throw authorityError('AUTHORITY_UNAVAILABLE');
    }

    const ticket = randomBytes(32).toString('hex');
    if (pending.has(ticket)) throw authorityError('AUTHORITY_UNAVAILABLE');
    const transport = new AbortController();
    const entry: Pending = {
      operation, requestHash: hashCanonical(operation), mode: mutation ? 'mutation' : 'read',
      reviewerId: reviewer.reviewerId, sessionId: reviewer.sessionId, authorize,
      deadline: performance.now() + lifetimeMs,
      cleanup() {
        if (pending.get(ticket) !== entry) return;
        pending.delete(ticket);
        clearTimeout(timer);
        request.raw.removeListener('aborted', entry.cleanup);
        response.removeListener('close', onClose);
        transport.abort();
      },
    };
    const onClose = () => {
      if (!response.writableFinished) entry.cleanup();
    };
    const timer = setTimeout(entry.cleanup, lifetimeMs);
    timer.unref();
    pending.set(ticket, entry);
    request.raw.once('aborted', entry.cleanup);
    response.once('close', onClose);
    try {
      if (operation.action === 'read') return await worker.read(operation.accountId, ticket, transport.signal);
      return await worker.command(operation.accountId, operation.action, operation.body, ticket, transport.signal);
    } finally {
      entry.cleanup();
    }
  }

  function requireLive(ticket: string, entry: Pending) {
    if (pending.get(ticket) !== entry) throw authorityError('AUTHORITY_FORBIDDEN');
    if (performance.now() >= entry.deadline) {
      entry.cleanup();
      throw authorityError('AUTHORITY_FORBIDDEN');
    }
  }

  function closeAdmissions() {
    closing = true;
    for (const entry of pending.values()) entry.cleanup();
  }

  const plugin: FastifyPluginAsync = async app => {
    app.addHook('preClose', async () => { closeAdmissions(); });
    app.addHook('onClose', async () => { closeAdmissions(); });
    app.setErrorHandler(sendAuthorityError);
    await app.register(async publicApp => {
      // Preserve the originating response while keeping the public run seam request-only.
      publicApp.addHook('onRequest', async (request, reply) => { publicResponses.set(request, reply.raw); });
      await publicApp.register(createAuthorityPublicPlugin({
        authorizeReviewer: (request, options) => session.authorizeReviewer(request, options),
        run,
      }));
    });
    app.post('/internal/authority-admissions/check', {
      bodyLimit: authorityBodyLimit,
      onRequest: async request => {
        if (!expectedBearer || !worker) throw authorityError('AUTHORITY_UNAVAILABLE');
        const supplied = Buffer.from(request.headers.authorization ?? '');
        let count = 0;
        for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
          if (request.raw.rawHeaders[index]?.toLowerCase() === 'authorization') count++;
        }
        if (count !== 1 || supplied.length !== expectedBearer.length || !timingSafeEqual(supplied, expectedBearer)) {
          throw authorityError('AUTHORITY_UNAUTHORIZED');
        }
        rejectPrivateAdmission(request);
        if (request.headers.cookie !== undefined || request.headers['x-eapr-csrf'] !== undefined) {
          throw authorityError('AUTHORITY_INPUT_INVALID');
        }
        rejectAuthorityQuery(request);
        requireAuthorityJson(request);
      },
    }, async (request, reply) => {
      const check = AuthorityAdmissionCheckV1Schema.safeParse(request.body);
      if (!check.success) throw authorityError('AUTHORITY_INPUT_INVALID');
      const { ticket, requestHash, mode } = check.data;
      const entry = pending.get(ticket);
      if (!entry || entry.requestHash !== requestHash || entry.mode !== mode) throw authorityError('AUTHORITY_FORBIDDEN');
      requireLive(ticket, entry);

      let grants: Awaited<ReturnType<Pending['authorize']>>;
      try {
        grants = await entry.authorize();
      } catch (error) {
        requireLive(ticket, entry);
        if (!(error instanceof LocalSessionError)) throw authorityError('AUTHORITY_UNAVAILABLE');
        throw authorityError(error.statusCode === 401 ? 'AUTHORITY_UNAUTHORIZED' : 'AUTHORITY_FORBIDDEN');
      }
      requireLive(ticket, entry);
      const detached = AuthorityAdmissionResponseV1Schema.safeParse({
        requestHash, grants: { reviewer: grants.reviewer, allowedAccountIds: grants.allowedAccountIds,
          allowedSourceRefs: grants.allowedSourceRefs },
      });
      if (!detached.success) throw authorityError('AUTHORITY_UNAVAILABLE');
      if (grants.reviewer.reviewerId !== entry.reviewerId || grants.reviewer.sessionId !== entry.sessionId ||
          !grants.allowedAccountIds.includes(entry.operation.accountId)) {
        throw authorityError('AUTHORITY_FORBIDDEN');
      }
      requireLive(ticket, entry);
      return reply.header('Cache-Control', 'no-store').send(detached.data);
    });
  };

  const invalidRequest: AuthorityInvalidRequest = async (request, reply) => {
    try {
      await session.authorizeReviewer(request, { mutation: request.method === 'POST' });
      rejectPrivateAdmission(request);
    } catch (error) {
      return sendAuthorityError(error, request, reply);
    }
    return sendAuthorityError(authorityError('AUTHORITY_INPUT_INVALID'), request, reply);
  };
  return { plugin, invalidRequest };
}
