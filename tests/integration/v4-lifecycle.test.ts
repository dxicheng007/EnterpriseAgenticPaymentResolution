import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { createToolStepId } from '../../packages/contracts/src/index.js';
import { acquireDiscoverySupervisor } from '../../packages/discovery/src/supervisor.js';
import { barrier, modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import { createDiscoveryRepository } from '../../packages/discovery/src/repository.js';

let system: Awaited<ReturnType<typeof createTestSystem>>;
beforeAll(async () => {
  system = await createTestSystem({ modelMode: 'stub', dbNamespace: testNamespace('v4life') });
}, 30000);
afterAll(async () => { await system?.close(); });

it('returns the unique saved start under current policy even without a model', async () => {
  const binding = {
    companyId: 'company', sourceRef: 'source', manifestId: 'manifest', manifestHash: 'a'.repeat(64),
    snapshotId: 'snapshot', snapshotHash: 'b'.repeat(64),
  };
  const grants = { allowedAccountIds: [], sourceRead: { companyId: 'company', sourceRef: 'source', sourceWide: true, accounts: [] } };
  let authorized = true;
  let captureReads = 0;
  const repository = createDiscoveryRepository({
    db: system.db.control, clock: () => new Date('2026-11-08T00:00:00Z'),
    resolveAuthority: () => authorized ? grants : undefined,
  });
  const input = { schemaVersion: 2 as const, companyId: 'company', manifestId: 'manifest', idempotencyKey: 'start' };
  const actor = { reviewerId: 'reviewer', sourceRef: 'source' };
  const bothCaptures = barrier<void>();
  const readCapture = async () => {
    if (++captureReads === 2) bothCaptures.resolve();
    await bothCaptures.promise;
    return binding;
  };
  const model = { modelId: 'script', mode: 'scripted' as const };
  const start = () => repository.start(input, actor, { model, readCapture });
  const [first, second] = await Promise.all([start(), start()]);
  expect(first).toEqual(second);
  const restarted = createDiscoveryRepository({ ...options(), resolveAuthority: () => grants });
  const saved = await restarted.start(input, actor, { readCapture: async () => { throw new Error('unexpected capture'); } });
  expect(saved).toEqual(first);
  expect(captureReads).toBe(2);
  await expect(repository.start({ ...input, manifestId: 'other' }, actor, { readCapture }))
    .rejects.toMatchObject({ statusCode: 409 });
  await expect(repository.start({ ...input, idempotencyKey: 'other' }, actor, { readCapture }))
    .rejects.toMatchObject({ statusCode: 503, code: 'MODEL_UNAVAILABLE' });
  authorized = false;
  await expect(start()).rejects.toMatchObject({ statusCode: 403 });
  const result = await system.db.control.query(`SELECT
    (SELECT count(*)::int FROM discovery_runs) AS runs,
    (SELECT count(*)::int FROM discovery_investigations) AS investigations,
    (SELECT count(*)::int FROM discovery_tasks) AS tasks,
    (SELECT count(*)::int FROM activity_events WHERE event->>'type' = 'discovery.started') AS events`);
  expect(result.rows).toEqual([{ runs: 1, investigations: 1, tasks: 1, events: 1 }]);
});

type Supervisor = NonNullable<Awaited<ReturnType<typeof acquireDiscoverySupervisor>>>;
const supervisors: Supervisor[] = [];
const binding = {
  companyId: 'company', sourceRef: 'source', manifestId: 'manifest', manifestHash: 'a'.repeat(64),
  snapshotId: 'snapshot', snapshotHash: 'b'.repeat(64),
};
const actor = { reviewerId: 'reviewer', sourceRef: 'source' };
const grants = {
  allowedAccountIds: [], sourceRead: { companyId: 'company', sourceRef: 'source', sourceWide: true, accounts: [] },
};
const options = () => ({
  db: system.db.control, clock: () => new Date('2026-11-08T00:00:00Z'), resolveAuthority: () => grants,
});
const toolCall = { id: 'call-1', name: 'delegateTask', arguments: {} };

async function owner(script: ReturnType<typeof scriptedModel>,
  testHooks: Parameters<typeof acquireDiscoverySupervisor>[0]['testHooks'] = {}) {
  const supervisor = await acquireDiscoverySupervisor({ ...options(), model: script.model, testHooks });
  if (!supervisor) throw new Error('Expected discovery ownership');
  supervisors.push(supervisor);
  return supervisor;
}

async function newRun(script: ReturnType<typeof scriptedModel>) {
  const repository = createDiscoveryRepository(options());
  const { runId } = await repository.start({
    schemaVersion: 2, companyId: binding.companyId, manifestId: binding.manifestId, idempotencyKey: randomUUID(),
  }, actor, { model: script.model, readCapture: async () => binding });
  const state = () => repository.readState(runId, actor);
  const taskId = (await state()).tasks[0].id;
  async function action(name: 'pause' | 'resume') {
    return repository.action(runId, actor, name, {
      schemaVersion: 2, expectedRevision: (await state()).revision, idempotencyKey: randomUUID(),
    });
  }
  return { runId, taskId, repository, state, action };
}

async function dispatchRows(runId: string) {
  return (await system.db.control.query(`SELECT id,state,accounting,result_hash,accepted,attempt
    FROM discovery_dispatches WHERE run_id=$1 ORDER BY task_id,attempt`, [runId])).rows;
}

async function stepRows(runId: string) {
  return (await system.db.control.query(`SELECT id,dispatch_id,native_id,state,result FROM discovery_tool_steps
    WHERE run_id=$1 ORDER BY dispatch_id,ordinal`, [runId])).rows;
}

async function activity(runId: string, type: string) {
  return (await system.db.control.query(
    "SELECT event FROM activity_events WHERE event->>'runId'=$1 AND event->>'type'=$2 ORDER BY sequence", [runId, type])).rows;
}

async function runtimeFingerprint() {
  const tables = await system.db.runtime.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  return Promise.all(tables.rows.map(({ tablename }) => {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected runtime table identifier');
    return system.db.runtime.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)
      .then(result => [tablename, result.rows]);
  }));
}

