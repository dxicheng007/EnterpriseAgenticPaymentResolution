import { expect, test } from 'vitest';
import { compile } from '../../compiler/src/compile.js';
import * as contracts from '../src/index.js';
import {
  baselineA, baselineManifestA, profileA, validSpecA,
} from '../../../tests/fixtures/index.js';

const bootstrap = {
  customer: { id: 'buyer-shared-1', displayName: 'Shared Buyer', evidenceRefs: ['ev-a-identity'] },
  billingConfigurationIds: [{ termId: 'term-a-1', id: 'config-a-1' }],
};

test('bootstrap pins the exact profile customer and one distinct configuration per term', () => {
  const schema = contracts.CustomerProfileSchema;
  expect(schema.parse(profileA)).toEqual(profileA);
  expect(schema.safeParse({ ...profileA, bootstrap }).success).toBe(true);
  expect(contracts.ProfileBootstrapSchema.parse(bootstrap)).toEqual(bootstrap);
  const exactName = { ...bootstrap, customer: { ...bootstrap.customer, displayName: ' Shared Buyer ' } };
  expect(schema.parse({ ...profileA, bootstrap: exactName }).bootstrap).toEqual(exactName);
  const [binding] = bootstrap.billingConfigurationIds;
  const twoTerms = { ...profileA, contractTerms: [...profileA.contractTerms, { ...profileA.contractTerms[0], id: 'term-a-2' }] };
  expect(schema.safeParse({
    ...twoTerms, bootstrap: { ...bootstrap, billingConfigurationIds: [binding, { termId: 'term-a-2', id: binding.id }] },
  }).success).toBe(false);
  for (const invalid of [
    { ...bootstrap, customer: { ...bootstrap.customer, id: 'different-customer' } },
    { ...bootstrap, billingConfigurationIds: [] },
    { ...bootstrap, billingConfigurationIds: [{ ...binding, termId: 'unexpected-term' }] },
    { ...bootstrap, billingConfigurationIds: [binding, { termId: 'unexpected-term', id: 'other-config' }] },
    { ...bootstrap, billingConfigurationIds: [binding, { ...binding, id: 'other-config' }] },
    { ...bootstrap, customer: { ...bootstrap.customer, displayName: '' } },
    { ...bootstrap, customer: { ...bootstrap.customer, evidenceRefs: [] } },
    { ...bootstrap, customer: { ...bootstrap.customer, evidenceRefs: ['ev-a-identity', 'ev-a-identity'] } },
    { ...bootstrap, customer: { ...bootstrap.customer, scope: profileA.scope } },
    { ...bootstrap, customer: JSON.parse('{"id":"buyer-shared-1","displayName":"Shared Buyer","evidenceRefs":["ev-a-identity"],"__proto__":null}') },
    { ...bootstrap, billingConfigurationIds: [{ ...binding, scope: profileA.scope }] },
  ]) {
    expect(schema.safeParse({ ...profileA, bootstrap: invalid }).success, JSON.stringify(invalid)).toBe(false);
  }
});

test('activation validates shape while manifest and artifact equality remain external', () => {
  expect(contracts.CustomerActivationSchema).toBeDefined();
  const compiled = compile(validSpecA, [profileA]);
  if (!compiled.ok) throw new Error('Expected a development artifact');
  const artifact = compiled.value;
  const baselineCursors = baselineManifestA.streams.map(({ streamId, resumeAfter }) => ({ streamId, resumeAfter }))
    .sort((a, b) => a.streamId < b.streamId ? -1 : 1);
  const activation = {
    id: 'activation-a', scope: profileA.scope, artifactHash: artifact.hash, profileHash: profileA.hash,
    manifestHash: baselineManifestA.hash, baselineCursors, allowedKinds: artifact.normalizedPlan.allowedKinds,
    limits: artifact.normalizedPlan.limits, reviewerId: 'development-reviewer', epoch: 1,
    status: 'active', approvedAt: '2026-10-02T00:00:00.000Z',
  };
  const schema = contracts.CustomerActivationSchema;
  const parsed = schema.parse(activation);
  expect(parsed.baselineCursors).toEqual([
    { streamId: 'a-finance', resumeAfter: '5' }, { streamId: 'a-semantics', resumeAfter: '0' },
  ]);
  expect(parsed.allowedKinds).toEqual(artifact.normalizedPlan.allowedKinds);
  expect(parsed.limits).toEqual({ maxTransactionCents: 5000000, maxRecordsPerCycle: 1000 });
  const unbound = schema.parse({ ...activation, baselineCursors: [baselineCursors[0]], allowedKinds: ['invoice'] });
  expect(unbound.baselineCursors).not.toEqual(parsed.baselineCursors);
  expect(unbound.allowedKinds).not.toEqual(artifact.normalizedPlan.allowedKinds);
  expect(schema.safeParse({ ...activation, baselineCursors: [], allowedKinds: [] }).success).toBe(true);
  for (const invalid of [
    { baselineCursors: [baselineCursors[0], baselineCursors[0]] },
    ...['01', '-1', '9007199254740992', 0].map(resumeAfter => ({ baselineCursors: [{ streamId: 'a-finance', resumeAfter }] })),
    { baselineCursors: [{ ...baselineCursors[0], extra: true }] },
    { epoch: 0 }, { epoch: Number.MAX_SAFE_INTEGER + 1 }, { status: 'pending' },
    { allowedKinds: ['invoice', 'invoice'] }, { allowedKinds: ['semantic_change'] },
    { limits: { ...activation.limits, maxTransactionCents: 4999999 } },
    { limits: { ...activation.limits, maxRecordsPerCycle: 1001 } },
    { sourceRef: 'legacy-a' },
  ]) {
    expect(schema.safeParse({ ...activation, ...invalid }).success, JSON.stringify(invalid)).toBe(false);
  }
});

