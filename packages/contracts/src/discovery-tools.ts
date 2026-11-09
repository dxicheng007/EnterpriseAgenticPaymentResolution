import { z } from 'zod';
import { HashSchema, IdSchema, NonnegativeIntegerSchema, guardKeys, strict, unique } from './common.js';
import { CaptureStreamSchema, SourceContractSchema } from './connector.js';
import { DiscoveryBindingSchema } from './discovery.js';
import {
  CsvLocatorSchema, EmailLocatorSchema, EvidenceResponseSchema, JsonLocatorSchema, PdfLocatorSchema,
} from './evidence.js';
import { RawSourceEventSchema } from './source.js';

const names = ['describeSource', 'querySnapshot', 'searchEvidence', 'readEvidence'] as const;
const maxPageSize = 50;
const maxSearchHits = 20;
const maxQueryLength = 256;
const maxExcerptLength = 8192;
const maxResultBytes = 65_536;
const maxJsonNesting = 128;
const encoder = new TextEncoder();

export const DiscoveryReadToolNameSchema = z.enum(names);

function plainJson<T extends z.ZodType>(schema: T, canonicalNumbers = false) {
  return z.preprocess((input, ctx) => {
    // Bound recursion before invoking nested schemas or serializing a result.
    const pending = [{ value: input, depth: 0 }];
    while (pending.length > 0) {
      const { value, depth } = pending.pop()!;
      if (canonicalNumbers && (
        value === undefined || (typeof value === 'number' && (!Number.isSafeInteger(value) || Object.is(value, -0)))
      )) {
        ctx.addIssue({ code: 'custom', message: 'Expected canonical JSON values' });
        return z.NEVER;
      }
      if (value === null || typeof value !== 'object') continue;
      const prototype = Object.getPrototypeOf(value);
      const plain = Array.isArray(value)
        ? prototype === Array.prototype
        : prototype === Object.prototype || prototype === null;
      if (!plain || Object.getOwnPropertySymbols(value).length || depth >= maxJsonNesting) {
        ctx.addIssue({ code: 'custom', message: 'Expected plain JSON with at most 128 nested containers' });
        return z.NEVER;
      }
      for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
    }
    return input;
  }, schema);
}

const describeInput = strict({});
const account = strict({ sellerEntityId: IdSchema, sourceAccountId: IdSchema });
const queryInput = strict({
  resource: IdSchema.optional(), account: account.optional(), afterEventId: IdSchema.optional(),
  limit: z.number().int().min(1).max(maxPageSize),
});
const searchInput = strict({
  query: z.string().min(1).refine(query => query.length <= maxQueryLength, 'Query exceeds 256 UTF-16 units'),
  limit: z.number().int().min(1).max(maxSearchHits),
});
const range = strict({ start: NonnegativeIntegerSchema, end: NonnegativeIntegerSchema })
  .refine(({ start, end }) => start < end, 'Range must be nonempty and ordered');
const readInput = strict({ evidenceId: IdSchema, range: range.optional() });

export const DescribeSourceInputSchema = plainJson(describeInput);
export const QuerySnapshotInputSchema = plainJson(queryInput);
export const SearchEvidenceInputSchema = plainJson(searchInput);
export const ReadEvidenceInputSchema = plainJson(readInput);

export const DiscoveryReadToolCallSchema = plainJson(guardKeys(z.discriminatedUnion('name', [
  z.strictObject({ name: z.literal(names[0]), arguments: describeInput }),
  z.strictObject({ name: z.literal(names[1]), arguments: queryInput }),
  z.strictObject({ name: z.literal(names[2]), arguments: searchInput }),
  z.strictObject({ name: z.literal(names[3]), arguments: readInput }),
])));

export const DiscoveryCitationIdentitySchema = plainJson(strict({
  id: IdSchema, snapshotId: IdSchema, sourceId: IdSchema,
  locator: z.union([PdfLocatorSchema, CsvLocatorSchema, JsonLocatorSchema, EmailLocatorSchema]),
  sha256: HashSchema,
}));

const failure = strict({
  ok: z.literal(false),
  code: z.enum([
    'DISCOVERY_INVALID', 'DISCOVERY_FORBIDDEN', 'DISCOVERY_CONFLICT', 'SOURCE_UNAVAILABLE',
    'TOOL_RESULT_LIMIT', 'TOOL_FORBIDDEN', 'TOOL_UNAVAILABLE',
  ]),
});
export const DiscoveryReadToolFailureSchema = plainJson(failure);

function boundedResult<T extends z.ZodType>(success: T) {
  return plainJson(z.union([success, failure]).refine(value =>
    // The parsed object is canonical JSON. Sorting object keys cannot change its byte count.
    encoder.encode(JSON.stringify(value)).byteLength <= maxResultBytes,
  'Tool result exceeds 65,536 canonical UTF-8 bytes'), true);
}

function isOrdered<T>(entries: readonly T[], before: (previous: T, current: T) => boolean) {
  return entries.every((entry, index) => index === 0 || before(entries[index - 1]!, entry));
}

