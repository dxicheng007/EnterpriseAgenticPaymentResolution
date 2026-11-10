import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { ParentInspection, ParentView as ParentViewPage } from '../../../apps/web/src/features/connections/ParentView.js';
import { ActivationStateV1Schema, type ActivationStateV1 } from '../../contracts/src/activation-authority.js';
import { hashTargetSnapshot } from '../../contracts/src/canonical.js';
import { ParentViewSchema, type ParentView, type TargetState } from '../../contracts/src/runtime.js';
import { baselineA, emptyTargetA, emptyTargetB, scopeA, scopeB } from '../../../tests/fixtures/index.js';
import { clearCsrfToken, onSessionExpiration, setCsrfToken } from '../src/http.js';
import { readAccountActivation, readParentAccount } from '../src/parent.js';
import type { LocalSession } from '../src/session.js';

afterEach(() => {
  clearCsrfToken();
  vi.unstubAllGlobals();
});

const hash = 'ab'.repeat(32);

function parentView(records: TargetState, asOf: string, balanceCents: number): ParentView {
  const legacyReferences = [
    ...records.invoices, ...records.payments, ...records.credits, ...records.allocations, ...records.reversals,
  ].map(record => ({
    targetRecordId: record.id, identity: record.identity,
    sourceRecordVersion: record.sourceRecordVersion, sourceEventId: record.sourceEventId,
  })).sort((left, right) => left.targetRecordId < right.targetRecordId ? -1 :
    left.targetRecordId > right.targetRecordId ? 1 : 0);
  return ParentViewSchema.parse({
    scope: records.scope, version: records.version, asOf, snapshotHash: hashTargetSnapshot(records),
    balanceCents, records, legacyReferences,
  });
}

function inactiveState(scope: TargetState['scope']): ActivationStateV1 {
  return ActivationStateV1Schema.parse({
    schemaVersion: '1', scope, activation: null, initialReceipt: null,
  });
}

function pairedState(scope: TargetState['scope']): ActivationStateV1 {
  return ActivationStateV1Schema.parse({
    schemaVersion: '1', scope,
    activation: {
      id: 'activation-a', scope, artifactHash: hash, profileHash: hash, manifestHash: hash,
      baselineCursors: [], allowedKinds: ['invoice', 'payment', 'credit', 'allocation'],
      limits: { maxTransactionCents: 5000000, maxRecordsPerCycle: 1000 },
      reviewerId: 'demo-reviewer', epoch: 1, status: 'active', approvedAt: '2026-10-01T00:00:00.000Z',
    },
    initialReceipt: {
      id: 'receipt-a', scope, activationId: 'activation-a', epoch: 1, artifactHash: hash, planHash: hash,
      eventIds: [], targetRecordIds: [], beforeBalanceCents: 0, afterBalanceCents: 80000,
      status: 'applied', committedAt: '2026-10-01T00:00:01.000Z',
    },
  });
}

function inspection(view: ParentView, activation: ActivationStateV1, accountId = view.scope.accountId) {
  return renderToStaticMarkup(createElement(ParentInspection, { accountId, view, activation }));
}

test('shows a version-zero balance as registered scope with activation and receipt absent', () => {
  const evaluated = parentView(emptyTargetA, '2026-10-03T00:00:00.000Z', 80000);
  const recorded = parentView(emptyTargetA, '2026-08-01T00:00:00.000Z', 0);
  const html = inspection(evaluated, inactiveState(emptyTargetA.scope));
  const otherTime = inspection(recorded, inactiveState(emptyTargetA.scope));
  expect(html).toContain('Not imported');
  expect(html).toContain('Parent version');
  expect(html).toContain('>0<');
  expect(html).toContain('Balance evaluation time');
  expect(html).toContain('2026-10-03T00:00:00.000Z');
  expect(html).toContain('Recorded snapshot time');
  expect(html).toContain(emptyTargetA.asOf);
  expect(html).toContain(evaluated.snapshotHash);
  expect(html).toContain('$800.00');
  expect(html).toContain('>Absent<');
  expect(html).not.toContain('Activation active');
  expect(otherTime).toContain('2026-08-01T00:00:00.000Z');
  expect(otherTime).toContain('$0.00');
  expect(otherTime).toContain(emptyTargetA.asOf);
  expect(otherTime).toContain(evaluated.snapshotHash);
  expect(otherTime).not.toContain('2026-10-03T00:00:00.000Z');
  expect(otherTime).not.toContain('$800.00');
});