let runtimeBefore: Awaited<ReturnType<typeof runtimeFingerprint>>;
beforeEach(async () => { runtimeBefore = await runtimeFingerprint(); });
afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) await supervisor.close();
  expect(await runtimeFingerprint()).toEqual(runtimeBefore);
});

it('atomically interrupts a held call and discards a late success across pause, resume and recovery', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const supervisor = await owner(script);
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  const turn = await script.at(0).turn.promise;
  const reserved = await run.state();
  expect(reserved).toMatchObject({ status: 'running', inFlightModelCalls: 1, usage: { modelCalls: 1, unknownUsageCalls: 0 } });
  await call.timeout();
  const interrupted = await run.state();
  expect(interrupted.revision).toBe(reserved.revision + 1);
  expect(interrupted).toMatchObject({
    status: 'blocked', inFlightModelCalls: 0, usage: { modelCalls: 1, unknownUsageCalls: 1, inputTokens: 0, outputTokens: 0 },
    tasks: [{ status: 'interrupted', attempt: 1, revision: reserved.tasks[0].revision + 1, diagnosticCodes: ['MODEL_TIMEOUT'] }],
    diagnostics: [{ code: 'MODEL_TIMEOUT' }],
  });
  expect(await dispatchRows(run.runId)).toMatchObject([{ state: 'interrupted', accounting: 'unknown', accepted: null }]);
  expect(await activity(run.runId, 'discovery.interrupted')).toHaveLength(1);
  await run.action('pause');
  const resumed = await run.action('resume');
  expect(resumed).toMatchObject({ status: 'blocked', diagnostics: [{ code: 'MODEL_TIMEOUT' }] });
  script.at(0).result.resolve(modelResult(turn, [toolCall]));
  await call.done;
  expect(await run.state()).toEqual(resumed);
  expect(await stepRows(run.runId)).toEqual([]);
  await supervisor.dispatchTask(run.runId, run.taskId)?.done;
  expect(script.calls).toBe(1);
  await supervisor.close();
  const replacement = await owner(script);
  expect(replacement.generation).toBeGreaterThan(supervisor.generation);
  await replacement.reconcile();
  await replacement.reconcile();
  expect(await run.state()).toEqual(resumed);
  expect(await activity(run.runId, 'discovery.interrupted')).toHaveLength(1);
});

