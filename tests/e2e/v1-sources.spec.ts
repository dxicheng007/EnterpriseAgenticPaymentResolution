import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  BootstrapManifestSchema, EvidenceResponseSchema, UploadResponseSchema, hashBytes, hashManifest,
  type UploadMetadata,
} from '@eapr/contracts';
import { createSourceService, publishManifest, readDossier, readEvidence, readManifest, sourceFileId } from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { textPdf } from '../../packages/sources/src/canonical-fixtures.js';
import { apiResponse, expectBrowserMutation, openLocalReview, startReview } from './support/local-review.js';

// Network traces include the live cookie and CSRF value. Screenshots preserve the visible evidence.
test.use({ trace: 'off' });

async function expectCitation(page: Page, origin: string, id: string, originalBytes: Buffer) {
  const waiting = apiResponse(page, '/api/evidence/' + encodeURIComponent(id));
  await page.getByRole('combobox', { name: 'Evidence citation', exact: true }).selectOption(id);
  const response = await waiting;
  expect(response.status()).toBe(200);
  const data = EvidenceResponseSchema.parse(await response.json());
  const article = page.getByRole('article', { name: 'Evidence citation' });
  await expect(article.locator('mark')).toHaveText(data.evidence.excerpt);
  await expect(article.getByText(data.evidence.snapshotId, { exact: true })).toBeVisible();
  await expect(article.getByText(data.evidence.sourceId, { exact: true })).toBeVisible();
  await expect(article.getByText(hashBytes(originalBytes), { exact: true })).toBeVisible();
  const link = article.getByRole('link', { name: /open original/i });
  const locator = data.evidence.locator;
  await expect(link).toHaveAttribute('href', data.original.url + (locator.kind === 'pdf' ? '#page=' + locator.page : ''));
  const original = await page.request.get(origin + data.original.url);
  expect(original.status()).toBe(200);
  expect((await original.headers())['content-type']).toContain(data.mediaType);
  expect(await original.body()).toEqual(originalBytes);
  expect(data.original.sha256).toBe(hashBytes(originalBytes));
  return data;
}

