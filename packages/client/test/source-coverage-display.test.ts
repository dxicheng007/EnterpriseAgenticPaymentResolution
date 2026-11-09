import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { Hold } from '../../contracts/src/common.js';
import type { CustomerProfile } from '../../contracts/src/connector.js';
import type { PreviewResponse } from '../../contracts/src/runtime.js';
import type { SourceCoverageResponse, SourceCoverageEvent } from '../../contracts/src/source-coverage.js';
import { profileA, profileB } from '../../../tests/fixtures/index.js';
import { SourceCoverage } from '../../../apps/web/src/features/preview/SourceCoverage.js';
import { PreviewResult } from '../../../apps/web/src/features/preview/PreviewResult.js';
import { summarizeSourceCoverage } from '../../../apps/web/src/features/preview/source-coverage-values.js';

function example(profile: CustomerProfile, counts: [number, number, number], extraKind?: SourceCoverageEvent['kind']) {
  const { companyId, sellerEntityId } = profile.scope;
  const accounts = [profile.sourceAccountIds[0]!, 'second', 'third'].map((sourceAccountId, index) => ({
    sellerEntityId, sourceAccountId, sourceBuyerId: 'buyer-' + index,
    displayName: index === 0 ? 'Selected customer' : 'Northstar',
    identityEvidenceRefs: ['citation-' + index], relatedEvidenceRefs: index === 1 ? ['amendment'] : [],
  }));
  const events: SourceCoverageEvent[] = accounts.flatMap((account, index) =>
    Array.from({ length: counts[index]! }, (_, eventIndex) => ({
      id: `event-${index}-${eventIndex}`,
      kind: extraKind === 'semantic_change' && index === 1 && eventIndex === 0 ? 'semantic_change' : 'invoice',
      rawIdentity: { companyId, sellerEntityId, sourceAccountId: account.sourceAccountId },
    })));
  if (extraKind === 'payment') events.push({
    id: 'event-unresolved', kind: 'payment', rawIdentity: { companyId, sellerEntityId, sourceAccountId: 'unresolved' },
  });
  return {
    companyId, sourceRef: profile.sourceRef, manifestHash: 'a'.repeat(64),
    snapshot: {
      id: 'snapshot:manifest', manifestId: 'manifest', sourceRef: profile.sourceRef,
      capturedAt: '2026-11-08T00:00:00.000Z', contentHash: 'b'.repeat(64),
      evidenceIds: accounts.flatMap(account => [...account.identityEvidenceRefs, ...account.relatedEvidenceRefs]),
      eventIds: events.map(event => event.id),
    },
    derivation: 'captured-source-rules-v1', accounts, events, diagnostics: [],
  } satisfies SourceCoverageResponse;
}

test('keeps same-name accounts distinct and reconciles selected and outside financial and semantic event IDs', () => {
  const coverage = example(profileA, [11, 10, 9], 'semantic_change');
  const summary = summarizeSourceCoverage(coverage, [profileA]);
  expect(summary.totalEvents).toBe(30);
  expect(summary.selected.eventIds).toHaveLength(11);
  expect(summary.outside.eventIds).toHaveLength(19);
  expect(summary.outside.financialEventIds).toHaveLength(18);
  expect(summary.outside.semanticEventIds).toEqual(['event-1-0']);
  expect(summary.accounts.map(row => [row.account.displayName, row.account.sourceBuyerId, row.eventIds.length]))
    .toEqual([['Selected customer', 'buyer-0', 11], ['Northstar', 'buyer-1', 10], ['Northstar', 'buyer-2', 9]]);
  expect(summary.accounts[0]?.profiles).toEqual([{ id: profileA.id, hash: profileA.hash }]);
  expect(summary.accounts[1]?.profiles).toEqual([]);
  expect(summary.accounts[1]?.kindCounts).toEqual({ invoice: 9, semantic_change: 1 });
});