it('keeps a committed result when timeout loses and a paused task retains its pending steps', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const supervisor = await owner(script);
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  const turn = await script.at(0).turn.promise;
  const paused = await run.action('pause');
  script.at(0).result.resolve(modelResult(turn, [toolCall]));
  await call.done;
  const returned = await run.state();
  expect(returned.revision).toBe(paused.revision + 1);
  expect(returned).toMatchObject({ status: 'paused', usage: { inputTokens: 11, outputTokens: 7, unknownUsageCalls: 0 },
    tasks: [{ attempt: 1, toolRounds: 1 }] });
  await call.timeout();
  expect(await run.state()).toEqual(returned);
  const id = createToolStepId({ dispatchId: turn.dispatchId, providerToolCallId: 'call-1' });
  expect(await stepRows(run.runId)).toMatchObject([{ id, state: 'pending', result: null }]);
  expect(await activity(run.runId, 'system.status')).toMatchObject([{ event: {
    runId: run.runId, taskId: run.taskId, role: 'coordinator', payload: {
      dispatchId: turn.dispatchId, status: 'paused', taskState: 'running', toolRounds: 1, inputTokens: 11, outputTokens: 7,
    },
  } }]);
  const [summary] = await activity(run.runId, 'system.status');
  expect(Object.keys(summary.event.payload).sort()).toEqual(
    ['dispatchId', 'inputTokens', 'outputTokens', 'status', 'taskState', 'toolRounds']);
  expect(await supervisor.resolveUnavailableStep(run.runId, run.taskId, id)).toBeUndefined();
  expect(await activity(run.runId, 'tool.called')).toEqual([]);
  await supervisor.close();
  const replacement = await owner(script);
  expect(await run.state()).toEqual(returned);
  await run.action('resume');
  const expected = { ok: false, code: 'TOOL_UNAVAILABLE' };
  expect(await replacement.resolveUnavailableStep(run.runId, run.taskId, id)).toEqual(expected);
  expect(await replacement.resolveUnavailableStep(run.runId, run.taskId, id)).toEqual(expected);
  expect(await activity(run.runId, 'tool.result')).toHaveLength(1);
  expect(script.calls).toBe(1);
});

it('does not reserve a fifth dispatch or reset permits when ownership changes', async () => {
  const script = scriptedModel();
  const first = await newRun(script);
  const second = await newRun(script);
  const supervisor = await owner(script);
  const specialist = { subject: { kind: 'source' as const }, role: 'identity' as const, question: 'Inspect identity.', dependencyIds: [] };
  const children = await Promise.all([supervisor.addTestSpecialist!(first.runId, specialist),
    supervisor.addTestSpecialist!(first.runId, specialist), supervisor.addTestSpecialist!(second.runId, specialist)]);
  const childIds = children.map(result => {
    if (!result?.taskId) throw new Error('Expected specialist');
    return result.taskId;
  });
  const taskKeys = [[first.runId, first.taskId], [first.runId, childIds[0]], [first.runId, childIds[1]],
    [second.runId, second.taskId], [second.runId, childIds[2]]];
  const calls = taskKeys.slice(0, 4).map(([runId, taskId]) => supervisor.dispatchTask(runId, taskId)!);
  try {
    await Promise.all(calls.map((_, index) => script.at(index).turn.promise));
    const [runId, taskId] = taskKeys[4];
    expect(supervisor.dispatchTask(runId, taskId)).toBeUndefined();
    await calls[0].timeout();
    expect(supervisor.dispatchTask(runId, taskId)).toBeUndefined();
    expect(await dispatchRows(runId)).toHaveLength(1);
    script.at(0).result.reject(new Error('late rejection'));
    await calls[0].done;
    const fifth = supervisor.dispatchTask(runId, taskId)!;
    await script.at(4).turn.promise;
    calls.push(fifth);
    expect(await dispatchRows(runId)).toHaveLength(2);
    expect(await acquireDiscoverySupervisor({ ...options(), model: script.model })).toBeUndefined();
    await supervisor.close();
    const replacement = await owner(script);
    // Three original calls and the fifth invocation still hold their permits.
    const third = await newRun(script);
    expect(replacement.dispatchTask(third.runId, third.taskId)).toBeUndefined();
    script.at(1).result.reject(new Error('old owner rejection'));
    await calls[1].done;
    const sixth = replacement.dispatchTask(third.runId, third.taskId)!;
    const turn = await script.at(5).turn.promise;
    script.at(5).result.resolve({ ...modelResult(turn), dispatchId: 'wrong-dispatch' });
    await sixth.done;
    expect(await third.state()).toMatchObject({ status: 'blocked', usage: { unknownUsageCalls: 1 } });
  } finally {
    for (let index = 0; index < script.calls; index++) script.at(index).result.reject(new Error('settle held call'));
    await Promise.all(calls.map(call => call.done));
  }
});

