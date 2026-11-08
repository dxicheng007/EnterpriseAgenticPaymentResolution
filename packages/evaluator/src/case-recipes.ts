import {
  canonicalJson, hashCanonical, hashEvent, targetRecordId,
  type BootstrapManifest, type CompiledArtifact, type CustomerProfile, type EventKind, type FieldContract,
  type Funding, type JsonObject, type RawSourceEvent, type SourceContract, type TargetState,
} from '@eapr/contracts';
import type { ProtectedFixtureSet } from './fixtures.js';
import type { FinancialRecord } from './reference-model.js';

type Company = 'a' | 'b';
type EventOptions = { effectiveAt?: string; sequence?: number };
type ProbeFact =
  | { kind: 'invoice'; amountCents: number; dueDate: string }
  | { kind: 'payment' | 'credit'; amountCents: number }
  | { kind: 'allocation'; amountCents: number; fundingKind: 'payment' | 'credit'; fundingRecordId: string; invoiceRecordId: string }
  | { kind: 'reversal'; reversedKind: 'payment' | 'credit'; reversedRecordId: string };

const kinds = ['invoice', 'payment', 'credit', 'allocation', 'reversal', 'semantic_change'] as const;
const namesB: Record<string, string> = {
  id: 'transaction_key', version: 'revision_no', account: 'client_code', effective_date: 'posted_on',
  amount: 'amount_minor', due_date: 'due_on', funding_kind: 'receipt_type', funding_id: 'receipt_key',
  invoice_id: 'bill_key', reversed_kind: 'void_type', reversed_id: 'void_key',
};
const text = { type: 'string', required: true, nullable: false, format: 'text' } as const;
const day = { ...text, format: 'iso-date' } as const;
const funding = { ...text, enum: ['payment', 'credit'] };
const count = { type: 'integer', required: true, nullable: false, unit: 'count', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;
const amountA = { ...text, format: 'decimal2' } as const;
const amountB = { ...count, unit: 'minor', maximum: 5000000 } as const;

function name(company: Company, field: string) {
  return company === 'b' ? namesB[field] ?? field : field;
}

function resource(company: Company, kind: EventKind) {
  return company + '-' + (kind === 'semantic_change' ? 'semantics' : kind + 's');
}

function streamId(company: Company, kind: EventKind) {
  if (kind === 'semantic_change') return company + '-semantics';
  if (company === 'a') return 'a-finance';
  return kind === 'payment' ? 'b-receipts' : 'b-files';
}

function sourceContract(company: Company, kind: EventKind): SourceContract {
  const amount = company === 'a' ? amountA : amountB;
  const extra: Record<EventKind, Record<string, FieldContract>> = {
    invoice: { amount, due_date: day }, payment: { amount }, credit: { amount },
    allocation: { amount, funding_kind: funding, funding_id: text, invoice_id: text },
    reversal: { reversed_kind: funding, reversed_id: text }, semantic_change: { revision: text },
  };
  return {
    resource: resource(company, kind), kind, schemaVersion: 'schema-' + company + '-1',
    fields: Object.fromEntries(Object.entries({
      id: text, account: text, version: count, effective_date: day, ...extra[kind],
    }).map(([key, value]) => [name(company, key), value])),
    additionalProperties: false, currency: 'USD', timezone: 'UTC',
    recordIdField: name(company, 'id'), recordVersionField: name(company, 'version'),
    accountIdField: name(company, 'account'), semantics: 'append-only-events', moneyUpdates: 'full-reversal-only',
  };
}

function decimal(cents: number): string {
  const digits = String(cents).padStart(3, '0');
  return digits.slice(0, -2) + '.' + digits.slice(-2);
}

export function addProbeRecords(target: TargetState, records: readonly FinancialRecord[]): TargetState {
  return {
    ...target,
    invoices: [...target.invoices, ...records.filter(record => record.kind === 'invoice')],
    payments: [...target.payments, ...records.filter((record): record is Funding & { kind: 'payment' } => record.kind === 'payment')],
    credits: [...target.credits, ...records.filter((record): record is Funding & { kind: 'credit' } => record.kind === 'credit')],
    allocations: [...target.allocations, ...records.filter(record => record.kind === 'allocation')],
    reversals: [...target.reversals, ...records.filter(record => record.kind === 'reversal')],
  };
}

export function emptyProbeTarget(target: TargetState): TargetState {
  return { ...target, version: 0, invoices: [], payments: [], credits: [], allocations: [], reversals: [] };
}

export function chooseRecipe(
  artifact: CompiledArtifact, profile: CustomerProfile, manifest: BootstrapManifest, truth: ProtectedFixtureSet,
  captured: readonly RawSourceEvent[],
) {
  const company = (['a', 'b'] as const).find(value => profile.sourceRef === 'legacy-' + value &&
    profile.scope.companyId === 'company-' + value && profile.scope.sellerEntityId === 'seller-' + value);
  if (!company || artifact.sourceRef !== profile.sourceRef || artifact.normalizedPlan.sourceContracts.length !== kinds.length ||
    kinds.some(kind => {
      const expected = sourceContract(company, kind);
      const actual = artifact.normalizedPlan.sourceContracts.find(contract => contract.resource === expected.resource);
      return !actual || canonicalJson(actual) !== canonicalJson(expected) ||
        manifest.schemaVersions[expected.resource] !== expected.schemaVersion ||
        !manifest.streams.some(member => member.streamId === streamId(company, kind)) ||
        !artifact.normalizedPlan.capture.some(stream => stream.streamId === streamId(company, kind) &&
          stream.resources.includes(expected.resource));
    })) return undefined;

  const choices = truth.accounts.flatMap(account => {
    const accountId = account.sourceAccountId;
    if (!profile.sourceAccountIds.includes(accountId) ||
      manifest.semanticVersions[profile.scope.sellerEntityId + '/' + accountId] !== profile.semanticVersion ||
      !profile.approvedLookups.some(table => table.valueType === 'parent-account' && table.entries.some(entry =>
        entry.source === accountId && entry.target === profile.scope.accountId && entry.evidenceRefs.length))) return [];
    return account.records.flatMap(record => {
      if (record.kind !== 'invoice' || record.amountCents !== 300000 || record.effectiveAt > truth.asOf ||
        !record.effectiveAt.endsWith('T00:00:00.000Z')) return [];
      const date = record.effectiveAt.slice(0, 10);
      const terms = profile.contractTerms.filter(term =>
        term.validFrom <= date && (term.validToExclusive === null || date < term.validToExclusive));
      return terms.length === 1 && terms[0].fixedMonthlyFeeCents === 300000 && terms[0].currency === 'USD' &&
        terms[0].cadence === 'monthly' && terms[0].anchorDay === Number(date.slice(8)) &&
        terms[0].evidenceRefs.length ? [{ accountId, date, record, term: terms[0] }] : [];
    });
  });
  choices.sort((a, b) => a.date === b.date ? 0 : a.date > b.date ? -1 : 1);
  const choice = choices[0];
  if (!choice) return undefined;
  const { accountId, date, record: invoice } = choice;
  const sourceCompany = company;
  const prefix = 'probe:' + hashCanonical([truth.hash, artifact.hash, profile.hash, accountId, date, '1']);
  const occupied = new Set(captured.flatMap(event => [event.recordId, event.id, event.rawIdentity.sourceAccountId]));
  if ([...occupied].some(id => id?.startsWith(prefix))) return undefined;
  const sequence = Math.max(0, ...manifest.streams.map(member => Number(member.resumeAfter)));
  if (sequence > Number.MAX_SAFE_INTEGER - 100) return undefined;
  let index = 0;
  const probeId = (label: string) => prefix + ':' + label;
  const field = (key: string) => name(company, key);

  function envelope(
    label: string, kind: EventKind, fields: JsonObject, options: EventOptions, semanticVersion = profile.semanticVersion,
  ): RawSourceEvent {
    const recordId = probeId(label);
    const effectiveAt = options.effectiveAt ?? invoice.effectiveAt;
    const contract = sourceContract(sourceCompany, kind);
    return rehash({
      id: probeId('evt-' + label), recordId, recordVersion: 1, kind, effectiveAt,
      sequence: options.sequence ?? (sequence + ++index), streamId: streamId(sourceCompany, kind), resource: contract.resource,
      sourceRef: profile.sourceRef, observedAt: truth.asOf, schemaVersion: contract.schemaVersion, semanticVersion,
      rawIdentity: { sellerEntityId: profile.scope.sellerEntityId, companyId: profile.scope.companyId, sourceAccountId: accountId },
      payload: {
        ...fields, [field('id')]: recordId, [field('version')]: 1, [field('account')]: accountId,
        [field('effective_date')]: effectiveAt.slice(0, 10),
      },
      contentHash: '0'.repeat(64),
    });
  }

  function make(label: string, fact: ProbeFact, options: EventOptions = {}) {
    const payload: JsonObject = {};
    if (fact.kind === 'reversal') {
      payload[field('reversed_kind')] = fact.reversedKind;
      payload[field('reversed_id')] = fact.reversedRecordId;
    } else {
      payload[field('amount')] = company === 'a' ? decimal(fact.amountCents) : fact.amountCents;
    }
    if (fact.kind === 'invoice') payload[field('due_date')] = fact.dueDate;
    if (fact.kind === 'allocation') {
      payload[field('funding_kind')] = fact.fundingKind;
      payload[field('funding_id')] = fact.fundingRecordId;
      payload[field('invoice_id')] = fact.invoiceRecordId;
    }
    const event = envelope(label, fact.kind, payload, options);
    const identity = { sourceRef: profile.sourceRef, sellerEntityId: profile.scope.sellerEntityId, kind: fact.kind, recordId: event.recordId };
    const record = {
      ...fact, id: targetRecordId(identity), identity, scope: profile.scope, sourceEventId: event.id, sourceRecordVersion: 1,
      effectiveAt: event.effectiveAt, currency: 'USD' as const,
    };
    return { event, record };
  }

  function semantic(label: string, semanticVersion: string, options: EventOptions = {}) {
    return envelope(label, 'semantic_change', { revision: semanticVersion }, options, semanticVersion);
  }

  function laterInstant(days: number) {
    const effectiveAt = new Date(Date.parse(invoice.effectiveAt) + days * 86_400_000).toISOString();
    const date = effectiveAt.slice(0, 10);
    const applicable = profile.contractTerms.filter(term =>
      term.validFrom <= date && (term.validToExclusive === null || date < term.validToExclusive));
    return effectiveAt <= truth.asOf && applicable.length === 1 && applicable[0].id === choice.term.id
      ? effectiveAt : undefined;
  }

  return { company, accountId, date, invoice, probeId, make, field, semantic, laterInstant,
    streamFor: (kind: EventKind) => streamId(sourceCompany, kind) };
}

export function rehash(event: RawSourceEvent): RawSourceEvent {
  return { ...event, contentHash: hashEvent(event) };
}
