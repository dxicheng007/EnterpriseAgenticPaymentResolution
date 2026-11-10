import { expect, expectTypeOf, test } from 'vitest';
import * as root from '../src/index.js';
import * as leaf from '../src/discovery-construction-tools.js';
import { PublishFindingInputSchema as schema } from '../src/discovery-construction-tools.js';

const input = {
  expectedRevision: 0, subject: { kind: 'source' }, fieldPath: '/terms', value: null,
  provenanceClass: 'unresolved', evidenceStatus: 'insufficient', evidenceRefs: ['z', 'a'],
  derivationInputs: [], alternatives: [], unresolvedQuestions: [],
};

test('publication accepts only agent input and exact CAS forms', () => {
  expect(schema.parse(input).evidenceRefs).toEqual(['a', 'z']);
  for (const fields of [
    { expectedRevision: 1 }, { findingId: 'existing' }, { reviewDisposition: 'pending' },
    { origin: 'agent' }, { value: 'x'.repeat(8192) },
    { value: Array.from({ length: 130 }).reduce<unknown>(value => [value], null) },
  ]) expect(schema.safeParse({ ...input, ...fields }).success).toBe(false);
});

test('proposal inputs require the full submitted shapes and exact CAS forms', async () => {
  const { DraftConnectorInputSchema, ReviseConnectorInputSchema, DraftConnectorResultSchema, discoveryProposalToolSchemas } =
    await import('../src/discovery-construction-tools.js');
  const spec = {
    id: 'submitted-spec', version: 1, sourceRef: 'source', sourceContracts: [], capture: [], mappings: [],
    allowedKinds: [], runtimeModelCalls: 'forbidden', maxTransactionCents: 5000000, maxRecordsPerCycle: 1000,
    targetSchemaVersion: '1', requiredValidators: [], evidenceRefs: [],
  };
  const profile = {
    id: 'submitted-profile', version: 1, sourceRef: 'source', scope: { companyId: 'company', sellerEntityId: 'seller', accountId: 'account' },
    parentCustomerId: 'customer', sourceAccountIds: ['alias'], approvedLookups: [], contractTerms: [],
    semanticVersion: 'v1', findings: [],
    bootstrap: { customer: { id: 'customer', displayName: 'Customer', evidenceRefs: ['citation'] }, billingConfigurationIds: [] },
  };
  const draft = { expectedRevision: 0, spec, profiles: [profile], findingRefs: [] };
  const revise = { ...draft, proposalId: 'proposal', expectedRevision: 1 };
  expect(DraftConnectorInputSchema.parse(draft)).toEqual(draft);
  expect(ReviseConnectorInputSchema.parse(revise)).toEqual(revise);
  expect(ReviseConnectorInputSchema.safeParse(draft).success).toBe(false);
  expect(DraftConnectorInputSchema.safeParse(revise).success).toBe(false);
  for (const fields of [
    { spec: {} }, { profiles: [] }, { investigationIds: [] }, { profiles: [{ ...profile, hash: 'a'.repeat(64) }] },
    { profiles: [{ ...profile, bootstrap: { ...profile.bootstrap, hash: 'a'.repeat(64) } }] },
    { profiles: [{ ...profile, findings: [{
      id: 'finding', scope: profile.scope, taskId: 'task', fieldPath: '/terms', value: null,
      origin: 'agent', reviewDisposition: 'confirmed', provenanceClass: 'observed', evidenceStatus: 'supported',
      evidenceRefs: [], derivationInputs: [], revision: 1,
    }] }] },
    { profiles: [{ ...profile, bootstrap: { ...profile.bootstrap, customer: {
      ...profile.bootstrap.customer, displayName: 'é'.repeat(33000),
    } } }] },
    { findingRefs: [{ findingId: 'a', revision: 1 }, { findingId: 'a', revision: 1 }] },
    JSON.parse('{"profiles":[{"constructor":{"prototype":{"value":1}}}]}'),
    { expectedRevision: -0 },
  ]) expect(DraftConnectorInputSchema.safeParse({ ...draft, ...fields }).success).toBe(false);
  const descriptor = discoveryProposalToolSchemas[0]!.inputSchema;
  expect(descriptor).toMatchObject({
    required: ['expectedRevision', 'spec', 'profiles', 'findingRefs'],
    properties: { spec: { properties: { mappings: { type: 'array' } } },
      profiles: { items: { $ref: expect.stringMatching(/^#\/\$defs\//) }, minItems: 1, maxItems: 1 } },
  });
  const properties = descriptor.properties as Record<string, { items?: { $ref: string } }>;
  const profileDefinition = properties.profiles!.items!.$ref.split('/').at(-1)!;
  expect(descriptor.$defs?.[profileDefinition]).toMatchObject({ properties: { scope: expect.any(Object) } });
  expect(descriptor.$defs?.[profileDefinition]).not.toHaveProperty('properties.hash');
  // Leave enough of the existing 128 KiB model-turn envelope for a full draft and its result.
  expect(Buffer.byteLength(JSON.stringify(discoveryProposalToolSchemas))).toBeLessThan(32 * 1024);
  const result = { proposalId: 'proposal', revision: 1, state: 'compile_blocked', profileHashes: [],
    diagnostics: [], assessment: { revision: 1, observedRunRevision: 2, investigationIds: ['source'], diagnosticCodes: [],
      blockerRefs: Array.from({ length: 800 }, (_, index) => ({
        findingId: 'origin-' + index.toString().padStart(32, '0'), revision: 1, code: 'FINDING_RESOLUTION_PENDING',
      })) } };
  expect(DraftConnectorResultSchema.safeParse({ ok: true, result }).success).toBe(false);
  expect(DraftConnectorResultSchema.parse({ ok: false, code: 'TOOL_RESULT_LIMIT' })).toEqual({
    ok: false, code: 'TOOL_RESULT_LIMIT',
  });
});

test('compileConnector accepts only proposal identity and exact revision', async () => {
  const { CompileConnectorInputSchema, CompileConnectorResultSchema, discoveryCompileToolSchemas } =
    await import('../src/discovery-construction-tools.js');
  const input = { proposalId: 'proposal', revision: 1 };
  expect(CompileConnectorInputSchema.parse(input)).toEqual(input);
  for (const invalid of [
    { ...input, artifactHash: 'a'.repeat(64) },
    { ...input, assessment: {} },
    { ...input, expectedRevision: 1 },
    { proposalId: 'proposal', revision: 0 },
    { revision: 1 },
    { proposalId: 'proposal' },
  ]) expect(CompileConnectorInputSchema.safeParse(invalid).success).toBe(false);
  expect(discoveryCompileToolSchemas).toHaveLength(1);
  expect(discoveryCompileToolSchemas[0]).toMatchObject({ name: 'compileConnector' });
  expect(CompileConnectorResultSchema.parse({ ok: false, code: 'TOOL_UNAVAILABLE' })).toEqual({
    ok: false, code: 'TOOL_UNAVAILABLE',
  });
});

test('sandbox replay and compare schemas accept only exact refs and sandbox literals', async () => {
  const {
    RunSandboxReplayInputSchema, RunSandboxReplayResultSchema, RunSandboxReplaySuccessSchema,
    CompareArtifactsInputSchema, CompareArtifactsSuccessSchema, CompareArtifactsResultSchema,
    discoveryReplayToolSchemas, discoveryCompareToolSchemas,
  } = await import('../src/discovery-construction-tools.js');
  const replayInput = { proposalId: 'proposal', revision: 1 };
  expect(RunSandboxReplayInputSchema.parse(replayInput)).toEqual(replayInput);
  for (const invalid of [
    { ...replayInput, target: 'empty' },
    { ...replayInput, events: [] },
    { ...replayInput, revision: 0 },
    { proposalId: 'proposal' },
    { revision: 1 },
  ]) expect(RunSandboxReplayInputSchema.safeParse(invalid).success).toBe(false);

  const outcome = { plans: [], holds: [] };
  const success = {
    ok: true as const,
    proposalId: 'proposal', revision: 1,
    artifactHash: 'a'.repeat(64), profileHash: 'b'.repeat(64),
    snapshotId: 'snapshot', manifestId: 'manifest',
    targetMode: 'empty-sandbox' as const, parentWrites: 0 as const, outcome,
  };
  expect(RunSandboxReplaySuccessSchema.parse(success)).toEqual(success);
  expect(RunSandboxReplayResultSchema.parse(success)).toEqual(success);
  for (const invalid of [
    { ...success, targetMode: 'empty-fixture' },
    { ...success, parentWrites: 1 },
    { ...success, outcome: undefined },
  ]) expect(RunSandboxReplaySuccessSchema.safeParse(invalid).success).toBe(false);
  expect(RunSandboxReplayResultSchema.parse({ ok: false, code: 'TOOL_UNAVAILABLE' })).toEqual({
    ok: false, code: 'TOOL_UNAVAILABLE',
  });

  const compareInput = {
    left: { proposalId: 'proposal', revision: 1 },
    right: { proposalId: 'proposal', revision: 2 },
  };
  expect(CompareArtifactsInputSchema.parse(compareInput)).toEqual(compareInput);
  for (const invalid of [
    { ...compareInput, note: 'x' },
    { left: compareInput.left },
    { left: { proposalId: 'proposal', revision: 0 }, right: compareInput.right },
  ]) expect(CompareArtifactsInputSchema.safeParse(invalid).success).toBe(false);

  const side = {
    proposalId: 'proposal', revision: 1, payloadHash: 'c'.repeat(64),
    profileHashes: ['d'.repeat(64)], specId: 'spec', specVersion: 1,
  };
  const compareSuccess = {
    ok: true as const, left: side, right: { ...side, revision: 2, payloadHash: 'e'.repeat(64) },
    identical: false,
    diffs: [{ category: 'hash' as const, path: '/payloadHash', change: 'changed' as const,
      leftDigest: 'c'.repeat(64), rightDigest: 'e'.repeat(64) }],
  };
  expect(CompareArtifactsSuccessSchema.parse(compareSuccess)).toEqual(compareSuccess);
  expect(CompareArtifactsSuccessSchema.safeParse({ ...compareSuccess, identical: true }).success).toBe(false);
  expect(CompareArtifactsSuccessSchema.parse({
    ...compareSuccess, identical: true, diffs: [],
  })).toMatchObject({ identical: true, diffs: [] });
  expect(CompareArtifactsResultSchema.parse({ ok: false, code: 'DISCOVERY_CONFLICT' })).toEqual({
    ok: false, code: 'DISCOVERY_CONFLICT',
  });
  expect(CompareArtifactsSuccessSchema.safeParse({
    ...compareSuccess,
    diffs: Array.from({ length: 501 }, (_, index) => ({
      category: 'field', path: '/spec/field/' + index, change: 'changed',
    })),
  }).success).toBe(false);

  expect(discoveryReplayToolSchemas).toHaveLength(1);
  expect(discoveryReplayToolSchemas[0]).toMatchObject({ name: 'runSandboxReplay' });
  expect(discoveryCompareToolSchemas).toHaveLength(1);
  expect(discoveryCompareToolSchemas[0]).toMatchObject({ name: 'compareArtifacts' });
});

test('requestVerification and readVerification accept only safe job shapes', async () => {
  const {
    RequestVerificationInputSchema, ReadVerificationInputSchema,
    RequestVerificationResultSchema, ReadVerificationResultSchema,
    discoveryVerificationToolSchemas,
  } = await import('../src/discovery-construction-tools.js');
  const request = { proposalId: 'proposal', revision: 1, profileHash: 'a'.repeat(64) };
  expect(RequestVerificationInputSchema.parse(request)).toEqual(request);
  for (const invalid of [
    { ...request, accountId: 'account' },
    { ...request, requestKey: 'step' },
    { ...request, revision: 0 },
    { proposalId: 'proposal', revision: 1 },
    { profileHash: 'a'.repeat(64) },
  ]) expect(RequestVerificationInputSchema.safeParse(invalid).success).toBe(false);

  const read = { proposalId: 'proposal', revision: 1, jobId: 'job-1' };
  expect(ReadVerificationInputSchema.parse(read)).toEqual(read);
  for (const invalid of [
    { jobId: 'job-1' },
    { ...read, revision: 0 },
    { jobId: '' },
    {},
  ]) expect(ReadVerificationInputSchema.safeParse(invalid).success).toBe(false);

  const job = { jobId: 'job-1', state: 'queued' as const, diagnostics: [] };
  const success = { ok: true as const, job };
  expect(RequestVerificationResultSchema.parse(success)).toEqual(success);
  expect(ReadVerificationResultSchema.parse(success)).toEqual(success);
  const completed = {
    ok: true as const,
    job: {
      ...job, state: 'completed' as const,
      summary: {
        reportId: 'report', artifactHash: 'b'.repeat(64), profileHashes: ['a'.repeat(64)],
        manifestHash: 'c'.repeat(64), eligible: true, coverageComplete: true,
        checks: [{ id: 'baseline_reconcile' as const, status: 'passed' as const, diagnosticCodes: [] }],
      },
    },
  };
  expect(RequestVerificationResultSchema.parse(completed)).toEqual(completed);
  for (const invalid of [
    { ok: true, job: { ...job, holdout: true } },
    { ok: true, job: { ...job, report: { id: 'secret' } } },
    { ok: true, job, expectedResults: [] },
    { ok: true, job: { jobId: 'job-1', state: 'queued' } },
  ]) expect(RequestVerificationResultSchema.safeParse(invalid).success).toBe(false);

  for (const code of [
    'TOOL_UNAVAILABLE', 'VERIFICATION_SCOPE_REQUIRED', 'DISCOVERY_PAUSED', 'DISCOVERY_FORBIDDEN',
  ] as const) {
    expect(RequestVerificationResultSchema.parse({ ok: false, code })).toEqual({ ok: false, code });
  }
  expect(RequestVerificationResultSchema.safeParse({ ok: false, code: 'DISCOVERY_OWNER_LOST' }).success)
    .toBe(false);

  expect(discoveryVerificationToolSchemas).toHaveLength(2);
  expect(discoveryVerificationToolSchemas.map(tool => tool.name))
    .toEqual(['requestVerification', 'readVerification']);
  expect(Buffer.byteLength(JSON.stringify(discoveryVerificationToolSchemas))).toBeLessThan(8 * 1024);
});

test('requestInvestigation accepts bounded subject requests and stays advertisement-only', async () => {
  const {
    RequestInvestigationInputSchema, RequestInvestigationResultSchema, discoveryInvestigationToolSchemas,
  } = await import('../src/discovery-construction-tools.js');

  const source = {
    subject: { kind: 'source' as const },
    question: 'What accounts appear in the capture?',
    dependencyFindingRefs: [{ findingId: 'finding-a', revision: 1 }],
  };
  expect(RequestInvestigationInputSchema.parse(source)).toEqual(source);

  const account = {
    subject: {
      kind: 'source_account' as const, sellerEntityId: 'seller-a', sourceAccountId: 'account-a',
    },
    question: 'Resolve the captured tuple.',
    dependencyFindingRefs: [],
  };
  expect(RequestInvestigationInputSchema.parse(account)).toEqual(account);

  for (const invalid of [
    { ...source, question: '' },
    { ...source, question: 'x'.repeat(8193) },
    { ...source, dependencyFindingRefs: [
      { findingId: 'finding-a', revision: 1 }, { findingId: 'finding-a', revision: 1 },
    ] },
    { ...source, grants: [] },
    { subject: source.subject, question: source.question },
    { subject: { kind: 'source' }, question: source.question, dependencyFindingRefs: [{ findingId: 'f', revision: 0 }] },
  ]) expect(RequestInvestigationInputSchema.safeParse(invalid).success).toBe(false);

  const success = { ok: true as const, requestId: 'request-1' };
  expect(RequestInvestigationResultSchema.parse(success)).toEqual(success);
  expect(RequestInvestigationResultSchema.parse({ ok: false, code: 'TOOL_UNAVAILABLE' }))
    .toEqual({ ok: false, code: 'TOOL_UNAVAILABLE' });
  for (const code of [
    'DISCOVERY_INVALID', 'DISCOVERY_FORBIDDEN', 'DISCOVERY_CONFLICT', 'DISCOVERY_PAUSED',
    'SOURCE_UNAVAILABLE', 'TOOL_RESULT_LIMIT', 'TOOL_FORBIDDEN',
  ] as const) {
    expect(RequestInvestigationResultSchema.parse({ ok: false, code })).toEqual({ ok: false, code });
  }
  for (const invalid of [
    { ok: true, requestId: 'request-1', grants: [] },
    { ok: true },
    { ok: false, code: 'VERIFICATION_SCOPE_REQUIRED' },
    { ok: false, code: 'DISCOVERY_OWNER_LOST' },
  ]) expect(RequestInvestigationResultSchema.safeParse(invalid).success).toBe(false);

  expect(discoveryInvestigationToolSchemas).toHaveLength(1);
  expect(discoveryInvestigationToolSchemas[0]).toMatchObject({ name: 'requestInvestigation' });
  expect(Buffer.byteLength(JSON.stringify(discoveryInvestigationToolSchemas))).toBeLessThan(8 * 1024);
});

test.each([
  'PROPOSAL_REVISION_CONFLICT', 'REPAIR_DIAGNOSTICS_REQUIRED', 'REPAIR_LIMIT', 'INVESTIGATION_REQUEST_LIMIT',
])('requestInvestigation accepts the additive safe failure %s', async code => {
  const { RequestInvestigationResultSchema } = await import('../src/discovery-construction-tools.js');
  const failure = { ok: false, code };
  expect(RequestInvestigationResultSchema.safeParse(failure)).toMatchObject({ success: true, data: failure });
});

const repairInput = {
  investigationId: 'investigation', proposalId: 'proposal', expectedProposalRevision: 7, diagnosticCodes: ['z', 'A'],
};
const compileRef = { code: 'z', kind: 'compile', toolStepId: 'step', assessmentRevision: 4 };
const verificationRef = { code: 'A', kind: 'verification', requestKey: 'request', jobId: 'job', assessmentRevision: 5 };
const repairResult = {
  ok: true, investigationId: 'investigation', proposalId: 'proposal', proposalRevision: 7,
  repairRound: 2, diagnosticRefs: [compileRef, verificationRef],
};

test('beginRepair normalizes unique diagnostic codes and safe provenance refs', () => {
  expect(leaf.BeginRepairInputSchema).toBeDefined();
  expect(leaf.BeginRepairInputSchema.parse(repairInput)).toEqual({ ...repairInput, diagnosticCodes: ['A', 'z'] });
  expect(repairInput.diagnosticCodes).toEqual(['z', 'A']);
  expect(leaf.DiscoveryRepairDiagnosticRefSchema.parse(compileRef)).toEqual(compileRef);
  expect(leaf.DiscoveryRepairDiagnosticRefSchema.parse(verificationRef)).toEqual(verificationRef);
  expect(leaf.BeginRepairResultSchema.parse(repairResult)).toEqual({
    ...repairResult, diagnosticRefs: [verificationRef, compileRef],
  });
  expect(repairResult.diagnosticRefs).toEqual([compileRef, verificationRef]);
  expect(leaf.BeginRepairResultSchema.parse({ ...repairResult, repairRound: 1 })).toEqual({
    ...repairResult, repairRound: 1, diagnosticRefs: [verificationRef, compileRef],
  });
});

test('beginRepair rejects authority fields, invalid revisions and ambiguous provenance', () => {
  for (const fields of [
    { runId: 'run' }, { grants: {} }, { assessmentRevision: 4 }, { authority: true }, { unexpected: true },
    { diagnosticCodes: [] }, { diagnosticCodes: ['z', 'z'] }, { diagnosticCodes: ['x'.repeat(161)] },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(expectedProposalRevision => ({ expectedProposalRevision })),
  ]) expect(leaf.BeginRepairInputSchema.safeParse({ ...repairInput, ...fields }).success, JSON.stringify(fields)).toBe(false);
  for (const fields of [
    { runId: 'run' }, { assessment: {} }, { diagnosticRefs: [] }, { repairRound: 0 }, { repairRound: 3 },
    { diagnosticRefs: [compileRef, { ...verificationRef, code: compileRef.code }] },
    { diagnosticRefs: [{ ...compileRef, requestKey: 'request', jobId: 'job' }] },
    { diagnosticRefs: [{ ...verificationRef, toolStepId: 'step' }] },
    { diagnosticRefs: [{ ...verificationRef, protectedTruth: {} }] },
    { diagnosticRefs: [{ ...verificationRef, requestKey: 'x'.repeat(161) }] },
    { diagnosticRefs: [{ ...compileRef, toolStepId: 'has spaces' }] },
    { diagnosticRefs: [JSON.parse('{"code":"z","kind":"compile","toolStepId":"step","assessmentRevision":4,"__proto__":{}}')] },
    ...[0, 1.5, Number.MAX_SAFE_INTEGER + 1].flatMap(revision => [
      { proposalRevision: revision }, { diagnosticRefs: [{ ...compileRef, assessmentRevision: revision }] },
    ]),
  ]) expect(leaf.BeginRepairResultSchema.safeParse({ ...repairResult, ...fields }).success, JSON.stringify(fields)).toBe(false);
});

const finishSuccess = { ok: true, runId: 'run', status: 'completed', observedRunRevision: 3, revision: 4 };
const blockers = [
  'TASK_GRAPH_INCOMPLETE', 'TASK_DEPENDENCIES_UNRESOLVED', 'NO_CURRENT_COMPILED_PROPOSAL',
  'DISCOVERY_ASSESSMENT_UNRESOLVED', 'DISCOVERY_WORK_IN_FLIGHT',
];
const finishIncomplete = { ok: false, code: 'DISCOVERY_INCOMPLETE', blockerCodes: blockers };

test('finishRun requires an empty input and a single checked completion revision increment', () => {
  expect(leaf.FinishRunInputSchema).toBeDefined();
  expect(leaf.FinishRunInputSchema.parse({})).toEqual({});
  for (const invalid of [
    { runId: 'run' }, { revision: 3 }, { authority: {} }, { grants: [] }, { assessment: {} }, [],
    JSON.parse('{"__proto__":{}}'),
  ]) expect(leaf.FinishRunInputSchema.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
  expect(leaf.FinishRunResultSchema.parse(finishSuccess)).toEqual(finishSuccess);
  for (const fields of [
    { status: 'running' }, { revision: 3 }, { revision: 5 }, { assessment: {} },
    ...[0, 1.5, Number.MAX_SAFE_INTEGER + 1].flatMap(revision => [
      { revision }, { observedRunRevision: revision },
    ]),
    { observedRunRevision: Number.MAX_SAFE_INTEGER, revision: Number.MAX_SAFE_INTEGER + 1 },
  ]) expect(leaf.FinishRunResultSchema.safeParse({ ...finishSuccess, ...fields }).success, JSON.stringify(fields)).toBe(false);
});

test('finishRun incomplete result reports only unique normalized blocker categories', () => {
  expect(leaf.FinishRunResultSchema.parse(finishIncomplete)).toEqual({
    ok: false, code: 'DISCOVERY_INCOMPLETE', blockerCodes: [
      'DISCOVERY_ASSESSMENT_UNRESOLVED', 'DISCOVERY_WORK_IN_FLIGHT', 'NO_CURRENT_COMPILED_PROPOSAL',
      'TASK_DEPENDENCIES_UNRESOLVED', 'TASK_GRAPH_INCOMPLETE',
    ],
  });
  for (const fields of [
    { blockerCodes: [] }, { blockerCodes: ['TASK_GRAPH_INCOMPLETE', 'TASK_GRAPH_INCOMPLETE'] },
    { blockerCodes: ['UNKNOWN_BLOCKER'] }, { message: 'prose' }, { blockerCodes: undefined },
  ]) expect(leaf.FinishRunResultSchema.safeParse({ ...finishIncomplete, ...fields }).success, JSON.stringify(fields)).toBe(false);
  expect(leaf.BeginRepairResultSchema.safeParse(finishIncomplete).success).toBe(false);
  expect(leaf.RequestInvestigationResultSchema.safeParse(finishIncomplete).success).toBe(false);
});

test('completion and request accept only the shared redacted failure vocabulary', () => {
  const failureCodes = [
    'DISCOVERY_INVALID', 'DISCOVERY_FORBIDDEN', 'DISCOVERY_CONFLICT', 'DISCOVERY_PAUSED',
    'SOURCE_UNAVAILABLE', 'TOOL_RESULT_LIMIT', 'TOOL_FORBIDDEN', 'TOOL_UNAVAILABLE',
    'PROPOSAL_REVISION_CONFLICT', 'REPAIR_DIAGNOSTICS_REQUIRED', 'REPAIR_LIMIT', 'INVESTIGATION_REQUEST_LIMIT',
  ];
  for (const result of [
    leaf.DiscoveryCompletionToolFailureSchema, leaf.DiscoveryInvestigationToolFailureSchema,
    leaf.BeginRepairResultSchema, leaf.FinishRunResultSchema, leaf.RequestInvestigationResultSchema,
  ]) {
    for (const code of failureCodes) expect(result.parse({ ok: false, code })).toEqual({ ok: false, code });
    for (const invalid of [
      { ok: false, code: 'UNRECOGNIZED' }, { ok: false, code: 'arbitrary prose' },
      { ok: false, code: 'DISCOVERY_INVALID', message: 'arbitrary prose' },
      { ok: false, code: 'DISCOVERY_INVALID', assessment: {} },
    ]) expect(result.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
  }
  expect(leaf.RequestInvestigationResultSchema.safeParse({ ok: true, requestId: 'request', status: 'pending' }).success).toBe(false);
});

const delegation = {
  subject: { kind: 'source' }, role: 'identity', question: 'Check evidence', dependencyIds: ['z', 'A'],
};
const investigationRequest = {
  subject: { kind: 'source' }, question: 'Check evidence', dependencyFindingRefs: [],
};

test('delegateTask retains the old specialist shape and permits one optional request identity', () => {
  expect(leaf.DelegateTaskInputSchema).toBeDefined();
  expect(leaf.DelegateTaskInputSchema.parse(delegation)).toEqual({ ...delegation, dependencyIds: ['A', 'z'] });
  expect(delegation.dependencyIds).toEqual(['z', 'A']);
  for (const role of ['identity', 'contract', 'receivables', 'connector']) {
    const input = { ...delegation, role, dependencyIds: [], requestId: 'request' };
    expect(leaf.DelegateTaskInputSchema.parse(input)).toEqual(input);
  }
  for (const fields of [
    { role: 'coordinator' }, { requestId: 'has spaces' }, { requesterId: 'task' }, { runId: 'run' }, { grants: {} },
    { consumed: true }, { dependencyIds: ['z', 'z'] }, { dependencyIds: undefined }, { subject: undefined },
    { role: undefined }, { question: undefined }, { question: '' },
    JSON.parse('{"subject":{"kind":"source","constructor":{"prototype":{}}}}'),
  ]) expect(leaf.DelegateTaskInputSchema.safeParse({ ...delegation, ...fields }).success, JSON.stringify(fields)).toBe(false);
});

test('requestInvestigation preserves exact finding revision tuples and rejects nested prototype keys', () => {
  const finding10 = { findingId: 'f', revision: 10 };
  const finding2 = { findingId: 'f', revision: 2 };
  expect(leaf.RequestInvestigationInputSchema.parse({
    ...investigationRequest, dependencyFindingRefs: [finding2, finding10],
  })).toEqual({ ...investigationRequest, dependencyFindingRefs: [finding10, finding2] });
  const poisonedRef = JSON.parse('{"findingId":"f","revision":1,"prototype":{}}');
  expect(leaf.RequestInvestigationInputSchema.safeParse({
    ...investigationRequest, dependencyFindingRefs: [poisonedRef],
  }).success).toBe(false);
});

test('request and delegate questions enforce the exact UTF-8 byte ceiling', () => {
  for (const question of ['a'.repeat(8192), 'é'.repeat(4096)]) {
    expect(Buffer.byteLength(question)).toBe(8192);
    expect(Buffer.byteLength(question + 'a')).toBe(8193);
    expect(leaf.RequestInvestigationInputSchema.parse({ ...investigationRequest, question }).question).toBe(question);
    expect(leaf.DelegateTaskInputSchema.parse({ ...delegation, question }).question).toBe(question);
    expect(leaf.RequestInvestigationInputSchema.safeParse({ ...investigationRequest, question: question + 'a' }).success).toBe(false);
    expect(leaf.DelegateTaskInputSchema.safeParse({ ...delegation, question: question + 'a' }).success).toBe(false);
  }
});

const canonicalBytes = (value: unknown) => Buffer.byteLength(root.canonicalJson(value));

function sizedEnvelope(bytes: number, make: (ids: string[]) => unknown): unknown {
  const shortIds = Array.from({ length: 420 }, (_, index) => index.toString(36).padStart(3, '0'));
  let remaining = bytes - canonicalBytes(make(shortIds));
  const envelope = make(shortIds.map(id => {
    const padding = Math.min(160 - id.length, remaining);
    remaining -= padding;
    return id + 'x'.repeat(padding);
  }));
  expect(canonicalBytes(envelope)).toBe(bytes);
  return envelope;
}

test('variable inputs and repair results enforce the full canonical UTF-8 envelope', () => {
  const question = 'é'.repeat(4096);
  const makeRepair = (diagnosticCodes: string[]) => ({ ...repairInput, diagnosticCodes });
  const makeDelegate = (dependencyIds: string[]) => ({ ...delegation, question, dependencyIds, requestId: 'request' });
  const makeRequest = (ids: string[]) => ({
    ...investigationRequest, question, dependencyFindingRefs: ids.map(findingId => ({ findingId, revision: 1 })),
  });
  const makeRepairResult = (ids: string[]) => ({
    ...repairResult, diagnosticRefs: ids.map(code => ({ ...verificationRef, code })),
  });
  for (const [parser, make] of [
    [leaf.BeginRepairInputSchema, makeRepair], [leaf.DelegateTaskInputSchema, makeDelegate],
    [leaf.RequestInvestigationInputSchema, makeRequest], [leaf.BeginRepairResultSchema, makeRepairResult],
  ] as const) {
    const accepted = parser.safeParse(sizedEnvelope(65_536, make));
    expect(accepted.success).toBe(true);
    expect(canonicalBytes(accepted.data)).toBe(65_536);
    expect(parser.safeParse(sizedEnvelope(65_537, make)).success).toBe(false);
  }
});

test('fixed envelopes reach their structural maxima below the byte ceiling', () => {
  const longestId = 'a'.repeat(160);
  expect(canonicalBytes(leaf.FinishRunInputSchema.parse({}))).toBe(2);
  expect(canonicalBytes(leaf.RequestInvestigationResultSchema.parse({ ok: true, requestId: longestId }))).toBe(186);
  expect(canonicalBytes(leaf.FinishRunResultSchema.parse({
    ...finishSuccess, runId: longestId, observedRunRevision: Number.MAX_SAFE_INTEGER - 1,
    revision: Number.MAX_SAFE_INTEGER,
  }))).toBe(270);
  expect(canonicalBytes(leaf.FinishRunResultSchema.parse(finishIncomplete))).toBe(206);
  expect(canonicalBytes(leaf.DiscoveryCompletionToolFailureSchema.parse({
    ok: false, code: 'INVESTIGATION_REQUEST_LIMIT',
  }))).toBe(49);
});

test('producer descriptors declare only their strict wire input fields', () => {
  expect(leaf.discoveryCompletionToolSchemas.map(tool => tool.name)).toEqual(['beginRepair', 'finishRun']);
  expect(leaf.discoveryDelegationToolSchemas.map(tool => tool.name)).toEqual(['delegateTask']);
  expect(leaf.discoveryInvestigationToolSchemas.map(tool => tool.name)).toEqual(['requestInvestigation']);
  const [begin, finish] = leaf.discoveryCompletionToolSchemas;
  const [delegate] = leaf.discoveryDelegationToolSchemas;
  const [request] = leaf.discoveryInvestigationToolSchemas;
  const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' };
  expect(begin!.inputSchema).toMatchObject({
    type: 'object', additionalProperties: false, required: [
      'investigationId', 'proposalId', 'expectedProposalRevision', 'diagnosticCodes',
    ],
    properties: {
      investigationId: id, proposalId: id,
      expectedProposalRevision: { type: 'integer', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      diagnosticCodes: { type: 'array', items: id, minItems: 1, uniqueItems: true },
    },
  });
  expect(finish!.inputSchema).toMatchObject({ type: 'object', additionalProperties: false, properties: {} });
  expect(Object.keys(finish!.inputSchema.properties ?? {})).toEqual([]);
  expect(finish!.inputSchema.required ?? []).toEqual([]);
  expect(delegate!.inputSchema).toMatchObject({
    type: 'object', additionalProperties: false, required: ['subject', 'role', 'question', 'dependencyIds'],
    properties: {
      requestId: id, role: { enum: ['identity', 'contract', 'receivables', 'connector'] },
      subject: {
        oneOf: [
          { additionalProperties: false, required: ['kind'], properties: { kind: { const: 'source' } } },
          { additionalProperties: false, required: ['kind', 'sellerEntityId', 'sourceAccountId'],
            properties: { kind: { const: 'source_account' }, sellerEntityId: id, sourceAccountId: id } },
        ],
      },
      question: { type: 'string', minLength: 1, maxLength: 8192 },
      dependencyIds: { type: 'array', items: id, uniqueItems: true },
    },
  });
  const requestDescriptor = request!.inputSchema;
  expect(requestDescriptor.$ref).toMatch(/^#\/\$defs\//);
  const requestShape = requestDescriptor.$defs?.[requestDescriptor.$ref!.split('/').at(-1)!];
  expect(requestShape).toMatchObject({
    type: 'object', additionalProperties: false, required: ['subject', 'question', 'dependencyFindingRefs'],
    properties: {
      question: { type: 'string', minLength: 1 }, dependencyFindingRefs: { type: 'array' },
    },
  });
});

test('contracts root exposes exactly the named producer schemas, descriptors and types from the leaf', () => {
  for (const name of [
    'DiscoveryCompletionToolFailureSchema', 'DiscoveryRepairDiagnosticRefSchema',
    'BeginRepairInputSchema', 'BeginRepairResultSchema', 'FinishRunInputSchema', 'FinishRunResultSchema',
    'RequestInvestigationInputSchema', 'RequestInvestigationResultSchema', 'DiscoveryInvestigationToolFailureSchema',
    'DelegateTaskInputSchema', 'discoveryCompletionToolSchemas', 'discoveryDelegationToolSchemas',
    'discoveryInvestigationToolSchemas',
  ] as const) {
    expect(leaf[name], name).toBeDefined();
    expect(root[name], name).toBe(leaf[name]);
  }
  expect(root).not.toHaveProperty('PublishFindingInputSchema');
  expectTypeOf<root.DiscoveryCompletionToolFailure>().toEqualTypeOf<leaf.DiscoveryCompletionToolFailure>();
  expectTypeOf<root.DiscoveryRepairDiagnosticRef>().toEqualTypeOf<leaf.DiscoveryRepairDiagnosticRef>();
  expectTypeOf<root.BeginRepairInput>().toEqualTypeOf<leaf.BeginRepairInput>();
  expectTypeOf<root.BeginRepairResult>().toEqualTypeOf<leaf.BeginRepairResult>();
  expectTypeOf<root.FinishRunInput>().toEqualTypeOf<leaf.FinishRunInput>();
  expectTypeOf<root.FinishRunResult>().toEqualTypeOf<leaf.FinishRunResult>();
  expectTypeOf<root.RequestInvestigationInput>().toEqualTypeOf<leaf.RequestInvestigationInput>();
  expectTypeOf<root.RequestInvestigationResult>().toEqualTypeOf<leaf.RequestInvestigationResult>();
  expectTypeOf<root.DiscoveryInvestigationToolFailure>().toEqualTypeOf<leaf.DiscoveryInvestigationToolFailure>();
  expectTypeOf<root.DelegateTaskInput>().toEqualTypeOf<leaf.DelegateTaskInput>();
});
