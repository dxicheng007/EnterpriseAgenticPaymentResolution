import type { ReviewDetailsV1 } from '../../contracts/src/review-details.js';

type Lineage = ReviewDetailsV1['proposedImport']['lineage'][number];
type Mapping = NonNullable<Lineage['mapping']>;

/** Plain-language meaning of the frozen v1 safety rules; keys outside the frozen set render as unexplained. */
const safetyRuleText: Record<string, string> = {
  'identity-bound-scope': 'Automatic sync stops for any record that does not belong to this approved company, seller and account.',
  'source-contract-bound': 'Automatic sync stops when a source no longer matches the contract that was reviewed.',
  'reviewed-semantic-version': 'Automatic sync stops if the reviewed meaning of the source fields changes.',
  'explicit-supported-finance': 'Only explicitly supported financial records are applied; other records are held, not guessed.',
  'target-version-bound': 'Automatic sync stops if the parent records changed since the version shown here.',
  'bounded-cycle': 'Automatic sync stops when a cycle exceeds the record or amount limits shown here.',
};

const validatorText: Record<string, string> = {
  allocation_limits: 'An allocation may not exceed its payment or the invoice it pays.',
  cycle_limits: 'A synchronization cycle may not exceed the record and amount limits.',
  economic_uniqueness: 'The same economic event is not applied twice.',
  effective_terms: 'Fees apply only within the approved contract term dates.',
  evidence_support: 'Each amount or term needs supporting evidence or a reproducible derivation.',
  explicit_allocation: 'Funds reduce an invoice only through an explicit allocation; unallocated funds do not.',
  full_reversal: 'Only a supported full reversal can undo a payment or credit and its allocations.',
  identity_scope: 'Records must match the approved company, seller and account.',
  safe_money: 'Amounts must be whole cents within safe integer bounds.',
  semantic_version: 'The reviewed semantic version must still match.',
  source_contract: 'The source must still match the reviewed contract.',
  target_version: 'The parent version must match the version the plan was built against.',
  usd_only: 'Only US dollar amounts are applied.',
};

export const explainSafetyRule = (id: string) => safetyRuleText[id] ?? 'No reviewed explanation is available for this rule.';
export const explainValidator = (id: string) => validatorText[id] ?? 'No reviewed explanation is available for this check.';

export function mappingLabel(mapping: Mapping | null): string {
  if (!mapping) return 'derived from the listed inputs';
  switch (mapping.op) {
    case 'constant': return 'fixed value supported by ' + mapping.evidenceRef;
    case 'effective_term': return 'contract ' + mapping.contractId + ' term effective on ' + mapping.datePath;
    case 'approved_lookup': return 'approved lookup ' + mapping.tableId + ' of ' + mapping.path;
    case 'decimal_to_minor': return 'decimal ' + mapping.path + ' converted to cents';
    case 'date_parse': return 'date ' + mapping.path + ' parsed as ' + mapping.format + ' (UTC)';
    case 'enum_lookup': return 'reviewed value mapping of ' + mapping.path;
    case 'existing_invoice_lookup': return 'existing invoice matched from ' + mapping.path;
    case 'normalize_text': return 'text ' + mapping.path + ' (' + mapping.mode + ')';
    case 'field': return 'copied from ' + mapping.path;
  }
}

export type OperationLineage = { operationIndex: number; fields: Lineage[] };

export function lineageByOperation(plan: ReviewDetailsV1['proposedImport']): OperationLineage[] {
  return plan.operations.map((_, operationIndex) => ({
    operationIndex, fields: plan.lineage.filter(item => item.operationIndex === operationIndex),
  }));
}

/** Evidence may only be opened when the pinned review details reference it. */
export function citationBinding(details: ReviewDetailsV1, evidenceId: string) {
  return details.evidence.referencedEvidenceIds.includes(evidenceId)
    ? { evidenceId, snapshotId: details.evidence.snapshotId } : undefined;
}
