import { z } from 'zod';
import {
  BootstrapManifestSchema, CompiledArtifactSchema, CustomerProfileSchema, HashSchema, IdSchema, PlanOutcomeSchema,
  RawSourceEventSchema, TargetStateSchema, strict,
} from '@eapr/contracts';

export const EvaluatorInputSchema = strict({
  protocolVersion: z.literal(1),
  jobId: IdSchema,
  artifact: CompiledArtifactSchema,
  profiles: z.array(CustomerProfileSchema),
  manifest: BootstrapManifestSchema,
  fixtureSetId: IdSchema,
  fixtureSetVersion: IdSchema,
  evaluatorBuildHash: HashSchema,
});

export const SubjectInputSchema = strict({
  protocolVersion: z.literal(1),
  requestId: IdSchema,
  artifact: CompiledArtifactSchema,
  profile: CustomerProfileSchema,
  events: z.array(RawSourceEventSchema),
  target: TargetStateSchema,
});

export const SubjectOutputSchema = strict({
  requestId: IdSchema,
  outcome: PlanOutcomeSchema,
});

export type EvaluatorInput = z.infer<typeof EvaluatorInputSchema>;
export type SubjectInput = z.infer<typeof SubjectInputSchema>;
export type SubjectOutput = z.infer<typeof SubjectOutputSchema>;
