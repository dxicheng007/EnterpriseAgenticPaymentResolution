import { request as httpRequest, type OutgoingHttpHeaders } from 'node:http';
import { ApiErrorSchema, AuthorityAdmissionResponseV1Schema, hashCanonical, LocalSessionResponseSchema,
  type AuthorityAdmissionCheckV1, type AuthorityOperationV1, type CurrentAuthorityV1, type AuthorityStatusResponseV1,
} from '@eapr/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, expect, test, vi } from 'vitest';
import { composeAuthorityOperations } from '../src/authority-composition.js';
import type { AuthorityWorkerClient } from '../src/authority-worker-client.js';
import { createLocalSessionService, LocalSessionError } from '../src/local-session.js';
import { buildControl } from '../src/server.js';
import { authorityError } from '../../worker/src/sync/current-authority-errors.js';

const origin = 'http://127.0.0.1:5173';
const accountId = 'account-a';
const accountPath = '/api/connections/' + accountId;
const sourceRef = 'source-a';
const token = 'private-admission-token';
const callbackPath = '/internal/authority-admissions/check';
const jsonHeaders = { 'content-type': 'application/json' };
const privateHeaders = { ...jsonHeaders, authorization: 'Bearer ' + token };
const ticketHeader = 'x-eapr-authority-admission';
const body = { expectedEpoch: 1, idempotencyKey: 'pause-1' };
const operation = { schemaVersion: '1', accountId, action: 'pause', body } as const;
const readOperation = { schemaVersion: '1', accountId, action: 'read', body: null } as const;
const changedAt = '2026-11-10T08:00:00.000Z';
const state: CurrentAuthorityV1 = {
  schemaVersion: '1', identity: {
    scope: { companyId: 'company', sellerEntityId: 'seller', accountId }, activationId: 'activation', bundleHash: 'a'.repeat(64),
  }, sourceRef, artifactHash: 'b'.repeat(64), profileHash: 'c'.repeat(64), manifestHash: 'd'.repeat(64),
  status: 'active', epoch: 1, changedAt,
};
const commandResult: AuthorityStatusResponseV1 = {
  result: { schemaVersion: '1', identity: state.identity, action: 'pause', idempotencyKey: body.idempotencyKey,
    beforeStatus: 'active', beforeEpoch: 1, state: { ...state, status: 'paused', epoch: 2 }, changed: true, committedAt: changedAt },
  replayed: false,
};
const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0).reverse()) await close();
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

type Session = ReturnType<typeof createLocalSessionService>;
type Response = { statusCode: number; headers: { 'cache-control'?: unknown }; json(): unknown };

function safeError(response: Response, status: number, code: string) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['cache-control']).toBe('no-store');
  const error = ApiErrorSchema.parse(response.json());
  expect(error.code).toBe(code);
  expect(error.diagnostics).toEqual([]);
  return error;
}

function workerHarness() {
  type Call = { ticket: string; signal: AbortSignal; operation: AuthorityOperationV1; finish: (error?: Error) => void };
  const calls: Call[] = [];
  const waiters = new Map<number, ReturnType<typeof deferred<Call>>>();
  function record(operation: AuthorityOperationV1, ticket: string, signal?: AbortSignal) {
    if (!signal) throw new Error('Forwarding must carry a cancellation signal');
    const end = deferred<Error | undefined>();
    const call = { operation, ticket, signal, finish: (error?: Error) => end.resolve(error) };
    waiters.get(calls.push(call) - 1)?.resolve(call);
    return end.promise.then(error => { if (error) throw error; });
  }
  const worker: AuthorityWorkerClient = {
    async read(accountId, ticket, signal) {
      await record({ schemaVersion: '1', action: 'read', accountId, body: null }, ticket, signal);
      return state;
    },
    async command(accountId, action, body, ticket, signal) {
      await record({ schemaVersion: '1', accountId, action, body }, ticket, signal);
      return commandResult;
    },
  };
  function at(index: number) {
    if (calls[index]) return Promise.resolve(calls[index]);
    let waiter = waiters.get(index);
    if (!waiter) {
      waiter = deferred<Call>();
      waiters.set(index, waiter);
    }
    return waiter.promise;
  }
  return { worker, calls, at, finishAll: () => calls.forEach(call => call.finish()) };
}

