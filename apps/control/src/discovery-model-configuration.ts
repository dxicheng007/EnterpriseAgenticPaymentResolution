import { guardKeys, hashCanonical, HashSchema, IdSchema, strict, type Hash } from '@eapr/contracts';
import { z } from 'zod';

const limitsSchema = strict({
  maxInputTokens: z.literal(8192),
  maxOutputTokens: z.literal(2048),
  timeoutMs: z.literal(60000),
  maxPreparedRequestBytes: z.literal(131072),
});

const policySchema = strict({
  schemaVersion: z.literal(1),
  providerId: IdSchema,
  modelId: IdSchema,
  adapterId: IdSchema,
  adapterVersion: IdSchema,
  meterId: IdSchema,
  meterVersion: IdSchema,
  providerRulesHash: HashSchema,
  endpointBindingId: IdSchema,
  limits: limitsSchema,
});

const configurationSchema = guardKeys(z.discriminatedUnion('state', [
  z.strictObject({ schemaVersion: z.literal(1), state: z.literal('disabled') }),
  z.strictObject({ schemaVersion: z.literal(1), state: z.literal('configured'), policy: policySchema }),
]));

const invalidCode = 'MODEL_CONFIGURATION_INVALID';

export type TrustedModelPolicyV1 = z.infer<typeof policySchema>;
export type DiscoveryModelConfiguration = z.infer<typeof configurationSchema>;

export type DisabledDiscoveryModel = {
  available: false;
  reason: 'MODEL_UNCONFIGURED' | 'MODEL_CONFIGURATION_INVALID' | 'MODEL_LIVE_RELEASE_PENDING';
};

export function parseDiscoveryModelConfiguration(input: unknown):
  | { ok: true; value: DiscoveryModelConfiguration }
  | { ok: false; code: typeof invalidCode } {
  try {
    return { ok: true, value: configurationSchema.parse(input) };
  } catch {
    return { ok: false, code: invalidCode };
  }
}

export function hashDiscoveryModelPolicy(policy: TrustedModelPolicyV1): Hash {
  try {
    const parsedPolicy = policySchema.parse(policy);
    return hashCanonical({ kind: 'discovery-model-policy', version: 1, policy: parsedPolicy });
  } catch {
    throw new Error(invalidCode);
  }
}

export function resolveOfflineDiscoveryModel(input?: unknown): DisabledDiscoveryModel {
  if (arguments.length === 0) return { available: false, reason: 'MODEL_UNCONFIGURED' };

  const parsed = parseDiscoveryModelConfiguration(input);
  if (!parsed.ok) return { available: false, reason: parsed.code };
  return {
    available: false,
    reason: parsed.value.state === 'disabled' ? 'MODEL_UNCONFIGURED' : 'MODEL_LIVE_RELEASE_PENDING',
  };
}
