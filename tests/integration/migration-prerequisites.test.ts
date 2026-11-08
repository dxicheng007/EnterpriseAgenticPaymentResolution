import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { expect, test } from 'vitest';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { probeMigration } from '../../packages/storage/src/transaction.js';
import { migrate, migrationIdentities, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb, testLeasePrefix } from '../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import { emptyTargetB, profileB } from '../fixtures/index.js';

test('the harness mounts injected read routes against its actual control service', async () => {
  let receivedDb: unknown;
  const system = await createTestSystem({
    modelMode: 'disabled',
    dbNamespace: testNamespace('plugins'),
    controlPluginFactory: async services => {
      receivedDb = services.db;
      return [async app => {
        app.post('/api/domain-check', async request => ({ accepted: request.body }));
      }];
    },
  });
  try {
    const response = await fetch('http://127.0.0.1:' + (process.env.EAPR_CONTROL_PORT ?? '3001') + '/api/domain-check', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"value":7}',
    });
    expect(response.status).toBe(200);
    expect(receivedDb).toBe(system.db.control);
    expect(await system.control.request('/api/domain-check', { method: 'POST', body: { value: 7 } })).toEqual({
      status: 200, body: { accepted: { value: 7 } },
    });
    await expect(system.control.request('/api/../internal/health')).rejects.toThrow(/path/i);
    await expect(system.control.request('https://example.com/api/domain-check')).rejects.toThrow(/path/i);
  } finally {
    await system.close();
  }
});

test('numbered migration application is serialized, atomic per migration and checksum-pinned', async () => {
  await startNativeDb();
  const namespace = testNamespace('migrations');
  const pair = await provisionTest(namespace);
  const directory = await mkdtemp(join(tmpdir(), 'eapr-migration-test-'));
  const root = pathToFileURL(directory + '/');
  const app = createControlDb({ connectionString: pair.control.appUrl });
  const admin = new Client({ connectionString: pair.control.migrationUrl });
  const sql2 = 'CREATE TABLE scoped_check (id integer); GRANT SELECT ON scoped_check TO :app_role;';
  const write2 = (sql: string) => writeFile(join(directory, 'control/002_scoped.sql'), sql);
  const write3 = (sql: string) => writeFile(join(directory, 'control/003_checked.sql'), sql);

  try {
    const base = readMigrationCatalog({ throughVersion: 1 });
    await cp(new URL('../../db/', import.meta.url), directory, { recursive: true, filter: source =>
      !source.endsWith('.sql') || source.endsWith('001_base.sql'),
    });
    await write2(sql2);
    await write3('CREATE TABLE rolled_back (id integer); SELECT 1 / 0;');
    const first = readMigrationCatalog({ root });
    await migrate(pair, ['control'], base);
    const identities = migrationIdentities(first.control);
    await expect(probeMigration(app, identities)).resolves.toEqual({
      status: 'not_ready', database: 'migration_required', migrationVersion: 1,
    });
    await expect(migrate(pair, ['control'], first)).rejects.toMatchObject({ code: '22012' });
    await expect(app.query("SELECT to_regclass('rolled_back') AS rolled_back")).resolves.toMatchObject({
      rows: [{ rolled_back: null }],
    });
    await expect(app.query('SELECT version, sha256 FROM migration_ledger ORDER BY version')).resolves.toMatchObject({
      rows: identities.slice(0, 2),
    });
    await expect(app.query('SELECT id FROM scoped_check')).resolves.toMatchObject({ rows: [] });
    await expect(app.query('INSERT INTO scoped_check VALUES (1)')).rejects.toMatchObject({ code: '42501' });
    await expect(probeMigration(app, identities)).resolves.toMatchObject({ status: 'not_ready', migrationVersion: 2 });

    await write3('CREATE TABLE private_check (id integer);');
    const final = readMigrationCatalog({ root });
    await Promise.all([migrate(pair, ['control'], final), migrate(pair, ['control'], final)]);
    const expected = migrationIdentities(final.control);
    await expect(probeMigration(app, expected)).resolves.toEqual({
      status: 'ready', database: 'ready', migrationVersion: 3,
    });
    await expect(app.query('SELECT id FROM private_check')).rejects.toMatchObject({ code: '42501' });
    await expect(probeMigration(app, expected.slice(0, 2))).resolves.toMatchObject({ status: 'not_ready' });
    await expect(migrate(pair, ['control'], base)).rejects.toThrow('Migration ledger mismatch');

    await write2(sql2 + '\n');
    const changed = readMigrationCatalog({ root });
    await expect(probeMigration(app, migrationIdentities(changed.control))).resolves.toMatchObject({ status: 'not_ready' });
    await expect(migrate(pair, ['control'], changed)).rejects.toThrow('Migration ledger mismatch');
    await write2(sql2);

    await admin.connect();
    await admin.query('DELETE FROM migration_ledger WHERE version = 2');
    await expect(migrate(pair, ['control'], final)).rejects.toThrow('Migration ledger mismatch');
    await writeFile(join(directory, 'control/002_duplicate.sql'), 'SELECT 1;');
    expect(() => readMigrationCatalog({ root })).toThrow(/duplicate migration/);
  } finally {
    await Promise.all([app.end(), admin.end()]);
    await rm(directory, { recursive: true, force: true });
    await dropTest(namespace);
  }
});

test('database test operations enforce the active lease and B uses its separate empty target', async () => {
  const foreign = testLeasePrefix() === 'eapr_test_t2' ? 'eapr_test_t1_foreign' : 'eapr_test_t2_foreign';
  await expect(provisionTest(foreign)).rejects.toThrow('Unsafe test database namespace');
  await expect(dropTest(foreign)).rejects.toThrow('Unsafe test database namespace');
  expect(emptyTargetB).toMatchObject({
    scope: profileB.scope, version: 0, invoices: [], payments: [], credits: [], allocations: [], reversals: [],
  });
});
