import { randomUUID } from 'node:crypto';
import { canonicalJson, type CompiledArtifact, type CustomerProfile, type PlanOutcome, type RawSourceEvent, type TargetState } from '@eapr/contracts';
import { runSubject } from './runner.js';
import { compareReferenceRecords, type ReferenceView } from './reference-model.js';

/** Apply subject inserts to a private local view and compare financial records and balances. */
export async function compareSubjectBaseline(
  artifact: CompiledArtifact, profile: CustomerProfile, events: RawSourceEvent[],
  target: TargetState, expected: ReferenceView,
) {
  const output = await runVerificationSubject(artifact, profile, events, target);
  if (!output.ok) throw new Error('Verification subject failed');
  const comparison = compareSubjectOutcome(artifact, profile, target, expected, output.value.outcome);
  return { ...comparison, matches: comparison.matches && output.value.outcome.holds.length === 0 };
}

export function runVerificationSubject(
  artifact: CompiledArtifact, profile: CustomerProfile, events: RawSourceEvent[], target: TargetState,
) {
  return runSubject(new URL('./subject-runner.ts', import.meta.url), {
    protocolVersion: 1, requestId: randomUUID(), artifact, profile, events, target,
  });
}

export function compareSubjectOutcome(
  artifact: CompiledArtifact, profile: CustomerProfile, target: TargetState, expected: ReferenceView, { plans }: PlanOutcome,
) {
  const actual = [...target.invoices, ...target.payments, ...target.credits, ...target.allocations, ...target.reversals];
  for (const plan of plans) {
    for (const operation of plan.operations) {
      switch (operation.op) {
        case 'insert_invoice': case 'insert_payment': case 'insert_credit': case 'add_allocation': case 'full_reverse':
          actual.push(operation.record);
          break;
        case 'ensure_customer': case 'ensure_account': case 'ensure_billing_configuration':
          break; // This comparison covers financial records. Configuration evidence is unavailable.
      }
    }
  }
  const comparison = compareReferenceRecords(expected.records, actual);
  return {
    matches: comparison.matches && plans.length <= 1 &&
      plans.every(plan => plan.expectedBalanceCents === expected.balanceCents &&
        plan.expectedTargetVersion === target.version && plan.asOf === target.asOf &&
        plan.artifactHash === artifact.hash && plan.profileHash === profile.hash &&
        canonicalJson(plan.scope) === canonicalJson(profile.scope)),
    unexplainedDifferenceCents: comparison.unexplainedDifferenceCents,
  };
}
