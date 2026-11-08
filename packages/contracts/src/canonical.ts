import { createHash } from 'node:crypto';
import { type EconomicIdentity, SafeKeySchema, unique } from './common.js';
import type { CompiledArtifact, ConnectorSpec, CustomerProfile, NormalizedPlan } from './connector.js';
import type { BootstrapManifest } from './evidence.js';
import type { ActivationBundle } from './review.js';
import type { MutationPlan, TargetState } from './runtime.js';
import type { RawSourceEvent } from './source.js';

export function canonicalJson(value: unknown): string {
  const visiting = new Set<object>();
  function encode(input: unknown): string {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'number' && Number.isSafeInteger(input) && !Object.is(input, -0)) return String(input);
    if (typeof input !== 'object' || input === null || visiting.has(input)) throw new Error('Invalid canonical JSON value');

    visiting.add(input);
    try {
      if (Array.isArray(input)) {
        return '[' + Array.from(input, encode).join(',') + ']';
      }
      const prototype = Object.getPrototypeOf(input);
      if ((prototype !== null && prototype !== Object.prototype) || Object.getOwnPropertySymbols(input).length) {
        throw new Error('Invalid canonical JSON object');
      }
      return '{' + Object.entries(input).sort(([a], [b]) => compare(a, b)).map(([key, entry]) => {
        SafeKeySchema.parse(key);
        return JSON.stringify(key) + ':' + encode(entry);
      }).join(',') + '}';
    } finally {
      visiting.delete(input);
    }
  }
  return encode(value);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedSet<T>(items: readonly T[], key: (item: T) => string): T[] {
  if (!unique(items, key)) throw new Error('Duplicate canonical set member');
  return [...items].sort((a, b) => compare(key(a), key(b)));
}
const strings = <T extends string>(items: readonly T[]) => sortedSet(items, item => item);
export const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const hashCanonical = (value: unknown) => hashBytes(Buffer.from(canonicalJson(value), 'utf8'));

type HashInput<T extends {hash: string}> = Omit<T, 'hash'> & {hash?: string};
type EventHashInput = Omit<RawSourceEvent, 'contentHash'> & {contentHash?: string};

export function hashEvent({ contentHash: _contentHash, ...event }: EventHashInput): string {
  return hashCanonical(event);
}

function canonicalProfile({ hash: _hash, ...profile }: HashInput<CustomerProfile>) {
  return {
    ...profile,
    sourceAccountIds: strings(profile.sourceAccountIds),
    approvedLookups: sortedSet(profile.approvedLookups, lookup => lookup.id).map(lookup => ({
      ...lookup,
      entries: sortedSet(lookup.entries, entry => entry.source).map(entry => ({ ...entry, evidenceRefs: strings(entry.evidenceRefs) })),
    })),
    contractTerms: sortedSet(profile.contractTerms, term => term.id).map(term => ({ ...term, evidenceRefs: strings(term.evidenceRefs) })),
    findings: sortedSet(profile.findings, finding => finding.id).map(finding => ({ ...finding, evidenceRefs: strings(finding.evidenceRefs) })),
  };
}

export const hashProfile = (profile: HashInput<CustomerProfile>) => hashCanonical(canonicalProfile(profile));

function connectorSets(value: ConnectorSpec | NormalizedPlan) {
  return {
    sourceContracts: sortedSet(value.sourceContracts, contract => contract.resource),
    capture: sortedSet(value.capture, stream => stream.streamId).map(stream => ({ ...stream, resources: strings(stream.resources) })),
    mappings: sortedSet(value.mappings, mapping => mapping.resource),
    allowedKinds: strings(value.allowedKinds),
  };
}

export function hashSpec(spec: ConnectorSpec): string {
  return hashCanonical({
    ...spec, ...connectorSets(spec), requiredValidators: strings(spec.requiredValidators), evidenceRefs: strings(spec.evidenceRefs),
  });
}

export function hashArtifact(artifact: Omit<HashInput<CompiledArtifact>, 'id'> & {id?: string}): string {
  const { specHash, compilerVersion, runtimeVersion, targetSchemaVersion, normalizedPlan, sourceContractHashes, requiredProfileHashes } = artifact;
  return hashCanonical({
    specHash, compilerVersion, runtimeVersion, targetSchemaVersion,
    normalizedPlan: { ...normalizedPlan, ...connectorSets(normalizedPlan), validators: strings(normalizedPlan.validators) },
    sourceContractHashes: sortedSet(sourceContractHashes, entry => entry.resource), requiredProfileHashes: strings(requiredProfileHashes),
  });
}

export function hashManifest({ hash: _hash, ...manifest }: HashInput<BootstrapManifest>): string {
  return hashCanonical({
    ...manifest,
    streams: sortedSet(manifest.streams, stream => stream.streamId), files: sortedSet(manifest.files, file => file.fileId),
  });
}

export function hashPlan({ hash: _hash, ...plan }: HashInput<MutationPlan>): string {
  return hashCanonical(plan);
}

export function hashBundle({ hash: _hash, ...bundle }: HashInput<ActivationBundle>): string {
  return hashCanonical({
    ...bundle,
    profiles: sortedSet(bundle.profiles, profile => profile.id).map(profile => ({ ...canonicalProfile(profile), hash: profile.hash })),
    manifest: { ...bundle.manifest, streams: sortedSet(bundle.manifest.streams, stream => stream.streamId),
      files: sortedSet(bundle.manifest.files, file => file.fileId) },
    artifact: {
      ...bundle.artifact,
      normalizedPlan: {
        ...bundle.artifact.normalizedPlan, ...connectorSets(bundle.artifact.normalizedPlan),
        validators: strings(bundle.artifact.normalizedPlan.validators),
      },
      sourceContractHashes: sortedSet(bundle.artifact.sourceContractHashes, entry => entry.resource),
      requiredProfileHashes: strings(bundle.artifact.requiredProfileHashes),
    },
    verificationReport: {
      ...bundle.verificationReport,
      profileHashes: strings(bundle.verificationReport.profileHashes),
      checks: sortedSet(bundle.verificationReport.checks, check => check.id),
      coverage: {
        ...bundle.verificationReport.coverage,
        profileHashes: strings(bundle.verificationReport.coverage.profileHashes),
        required: strings(bundle.verificationReport.coverage.required),
        executed: strings(bundle.verificationReport.coverage.executed),
        sourceRefs: strings(bundle.verificationReport.coverage.sourceRefs),
        eventKinds: strings(bundle.verificationReport.coverage.eventKinds),
      },
    },
  });
}

export const targetRecordId = (identity: EconomicIdentity) => 'tr:' + hashCanonical(identity);
export const hashTargetSnapshot = (records: TargetState) => hashCanonical({ scope: records.scope, records });
