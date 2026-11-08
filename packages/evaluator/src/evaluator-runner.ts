import {
  VerificationReportSchema,
  type VerificationReport,
} from '@eapr/contracts';
import { buildCasePlan, runCasePlan } from './cases.js';
import { readProtectedFixture } from './fixture-store.js';
import { EvaluatorInputSchema, type EvaluatorInput } from './protocol.js';
import { mandatoryChecks } from './verify.js';
import { evaluatorBuildHash } from './launcher.js';

async function evaluate(input: EvaluatorInput): Promise<VerificationReport> {
  const { jobId, artifact, profiles, manifest, fixtureSetId, fixtureSetVersion } = input;
  if (input.evaluatorBuildHash !== await evaluatorBuildHash()) throw new Error('Evaluator build mismatch');
  const { truth, snapshot, events } = await readProtectedFixture(fixtureSetId, fixtureSetVersion, manifest);
  if (truth.purpose !== 'construction') throw new Error('Verification fixture unavailable');

  const plan = buildCasePlan({ artifact, profiles, manifest }, truth, events, snapshot);
  const { checks, eventKinds, difference } = await runCasePlan(artifact, plan);
  return VerificationReportSchema.parse({
    id: 'report:' + jobId, artifactHash: artifact.hash, profileHashes: profiles.map(profile => profile.hash),
    manifestHash: manifest.hash, harnessVersion: '1', evaluatorBuildHash: input.evaluatorBuildHash,
    fixtureSetId, fixtureSetVersion, checks,
    coverage: {
      required: [...mandatoryChecks], executed: checks.filter(check => check.status !== 'unavailable').map(check => check.id),
      sourceRefs: [artifact.sourceRef], profileHashes: profiles.map(profile => profile.hash), eventKinds,
    },
    unexplainedDifferenceCents: difference, eligible: false, createdAt: new Date().toISOString(),
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
