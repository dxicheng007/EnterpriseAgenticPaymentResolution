import type { PoolClient } from 'pg';
import {
  TargetStateSchema, hashCanonical,
  type CompiledArtifact, type CustomerProfile, type Hash, type Id, type IsoInstant,
  type RawSourceEvent, type TargetState,
} from '../../contracts/src/index.js';
import {
  RunSandboxReplayInputSchema, RunSandboxReplayResultSchema,
  type RunSandboxReplayInput, type RunSandboxReplayResult,
} from '../../contracts/src/discovery-construction-tools.js';
import { planBatch } from '../../compiler/src/plan-batch.js';
import { loadCompileSubject, type CompileSubject } from './compilation.js';
import { discoveryError } from './repository.js';

export type ReplaySubject = CompileSubject & {
  artifactHash: Hash;
  profile: CustomerProfile;
};

export function buildEmptySandboxTarget(profile: CustomerProfile, asOf: IsoInstant): TargetState {
  return TargetStateSchema.parse({
    scope: profile.scope,
    version: 0,
    asOf,
    invoices: [], payments: [], credits: [], allocations: [], reversals: [],
    customers: [], accounts: [], billingConfigurations: [],
  });
}

export async function loadReplaySubject(
  client: PoolClient, runId: string, input: RunSandboxReplayInput,
): Promise<ReplaySubject> {
  const subject = await loadCompileSubject(client, runId, RunSandboxReplayInputSchema.parse(input));
  if (subject.current.state !== 'compiled' || !subject.current.artifactHash) throw discoveryError(409);
  const profile = subject.payload.profiles[0]!;
  if (!subject.current.profileHashes.includes(profile.hash) ||
      hashCanonical(subject.current.profileHashes) !== hashCanonical([profile.hash])) {
    throw discoveryError(409);
  }
  return { ...subject, artifactHash: subject.current.artifactHash, profile };
}

export function executeSandboxReplay(input: {
  subject: ReplaySubject;
  artifact: CompiledArtifact;
  events: readonly RawSourceEvent[];
  asOf: IsoInstant;
  snapshotId: Id;
  manifestId: Id;
}): RunSandboxReplayResult {
  const { subject, artifact, events, asOf, snapshotId, manifestId } = input;
  if (artifact.hash !== subject.artifactHash ||
      !artifact.requiredProfileHashes.includes(subject.profile.hash)) {
    return { ok: false, code: 'DISCOVERY_CONFLICT' };
  }
  const target = buildEmptySandboxTarget(subject.profile, asOf);
  const outcome = planBatch(artifact, subject.profile, [...events], target);
  try {
    return RunSandboxReplayResultSchema.parse({
      ok: true as const,
      proposalId: subject.proposalId,
      revision: subject.proposalRevision,
      artifactHash: artifact.hash,
      profileHash: subject.profile.hash,
      snapshotId,
      manifestId,
      targetMode: 'empty-sandbox' as const,
      parentWrites: 0 as const,
      outcome,
    });
  } catch {
    return { ok: false, code: 'TOOL_RESULT_LIMIT' };
  }
}
