import {
  ApiErrorSchema, AuthorityAdmissionTicketSchema, AuthorityOperationV1Schema, AuthorityStatusResponseV1Schema,
  CurrentAuthorityV1Schema,
  type AuthorityAdmissionTicket, type AuthorityOperationBodyV1, type AuthorityOperationV1,
  type AuthorityStatusCommandV1, type Id,
} from '@eapr/contracts';
import { authorityError } from '../../worker/src/sync/current-authority-errors.js';

const maximumResponseBytes = 256 * 1024;
const authorityCodes: Record<Parameters<typeof authorityError>[0], true> = {
  AUTHORITY_INPUT_INVALID: true,
  AUTHORITY_UNAUTHORIZED: true,
  AUTHORITY_FORBIDDEN: true,
  AUTHORITY_NOT_FOUND: true,
  AUTHORITY_IDEMPOTENCY_CONFLICT: true,
  AUTHORITY_STALE: true,
  AUTHORITY_REVOKED: true,
  AUTHORITY_EPOCH_EXHAUSTED: true,
  AUTHORITY_INACTIVE: true,
  AUTHORITY_SEMANTICS_MISMATCH: true,
  AUTHORITY_SEMANTICS_UNAVAILABLE: true,
  AUTHORITY_STORAGE_INVALID: true,
  AUTHORITY_UNAVAILABLE: true,
};

function responseError(status: number, json: unknown) {
  const parsed = ApiErrorSchema.safeParse(json);
  if (parsed.success && Object.hasOwn(authorityCodes, parsed.data.code)) {
    const error = authorityError(parsed.data.code as keyof typeof authorityCodes);
    if (error.statusCode === status) return error;
  }
  return authorityError('AUTHORITY_UNAVAILABLE');
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw authorityError('AUTHORITY_UNAVAILABLE');
  const reader = response.body.getReader();
  // Cancel the read without waiting for the stream source to finish cleanup.
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) cancel();
    signal.throwIfAborted();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumResponseBytes) {
        cancel();
        throw authorityError('AUTHORITY_UNAVAILABLE');
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export function createAuthorityWorkerClient(baseUrl: string, serviceToken: string) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== baseUrl ||
      !/^[A-Za-z0-9._~+/-]+=*$/.test(serviceToken) || serviceToken.length > 1024) {
    throw new Error('Authority operations require a fixed loopback worker origin and service credential');
  }

  async function send({ accountId, action, body }: AuthorityOperationV1, ticket: AuthorityAdmissionTicket, caller?: AbortSignal) {
    const path = '/internal/connections/' + encodeURIComponent(accountId) + '/' + (action === 'read' ? 'authority' : action);
    let response: Response;
    let json: unknown;
    try {
      const admission = AuthorityAdmissionTicketSchema.parse(ticket);
      const deadline = AbortSignal.timeout(8000);
      const signal = caller ? AbortSignal.any([caller, deadline]) : deadline;
      signal.throwIfAborted();
      response = await fetch(new URL(path, origin), {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: 'Bearer ' + serviceToken, 'x-eapr-authority-admission': admission,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error', signal,
      });
      json = await readJson(response, signal);
      signal.throwIfAborted();
    } catch {
      throw authorityError('AUTHORITY_UNAVAILABLE');
    }
    if (response.status !== 200) throw responseError(response.status, json);
    return json;
  }

  return {
    async read(accountId: Id, ticket: AuthorityAdmissionTicket, signal?: AbortSignal) {
      const operation = AuthorityOperationV1Schema.safeParse({ schemaVersion: '1', accountId, action: 'read', body: null });
      if (!operation.success) throw authorityError('AUTHORITY_UNAVAILABLE');
      const result = CurrentAuthorityV1Schema.safeParse(await send(operation.data, ticket, signal));
      if (!result.success || result.data.identity.scope.accountId !== operation.data.accountId) {
        throw authorityError('AUTHORITY_UNAVAILABLE');
      }
      return result.data;
    },
    async command(accountId: Id, action: AuthorityStatusCommandV1['action'], body: AuthorityOperationBodyV1,
      ticket: AuthorityAdmissionTicket, signal?: AbortSignal) {
      const operation = AuthorityOperationV1Schema.safeParse({ schemaVersion: '1', accountId, action, body });
      if (!operation.success || operation.data.action === 'read') throw authorityError('AUTHORITY_UNAVAILABLE');
      const expected = operation.data;
      const response = AuthorityStatusResponseV1Schema.safeParse(await send(expected, ticket, signal));
      if (!response.success) throw authorityError('AUTHORITY_UNAVAILABLE');
      const { result } = response.data;
      if (result.identity.scope.accountId !== expected.accountId || result.action !== expected.action ||
          result.idempotencyKey !== expected.body.idempotencyKey || result.beforeEpoch !== expected.body.expectedEpoch) {
        throw authorityError('AUTHORITY_UNAVAILABLE');
      }
      return response.data;
    },
  };
}

export type AuthorityWorkerClient = ReturnType<typeof createAuthorityWorkerClient>;
