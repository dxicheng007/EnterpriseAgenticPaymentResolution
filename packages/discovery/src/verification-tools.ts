import type { PoolClient } from 'pg';
import {
  VerificationJobSchema, hashCanonical,
  type Hash, type Id, type VerificationJob,
} from '../../contracts/src/index.js';
import {
  RequestVerificationInputSchema, RequestVerificationResultSchema,
  type DiscoveryVerificationToolFailure, type ReadVerificationInput, type RequestVerificationInput,
  type RequestVerificationResult,
} from '../../contracts/src/discovery-construction-tools.js';
import {
  type AdmissionResult, type ClaimResult, type DiscoveryVerificationOwnerGate,
  type GateOutcome, type HistoricalLookup, type PersistedBinding, type RequestIdentity,
} from '@eapr/evaluator/discovery-verification';
import { assessmentClear, loadCompileSubject, type CompileSubject } from './compilation.js';
import { discoveryError, lockRun, lockTask, runnable, type RunRow, type TaskRow } from './repository.js';
import { safeCounter } from './budgets.js';

type GateDenial = Extract<GateOutcome<unknown>, { kind: 'denied' }>['code'];

export type OwnerGateTransaction = <T>(fn: (
  client: PoolClient,
) => Promise<T | { kind: 'denied'; code: GateDenial }>) => Promise<GateOutcome<T>>;

export type VerificationAdmissionSubject = {
  subjectHash: string;
  subjectBytes: Uint8Array;
  proposalId: Id;
  proposalRevision: number;
  assessmentRevision: number;
  profileHash: Hash;
  accountId: Id;
};

export type VerificationAdmissionStore = {
  put(requestKey: string, subject: VerificationAdmissionSubject): void;
  take(requestKey: string): VerificationAdmissionSubject | undefined;
  peek(requestKey: string): VerificationAdmissionSubject | undefined;
};

export function createVerificationAdmissionStore(): VerificationAdmissionStore {
  const pending = new Map<string, VerificationAdmissionSubject>();
  return {
    put(requestKey, subject) { pending.set(requestKey, subject); },
    take(requestKey) {
      const value = pending.get(requestKey);
      pending.delete(requestKey);
      return value;
    },
    peek(requestKey) { return pending.get(requestKey); },
  };
}

export type VerificationSubject = CompileSubject & {
  profileHash: Hash;
  accountId: Id;
  artifactHash: Hash;
};

export async function hasVerificationBinding(client: PoolClient, requestKey: string) {
  const { rows: [row] } = await client.query<{ request_key: string }>(
    'SELECT request_key FROM discovery_verification_requests WHERE request_key=$1', [requestKey]);
  return !!row;
}

/**
 * Exact one-profile compiled proposal for the tool input.
 * New admission requires a clear assessment; historical recovery of an existing binding does not.
 */
export async function loadVerificationSubject(
  client: PoolClient, runId: string, input: RequestVerificationInput,
  options: { historical?: boolean } = {},
): Promise<VerificationSubject> {
  const subject = await loadCompileSubject(client, runId, {
    proposalId: input.proposalId, revision: input.revision,
  });
  if (subject.current.state !== 'compiled' || !subject.current.artifactHash ||
      (!options.historical && !assessmentClear(subject.current))) {
    throw discoveryError(409);
  }
  const profile = subject.payload.profiles[0];
  if (!profile || profile.hash !== input.profileHash ||
      subject.current.profileHashes.length !== 1 ||
      subject.current.profileHashes[0] !== input.profileHash ||
      hashCanonical(subject.payload.profiles.map(entry => entry.hash)) !== hashCanonical([input.profileHash])) {
    throw discoveryError(409);
  }
  return {
    ...subject,
    profileHash: profile.hash,
    accountId: profile.scope.accountId,
    artifactHash: subject.current.artifactHash,
  };
}

export const verificationInterrupted = {
  code: 'VERIFICATION_INTERRUPTED',
  severity: 'warning' as const,
  message: 'Protected verification execution outcome is uncertain; automatic relaunch is unavailable',
  sourceIds: [] as string[], fieldPaths: [] as string[],
};

export function trustedAccountIds(run: RunRow, task: TaskRow): readonly string[] {
  return task.grants.allowedAccountIds.filter(id => run.grants.allowedAccountIds.includes(id));
}

export function requireTrustedScope(run: RunRow, task: TaskRow, accountId: string): GateDenial | undefined {
  if (!trustedAccountIds(run, task).includes(accountId)) return 'VERIFICATION_SCOPE_REQUIRED';
}

async function loadToolStep(client: PoolClient, requestKey: string) {
  const { rows: [step] } = await client.query<{
    id: string; run_id: string; task_id: string; dispatch_id: string; name: string;
    state: string; generation: string; arguments: unknown;
  }>('SELECT * FROM discovery_tool_steps WHERE id=$1 FOR UPDATE', [requestKey]);
  return step;
}

