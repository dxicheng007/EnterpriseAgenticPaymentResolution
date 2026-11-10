import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CandidateRegistration } from '@eapr/compiler/preview-adapters';
import { canonicalJson, hashBytes, hashCanonical, type VerificationJob } from '@eapr/contracts';
import { sqlState } from '@eapr/storage/transaction';
import {
  createFinancialPreparation, getFinancialJob, type FinancialAttestationJobsOptions,
} from './financial-attestation-jobs.js';
import {
  createFinancialAttestationRegistry, FinancialAttestationFailure, readSavedFinancialRequestOn,
  requireFinancialCandidate, reservationRecord, reservePreparedOn, type FinancialTaskReservation,
} from './financial-attestation-registry.js';
import { financialEqual } from './financial-attestation-verify.js';

export type RequestIdentity = Readonly<{
  requestKey: string; runId: string; taskId: string; accountId: string;
}>;
export type PersistedBinding = Readonly<RequestIdentity & {
  dispatchId: string; admittedGeneration: number; admittedTaskRevision: number;
  proposalId: string; proposalRevision: number; assessmentRevision: number;
  subjectHash: string; subjectBytes: Uint8Array; jobId: string; requestHash: string;
}>;
type AdmissionBinding = Omit<PersistedBinding, 'jobId' | 'requestHash'>;
type GateDenial = 'DISCOVERY_FORBIDDEN' | 'DISCOVERY_CONFLICT' | 'VERIFICATION_SCOPE_REQUIRED' | 'DISCOVERY_PAUSED';
type CommitLoss = 'not_committed' | 'unknown';

export type GateOutcome<T> =
  | { kind: 'committed'; value: T }
  | { kind: 'denied'; code: GateDenial }
  | { kind: 'owner_lost'; commit: CommitLoss };
export type AdmissionResult = { binding: PersistedBinding; job: VerificationJob };
export type HistoricalLookup = { kind: 'absent' } | ({ kind: 'existing' } & AdmissionResult);
export type ClaimResult =
  | { kind: 'claimed'; binding: PersistedBinding; requestBytes: Uint8Array }
  | ({ kind: 'not_claimed' } & AdmissionResult);

/** The supervisor owns authority checks, the transaction, and positive COMMIT acknowledgement. */
export interface DiscoveryVerificationOwnerGate {
  lookup(input: RequestIdentity, sql: (client: PoolClient, identity: RequestIdentity) => Promise<HistoricalLookup>):
    Promise<GateOutcome<HistoricalLookup>>;
  admit(input: RequestIdentity & { expectedSubjectHash: string }, sql: (
    client: PoolClient, original: AdmissionBinding
  ) => Promise<AdmissionResult>): Promise<GateOutcome<AdmissionResult>>;
  recoverQueued(input: RequestIdentity, sql: (client: PoolClient, original: PersistedBinding) => Promise<ClaimResult>):
    Promise<GateOutcome<ClaimResult>>;
}

export type DiscoveryVerificationInput = {
  requestKey: string;
  candidate: CandidateRegistration;
  task: FinancialTaskReservation;
};

export class DiscoveryVerificationFailure extends Error {
  readonly statusCode: 403 | 409 | 503;

  constructor(readonly code: GateDenial | 'DISCOVERY_OWNER_LOST' | 'FINANCIAL_ATTESTATION_UNAVAILABLE',
    readonly commit?: CommitLoss) {
    super(code);
    this.statusCode = code === 'DISCOVERY_FORBIDDEN' || code === 'VERIFICATION_SCOPE_REQUIRED' ? 403 :
      code === 'DISCOVERY_CONFLICT' || code === 'DISCOVERY_PAUSED' ? 409 : 503;
  }
}

const conflict = () => new DiscoveryVerificationFailure('DISCOVERY_CONFLICT');
const unavailable = () => new DiscoveryVerificationFailure('FINANCIAL_ATTESTATION_UNAVAILABLE');

function committed<T>(outcome: GateOutcome<T>): T {
  switch (outcome.kind) {
    case 'committed': return outcome.value;
    case 'denied': throw new DiscoveryVerificationFailure(outcome.code);
    case 'owner_lost': throw new DiscoveryVerificationFailure('DISCOVERY_OWNER_LOST', outcome.commit);
  }
}

type Subject = Pick<PersistedBinding, 'subjectHash' | 'subjectBytes'>;

