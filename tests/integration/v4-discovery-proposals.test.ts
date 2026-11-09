import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createToolStepId, hashCanonical, hashEvent, hashManifest, hashProfile, type BootstrapManifest, type DiscoveryBinding, type DiscoverySubject, type JsonObject, type MappingOp, type ModelResultV2, type ProposalResult, type RawSourceEvent } from '@eapr/contracts';
import { createEvidenceStore, type EvidenceStore } from '@eapr/evidence';
import { captureBaseline, companyA, createDiscoveryReadTools, prepareApiRecord, publishManifest, readDiscoveryCapture, streamContentHash } from '@eapr/sources';
import { eventA } from '../../packages/sources/src/company-a.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { recheckDiscoveryCapture } from '../../apps/control/src/discovery-composition.js';
import { createDiscoveryRepository } from '../../packages/discovery/src/repository.js';
import type { DiscoveryReadTools } from '../../packages/discovery/src/read-tools.js';
import { acquireDiscoverySupervisor } from '../../packages/discovery/src/supervisor.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { barrier, modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { testNamespace } from '../fixtures/harness.js';

const namespace = testNamespace('discproposal');
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

type Owner = Awaited<ReturnType<typeof acquire>>;

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

const findingInput = {
  expectedRevision: 0, subject: { kind: 'source' }, fieldPath: '/terms', value: 'assertion',
  provenanceClass: 'unresolved', evidenceStatus: 'insufficient', evidenceRefs: [],
  derivationInputs: [], alternatives: [], unresolvedQuestions: ['Which terms apply?'],
};

function publish(id: string, overrides: Record<string, ModelResultV2['toolCalls'][number]['arguments'][string]> = {}) {
  return { id, name: 'publishFinding', arguments: { ...findingInput, ...overrides } };
}


async function submittedFor(run: Awaited<ReturnType<typeof createRun>>, alias = run.facts.sourceAccounts[0]!) {
  const { binding } = run.facts;
  const source = localSourceCatalog.get(binding.companyId)!;
  const adapter = createDiscoveryReadTools({ db, store }, localSourceCatalog);
  const sourceRead = { companyId: binding.companyId, sourceRef: binding.sourceRef, sourceWide: true, accounts: [] };
  const page = await adapter.prepare({ binding, sourceRead, name: 'querySnapshot', arguments: {
    account: { sellerEntityId: alias.sellerEntityId, sourceAccountId: alias.sourceAccountId }, limit: 25,
  } });
  if (!page.result.ok || !('events' in page.result)) throw new Error('Expected captured account events');
  const citation = page.result.events.flatMap(event => event.evidenceIds)[0]!;
  const invoice = source.contracts.find(contract => contract.kind === 'invoice')!;
  const amountCents: MappingOp = binding.companyId === 'company-a' ? { op: 'decimal_to_minor', path: '/amount', scale: 2 } :
    { op: 'field', path: '/amount_minor' };
  const submitted = {
    expectedRevision: 0, findingRefs: [],
    spec: {
      id: 'scripted-spec', version: 1, sourceRef: binding.sourceRef,
      sourceContracts: [...source.contracts], capture: [...source.streams], mappings: [{
        resource: invoice.resource, kind: 'invoice', fields: {
          currency: { op: 'constant', value: 'USD', evidenceRef: citation },
          effectiveAt: { op: 'field', path: binding.companyId === 'company-a' ? '/effective_date' : '/posted_on' },
          amountCents,
          dueDate: { op: 'field', path: binding.companyId === 'company-a' ? '/due_date' : '/due_on' },
        },
      }],
      allowedKinds: ['invoice'], runtimeModelCalls: 'forbidden', maxTransactionCents: 5000000,
      maxRecordsPerCycle: 1000, targetSchemaVersion: '1', requiredValidators: [], evidenceRefs: [citation],
    },
    profiles: [{
      id: 'scripted-profile', version: 7, sourceRef: binding.sourceRef,
      scope: { companyId: binding.companyId, sellerEntityId: alias.sellerEntityId, accountId: 'proposed-account' },
      parentCustomerId: 'proposed-customer', sourceAccountIds: [alias.sourceAccountId], semanticVersion: 'original-v1',
      approvedLookups: [{ id: 'alias-map', valueType: 'parent-account',
        entries: [{ source: alias.sourceAccountId, target: 'proposed-account', evidenceRefs: [citation] }] }],
      contractTerms: [{ id: 'proposed-term', contractId: 'proposed-contract', validFrom: '2026-01-01',
        validToExclusive: null, fixedMonthlyFeeCents: 12500, currency: 'USD', cadence: 'monthly', anchorDay: 1,
        evidenceRefs: [citation] }],
      findings: [],
      bootstrap: { customer: { id: 'proposed-customer', displayName: 'Proposed Customer', evidenceRefs: [citation] },
        billingConfigurationIds: [{ termId: 'proposed-term', id: 'proposed-configuration' }] },
    }],
  } satisfies JsonObject;
  return { submitted, citation };
}