test('keeps profile membership separate from documented identity, including conflicts on the same raw key', () => {
  const coverage = example(profileB, [9, 9, 9], 'payment');
  const baseline = summarizeSourceCoverage(coverage, [profileB]);
  expect(baseline.totalEvents).toBe(28);
  expect(baseline.selected.eventIds).toHaveLength(9);
  expect(baseline.outside.eventIds).toHaveLength(19);
  expect(baseline.documentedOutsideCount).toBe(18);
  expect(baseline.undocumented[0]?.eventIds).toEqual(['event-unresolved']);
  const unresolvedProfile = { ...profileB, sourceAccountIds: ['unresolved'] };
  const summary = summarizeSourceCoverage(coverage, [profileB, unresolvedProfile,
    { ...unresolvedProfile, id: 'second-profile' },
  ]);
  expect(summary.selected.eventIds).toHaveLength(10);
  expect(summary.outside.eventIds).toHaveLength(18);
  expect(summary.undocumented[0]?.profiles).toHaveLength(2);
  expect(summary.undocumented[0]?.eventIds).toEqual(['event-unresolved']);
  expect(summary.documentedOutsideCount).toBe(18);
  const html = renderToStaticMarkup(createElement(SourceCoverage, { response: coverage, summary, retry() {} }));
  expect(html).toContain('Source identity unresolved');
  expect(html).toContain('Profile conflict. Multiple profiles in this candidate match the same source account.');
  expect(html).toContain('Separate construction and verification needed.');
  expect(html).not.toMatch(/ready to import|eligible|parentCustomerId/);
});

test('matches only exact source, company, seller, and source account IDs', () => {
  const coverage = example(profileA, [11, 10, 9]);
  const summary = summarizeSourceCoverage(coverage, [
    { ...profileA, sourceRef: 'foreign-source' },
    { ...profileA, scope: { ...profileA.scope, companyId: 'foreign-company' } },
    { ...profileA, scope: { ...profileA.scope, sellerEntityId: 'foreign-seller' } },
    { ...profileA, scope: { ...profileA.scope, accountId: profileA.sourceAccountIds[0]! }, sourceAccountIds: [] },
  ]);
  expect(summary.selected.eventIds).toEqual([]);
  expect(summary.accounts.every(row => row.profiles.length === 0)).toBe(true);
});

function held(code: string, eventIds: string[], scope?: Hold['scope']): Hold {
  return { code, eventIds, scope, dependencies: ['dep:1'],
    diagnostics: [{ code, severity: 'blocker', message: 'Original ' + code, sourceIds: eventIds, fieldPaths: [] }] };
}

test('references every documented group from one raw hold and preserves other blockers and unmatched alias rows', () => {
  const summary = summarizeSourceCoverage(example(profileA, [11, 10, 9]), [profileA]);
  const grouped = held('UNKNOWN_ACCOUNT', ['event-1-0', 'event-2-0']);
  const semantic = held('SEMANTIC_VERSION', ['event-1-1']);
  const identity = held('IDENTITY_SCOPE', ['event-2-1']);
  const selected = held('UNKNOWN_ACCOUNT', ['event-0-0'], profileA.scope);
  const result: PreviewResponse = {
    artifact: null, parentWrites: 0, diffs: [],
    outcome: { plans: [], holds: [grouped, semantic, selected] },
    unsupportedRows: [structuredClone(grouped), identity],
    diagnostics: [...grouped.diagnostics, ...held('SOURCE_EPOCH_CONFLICT', []).diagnostics],
  };
  const before = structuredClone(result);
  const props = { result, evidenceRefs: [], profileScopes: [profileA.scope] };
  const markup = renderToStaticMarkup(createElement(PreviewResult, { ...props, coverage: summary }));
  expect(markup).toContain('Unsupported rows (4)');
  expect(markup).toContain('1 matching entry shown once.');
  expect(markup.match(/Northstar/g)).toHaveLength(2);
  expect(markup.match(/Source events event-1-0, event-2-0/g)).toHaveLength(1);
  expect(markup.match(/Blocker · UNKNOWN_ACCOUNT/g)).toHaveLength(2);
  expect(markup).toContain('Selected customer issues (1)');
  expect(markup).toContain('Other or unresolved scope issues (2)');
  expect(markup).toContain('Blocker · SEMANTIC_VERSION');
  expect(markup).toContain('Blocker · IDENTITY_SCOPE');
  expect(markup).toContain('Blocker · SOURCE_EPOCH_CONFLICT');
  expect(markup).not.toMatch(/ready to import|eligible/);
  expect(result).toEqual(before);
  const fallback = renderToStaticMarkup(createElement(PreviewResult, props));
  expect(fallback).toContain('Records not mapped by these profiles.');
  expect(fallback).not.toContain('Northstar');
  expect(fallback).toContain('Original UNKNOWN_ACCOUNT');
});
