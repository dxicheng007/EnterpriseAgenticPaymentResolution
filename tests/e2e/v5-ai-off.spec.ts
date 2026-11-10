/**
 * V5 AI-off browser harness: worker and control run with model credentials
 * absent and modelMode disabled. Browser provider requests are observed, but
 * runtime model-call counts are not instrumented or measured by this case.
 */
import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { localPort } from '../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import {
  assertModelCredentialsAbsent, modelCredentialEnvNames, scrubModelCredentials,
} from '../fixtures/v5-ai-off.js';

test.use({ trace: 'off' });

test('configured AI-off services stay ready with no browser-observed provider attempts', async ({ page, browser }) => {
  for (const name of modelCredentialEnvNames) process.env[name] = 'browser-must-scrub';
  scrubModelCredentials();
  assertModelCredentialsAbsent();

  const system = await createTestSystem({
    modelMode: 'disabled',
    dbNamespace: testNamespace('v5aioff'),
    migrationThroughVersion: 1,
  });
  let web: Awaited<ReturnType<typeof createServer>> | undefined;
  let runtimeProviderAttempts = 0;
  try {
    page.on('request', request => {
      const url = request.url();
      if (/openai|anthropic|api\.openai|api\.anthropic/i.test(url)) runtimeProviderAttempts += 1;
    });
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
    await expect(system.sourceAdmin.inject('fresh-payment')).rejects.toMatchObject({
      code: 'FEATURE_NOT_IMPLEMENTED',
    });
    await expect(createTestSystem({
      modelMode: 'live', dbNamespace: testNamespace('v5ailive'),
    })).rejects.toThrow(/unavailable/);

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
