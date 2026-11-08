import {
  IdSchema, IsoDateSchema, IsoInstantSchema, TransactionCentsSchema,
  type CustomerProfile, type JsonValue, type MappingOp, type RawSourceEvent, type SourceContract,
} from '@eapr/contracts';

type MoneyResult = { ok: true; cents: number } | { ok: false; code: 'MONEY_FORMAT' | 'MONEY_SCALE' | 'MONEY_RANGE' };

export function parseMinorUnits(input: string): MoneyResult {
  const parts = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(input);
  if (!parts || parts[0] !== input) return { ok: false, code: 'MONEY_FORMAT' };
  const fraction = parts[2] ?? '';
  if (fraction.length > 2) return { ok: false, code: 'MONEY_SCALE' };
  if (parts[1].length > 5) return { ok: false, code: 'MONEY_RANGE' };
  const cents = Number(parts[1] + fraction.padEnd(2, '0'));
  return cents <= 5000000 ? { ok: true, cents } : { ok: false, code: 'MONEY_RANGE' };
}

export class MappingError extends Error {
  constructor(readonly code: string, message: string, readonly path: string) {
    super(message);
    this.name = 'MappingError';
  }
}

export function fieldName(path: string): string {
  return path.slice(1).replaceAll('~1', '/').replaceAll('~0', '~');
}

export function validateSourcePayload(contract: SourceContract, event: RawSourceEvent): void {
  const { payload } = event;
  for (const field of Object.keys(payload).sort()) {
    if (!Object.hasOwn(contract.fields, field)) {
      throw new MappingError('SOURCE_SCHEMA', 'Source payload contains an undeclared field', '/payload');
    }
  }
  for (const field of Object.keys(contract.fields).sort()) {
    const definition = contract.fields[field];
    const value = Object.hasOwn(payload, field) ? payload[field] : undefined;
    const path = '/' + field.replaceAll('~', '~0').replaceAll('/', '~1');
    if ((value === undefined && !definition.required) || (value === null && definition.nullable)) continue;
    if (value === undefined || value === null || definition.type === 'boolean' && typeof value !== 'boolean') {
      throw new MappingError('SOURCE_SCHEMA', 'Source field does not match its declared type', path);
    }
    if (definition.type === 'integer') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < definition.minimum || value > definition.maximum) {
        throw new MappingError('SOURCE_SCHEMA', 'Source integer is outside its declared range', path);
      }
    }
    if (definition.type !== 'string') continue;
    if (typeof value !== 'string' || definition.enum && !definition.enum.includes(value)) {
      throw new MappingError('SOURCE_SCHEMA', 'Source text does not match its declared values', path);
    }
    if (definition.format === 'decimal2') {
      const parsed = parseMinorUnits(value);
      if (!parsed.ok) throw new MappingError(parsed.code, 'Source decimal money is invalid', path);
    }
    if ((definition.format === 'iso-date' && !IsoDateSchema.safeParse(value).success) ||
      (definition.format === 'iso-instant' && !IsoInstantSchema.safeParse(value).success)) {
      throw new MappingError('SOURCE_DATE', 'Source date is invalid or ambiguous', path);
    }
  }

  if (payload[contract.recordIdField] !== event.recordId || payload[contract.recordVersionField] !== event.recordVersion ||
    contract.accountIdField !== null && payload[contract.accountIdField] !== event.rawIdentity.sourceAccountId) {
    throw new MappingError('SOURCE_SCHEMA', 'Source identity fields do not match the event envelope', '/payload');
  }
}

export function isTargetValue(field: string, value: unknown): boolean {
  switch (field) {
    case 'amountCents': return TransactionCentsSchema.safeParse(value).success;
    case 'currency': return value === 'USD';
    case 'dueDate': return IsoDateSchema.safeParse(value).success;
    case 'effectiveAt': return IsoInstantSchema.safeParse(value).success;
    case 'fundingKind':
    case 'reversedKind': return value === 'payment' || value === 'credit';
    case 'fundingRecordId':
    case 'invoiceRecordId':
    case 'reversedRecordId': return IdSchema.safeParse(value).success;
    default: return false;
  }
}

export function normalizeText(value: string, mode: 'trim' | 'lower'): string {
  return mode === 'trim' ? value.trim() : value.toLowerCase();
}

export function executeMapping(
  mapping: MappingOp, target: string, event: RawSourceEvent, profile: CustomerProfile,
): { value: JsonValue; sourcePaths: string[]; evidenceRefs: string[]; derivationInputs: string[] } {
  if (mapping.op === 'effective_term') {
    throw new MappingError('MAPPING_TYPE', 'Contract terms are not financial record scalars', mapping.datePath);
  }
  const sourcePaths = mapping.op === 'constant' ? [] : [mapping.path];
  const evidenceRefs: string[] = [];
  const derivationInputs: string[] = [];
  const path = sourcePaths[0] ?? '/' + target;
  const field = sourcePaths.length ? fieldName(path) : '';
  const input = Object.hasOwn(event.payload, field) ? event.payload[field] : undefined;
  let value: JsonValue | undefined;

  switch (mapping.op) {
    case 'constant':
      value = mapping.value;
      evidenceRefs.push(mapping.evidenceRef);
      break;
    case 'field':
    case 'existing_invoice_lookup':
      // The planner resolves this ID against the exact existing or in-batch scoped invoice.
      value = input;
      break;
    case 'decimal_to_minor': {
      const parsed = typeof input === 'string' ? parseMinorUnits(input) : { ok: false, code: 'MONEY_FORMAT' } as const;
      if (!parsed.ok) throw new MappingError(parsed.code, 'Mapped decimal money is invalid', path);
      value = parsed.cents;
      break;
    }
    case 'date_parse':
      if (typeof input === 'string') {
        if (mapping.format === 'YYYY-MM-DD' && IsoDateSchema.safeParse(input).success) value = input + 'T00:00:00.000Z';
        else if (mapping.format === 'ISO_INSTANT') value = IsoInstantSchema.safeParse(input).data;
      }
      if (value === undefined) throw new MappingError('SOURCE_DATE', 'Mapped date is invalid or ambiguous', path);
      break;
    case 'enum_lookup':
      if (typeof input === 'string' && Object.hasOwn(mapping.values, input)) value = mapping.values[input];
      if (value === undefined) throw new MappingError('LOOKUP_MISSING', 'No exact enum lookup result', path);
      break;
    case 'approved_lookup': {
      const table = profile.approvedLookups.find(candidate => candidate.id === mapping.tableId && candidate.valueType === 'text');
      const entry = table?.entries.find(candidate => candidate.source === input);
      if (!table || !entry) throw new MappingError('LOOKUP_MISSING', 'No exact approved lookup result', path);
      value = entry.target;
      evidenceRefs.push(...entry.evidenceRefs);
      derivationInputs.push(table.id, profile.id);
      break;
    }
    case 'normalize_text':
      if (typeof input === 'string') value = normalizeText(input, mapping.mode);
      break;
  }

  if (value === undefined || !isTargetValue(target, value)) {
    const code = target === 'amountCents' ? 'MONEY_RANGE' : target === 'currency' ? 'CURRENCY_UNSUPPORTED' : 'MAPPING_VALUE';
    throw new MappingError(code, 'Mapped value does not satisfy the target field', path);
  }
  if (target === 'effectiveAt') value = IsoInstantSchema.parse(value);
  return { value, sourcePaths, evidenceRefs: [...new Set(evidenceRefs)].sort(), derivationInputs };
}
