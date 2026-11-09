import { z } from 'zod';
import { FinancialAttestationV1Schema } from './activation-authority.js';
import { BootstrapVerificationResultV1Schema } from './bootstrap-verification.js';
import { hashCanonical } from './canonical.js';
import { HashSchema, IdSchema, setOf, strict, type Hash } from './common.js';
import { CompiledArtifactSchema, CustomerProfileSchema, type CustomerProfile } from './connector.js';
import { BootstrapManifestSchema } from './evidence.js';
import {
  ActivationRequestSchema, ReviewPackageSchema, ReviewerContextSchema, SemanticPreflightSchema, VerificationReportSchema,
} from './review.js';
import { MutationPlanSchema } from './runtime.js';
import { RawSourceEventSchema, SourceSnapshotSchema } from './source.js';

export const ActivationBundleV2Schema = strict({
  schemaVersion: z.literal('2'), hash: HashSchema, request: ActivationRequestSchema, reviewer: ReviewerContextSchema,
  reviewPackage: ReviewPackageSchema, artifact: CompiledArtifactSchema,
  profiles: setOf(CustomerProfileSchema, profile => profile.id), manifest: BootstrapManifestSchema,
  verificationReport: VerificationReportSchema, snapshot: SourceSnapshotSchema,
  bootstrapEvents: z.array(RawSourceEventSchema), previewPlan: MutationPlanSchema, semanticPreflight: SemanticPreflightSchema,
  bootstrapVerification: BootstrapVerificationResultV1Schema, financialAttestation: FinancialAttestationV1Schema,
  authorityPolicy: strict({ issuerId: z.literal('eapr-control-registry-1'), policyId: IdSchema, policyHash: HashSchema }),
});
export type ActivationBundleV2 = z.infer<typeof ActivationBundleV2Schema>;

function sortedBy<T>(items: T[], key: (item: T) => string): T[] {
  return items.sort((a, b) => {
    const first = key(a);
    const second = key(b);
    return first < second ? -1 : first > second ? 1 : 0;
  });
}

function canonicalProfile({ bootstrap, ...profile }: CustomerProfile) {
  return {
    ...profile,
    ...(bootstrap === undefined ? {} : {
      bootstrap: {
        customer: { ...bootstrap.customer, evidenceRefs: bootstrap.customer.evidenceRefs.sort() },
        billingConfigurationIds: sortedBy(bootstrap.billingConfigurationIds, binding => binding.termId),
      },
    }),
    sourceAccountIds: profile.sourceAccountIds.sort(),
    approvedLookups: sortedBy(profile.approvedLookups, lookup => lookup.id).map(lookup => ({
      ...lookup,
      entries: sortedBy(lookup.entries, entry => entry.source).map(entry => ({ ...entry, evidenceRefs: entry.evidenceRefs.sort() })),
    })),
    contractTerms: sortedBy(profile.contractTerms, term => term.id).map(term => ({ ...term, evidenceRefs: term.evidenceRefs.sort() })),
    findings: sortedBy(profile.findings, finding => finding.id).map(finding => ({ ...finding, evidenceRefs: finding.evidenceRefs.sort() })),
  };
}

const placeholderHash = '0'.repeat(64);

export function hashBundleV2(input: Omit<ActivationBundleV2, 'hash'> & { hash?: Hash }): Hash {
  const { hash: _hash, ...bundle } = ActivationBundleV2Schema.parse(
    Object.hasOwn(input, 'hash') ? input : { ...input, hash: placeholderHash },
  );
  const { artifact, manifest, verificationReport } = bundle;
  const { normalizedPlan } = artifact;
  const { coverage } = verificationReport;
  // Preserve the v1 ordering rules for inherited members. Parsing has already checked set uniqueness.
  return hashCanonical({
    ...bundle,
    profiles: sortedBy(bundle.profiles, profile => profile.id).map(canonicalProfile),
    manifest: {
      ...manifest, streams: sortedBy(manifest.streams, stream => stream.streamId), files: sortedBy(manifest.files, file => file.fileId),
    },
    artifact: {
      ...artifact,
      normalizedPlan: {
        ...normalizedPlan,
        sourceContracts: sortedBy(normalizedPlan.sourceContracts, contract => contract.resource),
        capture: sortedBy(normalizedPlan.capture, stream => stream.streamId).map(stream => ({ ...stream, resources: stream.resources.sort() })),
        mappings: sortedBy(normalizedPlan.mappings, mapping => mapping.resource),
        allowedKinds: normalizedPlan.allowedKinds.sort(),
        validators: normalizedPlan.validators.sort(),
      },
      sourceContractHashes: sortedBy(artifact.sourceContractHashes, entry => entry.resource),
      requiredProfileHashes: artifact.requiredProfileHashes.sort(),
    },
    verificationReport: {
      ...verificationReport,
      profileHashes: verificationReport.profileHashes.sort(),
      checks: sortedBy(verificationReport.checks, check => check.id),
      coverage: {
        ...coverage,
        profileHashes: coverage.profileHashes.sort(),
        required: coverage.required.sort(),
        executed: coverage.executed.sort(),
        sourceRefs: coverage.sourceRefs.sort(),
        eventKinds: coverage.eventKinds.sort(),
      },
    },
  });
}
