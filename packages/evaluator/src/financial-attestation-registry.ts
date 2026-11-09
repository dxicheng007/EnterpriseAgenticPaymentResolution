import type { Pool } from 'pg';
import { ZodError } from 'zod';
import type { CandidateRegistration } from '@eapr/compiler/preview-adapters';
import {
  ActivationTrustPolicyV1Schema, CaptureAttestationV1Schema, HashSchema, HashSetSchema,
  canonicalJson, hashActivationTrustPolicy, hashBytes, hashCanonical,
  type ActivationTrustPolicyV1, type CaptureAttestationV1, type VerificationJob,
} from '@eapr/contracts';
import { sqlState, withTransaction } from '@eapr/storage/transaction';
import { FinancialEvaluatorInputV1Schema, type FinancialEvaluatorInputV1, type FinancialCaptureV1 } from './financial-attestation-protocol.js';
import { financialMessageLimit } from './financial-attestation-runner.js';
import { bindFinancialRequest, financialEqual, validateFinancialCompletion } from './financial-attestation-verify.js';
import { RegistryFailure } from './registry.js';

export type FinancialCandidateReader = {
  getCandidate(artifactHash: string, manifestId: string): Promise<CandidateRegistration>;
};
export type FinancialTaskReservation = { runId: string; accountId: string };
type ExpectedProof = {
  artifactHash: string;
  requiredProfileHashes: string[];
  capture: CaptureAttestationV1;
  policy: ActivationTrustPolicyV1;
};

type JobRow = {
  id: string;
  state: VerificationJob['state'];
  artifact_hash: string;
  manifest_id: string;
  source_refs: string[];
  account_ids: string[];
  summary: unknown;
};
type ReservationRow = {
  job_id: string;
  artifact_hash: string;
  manifest_id: string;
  snapshot_id: string;
  capture_hash: string;
  reservation_bytes: Buffer;
  reservation_hash: string;
  request_bytes: Buffer;
  request_hash: string;
};
type ProofRow = {
  report_id: string;
  job_id: string;
  request_hash: string;
  completion_bytes: Buffer;
  report_bytes: Buffer;
  report_hash: string;
  attestation_bytes: Buffer;
  attestation_hash: string;
  report: unknown;
};

type JoinedProofRow = ProofRow & JobRow & Pick<ReservationRow,
  'snapshot_id' | 'capture_hash' | 'reservation_bytes' | 'reservation_hash' | 'request_bytes'
> & { reserved_artifact_hash: string; reserved_manifest_id: string };

export class FinancialAttestationFailure extends Error {
  readonly statusCode: 409 | 503;

  constructor(reason: 'MISMATCH' | 'UNAVAILABLE') {
    super('FINANCIAL_ATTESTATION_' + reason);
    this.statusCode = reason === 'MISMATCH' ? 409 : 503;
  }
}

const mismatch = () => new FinancialAttestationFailure('MISMATCH');
const unavailable = () => new FinancialAttestationFailure('UNAVAILABLE');
const bytes = (value: unknown) => Buffer.from(canonicalJson(value));
const accounts = (capture: FinancialCaptureV1) => [...new Set(capture.profiles.map(profile => profile.scope.accountId))].sort();

function bounded(value: Buffer) {
  if (value.length >= financialMessageLimit) throw unavailable();
  return value;
}

export async function requireFinancialCandidate(candidates: FinancialCandidateReader, subject: Omit<FinancialCaptureV1, 'events'>) {
  let registered;
  try {
    registered = await candidates.getCandidate(subject.artifact.hash, subject.manifest.id);
  } catch (error) {
    if (error instanceof RegistryFailure && error.statusCode === 409) throw mismatch();
    throw unavailable();
  }
  if (!financialEqual(registered.artifact, subject.artifact) || !financialEqual(registered.manifest, subject.manifest) ||
    !financialEqual(registered.snapshot, subject.snapshot) || !financialEqual(
      [...registered.profiles].sort((a, b) => a.hash < b.hash ? -1 : 1),
      [...subject.profiles].sort((a, b) => a.hash < b.hash ? -1 : 1),
    )) throw mismatch();
  return registered;
}

function reservationRecord(input: FinancialEvaluatorInputV1) {
  try {
    const request = FinancialEvaluatorInputV1Schema.parse(input);
    const capture = bindFinancialRequest(request);
    const requestBytes = bounded(bytes(request));
    return { request, capture, requestBytes, requestHash: hashBytes(requestBytes) };
  } catch (error) {
    if (error instanceof FinancialAttestationFailure) throw error;
    throw mismatch();
  }
}

