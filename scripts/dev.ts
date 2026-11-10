import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createServer } from 'vite';
import { launchControl, createWorkerClient, type ControlServices } from '../apps/control/src/server.js';
import { createAuthorityWorkerClient } from '../apps/control/src/authority-worker-client.js';
import type { DemoCapture } from '../apps/control/src/demo-candidates.js';
import type { VerificationSetupCode } from '../apps/control/src/verification-composition.js';
import type { ActivationWorkerClient } from '../apps/control/src/activation-worker-client.js';
import { createParentReadClient } from '../apps/control/src/parent-read-client.js';
import { composeWorkerAuthority } from '../apps/worker/src/authority-composition.js';
import { composeWorkerActivation } from '../apps/worker/src/activation-composition.js';
import { composeWorkerParentReads } from '../apps/worker/src/parent-read-composition.js';
import { launchWorker } from '../apps/worker/src/server.js';
import { composeWorkerSync } from '../apps/worker/src/sync-composition.js';
import { composeWorkerDemoSync } from '../apps/worker/src/demo-sync-composition.js';
import { validDemoBearer } from '../apps/worker/src/demo-source-client.js';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
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

type DemoOperator = { enabled: false } | { enabled: true; token: string };
type Capabilities = { serviceToken: string; sourceReadToken: string; authorityAdmissionToken: string };

function demoOperatorFromEnv(): DemoOperator {
  return process.env.DEMO_OPERATOR_ENABLED === 'true'
    ? { enabled: true, token: required('DEMO_OPERATOR_TOKEN') }
    : { enabled: false };
}

function validateCapabilities({ serviceToken, sourceReadToken, authorityAdmissionToken }: Capabilities, operator: DemoOperator) {
  const tokens = [serviceToken, sourceReadToken, authorityAdmissionToken];
  if (operator.enabled) tokens.push(operator.token);
  if (tokens.some(token => !validDemoBearer(token)) || new Set(tokens).size !== tokens.length) {
    throw new Error('Local service capabilities must be valid and distinct');
  }
}

export function buildLocalChildEnvironments(input: Capabilities & {
  path: string | undefined;
  operator: DemoOperator;
  controlPort: number;
  workerPort: number;
  webPort: number;
  runtimeDbUrl: string;
  controlDbUrl: string;
  sourceRefs: readonly string[];
  evidenceRoot: string;
  captures: readonly DemoCapture[];
  reviewSelectionFile?: string | undefined;
  verificationPins?: string | undefined;
  verificationSetupCode?: VerificationSetupCode | undefined;
}): Record<'control' | 'worker' | 'web', NodeJS.ProcessEnv> {
  validateCapabilities(input, input.operator);
  const base = {
    PATH: input.path, EAPR_CONTROL_PORT: String(input.controlPort),
  };
  const services = {
    ...base,
    EAPR_WORKER_PORT: String(input.workerPort),
    EAPR_SERVICE_TOKEN: input.serviceToken,
    EAPR_SOURCE_READ_TOKEN: input.sourceReadToken,
    EAPR_AUTHORITY_ADMISSION_TOKEN: input.authorityAdmissionToken,
    ...(input.operator.enabled && { DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: input.operator.token }),
  };
  return {
    worker: {
      ...services, RUNTIME_DATABASE_URL: input.runtimeDbUrl, EAPR_SOURCE_READ_REFS: JSON.stringify(input.sourceRefs),
    },
    control: {
      ...services, CONTROL_DATABASE_URL: input.controlDbUrl, EAPR_WEB_PORT: String(input.webPort),
      EAPR_DEMO_EVIDENCE_ROOT: input.evidenceRoot, EAPR_DEMO_CAPTURES: JSON.stringify(input.captures),
      EAPR_REVIEW_SELECTION_FILE: input.reviewSelectionFile,
      EAPR_VERIFICATION_PINS: input.verificationPins, EAPR_VERIFICATION_SETUP_CODE: input.verificationSetupCode,
    },
    web: { ...base, EAPR_WEB_PORT: String(input.webPort) },
  };
}

export type WorkerRolePaths = { policyPath: string; registryRoot: string };
export type ControlRolePaths = WorkerRolePaths & {
  evidencePinRoot: string;
  visibleRoot: string;
  webRoot: string;
  sidecarRoot: string;
};

const workerPaths: WorkerRolePaths = {
  policyPath: fileURLToPath(new URL('../.local/activation-policy/current.json', import.meta.url)),
  registryRoot: fileURLToPath(new URL('../.local/artifacts', import.meta.url)),
};
const controlPaths: ControlRolePaths = {
  ...workerPaths,
  evidencePinRoot: fileURLToPath(new URL('../.local/protected-evaluator', import.meta.url)),
  visibleRoot: fileURLToPath(new URL('../.local/demo/visible', import.meta.url)),
  webRoot: fileURLToPath(new URL('../apps/web', import.meta.url)),
  sidecarRoot: fileURLToPath(new URL('../.local/protected-bootstrap', import.meta.url)),
};

