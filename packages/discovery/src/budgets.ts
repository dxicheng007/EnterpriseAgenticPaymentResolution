export const budgets = Object.freeze({
  attempts: 9, toolRounds: 8, specialists: 10, accountInvestigations: 20, repairs: 2, slots: 4,
});

export function safeCounter(value: string | number): number {
  if (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid database counter');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Unsafe database counter');
  return number;
}
