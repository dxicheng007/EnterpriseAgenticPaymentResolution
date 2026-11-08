import {
  canonicalJson, hashArtifact, hashPlan, hashProfile, targetRecordId,
  type BootstrapManifest, type CompiledArtifact, type CustomerProfile, type FieldLineage, type FinancialKind,
  type MappingOp, type PlanOutcome, type RawSourceEvent, type SourceSnapshot, type TargetState, type VerificationCheck,
} from '@eapr/contracts';
import type { EvidenceInputV1 } from './evidence-fixtures.js';
import type { FinancialRecord, ReferenceView } from './reference-model.js';
import { compareSubjectOutcome } from './subject-comparison.js';

export type CapturedEvidenceRun = {
  artifactHash: string;
  profileHash: string;
  events: RawSourceEvent[];
  target: TargetState;
  expected: ReferenceView;
  outcome: PlanOutcome | null;
};

type ContractFact = EvidenceInputV1['producer']['contracts'][number];
type IdentityFact = EvidenceInputV1['producer']['identities'][number];
type SupportedMapping = { resource: string; kind: FinancialKind; fields: Record<string, MappingOp> };

function equal(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

function equalIds(left: string[], right: string[]) {
  return new Set(left).size === left.length && new Set(right).size === right.length && equal([...left].sort(), [...right].sort());
}

function checkResult(status: VerificationCheck['status'], cases: number): VerificationCheck {
  return { id: 'evidence_support', status, cases, diagnosticCodes: [] };
}

function active(fact: ContractFact, instant: string) {
  const date = instant.slice(0, 10);
  return fact.validFrom <= date && (fact.validToExclusive === null || date < fact.validToExclusive);
}

function supportsFields(evidence: EvidenceInputV1, fact: ContractFact | IdentityFact, citations: string[]) {
  const available = evidence.resolvedSupport.filter(item => item.factId === fact.id);
  const covered = new Set(available.filter(item => citations.includes(item.evidenceId)).map(item => item.field));
  return citations.every(id => available.some(item => item.evidenceId === id)) &&
    fact.support.every(item => covered.has(item.field));
}

/** Terms may use reviewer IDs. Match the frozen independent account/contract/interval/value tuple. */
export function checkContractTerms(
  profile: CustomerProfile, facts: ContractFact[], evidence: EvidenceInputV1, asOf: string,
): boolean {
  const scoped = facts.filter(fact => fact.sellerEntityId === profile.scope.sellerEntityId &&
    profile.sourceAccountIds.includes(fact.sourceAccountId));
  const matched = new Set<string>();
  for (const term of profile.contractTerms) {
    const { id: _id, evidenceRefs, ...values } = term;
    const fact = scoped.find(({ id: _factId, sourceAccountId: _account, sellerEntityId: _seller, support: _support, ...expected }) =>
      equal(expected, values));
    if (!fact || matched.has(fact.id) || !supportsFields(evidence, fact, evidenceRefs)) return false;
    matched.add(fact.id);
  }
  const required = scoped.filter(fact => active(fact, asOf));
  return required.length > 0 && required.every(fact => matched.has(fact.id));
}

function identityMatches(profile: CustomerProfile, identity: IdentityFact, evidence: EvidenceInputV1, manifest: BootstrapManifest) {
  const account = [manifest.companyId, identity.sellerEntityId, identity.sourceAccountId].join('.');
  const binding = evidence.demoBindings.find(item => item.identityFactId === identity.id);
  const entries = profile.approvedLookups.filter(table => table.valueType === 'parent-account').flatMap(table => table.entries);
  const [entry] = entries;
  return profile.hash === hashProfile(profile) &&
    profile.sourceRef === manifest.sourceRef && profile.scope.companyId === manifest.companyId &&
    profile.scope.sellerEntityId === identity.sellerEntityId && profile.scope.accountId === account &&
    profile.parentCustomerId === identity.buyerId && profile.semanticVersion === manifest.semanticVersions[identity.sellerEntityId + '/' + identity.sourceAccountId] &&
    binding?.policy === 'generated-demo-buyer-account-v1' && binding.accountId === account &&
    binding.parentCustomerId === identity.buyerId && entries.length === 1 &&
    entry.source === identity.sourceAccountId && entry.target === account && supportsFields(evidence, identity, entry.evidenceRefs);
}

const kindToOperation = {
  invoice: 'insert_invoice', payment: 'insert_payment', credit: 'insert_credit', allocation: 'add_allocation', reversal: 'full_reverse',
} as const;
const bFields = {
  effective_date: 'posted_on', amount: 'amount_minor', due_date: 'due_on', funding_kind: 'receipt_type',
  funding_id: 'receipt_key', invoice_id: 'bill_key', reversed_kind: 'void_type', reversed_id: 'void_key',
} as const;

function expectedMappings(artifact: CompiledArtifact, manifest: BootstrapManifest): SupportedMapping[] | undefined {
  const company = manifest.companyId === 'company-a' && manifest.sourceRef === 'legacy-a' ? 'a' :
    manifest.companyId === 'company-b' && manifest.sourceRef === 'legacy-b' ? 'b' : undefined;
  const executable = artifact.normalizedPlan;
  if (!company || artifact.sourceRef !== manifest.sourceRef || executable.sourceRef !== manifest.sourceRef ||
    artifact.hash !== hashArtifact(artifact) || !equalIds(executable.mappings.map(mapping => mapping.kind), executable.allowedKinds)) return;

  const path = (field: keyof typeof bFields) => '/' + (company === 'a' ? field : bFields[field]);
  const field = (name: keyof typeof bFields): MappingOp => ({ op: 'field', path: path(name) });
  const kindLookup = (name: 'funding_kind' | 'reversed_kind'): MappingOp =>
    ({ op: 'enum_lookup', path: path(name), values: { payment: 'payment', credit: 'credit' } });
  const amountCents: MappingOp = company === 'a'
    ? { op: 'decimal_to_minor', path: path('amount'), scale: 2 }
    : field('amount');

  const mappings: SupportedMapping[] = [];
  for (const actual of executable.mappings) {
    const { kind } = actual;
    const currency = actual.fields.currency;
    if (currency.op !== 'constant' || currency.value !== 'USD') return;
    const resource = company + '-' + kind + 's';
    const contract = executable.sourceContracts.find(item => item.resource === resource);
    if (!contract || contract.kind !== kind || contract.schemaVersion !== manifest.schemaVersions[resource]) return;
    const fields: Record<string, MappingOp> = {
      currency: { op: 'constant', value: 'USD', evidenceRef: currency.evidenceRef },
      effectiveAt: { op: 'date_parse', path: path('effective_date'), format: 'YYYY-MM-DD', timezone: 'UTC' },
    };
    if (kind !== 'reversal') fields.amountCents = amountCents;
    switch (kind) {
      case 'invoice':
        fields.dueDate = field('due_date');
        break;
      case 'allocation':
        fields.fundingKind = kindLookup('funding_kind');
        fields.fundingRecordId = field('funding_id');
        fields.invoiceRecordId = { op: 'existing_invoice_lookup', path: path('invoice_id') };
        break;
      case 'reversal':
        fields.reversedKind = kindLookup('reversed_kind');
        fields.reversedRecordId = field('reversed_id');
        break;
    }
    const expected = { resource, kind, fields };
    if (!equal(expected, actual)) return;
    mappings.push(expected);
  }
  return mappings.length ? mappings : undefined;
}

function currencySupported(evidence: EvidenceInputV1, facts: ContractFact[], citationId: string, asOf: string) {
  return facts.some(fact => active(fact, asOf) && evidence.resolvedSupport.some(item =>
    item.factId === fact.id && item.field === 'currency' && item.evidenceId === citationId));
}

function expectedLineage(
  operationIndex: number, event: RawSourceEvent, record: FinancialRecord, profile: CustomerProfile, mapping: SupportedMapping,
): FieldLineage[] {
  const envelopeFields = [
    ['/id', ['/sourceRef', '/rawIdentity/sellerEntityId', '/kind', '/recordId'], true],
    ['/identity/sourceRef', ['/sourceRef'], false],
    ['/identity/sellerEntityId', ['/rawIdentity/sellerEntityId'], true],
    ['/identity/kind', ['/kind'], false],
    ['/identity/recordId', ['/recordId'], false],
    ['/scope/companyId', ['/rawIdentity/companyId'], true],
    ['/scope/sellerEntityId', ['/rawIdentity/sellerEntityId'], true],
    ['/scope/accountId', ['/rawIdentity/sourceAccountId'], true],
    ['/kind', ['/kind'], false],
    ['/sourceRecordVersion', ['/recordVersion'], false],
    ['/sourceEventId', ['/id'], false],
  ] as const;
  const derived: FieldLineage[] = envelopeFields.map(([targetField, sourcePaths, usesProfile]) => ({
    operationIndex, targetField, sourcePaths: [...sourcePaths], sourceEventIds: [event.id],
    mapping: null, evidenceRefs: [], derivationInputs: usesProfile ? [event.id, profile.id, profile.hash] : [event.id],
  }));
  const mapped = Object.entries(mapping.fields).map(([field, op]): FieldLineage => {
    const sourcePaths = 'path' in op ? [op.path] : [];
    if (field === 'effectiveAt') sourcePaths.push('/effectiveAt');
    const derivationInputs = op.op === 'existing_invoice_lookup' && record.kind === 'allocation'
      ? [targetRecordId({ ...record.identity, kind: 'invoice', recordId: record.invoiceRecordId })]
      : [];
    return {
      operationIndex, targetField: '/' + field, sourceEventIds: [event.id], sourcePaths,
      evidenceRefs: op.op === 'constant' ? [op.evidenceRef] : [], mapping: op, derivationInputs,
    };
  });
  return [...derived, ...mapped];
}

function lineageMatches(
  artifact: CompiledArtifact, profile: CustomerProfile, run: CapturedEvidenceRun, events: RawSourceEvent[],
  mappings: SupportedMapping[], evidence: EvidenceInputV1, terms: ContractFact[], asOf: string,
) {
  if (run.artifactHash !== artifact.hash || run.profileHash !== profile.hash || !run.outcome ||
    run.outcome.holds.length || run.outcome.plans.length !== 1 || run.target.asOf !== asOf || run.target.version !== 0 ||
    [run.target.invoices, run.target.payments, run.target.credits, run.target.allocations, run.target.reversals,
      run.target.customers, run.target.accounts, run.target.billingConfigurations].some(records => records.length)) return false;
  const captured = events.filter(event => event.rawIdentity.sellerEntityId === profile.scope.sellerEntityId &&
    profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId ?? ''));
  const byId = new Map(captured.map(event => [event.id, event]));
  if (!equalIds(run.events.map(event => event.id), captured.map(event => event.id)) ||
    run.events.some(event => !equal(byId.get(event.id), event))) return false;
  const [plan] = run.outcome.plans;
  if (plan.hash !== hashPlan(plan) || !compareSubjectOutcome(artifact, profile, run.target, run.expected, run.outcome).matches ||
    !equalIds(plan.eventIds, run.expected.records.map(record => record.sourceEventId))) return false;

  const expected = new Map(run.expected.records.map(record => [record.id, record]));
  const rows: FieldLineage[] = [];
  for (const [index, operation] of plan.operations.entries()) {
    if (operation.op === 'ensure_customer' || operation.op === 'ensure_account' || operation.op === 'ensure_billing_configuration') return false;
    const record = expected.get(operation.record.id);
    if (!record || kindToOperation[record.kind] !== operation.op) return false;
    const event = byId.get(record.sourceEventId);
    const mapping = event && mappings.find(item => item.resource === event.resource && item.kind === record.kind);
    if (!event || !mapping) return false;
    const currency = mapping.fields.currency;
    if (currency.op !== 'constant' || !currencySupported(evidence, terms, currency.evidenceRef, event.effectiveAt)) return false;
    rows.push(...expectedLineage(index, event, record, profile, mapping));
  }
  const key = (row: FieldLineage) => row.operationIndex + ':' + row.targetField;
  const ordered = (values: FieldLineage[]) => [...values].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  return equal(ordered(rows), ordered(plan.lineage));
}

