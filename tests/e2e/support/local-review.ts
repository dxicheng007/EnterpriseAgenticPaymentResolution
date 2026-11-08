import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, type Response } from '@playwright/test';
import { createServer } from 'vite';
import { createEvidenceStore } from '@eapr/evidence';
import { createLocalComposition } from '../../../apps/control/src/composition.js';
import { loadDemo } from '../../../scripts/load-demo.js';
import { migrationIdentities, readMigrationCatalog } from '../../../scripts/migrate.js';
import { prepareVerificationPins } from '../../../scripts/prepare-verification.js';
import { localPort } from '../../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../../fixtures/harness.js';

export async function openLocalReview({ verification = false } = {}) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-c3-browser-'));
  const origin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
  const visibleRoot = join(root, 'visible');
  const truthRoot = join(root, 'protected');
  let system: Awaited<ReturnType<typeof createTestSystem>> | undefined;
  let web: Awaited<ReturnType<typeof createServer>> | undefined;

  async function close() {
    try {
      await web?.close();
    } finally {
      try {
        await system?.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }

  try {
    const store = await createEvidenceStore(join(root, 'originals'));
    system = await createTestSystem({
      modelMode: 'disabled',
      dbNamespace: testNamespace('c3browser'),
      async controlPluginFactory({ db, clock }) {
        const dependencies = { db, clock, store };
        const { captures } = await loadDemo(dependencies, { visibleRoot, truthRoot });
        const options = { webOrigin: origin, captures };
        if (!verification) return (await createLocalComposition(dependencies, options)).featurePlugins;
        const pins = await prepareVerificationPins({ db, captures, truthRoot, store });
        return (await createLocalComposition(dependencies, {
          ...options,
          verification: {
            pins, registryRoot: join(root, 'artifacts'),
            expectedMigrations: migrationIdentities(readMigrationCatalog().control),
          },
        })).featurePlugins;
      },
    });
    web = await createServer({
      configFile: 'apps/web/vite.config.ts',
      ...(verification && {
        server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**',
          '**/.evidence/**', '**/fixtures/truth/**'] } },
      }),
    });
    await web.listen();
    return { origin, system, store, visibleRoot, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export function apiResponse(page: Page, path: string, method = 'GET') {
  return page.waitForResponse(response =>
    new URL(response.url()).pathname === path && response.request().method() === method);
}

export async function expectBrowserMutation(response: Response, origin: string, { bootstrap = false } = {}) {
  const headers = await response.request().allHeaders();
  expect(headers.origin).toBe(origin);
  expect('authorization' in headers).toBe(false);
  expect(Boolean(headers['x-eapr-csrf'])).toBe(!bootstrap);
  if (bootstrap) {
    expect(headers['x-eapr-local-ui']).toBe('1');
    expect(headers['content-type']).toBe('application/json');
    expect(response.request().postData()).toBe('{}');
  } else {
    expect(Boolean(headers.cookie)).toBe(true);
  }
}

export async function startReview(page: Page, origin: string, section: 'sources' | 'preview') {
  const bootstrap = apiResponse(page, '/api/local-session', 'POST');
  await page.goto(origin + '/#' + section);
  const session = await bootstrap;
  expect(session.status()).toBe(200);
  await expectBrowserMutation(session, origin, { bootstrap: true });
  const cookie = (await page.context().cookies(origin + '/api')).find(item => item.name === 'eapr_local_reviewer');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  await expect(page.getByText('Demo reviewer · demo-reviewer')).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in|log in|sign up/i })).toHaveCount(0);
  await expect(page.getByLabel(/password|sign-in code/i)).toHaveCount(0);
}
