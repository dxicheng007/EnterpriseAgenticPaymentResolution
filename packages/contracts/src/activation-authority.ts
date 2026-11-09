import { z } from 'zod';
import { BootstrapPinV1Schema } from './bootstrap-verification.js';
import { canonicalJson, hashCanonical } from './canonical.js';
import { HashSchema, HashSetSchema, IdSchema, IsoInstantSchema, ScopeSchema, setOf, strict, type Scope } from './common.js';
import { CustomerActivationSchema, SyncReceiptSchema } from './runtime.js';

export const EvidencePinV1Schema = strict({
  fixtureSetId: IdSchema, fixtureSetVersion: z.literal('2'), bundleHash: HashSchema,
});

export const CaptureAttestationV1Schema = strict({
  companyId: IdSchema, sourceRef: IdSchema, manifestId: IdSchema, manifestHash: HashSchema,
  snapshotId: IdSchema, snapshotHash: HashSchema, snapshotObjectHash: HashSchema, eventsHash: HashSchema,
}).refine(capture => capture.snapshotId === 'snapshot:' + capture.manifestId, {
  path: ['snapshotId'], message: 'Snapshot ID must match the manifest ID',
});

const issuerId = z.literal('eapr-control-registry-1');
const financialRunner = {
  runnerId: z.literal('eapr-financial-1'), protocolVersion: z.literal('1'), harnessVersion: z.literal('1'),
  evaluatorBuildHash: HashSchema, evidencePin: EvidencePinV1Schema,
};
const profileHashes = HashSetSchema.transform(hashes => hashes.sort());

export const FinancialReservationV1Schema = strict({
  schemaVersion: z.literal('1'), jobId: IdSchema, issuerId, ...financialRunner, purpose: z.literal('construction'),
  artifactHash: HashSchema,
  requiredProfileHashes: profileHashes.refine(hashes => hashes.length > 0, 'A reservation requires at least one profile'),
  capture: CaptureAttestationV1Schema, hash: HashSchema,
});

export const FinancialAttestationV1Schema = strict({
  schemaVersion: z.literal('1'), reservation: FinancialReservationV1Schema,
  reportId: IdSchema, reportHash: HashSchema, hash: HashSchema,
}).refine(attestation => attestation.reportId === 'report:' + attestation.reservation.jobId, {
  path: ['reportId'], message: 'Report ID must match the reservation job ID',
});

export const ActivationTrustPolicyEntryV1Schema = strict({
  issuerId, financial: strict(financialRunner), bootstrapPin: BootstrapPinV1Schema,
  capture: CaptureAttestationV1Schema, artifactHash: HashSchema, requiredProfileHashes: profileHashes,
  selectedProfileHash: HashSchema, scope: ScopeSchema,
}).refine(entry => entry.requiredProfileHashes.includes(entry.selectedProfileHash), {
  path: ['selectedProfileHash'], message: 'Selected profile must be included in required profile hashes',
}).refine(entry => entry.scope.companyId === entry.capture.companyId, {
  path: ['scope', 'companyId'], message: 'Scope company must match the capture company',
});

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const ActivationTrustPolicyV1Schema = strict({
  schemaVersion: z.literal('1'), policyId: IdSchema, hash: HashSchema,
  entries: setOf(ActivationTrustPolicyEntryV1Schema, canonicalJson).transform(entries => entries
    .map(entry => ({ entry, digest: hashCanonical(entry) }))
    .sort((a, b) => compare(a.digest, b.digest))
    .map(({ entry }) => entry)),
});

export const RegisteredScopeIndexEntryV1Schema = strict({
  accountId: IdSchema, scope: ScopeSchema, profileHash: HashSchema,
  manifestId: IdSchema, manifestHash: HashSchema, manifestAsOf: IsoInstantSchema,
}).refine(entry => entry.accountId === entry.scope.accountId, {
  path: ['accountId'], message: 'Account ID must match the scope account ID',
});

export const RegisteredScopeIndexV1Schema = strict({
  schemaVersion: z.literal('1'), hash: HashSchema,
  entries: setOf(RegisteredScopeIndexEntryV1Schema, entry => entry.accountId)
    .transform(entries => entries.sort((a, b) => compare(a.accountId, b.accountId))),
});

function sameScope(a: Scope, b: Scope): boolean {
  return a.companyId === b.companyId && a.sellerEntityId === b.sellerEntityId && a.accountId === b.accountId;
}

export const ActivationStateV1Schema = strict({
  schemaVersion: z.literal('1'), scope: ScopeSchema,
  activation: CustomerActivationSchema.nullable(), initialReceipt: SyncReceiptSchema.nullable(),
}).refine(({ scope, activation, initialReceipt }) => {
  if (activation === null || initialReceipt === null) return activation === null && initialReceipt === null;
  return sameScope(scope, activation.scope) && sameScope(scope, initialReceipt.scope)
    && initialReceipt.activationId === activation.id && initialReceipt.epoch === activation.epoch
    && initialReceipt.artifactHash === activation.artifactHash;
}, 'Activation and initial receipt must be paired and match the scope and activation identity');

export const ScopedReceiptQuerySchema = strict({
  scope: ScopeSchema, expectedRequestHash: HashSchema, expectedBundleHash: HashSchema,
});

export const ActivationAuthorityDiagnosticCodeSchema = z.enum([
  'FINANCIAL_ATTESTATION_UNAVAILABLE', 'FINANCIAL_ATTESTATION_MISMATCH', 'BOOTSTRAP_VERIFICATION_UNAVAILABLE',
  'BOOTSTRAP_VERIFICATION_MISMATCH', 'ACTIVATION_POLICY_UNAVAILABLE', 'ACTIVATION_POLICY_MISMATCH',
  'ACTIVATION_BUNDLE_MISMATCH', 'REVIEW_NOT_READY', 'REVIEW_STALE', 'TARGET_STALE', 'IDEMPOTENCY_CONFLICT',
  'ALREADY_ACTIVE', 'SOURCE_SEMANTICS_UNAVAILABLE', 'SOURCE_SEMANTICS_MISMATCH', 'SOURCE_SEMANTICS_UNSUPPORTED_ORDER',
]);

export type EvidencePinV1 = z.infer<typeof EvidencePinV1Schema>;
export type CaptureAttestationV1 = z.infer<typeof CaptureAttestationV1Schema>;
export type FinancialReservationV1 = z.infer<typeof FinancialReservationV1Schema>;
export type FinancialAttestationV1 = z.infer<typeof FinancialAttestationV1Schema>;
export type ActivationTrustPolicyEntryV1 = z.infer<typeof ActivationTrustPolicyEntryV1Schema>;
export type ActivationTrustPolicyV1 = z.infer<typeof ActivationTrustPolicyV1Schema>;
export type RegisteredScopeIndexEntryV1 = z.infer<typeof RegisteredScopeIndexEntryV1Schema>;
export type RegisteredScopeIndexV1 = z.infer<typeof RegisteredScopeIndexV1Schema>;
export type ActivationStateV1 = z.infer<typeof ActivationStateV1Schema>;
export type ScopedReceiptQuery = z.infer<typeof ScopedReceiptQuerySchema>;
export type ActivationAuthorityDiagnosticCode = z.infer<typeof ActivationAuthorityDiagnosticCodeSchema>;
