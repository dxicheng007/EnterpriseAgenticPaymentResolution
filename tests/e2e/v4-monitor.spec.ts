import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { StartDiscoveryResponseV2Schema } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { composeDiscovery } from '../../apps/control/src/discovery-composition.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import type { ModelClient } from '../../packages/discovery/src/model.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { localPort } from '../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import { apiResponse, expectBrowserMutation, openLocalReview } from './support/local-review.js';

test.use({ trace: 'off' });

test('default local discovery reports unavailable model and start', async ({ page }) => {
  const { origin, close } = await openLocalReview();
  try {
    await page.goto(origin + '/#discovery');
    await expect(page.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible();
    await expect(page.getByText('Discovery model is unavailable. Starting a run is unavailable.')).toBeVisible();
    await expect(page.getByRole('button', { name: /start|approve|activate/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);
  } finally {
    await page.close();
    await close();
  }
});

test('monitors durable scripted activity and persists pause, resume, and usage across reload', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'eapr-monitor-'));
  const origin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
  const modelReleased = Promise.withResolvers<void>();
  const modelClient: ModelClient = {
    mode: 'scripted', modelId: 'browser-test-model',
    async run() {
      await modelReleased.promise;
      throw new Error('Test model could not supply usage');
    },
  };
  let system: Awaited<ReturnType<typeof createTestSystem>> | undefined;
  let web: Awaited<ReturnType<typeof createServer>> | undefined;
  let manifestId = '';
  try {
    const store = await createEvidenceStore(join(root, 'originals'));
    system = await createTestSystem({
      modelMode: 'stub', dbNamespace: testNamespace('monitor'),
      async controlPluginFactory({ db, clock }) {
        const { captures } = await loadDemo({ db, clock, store }, {
          visibleRoot: join(root, 'visible'), truthRoot: join(root, 'truth'),
        });
        manifestId = captures.find(capture => capture.companyId === 'company-a')!.manifestId;
        const reviewer = {
          reviewerId: 'demo-reviewer',
          allowedSourceRefs: [...localSourceCatalog.values()].map(source => source.sourceRef),
          allowedAccountIds: [],
        };
        const session = createLocalSessionService({ webOrigin: origin, ...reviewer });
        return [session.plugin, composeDiscovery({
          catalog: localSourceCatalog, store, reviewer, authorizeReviewer: session.authorizeReviewer, modelClient,
        })];
      },
    });
    web = await createServer({ configFile: 'apps/web/vite.config.ts' });
    await web.listen();
    const bootstrapped = apiResponse(page, '/api/local-session', 'POST');
    await page.goto(origin + '/#discovery');
    const session = await bootstrapped;
    expect(session.status()).toBe(200);
    const { csrfToken } = await session.json();
    const start = await page.request.post(origin + '/api/discovery/runs', {
      headers: { Origin: origin, 'X-EAPR-CSRF': csrfToken },
      data: { schemaVersion: 2, companyId: 'company-a', manifestId, idempotencyKey: 'monitor-test-start' },
    });
    expect(start.status()).toBe(202);
    const { runId } = StartDiscoveryResponseV2Schema.parse(await start.json());
    const runPath = '/api/discovery/runs/' + runId;
    const cursor = apiResponse(page, runPath + '/events/cursor');
    const stream = apiResponse(page, runPath + '/events');
    await page.getByLabel('Run ID').fill(runId);
    await page.getByRole('button', { name: 'Open run' }).click();
    expect((await cursor).status()).toBe(200);
    const streamResponse = await stream;
    expect(streamResponse.status()).toBe(200);
    expect((await streamResponse.allHeaders())['content-type']).toContain('text/event-stream');
    expect(new URL(streamResponse.url()).searchParams.get('after')).toBeTruthy();
    const tasks = page.getByRole('region', { name: 'Tasks' });
    const usage = page.getByRole('region', { name: 'Model usage' });
    const recent = page.getByRole('region', { name: 'Recent activity' });
    const runStatus = page.getByText(/^Run status /);
    await expect(page.getByText('browser-test-model', { exact: true })).toBeVisible();
    await expect(runStatus).toHaveText('Run status running');
    await expect(usage.getByText('In-flight model calls 1')).toBeVisible();
    await expect(tasks.getByRole('listitem')).toHaveCount(1);
    const paused = apiResponse(page, runPath + '/pause', 'POST');
    await page.getByRole('button', { name: 'Pause run' }).click();
    const pauseResponse = await paused;
    expect(pauseResponse.status()).toBe(200);
    await expectBrowserMutation(pauseResponse, origin);
    await expect(runStatus).toHaveText('Run status paused');
    await expect(usage.getByText('In-flight model calls 1')).toBeVisible();
    await expect(recent.getByText('discovery.paused', { exact: true })).toHaveCount(1);
    modelReleased.resolve();
    await expect(usage.getByText('Unknown usage calls 1')).toBeVisible();
    await expect(usage.getByText('Cost unavailable')).toBeVisible();

    await page.reload();
    await expect(runStatus).toHaveText('Run status paused');
    await expect(usage.getByText('Model calls 1', { exact: true })).toBeVisible();
    await expect(usage.getByText('Unknown usage calls 1')).toBeVisible();
    await expect(tasks.getByRole('listitem')).toHaveCount(1);
    const resumed = apiResponse(page, runPath + '/resume', 'POST');
    await page.getByRole('button', { name: 'Resume run' }).click();
    const resumeResponse = await resumed;
    expect(resumeResponse.status()).toBe(200);
    await expectBrowserMutation(resumeResponse, origin);
    const pauseBody = pauseResponse.request().postDataJSON();
    const resumeBody = resumeResponse.request().postDataJSON();
    expect(resumeBody.expectedRevision).toBeGreaterThan(pauseBody.expectedRevision);
    expect(resumeBody.idempotencyKey).not.toBe(pauseBody.idempotencyKey);
    await expect(runStatus).toHaveText('Run status blocked');
    await expect(recent.getByText('discovery.resumed', { exact: true })).toHaveCount(1);

    await page.reload();
    await expect(runStatus).toHaveText('Run status blocked');
    await expect(usage.getByText('Unknown usage calls 1')).toBeVisible();
    await expect(tasks.getByRole('listitem')).toHaveCount(1);
  } finally {
    modelReleased.resolve();
    await page.close();
    await web?.close();
    await system?.close();
    await rm(root, { recursive: true, force: true });
  }
});
