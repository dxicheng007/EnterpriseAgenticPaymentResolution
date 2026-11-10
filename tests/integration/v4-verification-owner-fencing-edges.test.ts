import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  createToolStepId, hashCanonical, type DiscoveryBinding, type JsonObject, type ModelResultV2,
  type ProposalResult,
} from '@eapr/contracts';
import { createEvidenceStore, type EvidenceStore } from '@eapr/evidence';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import {
  createDiscoveryReadTools, createSourceService, readDiscoveryCapture, readManifest,
} from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { recheckDiscoveryCapture } from '../../apps/control/src/discovery-composition.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import {
  assertConstructionCapture, type ConstructionCapture,
} from '../../packages/discovery/src/compilation.js';
import { createDiscoveryRepository } from '../../packages/discovery/src/repository.js';
import type { DiscoveryReadTools } from '../../packages/discovery/src/read-tools.js';
import {
  acquireDiscoverySupervisor, type DiscoveryVerificationDeps,
} from '../../packages/discovery/src/supervisor.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { readDiscoveryCaptureContents } from '../../packages/sources/src/discovery-reads.js';
import { readSnapshot } from '../../packages/sources/src/dossier.js';
import { assembleEvidenceVerificationInput } from '../../scripts/evidence-verification-input.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { barrier, modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { testNamespace } from '../fixtures/harness.js';

/** Separate namespace from the main fencing suite so concurrent Auto runs stay isolated. */
const namespace = testNamespace('discveredge');
const clock = () => new Date('2026-11-08T00:00:00.000Z');
const reviewer = { reviewerId: 'demo-reviewer', allowedSourceRefs: ['legacy-a', 'legacy-b'] };
const wrongProfileHash = 'f'.repeat(64);
let db: Pool;
let admin: Pool;
let runtime: Pool;
let directory: string;
let registryRoot: string;
let evidencePinRoot: string;
let visibleRoot: string;
let truthRoot: string;
let evidenceRoot: string;
let provisioned = false;
let store: EvidenceStore;
let captures: Awaited<ReturnType<typeof loadDemo>>['captures'];
let trustedAccountId: string;
let fixtureSetId: string;
let snapshotHash: string;
let demoDraft: { expectedRevision: 0; findingRefs: []; spec: JsonObject; profiles: JsonObject[] };
let runtimeBefore: string;
let enabled = true;
let trustedAccounts: string[] = [];

async function runtimeFingerprint() {
  const { rows } = await runtime.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  return hashCanonical(await Promise.all(rows.map(async ({ tablename }) => {
    if (!/^[a-z_][a-z_0-9]*$/.test(tablename)) throw new Error('Unexpected runtime table');
    return [tablename, (await runtime.query('SELECT to_jsonb(t) AS row FROM ' + tablename + ' t ORDER BY 1')).rows];
  })));
}

beforeAll(async () => {
  directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-discovery-verif-edge-'));
  registryRoot = join(directory, 'registry');
  evidencePinRoot = join(directory, 'pin');
  visibleRoot = join(directory, 'visible');
  truthRoot = join(directory, 'truth');
  evidenceRoot = join(directory, 'evidence');
  await startNativeDb();
  const pair = await provisionTest(namespace);
  provisioned = true;
  await migrate(pair, migrationStreams, readMigrationCatalog());
  db = new Pool({ connectionString: pair.control.appUrl });
  admin = new Pool({ connectionString: pair.control.migrationUrl, statement_timeout: 3000 });
  runtime = new Pool({ connectionString: pair.runtime.migrationUrl });
  store = await createEvidenceStore(evidenceRoot);
  ({ captures } = await loadDemo({ db, store, clock }, { visibleRoot, truthRoot }));
  const capture = captures.find(item => item.companyId === 'company-a')!;
  const catalog = localSourceCatalog;
  const source = catalog.get(capture.companyId)!;
  const dependencies = { db, store, clock };
  const service = createSourceService(dependencies, catalog);
  const manifest = await readManifest(db, capture.companyId, capture.manifestId);
  const snapshot = await service.getSnapshot('snapshot:' + manifest.id);
  const events = await service.getSnapshotRecords(snapshot.id);
  const truth = await readFile(join(truthRoot, 'expected-a.json'), 'utf8');
  const raw = await readFile(join(truthRoot, 'evidence-a.json'), 'utf8');
  const producer = decodeEvidenceProducer(raw);
  const evidence = await assembleEvidenceVerificationInput(
    db, store, { source, manifest, snapshot, events }, truth, raw, producer);
  await pinProtectedEvidenceFixture(evidence, pathToFileURL(evidencePinRoot + '/'));
  const citation = evidence.citations.find(item => item.evidence.sourceId === capture.contractFileId &&
    item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1);
  const draft = buildDemoCandidate({ source, capture, manifest, snapshot, events, citation });
  if (!('candidate' in draft) || !draft.candidate) throw new Error('Demo candidate unavailable');
  const { spec, profiles } = draft.candidate.request;
  trustedAccountId = profiles[0]!.scope.accountId;
  fixtureSetId = producer.fixtureSetId;
  snapshotHash = snapshot.contentHash;
  const { hash: _hash, ...profile } = profiles[0]!;
  demoDraft = {
    expectedRevision: 0, findingRefs: [],
    spec: spec as unknown as JsonObject,
    profiles: [profile as unknown as JsonObject],
  };
  runtimeBefore = await runtimeFingerprint();
}, 120_000);

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
    {
      allowedAccountIds: [...trustedAccounts],
      sourceRead: { companyId, sourceRef, sourceWide: true, accounts: [] },
    } : undefined;

