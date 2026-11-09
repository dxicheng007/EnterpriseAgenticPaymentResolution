import Fastify from 'fastify';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createLocalComposition, localSourceCatalog } from '../../apps/control/src/composition.js';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createToolStepId, hashEvent, hashManifest, type BootstrapManifest, type ModelResultV2, type RawSourceEvent } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import {
  captureBaseline, companyA, prepareApiRecord, publishManifest, readDiscoveryCapture, SourceError, streamContentHash,
} from '@eapr/sources';
import { composeDiscovery, recheckDiscoveryCapture } from '../../apps/control/src/discovery-composition.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { mountDiscovery } from '../../apps/control/src/routes/discovery.js';
import { createDiscoveryService } from '../../packages/discovery/src/service.js';
import { acquireDiscoverySupervisor } from '../../packages/discovery/src/supervisor.js';
import type { CaptureAccess } from '../../packages/discovery/src/tasks.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { barrier, modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { testNamespace } from '../fixtures/harness.js';

const origin = 'http://127.0.0.1:5179';

test('default discovery requires a reviewer session and reports unavailable model configuration', async () => {
  const dependencies = {} as Parameters<typeof createLocalComposition>[0];
  const composition = await createLocalComposition(dependencies, { webOrigin: origin, captures: [] });
  const app = Fastify();
  try {
    for (const plugin of composition.featurePlugins) await app.register(plugin, { ...dependencies, workerClient: {} as never });
    const url = '/api/discovery/capabilities';
    expect((await app.inject(url)).statusCode).toBe(401);
    const session = await app.inject({
      method: 'POST', url: '/api/local-session', payload: {},
      headers: { origin, 'x-eapr-local-ui': '1', 'sec-fetch-site': 'same-origin' },
    });
    expect(session.statusCode).toBe(200);
    const cookie = session.cookies[0]!.name + '=' + session.cookies[0]!.value;
    const response = await app.inject({ url, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ schemaVersion: 2, mode: 'unconfigured', startAvailable: false });
  } finally {
    await app.close();
  }
});

const namespace = testNamespace('dischttp');
const clock = () => new Date('2026-11-08T00:00:00.000Z');
const reviewer = { reviewerId: 'demo-reviewer', allowedSourceRefs: ['legacy-a', 'legacy-b'], allowedAccountIds: [] };
let directory: string;
let db: Pool;
let admin: Pool;
let runtime: Pool;
let store: Awaited<ReturnType<typeof createEvidenceStore>>;
let capture: Awaited<ReturnType<typeof readDiscoveryCapture>>;
let runtimeBefore: unknown;
let enabled = true;
let provisioned = false;

async function persisted(pool: Pool, prefix?: string) {
  const { rows } = await pool.query<{ tablename: string }>(
    'SELECT tablename FROM pg_tables WHERE schemaname=\'public\' ORDER BY tablename');
  const tables = prefix ? rows.filter(row => row.tablename.startsWith(prefix) || row.tablename === 'activity_events') : rows;
  return {
    schema: (await pool.query(
      'SELECT * FROM information_schema.columns WHERE table_schema=\'public\' ORDER BY table_name, ordinal_position')).rows,
    rows: await Promise.all(tables.map(async ({ tablename }) => {
      if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected test table');
      return [tablename, (await pool.query('SELECT to_jsonb(t) FROM ' + tablename + ' t ORDER BY 1')).rows];
    })),
  };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'eapr-discovery-http-'));
  await startNativeDb();
  const pair = await provisionTest(namespace);
  provisioned = true;
  await migrate(pair, migrationStreams, readMigrationCatalog());
  db = new Pool({ connectionString: pair.control.appUrl });
  admin = new Pool({ connectionString: pair.control.migrationUrl });
  runtime = new Pool({ connectionString: pair.runtime.migrationUrl });
  store = await createEvidenceStore(join(directory, 'evidence'));
  const loaded = await loadDemo({ db, store, clock }, {
    visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'protected'),
  });
  capture = await readDiscoveryCapture({ db, store }, localSourceCatalog,
    loaded.captures.find(candidate => candidate.companyId === 'company-a')!);
  runtimeBefore = await persisted(runtime);
});

