import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { ActivationOutcomeView, ReviewDetailsView, ReviewPackageView } from '../../../apps/web/src/features/connections/ReviewPage.js';
import { ValidatorIdSchema } from '../../contracts/src/connector.js';
import { ReviewDetailsV1Schema, type ReviewDetailsV1 } from '../../contracts/src/review-details.js';
import { ReviewPackageSchema, type ReviewPackage } from '../../contracts/src/review.js';
import { clearCsrfToken, LocalApiError, setCsrfToken } from '../src/http.js';
import { activateReview, activationRequestFor, prepareReview, readReview, readReviewDetails } from '../src/review.js';

afterEach(() => {
  clearCsrfToken();
  vi.unstubAllGlobals();
});

const hash = (char: string) => char.repeat(64);
const scope = { companyId: 'company-a', sellerEntityId: 'seller-a', accountId: 'account-a' };
function reviewPackage(overrides: Partial<ReviewPackage> = {}): ReviewPackage {
  return ReviewPackageSchema.parse({
    id: 'package-a', revision: 1, hash: hash('1'), scope, artifactHash: hash('2'), profileHash: hash('3'),
    manifestHash: hash('4'), verificationReportId: 'report-a', previewPlanHash: hash('5'),
    expectedTargetVersion: 0, diagnostics: [], ready: true, ...overrides,
  });
}
const receipt = {
  id: 'receipt-a', scope, activationId: 'activation-a', epoch: 1, artifactHash: hash('2'), planHash: hash('5'),
  eventIds: ['event-a'], targetRecordIds: ['record-a'], beforeBalanceCents: 0, afterBalanceCents: 80000,
  status: 'applied', committedAt: '2026-11-09T00:00:00.000Z',
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('approval sends exactly the displayed hashes and key with the CSRF token, and no other account fields', async () => {
  setCsrfToken('csrf-token');
  const fetchMock = vi.fn().mockResolvedValue(respond({ receipt, replayed: true }));
  vi.stubGlobal('fetch', fetchMock);
  const request = activationRequestFor(reviewPackage(), 'key-a');
  const outcome = await activateReview('account-a', request);
  expect(outcome).toMatchObject({ state: 'applied', replayed: true });
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe('/api/review/account-a/activate');
  expect(new Headers(init.headers).get('X-EAPR-CSRF')).toBe('csrf-token');
  expect(JSON.parse(init.body)).toEqual({
    reviewPackageId: 'package-a', expectedPackageHash: hash('1'), expectedArtifactHash: hash('2'),
    expectedProfileHash: hash('3'), expectedTargetVersion: 0, idempotencyKey: 'key-a',
  });
});

test('a 202 pending response is not a receipt and must match the approval it answers', async () => {
  setCsrfToken('csrf-token');
  const request = activationRequestFor(reviewPackage(), 'key-a');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respond(
    { state: 'pending', reviewPackageId: 'package-a', idempotencyKey: 'key-a' }, 202,
  )).mockResolvedValueOnce(respond({ state: 'pending', reviewPackageId: 'package-a', idempotencyKey: 'other' }, 202)));
  expect(await activateReview('account-a', request)).toEqual({
    state: 'pending', reviewPackageId: 'package-a', idempotencyKey: 'key-a',
  });
  await expect(activateReview('account-a', request)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
});