const captureAccess = {
  readCapture: (selection: Parameters<typeof readDiscoveryCapture>[2]) =>
    readDiscoveryCapture({ db, store }, localSourceCatalog, selection),
  recheckCapture: recheckDiscoveryCapture,
};

async function constructionCapture(
  selection: Pick<DiscoveryBinding, 'companyId' | 'manifestId'>,
): Promise<ConstructionCapture> {
  const contents = await readDiscoveryCaptureContents({ db, store }, localSourceCatalog, selection);
  const snapshot = await readSnapshot(db, contents.facts.binding.snapshotId);
  const capture = {
    facts: contents.facts, manifest: contents.manifest, snapshot, events: contents.events,
  };
  assertConstructionCapture(capture);
  return capture;
}

function instrumentReads() {
  const readTools: DiscoveryReadTools = createDiscoveryReadTools({ db, store }, localSourceCatalog);
  return { readTools };
}

function verificationDeps(registry: ReturnType<typeof createCandidateRegistry>): DiscoveryVerificationDeps {
  const dependencies = { db, store, clock };
  const service = createSourceService(dependencies, localSourceCatalog);
  return {
    db,
    candidates: registry,
    captures: createFinancialCaptureReader({
      registry, dependencies, catalog: localSourceCatalog, service,
    }),
    launcher: createProtectedFinancialLauncher({
      registry,
      roots: { evidencePinRoot, servedRoots: [visibleRoot, evidenceRoot, registryRoot] },
    }),
    selectFixture: async () => ({
      fixtureSetId, fixtureSetVersion: '2' as const, purpose: 'construction' as const, snapshotHash,
    }),
    readBuildHash: readFixedFinancialBuildHash,
  };
}

async function acquire(
  model: ReturnType<typeof scriptedModel>['model'],
  readTools: DiscoveryReadTools,
  options: {
    testHooks?: Parameters<typeof acquireDiscoverySupervisor>[0]['testHooks'];
    withVerification?: boolean;
  } = {},
) {
  const registry = createCandidateRegistry(db, registryRoot);
  const owner = await acquireDiscoverySupervisor({
    db, clock, resolveAuthority, model, readTools, capture: captureAccess,
    constructionCapture, registerCandidate: registry.registerCandidate.bind(registry),
    getArtifact: registry.getArtifact.bind(registry),
    ...(options.withVerification ? { verification: verificationDeps(registry) } : {}),
    ...(options.testHooks ? { testHooks: options.testHooks } : {}),
  });
  if (!owner) throw new Error('Expected exclusive owner');
  return { owner, registry };
}

type Owner = Awaited<ReturnType<typeof acquire>>['owner'];