afterAll(async () => {
  try {
    if (runtimeBefore) expect(await persisted(runtime)).toEqual(runtimeBefore);
  } finally {
    await Promise.all([db?.end(), admin?.end(), runtime?.end()]);
    if (provisioned) await dropTest(namespace);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

const sourceRefForCompany = (companyId: string) => localSourceCatalog.get(companyId)?.sourceRef;
const resolveAuthority = (reviewerId: string, { companyId, sourceRef }: { companyId: string; sourceRef: string }) =>
  enabled && reviewerId === reviewer.reviewerId && sourceRefForCompany(companyId) === sourceRef ?
    { allowedAccountIds: [], sourceRead: { companyId, sourceRef, sourceWide: true, accounts: [] } } : undefined;
const readCapture: CaptureAccess['readCapture'] = selection => readDiscoveryCapture({ db, store }, localSourceCatalog, selection);
const base = '/api/discovery/runs';

async function http(options: Partial<Parameters<typeof createDiscoveryService>[0]> = {}) {
  const app = Fastify();
  const session = createLocalSessionService({ webOrigin: origin, ...reviewer });
  const service = await createDiscoveryService({
    db, clock, resolveAuthority, sourceRefForCompany, readCapture, recheckCapture: recheckDiscoveryCapture, ...options,
  });
  await app.register(session.plugin);
  await app.register(mountDiscovery(service, async (request, access) => {
    const caller = await session.authorizeReviewer(request, access);
    return { reviewerId: caller.reviewer.reviewerId, allowedSourceRefs: caller.allowedSourceRefs };
  }));
  const bootstrap = await app.inject({ method: 'POST', url: '/api/local-session', payload: {},
    headers: { origin, 'x-eapr-local-ui': '1', 'sec-fetch-site': 'same-origin' } });
  expect(bootstrap.statusCode).toBe(200);
  const { name, value } = bootstrap.cookies[0]!;
  const headers = { cookie: name + '=' + value, origin, 'x-eapr-csrf': bootstrap.json().csrfToken as string };
  return {
    app, headers,
    get: (url: string) => app.inject({ url, headers }),
    post: (url: string, payload: object) => app.inject({ method: 'POST', url, payload, headers }),
  };
}

function startPayload(idempotencyKey: string) {
  const { companyId, manifestId } = capture.binding;
  return { schemaVersion: 2, companyId, manifestId, idempotencyKey };
}

async function start(client: Awaited<ReturnType<typeof http>>, key: string, manifestId = capture.binding.manifestId) {
  const response = await client.post(base, { ...startPayload(key), manifestId });
  expect(response.statusCode, response.body).toBe(202);
  return response.json().runId as string;
}

test('requires CSRF and strict request bodies, preserves exact replay and enforces current source policy', async () => {
  const model = scriptedModel();
  const disabled = await http();
  const initial = await persisted(db, 'discovery_');
  try {
    expect((await disabled.app.inject({ method: 'POST', url: base, payload: {} })).statusCode).toBe(401);
    for (const csrf of ['', 'wrong']) {
      const response = await disabled.app.inject({ method: 'POST', url: base, payload: startPayload('no-client'),
        headers: { ...disabled.headers, 'x-eapr-csrf': csrf } });
      expect(response.statusCode).toBe(403);
    }
    expect((await disabled.post(base, { ...startPayload('no-client'), grants: {} })).statusCode).toBe(400);
    expect((await disabled.post(base, { ...startPayload('no-client'), companyId: 'unknown' })).statusCode).toBe(404);
    const response = await disabled.post(base, startPayload('no-client'));
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('MODEL_UNAVAILABLE');
    expect(await persisted(db, 'discovery_')).toEqual(initial);
  } finally {
    await disabled.app.close();
  }

  const configured = await http({ modelClient: model.model });
  let runId: string;
  let turn;
  try {
    const [first, second] = await Promise.all([
      configured.post(base, startPayload('concurrent')), configured.post(base, startPayload('concurrent')),
    ]);
    expect(first.statusCode, first.body).toBe(202);
    expect(second.statusCode, second.body).toBe(202);
    expect(first.json()).toEqual(second.json());
    runId = first.json().runId as string;
    turn = await model.at(0).turn.promise;
    expect(turn.runId).toBe(runId);
    const state = (await configured.get(base + '/' + runId)).json();
    expect(state.tasks).toMatchObject([{ role: 'coordinator', subject: { kind: 'source' } }]);
    const action = { schemaVersion: 2, expectedRevision: state.revision, idempotencyKey: 'pause' };
    expect((await configured.post(base + '/' + runId + '/pause', action)).statusCode).toBe(200);
    expect((await configured.post(base + '/' + runId + '/resume', action)).statusCode).toBe(409);
    expect((await configured.post(base, { ...startPayload('concurrent'), manifestId: 'different' })).statusCode).toBe(409);
  } finally {
    await configured.app.close();
    if (turn) model.at(0).result.resolve(modelResult(turn));
  }

  let reads = 0;
  const restarted = await http({ async readCapture() { reads++; throw Error('Unexpected read'); } });
  try {
    const before = await persisted(db, 'discovery_');
    expect(await start(restarted, 'concurrent')).toBe(runId);
    expect(reads).toBe(0);
    expect(await persisted(db, 'discovery_')).toEqual(before);
    expect((await restarted.get(base + '/' + runId)).statusCode).toBe(200);
    enabled = false;
    expect((await restarted.get(base + '/' + runId)).statusCode).toBe(403);
    expect((await restarted.post(base, startPayload('concurrent'))).statusCode).toBe(403);
    for (const action of ['pause', 'resume']) {
      expect((await restarted.post(base + '/' + runId + '/' + action,
        { schemaVersion: 2, expectedRevision: 1, idempotencyKey: "revoked" })).statusCode).toBe(403);
    }
    expect(await persisted(db, 'discovery_')).toEqual(before);
  } finally {
    enabled = true;
    await restarted.app.close();
  }
});

test('passes through safe source errors and rejects a dossier changed after blob validation', async () => {
  const errors = [
    new SourceError(422, 'SOURCE_CONTENT_INVALID', 'Pinned original content is invalid'),
    new SourceError(422, 'CITATION_INVALID', 'Pinned citation locator is invalid'),
    new SourceError(404, 'MANIFEST_NOT_FOUND', 'Manifest was not found'),
    new SourceError(409, 'SOURCE_HASH_CONFLICT', 'Pinned source capture content conflicts', [{
      code: 'SOURCE_HASH_CONFLICT', severity: 'blocker', message: 'Pinned member conflicts.',
      sourceIds: [capture.binding.manifestId], fieldPaths: [],
    }]),
    new SourceError(503, 'SOURCE_UNAVAILABLE', 'Source capture storage is unavailable'),
  ];
  const validated = barrier<void>();
  const proceed = barrier<void>();
  const model = scriptedModel();
  let nextError: SourceError | undefined;
  const client = await http({ modelClient: model.model, async readCapture(selection) {
    if (nextError) throw nextError;
    const facts = await readCapture(selection);
    validated.resolve();
    await proceed.promise;
    return facts;
  } });
  const manifestId = capture.binding.manifestId;
  const { rows: [saved] } = await db.query('SELECT dossier FROM source_dossiers WHERE manifest_id=$1', [manifestId]);
  try {
    const before = await persisted(db, 'discovery_');
    for (const error of errors) {
      nextError = error;
      const response = await client.post(base, startPayload('source-error'));
      expect(response.statusCode).toBe(error.status);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ code: error.code, message: error.message,
        diagnostics: error.diagnostics, correlationId: expect.any(String) });
    }
    nextError = undefined;
    const otherManifest = (await db.query("SELECT manifest_id FROM source_manifests WHERE company_id='company-b'")).rows[0]!.manifest_id;
    for (const manifestId of ['missing-manifest', otherManifest]) {
      expect((await client.post(base, { ...startPayload('wrong-manifest'), manifestId })).statusCode).toBe(404);
    }
    const request = client.post(base, startPayload('incomplete-after-validation'));
    await validated.promise;
    await db.query('UPDATE source_dossiers SET dossier=$2 WHERE manifest_id=$1',
      [manifestId, { ...saved.dossier, complete: false }]);
    proceed.resolve();
    expect((await request).statusCode).toBe(409);
    expect(await persisted(db, 'discovery_')).toEqual(before);
    expect(model.calls).toBe(0);
  } finally {
    proceed.resolve();
    await db.query('UPDATE source_dossiers SET dossier=$2 WHERE manifest_id=$1', [manifestId, saved.dossier]);
    await client.app.close();
  }
});

const sourceSubject = { kind: 'source' };
const delegate = (id: string, subject: object = sourceSubject, dependencyIds: string[] = [],
  extra: Record<string, unknown> = {}): ModelResultV2['toolCalls'][number] => ({
  id, name: 'delegateTask', arguments: { subject, role: 'identity', question: 'Inspect captured identity.', dependencyIds,
    ...extra } as ModelResultV2['toolCalls'][number]['arguments'],
});

async function steps(runId: string) {
  return (await db.query('SELECT * FROM discovery_tool_steps WHERE run_id=$1 ORDER BY dispatch_id, ordinal', [runId])).rows;
}

async function projection(runId: string) {
  const { rows: [row] } = await db.query(`SELECT
    (SELECT count(*)::int FROM discovery_tasks WHERE run_id=$1 AND role<>'coordinator') AS children,
    (SELECT count(*)::int FROM discovery_investigations WHERE run_id=$1) AS investigations,
    (SELECT sum(specialist_count)::int FROM discovery_investigations WHERE run_id=$1) AS specialists,
    (SELECT count(*)::int FROM activity_events WHERE event->>'runId'=$1 AND event->>'type' IN ('tool.called','tool.result')) AS tools`,
  [runId]);
  return row;
}

test('preflights all delegation inputs before the first effect', async () => {
  const model = scriptedModel();
  const client = await http({ modelClient: model.model });
  try {
    const predecessorRunId = await start(client, 'other-run-predecessor');
    const predecessorTurn = await model.at(0).turn.promise;
    expect(predecessorTurn.runId).toBe(predecessorRunId);
    const previous = predecessorTurn.taskId;
    model.at(0).result.resolve(modelResult(predecessorTurn));
    const cases = [
      delegate('invalid', sourceSubject, [previous]),
      delegate('invalid', sourceSubject, ['missing-task']),
      delegate('invalid', { kind: 'source_account', sellerEntityId: 'unknown', sourceAccountId: 'unknown' }),
      delegate('invalid', sourceSubject, ['duplicate', 'duplicate']),
      delegate('invalid', sourceSubject, [], { role: 'coordinator' }),
      delegate('invalid', sourceSubject, [], { grant: { sourceWide: true } }),
    ];
    for (const [index, invalid] of cases.entries()) {
      const runId = await start(client, 'preflight-' + index);
      const turn = await model.at(index + 1).turn.promise;
      expect(turn.runId).toBe(runId);
      expect(turn.toolSchemas.map(schema => schema.name)).toEqual(['delegateTask']);
      model.at(index + 1).result.resolve(modelResult(turn, [delegate('valid'), invalid]));
      await expect.poll(async () => (await steps(runId)).map(step => step.state)).toEqual(['failed', 'failed']);
      expect(await projection(runId)).toEqual({ children: 0, investigations: 1, specialists: 0, tools: 0 });
    }
  } finally {
    await client.app.close();
  }
});

async function owned(model: ReturnType<typeof scriptedModel>, testHooks: NonNullable<Parameters<typeof acquireDiscoverySupervisor>[0]['testHooks']> = {}) {
  const owner = await acquireDiscoverySupervisor({
    db, clock, model: model.model, resolveAuthority,
    capture: { readCapture, recheckCapture: recheckDiscoveryCapture }, testHooks,
  });
  if (!owner) throw new Error('Discovery owner was unavailable');
  return owner;
}

test('commits a single child effect with saved replay, and reuses native call IDs across dispatches and tasks', async () => {
  const model = scriptedModel();
  const owner = await owned(model);
  const client = await http({ modelClient: model.model });
  try {
    const runId = await start(client, 'success');
    const state = (await client.get(base + '/' + runId)).json();
    const coordinator = state.tasks[0].id as string;
    const first = owner.dispatchTask(runId, coordinator)!;
    const turn = await model.at(0).turn.promise;
    const subject = capture.sourceAccounts[0]!;
    expect(subject.kind).toBe('source_account');
    const accepted = modelResult(turn, [
      delegate('call-1', subject, [coordinator]), delegate('call-2', subject, [coordinator]),
    ]);
    model.at(0).result.resolve(accepted);
    await first.done;
    const [one, two] = await steps(runId);
    const result = await owner.executePendingStep(runId, coordinator, one.id);
    expect(result).toMatchObject({ ok: true, investigationId: expect.any(String), taskId: expect.any(String), revision: 1 });
    if (!result?.ok || !('investigationId' in result)) throw new Error('Expected a delegation result');
    expect(await owner.executePendingStep(runId, coordinator, two.id)).toMatchObject({
      ok: true, investigationId: result.investigationId,
    });
    expect(await projection(runId)).toEqual({ children: 2, investigations: 2, specialists: 2, tools: 4 });
    expect(await owner.executePendingStep(runId, coordinator, one.id)).toEqual(result);
    await first.replayTestResult!(accepted);
    await expect(first.replayTestResult!(modelResult(turn, [delegate('changed')]))).rejects.toMatchObject({ statusCode: 409 });
    expect(await projection(runId)).toEqual({ children: 2, investigations: 2, specialists: 2, tools: 4 });

    const follow = owner.dispatchTask(runId, coordinator)!;
    const next = await model.at(1).turn.promise;
    expect(next.messages).toContainEqual({ kind: 'tool_result', toolStepId: one.id, name: 'delegateTask', result });
    model.at(1).result.resolve(modelResult(next, [{ id: 'call-1', name: 'describeSource', arguments: {} }]));
    await follow.done;
    const secondId = createToolStepId({ dispatchId: next.dispatchId, providerToolCallId: 'call-1' });
    expect(secondId).not.toBe(one.id);
    expect(await owner.executePendingStep(runId, coordinator, secondId)).toEqual({ ok: false, code: 'TOOL_UNAVAILABLE' });

    const finish = owner.dispatchTask(runId, coordinator)!;
    const last = await model.at(2).turn.promise;
    model.at(2).result.resolve(modelResult(last));
    await finish.done;

    if (!result?.ok || !('taskId' in result)) throw new Error('Expected a child');
    const specialist = owner.dispatchTask(runId, result.taskId)!;
    const child = await model.at(3).turn.promise;
    expect(child.taskId).toBe(result.taskId);
    expect(child.toolSchemas).toEqual([]);
    model.at(3).result.resolve(modelResult(child, [delegate('call-1'), { id: 'unknown', name: 'unknown', arguments: {} }]));
    await specialist.done;
    const thirdId = createToolStepId({ dispatchId: child.dispatchId, providerToolCallId: 'call-1' });
    expect(new Set([one.id, secondId, thirdId]).size).toBe(3);
    const forbidden = { ok: false, code: 'TOOL_FORBIDDEN' };
    expect(await owner.executePendingStep(runId, child.taskId, thirdId)).toEqual(forbidden);
    expect(await owner.executePendingStep(runId, child.taskId,
      createToolStepId({ dispatchId: child.dispatchId, providerToolCallId: 'unknown' }))).toEqual(forbidden);

    const childFollow = owner.dispatchTask(runId, child.taskId)!;
    const childNext = await model.at(4).turn.promise;
    expect(childNext.messages).toContainEqual({ kind: 'tool_result', toolStepId: thirdId, name: 'delegateTask', result: forbidden });
    model.at(4).result.resolve(modelResult(childNext));
    await childFollow.done;
  } finally {
    await client.app.close();
    await owner.close();
  }
});

test('pauses pending output and rolls back a delegation before commit, then refences it after owner restart', async () => {
  const model = scriptedModel();
  const transactionReached = barrier<void>();
  const crash = barrier<void>();
  let owner = await owned(model, { async beforeDelegationCommit() {
    transactionReached.resolve();
    await crash.promise;
  } });
  const client = await http({ modelClient: model.model });
  try {
    const runId = await start(client, 'pause-recovery');
    const url = base + '/' + runId;
    const taskId = (await client.get(url)).json().tasks[0].id as string;
    const invocation = owner.dispatchTask(runId, taskId)!;
    const turn = await model.at(0).turn.promise;
    const act = async (action: 'pause' | 'resume', key: string) => {
      const current = (await client.get(url)).json();
      const response = await client.post(url + '/' + action,
        { schemaVersion: 2, idempotencyKey: key, expectedRevision: current.revision });
      expect(response.statusCode, response.body).toBe(200);
      return response;
    };
    await act('pause', 'first-pause');
    model.at(0).result.resolve(modelResult(turn, [delegate('call-1')]));
    await invocation.done;
    const [step] = await steps(runId);
    expect(step.state).toBe('pending');
    expect(await owner.executePendingStep(runId, taskId, step.id)).toBeUndefined();
    expect(await projection(runId)).toEqual({ children: 0, investigations: 1, specialists: 0, tools: 0 });
    await act('resume', 'first-resume');

    enabled = false;
    expect(await owner.executePendingStep(runId, taskId, step.id)).toBeUndefined();
    expect((await steps(runId))[0].state).toBe('pending');
    enabled = true;
    const effect = owner.executePendingStep(runId, taskId, step.id);
    await transactionReached.promise;
    await client.app.close();
    const closing = owner.close();
    crash.resolve();
    expect(await effect).toBeUndefined();
    await closing;
    expect(await projection(runId)).toEqual({ children: 0, investigations: 1, specialists: 0, tools: 0 });
    expect((await steps(runId))[0].state).toBe('pending');

    owner = await owned(model);
    const result = await owner.executePendingStep(runId, taskId, step.id);
    expect(result).toMatchObject({ ok: true, revision: 1 });
    expect(await owner.executePendingStep(runId, taskId, step.id)).toEqual(result);
    expect(model.calls).toBe(1);
    expect(await projection(runId)).toEqual({ children: 1, investigations: 1, specialists: 1, tools: 2 });
  } finally {
    enabled = true;
    crash.resolve();
    await client.app.close();
    await owner.close();
  }
});

test('accounts independently trusted usage for a byte-oversized model response without partial effects', async () => {
  const model = scriptedModel();
  const owner = await owned(model);
  const client = await http({ modelClient: model.model });
  try {
    const runId = await start(client, 'oversized');
    const url = base + '/' + runId;
    const taskId = (await client.get(url)).json().tasks[0].id as string;
    const invocation = owner.dispatchTask(runId, taskId)!;
    const turn = await model.at(0).turn.promise;
    const large = '😀'.repeat(16_000);
    const argumentsForCall = { body: large };
    expect(Buffer.byteLength(JSON.stringify(argumentsForCall))).toBeLessThan(64 * 1024);
    const invalid = modelResult(turn, [1, 2, 3].map(index => ({
      id: 'call-' + index, name: 'describeSource', arguments: argumentsForCall,
    })));
    expect(Buffer.byteLength(JSON.stringify(invalid))).toBeGreaterThan(128 * 1024);
    model.at(0).result.resolve(invalid);
    await invocation.done;
    expect(await steps(runId)).toEqual([]);
    expect(await projection(runId)).toEqual({ children: 0, investigations: 1, specialists: 0, tools: 0 });
    const state = (await client.get(url)).json();
    expect(state.usage).toMatchObject({ modelCalls: 1, inputTokens: 11, outputTokens: 7, unknownUsageCalls: 0 });
    expect(state.diagnostics).toMatchObject([{ code: 'MODEL_INVALID_RESULT' }]);
  } finally {
    await client.app.close();
    await owner.close();
  }
});

async function waitForLock(query: string) {
  await expect.poll(async () => (await db.query(
    "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND query=$1 AND wait_event_type='Lock'",
    [query])).rowCount).toBeGreaterThan(0);
}

test('keeps the dossier lock from recheck through run insertion', async () => {
  const rechecked = barrier<void>();
  const insert = barrier<void>();
  const model = scriptedModel();
  const owner = await owned(model);
  const client = await http({ modelClient: model.model, async recheckCapture(connection, facts) {
    await recheckDiscoveryCapture(connection, facts);
    rechecked.resolve();
    await insert.promise;
  } });
  const sql = 'UPDATE source_dossiers SET dossier=dossier WHERE manifest_id=$1';
  try {
    const pending = client.post(base, startPayload('dossier-share'));
    await rechecked.promise;
    const update = db.query(sql, [capture.binding.manifestId]);
    await waitForLock(sql);
    insert.resolve();
    expect((await pending).statusCode).toBe(202);
    expect((await update).rowCount).toBe(1);
  } finally {
    insert.resolve();
    await client.app.close();
    await owner.close();
  }
});

test('rejects privileged pinned-row corruption between source validation and transactional recheck', async () => {
  const { manifestId, snapshotId, sourceRef } = capture.binding;
  const event = (await admin.query('SELECT event_id, content_hash FROM source_events WHERE source_ref=$1 LIMIT 1',
    [sourceRef])).rows[0]!;
  const { rows: [citation] } = await admin.query('SELECT * FROM source_evidence WHERE evidence_id=$1', [capture.evidenceIds[0]]);
  const { rows: [manifest] } = await admin.query('SELECT manifest FROM source_manifests WHERE manifest_id=$1', [manifestId]);
  const { rows: [snapshot] } = await admin.query('SELECT snapshot FROM source_snapshots WHERE snapshot_id=$1', [snapshotId]);
  const hash = 'f'.repeat(64);
  const { hash: _manifestHash, ...missingManifestHash } = manifest.manifest;
  const { contentHash: _snapshotHash, ...missingSnapshotHash } = snapshot.snapshot;
  const probes = [
    {
      sql: 'UPDATE source_manifests SET manifest=$2 WHERE manifest_id=$1',
      corrupt: [manifestId, missingManifestHash], restore: [manifestId, manifest.manifest],
    },
    {
      sql: 'UPDATE source_snapshots SET snapshot=$2 WHERE snapshot_id=$1',
      corrupt: [snapshotId, missingSnapshotHash], restore: [snapshotId, snapshot.snapshot],
    },
    {
      sql: "UPDATE source_manifests SET manifest=$2 WHERE manifest_id=$1",
      corrupt: [manifestId, { ...manifest.manifest, hash }], restore: [manifestId, manifest.manifest],
    },
    {
      sql: "UPDATE source_snapshots SET snapshot=$2 WHERE snapshot_id=$1",
      corrupt: [snapshotId, { ...snapshot.snapshot, contentHash: hash }], restore: [snapshotId, snapshot.snapshot],
    },
    {
      sql: "UPDATE source_snapshots SET snapshot=$2 WHERE snapshot_id=$1",
      corrupt: [snapshotId, { ...snapshot.snapshot, eventIds: snapshot.snapshot.eventIds.slice(1) }],
      restore: [snapshotId, snapshot.snapshot],
    },
    {
      sql: 'UPDATE source_events SET content_hash=$3 WHERE source_ref=$1 AND event_id=$2',
      corrupt: [sourceRef, event.event_id, hash], restore: [sourceRef, event.event_id, event.content_hash],
    },
    {
      sql: 'UPDATE source_evidence SET evidence_id=$2 WHERE evidence_id=$1',
      corrupt: [citation.evidence_id, 'extra-citation'], restore: ['extra-citation', citation.evidence_id],
    },
  ];
  const model = scriptedModel();
  const owner = await owned(model);
  let beforeRecheck: (() => Promise<unknown>) | undefined;
  const client = await http({ modelClient: model.model, async readCapture(selection) {
    const facts = await readCapture(selection);
    await beforeRecheck?.();
    return facts;
  } });
  try {
    const before = await persisted(db, 'discovery_');
    for (const [index, probe] of probes.entries()) {
      beforeRecheck = () => admin.query(probe.sql, probe.corrupt);
      try {
        const response = await client.post(base, startPayload('corrupt-' + index));
        expect(response.statusCode, response.body).toBe(409);
        expect(response.json().code).toBe('DISCOVERY_CONFLICT');
        expect(await persisted(db, 'discovery_')).toEqual(before);
      } finally {
        await admin.query(probe.sql, probe.restore);
      }
    }
  } finally {
    await client.app.close();
    await owner.close();
  }
});

test('serializes pause behind a delegation that already owns the run lock', async () => {
  const model = scriptedModel();
  const effectLocked = barrier<void>();
  const commitEffect = barrier<void>();
  const owner = await owned(model, { async beforeDelegationCommit() {
    effectLocked.resolve();
    await commitEffect.promise;
  } });
  const client = await http({ modelClient: model.model });
  try {
    const runId = await start(client, 'effect-first');
    const url = base + '/' + runId;
    const taskId = (await client.get(url)).json().tasks[0].id as string;
    const invocation = owner.dispatchTask(runId, taskId)!;
    const turn = await model.at(0).turn.promise;
    model.at(0).result.resolve(modelResult(turn, [delegate('call-1')]));
    await invocation.done;
    const [step] = await steps(runId);
    const before = (await client.get(url)).json();
    const claim = owner.executePendingStep(runId, taskId, step.id);
    await effectLocked.promise;
    const pause = { schemaVersion: 2, idempotencyKey: 'pause-behind-effect', expectedRevision: before.revision };
    const pendingPause = client.post(url + '/pause', pause);
    await waitForLock('SELECT * FROM discovery_runs WHERE id = $1 FOR UPDATE');
    commitEffect.resolve();
    const result = await claim;
    expect(result).toMatchObject({ ok: true, revision: 1 });
    expect((await pendingPause).statusCode).toBe(409);
    const updated = (await client.get(url)).json();
    const response = await client.post(url + '/pause', { ...pause, expectedRevision: updated.revision });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: 'paused', tasks: expect.arrayContaining([{ ...updated.tasks.find(
      (task: { role: string }) => task.role === 'identity',
    ) }]) });
    expect(await owner.executePendingStep(runId, taskId, step.id)).toEqual(result);
    expect(await projection(runId)).toEqual({ children: 1, investigations: 1, specialists: 1, tools: 2 });
  } finally {
    commitEffect.resolve();
    await client.app.close();
    await owner.close();
  }
});

