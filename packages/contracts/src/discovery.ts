import { z } from 'zod';
import { ActivityEventSchema } from './activity.js';
import {
  DiagnosticSchema, HashSchema, IdSchema, JsonObjectSchema, JsonPointerSchema, JsonValueSchema,
  NonnegativeIntegerSchema, VersionSchema, guardKeys, strict, unique,
} from './common.js';
import { ConnectorSpecSchema, CustomerProfileSchema, type CustomerProfile } from './connector.js';
import { ProductRoleSchema, TaskContextSchema, type TaskContext } from './model.js';

function orderedSet<T>(array: z.ZodType<T[]>, key: (entry: T) => string) {
  return array.refine(entries => unique(entries, key), 'Duplicate set member')
    .transform(entries => entries.map(entry => ({ entry, key: key(entry) }))
      .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      .map(({ entry }) => entry));
}

const idSet = orderedSet(z.array(IdSchema), id => id);
const evidenceRefs = orderedSet(z.array(IdSchema).max(50), id => id);
const findingRef = strict({ findingId: IdSchema, revision: VersionSchema });
const findingRefKey = ({ findingId, revision }: { findingId: string; revision: number }) =>
  JSON.stringify([findingId, revision]);

const encoder = new TextEncoder();
function fitsJsonBytes(value: unknown, limit: number) {
  // The parsed payload contains safe JSON. Key ordering does not affect its UTF-8 size.
  return encoder.encode(JSON.stringify(value)).byteLength <= limit;
}

const maxJsonNesting = 128;
function canonicalJsonInput<T extends z.ZodType>(schema: T) {
  return z.preprocess((value, ctx) => {
    // Bound depth before invoking the recursive v1 JSON parser.
    const pending = [{ value, depth: 0 }];
    while (pending.length > 0) {
      const entry = pending.pop()!;
      if (typeof entry.value === 'number' && (!Number.isSafeInteger(entry.value) || Object.is(entry.value, -0))) {
        ctx.addIssue({ code: 'custom', message: 'Expected canonical JSON numbers' });
        return z.NEVER;
      }
      if (entry.value !== null && typeof entry.value === 'object') {
        if (entry.depth >= maxJsonNesting) {
          ctx.addIssue({ code: 'custom', message: 'JSON nesting exceeds 128 containers' });
          return z.NEVER;
        }
        for (const child of Object.values(entry.value)) pending.push({ value: child, depth: entry.depth + 1 });
      }
    }
    return value;
  }, schema);
}

const canonicalValue = canonicalJsonInput(JsonValueSchema);
const canonicalObject = canonicalJsonInput(JsonObjectSchema);

export const DiscoveryBindingSchema = strict({
  companyId: IdSchema, sourceRef: IdSchema, manifestId: IdSchema, manifestHash: HashSchema,
  snapshotId: IdSchema, snapshotHash: HashSchema,
});
export const DiscoverySubjectSchema = guardKeys(z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('source') }),
  z.strictObject({ kind: z.literal('source_account'), sellerEntityId: IdSchema, sourceAccountId: IdSchema }),
]));
const sourceAccount = strict({ sellerEntityId: IdSchema, sourceAccountId: IdSchema });
export const SourceReadGrantSchema = strict({
  companyId: IdSchema, sourceRef: IdSchema, sourceWide: z.boolean(),
  accounts: orderedSet(z.array(sourceAccount), entry => JSON.stringify([entry.sellerEntityId, entry.sourceAccountId])),
}).refine(grant => grant.sourceWide || grant.accounts.length > 0, {
  path: ['accounts'], message: 'Account-restricted grants require at least one account',
});

export const DiscoveryTaskContextV2Schema = strict({
  schemaVersion: z.literal(2), runId: IdSchema, taskId: IdSchema, role: ProductRoleSchema,
  allowedSourceRefs: idSet, allowedAccountIds: idSet,
  binding: DiscoveryBindingSchema, sourceRead: SourceReadGrantSchema,
  investigationId: IdSchema, taskRevision: VersionSchema, dispatchId: IdSchema,
}).refine(({ binding, sourceRead, allowedSourceRefs }) =>
  sourceRead.companyId === binding.companyId && sourceRead.sourceRef === binding.sourceRef &&
    allowedSourceRefs.includes(binding.sourceRef), {
  path: ['sourceRead'], message: 'Grant must match the binding and allowed source references',
});

