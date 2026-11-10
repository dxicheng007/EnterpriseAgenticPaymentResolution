import { expect, test } from 'vitest';
import {
  hashArtifact, hashEvent, hashPlan, hashProfile, PlanOutcomeSchema,
  type ConnectorSpec, type CustomerProfile, type RawSourceEvent,
} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { classifyBatch, planBatch } from '@eapr/compiler/plan-batch';
import {
  afterLatePaymentA, ambiguousRemittanceB, baselineA, baselineEventsA, baselineEventsB,
  emptyTargetA, emptyTargetB, invoiceBeforePaymentVariant, latePaymentA, profileA, profileB,
  renamedSchemaA, validSpecA, validSpecB,
} from '../../../tests/fixtures/index.js';

function artifact(spec: ConnectorSpec = validSpecA, profile: CustomerProfile = profileA) {
  const result = compile(spec, [profile]);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

function event(patch: Partial<RawSourceEvent>, base: RawSourceEvent = baselineEventsA[0]) {
  const value = { ...base, ...patch };
  return { ...value, contentHash: hashEvent(value) };
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

test('maps both source schemas into exact scoped records and deterministic lineage', () => {
  for (const [subject, profile, source, target] of [
    [artifact(), profileA, baselineEventsA, emptyTargetA],
    [artifact(validSpecB, profileB), profileB, baselineEventsB, emptyTargetB],
  ] as const) {
    const input = structuredClone({ subject, profile, source, target });
    const immutableInput = immutable(structuredClone(input));
    const first = planBatch(immutableInput.subject, immutableInput.profile, immutableInput.source, immutableInput.target);
    expect(PlanOutcomeSchema.safeParse(first).success).toBe(true);
    expect(first.holds).toEqual([]);
    expect(first.plans).toHaveLength(1);
    const [plan] = first.plans;
    expect(plan.expectedBalanceCents).toBe(80000);
    expect(plan.expectedTargetVersion).toBe(0);
    expect(plan.hash).toBe(hashPlan(plan));
    expect(plan.operations).toHaveLength(5);
    expect(plan.operations.map(operation => operation.record).every(record => 'scope' in record && record.scope.accountId === profile.scope.accountId)).toBe(true);
    expect(plan.lineage).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetField: '/amountCents', sourceEventIds: [source[0].id] }),
      expect.objectContaining({ targetField: '/scope/accountId', mapping: null, derivationInputs: expect.arrayContaining([profile.id]) }),
    ]));
    expect(planBatch(subject, profile, [...source].reverse(), target)).toEqual(first);
    expect(immutableInput).toEqual(input);
  }
});

test('rejects_ambiguous_date', () => {
  for (const dueDate of ['2026-09-31', '09/30/2026', '2026-09-30T00:00:00-07:00']) {
    const input = event({ payload: { ...baselineEventsA[0].payload, due_date: dueDate } });
    const outcome = planBatch(artifact(), profileA, [input], emptyTargetA);
    expect(outcome.plans).toEqual([]);
    expect(outcome.holds).toEqual([expect.objectContaining({ code: 'SOURCE_DATE', eventIds: [input.id] })]);
  }
});

test('late payment only changes balance when an explicit allocation is supplied', () => {
  const target = { ...baselineA, asOf: afterLatePaymentA.asOf };
  expect(planBatch(artifact(), profileA, [latePaymentA[0]], target).plans[0].expectedBalanceCents).toBe(80000);
  const [plan] = planBatch(artifact(), profileA, latePaymentA, target).plans;
  expect(plan.expectedBalanceCents).toBe(50000);
  expect(plan.expectedTargetVersion).toBe(baselineA.version);
  expect(plan.asOf).toBe(afterLatePaymentA.asOf);
});

test('missing dependency holds the related group and releases it in dependency order', () => {
  const { events, expectedHoldIds, expectedReleaseIds } = invoiceBeforePaymentVariant();
  const target = { ...baselineA, asOf: afterLatePaymentA.asOf };
  const absent = planBatch(artifact(), profileA, events.slice(0, 2), target);
  expect(absent.plans).toEqual([]);
  expect(absent.holds.flatMap(hold => hold.eventIds)).toEqual(expectedHoldIds);
  expect(absent.holds[0].dependencies).toContain('inv-a-dep');

  const complete = planBatch(artifact(), profileA, events, target);
  expect(complete.holds).toEqual([]);
  expect(complete.plans[0].eventIds).toEqual(expectedReleaseIds);
  expect(complete.plans[0].operations.findIndex(operation => operation.op === 'insert_invoice'))
    .toBeLessThan(complete.plans[0].operations.findIndex(operation => operation.op === 'add_allocation'));
  expect(complete.plans[0].expectedBalanceCents).toBe(90000);
});

