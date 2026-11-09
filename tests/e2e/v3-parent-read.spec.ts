import { expect, test, type Page } from '@playwright/test';
import { ActivationStateV1Schema, ParentViewSchema } from '@eapr/contracts';
import { formatUsdCents } from '../../apps/web/src/features/preview/preview-values.js';
import { apiResponse, openLocalReview, startReview } from './support/local-review.js';

test.use({ trace: 'off' });
test.setTimeout(180_000);

async function runtimeRows(system: Awaited<ReturnType<typeof openLocalReview>>['system']) {
  const names = await system.db.runtime.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return Promise.all(names.rows.map(({ tablename }) =>
    system.db.runtime.query('SELECT to_jsonb(t) AS row FROM ' + tablename + ' t ORDER BY to_jsonb(t)')
      .then(result => result.rows)));
}

function parentRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/parent/') || /^\/api\/accounts\/[^/]+\/activation$/.test(url.pathname)) {
      urls.push(request.method() + ' ' + url.pathname + url.search);
    }
  });
  return urls;
}

test('reads inactive registered parent state without writing runtime records', async ({ page }) => {
  const { origin, system, close } = await openLocalReview();
  const requests = parentRequests(page);
  try {
    await startReview(page, origin, 'parent');
    await expect(page.getByRole('heading', { name: 'Parent records', exact: true })).toBeVisible();
    const select = page.getByLabel('Registered account');
    await expect(select.locator('option')).toHaveCount(3);
    const accountIds = await select.locator('option').evaluateAll(options =>
      options.map(option => (option as HTMLOptionElement).value).filter(value => value !== ''));
    expect(accountIds).toHaveLength(2);
    const before = await runtimeRows(system);

    for (const [index, accountId] of accountIds.entries()) {
      const parentWait = apiResponse(page, '/api/parent/' + accountId);
      const activationWait = apiResponse(page, '/api/accounts/' + accountId + '/activation');
      await select.selectOption(accountId);
      const [parentResponse, activationResponse] = await Promise.all([parentWait, activationWait]);
      expect(parentResponse.status()).toBe(200);
      expect(activationResponse.status()).toBe(200);
      expect(parentResponse.headers()['cache-control']).toBe('no-store');
      expect(activationResponse.headers()['cache-control']).toBe('no-store');
      expect(parentResponse.request().method()).toBe('GET');
      expect(activationResponse.request().method()).toBe('GET');
      const view = ParentViewSchema.parse(await parentResponse.json());
      const activation = ActivationStateV1Schema.parse(await activationResponse.json());
      expect(view).toMatchObject({ scope: { accountId }, version: 0 });
      expect(activation).toEqual({ schemaVersion: '1', scope: view.scope, activation: null, initialReceipt: null });
      expect(view.asOf).not.toBe(view.records.asOf);
      const inspection = page.getByRole('region', { name: 'Parent inspection' });
      await expect(inspection.getByText('Not imported', { exact: true })).toBeVisible();
      await expect(inspection.getByText(view.records.asOf, { exact: true })).toBeVisible();
      await expect(inspection.getByText(view.asOf, { exact: true })).toBeVisible();
      await expect(inspection.getByText(view.snapshotHash, { exact: true })).toBeVisible();
      await expect(inspection.getByText(formatUsdCents(view.balanceCents), { exact: true })).toBeVisible();
      await expect(inspection.getByText('Absent', { exact: true })).toHaveCount(2);

      if (index === 0) {
        const evaluatedAt = '2026-08-01T00:00:00.000Z';
        const activationCount = requests.filter(request => request.includes('/activation')).length;
        const reread = page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.pathname === '/api/parent/' + accountId && url.searchParams.get('asOf') === evaluatedAt;
        });
        await page.getByLabel('Balance evaluation time').fill(evaluatedAt);
        await page.getByRole('button', { name: 'Apply parent selectors' }).click();
        const rereadResponse = await reread;
        expect(rereadResponse.status()).toBe(200);
        const rereadView = ParentViewSchema.parse(await rereadResponse.json());
        expect(rereadView.asOf).toBe(evaluatedAt);
        expect(rereadView.records).toEqual(view.records);
        expect(rereadView.snapshotHash).toBe(view.snapshotHash);
        expect(rereadView.version).toBe(view.version);
        await expect(inspection.getByText(evaluatedAt, { exact: true })).toBeVisible();
        await expect(inspection.getByText(view.records.asOf, { exact: true })).toBeVisible();
        await expect(inspection.getByText(view.snapshotHash, { exact: true })).toBeVisible();
        expect(requests.filter(request => request.includes('/activation'))).toHaveLength(activationCount);

        const missingHash = 'cd'.repeat(32);
        const parentCount = requests.filter(request => request.startsWith('GET /api/parent/')).length;
        const missing = page.waitForResponse(response => new URL(response.url()).searchParams.get('snapshotHash') === missingHash);
        await page.getByLabel('Historical snapshot hash').fill(missingHash);
        await page.getByRole('button', { name: 'Apply parent selectors' }).click();
        expect((await missing).status()).toBe(404);
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(inspection).toHaveCount(0);
        const parentReads = requests.filter(request => request.startsWith('GET /api/parent/'));
        expect(parentReads).toHaveLength(parentCount + 1);
        expect(parentReads.at(-1)).toContain('snapshotHash=' + missingHash);
        expect(parentReads.filter(request => !request.includes('snapshotHash='))).toHaveLength(parentCount);
      }
    }

    expect(requests.every(request => request.startsWith('GET '))).toBe(true);
    expect(await runtimeRows(system)).toEqual(before);
  } finally {
    await close();
  }
});
