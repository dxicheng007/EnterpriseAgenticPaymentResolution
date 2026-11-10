import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { readSyncReceipt } from '@eapr/parent/sync-store';
import { withTransaction } from '@eapr/storage/transaction';
import { buildLocalChildEnvironments } from '../../scripts/dev.js';
import type { DemoRoleSetup } from '../fixtures/demo-company-a-process.js';
import { assertWorkerSourcesModelFree, modelCredentialEnvNames, workerProductionImportGraph, workerSourceFiles } from '../fixtures/v5-ai-off.js';
import type { Pool } from 'pg';
import { expect, test } from 'vitest';
import { DemoCandidatesResponseSchema, IdSchema, RawSourceEventSchema, ReceiptResponseSchema, SafeIntegerSchema, hashSpec, strict } from '@eapr/contracts';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { composeDemoSource } from '../../apps/control/src/demo-source-composition.js';
import { launchControl } from '../../apps/control/src/server.js';
import { composeSourceSemantics } from '../../apps/control/src/source-semantics-composition.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { composeWorkerDemoSync } from '../../apps/worker/src/demo-sync-composition.js';
import { createParentReads } from '../../apps/worker/src/parent-reads.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { companyADemo as demo } from '../../packages/contracts/src/demo-company-a.js';
import { companyAGate, mountedCase } from '../../scripts/verify-demo-company-a-evidence.js';
import { migrate } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';
import { createSyncApplyFixture, syncApplyClock, type SyncApplyFixture } from '../fixtures/sync-apply.js';

const serviceToken = 'test-demo-service';
const sourceToken = 'test-demo-reader';
const operator = { enabled: true, token: 'test-demo-operator' } as const;
const payment = '/internal/demo/company-a/payment';
const sync = '/internal/demo/company-a/sync';
const financeFeed = '/internal/demo/company-a/changes/a-finance';

function post(origin: string, path: string, token?: string, body = '{}', extra: Record<string, string> = {}) {
  return fetch(origin + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }), ...extra }, body,
  });
}

async function fixture<T>(run: (data: SyncApplyFixture) => Promise<T>) {
  const data = await createSyncApplyFixture(undefined, undefined, { seed: demo.seed });
  try { return await run(data); } finally { await data.close(); }
}

async function controlServer(data: SyncApplyFixture, enabled = true) {
  const sourceReads: string[] = [];
  const app = await launchControl({
    db: data.dependencies.db, clock: data.dependencies.clock, expectedMigrations: [],
    workerClient: { getHealth: async () => { throw new Error('Unexpected health request'); } },
    featurePlugins: [
      async (control, services) => {
        control.addHook('onRequest', async request => {
          if (request.headers.authorization === 'Bearer ' + sourceToken) sourceReads.push(request.url);
        });
        control.register(composeDemoSource({
          source: data.source, sourceToken, serviceToken,
          operator: enabled ? { ...operator, dependencies: data.dependencies } : { enabled: false },
        }));
        control.register(composeSourceSemantics(data.dependencies, {
          catalog: localSourceCatalog, capability: { token: sourceToken, sourceRefs: [demo.sourceRef] },
        }).plugin, services);
      },
    ],
  }, 0);
  return { app, origin: app.listeningOrigin, sourceReads };
}

async function workerServer(data: SyncApplyFixture, origin: string, {
  db = data.db, enabled = true, loseResponse = false,
}: { db?: Pool; enabled?: boolean; loseResponse?: boolean } = {}) {
  const app = await launchWorker({
    db, clock: syncApplyClock, expectedMigrations: [], serviceToken,
    featurePlugins: [async (worker, services) => {
      if (loseResponse) {
        worker.addHook('onSend', async (request, reply) => {
          if (request.url === sync && reply.statusCode === 200) reply.raw.destroy();
        });
      }
      worker.register(composeWorkerDemoSync({
        registered: data.scopeReader, source: { origin, token: sourceToken },
        operator: enabled ? operator : { enabled: false },
      }), services);
    }],
  }, 0);
  return { app, origin: app.listeningOrigin };
}

function readParent(data: SyncApplyFixture, asOf: string) {
  return createParentReads(data.db, syncApplyClock, data.scopeReader).readParent(demo.scope.accountId, { asOf });
}

