import { afterEach, expect, test, vi } from 'vitest';
import { planBatch } from '@eapr/compiler/plan-batch';
import type { SourceEvent } from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { FinanceError } from '@eapr/finance/validate';
import { profileA } from '../../../tests/fixtures/index.js';
import { artifactA, independentInvoice, malformed, replayInvoice, targetAtLatePayment } from './fixtures/classification-cases.js';

vi.mock('@eapr/finance/balance', async importOriginal => {
  const balance = await importOriginal<typeof import('@eapr/finance/balance')>();
  return { ...balance, computeBalance: vi.fn(balance.computeBalance) };
});

afterEach(() => {
  vi.mocked(computeBalance).mockReset();
});

const message = 'Monetary total exceeds the exact integer range';
const inputs: unknown = [malformed, independentInvoice, replayInvoice];
const acceptedIds = [replayInvoice.id, independentInvoice.id];
const expectedLegacyFailure = {
  plans: [],
  holds: [{
    eventIds: [], code: 'SOURCE_SCHEMA', dependencies: [],
    diagnostics: [{
      code: 'SOURCE_SCHEMA', severity: 'blocker', message: 'Invalid source event envelope', sourceIds: [], fieldPaths: [],
    }],
  }, {
    eventIds: acceptedIds, code: 'MONEY_RANGE', scope: profileA.scope, dependencies: [],
    diagnostics: [{
      code: 'MONEY_RANGE', severity: 'blocker', message, sourceIds: acceptedIds, fieldPaths: [],
    }],
  }],
};

test('keeps earlier holds and appends the final finance failure for accepted deliveries', () => {
  vi.mocked(computeBalance).mockImplementationOnce(() => { throw new FinanceError('MONEY_RANGE', message); });
  expect(planBatch(artifactA, profileA, inputs as SourceEvent[], targetAtLatePayment)).toEqual(expectedLegacyFailure);
});
