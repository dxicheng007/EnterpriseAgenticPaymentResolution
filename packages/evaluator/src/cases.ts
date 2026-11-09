import {
  canonicalJson, hashCanonical,
  type BootstrapManifest, type CompiledArtifact, type CustomerProfile, type FinancialKind, type Hold,
  type PlanOutcome, type RawSourceEvent, type SourceSnapshot, type TargetState, type VerificationCheck, type VerificationCheckId,
} from '@eapr/contracts';
import { captureInputHash, planCaptureValidation, runCaptureValidation, type CaptureValidation } from './capture-boundary.js';
import { addProbeRecords, chooseRecipe, emptyProbeTarget, rehash } from './case-recipes.js';
import type { CapturedEvidenceRun } from './evidence-support.js';
import { bindTruth, type ProtectedFixtureSet } from './fixtures.js';
import { addReferenceCents, evaluateReferenceState, type ReferenceView } from './reference-model.js';
import { SubjectInputSchema } from './protocol.js';
import { compareSubjectOutcome, runVerificationSubject } from './subject-comparison.js';
import { mandatoryChecks } from './verify.js';

type Subject = { artifact: CompiledArtifact; profiles: CustomerProfile[]; manifest: BootstrapManifest };
type Provenance = 'captured-baseline' | 'independent-F8-probe';
type ExpectedHold = Pick<Hold, 'code' | 'eventIds' | 'scope'>;
type PlannerCase = {
  kind: 'planner';
  label: string;
  provenance: Provenance;
  events: RawSourceEvent[];
  target: TargetState;
  expected: ReferenceView;
  holds: ExpectedHold[];
  noPlan: boolean;
  replayOf?: string;
};
type CaptureCase = { kind: 'capture-validation'; label: string; provenance: 'captured-baseline'; action: CaptureValidation };
type CaseInput = PlannerCase | CaptureCase;
type PlannedCase = CaseInput & {
  profile: CustomerProfile;
  facts: {
    artifactHash: string;
    profileHash: string;
    inputHash: string;
    targetHash: string;
    expectedFactHash: string;
    recipeVersion: '2';
    sourceRef: string;
    sourceAccountIds: string[];
    effectiveDates: string[];
    asOf: string;
  };
};
type Unavailable = { profileHash: string; reason: 'NO_BASELINE_FACTS' | 'NO_COMPATIBLE_RECIPE' | 'UNSUPPORTED_KIND' | 'INPUT_BOUNDARY' };
type CheckPlan = {
  id: VerificationCheckId; cases: PlannedCase[]; requiredCases: string[]; unavailable: Unavailable[];
};
type Bound = ReturnType<typeof bindTruth>[number];
type Recipe = NonNullable<ReturnType<typeof chooseRecipe>>;
const implementedChecks = new Set<VerificationCheckId>([
  'baseline_reconcile', 'new_record', 'duplicate_delivery', 'retry_restart', 'invalid_money',
  'allocation_scope', 'unknown_identity', 'full_reversal', 'dependency_order', 'schema_drift',
  'semantic_drift', 'snapshot_boundary',
]);

function makeInput(
  label: string, provenance: Provenance, target: TargetState, events: RawSourceEvent[],
  expectedTarget: TargetState, holds: ExpectedHold[] = [], noPlan = false,
): PlannerCase {
  return { kind: 'planner', label, provenance, target, events, expected: evaluateReferenceState(expectedTarget), holds, noPlan };
}

function exactHolds(actual: Hold[], expected: ExpectedHold[]) {
  const identity = (hold: ExpectedHold) => canonicalJson({
    code: hold.code, eventIds: [...hold.eventIds].sort(), scope: hold.scope ?? null,
  });
  return canonicalJson(actual.map(identity).sort()) === canonicalJson(expected.map(identity).sort());
}