test('holds an overallocated group without consuming unrelated unallocated funds', () => {
  const [payment, allocation] = latePaymentA;
  const tooMuch = event({ payload: { ...allocation.payload, amount: '300.01' } }, allocation);
  const independent = event({
    id: 'evt-unallocated', recordId: 'pay-unallocated', sequence: 9,
    payload: { ...payment.payload, id: 'pay-unallocated' },
  }, payment);
  const target = { ...baselineA, asOf: afterLatePaymentA.asOf };
  const outcome = planBatch(artifact(), profileA, [tooMuch, independent, payment], target);
  expect(outcome.holds).toEqual([expect.objectContaining({ code: 'FUNDING_OVERALLOCATION', eventIds: [payment.id, allocation.id] })]);
  expect(outcome.plans[0].operations).toHaveLength(1);
  expect(outcome.plans[0].eventIds).toEqual([independent.id]);
  expect(outcome.plans[0].expectedBalanceCents).toBe(80000);
});

test('economic replay ignores delivery and connector version, but conflicting content holds', () => {
  const original = baselineEventsA[0];
  const replay = event({
    id: 'evt-invoice-new-version', recordVersion: 2, sequence: 8,
    payload: { ...original.payload, version: 2 },
  });
  const changed = event({ payload: { ...replay.payload, amount: '3000.01' } }, replay);
  const subject = artifact({ ...validSpecA, version: 2 });
  expect(planBatch(subject, profileA, [replay], baselineA)).toEqual({ plans: [], holds: [] });
  const conflict = planBatch(subject, profileA, [changed], baselineA);
  expect(conflict.plans).toEqual([]);
  expect(conflict.holds).toEqual([expect.objectContaining({ code: 'ECONOMIC_CONFLICT', eventIds: [changed.id] })]);
  const mixed = planBatch(subject, profileA, [...latePaymentA, replay], { ...baselineA, asOf: afterLatePaymentA.asOf });
  expect(mixed.plans[0].operations).toHaveLength(2);
  expect(mixed.plans[0].eventIds).toContain(replay.id);
});

test('rejects conflicting delivery hashes before planning any group', () => {
  const original = baselineEventsA[0];
  const changed = event({ payload: { ...original.payload, amount: '3000.01' } });
  const result = planBatch(artifact(), profileA, [...baselineEventsA, changed], emptyTargetA);
  expect(result.plans).toEqual([]);
  expect(result.holds).toEqual([expect.objectContaining({ code: 'DELIVERY_CONFLICT', eventIds: [original.id] })]);
});

test('holds schema, identity and semantic drift before mapping', () => {
  const before = planBatch(artifact(), profileA, [renamedSchemaA], emptyTargetA);
  expect(before.holds[0].code).toBe('SOURCE_SCHEMA');
  const unknown = planBatch(artifact(validSpecB, profileB), profileB, [ambiguousRemittanceB], emptyTargetB);
  expect(unknown.holds).toEqual([expect.objectContaining({ code: 'UNKNOWN_ACCOUNT' })]);
  expect(unknown.holds[0]).not.toHaveProperty('scope');
  const drift = event({ semanticVersion: 'not-reviewed' });
  expect(planBatch(artifact(), profileA, [drift], emptyTargetA).holds[0].code).toBe('SEMANTIC_VERSION');

  const sellerMissing = event({
    rawIdentity: { companyId: profileA.scope.companyId, sourceAccountId: profileA.sourceAccountIds[0] },
  });
  const blocked = planBatch(artifact(), profileA, [sellerMissing, baselineEventsA[1]], emptyTargetA);
  expect(blocked.plans).toEqual([]);
  expect(blocked.holds[0]).not.toHaveProperty('scope');
});

test('checks artifact and reviewed profile hashes and target scope', () => {
  const original = artifact();
  const altered = { ...original, normalizedPlan: { ...original.normalizedPlan, validators: [] } };
  altered.hash = hashArtifact(altered);
  const profile = { ...profileA, version: 2 };
  profile.hash = hashProfile(profile);
  for (const [subject, customer, target] of [
    [altered, profileA, emptyTargetA], [original, profile, emptyTargetA], [original, profileA, emptyTargetB],
  ] as const) {
    const result = planBatch(subject, customer, baselineEventsA, target);
    expect(result.plans).toEqual([]);
    expect(result.holds.length).toBeGreaterThan(0);
  }
});

function paymentReversal(patch: Partial<RawSourceEvent> = {}) {
  const base = latePaymentA[0];
  return event({
    id: 'evt-a-reversal', recordId: 'rev-a-1', resource: 'a-reversals', kind: 'reversal', sequence: 10,
    payload: {
      id: 'rev-a-1', version: 1, account: 'cust-a-1', effective_date: '2026-10-03',
      reversed_kind: 'payment', reversed_id: baselineEventsA[1].recordId,
    },
    ...patch,
  }, base);
}

