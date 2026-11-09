import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createToolStepId, hashCanonical, hashEvent, hashManifest, type BootstrapManifest, type DiscoveryBinding, type DiscoverySubject, type ModelResultV2, type RawSourceEvent } from '@eapr/contracts';
import { createEvidenceStore, type EvidenceStore } from '@eapr/evidence';
import { captureBaseline, companyA, createDiscoveryReadTools, prepareApiRecord, publishManifest, readDiscoveryCapture, streamContentHash, type DiscoveryReadTools } from '@eapr/sources';
import { eventA } from '../../packages/sources/src/company-a.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { recheckDiscoveryCapture } from '../../apps/control/src/discovery-composition.js';
import { createDiscoveryRepository } from '../../packages/discovery/src/repository.js';
import { acquireDiscoverySupervisor } from '../../packages/discovery/src/supervisor.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { barrier, modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { testNamespace } from '../fixtures/harness.js';

const namespace = testNamespace('discfindings');
const clock = () => new Date('2026-11-08T00:00:00.000Z');
const reviewer = { reviewerId: 'demo-reviewer', allowedSourceRefs: ['legacy-a', 'legacy-b'], allowedAccountIds: [] };
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
  const readTools: DiscoveryReadTools = {
    async prepare(input) {
      const invocation = ++preparations;
      let first = true;
      const adapter = createDiscoveryReadTools({ db, store: {
        async get(hash) {
          blobReads++;
          if (first) {
            first = false;
            await onFirstBlob?.(invocation);
          }
          return store.get(hash);
        },
      } }, localSourceCatalog);
      const prepared = await adapter.prepare(input);
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

const findingInput = {
  expectedRevision: 0, subject: { kind: 'source' }, fieldPath: '/terms', value: 'assertion',
  provenanceClass: 'unresolved', evidenceStatus: 'insufficient', evidenceRefs: [],
  derivationInputs: [], alternatives: [], unresolvedQuestions: ['Which terms apply?'],
};

function publish(id: string, overrides: Record<string, ModelResultV2['toolCalls'][number]['arguments'][string]> = {}) {
  return { id, name: 'publishFinding', arguments: { ...findingInput, ...overrides } };
}

test('scripted publication persists immutable historical findings and sticky origins', async () => {
  const model = scriptedModel();
  const reads = instrumentReads();
  const owner = await acquire(model.model, reads.readTools);
  try {
    const run = await createRun('finding-history', model);
    const [step] = await run.execute(owner, [publish('initial', { evidenceRefs: [run.facts.evidenceIds[0]!] })]);
    expect(await storedStep(step!)).toMatchObject({ state: 'succeeded', result: { ok: true, revision: 1 } });
    const [first] = (await run.state()).findings;
    expect(first).toMatchObject({ revision: 1, taskId: run.taskId });
    await run.execute(owner, [
      publish('revision', { findingId: first!.id, expectedRevision: 1, provenanceClass: 'observed', evidenceStatus: 'supported' }),
      { id: 'history', name: 'readFinding', arguments: { findingId: first!.id, revision: 1 } },
    ], 1).then(async ([, read]) => {
      expect(await storedStep(read!)).toMatchObject({ result: { ok: true, finding: { revision: 1, origin: 'agent', evidenceStatus: 'insufficient' } } });
    });
    expect((await run.state()).findings[0]).toMatchObject({ id: first!.id, revision: 2 });
    expect((await db.query('SELECT origin_revision,code FROM discovery_finding_blockers WHERE run_id=$1', [run.runId])).rows)
      .toContainEqual({ origin_revision: 1, code: 'FINDING_RESOLUTION_PENDING' });
    const io = reads.preparations;
    const events = await findingActivity(run.runId);
    await run.action('pause', 'after-commit');
    expect(await owner.executePendingStep(run.runId, run.taskId, step!)).toMatchObject({ ok: true, revision: 1 });
    enabled = false;
    expect(await owner.executePendingStep(run.runId, run.taskId, step!)).toBeUndefined();
    expect(reads.preparations).toBe(io);
    expect(await findingActivity(run.runId)).toEqual(events);
  } finally {
    enabled = true;
    await owner.close();
  }
});

async function findingActivity(runId: string) {
  const { rows } = await db.query<{ event: unknown }>(`
    SELECT event FROM activity_events WHERE event->>'runId'=$1
      AND event->>'type' IN ('finding.revised','tool.called','tool.result') ORDER BY sequence`, [runId]);
  return rows.map(row => row.event);
}

const delegate = { id: 'delegate', name: 'delegateTask', arguments: {
  subject: { kind: 'source' }, role: 'identity', question: 'Investigate.', dependencyIds: [],
} };
const describe = { id: 'describe', name: 'describeSource', arguments: {} };

test.each([false, true])('mixed batch with forbidden alternative has no successful effect, recovered=%s', async recovered => {
  const model = scriptedModel();
  const reads = instrumentReads();
  let owner = await acquire(model.model, reads.readTools);
  try {
    const run = await createRun('mixed-finding-' + recovered, model);
    const ids = await run.accept(owner, [delegate, describe, publish('valid'), publish('invalid', {
      alternatives: [{ value: 'invalid evidence', evidenceRefs: ['not-a-captured-citation'] }],
    })]);
    if (recovered) {
      await owner.close();
      owner = await acquire(model.model, reads.readTools);
    }
    expect(await owner.executePendingStep(run.runId, run.taskId, ids[0]!)).toEqual({ ok: false, code: 'DISCOVERY_FORBIDDEN' });
    for (const id of ids) expect(await storedStep(id)).toMatchObject({ state: 'failed', result: { ok: false, code: 'DISCOVERY_FORBIDDEN' } });
    expect(await run.state()).toMatchObject({ tasks: [{ id: run.taskId }], findings: [] });
    expect(await findingActivity(run.runId)).toEqual([]);
  } finally {
    await owner.close();
  }
});

test.each(['stale CAS', 'projected cycle'])('rejects %s before the first write in the batch', async mode => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('projected-' + mode.replace(' ', '-'), model);
    await run.execute(owner, [publish('first'), publish('second')]);
    const [a, b] = (await run.state()).findings;
    const initialActivity = await findingActivity(run.runId);
    const ids = await run.execute(owner, [
      publish('a-next', { findingId: a!.id, expectedRevision: 1, derivationInputs: [{ findingId: b!.id, revision: 1 }] }),
      mode === 'stale CAS' ? publish('stale', { findingId: a!.id, expectedRevision: 1 }) :
        publish('b-next', { findingId: b!.id, expectedRevision: 1, derivationInputs: [{ findingId: a!.id, revision: 1 }] }),
    ], 1);
    for (const id of ids) expect(await storedStep(id)).toMatchObject({ state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' } });
    expect((await run.state()).findings).toEqual([a, b]);
    expect(await findingActivity(run.runId)).toEqual(initialActivity);
  } finally {
    await owner.close();
  }
});

test('historical derivation references remain authorized and a supported empty assertion remains pending', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('historical-derivation', model);
    await run.execute(owner, [publish('origin')]);
    const [origin] = (await run.state()).findings;
    await run.execute(owner, [publish('revised', { findingId: origin!.id, expectedRevision: 1 })], 1);
    const [step] = await run.execute(owner, [publish('derived', {
      provenanceClass: 'derived', evidenceStatus: 'supported', value: 12345,
      derivationInputs: [{ findingId: origin!.id, revision: 1 }], unresolvedQuestions: [],
    })], 2);
    expect(await storedStep(step!)).toMatchObject({ state: 'succeeded' });
    const { rows: [row] } = await db.query<{ payload: unknown }>(
      'SELECT payload FROM discovery_finding_revisions WHERE tool_step_id=$1', [step]);
    expect(row!.payload).toMatchObject({ origin: 'agent', reviewDisposition: 'pending', evidenceRefs: [],
      derivationInputs: [{ findingId: origin!.id, revision: 1 }] });
    expect(await run.state()).toMatchObject({ proposals: [], verificationJobs: [] });
  } finally {
    await owner.close();
  }
});

