import type { PoolClient } from 'pg';
import { DiscoveryProposalV2Schema, ProposalResultSchema, type DiscoveryProposalV2, type ProposalResult } from '../../contracts/src/index.js';
import { DraftConnectorResultSchema } from '../../contracts/src/discovery-construction-tools.js';
import { safeCounter } from './budgets.js';
import { discoveryError } from './repository.js';

export type ProjectedFinding = {
  finding: { id: string; revision: number };
  blockers: { investigationId: string; code: string }[];
};
type AssessmentContext = {
  runId: string;
  observedRunRevision: number;
  runDiagnostics: readonly string[];
  payload: DiscoveryProposalV2;
  assessmentRevision: number;
  diagnosticCodes: readonly string[];
  projectedFindings?: readonly ProjectedFinding[];
};

export function nextRevision(value: number | string) {
  const revision = safeCounter(value);
  if (revision === Number.MAX_SAFE_INTEGER) throw discoveryError(409);
  return revision + 1;
}

export async function assessProposal(client: PoolClient, {
  runId, observedRunRevision, runDiagnostics, payload, assessmentRevision, diagnosticCodes, projectedFindings = [],
}: AssessmentContext): Promise<ProposalResult> {
  const { rows: blockerRefs } = await client.query<ProposalResult['assessment']['blockerRefs'][number]>(`
    SELECT finding_id AS "findingId", origin_revision AS revision, code
    FROM discovery_finding_blockers WHERE run_id=$1 AND investigation_id=ANY($2)`,
  [runId, payload.investigationIds]);
  for (const { finding, blockers } of projectedFindings) {
    for (const blocker of blockers) {
      if (payload.investigationIds.includes(blocker.investigationId)) {
        blockerRefs.push({ findingId: finding.id, revision: finding.revision, code: blocker.code });
      }
    }
  }
  const { rows: currentFindings } = await client.query<{ id: string; current_revision: number }>(
    'SELECT id,current_revision FROM discovery_finding_identities WHERE run_id=$1 AND id=ANY($2)',
    [runId, payload.findingRefs.map(ref => ref.findingId)]);
  const current = new Map(currentFindings.map(finding => [finding.id, finding.current_revision]));
  for (const { finding } of projectedFindings) current.set(finding.id, finding.revision);

  const codes = new Set([...runDiagnostics, ...diagnosticCodes]);
  if (payload.findingRefs.some(ref => current.get(ref.findingId) !== ref.revision)) codes.add('FINDING_REVISION_STALE');
  const result = ProposalResultSchema.parse({
    proposalId: payload.id, revision: payload.revision,
    state: blockerRefs.length > 0 || codes.size > 0 ? 'compile_blocked' : 'draft',
    profileHashes: payload.profiles.map(profile => profile.hash),
    diagnostics: [...codes].sort().map(code => ({ code, severity: 'blocker', message: code, sourceIds: [], fieldPaths: [] })),
    assessment: {
      revision: assessmentRevision, observedRunRevision, investigationIds: payload.investigationIds,
      blockerRefs, diagnosticCodes: [...codes],
    },
  });
  if (!DraftConnectorResultSchema.safeParse({ ok: true, result }).success) throw discoveryError(409, 'TOOL_RESULT_LIMIT');
  return result;
}

export async function persistAssessment(client: PoolClient, runId: string, result: ProposalResult) {
  const { proposalId, revision, assessment } = result;
  await client.query(`INSERT INTO discovery_proposal_assessments
    (run_id,proposal_id,proposal_revision,assessment_revision,observed_run_revision,payload)
    VALUES($1,$2,$3,$4,$5,$6)`, [runId, proposalId, revision, assessment.revision, assessment.observedRunRevision, assessment]);
  await client.query(`INSERT INTO discovery_proposal_current
    (run_id,proposal_id,proposal_revision,assessment_revision,compile_step_id,result)
    VALUES($1,$2,$3,$4,NULL,$5)
    ON CONFLICT(run_id,proposal_id) DO UPDATE SET proposal_revision=EXCLUDED.proposal_revision,
      assessment_revision=EXCLUDED.assessment_revision,compile_step_id=NULL,result=EXCLUDED.result`,
  [runId, proposalId, revision, assessment.revision, result]);
}

type CurrentAssessment = Pick<AssessmentContext, 'payload'> & { result: ProposalResult };

export async function readCurrentProposalAssessments(client: PoolClient, runId: string) {
  const { rows } = await client.query<{ payload: unknown; result: unknown; diagnostics: string[]; investigation_ids: string[] }>(`
    SELECT p.payload,c.result,r.diagnostics,ARRAY(
      SELECT investigation_id FROM discovery_proposal_investigations WHERE run_id=i.run_id AND proposal_id=i.id
    ) AS investigation_ids
    FROM discovery_proposal_identities i
    JOIN discovery_proposal_current c ON c.run_id=i.run_id AND c.proposal_id=i.id AND c.proposal_revision=i.current_revision
    JOIN discovery_proposal_revisions p ON p.run_id=i.run_id AND p.proposal_id=i.id AND p.revision=i.current_revision
    JOIN discovery_runs r ON r.id=i.run_id WHERE i.run_id=$1 ORDER BY i.id`, [runId]);
  const current = new Map<string, CurrentAssessment>();
  for (const row of rows) {
    const payload = DiscoveryProposalV2Schema.parse(row.payload);
    current.set(payload.id, {
      payload: { ...payload, investigationIds: row.investigation_ids },
      result: ProposalResultSchema.parse(row.result),
    });
  }
  return { current, runDiagnostics: rows[0]?.diagnostics ?? [] };
}

// Project an ordered prefix before any write. Reuse the same bounded assessment builder at publication.
export async function reassessProposals(
  client: PoolClient, current: Map<string, CurrentAssessment>,
  options: Pick<AssessmentContext, 'runId' | 'observedRunRevision' | 'runDiagnostics' | 'projectedFindings'>,
) {
  for (const entry of current.values()) {
    const { payload, result: previous } = entry;
    const result = await assessProposal(client, {
      ...options, payload, assessmentRevision: nextRevision(previous.assessment.revision),
      diagnosticCodes: [...previous.assessment.diagnosticCodes, ...previous.diagnostics.map(diagnostic => diagnostic.code)],
    });
    current.set(payload.id, { payload, result });
  }
}

export async function refreshProposalAssessments(
  client: PoolClient, { runId, observedRunRevision }: { runId: string; observedRunRevision: number },
) {
  const { current, runDiagnostics } = await readCurrentProposalAssessments(client, runId);
  await reassessProposals(client, current, { runId, observedRunRevision, runDiagnostics });
  for (const { result } of current.values()) await persistAssessment(client, runId, result);
}
