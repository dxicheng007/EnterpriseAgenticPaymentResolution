import {
  CustomerProfileSchema, hashEvent, hashPlan, SourceEventSchema,
  type CompiledArtifact, type CustomerProfile, type FieldLineage, type Hold, type MutationOperation,
  type PlanOutcome, type ProfileBootstrap, type SourceEvent, type TargetState,
} from '@eapr/contracts';
import { sameScope } from '@eapr/finance/validate';
import { BootstrapProjectionError, projectBootstrapTarget } from '@eapr/parent/bootstrap';
import { ordered } from './canonicalize.js';
import { blocker } from './compile.js';
import { planBatch } from './plan-batch.js';

type MetadataOperation = Extract<MutationOperation, {
  op: 'ensure_customer' | 'ensure_account' | 'ensure_billing_configuration';
}>;
type MetadataEntry = { operation: MetadataOperation; evidenceRefs: string[]; derivationInputs: string[] };

const messages = {
  BOOTSTRAP_METADATA_UNAVAILABLE: 'Reviewed bootstrap metadata is unavailable or invalid',
  BOOTSTRAP_BASELINE_REQUIRED: 'Bootstrap requires a single baseline plan with new financial operations',
  BOOTSTRAP_BASELINE_BLOCKED: 'Financial validation or unresolved source holds block bootstrap',
  BOOTSTRAP_METADATA_CONFLICT: 'Existing target metadata differs from the reviewed bootstrap records',
};

function blocked(
  code: keyof typeof messages, holds: Hold[] = [], profile?: CustomerProfile,
): PlanOutcome {
  return {
    plans: [],
    holds: [...holds, {
      code, eventIds: [], dependencies: [], ...(profile ? { scope: profile.scope } : {}),
      diagnostics: [blocker(code, messages[code], profile ? [profile.id] : [])],
    }],
  };
}

const sortedSet = (ids: string[]) => [...new Set(ids)].sort();

function prepareMetadata(profile: CustomerProfile, bootstrap: ProfileBootstrap): MetadataEntry[] {
  const { id, scope, sourceRef, sourceAccountIds, parentCustomerId } = profile;
  const customer = { ...bootstrap.customer, evidenceRefs: [...bootstrap.customer.evidenceRefs].sort() };
  const accountEvidence = profile.approvedLookups.filter(lookup => lookup.valueType === 'parent-account')
    .flatMap(lookup => lookup.entries)
    .filter(entry => sourceAccountIds.includes(entry.source) && entry.target === scope.accountId)
    .flatMap(entry => entry.evidenceRefs);
  const terms = new Map(profile.contractTerms.map(term => [term.id, term]));
  return [
    { operation: { op: 'ensure_customer', record: customer }, evidenceRefs: customer.evidenceRefs, derivationInputs: [id] },
    {
      operation: { op: 'ensure_account', record: {
        id: scope.accountId, scope, parentCustomerId, sourceRef, sourceAccountIds: [...sourceAccountIds].sort(),
      } },
      evidenceRefs: sortedSet([...customer.evidenceRefs, ...accountEvidence]), derivationInputs: [id],
    },
    ...ordered(bootstrap.billingConfigurationIds, binding => binding.id).map((binding): MetadataEntry => {
      // The profile schema requires a one-to-one binding for every term.
      const term = terms.get(binding.termId)!;
      const evidenceRefs = [...term.evidenceRefs].sort();
      return {
        operation: { op: 'ensure_billing_configuration', record: {
          id: binding.id, scope, contractTerm: { ...term, evidenceRefs },
        } },
        evidenceRefs, derivationInputs: sortedSet([id, term.id]),
      };
    }),
  ];
}

/** @internal Walks metadata record leaves independently of the current record shapes. */
export function leafPointers(value: unknown, pointer = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) && value.length === 0) return [pointer];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPointers(child, pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1')),
  );
}

function metadataLineage(entries: MetadataEntry[]): FieldLineage[] {
  return entries.flatMap(({ operation, evidenceRefs, derivationInputs }, operationIndex) =>
    leafPointers(operation.record).sort().map(targetField => ({
      operationIndex, targetField, sourceEventIds: [], sourcePaths: [], mapping: null, evidenceRefs, derivationInputs,
    })),
  );
}

