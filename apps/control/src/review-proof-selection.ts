import type { Pool } from 'pg';
import {
  BootstrapBindingV1Schema, HashSchema, IdSchema, canonicalJson, hashCanonical, hashTargetSnapshot, strict,
  type ActivationTrustPolicyEntryV1, type BootstrapBindingV1, type MutationPlan, type TargetState,
} from '@eapr/contracts';
import { createBootstrapVerificationJobs } from '@eapr/evaluator/bootstrap-jobs';
import { createProtectedBootstrapLauncher } from '@eapr/evaluator/bootstrap-launcher';
import { createBootstrapVerificationRegistry } from '@eapr/evaluator/bootstrap-registry';
import type { FinancialCaptureReader } from '@eapr/evaluator/financial-attestation-launcher';
import type { createCandidateRegistry } from '@eapr/evaluator/registry';
import { readPrivateBytes } from '../../../packages/storage/src/activation-files.js';
import { ReviewError } from './review-repository.js';

const selectionSchema = strict({
  policyId: IdSchema,
  entries: strict({
    artifactHash: HashSchema, manifestId: IdSchema, selectedProfileHash: HashSchema, financialReportId: IdSchema,
    bootstrapFixture: strict({ fixtureSetId: IdSchema, fixtureSetVersion: IdSchema, fixtureHash: HashSchema }),
  }).array().min(1),
});

export async function loadReviewSelection(path: string) {
  const bytes = await readPrivateBytes(path, 1024 * 1024);
  return selectionSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

type Capture = Awaited<ReturnType<FinancialCaptureReader['readCapture']>>;
export type BootstrapRoots = Parameters<typeof createProtectedBootstrapLauncher>[0]['roots'];

export function createReviewProofSelection(
  db: Pool, candidates: Pick<ReturnType<typeof createCandidateRegistry>, 'getCandidate'>, roots: BootstrapRoots,
) {
  const registry = createBootstrapVerificationRegistry(db, candidates);
  return async function select(input: {
    capture: Capture; entry: ActivationTrustPolicyEntryV1; policyHash: string; recordedTargetHash: string;
    target: TargetState; plan: MutationPlan; allowExecute: boolean;
  }) {
    const { capture: { artifact, profiles, manifest, snapshot, events }, entry, target, plan } = input;
    const pin = entry.bootstrapPin;
    const binding = BootstrapBindingV1Schema.parse({
      artifactHash: artifact.hash, profileHash: entry.selectedProfileHash,
      requiredProfileHashes: profiles.map(profile => profile.hash).sort(), scope: entry.scope,
      manifestId: manifest.id, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotHash: snapshot.contentHash,
      eventsHash: entry.capture.eventsHash, targetSnapshotHash: hashTargetSnapshot(target),
      expectedTargetVersion: target.version, asOf: manifest.asOf,
    });
    const selectionHash = hashCanonical({
      policyHash: input.policyHash, entry, capture: entry.capture, recordedTargetHash: input.recordedTargetHash,
      plannerTargetHash: binding.targetSnapshotHash, expectedTargetVersion: target.version,
      proposedPlanHash: plan.hash, proposedPlanBytesHash: hashCanonical(plan),
    });

    async function selectedResultId() {
      const { rows: [row] } = await db.query<{ result_id: string }>(
        'SELECT result_id FROM review_bootstrap_selections WHERE selection_hash = $1', [selectionHash],
      );
      return row?.result_id;
    }

    async function read(id: string) {
      const proof = await registry.readRegisteredBootstrapResult(id, { pin, binding, planHash: plan.hash });
      if (!proof.result.passed || canonicalJson(proof.plan) !== canonicalJson(plan)) {
        throw new ReviewError(409, 'BOOTSTRAP_VERIFICATION_MISMATCH');
      }
      return proof;
    }

    try {
      const existing = await selectedResultId();
      if (existing) return await read(existing);
      if (!input.allowExecute) throw new ReviewError(409, 'REVIEW_STALE');

      const launcher = createProtectedBootstrapLauncher({ registry: candidates, pin, roots });
      const jobs = createBootstrapVerificationJobs({ candidates, registry, launcher, pin });
      const { jobId } = await jobs.reserve({
        artifactHash: artifact.hash, manifestId: manifest.id, selectedProfileHash: entry.selectedProfileHash, events, target,
      });
      const { rows: [reserved] } = await db.query<{ binding: BootstrapBindingV1 }>(
        'SELECT binding FROM bootstrap_verification_jobs WHERE id = $1', [jobId],
      );
      // The accepted registry derives this binding from its exact reserved evaluator envelope.
      if (!reserved || canonicalJson(reserved.binding) !== canonicalJson(binding)) {
        await registry.failBootstrapVerification(jobId);
        throw new ReviewError(409, 'BOOTSTRAP_VERIFICATION_MISMATCH');
      }
      await jobs.execute(jobId);
      const { rows: [completed] } = await db.query<{ id: string }>(
        'SELECT id FROM bootstrap_verification_results WHERE job_id = $1', [jobId],
      );
      if (!completed) throw new ReviewError(503, 'BOOTSTRAP_VERIFICATION_UNAVAILABLE');
      await read(completed.id);
      await db.query(
        'INSERT INTO review_bootstrap_selections (selection_hash, result_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [selectionHash, completed.id],
      );
      const winner = await selectedResultId();
      if (!winner) throw new ReviewError(503, 'BOOTSTRAP_VERIFICATION_UNAVAILABLE');
      return await read(winner);
    } catch (error) {
      if (error instanceof ReviewError) throw error;
      if (error instanceof Error && error.message === 'BOOTSTRAP_VERIFICATION_MISMATCH') {
        throw new ReviewError(409, 'BOOTSTRAP_VERIFICATION_MISMATCH');
      }
      throw new ReviewError(503, 'BOOTSTRAP_VERIFICATION_UNAVAILABLE');
    }
  };
}
