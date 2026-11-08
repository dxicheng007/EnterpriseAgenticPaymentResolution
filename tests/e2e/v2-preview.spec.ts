import { expect, test } from '@playwright/test';
import { DemoCandidatesResponseSchema, PreviewResponseSchema } from '@eapr/contracts';
import { publishActivity } from '@eapr/storage/activity';
import { withTransaction } from '@eapr/storage/transaction';
import { apiResponse, expectBrowserMutation, openLocalReview, startReview } from './support/local-review.js';

// Network traces include the live cookie and CSRF value. Screenshots preserve the visible evidence.
test.use({ trace: 'off' });

test('previews both captured schemas and leaves real runtime state unchanged', async ({ page }) => {
  const { origin, system, close } = await openLocalReview();
  try {
    const runtime = system.db.runtime;
    const runtimeState = async () => ({
      tables: (await runtime.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows,
      rows: await Promise.all(['migration_ledger', 'seed_ledger', 'activity_counter', 'activity_events'].map(table =>
        runtime.query('SELECT to_jsonb(t) AS row FROM ' + table + ' AS t ORDER BY to_jsonb(t)').then(result => result.rows))),
    });
    await withTransaction(runtime, client => publishActivity(client, {
      stream: 'runtime', phase: 'run', type: 'system.status',
      at: '2026-11-08T00:00:00.000Z', payload: { status: 'ready' },
    }));
    const before = await runtimeState();
    const catalogWaiting = apiResponse(page, '/api/demo/candidates');
    await startReview(page, origin, 'preview');
    const catalogResponse = await catalogWaiting;
    expect(catalogResponse.status()).toBe(200);
    const catalogHeaders = await catalogResponse.request().allHeaders();
    expect('authorization' in catalogHeaders).toBe(false);
    expect(Boolean(catalogHeaders.cookie)).toBe(true);
    const catalog = DemoCandidatesResponseSchema.parse(await catalogResponse.json());
    expect(catalog).toMatchObject({ targetMode: 'empty-fixture', verificationAvailable: false });
    expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(['company-a', 'company-b']);
    const [a, b] = catalog.candidates;
    const selection = page.getByLabel('Development candidate');
    const run = page.getByRole('button', { name: 'Run preview' });

    await selection.selectOption(a.id);
    await expect(page.getByText(a.scope.sellerEntityId, { exact: true })).toBeVisible();
    await expect(page.getByText(a.scope.accountId, { exact: true })).toBeVisible();
    await expect(page.getByText('Empty development fixture', { exact: true })).toBeVisible();
    await page.getByText('Source contracts', { exact: true }).click();
    await expect(page.getByText(/Fields.*\bdue_date\b/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Preview result' })).toHaveCount(0);

    const previewA = apiResponse(page, '/api/connectors/preview', 'POST');
    await run.click();
    const responseA = await previewA;
    expect(responseA.status()).toBe(200);
    await expectBrowserMutation(responseA, origin);
    expect(responseA.request().postDataJSON()).toEqual(a.request);
    const resultA = PreviewResponseSchema.parse(await responseA.json());
    expect(resultA.diffs).toEqual([expect.objectContaining({ scope: a.scope, afterBalanceCents: 80000 })]);
    expect(resultA.parentWrites).toBe(0);
    const balanceA = page.getByRole('region', { name: 'Balance diff for ' + a.scope.accountId });
    await expect(balanceA.getByText('$800.00')).toBeVisible();
    await balanceA.screenshot({ path: test.info().outputPath('preview-company-a-balance.png') });
    await expect(page.getByText('Parent writes: 0', { exact: true })).toBeVisible();
    await expect(page.getByText(resultA.artifact!.hash, { exact: true })).toBeVisible();
    const unsupported = page.getByRole('heading', { name: /Unsupported rows \([1-9]/ }).locator('..');
    const unmappedHeading = unsupported.getByRole('heading', { name: /Records not mapped by the preview profiles/ });
    await expect(unmappedHeading).toHaveCount(1);
    await expect(unsupported.getByText(/This preview applies this customer profile to a captured source snapshot/)).toBeVisible();
    const unscopedA = resultA.unsupportedRows.find(row => !row.scope && row.code === 'UNKNOWN_ACCOUNT');
    expect(unscopedA).toBeDefined();
    await expect(unmappedHeading.locator('..').getByText(
      'Source events ' + unscopedA!.eventIds.join(', '), { exact: true })).toBeVisible();
    await unsupported.screenshot({ path: test.info().outputPath('preview-company-a-scope.png') });
    const invoice = page.locator('summary').filter({ hasText: 'insert_invoice' }).first();
    await invoice.click();
    const invoiceDetails = invoice.locator('..');
    await expect(invoiceDetails.getByText(/\/amount → decimal_to_minor → \/amountCents/)).toBeVisible();
    const conversion = invoiceDetails.getByText(/\/amount → decimal_to_minor → \/amountCents/).locator('..');
    await conversion.getByText('Mapping parameters', { exact: true }).click();
    await expect(conversion.getByText(/"scale": 2/)).toBeVisible();
    await invoiceDetails.screenshot({ path: test.info().outputPath('preview-company-a-lineage.png') });

    const citationId = a.request.spec.evidenceRefs[0];
    await page.getByRole('combobox', { name: 'Preview evidence citation', exact: true }).selectOption(citationId);
    const citation = page.getByRole('article', { name: 'Evidence citation' });
    await expect(citation.locator('mark')).toContainText('Monthly fee USD');
    await expect(citation.getByRole('link', { name: /open original/i })).toHaveAttribute(
      'href', '/api/evidence/' + citationId + '/content#page=1');
    await expect(page.getByText('Independent verification unavailable.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify artifact' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /approve|activate|sync/i })).toHaveCount(0);
    await citation.screenshot({ path: test.info().outputPath('preview-company-a-citation.png') });

    await selection.selectOption(b.id);
    await expect(page.getByText('$800.00', { exact: true })).toHaveCount(0);
    await expect(citation).toHaveCount(0);
    await page.getByText('Source contracts', { exact: true }).click();
    await expect(page.getByText(/Fields.*\bamount_minor\b/).first()).toBeVisible();
    const previewB = apiResponse(page, '/api/connectors/preview', 'POST');
    await run.click();
    const responseB = await previewB;
    expect(responseB.status()).toBe(200);
    await expectBrowserMutation(responseB, origin);
    expect(responseB.request().postDataJSON()).toEqual(b.request);
    const resultB = PreviewResponseSchema.parse(await responseB.json());
    expect(resultB.diffs).toEqual([expect.objectContaining({ scope: b.scope, afterBalanceCents: 0 })]);
    const held = resultB.unsupportedRows.flatMap(row => row.eventIds).find(id => id.startsWith('evt:pay-b:unresolved-'));
    expect(Boolean(held)).toBe(true);
    const balanceB = page.getByRole('region', { name: 'Balance diff for ' + b.scope.accountId });
    await expect(balanceB.getByText('$0.00').last()).toBeVisible();
    await balanceB.screenshot({ path: test.info().outputPath('preview-company-b-balance.png') });
    const remittance = unsupported.getByText('Source events ' + held, { exact: true });
    await expect(remittance).toBeVisible();
    const remittanceRow = remittance.locator('..');
    await expect(remittanceRow.getByText('Blocker · UNKNOWN_ACCOUNT', { exact: true })).toBeVisible();
    await expect(remittanceRow.getByText('Source account has no approved identity', { exact: true })).toBeVisible();
    await remittance.locator('..').screenshot({ path: test.info().outputPath('preview-company-b-hold.png') });

    const missingCsrf = await page.evaluate(async body => {
      const response = await fetch('/api/connectors/preview', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body,
      });
      return response.status;
    }, JSON.stringify(b.request));
    expect(missingCsrf).toBe(403);

    // Lose the HttpOnly cookie and exercise the real 401, followed by automatic bootstrap.
    // The original preview must remain failed until an explicit second click.
    await page.context().clearCookies();
    const previewCalls: number[] = [];
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/connectors/preview') previewCalls.push(response.status());
    });
    const denied = apiResponse(page, '/api/connectors/preview', 'POST');
    const replacementSession = apiResponse(page, '/api/local-session', 'POST');
    await run.click();
    expect((await denied).status()).toBe(401);
    const replacement = await replacementSession;
    expect(replacement.status()).toBe(200);
    await expectBrowserMutation(replacement, origin, { bootstrap: true });
    await expect(page.getByRole('alert')).toContainText('Demo reviewer session required.');
    await expect(page.getByRole('region', { name: 'Preview result' })).toHaveCount(0);
    expect(previewCalls).toEqual([401]);
    const retry = apiResponse(page, '/api/connectors/preview', 'POST');
    await run.click();
    expect((await retry).status()).toBe(200);
    await expect(page.getByRole('region', { name: 'Preview result' })).toBeVisible();
    expect(previewCalls).toEqual([401, 200]);
    expect(await runtimeState()).toEqual(before);
  } finally {
    await close();
  }
});
