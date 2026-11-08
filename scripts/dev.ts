import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createServer } from 'vite';
import { launchControl, createWorkerClient, type ControlServices } from '../apps/control/src/server.js';
import { launchWorker } from '../apps/worker/src/server.js';
import { createControlDb } from '../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../packages/storage/src/runtime-db.js';
import { migrate, migrationIdentities, readMigrationCatalog } from './migrate.js';
import { localPort, provisionDemo, startNativeDb } from './native-db.js';
import { seed } from './seed.js';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error('Missing local configuration: ' + name);
  return value;
}

function shutdownSignal(): Promise<void> {
  return Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM'), once(process, 'disconnect')]).then(() => {});
}

async function localFeaturePlugins(db: ControlServices['db'], clock: ControlServices['clock']) {
  const { safeVerificationPins } = await import('../apps/control/src/verification-composition.js');
  const { createLocalComposition } = await import('../apps/control/src/composition.js');
  const { createEvidenceStore } = await import('@eapr/evidence');
  const { IdSchema, strict } = await import('@eapr/contracts');
  const captures = z.array(strict({
    companyId: IdSchema, manifestId: IdSchema, contractFileId: IdSchema.nullable(),
  })).parse(JSON.parse(required('EAPR_DEMO_CAPTURES')));
  const store = await createEvidenceStore(required('EAPR_DEMO_EVIDENCE_ROOT'));
  const webOrigin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
  let verificationSetupDiagnostic: 'VERIFICATION_FIXTURE_SETUP_REQUIRED' | 'VERIFICATION_FIXTURE_CONFLICT' | undefined;
  let verification;
  const code = process.env.EAPR_VERIFICATION_SETUP_CODE;
  if (code === 'VERIFICATION_FIXTURE_SETUP_REQUIRED' || code === 'VERIFICATION_FIXTURE_CONFLICT') {
    verificationSetupDiagnostic = code;
  } else if (process.env.EAPR_VERIFICATION_PINS !== undefined) {
    try {
      verification = {
        pins: safeVerificationPins.parse(JSON.parse(process.env.EAPR_VERIFICATION_PINS)),
        registryRoot: fileURLToPath(new URL('../.local/artifacts', import.meta.url)),
        expectedMigrations: migrationIdentities(readMigrationCatalog().control),
      };
    } catch {
      verificationSetupDiagnostic = 'VERIFICATION_FIXTURE_CONFLICT';
    }
  }
  return (await createLocalComposition({ db, clock, store }, {
    webOrigin, captures, verification, verificationSetupDiagnostic,
  })).featurePlugins;
}

async function serve(role: 'worker' | 'control') {
  const serviceToken = required('EAPR_SERVICE_TOKEN');
  const clock = () => new Date();
  const shutdown = shutdownSignal();
  const workerPort = localPort('EAPR_WORKER_PORT', 3002);
  const pool = role === 'worker'
    ? createRuntimeDb({ connectionString: required('RUNTIME_DATABASE_URL') })
    : createControlDb({ connectionString: required('CONTROL_DATABASE_URL') });
  try {
    const expectedMigrations = migrationIdentities(readMigrationCatalog()[role === 'worker' ? 'runtime' : 'control']);
    const app = role === 'worker'
      ? await launchWorker({ db: pool, clock, serviceToken, expectedMigrations }, workerPort)
      : await launchControl({
          db: pool, clock, expectedMigrations, featurePlugins: await localFeaturePlugins(pool, clock),
          workerClient: createWorkerClient('http://127.0.0.1:' + workerPort, serviceToken),
        }, localPort('EAPR_CONTROL_PORT', 3001));
    try {
      process.send?.('ready');
      await shutdown;
    } finally {
      await app.close();
    }
  } finally {
    await pool.end();
  }
}

