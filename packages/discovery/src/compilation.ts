import type { PoolClient } from 'pg';
import {
  DiscoveryProposalV2Schema, ProposalResultSchema, hashCanonical,
  type BootstrapManifest, type Diagnostic, type DiscoveryBinding, type DiscoveryProposalV2,
  type Hash, type Id, type ProposalResult, type SourceSnapshot,
} from '../../contracts/src/index.js';
import {
  CompileConnectorInputSchema, CompileConnectorResultSchema, type CompileConnectorInput,
} from '../../contracts/src/discovery-construction-tools.js';
import { compile } from '../../compiler/src/compile.js';
import type { CandidateRegistry } from '../../compiler/src/preview-adapters.js';
import { assessProposal } from './assessments.js';
import { discoveryError, type RunRow, type TaskRow } from './repository.js';
import type { CaptureFacts } from './tasks.js';

/** Trusted pinned capture for compile/register. Detached; never model-authored. */
export type ConstructionCapture = {
  facts: CaptureFacts;
  manifest: BootstrapManifest;
  snapshot: SourceSnapshot;
};

export type ConstructionCaptureReader = (
  selection: Pick<CaptureFacts['binding'], 'companyId' | 'manifestId'>,
) => Promise<ConstructionCapture>;

export type CompileRegisterCandidate = CandidateRegistry['registerCandidate'];

export type CompileSourcePayload = {
  proposalId: Id;
  proposalRevision: number;
  assessmentRevision: number;
  observedRunRevision: number;
  proposalPayloadHash: Hash;
  profileHashes: Hash[];
  binding: DiscoveryBinding;
  captureEvidenceIds: Id[];
};

export type CompileRegistration = {
  artifactHash: Hash;
  artifactId: Id;
  manifestId: Id;
  snapshotId: Id;
  profileHashes: Hash[];
  specId: Id;
  specVersion: number;
};

export type CompileSubject = {
  proposalId: Id;
  proposalRevision: number;
  assessmentRevision: number;
  observedRunRevision: number;
  payload: DiscoveryProposalV2;
  payloadHash: Hash;
  current: ProposalResult;
};

type CompileContext = { run: RunRow; task: TaskRow; step: { id: string } };

const equalIds = (left: readonly Id[], right: readonly Id[]) =>
  left.length === right.length && hashCanonical([...left].sort()) === hashCanonical([...right].sort());

export function assertConstructionCapture(capture: ConstructionCapture): void {
  const { facts, manifest, snapshot } = capture;
  const { binding } = facts;
  if (snapshot.id !== binding.snapshotId ||
      snapshot.manifestId !== binding.manifestId || snapshot.manifestId !== manifest.id ||
      snapshot.sourceRef !== binding.sourceRef || snapshot.sourceRef !== manifest.sourceRef ||
      snapshot.contentHash !== binding.snapshotHash ||
      manifest.hash !== binding.manifestHash ||
      !equalIds(snapshot.evidenceIds, facts.evidenceIds)) {
    throw discoveryError(409);
  }
}

export function assessmentClear(result: ProposalResult) {
  return result.assessment.blockerRefs.length === 0 && result.assessment.diagnosticCodes.length === 0;
}

export function buildBlockedCompileResult(
  current: ProposalResult, diagnostics: readonly Diagnostic[],
): ProposalResult {
  const codes = new Set([
    ...current.assessment.diagnosticCodes,
    ...diagnostics.map(diagnostic => diagnostic.code),
  ]);
  const { artifactHash: _omit, ...rest } = current;
  return ProposalResultSchema.parse({
    ...rest,
    state: 'compile_blocked',
    diagnostics: [...codes].sort().map(code => ({
      code, severity: 'blocker' as const, message: code, sourceIds: [], fieldPaths: [],
    })),
    assessment: { ...current.assessment, diagnosticCodes: [...codes] },
  });
}

export function buildCompiledResult(current: ProposalResult, artifactHash: Hash): ProposalResult {
  if (!assessmentClear(current)) throw discoveryError(409);
  return ProposalResultSchema.parse({
    ...current,
    state: 'compiled',
    artifactHash,
    diagnostics: [],
    assessment: { ...current.assessment, diagnosticCodes: [] },
  });
}

export function compileProposal(payload: DiscoveryProposalV2) {
  return compile(payload.spec, payload.profiles);
}