test('plans one full reversal, preserves originals and rejects reallocation of reversed funding', () => {
  const reversal = paymentReversal();
  const target = { ...baselineA, asOf: afterLatePaymentA.asOf };
  const reversed = planBatch(artifact(), profileA, [reversal], target);
  expect(reversed.holds).toEqual([]);
  expect(reversed.plans[0].expectedBalanceCents).toBe(280000);
  const [operation] = reversed.plans[0].operations;
  if (operation.op !== 'full_reverse') throw new Error('Expected full reversal');
  const reversedTarget = { ...target, reversals: [operation.record] };
  expect(planBatch(artifact(), profileA, [reversal], reversedTarget)).toEqual({ plans: [], holds: [] });

  const [allocation] = baselineEventsA.slice(3);
  const again = event({
    id: 'evt-new-allocation', recordId: 'new-allocation', sequence: 11, effectiveAt: reversal.effectiveAt,
    payload: { ...allocation.payload, id: 'new-allocation', effective_date: '2026-10-03' },
  }, allocation);
  const outcome = planBatch(artifact(), profileA, [again], reversedTarget);
  expect(outcome.plans).toEqual([]);
  expect(outcome.holds[0].code).toBe('FUNDING_REVERSED');

  for (const unsupported of [
    { ...reversal.payload, amount: '10.00' },
    { ...reversal.payload, reversed_kind: 'invoice' },
    { ...reversal.payload, reversed_kind: 'reversal' },
  ]) {
    const result = planBatch(artifact(), profileA, [paymentReversal({ payload: unsupported })], target);
    expect(result.plans).toEqual([]);
    expect(result.holds[0].code).toBe('SOURCE_SCHEMA');
  }
});

test('cannot link an allocation to another seller or account using a shared buyer', () => {
  const [payment, allocation] = latePaymentA;
  const foreignInvoice = event({
    id: 'evt-another-account', recordId: 'invoice-another-account', sequence: 8,
    rawIdentity: { ...baselineEventsA[0].rawIdentity, sourceAccountId: 'cust-other' },
    payload: { ...baselineEventsA[0].payload, id: 'invoice-another-account', account: 'cust-other' },
  });
  const crossScope = event({
    payload: { ...allocation.payload, invoice_id: foreignInvoice.recordId },
  }, allocation);
  const otherSeller = event({
    id: 'evt-other-seller', sequence: 9,
    rawIdentity: { ...foreignInvoice.rawIdentity, sellerEntityId: 'seller-other' },
  }, foreignInvoice);
  const outcome = planBatch(artifact(), profileA, [payment, crossScope, foreignInvoice, otherSeller], baselineA);
  expect(outcome.plans).toHaveLength(0);
  expect(outcome.holds).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'DEPENDENCY_MISSING', eventIds: [payment.id, allocation.id] }),
    expect.objectContaining({ code: 'UNKNOWN_ACCOUNT', eventIds: [foreignInvoice.id] }),
    expect.objectContaining({ code: 'IDENTITY_SCOPE', eventIds: [otherSeller.id] }),
  ]));
  expect(outcome.holds.find(hold => hold.code === 'IDENTITY_SCOPE')).not.toHaveProperty('scope');
});

test('a later target version changes the expected version and plan hash', () => {
  const asOf = afterLatePaymentA.asOf;
  const first = planBatch(artifact(), profileA, latePaymentA, { ...baselineA, asOf }).plans[0];
  const next = planBatch(artifact(), profileA, latePaymentA, { ...baselineA, asOf, version: 7 }).plans[0];
  expect(next.expectedTargetVersion).toBe(7);
  expect(next.hash).not.toBe(first.hash);
  expect(next.operations).toEqual(first.operations);
});

test('classifyBatch traces every input and keeps planBatch outcomes identical', () => {
  const subject = artifact();
  const target = { ...baselineA, asOf: afterLatePaymentA.asOf };
  const inputs = [...latePaymentA, baselineEventsA[0], latePaymentA[0]];
  const result = classifyBatch(subject, profileA, inputs, target);
  expect(result.outcome).toEqual(planBatch(subject, profileA, inputs, target));
  if (result.details.kind !== 'classified') throw new Error('expected classified');
  expect(result.details.items.map(item => item.inputIndex)).toEqual([0, 1, 2, 3]);
  expect(result.details.items.map(item => item.disposition)).toEqual([
    'financial_new', 'financial_new', 'financial_replay', 'delivery_repeat',
  ]);
  const allocation = result.details.items[1];
  if (allocation.disposition !== 'financial_new') throw new Error('expected new');
  expect(allocation.mapped.prerequisites.map(value => [value.relation, value.presence.kind])).toEqual([
    ['allocation_funding', 'candidate'], ['allocation_invoice', 'target'],
  ]);
  expect(result.details.items[3]).toMatchObject({ disposition: 'delivery_repeat', primaryInputIndex: 0 });
});

test('classifyBatch marks missing prerequisites and stops without classification on conflicts', () => {
  const { events } = invoiceBeforePaymentVariant();
  const target = { ...baselineA, asOf: afterLatePaymentA.asOf };
  const held = classifyBatch(artifact(), profileA, events.slice(0, 2), target);
  if (held.details.kind !== 'classified') throw new Error('expected classified');
  expect(held.details.groups.every(group => group.disposition === 'held')).toBe(true);
  expect(held.details.items.every(item => item.disposition === 'held')).toBe(true);

  const changed = event({ payload: { ...baselineEventsA[0].payload, amount: '3000.01' } });
  const stopped = classifyBatch(artifact(), profileA, [...baselineEventsA, changed], emptyTargetA);
  expect(stopped.details).toMatchObject({ kind: 'not_classified', reason: 'delivery_conflict' });
});