async function localFeaturePlugins(
  db: ControlServices['db'], clock: ControlServices['clock'], expectedMigrations: ReturnType<typeof migrationIdentities>,
  parentReads: ReturnType<typeof createParentReadClient>, worker: ActivationWorkerClient,
  authorityWorker: ReturnType<typeof createAuthorityWorkerClient>,
  paths: ControlRolePaths, capabilities: Capabilities, operator: DemoOperator,
) {
  const { safeVerificationPins } = await import('../apps/control/src/verification-composition.js');
  const { createLocalComposition } = await import('../apps/control/src/composition.js');
  const { createEvidenceStore } = await import('@eapr/evidence');
  const { createCandidateRegistry } = await import('@eapr/evaluator/registry');
  const { IdSchema, strict } = await import('@eapr/contracts');
  const captures = z.array(strict({
    companyId: IdSchema, manifestId: IdSchema, contractFileId: IdSchema.nullable(),
  })).parse(JSON.parse(required('EAPR_DEMO_CAPTURES')));
  const store = await createEvidenceStore(required('EAPR_DEMO_EVIDENCE_ROOT'));
  const webOrigin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
  const { registryRoot, policyPath, evidencePinRoot, visibleRoot, webRoot, sidecarRoot } = paths;
  const servedRoots = [
    resolve(required('EAPR_DEMO_EVIDENCE_ROOT')),
    visibleRoot, webRoot,
    registryRoot,
  ];
  let verificationSetupDiagnostic: VerificationSetupCode | undefined;
  let verification;
  const code = process.env.EAPR_VERIFICATION_SETUP_CODE;
  if (code === 'VERIFICATION_FIXTURE_SETUP_REQUIRED' || code === 'VERIFICATION_FIXTURE_CONFLICT') {
    verificationSetupDiagnostic = code;
  } else if (process.env.EAPR_VERIFICATION_PINS !== undefined) {
    try {
      verification = {
        pins: safeVerificationPins.parse(JSON.parse(process.env.EAPR_VERIFICATION_PINS)),
        registryRoot,
        roots: { evidencePinRoot, servedRoots },
        expectedMigrations,
      };
    } catch {
      verificationSetupDiagnostic = 'VERIFICATION_FIXTURE_CONFLICT';
    }
  }
  const { featurePlugins, authorityInvalidRequest } = await createLocalComposition({ db, clock, store }, {
    webOrigin, captures, verification, verificationSetupDiagnostic, parentReads,
    sourceReadToken: capabilities.sourceReadToken,
    demoOperator: { serviceToken: capabilities.serviceToken, operator },
    authorityOperations: { worker: authorityWorker, admissionToken: capabilities.authorityAdmissionToken },
    activationReview: {
      registryRoot,
      policyPath, worker,
      selectionPath: process.env.EAPR_REVIEW_SELECTION_FILE,
      bootstrapRoots: {
        evidencePinRoot, servedRoots,
        sidecarRoot,
      },
    },
    registry: createCandidateRegistry(db, registryRoot),
  });
  return { featurePlugins, authorityInvalidRequest };
}

