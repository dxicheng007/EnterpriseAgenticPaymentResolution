/** Frozen local-demo-v1 / demo-contract literals for offline UI responses. Money matches a real Company A run. */

export const stagedCompanyA = {
  companyId: 'company-a',
  sourceRef: 'legacy-a',
  seller: 'seller-a',
  accountId: 'company-a.seller-a.cust-a-d22feb38e846-1',
  sourceAccountId: 'cust-a-d22feb38e846-1',
  parentCustomer: 'buyer-shared-d22feb38e846',
  manifestId: 'manifest-a-d22feb38e846-d4e83b7db551',
  candidateId: 'demo-candidate-a',
  candidateLabel: 'Company A · Shared Buyer',
  profileId: 'demo-profile-a',
  profileVersion: 2,
  connectorId: 'demo-connector-a',
  connectorVersion: 1,
  catalogMode: 'development-fixture',
  targetMode: 'persisted-parent',
  cutoverAsOf: '2026-10-01T00:00:00.000Z',
  currentAsOf: '2026-10-03T00:00:00.000Z',
  cutoverCents: 80_000,
  currentCents: 50_000,
  parentWrites: 0,
  epoch: 1,
  activationId: 'activation:staged-company-a-local-demo-v1',
  activationReceiptId: 'receipt:staged-company-a-activation',
  syncReceiptId: 'receipt:staged-company-a-sync-300',
  controlMigration: 10,
  runtimeMigration: 7,
  injectPayment: {
    amount: '300.00',
    effectiveDate: '2026-10-03',
    observedAt: '2026-10-03T00:00:00.000Z',
    invoiceId: 'inv-a:cust-a-d22feb38e846-1-2026-09-01',
    command: 'npm run demo:inject -- freshPaymentA',
  },
  /** Human-facing labels. Machine IDs above stay for contracts/tests. */
  display: {
    company: 'Company A',
    customer: 'Shared Buyer',
    account: 'Shared Buyer · Account 1',
    source: 'Legacy billing system A',
    seller: 'Seller A',
    sourceAccount: 'Customer account 1',
    parentCustomer: 'Shared Buyer (books)',
    candidate: 'Company A · Shared Buyer',
    connector: 'Company A import rules',
    profile: 'Company A matching profile',
    manifest: 'Company A evidence package',
    catalogMode: 'Sample data',
    targetMode: 'Existing books',
    activation: 'Company A go-live',
    activationReceipt: 'Go-live confirmation',
    syncReceipt: '$300 payment sync',
    reviewer: 'Demo reviewer',
  },
} as const;

export const stagedWorkingSteps = [
  'Opening pinned source evidence…',
  'Reading captured records…',
  'Checking balances…',
  'Preparing the response…',
] as const;

const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Format an ISO timestamp for reviewers (UTC calendar day). */
export function formatDisplayDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateTime.format(date);
}

/** Shared beat so Parent/Operations stay consistent with approve → inject → replay. */
export type StagedBeat = 'fresh' | 'approved' | 'synced' | 'replayed';

let beat: StagedBeat = 'fresh';
const beatListeners = new Set<() => void>();

export function getStagedBeat(): StagedBeat {
  return beat;
}

export function setStagedBeat(next: StagedBeat) {
  beat = next;
  for (const listener of beatListeners) listener();
}

export function onStagedBeatChange(listener: () => void) {
  beatListeners.add(listener);
  return () => { beatListeners.delete(listener); };
}

export function stagedBalanceCents(asOf: string): number {
  if (asOf <= stagedCompanyA.cutoverAsOf) return stagedCompanyA.cutoverCents;
  return beat === 'synced' || beat === 'replayed'
    ? stagedCompanyA.currentCents
    : stagedCompanyA.cutoverCents;
}
