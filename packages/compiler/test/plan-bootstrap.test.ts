import { expect, test } from 'vitest';
import {
  hashArtifact, hashEvent, hashPlan, hashProfile, PlanOutcomeSchema,
  type ConnectorSpec, type CustomerProfile, type SourceEvent, type TargetState,
} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { planBatch } from '@eapr/compiler/plan-batch';
import { planBootstrap } from '@eapr/compiler/plan-bootstrap';
import { projectBootstrapTarget } from '@eapr/parent/bootstrap';
import { leafPointers } from '../src/plan-bootstrap.js';
import {
  baselineA, baselineEventsA, baselineEventsB, emptyTargetA, emptyTargetB,
  profileA, profileB, validSpecA, validSpecB,
} from '../../../tests/fixtures/index.js';

function withBootstrap(base = profileA): CustomerProfile {
  const profile = {
    ...base,
    bootstrap: {
      customer: { id: base.parentCustomerId, displayName: ' Shared Buyer  ', evidenceRefs: ['ev-name', 'ev-identity'] },
      billingConfigurationIds: [{ termId: base.contractTerms[0].id, id: 'config-1' }],
    },
  };
  return { ...profile, hash: hashProfile(profile) };
}

function artifact(profile: CustomerProfile, spec: ConnectorSpec = validSpecA) {
  const result = compile(spec, [profile]);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

function event(patch: Partial<SourceEvent>, base = baselineEventsA[0]): SourceEvent {
  const value = { ...base, ...patch };
  return { ...value, contentHash: hashEvent(value) };
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('prepends three scoped ensures to the complete A financial plan without mutating inputs', () => {
  const profile = withBootstrap();
  const inputs = freeze(structuredClone({ subject: artifact(profile), profile, events: baselineEventsA, target: emptyTargetA }));
  const financial = planBatch(inputs.subject, inputs.profile, inputs.events, inputs.target).plans[0];
  const outcome = planBootstrap(inputs.subject, inputs.profile, inputs.events, inputs.target);
  expect(PlanOutcomeSchema.safeParse(outcome).success).toBe(true);
  expect(outcome.holds).toEqual([]);
  expect(outcome.plans).toHaveLength(1);
  const [plan] = outcome.plans;
  expect(plan.operations.slice(0, 3)).toEqual([
    { op: 'ensure_customer', record: { id: 'buyer-shared-1', displayName: ' Shared Buyer  ', evidenceRefs: ['ev-identity', 'ev-name'] } },
    { op: 'ensure_account', record: {
      id: 'a.seller-a.customer-1', scope: profile.scope, parentCustomerId: 'buyer-shared-1',
      sourceRef: 'legacy-a', sourceAccountIds: ['cust-a-1'],
    } },
    { op: 'ensure_billing_configuration', record: { id: 'config-1', scope: profile.scope, contractTerm: profile.contractTerms[0] } },
  ]);
  expect(plan.operations).toHaveLength(8);
  expect(plan.operations.slice(3)).toEqual(financial.operations);
  expect(plan.lineage.filter(row => row.operationIndex >= 3)).toEqual(
    financial.lineage.map(row => ({ ...row, operationIndex: row.operationIndex + 3 })),
  );
  expect(plan).toMatchObject({
    scope: financial.scope, artifactHash: financial.artifactHash, profileHash: financial.profileHash,
    eventIds: financial.eventIds, asOf: financial.asOf, expectedTargetVersion: financial.expectedTargetVersion,
    expectedBalanceCents: 80000,
  });
  expect(plan.hash).toBe(hashPlan(plan));
  expect(plan.hash).not.toBe(financial.hash);
  expect(inputs.target).toEqual(emptyTargetA);
});

test('allows a fully reconciled zero balance with nonempty B operations', () => {
  const profile = withBootstrap(profileB);
  const invoice = event({ payload: { ...baselineEventsB[0].payload, amount_minor: 220000 } }, baselineEventsB[0]);
  const result = planBootstrap(artifact(profile, validSpecB), profile, [invoice, ...baselineEventsB.slice(1)], emptyTargetB);
  expect(result.holds).toEqual([]);
  expect(result.plans).toHaveLength(1);
  expect(result.plans[0].expectedBalanceCents).toBe(0);
  expect(result.plans[0].operations).toHaveLength(8);
});

test('orders configurations by configuration ID and emits exactly the approved metadata leaf lineage', () => {
  const base = withBootstrap();
  const profile: CustomerProfile = {
    ...base,
    sourceAccountIds: ['cust-a-2', 'cust-a-1'],
    approvedLookups: [{ ...base.approvedLookups[0], entries: [
      ...base.approvedLookups[0].entries,
      { source: 'cust-a-2', target: base.scope.accountId, evidenceRefs: ['ev-z', 'ev-a-identity'] },
      { source: 'unselected', target: base.scope.accountId, evidenceRefs: ['ev-excluded'] },
    ] }],
    contractTerms: [
      { ...base.contractTerms[0], evidenceRefs: ['ev-z', 'ev-a'] },
      { ...base.contractTerms[0], id: 'term-a-2', contractId: 'contract-a-2', evidenceRefs: ['ev-other'] },
    ],
    bootstrap: {
      customer: base.bootstrap!.customer,
      billingConfigurationIds: [{ termId: 'term-a-1', id: 'config-z' }, { termId: 'term-a-2', id: 'config-a' }],
    },
  };
  profile.hash = hashProfile(profile);
  const subject = artifact(profile);
  const result = planBootstrap(subject, profile, baselineEventsA, emptyTargetA);
  expect(result.holds).toEqual([]);
  const [plan] = result.plans;
  expect(plan.operations.slice(2, 4).map(({ record }) => record.id)).toEqual(['config-a', 'config-z']);
  const configFields = [
    '/contractTerm/anchorDay', '/contractTerm/cadence', '/contractTerm/contractId', '/contractTerm/currency',
  ];
  const configSuffix = [
    '/contractTerm/fixedMonthlyFeeCents', '/contractTerm/id', '/contractTerm/validFrom', '/contractTerm/validToExclusive',
    '/id', '/scope/accountId', '/scope/companyId', '/scope/sellerEntityId',
  ];
  const expectedLineage = [
    { paths: ['/displayName', '/evidenceRefs/0', '/evidenceRefs/1', '/id'], refs: ['ev-identity', 'ev-name'], inputs: ['profile-a'] },
    { paths: ['/id', '/parentCustomerId', '/scope/accountId', '/scope/companyId', '/scope/sellerEntityId',
      '/sourceAccountIds/0', '/sourceAccountIds/1', '/sourceRef'],
    refs: ['ev-a-identity', 'ev-identity', 'ev-name', 'ev-z'], inputs: ['profile-a'] },
    { paths: [...configFields, '/contractTerm/evidenceRefs/0', ...configSuffix], refs: ['ev-other'], inputs: ['profile-a', 'term-a-2'] },
    { paths: [...configFields, '/contractTerm/evidenceRefs/0', '/contractTerm/evidenceRefs/1', ...configSuffix],
      refs: ['ev-a', 'ev-z'], inputs: ['profile-a', 'term-a-1'] },
  ].flatMap(({ paths, refs, inputs }, operationIndex) => paths.map(targetField => ({
    operationIndex, targetField, evidenceRefs: refs, derivationInputs: inputs,
    sourceEventIds: [], sourcePaths: [], mapping: null,
  })));
  expect(plan.lineage.filter(row => row.operationIndex < 4)).toEqual(expectedLineage);
  expect(plan.operations[2].record).toMatchObject({ contractTerm: { id: 'term-a-2', validToExclusive: null, evidenceRefs: ['ev-other'] } });

  const reordered = structuredClone(profile);
  reordered.bootstrap!.customer.evidenceRefs.reverse();
  reordered.bootstrap!.billingConfigurationIds.reverse();
  reordered.contractTerms[0].evidenceRefs.reverse();
  reordered.contractTerms.reverse();
  reordered.sourceAccountIds.reverse();
  reordered.approvedLookups[0].entries.reverse();
  expect(hashProfile(reordered)).toBe(profile.hash);
  expect(planBootstrap(subject, reordered, [...baselineEventsA].reverse(), emptyTargetA)).toEqual(result);
});

test('walks empty arrays and null leaves with RFC 6901 escaping', () => {
  // Valid compiled profiles require citations and at least one source account.
  // Exercise the generic traversal without bypassing those eligibility checks.
  expect(leafPointers({ 'key~/': [null, [], { flag: false }] })).toEqual([
    '/key~0~1/0', '/key~0~1/1', '/key~0~1/2/flag',
  ]);
});

test('keeps explicit ensures on exact reuse and blocks each conflicting record', () => {
  const profile = withBootstrap();
  const subject = artifact(profile);
  const first = planBootstrap(subject, profile, baselineEventsA, emptyTargetA);
  expect(first.plans).toHaveLength(1);
  const target = projectBootstrapTarget(emptyTargetA, first.plans[0].operations.slice(0, 3));
  expect(planBootstrap(subject, profile, baselineEventsA, target)).toEqual(first);
  for (const conflict of [
    { ...target, customers: [{ ...target.customers[0], evidenceRefs: [...target.customers[0].evidenceRefs].reverse() }] },
    { ...target, accounts: [{ ...target.accounts[0], sourceAccountIds: ['other-source-account'] }] },
    { ...target, billingConfigurations: [{ ...target.billingConfigurations[0],
      contractTerm: { ...target.billingConfigurations[0].contractTerm, fixedMonthlyFeeCents: 1 } }] },
  ]) {
    const result = planBootstrap(subject, profile, baselineEventsA, conflict);
    expect(result.plans).toEqual([]);
    expect(result.holds.map(hold => hold.code)).toContain('BOOTSTRAP_METADATA_CONFLICT');
  }
});

test('requires valid bootstrap metadata before it mints a plan', () => {
  const profile = withBootstrap();
  const subject = artifact(profile);
  for (const result of [
    planBootstrap(artifact(profileA), profileA, baselineEventsA, emptyTargetA),
    planBootstrap(subject, { ...profile, parentCustomerId: 'other' }, baselineEventsA, emptyTargetA),
  ]) {
    expect(result.plans).toEqual([]);
    expect(result.holds.map(hold => hold.code)).toContain('BOOTSTRAP_METADATA_UNAVAILABLE');
  }
});

test('blocks invalid targets while retaining existing financial target diagnostics', () => {
  const profile = withBootstrap();
  const subject = artifact(profile);
  for (const [target, codes] of [
    [{ ...emptyTargetA, scope: emptyTargetB.scope }, ['TARGET_SCOPE', 'BOOTSTRAP_BASELINE_BLOCKED']],
    [{ ...emptyTargetA, version: -1 }, ['TARGET_STATE_INVALID', 'BOOTSTRAP_BASELINE_BLOCKED']],
    [{ ...emptyTargetA, customers: [profile.bootstrap!.customer, profile.bootstrap!.customer] }, ['BOOTSTRAP_BASELINE_BLOCKED']],
  ] satisfies [TargetState, string[]][]) {
    const result = planBootstrap(subject, profile, baselineEventsA, target);
    expect(result.plans).toEqual([]);
    expect(result.holds.map(hold => hold.code)).toEqual(codes);
  }
});

test('preserves artifact binding failures as blocked baselines', () => {
  const profile = withBootstrap();
  const subject = artifact(profile);
  const notBound = { ...subject, requiredProfileHashes: [] };
  notBound.hash = hashArtifact(notBound);
  for (const result of [
    planBootstrap(subject, { ...profile, hash: 'a'.repeat(64) }, baselineEventsA, emptyTargetA),
    planBootstrap({ ...subject, hash: 'b'.repeat(64) }, profile, baselineEventsA, emptyTargetA),
    planBootstrap(notBound, profile, baselineEventsA, emptyTargetA),
  ]) {
    expect(result.plans).toEqual([]);
    expect(result.holds.map(hold => hold.code)).toEqual(expect.arrayContaining([
      'ARTIFACT_BINDING', 'BOOTSTRAP_BASELINE_BLOCKED',
    ]));
  }
});

test('requires new financial operations on empty capture and exact financial replay', () => {
  const profile = withBootstrap();
  const subject = artifact(profile);
  for (const result of [
    planBootstrap(subject, profile, [], emptyTargetA),
    planBootstrap(subject, profile, baselineEventsA, baselineA),
  ]) {
    expect(result.plans).toEqual([]);
    expect(result.holds.map(hold => hold.code)).toContain('BOOTSTRAP_BASELINE_REQUIRED');
  }
});

test('preserves financial holds while blocking selected and unresolved failures', () => {
  const profile = withBootstrap();
  const subject = artifact(profile);
  const selected = event({ id: 'selected-error', schemaVersion: 'unreviewed' });
  const missingEventId = { ...selected, id: undefined } as unknown as SourceEvent;
  const sourceWide = event({ id: 'source-wide', kind: 'semantic_change',
    rawIdentity: { companyId: profile.scope.companyId } });
  const unrelated = event({ id: 'outside', rawIdentity: { ...selected.rawIdentity, sourceAccountId: 'unrelated' } });
  const ambiguous = event({ id: unrelated.id }, baselineEventsB[0]);
  for (const extra of [[selected], [missingEventId], [sourceWide], [unrelated, ambiguous]]) {
    const inputs = [...baselineEventsA, ...extra];
    const financial = planBatch(subject, profile, inputs, emptyTargetA);
    const result = planBootstrap(subject, profile, inputs, emptyTargetA);
    expect(result.plans).toEqual([]);
    expect(result.holds).toEqual(expect.arrayContaining(financial.holds));
    expect(result.holds.map(hold => hold.code)).toContain('BOOTSTRAP_BASELINE_BLOCKED');
    if (extra[0] !== sourceWide) expect(financial.plans).toHaveLength(1);
  }
});

test('retains a uniquely resolved unrelated routing hold without adding its financial records', () => {
  const profile = withBootstrap();
  const subject = artifact(profile);
  const unrelated = event({ id: 'outside', rawIdentity: { ...baselineEventsA[0].rawIdentity, sourceAccountId: 'unrelated' },
    payload: { ...baselineEventsA[0].payload, account: 'unrelated' } });
  const baseline = planBootstrap(subject, profile, baselineEventsA, emptyTargetA);
  const result = planBootstrap(subject, profile, [...baselineEventsA, unrelated], emptyTargetA);
  expect(result.plans).toHaveLength(1);
  expect(result.plans).toEqual(baseline.plans);
  expect(result.holds).toMatchObject([{ code: 'UNKNOWN_ACCOUNT', eventIds: ['outside'] }]);
});
