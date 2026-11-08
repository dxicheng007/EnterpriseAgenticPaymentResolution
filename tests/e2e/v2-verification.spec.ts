import { writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { expect, test, type Response } from '@playwright/test';
import {
  DemoCandidatesResponseSchema, PreviewResponseSchema, VerificationCheckIdSchema,
  VerificationJobSchema, VerifyRequestSchema,
} from '@eapr/contracts';
import { readManifest } from '@eapr/sources';
import { publishActivity } from '@eapr/storage/activity';
import { withTransaction } from '@eapr/storage/transaction';
import { apiResponse, expectBrowserMutation, openLocalReview, startReview } from './support/local-review.js';

test.use({ trace: 'off', video: 'off' });

const testName = 'verifies both captured companies through the real protected evaluator and renders bound summaries';

test(testName, async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const options = { verification: true };
  const { origin, system, close } = await openLocalReview(options);
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
    const catalog = DemoCandidatesResponseSchema.parse(await catalogResponse.json());
    expect(catalog.verificationAvailable).toBe(true);
    expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(['company-a', 'company-b']);

    const region = page.getByRole('region', { name: 'Independent verification' });
    const prompt = page.getByText('Run a preview with a compiled artifact to request verification.', { exact: true });
    const restrictedControls = page.getByRole('button', { name: /approve|activate|sync/i });
    await expect(restrictedControls).toHaveCount(0);

    const results = [];
    for (const candidate of catalog.candidates) {
      await page.getByLabel('Development candidate').selectOption(candidate.id);
      await expect(region).toHaveCount(0);
      await expect(prompt).toBeVisible();
      const previewWaiting = apiResponse(page, '/api/connectors/preview', 'POST');
      await page.getByRole('button', { name: 'Run preview' }).click();
      const previewResponse = await previewWaiting;
      expect(previewResponse.status()).toBe(200);
      await expectBrowserMutation(previewResponse, origin);
      expect(isDeepStrictEqual(previewResponse.request().postDataJSON(), candidate.request)).toBe(true);
      const preview = PreviewResponseSchema.parse(await previewResponse.json());
      expect(preview.parentWrites).toBe(0);
      await expect(page.getByText('Parent writes: 0', { exact: true })).toBeVisible();
      const { artifact } = preview;
      if (!artifact) throw new Error('Preview did not compile an artifact');
      const profileHashes = candidate.request.profiles.map(profile => profile.hash).sort();
      expect(artifact.requiredProfileHashes).toEqual(profileHashes);
      const manifestId = candidate.snapshotId.slice('snapshot:'.length);
      expect(candidate.snapshotId).toBe('snapshot:' + manifestId);
      const manifest = await readManifest(system.db.control, candidate.companyId, manifestId);

      const observed: Response[] = [];
      const observeStatus = (response: Response) => {
        if (response.request().method() === 'GET' &&
            new URL(response.url()).pathname.startsWith('/api/verification-jobs/')) observed.push(response);
      };
      page.on('response', observeStatus);
      let job;
      try {
        const verifyPath = '/api/connectors/' + encodeURIComponent(candidate.request.spec.id) + '/verify';
        const verifyWaiting = apiResponse(page, verifyPath, 'POST');
        await page.getByRole('button', { name: 'Verify artifact' }).click();
        const verifyResponse = await verifyWaiting;
        expect(verifyResponse.ok()).toBe(true);
        await expectBrowserMutation(verifyResponse, origin);
        expect(VerifyRequestSchema.parse(verifyResponse.request().postDataJSON())).toEqual({
          artifactHash: artifact.hash, profileHashes, manifestId: manifest.id,
        });
        job = VerificationJobSchema.parse(await verifyResponse.json());
        const jobId = job.jobId;
        const statusPath = '/api/verification-jobs/' + encodeURIComponent(jobId);
        const refresh = page.getByRole('button', { name: 'Refresh verification status' });
        if (job.state === 'queued' || job.state === 'running') {
          await expect.poll(async () => {
            for (const response of observed.splice(0)) {
              expect(new URL(response.url()).pathname).toBe(statusPath);
              expect(response.status()).toBe(200);
              job = VerificationJobSchema.parse(await response.json());
              expect(job.jobId).toBe(jobId);
            }
            if ((job!.state === 'queued' || job!.state === 'running') && await refresh.isVisible()) {
              await refresh.click();
            }
            return job!.state === 'completed' || job!.state === 'failed';
          }, { timeout: 60_000 }).toBe(true);
        }
      } finally {
        page.off('response', observeStatus);
      }
      expect(job.state).toBe('completed');
      const { summary } = job;
      if (!summary) throw new Error('Completed verification had no summary');
      expect(summary.artifactHash).toBe(artifact.hash);
      expect(summary.profileHashes).toEqual(profileHashes);
      expect(summary.manifestHash).toBe(manifest.hash);
      for (const previous of results) {
        expect(job.jobId).not.toBe(previous.jobId);
        expect(summary.reportId).not.toBe(previous.reportId);
        expect(summary.artifactHash).not.toBe(previous.artifactHash);
      }
      await expect(region.getByText('Job ' + job.jobId + ' · completed', { exact: true })).toBeVisible();
      await expect(region.getByText('Report ' + summary.reportId + ' · Manifest ' + summary.manifestHash, {
        exact: true,
      })).toBeVisible();
      const ids = VerificationCheckIdSchema.options;
      expect(summary.checks.map(check => check.id).sort()).toEqual([...ids].sort());
      await expect(region.getByRole('row')).toHaveCount(ids.length + 1);
      const labels = { passed: 'Passed', failed: 'Failed', unavailable: 'Unavailable' };
      const counts = { passed: 0, failed: 0, unavailable: 0 };
      for (const check of summary.checks) {
        const row = region.getByRole('row').filter({
          has: page.getByRole('rowheader', { name: check.id.replaceAll('_', ' '), exact: true }),
        });
        await expect(row.getByRole('cell')).toHaveText([
          labels[check.status], check.diagnosticCodes.join(', ') || '—',
        ]);
        counts[check.status]++;
      }
      expect(summary.checks.find(check => check.id === 'baseline_reconcile')?.status).toBe('passed');
      expect(counts.failed).toBe(0);
      const complete = summary.coverageComplete && ids.every(id =>
        summary.checks.some(check => check.id === id && check.status !== 'unavailable'));
      const eligible = complete && summary.eligible && ids.every(id =>
        summary.checks.some(check => check.id === id && check.status === 'passed'));
      await expect(region.getByText(complete ? 'Mandatory coverage complete' : 'Mandatory coverage incomplete', {
        exact: true,
      })).toBeVisible();
      await expect(region.getByText(eligible ? 'Eligible for review' : 'Eligibility not established', {
        exact: true,
      })).toBeVisible();
      if (counts.unavailable > 0) {
        expect(summary.eligible).toBe(false);
        await expect(region.getByText('Eligible for review', { exact: true })).toHaveCount(0);
      }
      await expect(restrictedControls).toHaveCount(0);
      await region.screenshot({ path: testInfo.outputPath('verification-' + candidate.companyId + '.png') });
      results.push({
        companyId: candidate.companyId, jobId: job.jobId, state: job.state, reportId: summary.reportId,
        artifactHash: summary.artifactHash, profileHashes: summary.profileHashes, manifestHash: summary.manifestHash,
        checks: summary.checks.map(({ id, status, diagnosticCodes }) => ({ id, status, diagnosticCodes })),
        counts, coverageComplete: summary.coverageComplete, eligible: summary.eligible,
      });
    }

    expect(await runtimeState()).toEqual(before);
    await writeFile(testInfo.outputPath('verification-browser-results.json'), JSON.stringify({
      test: testName,
      assertions: { runtimeUnchanged: true, parentWritesZero: true, summariesBound: true, rowsMatch: true },
      companies: results,
    }, null, 2) + '\n');
  } finally {
    await close();
  }
});