it('checks action CAS and key collisions and rolls back action plus activity on publication failure', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const original = await run.state();
  const key = { schemaVersion: 2 as const, expectedRevision: original.revision, idempotencyKey: randomUUID() };
  const broken = createDiscoveryRepository({ ...options(), clock: () => new Date(NaN) });
  const counter = async () => (await system.db.control.query('SELECT sequence FROM activity_counter')).rows;
  const before = await counter();
  await expect(broken.action(run.runId, actor, 'pause', key)).rejects.toThrow();
  expect(await counter()).toEqual(before);
  expect(await run.state()).toEqual(original);
  expect(await activity(run.runId, 'discovery.paused')).toHaveLength(0);
  const paused = await run.repository.action(run.runId, actor, 'pause', key);
  await expect(run.repository.action(run.runId, actor, 'resume', key)).rejects.toMatchObject({ statusCode: 409 });
  await expect(run.repository.action(run.runId, actor, 'pause', { ...key, idempotencyKey: randomUUID() }))
    .rejects.toMatchObject({ statusCode: 409 });
  const resumed = await run.action('resume');
  expect(await run.repository.action(run.runId, actor, 'pause', key)).toEqual(paused);
  expect(await run.state()).toEqual(resumed);
});

async function terminateOwner() {
  const db = system.db.control;
  const { rows: [lock] } = await db.query<{ pid: number }>(`SELECT pid FROM pg_locks
    WHERE locktype='advisory' AND classid=1161908306 AND objid=4
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND granted`);
  // The disposable application role can terminate another session of the same role.
  const { rows: [result] } = await db.query('SELECT pg_terminate_backend($1,5000) AS terminated', [lock.pid]);
  expect(result.terminated).toBe(true);
}

it('reconciles on backend termination and rejects an old callback with the app pool healthy', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const supervisor = await owner(script);
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  const turn = await script.at(0).turn.promise;
  try {
    await terminateOwner();
    const replacement = await owner(script);
    expect(replacement.generation).toBeGreaterThan(supervisor.generation);
    const recovered = await run.state();
    expect(recovered).toMatchObject({ status: 'blocked', usage: { unknownUsageCalls: 1 }, tasks: [{ attempt: 1, status: 'interrupted' }] });
    expect(await dispatchRows(run.runId)).toMatchObject([{ state: 'interrupted', accounting: 'unknown' }]);
    script.at(0).result.resolve(modelResult(turn, [toolCall]));
    await call.done;
    expect(await stepRows(run.runId)).toEqual([]);
    await replacement.reconcile();
    await replacement.reconcile();
    expect(await run.state()).toEqual(recovered);
    expect(await activity(run.runId, 'discovery.interrupted')).toHaveLength(1);
  } finally {
    script.at(0).result.reject(new Error('settle held call'));
    await call.done;
  }
});

