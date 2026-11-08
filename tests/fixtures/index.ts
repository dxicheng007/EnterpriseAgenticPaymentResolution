import {
  BootstrapManifestSchema, ConnectorSpecSchema, CustomerProfileSchema, EvidenceRefSchema,
  RawSourceEventSchema, ReceiptResponseSchema, TargetStateSchema,
  canonicalJson, hashBytes, hashCanonical, hashEvent, hashManifest, hashProfile, targetRecordId,
  type CaptureStream, type ConnectorSpec, type ContractTerm, type EntityMapping, type EventKind,
  type FieldContract, type FinancialKind, type JsonObject, type ManifestFile, type MappingOp,
  type RawSourceEvent, type Scope, type SourceContract, type TargetState,
} from '../../packages/contracts/src/index.js';

export const fixtureMetadata = { classification: 'development-only', version: '1' } as const;

type Company = 'a' | 'b';
const october1 = '2026-10-01T00:00:00.000Z';
const october3 = '2026-10-03T00:00:00.000Z';
const baselineEffective = '2026-09-01T00:00:00.000Z';

function scope(company: Company): Scope {
  return { companyId: 'company-' + company, sellerEntityId: 'seller-' + company, accountId: company + '.seller-' + company + '.customer-1' };
}
export const scopeA = scope('a');
export const scopeB = scope('b');

const sourceRef = (company: Company) => 'legacy-' + company;
const sourceAccount = (company: Company) => 'cust-' + company + '-1';
const semanticVersion = (company: Company) => 'sem-' + company + '-1';
const schemaVersion = (company: Company) => 'schema-' + company + '-1';
const evidenceId = (company: Company, kind: string) => 'ev-' + company + '-' + kind;

function profile(company: Company) {
  const term: ContractTerm = {
    id: 'term-' + company + '-1', contractId: 'contract-' + company, validFrom: '2026-07-01',
    validToExclusive: null, fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly',
    anchorDay: 1, evidenceRefs: [evidenceId(company, 'contract')],
  };
  const subject = {
    id: 'profile-' + company, version: 1, sourceRef: sourceRef(company), scope: scope(company),
    parentCustomerId: 'buyer-shared-1', sourceAccountIds: [sourceAccount(company)],
    approvedLookups: [{
      id: 'account-map', valueType: 'parent-account' as const,
      entries: [{ source: sourceAccount(company), target: scope(company).accountId, evidenceRefs: [evidenceId(company, 'identity')] }],
    }],
    contractTerms: [term], semanticVersion: semanticVersion(company), findings: [],
  };
  return CustomerProfileSchema.parse({ ...subject, hash: hashProfile(subject) });
}
export const profileA = profile('a');
export const profileB = profile('b');

const fieldsB = {
  id: 'transaction_key', version: 'revision_no', account: 'client_code', effective_date: 'posted_on',
  amount: 'amount_minor', due_date: 'due_on', funding_kind: 'receipt_type', funding_id: 'receipt_key',
  invoice_id: 'bill_key', reversed_kind: 'void_type', reversed_id: 'void_key',
} as const;
function fieldName(company: Company, name: string) {
  return company === 'b' && Object.hasOwn(fieldsB, name) ? fieldsB[name as keyof typeof fieldsB] : name;
}
function fieldNames<T>(company: Company, entries: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(entries).map(([key, value]) => [fieldName(company, key), value]));
}

