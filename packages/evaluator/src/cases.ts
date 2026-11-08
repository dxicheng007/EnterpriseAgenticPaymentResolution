import {
  canonicalJson, hashCanonical,
  type BootstrapManifest, type CompiledArtifact, type CustomerProfile, type FinancialKind, type Hold,
  type PlanOutcome, type RawSourceEvent, type TargetState, type VerificationCheck, type VerificationCheckId,
} from '@eapr/contracts';
import { addProbeRecords, chooseRecipe, emptyProbeTarget, rehash } from './case-recipes.js';
import { bindTruth, type ProtectedFixtureSet } from './fixtures.js';
import { addReferenceCents, evaluateReferenceState, type ReferenceView } from './reference-model.js';
import { SubjectInputSchema } from './protocol.js';
import { compareSubjectOutcome, runVerificationSubject } from './subject-comparison.js';
import { mandatoryChecks } from './verify.js';

type Subject = { artifact: CompiledArtifact; profiles: CustomerProfile[]; manifest: BootstrapManifest };
type Provenance = 'captured-baseline' | 'independent-F8-probe';
type ExpectedHold = Pick<Hold, 'code' | 'eventIds' | 'scope'>;
type CaseInput = {
  label: string;
  provenance: Provenance;
  events: RawSourceEvent[];
  target: TargetState;
  expected: ReferenceView;
  holds: ExpectedHold[];
  noPlan: boolean;
  replayOf?: string;
};
type PlannedCase = CaseInput & {
  profile: CustomerProfile;
  facts: {
    artifactHash: string;
    profileHash: string;
    inputHash: string;
    targetHash: string;
    expectedFactHash: string;
    recipeVersion: '1';
    sourceRef: string;
    sourceAccountIds: string[];
    effectiveDates: string[];
    asOf: string;
  };
};
type Unavailable = { profileHash: string; reason: 'NO_BASELINE_FACTS' | 'NO_COMPATIBLE_RECIPE' | 'UNSUPPORTED_KIND' | 'INPUT_BOUNDARY' };
type CheckPlan = { id: VerificationCheckId; cases: PlannedCase[]; unavailable: Unavailable[] };
type Bound = ReturnType<typeof bindTruth>[number];
type Recipe = NonNullable<ReturnType<typeof chooseRecipe>>;
const implementedChecks = new Set<VerificationCheckId>([
  'baseline_reconcile', 'new_record', 'duplicate_delivery', 'retry_restart', 'invalid_money',
  'allocation_scope', 'unknown_identity',
]);

function makeInput(
  label: string, provenance: Provenance, target: TargetState, events: RawSourceEvent[],
  expectedTarget: TargetState, holds: ExpectedHold[] = [], noPlan = false,
): CaseInput {
  return { label, provenance, target, events, expected: evaluateReferenceState(expectedTarget), holds, noPlan };
}

function exactHolds(actual: Hold[], expected: ExpectedHold[]) {
  const identity = (hold: ExpectedHold) => canonicalJson({
    code: hold.code, eventIds: [...hold.eventIds].sort(), scope: hold.scope ?? null,
  });
  return canonicalJson(actual.map(identity).sort()) === canonicalJson(expected.map(identity).sort());
}

function planProfile(
  subject: Subject, truth: ProtectedFixtureSet, events: RawSourceEvent[], bound: Bound,
): Partial<Record<VerificationCheckId, CaseInput[]>> {
  const { profile, target, reference } = bound;
  const captured = events.filter(event => event.rawIdentity.sellerEntityId === profile.scope.sellerEntityId &&
    event.rawIdentity.sourceAccountId && profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId));
  const empty = emptyProbeTarget(target);
  const checks: Partial<Record<VerificationCheckId, CaseInput[]>> = {};
  if (reference.records.length) {
    checks.baseline_reconcile = [
      makeInput('pinned-baseline', 'captured-baseline', empty, captured, target),
    ];
  }
  const recipe = chooseRecipe(subject.artifact, profile, subject.manifest, truth, events);
  if (!recipe) return checks;
  return { ...checks, ...planProbes(recipe, subject, truth, events, bound) };
}