// Consumers still authenticate the persisted context and dispatch before tool use.
export function toVerificationTaskContext(context: DiscoveryTaskContextV2): TaskContext {
  const { runId, taskId, role, allowedSourceRefs, allowedAccountIds } = context;
  return TaskContextSchema.parse({ runId, taskId, role, allowedSourceRefs, allowedAccountIds });
}

const maxToolCalls = 4;
const maxModelBytes = 128 * 1024;
const toolFields = {
  name: z.string(),
  arguments: canonicalObject.refine(args => fitsJsonBytes(args, 64 * 1024), 'Tool arguments exceed 64 KiB'),
};
const transcriptCall = strict({ toolStepId: IdSchema, providerToolCallId: IdSchema, ...toolFields });
export const ModelMessageV2Schema = guardKeys(z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), role: z.enum(['user', 'assistant']), text: z.string() }),
  z.strictObject({
    kind: z.literal('assistant_tool_calls'),
    calls: z.array(transcriptCall).min(1).max(maxToolCalls)
      .refine(calls => unique(calls, call => call.providerToolCallId), 'Duplicate native tool call ID')
      .refine(calls => unique(calls, call => call.toolStepId), 'Duplicate tool step ID'),
  }),
  z.strictObject({ kind: z.literal('tool_result'), toolStepId: IdSchema, name: z.string(), result: canonicalValue }),
]));

function completeTranscript(messages: ModelMessageV2[]) {
  const seen = new Set<string>();
  const open = new Map<string, string>();
  for (const message of messages) {
    if (message.kind === 'assistant_tool_calls') {
      if (open.size > 0) return false;
      for (const { toolStepId, name } of message.calls) {
        if (seen.has(toolStepId)) return false;
        seen.add(toolStepId);
        open.set(toolStepId, name);
      }
    } else if (message.kind === 'tool_result') {
      if (open.get(message.toolStepId) !== message.name) return false;
      open.delete(message.toolStepId);
    }
  }
  return open.size === 0;
}

export const ModelTurnV2Schema = strict({
  schemaVersion: z.literal(2), dispatchId: IdSchema, runId: IdSchema, taskId: IdSchema, role: ProductRoleSchema,
  instructions: z.string(),
  messages: z.array(ModelMessageV2Schema).refine(completeTranscript, 'Incomplete or inconsistent tool transcript'),
  toolSchemas: z.array(canonicalObject),
  limits: strict({
    maxInputTokens: VersionSchema.max(8192), maxOutputTokens: VersionSchema.max(2048), timeoutMs: VersionSchema.max(60000),
  }),
}).refine(turn => fitsJsonBytes(turn, maxModelBytes), 'Model turn exceeds 128 KiB');

export const ModelResultV2Schema = strict({
  schemaVersion: z.literal(2), dispatchId: IdSchema, providerCallId: IdSchema, message: z.string().max(2000).optional(),
  toolCalls: z.array(strict({ id: IdSchema, ...toolFields })).max(maxToolCalls)
    .refine(calls => unique(calls, call => call.id), 'Duplicate native tool call ID'),
  usage: strict({ inputTokens: NonnegativeIntegerSchema, outputTokens: NonnegativeIntegerSchema }),
  stopReason: z.enum(['done', 'tool_calls', 'limit', 'error']),
}).refine(result => (result.stopReason === 'tool_calls') === (result.toolCalls.length > 0), {
  path: ['stopReason'], message: 'Tool calls must agree with the stop reason',
}).refine(result => fitsJsonBytes(result, maxModelBytes), 'Model result exceeds 128 KiB')
  .transform((result): typeof result => {
    if (result.message !== undefined) return result;
    const { message: _message, ...withoutMessage } = result;
    return withoutMessage;
  });

export const DiscoveryFindingV2Schema = strict({
  schemaVersion: z.literal(2), id: IdSchema, revision: VersionSchema, taskId: IdSchema,
  subject: DiscoverySubjectSchema, fieldPath: JsonPointerSchema, value: canonicalValue,
  provenanceClass: z.enum(['observed', 'derived', 'inferred', 'unresolved']),
  evidenceStatus: z.enum(['supported', 'contradicted', 'insufficient']),
  evidenceRefs, derivationInputs: orderedSet(z.array(findingRef).max(50), findingRefKey),
  alternatives: z.array(strict({ value: canonicalValue, evidenceRefs })).max(10),
  unresolvedQuestions: z.array(z.string().max(512)).max(10),
  reviewDisposition: z.literal('pending'), origin: z.literal('agent'),
}).refine(({ value, alternatives }) => fitsJsonBytes({ value, alternatives }, 8 * 1024), {
  path: ['value'], message: 'Finding value and alternatives exceed 8 KiB',
});

