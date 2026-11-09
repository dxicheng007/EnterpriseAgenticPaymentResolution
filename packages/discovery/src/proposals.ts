import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  CustomerProfileSchema, DiscoveryProposalV2Schema, ProposalResultSchema, canonicalJson,
  hashCanonical, hashProfile, type DiscoveryProposalV2, type ProposalResult,
} from '../../contracts/src/index.js';
import {
  DraftConnectorInputSchema, DraftConnectorResultSchema, ReviseConnectorInputSchema,
} from '../../contracts/src/discovery-construction-tools.js';
import { assessProposal, nextRevision, persistAssessment, type ProjectedFinding } from './assessments.js';
import { budgets } from './budgets.js';
import { readFinding } from './findings.js';
import { profileSubjects, proposalCitationIds, tupleKey, type AccountSubject, type PreparedProposalEvidence, type ProposalInput } from './proposal-evidence.js';
import { coversGrant, discoveryError, type RunRow, type TaskRow } from './repository.js';

type ProposalContext = { run: RunRow; task: TaskRow; step: { id: string } };
type AccountInvestigation = { id: string; subject: AccountSubject };
type ProposalPublication = {
  submitted: ProposalInput;
  payload: DiscoveryProposalV2;
  payloadHash: string;
  newInvestigations: AccountInvestigation[];
  result: ProposalResult;
};
type StoredRevision = {
  submitted: unknown; payload: unknown; payload_hash: string; result: unknown; is_current: boolean;
};

type HistoryRow = Pick<StoredRevision, 'payload' | 'payload_hash'>;
type ProposalHistory = { signature: string; evidenceIds: string[] };

function historySignature(rows: HistoryRow[]) {
  return hashCanonical(rows.map(row => row.payload_hash).sort());
}

function historyEvidence(rows: HistoryRow[]): ProposalHistory {
  const payloads = rows.map(row => DiscoveryProposalV2Schema.parse(row.payload));
  return {
    signature: historySignature(rows),
    evidenceIds: [...new Set(payloads.flatMap(proposalCitationIds))].sort(),
  };
}

export async function readProposalHistory(
  client: PoolClient, runId: string, proposalIds: readonly string[],
): Promise<Map<string, ProposalHistory>> {
  if (proposalIds.length === 0) return new Map();
  const { rows } = await client.query<HistoryRow & { proposal_id: string }>(`
    SELECT proposal_id,payload,payload_hash FROM discovery_proposal_revisions
    WHERE run_id=$1 AND proposal_id=ANY($2)`, [runId, proposalIds]);
  const histories = Map.groupBy(rows, row => row.proposal_id);
  return new Map(proposalIds.map(id => [id, historyEvidence(histories.get(id) ?? [])]));
}

export function proposalPayload(
  { runId, taskId, proposalId, revision, investigationIds }: {
    runId: string; taskId: string; proposalId: string; revision: number; investigationIds: string[];
  },
  input: ProposalInput,
): DiscoveryProposalV2 {
  const spec = { ...input.spec, id: 'discovery-spec:' + hashCanonical({ runId, submittedSpecId: input.spec.id }) };
  const profile = { ...input.profiles[0]!, id: 'discovery-profile:' + hashCanonical({ runId, proposalId }), version: revision };
  return DiscoveryProposalV2Schema.parse({
    schemaVersion: 2, id: proposalId, revision, taskId, investigationIds, spec,
    profiles: [CustomerProfileSchema.parse({ ...profile, hash: hashProfile(profile) })], findingRefs: input.findingRefs,
  });
}