function planProbes(
  recipe: Recipe, subject: Subject, truth: ProtectedFixtureSet, events: RawSourceEvent[], bound: Bound,
): Partial<Record<VerificationCheckId, CaseInput[]>> {
  const { profile } = bound;
  const target = { ...bound.target, version: 1 };
  const empty = emptyProbeTarget(target);
  const invoice = recipe.make('invoice', { kind: 'invoice', amountCents: 300000, dueDate: recipe.invoice.dueDate });
  const payment = recipe.make('payment', { kind: 'payment', amountCents: 200000 });
  const credit = recipe.make('credit', { kind: 'credit', amountCents: 20000 });
  const allocation = (label: string, amountCents: number, fundingRecordId: string, invoiceRecordId = invoice.event.recordId,
    fundingKind: 'payment' | 'credit' = 'payment') =>
    recipe.make(label, { kind: 'allocation', amountCents, fundingKind, fundingRecordId, invoiceRecordId });
  const payApplied = allocation('apply-payment', 200000, payment.event.recordId);
  const creditApplied = allocation('apply-credit', 20000, credit.event.recordId, invoice.event.recordId, 'credit');
  const original = [invoice, payment, credit, payApplied, creditApplied];
  const prior = { ...addProbeRecords(empty, original.map(item => item.record)), version: 1 };
  const fresh = recipe.make('new-payment', { kind: 'payment', amountCents: 30000 });
  const apply = allocation('new-allocation', 30000, fresh.event.recordId);
  const unapplied = addProbeRecords(prior, [fresh.record]);
  const applied = addProbeRecords(prior, [fresh.record, apply.record]);
  const after = { ...applied, version: 2 };
  const success = (label: string, priorState: TargetState, input: RawSourceEvent[], expected: TargetState, noPlan = false) =>
    makeInput(label, 'independent-F8-probe', priorState, input, expected, [], noPlan);
  const hold = (code: string, event: RawSourceEvent, scoped = true): ExpectedHold => ({
    code, eventIds: [event.id], ...(scoped ? { scope: profile.scope } : {}),
  });
  const negative = (label: string, priorState: TargetState, input: RawSourceEvent[], holds: ExpectedHold[],
    provenance: Provenance = 'independent-F8-probe') =>
    makeInput(label, provenance, priorState, input, priorState, holds, true);

  const redeliver = (event: RawSourceEvent, label: string) => rehash({
    ...event, id: recipe.probeId(label), recordVersion: 2, sequence: event.sequence + 50,
    payload: { ...event.payload, [recipe.field('version')]: 2 },
  });
  const alternate = redeliver(fresh.event, 'alternate-payment-delivery');
  const alternateAllocation = redeliver(apply.event, 'alternate-allocation-delivery');
  const conflicting = rehash({
    ...alternate, payload: { ...alternate.payload, [recipe.field('amount')]: recipe.company === 'a' ? '300.01' : 30001 },
  });

  const invalid: [string | number, string][] = recipe.company === 'a'
    ? [['1.005', 'MONEY_SCALE'], ['-1.00', 'MONEY_FORMAT'], ['1e3', 'MONEY_FORMAT']]
    : [['1.5', 'SOURCE_SCHEMA'], ['9007199254740992', 'SOURCE_SCHEMA'], [5000001, 'SOURCE_SCHEMA'], [-1, 'SOURCE_SCHEMA'], ['1e3', 'SOURCE_SCHEMA']];
  const invalidMoney = invalid.map(([value, code], index) => {
    const raw = recipe.make('invalid-money-' + index, { kind: 'payment', amountCents: 30000 }).event;
    const event = rehash({ ...raw, payload: { ...raw.payload, [recipe.field('amount')]: value } });
    return negative('invalid-money-' + index, prior, [event], [hold(code, event)]);
  });

  const surplus = recipe.make('excess-funding', { kind: 'payment', amountCents: 80001 });
  const overInvoice = allocation('excess-invoice-allocation', 80001, surplus.event.recordId);
  const underfunded = allocation('excess-funding-allocation', 30001, fresh.event.recordId);

  const foreignAccount = recipe.probeId('foreign-account');
  const foreignSeller = recipe.probeId('foreign-seller');
  function outside(event: RawSourceEvent, accountId: string, sellerEntityId = profile.scope.sellerEntityId) {
    return rehash({
      ...event, rawIdentity: { ...event.rawIdentity, sellerEntityId, sourceAccountId: accountId },
      payload: { ...event.payload, [recipe.field('account')]: accountId },
    });
  }
  const foreignInvoice = recipe.make('foreign-invoice', { kind: 'invoice', amountCents: 300000, dueDate: recipe.invoice.dueDate });
  const foreignAllocation = allocation('cross-scope-allocation', 30000, fresh.event.recordId, foreignInvoice.event.recordId);
  const crossAccount = outside(foreignInvoice.event, foreignAccount);
  const crossSeller = outside(foreignInvoice.event, recipe.accountId, foreignSeller);
  const rawUnknownIds = new Set(truth.accounts.filter(account => account.sourceAccountId.startsWith('cust-b-unknown-') &&
    !subject.profiles.some(candidate => candidate.sourceAccountIds.includes(account.sourceAccountId)))
    .flatMap(account => account.records.filter(record => record.kind === 'payment' && record.amountCents === 30000)
      .map(record => record.sourceEventId)));
  const actualUnknown = recipe.company === 'b' ? events.find(event => rawUnknownIds.has(event.id)) : undefined;
  const unknown = actualUnknown ?? outside(fresh.event, foreignAccount);
  const unknownSeller = outside(fresh.event, recipe.accountId, foreignSeller);

  return {
    new_record: [
      success('F8-base', empty, original.map(item => item.event), prior),
      success('F8-unallocated', prior, [fresh.event], unapplied),
      success('F8-allocated', prior, [fresh.event, apply.event], applied),
      makeInput('captured-unallocated', 'captured-baseline', target, [fresh.event], addProbeRecords(target, [fresh.record])),
    ],
    duplicate_delivery: [
      success('identical-delivery', after, [fresh.event, apply.event], after, true),
      success('same-economic-new-delivery', after, [alternate, alternateAllocation], after, true),
      negative('conflicting-economic-delivery', after, [conflicting], [hold('ECONOMIC_CONFLICT', conflicting)]),
    ],
    retry_restart: [
      success('planner-first', prior, [fresh.event, apply.event], applied),
      { ...success('planner-fresh-process', prior, [fresh.event, apply.event], applied), replayOf: 'planner-first' },
      success('planner-already-applied', after, [fresh.event, apply.event], after, true),
    ],
    invalid_money: invalidMoney,
    allocation_scope: [
      negative('over-invoice', addProbeRecords(prior, [surplus.record]), [overInvoice.event], [hold('INVOICE_OVERALLOCATION', overInvoice.event)]),
      negative('over-funding', unapplied, [underfunded.event], [hold('FUNDING_OVERALLOCATION', underfunded.event)]),
      negative('cross-account', unapplied, [crossAccount, foreignAllocation.event],
        [hold('UNKNOWN_ACCOUNT', crossAccount, false), hold('DEPENDENCY_MISSING', foreignAllocation.event)]),
      negative('cross-seller', unapplied, [crossSeller, foreignAllocation.event],
        [hold('IDENTITY_SCOPE', crossSeller, false), hold('DEPENDENCY_MISSING', foreignAllocation.event)]),
    ],
    unknown_identity: [
      negative('unknown-account', target, [unknown], [hold('UNKNOWN_ACCOUNT', unknown, false)],
        actualUnknown ? 'captured-baseline' : 'independent-F8-probe'),
      negative('unknown-seller', target, [unknownSeller], [hold('IDENTITY_SCOPE', unknownSeller, false)]),
    ],
  };
}

