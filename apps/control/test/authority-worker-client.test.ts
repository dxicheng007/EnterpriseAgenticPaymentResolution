import { afterEach, expect, test, vi } from 'vitest';
import { createAuthorityWorkerClient } from '../src/authority-worker-client.js';
import { AuthorityError } from '../../worker/src/sync/current-authority-errors.js';

const baseUrl = 'http://127.0.0.1:3512';
const serviceToken = 'worker-token';
const ticket = 'a'.repeat(64);
const accountId = 'a:account';
const body = { expectedEpoch: 1, idempotencyKey: 'key-1' };
const identity = {
  scope: { companyId: 'company', sellerEntityId: 'seller', accountId },
  activationId: 'activation', bundleHash: 'b'.repeat(64),
};
const changedAt = '2026-11-10T08:00:00.000Z';
const state = {
  schemaVersion: '1', identity, sourceRef: 'source', artifactHash: 'c'.repeat(64),
  profileHash: 'd'.repeat(64), manifestHash: 'e'.repeat(64), status: 'paused', epoch: 2, changedAt,
};
const result = {
  schemaVersion: '1', identity, idempotencyKey: body.idempotencyKey, action: 'pause',
  beforeStatus: 'active', beforeEpoch: 1, state, changed: true, committedAt: changedAt,
};
const success = { result, replayed: true };
const unavailable = { code: 'AUTHORITY_UNAVAILABLE', statusCode: 503 };
const errorEnvelope = (code: string) => ({ code, message: 'upstream details', correlationId: 'upstream', diagnostics: [] });
const client = () => createAuthorityWorkerClient(baseUrl, serviceToken);

function fetchReturns(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('sends only the fixed worker request for a read and each command', async () => {
  const fetch = fetchReturns(Response.json(state));
  await expect(client().read(accountId, ticket)).resolves.toEqual(state);
  expect(String(fetch.mock.calls[0]![0])).toBe(baseUrl + '/internal/connections/a%3Aaccount/authority');
  expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'GET', redirect: 'error' });
  expect(new Headers(fetch.mock.calls[0]![1]?.headers)).toEqual(new Headers({
    authorization: 'Bearer worker-token', 'x-eapr-authority-admission': ticket,
  }));
  expect(fetch.mock.calls[0]![1]?.body).toBeUndefined();

  for (const [action, status] of [['pause', 'paused'], ['resume', 'active'], ['revoke', 'revoked']] as const) {
    const value = { ...success, result: { ...result, action, beforeStatus: 'paused',
      state: { ...state, status, epoch: action === 'pause' ? 1 : 2 }, changed: action !== 'pause' } };
    fetch.mockResolvedValueOnce(Response.json(value));
    await expect(client().command(accountId, action, body, ticket)).resolves.toEqual(value);
    const [url, request] = fetch.mock.lastCall!;
    expect(String(url)).toBe(baseUrl + '/internal/connections/a%3Aaccount/' + action);
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', body: JSON.stringify(body) });
    expect(new Headers(request?.headers)).toEqual(new Headers({
      authorization: 'Bearer worker-token', 'x-eapr-authority-admission': ticket, 'content-type': 'application/json',
    }));
  }
  expect(fetch).toHaveBeenCalledTimes(4);
});

test('rejects_substituted_or_inconsistent_worker_result', async () => {
  const otherIdentity = { ...identity, scope: { ...identity.scope, accountId: 'b.account' } };
  const fetch = fetchReturns(Response.json({ ...state, identity: otherIdentity }));
  const worker = client();
  await expect(worker.read(accountId, ticket)).rejects.toMatchObject(unavailable);
  for (const replacement of [
    { ...result, identity: otherIdentity, state: { ...state, identity: otherIdentity } },
    { ...result, action: 'resume', beforeStatus: 'paused', state: { ...state, status: 'active' } },
    { ...result, idempotencyKey: 'key-2' },
    { ...result, beforeEpoch: 2, state: { ...state, epoch: 3 } },
    { ...result, state: { ...state, identity: { ...identity, bundleHash: 'f'.repeat(64) } } },
    { ...result, state: { ...state, epoch: 3 } },
  ]) {
    fetch.mockResolvedValueOnce(Response.json({ ...success, result: replacement }));
    await expect(worker.command(accountId, 'pause', body, ticket)).rejects.toMatchObject(unavailable);
  }
  expect(fetch).toHaveBeenCalledTimes(7);
});

