import { expect, test } from 'vitest';
import * as fixtureStore from '../src/fixture-store.js';

import { canonicalJson, hashCanonical } from '@eapr/contracts';
import { decodeEvidenceProducer, decodeProtectedEvidenceBundle, type ProducerV1 } from '../src/evidence-fixtures.js';
import { baselineManifestA } from '../../../tests/fixtures/index.js';

test('the private store accepts a separate evidence v2 pin without replacing the v1 API', () => {
  expect(fixtureStore).toHaveProperty('pinProtectedFixture', expect.any(Function));
  expect(fixtureStore).toHaveProperty('pinProtectedEvidenceFixture', expect.any(Function));
});

function producerSample() {
  const source = { companyId: 'company-a', sourceRef: 'legacy-a', sellerEntityId: 'seller-a', sourceAccountId: 'account-a' };
  const support = (fields: ProducerV1['identities'][number]['support'][number]['field'][]) =>
    fields.map(field => ({ field, fileId: 'file-contract', expectedLiteral: 'Independent example line for ' + field }));
  const identity = {
    id: 'identity:' + hashCanonical(source), sourceAccountId: source.sourceAccountId, sellerEntityId: source.sellerEntityId,
    buyerId: 'buyer-a', legalName: 'Example buyer', support: support(['sourceAccountId', 'sellerEntityId', 'buyerId', 'legalName']),
  };
  const term = (validFrom: string, validToExclusive: string | null) => {
    const contractId = 'contract-a';
    const fields: Parameters<typeof support>[0] = [
      'sourceAccountId', 'sellerEntityId', 'contractId', 'validFrom', 'fixedMonthlyFeeCents', 'currency', 'cadence', 'anchorDay',
    ];
    if (validToExclusive !== null) fields.push('validToExclusive');
    return {
      id: 'term:' + hashCanonical({ ...source, contractId, validFrom }), sourceAccountId: source.sourceAccountId,
      sellerEntityId: source.sellerEntityId, contractId, validFrom, validToExclusive, fixedMonthlyFeeCents: 300000,
      currency: 'USD' as const, cadence: 'monthly' as const, anchorDay: 1, support: support(fields),
    };
  };
  return {
    schemaVersion: 1 as const, kind: 'evidence-facts' as const, fixtureSetId: 'truth-test', producerFixtureSetVersion: '1' as const,
    producerTruthHash: hashCanonical('producer-truth'),
    generator: { seed: 'test-seed', buildHash: hashCanonical('producer-build') },
    companyId: source.companyId, sourceRef: source.sourceRef, sellerEntityId: source.sellerEntityId,
    manifestId: 'manifest-a', manifestHash: hashCanonical('manifest'),
    identities: [identity], contracts: [term('2026-01-01', '2026-02-01'), term('2026-02-01', null)],
  };
}

function producerJson(input: ReturnType<typeof producerSample>) {
  const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const sorted = <T extends { id: string; support: ProducerV1['identities'][number]['support'] }>(facts: T[]) =>
    [...facts].sort((a, b) => cmp(a.id, b.id)).map(fact => ({ ...fact, support: [...fact.support].sort((a, b) =>
      cmp(canonicalJson([a.field, a.fileId, a.expectedLiteral]), canonicalJson([b.field, b.fileId, b.expectedLiteral]))) }));
  const canonical = { ...input, identities: sorted(input.identities), contracts: sorted(input.contracts) };
  return canonicalJson({ ...canonical, hash: hashCanonical(canonical) });
}

test('strict producer decoding normalizes order and checks fact IDs and amendment adjacency', () => {
  const sample = producerSample();
  const json = producerJson(sample);
  const permuted = JSON.parse(json);
  permuted.contracts.reverse();
  permuted.identities[0].support.reverse();
  expect(decodeEvidenceProducer(JSON.stringify(permuted))).toEqual(decodeEvidenceProducer(json));
  const invalid = [
    (input: typeof sample) => { input.identities[0].id = 'incorrect-id'; },
    (input: typeof sample) => { input.contracts[0].validToExclusive = '2026-02-02'; },
    (input: typeof sample) => { input.contracts[0].validToExclusive = '2025-12-31'; },
    (input: typeof sample) => { input.contracts[0].anchorDay = 32; },
    (input: typeof sample) => { input.contracts[0].fixedMonthlyFeeCents = Number.MAX_SAFE_INTEGER + 1; },
    (input: typeof sample) => { input.identities[0].support.pop(); },
    (input: typeof sample) => { input.identities[0].support.push(input.identities[0].support[0]); },
    (input: typeof sample) => { input.contracts.push(input.contracts[0]); },
  ];
  for (const mutate of invalid) {
    const changed = structuredClone(sample);
    mutate(changed);
    const text = changed.contracts[0].fixedMonthlyFeeCents > Number.MAX_SAFE_INTEGER ? JSON.stringify(changed) : producerJson(changed);
    expect(() => decodeEvidenceProducer(text)).toThrow('Protected evidence fixture invalid');
  }
});

test('producer and v2 bundle reject oversized, unknown and prototype-bearing input', async () => {
  const json = producerJson(producerSample());
  const producer = JSON.parse(json);
  producer.identities[0].legalName += ' changed';
  expect(() => decodeEvidenceProducer(JSON.stringify(producer))).toThrow('Protected evidence fixture invalid');
  expect(() => decodeEvidenceProducer(json.replace('"generator":{', '"generator":{"__proto__":{},')))
    .toThrow('Protected evidence fixture invalid');
  expect(() => decodeEvidenceProducer(json.replace('"generator":{', '"generator":{"unexpected":1,')))
    .toThrow('Protected evidence fixture invalid');
  const oversized = ' '.repeat(10 * 1024 * 1024) + '{}';
  expect(() => decodeEvidenceProducer(oversized)).toThrow('Protected evidence fixture invalid');
  await expect(decodeProtectedEvidenceBundle(oversized, baselineManifestA)).rejects.toThrow('Protected evidence fixture invalid');
  await expect(decodeProtectedEvidenceBundle('{"schemaVersion":3}', baselineManifestA)).rejects.toThrow('Protected evidence fixture invalid');
});
