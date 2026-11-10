/**
 * V7 demo browser harness: deterministic construction-fixture wiring for the
 * two-company local demo. Full live rehearsals and joint G7 remain pending;
 * this proves both acquisitions surface on Sources and Preview without a live
 * provider or claiming acceptance.
 */
import { expect, test } from '@playwright/test';
import { DemoCandidatesResponseSchema, PreviewResponseSchema } from '@eapr/contracts';
import { apiResponse, expectBrowserMutation, openLocalReview, startReview } from './support/local-review.js';

test.use({ trace: 'off' });

test('deterministic fixture wires both demo companies on sources and preview', async ({ page, browser }) => {
  const { origin, close } = await openLocalReview();
  try {
    await test.info().attach('browser-version', { body: browser.version(), contentType: 'text/plain' });

    await startReview(page, origin, 'sources');
    await expect(page.getByRole('heading', { name: 'Sources and evidence', exact: true })).toBeVisible();
    const company = page.getByLabel('Demo company');
    await company.selectOption('company-a');
    await expect(page.getByText('Source scope')).toBeVisible();
    await expect(page.getByText('company-a', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('legacy-a', { exact: true }).first()).toBeVisible();
    await company.selectOption('company-b');
    await expect(page.getByText('company-b', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('legacy-b', { exact: true }).first()).toBeVisible();

    const catalogWaiting = apiResponse(page, '/api/demo/candidates');
    await page.goto(origin + '/#preview');
    const catalogResponse = await catalogWaiting;
    expect(catalogResponse.status()).toBe(200);
    const catalog = DemoCandidatesResponseSchema.parse(await catalogResponse.json());
    expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(['company-a', 'company-b']);
    const [a, b] = catalog.candidates;
    expect(a.id).not.toBe(b.id);

    const selection = page.getByLabel('Development candidate');
    const run = page.getByRole('button', { name: 'Run preview' });

    await selection.selectOption(a.id);
    await expect(page.getByText('Development fixture · parent records', { exact: true })).toBeVisible();
    const previewA = apiResponse(page, '/api/connectors/preview', 'POST');
    await run.click();
    const responseA = await previewA;
    expect(responseA.status()).toBe(200);
    await expectBrowserMutation(responseA, origin);
    const resultA = PreviewResponseSchema.parse(await responseA.json());
    expect(resultA.parentWrites).toBe(0);
    await expect(page.getByText('Preview only. No records have been imported.', { exact: true })).toBeVisible();
    await expect(page.getByText('Parent writes: 0', { exact: true })).toBeVisible();

    await selection.selectOption(b.id);
    await expect(page.getByText('Development fixture · parent records', { exact: true })).toBeVisible();
    const previewB = apiResponse(page, '/api/connectors/preview', 'POST');
    await run.click();
    const responseB = await previewB;
    expect(responseB.status()).toBe(200);
    await expectBrowserMutation(responseB, origin);
    const resultB = PreviewResponseSchema.parse(await responseB.json());
    expect(resultB.parentWrites).toBe(0);
    expect(resultB.diffs).not.toEqual(resultA.diffs);
    await expect(page.getByText('Preview only. No records have been imported.', { exact: true })).toBeVisible();
    await expect(page.getByText('Parent writes: 0', { exact: true })).toBeVisible();
  } finally {
    await page.close();
    await close();
  }
});