test('stores immutable uploads and opens exact originals only after a complete source capture', async ({ page }) => {
  const { origin, system, store, visibleRoot, close } = await openLocalReview();
  try {
    const db = system.db.control;
    const clock = () => new Date('2026-11-08T00:00:00.000Z');
    const dependencies = { db, clock, store };
    const source = createSourceService(dependencies, localSourceCatalog);
    const base = await readManifest(db, 'company-a');
    const other = await readManifest(db, 'company-b');
    const excerpt = 'Browser capture document';
    const bytes = Buffer.from(await textPdf([excerpt], base.asOf, 'Browser capture evidence'));
    const metadata: UploadMetadata = {
      companyId: 'company-a', sourceRef: 'legacy-a', kind: 'contract_pdf',
      documentId: 'browser-contract', documentVersion: 1, originalName: 'browser-contract.pdf',
    };
    const fileId = sourceFileId(metadata);
    const id = 'manifest-a-browser-pending';
    const manifestInput = {
      ...base, id, epoch: base.epoch + 1,
      streams: base.streams.map(member => ({ ...member, snapshotId: id + ':' + member.streamId })),
      files: [...base.files, {
        fileId, documentId: metadata.documentId, documentVersion: metadata.documentVersion, sha256: hashBytes(bytes),
        kind: metadata.kind,
      }],
    };
    const manifest = BootstrapManifestSchema.parse({ ...manifestInput, hash: hashManifest(manifestInput) });
    await publishManifest(dependencies, localSourceCatalog, manifest, []);
    expect(await source.captureSnapshot(id)).toMatchObject({ ok: false, dossier: { missingMembers: [fileId], evidenceIds: [] } });

    await startReview(page, origin, 'sources');
    const company = page.getByLabel('Demo company');
    await company.selectOption('company-a');
    const dossier = page.getByRole('heading', { name: 'Company A dossier' }).locator('..');
    await expect(dossier.getByText(id, { exact: true })).toBeVisible();
    await expect(dossier.getByText('Incomplete', { exact: true })).toBeVisible();
    await expect(dossier.getByText(fileId, { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Evidence citation', exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('source-incomplete.png'), fullPage: true });

    const counts = async () => Promise.all(['source_files', 'source_evidence'].map(table =>
      db.query('SELECT count(*)::int AS count FROM ' + table).then(result => result.rows[0].count as number)));
    const before = await counts();
    const upload = page.getByRole('button', { name: 'Store file' });
    await page.getByLabel('Document ID', { exact: true }).fill(metadata.documentId);
    await page.getByLabel('Source file').setInputFiles({ name: metadata.originalName, mimeType: 'application/pdf', buffer: bytes });
    for (const expected of [201, 200]) {
      const waiting = apiResponse(page, '/api/sources/uploads', 'POST');
      await upload.click();
      const response = await waiting;
      expect(response.status()).toBe(expected);
      await expectBrowserMutation(response, origin);
      expect(UploadResponseSchema.parse(await response.json())).toMatchObject({
        duplicate: expected === 200, evidenceIds: [], contentHash: hashBytes(bytes), fileId,
      });
      await expect(page.getByText(expected === 200
        ? 'Exact duplicate already stored. Waiting for a complete capture.'
        : 'File stored. Waiting for a complete capture.')).toBeVisible();
      expect(await counts()).toEqual([before[0] + 1, before[1]]);
    }

    const changed = Buffer.from(await textPdf(['Changed version content'], base.asOf, 'Conflicting bytes'));
    await page.getByLabel('Source file').setInputFiles({ name: metadata.originalName, mimeType: 'application/pdf', buffer: changed });
    const conflict = apiResponse(page, '/api/sources/uploads', 'POST');
    await upload.click();
    expect((await conflict).status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText('conflicts');
    expect(await counts()).toEqual([before[0] + 1, before[1]]);

    await page.getByRole('button', { name: 'Refresh dossier' }).click();
    await expect(dossier.getByText('Incomplete', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Evidence citation', exact: true })).toHaveCount(0);

    const completed = await source.captureSnapshot(id);
    if (!completed.ok) throw new Error('The uploaded member did not complete the capture');
    const refs = await Promise.all(completed.dossier.evidenceIds.map(item => readEvidence(db, item, async () => {})));
    const pdf = refs.find(item => item.evidence.sourceId === fileId)!;
    expect(pdf.evidence).toMatchObject({ excerpt, locator: { kind: 'pdf', page: 1 } });
    await page.getByRole('button', { name: 'Refresh dossier' }).click();
    await expect(dossier.getByText('Complete', { exact: true })).toBeVisible();
    const opened = await expectCitation(page, origin, pdf.evidence.id, bytes);
    expect(opened.evidence.excerpt).toBe(excerpt);
    await expect(page.getByText(/PDF page 1/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('source-complete-pdf.png'), fullPage: true });

    const json = refs.find(item => item.evidence.locator.kind === 'json')!;
    await expectCitation(page, origin, json.evidence.id, await store.get(json.original.sha256));
    await expect(page.getByText(/JSON pointer/)).toBeVisible();
    const email = refs.find(item => item.evidence.locator.kind === 'email')!;
    await expectCitation(page, origin, email.evidence.id, await readFile(join(visibleRoot, 'account-directory.json')));
    await expect(page.getByText(/Email .*offsets/)).toBeVisible();

    await company.selectOption('company-b');
    await expect(page.getByRole('article', { name: 'Evidence citation' })).toHaveCount(0);
    const bDossier = await readDossier(db, 'company-b', other.id);
    const bRefs = await Promise.all(bDossier.evidenceIds.map(item => readEvidence(db, item, async () => {})));
    const csvBytes = await readFile(join(visibleRoot, 'b-batch-1.csv'));
    const csv = bRefs.find(item => item.evidence.locator.kind === 'csv' && item.original.sha256 === hashBytes(csvBytes))!;
    await expectCitation(page, origin, csv.evidence.id, csvBytes);
    await expect(page.getByText(/CSV data row .*column payload_json/)).toBeVisible();

    await page.getByLabel('Manifest ID (optional)').fill(id);
    await page.getByRole('button', { name: 'Refresh dossier' }).click();
    await expect(page.getByRole('alert')).toContainText('requested record is unavailable');
    await expect(page.getByRole('article', { name: 'Evidence citation' })).toHaveCount(0);
    expect((await page.request.get(origin + csv.original.url, {
      headers: { Authorization: 'Bearer forged-test-token' },
    })).status()).toBe(403);
    await page.context().clearCookies();
    expect((await page.request.get(origin + csv.original.url)).status()).toBe(401);
  } finally {
    await close();
  }
});
