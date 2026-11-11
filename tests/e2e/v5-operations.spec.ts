import { expect, test } from '@playwright/test';
import {
  AuthorityOperationV1Schema, AuthorityStatusResponseV1Schema, ConnectionStateV1Schema, CurrentAuthorityV1Schema,
} from '@eapr/contracts';
import { formatUsdCents } from '../../apps/web/src/features/preview/preview-values.js';
import { apiResponse, expectBrowserMutation, openLocalReview, startReview } from './support/local-review.js';

test.use({ trace: 'off' });
test.setTimeout(420_000);

async function activate(page: Parameters<typeof startReview>[0], origin: string, accountId: string) {
  await startReview(page, origin, 'review');
  await page.getByLabel('Registered account').selectOption(accountId);
  const prepare = apiResponse(page, '/api/review/' + accountId + '/prepare', 'POST');
  await page.getByRole('button', { name: 'Prepare review package' }).click();
  await expectBrowserMutation(await prepare, origin);
  const activation = apiResponse(page, '/api/review/' + accountId + '/activate', 'POST');
  await page.getByRole('button', { name: 'Approve this customer only' }).click();
  expect((await activation).status()).toBe(200);
  await expect(page.getByRole('region', { name: 'Activation receipt' })).toBeVisible();
}

async function openOperations(
  page: Parameters<typeof startReview>[0],
  origin: string,
  accountId: string,
) {
  await page.goto(origin + '/#operations');
  await expect(page.getByRole('heading', { name: 'Connection operations' })).toBeVisible();
  await page.getByLabel('Registered account').selectOption(accountId);
  await expect(page.getByRole('region', { name: 'Current authority' })).toBeVisible();
}

test('shows dedicated authority, immutable receipts, honest AI-off posture and commands', async ({ page }) => {
  const { origin, system, close, accounts } = await openLocalReview({ activation: true });
  if (!accounts) throw new Error('Activation review harness did not expose accounts');
  const { a: accountA, b: accountB } = accounts();
  const writes: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/connections') && request.method() === 'POST') writes.push(path);
  });

  try {
    await activate(page, origin, accountA);
    const overviewRead = apiResponse(page, '/api/connections/' + accountA);
    const authorityRead = apiResponse(page, '/api/connections/' + accountA + '/authority');
    await openOperations(page, origin, accountA);
    const [overviewResponse, authorityResponse] = await Promise.all([overviewRead, authorityRead]);
    const state = ConnectionStateV1Schema.parse(await overviewResponse.json());
    const authority = CurrentAuthorityV1Schema.parse(await authorityResponse.json());
    expect(state).toMatchObject({ status: 'active', epoch: 1, runtimeModelCalls: null });
    expect(authority).toMatchObject({ status: 'active', epoch: 1, identity: { scope: { accountId: accountA } } });

    const stored = await system.db.runtime.query<{ receipt_id: string; activation_id: string }>(
      'SELECT receipt_id, activation_id FROM runtime_activation_imports WHERE account_id = $1', [accountA]);
    expect(state.receipts).toHaveLength(1);
    expect(state.receipts[0]).toMatchObject({
      id: stored.rows[0]!.receipt_id, kind: 'initial', activationId: stored.rows[0]!.activation_id,
    });

    const panel = page.getByRole('region', { name: 'Connection state' });
    const controls = page.getByRole('region', { name: 'Current authority' });
    await expect(panel.getByText(state.receipts[0]!.id, { exact: true }).first()).toBeVisible();
    await expect(panel.getByText(formatUsdCents(state.receipts[0]!.afterBalanceCents), { exact: true }).first()).toBeVisible();
    await expect(panel.getByText(/AI-off.*forbidden.*not measured/i)).toBeVisible();
    await expect(panel.getByText(/does not establish isolation.*share a capture lane/i)).toBeVisible();
    await expect(panel.getByText('Not measured', { exact: true }).first()).toBeVisible();
    for (const hash of [authority.artifactHash, authority.profileHash, authority.manifestHash]) {
      await expect(controls.getByText(hash, { exact: true })).toBeVisible();
    }

    const pause = apiResponse(page, '/api/connections/' + accountA + '/pause', 'POST');
    await controls.getByRole('button', { name: 'Pause this customer' }).click();
    expect(AuthorityStatusResponseV1Schema.parse(await (await pause).json()).result.state.epoch).toBe(2);
    await expect(controls.getByText(/paused.*epoch 2/i).first()).toBeVisible();
    await controls.getByRole('button', { name: 'Resume this customer' }).click();
    await expect(controls.getByText(/active.*epoch 3/i).first()).toBeVisible();
    await controls.getByRole('button', { name: 'Revoke this customer' }).click();
    await page.getByRole('alertdialog', { name: 'Confirm revoke' }).getByRole('button', { name: 'Confirm revoke' }).click();
    await expect(controls.getByText(/revoked.*epoch 4/i).first()).toBeVisible();
    expect(writes.map(path => path.split('/').pop())).toEqual(['pause', 'resume', 'revoke']);

    await page.getByLabel('Registered account').selectOption(accountB);
    await expect(page.getByRole('region', { name: 'Connection state' }).getByText(/Inactive:/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Current authority' }).getByRole('button', {
      name: /pause|resume|revoke/i,
    })).toHaveCount(0);
  } finally {
    await close();
  }
});

