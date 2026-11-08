import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { hashBytes } from '../packages/contracts/src/canonical.js';
import type { MigrationIdentity } from '../packages/storage/src/transaction.js';
import { getDemoPair, type DatabasePair } from './native-db.js';

export const migrationStreams = ['control', 'runtime'] as const;
type Stream = typeof migrationStreams[number];
type Migration = MigrationIdentity & { sql: string };
type MigrationCatalog = Record<Stream, readonly Migration[]>;

export function readMigrationCatalog({
  root = new URL('../db/', import.meta.url),
  throughVersion = Number.POSITIVE_INFINITY,
}: { root?: URL; throughVersion?: number } = {}): MigrationCatalog {
  function load(stream: Stream) {
    const directory = new URL(stream + '/', root);
    const versions = new Set<number>();
    const migrations = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.name.endsWith('.sql'))
      .map(entry => {
        const match = /^([0-9]{3})_[a-z0-9_]+\.sql$/.exec(entry.name);
        const version = Number(match?.[1]);
        if (!entry.isFile() || !match || version < 1 || versions.has(version)) {
          throw new Error('Invalid or duplicate migration in ' + stream);
        }
        versions.add(version);
        const bytes = readFileSync(new URL(entry.name, directory));
        return { version, sha256: hashBytes(bytes), sql: bytes.toString('utf8') };
      })
      .sort((left, right) => left.version - right.version);
    if (migrations.length === 0 || migrations.some((migration, index) => migration.version !== index + 1)) {
      throw new Error('Missing numbered migration in ' + stream);
    }
    if (throughVersion !== Number.POSITIVE_INFINITY && (!Number.isInteger(throughVersion) || throughVersion < 1)) {
      throw new Error('Invalid migration version ceiling');
    }
    return migrations.filter(migration => migration.version <= throughVersion);
  }
  return { control: load('control'), runtime: load('runtime') };
}

export function migrationIdentities(migrations: readonly Migration[]): MigrationIdentity[] {
  return migrations.map(({ version, sha256 }) => ({ version, sha256 }));
}

function bindAppRole(sql: string, role: string) {
  return sql.replace(/(?<!:):[a-zA-Z_][a-zA-Z_0-9]*/g, placeholder => {
    if (placeholder !== ':app_role') throw new Error('Unknown migration role placeholder');
    return role;
  });
}

export async function migrate(
  pair: DatabasePair,
  streams: readonly Stream[] = migrationStreams,
  catalog: MigrationCatalog = readMigrationCatalog(),
) {
  for (const stream of streams) {
    const { migrationUrl, appRole } = pair[stream];
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(appRole)) throw new Error('Invalid application role');
    const role = '"' + appRole + '"';
    const migrations = catalog[stream].map(migration => ({
      ...migration, sql: bindAppRole(migration.sql, role),
    }));
    const client = new Client({ connectionString: migrationUrl, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      // A session lock keeps concurrent runners out between migration commits.
      await client.query('SELECT pg_advisory_lock($1)', [146703201]);
      const found = await client.query<{ ledger: string | null }>("SELECT to_regclass('public.migration_ledger') AS ledger");
      const applied = found.rows[0].ledger
        ? (await client.query<MigrationIdentity>('SELECT version, sha256 FROM public.migration_ledger ORDER BY version')).rows
        : [];
      if (applied.some((row, index) =>
        row.version !== migrations[index]?.version || row.sha256 !== migrations[index]?.sha256
      ) || (found.rows[0].ledger && applied.length === 0)) {
        throw new Error('Migration ledger mismatch: ' + stream);
      }
      for (const { version, sha256, sql } of migrations.slice(applied.length)) {
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO public.migration_ledger (version, sha256) VALUES ($1, $2)', [version, sha256]);
          if (version === 1) {
            await client.query('GRANT SELECT ON migration_ledger, seed_ledger TO ' + role);
            await client.query('GRANT SELECT, UPDATE (sequence) ON activity_counter TO ' + role);
            await client.query('GRANT SELECT, INSERT ON activity_events TO ' + role);
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      await client.end();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await migrate(getDemoPair());
    console.log('Control and runtime migrations verified');
  } catch {
    console.error('Migration failed. Check local PostgreSQL and migration ledger identity.');
    process.exitCode = 1;
  }
}
