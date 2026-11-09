import { expect, test } from 'vitest';
import {
  ControlActivityPageSchema, ControlActivityWindowSchema, CustomerProfileDraftSchema,
  DiscoveryActionRequestV2Schema, DiscoveryCapabilitiesResponseV2Schema, DiscoveryFindingV2Schema,
  DiscoveryProposalV2Schema, DiscoveryStateV2Schema, DiscoveryTaskContextV2Schema, ModelMessageV2Schema,
  ModelResultV2Schema, ModelTurnV2Schema, ProposalResultSchema, StartDiscoveryRequestV2Schema,
  StartDiscoveryResponseV2Schema, toVerificationTaskContext,
} from '../src/discovery.js';
import { canonicalJson, hashProfile } from '../src/canonical.js';
import { CustomerProfileSchema } from '../src/connector.js';
import { ModelMessageSchema, TaskContextSchema } from '../src/model.js';
import { profileA, validSpecA } from '../../../tests/fixtures/index.js';

const hash = 'a'.repeat(64);
const binding = {
  companyId: 'company-a', sourceRef: 'source-a', manifestId: 'manifest-a', manifestHash: hash,
  snapshotId: 'snapshot-a', snapshotHash: hash,
};
const v1Context = {
  runId: 'run-a', taskId: 'task-a', role: 'contract', allowedSourceRefs: ['source-a'], allowedAccountIds: [],
} as const;
const context = {
  ...v1Context, schemaVersion: 2, binding, dispatchId: 'd1', taskRevision: 1, investigationId: 'inv-a',
  sourceRead: { companyId: 'company-a', sourceRef: 'source-a', sourceWide: true, accounts: [] },
};
const account = { sellerEntityId: 'seller-a', sourceAccountId: 'raw-a' };

test('projects only the original context fields without granting authority', () => {
  expect(toVerificationTaskContext(DiscoveryTaskContextV2Schema.parse(context))).toEqual(TaskContextSchema.parse(v1Context));
  expect(TaskContextSchema.safeParse(context).success).toBe(false);
  const untrusted = {
    ...context, binding: { ...binding, companyId: 'invented' },
    sourceRead: { ...context.sourceRead, companyId: 'invented', accounts: [account], sourceWide: false },
  };
  expect(DiscoveryTaskContextV2Schema.parse(untrusted)).toEqual(untrusted);
  for (const invalid of [
    { ...context, allowedSourceRefs: [] },
    { ...context, allowedSourceRefs: ['source-a', 'source-a'] },
    { ...context, sourceRead: { ...context.sourceRead, sourceRef: 'source-b' } },
    { ...context, sourceRead: { ...context.sourceRead, companyId: 'company-b' } },
    { ...context, sourceRead: { ...context.sourceRead, sourceWide: false } },
    { ...context, sourceRead: { ...context.sourceRead, accounts: [account, account] } },
    { ...context, reviewerId: 'reviewer-a' },
  ]) expect(DiscoveryTaskContextV2Schema.safeParse(invalid).success).toBe(false);
});

const native = { id: 'call-1', name: 'readEvidence', arguments: {} };
const call = (toolStepId: string, providerToolCallId = 'call-1') => ({
  toolStepId, providerToolCallId, name: native.name, arguments: {},
});
const batch = (...calls: ReturnType<typeof call>[]) => ({ kind: 'assistant_tool_calls', calls });
const result = (toolStepId: string, name = native.name) => ({ kind: 'tool_result', toolStepId, name, result: null });
const turn = {
  schemaVersion: 2, dispatchId: 'd3', runId: 'run-a', taskId: 'task-a', role: 'contract', instructions: '',
  messages: [], toolSchemas: [], limits: { maxInputTokens: 8192, maxOutputTokens: 2048, timeoutMs: 60000 },
};
const response = {
  schemaVersion: 2, dispatchId: 'd1', providerCallId: 'response-a', stopReason: 'tool_calls',
  usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [native],
};