let expansion: ReturnType<typeof buildExpandedCapture> | undefined;
const expandedCapture = () => expansion ??= buildExpandedCapture();

async function buildExpandedCapture() {
  const { rows: [saved] } = await db.query<{ manifest: BootstrapManifest }>(
    'SELECT manifest FROM source_manifests WHERE manifest_id=$1', [capture.binding.manifestId]);
  const manifest = saved.manifest;
  const { rows } = await db.query<{ event: RawSourceEvent }>(
    'SELECT event FROM source_events WHERE source_ref=$1 ORDER BY sequence', [companyA.sourceRef]);
  const original = rows.map(row => row.event);
  const now = clock().toISOString();
  const date = now.slice(0, 10);
  const id = 'manifest-expanded-discovery';
  const first = original.filter(event => event.streamId === companyA.streams[0]!.streamId).length + 1;
  const newEvents: RawSourceEvent[] = Array.from({ length: 23 }, (_, index) => {
    const base = eventA({
      kind: 'invoice', recordId: 'discovery-http-invoice-' + index,
      sourceAccountId: index < 2 ? 'shared-raw' : 'raw-' + index, effectiveDate: date,
      fields: { amount: '1.00', due_date: date },
    }, first + index, now);
    const { sellerEntityId: _seller, ...rawIdentity } = base.rawIdentity;
    const event = { ...base, rawIdentity: index === 22 ? rawIdentity : { ...rawIdentity, sellerEntityId: 'seller-' + index } };
    return { ...event, contentHash: hashEvent(event) };
  });
  const events = [...original, ...newEvents];
  const draft = {
    ...manifest, id, epoch: manifest.epoch + 1, asOf: now,
    streams: manifest.streams.map(({ streamId }) => {
      const members = events.filter(event => event.streamId === streamId);
      const resumeAfter = String(members.length);
      return {
        streamId, resumeAfter, snapshotId: id + ':' + streamId, eventIds: members.map(event => event.id),
        snapshotHash: streamContentHash(manifest.sourceRef, streamId, resumeAfter, members),
      };
    }),
    semanticVersions: { ...manifest.semanticVersions, ...Object.fromEntries(newEvents.filter(event => event.rawIdentity.sellerEntityId)
      .map(event => [event.rawIdentity.sellerEntityId + '/' + event.rawIdentity.sourceAccountId, event.semanticVersion])) },
  };
  const prepared = await Promise.all(newEvents.map(event =>
    prepareApiRecord(companyA, store, event, Buffer.from(JSON.stringify(event.payload)))));
  const dependencies = { db, store, clock };
  await publishManifest(dependencies, localSourceCatalog, { ...draft, hash: hashManifest(draft) }, prepared);
  expect((await captureBaseline(dependencies, id)).ok).toBe(true);
  return readCapture({ companyId: companyA.companyId, sourceRef: companyA.sourceRef, manifestId: id });
}

