import { z } from 'zod';
import {
  BootstrapManifestSchema, BootstrapPinV1Schema, BootstrapVerificationResultV1Schema,
  CompiledArtifactSchema, CustomerProfileSchema, HashSchema, IdSchema, MutationPlanSchema,
  PlanOutcomeSchema, RawSourceEventSchema, SourceSnapshotSchema, TargetStateSchema, canonicalJson, strict,
} from '@eapr/contracts';

export const bootstrapMessageLimit = 10 * 1024 * 1024;

export const BootstrapEvaluatorInputV1Schema = strict({
  protocolVersion: z.literal('bootstrap-1'),
  jobId: IdSchema,
  pin: BootstrapPinV1Schema,
  artifact: CompiledArtifactSchema,
  profiles: CustomerProfileSchema.array().min(1),
  selectedProfileHash: HashSchema,
  manifest: BootstrapManifestSchema,
  snapshot: SourceSnapshotSchema,
  events: RawSourceEventSchema.array(),
  target: TargetStateSchema,
});

export const BootstrapSubjectInputV1Schema = strict({
  protocolVersion: z.literal('bootstrap-subject-1'),
  requestId: IdSchema,
  artifact: CompiledArtifactSchema,
  profile: CustomerProfileSchema,
  events: RawSourceEventSchema.array(),
  target: TargetStateSchema,
});

const subjectOutput = strict({
  protocolVersion: z.literal('bootstrap-subject-1'),
  requestId: IdSchema,
  outcome: PlanOutcomeSchema,
});

const evaluatorCompletion = strict({
  protocolVersion: z.literal('bootstrap-completion-1'),
  jobId: IdSchema,
  requestHash: HashSchema,
  result: BootstrapVerificationResultV1Schema,
  observedBaselinePlan: MutationPlanSchema.nullable(),
  observedBaselinePlanBytesHash: HashSchema.nullable(),
});

// Responses must already be in their canonical schema representation. A transform
// must not repair changed observed plan bytes or reordered coverage on receipt.
function exactResponse<T>(schema: z.ZodType<T>) {
  return z.unknown().transform((value, ctx) => {
    const parsed = schema.safeParse(value);
    if (parsed.success && canonicalJson(parsed.data) === canonicalJson(value)) return parsed.data;
    ctx.addIssue({ code: 'custom', message: 'Invalid bootstrap response' });
    return z.NEVER;
  });
}

export const BootstrapSubjectOutputV1Schema = exactResponse(subjectOutput);
export const BootstrapEvaluatorCompletionV1Schema = exactResponse(evaluatorCompletion);

export type BootstrapEvaluatorInputV1 = z.infer<typeof BootstrapEvaluatorInputV1Schema>;
export type BootstrapEvaluatorCompletionV1 = z.infer<typeof BootstrapEvaluatorCompletionV1Schema>;
export type BootstrapSubjectInputV1 = z.infer<typeof BootstrapSubjectInputV1Schema>;
export type BootstrapLauncher = {
  launch(input: BootstrapEvaluatorInputV1): Promise<BootstrapEvaluatorCompletionV1>;
};

export async function readBootstrapMessage(stream: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > bootstrapMessageLimit) throw new Error('INPUT_TOO_LARGE');
    chunks.push(bytes);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
}
