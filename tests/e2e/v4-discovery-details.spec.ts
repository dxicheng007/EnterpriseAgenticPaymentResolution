import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { DiscoveryStateV2Schema, StartDiscoveryResponseV2Schema, hashCanonical } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { composeDiscovery } from '../../apps/control/src/discovery-composition.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import type { ModelClient } from '../../packages/discovery/src/model.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { localPort } from '../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import { modelResult } from '../fixtures/discovery-model.js';
import { apiResponse } from './support/local-review.js';

test.use({ trace: 'off' });

test('inspects persisted finding references through real run reads and SSE without parent writes', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'eapr-discovery-details-'));
  const origin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
  const releaseModel = Promise.withResolvers<void>();
  let published = false;
  const modelClient: ModelClient = {
    mode: 'scripted', modelId: 'details-test-model',
    async run(turn) {
      await releaseModel.promise;
      if (published) return modelResult(turn);
      published = true;
      return modelResult(turn, [{
        id: 'publish-unresolved', name: 'publishFinding',
        arguments: {
          expectedRevision: 0, subject: { kind: 'source' }, fieldPath: '/terms',
          value: 'Unresolved test assertion, not a financial fact',
          provenanceClass: 'unresolved', evidenceStatus: 'insufficient', evidenceRefs: [],
          derivationInputs: [], alternatives: [], unresolvedQuestions: ['Which terms apply?'],
        },
      }]);
    },
  };
  let system: Awaited<ReturnType<typeof createTestSystem>> | undefined;
  let web: Awaited<ReturnType<typeof createServer>> | undefined;
  let manifestId = '';
  try {
    const store = await createEvidenceStore(join(root, 'originals'));
    system = await createTestSystem({
      modelMode: 'stub', dbNamespace: testNamespace('details'),
      async controlPluginFactory({ db, clock }) {
        const { captures } = await loadDemo({ db, clock, store }, {
          visibleRoot: join(root, 'visible'), truthRoot: join(root, 'truth'),
        });
        manifestId = captures.find(capture => capture.companyId === 'company-a')!.manifestId;
        const reviewer = { reviewerId: 'demo-reviewer', allowedSourceRefs: ['legacy-a'], allowedAccountIds: [] };
        const session = createLocalSessionService({ webOrigin: origin, ...reviewer });
        return [session.plugin, composeDiscovery({
          catalog: localSourceCatalog, store, reviewer, authorizeReviewer: session.authorizeReviewer, modelClient,
        })];
      },
    });
    const runtime = system.db.runtime;
    async function runtimeFingerprint() {
      const { rows } = await runtime.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
      return hashCanonical(await Promise.all(rows.map(async ({ tablename }) => {
        if (!/^[a-z_][a-z_0-9]*$/.test(tablename)) throw new Error('Unexpected runtime table');
        return [tablename, (await runtime.query('SELECT to_jsonb(t) AS row FROM ' + tablename + ' t ORDER BY 1')).rows];
      })));
    }
    const before = await runtimeFingerprint();
    web = await createServer({ configFile: 'apps/web/vite.config.ts' });
    await web.listen();
    const bootstrapped = apiResponse(page, '/api/local-session', 'POST');
    await page.goto(origin + '/#discovery');
    const { csrfToken } = await (await bootstrapped).json();
    const start = await page.request.post(origin + '/api/discovery/runs', {
      headers: { Origin: origin, 'X-EAPR-CSRF': csrfToken },
      data: { schemaVersion: 2, companyId: 'company-a', manifestId, idempotencyKey: 'details-start' },
    });
    expect(start.status()).toBe(202);
    const { runId } = StartDiscoveryResponseV2Schema.parse(await start.json());
    const streamOpened = page.waitForRequest(request =>
      new URL(request.url()).pathname === '/api/discovery/runs/' + runId + '/events');
    await page.getByLabel('Run ID').fill(runId);
    await page.getByRole('button', { name: 'Open run' }).click();
    const construction = page.getByRole('region', { name: 'Connector construction' });
    await expect(construction.getByText('No findings recorded.', { exact: true })).toBeVisible();
    await streamOpened;
    releaseModel.resolve();
    await expect(construction.getByText('Finding references 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Activity connected', { exact: true })).toBeVisible();
    const saved = await page.request.get(origin + '/api/discovery/runs/' + runId);
    expect(saved.status()).toBe(200);
    const state = DiscoveryStateV2Schema.parse(await saved.json());
    expect(state.findings).toHaveLength(1);
    const finding = state.findings[0]!;
    await construction.locator('summary').filter({ hasText: finding.id }).click();
    await expect(construction.getByText('Revision ' + finding.revision, { exact: true })).toBeVisible();
    await expect(construction.getByText(finding.taskId, { exact: true })).toBeVisible();
    await expect(construction.getByText('Source-wide', { exact: true })).toBeVisible();
    await expect(construction.getByText('Agent interpretations are not independently verified facts or reviewer decisions.'))
      .toBeVisible();
    await expect(construction.getByText('No verification jobs linked to this run.')).toBeVisible();
    await expect(construction.getByRole('button')).toHaveCount(0);
    expect(await page.content()).not.toContain('Unresolved test assertion, not a financial fact');

    await page.reload();
    await expect(construction.getByText('Finding references 1', { exact: true })).toBeVisible();
    await construction.locator('summary').filter({ hasText: finding.id }).click();
    await expect(construction.getByText('Revision ' + finding.revision, { exact: true })).toBeVisible();
    expect(await runtimeFingerprint()).toBe(before);
  } finally {
    releaseModel.resolve();
    await page.close();
    await web?.close();
    await system?.close();
    await rm(root, { recursive: true, force: true });
  }
});
