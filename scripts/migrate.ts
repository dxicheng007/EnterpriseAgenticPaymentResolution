import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { hashBytes } from '../packages/contracts/src/canonical.js';
import { withTransaction } from '../packages/storage/src/transaction.js';
import { getDemoPair, type DatabasePair } from './native-db.js';

export async function migrate(pair: DatabasePair, streams: Array<keyof DatabasePair> = ['control', 'runtime']) {
  for (const stream of streams) {
    const { migrationUrl, appRole } = pair[stream];
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(appRole)) throw new Error('Invalid application role');
    const migration = await readFile(new URL('../db/' + stream + '/001_base.sql', import.meta.url));
    const checksum = hashBytes(migration);
    const pool = new Pool({ connectionString: migrationUrl, connectionTimeoutMillis: 2000 });
    try {
      await withTransaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [146703201]);
        const found = await client.query<{ ledger: string | null }>("SELECT to_regclass('public.migration_ledger') AS ledger");
        if (found.rows[0].ledger) {
          const versions = await client.query<{version: number; sha256: string}>('SELECT version, sha256 FROM migration_ledger');
          if (versions.rows.length !== 1 || versions.rows[0].version !== 1 || versions.rows[0].sha256 !== checksum) {
            throw new Error('Migration ledger mismatch: ' + stream);
          }
          return;
        }
        await client.query(migration.toString('utf8'));
        await client.query('INSERT INTO migration_ledger (version, sha256) VALUES ($1, $2)', [1, checksum]);
        const role = '"' + appRole + '"';
        await client.query('GRANT SELECT ON migration_ledger, seed_ledger TO ' + role);
        await client.query('GRANT SELECT, UPDATE (sequence) ON activity_counter TO ' + role);
        await client.query('GRANT SELECT, INSERT ON activity_events TO ' + role);
      });
    } finally {
      await pool.end();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await migrate(getDemoPair());
    console.log('Migration 1 applied to control and runtime');
  } catch {
    console.error('Migration failed. Check local PostgreSQL and migration ledger identity.');
    process.exitCode = 1;
  }
}