test.each(['owner loss', 'revocation', 'rollback'] as const)('publication is atomic across %s at commit', async condition => {
  const model = scriptedModel();
  const entered = barrier<void>();
  const release = barrier<void>();
  let owner = await acquire(model.model, instrumentReads().readTools, { async beforeFindingCommit() {
    entered.resolve();
    await release.promise;
    if (condition === 'rollback') throw new Error('test rollback');
  } });
  try {
    const run = await createRun('publication-' + condition.replace(' ', '-'), model);
    const [id] = await run.accept(owner, [publish('atomic')]);
    const execute = () => owner.executePendingStep(run.runId, run.taskId, id!);
    const settled = execute().catch(error => error);
    await entered.promise;
    expect(await findingActivity(run.runId)).toEqual([]);
    expect(await storedStep(id!)).toMatchObject({ state: 'pending', result: null });
    let closing: Promise<void> | undefined;
    if (condition === 'owner loss') closing = owner.close();
    if (condition === 'revocation') enabled = false;
    release.resolve();
    if (condition === 'rollback') expect(await settled).toEqual(new Error('test rollback'));
    else expect(await settled).toBeUndefined();
    await closing;
    expect(await findingActivity(run.runId)).toEqual([]);
    expect(await storedStep(id!)).toMatchObject({ state: 'pending', result: null });
    enabled = true;
    await owner.close();
    owner = await acquire(model.model, instrumentReads().readTools);
    expect(await execute()).toMatchObject({ ok: true, revision: 1 });
    expect(await findingActivity(run.runId)).toHaveLength(3);
  } finally {
    enabled = true;
    release.resolve();
    await owner.close();
  }
});

