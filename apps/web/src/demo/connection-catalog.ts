/** Connection catalog for Understand / Connect / Authorize / Operate. */
import { demoCompanies, type DemoCompany } from './acquisition-demo-data.js';
import { stagedCompanyA } from './staged-company-a.js';

export type ConnectionCompanyId = 'company-a' | 'company-b';

export type ConnectionCompany = {
  id: ConnectionCompanyId;
  name: string;
  sourceRef: string;
  sellerEntityId: string;
  accountId: string;
  sourceAccountId: string;
  parentCustomerId: string;
  parentCustomerName: string;
  candidateId: string;
  candidateLabel: string;
  manifestId: string;
  snapshotId: string;
  explanation: {
    source: string;
    records: string;
    meaning: string;
  };
  systems: DemoCompany['systems'];
  documents: DemoCompany['documents'];
  invoices: DemoCompany['invoices'];
  translations: DemoCompany['translations'];
  financeStack: string;
  tagline: string;
  preview: {
    asOf: string;
    beforeBalanceCents: number;
    afterBalanceCents: number;
    operations: readonly { kind: string; recordId: string; amountCents: number; note: string }[];
    coverage: readonly { accountId: string; events: number; evidence: number; status: string }[];
  };
  authorize: {
    connector: string;
    profile: string;
    manifest: string;
    startingBalanceCents: number;
    activationId: string;
    receiptId: string;
  };
  operate: {
    cutoverAsOf: string;
    currentAsOf: string;
    cutoverCents: number;
    currentCents: number;
    seller: string;
    lines: DemoCompany['parentView']['lines'];
    syncPaymentCents: number;
    syncPaymentLabel: string;
    syncReceiptId: string;
  };
};

function buildCompany(demo: DemoCompany, extras: {
  sourceRef: string;
  sellerEntityId: string;
  accountId: string;
  sourceAccountId: string;
  parentCustomerId: string;
  parentCustomerName: string;
  candidateId: string;
  candidateLabel: string;
  manifestId: string;
  snapshotId: string;
  explanation: ConnectionCompany['explanation'];
  preview: ConnectionCompany['preview'];
  authorize: ConnectionCompany['authorize'];
  operate: ConnectionCompany['operate'];
}): ConnectionCompany {
  return {
    id: demo.id,
    name: demo.name,
    sourceRef: extras.sourceRef,
    sellerEntityId: extras.sellerEntityId,
    accountId: extras.accountId,
    sourceAccountId: extras.sourceAccountId,
    parentCustomerId: extras.parentCustomerId,
    parentCustomerName: extras.parentCustomerName,
    candidateId: extras.candidateId,
    candidateLabel: extras.candidateLabel,
    manifestId: extras.manifestId,
    snapshotId: extras.snapshotId,
    explanation: extras.explanation,
    systems: demo.systems,
    documents: demo.documents,
    invoices: demo.invoices,
    translations: demo.translations,
    financeStack: demo.financeStack,
    tagline: demo.tagline,
    preview: extras.preview,
    authorize: extras.authorize,
    operate: extras.operate,
  };
}

const companyADemo = demoCompanies.find(item => item.id === 'company-a')!;
const companyBDemo = demoCompanies.find(item => item.id === 'company-b')!;

