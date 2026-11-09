import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CandidateRegistration } from '@eapr/compiler/preview-adapters';
import { createFinancialAttestationJobs } from '@eapr/evaluator/financial-attestation-jobs';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import type { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createFinancialCaptureReader, type FinancialSourceDependencies } from './financial-capture.js';

export type FinancialVerificationRoots = Parameters<typeof createProtectedFinancialLauncher>[0]['roots'];

function contains(root: string, path: string) {
  const child = relative(root, path);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep));
}

export async function composeFinancialVerification(
  sources: FinancialSourceDependencies,
  registry: ReturnType<typeof createCandidateRegistry>,
  roots: FinancialVerificationRoots,
  select: (candidate: CandidateRegistration) => Promise<{
    fixtureSetId: string; fixtureSetVersion: string; purpose: 'construction'; snapshotHash: string;
  }>,
) {
  const evidencePinRoot = resolve(roots.evidencePinRoot);
  const directory = await lstat(evidencePinRoot);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() ||
    (directory.mode & 0o777) !== 0o700 || await realpath(evidencePinRoot) !== evidencePinRoot) {
    throw new Error('Protected verification root is unavailable');
  }
  const servedRoots = await Promise.all(roots.servedRoots.map(path => realpath(resolve(path))));
  if (servedRoots.some(path => contains(path, evidencePinRoot) || contains(evidencePinRoot, path))) {
    throw new Error('Protected verification root conflicts with visible storage');
  }
  return createFinancialAttestationJobs({
    db: sources.dependencies.db,
    candidates: registry,
    captures: createFinancialCaptureReader({ ...sources, registry }),
    launcher: createProtectedFinancialLauncher({ registry, roots: { evidencePinRoot, servedRoots } }),
    async selectFixture(candidate) {
      const selection = await select(candidate);
      if (selection.fixtureSetVersion !== '2') throw new Error('FINANCIAL_ATTESTATION_MISMATCH');
      return { ...selection, fixtureSetVersion: '2' };
    },
    readBuildHash: readFixedFinancialBuildHash,
  });
}
