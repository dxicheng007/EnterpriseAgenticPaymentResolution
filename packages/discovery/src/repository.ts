import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  DiscoveryActionRequestV2Schema, DiscoveryBindingSchema, DiscoveryStateV2Schema,
  SourceReadGrantSchema, StartDiscoveryRequestV2Schema, StartDiscoveryResponseV2Schema,
  IdSchema, ProductRoleSchema, DiscoverySubjectSchema, hashCanonical,
  type Diagnostic, type DiscoveryActionRequestV2, type DiscoveryBinding, type DiscoveryStateV2,
  type DiscoverySubject, type SourceReadGrant, type StartDiscoveryRequestV2, type ActivityEvent,
} from '../../contracts/src/index.js';
import { publishActivity } from '../../storage/src/activity.js';
import { withTransaction } from '../../storage/src/transaction.js';
import { budgets, safeCounter } from './budgets.js';
import { modelLimits, type ModelClient } from './model.js';

export type Selection = Pick<DiscoveryBinding, 'companyId' | 'sourceRef' | 'manifestId'>;
export type Grants = { allowedAccountIds: string[]; sourceRead: SourceReadGrant };
type Actor = { reviewerId: string; sourceRef: string };
export type RepositoryOptions = {
  db: Pool;
  clock: () => Date;
  // A synchronous server policy lookup. It must use current configuration and perform no I/O.
  resolveAuthority: (reviewerId: string, selection: Selection) => Grants | undefined;
};
type StartOptions = {
  model?: Pick<ModelClient, 'modelId' | 'mode'>;
  readCapture: (selection: Selection) => Promise<DiscoveryBinding>;
  recheckCapture?: (client: PoolClient, binding: DiscoveryBinding) => Promise<void>;
};
type TaskState = DiscoveryStateV2['tasks'][number];

export type RunRow = {
  id: string; reviewer_id: string; start_hash: string; start_response: unknown;
  binding: DiscoveryBinding; grants: Grants; policy: typeof modelLimits; mode: ModelClient['mode']; model_id: string;
  status: DiscoveryStateV2['status']; revision: string; model_calls: string; input_tokens: string;
  output_tokens: string; unknown_calls: string; diagnostics: string[];
};
export type TaskRow = {
  id: string; investigation_id: string; role: TaskState['role']; question: string; status: TaskState['status'];
  attempt: number; revision: string; tool_rounds: number; repair_round: number; diagnostics: string[]; grants: Grants;
};
type Investigation = { id: string; seller_entity_id: string | null; source_account_id: string | null; specialist_count: number };
type SpecialistInput = { subject: DiscoverySubject; role: Exclude<TaskState['role'], 'coordinator'>; question: string; dependencyIds: string[] };

export function discoveryError(statusCode: number, code = 'DISCOVERY_CONFLICT') {
  return Object.assign(new Error(code), { statusCode, code });
}

const diagnostics: Record<string, string> = {
  MODEL_TIMEOUT: 'The model outcome is unknown after a timeout.',
  MODEL_INTERRUPTED: 'The model outcome is unknown after scheduler interruption.',
  MODEL_INVALID_RESULT: 'The model adapter returned an invalid result.',
  MODEL_CALL_FAILED: 'The model adapter did not return a usable result.',
  MODEL_ATTEMPT_LIMIT: 'The task exhausted its model attempts.',
  MODEL_TOOL_ROUND_LIMIT: 'The task exhausted its model tool rounds.',
  MODEL_STOPPED: 'The model stopped before completing its task.',
  INVESTIGATION_LIMIT: 'The run exhausted its source-account investigation budget.',
  SPECIALIST_LIMIT: 'The investigation exhausted its specialist task budget.',
  DEPENDENCY_BLOCKED: 'A required predecessor failed or was interrupted.',
  CONSTRUCTION_UNAVAILABLE: 'Proposal construction and blocker assessment are unavailable.',
};

function diagnostic(code: string): Diagnostic {
  return { code, severity: 'blocker', message: diagnostics[code] ?? code, sourceIds: [], fieldPaths: [] };
}

