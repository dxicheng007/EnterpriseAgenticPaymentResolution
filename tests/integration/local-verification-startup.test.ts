import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { expect, test } from 'vitest';
import {
  DemoCandidatesResponseSchema, PreviewResponseSchema, VerificationJobSchema, VerificationReportSchema, hashActivationTrustPolicy, hashBytes, hashCanonical,
} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService } from '@eapr/sources';
import { createCandidateRegistry, createVerificationJobs } from '@eapr/evaluator/registry';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { deriveFinancialCapture } from '@eapr/evaluator/financial-attestation-verify';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import { composeFinancialVerification } from '../../apps/control/src/financial-verification-composition.js';
import { createProtectedVerificationLauncher } from '@eapr/evaluator/verify';
import { createLocalComposition, localSourceCatalog } from '../../apps/control/src/composition.js';
import { createVerificationPlugin } from '../../apps/control/src/routes/verification.js';
import { createVerificationSelector } from '../../apps/control/src/verification-composition.js';
import { decodeTruth } from '../../packages/evaluator/src/fixtures.js';
import { evaluatorBuildHash } from '../../packages/evaluator/src/launcher.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';
import { prepareVerificationPins } from '../../scripts/prepare-verification.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

const fixtureTarget: import('@eapr/compiler/preview-adapters').TargetReader = {
  // Explicit version-zero fixture for this isolated verification composition test.
  async readTarget(scope, asOf) {
    return {
      scope, asOf, version: 0, invoices: [], payments: [], credits: [], allocations: [], reversals: [],
      customers: [], accounts: [], billingConfigurations: [],
    };
  },
};

const webOrigin = 'http://127.0.0.1:5179';
const setupRequired = { code: 'VERIFICATION_FIXTURE_SETUP_REQUIRED' };
const conflict = { code: 'VERIFICATION_FIXTURE_CONFLICT' };

