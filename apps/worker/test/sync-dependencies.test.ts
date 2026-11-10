import { expect, test } from 'vitest';
import type { InputClassification } from '@eapr/compiler/plan-batch';
import {
  DependencyError, dependencyOrder, dependencyOutcome, missingPrerequisites, selectGroups, transportBackoff,
} from '../src/sync/dependencies.js';

const item = (inputIndex: number, presences: Array<{ kind: 'target' | 'missing' } | { kind: 'candidate'; providerInputIndexes: number[] }>) => ({
  inputIndex, disposition: 'financial_new',
  mapped: {
    prerequisites: presences.map((presence, index) => ({ relation: 'allocation_funding', targetRecordId: `rec-${inputIndex}-${index}`, presence })),
  },
}) as unknown as InputClassification;

test('orders providers before consumers and reports missing prerequisites', () => {
  const items = [
    item(0, [{ kind: 'candidate', providerInputIndexes: [2] }, { kind: 'target' }]),
    item(1, [{ kind: 'missing' }]),
    item(2, []),
  ];
  expect(dependencyOrder(items)).toEqual([2, 0, 1]);
  expect([...missingPrerequisites(items)]).toEqual([[1, ['rec-1-0']]]);
});

test('cycles are explicit exceptions', () => {
  const items = [
    item(0, [{ kind: 'candidate', providerInputIndexes: [1] }]),
    item(1, [{ kind: 'candidate', providerInputIndexes: [0] }]),
  ];
  expect(() => dependencyOrder(items)).toThrow(DependencyError);
});

test('selection never splits a group and keeps stable order', () => {
  const event = (eventId: string, sequence: number, streamId = 's') => ({ eventId, sequence, streamId });
  const groups = [[event('b', 2), event('a', 2), event('c', 10)], [event('d', 1), event('e', 2)], [event('f', 1)]];
  const selected = selectGroups(groups, 4);
  expect(selected).toHaveLength(1);
  expect(selected[0].map(value => value.eventId)).toEqual(['a', 'b', 'c']);
  expect(() => selectGroups([groups[0]], 2)).toThrow(DependencyError);
});

test('third unresolved examination quarantines and transport backoff is bounded', () => {
  expect([1, 2, 3].map(dependencyOutcome)).toEqual(['pending_dependency', 'pending_dependency', 'quarantined']);
  expect([0, 1, 2, 3].map(transportBackoff)).toEqual([1000, 2000, 4000, null]);
});