test('a pause committed during evidence preparation prevents publication', async () => {
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
    const run = await createRun('pause-finding', model);
    const [id] = await run.accept(owner, [publish('paused')]);
    const pending = owner.executePendingStep(run.runId, run.taskId, id!);
    await entered.promise;
    await run.action('pause', 'while-preparing');
    release.resolve();
    expect(await pending).toBeUndefined();
    expect(await run.state()).toMatchObject({ status: 'paused', findings: [] });
    expect(await findingActivity(run.runId)).toEqual([]);
  } finally {
    release.resolve();
    await owner.close();
  }
});

async function addSpecialist(owner: Owner, runId: string, subject: DiscoverySubject) {
  const child = await owner.addTestSpecialist!(runId, { subject, role: 'contract', question: 'Inspect terms.', dependencyIds: [] });
  if (!child || !('taskId' in child) || !child.taskId) throw new Error('Expected an account task');
  return child.taskId;
}

test.each(['api', 'unknown document', 'sibling account', 'missing applicability', 'source derivation'] as const)(
  'applies exact account scope to %s evidence', async condition => {
    const model = scriptedModel();
    const reads = instrumentReads();
    const owner = await acquire(model.model, reads.readTools, {});
    try {
      const run = await createRun('account-' + condition.replaceAll(' ', '-'), model);
      const [subject, sibling] = run.facts.sourceAccounts;
      expect(subject).toBeDefined();
      const child = await addSpecialist(owner, run.runId, subject!);
      const { companyId, sourceRef } = run.facts.binding;
      const page = async (account: typeof subject) => {
        const prepared = await reads.readTools.prepare({ name: 'querySnapshot',
          arguments: { account: { sellerEntityId: account!.sellerEntityId, sourceAccountId: account!.sourceAccountId }, limit: 20 }, binding: run.facts.binding,
          sourceRead: { companyId, sourceRef, sourceWide: true, accounts: [] } });
        if (!prepared.result.ok || !('events' in prepared.result)) throw new Error('Expected captured events');
        return prepared.result.events.flatMap(event => event.evidenceIds);
      };
      let evidenceRefs: string[] = [];
      let derivationInputs: { findingId: string; revision: number }[] = [];
      if (condition === 'api') evidenceRefs = [(await page(subject))[0]!];
      if (condition === 'sibling account') evidenceRefs = [(await page(sibling))[0]!];
      if (condition === 'unknown document') {
        const { rows: [document] } = await db.query<{ evidence_id: string }>(
          'SELECT evidence_id FROM source_evidence WHERE snapshot_id=$1 AND file_id IS NOT NULL LIMIT 1',
          [run.facts.binding.snapshotId]);
        evidenceRefs = [document!.evidence_id];
      }
      if (condition === 'source derivation') {
        await run.execute(owner, [publish('source-only')]);
        const [finding] = (await run.state()).findings;
        derivationInputs = [{ findingId: finding!.id, revision: 1 }];
      }
      const [step] = await run.execute(owner, [publish('scoped', {
        subject: subject!, evidenceRefs, derivationInputs, provenanceClass: 'observed', evidenceStatus: 'supported',
        unresolvedQuestions: [],
      })], condition === 'source derivation' ? 1 : 0, child);
      const success = condition === 'api' || condition === 'missing applicability';
      expect(await storedStep(step!)).toMatchObject({ result: success ? { ok: true } : { ok: false, code: 'DISCOVERY_FORBIDDEN' } });
      const { rows } = await db.query(`
        SELECT i.seller_entity_id,b.code FROM discovery_finding_blockers b
        JOIN discovery_investigations i ON i.run_id=b.run_id AND i.id=b.investigation_id
        JOIN discovery_finding_revisions r ON r.run_id=b.run_id AND r.finding_id=b.finding_id AND r.revision=b.origin_revision
        WHERE r.tool_step_id=$1`, [step]);
      expect(rows).toEqual(condition === 'missing applicability' ?
        [{ seller_entity_id: null, code: 'FINDING_APPLICABILITY_UNRESOLVED' }] : []);
    } finally {
      await owner.close();
    }
  },
);

