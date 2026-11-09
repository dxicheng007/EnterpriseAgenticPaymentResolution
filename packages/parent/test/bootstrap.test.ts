import { expect, test } from 'vitest';
import { type MutationOperation } from '@eapr/contracts';
import { BootstrapProjectionError, projectBootstrapTarget } from '@eapr/parent/bootstrap';
import { baselineA, emptyTargetA, emptyTargetB, profileA } from '../../../tests/fixtures/index.js';

const customer = { displayName: ' Shared Buyer ', evidenceRefs: ['ev-a', 'ev-b'], id: profileA.parentCustomerId };
const account = {
  id: profileA.scope.accountId, scope: profileA.scope, parentCustomerId: profileA.parentCustomerId,
  sourceRef: profileA.sourceRef, sourceAccountIds: profileA.sourceAccountIds,
};
const config = { id: 'config-a', scope: profileA.scope, contractTerm: profileA.contractTerms[0] };
const ensures: MutationOperation[] = [
  { op: 'ensure_customer', record: customer },
  { op: 'ensure_account', record: account },
  { op: 'ensure_billing_configuration', record: config },
];

test('projects all record arrays without changing the target version, asOf or inputs', () => {
  const target = structuredClone(emptyTargetA);
  const before = structuredClone(target);
  const result = projectBootstrapTarget(target, [
    ...ensures,
    { op: 'insert_invoice', record: baselineA.invoices[0] },
    { op: 'insert_payment', record: baselineA.payments[0] },
    { op: 'insert_credit', record: baselineA.credits[0] },
    ...baselineA.allocations.map(record => ({ op: 'add_allocation', record }) as const),
  ]);
  expect(result).toEqual({
    ...baselineA, version: emptyTargetA.version, asOf: emptyTargetA.asOf,
    customers: [customer], accounts: [account], billingConfigurations: [config],
  });
  expect(target).toEqual(before);
  for (const key of Object.keys(target) as (keyof typeof target)[]) {
    if (Array.isArray(target[key])) expect(result[key]).not.toBe(target[key]);
  }
});

test('reuses canonical equality without re-encoding the stored record', () => {
  const target = { ...emptyTargetA, customers: [customer], accounts: [account], billingConfigurations: [config] };
  const result = projectBootstrapTarget(target, [
    { op: 'ensure_customer', record: { id: customer.id, displayName: customer.displayName, evidenceRefs: customer.evidenceRefs } },
    ...ensures.slice(1),
  ]);
  expect(result).toEqual(target);
  expect(result.customers).not.toBe(target.customers);
  expect(JSON.stringify(result.customers[0])).toBe(JSON.stringify(target.customers[0]));
});

test('treats different record bytes as conflicts even when only array order differs', () => {
  const target = { ...emptyTargetA, customers: [customer], accounts: [account], billingConfigurations: [config] };
  for (const operation of [
    { op: 'ensure_customer', record: { ...customer, evidenceRefs: ['ev-b', 'ev-a'] } },
    { op: 'ensure_account', record: { ...account, sourceRef: 'other-source' } },
    { op: 'ensure_billing_configuration', record: { ...config, contractTerm: { ...config.contractTerm, anchorDay: 2 } } },
  ] satisfies MutationOperation[]) {
    expect(() => projectBootstrapTarget(target, [operation])).toThrow(BootstrapProjectionError);
  }
});

test('rejects invalid state, duplicate metadata IDs and cross-scope operations', () => {
  const foreign = emptyTargetB.scope;
  for (const target of [
    { ...emptyTargetA, version: -1 },
    { ...emptyTargetA, customers: [customer, customer] },
    { ...emptyTargetA, accounts: [account, account] },
    { ...emptyTargetA, billingConfigurations: [config, config] },
    { ...emptyTargetA, accounts: [{ ...account, scope: foreign }] },
  ]) {
    expect(() => projectBootstrapTarget(target, [])).toThrow(BootstrapProjectionError);
  }
  for (const operation of [
    { op: 'ensure_account', record: { ...account, scope: foreign } },
    { op: 'ensure_billing_configuration', record: { ...config, scope: foreign } },
    { op: 'insert_invoice', record: { ...baselineA.invoices[0], scope: foreign } },
  ] satisfies MutationOperation[]) {
    expect(() => projectBootstrapTarget(emptyTargetA, [operation])).toThrow(BootstrapProjectionError);
  }
});