test('rejects a receipt or package for a different account and surfaces stale conflicts without retrying', async () => {
  setCsrfToken('csrf-token');
  const other = { ...scope, accountId: 'account-b' };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(respond({ receipt: { ...receipt, scope: other }, replayed: false }))
    .mockResolvedValueOnce(respond(reviewPackage({ scope: other })))
    .mockResolvedValueOnce(respond({ code: 'REVIEW_STALE', message: 'stale', correlationId: 'c', diagnostics: [] }, 409));
  vi.stubGlobal('fetch', fetchMock);
  const request = activationRequestFor(reviewPackage(), 'key-a');
  await expect(activateReview('account-a', request)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  await expect(readReview('account-a')).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  await expect(activateReview('account-a', request)).rejects.toBeInstanceOf(LocalApiError);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('prepare posts an empty body and invalid account IDs never reach the network', async () => {
  setCsrfToken('csrf-token');
  const fetchMock = vi.fn().mockResolvedValue(respond(reviewPackage()));
  vi.stubGlobal('fetch', fetchMock);
  await prepareReview('account-a');
  expect(fetchMock.mock.calls[0]![0]).toBe('/api/review/account-a/prepare');
  expect(fetchMock.mock.calls[0]![1].body).toBe('{}');
  await expect(readReview('../x')).rejects.toMatchObject({ code: 'REVIEW_REQUEST_INVALID' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('package view shows exact hashes, blockers and withholds ready wording; receipts distinguish pending', () => {
  const blocked = renderToStaticMarkup(createElement(ReviewPackageView, { reviewPackage: reviewPackage({
    ready: false, diagnostics: [{ code: 'UNSUPPORTED_TERM', severity: 'blocker', message: 'Unsupported term',
      sourceIds: [], fieldPaths: [] }],
  }) }));
  expect(blocked).toContain('Not ready for approval');
  expect(blocked).toContain('UNSUPPORTED_TERM');
  expect(blocked).toContain(hash('2'));
  const pending = renderToStaticMarkup(createElement(ActivationOutcomeView, {
    outcome: { state: 'pending', reviewPackageId: 'package-a', idempotencyKey: 'key-a' } }));
  expect(pending).toContain('not connected');
  expect(pending).not.toContain('Worker receipt');
  const applied = renderToStaticMarkup(createElement(ActivationOutcomeView, {
    outcome: { state: 'applied', receipt: receipt as never, replayed: true } }));
  expect(applied).toContain('replayed');
  expect(applied).toContain('$800.00');
});

function details(): ReviewDetailsV1 {
  const asOf = '2026-10-01T00:00:00.000Z';
  return ReviewDetailsV1Schema.parse({
    schemaVersion: '1', sourceRef: 'source', parentWrites: 0, reviewPackage: reviewPackage(),
    capture: { manifestId: 'manifest', manifestHash: hash('4'), snapshotId: 'snapshot:manifest', snapshotHash: hash('6') },
    artifact: { id: 'artifact', hash: hash('2'), specHash: hash('7'), compilerVersion: '1', runtimeVersion: '1', targetSchemaVersion: '1' },
    profile: { id: 'profile', version: 1, hash: hash('3'), sourceRef: 'source', scope, parentCustomerId: 'buyer',
      sourceAccountIds: ['source-account'], approvedLookups: [], contractTerms: [], semanticVersion: '1',
      bootstrap: { customer: { id: 'buyer', displayName: 'Buyer', evidenceRefs: ['cite'] }, billingConfigurationIds: [] } },
    baseline: { scope, version: 0, asOf, snapshotHash: hash('6'), balanceCents: 1250, legacyReferences: [],
      records: { scope, version: 0, asOf, customers: [], accounts: [], billingConfigurations: [], invoices: [],
        payments: [], credits: [], allocations: [], reversals: [] } },
    proposedImport: { hash: hash('5'), scope, artifactHash: hash('2'), profileHash: hash('3'), expectedTargetVersion: 0,
      eventIds: [], operations: [], expectedBalanceCents: 80000, asOf, lineage: [] },
    futureScope: { allowedKinds: ['invoice', 'payment'], limits: { maxTransactionCents: 5000000, maxRecordsPerCycle: 1000 },
      validators: [...ValidatorIdSchema.options].sort(), runtimeModelCalls: 'forbidden', safetyRulesVersion: 'frozen-v1',
      safetyRules: ['identity-bound-scope', 'source-contract-bound', 'reviewed-semantic-version',
        'explicit-supported-finance', 'target-version-bound', 'bounded-cycle'] },
    evidence: { snapshotId: 'snapshot:manifest', referencedEvidenceIds: ['cite'] },
  });
}

test('decision details show owed amount after import, bounded future authority and evidence before approval', () => {
  const html = renderToStaticMarkup(createElement(ReviewDetailsView, { details: details() }));
  expect(html).toContain('Balance owed after proposed import');
  expect(html).toContain('$800.00');
  expect(html).toContain('$12.50');
  expect(html).toContain('$50,000.00');
  expect(html).toContain('invoice, payment');
  expect(html).toContain('forbidden');
  expect(html).toContain('cite');
});

test('details must match the exact package and account requested', async () => {
  const body = details();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(body)));
  expect(await readReviewDetails('account-a', reviewPackage())).toEqual(body);
  expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/review/account-a/packages/' + hash('1') + '/details');
  await expect(readReviewDetails('account-a', reviewPackage({ hash: hash('9') }))).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
});
