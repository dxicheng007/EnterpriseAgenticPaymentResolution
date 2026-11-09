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
import { modelResult, scriptedModel } from '../fixtures/discovery-model.js';
import { testNamespace } from '../fixtures/harness.js';

const namespace = testNamespace('discreplay');
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
  directory = await mkdtemp(join(tmpdir(), 'eapr-discovery-replay-'));
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
    getArtifact?: NonNullable<Parameters<typeof acquireDiscoverySupervisor>[0]['getArtifact']>;
    constructionCapture?: typeof constructionCapture;
    omitSandbox?: boolean;
  } = {},
) {
  const registry = createCandidateRegistry(db, registryRoot);
  const owner = await acquireDiscoverySupervisor({
    db, clock, resolveAuthority, model, readTools, capture: captureAccess,
    constructionCapture: options.constructionCapture ?? constructionCapture,
    registerCandidate: options.registerCandidate ?? registry.registerCandidate.bind(registry),
    ...(options.omitSandbox ? {} : {
      getArtifact: options.getArtifact ?? registry.getArtifact.bind(registry),
    }),
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

async function delegateConnector(
  run: Awaited<ReturnType<typeof createRun>>, owner: Owner, attemptIndex = 0,
) {
  await run.execute(owner, [{ id: 'delegate', name: 'delegateTask', arguments: {
    subject: { kind: 'source' }, role: 'connector', question: 'Prepare draft rules', dependencyIds: [],
  } }], attemptIndex);
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
const replayCall = (id: string, proposal: ProposalResult) => ({
  id, name: 'runSandboxReplay', arguments: { proposalId: proposal.proposalId, revision: proposal.revision },
});
const compareCall = (id: string, left: ProposalResult, right: ProposalResult) => ({
  id, name: 'compareArtifacts', arguments: {
    left: { proposalId: left.proposalId, revision: left.revision },
    right: { proposalId: right.proposalId, revision: right.revision },
  },
});

async function draftCompile(
  run: Awaited<ReturnType<typeof createRun>>, owner: Owner, task: string, startAttempt = 1,
) {
  const proposal = await draftClearProposal(run, owner, task, startAttempt);
  const [step] = await run.execute(owner, [compileCall('compile', proposal)], startAttempt + 1, task);
  const compiled = (await run.state()).proposals[0]!;
  expect(await storedStep(step!)).toMatchObject({ state: 'succeeded' });
  expect(compiled.state).toBe('compiled');
  expect(compiled.artifactHash).toMatch(/^[0-9a-f]{64}$/);
  return compiled;
}

test('sandbox tools stay unavailable without getArtifact injection', async () => {
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools, { omitSandbox: true });
  try {
    const run = await createRun('replay-unavailable', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompile(run, owner, task);
    const [step] = await run.execute(owner, [replayCall('replay', compiled)], 3, task);
    expect(await storedStep(step!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'TOOL_UNAVAILABLE' },
    });
  } finally {
    await owner.close();
  }
});

for (const companyId of ['company-a', 'company-b']) {
  test('scripted sandbox replay keeps parentWrites 0 for ' + companyId, async () => {
    const model = scriptedModel();
    const { owner } = await acquire(model.model, instrumentReads().readTools);
    try {
      const run = await createRun('replay-happy-' + companyId, model, captures.find(item => item.companyId === companyId)!);
      const beforeRuntime = await runtimeFingerprint();
      const task = await delegateConnector(run, owner);
      const compiled = await draftCompile(run, owner, task);
      const [step] = await run.execute(owner, [replayCall('replay', compiled)], 3, task);
      const stored = await storedStep(step!);
      expect(stored).toMatchObject({
        state: 'succeeded',
        result: {
          ok: true, targetMode: 'empty-sandbox', parentWrites: 0,
          proposalId: compiled.proposalId, revision: compiled.revision,
          artifactHash: compiled.artifactHash,
        },
      });
      const result = stored.result as { ok: true; outcome: { plans: unknown[]; holds: unknown[] } };
      expect(result.outcome.plans.length + result.outcome.holds.length).toBeGreaterThan(0);
      expect(await runtimeFingerprint()).toBe(beforeRuntime);
      const activity = await toolActivity(run);
      expect(activity.some(event =>
        event.type === 'tool.result' && event.payload.toolName === 'runSandboxReplay' &&
        event.payload.toolStatus === 'succeeded')).toBe(true);
      expect(activity.every(event => !('outcome' in event.payload) && !('diffs' in event.payload))).toBe(true);
    } finally {
      await owner.close();
    }
  });
}

test('exact toolStepId replay returns stored result without re-reading artifacts', async () => {
  const model = scriptedModel();
  let artifactReads = 0;
  const { owner, registry } = await acquire(model.model, instrumentReads().readTools, {
    getArtifact: async hash => {
      artifactReads++;
      return registry.getArtifact(hash);
    },
  });
  try {
    const run = await createRun('replay-idempotent', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompile(run, owner, task);
    const [step] = await run.execute(owner, [replayCall('replay', compiled)], 3, task);
    const first = await storedStep(step!);
    expect(first).toMatchObject({ state: 'succeeded' });
    const readsAfterFirst = artifactReads;
    expect(readsAfterFirst).toBeGreaterThan(0);
    await owner.executePendingStep(run.runId, task, step!);
    expect(await storedStep(step!)).toEqual(first);
    expect(artifactReads).toBe(readsAfterFirst);
  } finally {
    await owner.close();
  }
});

test('draft-not-compiled replay conflicts', async () => {
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('replay-draft-conflict', model);
    const task = await delegateConnector(run, owner);
    const draft = await draftClearProposal(run, owner, task, 1);
    const [draftStep] = await run.execute(owner, [replayCall('replay-draft', draft)], 2, task);
    expect(await storedStep(draftStep!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' },
    });
  } finally {
    await owner.close();
  }
});

test('stale revision replay conflicts', async () => {
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('replay-stale', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompile(run, owner, task);
    const [staleStep] = await run.execute(owner, [{
      id: 'stale', name: 'runSandboxReplay',
      arguments: { proposalId: compiled.proposalId, revision: compiled.revision + 1 },
    }], 3, task);
    expect(await storedStep(staleStep!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' },
    });
  } finally {
    await owner.close();
  }
});

test('paused authority before claim leaves no running sandbox step', async () => {
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('replay-paused', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompile(run, owner, task);
    const [step] = await run.accept(owner, [replayCall('replay', compiled)], 3, task);
    await run.action('pause', 'pause-before-replay');
    await owner.executePendingStep(run.runId, task, step!);
    expect(await storedStep(step!)).toMatchObject({ state: 'pending' });
  } finally {
    await owner.close();
  }
});

test('compareArtifacts diffs revisions and treats same revision as identical', async () => {
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('compare-revisions', model);
    const task = await delegateConnector(run, owner);
    const { submitted, citation, draft } = await submittedFor(run);
    await run.execute(owner, [{ id: 'draft', name: 'draftConnector', arguments: submitted }], 1, task);
    const first = (await run.state()).proposals[0]!;
    await run.execute(owner, [compileCall('compile-1', first)], 2, task);
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

    const [sameStep] = await run.execute(owner, [compareCall('same', firstCompiled, firstCompiled)], 4, task);
    expect(await storedStep(sameStep!)).toMatchObject({
      state: 'succeeded', result: { ok: true, identical: true, diffs: [] },
    });

    const [diffStep] = await run.execute(owner, [compareCall('diff', firstCompiled, second)], 5, task);
    const diffStored = await storedStep(diffStep!);
    expect(diffStored).toMatchObject({ state: 'succeeded', result: { ok: true, identical: false } });
    const diffResult = diffStored.result as { ok: true; diffs: { category: string; path: string }[] };
    expect(diffResult.diffs.length).toBeGreaterThan(0);
    expect(diffResult.diffs.some(diff =>
      diff.category === 'rule' && diff.path.startsWith('/spec/mappings/'),
    )).toBe(true);
  } finally {
    await owner.close();
  }
});

test('compareArtifacts rejects cross-run refs', async () => {
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools);
  try {
    const leftRun = await createRun('compare-cross-a', model);
    const leftTask = await delegateConnector(leftRun, owner, 0);
    const leftCompiled = await draftCompile(leftRun, owner, leftTask, 1);

    const rightRun = await createRun('compare-cross-b', model);
    const rightTask = await delegateConnector(rightRun, owner, 3);
    const rightCompiled = await draftCompile(rightRun, owner, rightTask, 4);

    const [step] = await leftRun.execute(owner, [compareCall('cross', leftCompiled, rightCompiled)], 6, leftTask);
    expect(await storedStep(step!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'DISCOVERY_CONFLICT' },
    });
  } finally {
    await owner.close();
  }
});

test('mixed batch invalid sibling fails the whole construction batch', async () => {
  const model = scriptedModel();
  const { owner } = await acquire(model.model, instrumentReads().readTools);
  try {
    const run = await createRun('replay-mixed-batch', model);
    const task = await delegateConnector(run, owner);
    const compiled = await draftCompile(run, owner, task);
    const [replayStep, badStep] = await run.execute(owner, [
      replayCall('replay', compiled),
      { id: 'bad', name: 'runSandboxReplay', arguments: { proposalId: compiled.proposalId } },
    ], 3, task);
    expect(await storedStep(replayStep!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'DISCOVERY_INVALID' },
    });
    expect(await storedStep(badStep!)).toMatchObject({
      state: 'failed', result: { ok: false, code: 'DISCOVERY_INVALID' },
    });
  } finally {
    await owner.close();
  }
});
