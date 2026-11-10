import { expect, test, type Page } from '@playwright/test';
import { ActivationRequestSchema, ActivationStateV1Schema, ReviewPackageSchema } from '@eapr/contracts';
import { formatUsdCents } from '../../apps/web/src/features/preview/preview-values.js';
import { apiResponse, expectBrowserMutation, openLocalReview, startReview } from './support/local-review.js';

test.use({ trace: 'off' });
test.setTimeout(420_000);

function parentAndActivationRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/parent/') || /^\/api\/accounts\/[^/]+\/activation$/.test(url.pathname)) {
      urls.push(request.method() + ' ' + url.pathname + url.search);
    }
  });
  return urls;
}

async function prepareAccount(page: Page, origin: string, accountId: string) {
  const select = page.getByLabel('Registered account');
  await select.selectOption(accountId);
  const prepareWait = apiResponse(page, '/api/review/' + accountId + '/prepare', 'POST');
  await page.getByRole('button', { name: 'Prepare review package' }).click();
  const prepareResponse = await prepareWait;
  expect(prepareResponse.status()).toBe(200);
  await expectBrowserMutation(prepareResponse, origin);
  const reviewPackage = ReviewPackageSchema.parse(await prepareResponse.json());
  expect(reviewPackage).toMatchObject({ scope: { accountId }, ready: true });
  expect(reviewPackage.diagnostics.filter(item => item.severity === 'blocker')).toEqual([]);
  const card = page.getByRole('region', { name: 'Review package' });
  await expect(card.getByText('Ready for reviewer decision', { exact: true })).toBeVisible();
  await expect(card.getByText(reviewPackage.hash, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve this customer only' })).toBeEnabled();
  return reviewPackage;
}

test('binds one-customer approval, reuses the saved key, gates stale packages, and keeps parent reads GET-only', async ({ page }) => {
  const harness = await openLocalReview({ activation: true });
  const { origin, system, close, accounts, forceStaleReview } = harness;
  if (!accounts || !forceStaleReview) throw new Error('Activation review harness did not expose accounts');
  const { a: accountA, b: accountB } = accounts();
  const parentRequests = parentAndActivationRequests(page);

  try {
    await startReview(page, origin, 'review');
    const select = page.getByLabel('Registered account');
    await expect(select.locator('option')).toHaveCount(3);
    const optionIds = await select.locator('option').evaluateAll(options =>
      options.map(option => (option as HTMLOptionElement).value).filter(value => value !== ''));
    expect(optionIds.sort()).toEqual([accountA, accountB].sort());

    // --- Idempotency key reuse across reload (sessionStorage binding) ---
    const preparedA = await prepareAccount(page, origin, accountA);
    const reuseKey = 'browser-reuse-' + accountA;
    const seeded = ActivationRequestSchema.parse({
      reviewPackageId: preparedA.id,
      expectedPackageHash: preparedA.hash,
      expectedArtifactHash: preparedA.artifactHash,
      expectedProfileHash: preparedA.profileHash,
      expectedTargetVersion: preparedA.expectedTargetVersion,
      idempotencyKey: reuseKey,
    });
    await page.evaluate(({ accountId, request }) => {
      sessionStorage.setItem('eapr-review-approval:' + accountId, JSON.stringify(request));
    }, { accountId: accountA, request: seeded });
    await select.selectOption('');
    await select.selectOption(accountA);
    await expect(page.getByRole('region', { name: 'Review package' })).toBeVisible();
    await expect(page.getByText(/already submitted from this\s+browser session/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry same approval' })).toBeEnabled();

    const activateReuse = apiResponse(page, '/api/review/' + accountA + '/activate', 'POST');
    await page.getByRole('button', { name: 'Retry same approval' }).click();
    const reuseResponse = await activateReuse;
    expect([200, 202]).toContain(reuseResponse.status());
    await expectBrowserMutation(reuseResponse, origin);
    expect(reuseResponse.request().postDataJSON()).toEqual(seeded);

    if (reuseResponse.status() === 200) {
      const body = await reuseResponse.json() as { receipt: { id: string }; replayed: boolean };
      expect(body.receipt.id).toBeTruthy();
      await expect(page.getByRole('region', { name: 'Activation receipt' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Approve this customer only|Retry same approval/ })).toBeDisabled();
    } else {
      await expect(page.getByText(/application is still pending/i)).toBeVisible();
    }

    // --- Dual-account: prepare B, leave inactive; A remains the only approved path ---
    await select.selectOption(accountB);
    await expect(page.getByText('No review package is prepared for this account.', { exact: true })).toBeVisible();
    const preparedB = await prepareAccount(page, origin, accountB);
    expect(preparedB.scope.accountId).toBe(accountB);
    await expect(page.getByRole('button', { name: 'Approve this customer only' })).toBeEnabled();
    // Do not approve B — isolation requires it stay inactive after A.

    if (reuseResponse.status() !== 200) {
      // Finish A if the seeded key only reached pending.
      await select.selectOption(accountA);
      const finish = apiResponse(page, '/api/review/' + accountA + '/activate', 'POST');
      await page.getByRole('button', { name: /Retry same approval|Approve this customer only/ }).click();
      const finished = await finish;
      expect(finished.status(), await finished.text()).toBe(200);
      await expect(page.getByRole('region', { name: 'Activation receipt' })).toBeVisible();
    }

    // --- Stale gating on B (head rewritten under the displayed package) ---
    await select.selectOption(accountB);
    await expect(page.getByRole('region', { name: 'Review package' }).getByText(preparedB.hash, { exact: true })).toBeVisible();
    await forceStaleReview(accountB);
    const staleActivate = apiResponse(page, '/api/review/' + accountB + '/activate', 'POST');
    await page.getByRole('button', { name: 'Approve this customer only' }).click();
    const staleResponse = await staleActivate;
    expect(staleResponse.status()).toBe(409);
    const staleBody = await staleResponse.json() as { code: string };
    // Server may emit STALE_REVIEW (head CAS) or REVIEW_STALE (proof rebind); UI treats both as stale.
    expect(['STALE_REVIEW', 'REVIEW_STALE']).toContain(staleBody.code);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/package changed|Reload the saved package/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload saved package' })).toBeEnabled();
    // Stale keeps approve off; label may already say Retry if sessionStorage saved the attempt.
    await expect(page.getByRole('button', { name: /Approve this customer only|Retry same approval/ })).toBeDisabled();

    const reloadWait = apiResponse(page, '/api/review/' + accountB);
    await page.getByRole('button', { name: 'Reload saved package' }).click();
    expect((await reloadWait).status()).toBe(200);
    // Reloaded head may still match a saved same-package key (Retry) or show a fresh Approve.
    await expect(page.getByRole('button', { name: /Approve this customer only|Retry same approval/ })).toBeEnabled();

    // --- Parent inspect remains read-only; only A is active ---
    await page.getByRole('link', { name: 'Parent' }).click();
    await expect(page.getByRole('heading', { name: 'Parent records', exact: true })).toBeVisible();
    const parentSelect = page.getByLabel('Registered account');

    const activationA = apiResponse(page, '/api/accounts/' + accountA + '/activation');
    const parentA = apiResponse(page, '/api/parent/' + accountA);
    await parentSelect.selectOption(accountA);
    const [parentAResponse, activationAResponse] = await Promise.all([parentA, activationA]);
    expect(parentAResponse.status()).toBe(200);
    expect(activationAResponse.status()).toBe(200);
    expect(parentAResponse.request().method()).toBe('GET');
    expect(activationAResponse.request().method()).toBe('GET');
    const stateA = ActivationStateV1Schema.parse(await activationAResponse.json());
    expect(stateA.activation).not.toBeNull();
    expect(stateA.initialReceipt).not.toBeNull();
    expect(stateA.activation?.status).toBe('active');
    const inspectionA = page.getByRole('region', { name: 'Parent inspection' });
    await expect(inspectionA.getByText('Activation active', { exact: true })).toBeVisible();
    await expect(inspectionA.getByText(stateA.activation!.id, { exact: true })).toBeVisible();
    await expect(inspectionA.getByText(formatUsdCents(stateA.initialReceipt!.afterBalanceCents), { exact: true }).first())
      .toBeVisible();

    const activationB = apiResponse(page, '/api/accounts/' + accountB + '/activation');
    const parentB = apiResponse(page, '/api/parent/' + accountB);
    await parentSelect.selectOption(accountB);
    const [parentBResponse, activationBResponse] = await Promise.all([parentB, activationB]);
    expect(parentBResponse.status()).toBe(200);
    expect(activationBResponse.status()).toBe(200);
    const stateB = ActivationStateV1Schema.parse(await activationBResponse.json());
    expect(stateB).toEqual({
      schemaVersion: '1', scope: stateB.scope, activation: null, initialReceipt: null,
    });
    await expect(page.getByRole('region', { name: 'Parent inspection' }).getByText('Not imported', { exact: true })).toBeVisible();

    expect(parentRequests.every(request => request.startsWith('GET '))).toBe(true);
    expect(parentRequests.some(request => request.includes(accountA))).toBe(true);
    expect(parentRequests.some(request => request.includes(accountB))).toBe(true);

    // Runtime should hold exactly one activation import (account A).
    const imports = await system.db.runtime.query<{ account_id: string }>(
      'SELECT account_id FROM runtime_activation_imports ORDER BY account_id',
    );
    expect(imports.rows.map(row => row.account_id)).toEqual([accountA]);
  } finally {
    await close();
  }
});

async function prepareAccountWithoutApproveCheck(page: Page, origin: string, accountId: string) {
  await page.getByLabel('Registered account').selectOption(accountId);
  const wait = apiResponse(page, '/api/review/' + accountId + '/prepare', 'POST');
  await page.getByRole('button', { name: 'Prepare review package' }).click();
  const response = await wait;
  expect(response.status()).toBe(200);
  await expectBrowserMutation(response, origin);
  return ReviewPackageSchema.parse(await response.json());
}

test('retries a failed details read and offers earlier unresolved approvals only as an explicit action', async ({ page }) => {
  const harness = await openLocalReview({ activation: true });
  const { origin, close, accounts } = harness;
  if (!accounts) throw new Error('Activation review harness did not expose accounts');
  const { b: accountB } = accounts();
  const activations: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/activate')) activations.push(request.url());
  });

  try {
    await startReview(page, origin, 'review');
    let failures = 1;
    await page.route('**/api/review/*/packages/*/details', route => {
      if (failures-- > 0) return route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Details temporarily unavailable', diagnostics: [] }) });
      return route.continue();
    });
    const prepared = await prepareAccountWithoutApproveCheck(page, origin, accountB);
    await expect(page.getByRole('button', { name: 'Retry decision details' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve this customer only' })).toBeDisabled();
    await page.getByRole('button', { name: 'Retry decision details' }).click();
    await expect(page.getByRole('region', { name: 'Decision details' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve this customer only' })).toBeEnabled();
    await expect(page.getByText('Automatic sync stops').first()).toBeVisible();

    const earlier = ActivationRequestSchema.parse({
      reviewPackageId: 'earlier-' + prepared.id, expectedPackageHash: 'f'.repeat(64),
      expectedArtifactHash: prepared.artifactHash, expectedProfileHash: prepared.profileHash,
      expectedTargetVersion: prepared.expectedTargetVersion, idempotencyKey: 'earlier-key-' + accountB,
    });
    await page.evaluate(({ accountId, request }) => {
      sessionStorage.setItem('eapr-review-approval:' + accountId, JSON.stringify([request]));
    }, { accountId: accountB, request: earlier });
    await page.getByLabel('Registered account').selectOption('');
    await page.getByLabel('Registered account').selectOption(accountB);
    const panel = page.getByRole('region', { name: 'Unresolved earlier approvals' });
    await expect(panel).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve this customer only' })).toBeEnabled();
    expect(activations).toEqual([]);

    const original = apiResponse(page, '/api/review/' + accountB + '/activate', 'POST');
    await panel.getByRole('button', { name: /Retry original approval/ }).click();
    expect((await original).request().postDataJSON()).toEqual(earlier);
    expect(activations).toHaveLength(1);
  } finally {
    await close();
  }
});
