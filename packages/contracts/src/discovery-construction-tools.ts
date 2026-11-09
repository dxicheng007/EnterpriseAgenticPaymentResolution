import { z } from 'zod';
import { IdSchema, NonnegativeIntegerSchema, VersionSchema, strict } from './common.js';
import { canonicalJson } from './canonical.js';
import { ConnectorSpecSchema, CustomerProfileSchema } from './connector.js';
import { CustomerProfileDraftSchema, DiscoveryFindingV2Schema, DiscoveryProposalV2Schema, ProposalResultSchema } from './discovery.js';
import { DiscoveryReadToolFailureSchema } from './discovery-tools.js';
import { FindingSchema } from './model.js';

const fitsToolBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536;

const { schemaVersion, id, revision, taskId, reviewDisposition, origin, ...findingFields } = DiscoveryFindingV2Schema.out.shape;

export const PublishFindingInputSchema = strict({
  findingId: IdSchema.optional(), expectedRevision: NonnegativeIntegerSchema, ...findingFields,
}).refine(({ findingId, expectedRevision }) => (findingId === undefined) === (expectedRevision === 0), {
  path: ['expectedRevision'], message: 'New findings require revision zero and no identity',
}).refine(fitsToolBytes, 'Tool input exceeds 65,536 UTF-8 bytes').refine(({ findingId, expectedRevision, ...fields }) => DiscoveryFindingV2Schema.safeParse({
  ...fields, schemaVersion: 2, id: findingId ?? 'new', revision: Math.max(1, expectedRevision),
  taskId: 'task', reviewDisposition: 'pending', origin: 'agent',
}).success, 'Invalid finding payload');

export const ReadFindingInputSchema = strict({ findingId: IdSchema, revision: VersionSchema });

export const PublishFindingResultSchema = z.union([
  strict({ ok: z.literal(true), ...ReadFindingInputSchema.out.shape }), DiscoveryReadToolFailureSchema,
]);
export const ReadFindingResultSchema = z.union([
  strict({ ok: z.literal(true), finding: DiscoveryFindingV2Schema }).refine(
    fitsToolBytes, 'Tool result exceeds 65,536 UTF-8 bytes'),
  DiscoveryReadToolFailureSchema,
]);

export type PublishFindingInput = z.infer<typeof PublishFindingInputSchema>;
export type ReadFindingInput = z.infer<typeof ReadFindingInputSchema>;
export type PublishFindingResult = z.infer<typeof PublishFindingResultSchema>;
export type ReadFindingResult = z.infer<typeof ReadFindingResultSchema>;

const findingId = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' };
const version = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const evidenceRefs = { type: 'array', items: findingId, maxItems: 50, uniqueItems: true };
const ref = {
  type: 'object', additionalProperties: false, required: ['findingId', 'revision'],
  properties: { findingId, revision: version },
};
const subject = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'source' } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'sellerEntityId', 'sourceAccountId'],
      properties: { kind: { const: 'source_account' }, sellerEntityId: findingId, sourceAccountId: findingId } },
  ],
};
const fields = {
  expectedRevision: { ...version, minimum: 0 }, subject, fieldPath: { type: 'string' }, value: {},
  provenanceClass: { enum: ['observed', 'derived', 'inferred', 'unresolved'] },
  evidenceStatus: { enum: ['supported', 'contradicted', 'insufficient'] },
  evidenceRefs,
  derivationInputs: { type: 'array', items: ref, maxItems: 50, uniqueItems: true },
  alternatives: { type: 'array', maxItems: 10, items: {
    type: 'object', additionalProperties: false, required: ['value', 'evidenceRefs'],
    properties: { value: {}, evidenceRefs },
  } },
  unresolvedQuestions: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 512 } },
};
export const discoveryFindingToolSchemas = [
  { name: 'publishFinding', description: 'Publish a pending agent finding for your investigation. Omit findingId at revision zero.',
    inputSchema: { type: 'object', additionalProperties: false, required: Object.keys(fields),
      properties: { findingId, ...fields } } },
  { name: 'readFinding', description: 'Read an authorized exact finding revision.', inputSchema: ref },
];

const fitsProposalBytes = (value: unknown) => {
  try {
    return new TextEncoder().encode(canonicalJson(value)).byteLength <= 65_536;
  } catch {
    return false;
  }
};

const proposalFields = {
  spec: ConnectorSpecSchema, profiles: z.array(CustomerProfileDraftSchema).length(1),
  findingRefs: DiscoveryProposalV2Schema.out.shape.findingRefs,
};

export const DraftConnectorInputSchema = strict({
  expectedRevision: z.literal(0), ...proposalFields,
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

export const ReviseConnectorInputSchema = strict({
  proposalId: IdSchema, expectedRevision: VersionSchema, ...proposalFields,
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

export const DraftConnectorResultSchema = z.union([
  strict({ ok: z.literal(true), result: ProposalResultSchema }), DiscoveryReadToolFailureSchema,
]).refine(fitsProposalBytes, 'Tool result exceeds 65,536 UTF-8 bytes');
export const ReviseConnectorResultSchema = DraftConnectorResultSchema;

export type DraftConnectorInput = z.infer<typeof DraftConnectorInputSchema>;
export type ReviseConnectorInput = z.infer<typeof ReviseConnectorInputSchema>;
export type DraftConnectorResult = z.infer<typeof DraftConnectorResultSchema>;
export type ReviseConnectorResult = z.infer<typeof ReviseConnectorResultSchema>;

// The runtime draft parser retains the full profile refinements. Its preprocessing
// is opaque to JSON Schema conversion, so derive the wire shape from the same fields.
const { hash: _profileHash, ...profileFields } = CustomerProfileSchema.out.shape;
const descriptorFields = {
  ...proposalFields,
  profiles: z.array(z.strictObject({
    ...profileFields,
    findings: z.array(FindingSchema.out.extend({
      origin: z.literal('agent'), reviewDisposition: z.literal('pending'),
    })),
  })).length(1),
};
const proposalDescriptor = (shape: z.ZodRawShape) => z.toJSONSchema(z.strictObject({
  ...shape, ...descriptorFields,
}), { io: 'input', reused: 'ref', unrepresentable: 'any' });

export const discoveryProposalToolSchemas = [
  { name: 'draftConnector', description: 'Submit a connector specification and one proposed customer profile.',
    inputSchema: proposalDescriptor({ expectedRevision: z.literal(0) }) },
  { name: 'reviseConnector', description: 'Submit a new exact revision of an existing proposal for the same customer.',
    inputSchema: proposalDescriptor({ proposalId: IdSchema, expectedRevision: VersionSchema }) },
];