test('private HTTP applies the fixed source events once and recovers a lost worker response', () => fixture(async data => {
  const control = await controlServer(data);
  try {
    const worker = await workerServer(data, control.origin, { loseResponse: true });
    let receiptId: string;
    try {
      const before = await readParent(data, demo.scenario.observedAt);
      expect(before.balanceCents).toBe(80000);
      for (const token of [undefined, sourceToken, serviceToken]) {
        expect((await post(control.origin, payment, token, 'malformed')).status).toBe(401);
        expect((await post(worker.origin, sync, token, 'malformed')).status).toBe(401);
      }
      expect((await post(control.origin, payment, operator.token, '{}', { 'x-eapr-csrf': 'reviewer' })).status).toBe(401);
      expect((await post(control.origin, payment + '?amount=1', operator.token)).status).toBe(400);
      expect((await post(control.origin, payment, operator.token, '{"amount":"1.00"}')).status).toBe(400);
      expect((await post(worker.origin, sync, operator.token, '{"accountId":"other"}')).status).toBe(400);
      const feed = await fetch(control.origin + financeFeed + '?after=0', { headers: { authorization: 'Bearer ' + operator.token } });
      expect(feed.status).toBe(401);
      expect((await data.dependencies.db.query('SELECT 1 FROM source_events WHERE event_id = ANY($1)', [demo.eventIds])).rowCount).toBe(0);
      expect((await data.db.query('SELECT 1 FROM runtime_sync_receipts')).rowCount).toBe(0);
      expect(await readParent(data, demo.scenario.observedAt)).toEqual(before);
      const injected = await post(control.origin, payment, operator.token);
      expect(injected.status).toBe(200);
      expect(injected.headers.get('cache-control')).toBe('no-store');
      expect(await injected.json()).toEqual({ sourceRef: 'legacy-a', eventIds: [...demo.eventIds] });
      expect(await readParent(data, demo.scenario.observedAt)).toEqual(before);

      await expect(post(worker.origin, sync, operator.token)).rejects.toThrow('fetch failed');
      const receipts = await data.db.query<{ receipt_id: string }>('SELECT receipt_id FROM runtime_sync_receipts');
      expect(receipts.rowCount).toBe(1);
      receiptId = receipts.rows[0]!.receipt_id;
      expect(control.sourceReads).toEqual(expect.arrayContaining([
        expect.stringMatching(/^\/internal\/demo\/company-a\/changes\/a-finance\?after=\d+$/),
        expect.stringMatching(/^\/internal\/demo\/company-a\/changes\/a-semantics\?after=\d+$/),
        '/internal/sources/legacy-a/semantics',
      ]));
      expect(await readParent(data, demo.scenario.observedAt)).toMatchObject({ balanceCents: 50000, version: before.version + 1 });
      const cutover = await readParent(data, demo.cutover);
      expect(cutover).toMatchObject({ balanceCents: 80000 });
    } finally { await worker.app.close(); }

    const reconstructed = await workerServer(data, control.origin);
    try {
      expect((await post(control.origin, payment, operator.token)).status).toBe(200);
      const reads = control.sourceReads.length;
      const retry = await post(reconstructed.origin, sync, operator.token);
      expect(retry.status).toBe(200);
      expect(retry.headers.get('cache-control')).toBe('no-store');
      expect(ReceiptResponseSchema.parse(await retry.json())).toMatchObject({
        replayed: true, receipt: { id: receiptId, beforeBalanceCents: 80000, afterBalanceCents: 50000, eventIds: [...demo.eventIds] },
      });
      expect(control.sourceReads).toHaveLength(reads);
      expect((await data.db.query('SELECT 1 FROM runtime_sync_receipts')).rowCount).toBe(1);
      expect((await data.dependencies.db.query('SELECT 1 FROM source_events WHERE event_id = ANY($1)', [demo.eventIds])).rowCount).toBe(2);
    } finally { await reconstructed.app.close(); }
  } finally { await control.app.close(); }
}), 120_000);

