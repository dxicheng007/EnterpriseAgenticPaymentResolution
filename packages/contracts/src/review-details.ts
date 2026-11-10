import { z } from 'zod';
import { FinancialKindSchema, HashSchema, IdSchema, IdSetSchema, ScopeSchema, VersionSchema, setOf, strict } from './common.js';
import {
  ApprovedLookupSchema, ContractTermSchema, ProfileBootstrapSchema, ValidatorIdSchema,
} from './connector.js';
import { ReviewPackageSchema } from './review.js';
import { MutationPlanSchema, ParentViewSchema, type MutationPlan } from './runtime.js';

export const reviewSafetyRulesV1 = [
  'identity-bound-scope', 'source-contract-bound', 'reviewed-semantic-version',
  'explicit-supported-finance', 'target-version-bound', 'bounded-cycle',
] as const;

// This catalog describes the frozen v1 rules even if a later compiler adds validators.
const validatorsV1 = new Set([
  'allocation_limits', 'cycle_limits', 'economic_uniqueness', 'effective_terms', 'evidence_support',
  'explicit_allocation', 'full_reversal', 'identity_scope', 'safe_money', 'semantic_version',
  'source_contract', 'target_version', 'usd_only',
] satisfies (typeof ValidatorIdSchema.options)[number][]);

const byKey = <T>(items: T[], key: (item: T) => string) => items.sort((a, b) => {
  const left = key(a);
  const right = key(b);
  return left < right ? -1 : left > right ? 1 : 0;
});
const sortedIds = IdSetSchema.transform(ids => ids.sort());
const profileSchema = strict({
  id: IdSchema, version: VersionSchema, hash: HashSchema, sourceRef: IdSchema, scope: ScopeSchema,
  parentCustomerId: IdSchema, sourceAccountIds: sortedIds,
  approvedLookups: setOf(ApprovedLookupSchema, lookup => lookup.id).transform(lookups => byKey(lookups, lookup => lookup.id)
    .map(lookup => ({
      ...lookup,
      entries: byKey(lookup.entries, entry => entry.source).map(entry => ({ ...entry, evidenceRefs: entry.evidenceRefs.sort() })),
    }))),
  contractTerms: setOf(ContractTermSchema, term => term.id).transform(terms => byKey(terms, term => term.id)
    .map(term => ({ ...term, evidenceRefs: term.evidenceRefs.sort() }))),
  semanticVersion: IdSchema,
  bootstrap: ProfileBootstrapSchema.transform(bootstrap => ({
    customer: { ...bootstrap.customer, evidenceRefs: bootstrap.customer.evidenceRefs.sort() },
    billingConfigurationIds: byKey(bootstrap.billingConfigurationIds, binding => binding.termId),
  })),
}).refine(({ bootstrap, parentCustomerId, contractTerms }) => {
  const termIds = new Set(contractTerms.map(term => term.id));
  return bootstrap.customer.id === parentCustomerId && bootstrap.billingConfigurationIds.length === termIds.size &&
    bootstrap.billingConfigurationIds.every(binding => termIds.has(binding.termId));
}, { path: ['bootstrap'], message: 'Bootstrap bindings must match the customer and profile terms' });

export function reviewEvidenceIds(profile: z.infer<typeof profileSchema>, plan: MutationPlan): string[] {
  return [...new Set([
    ...profile.bootstrap.customer.evidenceRefs,
    ...profile.contractTerms.flatMap(term => term.evidenceRefs),
    ...profile.approvedLookups.flatMap(lookup => lookup.entries.flatMap(entry => entry.evidenceRefs)),
    ...plan.lineage.flatMap(({ evidenceRefs, mapping }) =>
      mapping?.op === 'constant' ? [...evidenceRefs, mapping.evidenceRef] : evidenceRefs),
  ])].sort();
}

const sameScope = (a: z.infer<typeof ScopeSchema>, b: z.infer<typeof ScopeSchema>) =>
  a.companyId === b.companyId && a.sellerEntityId === b.sellerEntityId && a.accountId === b.accountId;

export const ReviewDetailsV1Schema = strict({
  schemaVersion: z.literal('1'),
  reviewPackage: ReviewPackageSchema,
  sourceRef: IdSchema,
  capture: strict({ manifestId: IdSchema, manifestHash: HashSchema, snapshotId: IdSchema, snapshotHash: HashSchema }),
  artifact: strict({
    id: IdSchema, hash: HashSchema, specHash: HashSchema,
    compilerVersion: z.literal('1'), runtimeVersion: z.literal('1'), targetSchemaVersion: z.literal('1'),
  }),
  profile: profileSchema,
  baseline: ParentViewSchema,
  proposedImport: MutationPlanSchema,
  futureScope: strict({
    allowedKinds: setOf(FinancialKindSchema, kind => kind).transform(kinds => kinds.sort()),
    limits: strict({ maxTransactionCents: z.literal(5000000), maxRecordsPerCycle: z.literal(1000) }),
    validators: setOf(ValidatorIdSchema, id => id)
      .refine(ids => ids.length === validatorsV1.size && ids.every(id => validatorsV1.has(id)), 'Invalid frozen validator set')
      .transform(ids => ids.sort()),
    runtimeModelCalls: z.literal('forbidden'),
    safetyRulesVersion: z.literal('frozen-v1'),
    safetyRules: z.tuple([
      z.literal(reviewSafetyRulesV1[0]), z.literal(reviewSafetyRulesV1[1]), z.literal(reviewSafetyRulesV1[2]),
      z.literal(reviewSafetyRulesV1[3]), z.literal(reviewSafetyRulesV1[4]), z.literal(reviewSafetyRulesV1[5]),
    ]),
  }),
  evidence: strict({ snapshotId: IdSchema, referencedEvidenceIds: sortedIds }),
  parentWrites: z.literal(0),
}).superRefine(({ reviewPackage: review, sourceRef, capture, artifact, profile, baseline, proposedImport: plan, evidence }, ctx) => {
  if (profile.sourceRef !== sourceRef || ![profile.scope, baseline.scope, plan.scope].every(scope => sameScope(scope, review.scope))) {
    ctx.addIssue({ code: 'custom', message: 'Review detail scope bindings differ' });
  }
  if (capture.snapshotId !== 'snapshot:' + capture.manifestId || evidence.snapshotId !== capture.snapshotId ||
      capture.manifestHash !== review.manifestHash || artifact.hash !== review.artifactHash ||
      profile.hash !== review.profileHash || plan.artifactHash !== artifact.hash || plan.profileHash !== profile.hash ||
      plan.hash !== review.previewPlanHash) {
    ctx.addIssue({ code: 'custom', message: 'Review detail content bindings differ' });
  }
  if (baseline.version !== review.expectedTargetVersion || plan.expectedTargetVersion !== review.expectedTargetVersion ||
      baseline.asOf !== plan.asOf || plan.lineage.some(item => item.operationIndex >= plan.operations.length)) {
    ctx.addIssue({ code: 'custom', message: 'Review detail plan bindings differ' });
  }
  const refs = reviewEvidenceIds(profile, plan);
  if (refs.length !== evidence.referencedEvidenceIds.length || refs.some((ref, i) => ref !== evidence.referencedEvidenceIds[i])) {
    ctx.addIssue({ code: 'custom', message: 'Review detail evidence references differ' });
  }
});

export type ReviewDetailsV1 = z.infer<typeof ReviewDetailsV1Schema>;
