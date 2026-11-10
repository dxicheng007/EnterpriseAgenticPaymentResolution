import {
  ApiErrorSchema, AuthorityOperationBodyV1Schema, IdSchema,
  type AuthorityOperationV1, type AuthorityStatusResponseV1, type CurrentAuthorityV1,
} from '@eapr/contracts';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AuthorityError, authorityError } from '../../../worker/src/sync/current-authority-errors.js';
import { LocalSessionError, type createLocalSessionService } from '../local-session.js';

type AuthorizeReviewer = ReturnType<typeof createLocalSessionService>['authorizeReviewer'];

const authorityAdmissionHeader = 'x-eapr-authority-admission';
export const authorityBodyLimit = 4096;

const payloadErrors = new Set([
  'FST_ERR_CTP_BODY_TOO_LARGE', 'FST_ERR_CTP_INVALID_MEDIA_TYPE', 'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
  'FST_ERR_CTP_EMPTY_JSON_BODY', 'FST_ERR_CTP_INVALID_JSON_BODY',
]);

export function sendAuthorityError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  let safe: AuthorityError | LocalSessionError = authorityError('AUTHORITY_UNAVAILABLE');
  if (error instanceof LocalSessionError) {
    safe = new LocalSessionError(error.statusCode);
  } else if (error instanceof AuthorityError) {
    const canonical = authorityError(error.code);
    if (canonical.statusCode === error.statusCode) safe = canonical;
  } else if (error instanceof Error && 'code' in error && typeof error.code === 'string' && payloadErrors.has(error.code)) {
    safe = authorityError('AUTHORITY_INPUT_INVALID');
  }
  return reply.header('Cache-Control', 'no-store').code(safe.statusCode).send(ApiErrorSchema.parse({
    code: safe.code, message: safe.message, correlationId: request.id, diagnostics: [],
  }));
}

export function rejectPrivateAdmission(request: FastifyRequest) {
  if (request.headers[authorityAdmissionHeader] !== undefined) throw authorityError('AUTHORITY_INPUT_INVALID');
}

export function rejectAuthorityQuery(request: FastifyRequest) {
  // Fastify can discard empty queries and raw fragment delimiters when matching.
  if (/[?#]/.test(request.url)) throw authorityError('AUTHORITY_INPUT_INVALID');
}

export function requireAuthorityJson(request: FastifyRequest) {
  if (request.mediaType !== 'application/json') throw authorityError('AUTHORITY_INPUT_INVALID');
}

export function createAuthorityPublicPlugin({ authorizeReviewer, run }: {
  authorizeReviewer: AuthorizeReviewer;
  run(request: FastifyRequest, operation: AuthorityOperationV1): Promise<CurrentAuthorityV1 | AuthorityStatusResponseV1>;
}): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendAuthorityError);

    function authorized(mutation: boolean) {
      return async (request: FastifyRequest<{ Params: { accountId: string } }>) => {
        const grants = await authorizeReviewer(request, { mutation });
        rejectPrivateAdmission(request);
        rejectAuthorityQuery(request);
        const account = IdSchema.safeParse(request.params.accountId);
        if (!account.success) throw authorityError('AUTHORITY_INPUT_INVALID');
        if (!grants.allowedAccountIds.includes(account.data)) throw authorityError('AUTHORITY_FORBIDDEN');
        if (mutation) requireAuthorityJson(request);
        else {
          const length = request.headers['content-length'];
          if (request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')) {
            throw authorityError('AUTHORITY_INPUT_INVALID');
          }
        }
      };
    }

    async function dispatch(request: FastifyRequest, reply: FastifyReply, operation: AuthorityOperationV1) {
      return reply.header('Cache-Control', 'no-store').send(await run(request, operation));
    }

    const path = '/api/connections/:accountId/';
    app.get<{ Params: { accountId: string } }>(path + 'authority', {
      exposeHeadRoute: false, onRequest: authorized(false),
    }, (request, reply) => dispatch(request, reply, {
      schemaVersion: '1', accountId: request.params.accountId, action: 'read', body: null,
    }));
    for (const action of ['pause', 'resume', 'revoke'] as const) {
      app.post<{ Params: { accountId: string } }>(path + action, {
        bodyLimit: authorityBodyLimit, onRequest: authorized(true),
      }, (request, reply) => {
        const body = AuthorityOperationBodyV1Schema.safeParse(request.body);
        if (!body.success) throw authorityError('AUTHORITY_INPUT_INVALID');
        return dispatch(request, reply, { schemaVersion: '1', accountId: request.params.accountId, action, body: body.data });
      });
    }
  };
}
