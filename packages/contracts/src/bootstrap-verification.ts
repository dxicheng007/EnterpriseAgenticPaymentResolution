import { z } from 'zod';
import {
  HashSchema, HashSetSchema, IdSchema, IsoInstantSchema, NonnegativeIntegerSchema,
  ScopeSchema, setOf, strict,
} from './common.js';

export const bootstrapRequiredAssertions = Object.freeze([
  'capture_binding', 'identity_name_support', 'term_configuration_support', 'scoped_metadata_records',
  'ensure_equivalence_conflict', 'metadata_lineage', 'financial_suffix', 'operation_order_hash', 'baseline_blockers',
] as const);
export const bootstrapRequiredCases = Object.freeze([
  'captured_baseline', 'exact_metadata_reuse', 'customer_conflict', 'account_conflict',
  'configuration_conflict', 'empty_events', 'financial_replay', 'selected_blocker',
  'source_wide_blocker', 'unrelated_account_hold',
] as const);

export const BootstrapAssertionIdSchema = z.enum(bootstrapRequiredAssertions);
export const BootstrapCaseIdSchema = z.enum(bootstrapRequiredCases);
export type BootstrapAssertionId = z.infer<typeof BootstrapAssertionIdSchema>;
export type BootstrapCaseId = z.infer<typeof BootstrapCaseIdSchema>;

const metadataCases = Object.freeze(['captured_baseline', 'exact_metadata_reuse'] as const);
export const bootstrapAssertionCases: Readonly<Record<BootstrapAssertionId, readonly BootstrapCaseId[]>> = Object.freeze({
  capture_binding: Object.freeze(['captured_baseline'] as const),
  identity_name_support: metadataCases,
  term_configuration_support: metadataCases,
  scoped_metadata_records: metadataCases,
  ensure_equivalence_conflict: Object.freeze([
    'exact_metadata_reuse', 'customer_conflict', 'account_conflict', 'configuration_conflict',
  ] as const),
  metadata_lineage: metadataCases,
  financial_suffix: metadataCases,
  operation_order_hash: metadataCases,
  baseline_blockers: Object.freeze([
    'empty_events', 'financial_replay', 'selected_blocker', 'source_wide_blocker', 'unrelated_account_hold',
  ] as const),
});

export const BootstrapPinV1Schema = strict({
  runnerId: z.literal('eapr-bootstrap-1'), protocolVersion: z.literal('1'),
  evaluatorBuildHash: HashSchema, subjectBuildHash: HashSchema,
  fixtureSetId: IdSchema, fixtureSetVersion: IdSchema, fixtureHash: HashSchema,
});

// Consumers check these pins against trusted inputs. The wire shape contains only the digests.
export const BootstrapBindingV1Schema = strict({
  artifactHash: HashSchema, profileHash: HashSchema,
  requiredProfileHashes: HashSetSchema.transform(hashes => hashes.sort()),
  scope: ScopeSchema, manifestId: IdSchema, manifestHash: HashSchema,
  snapshotId: IdSchema,
  // SourceSnapshot.contentHash. Registry storage separately pins the whole-object digest.
  snapshotHash: HashSchema,
  // Canonical hash of the complete duplicate-free captured events sorted by event.id.
  eventsHash: HashSchema,
  // hashTargetSnapshot of the exact planner target, including its cutover asOf.
  targetSnapshotHash: HashSchema, expectedTargetVersion: NonnegativeIntegerSchema,
  // Consumers check equality with manifest.asOf.
  asOf: IsoInstantSchema,
}).refine(binding => binding.requiredProfileHashes.includes(binding.profileHash), {
  path: ['profileHash'], message: 'Selected profile must be included in required profile hashes',
});

const statusSchema = z.enum(['passed', 'failed', 'unavailable']);
const assertionSchema = strict({
  id: BootstrapAssertionIdSchema, status: statusSchema,
  caseIds: setOf(BootstrapCaseIdSchema, id => id).transform(ids =>
    ids.sort((a, b) => bootstrapRequiredCases.indexOf(a) - bootstrapRequiredCases.indexOf(b))),
});
const caseSchema = strict({ id: BootstrapCaseIdSchema, status: statusSchema });

export const BootstrapVerificationResultV1Schema = strict({
  schemaVersion: z.literal('1'), id: IdSchema, jobId: IdSchema,
  pin: BootstrapPinV1Schema, binding: BootstrapBindingV1Schema, planHash: HashSchema.nullable(),
  assertions: setOf(assertionSchema, assertion => assertion.id)
    .refine(items => items.length === bootstrapRequiredAssertions.length, 'Incomplete assertion coverage'),
  cases: setOf(caseSchema, item => item.id)
    .refine(items => items.length === bootstrapRequiredCases.length, 'Incomplete case coverage'),
  passed: z.boolean(), createdAt: IsoInstantSchema, hash: HashSchema,
}).superRefine((result, ctx) => {
  if (result.id !== 'bootstrap-result:' + result.jobId) {
    ctx.addIssue({ code: 'custom', path: ['id'], message: 'Result ID must match the job ID' });
  }

  const caseStatuses = new Map(result.cases.map(item => [item.id, item.status]));
  for (const [index, assertion] of result.assertions.entries()) {
    const required = bootstrapAssertionCases[assertion.id];
    const inMatrix = assertion.caseIds.every(id => required.includes(id));
    const validCoverage = assertion.status === 'unavailable'
      ? assertion.caseIds.length === 0
      : inMatrix && (assertion.status === 'passed'
        ? assertion.caseIds.length === required.length && assertion.caseIds.every(id => caseStatuses.get(id) === 'passed')
        : assertion.caseIds.length > 0 && assertion.caseIds.every(id => {
          const status = caseStatuses.get(id);
          return status === 'passed' || status === 'failed';
        }));
    if (!validCoverage) {
      ctx.addIssue({ code: 'custom', path: ['assertions', index, 'caseIds'], message: 'Invalid case coverage for assertion status' });
    }
  }

  if (result.planHash === null && caseStatuses.get('captured_baseline') === 'passed') {
    ctx.addIssue({ code: 'custom', path: ['planHash'], message: 'Passing baseline requires a plan hash' });
  }
  const passed = result.planHash !== null && result.assertions.every(item => item.status === 'passed')
    && result.cases.every(item => item.status === 'passed');
  if (result.passed !== passed) {
    ctx.addIssue({ code: 'custom', path: ['passed'], message: 'Overall result disagrees with the plan and coverage statuses' });
  }
}).transform(result => ({
  ...result,
  assertions: result.assertions.sort((a, b) => bootstrapRequiredAssertions.indexOf(a.id) - bootstrapRequiredAssertions.indexOf(b.id)),
  cases: result.cases.sort((a, b) => bootstrapRequiredCases.indexOf(a.id) - bootstrapRequiredCases.indexOf(b.id)),
}));

export type BootstrapPinV1 = z.infer<typeof BootstrapPinV1Schema>;
export type BootstrapBindingV1 = z.infer<typeof BootstrapBindingV1Schema>;
export type BootstrapVerificationResultV1 = z.infer<typeof BootstrapVerificationResultV1Schema>;