export function mapVerificationFailure(error: unknown): DiscoveryVerificationToolFailure['code'] {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    switch (code) {
      case 'DISCOVERY_INVALID':
      case 'DISCOVERY_FORBIDDEN':
      case 'DISCOVERY_CONFLICT':
      case 'DISCOVERY_PAUSED':
      case 'VERIFICATION_SCOPE_REQUIRED':
      case 'TOOL_UNAVAILABLE':
      case 'TOOL_FORBIDDEN':
      case 'TOOL_RESULT_LIMIT':
      case 'SOURCE_UNAVAILABLE':
        return code;
      case 'DISCOVERY_OWNER_LOST':
      case 'FINANCIAL_ATTESTATION_UNAVAILABLE':
        return 'TOOL_UNAVAILABLE';
      default:
        break;
    }
  }
  return 'TOOL_UNAVAILABLE';
}

export function verificationToolResult(job: VerificationJob): RequestVerificationResult {
  return RequestVerificationResultSchema.parse({ ok: true as const, job });
}

export type DiscoveryVerificationGateOptions = {
  runOnOwner: OwnerGateTransaction;
  generation: () => number;
  permits: (run: RunRow, task: TaskRow) => boolean;
  admissions: VerificationAdmissionStore;
};

/**
 * Owner-gate callbacks for the Platform producer. Every operation reauthenticates the
 * persisted tool-step association on the supervisor owner connection before SQL.
 */
export function createDiscoveryVerificationOwnerGate(
  options: DiscoveryVerificationGateOptions,
): DiscoveryVerificationOwnerGate {
  const { runOnOwner, generation, permits, admissions } = options;

  async function authorizeStep(
    client: PoolClient,
    identity: RequestIdentity,
    mode: 'lookup' | 'admit' | 'recover',
  ): Promise<{ run: RunRow; task: TaskRow; step: NonNullable<Awaited<ReturnType<typeof loadToolStep>>> } | { kind: 'denied'; code: GateDenial }> {
    const step = await loadToolStep(client, identity.requestKey);
    if (!step || step.run_id !== identity.runId || step.task_id !== identity.taskId ||
        step.id !== identity.requestKey) {
      return { kind: 'denied', code: 'DISCOVERY_FORBIDDEN' };
    }
    if (mode !== 'lookup' && step.name !== 'requestVerification') {
      return { kind: 'denied', code: 'DISCOVERY_CONFLICT' };
    }
    const run = await lockRun(client, identity.runId);
    const task = await lockTask(client, run.id, identity.taskId);
    if (!task || task.id !== identity.taskId) return { kind: 'denied', code: 'DISCOVERY_FORBIDDEN' };
    if (!permits(run, task)) return { kind: 'denied', code: 'DISCOVERY_FORBIDDEN' };

    if (mode === 'admit') {
      if (!runnable(run)) return { kind: 'denied', code: 'DISCOVERY_PAUSED' };
      if (task.status !== 'running') return { kind: 'denied', code: 'DISCOVERY_CONFLICT' };
      if (step.state !== 'running' || safeCounter(step.generation) !== generation()) {
        return { kind: 'denied', code: 'DISCOVERY_CONFLICT' };
      }
    }

    return { run, task, step };
  }

  return {
    async lookup(input, sql) {
      return runOnOwner(async client => {
        const authorized = await authorizeStep(client, input, 'lookup');
        if ('kind' in authorized) return authorized;
        return sql(client, input);
      });
    },

    async admit(input, sql) {
      return runOnOwner(async client => {
        const authorized = await authorizeStep(client, input, 'admit');
        if ('kind' in authorized) return authorized;
        const { run, task, step } = authorized;
        const parsed = RequestVerificationInputSchema.safeParse(step.arguments);
        if (!parsed.success) return { kind: 'denied', code: 'DISCOVERY_CONFLICT' };

        const prepared = admissions.peek(input.requestKey);
        if (!prepared || prepared.subjectHash !== input.expectedSubjectHash ||
            prepared.proposalId !== parsed.data.proposalId ||
            prepared.proposalRevision !== parsed.data.revision ||
            prepared.profileHash !== parsed.data.profileHash) {
          return { kind: 'denied', code: 'DISCOVERY_CONFLICT' };
        }

        const scope = requireTrustedScope(run, task, prepared.accountId);
        if (scope) return { kind: 'denied', code: scope };
        if (prepared.accountId !== input.accountId) return { kind: 'denied', code: 'DISCOVERY_CONFLICT' };

        let subject: VerificationSubject;
        try {
          subject = await loadVerificationSubject(client, run.id, parsed.data);
        } catch {
          return { kind: 'denied', code: 'DISCOVERY_CONFLICT' };
        }
        if (subject.assessmentRevision !== prepared.assessmentRevision ||
            subject.profileHash !== prepared.profileHash ||
            subject.accountId !== prepared.accountId) {
          return { kind: 'denied', code: 'DISCOVERY_CONFLICT' };
        }

        const original = {
          requestKey: input.requestKey,
          runId: input.runId,
          taskId: input.taskId,
          accountId: input.accountId,
          dispatchId: step.dispatch_id,
          admittedGeneration: generation(),
          admittedTaskRevision: safeCounter(task.revision),
          proposalId: subject.proposalId,
          proposalRevision: subject.proposalRevision,
          assessmentRevision: subject.assessmentRevision,
          subjectHash: prepared.subjectHash,
          subjectBytes: prepared.subjectBytes,
        };
        return sql(client, original);
      });
    },

    async recoverQueued(input, sql) {
      return runOnOwner(async client => {
        const authorized = await authorizeStep(client, input, 'recover');
        if ('kind' in authorized) return authorized;
        const { rows: [row] } = await client.query<{
          request_key: string; run_id: string; task_id: string; account_id: string;
          dispatch_id: string; admitted_generation: string; admitted_task_revision: string;
          proposal_id: string; proposal_revision: string; assessment_revision: string;
          subject_hash: string; subject_bytes: Buffer; job_id: string; request_hash: string;
        }>('SELECT * FROM discovery_verification_requests WHERE request_key=$1', [input.requestKey]);
        if (!row || row.run_id !== input.runId || row.task_id !== input.taskId ||
            row.account_id !== input.accountId) {
          return { kind: 'denied', code: 'DISCOVERY_FORBIDDEN' };
        }
        const scope = requireTrustedScope(authorized.run, authorized.task, row.account_id);
        if (scope) return { kind: 'denied', code: scope };
        const binding: PersistedBinding = {
          requestKey: row.request_key, runId: row.run_id, taskId: row.task_id, accountId: row.account_id,
          dispatchId: row.dispatch_id, admittedGeneration: Number(row.admitted_generation),
          admittedTaskRevision: Number(row.admitted_task_revision), proposalId: row.proposal_id,
          proposalRevision: Number(row.proposal_revision), assessmentRevision: Number(row.assessment_revision),
          subjectHash: row.subject_hash, subjectBytes: row.subject_bytes, jobId: row.job_id,
          requestHash: row.request_hash,
        };
        return sql(client, binding);
      });
    },
  };
}

