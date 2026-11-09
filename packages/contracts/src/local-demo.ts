import { z } from 'zod';
import { DiagnosticSchema, IdSchema, ScopeSchema, strict } from './common.js';
import { ReviewerContextSchema } from './review.js';
import { PreviewRequestSchema } from './runtime.js';

export const LocalSessionResponseSchema = strict({
  demoOnly: z.literal(true),
  reviewer: ReviewerContextSchema,
  allowedSourceRefs: z.array(IdSchema),
  allowedAccountIds: z.array(IdSchema),
  csrfToken: z.string().min(1),
});

export const DemoCandidatesResponseSchema = strict({
  mode: z.literal('development-fixture'),
  targetMode: z.enum(['empty-fixture', 'persisted-parent']),
  verificationAvailable: z.boolean(),
  candidates: z.array(strict({
    id: IdSchema, label: z.string(), companyId: IdSchema, sourceRef: IdSchema,
    scope: ScopeSchema, snapshotId: IdSchema, request: PreviewRequestSchema,
  })),
  diagnostics: z.array(DiagnosticSchema),
});

export type LocalSessionResponse = z.infer<typeof LocalSessionResponseSchema>;
export type DemoCandidatesResponse = z.infer<typeof DemoCandidatesResponseSchema>;
