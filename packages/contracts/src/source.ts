import { z } from 'zod';
import {
  CursorSchema, DiagnosticSchema, EventKindSchema, HashSchema, IdSchema, IsoInstantSchema,
  JsonObjectSchema, RawIdentitySchema, ScopeSchema, VersionSchema, guardKeys, strict,
} from './common.js';

const rawEvent = {
  id: IdSchema, sourceRef: IdSchema, resource: IdSchema, streamId: IdSchema, sequence: VersionSchema,
  recordId: IdSchema, recordVersion: VersionSchema, rawIdentity: RawIdentitySchema, kind: EventKindSchema,
  effectiveAt: IsoInstantSchema, observedAt: IsoInstantSchema, schemaVersion: IdSchema,
  semanticVersion: IdSchema, contentHash: HashSchema, payload: JsonObjectSchema,
};
export const RawSourceEventSchema = strict(rawEvent);
export const SourceEventSchema = RawSourceEventSchema;
export const ResolvedSourceEventSchema = strict({ ...rawEvent, scope: ScopeSchema, profileHash: HashSchema });
export const SourceSnapshotSchema = strict({
  id: IdSchema, manifestId: IdSchema, sourceRef: IdSchema, capturedAt: IsoInstantSchema,
  contentHash: HashSchema, evidenceIds: z.array(IdSchema), eventIds: z.array(IdSchema),
});
export const SourceDossierSchema = strict({
  companyId: IdSchema, manifestId: IdSchema, snapshotIds: z.array(IdSchema), evidenceIds: z.array(IdSchema),
  complete: z.boolean(), missingMembers: z.array(IdSchema), diagnostics: z.array(DiagnosticSchema),
});
export const CaptureSnapshotResultSchema = guardKeys(z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), snapshot: SourceSnapshotSchema, dossier: SourceDossierSchema }),
  z.strictObject({ ok: z.literal(false), dossier: SourceDossierSchema, diagnostics: z.array(DiagnosticSchema) }),
]));
export const ChangePageSchema = strict({
  sourceRef: IdSchema, streamId: IdSchema, after: CursorSchema, next: CursorSchema,
  complete: z.boolean(), events: z.array(RawSourceEventSchema),
}).refine(page => page.events.every((event, i) =>
  event.sourceRef === page.sourceRef && event.streamId === page.streamId &&
  event.sequence === Number(page.after) + i + 1) &&
  Number(page.next) === Number(page.after) + page.events.length, 'Invalid page cursor range');

export type RawSourceEvent = z.infer<typeof RawSourceEventSchema>;
export type SourceEvent = z.infer<typeof SourceEventSchema>;
export type ResolvedSourceEvent = z.infer<typeof ResolvedSourceEventSchema>;
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
export type SourceDossier = z.infer<typeof SourceDossierSchema>;
export type CaptureSnapshotResult = z.infer<typeof CaptureSnapshotResultSchema>;
export type ChangePage = z.infer<typeof ChangePageSchema>;