test('correlates transcript results by open step ID and exact name', () => {
  const valid = [batch(call('step:a')), result('step:a'), batch(call('step:b')), result('step:b')];
  expect(ModelTurnV2Schema.parse({ ...turn, messages: valid }).messages).toEqual(valid);
  expect(ModelTurnV2Schema.safeParse({
    ...turn, messages: [batch(call('step:a'), call('step:b', 'call-2')), result('step:b'), result('step:a')],
  }).success).toBe(true);
  for (const messages of [
    [result('step:a')], [batch(call('step:a'))],
    [batch(call('step:a')), result('step:a', 'wrongName')],
    [batch(call('step:a')), result('step:a'), result('step:a')],
    [batch(call('step:a')), result('step:a'), batch(call('step:a')), result('step:a')],
    [batch(call('step:a')), batch(call('step:b')), result('step:a'), result('step:b')],
    [batch(call('step:a'), call('step:b')), result('step:a'), result('step:b')],
    [batch()],
  ]) expect(ModelTurnV2Schema.safeParse({ ...turn, messages }).success).toBe(false);
  const legacy = { kind: 'tool_result', callId: 'call-1', name: native.name, result: null };
  expect(ModelMessageSchema.parse(legacy)).toEqual(legacy);
  expect(ModelMessageV2Schema.safeParse(legacy).success).toBe(false);
});

test('enforces model response count and stop reason with safe native IDs', () => {
  const tools = Array.from({ length: 4 }, (_, index) => ({ ...native, id: `call-${index}`, name: 'unknownTool' }));
  expect(ModelResultV2Schema.parse({ ...response, toolCalls: tools }).toolCalls).toEqual(tools);
  for (const invalid of [
    { toolCalls: [...tools, native] }, { toolCalls: [native, native] }, { toolCalls: [] },
    { stopReason: 'done' }, { stopReason: 'limit' }, { stopReason: 'error' }, { dispatchId: '' },
    { usage: { inputTokens: -1, outputTokens: 0 } }, { message: 'x'.repeat(2001) },
    { toolCalls: [{ ...native, arguments: JSON.parse('{"nested":{"constructor":{}}}') }] },
  ]) expect(ModelResultV2Schema.safeParse({ ...response, ...invalid }).success).toBe(false);
  for (const stopReason of ['done', 'limit', 'error']) {
    expect(ModelResultV2Schema.safeParse({ ...response, toolCalls: [], stopReason, message: 'x'.repeat(2000) }).success)
      .toBe(true);
  }
});

const utf8 = (bytes: number) => 'é'.repeat(Math.floor(bytes / 2)) + 'x'.repeat(bytes % 2);
const byteSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

test('enforces model argument and whole-envelope UTF-8 byte boundaries', () => {
  const toolAtSize = (id: string, size: number) => ({
    ...native, id, arguments: { text: utf8(size - byteSize({ text: '' })) },
  });
  const maxArgument = toolAtSize('call-1', 64 * 1024);
  const atLimit = { ...response, toolCalls: [maxArgument, toolAtSize('call-2', 64 * 1024)], message: '' };
  atLimit.toolCalls[1] = toolAtSize('call-2', 128 * 1024 - byteSize(atLimit) + 64 * 1024);
  expect(byteSize(atLimit)).toBe(128 * 1024);
  expect(ModelResultV2Schema.safeParse(atLimit).success).toBe(true);
  expect(ModelResultV2Schema.safeParse({ ...atLimit, message: 'x' }).success).toBe(false);
  expect(ModelResultV2Schema.safeParse({ ...response, toolCalls: [toolAtSize('call-1', 64 * 1024 + 1)] }).success)
    .toBe(false);
  const instructions = utf8(128 * 1024 - byteSize(turn));
  expect(ModelTurnV2Schema.safeParse({ ...turn, instructions }).success).toBe(true);
  expect(ModelTurnV2Schema.safeParse({ ...turn, instructions: instructions + 'x' }).success).toBe(false);
  for (const [key, value] of [['maxInputTokens', 8193], ['maxOutputTokens', 2049], ['timeoutMs', 60001], ['timeoutMs', 0]]) {
    expect(ModelTurnV2Schema.safeParse({ ...turn, limits: { ...turn.limits, [key]: value } }).success).toBe(false);
  }
});

