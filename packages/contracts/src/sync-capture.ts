import { z } from 'zod';
import { CursorSchema, HashSchema, IdSchema, IsoInstantSchema, ScopeSchema, strict } from './common.js';

const nonnegative = z.number().nonnegative().refine(value => Number.isSafeInteger(value) && !Object.is(value, -0));
const positive = z.number().positive().refine(Number.isSafeInteger);

function strictlyOrdered<T>(items: T[], key: (value: T) => string) {
  return items.every((item, index) => index === 0 || key(items[index - 1]!) < key(item));
}

export const CommittedCaptureIdentityV1Schema = strict({
  scope: ScopeSchema, activationId: IdSchema, bundleHash: HashSchema,
});
export const CaptureLaneV1Schema = strict({
  schemaVersion: z.literal('1'), sourceRef: IdSchema, manifestHash: HashSchema,
});
export const CaptureIncidentCodeV1Schema = z.enum([
  'CAPTURE_IDENTITY_CONFLICT', 'CAPTURE_PAGE_CONFLICT', 'CAPTURE_GAP',
]);
export const CaptureIncidentSummaryV1Schema = strict({
  code: CaptureIncidentCodeV1Schema, pageHash: HashSchema,
  sourceIds: z.array(IdSchema).max(20).refine(ids => strictlyOrdered(ids, id => id)),
  observedAt: IsoInstantSchema,
});
export const CaptureStreamProgressV1Schema = strict({
  streamId: IdSchema, transport: z.enum(['api', 'semantic']), baselineCursor: CursorSchema, captureCursor: CursorSchema,
  capturedRecords: nonnegative, capturedPages: nonnegative, lastCapturedAt: IsoInstantSchema.nullable(),
  lastIncident: CaptureIncidentSummaryV1Schema.nullable(),
}).refine(progress => {
  const records = Number(progress.captureCursor) - Number(progress.baselineCursor);
  return records === progress.capturedRecords && progress.capturedPages <= records &&
    (records === 0) === (progress.capturedPages === 0) && (records === 0) === (progress.lastCapturedAt === null);
}, 'Inconsistent capture counters or timestamp');
export const CaptureProgressV1Schema = strict({
  schemaVersion: z.literal('1'), lane: CaptureLaneV1Schema,
  streams: z.array(CaptureStreamProgressV1Schema).refine(streams => strictlyOrdered(streams, stream => stream.streamId)),
});
export const CaptureResultV1Schema = strict({
  disposition: z.enum(['captured', 'replayed', 'empty', 'refetch']),
  captured: nonnegative, cursor: CursorSchema, replayed: z.boolean(),
}).refine(result =>
  (result.disposition === 'captured' ? positive.safeParse(result.captured).success : result.captured === 0) &&
  result.replayed === (result.disposition === 'replayed'), 'Inconsistent capture disposition');

export type CommittedCaptureIdentityV1 = z.infer<typeof CommittedCaptureIdentityV1Schema>;
export type CaptureLaneV1 = z.infer<typeof CaptureLaneV1Schema>;
export type CaptureIncidentCodeV1 = z.infer<typeof CaptureIncidentCodeV1Schema>;
export type CaptureIncidentSummaryV1 = z.infer<typeof CaptureIncidentSummaryV1Schema>;
export type CaptureStreamProgressV1 = z.infer<typeof CaptureStreamProgressV1Schema>;
export type CaptureProgressV1 = z.infer<typeof CaptureProgressV1Schema>;
export type CaptureResultV1 = z.infer<typeof CaptureResultV1Schema>;