const resourceNames: Record<EventKind, string> = {
  invoice: 'invoices', payment: 'payments', credit: 'credits', allocation: 'allocations',
  reversal: 'reversals', semantic_change: 'semantics',
};
const resource = (company: Company, kind: EventKind) => company + '-' + resourceNames[kind];
const kinds: FinancialKind[] = ['invoice', 'payment', 'credit', 'allocation', 'reversal'];
const text = { type: 'string', required: true, nullable: false, format: 'text' } as const;
const day = { ...text, format: 'iso-date' } as const;
const funding = { ...text, enum: ['payment', 'credit'] };
const count = { type: 'integer', required: true, nullable: false, unit: 'count', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;

function contract(company: Company, kind: EventKind): SourceContract {
  const amount: FieldContract = company === 'a' ? { ...text, format: 'decimal2' } : { ...count, unit: 'minor', maximum: 5000000 };
  const extra: Record<EventKind, Record<string, FieldContract>> = {
    invoice: { amount, due_date: day }, payment: { amount }, credit: { amount },
    allocation: { amount, funding_kind: funding, funding_id: text, invoice_id: text },
    reversal: { reversed_kind: funding, reversed_id: text },
    semantic_change: { revision: text },
  };
  return {
    resource: resource(company, kind), kind, schemaVersion: schemaVersion(company),
    fields: fieldNames(company, { id: text, version: count, account: text, effective_date: day, ...extra[kind] }),
    additionalProperties: false, currency: 'USD', timezone: 'UTC',
    recordIdField: fieldName(company, 'id'), recordVersionField: fieldName(company, 'version'),
    accountIdField: fieldName(company, 'account'), semantics: 'append-only-events', moneyUpdates: 'full-reversal-only',
  };
}

function mapping(company: Company, kind: FinancialKind): EntityMapping {
  const path = (name: string) => '/' + fieldName(company, name);
  const field = (name: string): MappingOp => ({ op: 'field', path: path(name) });
  const fundingKind = (name: string): MappingOp => ({
    op: 'enum_lookup', path: path(name), values: { payment: 'payment', credit: 'credit' },
  });
  const base = {
    resource: resource(company, kind),
  };
  const common = {
    currency: { op: 'constant', value: 'USD', evidenceRef: evidenceId(company, 'currency') } as const,
    effectiveAt: { op: 'date_parse', path: path('effective_date'), format: 'YYYY-MM-DD', timezone: 'UTC' } as const,
  };
  const fields = {
    ...common,
    amountCents: company === 'a' ? { op: 'decimal_to_minor', path: path('amount'), scale: 2 } as const : field('amount'),
  };
  switch (kind) {
    case 'invoice':
      return { ...base, kind, fields: { ...fields, dueDate: field('due_date') } };
    case 'allocation':
      return { ...base, kind, fields: {
        ...fields, fundingKind: fundingKind('funding_kind'), fundingRecordId: field('funding_id'),
        invoiceRecordId: { op: 'existing_invoice_lookup', path: path('invoice_id') },
      } };
    case 'reversal':
      return { ...base, kind, fields: {
        ...common, reversedKind: fundingKind('reversed_kind'), reversedRecordId: field('reversed_id'),
      } };
    case 'payment':
    case 'credit':
      return { ...base, kind, fields };
  }
}

function spec(company: Company): ConnectorSpec {
  const stream = (name: string, transport: CaptureStream['transport'], members: EventKind[]): CaptureStream => ({
    streamId: company + '-' + name, transport, resources: members.map(kind => resource(company, kind)),
    cursorStrategy: 'positive-safe-integer', pageSize: 100,
  });
  const finance = company === 'a'
    ? [stream('finance', 'api', kinds)]
    : [stream('files', 'csv', kinds.filter(kind => kind !== 'payment')), stream('receipts', 'api', ['payment'])];
  return ConnectorSpecSchema.parse({
    id: 'connector-' + company, version: 1, sourceRef: sourceRef(company), targetSchemaVersion: '1',
    sourceContracts: [...kinds, 'semantic_change' as const].map(kind => contract(company, kind)),
    capture: [...finance, stream('semantics', 'semantic', ['semantic_change'])],
    mappings: kinds.map(kind => mapping(company, kind)), requiredValidators: [], allowedKinds: kinds,
    maxTransactionCents: 5000000, maxRecordsPerCycle: 1000,
    evidenceRefs: [evidenceId(company, 'currency')], runtimeModelCalls: 'forbidden',
  });
}
export const validSpecA = spec('a');
export const validSpecB = spec('b');

type ExampleEvent = {
  kind: FinancialKind;
  id: string;
  recordId: string;
  sequence: number;
  amountA: string;
  amountB: number;
  allocation?: { fundingKind: 'payment' | 'credit'; fundingId: string; invoiceId: string };
  effectiveAt?: string;
  observedAt?: string;
  account?: string;
};
function rawEvent(company: Company, input: ExampleEvent): RawSourceEvent {
  const { id, recordId, sequence, kind, allocation } = input;
  const account = input.account ?? sourceAccount(company);
  const effectiveAt = input.effectiveAt ?? baselineEffective;
  const payload: JsonObject = fieldNames(company, {
    id: recordId, version: 1, account, effective_date: effectiveAt.slice(0, 10),
    amount: company === 'a' ? input.amountA : input.amountB,
    ...(kind === 'invoice' ? { due_date: '2026-09-30' } : {}),
    ...(allocation ? {
      funding_kind: allocation.fundingKind, funding_id: allocation.fundingId, invoice_id: allocation.invoiceId,
    } : {}),
  });
  const event = {
    id, sourceRef: sourceRef(company), resource: resource(company, kind),
    streamId: company === 'a' ? 'a-finance' : kind === 'payment' ? 'b-receipts' : 'b-files',
    sequence, recordId, recordVersion: 1,
    rawIdentity: { companyId: scope(company).companyId, sellerEntityId: scope(company).sellerEntityId, sourceAccountId: account },
    kind, effectiveAt, observedAt: input.observedAt ?? october1, schemaVersion: schemaVersion(company),
    semanticVersion: semanticVersion(company), payload,
  };
  return RawSourceEventSchema.parse({ ...event, contentHash: hashEvent(event) });
}

function baselineEvents(company: Company) {
  const payId = 'pay-' + company + '-1';
  const invoiceId = 'inv-' + company + '-1';
  const creditId = 'credit-' + company + '-1';
  const event = (input: Omit<ExampleEvent, 'id'>) => rawEvent(company, { ...input, id: 'evt-' + company + '-' +
    input.recordId.replace('-' + company + '-', '-') });
  return [
    event({ kind: 'invoice', recordId: invoiceId, sequence: 1, amountA: '3000.00', amountB: 300000 }),
    event({ kind: 'payment', recordId: payId, sequence: company === 'a' ? 2 : 1, amountA: '2000.00', amountB: 200000 }),
    event({ kind: 'credit', recordId: creditId, sequence: company === 'a' ? 3 : 2, amountA: '200.00', amountB: 20000 }),
    event({
      kind: 'allocation', recordId: 'alloc-pay-' + company + '-1', sequence: company === 'a' ? 4 : 3,
      amountA: '2000.00', amountB: 200000, allocation: { fundingKind: 'payment', fundingId: payId, invoiceId },
    }),
    event({
      kind: 'allocation', recordId: 'alloc-credit-' + company + '-1', sequence: company === 'a' ? 5 : 4,
      amountA: '200.00', amountB: 20000, allocation: { fundingKind: 'credit', fundingId: creditId, invoiceId },
    }),
  ];
}
export const baselineEventsA = baselineEvents('a');
export const baselineEventsB = baselineEvents('b');

export const emptyTargetA = TargetStateSchema.parse({
  scope: scopeA, version: 0, asOf: october1, invoices: [], payments: [], credits: [], allocations: [], reversals: [],
  customers: [], accounts: [], billingConfigurations: [],
});

function recordBase(event: RawSourceEvent, kind: FinancialKind) {
  const identity = { sourceRef: event.sourceRef, sellerEntityId: scopeA.sellerEntityId, kind, recordId: event.recordId };
  return {
    id: targetRecordId(identity), identity, sourceRecordVersion: event.recordVersion, scope: scopeA,
    effectiveAt: event.effectiveAt, sourceEventId: event.id, currency: 'USD' as const,
  };
}

export const baselineA: TargetState = TargetStateSchema.parse({
  ...emptyTargetA, version: 1,
  invoices: [{ ...recordBase(baselineEventsA[0], 'invoice'), kind: 'invoice', amountCents: 300000, dueDate: '2026-09-30' }],
  payments: [{ ...recordBase(baselineEventsA[1], 'payment'), kind: 'payment', amountCents: 200000 }],
  credits: [{ ...recordBase(baselineEventsA[2], 'credit'), kind: 'credit', amountCents: 20000 }],
  allocations: [{
    ...recordBase(baselineEventsA[3], 'allocation'), kind: 'allocation', amountCents: 200000,
    fundingKind: 'payment', fundingRecordId: 'pay-a-1', invoiceRecordId: 'inv-a-1',
  }, {
    ...recordBase(baselineEventsA[4], 'allocation'), kind: 'allocation', amountCents: 20000,
    fundingKind: 'credit', fundingRecordId: 'credit-a-1', invoiceRecordId: 'inv-a-1',
  }],
  customers: [{ id: 'buyer-shared-1', displayName: 'Shared Buyer', evidenceRefs: ['ev-a-identity'] }],
  accounts: [{ id: scopeA.accountId, scope: scopeA, parentCustomerId: 'buyer-shared-1', sourceRef: 'legacy-a', sourceAccountIds: ['cust-a-1'] }],
  billingConfigurations: [{ id: 'config-a-1', scope: scopeA, contractTerm: profileA.contractTerms[0] }],
});

const late = { effectiveAt: october3, observedAt: october3, amountA: '300.00', amountB: 30000 };
export const latePaymentA = [
  rawEvent('a', { ...late, kind: 'payment', id: 'evt-a-pay-2', recordId: 'pay-a-2', sequence: 6 }),
  rawEvent('a', {
    ...late, kind: 'allocation', id: 'evt-a-alloc-pay-2', recordId: 'alloc-pay-a-2', sequence: 7,
    allocation: { fundingKind: 'payment', fundingId: 'pay-a-2', invoiceId: 'inv-a-1' },
  }),
];
export const afterLatePaymentA = TargetStateSchema.parse({
  ...baselineA, version: 2, asOf: october3,
  payments: [...baselineA.payments, { ...recordBase(latePaymentA[0], 'payment'), kind: 'payment', amountCents: 30000 }],
  allocations: [...baselineA.allocations, {
    ...recordBase(latePaymentA[1], 'allocation'), kind: 'allocation', amountCents: 30000,
    fundingKind: 'payment', fundingRecordId: 'pay-a-2', invoiceRecordId: 'inv-a-1',
  }],
});

function emailFixtures(company: Company) {
  const documents = [
    { name: 'identity', body: 'Account cust-' + company + '-1; seller seller-' + company + '; currency USD.', evidence: ['identity', 'currency'] },
    { name: 'contract', body: 'Fixed monthly fee USD 3000.00 effective 2026-07-01.', evidence: ['contract'] },
  ];
  return documents.map(({ name, body, evidence }) => {
    const messageId = 'msg-' + company + '-' + name;
    const bytes = Buffer.from(canonicalJson({ body, messageId }), 'utf8');
    const file: ManifestFile = {
      fileId: 'file-' + company + '-' + name, documentId: 'doc-' + company + '-' + name,
      documentVersion: 1, sha256: hashBytes(bytes), kind: 'email_json',
    };
    const refs = evidence.map(kind => EvidenceRefSchema.parse({
      id: evidenceId(company, kind), snapshotId: 'snapshot:manifest-' + company + '-1', sourceId: file.fileId,
      locator: { kind: 'email', messageId, start: 0, end: body.length }, excerpt: body, sha256: file.sha256,
    }));
    return { bytes, file, refs };
  });
}
export const emailFixturesA = emailFixtures('a');
export const emailFixturesB = emailFixtures('b');
const csvEventsB = baselineEventsB.filter(event => event.streamId === 'b-files').sort((a, b) => a.sequence - b.sequence);

function csvField(value: string | number) {
  const field = String(value);
  return /[",\n\r]/.test(field) ? '"' + field.replaceAll('"', '""') + '"' : field;
}
const csvHeader = 'event_id,sequence,resource,kind,record_id,record_version,effective_at,observed_at,account_id,schema_version,semantic_version,payload_json';
export const baselineCsvB = Buffer.from([
  csvHeader,
  ...csvEventsB.map(event => [
    event.id, event.sequence, event.resource, event.kind, event.recordId, event.recordVersion,
    event.effectiveAt, event.observedAt, sourceAccount('b'), event.schemaVersion, event.semanticVersion,
    canonicalJson(event.payload),
  ].map(csvField).join(',')),
].join('\n') + '\n', 'utf8');

function manifest(company: Company) {
  const spec = company === 'a' ? validSpecA : validSpecB;
  const events = company === 'a' ? baselineEventsA : baselineEventsB;
  const files = (company === 'a' ? emailFixturesA : emailFixturesB).map(doc => doc.file);
  if (company === 'b') {
    files.push({
      fileId: 'file-b-batch-1', documentId: 'doc-b-batch-1', documentVersion: 1, sha256: hashBytes(baselineCsvB),
      kind: 'event_csv', batchId: 'batch-b-1', sequence: 1, streamId: 'b-files',
    });
  }
  const subject = {
    id: 'manifest-' + company + '-1', companyId: scope(company).companyId, sourceRef: sourceRef(company),
    epoch: 1, asOf: october1,
    schemaVersions: Object.fromEntries(spec.sourceContracts.map(value => [value.resource, value.schemaVersion])),
    semanticVersions: { [scope(company).sellerEntityId + '/' + sourceAccount(company)]: semanticVersion(company) },
    streams: spec.capture.map(({ streamId }) => {
      const members = events.filter(event => event.streamId === streamId).sort((a, b) => a.sequence - b.sequence);
      const resumeAfter = String(members.at(-1)?.sequence ?? 0);
      const snapshotSuffix = streamId === 'a-semantics' ? 'a-sem' : streamId;
      return {
        streamId, snapshotId: 'snap-' + snapshotSuffix + '-1', resumeAfter, eventIds: members.map(event => event.id),
        snapshotHash: hashCanonical({
          sourceRef: spec.sourceRef, streamId, resumeAfter,
          events: members.map(({ id, contentHash }) => ({ id, contentHash })),
        }),
      };
    }),
    files,
  };
  return BootstrapManifestSchema.parse({ ...subject, hash: hashManifest(subject) });
}
export const baselineManifestA = manifest('a');
export const baselineManifestB = manifest('b');

const drift = rawEvent('a', { kind: 'invoice', id: 'evt-a-inv-drift', recordId: 'inv-a-drift', sequence: 8, amountA: '3000.00', amountB: 300000 });
const { amount: grossAmount, ...retainedPayload } = drift.payload;
const driftEnvelope = { ...drift, payload: { ...retainedPayload, gross_amount: grossAmount } };
export const renamedSchemaA = RawSourceEventSchema.parse({ ...driftEnvelope, contentHash: hashEvent(driftEnvelope) });

export function invoiceBeforePaymentVariant() {
  const events = [
    rawEvent('a', { ...late, kind: 'payment', id: 'evt-a-dep-pay', recordId: 'pay-a-dep', sequence: 8 }),
    rawEvent('a', {
      ...late, kind: 'allocation', id: 'evt-a-dep-alloc', recordId: 'alloc-a-dep', sequence: 9,
      allocation: { fundingKind: 'payment', fundingId: 'pay-a-dep', invoiceId: 'inv-a-dep' },
    }),
    rawEvent('a', {
      ...late, kind: 'invoice', id: 'evt-a-dep-inv', recordId: 'inv-a-dep', sequence: 10,
      amountA: '400.00', amountB: 40000,
    }),
  ];
  return { events, expectedHoldIds: ['evt-a-dep-pay', 'evt-a-dep-alloc'], expectedReleaseIds: events.map(event => event.id) };
}
export const ambiguousRemittanceB = rawEvent('b', {
  ...late, kind: 'payment', id: 'evt-b-pay-unknown', recordId: 'pay-b-unknown', sequence: 2, account: 'cust-b-unknown',
});
export const variantDiagnostics = { renamedSchemaA: 'SOURCE_SCHEMA', ambiguousRemittanceB: 'UNKNOWN_ACCOUNT' } as const;

const receipt = {
  id: 'receipt-a-1', scope: scopeA, activationId: 'activation-a-1', epoch: 1,
  artifactHash: hashCanonical({ fixture: 'example-artifact' }), planHash: hashCanonical({ fixture: 'example-plan' }),
  eventIds: latePaymentA.map(event => event.id), targetRecordIds: [afterLatePaymentA.payments[1].id, afterLatePaymentA.allocations[2].id],
  beforeBalanceCents: 80000, afterBalanceCents: 50000, status: 'applied', committedAt: october3,
};
export const originalReceiptResponse = ReceiptResponseSchema.parse({ receipt, replayed: false });
export const retryReceiptResponse = ReceiptResponseSchema.parse({ receipt, replayed: true });
// A reused key with a different canonical request has no ReceiptResponse.
export const conflictingReceiptKey = { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' } as const;
