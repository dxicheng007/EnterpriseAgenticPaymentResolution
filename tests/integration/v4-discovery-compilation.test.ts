import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  createToolStepId, hashCanonical, type DiscoveryBinding, type EntityMapping, type JsonObject,
  type MappingOp, type ModelResultV2, type ProposalResult,
} from '@eapr/contracts';
import { createEvidenceStore, type EvidenceStore } from '@eapr/evidence';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createDiscoveryReadTools, readDiscoveryCapture, type SourceDefinition } from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import {
  assertConstructionCapture, type ConstructionCapture,
} from '../../packages/discovery/src/compilation.js';
import { recheckDiscoveryCapture } from '../../apps/control/src/discovery-composition.js';
import { createDiscoveryRepository } from '../../packages/discovery/src/repository.js';
import type { DiscoveryReadTools } from '../../packages/discovery/src/read-tools.js';
import { acquireDiscoverySupervisor } from '../../packages/discovery/src/supervisor.js';
import { readDiscoveryCaptureContents } from '../../packages/sources/src/discovery-reads.js';
import { readSnapshot } from '../../packages/sources/src/dossier.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { barrier, modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { testNamespace } from '../fixtures/harness.js';

const namespace = testNamespace('disccompile');
const clock = () => new Date('2026-11-08T00:00:00.000Z');
const reviewer = { reviewerId: 'demo-reviewer', allowedSourceRefs: ['legacy-a', 'legacy-b'], allowedAccountIds: [] };
let db: Pool;
let admin: Pool;
let runtime: Pool;
let directory: string;
let registryRoot: string;
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
  directory = await mkdtemp(join(tmpdir(), 'eapr-discovery-compile-'));
  registryRoot = join(directory, 'registry');
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
  let preparations = 0;
  const readTools: DiscoveryReadTools = {
    async prepare(input) {
      preparations++;
      return createDiscoveryReadTools({ db, store }, localSourceCatalog).prepare(input);
    },
    async prepareDocumentApplicability(input) {
      preparations++;
      return createDiscoveryReadTools({ db, store }, localSourceCatalog).prepareDocumentApplicability(input);
    },
  };
  return { readTools, get preparations() { return preparations; } };
}

