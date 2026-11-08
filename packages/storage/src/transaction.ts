import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';

export function sqlState(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
        throw error;
      } finally {
        client.release(discard);
      }
    } catch (error) {
      if (attempt === 3 || !['40001', '40P01'].includes(sqlState(error) ?? '')) throw error;
      await delay(randomInt(5, 20) * attempt);
    }
  }
}

export type MigrationIdentity = { version: number; sha256: string };

export async function probeMigration(pool: Pool, expected: readonly MigrationIdentity[]): Promise<import('../../contracts/src/activity.js').ServiceHealth> {
  try {
    const result = await pool.query<MigrationIdentity>('SELECT version, sha256 FROM public.migration_ledger ORDER BY version');
    const latest = result.rows.at(-1)?.version ?? null;
    if (expected.length > 0 && result.rows.length === expected.length && result.rows.every(
      (row, index) => row.version === expected[index].version && row.sha256 === expected[index].sha256,
    )) {
      return { status: 'ready', database: 'ready', migrationVersion: latest };
    }
    return { status: 'not_ready', database: 'migration_required', migrationVersion: latest };
  } catch (error) {
    if (sqlState(error) === '42P01') return { status: 'not_ready', database: 'migration_required', migrationVersion: null };
    return { status: 'not_ready', database: 'unavailable', migrationVersion: null };
  }
}
