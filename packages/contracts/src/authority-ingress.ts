import { z } from 'zod';
import { HashSchema, IdSchema, strict } from './common.js';
import { ReviewerContextSchema } from './review.js';

export const AuthorityOperationBodyV1Schema = strict({
  expectedEpoch: z.number().int().positive().refine(Number.isSafeInteger), idempotencyKey: IdSchema,
});
export const AuthorityOperationV1Schema = z.union([
  strict({ schemaVersion: z.literal('1'), accountId: IdSchema, action: z.literal('read'), body: z.null() }),
  strict({ schemaVersion: z.literal('1'), accountId: IdSchema,
    action: z.enum(['pause', 'resume', 'revoke']), body: AuthorityOperationBodyV1Schema }),
]);
export const AuthorityAdmissionTicketSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const AuthorityAdmissionGrantsV1Schema = strict({
  reviewer: ReviewerContextSchema, allowedAccountIds: z.array(IdSchema), allowedSourceRefs: z.array(IdSchema),
});
export const AuthorityAdmissionCheckV1Schema = strict({
  ticket: AuthorityAdmissionTicketSchema, requestHash: HashSchema, mode: z.enum(['read', 'mutation']),
});
export const AuthorityAdmissionResponseV1Schema = strict({
  requestHash: HashSchema, grants: AuthorityAdmissionGrantsV1Schema,
});

export type AuthorityOperationBodyV1 = z.infer<typeof AuthorityOperationBodyV1Schema>;
export type AuthorityOperationV1 = z.infer<typeof AuthorityOperationV1Schema>;
export type AuthorityAdmissionTicket = z.infer<typeof AuthorityAdmissionTicketSchema>;
export type AuthorityAdmissionGrantsV1 = z.infer<typeof AuthorityAdmissionGrantsV1Schema>;
export type AuthorityAdmissionCheckV1 = z.infer<typeof AuthorityAdmissionCheckV1Schema>;
export type AuthorityAdmissionResponseV1 = z.infer<typeof AuthorityAdmissionResponseV1Schema>;