test('permits revision ten and refuses a batch that would consume revision eleven', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('revision-limit', model);
    await run.execute(owner, [publish('initial')]);
    const findingId = (await run.state()).findings[0]!.id;
    const revisions = (start: number, length: number) => Array.from({ length }, (_, index) =>
      publish('r' + (start + index), { findingId, expectedRevision: start + index }));
    await run.execute(owner, revisions(1, 4), 1);
    await run.execute(owner, revisions(5, 4), 2);
    expect((await run.state()).findings[0]!.revision).toBe(9);
    const [last] = await run.execute(owner, revisions(9, 1), 3);
    expect(await storedStep(last!)).toMatchObject({ result: { ok: true, revision: 10 } });
    const rejected = await run.execute(owner, [publish('new'), ...revisions(10, 1)], 4);
    for (const id of rejected) expect(await storedStep(id)).toMatchObject({ result: { ok: false, code: 'DISCOVERY_CONFLICT' } });
    expect(await run.state()).toMatchObject({ findings: [{ id: findingId, revision: 10 }],
      diagnostics: [{ code: 'FINDING_REVISION_LIMIT' }] });
  } finally {
    await owner.close();
  }
});

test('shares the 100 identity ceiling across concurrent tasks of one investigation', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools, {});
  try {
    const run = await createRun('identity-limit', model);
    const tasks = [run.taskId];
    for (let count = 0; count < 4; count++) tasks.push(await addSpecialist(owner, run.runId, { kind: 'source' }));
    const calls = (length: number) => Array.from({ length }, (_, index) => publish('finding-' + index));
    let turn = 0;
    for (const task of tasks.slice(0, 3)) {
      for (let round = 0; round < 8; round++) await run.execute(owner, calls(4), turn++, task);
    }
    const [first, second] = tasks.slice(3);
    await run.execute(owner, calls(3), turn++, first);
    expect((await run.state()).findings).toHaveLength(99);
    const [a] = await run.accept(owner, calls(1), turn++, first);
    const [b] = await run.accept(owner, calls(1), turn++, second);
    await Promise.all([
      owner.executePendingStep(run.runId, first!, a!), owner.executePendingStep(run.runId, second!, b!),
    ]);
    expect([(await storedStep(a!))?.state, (await storedStep(b!))?.state].sort()).toEqual(['failed', 'succeeded']);
    const final = await run.state();
    expect(final.findings).toHaveLength(100);
    expect(final.diagnostics).toMatchObject([{ code: 'FINDING_IDENTITY_LIMIT' }]);
  } finally {
    await owner.close();
  }
});

