import type { InputClassification } from '@eapr/compiler/plan-batch';

export const MAX_INBOX_EVENTS = 1000;
export const MAX_DEPENDENCY_EXAMINATIONS = 3;
export const TRANSPORT_BACKOFF_MS = [1000, 2000, 4000] as const;

export type DependencyOutcome = 'pending_dependency' | 'quarantined';

export class DependencyError extends Error {
  constructor(
    readonly code: 'DEPENDENCY_CYCLE' | 'DEPENDENCY_CLOSURE_TOO_LARGE' | 'DEPENDENCY_INPUT_INVALID', message: string,
  ) {
    super(message);
    this.name = 'DependencyError';
  }
}

type Ordered = { eventId: string; streamId: string; sequence: number };

/** Stable inbox order: stream, numeric sequence, event id. */
export function compareInbox(left: Ordered, right: Ordered): number {
  return left.streamId < right.streamId ? -1 : left.streamId > right.streamId ? 1
    : left.sequence - right.sequence
      || (left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0);
}

/** Takes whole groups in order until the next would exceed the limit; never splits a group. */
export function selectGroups<T extends Ordered>(groups: T[][], limit = MAX_INBOX_EVENTS): T[][] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_INBOX_EVENTS) {
    throw new DependencyError('DEPENDENCY_INPUT_INVALID', 'Dependency selection limit is outside the supported range');
  }
  const selected: T[][] = [];
  let used = 0;
  for (const group of groups) {
    if (group.length > limit) throw new DependencyError('DEPENDENCY_CLOSURE_TOO_LARGE', 'Dependency group exceeds the cycle limit');
    if (used + group.length > limit) break;
    selected.push([...group].sort(compareInbox));
    used += group.length;
  }
  return selected;
}

/** Input indexes whose financial prerequisite is absent from the target and from this batch. */
export function missingPrerequisites(items: InputClassification[]): Map<number, string[]> {
  const missing = new Map<number, string[]>();
  for (const item of items) {
    if (!('mapped' in item) || !item.mapped) continue;
    const ids = item.mapped.prerequisites.filter(value => value.presence.kind === 'missing').map(value => value.targetRecordId);
    if (ids.length) missing.set(item.inputIndex, ids);
  }
  return missing;
}

/** Orders trusted classifier output with every referenced mapped provider supplied, including held candidates. */
export function dependencyOrder(items: InputClassification[]): number[] {
  const edges = new Map<number, Set<number>>();
  for (const item of items) {
    if (!('mapped' in item) || !item.mapped) continue;
    if (!Number.isSafeInteger(item.inputIndex) || item.inputIndex < 0 || edges.has(item.inputIndex)) {
      throw new DependencyError('DEPENDENCY_INPUT_INVALID', 'Dependency input index is invalid or duplicated');
    }
    const providers = new Set<number>();
    for (const value of item.mapped.prerequisites) {
      if (value.presence.kind === 'candidate') {
        for (const index of value.presence.providerInputIndexes) providers.add(index);
      }
    }
    edges.set(item.inputIndex, providers);
  }
  for (const providers of edges.values()) {
    for (const provider of providers) {
      if (!edges.has(provider)) {
        throw new DependencyError('DEPENDENCY_INPUT_INVALID', 'Dependency provider is absent from the mapped inputs');
      }
    }
  }
  const order: number[] = [];
  const state = new Map<number, 'visiting' | 'done'>();
  const visit = (index: number) => {
    const current = state.get(index);
    if (current === 'done') return;
    if (current === 'visiting') throw new DependencyError('DEPENDENCY_CYCLE', 'Dependency identities form a cycle');
    state.set(index, 'visiting');
    for (const provider of [...edges.get(index)!].sort((a, b) => a - b)) visit(provider);
    state.set(index, 'done');
    order.push(index);
  };
  for (const index of [...edges.keys()].sort((a, b) => a - b)) visit(index);
  return order;
}

/** Distinct persisted examinations: the third unresolved examination quarantines. */
export function dependencyOutcome(examinations: number): DependencyOutcome {
  return examinations >= MAX_DEPENDENCY_EXAMINATIONS ? 'quarantined' : 'pending_dependency';
}

export function transportBackoff(attempt: number): number | null {
  return TRANSPORT_BACKOFF_MS[attempt] ?? null;
}
