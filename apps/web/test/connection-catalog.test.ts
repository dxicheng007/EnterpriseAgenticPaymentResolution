import { describe, expect, it } from 'vitest';
import {
  connectionBalanceCents,
  connectionCompanies,
  getConnectionBeat,
  getConnectionCompany,
  setConnectionBeat,
} from '../src/demo/connection-catalog.js';

describe('connection catalog', () => {
  it('covers Company A and DASDummies with source explanations', () => {
    expect(connectionCompanies.map(item => item.name)).toEqual(['Company A', 'DASDummies']);
    for (const company of connectionCompanies) {
      expect(company.explanation.source.length).toBeGreaterThan(40);
      expect(company.explanation.records.length).toBeGreaterThan(40);
      expect(company.explanation.meaning.length).toBeGreaterThan(40);
      expect(company.systems.length).toBeGreaterThan(0);
      expect(company.invoices.length).toBeGreaterThan(0);
      expect(company.preview.operations.length).toBeGreaterThan(0);
    }
  });

  it('tracks per-account approval and sync balances', () => {
    const company = getConnectionCompany('company-b');
    setConnectionBeat(company.accountId, 'fresh');
    expect(getConnectionBeat(company.accountId)).toBe('fresh');
    expect(connectionBalanceCents(company, company.operate.currentAsOf)).toBe(company.operate.cutoverCents);
    setConnectionBeat(company.accountId, 'synced');
    expect(connectionBalanceCents(company, company.operate.currentAsOf)).toBe(company.operate.currentCents);
  });
});