export async function loadCompileSubject(
  client: PoolClient, runId: string, input: CompileConnectorInput,
): Promise<CompileSubject> {
  const { rows: [row] } = await client.query<{
    payload: unknown; payload_hash: string; result: unknown; assessment_revision: string;
  }>(`
    SELECT p.payload,p.payload_hash,c.result,c.assessment_revision
    FROM discovery_proposal_identities i
    JOIN discovery_proposal_revisions p
      ON p.run_id=i.run_id AND p.proposal_id=i.id AND p.revision=i.current_revision
    JOIN discovery_proposal_current c
      ON c.run_id=i.run_id AND c.proposal_id=i.id AND c.proposal_revision=i.current_revision
    WHERE i.run_id=$1 AND i.id=$2 AND i.current_revision=$3
    FOR UPDATE OF i,c`, [runId, input.proposalId, input.revision]);
  if (!row) throw discoveryError(409);
  const payload = DiscoveryProposalV2Schema.parse(row.payload);
  const current = ProposalResultSchema.parse(row.result);
  if (payload.id !== input.proposalId || payload.revision !== input.revision ||
      current.proposalId !== input.proposalId || current.revision !== input.revision ||
      hashCanonical(payload) !== row.payload_hash) {
    throw discoveryError(409);
  }
  return {
    proposalId: payload.id,
    proposalRevision: payload.revision,
    assessmentRevision: Number(row.assessment_revision),
    observedRunRevision: current.assessment.observedRunRevision,
    payload,
    payloadHash: row.payload_hash,
    current,
  };
}

/** Exact reserved proposal/assessment rows, even when no longer current. */
export async function loadReservedCompileSubject(
  client: PoolClient, runId: string, sourcePayload: CompileSourcePayload,
): Promise<CompileSubject | undefined> {
  const { rows: [row] } = await client.query<{
    payload: unknown; payload_hash: string; assessment: unknown; observed_run_revision: string;
  }>(`
    SELECT p.payload,p.payload_hash,a.payload AS assessment,a.observed_run_revision
    FROM discovery_proposal_revisions p
    JOIN discovery_proposal_assessments a
      ON a.run_id=p.run_id AND a.proposal_id=p.proposal_id AND a.proposal_revision=p.revision
     AND a.assessment_revision=$4
    WHERE p.run_id=$1 AND p.proposal_id=$2 AND p.revision=$3`, [
    runId, sourcePayload.proposalId, sourcePayload.proposalRevision, sourcePayload.assessmentRevision,
  ]);
  if (!row || row.payload_hash !== sourcePayload.proposalPayloadHash) return;
  const payload = DiscoveryProposalV2Schema.parse(row.payload);
  const assessment = ProposalResultSchema.parse({
    proposalId: payload.id, revision: payload.revision, state: 'draft',
    profileHashes: payload.profiles.map(profile => profile.hash), diagnostics: [], assessment: row.assessment,
  }).assessment;
  const current = ProposalResultSchema.parse({
    proposalId: payload.id, revision: payload.revision,
    state: assessment.blockerRefs.length || assessment.diagnosticCodes.length ? 'compile_blocked' : 'draft',
    profileHashes: payload.profiles.map(profile => profile.hash),
    diagnostics: assessment.diagnosticCodes.map((code: string) => ({
      code, severity: 'blocker', message: code, sourceIds: [], fieldPaths: [],
    })),
    assessment: { ...assessment, observedRunRevision: Number(row.observed_run_revision) },
  });
  return {
    proposalId: payload.id,
    proposalRevision: payload.revision,
    assessmentRevision: sourcePayload.assessmentRevision,
    observedRunRevision: Number(row.observed_run_revision),
    payload,
    payloadHash: row.payload_hash,
    current,
  };
}

export function sourcePayloadFor(
  subject: CompileSubject, binding: DiscoveryBinding, evidenceIds: readonly Id[],
): CompileSourcePayload {
  return {
    proposalId: subject.proposalId,
    proposalRevision: subject.proposalRevision,
    assessmentRevision: subject.assessmentRevision,
    observedRunRevision: subject.observedRunRevision,
    proposalPayloadHash: subject.payloadHash,
    profileHashes: subject.payload.profiles.map(profile => profile.hash),
    binding,
    captureEvidenceIds: [...evidenceIds],
  };
}

export async function readCompileStep(client: PoolClient, toolStepId: string) {
  const { rows: [row] } = await client.query<{
    run_id: string; task_id: string; tool_step_id: string; proposal_id: string;
    proposal_revision: string; assessment_revision: string; generation: string;
    source_payload: unknown; state: 'reserved' | 'registered' | 'settled';
    registration: unknown | null; result: unknown | null;
  }>('SELECT * FROM discovery_compile_steps WHERE tool_step_id=$1 FOR UPDATE', [toolStepId]);
  return row;
}