export function coversGrant(current: Grants | undefined, saved: Grants): boolean {
  return !!current &&
    current.sourceRead.companyId === saved.sourceRead.companyId &&
    current.sourceRead.sourceRef === saved.sourceRead.sourceRef &&
    (!saved.sourceRead.sourceWide || current.sourceRead.sourceWide) &&
    (current.sourceRead.sourceWide || saved.sourceRead.accounts.every(account =>
      current.sourceRead.accounts.some(allowed => account.sellerEntityId === allowed.sellerEntityId &&
        account.sourceAccountId === allowed.sourceAccountId))) &&
    saved.allowedAccountIds.every(account => current.allowedAccountIds.includes(account));
}

export async function lockRun(client: PoolClient, id: string): Promise<RunRow> {
  const { rows: [run] } = await client.query<RunRow>('SELECT * FROM discovery_runs WHERE id = $1 FOR UPDATE', [id]);
  if (!run) throw discoveryError(404, 'DISCOVERY_NOT_FOUND');
  return run;
}

export async function lockTask(client: PoolClient, runId: string, taskId: string): Promise<TaskRow | undefined> {
  const { rows: [reference] } = await client.query<Pick<TaskRow, 'investigation_id'>>(
    'SELECT investigation_id FROM discovery_tasks WHERE run_id=$1 AND id=$2', [runId, taskId]);
  if (!reference) return;
  await client.query('SELECT id FROM discovery_investigations WHERE run_id=$1 AND id=$2 FOR UPDATE',
    [runId, reference.investigation_id]);
  const { rows: [task] } = await client.query<TaskRow>(
    'SELECT * FROM discovery_tasks WHERE run_id=$1 AND id=$2 FOR UPDATE', [runId, taskId]);
  return task;
}

export function runnable(run: RunRow): boolean {
  return run.status === 'queued' || run.status === 'running';
}

export async function markBlocker(client: PoolClient, runId: string, code: string) {
  await client.query(`UPDATE discovery_runs SET revision=revision+1,
    status=CASE WHEN status='paused' THEN status ELSE 'blocked' END,
    diagnostics=CASE WHEN $2=ANY(diagnostics) THEN diagnostics ELSE array_append(diagnostics,$2) END WHERE id=$1`, [runId, code]);
}

export async function publishDiscovery(client: PoolClient, clock: RepositoryOptions['clock'], runId: string,
  type: string, payload: ActivityEvent['payload'], task?: Pick<TaskRow, 'id' | 'role'>) {
  await publishActivity(client, {
    stream: 'control', phase: 'build', type, at: clock().toISOString(), runId, payload,
    ...(task ? { taskId: task.id, role: task.role } : {}),
  });
}