for (const companyId of ['company-a', 'company-b']) {
  test('scripted proposal persists actual submitted content and immutable edits for ' + companyId, async () => {
    const model = scriptedModel();
    const reads = instrumentReads();
    const owner = await acquire(model.model, reads.readTools);
    let restarted: Owner | undefined;
    try {
      const run = await createRun('proposal-history-' + companyId, model, captures.find(item => item.companyId === companyId)!);
      await run.execute(owner, [{ id: 'delegate', name: 'delegateTask', arguments: {
        subject: { kind: 'source' }, role: 'connector', question: 'Draft an actual connector', dependencyIds: [],
      } }]);
      const task = (await run.state()).tasks.find(item => item.role === 'connector')!;
      const { submitted, citation } = await submittedFor(run);
      await run.execute(owner, [
        { id: 'describe', name: 'describeSource', arguments: {} },
        publish('identity', { fieldPath: '/identity', evidenceRefs: [citation],
          provenanceClass: 'observed', evidenceStatus: 'supported' }),
      ], 1, task.id);
      const [finding] = (await run.state()).findings;
      const draft = { ...submitted, findingRefs: [{ findingId: finding!.id, revision: 1 }] };
      const [draftStep] = await run.execute(owner, [{ id: 'draft', name: 'draftConnector', arguments: draft }], 2, task.id);
      const state = await run.state();
      const proposal = state.proposals[0]!;
      expect(await storedStep(draftStep!)).toMatchObject({ state: 'succeeded', result: { ok: true, result: proposal } });
      expect(proposal).toMatchObject({ state: 'draft', assessment: { observedRunRevision: state.revision, revision: 1 } });
      expect(state.verificationJobs).toEqual([]);
      const edited = {
        ...draft, proposalId: proposal.proposalId, expectedRevision: 1,
        spec: { ...draft.spec, version: 2, mappings: draft.spec.mappings.map(mapping => ({
          ...mapping, fields: { ...mapping.fields, amountCents: { op: 'constant', value: 15625, evidenceRef: citation } },
        })) },
        profiles: draft.profiles.map(profile => ({
          ...profile, contractTerms: profile.contractTerms.map(term => ({ ...term, fixedMonthlyFeeCents: 15625 })),
        })),
      };
      await run.execute(owner, [{ id: 'revise', name: 'reviseConnector', arguments: edited }], 3, task.id);
      const { rows } = await db.query(
        'SELECT submitted,payload,payload_hash FROM discovery_proposal_revisions WHERE run_id=$1 ORDER BY revision', [run.runId]);
      expect(rows.map(row => row.submitted)).toEqual([draft, edited]);
      expect(rows.map(row => row.payload_hash)).toEqual(rows.map(row => hashCanonical(row.payload)));
      expect(rows[0].payload_hash).not.toBe(rows[1].payload_hash);
      expect(rows[1].payload.spec).toEqual({ ...edited.spec, id: 'discovery-spec:' + hashCanonical({
        runId: run.runId, submittedSpecId: draft.spec.id,
      }) });
      expect(rows[1].payload.profiles[0]).toEqual({
        ...edited.profiles[0], id: 'discovery-profile:' + hashCanonical({ runId: run.runId, proposalId: proposal.proposalId }),
        version: 2, hash: hashProfile(rows[1].payload.profiles[0]),
      });
      const current = (await run.state()).proposals[0] as ProposalResult;
      await owner.close();
      restarted = await acquire(model.model, reads.readTools);
      expect((await run.state()).proposals).toEqual([current]);
      const preparations = reads.preparations;
      const activity = await toolActivity(run);
      expect(await restarted.executePendingStep(run.runId, task.id, draftStep!)).toEqual({ ok: true, result: proposal });
      expect(reads.preparations).toBe(preparations);
      expect(await toolActivity(run)).toEqual(activity);
      expect(activity.filter(event => event.payload.toolStepId === draftStep)).toMatchObject([
        { type: 'tool.called', payload: { toolName: 'draftConnector', proposalId: proposal.proposalId, proposalRevision: 1 } },
        { type: 'tool.result', payload: { toolName: 'draftConnector', proposalId: proposal.proposalId, proposalRevision: 1 } },
      ]);
      expect((await db.query('SELECT count(*) FROM discovery_proposal_assessments WHERE run_id=$1', [run.runId])).rows)
        .toEqual([{ count: '2' }]);
    } finally {
      await restarted?.close();
      await owner.close();
    }
  });
}
async function buildExpandedCapture() {
  const { companyId, sourceRef } = companyA;
  const { rows: [head] } = await db.query<{ manifest: BootstrapManifest }>(
    'SELECT manifest FROM source_manifests WHERE source_ref=$1 ORDER BY epoch DESC LIMIT 1', [sourceRef]);
  const manifest = head!.manifest;
  const { rows } = await db.query<{ event: RawSourceEvent }>(
    'SELECT event FROM source_events WHERE source_ref=$1 ORDER BY sequence', [sourceRef]);
  const original = rows.map(row => row.event);
  const id = 'manifest-proposal-seller-collision';
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
  return { companyId, manifestId: id };
}


let expandedCapture: ReturnType<typeof buildExpandedCapture> | undefined;
const expanded = () => expandedCapture ??= buildExpandedCapture();
type Run = Awaited<ReturnType<typeof createRun>>;
type Submitted = Awaited<ReturnType<typeof submittedFor>>['submitted'];

const draftCall = (id: string, input: JsonObject) => ({ id, name: 'draftConnector', arguments: input });
const reviseCall = (id: string, proposal: ProposalResult, input: JsonObject) => ({
  id, name: 'reviseConnector', arguments: { ...input, proposalId: proposal.proposalId, expectedRevision: proposal.revision },
});

async function delegateConnector(run: Run, owner: Owner, subject: DiscoverySubject = { kind: 'source' }) {
  await run.execute(owner, [{ id: 'delegate', name: 'delegateTask', arguments: {
    subject, role: 'connector', question: 'Prepare draft rules', dependencyIds: [],
  } }]);
  return (await run.state()).tasks.find(task => task.role === 'connector')!.id;
}