export const connectionCompanies: readonly ConnectionCompany[] = [
  buildCompany(companyADemo, {
    sourceRef: stagedCompanyA.sourceRef,
    sellerEntityId: stagedCompanyA.seller,
    accountId: stagedCompanyA.accountId,
    sourceAccountId: stagedCompanyA.sourceAccountId,
    parentCustomerId: stagedCompanyA.parentCustomer,
    parentCustomerName: stagedCompanyA.display.parentCustomer,
    candidateId: stagedCompanyA.candidateId,
    candidateLabel: stagedCompanyA.candidateLabel,
    manifestId: stagedCompanyA.manifestId,
    snapshotId: 'snapshot:' + stagedCompanyA.manifestId,
    explanation: {
      source: 'Legacy Billing A plus pinned contract PDFs and a bank CSV payment inbox. This is the acquired company’s systems of record for Shared Buyer.',
      records: 'MSA terms, open and paid invoices, cash-application rows, and customer identity fields captured as a coordinated evidence package.',
      meaning: 'Each citation stays tied to an original file. Proposed import rules may only move amounts that those records support — review never invents balances.',
    },
    preview: {
      asOf: stagedCompanyA.cutoverAsOf,
      beforeBalanceCents: 0,
      afterBalanceCents: stagedCompanyA.cutoverCents,
      operations: [
        { kind: 'ensure_customer', recordId: stagedCompanyA.parentCustomer, amountCents: 0, note: 'Shared Buyer in parent books' },
        { kind: 'insert_invoice', recordId: 'INV-A-09', amountCents: 80_000, note: 'September invoice still open after partial pay' },
        { kind: 'insert_invoice', recordId: 'INV-A-10', amountCents: 80_000, note: 'October invoice open' },
        { kind: 'insert_payment', recordId: 'PAY-A-09-partial', amountCents: 30_000, note: 'September cash application' },
        { kind: 'add_allocation', recordId: 'ALLOC-A-09', amountCents: 30_000, note: 'Payment allocated to INV-A-09 only' },
      ],
      coverage: [
        { accountId: stagedCompanyA.sourceAccountId, events: 12, evidence: 4, status: 'Covered' },
      ],
    },
    authorize: {
      connector: stagedCompanyA.display.connector,
      profile: stagedCompanyA.display.profile,
      manifest: stagedCompanyA.display.manifest,
      startingBalanceCents: stagedCompanyA.cutoverCents,
      activationId: stagedCompanyA.activationId,
      receiptId: stagedCompanyA.activationReceiptId,
    },
    operate: {
      cutoverAsOf: stagedCompanyA.cutoverAsOf,
      currentAsOf: stagedCompanyA.currentAsOf,
      cutoverCents: stagedCompanyA.cutoverCents,
      currentCents: stagedCompanyA.currentCents,
      seller: stagedCompanyA.display.seller,
      lines: companyADemo.parentView.lines,
      syncPaymentCents: 30_000,
      syncPaymentLabel: '$300 payment applied',
      syncReceiptId: stagedCompanyA.syncReceiptId,
    },
  }),
  buildCompany(companyBDemo, {
    sourceRef: 'legacy-b',
    sellerEntityId: 'seller-b',
    accountId: 'company-b.seller-b.cust-b-d22feb38e846-1',
    sourceAccountId: 'cust-b-d22feb38e846-1',
    parentCustomerId: 'buyer-harbor-d22feb38e846',
    parentCustomerName: 'Harbor Clinics (books)',
    candidateId: 'demo-candidate-b',
    candidateLabel: 'DASDummies · Harbor Clinics',
    manifestId: 'manifest-b-d22feb38e846-9c2a1f0e7b44',
    snapshotId: 'snapshot:manifest-b-d22feb38e846-9c2a1f0e7b44',
    explanation: {
      source: 'Regional Ledger B with Seller B billing portal exports and a pinned deal-room PDF pack. Multi-seller books stay scoped to Seller B.',
      records: 'Customer schedules, trial balances, open AR invoice bundles, and tiered fee tables captured for Harbor Clinics and Pine Ortho.',
      meaning: 'Seller entity is preserved on import. Open AR and fee schedules only become connector rules when the cited PDFs and ledger rows support them.',
    },
    preview: {
      asOf: '2026-10-01T00:00:00.000Z',
      beforeBalanceCents: 0,
      afterBalanceCents: 1_240_000,
      operations: [
        { kind: 'ensure_customer', recordId: 'buyer-harbor-d22feb38e846', amountCents: 0, note: 'Harbor Clinics in parent books' },
        { kind: 'insert_invoice', recordId: 'INV-B-11', amountCents: 420_000, note: 'Harbor open invoice Sep 1' },
        { kind: 'insert_invoice', recordId: 'INV-B-12', amountCents: 210_000, note: 'Harbor open invoice Sep 15' },
        { kind: 'insert_invoice', recordId: 'INV-B-13', amountCents: 610_000, note: 'Pine Ortho partial balance' },
      ],
      coverage: [
        { accountId: 'cust-b-d22feb38e846-1', events: 9, evidence: 3, status: 'Covered' },
        { accountId: 'cust-b-pine-ortho-1', events: 4, evidence: 2, status: 'Covered' },
      ],
    },
    authorize: {
      connector: 'DASDummies import rules',
      profile: 'DASDummies matching profile',
      manifest: 'DASDummies evidence package',
      startingBalanceCents: 1_240_000,
      activationId: 'activation:dasdummies-harbor-local-demo-v1',
      receiptId: 'receipt:dasdummies-harbor-activation',
    },
    operate: {
      cutoverAsOf: '2026-10-01T00:00:00.000Z',
      currentAsOf: '2026-10-05T00:00:00.000Z',
      cutoverCents: 1_240_000,
      currentCents: 1_180_000,
      seller: 'Seller B',
      lines: companyBDemo.parentView.lines,
      syncPaymentCents: 60_000,
      syncPaymentLabel: '$600 Harbor payment applied',
      syncReceiptId: 'receipt:dasdummies-harbor-sync-600',
    },
  }),
];

export function getConnectionCompany(id: string): ConnectionCompany {
  return connectionCompanies.find(item => item.id === id) ?? connectionCompanies[0]!;
}

export function connectionCompanyOptions(allowedSourceRefs?: readonly string[]) {
  if (!allowedSourceRefs) return connectionCompanies;
  return connectionCompanies.filter(item => allowedSourceRefs.includes(item.sourceRef));
}

/** Per-account approval / sync beat shared across Authorize and Operate. */
export type ConnectionBeat = 'fresh' | 'approved' | 'synced' | 'replayed';

const beats = new Map<string, ConnectionBeat>();
const beatListeners = new Set<() => void>();

export function getConnectionBeat(accountId: string): ConnectionBeat {
  return beats.get(accountId) ?? 'fresh';
}

export function setConnectionBeat(accountId: string, next: ConnectionBeat) {
  beats.set(accountId, next);
  for (const listener of beatListeners) listener();
}

export function onConnectionBeatChange(listener: () => void) {
  beatListeners.add(listener);
  return () => { beatListeners.delete(listener); };
}

export function connectionBalanceCents(company: ConnectionCompany, asOf: string): number {
  const beat = getConnectionBeat(company.accountId);
  if (asOf <= company.operate.cutoverAsOf) return company.operate.cutoverCents;
  return beat === 'synced' || beat === 'replayed'
    ? company.operate.currentCents
    : company.operate.cutoverCents;
}

export const demoWorkspaceSession = {
  demoOnly: true as const,
  reviewer: { reviewerId: 'demo-reviewer', sessionId: 'connection-session' },
  allowedSourceRefs: connectionCompanies.map(item => item.sourceRef),
  allowedAccountIds: connectionCompanies.map(item => item.accountId),
};