// This gate case preserves the expected-only v1 protocol through an explicit legacy fixture.
test('real reviewer jobs use operator pins for the registered source captures', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-verification-startup-'));
  const roots = { visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'protected') };
  const store = await createEvidenceStore(join(directory, 'evidence'));
  const registryRoot = join(directory, 'artifacts');
  const protectedPaths: URL[] = [];
  let legacyReader: ((jobId: string, report: ReturnType<typeof VerificationReportSchema.parse>, manifestId: string) => Promise<void>) | undefined;
  let restartControl: (() => Promise<FastifyInstance>) | undefined;
  const pinsByCompany = new Map<string, Awaited<ReturnType<typeof prepareVerificationPins>>[number]>();
  try {
    const system = await createTestSystem({
      modelMode: 'disabled', dbNamespace: testNamespace('verstart'),
      async controlPluginFactory(services) {
        const dependencies = { ...services, store };
        const loaded = await loadDemo(dependencies, roots);
        const { captures } = loaded;
        const prepare = () => prepareVerificationPins({ db: services.db, store, captures, truthRoot: roots.truthRoot });
        const readSourceState = () => Promise.all([
          'source_files', 'source_events', 'source_manifests', 'source_snapshots', 'source_dossiers', 'source_evidence',
          'activity_events',
        ].map(table => services.db.query('SELECT to_jsonb(t) AS row FROM ' + table + ' AS t ORDER BY to_jsonb(t)').then(result => result.rows)));
        const before = await readSourceState();
        const expectedA = join(roots.truthRoot, 'expected-a.json');
        const expectedB = join(roots.truthRoot, 'expected-b.json');
        const originalA = await readFile(expectedA, 'utf8');
        const originalB = await readFile(expectedB, 'utf8');
        const legacySentinel = 'protected-legacy-startup-sentinel';
        const legacy = JSON.stringify({ summary: legacySentinel });
        await unlink(expectedB);
        expect(await loadDemo(dependencies, roots)).toEqual(loaded);
        await expect(prepare()).rejects.toMatchObject(setupRequired);
        await writeFile(expectedB, legacy);
        await expect(prepare()).rejects.toMatchObject(setupRequired);
        const degraded = await createLocalComposition(dependencies, {
          webOrigin, captures, fixtureTarget, verificationSetupDiagnostic: 'VERIFICATION_FIXTURE_SETUP_REQUIRED',
        });
        const degradedApp = Fastify();
        for (const plugin of degraded.featurePlugins) degradedApp.register(plugin, services);
        try {
          const session = await degradedApp.inject({
            method: 'POST', url: '/api/local-session', headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
          });
          const cookie = session.cookies[0]!.name + '=' + session.cookies[0]!.value;
          const catalog = await degradedApp.inject({ url: '/api/demo/candidates', headers: { cookie } });
          expect(catalog.json()).toMatchObject({
            verificationAvailable: false, diagnostics: [expect.objectContaining(setupRequired)],
          });
          expect(catalog.body).not.toContain(legacySentinel);
          expect(catalog.body).not.toContain(roots.truthRoot);
          expect((await degradedApp.inject({ url: '/api/verification-jobs/missing', headers: { cookie } })).statusCode).toBe(404);
        } finally {
          await degradedApp.close();
        }
        expect(await readFile(expectedB, 'utf8')).toBe(legacy);
        expect(hashBytes(await readFile(expectedA))).toBe(hashBytes(Buffer.from(originalA)));
        expect(await readSourceState()).toEqual(before);

        await unlink(expectedB);
        await symlink(expectedA, expectedB);
        await expect(prepare()).rejects.toMatchObject(setupRequired);
        await unlink(expectedB);
        await writeFile(expectedB, Buffer.from([0xc0, 0xaf]));
        await expect(prepare()).rejects.toMatchObject(setupRequired);
        await truncate(expectedB, 10 * 1024 * 1024 + 1);
        await expect(prepare()).rejects.toMatchObject(setupRequired);
        await writeFile(expectedB, originalB);

        // Namespace only the immutable key so the real child uses the default
        // protected store without touching existing operator fixture keys.
        for (const [path, original] of [[expectedA, originalA], [expectedB, originalB]] as const) {
          const { hash: _hash, ...truth } = decodeTruth(original);
          const unique = { ...truth, fixtureSetId: 'startup-test:' + randomUUID() };
          await writeFile(path, JSON.stringify({ ...unique, hash: hashCanonical(unique) }));
          protectedPaths.push(new URL('../../.local/protected-evaluator/' +
            hashCanonical([unique.fixtureSetId, unique.fixtureSetVersion]) + '.json', import.meta.url));
        }
        // The namespaced expected-only copies deliberately retain the legacy mode.
        await unlink(join(roots.truthRoot, 'evidence-a.json'));
        await unlink(join(roots.truthRoot, 'evidence-b.json'));
        const pins = await prepare();
        expect(pins.map(pin => pin.fixtureSetVersion)).toEqual(['1', '1']);
        for (const pin of pins) pinsByCompany.set(pin.companyId, pin);
        expect(await prepare()).toEqual(pins);
        expect(await readSourceState()).toEqual(before);

        const { hash: _hash, ...truth } = decodeTruth(await readFile(expectedB, 'utf8'));
        const protectedOriginal = await readFile(protectedPaths[1]!);
        const held = { ...truth, purpose: 'final_holdout' };
        await writeFile(expectedB, JSON.stringify({ ...held, hash: hashCanonical(held) }));
        await expect(prepare()).rejects.toMatchObject(conflict);
        const changed = { ...truth, generator: { ...truth.generator, buildHash: 'a'.repeat(64) } };
        await writeFile(expectedB, JSON.stringify({ ...changed, hash: hashCanonical(changed) }));
        await expect(prepare()).rejects.toMatchObject(conflict);
        expect(hashBytes(await readFile(protectedPaths[1]!))).toBe(hashBytes(protectedOriginal));
        await writeFile(expectedB, JSON.stringify({ ...truth, hash: hashCanonical(truth) }));
        expect(await prepare()).toEqual(pins);

        const registry = createCandidateRegistry(services.db, registryRoot);
        const options = { webOrigin, captures, registry, fixtureTarget, verification: {
          pins, registryRoot, expectedMigrations: migrationIdentities(readMigrationCatalog().control),
          roots: {
            evidencePinRoot: fileURLToPath(new URL('../../.local/protected-evaluator', import.meta.url)),
            servedRoots: [roots.visibleRoot, join(directory, 'evidence'), registryRoot],
          },
        } };
        legacyReader = async (jobId, report, manifestId) => {
          const sources = { dependencies, catalog: localSourceCatalog, service: createSourceService(dependencies, localSourceCatalog) };
          const reopenedRegistry = createCandidateRegistry(services.db, registryRoot);
          const select = createVerificationSelector(pins, pins);
          const { jobs } = await composeFinancialVerification(sources, reopenedRegistry, options.verification.roots, select);
          expect((await jobs.get(jobId)).job).toMatchObject({ state: 'completed', summary: { reportId: report.id } });
          const capture = await createFinancialCaptureReader({ ...sources, registry: reopenedRegistry })
            .readCapture({ artifactHash: report.artifactHash, manifestId });
          const policy = { schemaVersion: '1' as const, policyId: 'test-only', entries: [] };
          await expect(createFinancialAttestationRegistry(services.db, reopenedRegistry).readRegisteredFinancialAttestation(report.id, {
            artifactHash: report.artifactHash, requiredProfileHashes: report.profileHashes, capture: deriveFinancialCapture(capture),
            policy: { ...policy, hash: hashActivationTrustPolicy(policy) },
          })).rejects.toMatchObject({ statusCode: 503, message: 'FINANCIAL_ATTESTATION_UNAVAILABLE' });
        };
        const legacyPlugins = async () => {
          const local = await createLocalComposition(dependencies, options);
          const jobs = createVerificationJobs(services.db, createProtectedVerificationLauncher(createVerificationSelector(pins, pins)));
          return [...local.featurePlugins, createVerificationPlugin({
            registry, jobs,
            async authorizeVerification(request) {
              return { caller: 'reviewer', ...await local.authorizeReviewer(request, { mutation: request.method === 'POST' }) };
            },
          })];
        };
        restartControl = async () => {
          const app = Fastify();
          for (const plugin of await legacyPlugins()) app.register(plugin, services);
          await app.ready();
          return app;
        };
        return legacyPlugins();
      },
    });

    try {
      expect((await system.control.getHealth()).status).toBe(200);
      const session = await fetch(system.control.origin + '/api/local-session', {
        method: 'POST', headers: { origin: webOrigin, 'x-eapr-local-ui': '1', 'content-type': 'application/json' }, body: '{}',
      });
      expect(session.status).toBe(200);
      const cookie = session.headers.getSetCookie()[0]!.split(';', 1)[0]!;
      const csrf = (await session.json()).csrfToken as string;
      const mutation = { cookie, origin: webOrigin, 'x-eapr-csrf': csrf };
      const catalog = DemoCandidatesResponseSchema.parse(
        (await system.control.request('/api/demo/candidates', { headers: { cookie } })).body);
      expect(catalog).toMatchObject({ verificationAvailable: false, targetMode: 'empty-fixture', diagnostics: [expect.objectContaining(conflict)] });
      expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(['company-a', 'company-b']);

      const beforePreview = catalog.candidates[0]!;
      const verifyPath = '/api/connectors/' + beforePreview.request.spec.id + '/verify';
      const compiled = compile(beforePreview.request.spec, beforePreview.request.profiles);
      if (!compiled.ok) throw new Error('The registered subject must compile');
      const bodyBeforePreview = {
        artifactHash: compiled.value.hash, profileHashes: beforePreview.request.profiles.map(profile => profile.hash),
        manifestId: pinsByCompany.get(beforePreview.companyId)!.manifestId,
      };
      expect((await system.control.request(verifyPath, { method: 'POST', headers: mutation, body: bodyBeforePreview })).status).toBe(404);

      for (const demo of catalog.candidates) {
        const pin = pinsByCompany.get(demo.companyId)!;
        const preview = await system.control.request('/api/connectors/preview', {
          method: 'POST', headers: mutation, body: demo.request,
        });
        expect(preview.status).toBe(200);
        const { artifact, parentWrites } = PreviewResponseSchema.parse(preview.body);
        expect(parentWrites).toBe(0);
        const path = '/api/connectors/' + demo.request.spec.id + '/verify';
        const body = { artifactHash: artifact!.hash, profileHashes: demo.request.profiles.map(profile => profile.hash), manifestId: pin.manifestId };
        const post = (headers?: Record<string, string>, value: unknown = body) =>
          system.control.request(path, { method: 'POST', headers, body: value });
        expect((await post()).status).toBe(401);
        expect((await post({ cookie, origin: webOrigin })).status).toBe(403);
        expect((await post({ ...mutation, origin: 'http://127.0.0.1:9999' })).status).toBe(403);
        for (const credential of ['authorization', 'x-eapr-service-token', 'x-eapr-task-token']) {
          expect((await post({ ...mutation, [credential]: 'denied' })).status).toBe(403);
        }
        expect((await post(mutation, { ...body, fixtureSetId: pin.fixtureSetId })).status).toBe(400);
        const queued = await post(mutation);
        expect(queued.status).toBe(202);
        const { jobId } = VerificationJobSchema.parse(queued.body);
        const jobPath = '/api/verification-jobs/' + jobId;
        expect((await system.control.request(jobPath)).status).toBe(401);
        expect((await system.control.request(jobPath, { headers: { cookie, 'x-task-token': 'denied' } })).status).toBe(403);
        let finished;
        await expect.poll(async () => {
          const result = await system.control.request(jobPath, { headers: { cookie } });
          expect(result.status).toBe(200);
          finished = VerificationJobSchema.parse(result.body);
          return finished.state;
        }, { timeout: 7000 }).toBe('completed');
        expect(finished).toMatchObject({ summary: { eligible: false, coverageComplete: false } });
        const report = VerificationReportSchema.parse((await system.db.control.query(
          'SELECT report FROM verification_reports WHERE job_id = $1', [jobId],
        )).rows[0]?.report);
        expect(report).toMatchObject({
          artifactHash: body.artifactHash, profileHashes: body.profileHashes, manifestHash: pin.manifestHash,
          fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion,
          evaluatorBuildHash: await evaluatorBuildHash(), eligible: false,
        });
        expect(report.checks).toContainEqual(expect.objectContaining({ id: 'baseline_reconcile', status: 'passed' }));
        expect(report.checks).toContainEqual(expect.objectContaining({
          id: 'evidence_support', status: 'unavailable', cases: 0,
        }));
        expect(report.unexplainedDifferenceCents).toBe(0);
        await legacyReader!(jobId, report, pin.manifestId);
        expect(JSON.stringify(finished)).not.toContain(pin.fixtureSetId);
        expect(JSON.stringify(finished)).not.toContain(roots.truthRoot);

        const registry = createCandidateRegistry(system.db.control, registryRoot);
        const candidate = await registry.getCandidate(body.artifactHash, body.manifestId);
        const pins = [...pinsByCompany.values()];
        const select = createVerificationSelector(pins, pins);
        expect(await createProtectedVerificationLauncher(select).resolve(candidate)).toEqual({
          fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, purpose: 'construction',
          snapshotHash: pin.snapshotHash, evaluatorBuildHash: await evaluatorBuildHash(),
        });
        expect(() => createVerificationSelector([pin], pins)).toThrow();
        expect(() => createVerificationSelector([pin, pin], pins)).toThrow();
        expect(() => createVerificationSelector(pins.map(item => ({ ...item, truthRoot: roots.truthRoot })), pins)).toThrow();
        expect(() => createVerificationSelector(pins.map(item => ({ ...item, purpose: 'final_holdout' })), pins)).toThrow();
        for (const subject of [
          { ...candidate, manifest: { ...candidate.manifest, id: 'absent' } },
          { ...candidate, manifest: { ...candidate.manifest, companyId: 'wrong-company' } },
          { ...candidate, manifest: { ...candidate.manifest, hash: 'a'.repeat(64) } },
          { ...candidate, snapshot: { ...candidate.snapshot, contentHash: 'a'.repeat(64) } },
          { ...candidate, snapshot: { ...candidate.snapshot, sourceRef: 'wrong-source' } },
          { ...candidate, snapshot: { ...candidate.snapshot, manifestId: 'wrong-manifest' } },
          { ...candidate, profiles: candidate.profiles.map(profile => ({ ...profile, sourceRef: 'wrong-source' })) },
        ]) await expect(select(subject)).rejects.toThrow('bindings conflict');

        const dossier = await system.control.request('/api/sources/' + demo.companyId + '/dossier', { headers: { cookie } });
        const evidence = await system.control.request('/api/evidence/' + demo.request.spec.evidenceRefs[0], { headers: { cookie } });
        for (const response of [dossier, evidence]) {
          expect(response.status).toBe(200);
          expect(JSON.stringify(response.body)).not.toContain(pin.fixtureSetId);
          expect(JSON.stringify(response.body)).not.toContain(roots.truthRoot);
          expect(JSON.stringify(response.body)).not.toContain('protected-legacy-startup-sentinel');
        }

        const file = protectedPaths[demo.companyId === 'company-a' ? 0 : 1]!;
        const moved = new URL(file.href + '.missing');
        await rename(file, moved);
        try {
          const next = await post(mutation);
          expect(next.status).toBe(202);
          const failedPath = '/api/verification-jobs/' + VerificationJobSchema.parse(next.body).jobId;
          await expect.poll(async () => {
            const result = await system.control.request(failedPath, { headers: { cookie } });
            const job = VerificationJobSchema.parse(result.body);
            if (job.state === 'failed') {
              expect(job.summary).toBeUndefined();
              expect(job.diagnostics).toEqual([expect.objectContaining({ code: 'VERIFICATION_FAILED' })]);
              expect(JSON.stringify(job)).not.toContain(roots.truthRoot);
            }
            return job.state;
          }, { timeout: 7000 }).toBe('failed');
        } finally {
          await rename(moved, file);
        }
      }

      // Rebuild the same composition against the durable registry. Close while
      // the real job is pending and check its row before the test pool closes.
      const restarted = await restartControl!();
      let drainingJobId: string;
      try {
        expect((await restarted.inject({ url: '/api/demo/candidates', headers: { cookie } })).statusCode).toBe(401);
        const nextSession = await restarted.inject({
          method: 'POST', url: '/api/local-session', headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
        });
        expect(nextSession.statusCode).toBe(200);
        const nextCookie = nextSession.cookies[0]!.name + '=' + nextSession.cookies[0]!.value;
        const queued = await restarted.inject({
          method: 'POST', url: verifyPath,
          headers: { cookie: nextCookie, origin: webOrigin, 'x-eapr-csrf': nextSession.json().csrfToken },
          payload: bodyBeforePreview,
        });
        expect(queued.statusCode).toBe(202);
        drainingJobId = VerificationJobSchema.parse(queued.json()).jobId;
      } finally {
        await restarted.close();
      }
      const { rows } = await system.db.control.query('SELECT state FROM verification_jobs WHERE id = $1', [drainingJobId]);
      expect(rows).toEqual([{ state: 'completed' }]);
      expect((await system.db.control.query('SELECT * FROM verification_attempt_budgets')).rowCount).toBe(0);
    } finally {
      await system.close();
    }
  } finally {
    for (const path of protectedPaths) {
      if (await lstat(path).catch(() => undefined)) await unlink(path);
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test('the operator upgrade selects only exact regeneration in an isolated demo root', async () => {
  const checkout = fileURLToPath(new URL('../../', import.meta.url));
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-verification-upgrade-'));
  try {
    // Copy modules whose paths determine the protected store and CLI roots. Reuse
    // the installed dependencies without copying or linking any original .local state.
    for (const path of ['scripts', 'apps/control/src', 'apps/worker/src/routes/parent.ts', 'packages', 'package.json', 'package-lock.json', 'tests/fixtures/verification-startup.ts']) {
      await cp(join(checkout, path), join(directory, path), {
        recursive: true, filter: entry => !entry.split('/').includes('node_modules'),
      });
    }
    await symlink(join(checkout, 'node_modules'), join(directory, 'node_modules'));
    const demo = join(directory, '.local', 'demo');
    await mkdir(demo, { recursive: true });
    const store = await createEvidenceStore(join(demo, 'evidence'));
    const system = await createTestSystem({
      modelMode: 'disabled', dbNamespace: testNamespace('verupgrade'),
      async controlPluginFactory(services) {
        await loadDemo({ ...services, store }, { visibleRoot: join(demo, 'visible'), truthRoot: join(demo, 'protected') });
        return [];
      },
    });
    try {
      const sourceState = () => Promise.all([
        'source_files', 'source_events', 'source_manifests', 'source_snapshots', 'source_dossiers', 'source_evidence',
        'activity_events',
      ].map(table => system.db.control.query('SELECT to_jsonb(t) AS row FROM ' + table + ' AS t ORDER BY to_jsonb(t)').then(result => hashCanonical(result.rows))));
      const before = await sourceState();
      const tsx = ['--import', createRequire(import.meta.url).resolve('tsx')];
      const runOptions = {
        cwd: directory, timeout: 15_000, encoding: 'utf8' as const,
        env: { CONTROL_DATABASE_URL: system.db.control.options.connectionString },
      };
      const runPrivate = (body: string) => spawnSync(process.execPath, [...tsx, '--input-type=module', '-e', `
        import { strict as assert } from 'node:assert';
        import { join } from 'node:path';
        import { createControlDb } from './packages/storage/src/control-db.ts';
        import { loadVisible } from './scripts/load-demo.ts';
        import { prepareVerificationPins, upgradeVerification } from './scripts/prepare-verification.ts';
        const db = createControlDb({ connectionString: process.env.CONTROL_DATABASE_URL });
        const local = join(process.cwd(), '.local');
        try { ${body} }
        catch { process.stderr.write('PRIVATE_UPGRADE_ASSERTION_FAILED\\n'); process.exitCode = 1; }
        finally { await db.end(); }
      `], runOptions);
      const legacyRoot = join(directory, '.local', 'legacy-input');
      await mkdir(legacyRoot);
      for (const company of ['a', 'b']) {
        const name = 'expected-' + company + '.json';
        await cp(join(demo, 'protected', name), join(legacyRoot, name));
      }
      const legacy = runPrivate(`
        const captures = await Promise.all(['a', 'b'].map(async company =>
          (await loadVisible(join(local, 'demo', 'visible'), company)).capture));
        const pins = await prepareVerificationPins({ db, captures, truthRoot: join(local, 'legacy-input') });
        assert.deepEqual(pins.map(pin => pin.fixtureSetVersion), ['1', '1']);
      `);
      expect(legacy.stderr).toBe('');
      expect(legacy.status).toBe(0);
      const protectedStore = join(directory, '.local', 'protected-evaluator');
      const legacyPins = await readdir(protectedStore);
      const fingerprint = async (root: string, files: string[]) =>
        Promise.all(files.map(async name => hashBytes(await readFile(join(root, name)))));
      const oldPins = await fingerprint(protectedStore, legacyPins);
      const inventory = async (root: string) => {
        const files = (await readdir(root, { recursive: true, withFileTypes: true }))
          .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
        return Promise.all(files.map(async path => hashBytes(await readFile(path))));
      };
      const sourceRoots = ['visible', 'evidence'].map(name => join(demo, name));
      const oldSources = await Promise.all(sourceRoots.map(inventory));

      const run = spawnSync(process.execPath, [...tsx, 'tests/fixtures/verification-startup.ts'], runOptions);
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(run.stdout.trim()).toBe('UPGRADE_FIXTURE_CASES_PASSED');
      expect(await fingerprint(protectedStore, legacyPins)).toEqual(oldPins);

      const v2Names = (await readdir(protectedStore)).filter(name => !legacyPins.includes(name));
      const v2Pins = await Promise.all(v2Names.map(async name => {
        const file = join(protectedStore, name);
        const bundle = JSON.parse(await readFile(file, 'utf8'));
        return { file, companyId: bundle.evidence.producer.companyId, version: bundle.pin.fixtureSetVersion };
      }));
      expect(v2Pins.map(pin => pin.version)).toEqual(['2', '2']);
      const v2A = v2Pins.find(pin => pin.companyId === 'company-a')!.file;
      const v2B = v2Pins.find(pin => pin.companyId === 'company-b')!.file;
      const selection = join(demo, 'verification-selection.json');
      const previous = hashBytes(await readFile(selection));
      const previousInventory = await readdir(demo);
      const generator = join(directory, 'scripts', 'generate-fixtures.ts');
      const generatorSource = await readFile(generator, 'utf8');
      await writeFile(generator, generatorSource.replace(/^ +await writeEvidenceFacts\(join\(truth,'evidence-[ab]\.json'\).*$/gm, ''));
      try {
        const missing = runPrivate(`
          await assert.rejects(upgradeVerification(db, join(local, 'missing-companions')), {
            code: 'VERIFICATION_FIXTURE_SETUP_REQUIRED',
          });
        `);
        expect(missing.stderr).toBe('');
        expect(missing.status).toBe(0);
        expect(hashBytes(await readFile(selection))).toBe(previous);
        expect(await readdir(demo)).toEqual(previousInventory);
      } finally {
        await writeFile(generator, generatorSource);
      }
      // This protected store belongs entirely to the disposable checkout. Make
      // B's key unwritable after successful preflight, then verify A's orphan.
      const aHash = hashBytes(await readFile(v2A));
      await unlink(v2A);
      await rename(v2B, v2B + '.test-saved');
      await mkdir(v2B);
      const blocked = runPrivate(`
        await assert.rejects(upgradeVerification(db, join(local, 'blocked-second-pin')), {
          code: 'VERIFICATION_FIXTURE_CONFLICT',
        });
      `);
      expect(blocked.stderr).toBe('');
      expect(blocked.status).toBe(0);
      expect(hashBytes(await readFile(v2A))).toBe(aHash);
      expect(hashBytes(await readFile(selection))).toBe(previous);
      expect(await readdir(demo)).toEqual(previousInventory);
      expect(await fingerprint(protectedStore, legacyPins)).toEqual(oldPins);
      expect(await Promise.all(sourceRoots.map(inventory))).toEqual(oldSources);
      expect(await sourceState()).toEqual(before);
    } finally {
      await system.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test('the control composition import graph stays outside the operator and evaluator oracle', () => {
  const moduleUrl = new URL('../../apps/control/src/composition.ts', import.meta.url).href;
  const script = String.raw`
    import { registerHooks } from 'node:module';
    const forbidden = /(?:^|\/)(?:prepare-verification|evidence-verification-input|generate-fixtures|canonical-fixtures|case-recipes|cases|reference-model|fixtures|fixture-store|subject-runner|subject-comparison|evaluator-runner)\.(?:ts|js)$/;
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (forbidden.test(specifier)) throw new Error('Unexpected private dependency');
        return nextResolve(specifier, context);
      },
    });
    try {
      const { createLocalComposition } = await import(${JSON.stringify(moduleUrl)});
      if (typeof createLocalComposition !== 'function') process.exitCode = 2;
    } finally {
      hooks.deregister();
    }
  `;
  const run = spawnSync(process.execPath, [
    '--import', createRequire(import.meta.url).resolve('tsx'), '--input-type=module', '-e', script,
  ], { timeout: 5000, encoding: 'utf8', env: {} });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
});