/** Canonical equality assertion. Admission must independently derive it from the exact registered candidate. */
export function discoveryVerificationSubject(candidate: CandidateRegistration, { runId, accountId }: FinancialTaskReservation): Subject {
  const profiles = [...candidate.profiles].sort((a, b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);
  const subjectBytes = Buffer.from(canonicalJson({
    schemaVersion: 'discovery-verification-subject-1', task: { runId, accountId },
    snapshotObjectHash: hashCanonical(candidate.snapshot), candidate: { ...candidate, profiles },
  }));
  if (subjectBytes.length > 10 * 1024 * 1024) throw conflict();
  return { subjectBytes, subjectHash: hashBytes(subjectBytes) };
}

function requireSubject(actual: Subject, expected: Subject) {
  if (actual.subjectHash !== expected.subjectHash ||
      !Buffer.from(actual.subjectBytes).equals(expected.subjectBytes)) throw conflict();
}

function requireIdentity(actual: RequestIdentity, expected: RequestIdentity) {
  if (actual.requestKey !== expected.requestKey || actual.runId !== expected.runId ||
      actual.taskId !== expected.taskId || actual.accountId !== expected.accountId) throw conflict();
}

type BindingRow = {
  request_key: string; run_id: string; task_id: string; account_id: string;
  dispatch_id: string; admitted_generation: string; admitted_task_revision: string;
  proposal_id: string; proposal_revision: string; assessment_revision: string;
  subject_hash: string; subject_bytes: Buffer; job_id: string; request_hash: string;
};

async function readRequestOn(client: PoolClient, identity: RequestIdentity, candidate: CandidateRegistration, subject: Subject) {
  const { rows: [row] } = await client.query<BindingRow>(
    'SELECT * FROM discovery_verification_requests WHERE request_key = $1', [identity.requestKey],
  );
  if (!row) return null;
  const binding: PersistedBinding = {
    requestKey: row.request_key, runId: row.run_id, taskId: row.task_id, accountId: row.account_id,
    dispatchId: row.dispatch_id, admittedGeneration: Number(row.admitted_generation),
    admittedTaskRevision: Number(row.admitted_task_revision), proposalId: row.proposal_id,
    proposalRevision: Number(row.proposal_revision), assessmentRevision: Number(row.assessment_revision),
    subjectHash: row.subject_hash, subjectBytes: row.subject_bytes, jobId: row.job_id, requestHash: row.request_hash,
  };
  requireIdentity(binding, identity);
  requireSubject(binding, subject);
  const saved = await readSavedFinancialRequestOn(client, binding.jobId, binding.requestHash, binding);
  const { artifact, profiles, manifest, snapshot } = saved.request.capture;
  if (profiles.length !== 1) throw conflict();
  requireSubject(binding, discoveryVerificationSubject({ spec: candidate.spec, artifact, profiles, manifest, snapshot }, binding));
  return { binding, ...saved };
}

function requireBinding(actual: PersistedBinding, expected: PersistedBinding) {
  requireIdentity(actual, expected);
  requireSubject(actual, expected);
  if (actual.dispatchId !== expected.dispatchId || actual.admittedGeneration !== expected.admittedGeneration ||
      actual.admittedTaskRevision !== expected.admittedTaskRevision || actual.proposalId !== expected.proposalId ||
      actual.proposalRevision !== expected.proposalRevision || actual.assessmentRevision !== expected.assessmentRevision ||
      actual.jobId !== expected.jobId || actual.requestHash !== expected.requestHash) throw conflict();
}

async function claimQueuedOn(client: PoolClient, candidate: CandidateRegistration, original: PersistedBinding): Promise<ClaimResult> {
  const stored = await readRequestOn(client, original, candidate, original);
  if (!stored) throw conflict();
  requireBinding(stored.binding, original);
  if (stored.job.state !== 'queued') return { kind: 'not_claimed', binding: stored.binding, job: stored.job };

  const update = await client.query(
    "UPDATE verification_jobs SET state = 'running' WHERE id = $1 AND state = 'queued'", [original.jobId],
  );
  if (update.rowCount === 1) {
    return { kind: 'claimed', binding: stored.binding, requestBytes: stored.requestBytes };
  }
  const latest = await readRequestOn(client, original, candidate, original);
  if (!latest || latest.job.state === 'queued') throw conflict();
  requireBinding(latest.binding, original);
  return { kind: 'not_claimed', binding: latest.binding, job: latest.job };
}

export type DiscoveryVerificationOptions = FinancialAttestationJobsOptions & {
  gate: DiscoveryVerificationOwnerGate;
  /** Resolve the persisted step association. The gate reauthorizes it in every operation. */
  resolveTaskId(input: Omit<RequestIdentity, 'taskId'>): Promise<string>;
};

export function createDiscoveryVerification(options: DiscoveryVerificationOptions) {
  const { db, candidates, launcher, gate, resolveTaskId } = options;
  const prepare = createFinancialPreparation(options);
  const registry = createFinancialAttestationRegistry(db, candidates);
  const running = new Map<string, Promise<void>>();

  async function identityFor({ requestKey, task: { runId, accountId } }: DiscoveryVerificationInput) {
    const identity = { requestKey, runId, accountId };
    return { ...identity, taskId: await resolveTaskId(identity) };
  }

  async function lookup(identity: RequestIdentity, candidate: CandidateRegistration, subject: Subject) {
    return committed(await gate.lookup(identity, async (client, authorized) => {
      requireIdentity(authorized, identity);
      const stored = await readRequestOn(client, authorized, candidate, subject);
      if (!stored) return { kind: 'absent' };
      return { kind: 'existing', binding: stored.binding, job: stored.job };
    }));
  }

  async function execute(claim: Extract<ClaimResult, { kind: 'claimed' }>) {
    const { binding, requestBytes } = claim;
    try {
      const saved = reservationRecord(JSON.parse(Buffer.from(requestBytes).toString('utf8')));
      if (saved.request.jobId !== binding.jobId || saved.requestHash !== binding.requestHash ||
          !saved.requestBytes.equals(requestBytes)) throw conflict();
      const registered = await requireFinancialCandidate(candidates, saved.request.capture);
      requireSubject(binding, discoveryVerificationSubject(registered, binding));
      await registry.complete(binding.jobId, await launcher.launch(saved.request));
    } catch {
      await registry.fail(binding.jobId);
    }
  }

  async function recover(identity: RequestIdentity, candidate: CandidateRegistration, expected: AdmissionResult) {
    if (expected.job.state !== 'queued') return expected.job;
    const claim = committed(await gate.recoverQueued(identity, async (client, original) => {
      requireBinding(original, expected.binding);
      return claimQueuedOn(client, candidate, original);
    }));
    if (claim.kind === 'not_claimed') return claim.job;
    const execution = execute(claim);
    running.set(claim.binding.jobId, execution);
    const forget = () => running.delete(claim.binding.jobId);
    void execution.then(forget, forget);
    return { jobId: claim.binding.jobId, state: 'running', diagnostics: [] } satisfies VerificationJob;
  }

  async function safely<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DiscoveryVerificationFailure) throw error;
      if (error instanceof FinancialAttestationFailure && error.statusCode === 409) throw conflict();
      throw unavailable();
    }
  }

  return {
    async enqueueDiscoveryVerification(input: DiscoveryVerificationInput): Promise<VerificationJob> {
      return safely(async () => {
        const { candidate, task } = input;
        const identity = await identityFor(input);
        const subject = discoveryVerificationSubject(candidate, task);
        const historical = await lookup(identity, candidate, subject);
        if (historical.kind === 'existing') return recover(identity, candidate, historical);

        const registered = await requireFinancialCandidate(candidates, candidate);
        if (!financialEqual(registered.spec, candidate.spec) || registered.profiles.length !== 1 ||
            registered.profiles[0]?.scope.accountId !== task.accountId) throw conflict();
        requireSubject(discoveryVerificationSubject(registered, task), subject);
        const jobId = randomUUID();
        const prepared = reservationRecord(await prepare(registered, jobId, task));
        const { artifact, profiles, manifest, snapshot } = prepared.request.capture;
        requireSubject(discoveryVerificationSubject({ spec: registered.spec, artifact, profiles, manifest, snapshot }, task), subject);
        let admitted;
        try {
          admitted = committed(await gate.admit({ ...identity, expectedSubjectHash: subject.subjectHash }, async (client, original) => {
            requireIdentity(original, identity);
            requireSubject(original, subject);
            const existing = await readRequestOn(client, identity, candidate, subject);
            if (existing) return { binding: existing.binding, job: existing.job };
            await reservePreparedOn(client, prepared, task);
            const binding = { ...original, jobId, requestHash: prepared.requestHash };
            await client.query(
              `INSERT INTO discovery_verification_requests
                 (request_key, run_id, task_id, account_id, dispatch_id, admitted_generation, admitted_task_revision,
                  proposal_id, proposal_revision, assessment_revision, subject_hash, subject_bytes, job_id, request_hash)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
              [binding.requestKey, binding.runId, binding.taskId, binding.accountId, binding.dispatchId,
                binding.admittedGeneration, binding.admittedTaskRevision, binding.proposalId, binding.proposalRevision,
                binding.assessmentRevision, binding.subjectHash, Buffer.from(binding.subjectBytes), jobId, binding.requestHash],
            );
            return { binding, job: { jobId, state: 'queued', diagnostics: [] } };
          }));
        } catch (error) {
          if (sqlState(error) !== '23505') throw error;
          const winner = await lookup(identity, candidate, subject);
          if (winner.kind === 'absent') throw conflict();
          admitted = winner;
        }
        return recover(identity, candidate, admitted);
      });
    },

    async readByRequestKey(input: DiscoveryVerificationInput) {
      return safely(async () => {
        const result = await lookup(await identityFor(input), input.candidate, discoveryVerificationSubject(input.candidate, input.task));
        if (result.kind === 'absent') return result;
        return {
          kind: 'existing' as const,
          job: result.job,
          executionUncertain: result.job.state === 'running' && !running.has(result.job.jobId),
        };
      });
    },

    get(jobId: string) {
      return getFinancialJob(db, jobId);
    },

    async drain() {
      await Promise.allSettled(running.values());
    },
  };
}
