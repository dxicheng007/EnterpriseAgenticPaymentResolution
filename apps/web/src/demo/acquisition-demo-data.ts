/** Narrative fixtures for the acquisition visibility demo. Machine IDs stay internal. */

export type DemoCompanyStatus =
  | 'unknown'
  | 'exploring'
  | 'mapped'
  | 'translating'
  | 'wired';

export type DemoAct =
  | 'portfolio'
  | 'explore'
  | 'dossier'
  | 'translate'
  | 'parent';

export type SourceSystem = {
  id: string;
  name: string;
  kind: 'billing' | 'ledger' | 'contracts' | 'payments';
  vendor: string;
  records: number;
  freshness: string;
};

export type SourceDocument = {
  id: string;
  title: string;
  kind: 'contract' | 'invoice' | 'statement' | 'amendment';
  asOf: string;
  amountLabel?: string;
};

export type SourceInvoice = {
  id: string;
  customer: string;
  issued: string;
  due: string;
  amountCents: number;
  status: 'open' | 'partial' | 'paid';
};

export type TranslationChunk = {
  id: string;
  sourceLabel: string;
  sourceSystem: string;
  targetLabel: string;
  targetSystem: string;
  rule: string;
  evidence: string;
  status: 'pending' | 'building' | 'locked';
};

export type DemoCompany = {
  id: 'company-a' | 'company-b';
  name: string;
  tagline: string;
  acquiredOn: string;
  unknownBlurb: string;
  financeStack: string;
  systems: readonly SourceSystem[];
  documents: readonly SourceDocument[];
  invoices: readonly SourceInvoice[];
  translations: readonly TranslationChunk[];
  dashboard: {
    openReceivablesCents: number;
    customers: number;
    contracts: number;
    monthlyRevenueCents: number;
  };
  parentView: {
    customer: string;
    seller: string;
    startingBalanceCents: number;
    currentBalanceCents: number;
    lastSyncLabel: string;
    lines: readonly {
      label: string;
      source: string;
      parent: string;
      amountCents: number;
    }[];
  };
};

export const parentCompany = {
  name: 'Northstar Holdings',
  viewer: 'Parent books',
  schema: 'Northstar AR v3',
} as const;

