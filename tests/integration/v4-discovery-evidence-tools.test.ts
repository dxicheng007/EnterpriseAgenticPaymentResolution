import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createToolStepId, hashCanonical, hashManifest, type BootstrapManifest, type DiscoveryBinding, type ModelResultV2 } from '@eapr/contracts';
import { createEvidenceStore, type EvidenceStore } from '@eapr/evidence';
import { captureBaseline, createDiscoveryReadTools, publishManifest, readDiscoveryCapture, uploadSource } from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { composeDiscovery, recheckDiscoveryCapture } from '../../apps/control/src/discovery-composition.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { createDiscoveryRepository } from '../../packages/discovery/src/repository.js';
import { createDiscoveryService } from '../../packages/discovery/src/service.js';
import type { DiscoveryReadTools } from '../../packages/discovery/src/read-tools.js';
import { acquireDiscoverySupervisor } from '../../packages/discovery/src/supervisor.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { barrier, modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { testNamespace } from '../fixtures/harness.js';

const namespace = testNamespace('discevidence');
const clock = () => new Date('2026-11-08T00:00:00.000Z');
const reviewer = { reviewerId: 'demo-reviewer', allowedSourceRefs: ['legacy-a', 'legacy-b'], allowedAccountIds: [] };
const base = '/api/discovery/runs';
const webOrigin = 'http://127.0.0.1:5179';
let db: Pool;
let admin: Pool;
let runtime: Pool;
let directory: string;
let provisioned = false;
let store: EvidenceStore;
let captures: Awaited<ReturnType<typeof loadDemo>>['captures'];
let runtimeBefore: string;
let enabled = true;

async function runtimeFingerprint() {
  const { rows } = await runtime.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  return hashCanonical(await Promise.all(rows.map(async ({ tablename }) => {
    if (!/^[a-z_][a-z_0-9]*$/.test(tablename)) throw new Error('Unexpected runtime table');
    return [tablename, (await runtime.query('SELECT to_jsonb(t) AS row FROM ' + tablename + ' t ORDER BY 1')).rows];
  })));
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'eapr-discovery-evidence-'));
  await startNativeDb();
  const pair = await provisionTest(namespace);
  provisioned = true;
  await migrate(pair, migrationStreams, readMigrationCatalog());
  db = new Pool({ connectionString: pair.control.appUrl });
  admin = new Pool({ connectionString: pair.control.migrationUrl, statement_timeout: 3000 });
  runtime = new Pool({ connectionString: pair.runtime.migrationUrl });
  store = await createEvidenceStore(join(directory, 'evidence'));
  ({ captures } = await loadDemo({ db, store, clock }, {
    visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'protected'),
  }));
  runtimeBefore = await runtimeFingerprint();
});

