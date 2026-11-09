import { join } from 'node:path';
import {
  ActivationTrustPolicyV1Schema, canonicalJson, hashActivationTrustPolicy, type ActivationTrustPolicyV1,
} from '@eapr/contracts';
import { decodeCanonical, digestPath, freezeJson, hasFileCode, publishBytes, readPrivateBytes, trustedDirectory } from './activation-files.js';

function validate(policy: ActivationTrustPolicyV1) {
  if (policy.entries.length === 0 || policy.hash !== hashActivationTrustPolicy(policy)) {
    throw new Error('ACTIVATION_POLICY_MISMATCH');
  }
  return policy;
}

export async function loadActivationPolicy({ policyPath }: { policyPath: string }): Promise<ActivationTrustPolicyV1> {
  try {
    return freezeJson(validate(decodeCanonical(await readPrivateBytes(policyPath), ActivationTrustPolicyV1Schema)));
  } catch (error) {
    throw new Error(hasFileCode(error, 'ENOENT') || hasFileCode(error, 'EACCES')
      ? 'ACTIVATION_POLICY_UNAVAILABLE' : 'ACTIVATION_POLICY_MISMATCH');
  }
}

/** Operator setup only. Preparation and proof validation are owned by the operator command. */
export async function publishActivationPolicy(
  { policyRoot }: { policyRoot: string }, input: ActivationTrustPolicyV1, install = false,
): Promise<void> {
  try {
    const policy = validate(ActivationTrustPolicyV1Schema.parse(input));
    await trustedDirectory(policyRoot, true);
    const bytes = Buffer.from(canonicalJson(policy));
    await publishBytes(digestPath(join(policyRoot, 'policies'), policy.hash), bytes);
    if (install) await publishBytes(join(policyRoot, 'current.json'), bytes, true);
  } catch {
    throw new Error('ACTIVATION_POLICY_MISMATCH');
  }
}