test('rejects an exact citation from a different manifest containing the same file bytes', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('same-bytes-manifest', model);
    const { rows: [original] } = await db.query<{ manifest: BootstrapManifest }>(
      'SELECT manifest FROM source_manifests WHERE manifest_id=$1', [run.facts.binding.manifestId]);
    const id = 'findings-second-manifest';
    const draft = { ...original!.manifest, id, epoch: original!.manifest.epoch + 1,
      streams: original!.manifest.streams.map(stream => ({ ...stream, snapshotId: id + ':' + stream.streamId })),
    };
    const dependencies = { db, store, clock };
    await publishManifest(dependencies, localSourceCatalog, { ...draft, hash: hashManifest(draft) }, []);
    const captured = await captureBaseline(dependencies, id);
    if (!captured.ok) throw new Error('Expected a complete new capture');
    const { rows: [sameBytes] } = await db.query<{ evidence_id: string; prior_id: string }>(`
      SELECT second.evidence_id,first.evidence_id AS prior_id FROM source_evidence first JOIN source_evidence second
        ON first.file_id=second.file_id AND first.evidence->>'sha256'=second.evidence->>'sha256'
      WHERE first.snapshot_id=$1 AND second.snapshot_id=$2 LIMIT 1`, [run.facts.binding.snapshotId, captured.snapshot.id]);
    expect(sameBytes!.evidence_id).not.toBe(sameBytes!.prior_id);
    const [step] = await run.execute(owner, [publish('other-epoch', { evidenceRefs: [sameBytes!.evidence_id] })]);
    expect(await storedStep(step!)).toMatchObject({ state: 'failed', result: { ok: false, code: 'DISCOVERY_FORBIDDEN' } });
    expect((await run.state()).findings).toEqual([]);
  } finally {
    await owner.close();
  }
});

test('same dispatch replay cannot change a finding native payload', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools, {});
  try {
    const run = await createRun('changed-native-finding', model);
    const dispatch = owner.dispatchTask(run.runId, run.taskId)!;
    const turn = await model.at(0).turn.promise;
    const accepted = modelResult(turn, [publish('native')]);
    model.at(0).result.resolve(accepted);
    await dispatch.done;
    await dispatch.replayTestResult!(accepted);
    await expect(dispatch.replayTestResult!(modelResult(turn, [publish('native', { value: 'changed' })])))
      .rejects.toMatchObject({ statusCode: 409 });
    const step = createToolStepId({ dispatchId: turn.dispatchId, providerToolCallId: 'native' });
    expect(await owner.executePendingStep(run.runId, run.taskId, step)).toMatchObject({ ok: true, revision: 1 });
    expect((await run.state()).findings).toHaveLength(1);
  } finally {
    await owner.close();
  }
});