test('renders stored financial records, metadata, legacy references and a paired receipt', () => {
  const view = parentView(baselineA, '2026-10-03T00:00:00.000Z', 80000);
  const html = inspection(view, pairedState(baselineA.scope));
  expect(html).toContain('Activation active');
  expect(html).toContain('activation-a');
  expect(html).toContain('receipt-a');
  expect(html).toContain('demo-reviewer');
  expect(html).toContain(baselineA.invoices[0]!.id);
  expect(html).toContain('Shared Buyer');
  expect(html).toContain(baselineA.invoices[0]!.sourceEventId);
  expect(html).toContain(view.records.asOf);
  expect(html).toContain(view.snapshotHash);
  expect(html).not.toContain('Not imported');
});

test('keeps a mismatched account response out of the inspection', () => {
  const view = parentView(emptyTargetA, emptyTargetA.asOf, 0);
  const html = inspection(view, inactiveState(scopeB), scopeA.accountId);
  expect(html).toContain('The parent response did not match the selected account.');
  expect(html).not.toContain('Not imported');
  expect(html).not.toContain('$0.00');
});

test('encodes the account, normalizes selectors and sends no mutation', async () => {
  const fetch = vi.fn(async () => Response.json({
    code: 'PARENT_READ_NOT_FOUND', message: 'The registered scope or snapshot was not found',
    diagnostics: [], correlationId: 'request-1',
  }, { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  setCsrfToken('token-1');
  const snapshotHash = hash;
  await expect(readParentAccount('acct:1', { asOf: '2026-08-01T00:00:00Z', snapshotHash })).rejects.toMatchObject({
    status: 404, code: 'PARENT_READ_NOT_FOUND',
  });
  await expect(readParentAccount('acct:1', { asOf: '2026-10-03T00:00:00.000Z' })).rejects.toMatchObject({ status: 404 });
  await expect(readParentAccount('acct:1', { snapshotHash })).rejects.toMatchObject({ status: 404 });
  await expect(readAccountActivation('acct:1')).rejects.toMatchObject({ status: 404 });
  expect(fetch).toHaveBeenCalledTimes(4);
  const calls = fetch.mock.calls as unknown as [string, RequestInit][];
  const [parentUrl, parentInit] = calls[0]!;
  expect(parentUrl).toBe('/api/parent/acct%3A1?asOf=2026-08-01T00%3A00%3A00.000Z&snapshotHash=' + snapshotHash);
  expect(parentInit.method).toBeUndefined();
  expect(parentInit.credentials).toBe('same-origin');
  expect(parentInit.cache).toBe('no-store');
  expect(new Headers(parentInit.headers).has('X-EAPR-CSRF')).toBe(false);
  expect(calls[1]![0]).toBe('/api/parent/acct%3A1?asOf=2026-10-03T00%3A00%3A00.000Z');
  expect(calls[2]![0]).toBe('/api/parent/acct%3A1?snapshotHash=' + snapshotHash);
  expect(calls[3]![0]).toBe('/api/accounts/acct%3A1/activation');
  expect(calls[3]![0]).not.toContain('?');
});

test('rejects invalid selectors before a request and does not replace a missing snapshot', async () => {
  const fetch = vi.fn(async () => Response.json({
    code: 'PARENT_READ_NOT_FOUND', message: 'The registered scope or snapshot was not found',
    diagnostics: [], correlationId: 'request-1',
  }, { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  await expect(readParentAccount('acct:1', { asOf: 'yesterday' })).rejects.toMatchObject({
    status: 400, code: 'PARENT_READ_INVALID',
  });
  await expect(readParentAccount('bad id')).rejects.toMatchObject({ status: 400, code: 'PARENT_READ_INVALID' });
  expect(fetch).not.toHaveBeenCalled();
  await expect(readParentAccount('acct:1', { snapshotHash: hash })).rejects.toMatchObject({ status: 404 });
  expect(fetch).toHaveBeenCalledOnce();
});

test('preserves session expiry, cancellation and safe forbidden or unavailable failures', async () => {
  let expired = 0;
  const stop = onSessionExpiration(() => { expired += 1; });
  setCsrfToken('token-1');
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({
      code: 'PARENT_READ_FORBIDDEN', message: 'Parent read access is forbidden', diagnostics: [], correlationId: 'request-1',
    }, { status: 403 }))
    .mockResolvedValueOnce(new Response('<html>private</html>', { status: 503 }))
    .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));
  vi.stubGlobal('fetch', fetch);
  await expect(readParentAccount(scopeA.accountId)).rejects.toMatchObject({
    status: 403, code: 'PARENT_READ_FORBIDDEN', message: 'Parent read access is forbidden', correlationId: 'request-1',
  });
  expect(expired).toBe(0);
  await expect(readAccountActivation(scopeA.accountId)).rejects.toMatchObject({
    status: 503, code: 'MALFORMED_RESPONSE',
  });
  await expect(readParentAccount(scopeA.accountId, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect((fetch.mock.calls as unknown as [string, RequestInit][])[2]![1].signal).toBe(controller.signal);
  fetch.mockResolvedValueOnce(Response.json({
    code: 'UNAUTHORIZED', message: 'Session expired', diagnostics: [], correlationId: 'request-2',
  }, { status: 401 }));
  await expect(readParentAccount(scopeA.accountId)).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  expect(expired).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(4);
  stop();
});

test('accepts paired and inactive activation and rejects a substituted parent snapshot', async () => {
  const inactive = inactiveState(emptyTargetA.scope);
  const paired = pairedState(baselineA.scope);
  const view = parentView(emptyTargetA, '2026-11-08T00:00:00.000Z', 0);
  const substituted = parentView(emptyTargetA, '2026-11-08T00:00:00.000Z', 0);
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(inactive))
    .mockResolvedValueOnce(Response.json(paired))
    .mockResolvedValueOnce(Response.json({ ...paired, initialReceipt: null }))
    .mockResolvedValueOnce(Response.json({ ...paired, extra: true }))
    .mockResolvedValueOnce(Response.json(view))
    .mockResolvedValueOnce(Response.json(substituted))
    .mockResolvedValueOnce(Response.json(parentView(emptyTargetB, view.asOf, 0)));
  vi.stubGlobal('fetch', fetch);
  await expect(readAccountActivation(emptyTargetA.scope.accountId)).resolves.toEqual(inactive);
  await expect(readAccountActivation(baselineA.scope.accountId)).resolves.toEqual(paired);
  await expect(readAccountActivation(baselineA.scope.accountId)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  await expect(readAccountActivation(baselineA.scope.accountId)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  await expect(readParentAccount(emptyTargetA.scope.accountId)).resolves.toEqual(view);
  await expect(readParentAccount(emptyTargetA.scope.accountId, { snapshotHash: 'cd'.repeat(32) })).rejects
    .toMatchObject({ code: 'MALFORMED_RESPONSE' });
  await expect(readParentAccount(emptyTargetA.scope.accountId, { asOf: view.asOf })).rejects
    .toMatchObject({ code: 'MALFORMED_RESPONSE' });
  expect(fetch).toHaveBeenCalledTimes(7);
});

test('ParentView account options follow renewed session grants', () => {
  const session = (allowedAccountIds: string[]): LocalSession => ({
    demoOnly: true,
    reviewer: { reviewerId: 'reviewer', sessionId: 'session-1' },
    allowedSourceRefs: ['legacy-a'],
    allowedAccountIds,
  });
  const first = renderToStaticMarkup(createElement(ParentViewPage, { session: session(['account-a', 'account-b']) }));
  expect(first).toContain('account-a');
  expect(first).toContain('account-b');
  const renewed = renderToStaticMarkup(createElement(ParentViewPage, { session: session(['account-b']) }));
  expect(renewed).toContain('account-b');
  expect(renewed).not.toContain('>account-a<');
  const empty = renderToStaticMarkup(createElement(ParentViewPage, { session: session([]) }));
  expect(empty).toContain('No accounts are authorized for this reviewer session.');
});

test('matches ActivationStateV1 acceptance for inactive, paired and conflicting bodies', async () => {
  const samples = [
    inactiveState(emptyTargetA.scope),
    pairedState(baselineA.scope),
    { schemaVersion: '1', scope: scopeA, activation: null, initialReceipt: { id: 'receipt-a' } },
    { ...pairedState(baselineA.scope), activation: { ...pairedState(baselineA.scope).activation!, epoch: 2 } },
    { schemaVersion: '1', scope: scopeB, activation: null, initialReceipt: null },
  ];
  for (const sample of samples) {
    const real = ActivationStateV1Schema.safeParse(sample);
    const accountId = real.success ? real.data.scope.accountId :
      sample && typeof sample === 'object' && 'scope' in sample && sample.scope &&
      typeof sample.scope === 'object' && 'accountId' in sample.scope && typeof sample.scope.accountId === 'string'
        ? sample.scope.accountId : 'acct:1';
    vi.stubGlobal('fetch', async () => Response.json(sample));
    const client = await readAccountActivation(accountId).then(
      state => ({ ok: true as const, state }),
      () => ({ ok: false as const }),
    );
    expect(client.ok, JSON.stringify(sample)).toBe(real.success);
    if (real.success && client.ok) expect(client.state).toEqual(real.data);
  }
});
