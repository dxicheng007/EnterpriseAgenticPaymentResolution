import { readFile } from 'node:fs/promises';
import { hashBytes, hashCanonical } from '@eapr/contracts';

const checkout = new URL('../../../', import.meta.url);
export const financialBuildSources = Object.freeze([
  'package.json', 'package-lock.json', 'tsconfig.json',
  ...['compiler', 'contracts', 'evaluator', 'evidence', 'finance', 'parent', 'sources', 'storage']
    .map(name => 'packages/' + name + '/package.json'),
  ...[
    'activation-authority', 'activation-authority-hash', 'activation-bundle-v2', 'current-authority', 'activity', 'bootstrap-verification',
    'bootstrap-verification-hash', 'canonical', 'common', 'connection-state', 'connector', 'discovery-helpers', 'discovery-tools',
    'discovery', 'evidence', 'index', 'local-demo', 'model', 'review-details', 'review', 'runtime', 'source-coverage', 'source', 'sync-capture',
  ].map(name => 'packages/contracts/src/' + name + '.ts'),
  ...[
    'financial-attestation-protocol', 'financial-attestation-runner', 'financial-attestation-evaluator',
    'discovery-verification', 'financial-attestation-jobs', 'financial-attestation-registry', 'financial-attestation-launcher', 'financial-attestation-verify', 'financial-attestation-build', 'financial-evaluate',
    'capture-boundary', 'cases', 'case-recipes', 'evidence-support', 'evidence-fixtures', 'fixture-store', 'fixtures',
    'reference-model', 'subject-comparison', 'subject-runner', 'runner', 'transport', 'protocol', 'verify',
    'launcher', 'evaluator-runner', 'jobs', 'registry',
  ].map(name => 'packages/evaluator/src/' + name + '.ts'),
  'packages/compiler/src/canonicalize.ts', 'packages/compiler/src/compile.ts', 'packages/compiler/src/operations.ts',
  'packages/compiler/src/plan-batch.ts', 'packages/compiler/src/preview-adapters.ts',
  'packages/storage/src/transaction.ts', 'packages/parent/src/state.ts',
  'packages/finance/src/allocations.ts', 'packages/finance/src/balance.ts',
  'packages/finance/src/reversals.ts', 'packages/finance/src/validate.ts',
  'packages/evidence/src/extract.ts', 'packages/evidence/src/index.ts', 'packages/evidence/src/locate.ts',
  'packages/evidence/src/search.ts', 'packages/evidence/src/store.ts',
  'packages/sources/src/company-a.ts', 'packages/sources/src/company-b.ts', 'packages/sources/src/records.ts',
  'packages/sources/src/errors.ts',
]);

/** Root injection is private to this module and its source-closure tests. */
export async function readFinancialBuildHash(root = checkout) {
  try {
    if (new Set(financialBuildSources).size !== financialBuildSources.length) throw new Error();
    return hashCanonical(await Promise.all([...financialBuildSources].sort().map(async name => ({
      name, hash: hashBytes(await readFile(new URL(name, root))),
    }))));
  } catch {
    throw new Error('FINANCIAL_ATTESTATION_UNAVAILABLE');
  }
}