it('rolls back before reservation commit and accounts reserved-before-call crash as unknown', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const before = await run.state();
  const counterBefore = (await system.db.control.query('SELECT sequence FROM activity_counter')).rows;
  const entered = barrier<void>();
  const release = barrier<void>();
  const failing = await owner(script, { beforeReservationCommit: async () => {
    entered.resolve();
    await release.promise;
    throw new Error('abort reservation transaction');
  } });
  const failure = failing.dispatchTask(run.runId, run.taskId)!;
  const asserted = expect(failure.done).rejects.toThrow('abort reservation transaction');
  await entered.promise;
  expect(await dispatchRows(run.runId)).toEqual([]);
  expect(await activity(run.runId, 'task.started')).toEqual([]);
  release.resolve();
  await asserted;
  expect((await system.db.control.query('SELECT sequence FROM activity_counter')).rows).toEqual(counterBefore);
  expect(await run.state()).toEqual(before);
  await failing.close();

  const uncommitted = barrier<void>();
  const resumeTransaction = barrier<void>();
  const crashing = await owner(script, { beforeReservationCommit: async () => {
    uncommitted.resolve();
    await resumeTransaction.promise;
  } });
  const pending = crashing.dispatchTask(run.runId, run.taskId)!;
  await uncommitted.promise;
  try {
    await terminateOwner();
  } finally {
    resumeTransaction.resolve();
    await pending.done;
  }
  expect(await dispatchRows(run.runId)).toEqual([]);
  expect(await run.state()).toEqual(before);
  expect((await system.db.control.query('SELECT sequence FROM activity_counter')).rows).toEqual(counterBefore);

  const committed = barrier<void>();
  const invoke = barrier<void>();
  const reserving = await owner(script, { afterReservationCommit: async () => { committed.resolve(); await invoke.promise; } });
  const abandoned = reserving.dispatchTask(run.runId, run.taskId)!;
  await committed.promise;
  expect(await dispatchRows(run.runId)).toMatchObject([{ state: 'reserved', attempt: 1 }]);
  await reserving.close();
  const replacement = await owner(script);
  invoke.resolve();
  await abandoned.done;
  expect(script.calls).toBe(0);
  const recovered = await run.state();
  expect(recovered).toMatchObject({ status: 'blocked', usage: { modelCalls: 1, unknownUsageCalls: 1 } });
  await replacement.reconcile();
  expect(await run.state()).toEqual(recovered);
  expect(await activity(run.runId, 'task.started')).toHaveLength(1);
});

it('denies a scheduler claim queued behind the transaction that commits pause', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const supervisor = await owner(script);
  const lock = await system.db.control.connect();
  let wait: Promise<unknown> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM discovery_runs WHERE id=$1 FOR UPDATE', [run.runId]);
    const paused = run.action('pause');
    // Both operations block on the held tuple; enqueue the reviewer before the scheduler.
    await waitForBlockedQuery(lock, 'SELECT * FROM discovery_runs WHERE id = $1 FOR UPDATE', 1);
    wait = supervisor.dispatchTask(run.runId, run.taskId)!.done;
    await waitForBlockedQuery(lock, 'SELECT * FROM discovery_runs WHERE id = $1 FOR UPDATE', 2);
    await lock.query('COMMIT');
    expect((await paused).status).toBe('paused');
    await wait;
    expect(await dispatchRows(run.runId)).toEqual([]);
    expect(script.calls).toBe(0);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await wait;
  }
});

