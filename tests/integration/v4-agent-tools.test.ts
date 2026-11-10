import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createToolStepId } from '../../packages/contracts/src/index.js';
import { acquireDiscoverySupervisor } from '../../packages/discovery/src/supervisor.js';
import { createDiscoveryRepository } from '../../packages/discovery/src/repository.js';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { barrier, modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

let system: Awaited<ReturnType<typeof createTestSystem>>;
beforeAll(async () => {
  system = await createTestSystem({ modelMode: 'stub', dbNamespace: testNamespace('v4tools') });
}, 30000);
afterAll(async () => { await system?.close(); });

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

type Supervisor = NonNullable<Awaited<ReturnType<typeof acquireDiscoverySupervisor>>>;
const supervisors: Supervisor[] = [];

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

async function stepRows(runId: string) {
  return (await system.db.control.query(
    `SELECT id,name,state,result FROM discovery_tool_steps WHERE run_id=$1 ORDER BY ordinal,id`, [runId])).rows;
}

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) await supervisor.close();
});

it('denies unknown and role-incompatible tools while keeping repair/finish unavailable', async () => {
  const script = scriptedModel();
  expect(script.model.mode).toBe('scripted');
  const run = await newRun(script);
  const supervisor = await owner(script);
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  const turn = await script.at(0).turn.promise;
  // Without capture injection the supervisor advertises no live tool schemas; permission
  // still fences model-chosen names through the durable unavailable/forbidden path.
  expect(turn.toolSchemas).toEqual([]);
  script.at(0).result.resolve(modelResult(turn, [
    { id: 'shell', name: 'shell', arguments: {} },
    { id: 'repair', name: 'beginRepair', arguments: {} },
    { id: 'finish', name: 'finishRun', arguments: {} },
  ]));
  await call.done;
  const steps = await stepRows(run.runId);
  expect(steps).toHaveLength(3);
  const byNative = Object.fromEntries(steps.map(step => [step.name, step]));
  expect(await supervisor.resolveUnavailableStep(run.runId, run.taskId, byNative.shell.id))
    .toEqual({ ok: false, code: 'TOOL_FORBIDDEN' });
  expect(await supervisor.resolveUnavailableStep(run.runId, run.taskId, byNative.beginRepair.id))
    .toEqual({ ok: false, code: 'TOOL_UNAVAILABLE' });
  expect(await supervisor.resolveUnavailableStep(run.runId, run.taskId, byNative.finishRun.id))
    .toEqual({ ok: false, code: 'TOOL_UNAVAILABLE' });

  const child = await supervisor.addTestSpecialist!(run.runId, {
    subject: { kind: 'source' }, role: 'identity', question: 'Inspect without coordinator tools.', dependencyIds: [],
  });
  if (!child?.taskId) throw new Error('Expected specialist');
  const specialist = supervisor.dispatchTask(run.runId, child.taskId)!;
  const specialistTurn = await script.at(1).turn.promise;
  expect(specialistTurn.toolSchemas).toEqual([]);
  script.at(1).result.resolve(modelResult(specialistTurn, [
    { id: 'delegate', name: 'delegateTask', arguments: {} },
    { id: 'repair', name: 'beginRepair', arguments: {} },
  ]));
  await specialist.done;
  const specialistSteps = (await stepRows(run.runId)).filter(step => step.name === 'delegateTask' ||
    (step.name === 'beginRepair' && step.id !== byNative.beginRepair.id));
  expect(specialistSteps).toHaveLength(2);
  for (const step of specialistSteps) {
    expect(await supervisor.resolveUnavailableStep(run.runId, child.taskId, step.id))
      .toEqual({ ok: false, code: 'TOOL_FORBIDDEN' });
  }
  const activity = JSON.stringify((await system.db.control.query(
    "SELECT event FROM activity_events WHERE event->>'runId'=$1", [run.runId])).rows);
  expect(activity).not.toMatch(/OPENAI_|EAPR_MODEL_|API_KEY|process\.env/i);
});

