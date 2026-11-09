import { expect, test } from 'vitest';
import * as protocol from '../src/financial-attestation-protocol.js';

test('financial completion requires a dedicated envelope', () => {
  expect(protocol.FinancialEvaluatorCompletionV1Schema.safeParse({
    protocolVersion: 'financial-attestation-probe-result-1',
  }).success).toBe(false);
  expect(protocol.FinancialEvaluatorCompletionV1Schema.safeParse({
    protocolVersion: 'financial-attestation-completion-1', jobId: 'job:1',
  }).success).toBe(false);
});