test('disabled and unapproved private commands cannot write parent state', () => fixture(async data => {
  const disabledControl = await controlServer(data, false);
  try {
    const disabledWorker = await workerServer(data, disabledControl.origin, { enabled: false });
    try {
      expect((await post(disabledControl.origin, payment, operator.token)).status).toBe(404);
      expect((await post(disabledWorker.origin, sync, operator.token)).status).toBe(404);
    } finally { await disabledWorker.app.close(); }
  } finally { await disabledControl.app.close(); }

  const namespace = testNamespace('unapproved');
  const pair = await provisionTest(namespace);
  const db = createRuntimeDb({ connectionString: pair.runtime.appUrl });
  try {
    await migrate(pair, ['runtime']);
    const control = await controlServer(data);
    try {
      const worker = await workerServer(data, control.origin, { db });
      try {
        expect((await post(control.origin, payment, operator.token)).status).toBe(200);
        const result = await post(worker.origin, sync, operator.token);
        expect(result.status).toBe(404);
        expect(await result.json()).toMatchObject({ code: 'AUTHORITY_NOT_FOUND' });
        expect(control.sourceReads).toEqual([]);
        expect((await db.query('SELECT 1 FROM parent_targets')).rowCount).toBe(0);
        expect((await db.query('SELECT 1 FROM runtime_sync_receipts')).rowCount).toBe(0);
      } finally { await worker.app.close(); }
    } finally { await control.app.close(); }
  } finally { await db.end(); await dropTest(namespace); }
}), 120_000);

test('foreign source events remain in the real feed and block the fixed apply', () => fixture(async data => {
  const control = await controlServer(data);
  try {
    const worker = await workerServer(data, control.origin);
    try {
      const before = await readParent(data, demo.scenario.observedAt);
      expect((await post(control.origin, payment, operator.token)).status).toBe(200);
      const foreign = await data.addInvoice('demo-foreign-http', 'cust-a-d22feb38e846-2');
      const result = await post(worker.origin, sync, operator.token);
      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({ code: 'SYNC_COVERAGE_UNSUPPORTED' });
      expect((await data.db.query('SELECT 1 FROM runtime_sync_receipts')).rowCount).toBe(0);
      expect((await data.db.query('SELECT 1 FROM runtime_deliveries WHERE event_id = $1', [foreign[0]!.id])).rowCount).toBe(1);
      expect(await readParent(data, demo.scenario.observedAt)).toEqual(before);
    } finally { await worker.app.close(); }
  } finally { await control.app.close(); }
}), 120_000);

const mountObservationSchema = strict({
  mountedHttpPathProtected: z.literal(true),
  sourceRead: z.boolean(), semanticsRead: z.boolean(), interruptedBeforeApply: z.boolean(),
});

const cliReceiptSchema = strict({
  receiptId: IdSchema, replayed: z.boolean(), beforeBalanceCents: SafeIntegerSchema, afterBalanceCents: SafeIntegerSchema,
});

function waitForChildMessage<T>(child: ChildProcess, match: (message: unknown) => message is T): Promise<T> {
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      child.off('exit', fail);
      child.off('error', fail);
      child.off('message', receive);
    }
    function fail() {
      cleanup();
      reject(new Error('Demo child did not send its expected observation'));
    }
    function receive(message: unknown) {
      if (!match(message)) return;
      cleanup();
      resolve(message);
    }
    const timer = setTimeout(fail, 12_000);
    child.once('exit', fail);
    child.once('error', fail);
    child.on('message', receive);
  });
}

function spawnRole(role: DemoRoleSetup['role'], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/demo-company-a-process.ts', role], {
    env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  // Keep service output private and drain the pipes so child logging cannot block shutdown.
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}

async function stopRole(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(6_000) });
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3_000);
  try { await exited; } finally { clearTimeout(timer); }
}

async function startRole(setup: DemoRoleSetup, env: NodeJS.ProcessEnv) {
  const child = spawnRole(setup.role, env);
  try {
    const ready = waitForChildMessage(child, message => message === 'ready');
    const isolated = setup.role === 'worker'
      ? waitForChildMessage(child, message => message === 'isolation-ready')
      : undefined;
    child.send(setup, error => { if (error) child.kill('SIGTERM'); });
    await Promise.all([ready, isolated]);
    return child;
  } catch (error) {
    await stopRole(child);
    throw error;
  }
}

async function inspectWorker(child: ChildProcess) {
  const observed = waitForChildMessage(child, (message): message is z.infer<typeof mountObservationSchema> =>
    mountObservationSchema.safeParse(message).success);
  child.send('assert-isolation', error => { if (error) child.kill('SIGTERM'); });
  return mountObservationSchema.parse(await observed);
}

