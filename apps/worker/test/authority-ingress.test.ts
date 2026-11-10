import { request as httpRequest, type OutgoingHttpHeaders } from 'node:http';
import {
  ApiErrorSchema, hashCanonical, type AuthorityAdmissionCheckV1, type AuthorityOperationV1,
  type AuthorityStatusResponseV1, type CurrentAuthorityV1,
} from '@eapr/contracts';
import * as activationStore from '@eapr/parent/activation-store';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { afterEach, expect, test, vi } from 'vitest';
import type { AuthorityAdmissionClient } from '../src/authority-admission-client.js';
import { composeWorkerAuthority } from '../src/authority-composition.js';
import * as ingressIdentity from '../src/authority-identity.js';
import { createWorkerAuthorityPlugin } from '../src/routes/authority.js';
import { buildWorker } from '../src/server.js';
import * as authority from '../src/sync/current-authority.js';
import { authorityError } from '../src/sync/current-authority-errors.js';

const serviceToken = 'worker-service';
const ticket = 'a'.repeat(64);
const ticketHeader = 'x-eapr-authority-admission';
const auth = { authorization: 'Bearer ' + serviceToken, [ticketHeader]: ticket };
const json = { ...auth, 'content-type': 'application/json' };
const prefix = '/internal/connections/';
const accountId = 'company:seller:account';
const accountPath = prefix + encodeURIComponent(accountId) + '/';
const body = { expectedEpoch: 1, idempotencyKey: 'pause-1' };
const subject = {
  identity: {
    scope: { companyId: 'company', sellerEntityId: 'seller', accountId },
    activationId: 'activation', bundleHash: 'b'.repeat(64),
  },
  sourceRef: 'source', artifactHash: 'c'.repeat(64), profileHash: 'd'.repeat(64), manifestHash: 'e'.repeat(64),
};
const grants = {
  reviewer: { reviewerId: 'reviewer', sessionId: 'session' }, allowedAccountIds: [accountId], allowedSourceRefs: [subject.sourceRef],
};
const clock = () => new Date('2026-11-10T08:00:00.000Z');
const state: CurrentAuthorityV1 = {
  ...subject, schemaVersion: '1', status: 'active', epoch: 1, changedAt: clock().toISOString(),
};
const paused: AuthorityStatusResponseV1 = {
  result: {
    schemaVersion: '1', identity: subject.identity, action: 'pause', idempotencyKey: body.idempotencyKey,
    beforeStatus: 'active', beforeEpoch: 1, changed: true, committedAt: state.changedAt,
    state: { ...state, status: 'paused', epoch: 2 },
  },
  replayed: false,
};
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

function build(options?: { missingAdmissions?: boolean; mounted?: boolean }) {
  const connect = vi.fn<() => Promise<PoolClient>>().mockRejectedValue(new Error('unexpected runtime checkout'));
  const db = { connect } as unknown as Pool;
  const check = vi.fn<AuthorityAdmissionClient['check']>(async ({ requestHash }) => ({ requestHash, grants }));
  const observe = vi.fn(async () => { throw new Error('unexpected source read'); });
  const app = buildWorker({
    db, clock, serviceToken, expectedMigrations: [],
    featurePlugins: options?.mounted === false ? [] : [createWorkerAuthorityPlugin({
      db, clock, serviceToken, observe, admissions: options?.missingAdmissions ? undefined : { check },
    })],
  });
  cleanup.push(() => app.close());
  return { app, connect, check, observe, db };
}

type Response = { statusCode: number; headers: { 'cache-control'?: unknown }; json(): unknown };
function safeError(response: Response, status: number, code: Parameters<typeof authorityError>[0]) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['cache-control']).toBe('no-store');
  const safe = ApiErrorSchema.parse(response.json());
  expect(safe).toEqual({
    code, message: authorityError(code).message,
    diagnostics: [], correlationId: expect.any(String),
  });
}