function unavailableReason(
  id: VerificationCheckId, artifact: CompiledArtifact, profile: CustomerProfile, tests: CaseInput[] | undefined,
): Unavailable['reason'] | undefined {
  if (!tests?.length) return id === 'baseline_reconcile' ? 'NO_BASELINE_FACTS' : 'NO_COMPATIBLE_RECIPE';
  if (id !== 'baseline_reconcile' && tests.some(test => test.events.some(event =>
    event.kind !== 'semantic_change' && !artifact.normalizedPlan.allowedKinds.includes(event.kind)))) return 'UNSUPPORTED_KIND';
  for (const test of tests) {
    const wire = SubjectInputSchema.safeParse({
      protocolVersion: 1, requestId: '00000000-0000-0000-0000-000000000000', artifact, profile,
      events: test.events, target: test.target,
    });
    if (!wire.success || Buffer.byteLength(JSON.stringify(wire.data)) + 1 > 10 * 1024 * 1024) return 'INPUT_BOUNDARY';
  }
}

/** Build the full profile matrix before launching any subject. Keep the plan within the protected evaluator. */
export function buildCasePlan(subject: Subject, truth: ProtectedFixtureSet, events: RawSourceEvent[]): CheckPlan[] {
  const matrix = bindTruth(truth, subject.profiles).map(bound => ({
    profile: bound.profile, checks: planProfile(subject, truth, events, bound),
  }));
  return mandatoryChecks.map(id => {
    if (!implementedChecks.has(id)) return { id, unavailable: [], cases: [] };
    const unavailable = matrix.flatMap(({ profile, checks }) => {
      const reason = unavailableReason(id, subject.artifact, profile, checks[id]);
      return reason ? [{ profileHash: profile.hash, reason }] : [];
    });
    if (unavailable.length) return { id, unavailable, cases: [] };
    const cases = matrix.flatMap(({ profile, checks }) => (checks[id] ?? []).map(test => ({
      ...test, profile,
      facts: {
        artifactHash: subject.artifact.hash, profileHash: profile.hash, inputHash: hashCanonical(test.events),
        targetHash: hashCanonical(test.target),
        expectedFactHash: hashCanonical({ records: test.expected.records, balanceCents: test.expected.balanceCents,
          holds: test.holds, noPlan: test.noPlan, replayOf: test.replayOf ?? null }),
        recipeVersion: '1' as const, sourceRef: profile.sourceRef,
        sourceAccountIds: [...new Set(test.events.flatMap(event => event.rawIdentity.sourceAccountId ?? []))].sort(),
        effectiveDates: [...new Set(test.events.map(event => event.effectiveAt.slice(0, 10)))].sort(),
        asOf: test.target.asOf,
      },
    })));
    return { id, unavailable, cases };
  });
}