async function createRun(key: string, model: ReturnType<typeof scriptedModel>,
  selection: Pick<DiscoveryBinding, 'companyId' | 'manifestId'> = captures.find(item => item.companyId === 'company-a')!) {
  const repository = createDiscoveryRepository({ db, clock, resolveAuthority });
  const facts = await captureAccess.readCapture(selection);
  const actor = { reviewerId: reviewer.reviewerId, sourceRef: facts.binding.sourceRef };
  const { runId } = await repository.start({
    schemaVersion: 2, companyId: selection.companyId, manifestId: selection.manifestId, idempotencyKey: key,
  }, actor, { model: model.model, readCapture: async () => facts.binding,
    recheckCapture: connection => recheckDiscoveryCapture(connection, facts) });
  const state = () => repository.readState(runId, actor);
  const taskId = (await state()).tasks[0]!.id;
  const action = async (name: 'pause' | 'resume', idempotencyKey: string) =>
    repository.action(runId, actor, name, { schemaVersion: 2, idempotencyKey, expectedRevision: (await state()).revision });
  async function accept(owner: Owner, calls: ModelResultV2['toolCalls'], attemptIndex = 0, task = taskId) {
    const dispatch = owner.dispatchTask(runId, task)!;
    const turn = await model.at(attemptIndex).turn.promise;
    model.at(attemptIndex).result.resolve(modelResult(turn, calls));
    await dispatch.done;
    return calls.map(call => createToolStepId({ dispatchId: turn.dispatchId, providerToolCallId: call.id }));
  }
  async function execute(owner: Owner, calls: ModelResultV2['toolCalls'], attemptIndex = 0, task = taskId) {
    const steps = await accept(owner, calls, attemptIndex, task);
    for (const step of steps) await owner.executePendingStep(runId, task, step);
    return steps;
  }
  return { runId, taskId, state, action, accept, execute, facts };
}

async function storedStep(id: string) {
  const { rows: [step] } = await db.query<{ state: string; result: unknown; generation: string }>(
    'SELECT state,result,generation FROM discovery_tool_steps WHERE id=$1', [id]);
  return step;
}

async function counts(runId: string) {
  const { rows: [row] } = await db.query(
    `SELECT (SELECT count(*)::int FROM discovery_verification_requests WHERE run_id = $1) AS mappings,
       (SELECT coalesce(sum(attempts),0)::int FROM verification_attempt_budgets WHERE run_id = $1) AS attempts,
       count(*) FILTER (WHERE j.state = 'queued')::int AS queued,
       count(*) FILTER (WHERE j.state = 'running')::int AS running,
       count(*) FILTER (WHERE j.state = 'completed')::int AS completed,
       count(*) FILTER (WHERE j.state = 'failed')::int AS failed,
       count(r.job_id)::int AS reservations, count(v.job_id)::int AS reports, count(a.job_id)::int AS attestations
     FROM verification_jobs j
       LEFT JOIN financial_verification_reservations r ON r.job_id = j.id
       LEFT JOIN verification_reports v ON v.job_id = j.id
       LEFT JOIN financial_verification_attestations a ON a.job_id = j.id
     WHERE j.task_run_id = $1`, [runId],
  );
  return row as {
    mappings: number; attempts: number; queued: number; running: number; completed: number; failed: number;
    reservations: number; reports: number; attestations: number;
  };
}

const zeroCounts = {
  mappings: 0, attempts: 0, queued: 0, running: 0, completed: 0, failed: 0,
  reservations: 0, reports: 0, attestations: 0,
};

async function preparedVerify(
  key: string,
  options: {
    testHooks?: Parameters<typeof acquireDiscoverySupervisor>[0]['testHooks'];
  } = {},
) {
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  const acquired = await acquire(model.model, instrumentReads().readTools, {
    withVerification: true,
    ...(options.testHooks ? { testHooks: options.testHooks } : {}),
  });
  const run = await createRun(key, model);
  const task = await delegateConnector(run, acquired.owner);
  const compiled = await draftCompileDemo(run, acquired.owner, task);
  return { model, run, task, compiled, ...acquired };
}

async function delegateConnector(
  run: Awaited<ReturnType<typeof createRun>>, owner: Owner, attemptIndex = 0,
) {
  await run.execute(owner, [{ id: 'delegate', name: 'delegateTask', arguments: {
    subject: { kind: 'source' }, role: 'connector', question: 'Prepare draft rules', dependencyIds: [],
  } }], attemptIndex);
  return (await run.state()).tasks.find(task => task.role === 'connector')!.id;
}

async function draftCompileDemo(
  run: Awaited<ReturnType<typeof createRun>>, owner: Owner, task: string, startAttempt = 1,
) {
  await run.execute(owner, [{ id: 'draft', name: 'draftConnector', arguments: demoDraft }], startAttempt, task);
  const proposal = (await run.state()).proposals[0]!;
  expect(proposal.state).toBe('draft');
  expect(proposal.assessment.blockerRefs).toEqual([]);
  const [step] = await run.execute(owner, [{
    id: 'compile', name: 'compileConnector',
    arguments: { proposalId: proposal.proposalId, revision: proposal.revision },
  }], startAttempt + 1, task);
  expect(await storedStep(step!)).toMatchObject({ state: 'succeeded' });
  const compiled = (await run.state()).proposals[0]!;
  expect(compiled.state).toBe('compiled');
  expect(compiled.profileHashes).toHaveLength(1);
  return compiled;
}