function savedRequest(job: JobRow, row: ReservationRow) {
  try {
    const { request, capture, requestBytes, requestHash } = reservationRecord(JSON.parse(row.request_bytes.toString('utf8')));
    if (job.id !== row.job_id || job.id !== request.jobId || job.artifact_hash !== row.artifact_hash ||
      row.artifact_hash !== request.reservation.artifactHash || job.manifest_id !== row.manifest_id ||
      row.manifest_id !== capture.manifestId || row.snapshot_id !== capture.snapshotId ||
      row.capture_hash !== hashCanonical(capture) || !financialEqual(job.source_refs, [capture.sourceRef]) ||
      !financialEqual(job.account_ids, accounts(request.capture)) || !requestBytes.equals(row.request_bytes) ||
      requestHash !== row.request_hash || request.reservation.hash !== row.reservation_hash ||
      !bytes(request.reservation).equals(row.reservation_bytes)) throw mismatch();
    return request;
  } catch {
    throw mismatch();
  }
}

function completionRecord(request: FinancialEvaluatorInputV1, raw: unknown) {
  try {
    const value = validateFinancialCompletion(request, raw);
    return { ...value, completionBytes: bounded(bytes(value.completion)), reportBytes: bytes(value.report),
      attestationBytes: bytes(value.attestation) };
  } catch (error) {
    if (error instanceof FinancialAttestationFailure) throw error;
    throw mismatch();
  }
}

function requireStoredProof(job: JobRow, row: ProofRow, record: ReturnType<typeof completionRecord>) {
  if (row.job_id !== job.id || row.report_id !== record.report.id || row.request_hash !== record.completion.requestHash ||
    row.report_hash !== record.attestation.reportHash || row.attestation_hash !== record.attestation.hash ||
    !record.reportBytes.equals(row.report_bytes) || !record.completionBytes.equals(row.completion_bytes) ||
    !record.attestationBytes.equals(row.attestation_bytes) || !financialEqual(row.report, record.report) ||
    !financialEqual(job.summary, record.summary)) throw mismatch();
}

function requirePolicy(request: FinancialEvaluatorInputV1, expected: ExpectedProof) {
  const { issuerId, runnerId, protocolVersion, harnessVersion, evaluatorBuildHash, evidencePin,
    capture, artifactHash, requiredProfileHashes } = request.reservation;
  const policy = ActivationTrustPolicyV1Schema.parse(expected.policy);
  const expectedProfiles = HashSetSchema.parse(expected.requiredProfileHashes).sort();
  if (hashActivationTrustPolicy(policy) !== policy.hash || HashSchema.parse(expected.artifactHash) !== artifactHash ||
    !financialEqual(CaptureAttestationV1Schema.parse(expected.capture), capture) ||
    !financialEqual(expectedProfiles, requiredProfileHashes)) throw mismatch();
  if (!policy.entries.some(entry => entry.issuerId === issuerId && entry.artifactHash === artifactHash &&
    financialEqual(entry.capture, capture) && financialEqual(entry.requiredProfileHashes, requiredProfileHashes) &&
    financialEqual(entry.financial, { runnerId, protocolVersion, harnessVersion, evaluatorBuildHash, evidencePin }) &&
    request.capture.profiles.some(profile => profile.hash === entry.selectedProfileHash &&
      financialEqual(profile.scope, entry.scope)))) throw mismatch();
}

const proofQuery = `SELECT a.*, r.report FROM financial_verification_attestations a
  JOIN verification_reports r ON r.id = a.report_id AND r.job_id = a.job_id`;