const discoveryProfile = CustomerProfileSchema.refine(profile =>
  profile.findings.every(finding => finding.origin === 'agent' && finding.reviewDisposition === 'pending'), {
  path: ['findings'], message: 'Discovery profile findings must be pending agent findings',
});

export const CustomerProfileDraftSchema = guardKeys(z.preprocess((input, ctx) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    ctx.addIssue({ code: 'custom', message: 'Expected a profile draft object' });
    return z.NEVER;
  }
  if (Object.hasOwn(input, 'hash')) {
    ctx.addIssue({ code: 'custom', path: ['hash'], message: 'Profile draft must omit hash' });
    return z.NEVER;
  }
  // The complete current profile parser validates bootstrap and all its cross-field constraints.
  return { ...input, hash: '0'.repeat(64) };
}, discoveryProfile).transform(({ hash: _hash, ...draft }): Omit<CustomerProfile, 'hash'> => draft));

export const DiscoveryProposalV2Schema = strict({
  schemaVersion: z.literal(2), id: IdSchema, revision: VersionSchema, taskId: IdSchema,
  spec: ConnectorSpecSchema, profiles: z.array(discoveryProfile).length(1),
  findingRefs: orderedSet(z.array(findingRef), findingRefKey), investigationIds: idSet,
});
const blockerRef = strict({ findingId: IdSchema, revision: VersionSchema, code: IdSchema });
const assessment = strict({
  revision: VersionSchema, observedRunRevision: VersionSchema, investigationIds: idSet,
  blockerRefs: orderedSet(z.array(blockerRef), entry => JSON.stringify([entry.findingId, entry.revision, entry.code])),
  diagnosticCodes: idSet,
});
export const ProposalResultSchema = strict({
  proposalId: IdSchema, revision: VersionSchema, state: z.enum(['draft', 'compile_blocked', 'compiled']),
  artifactHash: HashSchema.optional(), profileHashes: orderedSet(z.array(HashSchema), hash => hash),
  diagnostics: z.array(DiagnosticSchema), assessment,
}).refine(result => result.state !== 'compiled' || (
  result.artifactHash !== undefined && result.profileHashes.length === 1 &&
    result.assessment.blockerRefs.length === 0 && result.assessment.diagnosticCodes.length === 0
), { path: ['state'], message: 'Compilation requires exact hashes and an unblocked assessment' });

const discoveryTask = strict({
  id: IdSchema, investigationId: IdSchema, subject: DiscoverySubjectSchema, role: ProductRoleSchema,
  question: z.string(), dependencyIds: idSet,
  status: z.enum(['queued', 'running', 'waiting', 'succeeded', 'failed', 'interrupted']),
  attempt: NonnegativeIntegerSchema.refine(value => value <= 9), revision: VersionSchema,
  toolRounds: NonnegativeIntegerSchema.refine(value => value <= 8),
  repairRound: NonnegativeIntegerSchema.refine(value => value <= 2),
  diagnosticCodes: orderedSet(z.array(z.string()), code => code),
});
const discoveryFindingRef = strict({ id: IdSchema, revision: VersionSchema, taskId: IdSchema, subject: DiscoverySubjectSchema });
const verificationJobRef = strict({ proposalId: IdSchema, proposalRevision: VersionSchema, jobId: IdSchema });