test('keeps same raw accounts under different sellers distinct and never invents a seller', async () => {
  const facts = await expandedCapture();
  const model = scriptedModel();
  const owner = await owned(model);
  const client = await http({ modelClient: model.model });
  try {
    const runId = await start(client, 'seller-identity', facts.binding.manifestId);
    const taskId = (await client.get(base + '/' + runId)).json().tasks[0].id as string;
    const invocation = owner.dispatchTask(runId, taskId)!;
    const turn = await model.at(0).turn.promise;
    const subjects = facts.sourceAccounts.filter(subject => subject.sourceAccountId === 'shared-raw');
    expect(subjects.map(subject => subject.sellerEntityId)).toEqual(['seller-0', 'seller-1']);
    expect(facts.sourceAccounts.some(subject => subject.sourceAccountId === 'raw-22')).toBe(false);
    model.at(0).result.resolve(modelResult(turn, subjects.map((subject, index) => delegate('call-' + index, subject))));
    await invocation.done;
    const [first, second] = await steps(runId);
    const left = await owner.executePendingStep(runId, taskId, first.id);
    const right = await owner.executePendingStep(runId, taskId, second.id);
    expect(left).toMatchObject({ ok: true });
    expect(right).toMatchObject({ ok: true });
    if (!left?.ok || !right?.ok || !('investigationId' in left) || !('investigationId' in right)) {
      throw new Error('Expected both seller tasks');
    }
    expect(left.investigationId).not.toBe(right.investigationId);
    expect(await projection(runId)).toEqual({ children: 2, investigations: 3, specialists: 2, tools: 4 });
  } finally {
    await client.app.close();
    await owner.close();
  }
});

