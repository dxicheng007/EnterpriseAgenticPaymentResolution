import { describe, expect, it } from 'vitest';
import {
  demoCompanies,
  formatDemoMoney,
  getDemoCompany,
  parentCompany,
} from '../src/demo/acquisition-demo-data.js';

describe('acquisition demo fixtures', () => {
  it('ships two acquired companies with unknown-to-wired narrative material', () => {
    expect(demoCompanies).toHaveLength(2);
    expect(demoCompanies[0]?.name).toBe('Company A');
    expect(demoCompanies[1]?.name).toBe('Company B');
    expect(parentCompany.name).toBe('Northstar Holdings');
    for (const company of demoCompanies) {
      expect(company.systems.length).toBeGreaterThan(0);
      expect(company.documents.length).toBeGreaterThan(0);
      expect(company.translations.length).toBeGreaterThan(0);
      expect(company.parentView.lines.length).toBeGreaterThan(0);
    }
  });

  it('formats demo money and resolves companies', () => {
    expect(formatDemoMoney(80_000)).toBe('$800.00');
    expect(getDemoCompany('company-b').name).toBe('Company B');
    expect(getDemoCompany('missing').id).toBe('company-a');
  });
});
