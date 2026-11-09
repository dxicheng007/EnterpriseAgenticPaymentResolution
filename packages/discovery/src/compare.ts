import type { PoolClient } from 'pg';
import {
  DiscoveryProposalV2Schema, hashCanonical,
  type DiscoveryProposalV2, type Hash, type Id,
} from '../../contracts/src/index.js';
import {
  CompareArtifactsInputSchema, CompareArtifactsResultSchema, CompareArtifactsSuccessSchema,
  type ArtifactCompareDiff, type CompareArtifactsInput, type CompareArtifactsResult,
} from '../../contracts/src/discovery-construction-tools.js';
import { discoveryError } from './repository.js';

export type CompareSubject = {
  proposalId: Id;
  revision: number;
  payload: DiscoveryProposalV2;
  payloadHash: Hash;
  artifactHash?: Hash;
};

type Diff = ArtifactCompareDiff;

function digest(value: unknown): Hash {
  return hashCanonical(value);
}

function pushDiff(
  diffs: Diff[],
  category: Diff['category'],
  path: string,
  left: unknown | undefined,
  right: unknown | undefined,
) {
  if (left === undefined && right === undefined) return;
  if (left === undefined) {
    diffs.push({ category, path, change: 'added', rightDigest: digest(right) });
    return;
  }
  if (right === undefined) {
    diffs.push({ category, path, change: 'removed', leftDigest: digest(left) });
    return;
  }
  const leftDigest = digest(left);
  const rightDigest = digest(right);
  if (leftDigest === rightDigest) return;
  diffs.push({ category, path, change: 'changed', leftDigest, rightDigest });
}

function keyedRuleDiffs(
  diffs: Diff[],
  basePath: string,
  leftItems: ReadonlyMap<string, unknown>,
  rightItems: ReadonlyMap<string, unknown>,
) {
  for (const key of [...new Set([...leftItems.keys(), ...rightItems.keys()])].sort()) {
    pushDiff(diffs, 'rule', `${basePath}/${key}`, leftItems.get(key), rightItems.get(key));
  }
}

function compareProposalPayloads(
  left: CompareSubject, right: CompareSubject,
): Diff[] {
  const diffs: Diff[] = [];
  pushDiff(diffs, 'hash', '/payloadHash', left.payloadHash, right.payloadHash);
  pushDiff(diffs, 'hash', '/profiles/0/hash', left.payload.profiles[0]!.hash, right.payload.profiles[0]!.hash);
  pushDiff(diffs, 'hash', '/artifactHash', left.artifactHash, right.artifactHash);

  const leftProfile = left.payload.profiles[0]!;
  const rightProfile = right.payload.profiles[0]!;
  const leftScope = leftProfile.scope;
  const rightScope = rightProfile.scope;
  for (const key of ['companyId', 'sellerEntityId', 'accountId'] as const) {
    pushDiff(diffs, 'scope', `/profiles/0/scope/${key}`, leftScope[key], rightScope[key]);
  }
  pushDiff(diffs, 'scope', '/profiles/0/parentCustomerId', leftProfile.parentCustomerId, rightProfile.parentCustomerId);
  const leftAccounts = new Set(leftProfile.sourceAccountIds);
  const rightAccounts = new Set(rightProfile.sourceAccountIds);
  for (const id of [...leftAccounts].sort()) {
    if (!rightAccounts.has(id)) pushDiff(diffs, 'scope', `/profiles/0/sourceAccountIds/${id}`, id, undefined);
  }
  for (const id of [...rightAccounts].sort()) {
    if (!leftAccounts.has(id)) pushDiff(diffs, 'scope', `/profiles/0/sourceAccountIds/${id}`, undefined, id);
  }

  const leftSpec = left.payload.spec;
  const rightSpec = right.payload.spec;
  for (const key of [
    'id', 'version', 'sourceRef', 'runtimeModelCalls', 'maxTransactionCents', 'maxRecordsPerCycle',
    'targetSchemaVersion', 'requiredValidators', 'evidenceRefs', 'allowedKinds',
  ] as const) {
    pushDiff(diffs, 'field', `/spec/${key}`, leftSpec[key], rightSpec[key]);
  }
  keyedRuleDiffs(
    diffs, '/spec/sourceContracts',
    new Map(leftSpec.sourceContracts.map(item => [item.resource, item])),
    new Map(rightSpec.sourceContracts.map(item => [item.resource, item])),
  );
  keyedRuleDiffs(
    diffs, '/spec/capture',
    new Map(leftSpec.capture.map(item => [item.streamId, item])),
    new Map(rightSpec.capture.map(item => [item.streamId, item])),
  );
  keyedRuleDiffs(
    diffs, '/spec/mappings',
    new Map(leftSpec.mappings.map(item => [item.resource, item])),
    new Map(rightSpec.mappings.map(item => [item.resource, item])),
  );

  for (const key of [
    'id', 'version', 'sourceRef', 'semanticVersion', 'approvedLookups', 'contractTerms',
    'findings', 'bootstrap',
  ] as const) {
    pushDiff(diffs, 'profile', `/profiles/0/${key}`, leftProfile[key], rightProfile[key]);
  }

  return diffs.sort((a, b) => a.path.localeCompare(b.path) || a.category.localeCompare(b.category));
}

