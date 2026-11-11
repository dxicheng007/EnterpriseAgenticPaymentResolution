import { afterEach, describe, expect, it } from 'vitest';
import {
  getStagedBeat,
  setStagedBeat,
  stagedBalanceCents,
  stagedCompanyA,
} from '../src/demo/staged-company-a.js';

describe('staged Company A walkthrough literals', () => {
  afterEach(() => {
    setStagedBeat('fresh');
  });

  it('matches demo-contract Company A identities and cents', () => {
    expect(stagedCompanyA.companyId).toBe('company-a');
    expect(stagedCompanyA.sourceRef).toBe('legacy-a');
    expect(stagedCompanyA.accountId).toBe('company-a.seller-a.cust-a-d22feb38e846-1');
    expect(stagedCompanyA.parentCustomer).toBe('buyer-shared-d22feb38e846');
    expect(stagedCompanyA.manifestId).toBe('manifest-a-d22feb38e846-d4e83b7db551');
    expect(stagedCompanyA.candidateId).toBe('demo-candidate-a');
    expect(stagedCompanyA.connectorId).toBe('demo-connector-a');
    expect(stagedCompanyA.cutoverCents).toBe(80_000);
    expect(stagedCompanyA.currentCents).toBe(50_000);
    expect(stagedCompanyA.parentWrites).toBe(0);
    expect(stagedCompanyA.injectPayment.command).toBe('npm run demo:inject -- freshPaymentA');
    expect(stagedCompanyA.activationId.startsWith('activation:')).toBe(true);
    expect(stagedCompanyA.activationReceiptId.startsWith('receipt:')).toBe(true);
    expect(stagedCompanyA.syncReceiptId.startsWith('receipt:')).toBe(true);
    expect('disclaimer' in stagedCompanyA).toBe(false);
    expect('label' in stagedCompanyA).toBe(false);
    expect(stagedCompanyA.display.customer).toBe('Shared Buyer');
    expect(stagedCompanyA.display.account).toBe('Shared Buyer · Account 1');
    expect(stagedCompanyA.candidateLabel).toBe('Company A · Shared Buyer');
  });

  it('formats balance dates for reviewers', async () => {
    const { formatDisplayDate } = await import('../src/demo/staged-company-a.js');
    expect(formatDisplayDate(stagedCompanyA.cutoverAsOf)).toBe('Oct 1, 2026');
    expect(formatDisplayDate(stagedCompanyA.currentAsOf)).toBe('Oct 3, 2026');
  });

  it('keeps cutover and pre-inject current at 80000 until sync', () => {
    expect(getStagedBeat()).toBe('fresh');
    expect(stagedBalanceCents(stagedCompanyA.cutoverAsOf)).toBe(80_000);
    expect(stagedBalanceCents(stagedCompanyA.currentAsOf)).toBe(80_000);

    setStagedBeat('approved');
    expect(stagedBalanceCents(stagedCompanyA.currentAsOf)).toBe(80_000);

    setStagedBeat('synced');
    expect(stagedBalanceCents(stagedCompanyA.cutoverAsOf)).toBe(80_000);
    expect(stagedBalanceCents(stagedCompanyA.currentAsOf)).toBe(50_000);

    setStagedBeat('replayed');
    expect(stagedBalanceCents(stagedCompanyA.currentAsOf)).toBe(50_000);
  });
});