async function waitForBlockedQuery(client: PoolClient, query: string, count: number) {
  const signal = AbortSignal.timeout(5000);
  while (!signal.aborted) {
    await client.query('SELECT pg_stat_clear_snapshot()');
    const { rows: [result] } = await client.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity
      WHERE datname=current_database() AND query=$1 AND wait_event_type='Lock'`, [query]);
    if (Number(result.count) === count) return;
  }
  throw new Error('PostgreSQL transaction did not reach the lock barrier');
}

it('preserves reused native IDs across rounds and rejects altered duplicate results before any further tool effect', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const supervisor = await owner(script);
  const invocation = supervisor.dispatchTask(run.runId, run.taskId)!;
  const turn = await script.at(0).turn.promise;
  const result = modelResult(turn, [toolCall]);
  script.at(0).result.resolve(result);
  await invocation.done;
  const before = await run.state();
  await invocation.replayTestResult!(result);
  await expect(invocation.replayTestResult!({ ...result, toolCalls: [{ ...toolCall, arguments: { changed: true } }] }))
    .rejects.toMatchObject({ statusCode: 409 });
  expect(await run.state()).toEqual(before);
  expect(await activity(run.runId, 'tool.called')).toEqual([]);
  const firstStep = createToolStepId({ dispatchId: turn.dispatchId, providerToolCallId: toolCall.id });
  await supervisor.resolveUnavailableStep(run.runId, run.taskId, firstStep);
  const second = supervisor.dispatchTask(run.runId, run.taskId)!;
  const nextTurn = await script.at(1).turn.promise;
  script.at(1).result.resolve(modelResult(nextTurn, [{ ...toolCall, name: 'arbitraryShell' }]));
  await second.done;
  const secondStep = createToolStepId({ dispatchId: nextTurn.dispatchId, providerToolCallId: toolCall.id });
  expect(secondStep).not.toBe(firstStep);
  const rows = await stepRows(run.runId);
  expect(rows).toHaveLength(2);
  expect(rows.map(row => row.id)).toEqual(expect.arrayContaining([firstStep, secondStep]));
  expect(await supervisor.resolveUnavailableStep(run.runId, run.taskId, secondStep)).toEqual({ ok: false, code: 'TOOL_FORBIDDEN' });
  expect(await activity(run.runId, 'tool.result')).toHaveLength(2);
});

it('keeps independent known usage but accepts no malformed or over-budget batch', async () => {
  const script = scriptedModel();
  const first = await newRun(script);
  const second = await newRun(script);
  const third = await newRun(script);
  const supervisor = await owner(script);
  for (const [index, run] of [first, second, third].entries()) {
    const call = supervisor.dispatchTask(run.runId, run.taskId)!;
    const turn = await script.at(index).turn.promise;
    const result = modelResult(turn, [toolCall]);
    if (index === 0) script.at(index).result.resolve({ ...result, toolCalls: [toolCall, toolCall] });
    if (index === 1) script.at(index).result.resolve({ ...result, usage: { inputTokens: 8193, outputTokens: 7 } });
    if (index === 2) script.at(index).result.resolve({ ...result, message: '\0' });
    await call.done;
    expect(await stepRows(run.runId)).toEqual([]);
    expect(await dispatchRows(run.runId)).toMatchObject([{ state: 'returned', accepted: null, accounting: 'known' }]);
    expect(await run.state()).toMatchObject({ status: 'blocked', diagnostics: [{ code: 'MODEL_INVALID_RESULT' }],
      usage: { inputTokens: index === 1 ? 8193 : 11, outputTokens: 7, unknownUsageCalls: 0 } });
  }
});

it('reserves the last attempt once, preserves an exhausted round across restart, and permits a ninth done turn', async () => {
  const script = scriptedModel();
  const last = await newRun(script);
  const done = await newRun(script);
  const supervisor = await owner(script);
  const db = system.db.control;
  await db.query('UPDATE discovery_tasks SET attempt=8,tool_rounds=7 WHERE id=$1', [last.taskId]);
  await db.query('UPDATE discovery_tasks SET attempt=8,tool_rounds=8 WHERE id=$1', [done.taskId]);
  const first = supervisor.dispatchTask(last.runId, last.taskId)!;
  const competing = supervisor.dispatchTask(last.runId, last.taskId)!;
  const turn = await script.at(0).turn.promise;
  await competing.done;
  expect(await dispatchRows(last.runId)).toMatchObject([{ attempt: 9, state: 'reserved' }]);
  script.at(0).result.resolve(modelResult(turn, [toolCall]));
  await first.done;
  const [step] = await stepRows(last.runId);
  await supervisor.resolveUnavailableStep(last.runId, last.taskId, step.id);
  await supervisor.dispatchTask(last.runId, last.taskId)?.done;
  expect(await last.state()).toMatchObject({ status: 'blocked', tasks: [{ attempt: 9, toolRounds: 8,
    diagnosticCodes: ['MODEL_ATTEMPT_LIMIT'] }] });
  expect(await activity(last.runId, 'task.blocked')).toMatchObject([{ event: {
    payload: { count: 9, toolRounds: 8, status: 'blocked', diagnosticCodes: ['MODEL_ATTEMPT_LIMIT'] },
  } }]);
  await last.action('pause');
  const blocked = await last.action('resume');
  const call = supervisor.dispatchTask(done.runId, done.taskId)!;
  script.at(1).result.resolve(modelResult(await script.at(1).turn.promise));
  await call.done;
  const succeeded = await done.state();
  expect(succeeded).toMatchObject({ status: 'blocked', tasks: [{ status: 'succeeded', attempt: 9, toolRounds: 8 }],
    diagnostics: [{ code: 'CONSTRUCTION_UNAVAILABLE' }] });
  await supervisor.close();
  const replacement = await owner(script);
  await replacement.dispatchTask(last.runId, last.taskId)?.done;
  await replacement.dispatchTask(done.runId, done.taskId)?.done;
  expect(await last.state()).toEqual(blocked);
  expect(await done.state()).toEqual(succeeded);
  expect(script.calls).toBe(2);
});

it('blocks a ninth tool-bearing result without accepting or applying any batch step', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  await system.db.control.query('UPDATE discovery_tasks SET attempt=8,tool_rounds=8 WHERE id=$1', [run.taskId]);
  const supervisor = await owner(script);
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  const turn = await script.at(0).turn.promise;
  script.at(0).result.resolve(modelResult(turn, [toolCall]));
  await call.done;
  expect(await stepRows(run.runId)).toEqual([]);
  expect(await run.state()).toMatchObject({ status: 'blocked', tasks: [{ attempt: 9, toolRounds: 8 }],
    usage: { inputTokens: 11, unknownUsageCalls: 0 }, diagnostics: [{ code: 'MODEL_TOOL_ROUND_LIMIT' }] });
});

it('shares an investigation budget, prevents cross-run dependencies, and checks repair storage ceilings', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const other = await newRun(script);
  const supervisor = await owner(script);
  const db = system.db.control;
  const specialist = { subject: { kind: 'source_account' as const, sellerEntityId: 'seller', sourceAccountId: 'acct' },
    role: 'identity' as const, question: 'Investigate account evidence.', dependencyIds: [] };
  await expect(supervisor.addTestSpecialist!(run.runId, { ...specialist, dependencyIds: [other.taskId] })).rejects
    .toMatchObject({ statusCode: 409 });
  await expect(db.query('INSERT INTO discovery_task_dependencies VALUES ($1,$2,$3)', [run.runId, run.taskId, other.taskId]))
    .rejects.toMatchObject({ code: '23503' });
  const [first, second] = await Promise.all([
    supervisor.addTestSpecialist!(run.runId, specialist),
    supervisor.addTestSpecialist!(run.runId, specialist),
  ]);
  expect(first?.investigationId).toBe(second?.investigationId);
  expect(first?.taskId).not.toBe(second?.taskId);
  const investigationId = first?.investigationId;
  await db.query('UPDATE discovery_investigations SET specialist_count=9 WHERE id=$1', [investigationId]);
  const results = await Promise.all([
    supervisor.addTestSpecialist!(run.runId, specialist),
    supervisor.addTestSpecialist!(run.runId, specialist),
  ]);
  expect(results[0]).toHaveProperty('taskId');
  expect(results[1]).toEqual({ blocker: 'SPECIALIST_LIMIT' });
  const { rows } = await db.query('SELECT specialist_count FROM discovery_investigations WHERE id=$1', [investigationId]);
  expect(rows).toEqual([{ specialist_count: 10 }]);
  await expect(db.query(`INSERT INTO discovery_investigations (run_id,id,seller_entity_id,source_account_id,repair_count)
    VALUES ($1,$2,'seller','other',3)`, [run.runId, randomUUID()])).rejects.toMatchObject({ code: '23514' });
  await expect(db.query(`INSERT INTO discovery_tasks (run_id,id,investigation_id,role,question,grants,repair_round)
    VALUES ($1,$2,$3,'identity','repair',$4,3)`, [run.runId, randomUUID(), investigationId, grants])).rejects.toMatchObject({ code: '23514' });
  await db.query(`INSERT INTO discovery_investigations (run_id,id,seller_entity_id,source_account_id,repair_count)
    VALUES ($1,$2,'seller','other',2)`, [run.runId, randomUUID()]);
  const status = await run.state();
  expect(status).toMatchObject({ status: 'blocked', diagnostics: [{ code: 'SPECIALIST_LIMIT' }] });
  await run.action('pause');
  expect(await run.action('resume')).toMatchObject({ status: 'blocked', diagnostics: status.diagnostics });
});

it('keeps a dependent task waiting with its own durable blocker after predecessor interruption', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const supervisor = await owner(script);
  const result = await supervisor.addTestSpecialist!(run.runId, { subject: { kind: 'source' }, role: 'identity',
    question: 'Wait for the coordinator.', dependencyIds: [run.taskId] });
  const child = result?.taskId;
  if (!child) throw new Error('Expected dependent task');
  await supervisor.dispatchTask(run.runId, child)?.done;
  expect(script.calls).toBe(0);
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  const turn = await script.at(0).turn.promise;
  await call.timeout();
  script.at(0).result.resolve(modelResult(turn));
  await call.done;
  expect((await run.state()).tasks.find(task => task.id === child)).toMatchObject({
    attempt: 0, status: 'waiting', diagnosticCodes: ['DEPENDENCY_BLOCKED'],
  });
});

it('denies revoked authority, forged task grants, and role-incompatible deferred tools', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const repository = createDiscoveryRepository({ ...options(), resolveAuthority: () => undefined });
  await expect(repository.readState(run.runId, actor)).rejects.toMatchObject({ statusCode: 403 });
  await expect(repository.action(run.runId, actor, 'pause', {
    schemaVersion: 2, expectedRevision: 1, idempotencyKey: randomUUID(),
  })).rejects.toMatchObject({ statusCode: 403 });
  let current = false;
  const supervisor = await acquireDiscoverySupervisor({
    ...options(), model: script.model, testHooks: {},
    resolveAuthority: () => current ? { ...grants, allowedAccountIds: ['later-account'] } : undefined,
  });
  if (!supervisor) throw new Error('Expected discovery ownership');
  supervisors.push(supervisor);
  await supervisor.dispatchTask(run.runId, run.taskId)?.done;
  expect(await dispatchRows(run.runId)).toEqual([]);

  current = true;
  const child = await supervisor.addTestSpecialist!(run.runId, { subject: { kind: 'source' }, role: 'identity',
    question: 'Examine the source.', dependencyIds: [] });
  if (!child?.taskId) throw new Error('Expected specialist');
  const forgedId = randomUUID();
  await system.db.control.query(`INSERT INTO discovery_tasks (run_id,id,investigation_id,role,question,grants)
    VALUES($1,$2,$3,'identity','forged',$4)`, [run.runId, forgedId, child.investigationId, {
      ...grants, allowedAccountIds: ['later-account'],
    }]);
  const forged = supervisor.dispatchTask(run.runId, forgedId)!;
  let checkingForged = true;
  const proof = await Promise.race([forged.done.then(() => 'denied'), script.at(0).turn.promise.then(turn => {
    if (checkingForged) script.at(0).result.resolve(modelResult(turn));
    return 'invoked';
  })]);
  checkingForged = false;
  await forged.done;
  expect(proof).toBe('denied');
  expect(await dispatchRows(run.runId)).toEqual([]);

  const call = supervisor.dispatchTask(run.runId, child.taskId)!;
  const turn = await script.at(0).turn.promise;
  script.at(0).result.resolve(modelResult(turn, [toolCall]));
  await call.done;
  const [step] = await stepRows(run.runId);
  expect(await supervisor.resolveUnavailableStep(run.runId, child.taskId, step.id))
    .toEqual({ ok: false, code: 'TOOL_FORBIDDEN' });
});

it('preserves the final source-account investigation slot under competing creation', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const supervisor = await owner(script);
  const db = system.db.control;
  const input = { role: 'identity' as const, question: 'Investigate a pinned account.', dependencyIds: [] };
  for (let index = 0; index < 19; index++) {
    const created = await supervisor.addTestSpecialist!(run.runId, {
      ...input, subject: { kind: 'source_account', sellerEntityId: 'seller', sourceAccountId: 'account-' + index },
    });
    expect(created).toHaveProperty('taskId');
  }
  const remaining = await Promise.all([19, 20].map(index => supervisor.addTestSpecialist!(run.runId, {
    ...input, subject: { kind: 'source_account', sellerEntityId: 'seller', sourceAccountId: 'account-' + index },
  })));
  expect(remaining[0]).toHaveProperty('taskId');
  expect(remaining[1]).toEqual({ blocker: 'INVESTIGATION_LIMIT' });
  const { rows } = await db.query('SELECT count(*)::int AS count FROM discovery_investigations WHERE run_id=$1', [run.runId]);
  expect(rows).toEqual([{ count: 21 }]);
  expect(await run.state()).toMatchObject({ status: 'blocked', diagnostics: [{ code: 'INVESTIGATION_LIMIT' }] });
});
