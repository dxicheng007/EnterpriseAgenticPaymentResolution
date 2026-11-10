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
import { modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { testNamespace } from '../fixtures/harness.js';

const namespace = testNamespace('discverif');
const clock = () => new Date('2026-11-08T00:00:00.000Z');
const reviewer = { reviewerId: 'demo-reviewer', allowedSourceRefs: ['legacy-a', 'legacy-b'] };
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
  directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-discovery-verif-'));
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

async function toolActivity(run: Awaited<ReturnType<typeof createRun>>) {
  const { rows } = await db.query<{ event: { type: string; payload: JsonObject } }>(`
    SELECT event FROM activity_events WHERE event->>'runId'=$1 AND event->>'type' IN ('tool.called','tool.result')
    ORDER BY sequence`, [run.runId]);
  return rows.map(row => row.event);
}

async function mappingCount(runId: string) {
  const { rows: [row] } = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM discovery_verification_requests WHERE run_id=$1', [runId]);
  return Number(row!.count);
}

async function waitJob(jobId: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows: [row] } = await db.query<{ state: string; summary: unknown }>(
      'SELECT state, summary FROM verification_jobs WHERE id=$1', [jobId]);
    if (row && (row.state === 'completed' || row.state === 'failed')) return row;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for verification job');
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

const verifyCall = (id: string, proposal: ProposalResult) => ({
  id, name: 'requestVerification', arguments: {
    proposalId: proposal.proposalId, revision: proposal.revision, profileHash: proposal.profileHashes[0]!,
  },
});

test('verification tools stay unavailable without verification injection', async () => {
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('verif-unavailable', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompileDemo(run, owner, task);
    const [step] = await run.execute(owner, [verifyCall('verify', compiled)], 3, task);
    expect(await storedStep(step!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'TOOL_UNAVAILABLE' },
    });
    expect((await run.state()).verificationJobs).toEqual([]);
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
});

test('untrusted account scope returns VERIFICATION_SCOPE_REQUIRED', async () => {
  // Interim policy: compiled proposals whose account is absent from trusted grants stay blocked.
  trustedAccounts = [];
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools, { withVerification: true });
  try {
    const run = await createRun('verif-scope', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompileDemo(run, owner, task);
    const [step] = await run.execute(owner, [verifyCall('verify-scope', compiled)], 3, task);
    expect(await storedStep(step!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'VERIFICATION_SCOPE_REQUIRED' },
    });
    expect(await mappingCount(run.runId)).toBe(0);
    expect((await run.state()).verificationJobs).toEqual([]);
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
});

test('requestVerification and readVerification complete through actual supervisor', async () => {
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools, { withVerification: true });
  try {
    const run = await createRun('verif-happy', model);
    const beforeRuntime = await runtimeFingerprint();
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompileDemo(run, owner, task);
    const [step] = await run.execute(owner, [verifyCall('verify', compiled)], 3, task);
    const stored = await storedStep(step!);
    expect(stored).toMatchObject({ state: 'succeeded', result: { ok: true } });
    const job = (stored!.result as { ok: true; job: { jobId: string; state: string } }).job;
    expect(job.jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(['queued', 'running', 'completed']).toContain(job.state);
    expect(await mappingCount(run.runId)).toBe(1);
    expect((await run.state()).verificationJobs).toEqual([{
      proposalId: compiled.proposalId, proposalRevision: compiled.revision, jobId: job.jobId,
    }]);

    const finished = await waitJob(job.jobId);
    expect(finished).toMatchObject({
      state: 'completed',
      summary: { eligible: true, coverageComplete: true },
    });

    const [readStep] = await run.execute(owner, [{
      id: 'read-verify', name: 'readVerification', arguments: { jobId: job.jobId },
    }], 4, task);
    expect(await storedStep(readStep!)).toMatchObject({
      state: 'succeeded',
      result: {
        ok: true,
        job: { jobId: job.jobId, state: 'completed', summary: { eligible: true, coverageComplete: true } },
      },
    });

    const activity = await toolActivity(run);
    expect(activity.some(event =>
      event.type === 'tool.result' && event.payload.toolName === 'requestVerification' &&
      event.payload.toolStatus === 'succeeded')).toBe(true);
    expect(activity.some(event =>
      event.type === 'tool.result' && event.payload.toolName === 'readVerification' &&
      event.payload.toolStatus === 'succeeded')).toBe(true);
    const serialized = JSON.stringify(activity);
    expect(serialized).not.toMatch(/subjectBytes|requestBytes|fixtureSetId|servedRoots|evidencePin|truthRoot/);
    expect(await runtimeFingerprint()).toBe(beforeRuntime);
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
}, 120_000);

test('pause before verification claim leaves pending step and no mapping', async () => {
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools, { withVerification: true });
  try {
    const run = await createRun('verif-paused', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompileDemo(run, owner, task);
    const [step] = await run.accept(owner, [verifyCall('verify', compiled)], 3, task);
    await run.action('pause', 'pause-before-verify');
    await owner.executePendingStep(run.runId, task, step!);
    expect(await storedStep(step!)).toMatchObject({ state: 'pending' });
    expect(await mappingCount(run.runId)).toBe(0);
    expect((await run.state()).verificationJobs).toEqual([]);
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
});

test('exact toolStepId verification replay reuses mapping without new budget', async () => {
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools, { withVerification: true });
  try {
    const run = await createRun('verif-idempotent', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompileDemo(run, owner, task);
    const [step] = await run.execute(owner, [verifyCall('verify', compiled)], 3, task);
    const first = await storedStep(step!);
    expect(first).toMatchObject({ state: 'succeeded' });
    expect(await mappingCount(run.runId)).toBe(1);
    await waitJob((first!.result as { ok: true; job: { jobId: string } }).job.jobId);
    await owner.executePendingStep(run.runId, task, step!);
    expect(await storedStep(step!)).toEqual(first);
    expect(await mappingCount(run.runId)).toBe(1);
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
}, 120_000);

test('readVerification rejects foreign job ids', async () => {
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools, { withVerification: true });
  try {
    const run = await createRun('verif-foreign-read', model);
    const task = await delegateConnector(run, owner);
    await draftCompileDemo(run, owner, task);
    const [step] = await run.execute(owner, [{
      id: 'read-foreign', name: 'readVerification',
      arguments: { jobId: '00000000-0000-4000-8000-000000000099' },
    }], 3, task);
    expect(await storedStep(step!)).toMatchObject({
      state: 'failed',
      result: { ok: false, code: expect.stringMatching(/DISCOVERY_FORBIDDEN|DISCOVERY_CONFLICT/) },
    });
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
});

test('stale assessment after admit keeps mapping without current success', async () => {
  trustedAccounts = [trustedAccountId];
  const model = scriptedModel();
  let runId = '';
  const { owner } = await acquire(model.model, instrumentReads().readTools, {
    withVerification: true,
    testHooks: {
      async afterVerificationEnqueue() {
        const updated = await db.query(`
          UPDATE discovery_proposal_current
          SET result = jsonb_set(
            jsonb_set(result, '{assessment,diagnosticCodes}', '["ASSESSMENT_STALE"]'::jsonb, true),
            '{state}', '"compile_blocked"')
          WHERE run_id=$1`, [runId]);
        if (updated.rowCount !== 1) throw new Error('failed to stale assessment: ' + updated.rowCount);
      },
    },
  });
  try {
    const run = await createRun('verif-stale-assess', model);
    runId = run.runId;
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompileDemo(run, owner, task);
    const [step] = await run.execute(owner, [verifyCall('verify', compiled)], 3, task);
    expect(await storedStep(step!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' },
    });
    expect(await mappingCount(run.runId)).toBe(1);
    const jobs = (await run.state()).verificationJobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      proposalId: compiled.proposalId, proposalRevision: compiled.revision,
    });
    await waitJob(jobs[0]!.jobId);
  } finally {
    await owner.close();
    trustedAccounts = [];
  }
}, 120_000);
