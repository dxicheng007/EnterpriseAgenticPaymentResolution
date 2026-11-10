/** Frozen demo-contract literals for staged UI only. Not live worker receipts. */

export const stagedCompanyA = {
  label: 'Staged demo responses · development fixture',
  disclaimer: 'These screens use hardcoded Company A fixture outcomes for walkthrough timing. They are not live service receipts and do not move money.',
  companyId: 'company-a',
  sourceRef: 'legacy-a',
  seller: 'seller-a',
  accountId: 'company-a.seller-a.cust-a-d22feb38e846-1',
  sourceAccountId: 'cust-a-d22feb38e846-1',
  manifestId: 'manifest-a-d22feb38e846-d4e83b7db551',
  candidateId: 'demo-candidate-a',
  profileId: 'demo-profile-a',
  cutoverAsOf: '2026-10-01T00:00:00.000Z',
  currentAsOf: '2026-10-03T00:00:00.000Z',
  cutoverCents: 80_000,
  currentCents: 50_000,
  parentWrites: 0,
  activationId: 'staged-activation-company-a',
  receiptId: 'staged-receipt-company-a-cutover',
  syncReceiptId: 'staged-receipt-company-a-sync-300',
  epoch: 1,
  artifactHash: 'staged-artifact-hash-company-a',
  profileHash: 'staged-profile-hash-company-a',
  packageHash: 'staged-package-hash-company-a',
  injectPayment: {
    amount: '300.00',
    effectiveDate: '2026-10-03',
    invoiceId: 'inv-a:cust-a-d22feb38e846-1-2026-09-01',
  },
} as const;

export const stagedWorkingSteps = [
  'Opening the pinned development fixture…',
  'Reading captured source evidence…',
  'Checking integer-cent balances…',
  'Preparing the staged walkthrough response…',
] as const;