const verifyCall = (id: string, proposal: ProposalResult, profileHash = proposal.profileHashes[0]!) => ({
  id, name: 'requestVerification', arguments: {
    proposalId: proposal.proposalId, revision: proposal.revision, profileHash,
  },
});

test('policy revoke at verification claim commit leaves zero mapping and pending step', async () => {
  const entered = barrier<void>();
  const release = barrier<void>();
  let owner: Owner | undefined;
  let pending: Promise<unknown> | undefined;
  const beforeRuntime = await runtimeFingerprint();
  try {
    const prepared = await preparedVerify('edge-claim-revoke', {
      testHooks: {
        beforeVerificationClaimCommit: async () => {
          enabled = false;
          entered.resolve();
          await release.promise;
        },
      },
    });
    owner = prepared.owner;
    const [step] = await prepared.run.accept(owner, [verifyCall('verify', prepared.compiled)], 3, prepared.task);
    pending = owner.executePendingStep(prepared.run.runId, prepared.task, step!);
    await entered.promise;
    release.resolve();
    expect(await pending).toBeUndefined();
    expect(await counts(prepared.run.runId)).toEqual(zeroCounts);
    expect(await storedStep(step!)).toMatchObject({ state: 'pending' });
    enabled = true;
    expect((await prepared.run.state()).verificationJobs).toEqual([]);
    expect(await runtimeFingerprint()).toBe(beforeRuntime);
  } finally {
    enabled = true;
    release.resolve();
    try { await pending; } catch { /* revoked */ }
    await owner?.close();
    trustedAccounts = [];
  }
}, 180_000);

test('policy revoke after producer admit SQL rolls back mapping before COMMIT', async () => {
  const entered = barrier<void>();
  const release = barrier<void>();
  let owner: Owner | undefined;
  let pending: Promise<unknown> | undefined;
  const beforeRuntime = await runtimeFingerprint();
  try {
    const prepared = await preparedVerify('edge-admit-revoke', {
      testHooks: {
        beforeVerificationAdmitCommit: async () => {
          enabled = false;
          entered.resolve();
          await release.promise;
        },
      },
    });
    owner = prepared.owner;
    const [step] = await prepared.run.accept(owner, [verifyCall('verify', prepared.compiled)], 3, prepared.task);
    pending = owner.executePendingStep(prepared.run.runId, prepared.task, step!);
    await entered.promise;
    release.resolve();
    await pending;
    // Same-txn claim + mapping both roll back, so the step stays pending.
    expect(await counts(prepared.run.runId)).toEqual(zeroCounts);
    expect(await storedStep(step!)).toMatchObject({ state: 'pending' });
    enabled = true;
    expect((await prepared.run.state()).verificationJobs).toEqual([]);
    expect(await runtimeFingerprint()).toBe(beforeRuntime);
  } finally {
    enabled = true;
    release.resolve();
    try { await pending; } catch { /* revoked */ }
    await owner?.close();
    trustedAccounts = [];
  }
}, 180_000);