async function addConnector(run: Run, owner: Owner, subject: DiscoverySubject = { kind: 'source' }) {
  const child = await owner.addTestSpecialist!(run.runId, { subject, role: 'connector', question: 'Prepare alternative rules', dependencyIds: [] });
  if (!child || !('taskId' in child) || !child.taskId) throw new Error('Expected connector task');
  return child.taskId;
}

function secondCustomer(first: Submitted, second: Submitted, accountId = 'second-proposed-account'): Submitted {
  const profile = second.profiles[0]!;
  return { ...second, spec: first.spec, profiles: [{ ...profile, scope: { ...profile.scope, accountId },
    approvedLookups: profile.approvedLookups.map(table => ({
      ...table, entries: table.entries.map(entry => ({ ...entry, target: accountId })),
    })),
  }] };
}

async function toolActivity(run: Run) {
  const { rows } = await db.query<{ event: { type: string; payload: JsonObject } }>(`
    SELECT event FROM activity_events WHERE event->>'runId'=$1 AND event->>'type' IN ('tool.called','tool.result')
    ORDER BY sequence`, [run.runId]);
  return rows.map(row => row.event);
}

test.each(['draft', 'read', 'finding'] as const)('a later invalid proposal rejects the whole %s batch before any effect',
  async first => {
    const model = scriptedModel();
    const reads = instrumentReads();
    let owner = await acquire(model.model, reads.readTools);
    try {
      const run = await createRun('mixed-proposal-' + first, model);
      const task = await delegateConnector(run, owner);
      const { submitted } = await submittedFor(run);
      const earlier = first === 'draft' ? draftCall('first', submitted) :
        first === 'read' ? { id: 'first', name: 'describeSource', arguments: {} } : publish('first');
      const invalid = first === 'draft' ? draftCall('last', submitted) : draftCall('last', {
        ...submitted, spec: { ...submitted.spec, evidenceRefs: ['unreadable-citation'] },
      });
      const before = await toolActivity(run);
      const ids = await run.accept(owner, [earlier, invalid], 1, task);
      if (first !== 'draft') {
        await owner.close();
        owner = await acquire(model.model, reads.readTools);
      }
      for (const id of ids) await owner.executePendingStep(run.runId, task, id);
      const expected = first === 'draft' ? 'DISCOVERY_CONFLICT' : 'DISCOVERY_FORBIDDEN';
      expect(await Promise.all(ids.map(storedStep))).toMatchObject(
        ids.map(() => ({ state: 'failed', result: { ok: false, code: expected } })));
      expect(await run.state()).toMatchObject({ findings: [], proposals: [], verificationJobs: [] });
      expect(await toolActivity(run)).toEqual(before);
      expect((await db.query('SELECT id FROM discovery_investigations WHERE run_id=$1 AND seller_entity_id IS NOT NULL',
        [run.runId])).rows).toEqual([]);
    } finally {
      await owner.close();
    }
  });