async function serveWeb() {
  const shutdown = shutdownSignal();
  const web = await createServer({
    configFile: 'apps/web/vite.config.ts',
    server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/.evidence/**', '**/fixtures/truth/**'] } },
  });
  try {
    await web.listen();
    process.send?.('ready');
    await shutdown;
  } finally {
    await web.close();
  }
}

async function runLocal() {
  await startNativeDb();
  const db = await provisionDemo();
  await migrate(db);
  await seed(db);

  const { loadDemo } = await import('./load-demo.js');
  const { prepareSelectedVerificationPins, VerificationSetupError } = await import('./prepare-verification.js');
  const { createEvidenceStore } = await import('@eapr/evidence');
  const evidenceRoot = resolve('.local/demo/evidence');
  const controlDb = createControlDb({ connectionString: db.control.appUrl });
  let captures;
  let verificationEnv: NodeJS.ProcessEnv;
  try {
    const store = await createEvidenceStore(evidenceRoot);
    const loaded = await loadDemo({ db: controlDb, store, clock: () => new Date() }, {
      visibleRoot: resolve('.local/demo/visible'), truthRoot: resolve('.local/demo/protected'),
    });
    captures = loaded.captures;
    console.log('Local demo captured ' + loaded.fileCount + ' documents and ' + loaded.eventCount + ' events.');
    try {
      const pins = await prepareSelectedVerificationPins({ db: controlDb, captures, store });
      verificationEnv = { EAPR_VERIFICATION_PINS: JSON.stringify(pins) };
    } catch (error) {
      const code = error instanceof VerificationSetupError ? error.code : 'VERIFICATION_FIXTURE_CONFLICT';
      console.log(code + '. See docs/demo/verification-setup.md.');
      verificationEnv = { EAPR_VERIFICATION_SETUP_CODE: code };
    }
  } catch {
    throw Object.assign(new Error('Local demo fixture loading failed'), { code: 'LOCAL_DEMO_LOAD_FAILED' });
  } finally {
    await controlDb.end();
  }

  const serviceToken = randomBytes(32).toString('hex');
  const controlPort = localPort('EAPR_CONTROL_PORT', 3001);
  const workerPort = localPort('EAPR_WORKER_PORT', 3002);
  const webPort = localPort('EAPR_WEB_PORT', 5173);
  const children: ChildProcess[] = [];
  const shutdown = shutdownSignal();
  const exits: Promise<string>[] = [];
  async function start(role: 'worker' | 'control' | 'web', specific: NodeJS.ProcessEnv) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/dev.ts', role], {
      env: {
        PATH: process.env.PATH,
        ...specific,
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    children.push(child);
    const exited = once(child, 'exit').then(() => role + ' exited');
    exits.push(exited);
    const ready = once(child, 'message').then(([message]) => message);
    if (await Promise.race([exited, ready, shutdown]) !== 'ready') throw new Error(role + ' could not bind its leased port');
  }
  try {
    const workerAccess = { EAPR_SERVICE_TOKEN: serviceToken, EAPR_WORKER_PORT: String(workerPort) };
    await start('worker', { ...workerAccess, RUNTIME_DATABASE_URL: db.runtime.appUrl });
    await start('control', {
      ...workerAccess, ...verificationEnv, CONTROL_DATABASE_URL: db.control.appUrl, EAPR_CONTROL_PORT: String(controlPort),
      EAPR_WEB_PORT: String(webPort), EAPR_DEMO_EVIDENCE_ROOT: evidenceRoot, EAPR_DEMO_CAPTURES: JSON.stringify(captures),
    });
    // Vite installs its own process signal handler. Keep it outside the supervising process.
    await start('web', { EAPR_WEB_PORT: String(webPort), EAPR_CONTROL_PORT: String(controlPort) });
    console.log('Web readiness: http://127.0.0.1:' + webPort);
    const exited = await Promise.race([shutdown, ...exits]);
    if (exited) throw new Error(exited);
  } finally {
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }));
  }
}

try {
  const role = process.argv[2];
  if (role === 'worker' || role === 'control') await serve(role);
  else if (role === 'web') await serveWeb();
  else await runLocal();
} catch (error) {
  console.error('Local service startup or shutdown failed. Check database readiness and port leases.',
    error instanceof Error && 'code' in error &&
      (error.code === 'EADDRINUSE' || error.code === 'LOCAL_DEMO_LOAD_FAILED') ? error.code : '');
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect?.();
}
