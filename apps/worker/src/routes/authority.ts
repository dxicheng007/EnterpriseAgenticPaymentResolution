import { timingSafeEqual } from 'node:crypto';
import {
  ApiErrorSchema, AuthorityAdmissionTicketSchema, AuthorityOperationV1Schema,
  AuthorityStatusResponseV1Schema, CurrentAuthorityV1Schema, canonicalJson, hashCanonical,
  type AuthorityAdmissionCheckV1, type CurrentAuthorityV1, type Id, type SemanticPreflight,
} from '@eapr/contracts';
import type { Clock } from '@eapr/storage/control-db';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AuthorityAdmissionClient } from '../authority-admission-client.js';
import { readIngressAuthorityIdentity } from '../authority-identity.js';
import { createCurrentAuthority } from '../sync/current-authority.js';
import { AuthorityError, authorityError } from '../sync/current-authority-errors.js';

const ticketHeader = 'x-eapr-authority-admission';
const headers = new Set([
  'authorization', ticketHeader, 'host', 'connection', 'user-agent', 'accept',
  'accept-encoding', 'accept-language', 'sec-fetch-mode', 'content-type', 'content-length', 'transfer-encoding',
]);
const payloadErrors = new Set([
  'FST_ERR_CTP_BODY_TOO_LARGE', 'FST_ERR_CTP_INVALID_MEDIA_TYPE', 'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
  'FST_ERR_CTP_EMPTY_JSON_BODY', 'FST_ERR_CTP_INVALID_JSON_BODY',
]);

function headerCount(request: FastifyRequest, name: string) {
  const raw = request.raw.rawHeaders;
  let count = 0;
  for (let index = 0; index < raw.length; index += 2) {
    if (raw[index]!.toLowerCase() === name) count += 1;
  }
  return count;
}

export function authorizeAuthorityService(request: FastifyRequest, serviceToken: string): void {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || headerCount(request, 'authorization') !== 1) {
    throw authorityError('AUTHORITY_UNAUTHORIZED');
  }
  const expected = Buffer.from('Bearer ' + serviceToken);
  const supplied = Buffer.from(value);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw authorityError('AUTHORITY_UNAUTHORIZED');
  }
}

export function sendAuthorityError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  let safe = authorityError('AUTHORITY_UNAVAILABLE');
  if (error instanceof AuthorityError) {
    const canonical = authorityError(error.code);
    if (canonical.statusCode === error.statusCode) safe = canonical;
  } else if (error instanceof Error && 'code' in error && typeof error.code === 'string' && payloadErrors.has(error.code)) {
    safe = authorityError('AUTHORITY_INPUT_INVALID');
  }
  return reply.header('Cache-Control', 'no-store').code(safe.statusCode).send(ApiErrorSchema.parse({
    code: safe.code, message: safe.message, correlationId: request.id, diagnostics: [],
  }));
}

function validateSubject(result: CurrentAuthorityV1, subject: Awaited<ReturnType<typeof readIngressAuthorityIdentity>>) {
  if (canonicalJson(result.identity) !== canonicalJson(subject.identity) || result.sourceRef !== subject.sourceRef ||
      result.artifactHash !== subject.artifactHash || result.profileHash !== subject.profileHash ||
      result.manifestHash !== subject.manifestHash) {
    throw authorityError('AUTHORITY_UNAVAILABLE');
  }
}

type Params = { Params: { accountId: string } };
type Action = 'read' | 'pause' | 'resume' | 'revoke';

export function createWorkerAuthorityPlugin({ db, clock, serviceToken, admissions, observe }: {
  db: Pool; clock: Clock; serviceToken: string; admissions?: AuthorityAdmissionClient;
  observe: (sourceRef: Id) => Promise<SemanticPreflight>;
}): FastifyPluginAsync {
  return async app => {
    const requests = new WeakMap<FastifyRequest, Readonly<AuthorityAdmissionCheckV1>>();

    async function authorize(request: FastifyRequest, mode: AuthorityAdmissionCheckV1['mode']) {
      const binding = requests.get(request);
      if (!binding || binding.mode !== mode) throw authorityError('AUTHORITY_FORBIDDEN');
      if (!admissions) throw authorityError('AUTHORITY_UNAVAILABLE');
      const { grants } = await admissions.check(binding);
      return grants;
    }

    const service = createCurrentAuthority<FastifyRequest>({ db, clock, observe, admission: { authorize } });

    function checkRequest(mutation: boolean) {
      return async (request: FastifyRequest) => {
        authorizeAuthorityService(request, serviceToken);
        if (/[?#]/.test(request.url) || Object.keys(request.headers).some(name => !headers.has(name))) {
          throw authorityError('AUTHORITY_INPUT_INVALID');
        }
        if (headerCount(request, ticketHeader) !== 1 || !AuthorityAdmissionTicketSchema.safeParse(request.headers[ticketHeader]).success) {
          throw authorityError('AUTHORITY_INPUT_INVALID');
        }
        if (mutation) {
          if (request.mediaType !== 'application/json') throw authorityError('AUTHORITY_INPUT_INVALID');
        } else {
          const length = request.headers['content-length'];
          if (request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')) {
            throw authorityError('AUTHORITY_INPUT_INVALID');
          }
        }
      };
    }

    function handle(action: Action) {
      return async (request: FastifyRequest<Params>, reply: FastifyReply) => {
        const parsed = AuthorityOperationV1Schema.safeParse({
          schemaVersion: '1', accountId: request.params.accountId, action,
          body: action === 'read' ? null : request.body,
        });
        if (!parsed.success) throw authorityError('AUTHORITY_INPUT_INVALID');
        const operation = Object.freeze(parsed.data);
        if (operation.body) Object.freeze(operation.body);
        const mode = operation.action === 'read' ? 'read' : 'mutation';
        const ticket = AuthorityAdmissionTicketSchema.parse(request.headers[ticketHeader]);
        requests.set(request, Object.freeze({ ticket, requestHash: hashCanonical(operation), mode }));
        try {
          const grants = await authorize(request, mode);
          if (!grants.allowedAccountIds.includes(operation.accountId)) throw authorityError('AUTHORITY_FORBIDDEN');
          const subject = await readIngressAuthorityIdentity(db, operation.accountId);
          if (!grants.allowedSourceRefs.includes(subject.sourceRef)) throw authorityError('AUTHORITY_FORBIDDEN');

          if (operation.action === 'read') {
            const result = CurrentAuthorityV1Schema.parse(await service.read(request, subject.identity));
            validateSubject(result, subject);
            return reply.header('Cache-Control', 'no-store').send(result);
          }
          const result = AuthorityStatusResponseV1Schema.parse(await service.command(request, {
            schemaVersion: '1', identity: subject.identity, action: operation.action, ...operation.body,
          }));
          validateSubject(result.result.state, subject);
          return reply.header('Cache-Control', 'no-store').send(result);
        } finally {
          requests.delete(request);
        }
      };
    }

    app.setErrorHandler(sendAuthorityError);
    const path = '/internal/connections/:accountId/';
    app.get<Params>(path + 'authority', { exposeHeadRoute: false, onRequest: checkRequest(false) }, handle('read'));
    for (const action of ['pause', 'resume', 'revoke'] as const) {
      app.post<Params>(path + action, { bodyLimit: 4096, onRequest: checkRequest(true) }, handle(action));
    }
  };
}
