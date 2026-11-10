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

    const controls = page.getByRole('region', { name: 'Authority controls' });
    const pause = apiResponse(page, '/api/connections/' + accountA + '/pause', 'POST');
    await controls.getByRole('button', { name: 'Pause this customer' }).click();
    const paused = await pause;
    expect(paused.status()).toBe(200);
    expect(paused.request().postDataJSON()).toMatchObject({ expectedEpoch: 1 });
    await expect(controls.getByText(/Pause recorded: paused at epoch 2/)).toBeVisible();
    await expect(panel.getByText(/Paused: no new input/)).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Pause this customer' })).toHaveCount(0);

    await controls.getByRole('button', { name: 'Resume this customer' }).click();
    await expect(controls.getByText(/Resume recorded: active at epoch 3/)).toBeVisible();

    await controls.getByRole('button', { name: 'Revoke this customer' }).click();
    await page.getByRole('alertdialog', { name: 'Confirm revoke' }).getByRole('button', { name: 'Confirm revoke' }).click();
    await expect(controls.getByText(/Revoke recorded: revoked at epoch 4/)).toBeVisible();
    await expect(panel.getByText(/Revoked: authority was withdrawn/)).toBeVisible();
    await expect(controls.getByRole('button')).toHaveCount(0);

    const inactive = apiResponse(page, '/api/connections/' + accountB);
    await page.getByLabel('Registered account').selectOption(accountB);
    const other = ConnectionStateV1Schema.parse(await (await inactive).json());
    expect(other).toMatchObject({ status: 'inactive', epoch: 0, activationId: null, receipts: [], lastReceiptId: null });
    await expect(page.getByRole('region', { name: 'Connection state' }).getByText(/Inactive:/)).toBeVisible();
    expect(writes.map(write => write.split('/').pop())).toEqual(['pause', 'resume', 'revoke']);
    expect(writes.every(write => write.includes(accountA))).toBe(true);
  } finally {
    await close();
  }
});
