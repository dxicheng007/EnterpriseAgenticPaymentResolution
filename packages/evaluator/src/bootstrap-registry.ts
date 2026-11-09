import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  canonicalJson, hashBytes, type BootstrapBindingV1, type BootstrapPinV1,
} from '@eapr/contracts';
import { withTransaction } from '@eapr/storage/transaction';
import {
  BootstrapEvaluatorInputV1Schema, type BootstrapEvaluatorCompletionV1, type BootstrapEvaluatorInputV1,
} from './bootstrap-protocol.js';
import { bootstrapEqual, deriveBootstrapBinding, validateBootstrapCompletion } from './bootstrap-verify.js';
import type { createCandidateRegistry } from './registry.js';

type CandidateReader = Pick<ReturnType<typeof createCandidateRegistry>, 'getCandidate'>;
type Reservation = Omit<BootstrapEvaluatorInputV1, 'jobId'>;
type ExpectedProof = { pin: BootstrapPinV1; binding: BootstrapBindingV1; planHash: string };
type State = 'queued' | 'running' | 'completed' | 'failed';

type JobRow = {
  id: string;
  state: State;
  artifact_hash: string;
  manifest_id: string;
  account_id: string;
  binding: unknown;
  pin: unknown;
  request_bytes: Buffer;
  request_hash: string;
  target_bytes: Buffer;
  target_hash: string;
};

type ResultRow = {
  id: string;
  job_id: string;
  result_hash: string;
  request_hash: string;
  completion_bytes: Buffer;
  result_bytes: Buffer;
  observed_plan_bytes: Buffer | null;
  observed_plan_bytes_hash: string | null;
};

class BootstrapRegistryFailure extends Error {
  constructor(reason: 'UNAVAILABLE' | 'MISMATCH') {
    super('BOOTSTRAP_VERIFICATION_' + reason);
  }
}

const unavailable = () => new BootstrapRegistryFailure('UNAVAILABLE');
const mismatch = () => new BootstrapRegistryFailure('MISMATCH');
const bytes = (value: unknown) => Buffer.from(canonicalJson(value), 'utf8');

function readRequest(row: JobRow) {
  try {
    const request = BootstrapEvaluatorInputV1Schema.parse(JSON.parse(row.request_bytes.toString('utf8')));
    const binding = deriveBootstrapBinding(request);
    if (request.jobId !== row.id || !bytes(request).equals(row.request_bytes) ||
      hashBytes(row.request_bytes) !== row.request_hash || !bytes(request.target).equals(row.target_bytes) ||
      binding.targetSnapshotHash !== row.target_hash || binding.artifactHash !== row.artifact_hash ||
      binding.manifestId !== row.manifest_id || binding.scope.accountId !== row.account_id ||
      !bootstrapEqual(binding, row.binding) || !bootstrapEqual(request.pin, row.pin)) throw new Error();
    return request;
  } catch {
    throw mismatch();
  }
}

function completionRecord(request: BootstrapEvaluatorInputV1, input: unknown): ResultRow {
  try {
    const completion = validateBootstrapCompletion(request, input);
    return {
      id: completion.result.id, job_id: request.jobId, result_hash: completion.result.hash,
      request_hash: completion.requestHash, completion_bytes: bytes(completion), result_bytes: bytes(completion.result),
      observed_plan_bytes: completion.observedBaselinePlan === null ? null : bytes(completion.observedBaselinePlan),
      observed_plan_bytes_hash: completion.observedBaselinePlanBytesHash,
    };
  } catch {
    throw mismatch();
  }
}

function requireSameRecord(stored: ResultRow, expected: ResultRow) {
  const observed = stored.observed_plan_bytes;
  if (stored.id !== expected.id || stored.job_id !== expected.job_id ||
    stored.result_hash !== expected.result_hash || stored.request_hash !== expected.request_hash ||
    !stored.completion_bytes.equals(expected.completion_bytes) || !stored.result_bytes.equals(expected.result_bytes) ||
    stored.observed_plan_bytes_hash !== expected.observed_plan_bytes_hash ||
    (observed === null ? expected.observed_plan_bytes !== null
      : expected.observed_plan_bytes === null || !observed.equals(expected.observed_plan_bytes) ||
        hashBytes(observed) !== stored.observed_plan_bytes_hash)) throw mismatch();
}

