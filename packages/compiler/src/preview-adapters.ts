import type {
  BootstrapManifest, CompiledArtifact, ConnectorSpec, CustomerProfile, EvidenceRef, Hash, Id, IsoInstant,
  RawSourceEvent, Scope, SourceDossier, SourceSnapshot, TargetState,
} from '@eapr/contracts';

export type PreviewReadContext = {
  caller: 'reviewer' | 'task';
  allowedSourceRefs: Id[];
  allowedAccountIds: Id[];
};

export type SnapshotRead = {
  snapshot: SourceSnapshot;
  manifest: BootstrapManifest;
  events: RawSourceEvent[];
  dossier: SourceDossier;
  evidence: EvidenceRef[];
};

export interface SnapshotReader {
  readSnapshot(snapshotId: Id, capability: PreviewReadContext): Promise<SnapshotRead>;
}

export interface TargetReader {
  readTarget(scope: Scope, asOf: IsoInstant, capability: PreviewReadContext): Promise<TargetState>;
}

export type CandidateRegistration = {
  spec: ConnectorSpec;
  artifact: CompiledArtifact;
  profiles: CustomerProfile[];
  manifest: BootstrapManifest;
  snapshot: SourceSnapshot;
};

export interface CandidateRegistry {
  registerCandidate(value: CandidateRegistration): Promise<void>;
  getArtifact(hash: Hash): Promise<{ artifact: CompiledArtifact; spec: ConnectorSpec }>;
  getProfile(hash: Hash): Promise<CustomerProfile>;
  getManifest(id: Id): Promise<BootstrapManifest>;
}
