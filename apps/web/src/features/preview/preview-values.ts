import type { Diagnostic, Hold, Scope } from '../../../../../packages/contracts/src/common.js';
import type { PreviewResponse } from '../../../../../packages/contracts/src/runtime.js';
import type { SourceCoverageSummary } from './source-coverage-values.js';


const dollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatUsdCents(cents: number): string {
  const magnitude = BigInt(Math.abs(cents));
  const whole = dollars.format(magnitude / 100n);
  const fraction = String(magnitude % 100n).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}$${whole}.${fraction}`;
}

export function recordField(record: object, pointer: string): unknown {
  if (pointer === '') return record;
  let value: unknown = record;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function scopeKey(scope: Scope): string {
  return JSON.stringify([scope.companyId, scope.sellerEntityId, scope.accountId]);
}

function diagnosticKey(item: Diagnostic): string {
  return JSON.stringify([item.code, item.severity, item.message, item.sourceIds, item.fieldPaths]);
}

function holdKey(hold: Hold): string {
  return JSON.stringify([
    hold.code, hold.scope && scopeKey(hold.scope), hold.eventIds, hold.dependencies,
    hold.diagnostics.map(diagnosticKey),
  ]);
}

function unmatched<T>(items: T[], displayed: T[], key: (item: T) => string): T[] {
  const counts = new Map<string, number>();
  for (const item of displayed) {
    const id = key(item);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return items.filter(item => {
    const id = key(item);
    const count = counts.get(id) ?? 0;
    if (count === 0) return true;
    counts.set(id, count - 1);
    return false;
  });
}

export function previewIssues(result: PreviewResponse, profileScopes: readonly Scope[]) {
  const { holds } = result.outcome;
  const unmatchedRows = unmatched(result.unsupportedRows, holds, holdKey);
  const consolidated = [...holds, ...unmatchedRows];
  const selectedScopes = new Set(profileScopes.map(scopeKey));
  const selected: Hold[] = [];
  const unmapped: Hold[] = [];
  const unresolved: Hold[] = [];
  for (const hold of consolidated) {
    if (hold.scope && selectedScopes.has(scopeKey(hold.scope))) selected.push(hold);
    else if (!hold.scope && hold.code === 'UNKNOWN_ACCOUNT') unmapped.push(hold);
    else unresolved.push(hold);
  }

  return {
    count: consolidated.length,
    matched: result.unsupportedRows.length - unmatchedRows.length,
    selected, unmapped, unresolved,
    additional: unmatched(result.diagnostics, consolidated.flatMap(hold => hold.diagnostics), diagnosticKey),
  };
}

type AccountReference = { label: string; eventCount: number };

export function partitionPreviewHolds(issues: ReturnType<typeof previewIssues>, coverage?: SourceCoverageSummary) {
  const accountsByEvent = new Map<string, SourceCoverageSummary['accounts'][number]>();
  const seen = new Set<string>();
  for (const row of coverage?.accounts ?? []) {
    for (const id of row.eventIds) {
      if (seen.has(id) || row.profiles.length || !row.account.identityEvidenceRefs.length) accountsByEvent.delete(id);
      else accountsByEvent.set(id, row);
      seen.add(id);
    }
  }
  for (const row of coverage?.undocumented ?? []) {
    for (const id of row.eventIds) accountsByEvent.delete(id);
  }

  const otherAccounts: Hold[] = [];
  const investigation = [...issues.unresolved];
  const accountReferences = new Map<Hold, AccountReference[]>();
  for (const hold of issues.unmapped) {
    const ids = new Set(hold.eventIds);
    const accounts = [...ids].map(id => accountsByEvent.get(id));
    if (hold.scope || hold.code !== 'UNKNOWN_ACCOUNT' || !ids.size ||
      !accounts.every(row => row !== undefined) ||
      hold.diagnostics.some(item => item.code !== 'UNKNOWN_ACCOUNT' || item.sourceIds.some(id => !ids.has(id)))) {
      investigation.push(hold);
      continue;
    }

    const counts = new Map<SourceCoverageSummary['accounts'][number], number>();
    for (const row of accounts) counts.set(row, (counts.get(row) ?? 0) + 1);
    otherAccounts.push(hold);
    accountReferences.set(hold, [...counts].map(([{ account }, eventCount]) => ({
      label: account.displayName + ' · ' + account.sellerEntityId + ' / ' + account.sourceAccountId, eventCount,
    })));
  }

  return { selected: issues.selected, otherAccounts, investigation, accountReferences };
}
