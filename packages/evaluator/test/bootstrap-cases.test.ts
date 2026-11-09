import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { bootstrapRequiredCases, hashArtifact, hashEvent, hashProfile, type ContractTerm } from '@eapr/contracts';
import { baselineA, baselineEventsA, baselineManifestA, emptyTargetA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { buildBootstrapCases } from '../src/bootstrap-cases.js';
import { buildBootstrapReference, type BootstrapReferenceInput } from '../src/bootstrap-reference.js';

type Context = BootstrapReferenceInput;
const { sourceRef, parentCustomerId: buyerId, sourceAccountIds: [sourceAccountId] } = profileA;
const scope = { ...profileA.scope, accountId: [profileA.scope.companyId, profileA.scope.sellerEntityId, sourceAccountId].join('.') };
const { sellerEntityId } = scope;

function publicVector(twoTerms = false) {
  const customer = { id: buyerId, displayName: 'Shared Buyer', evidenceRefs: ['ev-a-identity'] };
  const initial: ContractTerm = {
    ...profileA.contractTerms[0]!, evidenceRefs: ['ev-a-contract'],
    validToExclusive: twoTerms ? '2026-09-01' : null,
  };
  const terminal: ContractTerm = { ...initial, id: 'term-a-2', validFrom: '2026-09-01', validToExclusive: null };
  const contractTerms = twoTerms ? [initial, terminal] : [initial];
  const billingConfigurationIds = twoTerms
    ? [{ termId: initial.id, id: 'config-z' }, { termId: terminal.id, id: 'config-a' }]
    : [{ termId: initial.id, id: 'config-a-1' }];
  const preimage = {
    ...profileA, scope, contractTerms, bootstrap: { customer, billingConfigurationIds },
    approvedLookups: profileA.approvedLookups.map(table => ({
      ...table, entries: table.entries.map(entry => ({ ...entry, target: scope.accountId })),
    })),
  };
  const profile = { ...preimage, hash: hashProfile(preimage) };
  const result = compile(validSpecA, [profile]);
  if (!result.ok) throw new Error('Public fixture compile failed');
  const { value: artifact } = result;
  const manifest = baselineManifestA;
  const identity = { id: 'identity-a', buyerId, legalName: 'Shared Buyer', sourceAccountId, sellerEntityId, support: [] };
  const other = { ...identity, id: 'identity-other', sourceAccountId: 'cust-a-other' };
  const contracts = contractTerms.map(({ id, evidenceRefs: _refs, ...term }) => ({
    ...term, id: 'fact-' + id, sourceAccountId, sellerEntityId,
    support: term.validToExclusive === null ? [] : [{
      field: 'validToExclusive' as const, fileId: 'amendment-a', expectedLiteral: '2026-09-01',
    }],
  }));
  const resolvedSupport: Context['evidence']['resolvedSupport'] = [
    { factId: identity.id, field: 'legalName', fileId: 'agreement-a', expectedLiteral: 'Shared Buyer', evidenceId: 'ev-a-identity' },
    ...contracts.flatMap(fact => [{
      factId: fact.id, field: 'currency' as const, fileId: 'agreement-a', expectedLiteral: 'USD', evidenceId: 'ev-a-contract',
    }, {
      factId: fact.id, field: 'currency' as const, fileId: 'agreement-a', expectedLiteral: 'USD', evidenceId: 'ev-a-currency',
    }, ...fact.support.map(support => ({ ...support, factId: fact.id, evidenceId: 'ev-a-contract' }))]),
  ];
  const foreign = {
    ...baselineEventsA[0]!, id: 'foreign-delivery', recordId: 'foreign-record', sequence: 99,
    rawIdentity: { ...baselineEventsA[0]!.rawIdentity, sourceAccountId: other.sourceAccountId },
    payload: { ...baselineEventsA[0]!.payload, id: 'foreign-record', account: other.sourceAccountId },
  };
  const events = [...baselineEventsA, { ...foreign, contentHash: hashEvent(foreign) }];
  const descriptor = {
    manifestHash: manifest.hash, subjects: [{
      profileHash: profile.hash, profileId: profile.id, scope, identityFactId: identity.id,
      customerId: buyerId, customerEvidenceRefs: customer.evidenceRefs,
      terms: billingConfigurationIds.map(item => ({
        factId: 'fact-' + item.termId, termId: item.termId, configurationId: item.id, evidenceRefs: ['ev-a-contract'],
      })),
    }],
  };
  // This public vector exercises pure oracle/case derivation after capture validation.
  const context: Context = {
    descriptor, artifact, profiles: [profile], manifest, events,
    evidence: {
      producer: { identities: [identity, other], contracts },
      demoBindings: [{
        identityFactId: identity.id, policy: 'generated-demo-buyer-account-v1', parentCustomerId: buyerId, accountId: scope.accountId,
      }],
      resolvedSupport,
    },
    truth: {
      schemaVersion: 1, fixtureSetId: 'public-bootstrap-vector', fixtureSetVersion: '1', purpose: 'construction',
      generator: { seed: 'public', buildHash: '0'.repeat(64) }, hash: '0'.repeat(64),
      manifestId: manifest.id, manifestHash: manifest.hash, inputEvents: [], evidence: [],
      sourceRef, companyId: scope.companyId, sellerEntityId, asOf: emptyTargetA.asOf,
      accounts: [{
        sourceAccountId, balanceAnchorCents: 80_000,
        records: [...baselineA.invoices, ...baselineA.payments, ...baselineA.credits, ...baselineA.allocations]
          .map(({ id: _id, scope: _scope, identity, ...record }) => ({ ...record, recordId: identity.recordId })),
      }],
    },
  };
  return { context, profile, target: { ...emptyTargetA, scope } };
}

test('builds the exact public case matrix with independent reuse, replay and blocker probes', () => {
  const { context, profile, target } = publicVector();
  const cases = buildBootstrapCases(context, profile.hash, target);
  expect(cases?.map(item => item.id)).toEqual(bootstrapRequiredCases);
  const [baseline, reuse, customerConflict, accountConflict, configurationConflict, empty, replay, selected, sourceWide, unrelated] = cases!;
  expect(baseline!.expectedPlan?.expectedBalanceCents).toBe(80_000);
  expect(baseline!.expectedPlan?.operations).toHaveLength(8);
  expect(reuse!.expectedPlan).toEqual(baseline!.expectedPlan);
  expect(reuse!.target.customers).toEqual([{ id: 'buyer-shared-1', displayName: 'Shared Buyer', evidenceRefs: ['ev-a-identity'] }]);
  expect([customerConflict, accountConflict, configurationConflict].map(item => item!.expectedHolds.at(-1)?.code))
    .toEqual(Array(3).fill('BOOTSTRAP_METADATA_CONFLICT'));
  expect(empty!.events).toEqual([]);
  expect(replay!.target.allocations).toHaveLength(2);
  expect(selected!.events.at(-1)?.semanticVersion).not.toBe(profile.semanticVersion);
  expect(sourceWide!.events.at(-1)?.rawIdentity.sourceAccountId).toBeUndefined();
  expect(unrelated!.events.at(-1)?.rawIdentity.sourceAccountId).toBe('cust-a-other');
  expect(unrelated!.expectedPlan).toEqual(baseline!.expectedPlan);
  expect(buildBootstrapCases(context, '0'.repeat(64), target)).toBeUndefined();
  expect(buildBootstrapCases({ ...context, events: baselineEventsA }, profile.hash, target)).toBeUndefined();
});

test('orders billing configurations by configuration ID while preserving term ID and terminal provenance', () => {
  const { context, profile, target } = publicVector(true);
  const reference = buildBootstrapReference(context, profile.hash, target);
  expect(reference?.withMetadata.billingConfigurations.map(({ id, contractTerm }) =>
    [id, contractTerm.id, contractTerm.validToExclusive])).toEqual([
    ['config-a', 'term-a-2', null], ['config-z', 'term-a-1', '2026-09-01'],
  ]);
  expect(reference?.termProvenance).toEqual([
    { termId: 'term-a-1', validToExclusive: 'observed-amendment' },
    { termId: 'term-a-2', validToExclusive: 'derived-terminal' },
  ]);
});

test('does not derive expectations for a self-consistent unsupported mapping', () => {
  const { context, profile, target } = publicVector();
  const normalizedPlan = {
    ...context.artifact.normalizedPlan,
    mappings: context.artifact.normalizedPlan.mappings.map(mapping => mapping.kind === 'invoice'
      ? { ...mapping, fields: { ...mapping.fields, amountCents: { op: 'constant' as const, value: 123, evidenceRef: 'ev-a-contract' } } }
      : mapping),
  };
  const changed = { ...context.artifact, normalizedPlan };
  expect(buildBootstrapReference({ ...context, artifact: { ...changed, hash: hashArtifact(changed) } }, profile.hash, target))
    .toBeUndefined();
});
