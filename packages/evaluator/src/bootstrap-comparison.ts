import { hashCanonical, hashPlan, type Hold, type PlanOutcome } from '@eapr/contracts';
import type { BootstrapCase } from './bootstrap-cases.js';
import { bootstrapEqual, hasFinancialBaseline } from './bootstrap-verify.js';

export function observeBootstrapPlan(outcome: PlanOutcome) {
  const plan = outcome.plans.length === 1 ? outcome.plans[0]! : null;
  if (!plan || plan.hash !== hashPlan(plan)) return null;
  return { plan, bytesHash: hashCanonical(plan) };
}

const holdKey = ({ code, scope, eventIds }: Pick<Hold, 'code' | 'scope' | 'eventIds'>) =>
  hashCanonical({ code, scope: scope ?? null, eventIds: [...eventIds].sort() });

export function matchesBootstrapCase(probe: BootstrapCase, outcome: PlanOutcome): boolean {
  if (probe.expectedPlan) {
    if (outcome.plans.length !== 1 || !hasFinancialBaseline(outcome.plans[0]!) ||
      !bootstrapEqual(outcome.plans[0], probe.expectedPlan)) return false;
  } else if (outcome.plans.length !== 0) return false;

  return bootstrapEqual(outcome.holds.map(holdKey).sort(), probe.expectedHolds.map(holdKey).sort());
}