export const demoCompanies: readonly DemoCompany[] = [
  {
    id: 'company-a',
    name: 'Company A',
    tagline: 'Legacy SaaS billing · Shared Buyer book',
    acquiredOn: '2026-09-12',
    unknownBlurb: 'Status unknown. Systems, documents, and balances have not been explored yet.',
    financeStack: 'Legacy Billing A + contract PDFs',
    systems: [
      { id: 'a-billing', name: 'Legacy Billing A', kind: 'billing', vendor: 'In-house', records: 1842, freshness: 'Daily export' },
      { id: 'a-contracts', name: 'Contract vault', kind: 'contracts', vendor: 'Share drive', records: 46, freshness: 'Pinned PDFs' },
      { id: 'a-payments', name: 'Payment inbox', kind: 'payments', vendor: 'Bank CSV', records: 311, freshness: 'T+1' },
    ],
    documents: [
      { id: 'a-doc-1', title: 'Master services agreement · Shared Buyer', kind: 'contract', asOf: '2026-01-01', amountLabel: '$8,000 / mo' },
      { id: 'a-doc-2', title: 'Invoice INV-2026-09 · Shared Buyer', kind: 'invoice', asOf: '2026-09-01', amountLabel: '$8,000.00' },
      { id: 'a-doc-3', title: 'September cash application', kind: 'statement', asOf: '2026-09-30' },
      { id: 'a-doc-4', title: 'Q3 amendment · seat expansion', kind: 'amendment', asOf: '2026-07-15', amountLabel: '+$500 / mo' },
    ],
    invoices: [
      { id: 'INV-A-07', customer: 'Shared Buyer', issued: '2026-07-01', due: '2026-07-31', amountCents: 800_00, status: 'paid' },
      { id: 'INV-A-08', customer: 'Shared Buyer', issued: '2026-08-01', due: '2026-08-31', amountCents: 800_00, status: 'paid' },
      { id: 'INV-A-09', customer: 'Shared Buyer', issued: '2026-09-01', due: '2026-09-30', amountCents: 800_00, status: 'partial' },
      { id: 'INV-A-10', customer: 'Shared Buyer', issued: '2026-10-01', due: '2026-10-31', amountCents: 800_00, status: 'open' },
    ],
    translations: [
      {
        id: 'a-t1',
        sourceLabel: 'cust-a account row',
        sourceSystem: 'Legacy Billing A',
        targetLabel: 'Parent customer · Shared Buyer',
        targetSystem: 'Northstar AR',
        rule: 'Stable account id → parent customer id',
        evidence: 'MSA cover + billing export',
        status: 'pending',
      },
      {
        id: 'a-t2',
        sourceLabel: 'invoice.total (USD dollars)',
        sourceSystem: 'Legacy Billing A',
        targetLabel: 'invoice.amount_cents',
        targetSystem: 'Northstar AR',
        rule: 'Dollars → checked integer cents',
        evidence: 'INV-A-09 line totals',
        status: 'pending',
      },
      {
        id: 'a-t3',
        sourceLabel: 'payment.application',
        sourceSystem: 'Payment inbox',
        targetLabel: 'allocation → open invoice',
        targetSystem: 'Northstar AR',
        rule: 'Full payment reverses only matched allocation',
        evidence: 'September cash application',
        status: 'pending',
      },
      {
        id: 'a-t4',
        sourceLabel: 'MSA monthly fee',
        sourceSystem: 'Contract vault',
        targetLabel: 'supported recurring term',
        targetSystem: 'Connector profile',
        rule: 'Pinned contract amount, no silent inference',
        evidence: 'MSA § Fees',
        status: 'pending',
      },
    ],
    dashboard: {
      openReceivablesCents: 1_300_00,
      customers: 3,
      contracts: 4,
      monthlyRevenueCents: 800_00,
    },
    parentView: {
      customer: 'Shared Buyer',
      seller: 'Seller A (preserved)',
      startingBalanceCents: 800_00,
      currentBalanceCents: 500_00,
      lastSyncLabel: '$300 payment applied · Oct 3',
      lines: [
        { label: 'Open invoice Oct', source: 'INV-A-10', parent: 'AR invoice', amountCents: 800_00 },
        { label: 'Partial Sept remainder', source: 'INV-A-09', parent: 'AR balance', amountCents: 500_00 },
        { label: 'Oct 3 payment', source: 'Bank CSV', parent: 'Allocation', amountCents: -300_00 },
      ],
    },
  },
  {
    id: 'company-b',
    name: 'Company B',
    tagline: 'Regional ledger · multi-seller book',
    acquiredOn: '2026-09-18',
    unknownBlurb: 'Status unknown. Agent exploration has not opened this acquisition yet.',
    financeStack: 'Regional Ledger B + AP portal',
    systems: [
      { id: 'b-ledger', name: 'Regional Ledger B', kind: 'ledger', vendor: 'NetSuite-like', records: 920, freshness: 'API poll' },
      { id: 'b-billing', name: 'Seller B billing', kind: 'billing', vendor: 'Portal', records: 640, freshness: 'Hourly' },
      { id: 'b-contracts', name: 'Deal room', kind: 'contracts', vendor: 'PDF pack', records: 22, freshness: 'Pinned' },
    ],
    documents: [
      { id: 'b-doc-1', title: 'Seller B customer schedule', kind: 'contract', asOf: '2026-02-01', amountLabel: 'Tiered' },
      { id: 'b-doc-2', title: 'Ledger trial balance · Sep', kind: 'statement', asOf: '2026-09-30' },
      { id: 'b-doc-3', title: 'Invoice bundle · week 39', kind: 'invoice', asOf: '2026-09-26', amountLabel: '$12,400' },
    ],
    invoices: [
      { id: 'INV-B-11', customer: 'Harbor Clinics', issued: '2026-09-01', due: '2026-09-30', amountCents: 4_200_00, status: 'open' },
      { id: 'INV-B-12', customer: 'Harbor Clinics', issued: '2026-09-15', due: '2026-10-15', amountCents: 2_100_00, status: 'open' },
      { id: 'INV-B-13', customer: 'Pine Ortho', issued: '2026-09-20', due: '2026-10-20', amountCents: 6_100_00, status: 'partial' },
    ],
    translations: [
      {
        id: 'b-t1',
        sourceLabel: 'seller_entity_code',
        sourceSystem: 'Regional Ledger B',
        targetLabel: 'preserved seller entity',
        targetSystem: 'Northstar AR',
        rule: 'Acquisition does not reassign legal seller',
        evidence: 'Entity master',
        status: 'pending',
      },
      {
        id: 'b-t2',
        sourceLabel: 'invoice.balance_due',
        sourceSystem: 'Seller B billing',
        targetLabel: 'open AR cents',
        targetSystem: 'Northstar AR',
        rule: 'Balance due → integer cents, currency USD',
        evidence: 'Week 39 invoice bundle',
        status: 'pending',
      },
      {
        id: 'b-t3',
        sourceLabel: 'tiered fee table',
        sourceSystem: 'Deal room',
        targetLabel: 'supported fee schedule',
        targetSystem: 'Connector profile',
        rule: 'Only evidenced tiers become rules',
        evidence: 'Customer schedule PDF',
        status: 'pending',
      },
    ],
    dashboard: {
      openReceivablesCents: 12_400_00,
      customers: 2,
      contracts: 3,
      monthlyRevenueCents: 12_400_00,
    },
    parentView: {
      customer: 'Harbor Clinics',
      seller: 'Seller B (preserved)',
      startingBalanceCents: 12_400_00,
      currentBalanceCents: 12_400_00,
      lastSyncLabel: 'Awaiting first post-cutover sync',
      lines: [
        { label: 'Open AR Harbor', source: 'INV-B-11+12', parent: 'AR invoices', amountCents: 6_300_00 },
        { label: 'Open AR Pine', source: 'INV-B-13', parent: 'AR invoice', amountCents: 6_100_00 },
      ],
    },
  },
] as const;

export function getDemoCompany(id: string): DemoCompany {
  return demoCompanies.find(company => company.id === id) ?? demoCompanies[0]!;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatDemoMoney(cents: number): string {
  return money.format(cents / 100);
}

export const exploreSteps = [
  'Connecting to acquired systems…',
  'Indexing contracts and invoices…',
  'Reading financial schemas…',
  'Reconstructing customer identities…',
  'Assembling the company dossier…',
] as const;

export const translateSteps = [
  'Pinning evidenced source fields…',
  'Writing hard-coded translation rules…',
  'Checking integer-cent integrity…',
  'Dry-running against parent schema…',
  'Locking connector chunks…',
] as const;
