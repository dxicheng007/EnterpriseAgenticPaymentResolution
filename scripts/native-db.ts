import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const local = resolve('.local');
const dataDir = resolve(local, 'pgdata');
const configPath = resolve(local, 'env');
const demoNamespace = process.env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0';
if (!/^eapr_(?:review_)?(?:v0|t1|t2)$/.test(demoNamespace)) throw new Error('Unsafe demo database namespace');
const bootstrapRole = 'eapr_v0_bootstrap';
const port = localPort('EAPR_PG_PORT', 55432);

export function localPort(name: string, fallback: number): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Invalid local port: ' + name);
  return value;
}

type Credentials = { bootstrap: string; migrator: string; control: string; runtime: string };
type Database = { name: string; appRole: string; appUrl: string; migrationUrl: string };
export type DatabasePair = { control: Database; runtime: Database };

const randomPassword = () => randomBytes(32).toString('hex');
const newCredentials = (): Credentials => ({
  bootstrap: randomPassword(), migrator: randomPassword(), control: randomPassword(), runtime: randomPassword(),
});
function readCredentials(): Credentials {
  if ((statSync(configPath).mode & 0o777) !== 0o600) throw new Error('Local credential file must have mode 0600');
  const parsed: Credentials = JSON.parse(readFileSync(configPath, 'utf8'));
  if ([parsed.bootstrap, parsed.migrator, parsed.control, parsed.runtime].some(value => !/^[a-f0-9]{64}$/.test(value))) {
    throw new Error('Local credential file is invalid');
  }
  return parsed;
}

function pgUrl(role: string, password: string, db: string) {
  return 'postgresql://' + role + ':' + password + '@127.0.0.1:' + port + '/' + db;
}

function identifier(name: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('Invalid local PostgreSQL identifier');
  return '"' + name + '"';
}

function pair(namespace: string, credentials: Credentials): DatabasePair {
  const migrator = namespace + '_migrator';
  function database(stream: 'control' | 'runtime'): Database {
    const name = namespace + '_' + stream;
    const appRole = name + '_app';
    return { name, appRole, appUrl: pgUrl(appRole, credentials[stream], name), migrationUrl: pgUrl(migrator, credentials.migrator, name) };
  }
  return { control: database('control'), runtime: database('runtime') };
}

export const getDemoPair = () => pair(demoNamespace, readCredentials());

function adminClient() {
  return new Client({ connectionString: pgUrl(bootstrapRole, readCredentials().bootstrap, 'postgres'), connectionTimeoutMillis: 2000 });
}

function pgCommand(command: string, args: string[], allowFailure = false) {
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 30_000 });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(command + ' failed. Check PostgreSQL 18 on PATH, local cluster ownership, and leased port ' + port);
  }
  return result.status;
}

export async function startNativeDb() {
  mkdirSync(local, { recursive: true, mode: 0o700 });
  if (pgCommand('pg_ctl', ['status', '-D', dataDir], true) !== 0) {
    if (!existsSync(configPath)) {
      writeFileSync(configPath, JSON.stringify(newCredentials()), { flag: 'wx', mode: 0o600 });
    }
    if (!existsSync(resolve(dataDir, 'PG_VERSION'))) {
      const passwordFile = resolve(local, 'bootstrap-pw');
      writeFileSync(passwordFile, readCredentials().bootstrap + '\n', { flag: 'wx', mode: 0o600 });
      try {
        pgCommand('initdb', ['-D', dataDir, '-U', bootstrapRole, '--auth-local=scram-sha-256',
          '--auth-host=scram-sha-256', '--pwfile=' + passwordFile, '--encoding=UTF8', '--locale=C']);
      } finally {
        rmSync(passwordFile, { force: true });
      }
    }
    // No Unix socket or global service. PostgreSQL rejects a leased TCP port collision.
    pgCommand('pg_ctl', ['start', '-w', '-t', '20', '-D', dataDir, '-l', resolve(local, 'postgres.log'),
      '-o', "-h 127.0.0.1 -p " + port + " -c unix_socket_directories='' -c password_encryption=scram-sha-256 -c log_min_error_statement=panic"]);
  }
  const runningPort = Number(readFileSync(resolve(dataDir, 'postmaster.pid'), 'utf8').split('\n')[3]);
  if (runningPort !== port) throw new Error('Local PostgreSQL cluster already holds a different port lease');
  const client = adminClient();
  try {
    await client.connect();
    const location = await client.query<{ data_directory: string }>('SHOW data_directory');
    if (resolve(location.rows[0].data_directory) !== dataDir) throw new Error('PostgreSQL lease belongs to another cluster');
    await client.query('REVOKE CONNECT, TEMPORARY ON DATABASE postgres, template1 FROM PUBLIC');
  } finally {
    await client.end();
  }
}