test('007 grants preserve immutable finding, proposal and compile source data', async () => {
  const expected: Record<string, string[]> = {
    discovery_finding_identities: ['current_revision'],
    discovery_finding_revisions: [],
    discovery_finding_derivations: [],
    discovery_finding_blockers: [],
    discovery_proposal_identities: ['current_revision'],
    discovery_proposal_revisions: [],
    discovery_proposal_findings: [],
    discovery_proposal_investigations: [],
    discovery_proposal_assessments: [],
    discovery_proposal_current: ['assessment_revision', 'compile_step_id', 'proposal_revision', 'result'],
    discovery_compile_steps: ['registration', 'result', 'state'],
  };
  const { rows } = await db.query<{ table_name: string; updates: string[]; allowed: boolean }>(`
    SELECT table_name,
      coalesce(array_agg(column_name::text ORDER BY column_name)
        FILTER (WHERE has_column_privilege(current_user, 'public.'||table_name, column_name, 'UPDATE')), '{}') AS updates,
      bool_and(has_table_privilege(current_user,'public.'||table_name,'SELECT,INSERT')
        AND NOT has_table_privilege(current_user,'public.'||table_name,'DELETE,TRUNCATE')) AS allowed
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1)
    GROUP BY table_name`, [Object.keys(expected)]);
  expect(rows).toHaveLength(Object.keys(expected).length);
  for (const row of rows) {
    expect(row.allowed).toBe(true);
    expect(row.updates).toEqual(expected[row.table_name]);
  }
});

test('007 binds proposal and compile edges to their exact run, revision, assessment and tool step', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  const client = await db.connect();
  try {
    const run = await createRun('construction-fk', model);
    const [step, compileStep] = await run.execute(owner, [publish('finding'), { id: 'compile', name: 'compileConnector', arguments: {} }]);
    const state = await run.state();
    const finding = state.findings[0]!;
    const investigation = state.tasks[0]!.investigationId;
    await client.query('BEGIN');
    async function rejects(sql: string, values: unknown[], code: string) {
      await client.query('SAVEPOINT probe');
      await expect(client.query(sql, values)).rejects.toMatchObject({ code });
      await client.query('ROLLBACK TO SAVEPOINT probe');
    }
    const args = [run.runId, 'proposal', run.taskId, step, 'a'.repeat(64)];
    await client.query("INSERT INTO discovery_proposal_identities VALUES ($1,$2,1)", args.slice(0, 2));
    const proposal = "INSERT INTO discovery_proposal_revisions VALUES ($1,$2,1,$3,$4,'{}','{}',$5)";
    await rejects(proposal, [...args.slice(0, 4), 'bad-hash'], '23514');
    await client.query(proposal, args);
    await rejects("INSERT INTO discovery_proposal_revisions VALUES ($1,$2,2,$3,$4,'{}','{}',$5)", args, '23505');
    await rejects('INSERT INTO discovery_proposal_findings VALUES ($1,$2,1,$3,2)', [run.runId, 'proposal', finding.id], '23503');
    await client.query('INSERT INTO discovery_proposal_findings VALUES ($1,$2,1,$3,1)', [run.runId, 'proposal', finding.id]);
    await rejects('INSERT INTO discovery_proposal_investigations VALUES ($1,$2,$3)', [run.runId, 'proposal', 'unrelated'], '23503');
    await client.query('INSERT INTO discovery_proposal_investigations VALUES ($1,$2,$3)', [run.runId, 'proposal', investigation]);
    await rejects("INSERT INTO discovery_proposal_assessments VALUES ($1,$2,2,1,1,'{}')", [run.runId, 'proposal'], '23503');
    await client.query("INSERT INTO discovery_proposal_assessments VALUES ($1,$2,1,1,1,'{}'),($1,$2,1,2,1,'{}')", [run.runId, 'proposal']);
    const compile = "INSERT INTO discovery_compile_steps (run_id,task_id,tool_step_id,proposal_id,proposal_revision,assessment_revision,generation,source_payload) VALUES ($1,$2,$3,$4,1,$5,1,'{}')";
    await rejects(compile, [run.runId, run.taskId, compileStep, 'proposal', 3], '23503');
    await client.query(compile, [run.runId, run.taskId, compileStep, 'proposal', 1]);
    await rejects("UPDATE discovery_compile_steps SET state='registered' WHERE tool_step_id=$1", [compileStep], '23514');
    await rejects("UPDATE discovery_compile_steps SET source_payload='{}' WHERE tool_step_id=$1", [compileStep], '42501');
    await rejects("INSERT INTO discovery_proposal_current VALUES ($1,$2,1,2,$3,'{}')", [run.runId, 'proposal', compileStep], '23503');
    await client.query("INSERT INTO discovery_proposal_current VALUES ($1,$2,1,1,$3,'{}')", [run.runId, 'proposal', compileStep]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await owner.close();
  }
});