async function project(client: PoolClient, run: RunRow): Promise<DiscoveryStateV2> {
  const tasks = await client.query<TaskRow & Investigation & { dependency_ids: string[] }>(`
    SELECT t.*, i.seller_entity_id, i.source_account_id, ARRAY(
      SELECT predecessor_id FROM discovery_task_dependencies WHERE run_id=t.run_id AND task_id=t.id
    ) AS dependency_ids FROM discovery_tasks t JOIN discovery_investigations i ON i.id=t.investigation_id WHERE t.run_id=$1`, [run.id]);
  const { rows: [counts] } = await client.query<{ models: string; tools: string }>(`SELECT
    (SELECT count(*) FROM discovery_dispatches WHERE run_id=$1 AND state='reserved') AS models,
    (SELECT count(*) FROM discovery_tool_steps WHERE run_id=$1 AND state='running') AS tools`, [run.id]);
  const { rows: findings } = await client.query<DiscoveryStateV2['findings'][number]>(`
    SELECT i.id,r.revision,r.task_id AS "taskId",r.payload->'subject' AS subject
    FROM discovery_finding_identities i JOIN discovery_finding_revisions r
      ON r.run_id=i.run_id AND r.finding_id=i.id AND r.revision=i.current_revision
    WHERE i.run_id=$1 ORDER BY i.id COLLATE "C"`, [run.id]);
  const { rows: proposals } = await client.query<{ result: unknown }>(`
    SELECT c.result FROM discovery_proposal_identities i
    JOIN discovery_proposal_current c ON c.run_id=i.run_id AND c.proposal_id=i.id AND c.proposal_revision=i.current_revision
    WHERE i.run_id=$1 ORDER BY i.id COLLATE "C"`, [run.id]);
  const { rows: verificationJobs } = await client.query<{
    proposalId: string; proposalRevision: number; jobId: string;
  }>(`
    SELECT proposal_id AS "proposalId", proposal_revision::int AS "proposalRevision", job_id AS "jobId"
    FROM discovery_verification_requests
    WHERE run_id=$1
    ORDER BY proposal_id COLLATE "C", proposal_revision, job_id COLLATE "C"`, [run.id]);
  return DiscoveryStateV2Schema.parse({
    schemaVersion: 2, id: run.id, revision: safeCounter(run.revision), binding: run.binding, mode: run.mode,
    modelId: run.model_id, status: run.status,
    inFlightModelCalls: safeCounter(counts.models), inFlightToolSteps: safeCounter(counts.tools),
    tasks: tasks.rows.map(task => ({
      id: task.id, investigationId: task.investigation_id,
      subject: task.seller_entity_id === null ? { kind: 'source' } :
        { kind: 'source_account', sellerEntityId: task.seller_entity_id, sourceAccountId: task.source_account_id },
      role: task.role, question: task.question, dependencyIds: task.dependency_ids, status: task.status,
      attempt: task.attempt, revision: safeCounter(task.revision), toolRounds: task.tool_rounds,
      repairRound: task.repair_round, diagnosticCodes: task.diagnostics,
    })),
    findings, proposals: proposals.map(row => row.result), verificationJobs,
    usage: { modelCalls: safeCounter(run.model_calls), inputTokens: safeCounter(run.input_tokens),
      outputTokens: safeCounter(run.output_tokens), unknownUsageCalls: safeCounter(run.unknown_calls),
      cost: { status: 'unavailable' } },
    diagnostics: run.diagnostics.map(diagnostic),
  });
}