test('task revision advance after enqueue blocks current settlement', async () => {
  const entered = barrier<void>();
  const release = barrier<void>();
  let owner: Owner | undefined;
  let pending: Promise<unknown> | undefined;
  let connectorTask = '';
  const beforeRuntime = await runtimeFingerprint();
  try {
    const prepared = await preparedVerify('edge-task-revision', {
      testHooks: {
        afterVerificationEnqueue: async () => {
          const bumped = await db.query(
            'UPDATE discovery_tasks SET revision = revision + 1 WHERE id = $1', [connectorTask]);
          if (bumped.rowCount !== 1) throw new Error('failed to advance task revision');
          entered.resolve();
          await release.promise;
        },
      },
    });
    owner = prepared.owner;
    connectorTask = prepared.task;
    const [step] = await prepared.run.accept(owner, [verifyCall('verify', prepared.compiled)], 3, prepared.task);
    pending = owner.executePendingStep(prepared.run.runId, prepared.task, step!);
    await entered.promise;
    release.resolve();
    expect(await pending).toBeUndefined();

    const mapped = await db.query<{ job_id: string }>(
      'SELECT job_id FROM discovery_verification_requests WHERE run_id=$1', [prepared.run.runId]);
    expect(mapped.rows).toHaveLength(1);
    const jobId = mapped.rows[0]!.job_id;
    expect(await counts(prepared.run.runId)).toMatchObject({
      mappings: 1, attempts: 1, reservations: 1, completed: 0, failed: 0,
    });
    expect(await storedStep(step!)).not.toMatchObject({ state: 'succeeded' });
    expect((await prepared.run.state()).verificationJobs).toEqual([
      expect.objectContaining({ jobId }),
    ]);

    const recovered = await owner.executePendingStep(prepared.run.runId, prepared.task, step!);
    expect(recovered === undefined || (typeof recovered === 'object' && recovered && 'ok' in recovered &&
      !(recovered as { ok: boolean }).ok)).toBe(true);
    expect(await counts(prepared.run.runId)).toMatchObject({
      mappings: 1, attempts: 1, reservations: 1, completed: 0,
    });
    expect(await storedStep(step!)).not.toMatchObject({ state: 'succeeded' });
    expect((await db.query<{ job_id: string }>(
      'SELECT job_id FROM discovery_verification_requests WHERE run_id=$1', [prepared.run.runId],
    )).rows[0]!.job_id).toBe(jobId);
    expect(await runtimeFingerprint()).toBe(beforeRuntime);
  } finally {
    release.resolve();
    try { await pending; } catch { /* settle no-op */ }
    await owner?.close();
    trustedAccounts = [];
  }
}, 180_000);