test('a finding revision atomically stales its consumer and clears the current compile link', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('proposal-stale', model);
    const task = await delegateConnector(run, owner);
    const { submitted, citation } = await submittedFor(run);
    const observed = { evidenceRefs: [citation], provenanceClass: 'observed', evidenceStatus: 'supported' };
    await run.execute(owner, [publish('observed', observed)], 1, task);
    const [finding] = (await run.state()).findings;
    const [draftStep] = await run.execute(owner, [draftCall('draft', {
      ...submitted, findingRefs: [{ findingId: finding!.id, revision: 1 }],
    })], 2, task);
    const before = (await run.state()).proposals[0]!;
    expect(before.state).toBe('draft');
    const priorPayload = (await db.query('SELECT payload,payload_hash FROM discovery_proposal_revisions WHERE run_id=$1', [run.runId])).rows;
    const [compileStep] = await run.execute(owner, [{ id: 'compile-history', name: 'compileConnector', arguments: {} }], 3, task);
    // Trusted setup exercises installed link constraints without invoking the compiler or registry.
    const artifactHash = 'c'.repeat(64);
    await admin.query(`INSERT INTO discovery_compile_steps
      (run_id,task_id,tool_step_id,proposal_id,proposal_revision,assessment_revision,generation,source_payload,state,result)
      VALUES($1,$2,$3,$4,1,1,1,$5,'settled',$6)`,
    [run.runId, task, compileStep, before.proposalId, { source: 'test' }, { artifactHash }]);
    const compiled = { ...before, state: 'compiled', artifactHash };
    await admin.query('UPDATE discovery_proposal_current SET compile_step_id=$2,result=$3 WHERE run_id=$1',
      [run.runId, compileStep, compiled]);
    expect((await run.state()).proposals).toEqual([compiled]);

    await run.execute(owner, [
      publish('new-observation', { ...observed, findingId: finding!.id, expectedRevision: 1 }),
    ], 4, task);
    const state = await run.state();
    expect(state.proposals[0]).toMatchObject({ state: 'compile_blocked', assessment: {
      revision: 2, observedRunRevision: state.revision, blockerRefs: [], diagnosticCodes: ['FINDING_REVISION_STALE'],
    } });
    expect(state.proposals[0]).not.toHaveProperty('artifactHash');
    expect((await db.query('SELECT compile_step_id FROM discovery_proposal_current WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ compile_step_id: null }]);
    expect((await db.query('SELECT state,result FROM discovery_compile_steps WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ state: 'settled', result: { artifactHash } }]);
    expect((await db.query('SELECT payload,payload_hash FROM discovery_proposal_revisions WHERE run_id=$1', [run.runId])).rows)
      .toEqual(priorPayload);
    expect((await db.query('SELECT count(*) FROM discovery_proposal_assessments WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ count: '2' }]);
    expect(await storedStep(draftStep!)).toMatchObject({ result: { result: before } });
    expect(state.verificationJobs).toEqual([]);
  } finally {
    await owner.close();
  }
});

test('a contradicted alias remains bound after omission, alias removal, and a positive finding revision', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools, {});
  try {
    const run = await createRun('proposal-sticky', model);
    const task = await delegateConnector(run, owner);
    const { submitted, citation } = await submittedFor(run);
    const subject = run.facts.sourceAccounts[0]!;
    const child = await addConnector(run, owner, subject);
    await run.execute(owner, [publish('contradiction', { subject, evidenceRefs: [citation],
      fieldPath: '/unknown/customer/field', provenanceClass: 'observed', evidenceStatus: 'contradicted',
    })], 1, child);
    const [finding] = (await run.state()).findings;
    await run.execute(owner, [draftCall('draft', submitted)], 2, task);
    const before = (await run.state()).proposals[0]!;
    const blockerRefs = [{ findingId: finding!.id, revision: 1, code: 'FINDING_RESOLUTION_PENDING' }];
    expect(before).toMatchObject({ state: 'compile_blocked', assessment: { blockerRefs } });
    const dropped = { ...submitted, profiles: submitted.profiles.map(profile => ({
      ...profile, sourceAccountIds: [], approvedLookups: [],
    })) };
    await run.execute(owner, [reviseCall('dropped-alias', before, dropped)], 3, task);
    const afterDrop = (await run.state()).proposals[0]!;
    expect(afterDrop.assessment.investigationIds).toEqual(before.assessment.investigationIds);
    expect(afterDrop.assessment.blockerRefs).toEqual(blockerRefs);
    await run.execute(owner, [draftCall('new-logical-proposal', secondCustomer(submitted, submitted))], 4, task);
    expect((await run.state()).proposals.map(proposal => proposal.assessment.blockerRefs)).toEqual([blockerRefs, blockerRefs]);
    await run.execute(owner, [publish('positive', { subject, evidenceRefs: [citation], findingId: finding!.id, expectedRevision: 1,
      fieldPath: '/unknown/customer/field', provenanceClass: 'observed', evidenceStatus: 'supported',
    })], 5, child);
    const final = await run.state();
    expect(final.proposals).toHaveLength(2);
    for (const result of final.proposals) expect(result).toMatchObject({ state: 'compile_blocked', assessment: {
      revision: 2, blockerRefs, observedRunRevision: final.revision,
    } });
    expect(final.proposals.find(result => result.proposalId === before.proposalId)).toMatchObject({
      revision: 2, assessment: { diagnosticCodes: ['PROPOSAL_EVIDENCE_APPLICABILITY_UNRESOLVED'] },
    });
  } finally {
    await owner.close();
  }
});

test('separate legal sellers may share an alias spelling and one exact specification', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('distinct-legal-sellers', model, await expanded());
    const task = await delegateConnector(run, owner);
    const aliases = run.facts.sourceAccounts.filter(subject => subject.sourceAccountId === 'shared-collision-account');
    expect(aliases).toHaveLength(2);
    const { submitted } = await submittedFor(run, aliases[0]!);
    const other = secondCustomer(submitted, (await submittedFor(run, aliases[1]!)).submitted);
    const ids = await run.execute(owner, [draftCall('first', submitted), draftCall('second', other)], 1, task);
    expect(await Promise.all(ids.map(storedStep))).toMatchObject([{ state: 'succeeded' }, { state: 'succeeded' }]);
    const state = await run.state();
    expect(state.proposals).toHaveLength(2);
    expect(state.proposals.map(proposal => proposal.state)).toEqual(['draft', 'draft']);
    const { rows } = await db.query(`
      SELECT seller_entity_id,source_account_id,specialist_count,repair_count FROM discovery_investigations
      WHERE run_id=$1 AND seller_entity_id IS NOT NULL ORDER BY seller_entity_id`, [run.runId]);
    expect(rows).toEqual(aliases.map(alias => ({
      seller_entity_id: alias.sellerEntityId, source_account_id: alias.sourceAccountId, specialist_count: 0, repair_count: 0,
    })));
    const specs = (await db.query("SELECT payload->'spec' AS spec FROM discovery_proposal_revisions WHERE run_id=$1", [run.runId])).rows;
    expect(specs[0]).toEqual(specs[1]);
  } finally {
    await owner.close();
  }
});

test('a projected second account exceeds capacity before either draft consumes the final slot', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools, {});
  try {
    const run = await createRun('proposal-investigation-capacity', model, await expanded());
    const task = await delegateConnector(run, owner);
    const accounts = run.facts.sourceAccounts;
    expect(accounts.length).toBeGreaterThanOrEqual(21);
    for (const account of accounts.slice(0, 19)) await addConnector(run, owner, account);
    const first = (await submittedFor(run, accounts[19]!)).submitted;
    const second = secondCustomer(first, (await submittedFor(run, accounts[20]!)).submitted);
    const ids = await run.execute(owner, [draftCall('last-slot', first), draftCall('excess', second)], 1, task);
    expect(await Promise.all(ids.map(storedStep))).toMatchObject(
      ids.map(() => ({ state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' } })));
    const state = await run.state();
    expect(state).toMatchObject({ proposals: [], diagnostics: [{ code: 'INVESTIGATION_LIMIT' }] });
    expect((await db.query(`SELECT count(*)::integer AS count,sum(specialist_count)::integer AS specialists
      FROM discovery_investigations WHERE run_id=$1 AND seller_entity_id IS NOT NULL`, [run.runId])).rows)
      .toEqual([{ count: 19, specialists: 19 }]);
  } finally {
    await owner.close();
  }
});

test.each(['spec', 'parent', 'alias', 'contract', 'seller', 'company'] as const)(
  'rejects conflicting %s before publication', async conflict => {
    const model = scriptedModel();
    const owner = await acquire(model.model, instrumentReads().readTools);
    try {
      const run = await createRun('proposal-conflict-' + conflict, model);
      const task = await delegateConnector(run, owner);
      const { submitted } = await submittedFor(run);
      const profile = submitted.profiles[0]!;
      let invalid = submitted;
      let expected = 'DISCOVERY_CONFLICT';
      if (conflict === 'spec') invalid = {
        ...secondCustomer(submitted, (await submittedFor(run, run.facts.sourceAccounts[1]!)).submitted),
        spec: { ...submitted.spec, evidenceRefs: [] },
      };
      if (conflict === 'parent') invalid = secondCustomer(
        submitted, (await submittedFor(run, run.facts.sourceAccounts[1]!)).submitted, profile.scope.accountId,
      );
      if (conflict === 'alias') invalid = secondCustomer(submitted, submitted);
      if (conflict === 'contract') invalid = { ...submitted, spec: { ...submitted.spec,
        sourceContracts: submitted.spec.sourceContracts.map(contract => ({ ...contract, schemaVersion: 'fabricated' })),
      } };
      if (conflict === 'seller') invalid = { ...submitted, profiles: [{ ...profile, scope: { ...profile.scope, sellerEntityId: 'missing-seller' } }] };
      if (conflict === 'company') {
        invalid = { ...submitted, profiles: [{ ...profile, scope: { ...profile.scope, companyId: 'company-b' }, sourceRef: 'legacy-b' }] };
        expected = 'DISCOVERY_FORBIDDEN';
      }
      const batch = ['spec', 'parent', 'alias'].includes(conflict) ? [draftCall('first', submitted)] : [];
      const ids = await run.execute(owner, [...batch, draftCall('invalid', invalid)], 1, task);
      expect(await Promise.all(ids.map(storedStep))).toMatchObject(
        ids.map(() => ({ state: 'failed', result: { ok: false, code: expected } })));
      expect((await run.state()).proposals).toEqual([]);
    } finally {
      await owner.close();
    }
  },
);

test.each(['alias', 'direct', 'constant', 'lookup', 'bootstrap', 'derivation'] as const)(
  'an account-limited connector cannot use forbidden %s dependencies', async variant => {
    const model = scriptedModel();
    const owner = await acquire(model.model, instrumentReads().readTools);
    try {
      const run = await createRun('proposal-scope-' + variant, model);
      const [own, sibling] = run.facts.sourceAccounts;
      const task = await delegateConnector(run, owner, own!);
      const { submitted, citation } = await submittedFor(run, own);
      const forbidden = await submittedFor(run, sibling);
      const profile = submitted.profiles[0]!;
      let input: JsonObject = submitted;
      let turn = 1;
      if (variant === 'alias') input = forbidden.submitted;
      if (variant === 'direct') input = { ...submitted, spec: { ...submitted.spec, evidenceRefs: [forbidden.citation] } };
      if (variant === 'constant') input = { ...submitted, spec: { ...submitted.spec, mappings: [{
        resource: 'a-invoices', kind: 'invoice', fields: {
          amountCents: { op: 'constant', value: 625, evidenceRef: forbidden.citation },
          currency: { op: 'field', path: '/currency' }, effectiveAt: { op: 'field', path: '/effective_date' },
          dueDate: { op: 'field', path: '/due_date' },
        },
      }] } };
      if (variant === 'lookup') input = { ...submitted, profiles: [{
        ...profile, approvedLookups: [{ id: 'text-extra', valueType: 'text',
          entries: [{ source: 'x', target: 'y', evidenceRefs: [forbidden.citation] }] }],
      }] };
      if (variant === 'bootstrap') input = { ...submitted, profiles: [{
        ...profile, bootstrap: { ...profile.bootstrap, customer: {
          ...profile.bootstrap.customer, evidenceRefs: [forbidden.citation],
        } },
      }] };
      if (variant === 'derivation') {
        await run.execute(owner, [publish('source-ancestor', { alternatives: [{ value: 'alternative', evidenceRefs: [forbidden.citation] }] })], turn++);
        const [ancestor] = (await run.state()).findings;
        await run.execute(owner, [publish('source-derived', { evidenceRefs: [citation],
          provenanceClass: 'derived', evidenceStatus: 'supported', derivationInputs: [{ findingId: ancestor!.id, revision: 1 }],
        })], turn++);
        const derived = (await run.state()).findings.find(finding => finding.id !== ancestor!.id)!;
        input = { ...submitted, findingRefs: [{ findingId: derived.id, revision: 1 }] };
      }
      const [step] = await run.execute(owner, [draftCall('forbidden', input)], turn, task);
      expect(await storedStep(step!)).toMatchObject({ state: 'failed', result: { ok: false, code: 'DISCOVERY_FORBIDDEN' } });
      expect((await run.state()).proposals).toEqual([]);
    } finally {
      await owner.close();
    }
  },
);

test('source-wide document readability preserves an inspectable draft with unresolved applicability', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('unknown-document-proposal', model);
    const task = await delegateConnector(run, owner);
    const { submitted } = await submittedFor(run);
    const { rows: [document] } = await db.query<{ evidence_id: string }>(
      'SELECT evidence_id FROM source_evidence WHERE snapshot_id=$1 AND file_id IS NOT NULL ORDER BY evidence_id LIMIT 1',
      [run.facts.binding.snapshotId]);
    const profile = submitted.profiles[0]!;
    const input = { ...submitted, profiles: [{ ...profile, contractTerms: profile.contractTerms.map(term => ({
      ...term, evidenceRefs: [document!.evidence_id],
    })), findings: [{
      id: 'legacy-pending', taskId: task, scope: profile.scope, fieldPath: '/monthly_fee', value: 12500,
      origin: 'agent', reviewDisposition: 'pending', provenanceClass: 'unresolved', evidenceStatus: 'insufficient',
      evidenceRefs: [document!.evidence_id], derivationInputs: [], revision: 1,
    }] }] };
    const [step] = await run.execute(owner, [draftCall('draft', input)], 1, task);
    expect(await storedStep(step!)).toMatchObject({ state: 'succeeded', result: { ok: true } });
    expect((await run.state()).proposals[0]).toMatchObject({
      state: 'compile_blocked', assessment: { diagnosticCodes: ['PROPOSAL_EVIDENCE_APPLICABILITY_UNRESOLVED'] },
    });
    expect((await db.query("SELECT payload->'profiles'->0->'findings' AS findings FROM discovery_proposal_revisions WHERE run_id=$1",
      [run.runId])).rows).toEqual([{ findings: input.profiles[0]!.findings }]);
  } finally {
    await owner.close();
  }
});

test.each(['authorized', 'retained-alias', 'retained-citation', 'unknown-coverage'] as const)(
  'a new task must reauthorize prior proposal dependencies: %s', async variant => {
    const model = scriptedModel();
    const owner = await acquire(model.model, instrumentReads().readTools, {});
    try {
      const run = await createRun('proposal-revision-grant-' + variant, model);
      const wide = await delegateConnector(run, owner);
      const [own, sibling] = run.facts.sourceAccounts;
      expect(sibling!.sellerEntityId).toBe(own!.sellerEntityId);
      const narrow = await addConnector(run, owner, own);
      const { submitted } = await submittedFor(run, own);
      const profile = submitted.profiles[0]!;
      let prior: JsonObject = submitted;
      if (variant === 'retained-alias') prior = { ...submitted, profiles: [{
        ...profile, sourceAccountIds: [own!.sourceAccountId, sibling!.sourceAccountId],
      }] };
      if (variant === 'retained-citation') prior = { ...submitted, profiles: [{
        ...profile, contractTerms: profile.contractTerms.map(term => ({
          ...term, evidenceRefs: [], // The sibling evidence is only retained in the immutable lookup dependency.
        })),
        approvedLookups: [...profile.approvedLookups, { id: 'other-table', valueType: 'text', entries: [{
          source: 'other', target: 'other', evidenceRefs: [(await submittedFor(run, sibling)).citation],
        }] }],
      }] };
      if (variant === 'unknown-coverage') {
        const { rows: [document] } = await db.query<{ evidence_id: string }>(
          'SELECT evidence_id FROM source_evidence WHERE snapshot_id=$1 AND file_id IS NOT NULL ORDER BY evidence_id LIMIT 1',
          [run.facts.binding.snapshotId]);
        prior = { ...submitted, profiles: [{ ...profile, contractTerms: profile.contractTerms.map(term => ({
          ...term, evidenceRefs: [document!.evidence_id],
        })) }] };
      }
      await run.execute(owner, [draftCall('wide-draft', prior)], 1, wide);
      const proposal = (await run.state()).proposals[0]!;
      const [step] = await run.execute(owner, [reviseCall('narrow-revision', proposal, submitted)], 2, narrow);
      if (variant === 'authorized') {
        expect(await storedStep(step!)).toMatchObject({ state: 'succeeded', result: { ok: true, result: { revision: 2 } } });
        expect((await run.state()).proposals[0]).toMatchObject({ proposalId: proposal.proposalId, state: 'draft', revision: 2 });
      } else {
        expect(await storedStep(step!)).toMatchObject({ state: 'failed', result: { ok: false, code: 'DISCOVERY_FORBIDDEN' } });
        expect((await run.state()).proposals[0]).toEqual(proposal);
      }
    } finally {
      await owner.close();
    }
  },
);

test('a concurrent revision that commits during evidence I/O wins exact proposal CAS', async () => {
  const model = scriptedModel();
  const entered = barrier<void>();
  const release = barrier<void>();
  let hold = false;
  const reads = instrumentReads(undefined, async () => {
    if (!hold) return;
    hold = false;
    entered.resolve();
    await release.promise;
  });
  const owner = await acquire(model.model, reads.readTools, {});
  let pending: Promise<unknown> | undefined;
  try {
    const run = await createRun('proposal-revision-race', model);
    const first = await delegateConnector(run, owner);
    const second = await addConnector(run, owner);
    const { submitted } = await submittedFor(run);
    await run.execute(owner, [draftCall('draft', submitted)], 1, first);
    const proposal = (await run.state()).proposals[0]!;
    const [staleStep] = await run.accept(owner, [reviseCall('stale', proposal, submitted)], 2, first);
    const [winnerStep] = await run.accept(owner, [reviseCall('winner', proposal, submitted)], 3, second);
    hold = true;
    pending = owner.executePendingStep(run.runId, first, staleStep!);
    await entered.promise;
    expect(await owner.executePendingStep(run.runId, second, winnerStep!)).toMatchObject({
      ok: true, result: { proposalId: proposal.proposalId, revision: 2 },
    });
    release.resolve();
    expect(await pending).toEqual({ ok: false, code: 'DISCOVERY_CONFLICT' });
    expect((await run.state()).proposals[0]).toMatchObject({ proposalId: proposal.proposalId, revision: 2 });
    const rows = (await db.query('SELECT tool_step_id FROM discovery_proposal_revisions WHERE run_id=$1 ORDER BY revision',
      [run.runId])).rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ tool_step_id: winnerStep });
  } finally {
    release.resolve();
    await pending;
    await owner.close();
  }
});

test.each(['pause', 'policy', 'owner', 'accepted-dispatch'] as const)(
  'proposal work is fenced by %s before commit', async fence => {
    const model = scriptedModel();
    const entered = barrier<void>();
    const release = barrier<void>();
    const hold = async () => { entered.resolve(); await release.promise; };
    const reads = instrumentReads(undefined, fence === 'policy' ? undefined : async invocation => {
      if (invocation === 1) await hold();
    });
    let owner = await acquire(model.model, reads.readTools, fence === 'policy' ? { beforeProposalCommit: hold } : {});
    let pending: Promise<unknown> | undefined;
    try {
      const run = await createRun('proposal-fence-' + fence, model);
      const task = await delegateConnector(run, owner);
      const { submitted } = await submittedFor(run);
      const [step] = await run.accept(owner, [draftCall('draft', submitted)], 1, task);
      const before = await toolActivity(run);
      pending = owner.executePendingStep(run.runId, task, step!);
      await entered.promise;
      if (fence === 'pause') await run.action('pause', 'pause-during-source-io');
      if (fence === 'policy') enabled = false;
      if (fence === 'owner') {
        await owner.close();
        owner = await acquire(model.model, reads.readTools);
      }
      if (fence === 'accepted-dispatch') {
        await admin.query(`UPDATE discovery_dispatches SET accepted=jsonb_set(accepted,'{toolCalls,0,arguments,expectedRevision}','1')
          WHERE id=(SELECT dispatch_id FROM discovery_tool_steps WHERE id=$1)`, [step]);
      }
      release.resolve();
      expect(await pending).toBeUndefined();
      enabled = true;
      expect((await run.state()).proposals).toEqual([]);
      expect(await toolActivity(run)).toEqual(before);
      expect(await storedStep(step!)).toMatchObject({ state: 'pending', result: null });
    } finally {
      enabled = true;
      release.resolve();
      await pending;
      await owner.close();
    }
  },
);

test('a finding later in the same batch invalidates an earlier valid proposal', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('proposal-mixed-invalidation', model);
    const task = await delegateConnector(run, owner);
    const { submitted, citation } = await submittedFor(run);
    const evidence = { evidenceRefs: [citation], provenanceClass: 'observed', evidenceStatus: 'supported' };
    await run.execute(owner, [publish('first', evidence)], 1, task);
    const [finding] = (await run.state()).findings;
    const ids = await run.execute(owner, [
      draftCall('draft', { ...submitted, findingRefs: [{ findingId: finding!.id, revision: 1 }] }),
      publish('revision', { ...evidence, findingId: finding!.id, expectedRevision: 1 }),
    ], 2, task);
    expect(await storedStep(ids[0]!)).toMatchObject({ result: { ok: true, result: { state: 'draft' } } });
    const state = await run.state();
    expect(state.proposals[0]).toMatchObject({ state: 'compile_blocked', assessment: {
      revision: 2, observedRunRevision: state.revision, diagnosticCodes: ['FINDING_REVISION_STALE'],
    } });
  } finally {
    await owner.close();
  }
});