function isOutsideProfile(event: SourceEvent, profile: CustomerProfile): boolean {
  const { companyId, sellerEntityId, sourceAccountId } = event.rawIdentity;
  return !!sellerEntityId && !!sourceAccountId && (
    event.sourceRef !== profile.sourceRef || companyId !== profile.scope.companyId ||
    sellerEntityId !== profile.scope.sellerEntityId || !profile.sourceAccountIds.includes(sourceAccountId)
  );
}

function hasBlockingHolds(holds: Hold[], inputs: SourceEvent[], profile: CustomerProfile): boolean {
  if (!holds.length) return false;
  const routingCodes = ['IDENTITY_SCOPE', 'UNKNOWN_ACCOUNT'];
  if (holds.some(hold => !routingCodes.includes(hold.code) || !hold.eventIds.length ||
    (hold.scope && sameScope(hold.scope, profile.scope)))) return true;

  // Hold IDs do not carry sourceRef. Even identical repeated deliveries are ambiguous for this check.
  const byId = new Map<string, SourceEvent | null>();
  for (const input of inputs) {
    const parsed = SourceEventSchema.safeParse(input);
    if (!parsed.success) return true;
    const event = parsed.data;
    if (byId.has(event.id) || hashEvent(event) !== event.contentHash) byId.set(event.id, null);
    else byId.set(event.id, event);
  }
  return holds.some(hold => hold.eventIds.some(id => {
    const event = byId.get(id);
    return !event || !isOutsideProfile(event, profile);
  }));
}

/** Plans a scoped baseline and its reviewed metadata without changing parent state. */
export function planBootstrap(
  artifact: CompiledArtifact, profileInput: CustomerProfile, events: SourceEvent[], target: TargetState,
): PlanOutcome {
  const parsedProfile = CustomerProfileSchema.safeParse(profileInput);
  if (!parsedProfile.success && parsedProfile.error.issues.some(issue => issue.path[0] === 'bootstrap')) {
    return blocked('BOOTSTRAP_METADATA_UNAVAILABLE');
  }
  if (parsedProfile.success && !parsedProfile.data.bootstrap) {
    return blocked('BOOTSTRAP_METADATA_UNAVAILABLE', [], parsedProfile.data);
  }

  const profile = parsedProfile.success ? parsedProfile.data : undefined;
  let invalidTarget = false;
  try {
    projectBootstrapTarget(target, []);
  } catch (error) {
    if (!(error instanceof BootstrapProjectionError)) throw error;
    invalidTarget = true;
  }

  // Retain the financial planner's validation diagnostics, even if the bootstrap target failed preflight.
  const financial = planBatch(artifact, profileInput, events, target);
  if (invalidTarget || !profile?.bootstrap || hasBlockingHolds(financial.holds, events, profile)) {
    return blocked('BOOTSTRAP_BASELINE_BLOCKED', financial.holds, profile);
  }
  const [baseline] = financial.plans;
  if (financial.plans.length !== 1 || !baseline.operations.length) {
    return blocked('BOOTSTRAP_BASELINE_REQUIRED', financial.holds, profile);
  }
  if (!sameScope(baseline.scope, profile.scope) || baseline.artifactHash !== artifact.hash ||
    baseline.profileHash !== profile.hash || baseline.expectedTargetVersion !== target.version || baseline.asOf !== target.asOf) {
    return blocked('BOOTSTRAP_BASELINE_BLOCKED', financial.holds, profile);
  }

  const metadata = prepareMetadata(profile, profile.bootstrap);
  const operations = [...metadata.map(entry => entry.operation), ...baseline.operations];
  try {
    projectBootstrapTarget(target, operations);
  } catch (error) {
    if (!(error instanceof BootstrapProjectionError)) throw error;
    const code = error.code === 'metadata_conflict' ? 'BOOTSTRAP_METADATA_CONFLICT' : 'BOOTSTRAP_BASELINE_BLOCKED';
    return blocked(code, financial.holds, profile);
  }
  const lineage = [
    ...metadataLineage(metadata),
    ...baseline.lineage.map(row => ({ ...row, operationIndex: row.operationIndex + metadata.length })),
  ];
  const plan = { ...baseline, operations, lineage };
  return { plans: [{ ...plan, hash: hashPlan(plan) }], holds: financial.holds };
}
