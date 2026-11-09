import { readFile } from 'node:fs/promises';
import { hashBytes, hashCanonical } from '@eapr/contracts';
import type { VerificationLauncher } from './jobs.js';
import { runEvaluator } from './runner.js';

const buildFiles = [
  './capture-boundary.ts', './case-recipes.ts', './cases.ts', './evaluator-runner.ts', './evidence-fixtures.ts', './evidence-support.ts', './fixture-store.ts', './fixtures.ts', './jobs.ts', './launcher.ts', './protocol.ts',
  './reference-model.ts', './registry.ts', './runner.ts', './subject-comparison.ts', './subject-runner.ts', './transport.ts', './verify.ts',
  '../../evidence/src/extract.ts', '../../evidence/src/index.ts', '../../evidence/src/locate.ts',
  '../../evidence/src/search.ts', '../../evidence/src/store.ts',
  '../../sources/src/company-a.ts', '../../sources/src/company-b.ts', '../../sources/src/errors.ts', '../../sources/src/records.ts',
  '../../../package-lock.json',
];

export async function evaluatorBuildHash(): Promise<string> {
  return hashCanonical(await Promise.all(buildFiles.map(async name => ({
    name, hash: hashBytes(await readFile(new URL(name, import.meta.url))),
  }))));
}

type FixtureSelector = (candidate: Parameters<VerificationLauncher['resolve']>[0]) => Promise<
  Omit<Awaited<ReturnType<VerificationLauncher['resolve']>>, 'evaluatorBuildHash'>
>;

/** The trusted selector supplies pinned construction metadata only. This launcher has no truth reader. */
export function createProtectedVerificationLauncher(select: FixtureSelector): VerificationLauncher {
  return {
    async resolve(candidate) {
      const pin = await select(candidate);
      return { ...pin, evaluatorBuildHash: await evaluatorBuildHash() };
    },
    async launch(jobId, { artifact, profiles, manifest }, pin) {
      const output = await runEvaluator(new URL('./evaluator-runner.ts', import.meta.url), {
        protocolVersion: 1, jobId, artifact, profiles, manifest,
        fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, evaluatorBuildHash: pin.evaluatorBuildHash,
      });
      if (!output.ok) throw new Error('Protected evaluator failed');
      return output.value;
    },
  };
}