function executeDemoCli(controlPort: number, workerPort: number) {
  return new Promise<{ code: unknown; stdout: string; stderr: string }>(resolve => {
    execFile('npm', ['run', '--silent', 'demo:inject', '--', 'freshPaymentA'], {
      env: {
        PATH: process.env.PATH, DEMO_OPERATOR_TOKEN: operator.token,
        EAPR_CONTROL_PORT: String(controlPort), EAPR_WORKER_PORT: String(workerPort),
      }, timeout: 15_000,
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? (error ? -1 : 0), stdout, stderr }));
  });
}

function inspectMountedWorkerSources() {
  const workerRoot = 'apps/worker/src/';
  const entrypoints = ['demo-sync-composition', 'demo-source-client', 'source-semantics-client', 'sync-composition']
    .map(name => workerRoot + name + '.ts');
  assertWorkerSourcesModelFree(workerProductionImportGraph(entrypoints));

  // The helper follows relative imports only. Inspect the reached workspace package sources
  // and direct dependency declarations separately for this candidate's known HTTP path.
  const packages = ['contracts', 'sources', 'parent', 'storage', 'finance', 'compiler', 'evidence'];
  const files = [
    ...workerSourceFiles(),
    ...packages.flatMap(name => {
      const root = 'packages/' + name + '/src';
      return readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter(path => path.endsWith('.ts')).map(path => root + '/' + path);
    }),
  ];
  assertWorkerSourcesModelFree(files);
  const knownImports = new Set([
    ...packages.map(name => '@eapr/' + name),
    'csv-parse', 'csv-stringify', 'fastify', 'pdf-lib', 'pdfjs-dist', 'pg', 'zod',
    'node:crypto', 'node:fs', 'node:path', 'node:timers', 'node:url',
  ]);
  const fetchCallers: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const imports = [
      ...source.matchAll(/^(?:import|export) (?:[^'";]+?\bfrom\s*)?['"]([^'"\r\n]+)['"]/gm),
      ...source.matchAll(/\b(?:import|require)\(\s*['"]([^'"\r\n]+)['"]\s*\)/g),
    ];
    for (const [, specifier] of imports) {
      if (specifier!.startsWith('.')) continue;
      const module = specifier!.split('/').slice(0, specifier!.startsWith('@') ? 2 : 1).join('/');
      expect(knownImports.has(module), file + ' imports ' + module).toBe(true);
    }
    if (/\bfetch\s*\(/.test(source)) fetchCallers.push(file);
  }
  expect(fetchCallers.sort()).toEqual([
    workerRoot + 'authority-admission-client.ts', workerRoot + 'demo-source-client.ts', workerRoot + 'source-semantics-client.ts',
  ]);
  for (const file of ['package.json', 'package-lock.json', 'apps/worker/package.json',
    ...packages.map(name => 'packages/' + name + '/package.json')]) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/"[^"]*(?:\/|^)(?:openai|anthropic|axios|got|undici|node-fetch)"\s*:/im);
    expect(source, file).not.toMatch(/"(?:openai|anthropic|axios|got|undici|node-fetch|@openai\/[^"]+|@anthropic-ai\/[^"]+)"\s*:/);
  }
}

test('mounted worker source and dependency inventory stays within the inspected HTTP path', inspectMountedWorkerSources);

test('actual worker child rejects a leaked model credential before service readiness', async () => {
  const child = spawnRole('worker', { PATH: process.env.PATH, OPENAI_API_KEY: 'synthetic-model-sentinel' });
  try {
    const rejected = waitForChildMessage(child, message => message === 'worker-environment-rejected');
    const [, exited] = await Promise.all([rejected, once(child, 'exit')]);
    expect(exited).toEqual([1, null]);
  } finally { await stopRole(child); }
});

