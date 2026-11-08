import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { publishActivity } from '../packages/storage/src/activity.js';
import { withTransaction } from '../packages/storage/src/transaction.js';
import { getDemoPair, type DatabasePair } from './native-db.js';

export async function seed(pair: DatabasePair, clock = () => new Date()) {
  for (const stream of ['control', 'runtime'] as const) {
    const pool = new Pool({ connectionString: pair[stream].migrationUrl, connectionTimeoutMillis: 2000 });
    try {
      await withTransaction(pool, async client => {
        const inserted = await client.query('INSERT INTO seed_ledger (version) VALUES (1) ON CONFLICT DO NOTHING');
        if (inserted.rowCount) {
          await publishActivity(client, {
            stream, phase: stream === 'control' ? 'build' : 'run', type: 'system.seeded',
            at: clock().toISOString(), payload: { seedVersion: 1 },
          });
        }
      });
    } finally {
      await pool.end();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await seed(getDemoPair());
    console.log('Seed version 1 recorded for control and runtime');
  } catch {
    console.error('Seed failed. Check local PostgreSQL and apply migrations first.');
    process.exitCode = 1;
  }
}