export async function reserveCompileStep(
  client: PoolClient,
  context: CompileContext,
  subject: CompileSubject,
  sourcePayload: CompileSourcePayload,
  ownerGeneration: number,
) {
  const existing = await readCompileStep(client, context.step.id);
  if (existing) {
    if (existing.run_id !== context.run.id || existing.task_id !== context.task.id ||
        existing.proposal_id !== subject.proposalId ||
        Number(existing.proposal_revision) !== subject.proposalRevision ||
        Number(existing.assessment_revision) !== subject.assessmentRevision ||
        hashCanonical(existing.source_payload) !== hashCanonical(sourcePayload) ||
        existing.state === 'settled') {
      throw discoveryError(409);
    }
    return existing;
  }
  await client.query(`INSERT INTO discovery_compile_steps
    (run_id,task_id,tool_step_id,proposal_id,proposal_revision,assessment_revision,generation,source_payload,state)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'reserved')`, [
    context.run.id, context.task.id, context.step.id, subject.proposalId, subject.proposalRevision,
    subject.assessmentRevision, ownerGeneration, sourcePayload,
  ]);
  return readCompileStep(client, context.step.id);
}

export async function markCompileRegistered(
  client: PoolClient, toolStepId: string, registration: CompileRegistration,
) {
  const { rowCount } = await client.query(`UPDATE discovery_compile_steps
    SET state='registered',registration=$2
    WHERE tool_step_id=$1 AND state IN ('reserved','registered')`, [toolStepId, registration]);
  if (rowCount !== 1) throw discoveryError(409);
}

export async function settleCompileStep(
  client: PoolClient,
  context: CompileContext,
  result: ProposalResult,
  options: { registration?: CompileRegistration; linkCurrent: boolean },
) {
  const step = await readCompileStep(client, context.step.id);
  if (!step || step.state === 'settled') throw discoveryError(409);
  if (options.registration) {
    await markCompileRegistered(client, context.step.id, options.registration);
  }
  const { rowCount } = await client.query(`UPDATE discovery_compile_steps
    SET state='settled',result=$2
    WHERE tool_step_id=$1 AND state IN ('reserved','registered')`, [context.step.id, result]);
  if (rowCount !== 1) throw discoveryError(409);
  if (options.linkCurrent) {
    if (result.state !== 'compiled' || !result.artifactHash) throw discoveryError(409);
    const linked = await client.query(`UPDATE discovery_proposal_current
      SET compile_step_id=$5,result=$6
      WHERE run_id=$1 AND proposal_id=$2 AND proposal_revision=$3 AND assessment_revision=$4`, [
      context.run.id, step.proposal_id, Number(step.proposal_revision), Number(step.assessment_revision),
      context.step.id, result,
    ]);
    if (linked.rowCount !== 1) throw discoveryError(409);
  }
  return result;
}

/** Recheck exact reserved subject against current proposal/assessment before settle. */
export async function recheckCompileSubject(
  client: PoolClient, run: RunRow, sourcePayload: CompileSourcePayload,
): Promise<{ subject: CompileSubject; clear: boolean; stale: boolean }> {
  const reserved = await loadReservedCompileSubject(client, run.id, sourcePayload);
  if (!reserved) throw discoveryError(409);
  const input = CompileConnectorInputSchema.parse({
    proposalId: sourcePayload.proposalId, revision: sourcePayload.proposalRevision,
  });
  let current: CompileSubject | undefined;
  try {
    current = await loadCompileSubject(client, run.id, input);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'DISCOVERY_CONFLICT')) throw error;
  }
  if (!current || current.assessmentRevision !== sourcePayload.assessmentRevision ||
      current.payloadHash !== sourcePayload.proposalPayloadHash ||
      hashCanonical(current.current.profileHashes) !== hashCanonical(sourcePayload.profileHashes)) {
    return { subject: reserved, clear: false, stale: true };
  }
  const refreshed = await assessProposal(client, {
    runId: run.id,
    observedRunRevision: current.observedRunRevision,
    runDiagnostics: run.diagnostics,
    payload: current.payload,
    assessmentRevision: current.assessmentRevision,
    diagnosticCodes: current.current.assessment.diagnosticCodes,
  });
  const clear = assessmentClear(refreshed) && assessmentClear(current.current);
  const stale = hashCanonical(refreshed.assessment.blockerRefs) !== hashCanonical(current.current.assessment.blockerRefs) ||
    hashCanonical([...refreshed.assessment.diagnosticCodes].sort()) !==
      hashCanonical([...current.current.assessment.diagnosticCodes].sort());
  return { subject: current, clear: clear && !stale, stale };
}

export function compileToolResult(result: ProposalResult) {
  return CompileConnectorResultSchema.parse({ ok: true as const, result });
}

export function registrationFrom(
  artifact: { id: Id; hash: Hash },
  payload: DiscoveryProposalV2,
  capture: ConstructionCapture,
): CompileRegistration {
  return {
    artifactHash: artifact.hash,
    artifactId: artifact.id,
    manifestId: capture.manifest.id,
    snapshotId: capture.snapshot.id,
    profileHashes: payload.profiles.map(profile => profile.hash),
    specId: payload.spec.id,
    specVersion: payload.spec.version,
  };
}