/** Trusted control-side storage. Callers supply a server-selected pin and target. */
export function createBootstrapVerificationRegistry(pool: Pool, candidates: CandidateReader) {
  async function requireCandidate(request: BootstrapEvaluatorInputV1) {
    const { artifact, profiles, manifest, snapshot } = request;
    let registered;
    try {
      registered = await candidates.getCandidate(artifact.hash, manifest.id);
    } catch {
      throw unavailable();
    }
    if (!bootstrapEqual(registered.artifact, artifact) || !bootstrapEqual(registered.profiles, profiles) ||
      !bootstrapEqual(registered.manifest, manifest) || !bootstrapEqual(registered.snapshot, snapshot)) throw mismatch();
  }

  return {
    async reserveBootstrapVerification(input: Reservation): Promise<{ jobId: string }> {
      const jobId = randomUUID();
      let request;
      let binding;
      try {
        request = BootstrapEvaluatorInputV1Schema.parse({ ...input, jobId });
        binding = deriveBootstrapBinding(request);
      } catch {
        throw mismatch();
      }
      await requireCandidate(request);
      const requestBytes = bytes(request);
      await pool.query(
        `INSERT INTO bootstrap_verification_jobs
           (id, state, artifact_hash, manifest_id, account_id, binding, pin, request_bytes, request_hash, target_bytes, target_hash)
         VALUES ($1, 'queued', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [jobId, binding.artifactHash, binding.manifestId, binding.scope.accountId, canonicalJson(binding),
          canonicalJson(request.pin), requestBytes, hashBytes(requestBytes), bytes(request.target), binding.targetSnapshotHash],
      );
      return { jobId };
    },

    async startBootstrapVerification(jobId: string) {
      return withTransaction(pool, async client => {
        const { rows: [row] } = await client.query<JobRow>(
          "UPDATE bootstrap_verification_jobs SET state = 'running' WHERE id = $1 AND state = 'queued' RETURNING *", [jobId],
        );
        if (!row) throw unavailable();
        return readRequest(row);
      });
    },

    async failBootstrapVerification(jobId: string) {
      await pool.query(
        "UPDATE bootstrap_verification_jobs SET state = 'failed' WHERE id = $1 AND state IN ('queued', 'running')", [jobId],
      );
    },

    async completeBootstrapVerification(jobId: string, completion: BootstrapEvaluatorCompletionV1) {
      await withTransaction(pool, async client => {
        const { rows: [job] } = await client.query<JobRow>(
          'SELECT * FROM bootstrap_verification_jobs WHERE id = $1 FOR UPDATE', [jobId],
        );
        if (!job || (job.state !== 'running' && job.state !== 'completed')) throw unavailable();
        const record = completionRecord(readRequest(job), completion);
        if (job.state === 'completed') {
          const { rows: [stored] } = await client.query<ResultRow>(
            'SELECT * FROM bootstrap_verification_results WHERE job_id = $1', [jobId],
          );
          if (!stored) throw mismatch();
          requireSameRecord(stored, record);
          return;
        }
        await client.query(
          `INSERT INTO bootstrap_verification_results
             (id, job_id, result_hash, request_hash, completion_bytes, result_bytes, observed_plan_bytes, observed_plan_bytes_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [record.id, jobId, record.result_hash, record.request_hash, record.completion_bytes,
            record.result_bytes, record.observed_plan_bytes, record.observed_plan_bytes_hash],
        );
        const updated = await client.query(
          "UPDATE bootstrap_verification_jobs SET state = 'completed' WHERE id = $1 AND state = 'running'", [jobId],
        );
        if (updated.rowCount !== 1) throw mismatch();
      });
    },

    async readRegisteredBootstrapResult(id: string, expected: ExpectedProof) {
      try {
        const { rows: [row] } = await pool.query<ResultRow & Omit<JobRow, keyof ResultRow>>(
          `SELECT r.*, j.state, j.artifact_hash, j.manifest_id, j.account_id,
                  j.binding, j.pin, j.request_bytes, j.target_bytes, j.target_hash
             FROM bootstrap_verification_results r
             JOIN bootstrap_verification_jobs j ON j.id = r.job_id
            WHERE r.id = $1 AND j.state = 'completed'`,
          [id],
        );
        if (!row) throw unavailable();
        const request = readRequest({ ...row, id: row.job_id });
        const envelope: BootstrapEvaluatorCompletionV1 = JSON.parse(row.completion_bytes.toString('utf8'));
        const record = completionRecord(request, envelope);
        requireSameRecord(row, record);
        const { result, observedBaselinePlan: plan } = envelope;
        if (!bootstrapEqual(result.pin, expected.pin) || !bootstrapEqual(result.binding, expected.binding) ||
          result.planHash !== expected.planHash) throw mismatch();
        if (!result.passed || !plan) throw unavailable();
        await requireCandidate(request);
        return { result, plan };
      } catch (error) {
        if (error instanceof BootstrapRegistryFailure) throw error;
        if (error instanceof SyntaxError) throw mismatch();
        throw unavailable();
      }
    },
  };
}
