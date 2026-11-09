import {
  BootstrapBindingV1Schema, canonicalJson, hashArtifact, hashBootstrapVerificationResult, hashCanonical,
  hashEvent, hashManifest, hashPlan, hashProfile, hashTargetSnapshot, type MutationPlan,
} from '@eapr/contracts';
import {
  BootstrapEvaluatorCompletionV1Schema, BootstrapEvaluatorInputV1Schema,
  type BootstrapEvaluatorInputV1,
} from './bootstrap-protocol.js';

export const bootstrapEqual = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

export function deriveBootstrapBinding(input: BootstrapEvaluatorInputV1) {
  const { artifact, profiles, manifest, snapshot, target } = input;
  const profile = profiles.find(item => item.hash === input.selectedProfileHash);
  const profileHashes = profiles.map(item => item.hash).sort();
  const events = [...input.events].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const eventIds = events.map(event => event.id);
  if (!profile || !bootstrapEqual(profile.scope, target.scope) || target.asOf !== manifest.asOf ||
    artifact.hash !== hashArtifact(artifact) || profiles.some(item => item.hash !== hashProfile(item)) ||
    !bootstrapEqual(profileHashes, [...artifact.requiredProfileHashes].sort()) ||
    manifest.hash !== hashManifest(manifest) || snapshot.manifestId !== manifest.id ||
    new Set(eventIds).size !== eventIds.length || !bootstrapEqual(eventIds, [...snapshot.eventIds].sort()) ||
    events.some(event => event.contentHash !== hashEvent(event))) throw new Error('REQUEST_MISMATCH');

  return BootstrapBindingV1Schema.parse({
    artifactHash: artifact.hash, profileHash: profile.hash, requiredProfileHashes: profileHashes,
    scope: profile.scope, manifestId: manifest.id, manifestHash: manifest.hash,
    snapshotId: snapshot.id, snapshotHash: snapshot.contentHash, eventsHash: hashCanonical(events),
    targetSnapshotHash: hashTargetSnapshot(target), expectedTargetVersion: target.version, asOf: manifest.asOf,
  });
}

export function hasFinancialBaseline(plan: MutationPlan) {
  return plan.operations.some(operation => !operation.op.startsWith('ensure_')) &&
    plan.operations.filter(operation => operation.op === 'ensure_customer').length === 1 &&
    plan.operations.filter(operation => operation.op === 'ensure_account').length === 1 &&
    plan.operations.some(operation => operation.op === 'ensure_billing_configuration');
}

/** Validate the exact observed completion against the trusted reserved input. */
export function validateBootstrapCompletion(input: BootstrapEvaluatorInputV1, output: unknown) {
  try {
    const request = BootstrapEvaluatorInputV1Schema.parse(input);
    const completion = BootstrapEvaluatorCompletionV1Schema.parse(output);
    const { result, observedBaselinePlan: plan, observedBaselinePlanBytesHash: bytesHash } = completion;
    const binding = deriveBootstrapBinding(request);
    if (completion.jobId !== request.jobId || result.jobId !== request.jobId ||
      completion.requestHash !== hashCanonical(request) || !bootstrapEqual(result.pin, request.pin) ||
      !bootstrapEqual(result.binding, binding) || result.hash !== hashBootstrapVerificationResult(result)) {
      throw new Error();
    }
    if (plan === null) {
      if (result.planHash !== null || bytesHash !== null || result.passed) throw new Error();
    } else if (plan.hash !== result.planHash || plan.hash !== hashPlan(plan) || bytesHash !== hashCanonical(plan) ||
      plan.artifactHash !== binding.artifactHash || plan.profileHash !== binding.profileHash ||
      plan.expectedTargetVersion !== binding.expectedTargetVersion || plan.asOf !== binding.asOf ||
      !bootstrapEqual(plan.scope, binding.scope) || (result.passed && !hasFinancialBaseline(plan))) {
      throw new Error();
    }
    return completion;
  } catch {
    throw new Error('REQUEST_MISMATCH');
  }
}
