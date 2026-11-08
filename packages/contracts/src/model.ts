import { z } from 'zod';
import {
  DiagnosticSchema, IdSchema, JsonObjectSchema, JsonPointerSchema, JsonValueSchema, NonnegativeIntegerSchema,
  ScopeSchema, VersionSchema, guardKeys, strict,
} from './common.js';

export const ProductRoleSchema = z.enum(['coordinator', 'identity', 'contract', 'receivables', 'connector']);
export const FindingSchema = strict({
  id: IdSchema, scope: ScopeSchema, taskId: IdSchema, fieldPath: JsonPointerSchema, value: JsonValueSchema,
  origin: z.enum(['agent', 'deterministic', 'reviewer']),
  provenanceClass: z.enum(['observed', 'derived', 'inferred', 'unresolved']),
  evidenceStatus: z.enum(['supported', 'contradicted', 'insufficient']),
  reviewDisposition: z.enum(['pending', 'confirmed', 'rejected']),
  evidenceRefs: z.array(IdSchema), derivationInputs: z.array(IdSchema),
  revision: VersionSchema, supersedesId: IdSchema.optional(),
});
export const TaskContextSchema = strict({
  runId: IdSchema, taskId: IdSchema, role: ProductRoleSchema,
  allowedSourceRefs: z.array(IdSchema), allowedAccountIds: z.array(IdSchema),
});
export const ModelMessageSchema = guardKeys(z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), role: z.enum(['user', 'assistant']), text: z.string() }),
  z.strictObject({ kind: z.literal('tool_result'), callId: IdSchema, name: z.string(), result: JsonValueSchema }),
]));
export const ModelTurnSchema = strict({
  runId: IdSchema, taskId: IdSchema, role: ProductRoleSchema, instructions: z.string(),
  messages: z.array(ModelMessageSchema), toolSchemas: z.array(JsonObjectSchema),
  limits: strict({ maxInputTokens: VersionSchema, maxOutputTokens: VersionSchema, timeoutMs: VersionSchema }),
});
export const ModelResultSchema = strict({
  providerCallId: IdSchema, message: z.string().optional(),
  toolCalls: z.array(strict({ id: IdSchema, name: z.string(), arguments: JsonObjectSchema })),
  usage: strict({ inputTokens: NonnegativeIntegerSchema, outputTokens: NonnegativeIntegerSchema }),
  stopReason: z.enum(['done', 'tool_calls', 'limit', 'error']),
});
export const DiscoveryStateSchema = strict({
  id: IdSchema, companyId: IdSchema, manifestId: IdSchema,
  status: z.enum(['queued', 'running', 'paused', 'blocked', 'completed', 'failed']),
  tasks: z.array(strict({
    id: IdSchema, role: ProductRoleSchema, question: z.string(), dependencyIds: z.array(IdSchema),
    status: z.enum(['queued', 'running', 'waiting', 'succeeded', 'failed', 'interrupted']),
    attempt: NonnegativeIntegerSchema, revision: VersionSchema,
  })),
  findingIds: z.array(IdSchema), candidateArtifactId: IdSchema.optional(),
  modelCalls: NonnegativeIntegerSchema, inputTokens: NonnegativeIntegerSchema, outputTokens: NonnegativeIntegerSchema,
  diagnostics: z.array(DiagnosticSchema),
});
export type ProductRole = z.infer<typeof ProductRoleSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type TaskContext = z.infer<typeof TaskContextSchema>;
export type ModelMessage = z.infer<typeof ModelMessageSchema>;
export type ModelTurn = z.infer<typeof ModelTurnSchema>;
export type ModelResult = z.infer<typeof ModelResultSchema>;
export type DiscoveryState = z.infer<typeof DiscoveryStateSchema>;
