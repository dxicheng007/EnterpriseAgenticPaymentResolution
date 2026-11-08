import { z } from 'zod';
import {
  EventKindSchema, FieldPathSchema, FinancialKindSchema, HashSchema, HashSetSchema, IdSchema, IdSetSchema,
  IsoDateSchema, JsonValueSchema, MoneyCentsSchema, SafeIntegerSchema, SafeKeySchema, ScopeSchema,
  VersionSchema, guardKeys, setOf, strict, unique,
} from './common.js';
import { FindingSchema } from './model.js';

const required = { required: z.boolean(), nullable: z.boolean() };
export const FieldContractSchema = guardKeys(z.discriminatedUnion('type', [
  z.strictObject({
    ...required, type: z.literal('string'), format: z.enum(['text', 'decimal2', 'iso-date', 'iso-instant']),
    enum: setOf(z.string(), value => value).optional(),
  }),
  z.strictObject({
    ...required, type: z.literal('integer'), unit: z.enum(['minor', 'count']),
    minimum: SafeIntegerSchema, maximum: SafeIntegerSchema,
  }).refine(field => field.minimum <= field.maximum, 'Invalid integer range'),
  z.strictObject({ ...required, type: z.literal('boolean') }),
]));

const fieldName = SafeKeySchema.min(1);
export const SourceContractSchema = strict({
  resource: IdSchema, kind: EventKindSchema, schemaVersion: IdSchema, fields: z.record(fieldName, FieldContractSchema),
  additionalProperties: z.literal(false), currency: z.literal('USD'), timezone: z.literal('UTC'),
  recordIdField: fieldName, recordVersionField: fieldName, accountIdField: fieldName.nullable(),
  semantics: z.literal('append-only-events'), moneyUpdates: z.literal('full-reversal-only'),
});
export const CaptureStreamSchema = strict({
  streamId: IdSchema, transport: z.enum(['api', 'csv', 'semantic']), resources: IdSetSchema,
  cursorStrategy: z.literal('positive-safe-integer'), pageSize: z.number().int().min(1).max(1000),
});

const path = { path: FieldPathSchema };
export const MappingOpSchema = guardKeys(z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('field'), ...path }),
  z.strictObject({ op: z.literal('constant'), value: JsonValueSchema, evidenceRef: IdSchema }),
  z.strictObject({ op: z.literal('decimal_to_minor'), ...path, scale: z.literal(2) }),
  z.strictObject({ op: z.literal('date_parse'), ...path, format: z.enum(['YYYY-MM-DD', 'ISO_INSTANT']), timezone: z.literal('UTC') }),
  z.strictObject({ op: z.literal('enum_lookup'), ...path, values: z.record(SafeKeySchema, z.string()) }),
  z.strictObject({ op: z.literal('approved_lookup'), ...path, tableId: IdSchema }),
  z.strictObject({ op: z.literal('existing_invoice_lookup'), ...path }),
  z.strictObject({ op: z.literal('normalize_text'), ...path, mode: z.enum(['trim', 'lower']) }),
  z.strictObject({ op: z.literal('effective_term'), contractId: IdSchema, datePath: FieldPathSchema }),
]));
const commonFields = { currency: MappingOpSchema, effectiveAt: MappingOpSchema };
const amountFields = { ...commonFields, amountCents: MappingOpSchema };
export const EntityMappingSchema = guardKeys(z.discriminatedUnion('kind', [
  z.strictObject({
    resource: IdSchema, kind: z.literal('invoice'), fields: strict({ ...amountFields, dueDate: MappingOpSchema }),
  }),
  z.strictObject({ resource: IdSchema, kind: z.enum(['payment', 'credit']), fields: strict(amountFields) }),
  z.strictObject({
    resource: IdSchema, kind: z.literal('allocation'),
    fields: strict({ ...amountFields, fundingKind: MappingOpSchema, fundingRecordId: MappingOpSchema, invoiceRecordId: MappingOpSchema }),
  }),
  z.strictObject({
    resource: IdSchema, kind: z.literal('reversal'),
    fields: strict({ ...commonFields, reversedKind: MappingOpSchema, reversedRecordId: MappingOpSchema }),
  }),
]));
export const ValidatorIdSchema = z.enum([
  'identity_scope', 'source_contract', 'semantic_version', 'safe_money', 'usd_only',
  'economic_uniqueness', 'explicit_allocation', 'allocation_limits', 'full_reversal', 'effective_terms',
  'target_version', 'cycle_limits', 'evidence_support',
]);
const limits = { maxTransactionCents: z.literal(5000000), maxRecordsPerCycle: z.literal(1000) };
const connectorFields = {
  sourceRef: IdSchema, sourceContracts: setOf(SourceContractSchema, contract => contract.resource),
  capture: setOf(CaptureStreamSchema, stream => stream.streamId),
  mappings: setOf(EntityMappingSchema, mapping => mapping.resource),
  allowedKinds: setOf(FinancialKindSchema, kind => kind), runtimeModelCalls: z.literal('forbidden'),
};
const validators = setOf(ValidatorIdSchema, id => id);
export const ConnectorSpecSchema = strict({
  ...connectorFields, ...limits, id: IdSchema, version: VersionSchema,
  targetSchemaVersion: z.literal('1'), requiredValidators: validators, evidenceRefs: IdSetSchema,
});
export const ApprovedLookupSchema = strict({
  id: IdSchema, valueType: z.enum(['parent-account', 'text']),
  entries: setOf(strict({ source: SafeKeySchema, target: z.string(), evidenceRefs: IdSetSchema }), entry => entry.source),
});
export const ContractTermSchema = strict({
  id: IdSchema, contractId: IdSchema, validFrom: IsoDateSchema, validToExclusive: IsoDateSchema.nullable(),
  fixedMonthlyFeeCents: MoneyCentsSchema, currency: z.literal('USD'), cadence: z.literal('monthly'),
  anchorDay: z.number().int().min(1).max(31), evidenceRefs: IdSetSchema,
}).refine(term => term.validToExclusive === null || term.validFrom < term.validToExclusive, 'Invalid effective interval');
export const ProfileBootstrapSchema = strict({
  customer: strict({
    id: IdSchema, displayName: z.string().min(1), evidenceRefs: IdSetSchema.refine(refs => refs.length > 0),
  }),
  billingConfigurationIds: setOf(strict({ termId: IdSchema, id: IdSchema }), binding => binding.termId)
    .refine(bindings => unique(bindings, binding => binding.id), 'Duplicate billing configuration ID'),
});
export type ProfileBootstrap = z.infer<typeof ProfileBootstrapSchema>;

