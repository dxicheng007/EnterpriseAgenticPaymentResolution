import { z } from 'zod';

const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
export const SafeKeySchema = z.string().refine(key => !forbiddenKeys.has(key), 'Forbidden key');

function hasPrototypeKey(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const stack: object[] = [input];
  const seen = new WeakSet<object>();
  while (stack.length) {
    const item = stack.pop()!;
    if (seen.has(item)) continue;
    seen.add(item);
    for (const [key, value] of Object.entries(item)) {
      if (forbiddenKeys.has(key)) return true;
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return false;
}

// Guard before Zod's object parsing, which can omit special keys.
export function guardKeys<T extends z.ZodType>(schema: T) {
  return z.preprocess((input, ctx) => {
    if (hasPrototypeKey(input)) {
      ctx.addIssue({ code: 'custom', message: 'Forbidden key' });
      return z.NEVER;
    }
    return input;
  }, schema);
}
export function strict<S extends z.ZodRawShape>(shape: S) {
  return guardKeys(z.strictObject(shape));
}

export const IdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/);
export const SemanticScopeKeySchema = z.string().refine(key => {
  if (key === '*') return true;
  const parts = key.split('/');
  return parts.length === 2 && parts.every(part => IdSchema.safeParse(part).success && !forbiddenKeys.has(part));
});
export const SemanticVersionMapSchema = guardKeys(z.record(SemanticScopeKeySchema, IdSchema));
export const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const IsoDateSchema = z.iso.date();
export const IsoInstantSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
  .refine(value => {
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === normalizeInstant(value);
  }, 'Invalid UTC instant')
  .transform(normalizeInstant);

function normalizeInstant(value: string): string {
  return value.length === 20 ? value.slice(0, -1) + '.000Z' : value;
}

export const CursorSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(value => Number.isSafeInteger(Number(value)));
export const SafeIntegerSchema = z.number().int().refine(value => !Object.is(value, -0));
export const NonnegativeIntegerSchema = z.number().int().nonnegative().refine(value => !Object.is(value, -0));
export const VersionSchema = z.number().int().positive();
export const MoneyCentsSchema = NonnegativeIntegerSchema;
export const TransactionCentsSchema = z.number().int().min(1).max(5_000_000);
export const Decimal2Schema = z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/);
export const JsonPointerSchema = z.string().refine(pointer => {
  if (pointer === '') return true;
  return pointer.startsWith('/') && pointer.slice(1).split('/').every(segment =>
    !/~(?![01])/.test(segment) && !forbiddenKeys.has(segment.replaceAll('~1', '/').replaceAll('~0', '~')));
}, 'Invalid JSON Pointer');
export const FieldPathSchema = JsonPointerSchema.refine(pointer => /^\/[^/]+$/.test(pointer));

export type JsonValue = null | boolean | string | number | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.string(),
  z.number().refine(value => !Number.isInteger(value) || Number.isSafeInteger(value)),
  z.array(jsonValue), jsonObject,
]));
const jsonObject: z.ZodType<JsonObject> = z.lazy(() => z.record(SafeKeySchema, jsonValue));
export const JsonObjectSchema = guardKeys(jsonObject);
export const JsonValueSchema = guardKeys(jsonValue);

export const ScopeSchema = strict({ companyId: IdSchema, sellerEntityId: IdSchema, accountId: IdSchema });
export const RawIdentitySchema = strict({
  companyId: IdSchema, sellerEntityId: IdSchema.optional(), sourceAccountId: IdSchema.optional(),
});
export const FinancialKindSchema = z.enum(['invoice', 'payment', 'credit', 'allocation', 'reversal']);
export const EventKindSchema = z.enum([...FinancialKindSchema.options, 'semantic_change']);
export const EconomicIdentitySchema = strict({
  sourceRef: IdSchema, sellerEntityId: IdSchema, kind: FinancialKindSchema, recordId: IdSchema,
});
export const DiagnosticSchema = strict({
  code: z.string(), severity: z.enum(['blocker', 'warning']), message: z.string(),
  sourceIds: z.array(IdSchema), fieldPaths: z.array(z.string()),
});
export const HoldSchema = strict({
  eventIds: z.array(IdSchema), scope: ScopeSchema.optional(), code: z.string(),
  dependencies: z.array(IdSchema), diagnostics: z.array(DiagnosticSchema),
});

export function ResultSchema<T extends z.ZodType>(value: T) {
  return guardKeys(z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), diagnostics: z.array(DiagnosticSchema) }),
  ]));
}

export function unique<T>(items: readonly T[], key: (item: T) => string) {
  return new Set(items.map(key)).size === items.length;
}

export function setOf<T extends z.ZodType>(schema: T, key: (item: z.output<T>) => string) {
  return z.array(schema).refine(items => unique(items, key), 'Duplicate set member');
}

export const IdSetSchema = setOf(IdSchema, id => id);
export const HashSetSchema = setOf(HashSchema, hash => hash);

export type Id = z.infer<typeof IdSchema>;
export type SemanticScopeKey = z.infer<typeof SemanticScopeKeySchema>;
export type SemanticVersionMap = z.infer<typeof SemanticVersionMapSchema>;
export type Hash = z.infer<typeof HashSchema>;
export type IsoDate = z.infer<typeof IsoDateSchema>;
export type IsoInstant = z.infer<typeof IsoInstantSchema>;
export type Cursor = z.infer<typeof CursorSchema>;
export type Version = z.infer<typeof VersionSchema>;
export type MoneyCents = z.infer<typeof MoneyCentsSchema>;
export type Decimal2 = z.infer<typeof Decimal2Schema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type RawIdentity = z.infer<typeof RawIdentitySchema>;
export type FinancialKind = z.infer<typeof FinancialKindSchema>;
export type EventKind = z.infer<typeof EventKindSchema>;
export type EconomicIdentity = z.infer<typeof EconomicIdentitySchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export type Hold = z.infer<typeof HoldSchema>;
export type Result<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] };
