import { compile } from '@eapr/compiler/compile';
import {
  hashEvent, hashProfile, targetRecordId,
  type ConnectorSpec, type CustomerProfile, type RawSourceEvent, type TargetState,
} from '@eapr/contracts';
import {
  afterLatePaymentA, ambiguousRemittanceB, baselineA, baselineEventsA, baselineEventsB,
  emptyTargetA, emptyTargetB, invoiceBeforePaymentVariant, latePaymentA, profileA, profileB,
  renamedSchemaA, validSpecA, validSpecB,
} from '../../../../tests/fixtures/index.js';

function compileFixture(spec: ConnectorSpec, profile: CustomerProfile) {
  const result = compile(spec, [profile]);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

export const artifactA = compileFixture(validSpecA, profileA);
export const artifactB = compileFixture(validSpecB, profileB);
export const [invoice, payment, credit, paymentAllocation, creditAllocation] = baselineEventsA;
export const [latePayment, lateAllocation] = latePaymentA;
export const targetAtLatePayment = { ...baselineA, asOf: afterLatePaymentA.asOf };

export function event(patch: Partial<RawSourceEvent>, base: RawSourceEvent = invoice): RawSourceEvent {
  const value = { ...base, ...patch };
  return { ...value, contentHash: hashEvent(value) };
}

export function anotherDelivery(base: RawSourceEvent, id: string, sequence: number) {
  return event({ id, sequence, recordVersion: 2, payload: { ...base.payload, version: 2 } }, base);
}

export const replayInvoice = anotherDelivery(invoice, 'evt-invoice-replay', 8);
export const independentInvoice = event({
  id: 'evt-new-invoice', recordId: 'inv-new', sequence: 11, payload: { ...invoice.payload, id: 'inv-new' },
});
export const independentPayment = event({
  id: 'evt-unallocated', recordId: 'pay-unallocated', sequence: 9,
  payload: { ...latePayment.payload, id: 'pay-unallocated' },
}, latePayment);
export const coalescedPayment = anotherDelivery(latePayment, 'evt-pay-coalesced', 8);
export const overAllocation = event({ payload: { ...lateAllocation.payload, amount: '300.01' } }, lateAllocation);
export const changedDelivery = event({ observedAt: afterLatePaymentA.asOf });
export const badHash = { ...invoice, contentHash: '0'.repeat(64) };
export const malformed = { id: 'malformed' };
export const normalizedInvoice = { ...invoice, observedAt: invoice.observedAt.replace('.000Z', 'Z') };

const semanticContract = validSpecA.sourceContracts.find(contract => contract.kind === 'semantic_change')!;
const semanticStream = validSpecA.capture.find(stream => stream.resources.includes(semanticContract.resource))!;
const revisionId = 'sem-record';
export const semantic = event({
  id: 'evt-semantics', recordId: revisionId, sequence: 1, kind: 'semantic_change',
  resource: semanticContract.resource, streamId: semanticStream.streamId, schemaVersion: semanticContract.schemaVersion,
  payload: {
    [semanticContract.recordIdField]: revisionId,
    [semanticContract.recordVersionField]: 1,
    [semanticContract.accountIdField!]: profileA.sourceAccountIds[0],
    effective_date: invoice.effectiveAt.slice(0, 10), revision: profileA.semanticVersion,
  },
});
export const changedSemantic = event({
  semanticVersion: 'sem-new', payload: { ...semantic.payload, revision: 'sem-new' },
}, semantic);
const { sellerEntityId: _seller, ...withoutSeller } = invoice.rawIdentity;
const { sourceAccountId: _account, ...withoutAccount } = semantic.rawIdentity;
export const unscopedFinancial = event({ id: 'evt-no-seller', rawIdentity: withoutSeller });
export const unscopedSemantic = event({ rawIdentity: withoutAccount }, changedSemantic);
export const semanticWithoutSeller = event({ rawIdentity: withoutSeller }, semantic);

export const foreignSource = event({ sourceRef: 'foreign-source' });
export const foreignSeller = event({ rawIdentity: { ...invoice.rawIdentity, sellerEntityId: 'foreign-seller' } });
export const foreignCompany = event({ rawIdentity: { ...invoice.rawIdentity, companyId: 'foreign-company' } });
export const foreignAccount = event({
  rawIdentity: { ...invoice.rawIdentity, sourceAccountId: 'cust-another' },
  payload: { ...invoice.payload, account: 'cust-another' },
});
export const mappingFailure = event({ payload: { ...invoice.payload, due_date: '09/30/2026' } });

export function fullReversal(original: RawSourceEvent, kind: 'payment' | 'credit') {
  const recordId = 'reverse-' + original.recordId;
  return event({
    id: 'evt-' + recordId, recordId, resource: 'a-reversals', kind: 'reversal', sequence: 10,
    payload: {
      id: recordId, version: 1, account: profileA.sourceAccountIds[0],
      effective_date: latePayment.effectiveAt.slice(0, 10), reversed_kind: kind, reversed_id: original.recordId,
    },
  }, latePayment);
}

export const paymentReversal = fullReversal(payment, 'payment');
export const creditReversal = fullReversal(credit, 'credit');
const reversalIdentity = {
  sourceRef: paymentReversal.sourceRef, sellerEntityId: profileA.scope.sellerEntityId,
  kind: 'reversal' as const, recordId: paymentReversal.recordId,
};
export const reversedTarget: TargetState = {
  ...targetAtLatePayment,
  reversals: [{
    id: targetRecordId(reversalIdentity), identity: reversalIdentity, kind: 'reversal', scope: profileA.scope,
    currency: 'USD', effectiveAt: paymentReversal.effectiveAt, sourceEventId: paymentReversal.id,
    sourceRecordVersion: paymentReversal.recordVersion, reversedKind: 'payment', reversedRecordId: payment.recordId,
  }],
};
export const allocationAfterReversal = event({
  id: 'evt-allocation-after-reversal', recordId: 'new-allocation', sequence: 12, effectiveAt: paymentReversal.effectiveAt,
  payload: { ...paymentAllocation.payload, id: 'new-allocation', effective_date: '2026-10-03' },
}, paymentAllocation);
export const unsupportedReversals = [
  event({ payload: { ...paymentReversal.payload, amount: '10.00' } }, paymentReversal),
  event({ payload: { ...paymentReversal.payload, reversed_kind: 'invoice' } }, paymentReversal),
  event({ payload: { ...paymentReversal.payload, reversed_kind: 'reversal' } }, paymentReversal),
];

const dependencyEvents = invoiceBeforePaymentVariant().events;
const mixedAccepted = [latePayment, coalescedPayment, lateAllocation, replayInvoice];
const mixedHeld = [overAllocation, independentPayment, latePayment];
const unboundProfile = { ...profileA, version: 2 };
unboundProfile.hash = hashProfile(unboundProfile);

type CompatibilityCase = {
  id: string; artifact: unknown; profile: unknown; inputs: unknown; target: unknown;
};

function scenario(id: string, inputs: unknown, options: Partial<Omit<CompatibilityCase, 'id' | 'inputs'>> = {}): CompatibilityCase {
  return { id, artifact: artifactA, profile: profileA, inputs, target: emptyTargetA, ...options };
}

export const compatibilityCases: CompatibilityCase[] = [
  scenario('a-baseline', baselineEventsA),
  scenario('b-baseline', baselineEventsB, { artifact: artifactB, profile: profileB, target: emptyTargetB }),
  scenario('empty', []),
  scenario('late-payment-only', [latePayment], { target: targetAtLatePayment }),
  scenario('late-payment-and-allocation', latePaymentA, { target: targetAtLatePayment }),
  scenario('missing-invoice', dependencyEvents.slice(0, 2), { target: targetAtLatePayment }),
  scenario('released-invoice', dependencyEvents, { target: targetAtLatePayment }),
  scenario('over-allocation-and-independent-payment', mixedHeld, { target: targetAtLatePayment }),
  scenario('changed-delivery-and-version-replay', [replayInvoice], { target: baselineA }),
  scenario('economic-conflict-amount', [event({ payload: { ...replayInvoice.payload, amount: '3000.01' } }, replayInvoice)], { target: baselineA }),
  scenario('economic-conflict-relationship', [event({ payload: { ...paymentAllocation.payload, invoice_id: 'other-invoice' } }, paymentAllocation)], { target: baselineA }),
  scenario('economic-conflict-effective-at', [event({
    effectiveAt: latePayment.effectiveAt, payload: { ...invoice.payload, effective_date: '2026-10-03' },
  })], { target: targetAtLatePayment }),
  scenario('mixed-replay-new-coalesced', mixedAccepted, { target: targetAtLatePayment }),
  scenario('full-payment-reversal', [paymentReversal], { target: targetAtLatePayment }),
  scenario('full-credit-reversal', [creditReversal], { target: targetAtLatePayment }),
  scenario('replay-reversal', [anotherDelivery(paymentReversal, 'evt-reversal-replay', 12)], { target: reversedTarget }),
  scenario('replay-all-financial-kinds', [...baselineEventsA, paymentReversal], { target: reversedTarget }),
  scenario('allocation-at-funding-reversal', [allocationAfterReversal], { target: reversedTarget }),
  ...['partial', 'invoice', 'reversal-of-reversal'].map((name, index) =>
    scenario('unsupported-' + name, [unsupportedReversals[index]], { target: targetAtLatePayment })),
  scenario('exact-repeats', [invoice, invoice, invoice]),
  scenario('normalized-repeats', [normalizedInvoice, invoice, normalizedInvoice]),
  scenario('malformed-and-valid', [malformed, invoice, malformed, independentInvoice]),
  scenario('bad-hashes', [badHash, { ...payment, contentHash: '1'.repeat(64) }, badHash]),
  scenario('bad-hash-before-valid', [badHash, invoice]),
  scenario('bad-hash-after-valid', [invoice, badHash]),
  scenario('conflicting-delivery-observed-at', [invoice, changedDelivery]),
  scenario('late-target-delivery-conflict-replaces-holds', [
    malformed, event({ id: 'evt-mapping-failure' }, mappingFailure), event({ id: invoice.id }, independentInvoice),
  ], { target: baselineA }),
  scenario('semantic-unchanged', [semantic]),
  scenario('semantic-changed-and-financial', [changedSemantic, invoice]),
  scenario('semantic-invalid-payload', [event({ payload: { ...semantic.payload, revision: 42 } }, semantic)]),
  scenario('semantic-unscoped', [unscopedSemantic, invoice]),
  scenario('semantic-missing-seller', [semanticWithoutSeller, invoice]),
  scenario('financial-unscoped', [invoice, unscopedFinancial, foreignSource]),
  scenario('mixed-source-guard', [unscopedFinancial, unscopedSemantic, invoice, unscopedSemantic, foreignSource]),
  scenario('foreign-source', [foreignSource, invoice]),
  scenario('foreign-seller', [foreignSeller]),
  scenario('foreign-company', [foreignCompany]),
  scenario('foreign-account', [foreignAccount]),
  scenario('b-unknown-account', [ambiguousRemittanceB], { artifact: artifactB, profile: profileB, target: emptyTargetB }),
  scenario('mapping-failure', [mappingFailure]),
  scenario('schema-drift', [renamedSchemaA]),
  scenario('unsupported-currency', [event({ payload: { ...invoice.payload, currency: 'CAD' } })]),
  scenario('artifact-malformed', baselineEventsA, { artifact: null }),
  scenario('artifact-binding-mismatch', baselineEventsA, {
    artifact: { ...artifactA, normalizedPlan: { ...artifactA.normalizedPlan, validators: [] } },
  }),
  scenario('profile-binding-mismatch', baselineEventsA, { profile: unboundProfile }),
  scenario('target-invalid', baselineEventsA, { target: { ...emptyTargetA, version: -1 } }),
  scenario('target-scope-mismatch', baselineEventsA, { target: emptyTargetB }),
  scenario('limit-inclusive', Array.from({ length: 1_000 }, () => invoice)),
  scenario('overlimit', Array.from({ length: 1_001 }, () => invoice)),
  scenario('nonarray', { 0: invoice, length: 1 }),
];

let randomState = 0x51c1a55;
function permutation(events: RawSourceEvent[]) {
  const shuffled = [...events];
  for (let last = shuffled.length - 1; last > 0; last--) {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    const chosen = Math.floor(randomState / 2 ** 32 * (last + 1));
    [shuffled[last], shuffled[chosen]] = [shuffled[chosen], shuffled[last]];
  }
  return shuffled;
}

for (const [id, events, options] of [
  ['a-baseline', baselineEventsA, {}],
  ['b-baseline', baselineEventsB, { artifact: artifactB, profile: profileB, target: emptyTargetB }],
  ['mixed-replay-new-coalesced', mixedAccepted, { target: targetAtLatePayment }],
  ['over-allocation-and-independent-payment', mixedHeld, { target: targetAtLatePayment }],
] as const) {
  for (let index = 1; index <= 32; index++) {
    compatibilityCases.push(scenario(id + '-permutation-' + String(index).padStart(2, '0'), permutation(events), options));
  }
}
