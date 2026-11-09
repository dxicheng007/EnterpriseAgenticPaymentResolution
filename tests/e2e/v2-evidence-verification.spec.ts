import { writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { expect, test, type Page, type Response } from '@playwright/test';
import {
  DemoCandidatesResponseSchema, LocalSessionResponseSchema, PreviewResponseSchema, VerificationJobSchema,
  VerificationReportSchema, VerifyRequestSchema, hashArtifact, hashProfile,
} from '@eapr/contracts';
import { readManifest } from '@eapr/sources';
import { escapeIdentifier, type Pool } from 'pg';
import type { ZodType } from 'zod';
import { apiResponse, expectBrowserMutation, openLocalReview, startReview } from './support/local-review.js';

test.use({ trace: 'off', video: 'off' });

const title = 'verifies both captured companies with v2 evidence and all thirteen checks without parent writes';
const mandatoryIds = [
  'baseline_reconcile', 'new_record', 'duplicate_delivery', 'retry_restart', 'invalid_money', 'allocation_scope',
  'full_reversal', 'dependency_order', 'schema_drift', 'semantic_drift', 'unknown_identity', 'snapshot_boundary',
  'evidence_support',
].sort();
const companyIds = ['company-a', 'company-b'];

function safeParse<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(label + ' did not match the required schema');
  return result.data;
}

async function readPublic<T>(response: Response, schema: ZodType<T>, label: string, bodies: string[]) {
  try {
    const text = await response.text();
    bodies.push(text);
    return safeParse(schema, JSON.parse(text), label);
  } catch {
    throw new Error(label + ' did not match the public response schema');
  }
}

async function runtimeState(db: Pool) {
  const { rows: tables } = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const rows = await Promise.all(tables.map(({ tablename }) => db.query(
    'SELECT to_jsonb(t) AS row FROM public.' + escapeIdentifier(tablename) + ' AS t ORDER BY to_jsonb(t)',
  ).then(result => result.rows)));
  return { tables, rows };
}

async function verifyInBrowser(page: Page, origin: string, connectorId: string,
  subject: { artifactHash: string; profileHashes: string[]; manifestId: string }, bodies: string[]) {
  const observed: Response[] = [];
  const observe = (response: Response) => {
    if (response.request().method() === 'GET' &&
      new URL(response.url()).pathname.startsWith('/api/verification-jobs/')) observed.push(response);
  };
  page.on('response', observe);
  try {
    const waiting = apiResponse(page, '/api/connectors/' + encodeURIComponent(connectorId) + '/verify', 'POST');
    await page.getByRole('button', { name: 'Verify artifact' }).click();
    const response = await waiting;
    expect(response.status()).toBe(202);
    await expectBrowserMutation(response, origin);
    expect(isDeepStrictEqual(response.request().postDataJSON(), subject)).toBe(true);
    safeParse(VerifyRequestSchema, response.request().postDataJSON(), 'Verification request');
    let job = await readPublic(response, VerificationJobSchema, 'Submitted job', bodies);
    const jobId = job.jobId;
    expect((job.state === 'queued' || job.state === 'running') && job.diagnostics.length === 0).toBe(true);
    const statusPath = '/api/verification-jobs/' + encodeURIComponent(jobId);
    const refresh = page.getByRole('button', { name: 'Refresh verification status' });
    let reads = 0;
    await expect.poll(async () => {
      for (const status of observed.splice(0)) {
        expect(new URL(status.url()).pathname === statusPath).toBe(true);
        expect(status.status()).toBe(200);
        const headers = await status.request().allHeaders();
        expect(Boolean(headers.cookie) && !('authorization' in headers)).toBe(true);
        job = await readPublic(status, VerificationJobSchema, 'Polled job', bodies);
        expect(job.jobId === jobId).toBe(true);
        reads++;
        if (job.state === 'failed') return true;
        expect(job.diagnostics.length).toBe(0);
        if (job.state === 'completed') return true;
      }
      if (await refresh.isVisible()) await refresh.click();
      return false;
    }, { timeout: 120_000 }).toBe(true);
    expect(reads).toBeGreaterThan(0);
    expect(job.state).toBe('completed');
    if (!job.summary) throw new Error('Completed job did not return a summary');
    return { jobId, state: job.state, summary: job.summary };
  } finally {
    page.off('response', observe);
  }
}

