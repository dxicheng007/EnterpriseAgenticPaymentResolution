import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import {
  classifyBatch, planBatch, type BatchStopReason, type InputClassification, type TypedPrerequisite,
} from '@eapr/compiler/plan-batch';
import {
  SourceEventSchema, canonicalJson, hashEvent, hashTargetSnapshot, targetRecordId,
  type CompiledArtifact, type CustomerProfile, type EconomicIdentity, type SourceEvent, type TargetState,
} from '@eapr/contracts';
import { financialRecords, validateTarget } from '@eapr/finance/validate';
import { projectTarget, type FinancialMutation } from '@eapr/parent/state';
import {
  baselineA, baselineEventsA, baselineEventsB, emptyTargetA, emptyTargetB,
  invoiceBeforePaymentVariant, profileA, profileB,
} from '../../../tests/fixtures/index.js';
import {
  allocationAfterReversal, anotherDelivery, artifactA, artifactB, badHash, changedSemantic, coalescedPayment,
  compatibilityCases, credit, creditReversal, event, foreignAccount, foreignSource, independentPayment, invoice,
  lateAllocation, latePayment, malformed, mappingFailure, normalizedInvoice, overAllocation, payment,
  paymentReversal, replayInvoice, reversedTarget, semantic, semanticWithoutSeller, targetAtLatePayment,
  unscopedFinancial, unscopedSemantic, unsupportedReversals,
} from './fixtures/classification-cases.js';

const frozen: { baselineCommit: string; plannerBlob: string; cases: { id: string; outcome: unknown }[] } =
  JSON.parse(readFileSync(new URL('./fixtures/plan-batch-before-classification.json', import.meta.url), 'utf8'));

test('matches every pre-change planner outcome byte-for-byte canonically', () => {
  expect(frozen.baselineCommit).toBe('53c501f203903eb08054b84f1b6d93a11d763c64');
  expect(frozen.plannerBlob).toBe('70350f44c2d03ad9bda4b114e61c3eb36495a86a');
  const outcomes = new Map(frozen.cases.map(({ id, outcome }) => [id, outcome]));
  expect(outcomes.size).toBe(frozen.cases.length);
  expect([...outcomes.keys()].sort()).toEqual(compatibilityCases.map(({ id }) => id).sort());
  for (const { id, artifact, profile, inputs, target } of compatibilityCases) {
    const outcome = planBatch(artifact as CompiledArtifact, profile as CustomerProfile, inputs as SourceEvent[], target as TargetState);
    expect(canonicalJson(outcome), id).toBe(canonicalJson(outcomes.get(id)));
  }
});

test('keeps each sparse input position as an independent legacy envelope hold', () => {
  const inputs = new Array<SourceEvent>(3);
  inputs[1] = invoice;
  const outcome = planBatch(artifactA, profileA, inputs, emptyTargetA);
  const malformedHold = {
    eventIds: [], code: 'SOURCE_SCHEMA', dependencies: [],
    diagnostics: [{
      code: 'SOURCE_SCHEMA', severity: 'blocker', message: 'Invalid source event envelope', sourceIds: [], fieldPaths: [],
    }],
  };
  expect(outcome.holds).toEqual([malformedHold, malformedHold]);
  expect(outcome.plans.map(plan => plan.eventIds)).toEqual([[invoice.id]]);
  const result = classified(inputs);
  expect(result.outcome).toEqual(outcome);
  expect(result.items).toMatchObject([
    { inputIndex: 0, disposition: 'held', event: null, holdIndexes: [0], mapped: null },
    { inputIndex: 1, disposition: 'financial_new' },
    { inputIndex: 2, disposition: 'held', event: null, holdIndexes: [1], mapped: null },
  ]);
});

function classified(inputs: unknown, target = emptyTargetA) {
  const result = classifyBatch(artifactA, profileA, inputs as SourceEvent[], target);
  if (result.details.kind !== 'classified') throw new Error('Expected classified: ' + result.details.reason);
  return { outcome: result.outcome, ...result.details };
}

