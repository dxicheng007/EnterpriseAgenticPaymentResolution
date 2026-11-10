import { afterEach, expect, test, vi } from 'vitest';
import { createAuthorityAdmissionClient } from '../src/authority-admission-client.js';
import { AuthorityError } from '../src/sync/current-authority-errors.js';

const baseUrl = 'http://127.0.0.1:3511';
const token = 'admission-token';
const check = { ticket: 'a'.repeat(64), requestHash: 'b'.repeat(64), mode: 'mutation' } as const;
const grants = {
  reviewer: { reviewerId: 'reviewer', sessionId: 'session' },
  allowedAccountIds: ['a.account'], allowedSourceRefs: ['source-a'],
};
const response = { requestHash: check.requestHash, grants };
const unavailable = { code: 'AUTHORITY_UNAVAILABLE', statusCode: 503 };
const errorEnvelope = (code: string) => ({ code, message: 'upstream details', correlationId: 'upstream', diagnostics: [] });
const client = () => createAuthorityAdmissionClient({ baseUrl, token });

function fetchReturns(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('sends a fresh check to the fixed private callback with only its service bearer', async () => {
  const fetch = fetchReturns(Response.json(response));
  const admission = client();
  await expect(admission.check(check)).resolves.toEqual(response);
  const read = { ...check, mode: 'read' } as const;
  fetch.mockResolvedValueOnce(Response.json(response));
  await expect(admission.check(read)).resolves.toEqual(response);
  for (const [index, input] of [check, read].entries()) {
    const [url, request] = fetch.mock.calls[index]!;
    expect(String(url)).toBe(baseUrl + '/internal/authority-admissions/check');
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', body: JSON.stringify(input) });
    expect(new Headers(request?.headers)).toEqual(new Headers({
      authorization: 'Bearer admission-token', 'content-type': 'application/json',
    }));
  }
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('rejects_substituted_callback_hash and malformed grants', async () => {
  const fetch = fetchReturns(Response.json({ ...response, requestHash: 'c'.repeat(64) }));
  const admission = client();
  await expect(admission.check(check)).rejects.toMatchObject(unavailable);
  fetch.mockResolvedValueOnce(Response.json({ ...response, grants: { ...grants, reviewer: { reviewerId: 'reviewer' } } }));
  await expect(admission.check(check)).rejects.toMatchObject(unavailable);
});

test('only_accepts_matching_error_status_code', async () => {
  const fetch = fetchReturns(Response.json(errorEnvelope('AUTHORITY_UNAUTHORIZED'), { status: 401 }));
  const admission = client();
  const failure = await admission.check(check).catch(error => error);
  expect(failure).toBeInstanceOf(AuthorityError);
  expect(failure).toMatchObject({ code: 'AUTHORITY_UNAUTHORIZED', statusCode: 401, message: 'Authority admission is required' });
  expect(failure).not.toHaveProperty('correlationId');
  fetch.mockResolvedValueOnce(Response.json(errorEnvelope('AUTHORITY_FORBIDDEN'), { status: 403 }));
  await expect(admission.check(check)).rejects.toMatchObject({ code: 'AUTHORITY_FORBIDDEN', statusCode: 403 });
  for (const invalid of [
    Response.json(errorEnvelope('AUTHORITY_UNAUTHORIZED'), { status: 403 }),
    Response.json(errorEnvelope('AUTHORITY_FORBIDDEN'), { status: 401 }),
    Response.json(errorEnvelope('AUTHORITY_FORBIDDEN')),
    Response.json(errorEnvelope('UNKNOWN'), { status: 403 }),
    Response.json({ ...errorEnvelope('AUTHORITY_FORBIDDEN'), extra: true }, { status: 403 }),
    Response.json(response, { status: 201 }),
  ]) {
    fetch.mockResolvedValueOnce(invalid);
    await expect(admission.check(check)).rejects.toMatchObject(unavailable);
  }
});

test('bounds_and_cancels_transport on callback stream overflow', async () => {
  const limit = 256 * 1024;
  const encode = (text: string) => new TextEncoder().encode(text);
  const fetch = fetchReturns(new Response(encode(JSON.stringify(response).padEnd(limit, ' '))));
  const admission = client();
  await expect(admission.check(check)).resolves.toEqual(response);

  const cancel = vi.fn();
  fetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(JSON.stringify(response).padEnd(limit / 2, ' ')));
      controller.enqueue(encode(' '.repeat(limit / 2 + 1)));
      controller.enqueue(encode(' '));
      controller.close();
    },
    cancel,
  })));
  await expect(admission.check(check)).rejects.toMatchObject(unavailable);
  expect(cancel).toHaveBeenCalledOnce();
});

test('bounds_and_cancels_transport on callback timeout during body read', async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  const reading = Promise.withResolvers<void>();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetch = fetchReturns(new Response(new ReadableStream<Uint8Array>({
    start(controller) { stream = controller; },
    pull() { reading.resolve(); },
    cancel,
  }, { highWaterMark: 0 })));
  const result = client().check(check).catch(error => error);
  await reading.promise;
  deadline.abort();
  if (cancel.mock.calls.length === 0) stream.close();
  expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  expect(timeout).toHaveBeenCalledExactlyOnceWith(2000);
  expect(cancel).toHaveBeenCalledOnce();
  expect(await Promise.race([result, new Promise(resolve => setImmediate(() => resolve('stalled')))]))
    .toMatchObject(unavailable);
});

test('rejects absent bodies, invalid UTF-8 and JSON, and redirects', async () => {
  const fetch = fetchReturns(new Response());
  const admission = client();
  await expect(admission.check(check)).rejects.toMatchObject(unavailable);
  const malformedUtf8 = Buffer.concat([
    Buffer.from('{"message":"'), Buffer.from([0xc3, 0x28]),
    Buffer.from('","code":"AUTHORITY_UNAUTHORIZED","correlationId":"upstream","diagnostics":[]}'),
  ]);
  for (const invalid of [
    new Response(malformedUtf8, { status: 401 }),
    new Response('{invalid'),
    Response.redirect(baseUrl + '/elsewhere', 307),
  ]) {
    fetch.mockResolvedValueOnce(invalid);
    await expect(admission.check(check)).rejects.toMatchObject(unavailable);
  }
});

test('rejects noncanonical origins and invalid bearer configuration', () => {
  for (const origin of ['https://127.0.0.1:3511', 'http://localhost:3511', 'http://127.0.0.2:3511',
    'http://user@127.0.0.1:3511', baseUrl + '/', baseUrl + '/api', baseUrl + '?x', baseUrl + '#x']) {
    expect(() => createAuthorityAdmissionClient({ baseUrl: origin, token })).toThrow();
  }
  for (const value of ['', 'a b', 'a\nb', 'a'.repeat(1025)]) {
    expect(() => createAuthorityAdmissionClient({ baseUrl, token: value })).toThrow();
  }
});
