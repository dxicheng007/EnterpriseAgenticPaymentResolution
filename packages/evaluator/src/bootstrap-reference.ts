import {
  MutationPlanSchema, TargetStateSchema, canonicalJson, hashPlan, targetRecordId,
  type CustomerProfile, type FieldLineage, type FinancialKind, type MappingOp, type MutationOperation,
  type RawSourceEvent, type TargetState,
} from '@eapr/contracts';
import {
  compareBootstrapKeys as compare, resolveBootstrapSubject, type BootstrapSourceFacts, type ValidatedBootstrapExpectation,
} from './bootstrap-fixtures.js';
import { bindTruth } from './fixtures.js';
import type { FinancialRecord } from './reference-model.js';

export function bootstrapLeafPointers(value: unknown): string[] {
  const pointers: string[] = [];
  function visit(node: unknown, path: string) {
    if (node === null || typeof node !== 'object' || (Array.isArray(node) && !node.length)) {
      pointers.push(path);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'));
    }
  }
  visit(value, '');
  return pointers.sort(compare);
}

type Metadata = Extract<MutationOperation, { op: 'ensure_customer' | 'ensure_account' | 'ensure_billing_configuration' }>;

const bPaths = {
  effective_date: 'posted_on', amount: 'amount_minor', due_date: 'due_on',
  funding_kind: 'receipt_type', funding_id: 'receipt_key', invoice_id: 'bill_key',
  reversed_kind: 'void_type', reversed_id: 'void_key',
} as const;

function mappingFields(company: 'a' | 'b', kind: FinancialKind, currencyRef: string) {
  const path = (field: keyof typeof bPaths) => '/' + (company === 'a' ? field : bPaths[field]);
  const field = (key: keyof typeof bPaths): MappingOp => ({ op: 'field', path: path(key) });
  const funding = (key: 'funding_kind' | 'reversed_kind'): MappingOp =>
    ({ op: 'enum_lookup', path: path(key), values: { payment: 'payment', credit: 'credit' } });
  const fields: Record<string, MappingOp> = {
    currency: { op: 'constant', value: 'USD', evidenceRef: currencyRef },
    effectiveAt: { op: 'date_parse', path: path('effective_date'), format: 'YYYY-MM-DD', timezone: 'UTC' },
  };
  if (kind !== 'reversal') fields.amountCents = company === 'a'
    ? { op: 'decimal_to_minor', path: path('amount'), scale: 2 }
    : field('amount');
  if (kind === 'invoice') fields.dueDate = field('due_date');
  if (kind === 'allocation') {
    fields.fundingKind = funding('funding_kind');
    fields.fundingRecordId = field('funding_id');
    fields.invoiceRecordId = { op: 'existing_invoice_lookup', path: path('invoice_id') };
  }
  if (kind === 'reversal') {
    fields.reversedKind = funding('reversed_kind');
    fields.reversedRecordId = field('reversed_id');
  }
  return fields;
}

const envelopePointers: ReadonlyArray<readonly [string, readonly string[], boolean]> = [
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
];

function financialLineage(record: FinancialRecord, profile: CustomerProfile, fields: Record<string, MappingOp>, operationIndex: number) {
  const sourceEventIds = [record.sourceEventId];
  const rows: FieldLineage[] = envelopePointers.map(([targetField, paths, scoped]) => ({
    operationIndex, targetField, sourceEventIds, sourcePaths: [...paths], evidenceRefs: [], mapping: null,
    derivationInputs: scoped ? [...sourceEventIds, profile.id, profile.hash] : sourceEventIds,
  }));
  for (const [field, mapping] of Object.entries(fields)) {
    const sourcePaths = 'path' in mapping ? [mapping.path] : [];
    if (field === 'effectiveAt') sourcePaths.push('/effectiveAt');
    rows.push({
      operationIndex, targetField: '/' + field, sourceEventIds, sourcePaths, mapping,
      evidenceRefs: mapping.op === 'constant' ? [mapping.evidenceRef] : [],
      derivationInputs: field === 'invoiceRecordId' && record.kind === 'allocation'
        ? [targetRecordId({ ...record.identity, kind: 'invoice', recordId: record.invoiceRecordId })] : [],
    });
  }
  return rows.sort((a, b) => compare(a.targetField, b.targetField));
}