const finding = {
  schemaVersion: 2, id: 'f-a', revision: 1, taskId: 'task-a', subject: { kind: 'source' },
  fieldPath: '/terms/monthly', value: null, provenanceClass: 'unresolved', evidenceStatus: 'insufficient',
  evidenceRefs: [], derivationInputs: [], alternatives: [], unresolvedQuestions: [],
  reviewDisposition: 'pending', origin: 'agent',
};
const ref = { findingId: 'f-b', revision: 1 };

test('accepts bounded pending source findings before parent identity exists', () => {
  expect(DiscoveryFindingV2Schema.parse(finding)).toEqual(finding);
  expect(DiscoveryFindingV2Schema.safeParse({
    ...finding, subject: { kind: 'source_account', ...account }, derivationInputs: [ref, { ...ref, revision: 2 }],
  }).success).toBe(true);
  const value = utf8(8 * 1024 - byteSize({ value: '', alternatives: [] }));
  expect(DiscoveryFindingV2Schema.safeParse({ ...finding, value }).success).toBe(true);
  for (const invalid of [
    { value: value + 'x' }, { value, alternatives: [{ value: null, evidenceRefs: [] }] },
    { origin: 'reviewer' }, { reviewDisposition: 'confirmed' }, { scope: profileA.scope },
    { evidenceRefs: ['ev-a', 'ev-a'] }, { derivationInputs: [ref, ref] },
    { alternatives: Array.from({ length: 11 }, () => ({ value: null, evidenceRefs: [] })) },
    { unresolvedQuestions: Array.from({ length: 11 }, () => '?') }, { unresolvedQuestions: ['x'.repeat(513)] },
    { evidenceRefs: Array.from({ length: 51 }, (_, i) => `ev-${i}`) },
    { derivationInputs: Array.from({ length: 51 }, (_, i) => ({ ...ref, revision: i + 1 })) },
    { alternatives: [{ value: null, evidenceRefs: ['ev-a', 'ev-a'] }] },
    { value: JSON.parse('{"values":[{"__proto__":null}]}') },
  ]) expect(DiscoveryFindingV2Schema.safeParse({ ...finding, ...invalid }).success).toBe(false);
});

const { hash: profileHash, ...draft } = profileA;
const bootstrap = {
  customer: { id: 'buyer-shared-1', displayName: 'Shared Buyer', evidenceRefs: ['ev-a-identity'] },
  billingConfigurationIds: [{ termId: 'term-a-1', id: 'config-a-1' }],
};
const profileFinding = {
  id: 'profile-finding', taskId: 'task-a', scope: profileA.scope, fieldPath: '/parentCustomerId',
  origin: 'agent', reviewDisposition: 'pending', value: 'buyer-shared-1', provenanceClass: 'observed',
  evidenceStatus: 'supported', evidenceRefs: ['ev-a-identity'], derivationInputs: [], revision: 1,
};

test('rehashes profile drafts with and without current bootstrap metadata', () => {
  const absent = CustomerProfileDraftSchema.parse(draft);
  expect(absent).not.toHaveProperty('hash');
  expect(CustomerProfileSchema.parse({ ...absent, hash: hashProfile(absent) })).toEqual(profileA);
  expect(hashProfile(absent)).toBe(profileHash);
  const metadataDraft = { ...draft, bootstrap };
  const present = CustomerProfileDraftSchema.parse(metadataDraft);
  const metadataHash = hashProfile(metadataDraft);
  expect(present).not.toHaveProperty('hash');
  expect(hashProfile(present)).toBe(metadataHash);
  expect(metadataHash).not.toBe(profileHash);
  expect(CustomerProfileSchema.parse({ ...present, hash: hashProfile(present) }))
    .toEqual(CustomerProfileSchema.parse({ ...metadataDraft, hash: metadataHash }));
});

