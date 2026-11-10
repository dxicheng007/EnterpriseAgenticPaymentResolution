import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { classifyBatch, type InputClassification, type TypedPrerequisite } from '@eapr/compiler/plan-batch';
import { targetRecordId } from '@eapr/contracts';
import { baselineA, afterLatePaymentA, invoiceBeforePaymentVariant, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import {
  dependencyOrder, dependencyOutcome, missingPrerequisites, selectGroups, transportBackoff,
} from '../src/sync/dependencies.js';

const identity = (recordId: string) => ({
  kind: 'payment' as const, sourceRef: profileA.sourceRef, sellerEntityId: profileA.scope.sellerEntityId, recordId,
});
const item = (inputIndex: number, presences: TypedPrerequisite['presence'][] = []): InputClassification => ({
  inputIndex, disposition: 'held', event: null, holdIndexes: [0], groupIndex: 0,
  mapped: {
    scope: profileA.scope,
    identity: identity(`item-${inputIndex}`),
    targetRecordId: targetRecordId(identity(`item-${inputIndex}`)),
    prerequisites: presences.map((presence, index) => {
      const funding = identity(`rec-${inputIndex}-${index}`);
      return { relation: 'allocation_funding', scope: profileA.scope, identity: funding, targetRecordId: targetRecordId(funding), presence };
    }),
  },
});
const invalidDependencyInput = expect.objectContaining({ name: 'DependencyError', code: 'DEPENDENCY_INPUT_INVALID' });

test('orders providers before consumers and reports missing prerequisites', () => {
  const items = [
    item(0, [{ kind: 'candidate', providerInputIndexes: [2] }, { kind: 'target' }]),
    item(1, [{ kind: 'missing' }]),
    item(2, []),
  ];
  expect(dependencyOrder(items)).toEqual([2, 0, 1]);
  expect([...missingPrerequisites(items)]).toEqual([[1, [targetRecordId(identity('rec-1-0'))]]]);
});

test('cycles are explicit exceptions', () => {
  const items = [
    item(0, [{ kind: 'candidate', providerInputIndexes: [1] }]),
    item(1, [{ kind: 'candidate', providerInputIndexes: [0] }]),
  ];
  expect(() => dependencyOrder(items)).toThrow(expect.objectContaining({ name: 'DependencyError', code: 'DEPENDENCY_CYCLE' }));
});

test('selection never splits a group and keeps stable order', () => {
  const event = (eventId: string, sequence: number, streamId = 's') => ({ eventId, sequence, streamId });
  const groups = [[event('b', 2), event('a', 2), event('c', 10)], [event('d', 1), event('e', 2)], [event('f', 1)]];
  const selected = selectGroups(groups, 4);
  expect(selected).toHaveLength(1);
  expect(selected[0].map(value => value.eventId)).toEqual(['a', 'b', 'c']);
  expect(() => selectGroups([groups[0]], 2)).toThrow(expect.objectContaining({ name: 'DependencyError', code: 'DEPENDENCY_CLOSURE_TOO_LARGE' }));
});

test('rejects a provider index absent from the materialized dependency graph', () => {
  const consumer = item(0, [{ kind: 'candidate', providerInputIndexes: [99] }]);
  expect(() => dependencyOrder([consumer])).toThrow(invalidDependencyInput);
  const unmapped: InputClassification = { inputIndex: 99, disposition: 'held', event: null, holdIndexes: [1], mapped: null, groupIndex: null };
  expect(() => dependencyOrder([consumer, unmapped])).toThrow(invalidDependencyInput);
});

test('rejects duplicate materialized input indexes', () => {
  expect(() => dependencyOrder([item(0), item(0)])).toThrow(invalidDependencyInput);
});

test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid materialized input index %s', index => {
  expect(() => dependencyOrder([item(index)])).toThrow(invalidDependencyInput);
});

test('orders held provider candidates from the real classifier without releasing the hold', () => {
  const compiled = compile(validSpecA, [profileA]);
  if (!compiled.ok) throw new Error('Expected compiled fixture');
  const { events: [payment, allocation] } = invoiceBeforePaymentVariant();
  const { details, outcome } = classifyBatch(
    compiled.value, profileA, [allocation, payment], { ...baselineA, asOf: afterLatePaymentA.asOf },
  );
  if (details.kind !== 'classified') throw new Error('Expected classified dependency group');
  expect(outcome.plans).toEqual([]);
  expect(outcome.holds).toEqual([expect.objectContaining({ code: 'DEPENDENCY_MISSING' })]);
  expect(details.items.map(value => value.disposition)).toEqual(['held', 'held']);
  expect(dependencyOrder(details.items)).toEqual([1, 0]);
});

const inboxEvent = { eventId: 'event', sequence: 0, streamId: 'stream' };

test.each([0, -1, 0.5, NaN, Infinity, 1001])('rejects invalid group selection limit %s', limit => {
  expect(() => selectGroups([[inboxEvent]], limit)).toThrow(invalidDependencyInput);
});

test('accepts a whole 1000-event group at the default and explicit limit', () => {
  const group = Array.from({ length: 1000 }, (_, sequence) => ({ ...inboxEvent, eventId: `event-${sequence}`, sequence }));
  expect(selectGroups([group])).toEqual([group]);
  expect(selectGroups([group], 1000)).toEqual([group]);
  expect(() => selectGroups([[...group, inboxEvent]])).toThrow(
    expect.objectContaining({ name: 'DependencyError', code: 'DEPENDENCY_CLOSURE_TOO_LARGE' }),
  );
});

test('third unresolved examination quarantines and transport backoff is bounded', () => {
  expect([1, 2, 3].map(dependencyOutcome)).toEqual(['pending_dependency', 'pending_dependency', 'quarantined']);
  expect([0, 1, 2, 3].map(transportBackoff)).toEqual([1000, 2000, 4000, null]);
});