export async function serve(...[role, paths]: [role: 'worker', paths?: WorkerRolePaths] |
  [role: 'control', paths?: ControlRolePaths]) {
  const capabilities = {
    serviceToken: required('EAPR_SERVICE_TOKEN'),
    sourceReadToken: required('EAPR_SOURCE_READ_TOKEN'),
    authorityAdmissionToken: required('EAPR_AUTHORITY_ADMISSION_TOKEN'),
  };
  const { serviceToken, sourceReadToken, authorityAdmissionToken } = capabilities;
  const operator = demoOperatorFromEnv();
  validateCapabilities(capabilities, operator);
  const { registryRoot, policyPath } = paths ?? (role === 'worker' ? workerPaths : controlPaths);
  const clock = () => new Date();
  const shutdown = shutdownSignal();
  const workerPort = localPort('EAPR_WORKER_PORT', 3002);
  const pool = role === 'worker'
    ? createRuntimeDb({ connectionString: required('RUNTIME_DATABASE_URL') })
    : createControlDb({ connectionString: required('CONTROL_DATABASE_URL') });
  try {
    const expectedMigrations = migrationIdentities(readMigrationCatalog()[role === 'worker' ? 'runtime' : 'control']);
    const workerOrigin = 'http://127.0.0.1:' + workerPort;
    const controlPort = localPort('EAPR_CONTROL_PORT', 3001);
    const controlOrigin = 'http://127.0.0.1:' + controlPort;
    async function launchRuntime() {
      const sourceRefs = z.array(z.string()).parse(JSON.parse(required('EAPR_SOURCE_READ_REFS')));
      return launchWorker({
        db: pool, clock, serviceToken, expectedMigrations, featurePlugins: [
          composeWorkerParentReads(registryRoot),
          composeWorkerActivation({
            registryRoot, policyPath, sourceOrigin: controlOrigin, sourceReadToken, sourceRefs,
          }),
          composeWorkerAuthority({
            admissionOrigin: controlOrigin, admissionToken: authorityAdmissionToken,
            source: { origin: controlOrigin, token: sourceReadToken, sourceRefs },
          }),
          composeWorkerSync({
            source: { origin: controlOrigin, token: sourceReadToken, sourceRefs },
          }),
          composeWorkerDemoSync({
            registered: createRegisteredScopeReader({ registryRoot }),
            source: { origin: controlOrigin, token: sourceReadToken }, operator,
          }),
        ],
      }, workerPort);
    }
    const app = role === 'worker'
      ? await launchRuntime()
      : await launchControl({
          db: pool, clock, expectedMigrations,
          ...await localFeaturePlugins(pool, clock, expectedMigrations,
            createParentReadClient(workerOrigin, serviceToken, registryRoot),
            (await import('../apps/control/src/activation-worker-client.js')).createActivationWorkerClient(workerOrigin, serviceToken),
            createAuthorityWorkerClient(workerOrigin, serviceToken),
            paths ?? controlPaths, capabilities, operator),
          workerClient: createWorkerClient(workerOrigin, serviceToken),
        }, controlPort);
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
  const operator = demoOperatorFromEnv();
  const capabilities = {
    sourceReadToken: randomBytes(32).toString('hex'),
    serviceToken: randomBytes(32).toString('hex'),
    authorityAdmissionToken: randomBytes(32).toString('hex'),
  };
  validateCapabilities(capabilities, operator);
  await startNativeDb();
  const db = await provisionDemo();
  await migrate(db);
  await seed(db);

  const { localSourceCatalog } = await import('../apps/control/src/composition.js');
  const { loadDemo } = await import('./load-demo.js');
  const { prepareSelectedVerificationPins, VerificationSetupError } = await import('./prepare-verification.js');
  const { createEvidenceStore } = await import('@eapr/evidence');
  const evidenceRoot = resolve('.local/demo/evidence');
  const controlDb = createControlDb({ connectionString: db.control.appUrl });
  let captures;
  let verificationPins: string | undefined;
  let verificationSetupCode: VerificationSetupCode | undefined;
  try {
    const store = await createEvidenceStore(evidenceRoot);
    const loaded = await loadDemo({ db: controlDb, store, clock: () => new Date() }, {
      visibleRoot: resolve('.local/demo/visible'), truthRoot: resolve('.local/demo/protected'),
    });
    captures = loaded.captures;
    console.log('Local demo captured ' + loaded.fileCount + ' documents and ' + loaded.eventCount + ' events.');
    try {
      const pins = await prepareSelectedVerificationPins({ db: controlDb, captures, store });
      verificationPins = JSON.stringify(pins);
    } catch (error) {
      const code = error instanceof VerificationSetupError ? error.code : 'VERIFICATION_FIXTURE_CONFLICT';
      console.log(code + '. See docs/demo/verification-setup.md.');
      verificationSetupCode = code;
    }
  } catch {
    throw Object.assign(new Error('Local demo fixture loading failed'), { code: 'LOCAL_DEMO_LOAD_FAILED' });
  } finally {
    await controlDb.end();
  }

  const webPort = localPort('EAPR_WEB_PORT', 5173);
  const envs = buildLocalChildEnvironments({
    ...capabilities, path: process.env.PATH, operator,
    controlPort: localPort('EAPR_CONTROL_PORT', 3001),
    workerPort: localPort('EAPR_WORKER_PORT', 3002),
    webPort,
    controlDbUrl: db.control.appUrl, runtimeDbUrl: db.runtime.appUrl,
    sourceRefs: [...localSourceCatalog.values()].map(source => source.sourceRef),
    evidenceRoot, captures, reviewSelectionFile: process.env.EAPR_REVIEW_SELECTION_FILE,
    verificationPins, verificationSetupCode,
  });
  const children: ChildProcess[] = [];
  const shutdown = shutdownSignal();
  const exits: Promise<string>[] = [];
  async function start(role: 'worker' | 'control' | 'web') {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/dev.ts', role], {
      env: envs[role],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    children.push(child);
    const exited = once(child, 'exit').then(() => role + ' exited');
    exits.push(exited);
    const ready = once(child, 'message').then(([message]) => message);
    if (await Promise.race([exited, ready, shutdown]) !== 'ready') throw new Error(role + ' could not bind its leased port');
  }
  try {
    await start('worker');
    await start('control');
    // Vite installs its own process signal handler. Keep it outside the supervising process.
    await start('web');
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

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const role = process.argv[2];
    if (role === 'worker') await serve(role);
    else if (role === 'control') await serve(role);
    else if (role === 'web') await serveWeb();
    else await runLocal();
  } catch (error) {
    console.error('Local service startup or shutdown failed. Check database readiness, port leases and operator configuration.',
      error instanceof Error && 'code' in error &&
        (error.code === 'EADDRINUSE' || error.code === 'LOCAL_DEMO_LOAD_FAILED') ? error.code : '');
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect?.();
  }
}