function planProfile(
  subject: Subject, truth: ProtectedFixtureSet, events: RawSourceEvent[], bound: Bound, snapshot?: SourceSnapshot,
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
  return {
    ...checks, ...planProbes(recipe, subject, truth, events, bound),
    snapshot_boundary: snapshot && planSnapshotBoundary(recipe, subject, truth, snapshot, events, { ...target, version: 1 }, profile),
  };
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

  const fullReversal: CaseInput[] = [];
  const reversalAt = recipe.laterInstant(1);
  const reallocateAt = recipe.laterInstant(2);
  if (reversalAt && reallocateAt) {
    const reverse = (kind: 'payment' | 'credit', recordId: string) =>
      recipe.make('reverse-' + kind, { kind: 'reversal', reversedKind: kind, reversedRecordId: recordId },
        { effectiveAt: reversalAt });
    const paymentReversal = reverse('payment', payment.event.recordId);
    const creditReversal = reverse('credit', credit.event.recordId);
    const earlier = { ...prior, asOf: recipe.invoice.effectiveAt };
    const effective = { ...prior, asOf: reversalAt };
    const paidBack = addProbeRecords(effective, [paymentReversal.record]);
    const creditedBack = addProbeRecords(effective, [creditReversal.record]);
    const replayState = { ...paidBack, version: 2, asOf: reallocateAt };
    const reallocate = recipe.make('reallocate-reversed-payment', {
      kind: 'allocation', amountCents: 30000, fundingKind: 'payment',
      fundingRecordId: payment.event.recordId, invoiceRecordId: invoice.event.recordId,
    }, { effectiveAt: reallocateAt }).event;
    fullReversal.push(
      success('reversal-before-effective-asof', earlier, [paymentReversal.event], addProbeRecords(earlier, [paymentReversal.record])),
      success('full-payment-reversal', effective, [paymentReversal.event], paidBack),
      success('full-credit-reversal', effective, [creditReversal.event], creditedBack),
      success('identical-reversal-replay', replayState, [paymentReversal.event], replayState, true),
      negative('reallocate-reversed-funding', replayState, [reallocate], [hold('FUNDING_REVERSED', reallocate)]),
    );
    const invalidReversals = [
      ['partial-amount', { [recipe.field('amount')]: recipe.company === 'a' ? '1.00' : 100 }],
      ['invoice-reversal', { [recipe.field('reversed_kind')]: 'invoice', [recipe.field('reversed_id')]: invoice.event.recordId }],
      ['reversal-of-reversal', { [recipe.field('reversed_kind')]: 'reversal',
        [recipe.field('reversed_id')]: paymentReversal.event.recordId }],
    ] as const;
    for (const [label, fields] of invalidReversals) {
      const invalid = rehash({ ...paymentReversal.event, payload: { ...paymentReversal.event.payload, ...fields } });
      fullReversal.push(negative(label, replayState, [invalid], [hold('SOURCE_SCHEMA', invalid)]));
    }
  }

  const fundingPrior = { ...addProbeRecords(empty, [payment.record]), version: 1 };
  const dependencyComplete = addProbeRecords(fundingPrior, [invoice.record, payApplied.record]);
  const initialGroup = [invoice.event, payment.event, payApplied.event];

  const amountField = recipe.field('amount');
  const { [amountField]: removedAmount, ...withoutAmount } = fresh.event.payload;
  const schemaCases = [
    ['amount-removed', withoutAmount],
    ['amount-renamed', { ...withoutAmount, unapproved_amount: removedAmount }],
    ['amount-wrong-type', { ...fresh.event.payload, [amountField]: recipe.company === 'a' ? 30000 : '30000' }],
  ] as const;
  const schemaDrift = schemaCases.map(([label, payload]) => {
    const event = rehash({ ...fresh.event, payload });
    return negative(label, prior, [event], [hold('SOURCE_SCHEMA', event)]);
  });

  const unknownVersion = recipe.probeId('unseen-semantic-version');
  const unseenFinance = rehash({ ...fresh.event, semanticVersion: unknownVersion });
  const changedSemantics = recipe.semantic('changed-semantics', unknownVersion);
  const { sourceAccountId: _ignored, ...sourceIdentity } = changedSemantics.rawIdentity;
  const unscopedSemantics = rehash({ ...changedSemantics, rawIdentity: sourceIdentity });

  return {
    full_reversal: fullReversal,
    dependency_order: [
      negative('missing-invoice', fundingPrior, [payApplied.event], [hold('DEPENDENCY_MISSING', payApplied.event)]),
      success('invoice-restores-dependency', fundingPrior, [invoice.event, payApplied.event], dependencyComplete),
      success('dependency-group-first-order', empty, initialGroup, dependencyComplete),
      { ...success('dependency-group-second-order', empty, [...initialGroup].reverse(), dependencyComplete),
        replayOf: 'dependency-group-first-order' },
    ],
    schema_drift: schemaDrift,
    semantic_drift: [
      negative('unseen-financial-semantics', prior, [unseenFinance], [hold('SEMANTIC_VERSION', unseenFinance)]),
      negative('same-account-semantic-change', prior, [changedSemantics, fresh.event],
        [hold('SEMANTIC_VERSION', changedSemantics), hold('SEMANTIC_VERSION', fresh.event)]),
      negative('unscoped-semantic-governance', prior, [unscopedSemantics, fresh.event],
        [{ code: 'SEMANTIC_VERSION', eventIds: [unscopedSemantics.id, fresh.event.id] }]),
    ],
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

function planSnapshotBoundary(
  recipe: Recipe, subject: Subject, truth: ProtectedFixtureSet, snapshot: SourceSnapshot,
  events: RawSourceEvent[], target: TargetState, profile: CustomerProfile,
): CaseInput[] | undefined {
  const { manifest } = subject;
  const validation = planCaptureValidation({ truth, manifest, snapshot, events });
  if (!validation) return;
  const kinds = recipe.company === 'a' ? ['payment', 'semantic_change'] as const : ['payment', 'credit', 'semantic_change'] as const;
  if (manifest.streams.length !== kinds.length) return;
  const capturedIds = new Set(snapshot.eventIds);
  const cases: CaseInput[] = validation.map(action => ({
    kind: 'capture-validation', label: action.label, provenance: 'captured-baseline', action,
  }));
  for (const kind of kinds) {
    const stream = manifest.streams.find(member => member.streamId === recipe.streamFor(kind));
    if (!stream || Number(stream.resumeAfter) >= Number.MAX_SAFE_INTEGER) return;
    const sequence = Number(stream.resumeAfter) + 1;
    if (kind === 'semantic_change') {
      const event = recipe.semantic('after-captured-semantic', profile.semanticVersion, { sequence });
      if (capturedIds.has(event.id)) return;
      cases.push(makeInput('after-captured-semantic', 'captured-baseline', target, [event], target, [], true));
      continue;
    }
    const { event, record } = recipe.make('after-captured-' + kind, { kind, amountCents: 30000 }, { sequence });
    if (capturedIds.has(event.id)) return;
    const post = { ...addProbeRecords(target, [record]), version: target.version + 1 };
    cases.push(
      makeInput('after-captured-' + kind, 'captured-baseline', target, [event], post),
      makeInput('replay-after-captured-' + kind, 'captured-baseline', post, [event], post, [], true),
    );
  }
  return cases;
}

function unavailableReason(
  id: VerificationCheckId, artifact: CompiledArtifact, profile: CustomerProfile, tests: CaseInput[] | undefined,
): Unavailable['reason'] | undefined {
  if (!tests?.length) return id === 'baseline_reconcile' ? 'NO_BASELINE_FACTS' : 'NO_COMPATIBLE_RECIPE';
  if (id !== 'baseline_reconcile' && tests.some(test => test.kind === 'planner' && test.events.some(event =>
    event.kind !== 'semantic_change' && !artifact.normalizedPlan.allowedKinds.includes(event.kind)))) return 'UNSUPPORTED_KIND';
  for (const test of tests) {
    if (test.kind !== 'planner') continue;
    const wire = SubjectInputSchema.safeParse({
      protocolVersion: 1, requestId: '00000000-0000-0000-0000-000000000000', artifact, profile,
      events: test.events, target: test.target,
    });
    if (!wire.success || Buffer.byteLength(JSON.stringify(wire.data)) + 1 > 10 * 1024 * 1024) return 'INPUT_BOUNDARY';
  }
}

/** Build the full profile matrix before launching any subject. Keep the plan within the protected evaluator. */
export function buildCasePlan(
  subject: Subject, truth: ProtectedFixtureSet, events: RawSourceEvent[], snapshot?: SourceSnapshot,
): CheckPlan[] {
  const matrix = bindTruth(truth, subject.profiles).map(bound => ({
    profile: bound.profile, checks: planProfile(subject, truth, events, bound, snapshot),
  }));
  return mandatoryChecks.map(id => {
    if (!implementedChecks.has(id)) return { id, unavailable: [], cases: [], requiredCases: [] };
    const unavailable = matrix.flatMap(({ profile, checks }) => {
      const reason = unavailableReason(id, subject.artifact, profile, checks[id]);
      return reason ? [{ profileHash: profile.hash, reason }] : [];
    });
    if (unavailable.length) return { id, unavailable, cases: [], requiredCases: [] };
    const cases = matrix.flatMap(({ profile, checks }) => (checks[id] ?? []).map(test => planCase(subject, profile, test)));
    return { id, unavailable, cases, requiredCases: cases.map(caseKey) };
  });
}

function planCase(subject: Subject, profile: CustomerProfile, test: CaseInput): PlannedCase {
  const binding = {
    artifactHash: subject.artifact.hash, profileHash: profile.hash,
    recipeVersion: '2' as const, sourceRef: profile.sourceRef,
  };
  if (test.kind === 'capture-validation') {
    return { ...test, profile, facts: {
      ...binding, inputHash: captureInputHash(test.action), targetHash: test.action.capture.snapshot.contentHash,
      expectedFactHash: hashCanonical(test.action.accepts), asOf: test.action.capture.manifest.asOf,
      sourceAccountIds: [...profile.sourceAccountIds].sort(), effectiveDates: [],
    } };
  }
  return { ...test, profile, facts: {
    ...binding, inputHash: hashCanonical(test.events), targetHash: hashCanonical(test.target),
    expectedFactHash: hashCanonical({ records: test.expected.records, balanceCents: test.expected.balanceCents,
      holds: test.holds, noPlan: test.noPlan, replayOf: test.replayOf ?? null }),
    sourceAccountIds: [...new Set(test.events.flatMap(event => event.rawIdentity.sourceAccountId ?? []))].sort(),
    effectiveDates: [...new Set(test.events.map(event => event.effectiveAt.slice(0, 10)))].sort(),
    asOf: test.target.asOf,
  } };
}

function caseKey(test: PlannedCase): string {
  return test.profile.hash + ':' + test.kind + ':' + test.label;
}

export async function runCasePlan(
  artifact: CompiledArtifact, plan: CheckPlan[], observeCaptured?: (run: CapturedEvidenceRun) => void, strictTransport = false,
) {
  if (plan.some(check => canonicalJson(check.cases.map(caseKey)) !== canonicalJson(check.requiredCases) ||
    new Set(check.requiredCases).size !== check.requiredCases.length ||
    check.cases.some(test => test.facts.artifactHash !== artifact.hash || test.facts.profileHash !== test.profile.hash))) {
    throw new Error('Verification case binding failed');
  }
  const checks: VerificationCheck[] = [];
  const eventKinds = new Set<FinancialKind>();
  const privateResults: {
    id: VerificationCheckId; passed: number; failed: number; unavailable: Unavailable[];
    plannerExecutions: number; captureValidationExecutions: number;
  }[] = [];
  let difference = 0;
  for (const check of plan) {
    const outcomes = new Map<string, PlanOutcome>();
    let passed = 0;
    let failed = 0;
    let plannerExecutions = 0;
    let captureValidationExecutions = 0;
    const replaySources = new Set(check.cases.flatMap(test => test.kind === 'planner' && test.replayOf
      ? [test.profile.hash + ':' + test.replayOf] : []));
    for (const test of check.cases) {
      if (test.kind === 'capture-validation') {
        captureValidationExecutions++;
        if (runCaptureValidation(test.action)) passed++;
        else failed++;
        continue;
      }
      plannerExecutions++;
      const output = await runVerificationSubject(artifact, test.profile, test.events, test.target);
      if (!output.ok && strictTransport) throw new Error('Protected subject execution failed');
      if (check.id === 'baseline_reconcile' && observeCaptured) {
        observeCaptured({
          artifactHash: artifact.hash, profileHash: test.profile.hash, events: test.events,
          target: test.target, expected: test.expected, outcome: output.ok ? output.value.outcome : null,
        });
      }
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
      const replayKey = test.profile.hash + ':' + test.label;
      if (replaySources.has(replayKey)) outcomes.set(replayKey, outcome);
      difference = addReferenceCents(difference, comparison.unexplainedDifferenceCents);
      if (comparison.matches && deterministic && exactHolds(outcome.holds, test.holds) &&
        (!test.noPlan || outcome.plans.length === 0)) passed++;
      else failed++;
    }
    privateResults.push({ id: check.id, passed, failed, unavailable: check.unavailable, plannerExecutions, captureValidationExecutions });
    checks.push({
      id: check.id, cases: passed + failed,
      status: failed ? 'failed' : passed ? 'passed' : 'unavailable',
      diagnosticCodes: [],
    });
  }
  return { checks, eventKinds: [...eventKinds].sort(), difference, privateResults };
}