const records = baselineA;
const legacyReferences = [...records.invoices, ...records.payments, ...records.credits, ...records.allocations]
  .map(({ id, identity, sourceRecordVersion, sourceEventId }) => ({ targetRecordId: id, identity, sourceRecordVersion, sourceEventId }))
  .sort((a, b) => a.targetRecordId < b.targetRecordId ? -1 : 1);
const view = {
  scope: records.scope, version: records.version, asOf: '2026-10-03T00:00:00.000Z',
  snapshotHash: contracts.hashTargetSnapshot(records), balanceCents: 80000, records, legacyReferences,
};

test('parent view keeps recorded snapshot facts independent of evaluation time', () => {
  expect(contracts.ParentViewSchema).toBeDefined();
  const schema = contracts.ParentViewSchema;
  expect(view.asOf).not.toBe(records.asOf);
  expect(schema.parse(view)).toEqual(view);
  const earlier = schema.parse({ ...view, asOf: '2026-08-01T00:00:00.000Z', balanceCents: 0 });
  expect(earlier.records).toEqual(records);
  expect(earlier.snapshotHash).toBe(view.snapshotHash);
  expect(view.snapshotHash).toBe(contracts.hashCanonical({ scope: records.scope, records }));
  for (const key of ['companyId', 'sellerEntityId', 'accountId'] as const) {
    expect(schema.safeParse({ ...view, scope: { ...view.scope, [key]: 'different' } }).success).toBe(false);
  }
  expect(schema.safeParse({ ...view, version: 0 }).success).toBe(false);
  expect(schema.safeParse({ ...view, extra: 0 }).success).toBe(false);
});

test('legacy references match financial IDs, full identities, source versions and events bijectively', () => {
  expect(contracts.LegacyReferenceSchema.parse(legacyReferences[0])).toEqual(legacyReferences[0]);
  const schema = contracts.ParentViewSchema;
  const [first, ...rest] = legacyReferences;
  expect(schema.safeParse({
    ...view, records: { ...records, payments: [{ ...records.payments[0], id: records.invoices[0].id }] },
  }).success).toBe(false);
  for (const invalid of [
    rest, [...legacyReferences, first], [...legacyReferences, { ...first, targetRecordId: 'unexpected' }],
    [{ ...first, targetRecordId: 'unexpected' }, ...rest],
    ...Object.keys(first.identity).map(key => [{ ...first, identity: {
      ...first.identity, [key]: key === 'kind' ? (first.identity.kind === 'credit' ? 'payment' : 'credit') : 'unexpected',
    } }, ...rest]),
    [{ ...first, sourceRecordVersion: first.sourceRecordVersion + 1 }, ...rest],
    [{ ...first, sourceEventId: 'other-event' }, ...rest],
    [{ ...first, scope: view.scope }, ...rest],
  ]) {
    expect(schema.safeParse({ ...view, legacyReferences: invalid }).success).toBe(false);
  }
});

test('strict parent wires retain their existing field constraints', () => {
  const [customer] = records.customers;
  expect(contracts.ParentCustomerSchema.parse({ ...customer, displayName: '', evidenceRefs: [] }))
    .toEqual({ id: customer.id, displayName: '', evidenceRefs: [] });
  expect(contracts.ParentCustomerSchema.safeParse({ ...customer, scope: view.scope }).success).toBe(false);
  expect(contracts.ParentAccountSchema.safeParse({ ...records.accounts[0], displayName: 'Extra' }).success).toBe(false);
  expect(contracts.BillingConfigurationSchema.safeParse({ ...records.billingConfigurations[0], termId: 'term-a-1' }).success).toBe(false);
});

test('parent read query admits independent selectors without defaults', () => {
  expect(contracts.ParentReadQuerySchema).toBeDefined();
  const schema = contracts.ParentReadQuerySchema;
  const asOf = records.asOf;
  const snapshotHash = view.snapshotHash;
  for (const query of [{}, { asOf }, { snapshotHash }, { asOf, snapshotHash }]) {
    expect(schema.parse(query)).toEqual(query);
  }
  for (const query of [{ timestamp: asOf }, { asOf: '2026-02-30T00:00:00Z' }, { asOf: 0 }, { snapshotHash: 'invalid' }]) {
    expect(schema.safeParse(query).success).toBe(false);
  }
});
