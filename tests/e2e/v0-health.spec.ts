import { test, expect } from '@playwright/test';
import { createServer } from 'vite';
import { localPort } from '../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

test('renders ready and degraded PostgreSQL states and recovers on retry', async ({ page, browser }) => {
  const system = await createTestSystem({ modelMode: 'disabled', dbNamespace: testNamespace('browser') });
  let web: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    web = await createServer({ configFile: 'apps/web/vite.config.ts' });
    await web.listen();
    await test.info().attach('browser-version', { body: browser.version(), contentType: 'text/plain' });
    const origin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
    await page.goto(origin);
    const readiness = page.getByRole('definition');
    await expect(page.getByRole('status')).toHaveText('System ready');
    await expect(page.getByText('Control database', { exact: true })).toBeVisible();
    await expect(page.getByText('Runtime database', { exact: true })).toBeVisible();
    await expect(page.getByText('Control migration', { exact: true })).toBeVisible();
    await expect(page.getByText('Runtime migration', { exact: true })).toBeVisible();
    await expect(readiness).toHaveText(['Ready', '1', 'Ready', '1']);

    await system.worker.stop();
    const degraded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/health');
    await page.getByRole('button', { name: 'Retry health check' }).click();
    expect((await degraded).status()).toBe(503);
    await expect(page.getByRole('status')).toHaveText('System not ready');
    await expect(readiness).toHaveText(['Ready', '1', 'Unavailable', 'Unobserved']);

    await system.worker.start();
    await page.getByRole('button', { name: 'Retry health check' }).click();
    await expect(page.getByRole('status')).toHaveText('System ready');
    await expect(readiness).toHaveText(['Ready', '1', 'Ready', '1']);
  } finally {
    await web?.close();
    await system.close();
  }
});