export function createDiscoveryRepository({ db, clock, resolveAuthority }: RepositoryOptions) {
  function authorizeSource(reviewerId: string, selection: Selection): Grants {
    const grants = resolveAuthority(reviewerId, selection);
    if (!grants || grants.sourceRead.companyId !== selection.companyId ||
        grants.sourceRead.sourceRef !== selection.sourceRef) throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
    return {
      sourceRead: SourceReadGrantSchema.parse(grants.sourceRead),
      allowedAccountIds: [...new Set(grants.allowedAccountIds.map(id => IdSchema.parse(id)))].sort(),
    };
  }

  function authorizeRun(run: RunRow, reviewerId: string, sourceRef?: string) {
    if (run.reviewer_id !== reviewerId || (sourceRef !== undefined && run.binding.sourceRef !== sourceRef)) {
      throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
    }
    authorizeSource(reviewerId, run.binding);
  }

  function replayStart(run: RunRow, actor: Actor, requestHash: string) {
    authorizeRun(run, actor.reviewerId);
    if (run.start_hash !== requestHash || run.binding.sourceRef !== actor.sourceRef) throw discoveryError(409);
    return StartDiscoveryResponseV2Schema.parse(run.start_response);
  }

  async function start(raw: StartDiscoveryRequestV2, actor: Actor, options: StartOptions) {
    const input = StartDiscoveryRequestV2Schema.parse(raw);
    const selection = { companyId: input.companyId, manifestId: input.manifestId, sourceRef: actor.sourceRef };
    authorizeSource(actor.reviewerId, selection);
    const requestHash = hashCanonical(input);
    const key = [actor.reviewerId, input.idempotencyKey];
    const select = 'SELECT * FROM discovery_runs WHERE reviewer_id=$1 AND start_key=$2';
    const { rows: [saved] } = await db.query<RunRow>(select, key);
    if (saved) return replayStart(saved, actor, requestHash);
    if (!options.model) throw discoveryError(503, 'MODEL_UNAVAILABLE');
    const { mode, modelId } = options.model;
    const binding = DiscoveryBindingSchema.parse(await options.readCapture(selection));
    if (binding.companyId !== selection.companyId || binding.sourceRef !== selection.sourceRef ||
        binding.manifestId !== selection.manifestId) throw discoveryError(409);
    const runId = randomUUID();
    const response = StartDiscoveryResponseV2Schema.parse({ schemaVersion: 2, runId });
    return withTransaction(db, async client => {
      const { rows: [existing] } = await client.query<RunRow>(select, key);
      if (existing) return replayStart(existing, actor, requestHash);
      const grants = authorizeSource(actor.reviewerId, binding);
      await options.recheckCapture?.(client, binding);
      const inserted = await client.query(`INSERT INTO discovery_runs
        (id,reviewer_id,start_key,start_hash,start_response,binding,mode,model_id,policy,grants)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (reviewer_id,start_key) DO NOTHING`,
      [runId, ...key, requestHash, response, binding, mode, IdSchema.parse(modelId), modelLimits, grants]);
      if (!inserted.rowCount) {
        const { rows: [winner] } = await client.query<RunRow>(select, key);
        return replayStart(winner, actor, requestHash);
      }
      const investigationId = randomUUID();
      await client.query('INSERT INTO discovery_investigations(run_id,id) VALUES($1,$2)', [runId, investigationId]);
      await client.query(`INSERT INTO discovery_tasks (run_id,id,investigation_id,role,question,grants)
        VALUES ($1,$2,$3,'coordinator',$4,$5)`, [runId, randomUUID(), investigationId, 'Investigate the pinned source capture.', grants]);
      await publishDiscovery(client, clock, runId, 'discovery.started', { status: 'queued', mode });
      return response;
    });
  }

  async function readState(runId: string, actor: Actor) {
    return withTransaction(db, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [run] } = await client.query<RunRow>('SELECT * FROM discovery_runs WHERE id=$1', [runId]);
      if (!run) throw discoveryError(404, 'DISCOVERY_NOT_FOUND');
      authorizeRun(run, actor.reviewerId, actor.sourceRef);
      return project(client, run);
    });
  }

  async function action(runId: string, actor: Actor, name: 'pause' | 'resume', raw: DiscoveryActionRequestV2) {
    const input = DiscoveryActionRequestV2Schema.parse(raw);
    const requestHash = hashCanonical(input);
    return withTransaction(db, async client => {
      let run = await lockRun(client, runId);
      authorizeRun(run, actor.reviewerId, actor.sourceRef);
      const key = [actor.reviewerId, runId, input.idempotencyKey];
      const { rows: [saved] } = await client.query<{ action: string; request_hash: string; response: unknown }>(
        'SELECT action,request_hash,response FROM discovery_actions WHERE reviewer_id=$1 AND run_id=$2 AND action_key=$3', key);
      if (saved) {
        if (saved.action !== name || saved.request_hash !== requestHash) throw discoveryError(409);
        return DiscoveryStateV2Schema.parse(saved.response);
      }
      if (safeCounter(run.revision) !== input.expectedRevision || run.status === 'failed' || run.status === 'completed' ||
          (name === 'resume' && run.status !== 'paused')) throw discoveryError(409);
      const status = name === 'pause' ? 'paused' : run.diagnostics.length ? 'blocked' : 'queued';
      if (run.status !== status) {
        const { rows: [updated] } = await client.query<RunRow>(
          'UPDATE discovery_runs SET status=$2, revision=revision+1 WHERE id=$1 RETURNING *', [runId, status]);
        run = updated;
        await publishDiscovery(client, clock, runId, name === 'pause' ? 'discovery.paused' : 'discovery.resumed', { status });
      }
      const response = await project(client, run);
      await client.query(`INSERT INTO discovery_actions (reviewer_id,run_id,action_key,action,request_hash,response)
        VALUES ($1,$2,$3,$4,$5,$6)`, [...key, name, requestHash, response]);
      return response;
    });
  }

  return { start, readState, action };
}