test(title, async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const { origin, system, close, assertPrivateBoundary } = await openLocalReview({ verification: 'evidence-v2' });
  const bodies: string[] = [];
  const modules: Response[] = [];
  const observeModules = (response: Response) => {
    if (new URL(response.url()).origin === origin && response.request().resourceType() === 'script') modules.push(response);
  };
  page.on('response', observeModules);
  const screenshots = new Map<string, Buffer>();
  const companies = [];
  let activationRequest = false;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/^\/(?:api|internal)\//.test(path) && /(?:^|[/-])(?:approv\w*|activat\w*|sync\w*|import\w*|receipts?)(?:[/-]|$)/i.test(path)) {
      activationRequest = true;
    }
  });
  try {
    const before = await runtimeState(system.db.runtime);
    expect(before.tables.map(table => table.tablename)).toEqual(expect.arrayContaining([
      'migration_ledger', 'seed_ledger', 'activity_counter', 'activity_events',
    ]));
    const bootstrapWaiting = apiResponse(page, '/api/local-session', 'POST');
    const catalogWaiting = apiResponse(page, '/api/demo/candidates');
    await startReview(page, origin, 'preview');
    await readPublic(await bootstrapWaiting, LocalSessionResponseSchema, 'Local session', bodies);
    const catalogResponse = await catalogWaiting;
    expect(catalogResponse.status()).toBe(200);
    const catalogHeaders = await catalogResponse.request().allHeaders();
    expect(Boolean(catalogHeaders.cookie) && !('authorization' in catalogHeaders)).toBe(true);
    const catalog = await readPublic(catalogResponse, DemoCandidatesResponseSchema, 'Development catalog', bodies);
    expect(catalog.mode === 'development-fixture' && catalog.targetMode === 'empty-fixture' && catalog.verificationAvailable).toBe(true);
    expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(companyIds);

    const region = page.getByRole('region', { name: 'Independent verification' });
    const previewRegion = page.getByRole('region', { name: 'Preview result' });
    const prompt = page.getByText('Run a preview with a compiled artifact to request verification.', { exact: true });
    const forbiddenAction = /\b(?:approve|activate|sync)\b/i;
    const noActivationControls = async () => {
      await expect(page.getByRole('button', { name: forbiddenAction })).toHaveCount(0);
      await expect(page.getByRole('link', { name: forbiddenAction })).toHaveCount(0);
    };
    await noActivationControls();

    const privateFixtureIds: string[] = [];
    for (const [index, candidate] of catalog.candidates.entries()) {
      await page.getByLabel('Development candidate').selectOption(candidate.id);
      await expect(page.getByText('Development fixture · empty target', { exact: true })).toBeVisible();
      await expect(region).toHaveCount(0);
      await expect(previewRegion).toHaveCount(0);
      await expect(prompt).toBeVisible();
      const previewWaiting = apiResponse(page, '/api/connectors/preview', 'POST');
      await page.getByRole('button', { name: 'Run preview' }).click();
      const response = await previewWaiting;
      expect(response.status()).toBe(200);
      await expectBrowserMutation(response, origin);
      expect(isDeepStrictEqual(response.request().postDataJSON(), candidate.request)).toBe(true);
      const preview = await readPublic(response, PreviewResponseSchema, 'Preview', bodies);
      const previewBalanceCents = index === 0 ? 80_000 : 0;
      expect(preview.diffs).toEqual([expect.objectContaining({ scope: candidate.scope, afterBalanceCents: previewBalanceCents })]);
      const balance = previewRegion.getByRole('region', { name: 'Balance diff for ' + candidate.scope.accountId });
      const projected = balance.locator('dt:text-is("Amount still owed after proposed import") + dd > span');
      await expect(projected).toBeVisible();
      await expect(projected).toHaveText(index === 0 ? '$800.00' : '$0.00');
      expect(preview.parentWrites).toBe(0);
      await expect(previewRegion.getByText('Parent writes: 0', { exact: true })).toBeVisible();
      const { artifact } = preview;
      if (!artifact) throw new Error('Captured preview did not compile an artifact');
      const profileHashes = candidate.request.profiles.map(profile => profile.hash).sort();
      expect(isDeepStrictEqual(artifact.requiredProfileHashes, profileHashes) && hashArtifact(artifact) === artifact.hash &&
        candidate.request.profiles.every(profile => hashProfile(profile) === profile.hash)).toBe(true);
      const artifactDetails = previewRegion.locator('details:has(> summary:text-is("Artifact details"))');
      await artifactDetails.locator('summary').click();
      await expect(artifactDetails.getByText(artifact.hash, { exact: true })).toBeVisible();
      for (const hash of profileHashes) await expect(artifactDetails.getByText(hash, { exact: true })).toBeVisible();
      const manifest = await readManifest(system.db.control, candidate.companyId, candidate.snapshotId.slice('snapshot:'.length));
      expect(candidate.snapshotId).toBe('snapshot:' + manifest.id);
      expect(candidate.request.snapshotId).toBe(candidate.snapshotId);
      expect(manifest.sourceRef).toBe(candidate.sourceRef);
      expect(artifact.sourceRef).toBe(manifest.sourceRef);

      const { jobId, state, summary } = await verifyInBrowser(page, origin, candidate.request.spec.id, {
        artifactHash: artifact.hash, profileHashes, manifestId: manifest.id,
      }, bodies);
      expect(summary.artifactHash === artifact.hash && summary.manifestHash === manifest.hash &&
        isDeepStrictEqual(summary.profileHashes, profileHashes)).toBe(true);
      expect(summary.checks.map(check => check.id).sort()).toEqual(mandatoryIds);
      expect(summary.checks.every(check => check.status === 'passed' && check.diagnosticCodes.length === 0)).toBe(true);
      expect(summary.coverageComplete).toBe(true);
      expect(summary.eligible).toBe(true);
      for (const previous of companies) {
        expect(jobId !== previous.jobId && summary.reportId !== previous.reportId &&
          artifact.hash !== previous.artifactHash).toBe(true);
      }

      const { rows } = await system.db.control.query<{ report: unknown; id: string }>(
        'SELECT id, report FROM verification_reports WHERE job_id = $1', [jobId]);
      expect(rows.length).toBe(1);
      const report = safeParse(VerificationReportSchema, rows[0].report, 'Persisted report');
      expect(rows[0].id === summary.reportId && report.id === summary.reportId &&
        report.artifactHash === artifact.hash && report.manifestHash === manifest.hash &&
        isDeepStrictEqual(report.profileHashes, profileHashes)).toBe(true);
      expect(report.fixtureSetVersion === '2').toBe(true);
      expect(report.coverage.required.slice().sort()).toEqual(mandatoryIds);
      expect(report.coverage.executed.slice().sort()).toEqual(mandatoryIds);
      expect(report.unexplainedDifferenceCents).toBe(0);
      expect(report.eligible).toBe(true);
      expect(report.checks.map(check => check.id).sort()).toEqual(mandatoryIds);
      expect(report.checks.find(check => check.id === 'evidence_support')?.cases).toBe(4);
      privateFixtureIds.push(report.fixtureSetId);

      const completed = region.getByText('Job ' + jobId + ' · completed', { exact: true });
      await expect.poll(() => completed.isVisible()).toBe(true);
      expect(bodies.every(body => !body.includes(report.evaluatorBuildHash))).toBe(true);
      await assertPrivateBoundary(page, { bodies, modules, privateFixtureIds });
      await expect(region.getByText('Report ' + summary.reportId + ' · Manifest ' + summary.manifestHash, { exact: true })).toBeVisible();
      await expect(region.getByText('Mandatory coverage complete', { exact: true })).toBeVisible();
      await expect(region.getByText('Eligible for review', { exact: true })).toBeVisible();
      await expect(region.locator('tbody').getByRole('row')).toHaveCount(13);
      const checks = [];
      for (const check of summary.checks) {
        const stored = report.checks.find(candidate => candidate.id === check.id);
        if (!stored) throw new Error('Persisted report is missing a mandatory check');
        expect(stored.status === 'passed' && Number.isSafeInteger(stored.cases) && stored.cases > 0).toBe(true);
        expect(isDeepStrictEqual(stored.diagnosticCodes, check.diagnosticCodes)).toBe(true);
        const row = region.getByRole('row').filter({
          has: page.getByRole('rowheader', { name: check.id.replaceAll('_', ' '), exact: true }),
        });
        // Compare in memory so unexpected private text never becomes an assertion diff.
        const cells = await row.getByRole('cell').allTextContents();
        expect(isDeepStrictEqual(cells, ['Passed', check.diagnosticCodes.join(', ') || '—'])).toBe(true);
        checks.push({ id: check.id, status: check.status, cases: stored.cases, diagnosticCodes: check.diagnosticCodes });
      }
      await noActivationControls();
      screenshots.set('verification-v2-' + candidate.companyId + '.png', await region.screenshot());
      companies.push({
        companyId: candidate.companyId, jobId, state, reportId: summary.reportId, artifactHash: artifact.hash,
        profileHashes, manifestHash: manifest.hash, evaluatorBuildHash: report.evaluatorBuildHash,
        fixtureSetVersion: report.fixtureSetVersion, parentWrites: preview.parentWrites,
        previewBalanceCents: preview.diffs[0].afterBalanceCents, coverageComplete: summary.coverageComplete,
        eligible: summary.eligible, checks,
      });
    }

    expect(isDeepStrictEqual(await runtimeState(system.db.runtime), before)).toBe(true);
    expect(activationRequest).toBe(false);
  } catch (error) {
    // Failed runs must not retain a page snapshot containing unverified response content.
    await page.close();
    throw error;
  } finally {
    page.off('response', observeModules);
    await close();
  }

  for (const [filename, screenshot] of screenshots) await writeFile(testInfo.outputPath(filename), screenshot);
  await writeFile(testInfo.outputPath('v2-browser-results.json'), JSON.stringify({
    schemaVersion: 1, test: title,
    assertions: {
      runtimeUnchanged: true, parentWritesZero: true, summariesBound: true,
      rowsMatch: true, privateBoundary: true, noActivation: true,
    },
    companies,
  }, null, 2) + '\n');
});
