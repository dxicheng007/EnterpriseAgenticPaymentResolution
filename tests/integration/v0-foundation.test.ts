import { randomBytes } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Client } from 'pg';
import { beforeAll, expect, test } from 'vitest';
import { createWorkerClient, launchControl } from '../../apps/control/src/server.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { decodeUiCursor, encodeUiCursor, type ActivityInput } from '../../packages/contracts/src/activity.js';
import { publishActivity, readActivity } from '../../packages/storage/src/activity.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../../packages/storage/src/runtime-db.js';
import { withTransaction } from '../../packages/storage/src/transaction.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb, stopNativeDb, type DatabasePair } from '../../scripts/native-db.js';
import { seed } from '../../scripts/seed.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

beforeAll(startNativeDb);
const baseMigrations = readMigrationCatalog({ throughVersion: 1 });
const migrateBase = (pair: DatabasePair, streams: Parameters<typeof migrate>[1] = migrationStreams) =>
  migrate(pair, streams, baseMigrations);
const clock = () => new Date('2026-11-08T00:00:00.000Z');
const controlPort = localPort('EAPR_CONTROL_PORT', 3001);
const workerPort = localPort('EAPR_WORKER_PORT', 3002);
const controlUrl = 'http://127.0.0.1:' + controlPort;
const workerUrl = 'http://127.0.0.1:' + workerPort;

async function withDatabases(label: string, fn: (pair: DatabasePair) => Promise<void>) {
  const namespace = testNamespace(label);
  const pair = await provisionTest(namespace);
  try {
    await fn(pair);
  } finally {
    await dropTest(namespace);
  }
}
const controlEvent = (eventId: string): ActivityInput => ({
  stream: 'control', phase: 'build', type: 'system.status', at: clock().toISOString(),
  payload: { eventId, status: 'ready' },
});

test('public health requires both real migrations and reaches worker over authenticated HTTP', async () => {
  await withDatabases('health', async pair => {
    const controlDb = createControlDb({ connectionString: pair.control.appUrl });
    const runtimeDb = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    const serviceToken = randomBytes(32).toString('hex');
    const workerClient = createWorkerClient(workerUrl, serviceToken);
    const worker = await launchWorker({ db: runtimeDb, serviceToken, clock, expectedMigrations: migrationIdentities(baseMigrations.runtime) }, workerPort);
    const control = await launchControl({ db: controlDb, workerClient, clock, expectedMigrations: migrationIdentities(baseMigrations.control) }, controlPort);
    const getHealth = async () => {
      const response = await fetch(controlUrl + '/api/health');
      return { status: response.status, body: await response.json() };
    };
    try {
      const unauthenticated = await fetch(workerUrl + '/internal/health');
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toMatchObject({ code: 'SERVICE_UNAUTHORIZED' });
      expect(await getHealth()).toMatchObject({
        status: 503, body: {
          status: 'not_ready', controlDb: 'migration_required', runtimeDb: 'migration_required',
          migrationVersions: { control: null, runtime: null },
        },
      });
      await migrateBase(pair, ['control']);
      expect(await getHealth()).toMatchObject({
        status: 503, body: {
          status: 'not_ready', controlDb: 'ready', runtimeDb: 'migration_required',
          migrationVersions: { control: 1, runtime: null },
        },
      });
      await migrateBase(pair, ['runtime']);
      await migrateBase(pair); // Reapplication checks the immutable migration ledger.
      expect(await getHealth()).toEqual({
        status: 200, body: {
          status: 'ready', controlDb: 'ready', runtimeDb: 'ready',
          migrationVersions: { control: 1, runtime: 1 }, diagnostics: [],
        },
      });
      await worker.close();
      expect(await getHealth()).toMatchObject({
        status: 503, body: {
          status: 'not_ready', controlDb: 'ready', runtimeDb: 'unavailable',
          migrationVersions: { control: 1, runtime: null }, diagnostics: [{ code: 'RUNTIME_UNAVAILABLE' }],
        },
      });
    } finally {
      await Promise.allSettled([control.close(), worker.close()]);
      await Promise.all([controlDb.end(), runtimeDb.end()]);
    }
  });
});

