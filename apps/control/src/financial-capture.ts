import { canonicalJson, type Id } from '@eapr/contracts';
import type { FinancialCaptureReader } from '@eapr/evaluator/financial-attestation-launcher';
import { deriveFinancialCapture } from '@eapr/evaluator/financial-attestation-verify';
import type { createCandidateRegistry } from '@eapr/evaluator/registry';
import { readDiscoveryCapture, readManifest, type createSourceService, type SourceDefinition, type UploadDependencies } from '@eapr/sources';

export type FinancialSourceDependencies = {
  dependencies: UploadDependencies;
  catalog: ReadonlyMap<Id, SourceDefinition>;
  service: ReturnType<typeof createSourceService>;
};

export function createFinancialCaptureReader({ registry, dependencies, catalog, service }: FinancialSourceDependencies & {
  registry: Pick<ReturnType<typeof createCandidateRegistry>, 'getCandidate'>;
}): FinancialCaptureReader {
  return {
    async readCapture({ artifactHash, manifestId }) {
      const candidate = await registry.getCandidate(artifactHash, manifestId);
      const { companyId, sourceRef } = candidate.manifest;
      const { binding } = await readDiscoveryCapture(dependencies, catalog, { companyId, manifestId });
      const [manifest, snapshot, events] = await Promise.all([
        readManifest(dependencies.db, companyId, manifestId),
        service.getSnapshot(candidate.snapshot.id),
        service.getSnapshotRecords(candidate.snapshot.id),
      ]);
      if (canonicalJson(manifest) !== canonicalJson(candidate.manifest) ||
        canonicalJson(snapshot) !== canonicalJson(candidate.snapshot) ||
        binding.companyId !== companyId || binding.sourceRef !== sourceRef ||
        binding.manifestId !== manifestId || binding.manifestHash !== manifest.hash ||
        binding.snapshotId !== snapshot.id || binding.snapshotHash !== snapshot.contentHash) {
        throw new Error('FINANCIAL_ATTESTATION_MISMATCH');
      }
      const capture = { artifact: candidate.artifact, profiles: candidate.profiles, manifest, snapshot, events };
      deriveFinancialCapture(capture);
      return capture;
    },
  };
}
