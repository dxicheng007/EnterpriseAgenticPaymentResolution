import type { EventKind, RawIdentity } from '../../../../../packages/contracts/src/common.js';
import type { CustomerProfile } from '../../../../../packages/contracts/src/connector.js';
import type { SourceCoverageEvent, SourceCoverageResponse } from '../../../../../packages/contracts/src/source-coverage.js';

function accountKey(seller?: string, account?: string): string {
  return JSON.stringify([seller, account]);
}

function eventMembership(events: readonly SourceCoverageEvent[]) {
  const eventIds: string[] = [];
  const financialEventIds: string[] = [];
  const semanticEventIds: string[] = [];
  const kindCounts: Partial<Record<EventKind, number>> = {};
  for (const { id, kind } of events) {
    eventIds.push(id);
    (kind === 'semantic_change' ? semanticEventIds : financialEventIds).push(id);
    kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
  }
  return { eventIds, financialEventIds, semanticEventIds, kindCounts };
}

export function summarizeSourceCoverage(coverage: SourceCoverageResponse, profiles: readonly CustomerProfile[]) {
  const profileByAccount = new Map<string, Pick<CustomerProfile, 'id' | 'hash'>[]>();
  for (const { sourceRef, scope, sourceAccountIds, id, hash } of profiles) {
    if (sourceRef !== coverage.sourceRef || scope.companyId !== coverage.companyId) continue;
    for (const account of sourceAccountIds) {
      const key = accountKey(scope.sellerEntityId, account);
      const matches = profileByAccount.get(key) ?? [];
      matches.push({ id, hash });
      profileByAccount.set(key, matches);
    }
  }

  const eventsByAccount = new Map<string, { rawIdentity: RawIdentity; events: SourceCoverageEvent[] }>();
  const selected: SourceCoverageEvent[] = [];
  const outside: SourceCoverageEvent[] = [];
  for (const event of coverage.events) {
    const { rawIdentity } = event;
    const key = accountKey(rawIdentity.sellerEntityId, rawIdentity.sourceAccountId);
    const group = eventsByAccount.get(key) ?? { rawIdentity, events: [] };
    group.events.push(event);
    eventsByAccount.set(key, group);
    (profileByAccount.has(key) ? selected : outside).push(event);
  }

  const documented = new Set<string>();
  let documentedOutsideCount = 0;
  const accounts = coverage.accounts.map(account => {
    const key = accountKey(account.sellerEntityId, account.sourceAccountId);
    documented.add(key);
    const membership = eventMembership(eventsByAccount.get(key)?.events ?? []);
    const matches = profileByAccount.get(key) ?? [];
    if (!matches.length) documentedOutsideCount += membership.eventIds.length;
    return { account, profiles: matches, ...membership };
  });
  const undocumented = [...eventsByAccount].filter(([key]) => !documented.has(key)).map(([key, group]) => ({
    key, rawIdentity: group.rawIdentity, profiles: profileByAccount.get(key) ?? [], ...eventMembership(group.events),
  }));
  return {
    accounts, undocumented, documentedOutsideCount,
    totalEvents: coverage.events.length, selected: eventMembership(selected), outside: eventMembership(outside),
  };
}

export type SourceCoverageSummary = ReturnType<typeof summarizeSourceCoverage>;
