import { expect, test, vi } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import * as compiler from '@eapr/compiler/plan-batch';
import { classifyBatch } from '@eapr/compiler/plan-batch';
import { hashCanonical, hashEvent, hashTargetSnapshot } from '@eapr/contracts';
import { classifyCapturedGroup } from '../src/sync/apply-coverage.js';
import { afterLatePaymentA, baselineA, latePaymentA, profileA, validSpecA } from '../../../tests/fixtures/index.js';

test('coalesced_and_repeat: only a different delivery of equivalent economics adds acknowledgment membership', () => {
  const compiled = compile(validSpecA, [profileA]);
  if (!compiled.ok) throw new Error('Expected a compiled public fixture');
  const [payment, allocation] = latePaymentA;
  const duplicateEconomics = { ...allocation, id: 'coalesced-allocation', sequence: allocation.sequence + 1 };
  duplicateEconomics.contentHash = hashEvent(duplicateEconomics);
  const { details, outcome } = classifyBatch(compiled.value, profileA, [payment, allocation, allocation, duplicateEconomics],
    { ...baselineA, asOf: afterLatePaymentA.asOf });
  expect(outcome.holds).toEqual([]);
  expect(details).toMatchObject({ kind: 'classified', items: [
    { disposition: 'financial_new', inputIndex: 0 },
    { disposition: 'financial_new', inputIndex: 1 },
    { disposition: 'delivery_repeat', inputIndex: 2, primaryInputIndex: 1 },
    { disposition: 'financial_coalesced', inputIndex: 3, producerInputIndex: 1 },
  ] });
  const [plan] = outcome.plans;
  expect(plan.eventIds).toEqual([payment.id, allocation.id, duplicateEconomics.id]);
  expect(plan.operations.map(operation => operation.op)).toEqual(['insert_payment', 'add_allocation']);
  expect(plan.expectedBalanceCents).toBe(50000);
});

test('a changed observation time is a delivery conflict for an occupied full identity', () => {
  const compiled = compile(validSpecA, [profileA]);
  if (!compiled.ok) throw new Error('Expected a compiled public fixture');
  const [payment] = latePaymentA;
  const conflict = { ...payment, observedAt: '2026-11-09T08:01:00.000Z' };
  conflict.contentHash = hashEvent(conflict);
  const { details, outcome } = classifyBatch(compiled.value, profileA, [payment, conflict], baselineA);
  expect(details).toMatchObject({ kind: 'not_classified', reason: 'delivery_conflict' });
  expect(outcome.plans).toEqual([]);
});

test.each(['provider indexes', 'operation correspondence'])('rejects corrupted classifier %s', fault => {
  const compiled = compile(validSpecA, [profileA]);
  if (!compiled.ok) throw new Error('Expected a compiled public fixture');
  const identity = { scope: profileA.scope, activationId: 'worker-apply-unit', bundleHash: hashCanonical('public-test-bundle') };
  const activation = { allowedKinds: ['payment', 'allocation'] as ('payment' | 'allocation')[],
    limits: { maxRecordsPerCycle: 1000, maxTransactionCents: 5000000 } as const };
  const target = { records: baselineA, snapshotHash: hashTargetSnapshot(baselineA), digest: hashCanonical(baselineA) };
  const subject = { activation, artifact: compiled.value, profile: profileA, identity, events: latePaymentA };
  const asOf = afterLatePaymentA.asOf;
  const accepted = classifyCapturedGroup(subject, target, asOf);
  expect(accepted.plan?.eventIds).toEqual(latePaymentA.map(event => event.id));
  const forged = classifyBatch(compiled.value, profileA, latePaymentA, { ...baselineA, asOf });
  if (forged.details.kind !== 'classified') throw new Error('Expected classified inputs');
  const allocation = forged.details.items[1];
  if (allocation?.disposition !== 'financial_new') throw new Error('Expected allocation producer');
  if (fault === 'provider indexes') {
    const funding = allocation.mapped.prerequisites.find(prerequisite => prerequisite.relation === 'allocation_funding')!;
    funding.presence = { kind: 'candidate', providerInputIndexes: [1] };
  } else {
    allocation.operationIndex = 0;
  }
  const spy = vi.spyOn(compiler, 'classifyBatch').mockReturnValueOnce(forged);
  try {
    expect(() => classifyCapturedGroup(subject, target, asOf)).toThrow(expect.objectContaining({ code: 'SYNC_INVALID_PLAN' }));
  } finally {
    spy.mockRestore();
  }
});
