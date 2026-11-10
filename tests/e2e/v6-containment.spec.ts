/**
 * V6 containment browser harness: worker/control stay ready with model credentials
 * absent while parent financial rows remain unread-write-safe. Full Connections UI
 * drift panels and joint G6 remain pending; this proves containment readiness surfaces.
 */
import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { localPort } from '../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import {
  assertModelCredentialsAbsent, modelCredentialEnvNames, scrubModelCredentials,
} from '../fixtures/v5-ai-off.js';
import { committedFinancialFingerprint } from '../fixtures/v6-containment.js';

test.use({ trace: 'off' });

test('containment surfaces stay ready without model credentials or financial writes', async ({ page, browser }) => {
  for (const name of modelCredentialEnvNames) process.env[name] = 'browser-must-scrub';
  scrubModelCredentials();
  assertModelCredentialsAbsent();

  const system = await createTestSystem({
    modelMode: 'disabled',
    dbNamespace: testNamespace('v6contain'),
  });
  let web: Awaited<ReturnType<typeof createServer>> | undefined;
  let runtimeProviderAttempts = 0;
  try {
    page.on('request', request => {
      const url = request.url();
      if (/openai|anthropic|api\.openai|api\.anthropic/i.test(url)) runtimeProviderAttempts += 1;
    });
    const before = await committedFinancialFingerprint(system.db.runtime);
    web = await createServer({ configFile: 'apps/web/vite.config.ts' });
    await web.listen();
    await test.info().attach('browser-version', { body: browser.version(), contentType: 'text/plain' });
    const origin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
    await page.goto(origin);
    await expect(page.getByRole('status')).toHaveText('System ready');
    await expect(page.getByText('Control database', { exact: true })).toBeVisible();
    await expect(page.getByText('Runtime database', { exact: true })).toBeVisible();

    const health = await system.control.getHealth();
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ready');

    // Operator mutate paths that would broaden sync authority stay unimplemented in V0 harness.
    await expect(system.sourceAdmin.inject('fresh-payment')).rejects.toMatchObject({
      code: 'FEATURE_NOT_IMPLEMENTED',
    });
    await expect(system.sourceAdmin.inject('schema-rename')).rejects.toMatchObject({
      code: 'FEATURE_NOT_IMPLEMENTED',
    });

    expect(await committedFinancialFingerprint(system.db.runtime)).toEqual(before);
    assertModelCredentialsAbsent();
    expect(runtimeProviderAttempts).toBe(0);
    for (const name of modelCredentialEnvNames) {
      expect(process.env[name], name).toBeUndefined();
    }
  } finally {
    await web?.close();
    await system.close();
  }
});