test('rejects draft hash injection and preserves strict profile refinements', () => {
  const nonEnumerableHash = Object.defineProperty({ ...draft }, 'hash', { value: undefined });
  for (const invalid of [
    profileA, { ...draft, hash: undefined }, nonEnumerableHash,
    { ...draft, bootstrap: { ...bootstrap, customer: { ...bootstrap.customer, id: 'other' } } },
    { ...draft, bootstrap: { ...bootstrap, billingConfigurationIds: [] } },
    { ...draft, bootstrap: { ...bootstrap, billingConfigurationIds: [
      ...bootstrap.billingConfigurationIds, { termId: 'other-term', id: 'other-config' },
    ] } },
    { ...draft, bootstrap: { ...bootstrap, customer: { ...bootstrap.customer, evidenceRefs: ['ev-a', 'ev-a'] } } },
    { ...draft, bootstrap: { ...bootstrap, customer: JSON.parse('{"__proto__":null}') } },
    { ...draft, findings: [{ ...profileFinding, reviewDisposition: 'confirmed' }] },
    { ...draft, findings: [{ ...profileFinding, origin: 'reviewer' }] },
  ]) expect(CustomerProfileDraftSchema.safeParse(invalid).success).toBe(false);
  expect(CustomerProfileDraftSchema.safeParse({ ...draft, findings: [profileFinding] }).success).toBe(true);
});

const proposal = {
  schemaVersion: 2, id: 'p-a', revision: 1, taskId: 'task-a', spec: validSpecA,
  profiles: [profileA], findingRefs: [ref], investigationIds: ['inv-a'],
};
const compiled = {
  proposalId: 'p-a', revision: 1, state: 'compiled', artifactHash: hash, profileHashes: [profileHash], diagnostics: [],
  assessment: { revision: 1, observedRunRevision: 2, investigationIds: ['inv-a'], blockerRefs: [], diagnosticCodes: [] },
};

test('serializes one exact profile per proposal with pending agent findings', () => {
  expect(DiscoveryProposalV2Schema.parse(proposal)).toEqual(proposal);
  for (const invalid of [
    { profiles: [] }, { profiles: [profileA, profileA] }, { profiles: [draft] },
    { profiles: [{ ...profileA, findings: [{ ...profileFinding, reviewDisposition: 'confirmed' }] }] },
    { findingRefs: [ref, ref] }, { investigationIds: ['inv-a', 'inv-a'] },
  ]) expect(DiscoveryProposalV2Schema.safeParse({ ...proposal, ...invalid }).success).toBe(false);
});

test('rejects inconsistent compiled result shapes and represents blocked history', () => {
  expect(ProposalResultSchema.parse(compiled)).toEqual(compiled);
  const assessment = {
    ...compiled.assessment, blockerRefs: [{ ...ref, code: 'FINDING_RESOLUTION_PENDING' }],
  };
  expect(ProposalResultSchema.safeParse({ ...compiled, state: 'compile_blocked', assessment }).success).toBe(true);
  expect(ProposalResultSchema.safeParse({
    ...compiled, state: 'draft', artifactHash: undefined, profileHashes: [], assessment,
  }).success).toBe(true);
  for (const invalid of [
    { assessment }, { artifactHash: undefined }, { profileHashes: [] }, { profileHashes: [profileHash, hash] },
    { assessment: { ...compiled.assessment, diagnosticCodes: ['FINDING_APPLICABILITY_UNRESOLVED'] } },
    { assessment: { ...compiled.assessment, extra: true } },
  ]) expect(ProposalResultSchema.safeParse({ ...compiled, ...invalid }).success).toBe(false);
});