let expandedCapture: ReturnType<typeof buildExpandedCapture> | undefined;
const getExpandedCapture = () => expandedCapture ??= buildExpandedCapture();

async function buildExpandedCapture() {
  const { companyId, sourceRef } = companyA;
  const { rows: [head] } = await db.query<{ manifest: BootstrapManifest }>(
    'SELECT manifest FROM source_manifests WHERE source_ref=$1 ORDER BY epoch DESC LIMIT 1', [sourceRef]);
  const manifest = head!.manifest;
  const { rows } = await db.query<{ event: RawSourceEvent }>(
    'SELECT event FROM source_events WHERE source_ref=$1 ORDER BY sequence', [sourceRef]);
  const original = rows.map(row => row.event);
  const id = 'manifest-findings-seller-collision';
  const instant = clock().toISOString();
  const date = instant.slice(0, 10);
  const sequence = original.filter(event => event.streamId === 'a-finance').length + 1;
  const sellers = Array.from({ length: 22 }, (_, index) => 'seller-collision-' + index);
  const sourceAccountId = 'shared-collision-account';
  const extra = sellers.map((sellerEntityId, index) => {
    const base = eventA({ kind: 'invoice', recordId: 'collision-invoice-' + index,
      sourceAccountId: index < 2 ? sourceAccountId : 'expanded-account-' + index,
      effectiveDate: date, fields: { amount: '1.00', due_date: date } }, sequence + index, instant);
    const event = { ...base, rawIdentity: { ...base.rawIdentity, sellerEntityId } };
    return { ...event, contentHash: hashEvent(event) };
  });
  const allEvents = [...original, ...extra];
  const draft = {
    ...manifest, id, epoch: manifest.epoch + 1,
    streams: manifest.streams.map(({ streamId }) => {
      const members = allEvents.filter(event => event.streamId === streamId);
      const resumeAfter = String(members.length);
      return { streamId, resumeAfter, snapshotId: id + ':' + streamId, eventIds: members.map(event => event.id),
        snapshotHash: streamContentHash(sourceRef, streamId, resumeAfter, members) };
    }),
    semanticVersions: { ...manifest.semanticVersions, ...Object.fromEntries(extra.map(event =>
      [event.rawIdentity.sellerEntityId + '/' + event.rawIdentity.sourceAccountId, event.semanticVersion])) },
  };
  const prepared = await Promise.all(extra.map(event =>
    prepareApiRecord(companyA, store, event, Buffer.from(JSON.stringify(event.payload)))));
  const dependencies = { db, store, clock };
  await publishManifest(dependencies, localSourceCatalog, { ...draft, hash: hashManifest(draft) }, prepared);
  expect((await captureBaseline(dependencies, id)).ok).toBe(true);
  return { companyId, sourceRef, manifestId: id, sellers, sourceAccountId };
}

test('rejects a citation for the same source account ID under another captured seller', async () => {
  const { companyId, sourceRef, manifestId, sellers, sourceAccountId } = await getExpandedCapture();
  const model = scriptedModel();
  const { readTools } = instrumentReads();
  const owner = await acquire(model.model, readTools, {});
  try {
    const run = await createRun('seller-collision', model, { companyId, manifestId });
    const subject = { kind: 'source_account' as const, sellerEntityId: sellers[0]!, sourceAccountId };
    const child = await addSpecialist(owner, run.runId, subject);
    const query = await readTools.prepare({ name: 'querySnapshot', binding: run.facts.binding,
      sourceRead: { companyId, sourceRef, sourceWide: true, accounts: [] },
      arguments: { account: { sellerEntityId: sellers[1]!, sourceAccountId }, limit: 1 } });
    if (!query.result.ok || !('events' in query.result)) throw new Error('Expected captured seller events');
    const [step] = await run.execute(owner, [publish('cross-seller', {
      subject, evidenceRefs: [query.result.events[0]!.evidenceIds[0]!],
    })], 0, child);
    expect(await storedStep(step!)).toMatchObject({ result: { ok: false, code: 'DISCOVERY_FORBIDDEN' } });
    expect((await run.state()).findings).toEqual([]);
  } finally {
    await owner.close();
  }
});

