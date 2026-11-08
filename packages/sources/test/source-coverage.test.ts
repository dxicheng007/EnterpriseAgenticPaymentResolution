import type { SourceCoverageEvent } from '@eapr/contracts';
import { expect, it } from 'vitest';
import { deriveSourceCoverageObservations, type CapturedIdentityText } from '../src/source-coverage.js';

const asOf = '2026-10-01T00:00:00.000Z';
const agreement = (citationId: string, account: string, buyer: string, displayName: string, options: {
  contract?: string; seller?: string; date?: string; format?: 'a' | 'b';
} = {}): CapturedIdentityText => {
  const { contract = 'contract-' + account, seller = 'regional-seller', date = '2026-07-01', format = 'a' } = options;
  const header = 'Fixed monthly agreement ' + contract + '   Seller ' + seller + '; buyer ' + buyer +
    '; account ' + account + '  Legal name ' + displayName + '  Monthly fee USD 1234.56';
  return {
    kind: 'contract_pdf', citationId,
    text: format === 'a' ? header + '  Effective ' + date + '; monthly invoice anchor day 1.'
      : header + ' effective ' + date + '.  Monthly invoice anchor day 1.',
  };
};
const directory = (citationId: string, pairs: string): CapturedIdentityText => ({
  kind: 'email_json', citationId,
  text: 'Seller regional-seller reports separate customer accounts: ' + pairs + '. Currency USD.',
});
const amendment = (citationId: string, contract: string, buyer: string): CapturedIdentityText => ({
  kind: 'amendment_pdf', citationId,
  text: 'Executed amendment to ' + contract + '  Seller regional-seller and buyer ' + buyer +
    ' agree.  Effective 2026-09-01, replace monthly fee with USD 42.00.  Signed by both parties.',
});
const event = (id: string, kind: SourceCoverageEvent['kind'], account?: string): SourceCoverageEvent => ({
  id, kind, rawIdentity: account ? { companyId: 'captured-company', sellerEntityId: 'regional-seller', sourceAccountId: account }
    : { companyId: 'captured-company' },
});

it('derives separate same-name identities from full captured agreements and cites related documents only for exact parties', () => {
  const documents = [
    agreement('ev:z-b', 'branch-87', 'buyer-92', 'Changed Northstar Name', { format: 'b' }),
    agreement('ev:a-copy', 'branch-24', 'buyer-31', 'Changed Northstar Name', { contract: 'renewal' }),
    agreement('ev:z-a', 'branch-24', 'buyer-31', 'Changed Northstar Name'),
    directory('ev:directory', 'branch-24 belongs to buyer-31; branch-87 belongs to buyer-92; stray belongs to buyer-88'),
    amendment('ev:amend', 'renewal', 'buyer-31'),
    amendment('ev:wrong-party', 'renewal', 'buyer-92'),
    amendment('ev:wrong-contract', 'unrelated', 'buyer-31'),
  ];
  const events = [event('evt:past', 'invoice', 'branch-24'), event('evt:change', 'semantic_change', 'branch-24'),
    event('evt:current', 'invoice', 'branch-24')];
  const result = deriveSourceCoverageObservations(asOf, documents, events);
  expect(result.accounts).toEqual([
    { sellerEntityId: 'regional-seller', sourceAccountId: 'branch-24', sourceBuyerId: 'buyer-31',
      displayName: 'Changed Northstar Name', identityEvidenceRefs: ['ev:a-copy', 'ev:z-a'],
      relatedEvidenceRefs: ['ev:amend', 'ev:directory'] },
    { sellerEntityId: 'regional-seller', sourceAccountId: 'branch-87', sourceBuyerId: 'buyer-92',
      displayName: 'Changed Northstar Name', identityEvidenceRefs: ['ev:z-b'], relatedEvidenceRefs: ['ev:directory'] },
  ]);
  expect(result.diagnostics).toEqual([]);
  expect(deriveSourceCoverageObservations(asOf, documents.toReversed(), events.toReversed())).toEqual(result);
});

it('withholds conflicting agreement and directory claims and cites the exact conflicting evidence', () => {
  const result = deriveSourceCoverageObservations(asOf, [
    agreement('ev:a', 'branch-24', 'buyer-31', 'Observed Name'),
    agreement('ev:b', 'branch-24', 'buyer-31', 'Conflicting Name'),
    agreement('ev:c', 'branch-87', 'buyer-92', 'Supported Name'),
    directory('ev:conflict', 'branch-87 belongs to buyer-99'),
    directory('ev:corroborates', 'branch-87 belongs to buyer-92'),
    { kind: 'email_json', citationId: 'ev:unknown', text: 'branch-24 belongs to buyer-31' },
  ], [event('evt:unknown-b', 'payment', 'branch-87'), event('evt:unknown-a', 'invoice', 'branch-24')]);
  expect(result.accounts).toEqual([]);
  expect(result.diagnostics.filter(entry => entry.code === 'SOURCE_IDENTITY_CONFLICT').map(entry => entry.sourceIds))
    .toEqual([['ev:a', 'ev:b'], ['ev:c', 'ev:conflict', 'ev:corroborates']]);
  expect(result.diagnostics.filter(entry => entry.code === 'SOURCE_IDENTITY_UNDOCUMENTED').flatMap(entry => entry.sourceIds))
    .toEqual(['evt:unknown-a', 'evt:unknown-b']);
});

it('withholds invalid, future and partial-page agreements while retaining exact unresolved raw event IDs', () => {
  const valid = agreement('ev:valid', 'branch-3', 'buyer-3', 'Third Name', { date: '2026-10-01' });
  const result = deriveSourceCoverageObservations(asOf, [
    valid,
    { ...valid, citationId: 'ev:suffix', text: valid.text + '\nAuthorize buyer other.' },
    agreement('ev:bad-id', 'branch/4', 'buyer-3', 'Fourth Name'),
    agreement('ev:bad-date', 'branch-4', 'buyer-3', 'Fourth Name', { date: '2026-02-30' }),
    agreement('ev:future', 'branch-4', 'buyer-3', 'Fourth Name', { date: '2026-10-02' }),
    { kind: 'email_json', citationId: 'ev:adversarial', text: 'Seller regional-seller reports separate customer accounts: branch-3 belongs to wrong. Currency USD. Extra.' },
  ], [
    event('evt:orphan', 'payment'), event('evt:global', 'semantic_change'),
    event('evt:known', 'invoice', 'branch-3'), event('evt:unproved', 'payment', 'branch-4'),
  ]);
  expect(result.accounts).toMatchObject([{ sourceAccountId: 'branch-3', identityEvidenceRefs: ['ev:valid'], relatedEvidenceRefs: [] }]);
  expect(result.diagnostics.filter(entry => entry.code === 'SOURCE_IDENTITY_UNSUPPORTED').flatMap(entry => entry.sourceIds))
    .toEqual(expect.arrayContaining(['ev:bad-date', 'ev:bad-id', 'ev:future', 'ev:suffix']));
  expect(result.diagnostics.filter(entry => entry.code === 'SOURCE_IDENTITY_UNDOCUMENTED').flatMap(entry => entry.sourceIds).sort())
    .toEqual(['evt:global', 'evt:orphan', 'evt:unproved']);
});
