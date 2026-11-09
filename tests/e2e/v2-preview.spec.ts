import { expect, test } from '@playwright/test';
import { DemoCandidatesResponseSchema, PreviewResponseSchema, SourceCoverageResponseSchema } from '@eapr/contracts';
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
    expect(catalog).toMatchObject({ targetMode: 'persisted-parent', verificationAvailable: false });
    expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(['company-a', 'company-b']);
    const [a, b] = catalog.candidates;
    const selection = page.getByLabel('Development candidate');
    const run = page.getByRole('button', { name: 'Run preview' });

    const readCoverage = (companyId: string) => apiResponse(page, '/api/sources/' + companyId + '/coverage');
    const coverageRegion = page.getByRole('region', { name: 'Captured source coverage' });
    const coverageARequest = readCoverage(a.companyId);
    await selection.selectOption(a.id);
    await expect(page.getByText('Development fixture · parent records', { exact: true })).toBeVisible();
    const coverageAResponse = await coverageARequest;
    expect(coverageAResponse.status()).toBe(200);
    const coverageA = SourceCoverageResponseSchema.parse(await coverageAResponse.json());
    expect(coverageA.snapshot.id).toBe(a.snapshotId);
    await expect(page.getByText('This preview covers one customer from the company snapshot.', { exact: true })).toBeVisible();
    await expect(coverageRegion.getByText('30 captured events', { exact: true })).toBeVisible();
    await expect(coverageRegion.getByText('11 selected-profile events', { exact: true })).toBeVisible();
    await expect(coverageRegion.getByText('19 outside-profile events', { exact: true })).toBeVisible();
    await expect(coverageRegion.getByText(/18 financial events · 1 source-change event/)).toBeVisible();
    const candidateA = page.getByRole('heading', { name: a.label, exact: true }).locator('..');
    await expect(candidateA.getByText(a.scope.sellerEntityId, { exact: true })).toBeVisible();
    await expect(candidateA.getByText(a.scope.accountId, { exact: true })).toBeVisible();
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
    const owedA = balanceA.locator('dt:text-is("Amount still owed after proposed import") + dd > span');
    await expect(owedA).toBeVisible();
    await expect(owedA).toHaveText('$800.00');
    await expect(balanceA.getByText(`Unpaid invoice amount as of ${a.request.asOf}`, { exact: false })).toBeVisible();
    await expect(balanceA.getByText('Target balance before proposed import', { exact: true })).toBeVisible();
    await expect(balanceA.getByText(/The demo target starts empty/)).toHaveCount(0);
    await expect(page.getByText('Preview only. No records have been imported.', { exact: true })).toBeVisible();
    await balanceA.screenshot({ path: test.info().outputPath('preview-company-a-balance.png') });
    await expect(page.getByText('Parent writes: 0', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '11 proposed imports of existing records' })).toBeVisible();
    expect(resultA.outcome.holds).toHaveLength(19);
    await page.getByText('Artifact details', { exact: true }).click();
    await expect(page.getByText(resultA.artifact!.hash, { exact: true })).toBeVisible();
    const excluded = page.getByRole('heading', { name: "Records not included in this customer's preview", exact: true }).locator('..');
    const otherAccounts = excluded.getByRole('heading', { name: 'Other accounts needing connectors', exact: true }).locator('..');
    const investigation = excluded.getByRole('heading', { name: 'Records needing investigation', exact: true }).locator('..');
    await expect(otherAccounts.getByText('19 hold entries affecting 19 distinct source events', { exact: true })).toBeVisible();
    await expect(investigation).toHaveCount(0);
    await expect(excluded.getByText(/Others need investigation/)).toHaveCount(0);
    await excluded.getByText('Technical hold details', { exact: true }).click();
    await expect(excluded.getByText(/19 matching entries shown once/)).toBeVisible();
    const unscopedA = resultA.unsupportedRows.find(row => !row.scope && row.code === 'UNKNOWN_ACCOUNT');
    expect(unscopedA).toBeDefined();
    const aHoldDetails = otherAccounts.locator('details').filter({
      hasText: 'Source events ' + unscopedA!.eventIds.join(', '),
    });
    await aHoldDetails.locator('summary').click();
    await expect(aHoldDetails.getByText('Source events ' + unscopedA!.eventIds.join(', '), { exact: true })).toBeVisible();
    await excluded.screenshot({ path: test.info().outputPath('preview-company-a-scope.png') });
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

    const otherA = coverageA.accounts.filter(account => !a.request.profiles.some(profile =>
      profile.scope.sellerEntityId === account.sellerEntityId && profile.sourceAccountIds.includes(account.sourceAccountId)));
    expect(otherA).toHaveLength(2);
    expect(otherA[0]!.displayName).toBe(otherA[1]!.displayName);
    const related = coverageRegion.getByRole('article', { name: 'Evidence citation' });
    for (const [index, account] of otherA.entries()) {
      const row = coverageRegion.getByRole('article', { name: 'Source account ' + account.sourceAccountId });
      await expect(row.getByText(`${[10, 9][index]} captured events`, { exact: true })).toBeVisible();
      await expect(row.getByText(account.sourceBuyerId, { exact: true })).toBeVisible();
      await expect(row.getByText('No profile in this candidate. Separate construction and verification needed.')).toBeVisible();
      await row.getByRole('button', { name: /^Identity citation/ }).first().click();
      await expect(related.getByRole('heading', { name: account.identityEvidenceRefs[0], exact: true })).toBeVisible();
      await expect(related.locator('mark')).toContainText(account.sourceBuyerId);
      await expect(related.locator('mark')).toContainText(account.sourceAccountId);
    }
    const amendmentAccount = otherA.find(account => account.relatedEvidenceRefs.length > 0)!;
    const amendmentRow = coverageRegion.getByRole('article', { name: 'Source account ' + amendmentAccount.sourceAccountId });
    let amendmentVisible = false;
    for (const [index, evidenceId] of amendmentAccount.relatedEvidenceRefs.entries()) {
      await amendmentRow.getByRole('button', { name: /^Related citation/ }).nth(index).click();
      await expect(related.getByRole('heading', { name: evidenceId, exact: true })).toBeVisible();
      amendmentVisible ||= (await related.locator('mark').innerText()).startsWith('Executed amendment to ');
    }
    expect(amendmentVisible).toBe(true);
    await expect(amendmentRow.getByText(/Amendments require separate terms review/)).toBeVisible();
    await expect(page.getByText(/Live agent construction is pending/)).toBeVisible();
    await expect(page.getByRole('button', { name: /start discovery|approve|enable|activate|sync/i })).toHaveCount(0);

    const coverageBRequest = readCoverage(b.companyId);
    await selection.selectOption(b.id);
    const coverageBResponse = await coverageBRequest;
    expect(coverageBResponse.status()).toBe(200);
    const coverageB = SourceCoverageResponseSchema.parse(await coverageBResponse.json());
    expect(coverageB.snapshot.id).toBe(b.snapshotId);
    await expect(coverageRegion.getByText('28 captured events', { exact: true })).toBeVisible();
    await expect(coverageRegion.getByText('9 selected-profile events', { exact: true })).toBeVisible();
    await expect(coverageRegion.getByText('19 outside-profile events', { exact: true })).toBeVisible();
    await expect(coverageRegion.getByText(/18 documented · 1 unresolved/)).toBeVisible();
    const unresolved = coverageRegion.getByRole('heading', { name: 'Source identity unresolved' }).locator('..');
    await expect(unresolved.getByText('payment 1', { exact: true })).toBeVisible();
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
    const owedB = balanceB.locator('dt:text-is("Amount still owed after proposed import") + dd > span');
    await expect(owedB).toBeVisible();
    await expect(owedB).toHaveText('$0.00');
    await balanceB.screenshot({ path: test.info().outputPath('preview-company-b-balance.png') });
    expect(resultB.parentWrites).toBe(0);
    await expect(otherAccounts.getByText('18 hold entries affecting 18 distinct source events', { exact: true })).toBeVisible();
    await expect(investigation.getByText('1 hold entry affecting 1 distinct source event', { exact: true })).toBeVisible();
    await expect(otherAccounts.locator('details').filter({ hasText: 'Source events ' + held })).toHaveCount(0);
    const remittanceRow = investigation.locator('details').filter({ hasText: 'Source events ' + held });
    await remittanceRow.locator('summary').click();
    await expect(remittanceRow.getByText('Source events ' + held, { exact: true })).toBeVisible();
    await expect(remittanceRow.getByText('Blocker · UNKNOWN_ACCOUNT', { exact: true })).toBeVisible();
    await expect(remittanceRow.getByText('Source account has no approved identity', { exact: true })).toBeVisible();
    await investigation.screenshot({ path: test.info().outputPath('preview-company-b-hold.png') });

    // Hold a real A response in transit while switching to B. Supply a deliberately
    // misbound B response once to exercise rejection of an otherwise valid wire shape.
    const coverageAPath = '/api/sources/' + a.companyId + '/coverage';
    const coverageBPath = '/api/sources/' + b.companyId + '/coverage';
    const delayed = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const aborted = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname === coverageAPath);
    await page.route('**' + coverageAPath + '?*', async route => {
      const response = await route.fetch();
      delayed.resolve(response.status());
      await release.promise;
      try {
        await route.fulfill({ response });
      } catch (failure) {
        // Chromium may already have canceled the paused route. Assert the abort below.
        if (!(failure instanceof Error) || !failure.message.includes('Route is already handled!')) throw failure;
      }
    }, { times: 1 });
    try {
      await selection.selectOption(a.id);
      expect(await delayed.promise).toBe(200);
      await expect(coverageRegion.getByText('Loading captured source coverage…')).toBeVisible();
      await page.route('**' + coverageBPath + '?*', async route => {
        const response = await route.fetch();
        const coverage = SourceCoverageResponseSchema.parse(await response.json());
        expect(response.status()).toBe(200);
        const sourceRef = 'unexpected-source';
        await route.fulfill({ response, json: { ...coverage, sourceRef, snapshot: { ...coverage.snapshot, sourceRef } } });
      }, { times: 1 });
      await selection.selectOption(b.id);
      await expect(coverageRegion.getByText('Source-account explanation unavailable', { exact: true })).toBeVisible();
      await expect(coverageRegion.getByRole('alert')).toContainText('Source coverage did not match the selected candidate source.');
    } finally {
      release.resolve();
    }
    expect((await aborted).failure()?.errorText).toBe('net::ERR_ABORTED');
    await expect(coverageRegion.getByText('30 captured events', { exact: true })).toHaveCount(0);
    await expect(coverageRegion.getByText('Source-account explanation unavailable', { exact: true })).toBeVisible();
    const fallbackPreview = apiResponse(page, '/api/connectors/preview', 'POST');
    await run.click();
    expect((await fallbackPreview).status()).toBe(200);
    await expect(owedB).toBeVisible();
    await expect(owedB).toHaveText('$0.00');
    await expect(investigation.getByText(
      'Records not mapped by these profiles. Source-account ownership has not been established for this explanation.',
      { exact: true },
    )).toBeVisible();
    await expect(otherAccounts).toHaveCount(0);
    const recovery = readCoverage(b.companyId);
    await coverageRegion.getByRole('button', { name: 'Retry source coverage' }).click();
    expect((await recovery).status()).toBe(200);
    await expect(coverageRegion.getByText('28 captured events', { exact: true })).toBeVisible();
    await expect(otherAccounts.getByText('18 hold entries affecting 18 distinct source events', { exact: true })).toBeVisible();
    await expect(owedB).toBeVisible();
    await expect(owedB).toHaveText('$0.00');

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
