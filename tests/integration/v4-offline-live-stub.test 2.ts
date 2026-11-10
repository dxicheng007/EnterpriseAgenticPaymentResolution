import { randomUUID } from 'node:crypto';
import { expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { acquireDiscoverySupervisor } from '../../packages/discovery/src/supervisor.js';
import { createDiscoveryRepository } from '../../packages/discovery/src/repository.js';
import { createDiscoveryService } from '../../packages/discovery/src/service.js';
import { offlineLiveModel } from '../../packages/discovery/src/live-model-stub.js';
import { barrier, scriptedModel, modelResult } from '../fixtures/discovery-model.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import type { ModelClient } from '../../packages/discovery/src/model.js';

let system: Awaited<ReturnType<typeof createTestSystem>>;
beforeAll(async () => {
  system = await createTestSystem({ modelMode: 'stub', dbNamespace: testNamespace('v4live') });
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

async function own(model: ModelClient, testHooks: Parameters<typeof acquireDiscoverySupervisor>[0]['testHooks'] = {}) {
  const supervisor = await acquireDiscoverySupervisor({ ...options(), model, testHooks });
  if (!supervisor) throw new Error('Expected discovery ownership');
  supervisors.push(supervisor);
  return supervisor;
}

async function startRun(model: ModelClient) {
  const repository = createDiscoveryRepository(options());
  const { runId } = await repository.start({
    schemaVersion: 2, companyId: binding.companyId, manifestId: binding.manifestId, idempotencyKey: randomUUID(),
  }, actor, { model, readCapture: async () => binding });
  const state = () => repository.readState(runId, actor);
  return { runId, taskId: (await state()).tasks[0].id, repository, state };
}

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) await supervisor.close();
});

it('keeps default composition unavailable without an injected modelClient', async () => {
  const service = await createDiscoveryService({
    ...options(),
    sourceRefForCompany: () => binding.sourceRef,
    readCapture: async () => { throw new Error('unexpected capture'); },
    recheckCapture: async () => undefined,
  });
  try {
    expect(service.capabilities()).toMatchObject({
      mode: 'unconfigured', startAvailable: false,
      diagnostics: [{ code: 'MODEL_UNAVAILABLE' }],
    });
    await expect(service.startDiscovery(
      { reviewerId: actor.reviewerId, allowedSourceRefs: [binding.sourceRef] },
      { schemaVersion: 2, companyId: binding.companyId, manifestId: binding.manifestId, idempotencyKey: 'no-client' },
    )).rejects.toMatchObject({ statusCode: 503, code: 'MODEL_UNAVAILABLE' });
  } finally {
    await service.close();
  }
});

it('fails closed for an injected unconfigured live stub and records MODEL_CALL_FAILED', async () => {
  const model = offlineLiveModel({ configured: false, modelId: 'live-stub' });
  const run = await startRun(model);
  const reserved = barrier<void>();
  const supervisor = await own(model, { afterReservationCommit: async () => reserved.resolve() });
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  await reserved.promise;
  await call.done;
  // Rejected adapter calls have no usage envelope → explicit unknown accounting once.
  expect(await run.state()).toMatchObject({
    status: 'blocked',
    usage: { modelCalls: 1, unknownUsageCalls: 1 },
    tasks: [{ diagnosticCodes: ['MODEL_CALL_FAILED'] }],
    diagnostics: [{ code: 'MODEL_CALL_FAILED' }],
  });
});

it('interrupts a hanging live stub with MODEL_TIMEOUT and unknown usage once', async () => {
  const hang = barrier<void>();
  const model = offlineLiveModel({
    configured: true, modelId: 'live-stub', hangUntilAbort: true, hangUntil: hang.promise,
  });
  const run = await startRun(model);
  const reserved = barrier<void>();
  const supervisor = await own(model, { afterReservationCommit: async () => reserved.resolve() });
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  await reserved.promise;
  await call.timeout();
  const interrupted = await run.state();
  expect(interrupted).toMatchObject({
    status: 'blocked', inFlightModelCalls: 0,
    usage: { modelCalls: 1, unknownUsageCalls: 1, inputTokens: 0, outputTokens: 0 },
    tasks: [{ status: 'interrupted', diagnosticCodes: ['MODEL_TIMEOUT'] }],
    diagnostics: [{ code: 'MODEL_TIMEOUT' }],
  });
  const activity = await system.db.control.query(
    "SELECT event FROM activity_events WHERE event->>'runId'=$1 AND event->>'type'=$2",
    [run.runId, 'discovery.interrupted']);
  expect(activity.rows).toHaveLength(1);
  const payload = JSON.stringify(activity.rows[0].event);
  expect(payload).not.toMatch(/OPENAI_|API_KEY|apiKey|secret|credential/i);
  hang.resolve();
  await call.done;
  expect(await run.state()).toMatchObject({
    usage: { unknownUsageCalls: 1 },
    diagnostics: [{ code: 'MODEL_TIMEOUT' }],
  });
});

it('leaves the scripted fixture path unchanged for a successful turn', async () => {
  const script = scriptedModel();
  expect(script.model.mode).toBe('scripted');
  const run = await startRun(script.model);
  const supervisor = await own(script.model);
  const call = supervisor.dispatchTask(run.runId, run.taskId)!;
  const turn = await script.at(0).turn.promise;
  script.at(0).result.resolve(modelResult(turn));
  await call.done;
  expect(await run.state()).toMatchObject({
    status: 'blocked',
    usage: { modelCalls: 1, unknownUsageCalls: 0, inputTokens: 11, outputTokens: 7 },
  });
});