export const CustomerProfileSchema = strict({
  id: IdSchema, version: VersionSchema, hash: HashSchema, sourceRef: IdSchema, scope: ScopeSchema,
  parentCustomerId: IdSchema, sourceAccountIds: IdSetSchema,
  approvedLookups: setOf(ApprovedLookupSchema, lookup => lookup.id),
  contractTerms: setOf(ContractTermSchema, term => term.id),
  semanticVersion: IdSchema, findings: setOf(FindingSchema, finding => finding.id),
  bootstrap: ProfileBootstrapSchema.optional(),
}).refine(({ bootstrap, parentCustomerId }) => !bootstrap || bootstrap.customer.id === parentCustomerId, {
  path: ['bootstrap', 'customer', 'id'], message: 'Bootstrap customer differs from parent customer',
}).refine(({ bootstrap, contractTerms }) => {
  if (!bootstrap) return true;
  const termIds = new Set(contractTerms.map(term => term.id));
  return bootstrap.billingConfigurationIds.length === termIds.size &&
    bootstrap.billingConfigurationIds.every(binding => termIds.has(binding.termId));
}, {
  path: ['bootstrap', 'billingConfigurationIds'], message: 'Bootstrap bindings must cover exactly the profile terms',
});
export const NormalizedPlanSchema = strict({
  ...connectorFields, validators, limits: strict(limits),
});
export const CompiledArtifactSchema = strict({
  id: IdSchema, sourceRef: IdSchema, hash: HashSchema, specHash: HashSchema,
  compilerVersion: z.literal('1'), runtimeVersion: z.literal('1'), targetSchemaVersion: z.literal('1'),
  normalizedPlan: NormalizedPlanSchema,
  sourceContractHashes: setOf(strict({ resource: IdSchema, hash: HashSchema }), entry => entry.resource),
  requiredProfileHashes: HashSetSchema,
});
export type FieldContract = z.infer<typeof FieldContractSchema>;
export type SourceContract = z.infer<typeof SourceContractSchema>;
export type CaptureStream = z.infer<typeof CaptureStreamSchema>;
export type MappingOp = z.infer<typeof MappingOpSchema>;
export type EntityMapping = z.infer<typeof EntityMappingSchema>;
export type ValidatorId = z.infer<typeof ValidatorIdSchema>;
export type ConnectorSpec = z.infer<typeof ConnectorSpecSchema>;
export type ApprovedLookup = z.infer<typeof ApprovedLookupSchema>;
export type ContractTerm = z.infer<typeof ContractTermSchema>;
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;
export type NormalizedPlan = z.infer<typeof NormalizedPlanSchema>;
export type CompiledArtifact = z.infer<typeof CompiledArtifactSchema>;
