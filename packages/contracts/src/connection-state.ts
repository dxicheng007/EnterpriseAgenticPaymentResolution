import { z } from 'zod';
import { HashSchema, IdSchema, IsoInstantSchema, NonnegativeIntegerSchema, ScopeSchema, strict } from './common.js';

const count = NonnegativeIntegerSchema;
const measured = z.union([count, z.null()]);

export const ConnectionStreamV1Schema = strict({
  sourceRef: IdSchema, streamId: IdSchema, transport: z.enum(['api', 'semantic']),
  baselineCursor: count, capturedThrough: count, capturedPages: count,
  lastCapturedAt: IsoInstantSchema.nullable(),
  // Null means the source high-water mark is not measured, never zero lag.
  lagEvents: measured,
});
export const ConnectionIncidentV1Schema = strict({
  sourceRef: IdSchema, streamId: IdSchema, code: z.enum(['CAPTURE_IDENTITY_CONFLICT', 'CAPTURE_PAGE_CONFLICT', 'CAPTURE_GAP']),
  observedAt: IsoInstantSchema, sourceIds: z.array(IdSchema).max(20),
});
export const ConnectionReceiptV1Schema = strict({
  id: IdSchema, kind: z.enum(['initial', 'sync']), activationId: IdSchema, epoch: z.number().int().positive(),
  planHash: HashSchema, beforeVersion: measured, afterVersion: count,
  eventCount: count, recordCount: count,
  beforeBalanceCents: count, afterBalanceCents: count, committedAt: IsoInstantSchema,
});

/** Read-only operations view of one registered account. Unmeasured quantities are null, never zero. */
export const ConnectionStateV1Schema = strict({
  schemaVersion: z.literal('1'),
  scope: ScopeSchema,
  status: z.enum(['inactive', 'active', 'paused', 'revoked']),
  epoch: count,
  activationId: IdSchema.nullable(),
  statusChangedAt: IsoInstantSchema.nullable(),
  parentVersion: count,
  streams: z.array(ConnectionStreamV1Schema).max(50),
  incidents: z.array(ConnectionIncidentV1Schema).max(50),
  receipts: z.array(ConnectionReceiptV1Schema).max(50),
  counts: strict({ appliedBatches: count, pendingEvents: measured, quarantinedEvents: measured }),
  lastReceiptId: IdSchema.nullable(),
  runtimeModelCalls: z.literal(0),
});

export type ConnectionStateV1 = z.infer<typeof ConnectionStateV1Schema>;
export type ConnectionReceiptV1 = z.infer<typeof ConnectionReceiptV1Schema>;