test('only_accepts_matching_error_status_code', async () => {
  const fetch = fetchReturns(Response.json(errorEnvelope('AUTHORITY_STALE'), { status: 409 }));
  const worker = client();
  const failure = await worker.command(accountId, 'pause', body, ticket).catch(error => error);
  expect(failure).toBeInstanceOf(AuthorityError);
  expect(failure).toMatchObject({ code: 'AUTHORITY_STALE', statusCode: 409, message: 'Authority epoch has changed' });
  expect(failure).not.toHaveProperty('correlationId');
  for (const response of [
    Response.json(errorEnvelope('AUTHORITY_STALE'), { status: 403 }),
    Response.json(errorEnvelope('AUTHORITY_FORBIDDEN'), { status: 409 }),
    Response.json(errorEnvelope('AUTHORITY_STALE')),
    Response.json(errorEnvelope('UNKNOWN'), { status: 409 }),
    Response.json({ ...errorEnvelope('AUTHORITY_STALE'), extra: true }, { status: 409 }),
    Response.json(state, { status: 201 }),
  ]) {
    fetch.mockResolvedValueOnce(response);
    await expect(worker.read(accountId, ticket)).rejects.toMatchObject(unavailable);
  }
});

test('bounds_and_cancels_transport on stream overflow', async () => {
  const limit = 256 * 1024;
  const encode = (text: string) => new TextEncoder().encode(text);
  const fetch = fetchReturns(new Response(encode(JSON.stringify(state).padEnd(limit, ' '))));
  const worker = client();
  await expect(worker.read(accountId, ticket)).resolves.toEqual(state);

  const cancel = vi.fn();
  fetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(JSON.stringify(state).padEnd(limit / 2, ' ')));
      controller.enqueue(encode(' '.repeat(limit / 2 + 1)));
      controller.enqueue(encode(' '));
      controller.close();
    },
    cancel,
  })));
  await expect(worker.read(accountId, ticket)).rejects.toMatchObject(unavailable);
  expect(cancel).toHaveBeenCalledOnce();
});

test('bounds_and_cancels_transport on caller abort during body read', async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  const caller = new AbortController();
  const reading = Promise.withResolvers<void>();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetch = fetchReturns(new Response(new ReadableStream<Uint8Array>({
    start(controller) { stream = controller; },
    pull() { reading.resolve(); },
    cancel,
  }, { highWaterMark: 0 })));
  const result = client().read(accountId, ticket, caller.signal).catch(error => error);
  await reading.promise;
  caller.abort();
  if (cancel.mock.calls.length === 0) stream.close();
  expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  expect(timeout).toHaveBeenCalledExactlyOnceWith(8000);
  expect(cancel).toHaveBeenCalledOnce();
  expect(await Promise.race([result, new Promise(resolve => setImmediate(() => resolve('stalled')))]))
    .toMatchObject(unavailable);
});

test('bounds_and_cancels_transport on timeout before fetch resolves', async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  const pending = Promise.withResolvers<Response>();
  const fetch = vi.fn<typeof globalThis.fetch>((_, request) => {
    request?.signal?.addEventListener('abort', () => pending.reject(request.signal?.reason), { once: true });
    return pending.promise;
  });
  vi.stubGlobal('fetch', fetch);
  const result = client().read(accountId, ticket).catch(error => error);
  deadline.abort();
  expect(timeout).toHaveBeenCalledExactlyOnceWith(8000);
  expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  await expect(result).resolves.toMatchObject(unavailable);
});

test('rejects absent bodies, invalid UTF-8 and JSON, and redirects', async () => {
  const fetch = fetchReturns(new Response());
  const worker = client();
  await expect(worker.read(accountId, ticket)).rejects.toMatchObject(unavailable);
  const malformedUtf8 = Buffer.concat([
    Buffer.from('{"message":"'), Buffer.from([0xc3, 0x28]),
    Buffer.from('","code":"AUTHORITY_STALE","correlationId":"upstream","diagnostics":[]}'),
  ]);
  for (const response of [
    new Response(malformedUtf8, { status: 409 }),
    new Response('{invalid'),
    Response.redirect(baseUrl + '/elsewhere', 307),
  ]) {
    fetch.mockResolvedValueOnce(response);
    await expect(worker.read(accountId, ticket)).rejects.toMatchObject(unavailable);
  }
});

test('rejects noncanonical origins and invalid bearer configuration', () => {
  for (const origin of ['https://127.0.0.1:3512', 'http://localhost:3512', 'http://127.0.0.2:3512',
    'http://user@127.0.0.1:3512', baseUrl + '/', baseUrl + '/api', baseUrl + '?x', baseUrl + '#x']) {
    expect(() => createAuthorityWorkerClient(origin, serviceToken)).toThrow();
  }
  for (const token of ['', 'a b', 'a\nb', 'a'.repeat(1025)]) {
    expect(() => createAuthorityWorkerClient(baseUrl, token)).toThrow();
  }
});