const task = {
  id: 'task-a', investigationId: 'inv-a', subject: finding.subject, role: 'contract', question: 'Which terms apply?',
  dependencyIds: [], status: 'running', attempt: 9, revision: 1, toolRounds: 8, repairRound: 2, diagnosticCodes: [],
};
const job = { proposalId: 'p-a', proposalRevision: 1, jobId: 'job-a' };
const state = {
  schemaVersion: 2, id: 'run-a', revision: 2, binding, mode: 'scripted', modelId: 'scripted-a',
  status: 'paused', inFlightModelCalls: 4, inFlightToolSteps: 0, tasks: [task],
  findings: [{ id: finding.id, taskId: finding.taskId, revision: finding.revision, subject: finding.subject }],
  proposals: [compiled], verificationJobs: [job],
  usage: { modelCalls: 1, inputTokens: 0, outputTokens: 0, unknownUsageCalls: 1, cost: { status: 'unavailable' } },
  diagnostics: [],
};

test('validates distinct observable state keys and bounded counts without inferring completion', () => {
  expect(DiscoveryStateV2Schema.parse(state)).toEqual(state);
  for (const invalid of [
    { inFlightModelCalls: 5 }, { inFlightToolSteps: Number.MAX_SAFE_INTEGER + 1 },
    { tasks: [task, task] }, { tasks: [{ ...task, dependencyIds: ['dep-a', 'dep-a'] }] },
    { tasks: [{ ...task, attempt: 10 }] }, { tasks: [{ ...task, toolRounds: 9 }] },
    { tasks: [{ ...task, repairRound: 3 }] }, { proposals: [compiled, compiled] },
    { findings: [state.findings[0], state.findings[0]] }, { verificationJobs: [job, job] },
    { usage: { ...state.usage, cost: { status: 'unavailable', cents: 0 } } }, { ready: true },
  ]) expect(DiscoveryStateV2Schema.safeParse({ ...state, ...invalid }).success).toBe(false);
});

test('accepts only the versioned public capability and action shapes', () => {
  const schemas = [
    [DiscoveryCapabilitiesResponseV2Schema, { schemaVersion: 2, mode: 'unconfigured', startAvailable: false, diagnostics: [] }],
    [StartDiscoveryRequestV2Schema, { schemaVersion: 2, companyId: 'company-a', manifestId: 'manifest-a', idempotencyKey: 'key-a' }],
    [StartDiscoveryResponseV2Schema, { schemaVersion: 2, runId: 'run-a' }],
    [DiscoveryActionRequestV2Schema, { schemaVersion: 2, expectedRevision: 1, idempotencyKey: 'key-a' }],
  ] as const;
  for (const [schema, value] of schemas) {
    expect(schema.parse(value)).toEqual(value);
    expect(schema.safeParse({ ...value, schemaVersion: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...value, providerKey: 'extra' }).success).toBe(false);
  }
});

test('enforces the visible control activity continuation invariants', () => {
  const window = { highWater: 4, retainedAfter: 0 };
  const event = (sequence: number) => ({
    stream: 'control', phase: 'build', runId: 'run-a', sequence,
    type: 'task.started', at: '2026-11-08T00:00:00.000Z', payload: {},
  });
  const partial = { ...window, events: [event(1), event(3)], nextAfter: 3, hasMore: true };
  expect(ControlActivityWindowSchema.parse(window)).toEqual(window);
  expect(ControlActivityWindowSchema.safeParse({ ...window, retainedAfter: 5 }).success).toBe(false);
  expect(ControlActivityPageSchema.parse(partial)).toEqual(partial);
  expect(ControlActivityPageSchema.safeParse({ ...partial, events: [], hasMore: false, nextAfter: 4 }).success).toBe(true);
  expect(ControlActivityPageSchema.safeParse({ ...partial, events: [event(3)], hasMore: false, nextAfter: 4 }).success)
    .toBe(true);
  for (const invalid of [
    { events: [] }, { events: [event(3), event(1)] }, { events: [event(3), event(3)] },
    { events: [{ ...event(3), stream: 'runtime' }] }, { events: [event(5)] }, { retainedAfter: 1 },
    { nextAfter: 1 }, { nextAfter: 4 }, { nextAfter: 5 }, { hasMore: false },
    { events: [event(4)], nextAfter: 4 },
  ]) expect(ControlActivityPageSchema.safeParse({ ...partial, ...invalid }).success).toBe(false);
});

