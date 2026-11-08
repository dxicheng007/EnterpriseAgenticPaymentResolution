import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { expect, test } from 'vitest';
import {
  DemoCandidatesResponseSchema, PreviewResponseSchema, VerificationJobSchema, VerificationReportSchema, hashBytes, hashCanonical,
} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { createEvidenceStore } from '@eapr/evidence';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createProtectedVerificationLauncher } from '@eapr/evaluator/verify';
import { createLocalComposition } from '../../apps/control/src/composition.js';
import { createVerificationSelector } from '../../apps/control/src/verification-composition.js';
import { decodeTruth } from '../../packages/evaluator/src/fixtures.js';
import { evaluatorBuildHash } from '../../packages/evaluator/src/launcher.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';
import { prepareVerificationPins } from '../../scripts/prepare-verification.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

const webOrigin = 'http://127.0.0.1:5179';
const setupRequired = { code: 'VERIFICATION_FIXTURE_SETUP_REQUIRED' };
const conflict = { code: 'VERIFICATION_FIXTURE_CONFLICT' };

test('real reviewer jobs use operator pins for the registered source captures', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-verification-startup-'));
  const roots = { visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'protected') };
  const store = await createEvidenceStore(join(directory, 'evidence'));
  const registryRoot = join(directory, 'artifacts');
  const protectedPaths: URL[] = [];
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
          webOrigin, captures, verificationSetupDiagnostic: 'VERIFICATION_FIXTURE_SETUP_REQUIRED',
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
        const pins = await prepare();
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

        const options = { webOrigin, captures, verification: {
          pins, registryRoot, expectedMigrations: migrationIdentities(readMigrationCatalog().control),
        } };
        restartControl = async () => {
          const restarted = await createLocalComposition(dependencies, options);
          const app = Fastify();
          for (const plugin of restarted.featurePlugins) app.register(plugin, services);
          await app.ready();
          return app;
        };
        return (await createLocalComposition(dependencies, options)).featurePlugins;
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
      expect(catalog).toMatchObject({ verificationAvailable: true, targetMode: 'empty-fixture', diagnostics: [] });
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
        expect(report.checks).toContainEqual(expect.objectContaining({ status: 'unavailable' }));
        expect(report.unexplainedDifferenceCents).toBe(0);
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
    for (const path of ['scripts', 'apps/control/src', 'packages', 'package.json', 'package-lock.json', 'tests/fixtures/verification-startup.ts']) {
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
      const run = spawnSync(process.execPath, [
        '--import', createRequire(import.meta.url).resolve('tsx'), 'tests/fixtures/verification-startup.ts',
      ], {
        cwd: directory, timeout: 15_000, encoding: 'utf8',
        env: { CONTROL_DATABASE_URL: system.db.control.options.connectionString },
      });
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(run.stdout.trim()).toBe('UPGRADE_FIXTURE_CASES_PASSED');
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
    const forbidden = /(?:^|\/)(?:prepare-verification|generate-fixtures|canonical-fixtures|case-recipes|cases|reference-model|fixtures|fixture-store|subject-runner|subject-comparison|evaluator-runner)\.(?:ts|js)$/;
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
