import {
  AuthorityAdmissionTicketSchema, AuthorityOperationV1Schema, AuthorityStatusResponseV1Schema,
  CurrentAuthorityV1Schema,
  type AuthorityAdmissionTicket, type AuthorityOperationBodyV1, type AuthorityOperationV1,
  type AuthorityStatusCommandV1, type Id,
} from '@eapr/contracts';
import { readJson, responseError } from '../../worker/src/authority-transport.js';
import { authorityError } from '../../worker/src/sync/current-authority-errors.js';

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