async function acquire(
  model: ReturnType<typeof scriptedModel>['model'],
  readTools: DiscoveryReadTools,
  options: {
    testHooks?: Parameters<typeof acquireDiscoverySupervisor>[0]['testHooks'];
    registerCandidate?: NonNullable<Parameters<typeof acquireDiscoverySupervisor>[0]['registerCandidate']>;
    constructionCapture?: typeof constructionCapture;
  } = {},
) {
  const registry = createCandidateRegistry(db, registryRoot);
  const owner = await acquireDiscoverySupervisor({
    db, clock, resolveAuthority, model, readTools, capture: captureAccess,
    constructionCapture: options.constructionCapture ?? constructionCapture,
    registerCandidate: options.registerCandidate ?? registry.registerCandidate.bind(registry),
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

function compileMappings(companyId: string, source: SourceDefinition, citation: string): EntityMapping[] {
  const company = companyId === 'company-a' ? 'a' : 'b';
  const paths = company === 'a'
    ? { date: '/effective_date', due: '/due_date', amount: '/amount', fundingKind: '/funding_kind',
      funding: '/funding_id', invoice: '/invoice_id', reversedKind: '/reversed_kind', reversed: '/reversed_id' }
    : { date: '/posted_on', due: '/due_on', amount: '/amount_minor', fundingKind: '/receipt_type',
      funding: '/receipt_key', invoice: '/bill_key', reversedKind: '/void_type', reversed: '/void_key' };
  const field = (path: string): MappingOp => ({ op: 'field', path });
  const fundingKind = (path: string): MappingOp => ({
    op: 'enum_lookup', path, values: { payment: 'payment', credit: 'credit' },
  });
  const common = {
    currency: { op: 'constant' as const, value: 'USD', evidenceRef: citation },
    effectiveAt: { op: 'date_parse' as const, path: paths.date, format: 'YYYY-MM-DD' as const, timezone: 'UTC' as const },
  };
  const amountCents: MappingOp = company === 'a'
    ? { op: 'decimal_to_minor', path: paths.amount, scale: 2 }
    : field(paths.amount);
  const money = { ...common, amountCents };
  const mappings: EntityMapping[] = [];
  for (const { resource, kind } of source.contracts) {
    if (kind === 'invoice') {
      mappings.push({ resource, kind, fields: { ...money, dueDate: field(paths.due) } });
    } else if (kind === 'payment' || kind === 'credit') {
      mappings.push({ resource, kind, fields: money });
    } else if (kind === 'allocation') {
      mappings.push({ resource, kind, fields: {
        ...money, fundingKind: fundingKind(paths.fundingKind), fundingRecordId: field(paths.funding),
        invoiceRecordId: { op: 'existing_invoice_lookup', path: paths.invoice },
      } });
    } else if (kind === 'reversal') {
      mappings.push({ resource, kind, fields: {
        ...common, reversedKind: fundingKind(paths.reversedKind), reversedRecordId: field(paths.reversed),
      } });
    }
  }
  return mappings;
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
  const mappings = compileMappings(binding.companyId, source, citation);
  const submitted = {
    expectedRevision: 0, findingRefs: [],
    spec: {
      id: 'scripted-spec', version: 1, sourceRef: binding.sourceRef,
      sourceContracts: [...source.contracts], capture: [...source.streams], mappings,
      allowedKinds: mappings.map(mapping => mapping.kind), runtimeModelCalls: 'forbidden',
      maxTransactionCents: 5000000, maxRecordsPerCycle: 1000, targetSchemaVersion: '1',
      requiredValidators: [], evidenceRefs: [citation],
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
  };
  return { submitted: submitted as JsonObject, citation, draft: submitted };
}

async function delegateConnector(run: Awaited<ReturnType<typeof createRun>>, owner: Owner) {
  await run.execute(owner, [{ id: 'delegate', name: 'delegateTask', arguments: {
    subject: { kind: 'source' }, role: 'connector', question: 'Prepare draft rules', dependencyIds: [],
  } }]);
  return (await run.state()).tasks.find(task => task.role === 'connector')!.id;
}

async function draftClearProposal(
  run: Awaited<ReturnType<typeof createRun>>, owner: Owner, task: string, attemptIndex: number,
) {
  const { submitted } = await submittedFor(run);
  await run.execute(owner, [{ id: 'draft', name: 'draftConnector', arguments: submitted }], attemptIndex, task);
  const proposal = (await run.state()).proposals[0]!;
  expect(proposal.state).toBe('draft');
  expect(proposal.assessment.blockerRefs).toEqual([]);
  expect(proposal.assessment.diagnosticCodes).toEqual([]);
  return proposal;
}

const compileCall = (id: string, proposal: ProposalResult) => ({
  id, name: 'compileConnector', arguments: { proposalId: proposal.proposalId, revision: proposal.revision },
});

test('compileConnector stays unavailable without registry injection', async () => {
  const model = scriptedModel();
  const owner = await acquireDiscoverySupervisor({
    db, clock, resolveAuthority, model: model.model, readTools: instrumentReads().readTools, capture: captureAccess,
  });
  if (!owner) throw new Error('Expected exclusive owner');
  try {
    const run = await createRun('compile-unavailable', model);
    const task = await delegateConnector(run, owner);
    const proposal = await draftClearProposal(run, owner, task, 1);
    const [step] = await run.execute(owner, [compileCall('compile', proposal)], 2, task);
    expect(await storedStep(step!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'TOOL_UNAVAILABLE' },
    });
    expect((await run.state()).proposals[0]?.state).toBe('draft');
  } finally {
    await owner.close();
  }
});

for (const companyId of ['company-a', 'company-b']) {
  test('scripted compile registers the exact candidate for ' + companyId, async () => {
    const model = scriptedModel();
    const reads = instrumentReads();
    const { owner, registry } = await acquire(model.model, reads.readTools);
    try {
      const run = await createRun('compile-happy-' + companyId, model, captures.find(item => item.companyId === companyId)!);
      const beforeRuntime = await runtimeFingerprint();
      const task = await delegateConnector(run, owner);
      const proposal = await draftClearProposal(run, owner, task, 1);
      const [step] = await run.execute(owner, [compileCall('compile', proposal)], 2, task);
      const state = await run.state();
      const compiled = state.proposals[0]!;
      expect(await storedStep(step!)).toMatchObject({ state: 'succeeded', result: { ok: true, result: compiled } });
      expect(compiled).toMatchObject({
        state: 'compiled', proposalId: proposal.proposalId, revision: proposal.revision,
        profileHashes: proposal.profileHashes,
      });
      expect(compiled.artifactHash).toMatch(/^[0-9a-f]{64}$/);
      const { rows: [row] } = await db.query<{
        state: string; compile_step_id: string | null; registration: { artifactHash: string; manifestId: string };
      }>(`SELECT s.state,c.compile_step_id,s.registration
        FROM discovery_compile_steps s
        JOIN discovery_proposal_current c ON c.compile_step_id=s.tool_step_id
        WHERE s.tool_step_id=$1`, [step]);
      expect(row).toMatchObject({
        state: 'settled', compile_step_id: step,
        registration: { artifactHash: compiled.artifactHash, manifestId: run.facts.binding.manifestId },
      });
      const candidate = await registry.getCandidate(compiled.artifactHash!, run.facts.binding.manifestId);
      expect(candidate.artifact.hash).toBe(compiled.artifactHash);
      expect(candidate.manifest.id).toBe(run.facts.binding.manifestId);
      expect(candidate.snapshot.id).toBe(run.facts.binding.snapshotId);
      expect(state.verificationJobs).toEqual([]);
      expect(await runtimeFingerprint()).toBe(beforeRuntime);
    } finally {
      await owner.close();
    }
  });
}

test('mapping change yields a different artifact or authentic compiler diagnostics', async () => {
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('compile-mapping-change', model);
    const task = await delegateConnector(run, owner);
    const { submitted, citation, draft } = await submittedFor(run);
    await run.execute(owner, [{ id: 'draft', name: 'draftConnector', arguments: submitted }], 1, task);
    const first = (await run.state()).proposals[0]!;
    const [firstStep] = await run.execute(owner, [compileCall('compile-1', first)], 2, task);
    const firstCompiled = (await run.state()).proposals[0]!;
    expect(firstCompiled.state).toBe('compiled');
    const revised = {
      ...draft, proposalId: first.proposalId, expectedRevision: 1,
      spec: { ...draft.spec, version: 2, mappings: draft.spec.mappings.map(mapping =>
        mapping.kind === 'invoice' ? {
          ...mapping, fields: { ...mapping.fields, amountCents: { op: 'constant', value: 15625, evidenceRef: citation } },
        } : mapping),
      },
    } as JsonObject;
    await run.execute(owner, [{ id: 'revise', name: 'reviseConnector', arguments: revised }], 3, task);
    const second = (await run.state()).proposals[0]!;
    expect(second.revision).toBe(2);
    const [secondStep] = await run.execute(owner, [compileCall('compile-2', second)], 4, task);
    const secondStored = await storedStep(secondStep!);
    expect(secondStored).toMatchObject({ state: 'succeeded', result: { ok: true } });
    const toolResult = (secondStored.result as { ok: true; result: ProposalResult }).result;
    expect(firstCompiled.state).toBe('compiled');
    expect(firstCompiled.artifactHash).toMatch(/^[0-9a-f]{64}$/);
    if (toolResult.state === 'compiled') {
      expect(toolResult.artifactHash).toMatch(/^[0-9a-f]{64}$/);
      expect(toolResult.artifactHash).not.toBe(firstCompiled.artifactHash);
    } else {
      expect(toolResult.state).toBe('compile_blocked');
      expect(toolResult.diagnostics.length).toBeGreaterThan(0);
      expect(toolResult).not.toHaveProperty('artifactHash');
      expect((await db.query('SELECT compile_step_id FROM discovery_proposal_current WHERE run_id=$1', [run.runId])).rows)
        .toEqual([{ compile_step_id: null }]);
    }
    expect(await storedStep(firstStep!)).toMatchObject({ state: 'succeeded' });
  } finally {
    await owner.close();
  }
});

test('assessment blockers never publish a current compiled candidate', async () => {
  const model = scriptedModel();
  const registrations: unknown[] = [];
  const { owner } = await acquire(model.model, instrumentReads().readTools, {
    registerCandidate: async input => { registrations.push(input); },
  });
  try {
    const run = await createRun('compile-assessment-block', model);
    const task = await delegateConnector(run, owner);
    await run.execute(owner, [{
      id: 'blocker', name: 'publishFinding', arguments: {
        expectedRevision: 0, subject: { kind: 'source' }, fieldPath: '/terms', value: 'assertion',
        provenanceClass: 'unresolved', evidenceStatus: 'insufficient', evidenceRefs: [],
        derivationInputs: [], alternatives: [], unresolvedQuestions: ['Which terms apply?'],
      },
    }], 1, task);
    const { submitted } = await submittedFor(run);
    await run.execute(owner, [{ id: 'draft', name: 'draftConnector', arguments: submitted }], 2, task);
    const proposal = (await run.state()).proposals[0]!;
    expect(proposal.state).toBe('compile_blocked');
    const [step] = await run.execute(owner, [compileCall('compile', proposal)], 3, task);
    const after = (await run.state()).proposals[0]!;
    expect(await storedStep(step!)).toMatchObject({ state: 'succeeded', result: { ok: true, result: {
      state: 'compile_blocked',
    } } });
    expect(after.state).toBe('compile_blocked');
    expect(after).not.toHaveProperty('artifactHash');
    expect((await db.query('SELECT compile_step_id FROM discovery_proposal_current WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ compile_step_id: null }]);
    expect(registrations).toEqual([]);
    expect((await run.state()).verificationJobs).toEqual([]);
  } finally {
    await owner.close();
  }
});

test('policy revoke at settle rolls back current compiled and interrupts the claim', async () => {
  const model = scriptedModel();
  const reads = instrumentReads();
  const entered = barrier<void>();
  const release = barrier<void>();
  const { owner } = await acquire(model.model, reads.readTools, {
    testHooks: { beforeCompileSettleCommit: async () => { entered.resolve(); await release.promise; } },
  });
  let pending: Promise<unknown> | undefined;
  try {
    const run = await createRun('compile-policy-revoke', model);
    const task = await delegateConnector(run, owner);
    const proposal = await draftClearProposal(run, owner, task, 1);
    const [step] = await run.accept(owner, [compileCall('compile', proposal)], 2, task);
    pending = owner.executePendingStep(run.runId, task, step!);
    await entered.promise;
    enabled = false;
    release.resolve();
    expect(await pending).toBeUndefined();
    enabled = true;
    expect((await run.state()).proposals[0]?.state).not.toBe('compiled');
    expect((await run.state()).proposals[0]).not.toHaveProperty('artifactHash');
    expect((await db.query('SELECT compile_step_id FROM discovery_proposal_current WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ compile_step_id: null }]);
    expect(await storedStep(step!)).toMatchObject({ state: 'interrupted', result: null });
  } finally {
    enabled = true;
    release.resolve();
    try { await pending; } catch { /* revoked */ }
    await owner.close();
  }
}, 40_000);

test('owner loss after registry write leaves an orphan without current compiled', async () => {
  const model = scriptedModel();
  const reads = instrumentReads();
  const entered = barrier<void>();
  const release = barrier<void>();
  let acquired = await acquire(model.model, reads.readTools, {
    testHooks: { beforeCompileSettleCommit: async () => { entered.resolve(); await release.promise; } },
  });
  let owner = acquired.owner;
  let pending: Promise<unknown> | undefined;
  try {
    const run = await createRun('compile-owner-loss', model);
    const task = await delegateConnector(run, owner);
    const proposal = await draftClearProposal(run, owner, task, 1);
    const [step] = await run.accept(owner, [compileCall('compile', proposal)], 2, task);
    pending = owner.executePendingStep(run.runId, task, step!);
    await entered.promise;
    // Invalidate first without awaiting serial, then release the in-txn hook so COMMIT observes owner loss.
    const closing = owner.close();
    release.resolve();
    await closing;
    expect(await pending).toBeUndefined();
    acquired = await acquire(model.model, reads.readTools);
    owner = acquired.owner;
    const state = await run.state();
    expect(state.proposals[0]?.state).not.toBe('compiled');
    expect(state.proposals[0]).not.toHaveProperty('artifactHash');
    expect((await db.query('SELECT compile_step_id FROM discovery_proposal_current WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ compile_step_id: null }]);
    const { rows: [compile] } = await db.query<{ state: string }>(
      'SELECT state FROM discovery_compile_steps WHERE tool_step_id=$1', [step]);
    expect(['reserved', 'registered', 'settled']).toContain(compile?.state);
  } finally {
    enabled = true;
    release.resolve();
    try { await pending; } catch { /* owner lost */ }
    await owner.close();
  }
}, 40_000);

test('pause after claim may settle without starting a new reserve', async () => {
  const model = scriptedModel();
  const reads = instrumentReads();
  const entered = barrier<void>();
  const release = barrier<void>();
  const registry = createCandidateRegistry(db, join(directory, 'pause-registry'));
  const { owner } = await acquire(model.model, reads.readTools, {
    registerCandidate: async input => {
      entered.resolve();
      await release.promise;
      await registry.registerCandidate(input);
    },
  });
  let pending: Promise<unknown> | undefined;
  try {
    const run = await createRun('compile-pause-settle', model);
    const task = await delegateConnector(run, owner);
    const proposal = await draftClearProposal(run, owner, task, 1);
    const [step] = await run.accept(owner, [compileCall('compile', proposal)], 2, task);
    pending = owner.executePendingStep(run.runId, task, step!);
    await entered.promise;
    await run.action('pause', 'pause-during-compile-register');
    release.resolve();
    const result = await pending;
    expect(result).toMatchObject({ ok: true, result: { state: 'compiled' } });
    expect((await run.state()).proposals[0]?.state).toBe('compiled');
    expect(await storedStep(step!)).toMatchObject({ state: 'succeeded' });
  } finally {
    release.resolve();
    try { await pending; } catch { /* paused settle */ }
    await owner.close();
  }
}, 40_000);

test('same-step replay returns one current compiled result without extra activity', async () => {
  const model = scriptedModel();
  const reads = instrumentReads();
  let registrations = 0;
  const registry = createCandidateRegistry(db, join(directory, 'replay-registry'));
  const { owner } = await acquire(model.model, reads.readTools, {
    registerCandidate: async input => {
      registrations++;
      await registry.registerCandidate(input);
    },
  });
  let restarted: Owner | undefined;
  try {
    const run = await createRun('compile-replay', model);
    const task = await delegateConnector(run, owner);
    const proposal = await draftClearProposal(run, owner, task, 1);
    const [step] = await run.execute(owner, [compileCall('compile', proposal)], 2, task);
    const compiled = (await run.state()).proposals[0]!;
    expect(compiled.state).toBe('compiled');
    const activity = await toolActivity(run);
    const preparations = reads.preparations;
    const count = registrations;
    await owner.close();
    restarted = (await acquire(model.model, reads.readTools, {
      registerCandidate: async input => {
        registrations++;
        await registry.registerCandidate(input);
      },
    })).owner;
    expect(await restarted.executePendingStep(run.runId, task, step!)).toEqual({ ok: true, result: compiled });
    expect(reads.preparations).toBe(preparations);
    expect(registrations).toBe(count);
    expect(await toolActivity(run)).toEqual(activity);
    expect((await run.state()).proposals).toEqual([compiled]);
  } finally {
    await restarted?.close();
    await owner.close();
  }
});

test('registry repeat of the exact subject succeeds and identity conflict stays safe', async () => {
  const model = scriptedModel();
  const { owner, registry } = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('compile-registry-idempotent', model);
    const task = await delegateConnector(run, owner);
    const proposal = await draftClearProposal(run, owner, task, 1);
    await run.execute(owner, [compileCall('compile', proposal)], 2, task);
    const compiled = (await run.state()).proposals[0]!;
    const candidate = await registry.getCandidate(compiled.artifactHash!, run.facts.binding.manifestId);
    await registry.registerCandidate(candidate);
    await expect(registry.registerCandidate({
      ...candidate, artifact: { ...candidate.artifact, id: 'forged-artifact' },
    })).rejects.toThrow(/Candidate identity conflict/);
  } finally {
    await owner.close();
  }
});

test('mixed-batch invalid sibling prevents compile reserve and registration', async () => {
  const model = scriptedModel();
  const registrations: unknown[] = [];
  const { owner } = await acquire(model.model, instrumentReads().readTools, {
    registerCandidate: async input => { registrations.push(input); },
  });
  try {
    const run = await createRun('compile-mixed-batch', model);
    const task = await delegateConnector(run, owner);
    const proposal = await draftClearProposal(run, owner, task, 1);
    const before = await toolActivity(run);
    const ids = await run.execute(owner, [
      compileCall('compile', proposal),
      { id: 'bad', name: 'draftConnector', arguments: {
        expectedRevision: 0, findingRefs: [],
        spec: { id: 'x' }, profiles: [],
      } },
    ], 2, task);
    expect(await Promise.all(ids.map(storedStep))).toMatchObject(ids.map(() => ({
      state: 'failed', result: { ok: false },
    })));
    expect((await run.state()).proposals[0]?.state).toBe('draft');
    expect((await db.query('SELECT count(*)::integer AS count FROM discovery_compile_steps WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ count: 0 }]);
    expect(registrations).toEqual([]);
    expect(await toolActivity(run)).toEqual(before);
  } finally {
    await owner.close();
  }
});

test('contradiction after registration before settle keeps current non-compiled', async () => {
  const model = scriptedModel();
  const registry = createCandidateRegistry(db, join(directory, 'race-registry'));
  let runId = '';
  const { owner } = await acquire(model.model, instrumentReads().readTools, {
    registerCandidate: async input => {
      await registry.registerCandidate(input);
      await admin.query(`UPDATE discovery_proposal_current
        SET result = jsonb_set(result,'{assessment,diagnosticCodes}','["FINDING_RESOLUTION_PENDING"]'::jsonb)
        WHERE run_id=$1`, [runId]);
    },
  });
  try {
    const run = await createRun('compile-race-finding', model);
    runId = run.runId;
    const task = await delegateConnector(run, owner);
    const proposal = await draftClearProposal(run, owner, task, 1);
    const [step] = await run.execute(owner, [compileCall('compile', proposal)], 2, task);
    const stored = await storedStep(step!);
    expect(stored).toMatchObject({
      state: 'succeeded', result: { ok: true, result: { state: 'compile_blocked' } },
    });
    expect((stored.result as { result: ProposalResult }).result).not.toHaveProperty('artifactHash');
    expect((await db.query('SELECT compile_step_id FROM discovery_proposal_current WHERE run_id=$1', [run.runId])).rows)
      .toEqual([{ compile_step_id: null }]);
    expect((await run.state()).proposals[0]).not.toMatchObject({ state: 'compiled' });
    const { rows: [compile] } = await db.query<{ state: string; registration: unknown }>(
      'SELECT state,registration FROM discovery_compile_steps WHERE run_id=$1', [run.runId]);
    expect(compile.state).toBe('settled');
    expect(compile.registration).toBeTruthy();
  } finally {
    await owner.close();
  }
});
