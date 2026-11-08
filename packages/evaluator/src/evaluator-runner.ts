import {
  VerificationReportSchema,
  type FinancialKind, type VerificationCheck, type VerificationReport,
} from '@eapr/contracts';
import { bindTruth } from './fixtures.js';
import { readProtectedFixture } from './fixture-store.js';
import { EvaluatorInputSchema, type EvaluatorInput } from './protocol.js';
import { addReferenceCents } from './reference-model.js';
import { compareSubjectBaseline, mandatoryChecks } from './verify.js';
import { evaluatorBuildHash } from './launcher.js';

async function evaluate(input: EvaluatorInput): Promise<VerificationReport> {
  const { jobId, artifact, profiles, manifest, fixtureSetId, fixtureSetVersion } = input;
  if (input.evaluatorBuildHash !== await evaluatorBuildHash()) throw new Error('Evaluator build mismatch');
  const { truth, events } = await readProtectedFixture(fixtureSetId, fixtureSetVersion, manifest);
  if (truth.purpose !== 'construction') throw new Error('Verification fixture unavailable');

  const bound = bindTruth(truth, profiles);
  let difference = 0;
  let reconciled = true;
  let cases = 0;
  const eventKinds = new Set<FinancialKind>();
  for (const { profile, target, reference } of bound) {
    const batch = events.filter(event => event.rawIdentity.sellerEntityId === profile.scope.sellerEntityId &&
      event.rawIdentity.sourceAccountId && profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId));
    if (!reference.records.length) continue;
    const comparison = await compareSubjectBaseline(artifact, profile, batch, {
      ...target, invoices: [], payments: [], credits: [], allocations: [], reversals: [],
    }, reference);
    reconciled &&= comparison.matches;
    difference = addReferenceCents(difference, comparison.unexplainedDifferenceCents);
    for (const event of batch) {
      if (event.kind !== 'semantic_change' && artifact.normalizedPlan.allowedKinds.includes(event.kind)) eventKinds.add(event.kind);
    }
    cases++;
  }
  const checks: VerificationCheck[] = mandatoryChecks.map(id => ({
    id, cases: id === 'baseline_reconcile' ? cases : 0,
    status: id === 'baseline_reconcile' && cases > 0 ? (reconciled && cases === bound.length ? 'passed' : 'failed') : 'unavailable',
    diagnosticCodes: [],
  }));
  return VerificationReportSchema.parse({
    id: 'report:' + jobId, artifactHash: artifact.hash, profileHashes: profiles.map(profile => profile.hash),
    manifestHash: manifest.hash, harnessVersion: '1', evaluatorBuildHash: input.evaluatorBuildHash,
    fixtureSetId, fixtureSetVersion, checks,
    coverage: {
      required: [...mandatoryChecks], executed: checks.filter(check => check.status !== 'unavailable').map(check => check.id),
      sourceRefs: [artifact.sourceRef], profileHashes: profiles.map(profile => profile.hash), eventKinds: [...eventKinds].sort(),
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