export function stopNativeDb() {
  if (pgCommand('pg_ctl', ['status', '-D', dataDir], true) === 0) {
    pgCommand('pg_ctl', ['stop', '-m', 'fast', '-w', '-t', '20', '-D', dataDir]);
  }
}

export function testLeasePrefix() {
  const prefix = process.env.EAPR_TEST_PREFIX ?? 'eapr_test_v0';
  if (!/^eapr_test_(?:review_)?(?:v0|t1|t2)$/.test(prefix)) throw new Error('Unsafe test database lease');
  return prefix;
}

function validateTestNamespace(namespace: string) {
  const prefix = testLeasePrefix() + '_';
  if (!namespace.startsWith(prefix) || !/^[a-z0-9]{1,28}$/.test(namespace.slice(prefix.length))) {
    throw new Error('Unsafe test database namespace');
  }
}

async function provision(namespace: string, credentials: Credentials, reuse: boolean): Promise<DatabasePair> {
  const db = pair(namespace, credentials);
  const client = adminClient();
  const migrator = namespace + '_migrator';
  const roles = [[migrator, credentials.migrator], [db.control.appRole, credentials.control], [db.runtime.appRole, credentials.runtime]];
  const createdRoles: string[] = [];
  const createdDatabases: string[] = [];
  try {
    await client.connect();
    await client.query('SELECT pg_advisory_lock($1)', [563982761]);
    for (const [role, password] of roles) {
      const found = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
      if (found.rowCount) {
        if (!reuse) throw new Error('Test role lease already occupied: ' + role);
        continue;
      }
      await client.query('CREATE ROLE ' + identifier(role) +
        " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + password + "'");
      createdRoles.push(role);
    }
    for (const database of [db.control, db.runtime]) {
      const found = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database.name]);
      const name = identifier(database.name);
      if (found.rowCount) {
        if (!reuse) throw new Error('Test database lease already occupied: ' + database.name);
      } else {
        await client.query('CREATE DATABASE ' + name + ' OWNER ' + identifier(migrator));
        createdDatabases.push(database.name);
      }
      await client.query('REVOKE ALL ON DATABASE ' + name + ' FROM PUBLIC');
      await client.query('GRANT CONNECT ON DATABASE ' + name + ' TO ' + identifier(database.appRole));

      const owner = new Client({ connectionString: database.migrationUrl, connectionTimeoutMillis: 2000 });
      try {
        await owner.connect();
        await owner.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
        await owner.query('GRANT USAGE ON SCHEMA public TO ' + identifier(database.appRole));
      } finally {
        await owner.end();
      }
    }
    return db;
  } catch (error) {
    for (const name of createdDatabases.reverse()) await client.query('DROP DATABASE ' + identifier(name));
    for (const role of createdRoles.reverse()) await client.query('DROP ROLE ' + identifier(role));
    throw error;
  } finally {
    await client.end();
  }
}

export async function provisionDemo() {
  return provision(demoNamespace, readCredentials(), true);
}

export async function provisionTest(namespace: string) {
  validateTestNamespace(namespace);
  return provision(namespace, newCredentials(), false);
}

export async function dropTest(namespace: string) {
  validateTestNamespace(namespace);
  const client = adminClient();
  try {
    await client.connect();
    await client.query('SELECT pg_advisory_lock($1)', [563982761]);
    for (const stream of ['control', 'runtime']) {
      await client.query('DROP DATABASE IF EXISTS ' + identifier(namespace + '_' + stream));
      await client.query('DROP ROLE IF EXISTS ' + identifier(namespace + '_' + stream + '_app'));
    }
    await client.query('DROP ROLE IF EXISTS ' + identifier(namespace + '_migrator'));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'up') {
      await startNativeDb();
      await provisionDemo();
      console.log('Native PostgreSQL ready on loopback port ' + port);
    } else if (process.argv[2] === 'down') {
      stopNativeDb();
      console.log('Native PostgreSQL stopped');
    } else {
      throw new Error('Use db:up or db:down');
    }
  } catch (error) {
    console.error('Local database command failed:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  }
}
