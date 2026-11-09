import { expect, it } from 'vitest';
import { budgets, safeCounter } from '../src/budgets.js';

it('pins durable ceilings and rejects unsafe database counters', () => {
  expect(budgets).toEqual({ attempts: 9, toolRounds: 8, specialists: 10, accountInvestigations: 20, repairs: 2, slots: 4 });
  expect(safeCounter('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  for (const invalid of ['9007199254740992', '-1', '1.5', '', '1e2']) {
    expect(() => safeCounter(invalid)).toThrow();
  }
});
