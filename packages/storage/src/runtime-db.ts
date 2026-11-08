import { Pool } from 'pg';

export type RuntimeDbConfig = { connectionString: string };
export function createRuntimeDb({ connectionString }: RuntimeDbConfig): Pool {
  if (!connectionString) throw new Error('Runtime database URL is required');
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 1500, query_timeout: 1500 });
  pool.on('error', () => { /* Idle connection failures are reflected by the readiness probe. */ });
  return pool;
}