export async function validateProposalPublication(
  client: PoolClient, context: ProposalContext, input: ProposalInput, prepared: PreparedProposalEvidence,
  previousPlans: readonly ProposalPublication[],
  projection?: { findings: readonly ProjectedFinding[]; history: ProposalHistory | undefined; observedRunRevision: number },
): Promise<ProposalPublication> {
  const { run, task } = context;
  const { findings: projectedFindings = [], history, observedRunRevision = nextRevision(run.revision) } = projection ?? {};
  const id = 'proposalId' in input ? input.proposalId : randomUUID();
  const revision = nextRevision(input.expectedRevision);
  const profile = input.profiles[0]!;
  const { rows } = await client.query<StoredRevision>(`
    SELECT p.submitted,p.payload,p.payload_hash,c.result,
      i.current_revision=p.revision AS is_current
    FROM discovery_proposal_revisions p
    JOIN discovery_proposal_identities i ON i.run_id=p.run_id AND i.id=p.proposal_id
    LEFT JOIN discovery_proposal_current c ON c.run_id=p.run_id AND c.proposal_id=p.proposal_id AND c.proposal_revision=p.revision
    WHERE p.run_id=$1`, [run.id]);
  const current = new Map<string, DiscoveryProposalV2>();
  const sameProposal: StoredRevision[] = [];
  const submittedSpec = canonicalJson(input.spec);
  function checkSpec(spec: ProposalInput['spec']) {
    if (spec.id === input.spec.id && spec.version === input.spec.version && canonicalJson(spec) !== submittedSpec) {
      throw discoveryError(409);
    }
  }
  let previousResult: ProposalResult | undefined;
  for (const row of rows) {
    const stored = DiscoveryProposalV2Schema.parse(row.payload);
    const parser = stored.revision === 1 ? DraftConnectorInputSchema : ReviseConnectorInputSchema;
    checkSpec(parser.parse(row.submitted).spec);
    if (stored.id === id) {
      sameProposal.push(row);
      if (row.is_current) previousResult = ProposalResultSchema.parse(row.result);
    }
    if (row.is_current) current.set(stored.id, stored);
  }
  for (const previous of previousPlans) {
    checkSpec(previous.submitted.spec);
    current.set(previous.payload.id, previous.payload);
  }

  const prior = current.get(id);
  const investigationIds = new Set(prior?.investigationIds);
  if ('proposalId' in input) {
    // A guessed ID cannot address a proposal that has no durable identity yet.
    if (!prior || sameProposal.length === 0 || prior.revision !== input.expectedRevision ||
        history?.signature !== historySignature(sameProposal)) throw discoveryError(409);
    const priorProfile = prior.profiles[0]!;
    if (canonicalJson(priorProfile.scope) !== canonicalJson(profile.scope) ||
        priorProfile.sourceRef !== profile.sourceRef || priorProfile.parentCustomerId !== profile.parentCustomerId) {
      throw discoveryError(409);
    }
    const { rows: bindings } = await client.query<{ investigation_id: string }>(
      'SELECT investigation_id FROM discovery_proposal_investigations WHERE run_id=$1 AND proposal_id=$2', [run.id, id]);
    for (const binding of bindings) investigationIds.add(binding.investigation_id);
    for (const row of sameProposal) {
      const historic = DiscoveryProposalV2Schema.parse(row.payload);
      for (const ref of historic.findingRefs) await readFinding(client, context, ref);
    }
  }

  const accountKeys = new Set(prepared.accountSubjects.map(tupleKey));
  for (const [otherId, other] of current) {
    if (otherId === id) continue;
    const otherProfile = other.profiles[0]!;
    if (otherProfile.scope.accountId === profile.scope.accountId ||
        profileSubjects(otherProfile).some(subject => accountKeys.has(tupleKey(subject)))) throw discoveryError(409);
  }

  const findingIds = new Set<string>();
  for (const ref of input.findingRefs) {
    if (findingIds.has(ref.findingId)) throw discoveryError(409);
    findingIds.add(ref.findingId);
    await readFinding(client, context, ref);
    const { rows: [identity] } = await client.query<{ current_revision: number }>(
      'SELECT current_revision FROM discovery_finding_identities WHERE run_id=$1 AND id=$2', [run.id, ref.findingId]);
    const currentRevision = projectedFindings.findLast(plan => plan.finding.id === ref.findingId)?.finding.revision ??
      identity?.current_revision;
    if (currentRevision !== ref.revision) throw discoveryError(409);
  }

  const { rows: investigations } = await client.query<{ id: string; seller_entity_id: string | null; source_account_id: string | null }>(
    'SELECT id,seller_entity_id,source_account_id FROM discovery_investigations WHERE run_id=$1', [run.id]);
  const source = investigations.find(row => row.seller_entity_id === null);
  if (!source) throw discoveryError(409);
  investigationIds.add(source.id);
  const accounts = new Map<string, AccountInvestigation>();
  for (const row of investigations) {
    if (row.seller_entity_id === null || row.source_account_id === null) continue;
    const subject: AccountSubject = {
      kind: 'source_account', sellerEntityId: row.seller_entity_id, sourceAccountId: row.source_account_id,
    };
    accounts.set(tupleKey(subject), { id: row.id, subject });
  }
  for (const plan of previousPlans) {
    for (const item of plan.newInvestigations) accounts.set(tupleKey(item.subject), item);
  }

  const newInvestigations: AccountInvestigation[] = [];
  for (const subject of prepared.accountSubjects) {
    const key = tupleKey(subject);
    let row = accounts.get(key);
    if (!row) {
      if (accounts.size >= budgets.accountInvestigations) throw discoveryError(409, 'INVESTIGATION_LIMIT');
      row = { id: randomUUID(), subject };
      accounts.set(key, row);
      newInvestigations.push(row);
    }
    investigationIds.add(row.id);
  }
  const retained = [...accounts.values()].filter(row => investigationIds.has(row.id)).map(row => row.subject);
  if (!coversGrant(task.grants, { sourceRead: { ...task.grants.sourceRead, sourceWide: false, accounts: retained }, allowedAccountIds: [] })) {
    throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
  }

  const payload = proposalPayload({
    runId: run.id, taskId: task.id, proposalId: id, revision, investigationIds: [...investigationIds],
  }, input);
  const reevaluated = new Set(['PROPOSAL_EVIDENCE_APPLICABILITY_UNRESOLVED', 'FINDING_REVISION_STALE']);
  const diagnosticCodes = [...new Set([
    ...prepared.diagnosticCodes,
    ...(previousResult?.assessment.diagnosticCodes ?? []).filter(code => !reevaluated.has(code)),
    ...(previousResult?.diagnostics ?? []).map(diagnostic => diagnostic.code).filter(code => !reevaluated.has(code)),
  ])];
  const result = await assessProposal(client, {
    runId: run.id, observedRunRevision, runDiagnostics: run.diagnostics,
    payload, assessmentRevision: 1, diagnosticCodes, projectedFindings,
  });
  if (!DraftConnectorResultSchema.safeParse({ ok: true, result }).success) throw discoveryError(409, 'TOOL_RESULT_LIMIT');
  return { submitted: input, payload, payloadHash: hashCanonical(payload), newInvestigations, result };
}

