import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'vite';
import { launchControl, createWorkerClient } from '../apps/control/src/server.js';
import { launchWorker } from '../apps/worker/src/server.js';
import { createControlDb } from '../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../packages/storage/src/runtime-db.js';
import { migrate } from './migrate.js';
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

async function serve(role: 'worker' | 'control') {
  const serviceToken = required('EAPR_SERVICE_TOKEN');
  const clock = () => new Date();
  const shutdown = shutdownSignal();
  const workerPort = localPort('EAPR_WORKER_PORT', 3002);
  const pool = role === 'worker'
    ? createRuntimeDb({ connectionString: required('RUNTIME_DATABASE_URL') })
    : createControlDb({ connectionString: required('CONTROL_DATABASE_URL') });
  try {
    const app = role === 'worker'
      ? await launchWorker({ db: pool, clock, serviceToken }, workerPort)
      : await launchControl({
          db: pool, clock, workerClient: createWorkerClient('http://127.0.0.1:' + workerPort, serviceToken),
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
  const web = await createServer({ configFile: 'apps/web/vite.config.ts' });
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

  const serviceToken = randomBytes(32).toString('hex');
  const controlPort = localPort('EAPR_CONTROL_PORT', 3001);
  const workerPort = localPort('EAPR_WORKER_PORT', 3002);
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
      ...workerAccess, CONTROL_DATABASE_URL: db.control.appUrl, EAPR_CONTROL_PORT: String(controlPort),
    });
    const webPort = localPort('EAPR_WEB_PORT', 5173);
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
    error instanceof Error && 'code' in error && error.code === 'EADDRINUSE' ? 'EADDRINUSE' : '');
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect?.();
}