// Called only inside the owner's transaction with the run already locked.
// Callers prove subject membership before this method. Dependencies point only to existing tasks,
// so creating a new task cannot introduce a cycle.
export async function insertSpecialist(client: PoolClient, run: RunRow, raw: SpecialistInput) {
  const subject = DiscoverySubjectSchema.parse(raw.subject);
  const role = ProductRoleSchema.parse(raw.role);
  if (role === 'coordinator' || typeof raw.question !== 'string' || raw.question.length === 0 ||
      Buffer.byteLength(raw.question) > 8192) throw discoveryError(400, 'DISCOVERY_INVALID');
  const dependencyIds = raw.dependencyIds.map(id => IdSchema.parse(id));
  const { rows: predecessors } = await client.query<Pick<TaskRow, 'id' | 'status'>>(
    'SELECT id,status FROM discovery_tasks WHERE run_id=$1 AND id=ANY($2)', [run.id, dependencyIds]);
  if (predecessors.length !== dependencyIds.length) throw discoveryError(409);

  const account = subject.kind === 'source_account' ? subject : undefined;
  if (!run.grants.sourceRead.sourceWide && (!account || !run.grants.sourceRead.accounts.some(granted =>
    granted.sellerEntityId === account.sellerEntityId && granted.sourceAccountId === account.sourceAccountId))) {
    throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
  }
  const subjectKey = [run.id, account?.sellerEntityId ?? null, account?.sourceAccountId ?? null];
  const { rows: [saved] } = await client.query<Investigation>(`SELECT * FROM discovery_investigations
    WHERE run_id=$1 AND seller_entity_id IS NOT DISTINCT FROM $2 AND source_account_id IS NOT DISTINCT FROM $3 FOR UPDATE`, subjectKey);
  if (!saved) {
    const { rows: [count] } = await client.query<{ count: string }>(
      'SELECT count(*) FROM discovery_investigations WHERE run_id=$1 AND seller_entity_id IS NOT NULL', [run.id]);
    if (safeCounter(count.count) >= budgets.accountInvestigations) return { blocker: 'INVESTIGATION_LIMIT' } as const;
  }
  if (saved?.specialist_count === budgets.specialists) return { blocker: 'SPECIALIST_LIMIT' } as const;
  const investigationId = saved?.id ?? randomUUID();
  if (saved) {
    await client.query('UPDATE discovery_investigations SET specialist_count=specialist_count+1 WHERE id=$1', [investigationId]);
  } else {
    await client.query(`INSERT INTO discovery_investigations (run_id,seller_entity_id,source_account_id,id,specialist_count)
      VALUES ($1,$2,$3,$4,1)`, [...subjectKey, investigationId]);
  }
  const grants: Grants = account ? { ...run.grants, sourceRead: { companyId: run.binding.companyId,
    sourceRef: run.binding.sourceRef, sourceWide: false, accounts: [{
      sellerEntityId: account.sellerEntityId, sourceAccountId: account.sourceAccountId,
    }] } } : run.grants;
  const taskId = randomUUID();
  const waiting = predecessors.some(task => task.status !== 'succeeded');
  const blocked = predecessors.some(task => task.status === 'failed' || task.status === 'interrupted');
  await client.query(`INSERT INTO discovery_tasks (run_id,id,investigation_id,role,question,grants,status,diagnostics)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [run.id, taskId, investigationId, role, raw.question, grants, waiting ? 'waiting' : 'queued', blocked ? ['DEPENDENCY_BLOCKED'] : []]);
  await client.query(`INSERT INTO discovery_task_dependencies (run_id,task_id,predecessor_id)
    SELECT $1,$2,unnest($3::text[])`, [run.id, taskId, dependencyIds]);
  if (blocked) await markBlocker(client, run.id, 'DEPENDENCY_BLOCKED');
  else await client.query('UPDATE discovery_runs SET revision=revision+1 WHERE id=$1', [run.id]);
  return { taskId, investigationId } as const;
}
