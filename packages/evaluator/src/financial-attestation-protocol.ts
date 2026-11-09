import { z } from 'zod';
import {
  BootstrapManifestSchema, CaptureAttestationV1Schema, CompiledArtifactSchema, CustomerProfileSchema,
  EvidencePinV1Schema, FinancialReservationV1Schema, HashSchema, IdSchema, RawSourceEventSchema,
  SourceSnapshotSchema, VerificationReportSchema, guardKeys, strict,
} from '@eapr/contracts';

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const FinancialCaptureV1Schema = strict({
  artifact: CompiledArtifactSchema, manifest: BootstrapManifestSchema, snapshot: SourceSnapshotSchema,
  profiles: CustomerProfileSchema.array().min(1).transform(items => items.sort((a, b) => compare(a.hash, b.hash))),
  events: RawSourceEventSchema.array().transform(items => items.sort((a, b) => compare(a.id, b.id))),
});

export const FinancialFixtureSelectionV1Schema = strict({
  fixtureSetId: IdSchema, fixtureSetVersion: z.literal('2'), purpose: z.literal('construction'), snapshotHash: HashSchema,
});

export const FinancialProbeInputV1Schema = strict({
  protocolVersion: z.literal('financial-attestation-probe-1'), jobId: IdSchema,
  capture: FinancialCaptureV1Schema, selection: FinancialFixtureSelectionV1Schema, evaluatorBuildHash: HashSchema,
});
export const FinancialEvaluatorInputV1Schema = strict({
  protocolVersion: z.literal('financial-attestation-1'), jobId: IdSchema,
  reservation: FinancialReservationV1Schema, capture: FinancialCaptureV1Schema,
});
const response = {
  jobId: IdSchema, requestHash: HashSchema, evidencePin: EvidencePinV1Schema,
  capture: CaptureAttestationV1Schema, evaluatorBuildHash: HashSchema,
};
export const FinancialProbeResultV1Schema = strict({
  protocolVersion: z.literal('financial-attestation-probe-result-1'), ...response,
});
export const FinancialEvaluatorCompletionV1Schema = strict({
  protocolVersion: z.literal('financial-attestation-completion-1'), ...response,
  reservationHash: HashSchema, report: VerificationReportSchema,
});
export const FinancialRequestSchema = guardKeys(z.union([FinancialProbeInputV1Schema, FinancialEvaluatorInputV1Schema]));
export const FinancialResponseSchema = guardKeys(z.union([FinancialProbeResultV1Schema, FinancialEvaluatorCompletionV1Schema]));
export const FinancialRootsSchema = strict({
  evidencePinRoot: z.string().min(1), servedRoots: z.string().min(1).array(),
});
export const FinancialContextSchema = strict({
  protocolVersion: z.literal('financial-attestation-context-1'), requestHash: HashSchema, roots: FinancialRootsSchema,
});

export type FinancialCaptureV1 = z.infer<typeof FinancialCaptureV1Schema>;
export type FinancialFixtureSelectionV1 = z.infer<typeof FinancialFixtureSelectionV1Schema>;
export type FinancialProbeInputV1 = z.infer<typeof FinancialProbeInputV1Schema>;
export type FinancialProbeResultV1 = z.infer<typeof FinancialProbeResultV1Schema>;
export type FinancialEvaluatorInputV1 = z.infer<typeof FinancialEvaluatorInputV1Schema>;
export type FinancialEvaluatorCompletionV1 = z.infer<typeof FinancialEvaluatorCompletionV1Schema>;
export type FinancialRequest = z.infer<typeof FinancialRequestSchema>;
export type FinancialContext = z.infer<typeof FinancialContextSchema>;
export type FinancialCaptureReader = {
  readCapture(input: { artifactHash: string; manifestId: string }): Promise<FinancialCaptureV1>;
};
export type FinancialAttestationLauncher = {
  probe(input: FinancialProbeInputV1): Promise<FinancialProbeResultV1>;
  launch(input: FinancialEvaluatorInputV1): Promise<FinancialEvaluatorCompletionV1>;
};
