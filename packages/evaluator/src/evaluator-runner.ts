import {
  VerificationReportSchema,
  type VerificationReport,
} from '@eapr/contracts';
import { buildCasePlan, runCasePlan } from './cases.js';
import { checkEvidenceSupport, type CapturedEvidenceRun } from './evidence-support.js';
import { readProtectedFixture } from './fixture-store.js';
import { EvaluatorInputSchema, type EvaluatorInput } from './protocol.js';
import { mandatoryChecks } from './verify.js';
import { evaluatorBuildHash } from './launcher.js';

async function evaluate(input: EvaluatorInput): Promise<VerificationReport> {
  const { jobId, artifact, profiles, manifest, fixtureSetId, fixtureSetVersion } = input;
  if (input.evaluatorBuildHash !== await evaluatorBuildHash()) throw new Error('Evaluator build mismatch');
  const { truth, snapshot, events, evidence } = await readProtectedFixture(fixtureSetId, fixtureSetVersion, manifest);
  if (truth.purpose !== 'construction') throw new Error('Verification fixture unavailable');

  const plan = buildCasePlan({ artifact, profiles, manifest }, truth, events, snapshot);
  const capturedRuns = new Map<string, CapturedEvidenceRun>();
  const { checks: financialChecks, eventKinds, difference } = await runCasePlan(artifact, plan,
    evidence ? run => { capturedRuns.set(run.profileHash, run); } : undefined);
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

try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input = EvaluatorInputSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
  );
  process.stdout.write(JSON.stringify(await evaluate(input)) + '\n');
} catch {
  process.exitCode = 1;
}