async function observeMountedCompanyA(data: SyncApplyFixture, collectObservation: boolean) {
  const { processSetup: setup, stored } = data;
  const controlPort = localPort('EAPR_CONTROL_PORT', 3241);
  const workerPort = localPort('EAPR_WORKER_PORT', 3242);
  const input = {
    path: process.env.PATH, operator, serviceToken, sourceReadToken: sourceToken, authorityAdmissionToken: 'test-demo-admission',
    controlPort, workerPort, webPort: 5182, runtimeDbUrl: data.pair.runtime.appUrl, controlDbUrl: data.pair.control.appUrl,
    sourceRefs: [...localSourceCatalog.values()].map(source => source.sourceRef),
    evidenceRoot: setup.evidenceRoot, captures: setup.captures, reviewSelectionFile: setup.selectionPath,
    verificationSetupCode: 'VERIFICATION_FIXTURE_SETUP_REQUIRED' as const,
  };
  expect(() => buildLocalChildEnvironments({ ...input, operator: { enabled: true, token: input.authorityAdmissionToken } })).toThrow('distinct');
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-model-sentinel';
  let env: ReturnType<typeof buildLocalChildEnvironments>;
  try {
    env = buildLocalChildEnvironments(input);
    for (const role of ['worker', 'control', 'web'] as const) {
      for (const name of modelCredentialEnvNames) expect(Object.hasOwn(env[role], name)).toBe(false);
    }
  } finally {
    if (prior === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prior;
  }
  expect(Object.keys(env.web).sort()).toEqual(['EAPR_CONTROL_PORT', 'EAPR_WEB_PORT', 'PATH']);
  expect(Object.hasOwn(env.worker, 'CONTROL_DATABASE_URL')).toBe(false);
  expect(Object.hasOwn(env.worker, 'EAPR_DEMO_EVIDENCE_ROOT')).toBe(false);
  expect(Object.hasOwn(env.control, 'RUNTIME_DATABASE_URL')).toBe(false);
  const disabled = buildLocalChildEnvironments({ ...input, operator: { enabled: false } });
  for (const role of ['worker', 'control'] as const) {
    expect(Object.hasOwn(disabled[role], 'DEMO_OPERATOR_TOKEN')).toBe(false);
    expect(Object.hasOwn(disabled[role], 'DEMO_OPERATOR_ENABLED')).toBe(false);
  }

  expect(data.identity.scope).toEqual(demo.scope);
  expect(stored.bundle.manifest.id).toBe(demo.manifestId);
  for (const id of demo.eventIds) expect(stored.bundle.snapshot.eventIds).not.toContain(id);
  const before = await readParent(data, demo.scenario.observedAt);
  expect(before.balanceCents).toBe(80000);
  expect((await data.dependencies.db.query('SELECT 1 FROM source_events WHERE event_id = ANY($1)', [demo.eventIds])).rowCount).toBe(0);

  const control = await startRole({ role: 'control', paths: setup.controlPaths }, env.control);
  const workerSetup = { role: 'worker', paths: setup.workerPaths } as const;
  try {
    const interrupted = await startRole({ ...workerSetup, interruptBeforeApply: true }, env.worker);
    try {
      const failure = await executeDemoCli(controlPort, workerPort);
      expect(failure.code).toBe(1);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toContain('Worker commit could not be confirmed');
      expect(await inspectWorker(interrupted)).toEqual({
        mountedHttpPathProtected: true, sourceRead: true, semanticsRead: true, interruptedBeforeApply: true,
      });
      expect(await readParent(data, demo.scenario.observedAt)).toEqual(before);
      expect((await data.db.query('SELECT 1 FROM runtime_sync_receipts')).rowCount).toBe(0);
      expect((await data.db.query('SELECT 1 FROM runtime_inbox WHERE event_id = ANY($1)', [demo.eventIds])).rowCount).toBe(2);
    } finally { await stopRole(interrupted); }

    const applying = await startRole(workerSetup, env.worker);
    let applied: z.infer<typeof cliReceiptSchema>;
    try {
      const result = await executeDemoCli(controlPort, workerPort);
      expect(result.code, result.stderr).toBe(0);
      applied = cliReceiptSchema.parse(JSON.parse(result.stdout));
      expect(applied).toMatchObject({ replayed: false, beforeBalanceCents: 80000, afterBalanceCents: 50000 });
      expect(await inspectWorker(applying)).toEqual({
        mountedHttpPathProtected: true, sourceRead: true, semanticsRead: true, interruptedBeforeApply: false,
      });
    } finally { await stopRole(applying); }

    const reconstructed = await startRole(workerSetup, env.worker);
    try {
      const retry = await executeDemoCli(controlPort, workerPort);
      expect(retry.code, retry.stderr).toBe(0);
      const replay = cliReceiptSchema.parse(JSON.parse(retry.stdout));
      expect(replay).toEqual({ ...applied, replayed: true });
      expect(await inspectWorker(reconstructed)).toEqual({
        mountedHttpPathProtected: true, sourceRead: false, semanticsRead: false, interruptedBeforeApply: false,
      });
      const saved = await data.db.query<{ plan_hash: string }>('SELECT plan_hash FROM runtime_sync_receipts');
      expect(saved.rowCount).toBe(1);
      expect((await data.db.query('SELECT 1 FROM runtime_sync_units')).rowCount).toBe(1);
      const savedReceipt = await withTransaction(data.db, client => readSyncReceipt(client, demo.scope, saved.rows[0]!.plan_hash));
      expect(savedReceipt).toMatchObject({
        id: applied.receiptId, activationId: data.identity.activationId, artifactHash: stored.bundle.artifact.hash,
        eventIds: [...demo.eventIds], beforeBalanceCents: 80000, afterBalanceCents: 50000,
      });
      expect((await data.dependencies.db.query('SELECT 1 FROM source_events WHERE event_id = ANY($1)', [demo.eventIds])).rowCount).toBe(2);
      const current = await readParent(data, demo.scenario.observedAt);
      expect(current).toMatchObject({ balanceCents: 50000, version: before.version + 1 });
      expect(current.records.payments.filter(payment => payment.sourceEventId === demo.eventIds[0]))
        .toMatchObject([{ amountCents: 30000 }]);
      expect(current.records.allocations.filter(allocation => allocation.sourceEventId === demo.eventIds[1]))
        .toMatchObject([{ amountCents: 30000 }]);
      const cutover = await readParent(data, demo.cutover);
      expect(cutover).toMatchObject({ balanceCents: 80000 });
      const approvedHash = stored.approvedTarget.snapshotHash;
      const historical = await createParentReads(data.db, syncApplyClock, data.scopeReader)
        .readParent(demo.scope.accountId, { asOf: demo.cutover, snapshotHash: approvedHash });
      expect(historical).toMatchObject({ balanceCents: 80000, snapshotHash: approvedHash, records: stored.approvedTarget.records });
      const original = await withTransaction(data.db, client => readStoredActivation(client, demo.scope));
      expect(original?.receipt).toEqual(stored.receipt);
      expect(original?.approvedTarget).toEqual(stored.approvedTarget);
      if (!collectObservation) return;
      const { activation, bundle, receipt: initial } = stored;
      const { artifact, manifest, reviewPackage } = bundle;
      const profile = bundle.profiles.find(profile => profile.hash === activation.profileHash);
      expect(profile).toMatchObject({ id: demo.profileId, version: demo.profileVersion, parentCustomerId: demo.parentCustomerId });
      expect(activation).toMatchObject({
        id: data.identity.activationId, scope: demo.scope, epoch: 1, status: 'active',
        artifactHash: artifact.hash, profileHash: reviewPackage.profileHash, manifestHash: manifest.hash,
      });
      expect(reviewPackage.manifestHash).toBe(manifest.hash);
      expect(initial).toMatchObject({
        scope: demo.scope, activationId: activation.id, epoch: activation.epoch,
        artifactHash: activation.artifactHash, afterBalanceCents: before.balanceCents,
      });
      expect(original?.activation).toEqual(activation);
      expect(savedReceipt).toMatchObject({ scope: demo.scope, epoch: activation.epoch,
        beforeBalanceCents: before.balanceCents, afterBalanceCents: current.balanceCents });
      expect(savedReceipt!.id).not.toBe(initial.id);

      const events = await data.dependencies.db.query<{ event: unknown }>(
        'SELECT event FROM source_events WHERE source_ref = $1 AND event_id = ANY($2) ORDER BY sequence',
        [demo.sourceRef, demo.eventIds],
      );
      const source = events.rows.map(row => RawSourceEventSchema.parse(row.event));
      expect(source.map(({ id, recordId, effectiveAt, observedAt }) => ({ id, recordId, effectiveAt, observedAt })))
        .toEqual(demo.eventIds.map((id, i) => ({
          id, recordId: demo.recordIds[i], effectiveAt: demo.scenario.observedAt, observedAt: demo.scenario.observedAt,
        })));
      const payment = current.records.payments.find(record => record.sourceEventId === demo.eventIds[0])!;
      const allocation = current.records.allocations.find(record => record.sourceEventId === demo.eventIds[1])!;
      expect(allocation.fundingRecordId).toBe(payment.id);
      expect(savedReceipt!.targetRecordIds).toEqual(expect.arrayContaining([payment.id, allocation.id]));
      expect(savedReceipt!.targetRecordIds).toHaveLength(2);

      const controlOrigin = 'http://127.0.0.1:' + controlPort;
      const webOrigin = 'http://127.0.0.1:' + input.webPort;
      const opened = await post(controlOrigin, '/api/local-session', undefined, '{}', { origin: webOrigin, 'x-eapr-local-ui': '1' });
      expect(opened.status).toBe(200);
      await opened.body?.cancel();
      const cookie = opened.headers.getSetCookie()[0]?.split(';')[0];
      expect(cookie).toBeTruthy();
      const catalogResponse = await fetch(controlOrigin + '/api/demo/candidates', {
        headers: { cookie: cookie! }, redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      expect(catalogResponse.status).toBe(200);
      const catalog = DemoCandidatesResponseSchema.parse(await catalogResponse.json());
      const candidate = catalog.candidates.find(item => item.id === demo.candidateId);
      expect(catalog).toMatchObject({ mode: 'development-fixture', targetMode: 'persisted-parent' });
      expect(candidate).toMatchObject({
        scope: activation.scope, sourceRef: manifest.sourceRef, snapshotId: bundle.snapshot.id,
        request: { spec: { id: demo.connectorId, version: demo.connectorVersion }, profiles: [profile] },
      });
      const spec = candidate!.request.spec;
      expect(hashSpec(spec)).toBe(artifact.specHash);

      return {
        schemaVersion: 1, gate: companyAGate, test: mountedCase,
        constructionMode: catalog.mode, targetMode: catalog.targetMode, seed: demo.seed,
        scope: activation.scope, parentCustomerId: profile!.parentCustomerId, sourceRef: manifest.sourceRef,
        manifestId: manifest.id, manifestHash: activation.manifestHash, artifactHash: activation.artifactHash,
        profileHash: activation.profileHash, profileId: profile!.id, profileVersion: profile!.version,
        candidateId: candidate!.id, specId: spec.id, specVersion: spec.version,
        activation: {
          activationId: activation.id, initialReceiptId: initial.id, epoch: activation.epoch,
          initialAfterBalanceCents: initial.afterBalanceCents,
        },
        sync: {
          receiptId: savedReceipt!.id, activationId: savedReceipt!.activationId, epoch: savedReceipt!.epoch,
          artifactHash: savedReceipt!.artifactHash, replayed: applied.replayed,
          beforeBalanceCents: savedReceipt!.beforeBalanceCents, afterBalanceCents: savedReceipt!.afterBalanceCents,
          replayReceiptId: replay.receiptId,
        },
        sourceEventIds: savedReceipt!.eventIds, paymentId: payment.identity.recordId, allocationId: allocation.identity.recordId,
        amountCents: payment.amountCents, effectiveDate: source[0]!.effectiveAt.slice(0, 10), observedAt: source[0]!.observedAt,
        parent: {
          currentAsOf: current.asOf, currentBalanceCents: current.balanceCents, cutoverAsOf: cutover.asOf,
          cutoverBalanceCents: cutover.balanceCents, beforeVersion: before.version, afterVersion: current.version,
          approvedSnapshotHash: historical.snapshotHash,
        },
        assertions: {
          baselineExcludesInjectedEvents: true, sameApproval: true, onePaymentAndAllocation: true,
          approvedSnapshotUnchanged: true, receiptMatchesStoredParent: true, actualSupervisorMount: true, privateBoundary: true,
        },
      };

    } finally { await stopRole(reconstructed); }
  } finally { await stopRole(control); }
}

test(mountedCase, async () => {
  const path = process.env.EAPR_COMPANY_A_OBSERVATION;
  const runToken = process.env.EAPR_COMPANY_A_RUN_TOKEN;
  const collectObservation = path !== undefined || runToken !== undefined;
  const observation = await fixture(data => observeMountedCompanyA(data, collectObservation));
  if (!collectObservation) return;
  expect(observation).toBeDefined();
  expect(path).toBeTruthy();
  expect(runToken).toMatch(/^[0-9a-f]{64}$/);
  // The worker's isolation-ready handshake requires credential absence and forbidden-fetch controls.
  // Its final IPC assertions require those credentials and the guard/trap to stay unchanged.
  inspectMountedWorkerSources();
  writeFileSync(path!, JSON.stringify({
    ...observation, runToken,
    runtimeIsolation: {
      credentialsAbsent: true, modelFreeWorkerImports: true, mountedHttpPathProtected: true, positiveControlPassed: true,
    },
  }), { mode: 0o600, flag: 'wx' });
}, 120_000);
