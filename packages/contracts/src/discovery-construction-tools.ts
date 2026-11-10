import { z } from 'zod';
import { HashSchema, IdSchema, IdSetSchema, NonnegativeIntegerSchema, VersionSchema, strict, unique } from './common.js';
import { canonicalJson } from './canonical.js';
import { ConnectorSpecSchema, CustomerProfileSchema } from './connector.js';
import {
  CustomerProfileDraftSchema, DiscoveryFindingV2Schema, DiscoveryProposalV2Schema, DiscoverySubjectSchema,
  ProposalResultSchema,
} from './discovery.js';
import { DiscoveryReadToolFailureSchema } from './discovery-tools.js';
import { FindingSchema } from './model.js';
import { PlanOutcomeSchema } from './runtime.js';
import { VerificationJobSchema } from './review.js';

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

export const CompileConnectorInputSchema = strict({
  proposalId: IdSchema, revision: VersionSchema,
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

export const CompileConnectorResultSchema = z.union([
  strict({ ok: z.literal(true), result: ProposalResultSchema }), DiscoveryReadToolFailureSchema,
]).refine(fitsProposalBytes, 'Tool result exceeds 65,536 UTF-8 bytes');

export type CompileConnectorInput = z.infer<typeof CompileConnectorInputSchema>;
export type CompileConnectorResult = z.infer<typeof CompileConnectorResultSchema>;

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

export const discoveryCompileToolSchemas = [
  { name: 'compileConnector', description: 'Compile the exact current proposal revision and register a candidate when assessment is clear.',
    inputSchema: z.toJSONSchema(CompileConnectorInputSchema, { io: 'input', reused: 'ref', unrepresentable: 'any' }) },
];

export const RunSandboxReplayInputSchema = strict({
  proposalId: IdSchema, revision: VersionSchema,
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

export const RunSandboxReplaySuccessSchema = strict({
  ok: z.literal(true),
  proposalId: IdSchema,
  revision: VersionSchema,
  artifactHash: HashSchema,
  profileHash: HashSchema,
  snapshotId: IdSchema,
  manifestId: IdSchema,
  targetMode: z.literal('empty-sandbox'),
  parentWrites: z.literal(0),
  outcome: PlanOutcomeSchema,
});

export const RunSandboxReplayResultSchema = z.union([
  RunSandboxReplaySuccessSchema,
  DiscoveryReadToolFailureSchema,
]).refine(fitsProposalBytes, 'Tool result exceeds 65,536 UTF-8 bytes');

export type RunSandboxReplayInput = z.infer<typeof RunSandboxReplayInputSchema>;
export type RunSandboxReplayResult = z.infer<typeof RunSandboxReplayResultSchema>;

const ProposalRevisionRefSchema = strict({
  proposalId: IdSchema, revision: VersionSchema,
});

export const CompareArtifactsInputSchema = strict({
  left: ProposalRevisionRefSchema,
  right: ProposalRevisionRefSchema,
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

export const ArtifactCompareDiffSchema = strict({
  category: z.enum(['field', 'rule', 'profile', 'hash', 'scope']),
  path: z.string().min(1).max(512),
  change: z.enum(['added', 'removed', 'changed']),
  leftDigest: HashSchema.optional(),
  rightDigest: HashSchema.optional(),
});

const CompareSideSchema = strict({
  proposalId: IdSchema,
  revision: VersionSchema,
  payloadHash: HashSchema,
  profileHashes: z.array(HashSchema).length(1),
  artifactHash: HashSchema.optional(),
  specId: IdSchema,
  specVersion: VersionSchema,
});

export const CompareArtifactsSuccessSchema = strict({
  ok: z.literal(true),
  left: CompareSideSchema,
  right: CompareSideSchema,
  identical: z.boolean(),
  diffs: z.array(ArtifactCompareDiffSchema).max(500),
}).refine(value => value.identical === (value.diffs.length === 0), {
  path: ['identical'], message: 'identical must equal diffs.length === 0',
});

export const CompareArtifactsResultSchema = z.union([
  CompareArtifactsSuccessSchema,
  DiscoveryReadToolFailureSchema,
]).refine(fitsProposalBytes, 'Tool result exceeds 65,536 UTF-8 bytes');

export type CompareArtifactsInput = z.infer<typeof CompareArtifactsInputSchema>;
export type CompareArtifactsResult = z.infer<typeof CompareArtifactsResultSchema>;
export type ArtifactCompareDiff = z.infer<typeof ArtifactCompareDiffSchema>;

export const discoveryReplayToolSchemas = [
  { name: 'runSandboxReplay',
    description: 'Replay the exact compiled proposal revision against the pinned capture on an isolated empty sandbox target. parentWrites is always 0.',
    inputSchema: z.toJSONSchema(RunSandboxReplayInputSchema, { io: 'input', reused: 'ref', unrepresentable: 'any' }) },
];

export const discoveryCompareToolSchemas = [
  { name: 'compareArtifacts',
    description: 'Compare two same-run proposal revisions by deterministic field, rule, profile, hash, and scope digests.',
    inputSchema: z.toJSONSchema(CompareArtifactsInputSchema, { io: 'input', reused: 'ref', unrepresentable: 'any' }) },
];

export const RequestVerificationInputSchema = strict({
  proposalId: IdSchema, revision: VersionSchema, profileHash: HashSchema,
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

export const ReadVerificationInputSchema = strict({
  proposalId: IdSchema, revision: VersionSchema, jobId: IdSchema,
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

/** Safe job observation only. No holdout, report truth, pins, or reservation bytes. */
const SafeVerificationJobSchema = VerificationJobSchema;

export const DiscoveryVerificationToolFailureSchema = strict({
  ok: z.literal(false),
  code: z.enum([
    'DISCOVERY_INVALID', 'DISCOVERY_FORBIDDEN', 'DISCOVERY_CONFLICT', 'DISCOVERY_PAUSED',
    'VERIFICATION_SCOPE_REQUIRED', 'SOURCE_UNAVAILABLE', 'TOOL_RESULT_LIMIT', 'TOOL_FORBIDDEN',
    'TOOL_UNAVAILABLE',
  ]),
});

export const RequestVerificationResultSchema = z.union([
  strict({ ok: z.literal(true), job: SafeVerificationJobSchema }),
  DiscoveryVerificationToolFailureSchema,
]).refine(fitsProposalBytes, 'Tool result exceeds 65,536 UTF-8 bytes');

export const ReadVerificationResultSchema = RequestVerificationResultSchema;

export type RequestVerificationInput = z.infer<typeof RequestVerificationInputSchema>;
export type ReadVerificationInput = z.infer<typeof ReadVerificationInputSchema>;
export type RequestVerificationResult = z.infer<typeof RequestVerificationResultSchema>;
export type ReadVerificationResult = z.infer<typeof ReadVerificationResultSchema>;
export type DiscoveryVerificationToolFailure = z.infer<typeof DiscoveryVerificationToolFailureSchema>;

export const discoveryVerificationToolSchemas = [
  { name: 'requestVerification',
    description: 'Enqueue protected financial verification for the exact one-profile compiled proposal revision under trusted account scope.',
    inputSchema: z.toJSONSchema(RequestVerificationInputSchema, { io: 'input', reused: 'ref', unrepresentable: 'any' }) },
  { name: 'readVerification',
    description: 'Read a same-run authorized verification job and safe summary. Holdout and report truth are never returned.',
    inputSchema: z.toJSONSchema(ReadVerificationInputSchema, { io: 'input', reused: 'ref', unrepresentable: 'any' }) },
];

/** Contracts-only I/O. Keep unadvertised in roles until storage/semantics land after Blocker C. */
export const RequestInvestigationInputSchema = strict({
  subject: DiscoverySubjectSchema,
  question: z.string().min(1).refine(question => Buffer.byteLength(question) <= 8192, 'Question exceeds 8192 UTF-8 bytes'),
  dependencyFindingRefs: DiscoveryProposalV2Schema.out.shape.findingRefs,
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

export const DiscoveryCompletionToolFailureSchema = strict({
  ok: z.literal(false),
  code: z.enum([
    'DISCOVERY_INVALID', 'DISCOVERY_FORBIDDEN', 'DISCOVERY_CONFLICT', 'DISCOVERY_PAUSED',
    'SOURCE_UNAVAILABLE', 'TOOL_RESULT_LIMIT', 'TOOL_FORBIDDEN', 'TOOL_UNAVAILABLE',
    'PROPOSAL_REVISION_CONFLICT', 'REPAIR_DIAGNOSTICS_REQUIRED', 'REPAIR_LIMIT', 'INVESTIGATION_REQUEST_LIMIT',
  ]),
}).refine(fitsProposalBytes, 'Tool result exceeds 65,536 UTF-8 bytes');

export const DiscoveryInvestigationToolFailureSchema = DiscoveryCompletionToolFailureSchema;

export const RequestInvestigationResultSchema = z.union([
  strict({ ok: z.literal(true), requestId: IdSchema }),
  DiscoveryInvestigationToolFailureSchema,
]).refine(fitsProposalBytes, 'Tool result exceeds 65,536 UTF-8 bytes');

export type RequestInvestigationInput = z.infer<typeof RequestInvestigationInputSchema>;
export type RequestInvestigationResult = z.infer<typeof RequestInvestigationResultSchema>;
export type DiscoveryInvestigationToolFailure = z.infer<typeof DiscoveryInvestigationToolFailureSchema>;

export const discoveryInvestigationToolSchemas = [
  { name: 'requestInvestigation',
    description: 'Persist a bounded coordinator investigation request for a pinned source or captured tuple. Does not spawn a task or widen grants.',
    inputSchema: z.toJSONSchema(RequestInvestigationInputSchema, { io: 'input', reused: 'ref', unrepresentable: 'any' }) },
];

export const DiscoveryRepairDiagnosticRefSchema = z.union([
  strict({ code: IdSchema, kind: z.literal('compile'), toolStepId: IdSchema, assessmentRevision: VersionSchema }),
  strict({
    code: IdSchema, kind: z.literal('verification'), requestKey: IdSchema, jobId: IdSchema,
    assessmentRevision: VersionSchema,
  }),
]);

export const BeginRepairInputSchema = strict({
  investigationId: IdSchema,
  proposalId: IdSchema,
  expectedProposalRevision: VersionSchema,
  diagnosticCodes: IdSetSchema.min(1).meta({ uniqueItems: true }).transform(codes => [...codes].sort()),
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

export const BeginRepairResultSchema = z.union([
  strict({
    ok: z.literal(true),
    investigationId: IdSchema,
    proposalId: IdSchema,
    proposalRevision: VersionSchema,
    repairRound: z.literal([1, 2]),
    diagnosticRefs: z.array(DiscoveryRepairDiagnosticRefSchema).min(1)
      .refine(refs => unique(refs, ref => ref.code), 'Duplicate diagnostic code')
      .transform(refs => [...refs].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
  }),
  DiscoveryCompletionToolFailureSchema,
]).refine(fitsProposalBytes, 'Tool result exceeds 65,536 UTF-8 bytes');

export const FinishRunInputSchema = strict({})
  .refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

const FinishRunBlockerCodeSchema = z.enum([
  'TASK_GRAPH_INCOMPLETE', 'TASK_DEPENDENCIES_UNRESOLVED', 'NO_CURRENT_COMPILED_PROPOSAL',
  'DISCOVERY_ASSESSMENT_UNRESOLVED', 'DISCOVERY_WORK_IN_FLIGHT',
]);

export const FinishRunResultSchema = z.union([
  strict({
    ok: z.literal(true),
    runId: IdSchema,
    status: z.literal('completed'),
    observedRunRevision: VersionSchema,
    revision: VersionSchema,
  }).refine(({ observedRunRevision, revision }) => revision === observedRunRevision + 1, {
    path: ['revision'], message: 'Completion revision must follow the observed run revision',
  }),
  strict({
    ok: z.literal(false),
    code: z.literal('DISCOVERY_INCOMPLETE'),
    blockerCodes: z.array(FinishRunBlockerCodeSchema).min(1)
      .refine(codes => unique(codes, code => code), 'Duplicate blocker code')
      .transform(codes => [...codes].sort()),
  }),
  DiscoveryCompletionToolFailureSchema,
]).refine(fitsProposalBytes, 'Tool result exceeds 65,536 UTF-8 bytes');

export const DelegateTaskInputSchema = strict({
  subject: DiscoverySubjectSchema,
  role: z.enum(['identity', 'contract', 'receivables', 'connector']),
  question: z.string().min(1).max(8192)
    .refine(question => Buffer.byteLength(question) <= 8192, 'Question exceeds 8192 UTF-8 bytes')
    .describe('At most 8192 UTF-8 bytes.'),
  dependencyIds: IdSetSchema.meta({ uniqueItems: true }).transform(ids => [...ids].sort()),
  requestId: IdSchema.optional(),
}).refine(fitsProposalBytes, 'Invalid canonical input or input exceeds 65,536 UTF-8 bytes');

export type DiscoveryCompletionToolFailure = z.infer<typeof DiscoveryCompletionToolFailureSchema>;
export type DiscoveryRepairDiagnosticRef = z.infer<typeof DiscoveryRepairDiagnosticRefSchema>;
export type BeginRepairInput = z.infer<typeof BeginRepairInputSchema>;
export type BeginRepairResult = z.infer<typeof BeginRepairResultSchema>;
export type FinishRunInput = z.infer<typeof FinishRunInputSchema>;
export type FinishRunResult = z.infer<typeof FinishRunResultSchema>;
export type DelegateTaskInput = z.infer<typeof DelegateTaskInputSchema>;

// JSON Schema cannot express the canonical envelope byte limit, UTF-8 question
// byte limit or normalization. The runtime parsers enforce those constraints.
export const discoveryCompletionToolSchemas = [
  { name: 'beginRepair',
    description: 'Begin a bounded repair for the exact proposal revision using current diagnostic codes.',
    inputSchema: z.toJSONSchema(BeginRepairInputSchema, { io: 'input', unrepresentable: 'any' }) },
  { name: 'finishRun',
    description: 'Complete discovery after the run meets its completion requirements.',
    inputSchema: z.toJSONSchema(FinishRunInputSchema, { io: 'input', unrepresentable: 'any' }) },
];

export const discoveryDelegationToolSchemas = [
  { name: 'delegateTask',
    description: 'Assign a bounded specialist investigation, optionally handling an existing request.',
    inputSchema: z.toJSONSchema(DelegateTaskInputSchema, { io: 'input', unrepresentable: 'any' }) },
];
