import { z } from 'zod';
import { IdSchema, strict } from './common.js';

export const companyADemo = {
  seed: 'local-demo-v1',
  companyId: 'company-a',
  sourceRef: 'legacy-a',
  sellerEntityId: 'seller-a',
  manifestId: 'manifest-a-d22feb38e846-d4e83b7db551',
  manifestEpoch: 1,
  cutover: '2026-10-01T00:00:00.000Z',
  accountId: 'company-a.seller-a.cust-a-d22feb38e846-1',
  sourceAccountId: 'cust-a-d22feb38e846-1',
  parentCustomerId: 'buyer-shared-d22feb38e846',
  candidateId: 'demo-candidate-a',
  profileId: 'demo-profile-a',
  profileVersion: 2,
  connectorId: 'demo-connector-a',
  connectorVersion: 1,
  scenario: {
    id: 'demo-pay-a-cutover-300',
    paymentRecordId: 'pay-a:demo-pay-a-cutover-300',
    allocationRecordId: 'alloc-a:demo-pay-a-cutover-300',
    paymentEventId: 'evt:pay-a:demo-pay-a-cutover-300',
    allocationEventId: 'evt:alloc-a:demo-pay-a-cutover-300',
    invoiceId: 'inv-a:cust-a-d22feb38e846-1-2026-09-01',
    amount: '300.00',
    amountCents: 30000,
    effectiveDate: '2026-10-03',
    asOf: '2026-10-03T00:00:00.000Z',
    observedAt: '2026-10-03T00:00:00.000Z',
  },
} as const;

export const CompanyADemoEmptyRequestSchema = strict({});
export const CompanyADemoSourceInjectionResponseSchema = strict({
  sourceRef: z.literal(companyADemo.sourceRef),
  eventIds: z.tuple([
    z.literal(companyADemo.scenario.paymentEventId),
    z.literal(companyADemo.scenario.allocationEventId),
  ]),
});

export const CompanyADemoScenarioNameSchema = z.literal('freshPaymentA');
export const CompanyADemoEventIdSchema = IdSchema.refine(
  value => value === companyADemo.scenario.paymentEventId || value === companyADemo.scenario.allocationEventId,
);
