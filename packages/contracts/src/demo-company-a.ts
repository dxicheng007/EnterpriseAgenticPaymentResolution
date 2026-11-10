import { z } from 'zod';
import { strict } from './common.js';

export const companyADemo = {
  seed: 'local-demo-v1',
  scope: { accountId: 'company-a.seller-a.cust-a-d22feb38e846-1', companyId: 'company-a', sellerEntityId: 'seller-a' },
  sourceRef: 'legacy-a',
  manifestId: 'manifest-a-d22feb38e846-d4e83b7db551',
  cutover: '2026-10-01T00:00:00.000Z',
  candidateId: 'demo-candidate-a',
  parentCustomerId: 'buyer-shared-d22feb38e846',
  profileId: 'demo-profile-a',
  profileVersion: 2,
  connectorId: 'demo-connector-a',
  connectorVersion: 1,
  streams: ['a-finance', 'a-semantics'],
  scenario: {
    id: 'demo-pay-a-cutover-300',
    accountId: 'cust-a-d22feb38e846-1',
    invoiceId: 'inv-a:cust-a-d22feb38e846-1-2026-09-01',
    amount: '300.00',
    effectiveDate: '2026-10-03',
    observedAt: '2026-10-03T00:00:00.000Z',
  },
  recordIds: ['pay-a:demo-pay-a-cutover-300', 'alloc-a:demo-pay-a-cutover-300'],
  eventIds: ['evt:pay-a:demo-pay-a-cutover-300', 'evt:alloc-a:demo-pay-a-cutover-300'],
} as const;

export const CompanyADemoRequestSchema = strict({});
export const CompanyADemoPaymentResponseSchema = strict({
  sourceRef: z.literal(companyADemo.sourceRef),
  eventIds: z.tuple([z.literal(companyADemo.eventIds[0]), z.literal(companyADemo.eventIds[1])]),
});