it('stops at attempt and tool-round budgets without accepting further tool steps', async () => {
  const script = scriptedModel();
  const attempts = await newRun(script);
  const rounds = await newRun(script);
  const supervisor = await owner(script);
  await system.db.control.query('UPDATE discovery_tasks SET attempt=8,tool_rounds=7 WHERE id=$1', [attempts.taskId]);
  await system.db.control.query('UPDATE discovery_tasks SET attempt=8,tool_rounds=8 WHERE id=$1', [rounds.taskId]);

  const attemptCall = supervisor.dispatchTask(attempts.runId, attempts.taskId)!;
  const attemptTurn = await script.at(0).turn.promise;
  script.at(0).result.resolve(modelResult(attemptTurn, [{ id: 'call-1', name: 'delegateTask', arguments: {} }]));
  await attemptCall.done;
  const [attemptStep] = await stepRows(attempts.runId);
  await supervisor.resolveUnavailableStep(attempts.runId, attempts.taskId, attemptStep.id);
  await supervisor.dispatchTask(attempts.runId, attempts.taskId)?.done;
  expect(await attempts.state()).toMatchObject({
    status: 'blocked',
    tasks: [{ attempt: 9, toolRounds: 8, diagnosticCodes: ['MODEL_ATTEMPT_LIMIT'] }],
  });
  const before = script.calls;
  await supervisor.dispatchTask(attempts.runId, attempts.taskId)?.done;
  expect(script.calls).toBe(before);
  expect(await attempts.state()).toMatchObject({
    status: 'blocked',
    tasks: [{ attempt: 9, toolRounds: 8, diagnosticCodes: ['MODEL_ATTEMPT_LIMIT'] }],
  });

  const roundCall = supervisor.dispatchTask(rounds.runId, rounds.taskId)!;
  const roundTurn = await script.at(1).turn.promise;
  script.at(1).result.resolve(modelResult(roundTurn, [{ id: 'call-1', name: 'delegateTask', arguments: {} }]));
  await roundCall.done;
  expect(await stepRows(rounds.runId)).toEqual([]);
  expect(await rounds.state()).toMatchObject({
    status: 'blocked',
    tasks: [{ attempt: 9, toolRounds: 8 }],
    diagnostics: [{ code: 'MODEL_TOOL_ROUND_LIMIT' }],
  });
});

it('preserves pending tool steps and budgets across pause and resume', async () => {
  const script = scriptedModel();
  const run = await newRun(script);
  const reserved = barrier<void>();
  const supervisor = await owner(script, { afterReservationCommit: async () => reserved.resolve() });
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  const turn = await script.at(0).turn.promise;
  await reserved.promise;
  const paused = await run.action('pause');
  script.at(0).result.resolve(modelResult(turn, [
    { id: 'call-1', name: 'beginRepair', arguments: {} },
    { id: 'shell', name: 'shell', arguments: {} },
  ]));
  await call.done;
  const pending = await run.state();
  expect(pending.revision).toBe(paused.revision + 1);
  expect(pending).toMatchObject({
    status: 'paused',
    usage: { modelCalls: 1, inputTokens: 11, outputTokens: 7, unknownUsageCalls: 0 },
    tasks: [{ attempt: 1, toolRounds: 1, status: 'running' }],
  });
  const steps = await stepRows(run.runId);
  expect(steps).toMatchObject([
    { name: 'beginRepair', state: 'pending', result: null },
    { name: 'shell', state: 'pending', result: null },
  ]);
  expect(await supervisor.resolveUnavailableStep(run.runId, run.taskId, steps[0].id)).toBeUndefined();

  const resumed = await run.action('resume');
  expect(resumed).toMatchObject({
    status: 'queued',
    usage: { modelCalls: 1, inputTokens: 11, outputTokens: 7, unknownUsageCalls: 0 },
    tasks: [{ attempt: 1, toolRounds: 1, status: 'running' }],
  });
  expect(await stepRows(run.runId)).toMatchObject([
    { id: steps[0].id, name: 'beginRepair', state: 'pending', result: null },
    { id: steps[1].id, name: 'shell', state: 'pending', result: null },
  ]);
  expect(await supervisor.resolveUnavailableStep(run.runId, run.taskId, steps[0].id))
    .toEqual({ ok: false, code: 'TOOL_UNAVAILABLE' });
  expect(await supervisor.resolveUnavailableStep(run.runId, run.taskId, steps[1].id))
    .toEqual({ ok: false, code: 'TOOL_FORBIDDEN' });
  expect(await supervisor.resolveUnavailableStep(run.runId, run.taskId, steps[0].id))
    .toEqual({ ok: false, code: 'TOOL_UNAVAILABLE' });

  expect(await run.state()).toMatchObject({
    status: 'queued',
    usage: { modelCalls: 1, inputTokens: 11, outputTokens: 7 },
    tasks: [{ attempt: 1, toolRounds: 1, status: 'queued' }],
  });
  const repairId = createToolStepId({ dispatchId: turn.dispatchId, providerToolCallId: 'call-1' });
  expect(steps[0].id).toBe(repairId);
  expect(script.calls).toBe(1);
});

it('keeps packages/discovery free of product env names and live composition mounts', () => {
  const root = join(process.cwd(), 'packages/discovery/src');
  const files = readdirSync(root).filter(name => name.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for (const name of files) {
    const source = readFileSync(join(root, name), 'utf8');
    expect(source, name).not.toMatch(/OPENAI_|ANTHROPIC_|EAPR_MODEL_/);
    if (name === 'live-model-transport.ts' || name === 'live-model-tokens.ts' || name === 'live-model-stub.ts') {
      expect(source, name).not.toMatch(/process\.env/);
      continue;
    }
    expect(source, name).not.toMatch(/process\.env/);
  }
  expect(files).not.toContain('composition.ts');
});
