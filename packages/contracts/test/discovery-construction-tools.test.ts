import { expect, test } from 'vitest';
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