/** Trusted control-side persistence. HTTP composition receives the separate jobs service. */
export function createFinancialAttestationRegistry(db: Pool, candidates: FinancialCandidateReader) {
  return {
    async reserve(input: FinancialEvaluatorInputV1, task?: FinancialTaskReservation) {
      const { request, capture, requestBytes, requestHash } = reservationRecord(input);
      await requireFinancialCandidate(candidates, request.capture);
      const accountIds = accounts(request.capture);
      if (task && (accountIds.length !== 1 || accountIds[0] !== task.accountId)) throw mismatch();
      try {
        await withTransaction(db, async client => {
          if (task) {
            const reserved = await client.query(
              `INSERT INTO verification_attempt_budgets VALUES ($1, $2, 1)
               ON CONFLICT (run_id, account_id) DO UPDATE SET attempts = verification_attempt_budgets.attempts + 1
               WHERE verification_attempt_budgets.attempts < 3 RETURNING attempts`, [task.runId, task.accountId],
            );
            if (reserved.rowCount !== 1) throw mismatch();
          }
          await client.query(
            `INSERT INTO verification_jobs (id, state, source_refs, account_ids, task_run_id, artifact_hash, manifest_id)
             VALUES ($1, 'queued', $2, $3, $4, $5, $6)`,
            [request.jobId, [capture.sourceRef], accountIds, task?.runId ?? null, request.reservation.artifactHash, capture.manifestId],
          );
          await client.query(
            `INSERT INTO financial_verification_reservations
               (job_id, artifact_hash, manifest_id, snapshot_id, capture_hash, reservation_bytes, reservation_hash, request_bytes, request_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [request.jobId, request.reservation.artifactHash, capture.manifestId, capture.snapshotId, hashCanonical(capture),
              bytes(request.reservation), request.reservation.hash, requestBytes, requestHash],
          );
        });
      } catch (error) {
        if (error instanceof FinancialAttestationFailure) throw error;
        if (sqlState(error) === '23505') throw mismatch();
        throw unavailable();
      }
    },

    async start(jobId: string) {
      try {
        const request = await withTransaction(db, async client => {
          const { rows: [job] } = await client.query<JobRow>(
            "UPDATE verification_jobs SET state = 'running' WHERE id = $1 AND state = 'queued' RETURNING *", [jobId],
          );
          const { rows: [row] } = await client.query<ReservationRow>(
            'SELECT * FROM financial_verification_reservations WHERE job_id = $1', [jobId],
          );
          if (!job || !row) throw unavailable();
          return savedRequest(job, row);
        });
        // Immutable subject lookup uses its own pool connection and filesystem.
        await requireFinancialCandidate(candidates, request.capture);
        return request;
      } catch (error) {
        if (error instanceof FinancialAttestationFailure) throw error;
        throw unavailable();
      }
    },

    async fail(jobId: string) {
      try {
        await db.query(
          `UPDATE verification_jobs SET state = 'failed' WHERE id = $1 AND state IN ('queued', 'running')
           AND EXISTS (SELECT 1 FROM financial_verification_reservations WHERE job_id = $1)`, [jobId],
        );
      } catch {
        throw unavailable();
      }
    },

    async complete(jobId: string, raw: unknown) {
      try {
        return await withTransaction(db, async client => {
          const { rows: [job] } = await client.query<JobRow>('SELECT * FROM verification_jobs WHERE id = $1 FOR UPDATE', [jobId]);
          if (!job || (job.state !== 'running' && job.state !== 'completed')) throw unavailable();
          const { rows: [row] } = await client.query<ReservationRow>(
            'SELECT * FROM financial_verification_reservations WHERE job_id = $1', [jobId],
          );
          if (!row) throw unavailable();
          const record = completionRecord(savedRequest(job, row), raw);
          const { report, attestation, summary, completion } = record;
          if (job.state === 'completed') {
            const { rows: [stored] } = await client.query<ProofRow>(proofQuery + ' WHERE a.job_id = $1', [jobId]);
            if (!stored) throw mismatch();
            requireStoredProof(job, stored, record);
          } else {
            await client.query('INSERT INTO verification_reports (id, job_id, report) VALUES ($1, $2, $3)',
              [report.id, jobId, record.reportBytes.toString('utf8')]);
            await client.query(
              `INSERT INTO financial_verification_attestations
                (report_id, job_id, request_hash, completion_bytes, report_bytes, report_hash, attestation_bytes, attestation_hash)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [report.id, jobId, completion.requestHash, record.completionBytes, record.reportBytes,
                attestation.reportHash, record.attestationBytes, attestation.hash],
            );
            const updated = await client.query(
              "UPDATE verification_jobs SET state = 'completed', summary = $2 WHERE id = $1 AND state = 'running'",
              [jobId, canonicalJson(summary)],
            );
            if (updated.rowCount !== 1) throw mismatch();
          }
          return { report, attestation };
        });
      } catch (error) {
        if (error instanceof FinancialAttestationFailure) throw error;
        throw unavailable();
      }
    },

    async readRegisteredFinancialAttestation(reportId: string, expected: ExpectedProof) {
      try {
        const { rows: [proof] } = await db.query<JoinedProofRow>(
          `SELECT a.*, r.report, j.*, f.snapshot_id, f.capture_hash, f.reservation_bytes, f.reservation_hash,
                  f.request_bytes, f.artifact_hash AS reserved_artifact_hash, f.manifest_id AS reserved_manifest_id
             FROM financial_verification_attestations a
             JOIN verification_reports r ON r.id = a.report_id AND r.job_id = a.job_id
             JOIN financial_verification_reservations f ON f.job_id = a.job_id AND f.request_hash = a.request_hash
             JOIN verification_jobs j ON j.id = a.job_id
            WHERE a.report_id = $1`, [reportId],
        );
        if (!proof) throw unavailable();
        if (proof.state !== 'completed') throw mismatch();
        const request = savedRequest(proof, {
          ...proof, artifact_hash: proof.reserved_artifact_hash, manifest_id: proof.reserved_manifest_id,
        });
        const record = completionRecord(request, JSON.parse(proof.completion_bytes.toString('utf8')));
        requireStoredProof(proof, proof, record);
        requirePolicy(request, expected);
        await requireFinancialCandidate(candidates, request.capture);
        if (!record.report.eligible) throw unavailable();
        return { report: record.report, attestation: record.attestation };
      } catch (error) {
        if (error instanceof FinancialAttestationFailure) throw error;
        if (error instanceof SyntaxError || error instanceof ZodError) throw mismatch();
        throw unavailable();
      }
    },
  };
}