export const DiscoveryStateV2Schema = strict({
  schemaVersion: z.literal(2), id: IdSchema, revision: VersionSchema, binding: DiscoveryBindingSchema,
  mode: z.enum(['scripted', 'live']), modelId: IdSchema,
  status: z.enum(['queued', 'running', 'paused', 'blocked', 'completed', 'failed']),
  inFlightModelCalls: NonnegativeIntegerSchema.refine(value => value <= 4), inFlightToolSteps: NonnegativeIntegerSchema,
  tasks: orderedSet(z.array(discoveryTask), task => task.id),
  findings: orderedSet(z.array(discoveryFindingRef), finding => finding.id),
  proposals: orderedSet(z.array(ProposalResultSchema), proposal => proposal.proposalId),
  verificationJobs: orderedSet(z.array(verificationJobRef), job => JSON.stringify([job.proposalId, job.proposalRevision, job.jobId])),
  usage: strict({
    modelCalls: NonnegativeIntegerSchema, inputTokens: NonnegativeIntegerSchema,
    outputTokens: NonnegativeIntegerSchema, unknownUsageCalls: NonnegativeIntegerSchema,
    cost: strict({ status: z.literal('unavailable') }),
  }),
  diagnostics: z.array(DiagnosticSchema),
});

export const DiscoveryCapabilitiesResponseV2Schema = strict({
  schemaVersion: z.literal(2), mode: z.enum(['unconfigured', 'scripted', 'live']),
  startAvailable: z.boolean(), diagnostics: z.array(DiagnosticSchema),
});
export const StartDiscoveryRequestV2Schema = strict({
  schemaVersion: z.literal(2), companyId: IdSchema, manifestId: IdSchema, idempotencyKey: IdSchema,
});
export const StartDiscoveryResponseV2Schema = strict({ schemaVersion: z.literal(2), runId: IdSchema });
export const DiscoveryActionRequestV2Schema = strict({
  schemaVersion: z.literal(2), expectedRevision: VersionSchema, idempotencyKey: IdSchema,
});

export const DiscoveryCursorV1Schema = strict({
  v: z.literal(1), runId: IdSchema, controlCursor: NonnegativeIntegerSchema,
});
const activityWindow = { highWater: NonnegativeIntegerSchema, retainedAfter: NonnegativeIntegerSchema };
export const ControlActivityWindowSchema = strict(activityWindow)
  .refine(window => window.retainedAfter <= window.highWater, 'Retention floor exceeds high-water');

export const ControlActivityPageSchema = strict({
  ...activityWindow, events: z.array(ActivityEventSchema), nextAfter: NonnegativeIntegerSchema, hasMore: z.boolean(),
}).refine(({ events, highWater, retainedAfter, nextAfter, hasMore }) => {
  if (retainedAfter > highWater || nextAfter > highWater) return false;
  let last = retainedAfter;
  for (const event of events) {
    if (event.stream !== 'control' || event.sequence <= last || event.sequence > nextAfter) return false;
    last = event.sequence;
  }
  return hasMore ? events.length > 0 && nextAfter === last && nextAfter < highWater : nextAfter === highWater;
}, 'Inconsistent control activity page');

export type DiscoveryBinding = z.infer<typeof DiscoveryBindingSchema>;
export type DiscoverySubject = z.infer<typeof DiscoverySubjectSchema>;
export type SourceReadGrant = z.infer<typeof SourceReadGrantSchema>;
export type DiscoveryTaskContextV2 = z.infer<typeof DiscoveryTaskContextV2Schema>;
export type ModelMessageV2 = z.infer<typeof ModelMessageV2Schema>;
export type ModelTurnV2 = z.infer<typeof ModelTurnV2Schema>;
export type ModelResultV2 = z.infer<typeof ModelResultV2Schema>;
export type DiscoveryFindingV2 = z.infer<typeof DiscoveryFindingV2Schema>;
export type CustomerProfileDraft = z.infer<typeof CustomerProfileDraftSchema>;
export type DiscoveryProposalV2 = z.infer<typeof DiscoveryProposalV2Schema>;
export type ProposalResult = z.infer<typeof ProposalResultSchema>;
export type DiscoveryStateV2 = z.infer<typeof DiscoveryStateV2Schema>;
export type DiscoveryCapabilitiesResponseV2 = z.infer<typeof DiscoveryCapabilitiesResponseV2Schema>;
export type StartDiscoveryRequestV2 = z.infer<typeof StartDiscoveryRequestV2Schema>;
export type StartDiscoveryResponseV2 = z.infer<typeof StartDiscoveryResponseV2Schema>;
export type DiscoveryActionRequestV2 = z.infer<typeof DiscoveryActionRequestV2Schema>;
export type DiscoveryCursorV1 = z.infer<typeof DiscoveryCursorV1Schema>;
export type ControlActivityWindow = z.infer<typeof ControlActivityWindowSchema>;
export type ControlActivityPage = z.infer<typeof ControlActivityPageSchema>;
