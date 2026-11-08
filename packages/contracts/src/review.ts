import { z } from 'zod';
import {
  DiagnosticSchema, FinancialKindSchema, HashSchema, HashSetSchema, IdSchema, IsoInstantSchema,
  NonnegativeIntegerSchema, ScopeSchema, SemanticVersionMapSchema, VersionSchema, setOf, strict,
} from './common.js';
import { CompiledArtifactSchema, CustomerProfileSchema } from './connector.js';
import { BootstrapManifestSchema } from './evidence.js';
import { MutationPlanSchema } from './runtime.js';
import { RawSourceEventSchema, SourceSnapshotSchema } from './source.js';

export const VerificationCheckIdSchema = z.enum([
  'baseline_reconcile', 'new_record', 'duplicate_delivery', 'retry_restart', 'invalid_money', 'allocation_scope',
  'full_reversal', 'dependency_order', 'schema_drift', 'semantic_drift', 'unknown_identity', 'snapshot_boundary', 'evidence_support',
]);
const checkStatus = z.enum(['passed', 'failed', 'unavailable']);
const summaryCheck = { id: VerificationCheckIdSchema, status: checkStatus, diagnosticCodes: z.array(z.string()) };
export const VerificationCheckSchema = strict({ ...summaryCheck, cases: NonnegativeIntegerSchema });
const checkIds = setOf(VerificationCheckIdSchema, id => id);
export const VerificationReportSchema = strict({
  id: IdSchema, artifactHash: HashSchema, profileHashes: HashSetSchema, manifestHash: HashSchema,
  harnessVersion: z.literal('1'), evaluatorBuildHash: HashSchema, fixtureSetId: IdSchema, fixtureSetVersion: IdSchema,
  checks: setOf(VerificationCheckSchema, check => check.id),
  coverage: strict({
    required: checkIds, executed: checkIds, sourceRefs: setOf(IdSchema, id => id),
    profileHashes: HashSetSchema, eventKinds: setOf(FinancialKindSchema, kind => kind),
  }),
  unexplainedDifferenceCents: NonnegativeIntegerSchema, eligible: z.boolean(), createdAt: IsoInstantSchema,
});
export const VerifyRequestSchema = strict({ artifactHash: HashSchema, profileHashes: HashSetSchema, manifestId: IdSchema });
export const VerificationSummarySchema = strict({
  reportId: IdSchema, artifactHash: HashSchema, profileHashes: HashSetSchema, manifestHash: HashSchema,
  eligible: z.boolean(), checks: setOf(strict(summaryCheck), check => check.id), coverageComplete: z.boolean(),
});
export const VerificationJobSchema = strict({
  jobId: IdSchema, state: z.enum(['queued', 'running', 'completed', 'failed']),
  summary: VerificationSummarySchema.optional(), diagnostics: z.array(DiagnosticSchema),
});
export const ReviewPackageSchema = strict({
  id: IdSchema, revision: VersionSchema, hash: HashSchema, scope: ScopeSchema, artifactHash: HashSchema,
  profileHash: HashSchema, manifestHash: HashSchema, verificationReportId: IdSchema, previewPlanHash: HashSchema,
  expectedTargetVersion: NonnegativeIntegerSchema, diagnostics: z.array(DiagnosticSchema), ready: z.boolean(),
});
export const ActivationRequestSchema = strict({
  reviewPackageId: IdSchema, expectedPackageHash: HashSchema, expectedArtifactHash: HashSchema,
  expectedProfileHash: HashSchema, expectedTargetVersion: NonnegativeIntegerSchema, idempotencyKey: IdSchema,
});
export const ReviewerContextSchema = strict({ reviewerId: IdSchema, sessionId: IdSchema });
export const SemanticPreflightSchema = strict({ sourceRef: IdSchema, checkedAt: IsoInstantSchema, versions: SemanticVersionMapSchema });
export const ActivationBundleSchema = strict({
  schemaVersion: z.literal('1'), hash: HashSchema, request: ActivationRequestSchema, reviewer: ReviewerContextSchema,
  reviewPackage: ReviewPackageSchema, artifact: CompiledArtifactSchema,
  profiles: setOf(CustomerProfileSchema, profile => profile.id), manifest: BootstrapManifestSchema,
  verificationReport: VerificationReportSchema, snapshot: SourceSnapshotSchema,
  bootstrapEvents: z.array(RawSourceEventSchema), previewPlan: MutationPlanSchema, semanticPreflight: SemanticPreflightSchema,
});
export const InternalActivationRequestSchema = strict({ bundleHash: HashSchema, idempotencyKey: IdSchema });
export type VerificationCheckId = z.infer<typeof VerificationCheckIdSchema>;
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;
export type VerificationReport = z.infer<typeof VerificationReportSchema>;
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;
export type VerificationSummary = z.infer<typeof VerificationSummarySchema>;
export type VerificationJob = z.infer<typeof VerificationJobSchema>;
export type ReviewPackage = z.infer<typeof ReviewPackageSchema>;
export type ActivationRequest = z.infer<typeof ActivationRequestSchema>;
export type ReviewerContext = z.infer<typeof ReviewerContextSchema>;
export type SemanticPreflight = z.infer<typeof SemanticPreflightSchema>;
export type ActivationBundle = z.infer<typeof ActivationBundleSchema>;
export type InternalActivationRequest = z.infer<typeof InternalActivationRequestSchema>;