test('an earlier projected finding revision makes a later old citation fail before effects', async () => {
  const model = scriptedModel();
  const owner = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('proposal-projected-stale-finding', model);
    const task = await delegateConnector(run, owner);
    const { submitted, citation } = await submittedFor(run);
    const evidence = { evidenceRefs: [citation], provenanceClass: 'observed', evidenceStatus: 'supported' };
    await run.execute(owner, [publish('first', evidence)], 1, task);
    const [finding] = (await run.state()).findings;
    const before = await toolActivity(run);
    const ids = await run.execute(owner, [
      publish('revision', { ...evidence, findingId: finding!.id, expectedRevision: 1 }),
      draftCall('stale-draft', { ...submitted, findingRefs: [{ findingId: finding!.id, revision: 1 }] }),
    ], 2, task);
    expect(await Promise.all(ids.map(storedStep))).toMatchObject(
      ids.map(() => ({ state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' } })));
    expect(await run.state()).toMatchObject({ findings: [finding], proposals: [] });
    expect(await toolActivity(run)).toEqual(before);
  } finally {
    await owner.close();
  }
});

async function seedNearLimitOrigins(run: Run, current: ProposalResult) {
  const size = (blockerRefs: ProposalResult['assessment']['blockerRefs']) => Buffer.byteLength(JSON.stringify({
    ok: true, result: { ...current, state: 'compile_blocked', assessment: { ...current.assessment, blockerRefs } },
  }));
  const code = 'FINDING_RESOLUTION_PENDING';
  const target = 65_536 - 150;
  let refs: ProposalResult['assessment']['blockerRefs'] = [];
  for (let width = 160; width >= 130; width--) {
    refs = [];
    for (let index = 0; ; index++) {
      const ref = { findingId: 'historical-' + Math.floor(index / 4).toString().padStart(width - 11, '0'),
        revision: index % 4 + 1, code };
      if (size([...refs, ref]) > target) break;
      refs.push(ref);
    }
    const filler = { findingId: 'f', revision: 1, code };
    const length = 1 + target - size([...refs, filler]);
    if (length >= 1 && length <= 160) {
      refs.push({ ...filler, findingId: 'f'.repeat(length) });
      break;
    }
  }
  expect(size(refs)).toBe(target);
  const added = (index: number) => ({ findingId: index.toString().padStart(36, '0'), revision: 1, code });
  expect(size([...refs, added(1)])).toBeLessThan(65_536);
  expect(size([...refs, added(1), added(2)])).toBeGreaterThan(65_536);

  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const rows = refs.map((ref, index) => ({
      ...ref, task_id: run.runId + '-history-task-' + Math.floor(index / 36),
      dispatch_id: run.runId + '-history-dispatch-' + Math.floor(index / 4),
      step_id: run.runId + '-history-step-' + index, attempt: Math.floor(index / 4) % 9 + 1, ordinal: index % 4,
    }));
    const entries = JSON.stringify(rows);
    const records = `jsonb_to_recordset($2) AS x("findingId" text,revision int,code text,task_id text,
      dispatch_id text,step_id text,attempt int,ordinal int)`;
    await client.query(`INSERT INTO discovery_tasks(run_id,id,investigation_id,role,question,grants,status)
      SELECT DISTINCT t.run_id,x.task_id,t.investigation_id,'contract','Historical test finding',t.grants,'succeeded'
      FROM discovery_tasks t CROSS JOIN ${records} WHERE t.run_id=$1 AND t.role='coordinator'`, [run.runId, entries]);
    await client.query(`INSERT INTO discovery_dispatches(id,run_id,task_id,attempt,generation,task_revision,state,request_hash,accounting)
      SELECT DISTINCT dispatch_id,$1,task_id,attempt,1,1,'returned','test','known' FROM ${records}`, [run.runId, entries]);
    await client.query(`INSERT INTO discovery_tool_steps(id,dispatch_id,run_id,task_id,native_id,ordinal,name,input_hash,arguments,generation,state)
      SELECT step_id,dispatch_id,$1,task_id,step_id,ordinal,'publishFinding','test','{}',1,'succeeded'
      FROM ${records}`, [run.runId, entries]);
    await client.query(`INSERT INTO discovery_finding_identities(run_id,id,investigation_id,current_revision)
      SELECT $1,x."findingId",t.investigation_id,max(x.revision) FROM ${records}
      JOIN discovery_tasks t ON t.id=x.task_id GROUP BY x."findingId",t.investigation_id`, [run.runId, entries]);
    await client.query(`INSERT INTO discovery_finding_revisions(run_id,finding_id,revision,investigation_id,task_id,tool_step_id,payload)
      SELECT $1,x."findingId",x.revision,t.investigation_id,x.task_id,x.step_id,
        $3::jsonb || jsonb_build_object('id',x."findingId",'revision',x.revision,'taskId',x.task_id)
      FROM ${records} JOIN discovery_tasks t ON t.id=x.task_id`, [run.runId, entries, {
      schemaVersion: 2, subject: { kind: 'source' }, fieldPath: '/terms', value: null,
      provenanceClass: 'unresolved', evidenceStatus: 'insufficient', evidenceRefs: [], derivationInputs: [],
      alternatives: [], unresolvedQuestions: [], reviewDisposition: 'pending', origin: 'agent',
    }]);
    await client.query(`INSERT INTO discovery_finding_blockers(run_id,finding_id,origin_revision,investigation_id,code)
      SELECT $1,x."findingId",x.revision,t.investigation_id,x.code FROM ${records}
      JOIN discovery_tasks t ON t.id=x.task_id`, [run.runId, entries]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return refs.length;
}

test.each([false, true])('later reassessment overflow rolls back the whole batch, recovered=%s', async recovered => {
  const model = scriptedModel();
  const reads = instrumentReads();
  let owner = await acquire(model.model, reads.readTools);
  try {
    const run = await createRun('reassessment-overflow-' + recovered, model);
    const task = await delegateConnector(run, owner);
    const { submitted } = await submittedFor(run);
    await run.execute(owner, [draftCall('draft', submitted)], 1, task);
    const before = (await run.state()).proposals[0]!;
    const originCount = await seedNearLimitOrigins(run, before);
    const activity = await toolActivity(run);
    const ids = await run.accept(owner, [publish('fits-alone'), publish('crosses-limit')], 2, task);
    if (recovered) {
      await owner.close();
      owner = await acquire(model.model, reads.readTools);
    }
    for (const step of ids) await owner.executePendingStep(run.runId, task, step);
    expect(await Promise.all(ids.map(storedStep))).toMatchObject(ids.map(() => ({
      state: 'failed', result: { ok: false, code: 'TOOL_RESULT_LIMIT' },
    })));
    expect((await run.state()).proposals).toEqual([before]);
    expect(await toolActivity(run)).toEqual(activity);
    expect((await db.query('SELECT count(*)::integer FROM discovery_finding_blockers WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ count: originCount }]);
    expect((await db.query('SELECT count(*)::integer FROM discovery_proposal_assessments WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ count: 1 }]);
  } finally {
    await owner.close();
  }
});