test.each([
  { code: 'SPECIALIST_LIMIT', recovered: false, seeded: 10 },
  { code: 'SPECIALIST_LIMIT', recovered: true, seeded: 9 },
  { code: 'INVESTIGATION_LIMIT', recovered: true, seeded: 20 },
  { code: 'INVESTIGATION_LIMIT', recovered: false, seeded: 19 },
])('mixed batch rejects $code at $seeded before effects, recovered=$recovered', async ({ code, recovered, seeded }) => {
  const model = scriptedModel();
  const { readTools } = instrumentReads();
  let owner = await acquire(model.model, readTools, {});
  try {
    const accountLimit = code === 'INVESTIGATION_LIMIT';
    const selection = accountLimit ? await getExpandedCapture() : undefined;
    const run = await createRun('mixed-capacity-' + seeded, model, selection);
    const source = { kind: 'source' } as const;
    const accounts = run.facts.sourceAccounts;
    const seed = accountLimit ? accounts.slice(0, seeded) : Array<DiscoverySubject>(seeded).fill(source);
    expect(seed).toHaveLength(seeded);
    for (const subject of seed) await addSpecialist(owner, run.runId, subject);
    const before = await run.state();
    const requested = seeded % 2 === 0 ? 1 : 2;
    const subjects = accountLimit ? accounts.slice(seeded, seeded + requested) : Array<DiscoverySubject>(requested).fill(source);
    expect(subjects).toHaveLength(requested);
    const ids = await run.accept(owner, [
      publish('before-capacity'), describe,
      ...subjects.map((subject, ordinal) => ({ ...delegate, id: 'capacity-' + ordinal, arguments: { ...delegate.arguments, subject } })),
    ]);
    if (recovered) {
      await owner.close();
      owner = await acquire(model.model, readTools, {});
    }
    for (const step of ids) await owner.executePendingStep(run.runId, run.taskId, step);
    const after = await run.state();
    expect(after.findings).toEqual([]);
    expect(after.tasks.map(task => task.id)).toEqual(before.tasks.map(task => task.id));
    for (const [ordinal, step] of ids.entries()) expect(await storedStep(step)).toMatchObject({
      state: 'failed', result: { ok: false, code: ordinal < 2 ? 'DISCOVERY_CONFLICT' : code },
    });
    expect(after.diagnostics).toMatchObject([{ code }]);
    expect(await findingActivity(run.runId)).toEqual([]);
  } finally {
    await owner.close();
  }
});

test('two delegations for the same new account share the final investigation slot', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools, {});
  try {
    const run = await createRun('shared-final-slot', model, await getExpandedCapture());
    const accounts = run.facts.sourceAccounts;
    expect(accounts.length).toBeGreaterThanOrEqual(20);
    for (const subject of accounts.slice(0, 19)) await addSpecialist(owner, run.runId, subject);
    const subject = accounts[19]!;
    const ids = await run.execute(owner, ['first', 'second'].map(id => ({
      ...delegate, id, arguments: { ...delegate.arguments, subject },
    })));
    const result = await Promise.all(ids.map(storedStep));
    expect(result).toMatchObject([{ state: 'succeeded' }, { state: 'succeeded' }]);
    const tasks = (await run.state()).tasks.filter(task => task.subject.kind === 'source_account' &&
      task.subject.sellerEntityId === subject.sellerEntityId && task.subject.sourceAccountId === subject.sourceAccountId);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.investigationId).toBe(tasks[1]!.investigationId);
  } finally {
    await owner.close();
  }
});