async function fixture(options: {
  wrap?: (authorize: Session['authorizeReviewer']) => Session['authorizeReviewer'];
  hook?: boolean; mount?: boolean; wiring?: 'no-worker' | 'bad-token';
} = {}) {
  const session = createLocalSessionService({ webOrigin: origin, reviewerId: 'reviewer', allowedSourceRefs: [sourceRef],
    allowedAccountIds: [accountId, 'account-b'] });
  const worker = workerHarness();
  const authority = composeAuthorityOperations({
    session: { ...session, authorizeReviewer: options.wrap?.(session.authorizeReviewer) ?? session.authorizeReviewer },
    ...(options.wiring === 'no-worker' ? {} : { worker: worker.worker }),
    admissionToken: options.wiring === 'bad-token' ? 'invalid token' : token,
  });
  const dependencies = {
    db: {} as Pool, workerClient: { getHealth: async () => { throw new Error('Unexpected health probe'); } },
    clock: () => new Date(changedAt), expectedMigrations: [],
    featurePlugins: [session.plugin, ...(options.mount === false ? [] : [authority.plugin])],
    ...(options.hook === false ? {} : { authorityInvalidRequest: authority.invalidRequest }),
  };
  const app = buildControl(dependencies);
  cleanup.push(async () => { worker.finishAll(); await app.close(); });
  const opened = await app.inject({
    method: 'POST', url: '/api/local-session', headers: { origin, 'x-eapr-local-ui': '1' }, payload: {},
  });
  expect(opened.statusCode).toBe(200);
  const cookie = opened.headers['set-cookie']!.toString().split(';')[0]!;
  const { csrfToken } = LocalSessionResponseSchema.parse(opened.json());
  const readHeaders = { cookie };
  const mutationHeaders = { ...jsonHeaders, cookie, origin, 'x-eapr-csrf': csrfToken };
  const post = (payload: string | object = body, headers: Record<string, string> = mutationHeaders, url = accountPath + '/pause') =>
    app.inject({ method: 'POST', url, headers, payload });
  const read = () => app.inject({ method: 'GET', url: accountPath + '/authority', headers: readHeaders });
  const check = (payload: Partial<AuthorityAdmissionCheckV1> | string, headers: Record<string, string> = privateHeaders, url = callbackPath) =>
    app.inject({ method: 'POST', url, headers, payload });
  return { app, worker, readHeaders, mutationHeaders, post, read, check };
}

function admission(ticket: string, binding: AuthorityOperationV1 = operation): AuthorityAdmissionCheckV1 {
  return { ticket, requestHash: hashCanonical(binding), mode: binding.action === 'read' ? 'read' : 'mutation' };
}

async function forwarded<T extends Response>(worker: ReturnType<typeof workerHarness>, index: number, response: Promise<T>) {
  return Promise.race([worker.at(index), response.then(result => {
    throw new Error('Expected an authorized request to reach the worker before HTTP ' + result.statusCode);
  })]);
}