test('keeps authority command availability independent from the overview', async ({ page }) => {
  const { origin, close, accounts } = await openLocalReview({ activation: true });
  if (!accounts) throw new Error('Activation review harness did not expose accounts');
  const { a: accountA } = accounts();
  const overviewPath = '/api/connections/' + accountA;
  const authorityPath = overviewPath + '/authority';

  try {
    await activate(page, origin, accountA);
    await page.route('**' + overviewPath, route => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ code: 'DEPENDENCY_UNAVAILABLE', message: 'overview unavailable', diagnostics: [] }),
    }));
    await openOperations(page, origin, accountA);
    const controls = page.getByRole('region', { name: 'Current authority' });
    await expect(controls.getByRole('button', { name: 'Pause this customer' })).toBeEnabled();
    await expect(page.getByRole('alert')).toBeVisible();

    await page.unroute('**' + overviewPath);
    await page.route('**' + authorityPath, route => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ code: 'AUTHORITY_UNAVAILABLE', message: 'authority unavailable', diagnostics: [] }),
    }));
    await page.getByRole('button', { name: 'Refresh authority and connection state' }).click();
    await expect(page.getByRole('region', { name: 'Connection state' })).toBeVisible();
    await expect(controls.getByText(/commands are unavailable/i)).toBeVisible();
    await expect(controls.getByRole('button', { name: /pause|resume|revoke/i })).toHaveCount(0);
  } finally {
    await close();
  }
});

test('persists an uncertain command across navigation and retries its exact body', async ({ page }) => {
  const { origin, close, accounts } = await openLocalReview({ activation: true });
  if (!accounts) throw new Error('Activation review harness did not expose accounts');
  const { a: accountA } = accounts();
  const path = '/api/connections/' + accountA + '/pause';
  const bodies: unknown[] = [];
  let loseReply = true;

  try {
    await activate(page, origin, accountA);
    await page.route('**' + path, async route => {
      bodies.push(route.request().postDataJSON());
      if (!loseReply) return route.continue();
      loseReply = false;
      await route.fetch();
      await route.abort('failed');
    });
    await openOperations(page, origin, accountA);
    const controls = page.getByRole('region', { name: 'Current authority' });
    await controls.getByRole('button', { name: 'Pause this customer' }).click();
    await expect(controls.getByRole('button', { name: 'Retry original pause' })).toBeEnabled();
    await openOperations(page, origin, accountA);
    await expect(controls.getByRole('button', { name: 'Retry original pause' })).toBeEnabled();
    const retry = apiResponse(page, path, 'POST');
    await controls.getByRole('button', { name: 'Retry original pause' }).click();
    const replay = AuthorityStatusResponseV1Schema.parse(await (await retry).json());
    expect(replay.replayed).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    await expect(controls.getByText(/replayed historical result/i)).toBeVisible();
  } finally {
    await close();
  }
});

