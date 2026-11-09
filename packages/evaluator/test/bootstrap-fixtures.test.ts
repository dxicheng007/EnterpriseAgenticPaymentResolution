import { expect, test } from 'vitest';
import { hashCanonical } from '@eapr/contracts';
import { decodeBootstrapExpectation } from '../src/bootstrap-fixtures.js';

test('descriptor decoding rejects a rebuilt digest over noncanonical subject order', () => {
  const pin = { fixtureSetId: 'demo', fixtureSetVersion: '2', bundleHash: '0'.repeat(64) };
  const subject = {
    profileHash: 'a'.repeat(64), profileId: 'profile', scope: { companyId: 'company', sellerEntityId: 'seller', accountId: 'account' },
    identityFactId: 'fact', customerId: 'buyer', customerEvidenceRefs: ['ev'],
    terms: [{ factId: 'term-fact', termId: 'term', configurationId: 'config', evidenceRefs: ['ev'] }],
  };
  const input = {
    schemaVersion: '1', fixtureSetId: 'demo', fixtureSetVersion: '1', purpose: 'construction', evidencePin: pin,
    manifestHash: '1'.repeat(64), snapshotHash: '2'.repeat(64), recipeVersion: 'demo-bootstrap-1',
    subjects: [subject, { ...subject, profileHash: 'b'.repeat(64) }],
  };
  const encode = (value: typeof input) => JSON.stringify({ ...value, hash: hashCanonical(value) });
  expect(decodeBootstrapExpectation(encode(input))).toMatchObject(input);
  expect(() => decodeBootstrapExpectation(encode({ ...input, subjects: [...input.subjects].reverse() }))).toThrow();
});