/** Only the protected evaluator supplies validated v2 evidence and observed real baseline output. */
export function checkEvidenceSupport({
  artifact, profiles, manifest, snapshot, events, evidence, capturedRuns,
}: {
  artifact: CompiledArtifact; profiles: CustomerProfile[]; manifest: BootstrapManifest; snapshot: SourceSnapshot;
  events: RawSourceEvent[]; evidence: EvidenceInputV1 | undefined; capturedRuns: ReadonlyMap<string, CapturedEvidenceRun>;
}): VerificationCheck {
  if (!evidence || !profiles.length || profiles.some(profile => Object.hasOwn(profile, 'bootstrap'))) return checkResult('unavailable', 0);
  const mappings = artifact.normalizedPlan.mappings;
  if (mappings.some(mapping => 'amountCents' in mapping.fields && mapping.fields.amountCents.op === 'constant')) {
    return checkResult('failed', 1);
  }
  const unsupportedMapping = mappings.some(mapping => Object.entries(mapping.fields).some(([field, operation]) =>
    operation.op === 'approved_lookup' || operation.op === 'normalize_text' || operation.op === 'effective_term' ||
    (operation.op === 'constant' && field !== 'currency')));
  if (unsupportedMapping || profiles.some(profile => profile.findings.length ||
    profile.approvedLookups.some(table => table.valueType === 'text')) ||
    [...capturedRuns.values()].some(run => run.outcome?.plans.some(plan => plan.operations.some(operation => operation.op.startsWith('ensure_'))))) {
    return checkResult('unavailable', 0);
  }

  const { producer } = evidence;
  if (evidence.manifestId !== manifest.id || evidence.manifestHash !== manifest.hash ||
    evidence.snapshotId !== snapshot.id || evidence.snapshotHash !== snapshot.contentHash ||
    !equalIds(artifact.requiredProfileHashes, profiles.map(profile => profile.hash))) return checkResult('failed', 1);
  const contexts = profiles.map(profile => {
    const [account] = profile.sourceAccountIds;
    const scopeKnown = profile.sourceAccountIds.length === 1 &&
      Object.hasOwn(manifest.semanticVersions, producer.sellerEntityId + '/' + account);
    const identity = scopeKnown ? producer.identities.find(fact => fact.sourceAccountId === account) : undefined;
    const terms = identity ? producer.contracts.filter(fact => fact.sourceAccountId === identity.sourceAccountId &&
      fact.sellerEntityId === identity.sellerEntityId) : [];
    return { profile, scopeKnown, identity, terms, run: capturedRuns.get(profile.hash) };
  });
  if (contexts.some(({ scopeKnown, identity, terms }) =>
    scopeKnown && (!identity || !terms.some(term => active(term, manifest.asOf))))) return checkResult('unavailable', 0);
  const templates = expectedMappings(artifact, manifest);
  const assertions: boolean[] = [];
  let complete = true;
  for (const { profile, identity, terms, run } of contexts) {
    assertions.push(!!identity && identityMatches(profile, identity, evidence, manifest));
    if (!identity) continue;
    assertions.push(checkContractTerms(profile, terms, evidence, manifest.asOf));
    assertions.push(!!templates && templates.every(({ fields: { currency } }) =>
      currency.op === 'constant' && currencySupported(evidence, terms, currency.evidenceRef, manifest.asOf)));
    if (run && templates) assertions.push(lineageMatches(artifact, profile, run, events, templates, evidence, terms, manifest.asOf));
    else complete = false;
  }
  if (assertions.includes(false)) return checkResult('failed', assertions.length);
  return complete ? checkResult('passed', assertions.length) : checkResult('unavailable', 0);
}