const ranks: Record<FinancialKind, number> = { invoice: 0, payment: 0, credit: 0, allocation: 1, reversal: 2 };

function financialOperation(record: FinancialRecord): MutationOperation {
  switch (record.kind) {
    case 'invoice': return { op: 'insert_invoice', record };
    case 'payment': return { op: 'insert_payment', record: { ...record, kind: 'payment' } };
    case 'credit': return { op: 'insert_credit', record: { ...record, kind: 'credit' } };
    case 'allocation': return { op: 'add_allocation', record };
    case 'reversal': return { op: 'full_reverse', record };
  }
}

function eventOrder(a: RawSourceEvent, b: RawSourceEvent) {
  return compare(a.sourceRef, b.sourceRef) || compare(a.streamId, b.streamId) ||
    a.sequence - b.sequence || compare(a.id, b.id);
}

function equal(a: unknown, b: unknown) {
  return canonicalJson(a) === canonicalJson(b);
}

export type BootstrapReferenceInput = Pick<ValidatedBootstrapExpectation, 'artifact' | 'profiles' | 'truth' | 'manifest' | 'events'> & {
  descriptor: Pick<ValidatedBootstrapExpectation['descriptor'], 'manifestHash' | 'subjects'>;
  evidence: BootstrapSourceFacts;
};