test('rejects the entire delegation batch at both persisted capacity boundaries', async () => {
  const facts = await expandedCapture();
  const model = scriptedModel();
  const owner = await owned(model);
  const client = await http({ modelClient: model.model });
  try {
    for (const [index, limit] of ['SPECIALIST_LIMIT', 'INVESTIGATION_LIMIT'].entries()) {
      const runId = await start(client, 'capacity-' + index, facts.binding.manifestId);
      const url = base + '/' + runId;
      const taskId = (await client.get(url)).json().tasks[0].id as string;
      const seedSubjects = index === 0 ? Array.from({ length: 9 }, () => ({ kind: 'source' as const })) :
        facts.sourceAccounts.slice(0, 19);
      expect(seedSubjects.length).toBe(index === 0 ? 9 : 19);
      for (const subject of seedSubjects) {
        const seeded = await owner.addTestSpecialist!(runId, {
          role: 'identity', question: 'Capacity fixture.', dependencyIds: [taskId], subject,
        });
        expect(seeded).toMatchObject({ taskId: expect.any(String) });
      }
      const invocation = owner.dispatchTask(runId, taskId)!;
      const turn = await model.at(index).turn.promise;
      const subjects = index === 0 ? [sourceSubject, sourceSubject] : facts.sourceAccounts.slice(19, 21);
      model.at(index).result.resolve(modelResult(turn, subjects.map((subject, ordinal) => delegate('call-' + ordinal, subject))));
      await invocation.done;
      const [first, second] = await steps(runId);
      const results = await Promise.all([
        owner.executePendingStep(runId, taskId, first.id), owner.executePendingStep(runId, taskId, second.id),
      ]);
      expect(results).toEqual([{ ok: false, code: limit }, { ok: false, code: limit }]);
      const count = index === 0 ? 9 : 19;
      expect(await projection(runId)).toEqual({ children: count, investigations: index === 0 ? 1 : 20,
        specialists: count, tools: 0 });
      const blocked = (await client.get(url)).json();
      expect(blocked).toMatchObject({ status: 'blocked', diagnostics: [{ code: limit }, { code: 'DEPENDENCY_BLOCKED' }] });
      const pause = await client.post(url + '/pause',
        { schemaVersion: 2, idempotencyKey: 'limit-pause', expectedRevision: blocked.revision });
      expect(pause.statusCode).toBe(200);
      const resume = await client.post(url + '/resume',
        { schemaVersion: 2, idempotencyKey: 'limit-resume', expectedRevision: pause.json().revision });
      expect(resume.statusCode).toBe(200);
      expect(resume.json()).toMatchObject({ status: 'blocked', diagnostics: [{ code: limit }, { code: 'DEPENDENCY_BLOCKED' }] });
    }
  } finally {
    await client.app.close();
    await owner.close();
  }
});

