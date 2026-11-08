import { z } from 'zod';
import {
  CursorSchema, DiagnosticSchema, HashSchema, IdSchema, IsoInstantSchema, JsonPointerSchema,
  NonnegativeIntegerSchema as Offset, SemanticVersionMapSchema, VersionSchema, guardKeys, setOf, strict,
} from './common.js';

const pdfLocator = z.strictObject({ kind: z.literal('pdf'), page: VersionSchema, start: Offset, end: Offset });
const csvLocator = z.strictObject({ kind: z.literal('csv'), row: VersionSchema, column: z.string().min(1) });
const jsonLocator = z.strictObject({ kind: z.literal('json'), pointer: JsonPointerSchema });
const emailLocator = z.strictObject({ kind: z.literal('email'), messageId: IdSchema, start: Offset, end: Offset });
const ordered = (locator: {start: number; end: number}) => locator.start < locator.end;

export const PdfLocatorSchema = guardKeys(pdfLocator.refine(ordered));
export const CsvLocatorSchema = guardKeys(csvLocator);
export const JsonLocatorSchema = guardKeys(jsonLocator);
export const EmailLocatorSchema = guardKeys(emailLocator.refine(ordered));
export const EvidenceRefSchema = strict({
  id: IdSchema, snapshotId: IdSchema, sourceId: IdSchema,
  locator: z.discriminatedUnion('kind', [pdfLocator, csvLocator, jsonLocator, emailLocator])
    .refine(locator => !('start' in locator) || ordered(locator)),
  excerpt: z.string(), sha256: HashSchema,
});

const documentKind = z.enum(['contract_pdf', 'amendment_pdf', 'event_csv', 'email_json']);
const batch = { batchId: IdSchema, sequence: VersionSchema, streamId: IdSchema };
export const UploadMetadataSchema = strict({
  companyId: IdSchema, sourceRef: IdSchema, documentId: IdSchema, documentVersion: VersionSchema,
  kind: documentKind, originalName: z.string().min(1).refine(name => !/[\\/\0]/.test(name) && name !== '..' && name !== '.'),
  batch: strict(batch).optional(),
}).refine(value => (value.kind === 'event_csv') === !!value.batch, 'Only event CSV requires batch metadata');

export const UploadResponseSchema = strict({
  fileId: IdSchema, documentId: IdSchema, documentVersion: VersionSchema, contentHash: HashSchema,
  duplicate: z.boolean(), evidenceIds: z.array(IdSchema), diagnostics: z.array(DiagnosticSchema),
});
export const EvidenceResponseSchema = strict({
  evidence: EvidenceRefSchema, mediaType: z.enum(['application/pdf', 'text/csv', 'application/json']),
  original: strict({ url: z.string(), sha256: HashSchema, byteLength: Offset }),
  text: strict({ value: z.string(), sha256: HashSchema, unit: z.literal('utf16'), startInclusive: Offset, endExclusive: Offset }),
}).refine(value => {
  const { text, evidence, original } = value;
  const { startInclusive, endExclusive } = text;
  const splitsSurrogate = (index: number) => /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text.value.slice(index - 1, index + 1));
  return original.url === '/api/evidence/' + evidence.id + '/content' &&
    original.sha256 === evidence.sha256 && endExclusive <= text.value.length &&
    startInclusive < endExclusive && !splitsSurrogate(startInclusive) && !splitsSurrogate(endExclusive) &&
    text.value.slice(startInclusive, endExclusive) === evidence.excerpt;
}, 'Evidence content and offsets must match citation');

export const ManifestStreamSchema = strict({
  streamId: IdSchema, snapshotId: IdSchema, resumeAfter: CursorSchema,
  eventIds: setOf(IdSchema, id => id), snapshotHash: HashSchema,
});
export const ManifestFileSchema = strict({
  fileId: IdSchema, documentId: IdSchema, documentVersion: VersionSchema, sha256: HashSchema, kind: documentKind,
  batchId: batch.batchId.optional(), sequence: batch.sequence.optional(), streamId: batch.streamId.optional(),
}).refine(file => {
  const count = [file.batchId, file.sequence, file.streamId].filter(value => value !== undefined).length;
  return count === (file.kind === 'event_csv' ? 3 : 0);
}, 'Only event CSV requires batch metadata');
export const BootstrapManifestSchema = strict({
  id: IdSchema, companyId: IdSchema, sourceRef: IdSchema, epoch: VersionSchema, asOf: IsoInstantSchema,
  schemaVersions: z.record(IdSchema, IdSchema), semanticVersions: SemanticVersionMapSchema,
  streams: setOf(ManifestStreamSchema, stream => stream.streamId), files: setOf(ManifestFileSchema, file => file.fileId),
  hash: HashSchema,
});

export type PdfLocator = z.infer<typeof PdfLocatorSchema>;
export type CsvLocator = z.infer<typeof CsvLocatorSchema>;
export type JsonLocator = z.infer<typeof JsonLocatorSchema>;
export type EmailLocator = z.infer<typeof EmailLocatorSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
export type EvidenceResponse = z.infer<typeof EvidenceResponseSchema>;
export type ManifestStream = z.infer<typeof ManifestStreamSchema>;
export type ManifestFile = z.infer<typeof ManifestFileSchema>;
export type BootstrapManifest = z.infer<typeof BootstrapManifestSchema>;
