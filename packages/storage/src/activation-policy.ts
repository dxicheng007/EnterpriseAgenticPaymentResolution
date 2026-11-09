import { ActivationTrustPolicyV1Schema, type ActivationTrustPolicyV1 } from '@eapr/contracts';
import { decodeCanonical, freezeJson, hasFileCode, readPrivateBytes, validateActivationPolicy } from './activation-files.js';

export async function loadActivationPolicy({ policyPath }: { policyPath: string }): Promise<ActivationTrustPolicyV1> {
  try {
    return freezeJson(validateActivationPolicy(decodeCanonical(await readPrivateBytes(policyPath), ActivationTrustPolicyV1Schema)));
  } catch (error) {
    throw new Error(hasFileCode(error, 'ENOENT') || hasFileCode(error, 'EACCES')
      ? 'ACTIVATION_POLICY_UNAVAILABLE' : 'ACTIVATION_POLICY_MISMATCH');
  }
}
