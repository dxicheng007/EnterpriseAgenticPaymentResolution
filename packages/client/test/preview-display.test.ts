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
  const html = renderToStaticMarkup(createElement(PreviewResult, { result, evidenceRefs: [], asOf: baselineManifestA.asOf }));
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
  const html = renderToStaticMarkup(createElement(PreviewResult, { result, evidenceRefs: [], asOf: baselineManifestA.asOf }));
  expect(html.match(/Source events evt:unmapped/g)).toHaveLength(1);
  expect(html.match(/Blocker · UNKNOWN_ACCOUNT/g)).toHaveLength(1);
  expect(html).toContain('Records not mapped by these profiles. Source-account ownership has not been established for this explanation.');
  expect(html).toContain('Source account has no approved identity');
  expect(html).toContain('Sources source-one');
  expect(html).toContain('Fields /account');
  expect(html).toContain('Dependencies dep:1');
  expect(html).toContain('Preview-wide and additional issues');
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
  const props = { result, evidenceRefs: [], asOf: baselineManifestA.asOf };
  const html = renderToStaticMarkup(createElement(PreviewResult, { ...props, profileScopes: [profileA.scope] }));
  expect(html).toContain('Technical hold details');
  expect(html).toContain('Returned as 4 hold entries and 12 unsupported rows.');
  expect(html).toContain('2 matching entries shown once.');
  expect(html).toContain('Issues affecting this customer');
  expect(html).toContain('9 hold entries affecting 2 distinct source events');
  expect(html).toContain('Records needing investigation');
  expect(html).toContain('5 hold entries affecting 4 distinct source events');
  expect(html).toContain('Blocker · SEMANTIC_VERSION');
  expect(html).toContain('Blocker · IDENTITY_SCOPE');
  expect(html).toContain('Warning · UNKNOWN_ACCOUNT');
  expect(html).toContain('Different detail');
  expect(html).not.toContain('Other accounts needing connectors');
  const withoutProfiles = renderToStaticMarkup(createElement(PreviewResult, props));
  expect(withoutProfiles).not.toContain('Issues affecting');
  expect(withoutProfiles).toContain('14 hold entries affecting 4 distinct source events');
  const multipleProfiles = renderToStaticMarkup(createElement(PreviewResult, {
    ...props, profileScopes: [profileA.scope, { ...profileA.scope, accountId: 'other' }],
  }));
  expect(multipleProfiles).toContain('Records not included in this preview');
  expect(multipleProfiles).toContain('Issues affecting the selected customers');
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
  const html = renderToStaticMarkup(createElement(PreviewResult, { result, evidenceRefs: [], asOf: baselineManifestA.asOf }));
  expect(html.match(/Blocker · UNKNOWN_ACCOUNT/g)).toHaveLength(3);
  expect(html).toContain('Preview-wide and additional issues');
  expect(html).toContain('Fields /different');
});

test.each([80_000, 51_209])('explains the returned receivable at the supplied cutover for %i cents', afterBalanceCents => {
  const asOf = '2026-12-09T00:00:00.000Z';
  const result: PreviewResponse = {
    artifact: null, outcome: { plans: [], holds: [] }, unsupportedRows: [], diagnostics: [], parentWrites: 0,
    diffs: [{ scope: profileA.scope, beforeVersion: 7, beforeBalanceCents: 0, afterBalanceCents, operations: [], lineage: [] }],
  };
  const props = { result, evidenceRefs: [], asOf };
  const html = renderToStaticMarkup(createElement(PreviewResult, { ...props, targetMode: 'empty-fixture' }));
  expect(html).toContain('Amount still owed after proposed import');
  expect(html).toContain(formatUsdCents(afterBalanceCents));
  expect(html).toContain(`Unpaid invoice amount as of ${asOf}, after applying payments and credits allocated to those invoices. Unallocated payments and credits do not reduce this amount.`);
  expect(html).toContain('Empty demo target before import');
  expect(html).toContain('The demo target starts empty. Its starting balance does not describe the acquired customer');
  expect(html).toContain('Target version 7');
  expect(html).toContain('Preview only. No records have been imported.');
  expect(html).toContain('Parent writes: 0');
  const nonempty = renderToStaticMarkup(createElement(PreviewResult, {
    ...props, result: { ...result, diffs: [{ ...result.diffs[0]!, beforeBalanceCents: 4_321 }] },
  }));
  expect(nonempty).toContain('Target balance before proposed import');
  expect(nonempty).toContain('$43.21');
  expect(nonempty).not.toContain('Empty demo target');
  expect(nonempty).not.toContain('The demo target starts empty.');
});