function lexicalSet<T>(entries: z.ZodType<T[]>, key: (value: T) => string) {
  return entries.refine(items => isOrdered(items, (left, right) => key(left) < key(right)), 'Expected a unique lexical set');
}

export const DescribeSourceResultSchema = boundedResult(strict({
  ok: z.literal(true),
  binding: DiscoveryBindingSchema,
  contracts: lexicalSet(z.array(SourceContractSchema), contract => contract.resource),
  streams: lexicalSet(z.array(CaptureStreamSchema), stream => stream.streamId),
}));

const snapshotRow = strict({
  event: RawSourceEventSchema,
  evidenceIds: lexicalSet(z.array(IdSchema), id => id),
});
export const QuerySnapshotResultSchema = boundedResult(strict({
  ok: z.literal(true),
  events: z.array(snapshotRow).max(maxPageSize),
  nextAfterEventId: IdSchema.nullable(),
}).refine(({ events, nextAfterEventId }) =>
  unique(events, row => row.event.id) &&
  isOrdered(events, ({ event: left }, { event: right }) =>
    left.streamId < right.streamId || (left.streamId === right.streamId && left.sequence < right.sequence)) &&
  (nextAfterEventId === null || events.at(-1)?.event.id === nextAfterEventId),
'Events must be uniquely ordered by stream and sequence with a valid continuation'));

const searchHit = strict({ id: IdSchema, excerpt: z.string().refine(excerpt => excerpt.length <= 2000, 'Search excerpt exceeds 2,000 UTF-16 units') });
export const SearchEvidenceResultSchema = boundedResult(strict({
  ok: z.literal(true),
  hits: lexicalSet(z.array(searchHit).max(maxSearchHits), hit => hit.id),
}));

export const ReadEvidenceResultSchema = boundedResult(strict({
  ok: z.literal(true),
  evidence: DiscoveryCitationIdentitySchema,
  mediaType: EvidenceResponseSchema.out.shape.mediaType,
  text: strict({
    value: z.string().min(1), unit: z.literal('utf16'),
    startInclusive: NonnegativeIntegerSchema, endExclusive: NonnegativeIntegerSchema, sha256: HashSchema,
  }).refine(({ value, startInclusive, endExclusive }) =>
    value.length <= maxExcerptLength && endExclusive - startInclusive === value.length,
  'Text length must match UTF-16 offsets and stay within 8,192 units'),
}));

const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' } as const;
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum } as const);
export const discoveryReadToolSchemas = [
  {
    name: names[0],
    description: 'Describe the pinned source contracts, capture streams and capture binding.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: names[1],
    description: 'Page through authorized raw events in the pinned snapshot, with their citation IDs.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['limit'],
      properties: {
        resource: id, afterEventId: id, limit: integer(1, maxPageSize),
        account: {
          type: 'object', additionalProperties: false, required: ['sellerEntityId', 'sourceAccountId'],
          properties: { sellerEntityId: id, sourceAccountId: id },
        },
      },
    },
  },
  {
    name: names[2],
    description: 'Search authorized captured citation excerpts.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['query', 'limit'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: maxQueryLength, description: 'Length is measured in UTF-16 code units.' },
        limit: integer(1, maxSearchHits),
      },
    },
  },
  {
    name: names[3],
    description: 'Read a bounded excerpt from an authorized captured citation.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['evidenceId'],
      properties: {
        evidenceId: id,
        range: {
          type: 'object', additionalProperties: false, required: ['start', 'end'],
          description: 'Half-open UTF-16 offsets relative to the cited span. Start must be less than end. Omit for the cited span.',
          properties: { start: integer(0, Number.MAX_SAFE_INTEGER), end: integer(1, Number.MAX_SAFE_INTEGER) },
        },
      },
    },
  },
] as const;

export type DiscoveryReadToolName = z.infer<typeof DiscoveryReadToolNameSchema>;
export type DescribeSourceInput = z.infer<typeof DescribeSourceInputSchema>;
export type QuerySnapshotInput = z.infer<typeof QuerySnapshotInputSchema>;
export type SearchEvidenceInput = z.infer<typeof SearchEvidenceInputSchema>;
export type ReadEvidenceInput = z.infer<typeof ReadEvidenceInputSchema>;
export type DiscoveryReadToolCall = z.infer<typeof DiscoveryReadToolCallSchema>;
export type DiscoveryCitationIdentity = z.infer<typeof DiscoveryCitationIdentitySchema>;
export type DiscoveryReadToolFailure = z.infer<typeof DiscoveryReadToolFailureSchema>;
export type DescribeSourceResult = z.infer<typeof DescribeSourceResultSchema>;
export type QuerySnapshotResult = z.infer<typeof QuerySnapshotResultSchema>;
export type SearchEvidenceResult = z.infer<typeof SearchEvidenceResultSchema>;
export type ReadEvidenceResult = z.infer<typeof ReadEvidenceResultSchema>;
export type DiscoveryReadToolResult = DescribeSourceResult | QuerySnapshotResult | SearchEvidenceResult | ReadEvidenceResult;
