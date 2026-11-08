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

test('renders mirrored blocked rows and their diagnostics once without changing the response', () => {
  const diagnostic = {
    code: 'UNKNOWN_ACCOUNT', severity: 'blocker' as const, message: 'Source account has no approved identity',
    sourceIds: ['source-one'], fieldPaths: ['/account'],
  };
  const hold = { code: diagnostic.code, eventIds: ['evt:unmapped'], dependencies: ['dep:1'], diagnostics: [diagnostic] };
  const result: PreviewResponse = {
    artifact: null, diffs: [], parentWrites: 0,
    outcome: { holds: [hold], plans: [] }, unsupportedRows: [structuredClone(hold)],
    diagnostics: [structuredClone(diagnostic), { ...diagnostic, code: 'COMPILE', message: 'Compilation failed' }],
  };
  const original = structuredClone(result);
  const html = renderToStaticMarkup(createElement(PreviewResult, { result, evidenceRefs: [] }));
  expect(html.match(/Source events evt:unmapped/g)).toHaveLength(1);
  expect(html.match(/Blocker · UNKNOWN_ACCOUNT/g)).toHaveLength(1);
  expect(html).toContain('Records not mapped by the preview profiles');
  expect(html).toContain('Source account has no approved identity');
  expect(html).toContain('Sources source-one');
  expect(html).toContain('Fields /account');
  expect(html).toContain('Dependencies dep:1');
  expect(html).toContain('Additional diagnostics');
  expect(html).toContain('Compilation failed');
  expect(result).toEqual(original);
});

test('preserves unmatched occurrences and groups holds by the complete submitted scope', () => {
  const diagnostic = {
    code: 'UNKNOWN_ACCOUNT', severity: 'blocker' as const, message: 'Mapping missing',
    sourceIds: ['one', 'two'], fieldPaths: ['/first', '/second'],
  };
  const selected = {
    code: diagnostic.code, scope: profileA.scope, eventIds: ['evt:shared', 'evt:second'],
    dependencies: ['dep:first', 'dep:second'], diagnostics: [diagnostic],
  };
  const unresolved = ['SEMANTIC_VERSION', 'IDENTITY_SCOPE'].map(code => ({
    code, eventIds: ['evt:' + code], dependencies: [], diagnostics: [{ ...diagnostic, code }],
  }));
  const result: PreviewResponse = {
    artifact: null, diffs: [], parentWrites: 0,
    outcome: { plans: [], holds: [selected, selected, ...unresolved] },
    unsupportedRows: [
      selected, selected, selected,
      { ...selected, scope: { ...selected.scope, companyId: 'company-other' } },
      { ...selected, scope: { ...selected.scope, sellerEntityId: 'seller-other' } },
      { ...selected, scope: { ...selected.scope, accountId: 'account-other' } },
      { ...selected, diagnostics: [{ ...diagnostic, message: 'Different detail' }] },
      { ...selected, diagnostics: [{ ...diagnostic, severity: 'warning' }] },
      { ...selected, diagnostics: [{ ...diagnostic, sourceIds: ['two', 'one'] }] },
      { ...selected, diagnostics: [{ ...diagnostic, fieldPaths: ['/second', '/first'] }] },
      { ...selected, dependencies: ['dep:second', 'dep:first'] },
      { ...selected, eventIds: ['evt:second', 'evt:shared'] },
    ],
    diagnostics: [],
  };
  const props = { result, evidenceRefs: [] };
  const html = renderToStaticMarkup(createElement(PreviewResult, { ...props, profileScopes: [profileA.scope] }));
  expect(html).toContain('Unsupported rows (14)');
  expect(html).toContain('2 matching entries shown once.');
  expect(html).toContain('Selected customer issues (9)');
  expect(html).toContain('Other or unresolved scope issues (5)');
  expect(html).toContain('Blocker · SEMANTIC_VERSION');
  expect(html).toContain('Blocker · IDENTITY_SCOPE');
  expect(html).toContain('Warning · UNKNOWN_ACCOUNT');
  expect(html).toContain('Different detail');
  expect(html).not.toContain('Records not mapped by the preview profiles');
  const withoutProfiles = renderToStaticMarkup(createElement(PreviewResult, props));
  expect(withoutProfiles).not.toContain('Selected customer issues');
  expect(withoutProfiles).toContain('Other or unresolved scope issues (14)');
});

test('preserves extra global diagnostic occurrences and distinct diagnostic details', () => {
  const diagnostic = { code: 'UNKNOWN_ACCOUNT', severity: 'blocker' as const,
    message: 'Mapping missing', sourceIds: ['source'], fieldPaths: ['/account'] };
  const hold = { code: diagnostic.code, eventIds: ['evt:one'], dependencies: [], diagnostics: [diagnostic] };
  const result: PreviewResponse = {
    artifact: null, diffs: [], parentWrites: 0,
    outcome: { plans: [], holds: [hold] }, unsupportedRows: [hold],
    diagnostics: [diagnostic, diagnostic, { ...diagnostic, fieldPaths: ['/different'] }],
  };
  const html = renderToStaticMarkup(createElement(PreviewResult, { result, evidenceRefs: [] }));
  expect(html.match(/Blocker · UNKNOWN_ACCOUNT/g)).toHaveLength(3);
  expect(html).toContain('Additional diagnostics');
  expect(html).toContain('Fields /different');
});