export async function bindReadVerificationJob(
  client: PoolClient,
  run: RunRow,
  task: TaskRow,
  input: ReadVerificationInput,
): Promise<{ binding: PersistedBinding; job: VerificationJob } | { code: GateDenial }> {
  const { rows: [row] } = await client.query<{
    request_key: string; run_id: string; task_id: string; account_id: string;
    dispatch_id: string; admitted_generation: string; admitted_task_revision: string;
    proposal_id: string; proposal_revision: string; assessment_revision: string;
    subject_hash: string; subject_bytes: Buffer; job_id: string; request_hash: string;
  }>('SELECT * FROM discovery_verification_requests WHERE job_id=$1 AND run_id=$2', [input.jobId, run.id]);
  if (!row || row.task_id !== task.id) return { code: 'DISCOVERY_FORBIDDEN' };
  const scope = requireTrustedScope(run, task, row.account_id);
  if (scope) return { code: scope };
  const { rows: [jobRow] } = await client.query<{
    id: string; state: VerificationJob['state']; summary: unknown;
  }>('SELECT id, state, summary FROM verification_jobs WHERE id=$1', [row.job_id]);
  if (!jobRow) return { code: 'DISCOVERY_CONFLICT' };
  const parsed = VerificationJobSchema.safeParse({
    jobId: jobRow.id, state: jobRow.state, summary: jobRow.summary ?? undefined,
    diagnostics: jobRow.state === 'failed' ? [{
      code: 'VERIFICATION_FAILED', severity: 'blocker',
      message: 'Protected verification could not finish', sourceIds: [], fieldPaths: [],
    }] : [],
  });
  if (!parsed.success) return { code: 'DISCOVERY_CONFLICT' };
  const safe = RequestVerificationResultSchema.safeParse({ ok: true, job: parsed.data });
  if (!safe.success || !safe.data.ok) return { code: 'DISCOVERY_CONFLICT' };
  return {
    binding: {
      requestKey: row.request_key, runId: row.run_id, taskId: row.task_id, accountId: row.account_id,
      dispatchId: row.dispatch_id, admittedGeneration: Number(row.admitted_generation),
      admittedTaskRevision: Number(row.admitted_task_revision), proposalId: row.proposal_id,
      proposalRevision: Number(row.proposal_revision), assessmentRevision: Number(row.assessment_revision),
      subjectHash: row.subject_hash, subjectBytes: row.subject_bytes, jobId: row.job_id,
      requestHash: row.request_hash,
    },
    job: safe.data.job,
  };
}

export type { HistoricalLookup, AdmissionResult, ClaimResult };