test('orders declared reference sets and preserves ordered transcript data', () => {
  const ordered = DiscoveryTaskContextV2Schema.parse({
    ...context, allowedSourceRefs: ['source-z', 'source-a'],
    sourceRead: { ...context.sourceRead, accounts: [{ ...account, sourceAccountId: 'raw-z' }, account] },
  });
  expect(ordered.allowedSourceRefs).toEqual(['source-a', 'source-z']);
  expect(ordered.sourceRead.accounts.map(entry => entry.sourceAccountId)).toEqual(['raw-a', 'raw-z']);
  expect(DiscoveryFindingV2Schema.parse({
    ...finding, evidenceRefs: ['ev-z', 'ev-a'], unresolvedQuestions: ['z?', 'a?'],
  })).toMatchObject({ evidenceRefs: ['ev-a', 'ev-z'], unresolvedQuestions: ['z?', 'a?'] });
});

test('uses the canonical numeric domain for v2 model and finding JSON', () => {
  for (const value of [1.25, -0, Number.MAX_SAFE_INTEGER + 1]) {
    expect(ModelResultV2Schema.safeParse({
      ...response, toolCalls: [{ ...native, arguments: { nested: [value] } }],
    }).success).toBe(false);
    expect(ModelTurnV2Schema.safeParse({ ...turn, toolSchemas: [{ nested: [value] }] }).success).toBe(false);
    expect(ModelMessageV2Schema.safeParse({ ...result('step:a'), result: { nested: [value] } }).success).toBe(false);
    expect(DiscoveryFindingV2Schema.safeParse({ ...finding, value: { nested: [value] } }).success).toBe(false);
  }
  const value = { money: '1.25', safeInteger: Number.MAX_SAFE_INTEGER, negative: -1 };
  expect(DiscoveryFindingV2Schema.parse({ ...finding, value }).value).toEqual(value);
  expect(ModelMessageV2Schema.safeParse({ ...result('step:a'), result: value }).success).toBe(true);
  expect(ModelMessageSchema.safeParse({ kind: 'tool_result', callId: 'call-1', name: native.name, result: 1.25 }).success)
    .toBe(true);
});

test('checks the nesting limit before invoking a recursive JSON parser', () => {
  function nestedArray(depth: number): unknown {
    let value: unknown = 0;
    for (let i = 0; i < depth; i++) value = [value];
    return value;
  }
  const message = (depth: number) => ({ ...result('step:a'), result: nestedArray(depth) });
  expect(ModelMessageV2Schema.safeParse(message(128)).success).toBe(true);
  expect(ModelMessageV2Schema.safeParse(message(129)).success).toBe(false);
  expect(ModelMessageV2Schema.safeParse(message(4000)).success).toBe(false);
  const withArguments = (depth: number) => ({
    ...response, toolCalls: [{ ...native, arguments: { value: nestedArray(depth) } }],
  });
  expect(ModelResultV2Schema.safeParse(withArguments(127)).success).toBe(true);
  expect(ModelResultV2Schema.safeParse(withArguments(128)).success).toBe(false);
  const withAlternative = (depth: number) => ({
    ...finding, alternatives: [{ value: nestedArray(depth), evidenceRefs: [] }],
  });
  expect(DiscoveryFindingV2Schema.safeParse(withAlternative(128)).success).toBe(true);
  expect(DiscoveryFindingV2Schema.safeParse(withAlternative(129)).success).toBe(false);
});

test('omits an explicitly undefined optional response message from canonical output', () => {
  const withoutMessage = ModelResultV2Schema.parse(response);
  const explicitUndefined = ModelResultV2Schema.parse({ ...response, message: undefined });
  expect(explicitUndefined).not.toHaveProperty('message');
  expect(canonicalJson(explicitUndefined)).toBe(canonicalJson(withoutMessage));
});