export function buildBootstrapReference(context: BootstrapReferenceInput, selectedProfileHash: string, target: TargetState) {
  const { descriptor, evidence, artifact, profiles, truth, manifest, events } = context;
  const subject = descriptor.subjects.find(item => item.profileHash === selectedProfileHash);
  const profile = profiles.find(item => item.hash === selectedProfileHash);
  const company = (['a', 'b'] as const).find(id =>
    manifest.companyId === 'company-' + id && manifest.sourceRef === 'legacy-' + id);
  if (!subject || !profile || !company || !TargetStateSchema.safeParse(target).success ||
    !equal(target.scope, subject.scope) || target.asOf !== manifest.asOf ||
    [target.invoices, target.payments, target.credits, target.allocations, target.reversals].some(items => items.length)) return;

  const { identity, binding, terms } = resolveBootstrapSubject(descriptor, evidence, manifest, subject);
  const configurations = terms.map(({ id, term }) => ({ id, scope: subject.scope, contractTerm: term }))
    .sort((a, b) => compare(a.id, b.id));
  const customer = { id: identity.buyerId, displayName: identity.legalName, evidenceRefs: subject.customerEvidenceRefs };
  const account = {
    id: binding.accountId, scope: subject.scope, parentCustomerId: identity.buyerId,
    sourceRef: manifest.sourceRef, sourceAccountIds: [identity.sourceAccountId],
  };
  const metadata: Metadata[] = [
    { op: 'ensure_customer', record: customer }, { op: 'ensure_account', record: account },
    ...configurations.map(record => ({ op: 'ensure_billing_configuration' as const, record })),
  ];
  const completeMetadata = <T extends { id: string }>(existing: T[], expected: T[]) =>
    existing.length === new Set(existing.map(record => record.id)).size &&
    existing.every(record => expected.some(item => item.id === record.id && equal(item, record)))
      ? [...existing, ...expected.filter(record => !existing.some(item => item.id === record.id))]
      : undefined;
  const customers = completeMetadata(target.customers, [customer]);
  const accounts = completeMetadata(target.accounts, [account]);
  const billingConfigurations = completeMetadata(target.billingConfigurations, configurations);
  if (!customers || !accounts || !billingConfigurations) return;
  const withMetadata = { ...target, customers, accounts, billingConfigurations };

  const accountRefs = [...new Set([...subject.customerEvidenceRefs,
    ...profile.approvedLookups.flatMap(table => table.entries.flatMap(entry => entry.evidenceRefs))])].sort(compare);
  const lineage: FieldLineage[] = metadata.flatMap((operation, operationIndex) => {
    const term = operation.op === 'ensure_billing_configuration' ? operation.record.contractTerm : undefined;
    const evidenceRefs = term?.evidenceRefs ?? (operation.op === 'ensure_account' ? accountRefs : subject.customerEvidenceRefs);
    const derivationInputs = term ? [...new Set([subject.profileId, term.id])].sort(compare) : [subject.profileId];
    return bootstrapLeafPointers(operation.record).map(targetField => ({
      operationIndex, targetField, sourceEventIds: [], sourcePaths: [], mapping: null, evidenceRefs, derivationInputs,
    }));
  });

  const activeCurrency = (citation: string, instant: string) => {
    const date = instant.slice(0, 10);
    return subject.terms.some(({ factId, termId }) => {
      const { term } = terms.find(item => item.term.id === termId)!;
      return term.validFrom <= date && (term.validToExclusive === null || date < term.validToExclusive) &&
        evidence.resolvedSupport.some(row => row.factId === factId && row.field === 'currency' && row.evidenceId === citation);
    });
  };
  const mappingByKind = new Map<FinancialKind, Record<string, MappingOp>>();
  for (const mapping of artifact.normalizedPlan.mappings) {
    const currency = mapping.fields.currency;
    const contract = artifact.normalizedPlan.sourceContracts.find(item => item.resource === mapping.resource);
    if (!contract || contract.kind !== mapping.kind || contract.schemaVersion !== manifest.schemaVersions[mapping.resource] ||
      currency.op !== 'constant' || !activeCurrency(currency.evidenceRef, manifest.asOf) ||
      mappingByKind.has(mapping.kind) || mapping.resource !== company + '-' + mapping.kind + 's') return;
    const expected = mappingFields(company, mapping.kind, currency.evidenceRef);
    if (!equal(mapping.fields, expected)) return;
    mappingByKind.set(mapping.kind, expected);
  }
  if (!mappingByKind.size || !equal([...mappingByKind.keys()].sort(), [...artifact.normalizedPlan.allowedKinds].sort())) return;

  const [bound] = bindTruth(truth, [profile]);
  const selectedEvents = events.filter(event => event.sourceRef === manifest.sourceRef &&
    event.rawIdentity.companyId === manifest.companyId && event.rawIdentity.sellerEntityId === identity.sellerEntityId &&
    event.rawIdentity.sourceAccountId === identity.sourceAccountId && event.kind !== 'semantic_change');
  if (!bound || !bound.reference.records.length || selectedEvents.length !== bound.reference.records.length) return;
  const records = bound.reference.records.flatMap(record => {
    const event = selectedEvents.find(item => item.id === record.sourceEventId);
    const fields = mappingByKind.get(record.kind);
    if (!event || !fields || fields.currency?.op !== 'constant' || !activeCurrency(fields.currency.evidenceRef, event.effectiveAt) ||
      event.resource !== company + '-' + record.kind + 's' || event.semanticVersion !== profile.semanticVersion ||
      !artifact.normalizedPlan.capture.some(stream => stream.streamId === event.streamId && stream.resources.includes(event.resource))) return [];
    return [{ record, event, fields }];
  });
  if (records.length !== bound.reference.records.length) return;
  records.sort((a, b) => ranks[a.record.kind] - ranks[b.record.kind] || eventOrder(a.event, b.event));
  const operations = [...metadata, ...records.map(({ record }) => financialOperation(record))];
  for (const [index, { record, fields }] of records.entries()) {
    lineage.push(...financialLineage(record, profile, fields, metadata.length + index));
  }
  const plan = {
    scope: subject.scope, artifactHash: artifact.hash, profileHash: subject.profileHash,
    expectedTargetVersion: target.version, asOf: manifest.asOf,
    eventIds: selectedEvents.sort(eventOrder).map(event => event.id),
    operations, lineage, expectedBalanceCents: bound.reference.balanceCents,
  };
  const replay = {
    ...withMetadata, invoices: bound.target.invoices, payments: bound.target.payments, credits: bound.target.credits,
    allocations: bound.target.allocations, reversals: bound.target.reversals,
  };
  return {
    profile, metadata, withMetadata, replay, plan: MutationPlanSchema.parse({ ...plan, hash: hashPlan(plan) }),
    termProvenance: terms.map(({ term, endProvenance }) => ({ termId: term.id, validToExclusive: endProvenance })),
  };
}