async function rawClient(app: FastifyInstance) {
  const received: { url: string | undefined; headers: string[] }[] = [];
  app.server.prependListener('request', request => received.push({ url: request.url, headers: request.rawHeaders }));
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Worker did not listen on loopback');
  return async function raw(method: string, path: string, headers: OutgoingHttpHeaders | readonly string[]): Promise<Response> {
    const response = await new Promise<Response>((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1', port: address.port, method, path, agent: false,
        headers: Array.isArray(headers) ? ['Host', '127.0.0.1:' + address.port, ...headers] : headers,
      }, incoming => {
        let text = '';
        incoming.setEncoding('utf8').on('data', part => { text += part; });
        incoming.on('error', reject);
        incoming.on('end', () => resolve({ statusCode: incoming.statusCode!, headers: incoming.headers, json: () => JSON.parse(text) }));
      });
      outgoing.on('error', reject).end();
    });
    const actual = received.at(-1);
    expect(actual?.url).toBe(path);
    if (Array.isArray(headers)) expect(actual?.headers.slice(2, 2 + headers.length)).toEqual(headers);
    return response;
  };
}

test('service_auth_precedes_parser_and_identity_read', async () => {
  const { app, connect, check } = build();
  for (const headers of [{ 'content-type': 'application/json' }, { ...json, authorization: 'Bearer wrong' }]) {
    const result = await app.inject({ method: 'POST', url: accountPath + 'pause', headers, payload: '{' });
    safeError(result, 401, 'AUTHORITY_UNAUTHORIZED');
  }
  safeError(await app.inject({ method: 'POST', url: accountPath + 'pause', headers: json, payload: '{' }),
    400, 'AUTHORITY_INPUT_INVALID');
  expect(check).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

test('worker_private_shape_is_closed', async () => {
  const { app, connect, check } = build();
  for (const headers of [
    { authorization: auth.authorization },
    { ...auth, [ticketHeader]: 'A'.repeat(64) },
    { ...auth, [ticketHeader]: [ticket, ticket] },
    { ...auth, cookie: 'session=browser' },
    { ...auth, 'x-eapr-csrf': 'browser' },
    { ...auth, 'x-eapr-reviewer-id': 'forged' },
    { ...auth, 'x-reviewer-id': 'forged' },
    { ...auth, 'transfer-encoding': 'chunked' },
  ] satisfies OutgoingHttpHeaders[]) {
    safeError(await app.inject({ url: accountPath + 'authority', headers }), 400, 'AUTHORITY_INPUT_INVALID');
  }
  const raw = await rawClient(app);
  for (const duplicate of [auth.authorization, 'Bearer wrong']) {
    safeError(await raw('GET', accountPath + 'authority', [
      'authorization', auth.authorization, 'Authorization', duplicate, ticketHeader, ticket,
    ]), 401, 'AUTHORITY_UNAUTHORIZED');
  }
  safeError(await raw('GET', accountPath + 'authority', [
    'authorization', auth.authorization, ticketHeader, ticket, ticketHeader, ticket,
  ]), 400, 'AUTHORITY_INPUT_INVALID');
  for (const url of [accountPath + 'authority?extra=yes', prefix + 'bad%2Fid/authority']) {
    safeError(await app.inject({ url, headers: auth }), 400, 'AUTHORITY_INPUT_INVALID');
  }
  safeError(await app.inject({ url: accountPath + 'authority', headers: auth, payload: 'body' }), 400, 'AUTHORITY_INPUT_INVALID');
  expect((await app.inject({ method: 'HEAD', url: accountPath + 'authority', headers: auth })).statusCode).toBe(404);
  for (const payload of [
    JSON.stringify({ ...body, actor: grants.reviewer }),
    JSON.stringify({ ...body, action: 'pause' }),
    '{"expectedEpoch":1,"idempotencyKey":"pause-1","__proto__":{}}',
    JSON.stringify(body).padEnd(4097, ' '),
  ]) {
    safeError(await app.inject({ method: 'POST', url: accountPath + 'pause', headers: json, payload }), 400, 'AUTHORITY_INPUT_INVALID');
  }
  safeError(await app.inject({ method: 'POST', url: accountPath + 'pause',
    headers: { ...json, 'content-type': 'text/plain' }, payload: JSON.stringify(body) }), 400, 'AUTHORITY_INPUT_INVALID');
  expect(check).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

test('framework route failures authenticate before diagnostics', async () => {
  const { app, connect, check } = build();
  const raw = await rawClient(app);
  for (const [method, action] of [
    ['GET', 'authority'], ['POST', 'pause'], ['POST', 'resume'], ['POST', 'revoke'],
  ] as const) {
    const encodedAction = '%' + action.charCodeAt(0).toString(16) + action.slice(1);
    for (const [headers, status, code] of [
      [{}, 401, 'AUTHORITY_UNAUTHORIZED'],
      [{ ...auth, authorization: 'Bearer wrong' }, 401, 'AUTHORITY_UNAUTHORIZED'],
      [auth, 400, 'AUTHORITY_INPUT_INVALID'],
    ] as const) {
      for (const path of [prefix + '%ZZ/' + encodedAction + '#raw?query',
        prefix + 'a'.repeat(161) + '/' + action + '?', accountPath + action + '?', accountPath + action + '#raw']) {
        safeError(await raw(method, path, headers), status, code);
      }
      for (const url of [prefix + '%ZZ/' + action, prefix + 'a'.repeat(161) + '/' + action,
        '/%69nternal/%63onnections/%ZZ/' + encodedAction]) {
        safeError(await app.inject({ method, url, headers }), status, code);
      }
    }
  }
  const neighboring = await app.inject({ url: prefix + '%ZZ/other', headers: auth });
  expect(neighboring.json()).toMatchObject({ code: 'FST_ERR_BAD_URL' });
  const unmounted = build({ mounted: false }).app;
  expect((await unmounted.inject({ url: prefix + '%ZZ/authority', headers: auth })).json()).toMatchObject({ code: 'FST_ERR_BAD_URL' });
  expect(check).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

test('unbound_request_context_cannot_authorize', async () => {
  const { app, check } = build();
  vi.spyOn(ingressIdentity, 'readIngressAuthorityIdentity').mockResolvedValue(subject);
  let live!: FastifyRequest;
  let admission!: authority.TrustedAuthorityAdmission<FastifyRequest>;
  vi.spyOn(authority, 'createCurrentAuthority').mockImplementation(
    ({ admission: injected }) => ({
      async read(request) {
        live = request as FastifyRequest;
        admission = injected as authority.TrustedAuthorityAdmission<FastifyRequest>;
        await expect(admission.authorize({ ...live }, 'read')).rejects.toMatchObject({ code: 'AUTHORITY_FORBIDDEN' });
        await expect(admission.authorize(live, 'mutation')).rejects.toMatchObject({ code: 'AUTHORITY_FORBIDDEN' });
        await expect(admission.authorize(live, 'read')).resolves.toEqual(grants);
        return state;
      },
      async command() { throw new Error('unexpected command'); },
    }),
  );
  expect((await app.inject({ url: accountPath + 'authority', headers: auth })).statusCode).toBe(200);
  await expect(admission.authorize(live, 'read')).rejects.toMatchObject({ code: 'AUTHORITY_FORBIDDEN' });
  expect(check).toHaveBeenCalledTimes(2);
});

test('every_service_admission_calls_control', async () => {
  const { app, check, db, observe } = build();
  const lookup = vi.spyOn(ingressIdentity, 'readIngressAuthorityIdentity').mockResolvedValue(subject);
  const run = vi.fn();
  vi.spyOn(authority, 'createCurrentAuthority').mockImplementation(
    ({ admission }) => ({
      async read(request, identity) {
        run(identity);
        await admission.authorize(request, 'read');
        return state;
      },
      async command(request, command) {
        run(command);
        await admission.authorize(request, 'mutation');
        await admission.authorize(request, 'mutation');
        return paused;
      },
    }),
  );
  const read: AuthorityOperationV1 = { schemaVersion: '1', accountId, action: 'read', body: null };
  const operation: AuthorityOperationV1 = { schemaVersion: '1', accountId, action: 'pause', body };
  expect((await app.inject({ url: accountPath + 'authority', headers: auth })).json()).toEqual(state);
  expect((await app.inject({ method: 'POST', url: accountPath + 'pause', headers: json, payload: body })).json()).toEqual(paused);
  expect(check.mock.calls.map(([input]) => input)).toEqual([
    ...Array.from({ length: 2 }, () => ({ ticket, requestHash: hashCanonical(read), mode: 'read' as const })),
    ...Array.from({ length: 3 }, () => ({ ticket, requestHash: hashCanonical(operation), mode: 'mutation' as const })),
  ] satisfies AuthorityAdmissionCheckV1[]);
  expect(check.mock.invocationCallOrder[0]).toBeLessThan(lookup.mock.invocationCallOrder[0]!);
  expect(lookup.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]!);
  expect(lookup).toHaveBeenNthCalledWith(1, db, accountId);
  expect(run.mock.calls).toEqual([[subject.identity], [{ schemaVersion: '1', identity: subject.identity, action: 'pause', ...body }]]);
  expect(observe).not.toHaveBeenCalled();
});

test('requires the admitted account before lookup and stored source before service', async () => {
  const { app, check } = build();
  const lookup = vi.spyOn(ingressIdentity, 'readIngressAuthorityIdentity').mockResolvedValue(subject);
  const read = vi.fn().mockResolvedValue(state);
  vi.spyOn(authority, 'createCurrentAuthority').mockReturnValue({ read, command: vi.fn() });
  check.mockImplementationOnce(async ({ requestHash }) => ({ requestHash, grants: { ...grants, allowedAccountIds: [] } }));
  safeError(await app.inject({ url: accountPath + 'authority', headers: auth }), 403, 'AUTHORITY_FORBIDDEN');
  expect(lookup).not.toHaveBeenCalled();
  check.mockImplementationOnce(async ({ requestHash }) => ({ requestHash, grants: { ...grants, allowedSourceRefs: [] } }));
  safeError(await app.inject({ url: accountPath + 'authority', headers: auth }), 403, 'AUTHORITY_FORBIDDEN');
  expect(lookup).toHaveBeenCalledOnce();
  expect(read).not.toHaveBeenCalled();
});

test('worker_validates_full_returned_identity', async () => {
  const { app } = build();
  vi.spyOn(ingressIdentity, 'readIngressAuthorityIdentity').mockResolvedValue(subject);
  const read = vi.fn();
  const command = vi.fn();
  vi.spyOn(authority, 'createCurrentAuthority').mockReturnValue({ read, command });
  const { identity } = state;
  const substituted: CurrentAuthorityV1[] = [
    ...(['accountId', 'companyId', 'sellerEntityId'] as const).map(field => ({
      ...state, identity: { ...identity, scope: { ...identity.scope, [field]: 'substituted' } },
    })),
    { ...state, identity: { ...identity, activationId: 'substituted' } },
    { ...state, identity: { ...identity, bundleHash: '9'.repeat(64) } },
    { ...state, sourceRef: 'substituted' },
    ...(['artifactHash', 'profileHash', 'manifestHash'] as const).map(field => ({ ...state, [field]: '9'.repeat(64) })),
  ];
  for (const changed of substituted) {
    read.mockResolvedValueOnce(changed);
    command.mockResolvedValueOnce({ ...paused, result: { ...paused.result, identity: changed.identity,
      state: { ...changed, status: 'paused', epoch: 2 } } });
    safeError(await app.inject({ url: accountPath + 'authority', headers: auth }), 503, 'AUTHORITY_UNAVAILABLE');
    safeError(await app.inject({ method: 'POST', url: accountPath + 'pause', headers: json, payload: body }),
      503, 'AUTHORITY_UNAVAILABLE');
  }
  read.mockResolvedValueOnce({ ...state, proof: 'substituted' });
  safeError(await app.inject({ url: accountPath + 'authority', headers: auth }), 503, 'AUTHORITY_UNAVAILABLE');
});

test('missing admission wiring fails after bearer authentication', async () => {
  const { app, connect } = build({ missingAdmissions: true });
  safeError(await app.inject({ url: accountPath + 'authority' }), 401, 'AUTHORITY_UNAUTHORIZED');
  safeError(await app.inject({ url: accountPath + 'authority', headers: auth }), 503, 'AUTHORITY_UNAVAILABLE');
  expect(connect).not.toHaveBeenCalled();
});

test('worker authority composition requires distinct capabilities and defers missing source failure', async () => {
  const { db } = build();
  const unavailable = composeWorkerAuthority({
    admissionOrigin: 'http://127.0.0.1:3351', admissionToken: serviceToken,
  });
  const conflicted = buildWorker({ db, serviceToken, clock, expectedMigrations: [], featurePlugins: [unavailable] });
  cleanup.push(() => conflicted.close());
  await expect((async () => { await conflicted.ready(); })()).rejects.toThrow(/distinct/);
  const factory = vi.spyOn(authority, 'createCurrentAuthority').mockReturnValue({ read: vi.fn(), command: vi.fn() });
  const configured = buildWorker({ db, serviceToken, clock, expectedMigrations: [], featurePlugins: [composeWorkerAuthority({})] });
  cleanup.push(() => configured.close());
  await configured.ready();
  const options = factory.mock.calls[0]?.[0];
  expect(options).toBeDefined();
  await expect(options?.observe(subject.sourceRef)).rejects.toMatchObject({ code: 'AUTHORITY_SEMANTICS_UNAVAILABLE' });
});

test('immutable lookup uses one read-only snapshot, releases it, and preserves error distinctions', async () => {
  const row = { account_id: accountId, company_id: 'company', seller_entity_id: 'seller' };
  const query = vi.fn().mockResolvedValue({ rows: [row] });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn().mockResolvedValue(client);
  const db = { connect } as unknown as Pool;
  const stored = vi.spyOn(activationStore, 'readStoredActivation').mockResolvedValue({
    activation: { ...subject, scope: subject.identity.scope, id: subject.identity.activationId },
    bundle: { manifest: { sourceRef: subject.sourceRef } }, bundleHash: subject.identity.bundleHash,
  } as unknown as activationStore.StoredActivation);
  const lookup = () => ingressIdentity.readIngressAuthorityIdentity(db, accountId);
  await expect(lookup()).resolves.toEqual(subject);
  expect(query.mock.calls).toEqual([
    ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'],
    ['SELECT account_id,company_id,seller_entity_id FROM runtime_activation_imports WHERE account_id=$1 LIMIT 2', [accountId]],
    ['COMMIT'],
  ]);
  expect(stored).toHaveBeenCalledExactlyOnceWith(client, subject.identity.scope);
  expect(release).toHaveBeenCalledExactlyOnceWith(false);

  for (const [rows, code] of [[[], 'AUTHORITY_NOT_FOUND'], [[row, row], 'AUTHORITY_STORAGE_INVALID'],
    [[{ ...row, seller_entity_id: '' }], 'AUTHORITY_STORAGE_INVALID']] as const) {
    stored.mockClear();
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows });
    await expect(lookup()).rejects.toMatchObject({ code });
    expect(stored).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  }
  stored.mockResolvedValueOnce(null);
  await expect(lookup()).rejects.toMatchObject({ code: 'AUTHORITY_STORAGE_INVALID' });
  stored.mockRejectedValueOnce(new Error('Inconsistent first import stored indexes'));
  await expect(lookup()).rejects.toMatchObject({ code: 'AUTHORITY_STORAGE_INVALID' });
  stored.mockRejectedValueOnce(new Error('connection lost'));
  await expect(lookup()).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' });
  query.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('query failed')).mockRejectedValueOnce(new Error('rollback failed'));
  await expect(lookup()).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' });
  expect(release).toHaveBeenLastCalledWith(true);
  connect.mockClear();
  await expect(ingressIdentity.readIngressAuthorityIdentity(db, 'bad/account')).rejects.toMatchObject({ code: 'AUTHORITY_INPUT_INVALID' });
  expect(connect).not.toHaveBeenCalled();
});
