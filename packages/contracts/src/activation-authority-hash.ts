import {
  ActivationTrustPolicyEntryV1Schema, ActivationTrustPolicyV1Schema, FinancialAttestationV1Schema,
  FinancialReservationV1Schema, RegisteredScopeIndexV1Schema, type ActivationTrustPolicyEntryV1,
  type ActivationTrustPolicyV1, type FinancialAttestationV1, type FinancialReservationV1, type RegisteredScopeIndexV1,
} from './activation-authority.js';
import { canonicalJson, hashCanonical } from './canonical.js';
import type { Hash } from './common.js';
import { VerificationReportSchema, type VerificationReport } from './review.js';

type HashInput<T extends { hash: Hash }> = Omit<T, 'hash'> & { hash?: Hash };
const placeholderHash = '0'.repeat(64);

function hashNormalized<T extends { hash: Hash }>(input: HashInput<T>, schema: { parse(input: unknown): T }): Hash {
  const { hash: _hash, ...preimage } = schema.parse(
    Object.hasOwn(input, 'hash') ? input : { ...input, hash: placeholderHash },
  );
  return hashCanonical(preimage);
}

export function hashFinancialReservation(input: HashInput<FinancialReservationV1>): Hash {
  return hashNormalized(input, FinancialReservationV1Schema);
}

export function hashFinancialAttestation(input: HashInput<FinancialAttestationV1>): Hash {
  return hashNormalized(input, FinancialAttestationV1Schema);
}

export function hashActivationTrustPolicy(input: HashInput<ActivationTrustPolicyV1>): Hash {
  return hashNormalized(input, ActivationTrustPolicyV1Schema);
}

export function hashRegisteredScopeIndex(input: HashInput<RegisteredScopeIndexV1>): Hash {
  return hashNormalized(input, RegisteredScopeIndexV1Schema);
}

export function hashFinancialReport(input: VerificationReport): Hash {
  return hashCanonical(VerificationReportSchema.parse(input));
}

export function matchesActivationTrustPolicyEntry(
  entry: ActivationTrustPolicyEntryV1,
  expected: ActivationTrustPolicyEntryV1,
): boolean {
  return canonicalJson(ActivationTrustPolicyEntryV1Schema.parse(entry))
    === canonicalJson(ActivationTrustPolicyEntryV1Schema.parse(expected));
}