test('both service roles are denied cross-database CONNECT and DDL', async () => {
  await withDatabases('roles', async pair => {
    await migrateBase(pair);
    for (const [own, other] of [[pair.control, pair.runtime], [pair.runtime, pair.control]]) {
      const local = new Client({ connectionString: own.appUrl });
      const wrong = new URL(own.appUrl);
      wrong.pathname = '/' + other.name;
      const remote = new Client({ connectionString: wrong.href });
      try {
        await local.connect();
        await expect(local.query('SELECT version FROM migration_ledger')).resolves.toMatchObject({ rows: [{ version: 1 }] });
        await expect(local.query('CREATE TABLE unexpected (id integer)')).rejects.toMatchObject({ code: '42501' });
        await expect(local.query('CREATE SCHEMA unexpected')).rejects.toMatchObject({ code: '42501' });
        await expect(local.query('CREATE TEMP TABLE unexpected (id integer)')).rejects.toMatchObject({ code: '42501' });
        await expect(local.query('ALTER TABLE activity_events ADD COLUMN unexpected integer')).rejects.toMatchObject({ code: '42501' });
        await expect(remote.connect()).rejects.toMatchObject({ code: '42501' });
      } finally {
        await Promise.all([local.end(), remote.end()]);
      }
    }
  });
});

test('seed twice preserves one version in each database and committed activity survives native restart', async () => {
  await withDatabases('restart', async pair => {
    await migrateBase(pair);
    await seed(pair, clock);
    await seed(pair, clock);
    const controlDb = createControlDb({ connectionString: pair.control.appUrl });
    const runtimeDb = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    let saved;
    try {
      for (const pool of [controlDb, runtimeDb]) {
        expect((await pool.query('SELECT version FROM seed_ledger')).rows).toEqual([{ version: 1 }]);
        expect((await readActivity(pool, 0, 10)).map(event => event.type)).toEqual(['system.seeded']);
      }
      saved = await withTransaction(controlDb, client => publishActivity(client, {
        ...controlEvent('durable-status'),
        payload: {
          status: 'ready', eventId: 'durable-status', count: 1,
          credential: 'forbidden-demo-marker', path: '/private/example',
          toolName: '/private/example', raw: { expected: 9 },
        },
      }));
      expect(saved.payload).toEqual({ status: 'ready', eventId: 'durable-status', count: 1 });
    } finally {
      await Promise.all([controlDb.end(), runtimeDb.end()]);
    }
    stopNativeDb();
    await startNativeDb();
    const reconstructed = createControlDb({ connectionString: pair.control.appUrl });
    try {
      expect(await readActivity(reconstructed, 1, 10)).toEqual([saved]);
      const runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
      const token = randomBytes(32).toString('hex');
      const worker = await launchWorker({ db: runtime, serviceToken: token, clock, expectedMigrations: migrationIdentities(baseMigrations.runtime) }, workerPort);
      const control = await launchControl({
        db: reconstructed, workerClient: createWorkerClient(workerUrl, token), clock,
        expectedMigrations: migrationIdentities(baseMigrations.control),
      }, controlPort);
      try {
        expect((await fetch(controlUrl + '/api/health')).status).toBe(200);
      } finally {
        await Promise.all([worker.close(), control.close()]);
        await runtime.end();
      }
    } finally {
      await reconstructed.end();
    }
  });
});

test('rollback discards an activity insert and its sequence increment', async () => {
  await withDatabases('rollback', async pair => {
    await migrateBase(pair);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    try {
      await expect(withTransaction(db, async client => {
        await publishActivity(client, controlEvent('rolled-back'));
        throw new Error('deliberate rollback');
      })).rejects.toThrow('deliberate rollback');
      expect(await readActivity(db, 0, 10)).toEqual([]);
      const committed = await withTransaction(db, client => publishActivity(client, controlEvent('committed')));
      expect(committed.sequence).toBe(1);
      expect((await readActivity(db, 0, 10)).map(event => event.payload.eventId)).toEqual(['committed']);
    } finally {
      await db.end();
    }
  });
});

function barrier<T = void>() {
  return Promise.withResolvers<T>();
}

