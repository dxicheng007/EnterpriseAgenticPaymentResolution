import { expect, test } from '@playwright/test';
import { ConnectionStateV1Schema } from '@eapr/contracts';
import { formatUsdCents } from '../../apps/web/src/features/preview/preview-values.js';
import { apiResponse, expectBrowserMutation, openLocalReview, startReview } from './support/local-review.js';

test.use({ trace: 'off' });
test.setTimeout(420_000);

test('shows worker-authoritative connection state, receipts and honest unmeasured counts', async ({ page }) => {
  const { origin, system, close, accounts } = await openLocalReview({ activation: true });
  if (!accounts) throw new Error('Activation review harness did not expose accounts');
  const { a: accountA, b: accountB } = accounts();
  const writes: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/connections') && request.method() !== 'GET') writes.push(request.method() + ' ' + url.pathname);
  });

  try {
    await startReview(page, origin, 'review');
    await page.getByLabel('Registered account').selectOption(accountA);
    const prepare = apiResponse(page, '/api/review/' + accountA + '/prepare', 'POST');
    await page.getByRole('button', { name: 'Prepare review package' }).click();
    await expectBrowserMutation(await prepare, origin);
    await expect(page.getByRole('button', { name: 'Approve this customer only' })).toBeEnabled();
    const activate = apiResponse(page, '/api/review/' + accountA + '/activate', 'POST');
    await page.getByRole('button', { name: 'Approve this customer only' }).click();
    expect((await activate).status()).toBe(200);
    await expect(page.getByRole('region', { name: 'Activation receipt' })).toBeVisible();

    await page.getByRole('link', { name: 'Operations' }).click();
    await expect(page.getByRole('heading', { name: 'Connection operations' })).toBeVisible();
    const read = apiResponse(page, '/api/connections/' + accountA);
    await page.getByLabel('Registered account').selectOption(accountA);
    const response = await read;
    expect(response.status()).toBe(200);
    expect(response.request().method()).toBe('GET');
    const state = ConnectionStateV1Schema.parse(await response.json());
    expect(state).toMatchObject({ status: 'active', epoch: 1, runtimeModelCalls: null });
    expect(state.counts).toEqual({ appliedBatches: 0, pendingEvents: null, quarantinedEvents: null });
    expect(state.receipts).toHaveLength(1);

    const stored = await system.db.runtime.query<{ receipt_id: string; activation_id: string }>(
      'SELECT receipt_id, activation_id FROM runtime_activation_imports WHERE account_id = $1', [accountA]);
    expect(stored.rows).toHaveLength(1);
    expect(state.receipts[0]).toMatchObject({ id: stored.rows[0]!.receipt_id, kind: 'initial', activationId: stored.rows[0]!.activation_id });

    const panel = page.getByRole('region', { name: 'Connection state' });
    await expect(panel.getByText(/Active: bounded automatic/)).toBeVisible();
    await expect(panel.getByText(state.receipts[0]!.id, { exact: true }).first()).toBeVisible();
    await expect(panel.getByText(formatUsdCents(state.receipts[0]!.afterBalanceCents), { exact: true }).first()).toBeVisible();
    await expect(panel.getByText('Not measured', { exact: true }).first()).toBeVisible();
    await expect(panel.getByText(/controls are not available/i)).toBeVisible();
    await expect(panel.getByRole('button', { name: /pause|resume|revoke/i })).toHaveCount(0);

    const inactive = apiResponse(page, '/api/connections/' + accountB);
    await page.getByLabel('Registered account').selectOption(accountB);
    const other = ConnectionStateV1Schema.parse(await (await inactive).json());
    expect(other).toMatchObject({ status: 'inactive', epoch: 0, activationId: null, receipts: [], lastReceiptId: null });
    await expect(page.getByRole('region', { name: 'Connection state' }).getByText(/Inactive:/)).toBeVisible();
    expect(writes).toEqual([]);
  } finally {
    await close();
  }
});