afterAll(async () => {
  try {
    if (runtimeBefore) expect(await runtimeFingerprint()).toBe(runtimeBefore);
  } finally {
    await Promise.all([db?.end(), admin?.end(), runtime?.end()]);
    if (provisioned) await dropTest(namespace);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

const resolveAuthority = (reviewerId: string, { companyId, sourceRef }: Pick<DiscoveryBinding, 'companyId' | 'sourceRef'>) =>
  enabled && reviewerId === reviewer.reviewerId && localSourceCatalog.get(companyId)?.sourceRef === sourceRef ?
    { allowedAccountIds: [], sourceRead: { companyId, sourceRef, sourceWide: true, accounts: [] } } : undefined;
const actor = { reviewerId: reviewer.reviewerId, sourceRef: 'legacy-a' };
const captureAccess = {
  readCapture: (selection: Parameters<typeof readDiscoveryCapture>[2]) =>
    readDiscoveryCapture({ db, store }, localSourceCatalog, selection),
  recheckCapture: recheckDiscoveryCapture,
};

function instrumentReads(onFirstBlob?: (invocation: number) => Promise<void>, afterPrepare?: (invocation: number) => Promise<void>) {
  let preparations = 0;
  let blobReads = 0;
  function openAdapter(invocation: number) {
    let first = true;
    return createDiscoveryReadTools({ db, store: {
      async get(hash) {
        blobReads++;
        if (first) {
          first = false;
          await onFirstBlob?.(invocation);
        }
        return store.get(hash);
      },
    } }, localSourceCatalog);
  }
  const readTools: DiscoveryReadTools = {
    async prepare(input) {
      const invocation = ++preparations;
      const prepared = await openAdapter(invocation).prepare(input);
      await afterPrepare?.(invocation);
      return prepared;
    },
    async prepareDocumentApplicability(input) {
      const invocation = ++preparations;
      const prepared = await openAdapter(invocation).prepareDocumentApplicability(input);
      await afterPrepare?.(invocation);
      return prepared;
    },
  };
  return { readTools, get preparations() { return preparations; }, get blobReads() { return blobReads; } };
}

async function acquire(model: ReturnType<typeof scriptedModel>['model'], readTools: DiscoveryReadTools,
  testHooks?: Parameters<typeof acquireDiscoverySupervisor>[0]['testHooks']) {
  const owner = await acquireDiscoverySupervisor({ db, clock, resolveAuthority, model, readTools,
    capture: captureAccess, ...(testHooks ? { testHooks } : {}) });
  if (!owner) throw new Error('Expected exclusive owner');
  return owner;
}

const describeCall = { id: 'native-reused', name: 'describeSource', arguments: {} };
const queryCall = { id: 'query', name: 'querySnapshot', arguments: { limit: 1 } };
function delegate(dependencyIds: string[] = []) {
  return { id: 'delegate', name: 'delegateTask', arguments: {
    subject: { kind: 'source' }, role: 'identity', question: 'Read captured evidence.', dependencyIds,
  } };
}
type Owner = Awaited<ReturnType<typeof acquire>>;

async function createRun(key: string, model: ReturnType<typeof scriptedModel>,
  selection: Pick<DiscoveryBinding, 'companyId' | 'manifestId'> = captures.find(item => item.companyId === 'company-a')!) {
  const repository = createDiscoveryRepository({ db, clock, resolveAuthority });
  const facts = await captureAccess.readCapture(selection);
  const { runId } = await repository.start({
    schemaVersion: 2, companyId: selection.companyId, manifestId: selection.manifestId, idempotencyKey: key,
  }, actor, { model: model.model, readCapture: async () => facts.binding,
    recheckCapture: connection => recheckDiscoveryCapture(connection, facts) });
  const state = () => repository.readState(runId, actor);
  const taskId = (await state()).tasks[0]!.id;
  const action = async (name: 'pause' | 'resume', idempotencyKey: string) =>
    repository.action(runId, actor, name, { schemaVersion: 2, idempotencyKey, expectedRevision: (await state()).revision });
  async function accept(owner: Owner, calls: ModelResultV2['toolCalls'], attemptIndex = 0) {
    const dispatch = owner.dispatchTask(runId, taskId)!;
    const turn = await model.at(attemptIndex).turn.promise;
    model.at(attemptIndex).result.resolve(modelResult(turn, calls));
    await dispatch.done;
    return calls.map(call => createToolStepId({ dispatchId: turn.dispatchId, providerToolCallId: call.id }));
  }
  return { runId, taskId, state, action, accept, facts };
}

async function storedStep(id: string) {
  const { rows: [step] } = await db.query<{ state: string; result: unknown; generation: string }>(
    'SELECT state,result,generation FROM discovery_tool_steps WHERE id=$1', [id]);
  return step;
}

async function toolActivity(runId: string) {
  const { rows } = await db.query<{ event: { type: string; payload: Record<string, unknown> } }>(
    "SELECT event FROM activity_events WHERE event->>'runId'=$1 AND event->>'type' IN ('tool.called','tool.result') ORDER BY sequence",
    [runId]);
  return rows.map(row => row.event);
}

async function assertOwnerOutsideTransaction() {
  const { rows } = await db.query(`SELECT a.state,a.xact_start FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid=l.pid
    WHERE l.locktype='advisory' AND l.classid=1161908306 AND l.objid=4
    AND a.datname=current_database()`);
  expect(rows).toEqual([{ state: 'idle', xact_start: null }]);
}

test.each(['paused', 'runnable', 'paused-prepare', 'runnable-prepare'] as const)(
  'persists revoked authority for an abandoned claimed read during %s recovery', async recovery => {
    const model = scriptedModel();
    const claimed = barrier<void>();
    const releaseClaim = barrier<void>();
    const preparing = barrier<void>();
    const releasePreparation = barrier<void>();
    const paused = recovery.startsWith('paused');
    const duringPreparation = recovery.endsWith('prepare');
    const oldReads = instrumentReads(async invocation => {
      if (invocation !== 2) return;
      claimed.resolve();
      await releaseClaim.promise;
    });
    const holdPreparation = async () => {
      await assertOwnerOutsideTransaction();
      preparing.resolve();
      await releasePreparation.promise;
    };
    const reads = instrumentReads(undefined, !paused && duringPreparation ? holdPreparation : undefined);
    let owner = await acquire(model.model, oldReads.readTools);
    let replacement: ReturnType<typeof acquireDiscoverySupervisor> | undefined;
    let work: Promise<unknown> | undefined;
    let capturePreparations = 0;
    try {
      const run = await createRun('revoked-recovery-' + recovery, model);
      const [id] = await run.accept(owner, [describeCall]);
      const stale = owner.executePendingStep(run.runId, run.taskId, id!);
      await claimed.promise;
      expect(await run.state()).toMatchObject({ inFlightToolSteps: 1 });
      if (paused) await run.action('pause', 'before-owner-loss');
      await owner.close();

      if (!duringPreparation) enabled = false;
      replacement = acquireDiscoverySupervisor({
        db, clock, resolveAuthority, model: model.model, readTools: reads.readTools,
        capture: {
          ...captureAccess,
          async readCapture(selection) {
            capturePreparations++;
            const facts = await captureAccess.readCapture(selection);
            if (paused && duringPreparation) await holdPreparation();
            return facts;
          },
        },
      });
      if (!paused || !duringPreparation) {
        owner = (await replacement)!;
        work = owner.executePendingStep(run.runId, run.taskId, id!);
      }
      if (duringPreparation) {
        await preparing.promise;
        enabled = false;
        releasePreparation.resolve();
      }
      owner = (await replacement)!;
      expect(await work).toBeUndefined();
      releaseClaim.resolve();
      expect(await stale).toBeUndefined();

      enabled = true;
      const diagnostics = [{ code: 'DISCOVERY_FORBIDDEN' }];
      expect(await storedStep(id!)).toMatchObject({ state: 'interrupted', result: null });
      expect(await run.state()).toMatchObject({
        status: paused ? 'paused' : 'blocked', inFlightToolSteps: 0, diagnostics,
        tasks: [{ status: 'interrupted' }],
      });
      expect((await db.query('SELECT diagnostics FROM discovery_tasks WHERE id=$1', [run.taskId])).rows)
        .toEqual([{ diagnostics: ['DISCOVERY_FORBIDDEN'] }]);
      await owner.close();
      owner = await acquire(model.model, reads.readTools);
      if (!paused) await run.action('pause', 'after-owner-loss');
      expect(await run.action('resume', 'after-policy-restore')).toMatchObject({ status: 'blocked', diagnostics });
      expect(await owner.executePendingStep(run.runId, run.taskId, id!)).toBeUndefined();
      await owner.dispatchTask(run.runId, run.taskId)?.done;
      expect(capturePreparations).toBe(paused && duringPreparation ? 1 : 0);
      expect(reads.preparations).toBe(!paused && duringPreparation ? 1 : 0);
      expect(model.calls).toBe(1);
      expect((await toolActivity(run.runId)).map(event => event.type)).toEqual(['tool.called']);
    } finally {
      enabled = true;
      releaseClaim.resolve();
      releasePreparation.resolve();
      await work;
      await (await replacement)?.close();
      await owner.close();
    }
  },
);

test.each(['runnable', 'paused', 'paused-with-blocker'] as const)('refences the same read after owner loss while %s', async disposition => {
  const model = scriptedModel();
  const reads = instrumentReads();
  let owner = await acquire(model.model, reads.readTools);
  try {
    const run = await createRun('owner-loss-' + disposition, model);
    const [id, second] = await run.accept(owner, [describeCall, queryCall]);
    const invoke = () => owner.executePendingStep(run.runId, run.taskId, id!);
    await run.action('pause', 'before-claim');
    expect(await invoke()).toBeUndefined();
    expect(reads.preparations).toBe(0);
    await run.action('resume', 'allow-claim');
    // Two reads preflight before the first claim, followed by a fresh claimed read.
    const first = await invoke();
    expect(reads.preparations).toBe(3);
    expect(first).toMatchObject({ ok: true, binding: run.facts.binding });

    // Barrier the second read's claimed I/O with a fresh adapter and owner.
    await owner.close();
    const claimReached = barrier<void>();
    const claimRelease = barrier<void>();
    const held = instrumentReads(async invocation => {
      if (invocation !== 2) return;
      await assertOwnerOutsideTransaction();
      claimReached.resolve();
      await claimRelease.promise;
    });
    owner = await acquire(model.model, held.readTools);
    try {
      const stale = owner.executePendingStep(run.runId, run.taskId, second!);
      await claimReached.promise;
      expect(await run.state()).toMatchObject({ inFlightToolSteps: 1, usage: { modelCalls: 1, unknownUsageCalls: 0 } });
      if (disposition !== 'runnable') await run.action('pause', 'during-read');
      if (disposition === 'paused-with-blocker') {
        await db.query("UPDATE discovery_runs SET diagnostics=ARRAY['SPECIALIST_LIMIT'],revision=revision+1 WHERE id=$1", [run.runId]);
      }
      await owner.close();
      owner = await acquire(model.model, reads.readTools);
      expect(await storedStep(second!)).toMatchObject({
        state: disposition === 'paused' ? 'pending' : 'interrupted', result: null,
      });
      const earlier = reads.preparations;
      if (disposition === 'paused-with-blocker') {
        expect(await run.state()).toMatchObject({ inFlightToolSteps: 0, status: 'paused',
          diagnostics: [{ code: 'SPECIALIST_LIMIT' }] });
        expect(await run.action('resume', 'blocker-survives')).toMatchObject({ status: 'blocked',
          diagnostics: [{ code: 'SPECIALIST_LIMIT' }] });
        expect(await owner.executePendingStep(run.runId, run.taskId, second!)).toBeUndefined();
        expect(reads.preparations).toBe(earlier);
        claimRelease.resolve();
        expect(await stale).toBeUndefined();
        return;
      }
      expect(await run.state()).toMatchObject({ inFlightToolSteps: 0, diagnostics: [] });
      if (disposition === 'paused') {
        expect((await toolActivity(run.runId)).map(event => event.type)).toEqual(['tool.called', 'tool.result', 'tool.called']);
        expect(await owner.executePendingStep(run.runId, run.taskId, second!)).toBeUndefined();
        expect(reads.preparations).toBe(earlier);
        await run.action('resume', 'after-replacement');
      }
      const replacement = await owner.executePendingStep(run.runId, run.taskId, second!);
      expect(replacement).toMatchObject({ ok: true, events: [expect.any(Object)] });
      const count = reads.blobReads;
      expect(await owner.executePendingStep(run.runId, run.taskId, second!)).toEqual(replacement);
      expect(reads.blobReads).toBe(count);
      claimRelease.resolve();
      expect(await stale).toBeUndefined();
      expect(await storedStep(second!)).toMatchObject({ state: 'succeeded', result: replacement });
      const results = (await toolActivity(run.runId)).filter(event => event.type === 'tool.result');
      expect(results.map(event => event.payload.toolStepId)).toEqual([id, second]);
      expect(await run.state()).toMatchObject({ inFlightToolSteps: 0, diagnostics: [], usage: { modelCalls: 1 },
        tasks: [{ attempt: 1, toolRounds: 1, status: 'queued' }] });
    } finally {
      claimRelease.resolve();
    }
  } finally {
    await owner.close();
  }
});

test.each(['pause', 'revocation', 'revocation-at-commit', 'capture-conflict'] as const)('settles a claimed real read across %s', async condition => {
  const model = scriptedModel();
  const entered = barrier<void>();
  const unblock = barrier<void>();
  const blockClaim = async (invocation: number) => {
    if (invocation !== 2) return;
    await assertOwnerOutsideTransaction();
    entered.resolve();
    await unblock.promise;
  };
  const reads = condition === 'capture-conflict' ? instrumentReads(undefined, blockClaim) :
    condition === 'revocation-at-commit' ? instrumentReads() : instrumentReads(blockClaim);
  let owner = await acquire(model.model, reads.readTools, condition === 'revocation-at-commit' ? {
    async beforeReadResultCommit() {
      entered.resolve();
      await unblock.promise;
    },
  } : undefined);
  let restore = async () => {};
  try {
    const run = await createRun('settle-' + condition, model);
    const [id] = await run.accept(owner, [describeCall]);
    const invoke = () => owner.executePendingStep(run.runId, run.taskId, id!);
    const pending = invoke();
    await entered.promise;
    expect(await run.state()).toMatchObject({ inFlightToolSteps: 1, tasks: [{ status: 'running' }] });
    if (condition.startsWith('revocation')) enabled = false;
    else if (condition === 'pause') await run.action('pause', 'in-flight');
    else {
      const manifestId = run.facts.binding.manifestId;
      const { rows: [row] } = await admin.query('SELECT dossier FROM source_dossiers WHERE manifest_id=$1', [manifestId]);
      await admin.query("UPDATE source_dossiers SET dossier=jsonb_set(dossier,'{complete}','false') WHERE manifest_id=$1", [manifestId]);
      restore = async () => { await admin.query('UPDATE source_dossiers SET dossier=$2 WHERE manifest_id=$1', [manifestId, row.dossier]); };
    }
    unblock.resolve();
    const result = await pending;
    if (condition === 'pause') {
      expect(result).toMatchObject({ ok: true });
      expect(await run.state()).toMatchObject({ inFlightToolSteps: 0, status: 'paused', tasks: [{ status: 'queued' }] });
      const ignored = owner.dispatchTask(run.runId, run.taskId)!;
      await ignored.done;
      expect(model.calls).toBe(1);
      enabled = false;
      expect(await invoke()).toBeUndefined();
      enabled = true;
      expect(await invoke()).toEqual(result);
      expect(reads.preparations).toBe(2);
    } else {
      enabled = true;
      await restore();
      const revoked = condition.startsWith('revocation');
      const code = revoked ? 'DISCOVERY_FORBIDDEN' : 'DISCOVERY_CONFLICT';
      expect(await storedStep(id!)).toMatchObject(revoked ?
        { state: 'interrupted', result: null } : { state: 'failed', result: { ok: false, code } });
      if (revoked) expect((await toolActivity(run.runId)).map(event => event.type)).toEqual(['tool.called']);
      await owner.close();
      owner = await acquire(model.model, reads.readTools);
      await run.action('pause', 'blocked-pause');
      expect(await run.action('resume', 'blocked-resume')).toMatchObject({ inFlightToolSteps: 0, status: 'blocked',
        diagnostics: [{ code }], usage: { modelCalls: 1, unknownUsageCalls: 0 } });
      await invoke();
      expect(reads.preparations).toBe(2);
      const replacementRun = await createRun('new-after-' + condition, model);
      expect(await replacementRun.state()).toMatchObject({ status: 'queued', diagnostics: [], usage: { modelCalls: 0 },
        tasks: [{ attempt: 0, toolRounds: 0 }] });
    }
  } finally {
    enabled = true;
    unblock.resolve();
    await restore();
    await owner.close();
  }
});

test.each([
  { recovered: false, calls: [delegate(), { ...queryCall, arguments: { limit: 1, afterEventId: 'missing' } }], code: 'DISCOVERY_INVALID' },
  { recovered: true, calls: [describeCall, delegate(['missing-task'])], code: 'DISCOVERY_CONFLICT' },
])('rejects a whole mixed batch without effect, recovered=$recovered', async ({ recovered, calls, code }) => {
  const model = scriptedModel();
  const reads = instrumentReads();
  let owner = await acquire(model.model, reads.readTools);
  try {
    const run = await createRun('batch-' + recovered, model);
    const ids = await run.accept(owner, calls);
    if (recovered) {
      await owner.close();
      owner = await acquire(model.model, reads.readTools);
    }
    expect(await owner.executePendingStep(run.runId, run.taskId, ids[0]!)).toEqual({ ok: false, code });
    for (const id of ids) expect(await storedStep(id)).toMatchObject({ state: 'failed', result: { ok: false, code } });
    expect(await toolActivity(run.runId)).toEqual([]);
    expect(await run.state()).toMatchObject({ status: 'blocked', diagnostics: [{ code }], tasks: [{ role: 'coordinator' }] });
    expect(reads.preparations).toBe(1);
  } finally {
    await owner.close();
  }
});

test('rolls back a read result if ownership is lost before commit', async () => {
  const model = scriptedModel();
  const entered = barrier<void>();
  const release = barrier<void>();
  const reads = instrumentReads();
  let owner = await acquire(model.model, reads.readTools, { async beforeReadResultCommit() {
    entered.resolve();
    await release.promise;
  } });
  try {
    const run = await createRun('result-rollback', model);
    const [id] = await run.accept(owner, [describeCall]);
    const invoke = () => owner.executePendingStep(run.runId, run.taskId, id!);
    const pending = invoke();
    await entered.promise;
    expect(await storedStep(id!)).toMatchObject({ state: 'running', result: null });
    expect((await toolActivity(run.runId)).map(event => event.type)).toEqual(['tool.called']);
    const closing = owner.close();
    release.resolve();
    expect(await pending).toBeUndefined();
    await closing;
    owner = await acquire(model.model, reads.readTools);
    expect(await invoke()).toMatchObject({ ok: true });
    expect((await toolActivity(run.runId)).map(event => event.type)).toEqual(['tool.called', 'tool.called', 'tool.result']);
    await owner.close();
    owner = await acquire(model.model, reads.readTools);
    const count = reads.blobReads;
    expect(await invoke()).toMatchObject({ ok: true });
    expect(reads.blobReads).toBe(count);
  } finally {
    release.resolve();
    await owner.close();
  }
});

test.each(['pause', 'authority'] as const)('fences a claim after completed preflight when %s changes', async condition => {
  const model = scriptedModel();
  const entered = barrier<void>();
  const release = barrier<void>();
  const reads = instrumentReads(undefined, async invocation => {
    if (invocation !== 1) return;
    entered.resolve();
    await release.promise;
  });
  const owner = await acquire(model.model, reads.readTools);
  try {
    const run = await createRun('preclaim-' + condition, model);
    const [id] = await run.accept(owner, [describeCall]);
    const invoke = () => owner.executePendingStep(run.runId, run.taskId, id!);
    const pending = invoke();
    await entered.promise;
    if (condition === 'authority') enabled = false;
    else await run.action('pause', 'after-preflight');
    release.resolve();
    expect(await pending).toBeUndefined();
    expect(await storedStep(id!)).toMatchObject({ state: 'pending', result: null });
    expect(await toolActivity(run.runId)).toEqual([]);
    expect(reads.preparations).toBe(1);
    if (condition === 'authority') enabled = true;
    else await run.action('resume', 'after-claim-denied');
    expect(await invoke()).toMatchObject({ ok: true });
  } finally {
    enabled = true;
    release.resolve();
    await owner.close();
  }
});

test('rejects invalid later reader arguments before any original access or delegation', async () => {
  const model = scriptedModel();
  const reads = instrumentReads();
  const owner = await acquire(model.model, reads.readTools);
  try {
    const run = await createRun('strict-batch', model);
    const ids = await run.accept(owner, [delegate(), describeCall, {
      ...queryCall, arguments: { limit: 1, sourceRef: 'legacy-b' },
    }]);
    expect(await owner.executePendingStep(run.runId, run.taskId, ids[0]!)).toEqual({ ok: false, code: 'DISCOVERY_INVALID' });
    expect(reads.preparations).toBe(0);
    expect(reads.blobReads).toBe(0);
    expect(await toolActivity(run.runId)).toEqual([]);
    expect((await run.state()).tasks).toHaveLength(1);
  } finally {
    await owner.close();
  }
});

test('polling replaces a terminated owner while old original I/O is outstanding', async () => {
  const model = scriptedModel();
  const entered = barrier<void>();
  const release = barrier<void>();
  const reads = instrumentReads(async invocation => {
    if (invocation !== 2) return;
    await assertOwnerOutsideTransaction();
    entered.resolve();
    await release.promise;
  });
  const service = await createDiscoveryService({
    db, clock, resolveAuthority, modelClient: { ...model.model, modelId: 'script-auto-recovery' },
    readTools: reads.readTools, ...captureAccess, sourceRefForCompany: companyId => localSourceCatalog.get(companyId)?.sourceRef,
  });
  try {
    const { companyId, manifestId } = captures.find(item => item.companyId === 'company-a')!;
    const { runId } = await service.startDiscovery(reviewer, { schemaVersion: 2, companyId, manifestId, idempotencyKey: 'auto-recovery' });
    const turn = await model.at(0).turn.promise;
    model.at(0).result.resolve(modelResult(turn, [describeCall]));
    await entered.promise;
    expect(await service.readState(reviewer, runId)).toMatchObject({ inFlightToolSteps: 1, usage: { modelCalls: 1 } });
    const { rows: [lock] } = await db.query<{ pid: number }>(`SELECT pid FROM pg_locks
      WHERE locktype='advisory' AND classid=1161908306 AND objid=4
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND granted`);
    expect((await db.query('SELECT pg_terminate_backend($1,5000) AS terminated', [lock.pid])).rows[0].terminated).toBe(true);
    const next = await model.at(1).turn.promise;
    const toolStepId = createToolStepId({ dispatchId: turn.dispatchId, providerToolCallId: describeCall.id });
    expect(next.messages).toContainEqual({ kind: 'tool_result', toolStepId, name: describeCall.name,
      result: expect.objectContaining({ ok: true }) });
    expect(await service.readState(reviewer, runId)).toMatchObject({ inFlightToolSteps: 0, diagnostics: [],
      usage: { modelCalls: 2, unknownUsageCalls: 0 } });
    release.resolve();
    model.at(1).result.resolve(modelResult(next));
    await expect.poll(async () => (await service.readState(reviewer, runId)).status).toBe('blocked');
    expect((await toolActivity(runId)).map(event => event.type)).toEqual(['tool.called', 'tool.called', 'tool.result']);
  } finally {
    release.resolve();
    await service.close();
  }
});

async function captureLongCitation() {
  const { companyId, manifestId } = captures.find(item => item.companyId === 'company-a')!;
  const sourceRef = actor.sourceRef;
  const { rows: [row] } = await db.query<{ manifest: BootstrapManifest }>(
    'SELECT manifest FROM source_manifests WHERE manifest_id=$1', [manifestId]);
  const body = '😀'.repeat(5000);
  const documentId = 'long-discovery-email';
  const dependencies = { db, store, clock };
  const email = await uploadSource(dependencies, {
    companyId, sourceRef, documentId, documentVersion: 1, kind: 'email_json', originalName: 'long.json',
  }, Buffer.from(JSON.stringify({ messageId: documentId, body })));
  const id = 'long-discovery-manifest';
  const draft = { ...row.manifest, id, epoch: row.manifest.epoch + 1,
    streams: row.manifest.streams.map(stream => ({ ...stream, snapshotId: id + ':' + stream.streamId })),
    files: [...row.manifest.files, { fileId: email.fileId, documentId, documentVersion: 1,
      kind: 'email_json' as const, sha256: email.contentHash }],
  };
  await publishManifest(dependencies, localSourceCatalog, { ...draft, hash: hashManifest(draft) }, []);
  const captured = await captureBaseline(dependencies, id);
  if (!captured.ok) throw new Error('Expected captured long citation');
  const { rows: [citation] } = await db.query<{ evidence_id: string }>(
    'SELECT evidence_id FROM source_evidence WHERE snapshot_id=$1 AND file_id=$2', [captured.snapshot.id, email.fileId]);
  return { selection: { companyId, sourceRef, manifestId: id }, evidenceId: citation.evidence_id };
}

test('keeps oversize sticky and rejects an oversized combined transcript without reserving a model attempt', async () => {
  const model = scriptedModel();
  const reads = instrumentReads();
  let owner = await acquire(model.model, reads.readTools);
  try {
    const { selection, evidenceId } = await captureLongCitation();
    const oversized = await createRun('oversized-original', model, selection);
    const read = { id: 'native', name: 'readEvidence', arguments: { evidenceId } };
    const [large] = await oversized.accept(owner, [read]);
    expect(await owner.executePendingStep(oversized.runId, oversized.taskId, large!)).toEqual({ ok: false, code: 'TOOL_RESULT_LIMIT' });
    await owner.close();
    owner = await acquire(model.model, reads.readTools);
    await oversized.action('pause', 'limit-pause');
    expect(await oversized.action('resume', 'limit-resume')).toMatchObject({
      status: 'blocked', diagnostics: [{ code: 'TOOL_RESULT_LIMIT' }], inFlightToolSteps: 0,
    });
    const beforeReplay = reads.blobReads;
    expect(await owner.executePendingStep(oversized.runId, oversized.taskId, large!)).toEqual({ ok: false, code: 'TOOL_RESULT_LIMIT' });
    expect(reads.blobReads).toBe(beforeReplay);

    const bounded = await createRun('bounded-transcript', model, selection);
    const calls = Array.from({ length: 4 }, (_, index) => ({
      ...read, id: 'native-' + index, arguments: { evidenceId, range: { start: 0, end: 8192 } },
    }));
    const usedIds = new Set<string>();
    for (const round of [1, 2]) {
      const ids = await bounded.accept(owner, calls, round);
      for (const id of ids) usedIds.add(id);
      for (const id of ids) {
        const result = await owner.executePendingStep(bounded.runId, bounded.taskId, id);
        expect(result).toMatchObject({ ok: true, text: { value: '😀'.repeat(4096) } });
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(65536);
      }
    }
    expect(usedIds.size).toBe(8);
    await owner.dispatchTask(bounded.runId, bounded.taskId)!.done;
    expect(model.calls).toBe(3);
    expect(await bounded.state()).toMatchObject({ status: 'blocked', diagnostics: [{ code: 'MODEL_STOPPED' }],
      usage: { modelCalls: 2, unknownUsageCalls: 0 }, tasks: [{ status: 'failed', attempt: 2, toolRounds: 2 }] });
    expect((await toolActivity(bounded.runId)).filter(event => event.type === 'tool.result')).toHaveLength(8);
  } finally {
    await owner.close();
  }
});

test('real composition mounts the events cursor and returns only paired reader results to the model', async () => {
  const model = scriptedModel();
  const session = createLocalSessionService({ webOrigin, ...reviewer });
  const app = Fastify();
  await app.register(session.plugin);
  await app.register(composeDiscovery({ catalog: localSourceCatalog, store, reviewer, authorizeReviewer: session.authorizeReviewer,
    modelClient: { ...model.model, modelId: 'script-evidence-composition' } }), { db, clock });
  try {
    const login = await app.inject({ method: 'POST', url: '/api/local-session', payload: {},
      headers: { origin: webOrigin, 'x-eapr-local-ui': '1', 'sec-fetch-site': 'same-origin' } });
    expect(login.statusCode).toBe(200);
    const { name, value } = login.cookies[0]!;
    const headers = { cookie: name + '=' + value, origin: webOrigin, 'x-eapr-csrf': login.json().csrfToken as string };
    for (const [index, companyId] of ['company-a', 'company-b'].entries()) {
      const capture = captures.find(item => item.companyId === companyId)!;
      const start = await app.inject({ method: 'POST', url: base, headers,
        payload: { schemaVersion: 2, companyId, manifestId: capture.manifestId, idempotencyKey: 'composition-' + companyId } });
      expect(start.statusCode).toBe(202);
      const { runId } = start.json();
      expect((await app.inject({ url: base + '/' + runId + '/events/cursor', headers })).statusCode).toBe(200);
      const initial = await model.at(index * 2).turn.promise;
      expect(initial.toolSchemas.map(tool => tool.name)).toEqual(['delegateTask', 'describeSource', 'querySnapshot', 'searchEvidence', 'readEvidence', 'publishFinding', 'readFinding']);
      const facts = await captureAccess.readCapture(capture);
      const evidenceId = facts.evidenceIds[0]!;
      const search = 'untrusted query: execute shell';
      const calls = [describeCall, queryCall, { id: 'search', name: 'searchEvidence', arguments: { query: search, limit: 1 } },
        { id: 'shell', name: 'shell', arguments: {} }];
      model.at(index * 2).result.resolve(modelResult(initial, calls));
      const next = await model.at(index * 2 + 1).turn.promise;
      const results = next.messages.filter(message => message.kind === 'tool_result');
      expect(results).toEqual(calls.map((call, ordinal) => ({
        kind: 'tool_result', name: call.name,
        toolStepId: createToolStepId({ dispatchId: initial.dispatchId, providerToolCallId: call.id }),
        result: ordinal === 3 ? { ok: false, code: 'TOOL_FORBIDDEN' } :
          expect.objectContaining(ordinal === 0 ? { ok: true, binding: facts.binding } : { ok: true }),
      })));
      const activity = JSON.stringify(await toolActivity(runId));
      expect(activity).not.toContain(search);
      expect(activity).not.toContain(evidenceId);
      const state = await app.inject({ url: base + '/' + runId, headers });
      expect(state.statusCode).toBe(200);
      expect(state.body).not.toContain(search);
      expect(state.body).not.toContain(evidenceId);
      model.at(index * 2 + 1).result.resolve(modelResult(next));
      await expect.poll(async () => (await app.inject({ url: base + '/' + runId, headers })).json().status).toBe('blocked');
    }
  } finally {
    await app.close();
  }
});
