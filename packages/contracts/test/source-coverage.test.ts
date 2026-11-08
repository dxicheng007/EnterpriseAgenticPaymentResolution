import { expect, test } from 'vitest';
import { SourceCoverageResponseSchema } from '../src/source-coverage.js';

const hash = 'a'.repeat(64);
const snapshot = {
  id: 'snapshot:manifest-a', manifestId: 'manifest-a', sourceRef: 'source-a',
  capturedAt: '2026-11-08T00:00:00.000Z', contentHash: hash,
  evidenceIds: ['related-z', 'identity-a', 'related-a', 'identity-Z'],
  eventIds: ['payment-a', 'semantic-a', 'invoice-a'],
};

const account = {
  sellerEntityId: 'seller', sourceAccountId: 'account-a', sourceBuyerId: 'buyer-a',
  displayName: 'Northstar', identityEvidenceRefs: ['identity-a', 'identity-Z'],
  relatedEvidenceRefs: ['related-z', 'related-a'],
};
const sameNameAccount = { ...account, sourceAccountId: 'account-b', sourceBuyerId: 'buyer-b' };
const otherSellerAccount = { ...account, sellerEntityId: 'seller-a', sourceBuyerId: 'buyer-c' };

const invoice = {
  id: 'invoice-a', kind: 'invoice',
  rawIdentity: { companyId: 'company-a', sellerEntityId: 'seller', sourceAccountId: 'account-a' },
};
const payment = {
  id: 'payment-a', kind: 'payment',
  rawIdentity: { companyId: 'company-a', sellerEntityId: 'seller', sourceAccountId: 'unresolved' },
};
const semanticChange = { id: 'semantic-a', kind: 'semantic_change', rawIdentity: { companyId: 'company-a' } };

const coverage = {
  companyId: 'company-a', sourceRef: 'source-a', manifestHash: hash, snapshot,
  derivation: 'captured-source-rules-v1',
  accounts: [otherSellerAccount, sameNameAccount, account],
  events: [semanticChange, payment, invoice],
  diagnostics: [
    { code: 'SOURCE_IDENTITY_UNDOCUMENTED', severity: 'warning', message: 'Source identity unresolved',
      sourceIds: ['payment-a'], fieldPaths: [] },
  ],
};

test('normalizes coverage lists while preserving the snapshot and unsupported event identities', () => {
  const normalizedCitations = {
    identityEvidenceRefs: ['identity-Z', 'identity-a'], relatedEvidenceRefs: ['related-a', 'related-z'],
  };
  expect(SourceCoverageResponseSchema.parse(coverage)).toEqual({
    ...coverage,
    accounts: [
      { ...account, ...normalizedCitations },
      { ...sameNameAccount, ...normalizedCitations },
      { ...otherSellerAccount, ...normalizedCitations },
    ],
    events: [invoice, payment, semanticChange],
  });
});

test('accepts empty account coverage with a complete event inventory', () => {
  expect(SourceCoverageResponseSchema.parse({ ...coverage, accounts: [] }).accounts).toEqual([]);
});

test('accepts account observations with no related citations', () => {
  const accounts = [{ ...account, relatedEvidenceRefs: [] }];
  expect(SourceCoverageResponseSchema.parse({ ...coverage, accounts }).accounts[0].relatedEvidenceRefs).toEqual([]);
});

test.each([
  ['duplicate account key', { accounts: [account, { ...account, sourceBuyerId: 'different-buyer' }] }],
  ['blank display name', { accounts: [{ ...account, displayName: '   ' }] }],
  ['missing identity support', { accounts: [{ ...account, identityEvidenceRefs: [] }] }],
  ['duplicate identity citations', { accounts: [{ ...account, identityEvidenceRefs: ['identity-a', 'identity-a'] }] }],
  ['duplicate related citations', { accounts: [{ ...account, relatedEvidenceRefs: ['related-a', 'related-a'] }] }],
  ['foreign identity citation', { accounts: [{ ...account, identityEvidenceRefs: ['foreign-ref'] }] }],
  ['foreign related citation', { accounts: [{ ...account, relatedEvidenceRefs: ['foreign-ref'] }] }],
  ['duplicate snapshot evidence ID', { snapshot: { ...snapshot, evidenceIds: [...snapshot.evidenceIds, 'identity-a'] } }],
  ['duplicate snapshot event ID', { snapshot: { ...snapshot, eventIds: [...snapshot.eventIds, 'invoice-a'] } }],
  ['duplicate event ID', { events: [invoice, payment, payment] }],
  ['missing event', { events: [invoice, payment] }],
  ['additional event', { events: [invoice, payment, semanticChange, { ...payment, id: 'another-event' }] }],
  ['same-size foreign event set', { events: [invoice, payment, { ...semanticChange, id: 'foreign-event' }] }],
  ['event company mismatch', { events: [invoice, payment, { ...semanticChange, rawIdentity: { companyId: 'company-b' } }] }],
  ['snapshot source mismatch', { snapshot: { ...snapshot, sourceRef: 'source-b' } }],
  ['unsupported event kind', { events: [invoice, payment, { ...semanticChange, kind: 'approved' }] }],
  ['unsupported derivation', { derivation: 'agent-construction' }],
  ['invalid manifest hash', { manifestHash: 'bad-hash' }],
  ['invalid buyer ID', { accounts: [{ ...account, sourceBuyerId: 'bad/id' }] }],
  ['parent identity field', { accounts: [{ ...account, parentCustomerId: 'parent-a' }] }],
  ['invented status field', { status: 'eligible' }],
  ['event amount field', { events: [{ ...invoice, amountCents: 500 }, payment, semanticChange] }],
  ['inferred raw identity', { events: [{ ...invoice, rawIdentity: { ...invoice.rawIdentity, sourceBuyerId: 'buyer-a' } }, payment, semanticChange] }],
  ['unknown snapshot field', { snapshot: { ...snapshot, complete: true } }],
  ['invented diagnostic status', { diagnostics: [{ ...coverage.diagnostics[0], status: 'resolved' }] }],
])('rejects %s', (_label, patch) => {
  expect(SourceCoverageResponseSchema.safeParse({ ...coverage, ...patch }).success).toBe(false);
});

test.each(['__proto__', 'constructor', 'prototype'])('rejects the nested prototype key %s', key => {
  const rawIdentity = JSON.parse(`{"companyId":"company-a","${key}":{"untrusted":true}}`);
  const result = SourceCoverageResponseSchema.safeParse({
    ...coverage, events: [invoice, payment, { ...semanticChange, rawIdentity }],
  });
  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(expect.objectContaining({ message: 'Forbidden key' }));
});
