import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile } from '@eapr/compiler/compile';
import { baselineManifestA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import type { PreviewResponse } from '../../contracts/src/runtime.js';
import { PreviewResult } from '../../../apps/web/src/features/preview/PreviewResult.js';
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

test('exposes different parameters of the same transform even when the target value is identical', () => {
  const compiled = compile(validSpecA, [profileA]);
  if (!compiled.ok) throw new Error('Development fixture must compile');
  const result: PreviewResponse = {
    artifact: compiled.value, diffs: [], unsupportedRows: [], diagnostics: [], parentWrites: 0,
    outcome: {
      holds: [],
      plans: [{
        hash: 'a'.repeat(64), scope: profileA.scope, artifactHash: compiled.value.hash, profileHash: profileA.hash,
        expectedTargetVersion: 0, eventIds: [], expectedBalanceCents: 0, asOf: baselineManifestA.asOf,
        operations: [
          { op: 'ensure_customer', record: { id: 'buyer-one', displayName: 'buyer', evidenceRefs: ['ev-one'] } },
          { op: 'ensure_customer', record: { id: 'buyer-two', displayName: 'buyer', evidenceRefs: ['ev-two'] } },
        ],
        lineage: (['trim', 'lower'] as const).map((mode, operationIndex) => ({
          operationIndex, targetField: '/displayName', sourceEventIds: [], sourcePaths: ['/name'],
          evidenceRefs: [operationIndex === 0 ? 'ev-one' : 'ev-two'], derivationInputs: [],
          mapping: { op: 'normalize_text', path: '/name', mode },
        })),
      }],
    },
  };
  const html = renderToStaticMarkup(createElement(PreviewResult, { result, evidenceRefs: [] }));
  expect(html).toContain('&quot;mode&quot;: &quot;trim&quot;');
  expect(html).toContain('&quot;mode&quot;: &quot;lower&quot;');
  expect(html).toContain('<code>/name</code> → <code>normalize_text</code> → <code>/displayName</code>');
  expect(html).toContain('View citation ev-one');
  expect(html).toContain('View citation ev-two');
});
