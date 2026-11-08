import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { VerificationJobSchema, canonicalJson, type VerificationJob } from '@eapr/contracts';
import type { CandidateRegistration } from '@eapr/compiler/preview-adapters';
import { withTransaction } from '@eapr/storage/transaction';
import { RegistryFailure } from './registry.js';
import { validateReport, type VerificationPin } from './verify.js';

type TaskReservation = { runId: string; accountId: string };
type FixturePolicy = VerificationPin & { purpose: 'construction' | 'final_holdout'; snapshotHash: string };

export type VerificationLauncher = {
  resolve(candidate: CandidateRegistration): Promise<FixturePolicy>;
  launch(jobId: string, candidate: CandidateRegistration, pin: FixturePolicy): Promise<unknown>;
};

type JobRow = {
  id: string;
  source_refs: string[];
  account_ids: string[];
  task_run_id: string | null;
  state: VerificationJob['state'];
  summary: unknown;
};

export function createVerificationJobs(pool: Pool, launcher: VerificationLauncher) {
  const pending = new Set<Promise<void>>();

  async function process(jobId: string, candidate: CandidateRegistration) {
    try {
      await pool.query("UPDATE verification_jobs SET state = 'running' WHERE id = $1 AND state = 'queued'", [jobId]);
      const pin = await launcher.resolve(candidate);
      if (pin.purpose !== 'construction' || pin.snapshotHash !== candidate.snapshot.contentHash) throw new Error('Verification fixture unavailable');
      const raw = await launcher.launch(jobId, candidate, pin);
      const { report, summary } = validateReport(jobId, candidate, pin, raw);
      await withTransaction(pool, async client => {
        await client.query('INSERT INTO verification_reports VALUES ($1, $2, $3)', [report.id, jobId, canonicalJson(report)]);
        const updated = await client.query(
          "UPDATE verification_jobs SET state = 'completed', summary = $2 WHERE id = $1 AND state = 'running'",
          [jobId, canonicalJson(summary)],
        );
        if (updated.rowCount !== 1) throw new Error('Verification job transition failed');
      });
    } catch {
      await pool.query(
        "UPDATE verification_jobs SET state = 'failed' WHERE id = $1 AND state IN ('queued', 'running')", [jobId],
      );
    }
  }

  return {
    async enqueue(candidate: CandidateRegistration, task?: TaskReservation): Promise<VerificationJob> {
      const jobId = randomUUID();
      const accounts = [...new Set(candidate.profiles.map(profile => profile.scope.accountId))].sort();
      if (task && (accounts.length !== 1 || accounts[0] !== task.accountId)) throw new RegistryFailure(409);
      await withTransaction(pool, async client => {
        if (task) {
          const reserved = await client.query(
            `INSERT INTO verification_attempt_budgets VALUES ($1, $2, 1)
             ON CONFLICT (run_id, account_id) DO UPDATE SET attempts = verification_attempt_budgets.attempts + 1
             WHERE verification_attempt_budgets.attempts < 3 RETURNING attempts`,
            [task.runId, task.accountId],
          );
          if (reserved.rowCount !== 1) throw new RegistryFailure(409);
        }
        await client.query(
          `INSERT INTO verification_jobs (id, state, source_refs, account_ids, task_run_id, artifact_hash, manifest_id)
           VALUES ($1, 'queued', $2, $3, $4, $5, $6)`,
          [jobId, [candidate.artifact.sourceRef], accounts, task?.runId ?? null, candidate.artifact.hash, candidate.manifest.id],
        );
      });
      const job = process(jobId, candidate);
      pending.add(job);
      void job.then(() => pending.delete(job), () => pending.delete(job));
      return { jobId, state: 'queued', diagnostics: [] };
    },
    async get(jobId: string) {
      const { rows: [row] } = await pool.query<JobRow>('SELECT * FROM verification_jobs WHERE id = $1', [jobId]);
      if (!row) throw new RegistryFailure(404);
      const job = VerificationJobSchema.parse({
        jobId: row.id, state: row.state, summary: row.summary ?? undefined,
        diagnostics: row.state === 'failed' ? [{
          code: 'VERIFICATION_FAILED', severity: 'blocker', message: 'Protected verification could not finish',
          sourceIds: [], fieldPaths: [],
        }] : [],
      });
      return { job, sourceRefs: row.source_refs, accountIds: row.account_ids, taskRunId: row.task_run_id };
    },
    async drain() {
      await Promise.allSettled(pending);
    },
  };
}
