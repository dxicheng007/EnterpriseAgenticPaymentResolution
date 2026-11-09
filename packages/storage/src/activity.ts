import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  ActivityEventSchema, ActivityInputSchema, ControlActivityPageSchema, ControlActivityWindowSchema,
  HashSchema, IdSchema, InvalidCursorError, NonnegativeIntegerSchema, VersionSchema, strict,
  type ActivityEvent, type ControlActivityPage, type ControlActivityWindow, type Id, type JsonObject,
} from '../../contracts/src/index.js';

const activityTypes = new Set([
  'system.seeded', 'system.status', 'source.captured', 'task.started', 'task.completed', 'task.blocked',
  'tool.called', 'tool.result', 'finding.revised', 'artifact.compiled', 'verification.completed', 'customer.activated',
  'discovery.started', 'discovery.paused', 'discovery.resumed', 'discovery.blocked',
  'discovery.completed', 'discovery.interrupted',
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
  proposalId: IdSchema, dispatchId: IdSchema, toolStepId: IdSchema,
  proposalRevision: VersionSchema, findingRevision: VersionSchema, taskRevision: VersionSchema,
  inputTokens: count, outputTokens: count, modelCalls: count, unknownUsageCalls: count,
  repairRound: count, toolRounds: count, mode: z.enum(['scripted', 'live']),
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


const controlPageInput = strict({
  after: NonnegativeIntegerSchema, limit: z.number().int().min(1).max(1000), runId: IdSchema,
});
const storedSequence = z.string().regex(/^(0|[1-9][0-9]*)$/)
  .transform(value => Number(value)).pipe(NonnegativeIntegerSchema);
// This stream has no pruning or retention ledger.
const retainedAfter = 0;

export async function readControlActivityWindow(db: Pick<Pool, 'query'>): Promise<ControlActivityWindow> {
  const { rows } = await db.query<{ sequence: string }>('SELECT sequence FROM activity_counter WHERE singleton');
  return ControlActivityWindowSchema.parse({ highWater: storedSequence.parse(rows[0]?.sequence), retainedAfter });
}

export async function readControlActivityPage(
  db: Pick<Pool, 'query'>,
  input: { after: number; limit: number; runId: Id },
): Promise<ControlActivityPage> {
  if (!NonnegativeIntegerSchema.safeParse(input?.after).success) throw new InvalidCursorError();
  const { after, limit, runId } = controlPageInput.parse(input);
  const { rows } = await db.query<{ event: unknown; sequence: string | null; high_water: string }>(`
    SELECT history.event, history.sequence, counter.sequence AS high_water
    FROM activity_counter counter
    LEFT JOIN LATERAL (
      SELECT sequence, event FROM activity_events
      WHERE sequence > $1 AND sequence <= counter.sequence AND event->>'runId' = $2
      ORDER BY sequence LIMIT $3
    ) history ON TRUE
    WHERE counter.singleton
    ORDER BY history.sequence
  `, [after, runId, limit + 1]);

  const highWater = storedSequence.parse(rows[0]?.high_water);
  if (after > highWater) throw new InvalidCursorError();
  const events = rows.filter(row => row.sequence !== null).map(row => {
    const event = ActivityEventSchema.parse(row.event);
    if (event.stream !== 'control' || event.runId !== runId || event.sequence !== storedSequence.parse(row.sequence) ||
        event.sequence <= after || event.sequence > highWater) {
      throw new Error('Invalid stored control activity event');
    }
    return event;
  });
  const hasMore = events.length > limit;
  return ControlActivityPageSchema.parse({
    highWater, retainedAfter, events: events.slice(0, limit), hasMore,
    nextAfter: hasMore ? events[limit - 1].sequence : highWater,
  });
}