export async function publishProposal(
  client: PoolClient, { run, task, step }: ProposalContext, plan: ProposalPublication, observedRunRevision: number,
): Promise<ProposalResult> {
  const { payload, submitted, payloadHash, result } = plan;
  if (result.assessment.observedRunRevision !== observedRunRevision) throw discoveryError(409);

  for (const { id, subject } of plan.newInvestigations) {
    await client.query(`INSERT INTO discovery_investigations(run_id,id,seller_entity_id,source_account_id)
      VALUES($1,$2,$3,$4)`, [run.id, id, subject.sellerEntityId, subject.sourceAccountId]);
  }
  if ('proposalId' in submitted) {
    const { rowCount } = await client.query(`UPDATE discovery_proposal_identities SET current_revision=$3
      WHERE run_id=$1 AND id=$2 AND current_revision=$4`, [run.id, payload.id, payload.revision, submitted.expectedRevision]);
    if (rowCount !== 1) throw discoveryError(409);
  } else {
    await client.query(`INSERT INTO discovery_proposal_identities(run_id,id,current_revision)
      VALUES($1,$2,$3)`, [run.id, payload.id, payload.revision]);
  }
  await client.query(`INSERT INTO discovery_proposal_revisions
    (run_id,proposal_id,revision,task_id,tool_step_id,submitted,payload,payload_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [run.id, payload.id, payload.revision, task.id, step.id, submitted, payload, payloadHash]);
  for (const ref of payload.findingRefs) {
    await client.query(`INSERT INTO discovery_proposal_findings(run_id,proposal_id,proposal_revision,finding_id,finding_revision)
      VALUES($1,$2,$3,$4,$5)`, [run.id, payload.id, payload.revision, ref.findingId, ref.revision]);
  }
  for (const investigationId of payload.investigationIds) {
    await client.query(`INSERT INTO discovery_proposal_investigations(run_id,proposal_id,investigation_id)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [run.id, payload.id, investigationId]);
  }
  await persistAssessment(client, run.id, result);
  return result;
}
