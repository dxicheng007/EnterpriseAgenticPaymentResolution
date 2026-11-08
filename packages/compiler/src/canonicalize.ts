import { hashArtifact, hashCanonical, hashSpec, ValidatorIdSchema } from '@eapr/contracts';
import type { CompiledArtifact, ConnectorSpec, CustomerProfile, NormalizedPlan } from '@eapr/contracts';

export function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function ordered<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => compare(key(left), key(right)));
}

export function sourceContractHashes(plan: NormalizedPlan) {
  return ordered(plan.sourceContracts, contract => contract.resource).map(contract => ({
    resource: contract.resource, hash: hashCanonical(contract),
  }));
}

export function canonicalArtifact(spec: ConnectorSpec, profiles: CustomerProfile[]): CompiledArtifact {
  const normalizedPlan: NormalizedPlan = {
    sourceRef: spec.sourceRef,
    sourceContracts: ordered(spec.sourceContracts, contract => contract.resource),
    capture: ordered(spec.capture, stream => stream.streamId).map(stream => ({ ...stream, resources: [...stream.resources].sort() })),
    mappings: ordered(spec.mappings, mapping => mapping.resource),
    validators: [...ValidatorIdSchema.options].sort(),
    allowedKinds: [...spec.allowedKinds].sort(),
    limits: { maxTransactionCents: spec.maxTransactionCents, maxRecordsPerCycle: spec.maxRecordsPerCycle },
    runtimeModelCalls: spec.runtimeModelCalls,
  };
  const preimage = {
    sourceRef: spec.sourceRef, specHash: hashSpec(spec), compilerVersion: '1' as const,
    runtimeVersion: '1' as const, targetSchemaVersion: spec.targetSchemaVersion, normalizedPlan,
    sourceContractHashes: sourceContractHashes(normalizedPlan), requiredProfileHashes: profiles.map(profile => profile.hash).sort(),
  };
  const hash = hashArtifact(preimage);
  return { ...preimage, hash, id: 'artifact:' + hash };
}