async function loadCompareSubject(
  client: PoolClient, runId: string, ref: { proposalId: Id; revision: number },
): Promise<CompareSubject> {
  const { rows: [row] } = await client.query<{
    payload: unknown; payload_hash: string; artifact_hash: string | null;
  }>(`
    SELECT p.payload, p.payload_hash,
      COALESCE(
        CASE WHEN c.proposal_revision = p.revision AND c.result->>'state' = 'compiled'
          THEN c.result->>'artifactHash' END,
        (SELECT s.result->>'artifactHash' FROM discovery_compile_steps s
          WHERE s.run_id = p.run_id AND s.proposal_id = p.proposal_id
            AND s.proposal_revision = p.revision AND s.state = 'settled'
            AND s.result->>'state' = 'compiled'
          ORDER BY s.tool_step_id DESC LIMIT 1)
      ) AS artifact_hash
    FROM discovery_proposal_revisions p
    LEFT JOIN discovery_proposal_current c
      ON c.run_id = p.run_id AND c.proposal_id = p.proposal_id
    WHERE p.run_id = $1 AND p.proposal_id = $2 AND p.revision = $3`,
  [runId, ref.proposalId, ref.revision]);
  if (!row) throw discoveryError(409);
  const payload = DiscoveryProposalV2Schema.parse(row.payload);
  if (payload.id !== ref.proposalId || payload.revision !== ref.revision ||
      hashCanonical(payload) !== row.payload_hash) {
    throw discoveryError(409);
  }
  return {
    proposalId: payload.id,
    revision: payload.revision,
    payload,
    payloadHash: row.payload_hash,
    ...(row.artifact_hash ? { artifactHash: row.artifact_hash } : {}),
  };
}

export async function loadCompareSubjects(
  client: PoolClient, runId: string, input: CompareArtifactsInput,
): Promise<{ left: CompareSubject; right: CompareSubject }> {
  const parsed = CompareArtifactsInputSchema.parse(input);
  const left = await loadCompareSubject(client, runId, parsed.left);
  const right = await loadCompareSubject(client, runId, parsed.right);
  return { left, right };
}

export function compareArtifactsResult(left: CompareSubject, right: CompareSubject): CompareArtifactsResult {
  const diffs = left.proposalId === right.proposalId && left.revision === right.revision ?
    [] :
    compareProposalPayloads(left, right);
  const side = (subject: CompareSubject) => ({
    proposalId: subject.proposalId,
    revision: subject.revision,
    payloadHash: subject.payloadHash,
    profileHashes: [subject.payload.profiles[0]!.hash] as [Hash],
    ...(subject.artifactHash ? { artifactHash: subject.artifactHash } : {}),
    specId: subject.payload.spec.id,
    specVersion: subject.payload.spec.version,
  });
  try {
    return CompareArtifactsResultSchema.parse(CompareArtifactsSuccessSchema.parse({
      ok: true as const,
      left: side(left),
      right: side(right),
      identical: diffs.length === 0,
      diffs,
    }));
  } catch {
    return { ok: false, code: 'TOOL_RESULT_LIMIT' };
  }
}