test('configured composition runs the persisted coordinator and child through the authenticated HTTP surface', async () => {
  const model = scriptedModel();
  const session = createLocalSessionService({ webOrigin: origin, ...reviewer });
  const app = Fastify();
  let blobReads = 0;
  const storeWithProbe = { async get(...args: Parameters<typeof store.get>) {
    blobReads++;
    const { rowCount } = await db.query(`SELECT 1 FROM pg_stat_activity
      WHERE datname=current_database() AND usename=current_user AND state='idle in transaction'`);
    expect(rowCount).toBe(0);
    return store.get(...args);
  } };
  await app.register(session.plugin);
  await app.register(composeDiscovery({
    catalog: localSourceCatalog, store: storeWithProbe, reviewer, authorizeReviewer: session.authorizeReviewer,
    modelClient: { ...model.model, modelId: 'script-composition' },
  }), { db, clock });
  const addr = await app.listen({ host: '127.0.0.1', port: localPort('EAPR_CONTROL_PORT', 3601) });
  const request = (path: string, options: RequestInit = {}) =>
    fetch(addr + path, { signal: AbortSignal.timeout(5000), ...options });
  try {
    const session = await request('/api/local-session', { method: 'POST', body: '{}',
      headers: { origin, 'x-eapr-local-ui': '1', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } });
    expect(session.status).toBe(200);
    const cookie = session.headers.getSetCookie()[0]!.split(';')[0]!;
    const csrf = (await session.json()).csrfToken as string;
    const capability = await request('/api/discovery/capabilities', { headers: { cookie } });
    expect(await capability.json()).toEqual({ schemaVersion: 2, mode: 'scripted', startAvailable: true, diagnostics: [] });
    const response = await request(base, { method: 'POST', body: JSON.stringify(startPayload('real-http')),
      headers: { cookie, origin, 'content-type': 'application/json', 'x-eapr-csrf': csrf } });
    expect(response.status).toBe(202);
    const { runId } = await response.json();
    const coordinator = await model.at(0).turn.promise;
    model.at(0).result.resolve(modelResult(coordinator, [delegate('call-1', sourceSubject, [coordinator.taskId])]));
    const followUp = await model.at(1).turn.promise;
    expect(followUp.taskId).toBe(coordinator.taskId);
    expect(followUp.messages).toContainEqual(expect.objectContaining({
      kind: 'tool_result', result: expect.objectContaining({ ok: true }),
    }));
    model.at(1).result.resolve(modelResult(followUp));
    const child = await model.at(2).turn.promise;
    expect(child.role).toBe('identity');
    model.at(2).result.resolve(modelResult(child));
    await expect.poll(async () => {
      const state = await request(base + '/' + runId, { headers: { cookie } });
      expect(state.status).toBe(200);
      return state.json();
    }).toMatchObject({
      status: 'blocked', findings: [], proposals: [], verificationJobs: [],
      diagnostics: [{ code: 'CONSTRUCTION_UNAVAILABLE' }],
    });
    expect(await projection(runId)).toEqual({ children: 1, investigations: 1, specialists: 1, tools: 2 });
    expect(blobReads).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