function aborted(signal: AbortSignal) {
  return signal.aborted ? Promise.resolve() : new Promise<void>(resolve => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function listen(app: FastifyInstance) {
  const url = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
  return function raw(method: string, path: string, headers: OutgoingHttpHeaders | readonly string[], payload?: string) {
    const response = deferred<Response>();
    const client = httpRequest({ host: '127.0.0.1', port: url.port, method, path,
      headers: Array.isArray(headers) ? ['Host', url.host, ...headers] : headers, agent: false,
    }, incoming => {
      incoming.setEncoding('utf8');
      let data = '';
      incoming.on('data', text => { data += text; });
      incoming.on('end', () => response.resolve({
        statusCode: incoming.statusCode!, headers: incoming.headers, json: () => JSON.parse(data) as unknown,
      }));
    });
    // Destroyed test sockets settle their promise without creating unhandled errors.
    client.on('error', () => response.resolve({ statusCode: 0, headers: {}, json: () => undefined }));
    client.end(payload);
    cleanup.push(async () => { client.destroy(); });
    return { response: response.promise, destroy: () => client.destroy() };
  };
}

test('authenticates_before_parsing', async () => {
  const { post, mutationHeaders, worker } = await fixture();
  for (const payload of ['{', 'x'.repeat(4097)]) {
    safeError(await post(payload, { ...mutationHeaders, cookie: '' }), 401, 'LOCAL_SESSION_REQUIRED');
    for (const header of ['authorization', 'x-eapr-task-token', 'x-eapr-source-operator-token']) {
      const headers = { ...mutationHeaders, [header]: 'Bearer masquerading' };
      safeError(await post(payload, headers), 403, 'LOCAL_SESSION_FORBIDDEN');
    }
    safeError(await post(payload, { ...mutationHeaders, 'x-eapr-csrf': 'wrong' }), 403, 'LOCAL_SESSION_FORBIDDEN');
    safeError(await post(payload), 400, 'AUTHORITY_INPUT_INVALID');
  }
  expect(worker.calls).toHaveLength(0);
});

test('public_route_shape_is_closed', async () => {
  const { app, post, mutationHeaders, readHeaders, worker } = await fixture();
  const raw = await listen(app);
  for (const field of ['actor', 'reviewer', 'sessionId', 'identity', 'grants', 'action', 'sourceRef', 'policy',
    '__proto__', 'prototype', 'constructor']) {
    safeError(await post('{"expectedEpoch":1,"idempotencyKey":"pause-1","' + field + '":{}}'), 400, 'AUTHORITY_INPUT_INVALID');
  }
  for (const url of [accountPath + '/pause?foo=1', '/api/connections/_invalid/pause']) {
    safeError(await post(body, mutationHeaders, url), 400, 'AUTHORITY_INPUT_INVALID');
  }
  safeError(await post(JSON.stringify(body), { ...mutationHeaders, 'content-type': 'text/plain' }), 400, 'AUTHORITY_INPUT_INVALID');
  safeError(await post(JSON.stringify(body).padEnd(4097)), 400, 'AUTHORITY_INPUT_INVALID');
  safeError(await post(body, { ...mutationHeaders, [ticketHeader]: '' }), 400, 'AUTHORITY_INPUT_INVALID');
  safeError(await post(body, mutationHeaders, '/api/connections/foreign/pause'), 403, 'AUTHORITY_FORBIDDEN');
  safeError(await raw('POST', accountPath + '/pause?', mutationHeaders, JSON.stringify(body)).response, 400, 'AUTHORITY_INPUT_INVALID');
  safeError(await raw('GET', accountPath + '/authority?', readHeaders).response, 400, 'AUTHORITY_INPUT_INVALID');
  safeError(await raw('GET', accountPath + '/authority#ignored', readHeaders).response, 400, 'AUTHORITY_INPUT_INVALID');
  safeError(await raw('GET', accountPath + '/authority', { ...readHeaders, 'content-length': '2' }, '{}').response, 400, 'AUTHORITY_INPUT_INVALID');
  safeError(await raw('GET', accountPath + '/authority', { ...readHeaders, 'transfer-encoding': 'chunked' }).response, 400, 'AUTHORITY_INPUT_INVALID');
  expect((await app.inject({ method: 'HEAD', url: accountPath + '/authority', headers: readHeaders })).statusCode).toBe(404);
  expect(worker.calls).toHaveLength(0);
});

test('refresh_reuses_real_original_request', async () => {
  const requests: { request: FastifyRequest; mutation: boolean }[] = [];
  let revise: (grants: Awaited<ReturnType<Session['authorizeReviewer']>>) => void = () => {};
  const { post, check, worker } = await fixture({ wrap: real => async (request, options) => {
    requests.push({ request, mutation: options.mutation });
    const grants = await real(request, options);
    revise(grants);
    return grants;
  } });
  const operationResponse = post();
  const call = await forwarded(worker, 0, operationResponse);
  const descriptor = admission(call.ticket);
  const initial = AuthorityAdmissionResponseV1Schema.parse((await check(descriptor)).json());
  revise = grants => {
    grants.allowedAccountIds = [accountId, 'new-unrelated-account'];
    grants.allowedSourceRefs.push('new-unrelated-source');
  };
  const refreshed = AuthorityAdmissionResponseV1Schema.parse((await check(descriptor)).json());
  expect(initial.grants.allowedSourceRefs).toEqual([sourceRef]);
  expect(refreshed.grants.allowedSourceRefs).toEqual([sourceRef, 'new-unrelated-source']);
  expect(refreshed.grants.allowedAccountIds).toEqual([accountId, 'new-unrelated-account']);
  for (const reviseGrants of [
    (grants: typeof refreshed.grants) => { grants.reviewer.reviewerId = 'other-reviewer'; },
    (grants: typeof refreshed.grants) => { grants.reviewer.sessionId = 'other-session'; },
    (grants: typeof refreshed.grants) => { grants.allowedAccountIds = ['account-b']; },
    () => { throw new LocalSessionError(403); },
  ]) {
    revise = reviseGrants;
    safeError(await check(descriptor), 403, 'AUTHORITY_FORBIDDEN');
  }
  revise = () => { throw new LocalSessionError(401); };
  safeError(await check(descriptor), 401, 'AUTHORITY_UNAUTHORIZED');
  expect(requests).toHaveLength(9);
  expect(requests.every(({ request, mutation }) => request === requests[0]?.request && mutation)).toBe(true);
  call.finish();
  expect((await operationResponse).json()).toEqual(commandResult);
  safeError(await check(descriptor), 403, 'AUTHORITY_FORBIDDEN');
});

test('ticket_binds_complete_operation', async () => {
  const { post, read, check, worker, app, mutationHeaders } = await fixture();
  const firstResponse = post(JSON.stringify(body).padEnd(4096));
  const first = await forwarded(worker, 0, firstResponse);
  const secondResponse = read();
  const second = await forwarded(worker, 1, secondResponse);
  const valid = admission(first.ticket);
  const readValid = admission(second.ticket, readOperation);
  expect(first.operation).toEqual(operation);
  expect(second.operation).toEqual(readOperation);
  expect(Object.isFrozen(first.operation.body)).toBe(true);
  expect(/^[0-9a-f]{64}$/.test(first.ticket)).toBe(true);
  expect(first.ticket === second.ticket).toBe(false);
  for (const payload of [
    { ...valid, ticket: 'a'.repeat(64) },
    admission(first.ticket, { ...operation, accountId: 'account-b' }),
    admission(first.ticket, { ...operation, action: 'resume' }),
    admission(first.ticket, { ...operation, body: { ...body, expectedEpoch: 2 } }),
    admission(first.ticket, { ...operation, body: { ...body, idempotencyKey: 'another-key' } }),
    { ...valid, mode: 'read' as const },
    { ...readValid, ticket: first.ticket },
    { ...valid, ticket: second.ticket },
  ]) safeError(await check(payload), 403, 'AUTHORITY_FORBIDDEN');
  for (const descriptor of [valid, readValid, valid]) {
    const response = await check(JSON.stringify(descriptor).padEnd(4096));
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(AuthorityAdmissionResponseV1Schema.parse(response.json()).requestHash).toBe(descriptor.requestHash);
  }
  for (const headers of [jsonHeaders, { ...jsonHeaders, authorization: 'Bearer wrong' }]) {
    safeError(await check('{', headers), 401, 'AUTHORITY_UNAUTHORIZED');
    safeError(await check('x'.repeat(4097), headers), 401, 'AUTHORITY_UNAUTHORIZED');
  }
  for (const header of ['cookie', 'x-eapr-csrf', ticketHeader]) {
    safeError(await check(valid, { ...privateHeaders, [header]: '' }), 400, 'AUTHORITY_INPUT_INVALID');
  }
  for (const invalid of ['{', JSON.stringify(valid).padEnd(4097), JSON.stringify({ ...valid, extra: true })]) {
    safeError(await check(invalid), 400, 'AUTHORITY_INPUT_INVALID');
  }
  safeError(await check(valid, { ...privateHeaders, 'content-type': 'text/plain' }), 400, 'AUTHORITY_INPUT_INVALID');
  safeError(await check(valid, privateHeaders, callbackPath + '?x=1'), 400, 'AUTHORITY_INPUT_INVALID');
  const raw = await listen(app);
  const validJson = JSON.stringify(valid);
  safeError(await raw('POST', callbackPath + '?', privateHeaders, validJson).response, 400, 'AUTHORITY_INPUT_INVALID');
  safeError(await raw('POST', callbackPath, ['Authorization', 'Bearer ' + token, 'Authorization', 'Bearer wrong',
    'Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(validJson))], validJson).response,
    401, 'AUTHORITY_UNAUTHORIZED');
  safeError(await raw('POST', accountPath + '/pause', { ...mutationHeaders, [ticketHeader]: ['', 'also-private'] },
    JSON.stringify(body)).response, 400, 'AUTHORITY_INPUT_INVALID');
  first.finish();
  second.finish();
  const command = await firstResponse;
  expect(command.statusCode).toBe(200);
  expect(command.headers['cache-control']).toBe('no-store');
  const readResult = await secondResponse;
  expect(readResult.headers['cache-control']).toBe('no-store');
  expect(readResult.json()).toEqual(state);
});

test.each(['disconnect', 'deadline', 'shutdown'] as const)('ticket_cancellation_during_authorize_denies (%s)', async reason => {
  const entered = deferred();
  const release = deferred();
  let pause = false;
  let publicSocket: ReturnType<Awaited<ReturnType<typeof listen>>> | undefined;
  const { app, post, check, worker, mutationHeaders } = await fixture({ wrap: real => async (request, options) => {
    const grants = await real(request, options);
    if (pause) {
      entered.resolve();
      await release.promise;
    }
    return grants;
  } });
  cleanup.push(async () => { release.resolve(); });
  if (reason === 'deadline') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  if (reason !== 'deadline') {
    const raw = await listen(app);
    publicSocket = raw('POST', accountPath + '/pause', mutationHeaders, JSON.stringify(body));
  }
  const response = publicSocket?.response ?? post();
  const call = await forwarded(worker, 0, response);
  const binding = admission(call.ticket);
  pause = true;
  const pendingCheck = check(binding);
  try {
    await Promise.race([entered.promise, pendingCheck.then(() => { throw new Error('Callback did not reach live authorization'); })]);
    if (reason === 'disconnect') publicSocket!.destroy();
    if (reason === 'deadline') await vi.advanceTimersByTimeAsync(8000);
    const closing = reason === 'shutdown' ? app.close() : undefined;
    await aborted(call.signal);
    release.resolve();
    safeError(await pendingCheck, 403, 'AUTHORITY_FORBIDDEN');
    call.finish(authorityError('AUTHORITY_UNAVAILABLE'));
    await response;
    await closing;
    if (!closing) safeError(await check(binding), 403, 'AUTHORITY_FORBIDDEN');
  } finally {
    release.resolve();
  }
});

test('completed_request_body_is_not_disconnect', async () => {
  const { app, check, worker, mutationHeaders } = await fixture();
  const raw = await listen(app);
  const response = raw('POST', accountPath + '/pause', mutationHeaders, JSON.stringify(body)).response;
  const call = await forwarded(worker, 0, response);
  const admitted = await check(admission(call.ticket));
  expect(admitted.statusCode).toBe(200);
  expect(call.signal.aborted).toBe(false);
  call.finish();
  expect((await response).json()).toEqual(commandResult);
});

test('ticket_capacity_and_cleanup', async () => {
  const { app, post, check, worker, mutationHeaders } = await fixture();
  const raw = await listen(app);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const expiryResponse = post();
  const expiry = await forwarded(worker, 0, expiryResponse);
  await vi.advanceTimersByTimeAsync(1);
  const socket = raw('POST', accountPath + '/pause', mutationHeaders, JSON.stringify(body));
  const disconnect = await forwarded(worker, 1, socket.response);
  const held = Array.from({ length: 254 }, () => post());
  const full = await forwarded(worker, 255, Promise.race(held));
  safeError(await post(), 503, 'AUTHORITY_UNAVAILABLE');
  expect(worker.calls).toHaveLength(256);
  for (const [index, error] of [[2, undefined], [3, authorityError('AUTHORITY_STALE')]] as const) {
    const call = await worker.at(index);
    call.finish(error);
    const settled = await Promise.race(held.filter((_, i) => i >= index - 2));
    if (error) safeError(settled, 409, 'AUTHORITY_STALE');
    else expect(settled.statusCode).toBe(200);
    safeError(await check(admission(call.ticket)), 403, 'AUTHORITY_FORBIDDEN');
    await forwarded(worker, 254 + index, post());
    safeError(await post(), 503, 'AUTHORITY_UNAVAILABLE');
  }
  socket.destroy();
  await aborted(disconnect.signal);
  safeError(await check(admission(disconnect.ticket)), 403, 'AUTHORITY_FORBIDDEN');
  await forwarded(worker, 258, post());
  safeError(await post(), 503, 'AUTHORITY_UNAVAILABLE');
  await vi.advanceTimersByTimeAsync(7999);
  await aborted(expiry.signal);
  expect(full.signal.aborted).toBe(false);
  safeError(await check(admission(expiry.ticket)), 403, 'AUTHORITY_FORBIDDEN');
  expiry.finish(authorityError('AUTHORITY_UNAVAILABLE'));
  safeError(await expiryResponse, 503, 'AUTHORITY_UNAVAILABLE');
  await forwarded(worker, 259, post());
  safeError(await post(), 503, 'AUTHORITY_UNAVAILABLE');
});

test('malformed_authority_url_authenticates_first', async () => {
  const { app, worker, readHeaders, mutationHeaders } = await fixture();
  const raw = await listen(app);
  for (const account of ['%ZZ', 'a'.repeat(161)]) {
    for (const [method, action] of [['GET', 'authority'], ['POST', 'pause'], ['POST', 'resume'], ['POST', 'revoke']] as const) {
      const url = '/api/connections/' + account + '/' + action;
      safeError(await app.inject({ method, url }), 401, 'LOCAL_SESSION_REQUIRED');
      const headers = method === 'GET' ? readHeaders : mutationHeaders;
      if (method === 'POST') safeError(await app.inject({ method, url, headers: { ...headers, 'x-eapr-csrf': 'bad' } }),
        403, 'LOCAL_SESSION_FORBIDDEN');
      safeError(await app.inject({ method, url, headers }), 400, 'AUTHORITY_INPUT_INVALID');
      safeError(await app.inject({ method, url, headers: { ...headers, [ticketHeader]: '' } }), 400, 'AUTHORITY_INPUT_INVALID');
    }
  }
  for (const url of [
    '/api/connections/%ZZ/%70ause?', '/%61pi/connections/%ZZ/%70ause#raw',
    '/api/connections/' + 'a'.repeat(161) + '/%70ause#raw', 'http://127.0.0.1/api/connections/%ZZ/%70ause?',
  ]) {
    safeError(await raw('POST', url, {}).response, 401, 'LOCAL_SESSION_REQUIRED');
    safeError(await raw('POST', url, mutationHeaders).response, 400, 'AUTHORITY_INPUT_INVALID');
  }
  for (const url of ['/api/connections/%ZZ/other', '/api/connections/%ZZ/authority/extra', '/api/other/%ZZ']) {
    const unrelated = await app.inject({ method: 'GET', url });
    expect(unrelated.json()).toMatchObject({ code: 'FST_ERR_BAD_URL' });
  }
  const unmounted = await fixture({ mount: false });
  expect((await unmounted.app.inject({ method: 'GET', url: '/api/connections/%ZZ/authority' })).json())
    .toMatchObject({ code: 'FST_ERR_BAD_URL' });
  const missingHook = await fixture({ hook: false });
  safeError(await missingHook.app.inject({ method: 'GET', url: '/api/connections/%ZZ/authority' }), 503, 'AUTHORITY_UNAVAILABLE');
  expect(worker.calls).toHaveLength(0);
});

test.each(['no-worker', 'bad-token'] as const)('missing wiring fails closed after public authorization (%s)', async wiring => {
  const { app, post, check, worker } = await fixture({ wiring });
  safeError(await app.inject({ method: 'GET', url: accountPath + '/authority' }), 401, 'LOCAL_SESSION_REQUIRED');
  safeError(await post(), 503, 'AUTHORITY_UNAVAILABLE');
  safeError(await check(admission('a'.repeat(64))), 503, 'AUTHORITY_UNAVAILABLE');
  expect(worker.calls).toHaveLength(0);
});