test('transaction start order cannot cause reconnect to lose a later committed publication', async () => {
  await withDatabases('reconnect', async pair => {
    await migrateBase(pair);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    const started = barrier();
    const release = barrier();
    const first = withTransaction(db, async client => {
      started.resolve();
      await release.promise;
      return publishActivity(client, controlEvent('starts-first'));
    });
    try {
      await started.promise;
      await withTransaction(db, client => publishActivity(client, controlEvent('commits-first')));
      const observed = await readActivity(db, 0, 10);
      expect(observed.map(event => [event.sequence, event.payload.eventId])).toEqual([[1, 'commits-first']]);
      const saved = encodeUiCursor({ v: 1, controlCursor: observed[0].sequence, runtimeCursor: 0 });
      release.resolve();
      const last = await first;
      const highWater = { v: 1 as const, controlCursor: last.sequence, runtimeCursor: 0 };
      const resumed = decodeUiCursor(saved, highWater);
      expect((await readActivity(db, resumed.controlCursor, 10)).map(event => [event.sequence, event.payload.eventId]))
        .toEqual([[2, 'starts-first']]);
      expect(() => decodeUiCursor(encodeUiCursor({ ...highWater, controlCursor: 3 }), highWater))
        .toThrow('Invalid activity cursor');
      await expect(readActivity(db, 3, 10)).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    } finally {
      release.resolve();
      await Promise.allSettled([first]);
      await db.end();
    }
  });
});

test('a waiting publisher cannot commit while another transaction holds the counter lock', async () => {
  await withDatabases('lock', async pair => {
    await migrateBase(pair);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    const locked = barrier<number>();
    const waiting = barrier<number>();
    const release = barrier();
    const first = withTransaction(db, async client => {
      const { rows: [{ pid }] } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const event = await publishActivity(client, controlEvent('holds-lock'));
      locked.resolve(pid);
      await release.promise;
      return event;
    });
    let second: Promise<unknown> | undefined;
    try {
      const holder = await locked.promise;
      const contending = withTransaction(db, async client => {
        const { rows: [{ pid }] } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        waiting.resolve(pid);
        return publishActivity(client, controlEvent('waits-for-lock'));
      });
      second = contending;
      const waiter = await waiting.promise;
      const deadline = performance.now() + 5000;
      for (;;) {
        const { rows: [{ blocked }] } = await db.query<{ blocked: boolean }>(
          'SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked', [holder, waiter],
        );
        if (blocked) break;
        if (performance.now() > deadline) throw new Error('Publisher did not wait on the activity counter row');
        await nextTurn();
      }
      expect(await readActivity(db, 0, 10)).toEqual([]);
      release.resolve();
      expect((await first).sequence).toBe(1);
      expect((await contending).sequence).toBe(2);
      expect((await readActivity(db, 0, 10)).map(event => event.payload.eventId)).toEqual(['holds-lock', 'waits-for-lock']);
    } finally {
      release.resolve();
      await Promise.allSettled(second ? [first, second] : [first]);
      await db.end();
    }
  });
});

test('serialization failures retry the whole transaction at most three times', async () => {
  await withDatabases('retries', async pair => {
    await migrateBase(pair);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    let attempts = 0;
    try {
      await expect(withTransaction(db, async client => {
        attempts++;
        await publishActivity(client, controlEvent('uncommitted'));
        await client.query("DO $$ BEGIN RAISE EXCEPTION 'forced' USING ERRCODE = '40001'; END $$");
      })).rejects.toMatchObject({ code: '40001' });
      expect(attempts).toBe(3);
      expect(await readActivity(db, 0, 10)).toEqual([]);
    } finally {
      await db.end();
    }
  });
});

test('deterministic harness runs without a provider and fails unavailable capabilities explicitly', async () => {
  const system = await createTestSystem({ modelMode: 'disabled', dbNamespace: testNamespace('harness'), migrationThroughVersion: 1 });
  try {
    expect(await system.control.getHealth()).toMatchObject({ status: 200 });
    await expect(system.sourceAdmin.inject('anything')).rejects.toMatchObject({ code: 'FEATURE_NOT_IMPLEMENTED' });
    await expect(createTestSystem({ modelMode: 'live', dbNamespace: testNamespace('live') })).rejects.toThrow(/unavailable/);
  } finally {
    await system.close();
  }
});
