import { Pool } from 'pg';

export type ControlDbConfig = { connectionString: string };
export function createControlDb({ connectionString }: ControlDbConfig): Pool {
  if (!connectionString) throw new Error('Control database URL is required');
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 1500, query_timeout: 1500 });
  pool.on('error', () => { /* Idle connection failures are reflected by the readiness probe. */ });
  return pool;
}

export type Clock = () => Date;
