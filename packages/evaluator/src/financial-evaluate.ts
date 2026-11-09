import {
  VerificationReportSchema,
  type VerificationReport,
} from '@eapr/contracts';
import { buildCasePlan, runCasePlan } from './cases.js';
import { checkEvidenceSupport, type CapturedEvidenceRun } from './evidence-support.js';
import type { readProtectedFixture } from './fixture-store.js';
import type { EvaluatorInput } from './protocol.js';
import { mandatoryChecks } from './verify.js';

export async function evaluateFinancialSubject(
  input: EvaluatorInput,
  { truth, snapshot, events, evidence }: Awaited<ReturnType<typeof readProtectedFixture>>,
  strictTransport = false,
): Promise<VerificationReport> {
  const { jobId, artifact, profiles, manifest, fixtureSetId, fixtureSetVersion } = input;
  if (truth.purpose !== 'construction') throw new Error('Verification fixture unavailable');

  const plan = buildCasePlan({ artifact, profiles, manifest }, truth, events, snapshot);
  const capturedRuns = new Map<string, CapturedEvidenceRun>();
  const { checks: financialChecks, eventKinds, difference } = await runCasePlan(artifact, plan,
    evidence ? run => { capturedRuns.set(run.profileHash, run); } : undefined, strictTransport);
  const evidenceCheck = checkEvidenceSupport({ artifact, profiles, manifest, snapshot, events, evidence, capturedRuns });
  const checks = financialChecks.map(check => check.id === 'evidence_support' ? evidenceCheck : check);
  const requestedKinds = artifact.normalizedPlan.allowedKinds;
  const eligible = checks.every(check => check.status === 'passed' && check.cases > 0) && difference === 0 &&
    eventKinds.length === requestedKinds.length && requestedKinds.every(kind => eventKinds.includes(kind));
  return VerificationReportSchema.parse({
    id: 'report:' + jobId, artifactHash: artifact.hash, profileHashes: profiles.map(profile => profile.hash),
    manifestHash: manifest.hash, harnessVersion: '1', evaluatorBuildHash: input.evaluatorBuildHash,
    fixtureSetId, fixtureSetVersion, checks,
    coverage: {
      required: [...mandatoryChecks], executed: checks.filter(check => check.status !== 'unavailable').map(check => check.id),
      sourceRefs: [artifact.sourceRef], profileHashes: profiles.map(profile => profile.hash), eventKinds,
    },
    unexplainedDifferenceCents: difference, eligible, createdAt: new Date().toISOString(),
  });
}
