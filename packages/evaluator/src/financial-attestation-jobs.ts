import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CandidateRegistration } from '@eapr/compiler/preview-adapters';
import { hashFinancialReservation, type VerificationJob } from '@eapr/contracts';
import {
  FinancialProbeInputV1Schema, type FinancialAttestationLauncher, type FinancialCaptureReader,
  type FinancialFixtureSelectionV1,
} from './financial-attestation-protocol.js';
import {
  createFinancialAttestationRegistry, financialJob, FinancialAttestationFailure, requireFinancialCandidate,
  type FinancialCandidateReader, type FinancialTaskReservation,
} from './financial-attestation-registry.js';
import { validateFinancialProbe } from './financial-attestation-verify.js';
import { RegistryFailure } from './registry.js';

export type FinancialAttestationJobsOptions = {
  db: Pool;
  candidates: FinancialCandidateReader;
  captures: FinancialCaptureReader;
  launcher: FinancialAttestationLauncher;
  selectFixture(candidate: CandidateRegistration): Promise<FinancialFixtureSelectionV1>;
  readBuildHash(): Promise<string>;
};
type JobRow = {
  id: string;
  state: VerificationJob['state'];
  summary: unknown;
  source_refs: string[];
  account_ids: string[];
  task_run_id: string | null;
};

export function createFinancialPreparation({ candidates, captures, launcher, selectFixture, readBuildHash }: FinancialAttestationJobsOptions) {
  return async (candidate: CandidateRegistration, jobId: string, task?: FinancialTaskReservation) => {
    const registered = await requireFinancialCandidate(candidates, candidate);
    if (task && registered.profiles.some(profile => profile.scope.accountId !== task.accountId)) {
      throw new FinancialAttestationFailure('MISMATCH');
    }
    const capture = await captures.readCapture({ artifactHash: registered.artifact.hash, manifestId: registered.manifest.id });
    const captureCandidate = await requireFinancialCandidate(candidates, capture);
    if (captureCandidate.artifact.hash !== registered.artifact.hash || captureCandidate.manifest.id !== registered.manifest.id) {
      throw new FinancialAttestationFailure('MISMATCH');
    }
    const input = FinancialProbeInputV1Schema.parse({
      protocolVersion: 'financial-attestation-probe-1', jobId, capture,
      selection: await selectFixture(registered), evaluatorBuildHash: await readBuildHash(),
    });
    const probe = validateFinancialProbe(input, await launcher.probe(input));
    if (await readBuildHash() !== input.evaluatorBuildHash) throw new FinancialAttestationFailure('MISMATCH');
    const reservation = {
      schemaVersion: '1', jobId, issuerId: 'eapr-control-registry-1', runnerId: 'eapr-financial-1',
      protocolVersion: '1', harnessVersion: '1', purpose: 'construction', evaluatorBuildHash: input.evaluatorBuildHash,
      artifactHash: input.capture.artifact.hash, requiredProfileHashes: input.capture.profiles.map(profile => profile.hash),
      capture: probe.capture, evidencePin: probe.evidencePin,
    } as const;
    return {
      protocolVersion: 'financial-attestation-1', jobId, capture: input.capture,
      reservation: { ...reservation, hash: hashFinancialReservation(reservation) },
    } as const;
  };
}

export async function getFinancialJob(db: Pool, jobId: string) {
  const { rows: [row] } = await db.query<JobRow>(
    'SELECT id, state, summary, source_refs, account_ids, task_run_id FROM verification_jobs WHERE id = $1', [jobId],
  );
  if (!row) throw new RegistryFailure(404);
  const job = financialJob(row);
  return { job, sourceRefs: row.source_refs, accountIds: row.account_ids, taskRunId: row.task_run_id };
}

export function createFinancialAttestationJobs(options: FinancialAttestationJobsOptions) {
  const { db, candidates, launcher } = options;
  const prepare = createFinancialPreparation(options);
  const registry = createFinancialAttestationRegistry(db, candidates);
  const pending = new Set<Promise<void>>();

  async function run(jobId: string) {
    try {
      const input = await registry.start(jobId);
      await registry.complete(jobId, await launcher.launch(input));
    } catch {
      await registry.fail(jobId);
    }
  }

  return {
    async enqueue(candidate: CandidateRegistration, task?: FinancialTaskReservation): Promise<VerificationJob> {
      const jobId = randomUUID();
      try {
        await registry.reserve(await prepare(candidate, jobId, task), task);
      } catch (error) {
        if (error instanceof FinancialAttestationFailure) throw error;
        if (error instanceof Error && (error.message === 'FINANCIAL_ATTESTATION_MISMATCH' || error.name === 'ZodError')) {
          throw new FinancialAttestationFailure('MISMATCH');
        }
        throw new FinancialAttestationFailure('UNAVAILABLE');
      }
      const job = run(jobId);
      pending.add(job);
      void job.then(() => pending.delete(job), () => pending.delete(job));
      return { jobId, state: 'queued', diagnostics: [] };
    },

    get(jobId: string) {
      return getFinancialJob(db, jobId);
    },

    async drain() {
      await Promise.allSettled(pending);
    },
  };
}
