import { hashCanonical } from '@eapr/contracts';
import { baselineA, baselineEventsA, baselineManifestA, profileA } from '../../../tests/fixtures/index.js';

export function publicTruthFixture() {
  const records = [...baselineA.invoices, ...baselineA.payments, ...baselineA.credits, ...baselineA.allocations]
    .map(({ id: _id, scope: _scope, identity, ...record }) => ({ ...record, recordId: identity.recordId }))
    .sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.recordId < b.recordId ? -1 : 1);
  const manifest = baselineManifestA;
  const inputEvents = baselineEventsA.map(({ id, contentHash }) => ({ id, contentHash })).sort((a, b) => a.id < b.id ? -1 : 1);
  const value = {
    schemaVersion: 1, fixtureSetId: 'test-fixture', fixtureSetVersion: '1', purpose: 'construction',
    generator: { seed: 'test', buildHash: hashCanonical('public test scenario') },
    companyId: manifest.companyId, sourceRef: manifest.sourceRef, sellerEntityId: profileA.scope.sellerEntityId,
    asOf: manifest.asOf, manifestId: manifest.id, manifestHash: manifest.hash, inputEvents,
    accounts: [{ sourceAccountId: profileA.sourceAccountIds[0], records, balanceAnchorCents: 80000 }],
    evidence: [],
  };
  return { ...value, hash: hashCanonical(value) };
}