test('wrong profileHash is rejected before verification budget', async () => {
  // Multi-profile subjects are schema-forbidden on durable proposals (profiles.length === 1);
  // mismatched profileHash exercises the same pre-budget subject rejection path.
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools, { withVerification: true });
  const beforeRuntime = await runtimeFingerprint();
  try {
    const run = await createRun('edge-wrong-profile', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompileDemo(run, owner, task);
    const [step] = await run.execute(owner, [verifyCall('verify-bad-hash', compiled, wrongProfileHash)], 3, task);
    expect(await storedStep(step!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' },
    });
    expect(await counts(run.runId)).toEqual(zeroCounts);
    expect((await run.state()).verificationJobs).toEqual([]);
    expect(await runtimeFingerprint()).toBe(beforeRuntime);
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
}, 120_000);

test('verification uncertainty does not block pause/resume', async () => {
  const entered = barrier<void>();
  const release = barrier<void>();
  let owner: Owner | undefined;
  let pending: Promise<unknown> | undefined;
  try {
    const prepared = await preparedVerify('edge-uncertainty-resume', {
      testHooks: {
        afterVerificationEnqueue: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    });
    owner = prepared.owner;
    const [step] = await prepared.run.accept(owner, [verifyCall('verify', prepared.compiled)], 3, prepared.task);
    pending = owner.executePendingStep(prepared.run.runId, prepared.task, step!);
    await entered.promise;
    await owner.close();
    owner = undefined;
    release.resolve();
    try { await pending; } catch { /* owner lost */ }

    const restarted = await acquire(prepared.model.model, instrumentReads().readTools, {
      withVerification: true,
    });
    owner = restarted.owner;
    const paused = await prepared.run.action('pause', 'uncertainty-pause');
    expect(paused.status).toBe('paused');
    const resumed = await prepared.run.action('resume', 'uncertainty-resume');
    expect(resumed.status).not.toBe('blocked');
    expect(resumed.diagnostics.every(item => item.code !== 'VERIFICATION_INTERRUPTED' ||
      item.severity === 'warning')).toBe(true);
  } finally {
    release.resolve();
    try { await pending; } catch { /* owner lost */ }
    await owner?.close();
    trustedAccounts = [];
  }
}, 180_000);

test('recoverAdmittedVerifications claims queued mapping without current success', async () => {
  const entered = barrier<void>();
  const release = barrier<void>();
  let owner: Owner | undefined;
  let pending: Promise<unknown> | undefined;
  const beforeRuntime = await runtimeFingerprint();
  try {
    const prepared = await preparedVerify('edge-recover-queued', {
      testHooks: {
        afterVerificationEnqueue: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    });
    owner = prepared.owner;
    const [step] = await prepared.run.accept(owner, [verifyCall('verify', prepared.compiled)], 3, prepared.task);
    pending = owner.executePendingStep(prepared.run.runId, prepared.task, step!);
    await entered.promise;
    await prepared.run.action('pause', 'pause-before-recover');
    const mapped = await db.query<{ job_id: string }>(
      'SELECT job_id FROM discovery_verification_requests WHERE run_id=$1', [prepared.run.runId]);
    expect(mapped.rows).toHaveLength(1);
    const jobId = mapped.rows[0]!.job_id;
    // Simulate owner loss after admit: job remains queued for replacement recovery.
    await db.query("UPDATE verification_jobs SET state='queued' WHERE id=$1", [jobId]);
    release.resolve();
    await pending;
    expect(await storedStep(step!)).toMatchObject({ state: 'interrupted' });
    expect(await counts(prepared.run.runId)).toMatchObject({
      mappings: 1, attempts: 1, reservations: 1, queued: 1,
    });

    await owner.recoverAdmittedVerifications();
    await expect.poll(async () => (await counts(prepared.run.runId)).queued, { timeout: 30_000 }).toBe(0);
    expect(await counts(prepared.run.runId)).toMatchObject({
      mappings: 1, attempts: 1, reservations: 1, queued: 0,
    });
    expect(await storedStep(step!)).toMatchObject({ state: 'interrupted' });
    expect(await runtimeFingerprint()).toBe(beforeRuntime);
  } finally {
    release.resolve();
    try { await pending; } catch { /* settle */ }
    await owner?.close();
    trustedAccounts = [];
  }
}, 180_000);

test('narrowed account grants hide previously admitted verificationJobs', async () => {
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools, { withVerification: true });
  try {
    const run = await createRun('edge-scoped-state', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompileDemo(run, owner, task);
    const [step] = await run.execute(owner, [verifyCall('verify', compiled)], 3, task);
    expect(await storedStep(step!)).toMatchObject({ state: 'succeeded' });
    expect((await run.state()).verificationJobs).toHaveLength(1);
    trustedAccounts = [];
    expect((await run.state()).verificationJobs).toEqual([]);
    const paused = await run.action('pause', 'scope-pause');
    expect(paused.verificationJobs).toEqual([]);
    trustedAccounts = [trustedAccountId];
    expect((await run.state()).verificationJobs).toHaveLength(1);
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
}, 180_000);

test('pause after verification enqueue keeps mapping without current success', async () => {
  const entered = barrier<void>();
  const release = barrier<void>();
  let owner: Owner | undefined;
  let pending: Promise<unknown> | undefined;
  let pause: (() => Promise<unknown>) | undefined;
  const beforeRuntime = await runtimeFingerprint();
  try {
    const prepared = await preparedVerify('edge-pause-settle', {
      testHooks: {
        afterVerificationEnqueue: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    });
    owner = prepared.owner;
    pause = () => prepared.run.action('pause', 'pause-after-enqueue');
    const [step] = await prepared.run.accept(owner, [verifyCall('verify', prepared.compiled)], 3, prepared.task);
    pending = owner.executePendingStep(prepared.run.runId, prepared.task, step!);
    await entered.promise;
    await pause();
    release.resolve();
    await pending;
    expect(await counts(prepared.run.runId)).toMatchObject({
      mappings: 1, attempts: 1, reservations: 1,
    });
    expect(await storedStep(step!)).toMatchObject({ state: 'interrupted' });
    expect((await prepared.run.state()).verificationJobs).toHaveLength(1);
    expect(await runtimeFingerprint()).toBe(beforeRuntime);
  } finally {
    release.resolve();
    try { await pending; } catch { /* paused settle */ }
    await owner?.close();
    trustedAccounts = [];
  }
}, 180_000);

test('invalid later verification prevents earlier batch verification effects', async () => {
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools, { withVerification: true });
  const beforeRuntime = await runtimeFingerprint();
  try {
    const run = await createRun('edge-batch-preflight', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompileDemo(run, owner, task);
    const steps = await run.execute(owner, [
      verifyCall('verify-first', compiled),
      verifyCall('verify-bad-later', compiled, wrongProfileHash),
    ], 3, task);
    expect(await storedStep(steps[0]!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' },
    });
    expect(await storedStep(steps[1]!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' },
    });
    expect(await counts(run.runId)).toEqual(zeroCounts);
    expect((await run.state()).verificationJobs).toEqual([]);
    expect(await runtimeFingerprint()).toBe(beforeRuntime);
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
}, 180_000);