export async function runCasePlan(artifact: CompiledArtifact, plan: CheckPlan[]) {
  if (plan.some(check => check.cases.some(test =>
    test.facts.artifactHash !== artifact.hash || test.facts.profileHash !== test.profile.hash))) {
    throw new Error('Verification case binding failed');
  }
  const checks: VerificationCheck[] = [];
  const eventKinds = new Set<FinancialKind>();
  const privateResults: { id: VerificationCheckId; passed: number; failed: number; unavailable: Unavailable[] }[] = [];
  let difference = 0;
  for (const check of plan) {
    const outcomes = new Map<string, PlanOutcome>();
    let passed = 0;
    let failed = 0;
    for (const test of check.cases) {
      const output = await runVerificationSubject(artifact, test.profile, test.events, test.target);
      for (const event of test.events) {
        if (event.kind !== 'semantic_change' && artifact.normalizedPlan.allowedKinds.includes(event.kind)) eventKinds.add(event.kind);
      }
      if (!output.ok) {
        failed++;
        continue;
      }
      const outcome = output.value.outcome;
      const comparison = compareSubjectOutcome(artifact, test.profile, test.target, test.expected, outcome);
      const prior = test.replayOf && outcomes.get(test.profile.hash + ':' + test.replayOf);
      const deterministic = !test.replayOf || (prior && canonicalJson(prior) === canonicalJson(outcome));
      if (check.id === 'retry_restart') outcomes.set(test.profile.hash + ':' + test.label, outcome);
      difference = addReferenceCents(difference, comparison.unexplainedDifferenceCents);
      if (comparison.matches && deterministic && exactHolds(outcome.holds, test.holds) &&
        (!test.noPlan || outcome.plans.length === 0)) passed++;
      else failed++;
    }
    privateResults.push({ id: check.id, passed, failed, unavailable: check.unavailable });
    checks.push({
      id: check.id, cases: passed + failed,
      status: failed ? 'failed' : passed ? 'passed' : 'unavailable',
      diagnosticCodes: [],
    });
  }
  return { checks, eventKinds: [...eventKinds].sort(), difference, privateResults };
}