function mapped(item: InputClassification) {
  if (!('mapped' in item) || !item.mapped) throw new Error('Expected mapped financial item');
  return item.mapped;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('classifies A and B baselines with exact operation references', () => {
  for (const [artifact, profile, inputs, target] of [
    [artifactA, profileA, baselineEventsA, emptyTargetA],
    [artifactB, profileB, baselineEventsB, emptyTargetB],
  ] as const) {
    const result = classifyBatch(artifact, profile, inputs, target);
    expect(result.schemaVersion).toBe('1');
    expect(result.outcome.holds).toEqual([]);
    expect(result.outcome.plans).toHaveLength(1);
    expect(result.outcome.plans[0].expectedBalanceCents).toBe(80_000);
    if (result.details.kind !== 'classified') throw new Error('Expected classified baseline');
    const { items, binding, sourceBlockers } = result.details;
    expect(sourceBlockers).toEqual([]);
    expect(items).toHaveLength(inputs.length);
    expect(binding).toEqual({
      artifactHash: artifact.hash, profileHash: profile.hash, scope: profile.scope, expectedTargetVersion: target.version,
      targetSnapshotHash: hashTargetSnapshot(validateTarget(target).state), asOf: target.asOf,
    });
    for (const [inputIndex, item] of items.entries()) {
      if (item.disposition !== 'financial_new') throw new Error('Expected new baseline operation');
      expect(item.inputIndex).toBe(inputIndex);
      expect(item.planIndex).toBe(0);
      const { record } = result.outcome.plans[item.planIndex].operations[item.operationIndex] as FinancialMutation;
      expect(record).toMatchObject({
        id: item.mapped.targetRecordId, scope: profile.scope,
        identity: { kind: inputs[inputIndex].kind, recordId: inputs[inputIndex].recordId, sourceRef: artifact.sourceRef },
        sourceEventId: inputs[inputIndex].id, sourceRecordVersion: inputs[inputIndex].recordVersion,
      });
    }
    expect(Object.keys(planBatch(artifact, profile, inputs, target)).sort()).toEqual(['holds', 'plans']);
  }
});

test('classifies all-target replay without a plan', () => {
  const inputs = [...baselineEventsA, paymentReversal].map((original, index) =>
    anotherDelivery(original, 'evt-replay-' + index, 20 + index));
  const result = classified(inputs, reversedTarget);
  expect(result.outcome).toEqual({ plans: [], holds: [] });
  expect(result.groups).toEqual([{ inputIndexes: [0, 1, 2, 3, 4, 5], disposition: 'accepted', holdIndexes: [] }]);
  const originals = financialRecords(reversedTarget);
  for (const [index, item] of result.items.entries()) {
    const original = originals[index];
    expect(item).toEqual({
      inputIndex: index, disposition: 'financial_replay', event: expect.objectContaining({ eventId: inputs[index].id }),
      groupIndex: 0, mapped: expect.objectContaining({ identity: original.identity }),
      existing: {
        identity: original.identity, targetRecordId: original.id, sourceEventId: original.sourceEventId,
        sourceRecordVersion: original.sourceRecordVersion,
      },
    });
  }
});

test('separates new economics coalescence and replay', () => {
  const thirdDelivery = anotherDelivery(latePayment, 'evt-pay-also-coalesced', 10);
  const inputs = [latePayment, coalescedPayment, thirdDelivery, replayInvoice];
  for (const order of [inputs, [...inputs].reverse()]) {
    const { items, groups, outcome } = classified(order, targetAtLatePayment);
    const producerInputIndex = order.indexOf(latePayment);
    const [plan] = outcome.plans;
    expect(outcome.holds).toEqual([]);
    expect(plan.eventIds).toEqual([latePayment.id, replayInvoice.id, coalescedPayment.id, thirdDelivery.id]);
    expect(plan.operations).toHaveLength(1);
    expect(plan.lineage.every(item => item.operationIndex === 0 && item.sourceEventIds.every(id => id === latePayment.id))).toBe(true);
    expect(plan.expectedBalanceCents).toBe(80_000);
    expect(groups).toHaveLength(2);
    expect(items[producerInputIndex]).toMatchObject({ disposition: 'financial_new', operationIndex: 0 });
    for (const delivery of [coalescedPayment, thirdDelivery]) {
      expect(items[order.indexOf(delivery)]).toMatchObject({ disposition: 'financial_coalesced', producerInputIndex });
    }
    expect(items[order.indexOf(replayInvoice)]).toMatchObject({
      disposition: 'financial_replay', existing: { sourceEventId: invoice.id, sourceRecordVersion: invoice.recordVersion },
    });
  }
});

test('tracks parsed repeat occurrences including normalized instants', () => {
  const result = classified([normalizedInvoice, invoice, normalizedInvoice]);
  expect(result.items.map(item => item.disposition)).toEqual(['financial_new', 'delivery_repeat', 'delivery_repeat']);
  for (const repeated of result.items.slice(1)) {
    expect(repeated).toMatchObject({ primaryInputIndex: 0, event: result.items[0].event });
  }

  const mixed = classified([
    mappingFailure, mappingFailure, semantic, semantic, coalescedPayment, coalescedPayment,
    replayInvoice, replayInvoice, latePayment,
  ], targetAtLatePayment);
  expect(mixed.items.map(item => item.disposition)).toEqual([
    'held', 'delivery_repeat', 'semantic_observed', 'delivery_repeat', 'financial_coalesced',
    'delivery_repeat', 'financial_replay', 'delivery_repeat', 'financial_new',
  ]);
  for (const index of [1, 3, 5, 7]) {
    expect(mixed.items[index]).toMatchObject({ primaryInputIndex: index - 1, event: mixed.items[index - 1].event });
  }

  const changed = event({ observedAt: targetAtLatePayment.asOf });
  const conflict = classifyBatch(artifactA, profileA, [normalizedInvoice, changed], emptyTargetA);
  expect(conflict.details).toEqual({ kind: 'not_classified', reason: 'delivery_conflict', holdIndexes: [0], sourceBlockers: [] });
});

test('binds the exact parsed target without mutation or clock reads', () => {
  const subject = { artifact: artifactA, profile: profileA, inputs: [invoice], target: emptyTargetA };
  const input = freeze(structuredClone(subject));
  const version = { ...input.target, version: 7 };
  const later = { ...input.target, asOf: '2026-10-03T00:00:00Z' };
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Wall clock read'); });
  let outcome, original, newer, laterResult, empty;
  try {
    outcome = planBatch(input.artifact, input.profile, input.inputs, input.target);
    original = classifyBatch(input.artifact, input.profile, input.inputs, input.target);
    newer = classifyBatch(input.artifact, input.profile, input.inputs, version);
    laterResult = classifyBatch(input.artifact, input.profile, input.inputs, later);
    empty = classifyBatch(input.artifact, input.profile, [], input.target);
  } finally {
    clock.mockRestore();
  }

  expect(input).toEqual(subject);
  expect(outcome).toEqual(original.outcome);
  expect(empty.outcome).toEqual({ plans: [], holds: [] });
  expect(empty.details).toMatchObject({ kind: 'classified', items: [], groups: [], sourceBlockers: [] });
  const hashes = new Set<string>();
  for (const [value, supplied] of [[original, input.target], [newer, version], [laterResult, later]] as const) {
    if (value.details.kind !== 'classified') throw new Error('Expected exact target binding');
    const { state } = validateTarget(supplied);
    const { binding } = value.details;
    expect(binding).toMatchObject({
      expectedTargetVersion: state.version, asOf: state.asOf, targetSnapshotHash: hashTargetSnapshot(state),
    });
    expect(value.outcome.plans[0].operations).toEqual(outcome.plans[0].operations);
    expect(value.outcome.plans[0].expectedBalanceCents).toBe(outcome.plans[0].expectedBalanceCents);
    hashes.add(binding.targetSnapshotHash);
  }
  expect(hashes.size).toBe(3);
});

test('covers each bounded occurrence with valid internal references', () => {
  let checked = 0;
  for (const { id, artifact, profile, inputs, target } of compatibilityCases) {
    const { outcome, details } = classifyBatch(
      artifact as CompiledArtifact, profile as CustomerProfile, inputs as SourceEvent[], target as TargetState,
    );
    expect(canonicalJson(outcome), id).toBe(canonicalJson(frozen.cases.find(entry => entry.id === id)!.outcome));
    if (details.kind !== 'classified') continue;
    checked++;
    const events = inputs as SourceEvent[];
    const { state, records } = validateTarget(target as TargetState);
    const { items, groups } = details;
    expect(items.map(item => item.inputIndex), id).toEqual(Array.from(events.keys()));
    const grouped = groups.flatMap(group => group.inputIndexes);
    expect([...grouped].sort((a, b) => a - b), id).toEqual(items.flatMap(item =>
      'groupIndex' in item && item.groupIndex !== null ? [item.inputIndex] : []));
    for (const [groupIndex, group] of groups.entries()) {
      expect(group.inputIndexes, id).toEqual([...group.inputIndexes].sort((a, b) => a - b));
      expect(group.inputIndexes.length, id).toBeGreaterThan(0);
      if (group.disposition === 'accepted') expect(group.holdIndexes, id).toEqual([]);
      for (const inputIndex of group.inputIndexes) {
        expect(items[inputIndex], id).toMatchObject({ groupIndex });
        if (group.disposition === 'held') expect(items[inputIndex], id).toMatchObject({ disposition: 'held', holdIndexes: group.holdIndexes });
        else expect(['financial_new', 'financial_replay', 'financial_coalesced'], id).toContain(items[inputIndex].disposition);
      }
    }

    const operationReferences: string[] = [];
    for (const item of items) {
      if (item.event) {
        const parsed = SourceEventSchema.parse(events[item.inputIndex]);
        expect(item.event, id).toEqual({
          sourceRef: parsed.sourceRef, eventId: parsed.id, streamId: parsed.streamId,
          sequence: parsed.sequence, contentHash: parsed.contentHash,
        });
        if (item.disposition !== 'held') expect(parsed.contentHash, id).toBe(hashEvent(parsed));
      }
      if (item.disposition === 'held') {
        expect(item.holdIndexes.length, id).toBeGreaterThan(0);
        for (const holdIndex of item.holdIndexes) {
          const hold = outcome.holds[holdIndex];
          expect(hold, id).toBeDefined();
          if (item.event) expect(hold.eventIds, id).toContain(item.event.eventId);
        }
      }
      if (item.disposition === 'delivery_repeat') {
        const primary = items[item.primaryInputIndex];
        expect(item.primaryInputIndex, id).toBeLessThan(item.inputIndex);
        expect(primary.disposition, id).not.toBe('delivery_repeat');
        expect(primary.event, id).toEqual(item.event);
        expect(SourceEventSchema.parse(events[item.primaryInputIndex]), id).toEqual(SourceEventSchema.parse(events[item.inputIndex]));
      }
      if (item.disposition === 'financial_new') {
        const { record } = outcome.plans[item.planIndex].operations[item.operationIndex] as FinancialMutation;
        expect(record, id).toMatchObject({
          id: item.mapped.targetRecordId, identity: item.mapped.identity, sourceEventId: item.event.eventId,
        });
        operationReferences.push(item.planIndex + '/' + item.operationIndex);
      }
      if (item.disposition === 'financial_coalesced') {
        expect(items[item.producerInputIndex], id).toMatchObject({
          disposition: 'financial_new', mapped: item.mapped, groupIndex: item.groupIndex,
        });
      }
      if (item.disposition === 'financial_replay') {
        const original = records.get(item.mapped.targetRecordId)!;
        expect(item.existing, id).toEqual({
          identity: original.identity, targetRecordId: original.id,
          sourceEventId: original.sourceEventId, sourceRecordVersion: original.sourceRecordVersion,
        });
      }
      if (!('mapped' in item) || !item.mapped) continue;
      const { scope, identity, targetRecordId: recordId, prerequisites } = item.mapped;
      expect(scope, id).toEqual(state.scope);
      expect(recordId, id).toBe(targetRecordId(identity));
      const keys = prerequisites.map(requirement => requirement.relation + '/' + canonicalJson(requirement.identity));
      expect(keys, id).toEqual([...new Set(keys)].sort());
      for (const requirement of prerequisites) {
        expect(requirement.scope, id).toEqual(state.scope);
        expect(requirement.targetRecordId, id).toBe(targetRecordId(requirement.identity));
        const providers = items.flatMap(candidate => 'mapped' in candidate && candidate.mapped?.targetRecordId === requirement.targetRecordId
          ? [candidate.inputIndex] : []);
        expect(requirement.presence, id).toEqual(records.has(requirement.targetRecordId) ? { kind: 'target' }
          : providers.length ? { kind: 'candidate', providerInputIndexes: providers } : { kind: 'missing' });
      }
    }
    expect(operationReferences.sort(), id).toEqual(outcome.plans.flatMap((plan, planIndex) =>
      plan.operations.map((_, operationIndex) => planIndex + '/' + operationIndex)).sort());
  }
  expect(checked).toBeGreaterThan(128);
});

function prerequisite(relation: TypedPrerequisite['relation'], kind: EconomicIdentity['kind'], recordId: string, presence: TypedPrerequisite['presence']) {
  const identity = { sourceRef: profileA.sourceRef, sellerEntityId: profileA.scope.sellerEntityId, kind, recordId };
  return { relation, scope: profileA.scope, identity, targetRecordId: targetRecordId(identity), presence };
}

test('reports exact allocation and reversal prerequisite identities', () => {
  const { items } = classified(baselineEventsA);
  expect(items.slice(0, 3).map(item => mapped(item).prerequisites)).toEqual([[], [], []]);
  for (const [index, funding] of [payment, credit].entries()) {
    expect(mapped(items[index + 3]).prerequisites).toEqual([
      prerequisite('allocation_funding', index === 0 ? 'payment' : 'credit', funding.recordId, { kind: 'candidate', providerInputIndexes: [index + 1] }),
      prerequisite('allocation_invoice', 'invoice', invoice.recordId, { kind: 'candidate', providerInputIndexes: [0] }),
    ]);
  }

  for (const [reversal, funding, kind] of [[paymentReversal, payment, 'payment'], [creditReversal, credit, 'credit']] as const) {
    const { items: [item] } = classified([reversal], targetAtLatePayment);
    expect(item.disposition).toBe('financial_new');
    expect(mapped(item).prerequisites).toEqual([prerequisite('reversal_original', kind, funding.recordId, { kind: 'target' })]);
  }
});

test('distinguishes target candidate and missing presence', () => {
  const inputs = [coalescedPayment, lateAllocation, latePayment, latePayment, replayInvoice];
  const { items } = classified(inputs, targetAtLatePayment);
  expect(mapped(items[1]).prerequisites).toEqual([
    prerequisite('allocation_funding', 'payment', latePayment.recordId, { kind: 'candidate', providerInputIndexes: [0, 2] }),
    prerequisite('allocation_invoice', 'invoice', invoice.recordId, { kind: 'target' }),
  ]);
  const { events, expectedHoldIds, expectedReleaseIds } = invoiceBeforePaymentVariant();
  const missing = classified(events.slice(0, 2), targetAtLatePayment);
  expect(missing.groups).toEqual([{ inputIndexes: [0, 1], disposition: 'held', holdIndexes: [0] }]);
  expect(missing.outcome.holds[0]).toMatchObject({ code: 'DEPENDENCY_MISSING', dependencies: [events[2].recordId], eventIds: expectedHoldIds });
  expect(mapped(missing.items[1]).prerequisites[1]).toEqual(prerequisite('allocation_invoice', 'invoice', events[2].recordId, { kind: 'missing' }));
  const released = classified(events, targetAtLatePayment);
  expect(released.groups).toEqual([{ inputIndexes: [0, 1, 2], disposition: 'accepted', holdIndexes: [] }]);
  expect(mapped(released.items[1]).prerequisites[1]).toEqual(
    prerequisite('allocation_invoice', 'invoice', events[2].recordId, { kind: 'candidate', providerInputIndexes: [2] }),
  );
  expect(released.outcome.plans[0]).toMatchObject({ eventIds: expectedReleaseIds, expectedBalanceCents: 90_000 });
});

test('does not confuse same raw IDs or held providers', () => {
  const sameIdInvoice = event({ recordId: latePayment.recordId, payload: { ...invoice.payload, id: latePayment.recordId } });
  const sameIdAllocation = event({ payload: { ...lateAllocation.payload, invoice_id: latePayment.recordId } }, lateAllocation);
  const sameIds = classified([sameIdAllocation, latePayment, sameIdInvoice], { ...emptyTargetA, asOf: latePayment.effectiveAt });
  expect(sameIds.outcome.holds).toEqual([]);
  const [funding, invoiceDependency] = mapped(sameIds.items[0]).prerequisites;
  expect(funding.identity.recordId).toBe(invoiceDependency.identity.recordId);
  expect(funding.targetRecordId).not.toBe(invoiceDependency.targetRecordId);
  expect([funding.presence, invoiceDependency.presence]).toEqual([
    { kind: 'candidate', providerInputIndexes: [1] }, { kind: 'candidate', providerInputIndexes: [2] },
  ]);

  const foreignOrInvalid = [
    event({ id: 'foreign-account-pay', rawIdentity: foreignAccount.rawIdentity, payload: { ...latePayment.payload, account: 'cust-another' } }, latePayment),
    event({ id: 'foreign-source-pay', sourceRef: foreignSource.sourceRef }, latePayment),
    event({ id: 'foreign-seller-pay', rawIdentity: { ...latePayment.rawIdentity, sellerEntityId: 'another-seller' } }, latePayment),
    event({ id: 'invalid-pay', payload: { ...latePayment.payload, amount: 'invalid' } }, latePayment),
  ];
  const missing = classified([...foreignOrInvalid, lateAllocation], targetAtLatePayment);
  expect(missing.items.slice(0, 4).every(item => item.disposition === 'held' && item.mapped === null)).toBe(true);
  expect(mapped(missing.items[4]).prerequisites[0].presence).toEqual({ kind: 'missing' });

  const conflicting = event({ payload: { ...coalescedPayment.payload, amount: '300.01' } }, coalescedPayment);
  const held = classified([lateAllocation, replayInvoice, conflicting, latePayment], targetAtLatePayment);
  expect(held.outcome.holds.map(hold => hold.code)).toEqual(['ECONOMIC_CONFLICT']);
  expect(held.groups).toEqual([{ inputIndexes: [0, 1, 2, 3], disposition: 'held', holdIndexes: [0] }]);
  expect(held.items.map(item => item.disposition)).toEqual(['held', 'held', 'held', 'held']);
  expect(mapped(held.items[0]).prerequisites[0].presence).toEqual({ kind: 'candidate', providerInputIndexes: [2, 3] });
});

test('preserves existing allocation edges and capacity coupling', () => {
  const inputs = [creditReversal, independentPayment, overAllocation, replayInvoice, coalescedPayment, latePayment];
  const { items, groups, outcome } = classified(inputs, targetAtLatePayment);
  expect(outcome.holds.map(hold => hold.code)).toEqual(['FUNDING_OVERALLOCATION']);
  expect(groups).toContainEqual({ inputIndexes: [0, 2, 3, 4, 5], disposition: 'held', holdIndexes: [0] });
  expect(items.map(item => item.disposition)).toEqual(['held', 'financial_new', 'held', 'held', 'held', 'held']);
  expect(outcome.plans[0]).toMatchObject({ eventIds: [independentPayment.id], expectedBalanceCents: 80_000 });
  expect(outcome.plans[0].operations).toHaveLength(1);
});

test('preserves supported reversal and economic conflict boundaries', () => {
  for (const [reversal, balance] of [[paymentReversal, 280_000], [creditReversal, 100_000]] as const) {
    const { outcome } = classified([reversal], targetAtLatePayment);
    expect(outcome.holds).toEqual([]);
    const plan = outcome.plans[0];
    expect(plan.expectedBalanceCents).toBe(balance);
    expect(plan.operations.map(operation => operation.op)).toEqual(['full_reverse']);
    const projected = projectTarget(targetAtLatePayment, plan.operations as FinancialMutation[]);
    expect(projected.payments).toEqual(targetAtLatePayment.payments);
    expect(projected.credits).toEqual(targetAtLatePayment.credits);
    expect(projected.allocations).toEqual(targetAtLatePayment.allocations);
  }
  for (const unsupported of unsupportedReversals) {
    const { items, outcome } = classified([unsupported], targetAtLatePayment);
    expect(items).toMatchObject([{ disposition: 'held', mapped: null, groupIndex: null }]);
    expect(outcome.holds.map(hold => hold.code)).toEqual(['SOURCE_SCHEMA']);
  }
  const after = classified([allocationAfterReversal, independentPayment], reversedTarget);
  expect(after.items.map(item => item.disposition)).toEqual(['held', 'financial_new']);
  expect(after.outcome.holds.map(hold => hold.code)).toEqual(['FUNDING_REVERSED']);
  for (const id of ['economic-conflict-amount', 'economic-conflict-relationship', 'economic-conflict-effective-at', 'unsupported-currency']) {
    const { inputs, target } = compatibilityCases.find(entry => entry.id === id)!;
    const result = classified(inputs, target as TargetState);
    expect(result.items.map(item => item.disposition), id).toEqual(['held']);
    expect(result.outcome.holds[0].code, id).toBe(id === 'unsupported-currency' ? 'SOURCE_SCHEMA' : 'ECONOMIC_CONFLICT');
  }
});

test('preserves fatal legacy outcomes with bounded not_classified detail', () => {
  const reasons: [string, BatchStopReason][] = [
    ['artifact-malformed', 'artifact_binding'],
    ['artifact-binding-mismatch', 'artifact_binding'],
    ['profile-binding-mismatch', 'artifact_binding'],
    ['nonarray', 'input_limit'],
    ['overlimit', 'input_limit'],
    ['target-invalid', 'target_invalid'],
    ['target-scope-mismatch', 'target_scope'],
    ['bad-hash-before-valid', 'delivery_conflict'],
    ['bad-hash-after-valid', 'delivery_conflict'],
    ['conflicting-delivery-observed-at', 'delivery_conflict'],
    ['late-target-delivery-conflict-replaces-holds', 'delivery_conflict'],
  ];
  for (const [id, reason] of reasons) {
    const { artifact, profile, inputs, target } = compatibilityCases.find(entry => entry.id === id)!;
    const result = classifyBatch(artifact as CompiledArtifact, profile as CustomerProfile, inputs as SourceEvent[], target as TargetState);
    expect(result, id).toEqual({
      schemaVersion: '1', outcome: frozen.cases.find(entry => entry.id === id)!.outcome,
      details: { kind: 'not_classified', reason, holdIndexes: [0], sourceBlockers: [] },
    });
  }

  const cyclicArtifact = { ...artifactA, extra: {} };
  cyclicArtifact.extra = cyclicArtifact;
  const malformedProfile = { ...profileA, unrecognized: Number.NaN };
  for (const [artifact, profile] of [[cyclicArtifact, profileA], [artifactA, malformedProfile]] as const) {
    const result = classifyBatch(artifact, profile, [invoice], emptyTargetA);
    expect(result.details).toEqual({
      kind: 'not_classified', reason: 'artifact_binding', holdIndexes: [0], sourceBlockers: [],
    });
    expect(result.outcome.holds[0]).toMatchObject({
      code: 'ARTIFACT_BINDING', diagnostics: [{ message: 'Artifact or reviewed profile is invalid' }],
    });
  }
  const duplicateRecords = { ...baselineA, invoices: [...baselineA.invoices, ...baselineA.invoices] };
  const invalidTarget = classifyBatch(artifactA, profileA, [invoice], duplicateRecords);
  expect(invalidTarget.details).toEqual({ kind: 'not_classified', reason: 'target_invalid', holdIndexes: [0], sourceBlockers: [] });
  expect(invalidTarget.outcome.holds[0]).toMatchObject({
    code: 'ECONOMIC_CONFLICT', eventIds: [invoice.id], diagnostics: [{ message: 'Target contains duplicate economic records' }],
  });

  const read = () => { throw new Error('Rejected input must never be read'); };
  const oversized = Object.defineProperty(new Array<SourceEvent>(1_001), '0', { get: read });
  const notArray = Object.defineProperty({ length: 1 }, '0', { get: read });
  for (const input of [oversized, notArray]) {
    expect(classifyBatch(artifactA, profileA, input as SourceEvent[], emptyTargetA).details).toEqual({
      kind: 'not_classified', reason: 'input_limit', holdIndexes: [0], sourceBlockers: [],
    });
  }
  const bounded = classified(Array.from({ length: 1_000 }, () => invoice));
  expect(bounded.items).toHaveLength(1_000);
  expect(bounded.items[0].disposition).toBe('financial_new');
  expect(bounded.items.slice(1).every(item => item.disposition === 'delivery_repeat' && item.primaryInputIndex === 0)).toBe(true);
});

test('keeps malformed holds and profile-local identity separate', () => {
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  const runtimeInputs = [malformed, malformed, badHash, badHash, undefined, cycle, { ...invoice, payload: { amount: 1.5 } }];
  const invalid = classified(runtimeInputs);
  expect(invalid.items.map(item => item.disposition)).toEqual(runtimeInputs.map(() => 'held'));
  expect(invalid.items.map(item => item.disposition === 'held' ? item.holdIndexes : null)).toEqual([[0], [1], [5], [6], [2], [3], [4]]);
  expect(invalid.outcome.holds.map(hold => hold.code)).toEqual([
    'SOURCE_SCHEMA', 'SOURCE_SCHEMA', 'SOURCE_SCHEMA', 'SOURCE_SCHEMA', 'SOURCE_SCHEMA', 'SOURCE_HASH_CONFLICT', 'SOURCE_HASH_CONFLICT',
  ]);
  expect(invalid.items.every(item => item.disposition === 'held' && item.mapped === null && item.groupIndex === null)).toBe(true);
  for (const inputIndex of [0, 1, 4, 5, 6]) expect(invalid.items[inputIndex].event).toBeNull();

  const sameEventId = classified([foreignSource, mappingFailure]);
  expect(sameEventId.items).toMatchObject([
    { disposition: 'held', event: { sourceRef: foreignSource.sourceRef, eventId: invoice.id }, holdIndexes: [0], mapped: null },
    { disposition: 'held', event: { sourceRef: profileA.sourceRef, eventId: invoice.id }, holdIndexes: [1], mapped: null },
  ]);
  expect(sameEventId.outcome.holds[0]).toMatchObject({ code: 'IDENTITY_SCOPE', eventIds: [invoice.id] });
  expect(sameEventId.outcome.holds[0]).not.toHaveProperty('scope');
  expect(sameEventId.outcome.holds[1]).toMatchObject({ code: 'SOURCE_DATE', eventIds: [invoice.id], scope: profileA.scope });
});

test('observes only validated unchanged selected-profile semantics', () => {
  const valid = classified([semantic]);
  expect(valid.outcome).toEqual({ plans: [], holds: [] });
  expect(valid.items).toMatchObject([{ disposition: 'semantic_observed', event: { eventId: semantic.id }, scope: profileA.scope }]);
  expect(valid.groups).toEqual([]);

  const changed = classified([changedSemantic, invoice]);
  expect(changed.items.map(item => item.disposition)).toEqual(['held', 'held']);
  expect(changed.outcome.holds.map(hold => [hold.code, hold.scope])).toEqual([
    ['SEMANTIC_VERSION', profileA.scope], ['SEMANTIC_VERSION', profileA.scope],
  ]);

  for (const [subject, expectedCode] of [
    [event({ payload: { ...semantic.payload, revision: 42 } }, semantic), 'SOURCE_SCHEMA'],
    [event({ streamId: 'a-finance' }, semantic), 'SOURCE_SCHEMA'],
    [event({ resource: invoice.resource }, semantic), 'SOURCE_SCHEMA'],
    [event({ schemaVersion: 'other-schema' }, semantic), 'SOURCE_SCHEMA'],
    [event({ rawIdentity: foreignAccount.rawIdentity, payload: { ...semantic.payload, account: 'cust-another' } }, semantic), 'UNKNOWN_ACCOUNT'],
    [event({ sourceRef: foreignSource.sourceRef }, semantic), 'IDENTITY_SCOPE'],
  ] as const) {
    const result = classified([subject]);
    expect(result.items).toMatchObject([{ disposition: 'held', mapped: null, holdIndexes: [0], groupIndex: null }]);
    expect(result.sourceBlockers).toEqual([]);
    expect(result.outcome.holds[0].code).toBe(expectedCode);
    if (expectedCode !== 'SOURCE_SCHEMA') expect(result.outcome.holds[0]).not.toHaveProperty('scope');
  }
  const otherApprovedProfile = classified([baselineEventsB[0]]);
  expect(otherApprovedProfile.items).toMatchObject([{ disposition: 'held', mapped: null }]);
  expect(otherApprovedProfile.outcome.holds[0]).toMatchObject({ code: 'IDENTITY_SCOPE' });
  expect(otherApprovedProfile.outcome.holds[0]).not.toHaveProperty('scope');
  expect(otherApprovedProfile.sourceBlockers).toEqual([]);
});

test.each([
  {
    id: 'mixed-source-guard', code: 'SEMANTIC_VERSION', causes: [0, 1, 3],
    inputs: [unscopedFinancial, unscopedSemantic, invoice, unscopedSemantic, foreignSource],
  },
  { id: 'semantic-missing-seller', code: 'SEMANTIC_VERSION', causes: [0], inputs: [semanticWithoutSeller, invoice] },
  { id: 'financial-unscoped', code: 'IDENTITY_SCOPE', causes: [1], inputs: [invoice, unscopedFinancial, foreignSource] },
])('reports only actual source guard causes for $id', ({ id, code, causes, inputs }) => {
  const result = classifyBatch(artifactA, profileA, inputs, emptyTargetA);
  expect(result.outcome).toEqual(frozen.cases.find(entry => entry.id === id)!.outcome);
  expect(result.details).toEqual({
    kind: 'not_classified', reason: 'source_guard', holdIndexes: [0],
    sourceBlockers: [{ sourceRef: profileA.sourceRef, code, causingInputIndexes: causes }],
  });
});
