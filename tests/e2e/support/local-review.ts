import { lstat, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Response } from '@playwright/test';
import { createLogger, createServer } from 'vite';
import { hashBytes, hashCanonical } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService, readManifest } from '@eapr/sources';
import { createLocalComposition, localSourceCatalog } from '../../../apps/control/src/composition.js';
import { loadDemo } from '../../../scripts/load-demo.js';
import { migrationIdentities, readMigrationCatalog } from '../../../scripts/migrate.js';
import { prepareVerificationPins } from '../../../scripts/prepare-verification.js';
import { localPort } from '../../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../../fixtures/harness.js';
import { browserVerificationFixtures, fixedProtectedRoot } from './verification-fixtures.js';

async function fingerprintTree(path: string): Promise<string> {
  const stat = await lstat(path);
  if (stat.isFile()) return hashCanonical([stat.mode, hashBytes(await readFile(path))]);
  if (!stat.isDirectory()) throw new Error('Unexpected browser fixture entry');
  const members = await Promise.all((await readdir(path)).sort().map(async name =>
    [name, await fingerprintTree(join(path, name))]));
  return hashCanonical([stat.mode, members]);
}

export async function openLocalReview(
  { verification = false }: { verification?: boolean | 'evidence-v2' } = {},
) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-c3-browser-'));
  const origin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
  const visibleRoot = join(root, 'visible');
  const truthRoot = join(root, 'protected');
  const originalsRoot = join(root, 'originals');
  const evidenceV2 = verification === 'evidence-v2';
  const fixtures = verification ? browserVerificationFixtures({
    root, originalTruthRoot: truthRoot, mode: 'evidence-v2',
  }) : undefined;
  const inputRoots = [truthRoot, visibleRoot, originalsRoot];
  let originalFingerprints: string[] | undefined;
  async function fingerprintInputs() {
    try {
      return await Promise.all(inputRoots.map(fingerprintTree));
    } catch {
      throw new Error('Browser fixture input inventory could not be read');
    }
  }
  const privateFiles: string[] = [];
  const blockedPinPaths: string[] = [];
  const protectedValues = new Set<string>();
  const privateField = /"(?:fixtureSetId|fixtureSetVersion|producerTruthHash|financialTruthHash|truthJson|producerTruthJson|bundleHash|balanceAnchorCents|expectedRecords|expectedFactHash|privateResults|resolvedSupport|bytesBase64|recipeVersion|caseId)"\s*:/;
  const privatePayload = /captured-baseline|independent-F8-probe|planner-fresh-process|browser-fixture:/;
  const protectedModule = /\/packages\/evaluator\/|\/scripts\/(?:prepare-verification|generate-fixtures|evidence-verification-input)\b/;

  async function assertPrivateBoundary(page: Page, { bodies, modules, privateFixtureIds }: {
    bodies: readonly string[]; modules: readonly Response[]; privateFixtureIds: readonly string[];
  }) {
    if (!evidenceV2 || privateFiles.length !== 10) throw new Error('V2 browser private boundary was not prepared');
    expect(privateFixtureIds.length > 0 && privateFixtureIds.every(id => protectedValues.has(id))).toBe(true);
    const containsProtectedValue = (text: string) => [...protectedValues].some(value => text.includes(value));
    const containsPrivatePayload = (text: string) =>
      containsProtectedValue(text) || privateField.test(text) || privatePayload.test(text);
    const containsPrivatePath = (text: string) =>
      text.includes(root) || /protected-evaluator|verification-truth|(?:expected|evidence)-[ab]\.json/.test(text);
    const dom = await page.content();
    expect([...bodies, dom].every(text => !containsPrivatePayload(text) && !containsPrivatePath(text))).toBe(true);

    expect(modules.some(response => new URL(response.url()).pathname.startsWith('/src/'))).toBe(true);
    for (const response of modules) {
      const path = new URL(response.url()).pathname;
      expect(!protectedModule.test(path)).toBe(true);
      const text = await response.text();
      expect(!containsPrivatePayload(text) && !containsPrivatePath(text) && !protectedModule.test(text)).toBe(true);
    }

    const apiPaths = [...new Set(privateFiles.map(file => basename(file)))].flatMap(file =>
      ['/api/evidence/' + encodeURIComponent(file), '/api/evidence/' + encodeURIComponent(file) + '/content']);
    const fsPaths = privateFiles.map(file => '/@fs' + file.split('/').map(encodeURIComponent).join('/'));
    for (const [kind, paths] of [['control', apiPaths], ['Vite filesystem', fsPaths], ['Vite blocked root', blockedPinPaths]] as const) {
      for (const path of paths) {
        let denied: boolean;
        try {
          // Ask for a file response so Vite's HTML navigation fallback cannot answer the probe.
          const response = await page.request.get(origin + path, {
            headers: { accept: 'application/json' }, maxRedirects: 0, timeout: 5000,
          });
          try {
            const text = await response.text();
            denied = [403, 404].includes(response.status()) && !containsPrivatePayload(text) &&
              !/\b(?:import|export)\s+(?:\{|(?:const|function|default)\b)/.test(text);
          } finally {
            await response.dispose();
          }
        } catch {
          throw new Error('Private HTTP probe failed');
        }
        expect(denied, kind + ' denies private file reads').toBe(true);
      }
    }
  }
  const logger = createLogger();
  const privateProbeLogger = {
    ...logger,
    error(message: string, options?: Parameters<typeof logger.error>[1]) {
      if (privateFiles.some(path => message === 'The request id "' + path + '" is outside of Vite serving allow list.')) return;
      logger.error(message, options);
    },
    warnOnce(message: string, options?: Parameters<typeof logger.warnOnce>[1]) {
      if (message.endsWith('#server-fs-allow for configurations and more details.\n')) return;
      logger.warnOnce(message, options);
    },
  };
  let system: Awaited<ReturnType<typeof createTestSystem>> | undefined;
  let web: Awaited<ReturnType<typeof createServer>> | undefined;

  async function close() {
    try {
      await web?.close();
    } finally {
      try {
        await system?.close();
      } finally {
        try {
          await fixtures?.close();
          if (originalFingerprints) {
            const current = await fingerprintInputs();
            expect(current.every((hash, index) => hash === originalFingerprints![index])).toBe(true);
          }
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  }

  try {
    const store = await createEvidenceStore(originalsRoot);
    system = await createTestSystem({
      modelMode: 'disabled',
      dbNamespace: testNamespace('c3browser'),
      async controlPluginFactory({ db, clock }) {
        const dependencies = { db, clock, store };
        const { captures } = await loadDemo(dependencies, { visibleRoot, truthRoot });
        const options = { webOrigin: origin, captures };
        if (!fixtures) return (await createLocalComposition(dependencies, options)).featurePlugins;
        const sources = createSourceService(dependencies, localSourceCatalog);
        const bindings = await Promise.all(captures.map(async ({ companyId, manifestId }) => {
          const manifest = await readManifest(db, companyId, manifestId);
          const snapshot = await sources.getSnapshot('snapshot:' + manifestId);
          return { companyId, manifestId, sourceRef: manifest.sourceRef,
            manifestHash: manifest.hash, snapshotHash: snapshot.contentHash };
        }));
        if (evidenceV2) originalFingerprints = await fingerprintInputs();
        const pins = await fixtures.prepare(bindings,
          truthRoot => prepareVerificationPins({ db, captures, truthRoot, store }));
        if (evidenceV2) {
          try {
            for (const pin of pins) {
              const filename = hashCanonical([pin.fixtureSetId, pin.fixtureSetVersion]) + '.json';
              const path = fileURLToPath(new URL(filename, fixedProtectedRoot));
              privateFiles.push(path);
              blockedPinPaths.push('/.local/protected-evaluator/' + filename);
              const bundle = JSON.parse(await readFile(path, 'utf8'));
              for (const value of [pin.fixtureSetId, bundle.pin.hash, bundle.bundleHash, bundle.evidence.hash,
                bundle.evidence.financialTruthHash, bundle.evidence.producer.hash, bundle.evidence.producer.producerTruthHash]) {
                if (typeof value !== 'string' || !value) throw new Error('Invalid private pin probe input');
                protectedValues.add(value);
              }
            }
            for (const directory of [truthRoot, join(root, 'verification-truth')]) {
              for (const company of ['a', 'b']) {
                for (const kind of ['expected', 'evidence']) {
                  const path = join(directory, kind + '-' + company + '.json');
                  privateFiles.push(path);
                  const input = JSON.parse(await readFile(path, 'utf8'));
                  for (const value of [input.fixtureSetId, input.hash]) {
                    if (typeof value !== 'string' || !value) throw new Error('Invalid private file probe input');
                    protectedValues.add(value);
                  }
                }
              }
            }
          } catch {
            throw new Error('Browser could not prepare private boundary probes');
          }
        }
        const registryRoot = join(root, 'artifacts');
        return (await createLocalComposition(dependencies, {
          ...options,
          verification: {
            pins, registryRoot,
            roots: { evidencePinRoot: fileURLToPath(fixedProtectedRoot), servedRoots: [visibleRoot, originalsRoot, registryRoot] },
            expectedMigrations: migrationIdentities(readMigrationCatalog().control),
          },
        })).featurePlugins;
      },
    });
    web = await createServer({
      configFile: 'apps/web/vite.config.ts',
      // Suppress only the known file-denial diagnostics that log private paths.
      ...(evidenceV2 && { customLogger: privateProbeLogger }),
      ...(verification && {
        server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**',
          '**/.evidence/**', '**/fixtures/truth/**'] } },
      }),
    });
    await web.listen();
    return { origin, system, store, visibleRoot, close, assertPrivateBoundary };
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
