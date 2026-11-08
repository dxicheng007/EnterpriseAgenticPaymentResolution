import { z } from 'zod';
import {
  DiagnosticSchema, IdSchema, IsoInstantSchema, JsonObjectSchema, NonnegativeIntegerSchema,
  ScopeSchema, VersionSchema, strict,
} from './common.js';
import { ProductRoleSchema } from './model.js';

const serviceStatus = z.enum(['ready', 'not_ready']);
const databaseStatus = z.enum(['ready', 'unavailable', 'migration_required']);
const migrationVersion = NonnegativeIntegerSchema.nullable();
export const ServiceHealthSchema = strict({ status: serviceStatus, database: databaseStatus, migrationVersion })
  .refine(health => (health.status === 'ready') === (health.database === 'ready') &&
    (health.database !== 'ready' || (health.migrationVersion !== null && health.migrationVersion > 0)) &&
    (health.database !== 'unavailable' || health.migrationVersion === null), 'Inconsistent service health');
export const HealthResponseSchema = strict({
  status: serviceStatus, controlDb: databaseStatus, runtimeDb: databaseStatus,
  migrationVersions: strict({ control: migrationVersion, runtime: migrationVersion }),
  diagnostics: z.array(DiagnosticSchema),
});
const activityFields = {
  stream: z.enum(['control', 'runtime']), phase: z.enum(['build', 'run']),
  scope: ScopeSchema.optional(), runId: IdSchema.optional(), taskId: IdSchema.optional(),
  role: ProductRoleSchema.optional(), type: z.string(), at: IsoInstantSchema, payload: JsonObjectSchema,
};
export const ActivityInputSchema = strict(activityFields);
export const ActivityEventSchema = strict({ ...activityFields, sequence: VersionSchema });
export const UiCursorSchema = strict({
  v: z.literal(1), controlCursor: NonnegativeIntegerSchema, runtimeCursor: NonnegativeIntegerSchema,
});
export const ApiErrorSchema = strict({
  code: z.string(), message: z.string(), diagnostics: z.array(DiagnosticSchema), correlationId: IdSchema,
});
export const EventCursorResponseSchema = strict({ cursor: z.string() });

export class InvalidCursorError extends Error {
  readonly code = 'CURSOR_INVALID';
  constructor() { super('Invalid activity cursor'); }
}

export function encodeUiCursor(cursor: UiCursor): string {
  const { v, controlCursor, runtimeCursor } = UiCursorSchema.parse(cursor);
  // The three keys are in canonical lexicographic order.
  return Buffer.from(JSON.stringify({ controlCursor, runtimeCursor, v }), 'utf8').toString('base64url');
}

export function decodeUiCursor(wire: string, highWater: UiCursor): UiCursor {
  if (wire.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(wire)) throw new InvalidCursorError();
  try {
    const cursor = UiCursorSchema.parse(JSON.parse(Buffer.from(wire, 'base64url').toString('utf8')));
    if (encodeUiCursor(cursor) !== wire ||
        cursor.controlCursor > highWater.controlCursor || cursor.runtimeCursor > highWater.runtimeCursor) {
      throw new InvalidCursorError();
    }
    return cursor;
  } catch {
    throw new InvalidCursorError();
  }
}
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ActivityInput = z.infer<typeof ActivityInputSchema>;
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
export type UiCursor = z.infer<typeof UiCursorSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type EventCursorResponse = z.infer<typeof EventCursorResponseSchema>;
