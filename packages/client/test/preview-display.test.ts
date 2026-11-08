import { expect, test } from 'vitest';
import { formatUsdCents, recordField } from '../../../apps/web/src/features/preview/preview-values.js';

test('formats the returned signed integer cents exactly at the safe integer boundary', () => {
  expect(formatUsdCents(80000)).toBe('$800.00');
  expect(formatUsdCents(-5)).toBe('-$0.05');
  expect(formatUsdCents(Number.MAX_SAFE_INTEGER)).toBe('$90,071,992,547,409.91');
});

test('resolves a lineage pointer within the operation record', () => {
  const record = { id: 'record-1', scope: { 'account/id': 'account-1' }, amountCents: 0 };
  expect(recordField(record, '/scope/account~1id')).toBe('account-1');
  expect(recordField(record, '/amountCents')).toBe(0);
  expect(recordField(record, '/constructor')).toBeUndefined();
  expect(recordField(record, '/record/id')).toBeUndefined();
});