test('retires a 409 attempt, refreshes both reads and requires a new deliberate key', async ({ page }) => {
  const { origin, close, accounts } = await openLocalReview({ activation: true });
  if (!accounts) throw new Error('Activation review harness did not expose accounts');
  const { a: accountA } = accounts();
  const pausePath = '/api/connections/' + accountA + '/pause';
  const bodies: Array<{ expectedEpoch: number; idempotencyKey: string }> = [];
  let conflict = true;

  try {
    await activate(page, origin, accountA);
    await page.route('**' + pausePath, async route => {
      bodies.push(route.request().postDataJSON());
      if (!conflict) return route.continue();
      conflict = false;
      await route.fetch();
      await route.fulfill({
        status: 409, contentType: 'application/json',
        body: JSON.stringify({ code: 'AUTHORITY_STALE', message: 'stale authority', diagnostics: [] }),
      });
    });
    await openOperations(page, origin, accountA);
    const controls = page.getByRole('region', { name: 'Current authority' });
    await controls.getByRole('button', { name: 'Pause this customer' }).click();
    await expect(controls.getByText(/paused.*epoch 2/i).first()).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Retry original pause' })).toHaveCount(0);
    expect(bodies).toHaveLength(1);

    const resume = apiResponse(page, '/api/connections/' + accountA + '/resume', 'POST');
    await controls.getByRole('button', { name: 'Resume this customer' }).click();
    const nextBody = (await resume).request().postDataJSON() as { expectedEpoch: number; idempotencyKey: string };
    expect(nextBody.expectedEpoch).toBe(2);
    expect(nextBody.idempotencyKey).not.toBe(bodies[0]!.idempotencyKey);
  } finally {
    await close();
  }
});

test('keeps a same-identity epoch floor and never displays a historical replay as current', async ({ page }) => {
  const { origin, close, accounts } = await openLocalReview({ activation: true });
  if (!accounts) throw new Error('Activation review harness did not expose accounts');
  const { a: accountA } = accounts();
  const authorityPath = '/api/connections/' + accountA + '/authority';
  let originalPause: unknown;

  try {
    await activate(page, origin, accountA);
    const initialRead = apiResponse(page, authorityPath);
    await openOperations(page, origin, accountA);
    const initialAuthority = CurrentAuthorityV1Schema.parse(await (await initialRead).json());
    const controls = page.getByRole('region', { name: 'Current authority' });
    await page.route('**' + authorityPath, async route => {
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(initialAuthority) });
    }, { times: 1 });
    const pause = apiResponse(page, '/api/connections/' + accountA + '/pause', 'POST');
    await controls.getByRole('button', { name: 'Pause this customer' }).click();
    originalPause = (await pause).request().postDataJSON();
    await expect(controls.getByText(/paused.*epoch 2/i).first()).toBeVisible();
    await page.waitForTimeout(150);
    await expect(controls.getByText(/paused.*epoch 2/i).first()).toBeVisible();

    await controls.getByRole('button', { name: 'Resume this customer' }).click();
    await expect(controls.getByText(/active.*epoch 3/i).first()).toBeVisible();
    await controls.getByRole('button', { name: 'Revoke this customer' }).click();
    await page.getByRole('alertdialog', { name: 'Confirm revoke' }).getByRole('button', { name: 'Confirm revoke' }).click();
    await expect(controls.getByText(/revoked.*epoch 4/i).first()).toBeVisible();

    const historical = AuthorityOperationV1Schema.parse({
      schemaVersion: '1', accountId: accountA, action: 'pause', body: originalPause,
    });
    await page.evaluate(({ accountId, operation }) => {
      sessionStorage.setItem('eapr-authority-operation:' + accountId, JSON.stringify(operation));
    }, { accountId: accountA, operation: historical });
    await openOperations(page, origin, accountA);
    await expect(controls.getByText(/revoked.*epoch 4/i).first()).toBeVisible();
    await controls.getByRole('button', { name: 'Retry original pause' }).click();
    await expect(controls.getByText(/replayed historical result/i)).toBeVisible();
    await expect(controls.getByText(/revoked.*epoch 4/i).first()).toBeVisible();
  } finally {
    await close();
  }
});
