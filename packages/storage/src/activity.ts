import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  ActivityEventSchema, ActivityInputSchema, HashSchema, IdSchema, InvalidCursorError,
  NonnegativeIntegerSchema, VersionSchema, type ActivityEvent, type JsonObject,
} from '../../contracts/src/index.js';

const activityTypes = new Set([
  'system.seeded', 'system.status', 'source.captured', 'task.started', 'task.completed', 'task.blocked',
  'tool.called', 'tool.result', 'finding.revised', 'artifact.compiled', 'verification.completed', 'customer.activated',
  'event.pending', 'event.quarantined', 'batch.applied', 'batch.replayed', 'connection.paused', 'connection.revoked',
]);
const status = z.enum([
  'ready', 'not_ready', 'unavailable', 'migration_required', 'queued', 'running', 'waiting',
  'succeeded', 'completed', 'failed', 'interrupted', 'paused', 'blocked', 'active', 'revoked',
  'passed', 'pending', 'applied', 'replayed', 'quarantined',
]);
const ids = z.array(IdSchema).max(1000);
const count = NonnegativeIntegerSchema;
const payloadFields = {
  sourceId: IdSchema, sourceRef: IdSchema, eventId: IdSchema, receiptId: IdSchema, planId: IdSchema,
  artifactId: IdSchema, manifestId: IdSchema, findingId: IdSchema, reportId: IdSchema,
  sourceIds: ids, diagnosticCodes: ids, artifactHash: HashSchema, manifestHash: HashSchema, planHash: HashSchema,
  profileHash: HashSchema, snapshotHash: HashSchema, toolName: IdSchema, toolStatus: status,
  taskState: status, status, count, captured: count, applied: count, pending: count, quarantined: count,
  seedVersion: VersionSchema, migrationVersion: VersionSchema, controlDb: status, runtimeDb: status,
};

function activitySummary(payload: JsonObject): JsonObject {
  const summary: JsonObject = {};
  for (const [key, validator] of Object.entries(payloadFields)) {
    const result = validator.safeParse(payload[key]);
    if (result.success) summary[key] = result.data;
  }
  return summary;
}

export async function publishActivity(client: PoolClient, input: Omit<ActivityEvent, 'sequence'>): Promise<ActivityEvent> {
  const event = ActivityInputSchema.parse(input);
  if (!activityTypes.has(event.type)) throw new Error('Unsupported activity type');
  const counter = await client.query<{ sequence: string }>(
    'UPDATE activity_counter SET sequence = sequence + 1 WHERE singleton RETURNING sequence',
  );
  const sequence = VersionSchema.parse(Number(counter.rows[0]?.sequence));
  const stored = ActivityEventSchema.parse({ ...event, sequence, payload: activitySummary(event.payload) });
  await client.query('INSERT INTO activity_events (sequence, event) VALUES ($1, $2)', [sequence, JSON.stringify(stored)]);
  return stored;
}

export async function readActivity(pool: Pool, after: number, limit: number): Promise<ActivityEvent[]> {
  if (!NonnegativeIntegerSchema.safeParse(after).success) throw new InvalidCursorError();
  z.number().int().min(1).max(1000).parse(limit);
  const result = await pool.query<{event: unknown; high_water: string}>(
    'SELECT history.event, counter.sequence AS high_water FROM activity_counter counter ' +
    'LEFT JOIN LATERAL (SELECT sequence, event FROM activity_events WHERE sequence > $1 ORDER BY sequence LIMIT $2) history ON TRUE ' +
    'WHERE counter.singleton ORDER BY history.sequence',
    [after, limit],
  );
  const highWater = NonnegativeIntegerSchema.parse(Number(result.rows[0]?.high_water));
  if (after > highWater) throw new InvalidCursorError();
  return result.rows.filter(row => row.event !== null).map(row => ActivityEventSchema.parse(row.event));
}
