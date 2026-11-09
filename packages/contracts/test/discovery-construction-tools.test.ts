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
