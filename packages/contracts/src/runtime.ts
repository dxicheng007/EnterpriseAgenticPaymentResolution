import { z } from 'zod';
import {
  DiagnosticSchema, EconomicIdentitySchema, HashSchema, HoldSchema, IdSchema, IsoDateSchema, IsoInstantSchema,
  JsonPointerSchema, NonnegativeIntegerSchema, SafeIntegerSchema, ScopeSchema,
  TransactionCentsSchema, VersionSchema, guardKeys, strict,
} from './common.js';
import { CompiledArtifactSchema, ConnectorSpecSchema, ContractTermSchema, CustomerProfileSchema, MappingOpSchema } from './connector.js';

const recordBase = {
  id: IdSchema, identity: EconomicIdentitySchema, sourceRecordVersion: VersionSchema,
  scope: ScopeSchema, effectiveAt: IsoInstantSchema, sourceEventId: IdSchema, currency: z.literal('USD'),
};
export const RecordBaseSchema = strict(recordBase);
export type RecordBase = z.infer<typeof RecordBaseSchema>;

const fundingKind = z.enum(['payment', 'credit']);
const funded = { ...recordBase, amountCents: TransactionCentsSchema };
const sameIdentityKind = (record: { kind: string; identity: { kind: string } }) => record.kind === record.identity.kind;
export const InvoiceSchema = strict({ ...funded, kind: z.literal('invoice'), dueDate: IsoDateSchema }).refine(sameIdentityKind);
export const FundingSchema = strict({ ...funded, kind: fundingKind }).refine(sameIdentityKind);
const payment = strict({ ...funded, kind: z.literal('payment') }).refine(sameIdentityKind);
const credit = strict({ ...funded, kind: z.literal('credit') }).refine(sameIdentityKind);
export const AllocationSchema = strict({
  ...funded, kind: z.literal('allocation'), fundingKind, fundingRecordId: IdSchema, invoiceRecordId: IdSchema,
}).refine(sameIdentityKind);
export const FullReversalSchema = strict({
  ...recordBase, kind: z.literal('reversal'), reversedKind: fundingKind, reversedRecordId: IdSchema,
}).refine(sameIdentityKind);
export const ParentCustomerSchema = strict({ id: IdSchema, displayName: z.string(), evidenceRefs: z.array(IdSchema) });
export const ParentAccountSchema = strict({
  id: IdSchema, scope: ScopeSchema, parentCustomerId: IdSchema, sourceRef: IdSchema, sourceAccountIds: z.array(IdSchema),
});
export const BillingConfigurationSchema = strict({ id: IdSchema, scope: ScopeSchema, contractTerm: ContractTermSchema });
export const TargetStateSchema = strict({
  scope: ScopeSchema, version: NonnegativeIntegerSchema, asOf: IsoInstantSchema,
  invoices: z.array(InvoiceSchema), payments: z.array(payment), credits: z.array(credit),
  allocations: z.array(AllocationSchema), reversals: z.array(FullReversalSchema),
  customers: z.array(ParentCustomerSchema), accounts: z.array(ParentAccountSchema),
  billingConfigurations: z.array(BillingConfigurationSchema),
}).refine(state => [
  ...state.invoices, ...state.payments, ...state.credits, ...state.allocations, ...state.reversals,
  ...state.accounts, ...state.billingConfigurations,
].every(({ scope }) => scope.accountId === state.scope.accountId && scope.sellerEntityId === state.scope.sellerEntityId &&
  scope.companyId === state.scope.companyId), 'Target record scope differs from state scope');

export const MutationOperationSchema = guardKeys(z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('insert_invoice'), record: InvoiceSchema }),
  z.strictObject({ op: z.literal('insert_payment'), record: payment }),
  z.strictObject({ op: z.literal('insert_credit'), record: credit }),
  z.strictObject({ op: z.literal('add_allocation'), record: AllocationSchema }),
  z.strictObject({ op: z.literal('full_reverse'), record: FullReversalSchema }),
  z.strictObject({ op: z.literal('ensure_customer'), record: ParentCustomerSchema }),
  z.strictObject({ op: z.literal('ensure_account'), record: ParentAccountSchema }),
  z.strictObject({ op: z.literal('ensure_billing_configuration'), record: BillingConfigurationSchema }),
]));
export const FieldLineageSchema = strict({
  operationIndex: NonnegativeIntegerSchema, targetField: JsonPointerSchema, sourceEventIds: z.array(IdSchema),
  sourcePaths: z.array(JsonPointerSchema), evidenceRefs: z.array(IdSchema), mapping: MappingOpSchema.nullable(),
  derivationInputs: z.array(IdSchema),
});
export const MutationPlanSchema = strict({
  hash: HashSchema, scope: ScopeSchema, artifactHash: HashSchema, profileHash: HashSchema,
  expectedTargetVersion: NonnegativeIntegerSchema, eventIds: z.array(IdSchema), operations: z.array(MutationOperationSchema),
  expectedBalanceCents: SafeIntegerSchema, asOf: IsoInstantSchema, lineage: z.array(FieldLineageSchema),
});
export const PlanOutcomeSchema = strict({ plans: z.array(MutationPlanSchema), holds: z.array(HoldSchema) });
export const PreviewRequestSchema = strict({
  spec: ConnectorSpecSchema, profiles: z.array(CustomerProfileSchema), snapshotId: IdSchema, asOf: IsoInstantSchema,
});
export const PreviewResponseSchema = strict({
  artifact: CompiledArtifactSchema.nullable(), outcome: PlanOutcomeSchema,
  diffs: z.array(strict({
    scope: ScopeSchema, beforeVersion: NonnegativeIntegerSchema,
    beforeBalanceCents: SafeIntegerSchema, afterBalanceCents: SafeIntegerSchema,
    operations: z.array(MutationOperationSchema), lineage: z.array(FieldLineageSchema),
  })),
  unsupportedRows: z.array(HoldSchema), diagnostics: z.array(DiagnosticSchema), parentWrites: z.literal(0),
});
export const SyncReceiptSchema = strict({
  id: IdSchema, scope: ScopeSchema, activationId: IdSchema, epoch: VersionSchema, artifactHash: HashSchema,
  planHash: HashSchema, eventIds: z.array(IdSchema), targetRecordIds: z.array(IdSchema), beforeBalanceCents: SafeIntegerSchema,
  afterBalanceCents: SafeIntegerSchema, status: z.literal('applied'), committedAt: IsoInstantSchema,
});
export const ReceiptResponseSchema = strict({ receipt: SyncReceiptSchema, replayed: z.boolean() });
export type Invoice = z.infer<typeof InvoiceSchema>;
export type Funding = z.infer<typeof FundingSchema>;
export type Allocation = z.infer<typeof AllocationSchema>;
export type FullReversal = z.infer<typeof FullReversalSchema>;
export type ParentCustomer = z.infer<typeof ParentCustomerSchema>;
export type ParentAccount = z.infer<typeof ParentAccountSchema>;
export type BillingConfiguration = z.infer<typeof BillingConfigurationSchema>;
export type TargetState = z.infer<typeof TargetStateSchema>;
export type MutationOperation = z.infer<typeof MutationOperationSchema>;
export type FieldLineage = z.infer<typeof FieldLineageSchema>;
export type MutationPlan = z.infer<typeof MutationPlanSchema>;
export type PlanOutcome = z.infer<typeof PlanOutcomeSchema>;
export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;
export type PreviewResponse = z.infer<typeof PreviewResponseSchema>;
export type SyncReceipt = z.infer<typeof SyncReceiptSchema>;
export type ReceiptResponse = z.infer<typeof ReceiptResponseSchema>;
