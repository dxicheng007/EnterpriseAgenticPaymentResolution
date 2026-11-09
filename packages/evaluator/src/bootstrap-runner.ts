import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { HashSchema, IdSchema, hashBytes, hashCanonical, strict, type BootstrapPinV1 } from '@eapr/contracts';
import {
  BootstrapEvaluatorCompletionV1Schema, BootstrapEvaluatorInputV1Schema,
  BootstrapSubjectInputV1Schema, BootstrapSubjectOutputV1Schema, bootstrapMessageLimit,
  type BootstrapEvaluatorInputV1, type BootstrapSubjectInputV1,
} from './bootstrap-protocol.js';
import { exchange } from './transport.js';

export const BootstrapRootsSchema = strict({
  sidecarRoot: z.string().min(1), evidencePinRoot: z.string().min(1), servedRoots: z.string().min(1).array(),
});

export const BootstrapLaunchContextV1Schema = strict({
  protocolVersion: z.literal('bootstrap-launch-context-1'),
  requestHash: HashSchema,
  registration: strict({
    artifactHash: HashSchema, manifestHash: HashSchema, snapshotId: IdSchema, snapshotObjectHash: HashSchema,
  }),
  roots: BootstrapRootsSchema,
});

type BootstrapLaunchContextV1 = z.infer<typeof BootstrapLaunchContextV1Schema>;
const evaluator = new URL('./bootstrap-evaluator-runner.ts', import.meta.url);
const subject = new URL('./bootstrap-subject-runner.ts', import.meta.url);

const checkout = new URL('../../../', import.meta.url);
const cwd = fileURLToPath(checkout);
const subjectLimits = { maxBytes: bootstrapMessageLimit, timeoutMs: 5_000 };
const evaluatorLimits = { maxBytes: bootstrapMessageLimit, timeoutMs: 120_000 };

/** @internal Fixed production callers supply the entrypoint and cap. Scripted tests lower the cap. */
export function exchangeBootstrapSubject(entrypoint: URL, input: BootstrapSubjectInputV1, limits = subjectLimits) {
  return exchange(entrypoint, input, BootstrapSubjectInputV1Schema, BootstrapSubjectOutputV1Schema, limits,
    'message', (request, response) => request.requestId === response.requestId, { cwd });
}

export function runBootstrapSubject(input: BootstrapSubjectInputV1) {
  return exchangeBootstrapSubject(subject, input);
}

/** @internal The private pipe is only used by the fixed evaluator and scripted tests. */
export function exchangeBootstrapEvaluator(
  entrypoint: URL, input: BootstrapEvaluatorInputV1, launchContext: Buffer | undefined, limits = evaluatorLimits,
) {
  return exchange(entrypoint, input, BootstrapEvaluatorInputV1Schema, BootstrapEvaluatorCompletionV1Schema, limits,
    'report-line', (request, response) => request.jobId === response.jobId && request.jobId === response.result.jobId &&
      hashCanonical(request) === response.requestHash, { cwd, launchContext });
}

export function runBootstrapEvaluator(input: BootstrapEvaluatorInputV1, context: BootstrapLaunchContextV1) {
  return exchangeBootstrapEvaluator(evaluator, input, Buffer.from(JSON.stringify(context) + '\n'));
}

const shared = [
  'package.json', 'package-lock.json', 'tsconfig.json',
  'packages/contracts/package.json', 'packages/evaluator/package.json',
  ...[
    'activity', 'bootstrap-verification-hash', 'bootstrap-verification', 'canonical', 'common', 'connector',
    'discovery-helpers', 'discovery', 'evidence', 'index', 'local-demo', 'model', 'review', 'runtime',
    'source-coverage', 'source',
  ].map(name => 'packages/contracts/src/' + name + '.ts'),
];
const subjectSources = [
  ...shared,
  'packages/evaluator/src/bootstrap-protocol.ts', 'packages/evaluator/src/bootstrap-subject-runner.ts',
  'packages/evaluator/src/bootstrap-runner.ts',
  'packages/compiler/package.json', 'packages/parent/package.json', 'packages/finance/package.json',
  'packages/compiler/src/canonicalize.ts', 'packages/compiler/src/compile.ts', 'packages/compiler/src/operations.ts',
  'packages/compiler/src/plan-batch.ts', 'packages/compiler/src/plan-bootstrap.ts',
  'packages/parent/src/bootstrap.ts', 'packages/parent/src/state.ts',
  'packages/finance/src/allocations.ts', 'packages/finance/src/balance.ts',
  'packages/finance/src/reversals.ts', 'packages/finance/src/validate.ts',
];
const evaluatorSources = [
  ...subjectSources,
  'packages/evidence/package.json', 'packages/sources/package.json',
  ...[
    'bootstrap-launcher', 'bootstrap-evaluator-runner', 'bootstrap-comparison', 'bootstrap-verify',
    'bootstrap-fixtures', 'bootstrap-reference', 'bootstrap-cases', 'runner', 'transport', 'protocol',
    'fixture-store', 'evidence-fixtures', 'fixtures', 'reference-model',
  ].map(name => 'packages/evaluator/src/' + name + '.ts'),
  'packages/evidence/src/extract.ts', 'packages/evidence/src/index.ts', 'packages/evidence/src/locate.ts',
  'packages/evidence/src/search.ts', 'packages/evidence/src/store.ts',
  'packages/sources/src/company-a.ts', 'packages/sources/src/company-b.ts', 'packages/sources/src/records.ts',
  'packages/sources/src/errors.ts',
];

export const bootstrapBuildSources = Object.freeze({
  evaluator: Object.freeze(evaluatorSources), subject: Object.freeze(subjectSources),
});

/** @internal Root override is for manifest verification against isolated test copies only. */
async function digestBootstrapBuild(root: URL, names: readonly string[]) {
  if (new Set(names).size !== names.length) throw new Error('BUILD_MISMATCH');
  return hashCanonical(await Promise.all([...names].sort().map(async name => ({
    name, hash: hashBytes(await readFile(new URL(name, root))),
  }))));
}

export async function readBootstrapBuildPins(root = checkout) {
  try {
    const [evaluatorBuildHash, subjectBuildHash] = await Promise.all([
      digestBootstrapBuild(root, evaluatorSources), digestBootstrapBuild(root, subjectSources),
    ]);
    return { evaluatorBuildHash, subjectBuildHash };
  } catch {
    throw new Error('BUILD_MISMATCH');
  }
}

export async function requireBootstrapBuildPins(pin: BootstrapPinV1) {
  const builds = await readBootstrapBuildPins();
  if (pin.evaluatorBuildHash !== builds.evaluatorBuildHash || pin.subjectBuildHash !== builds.subjectBuildHash) {
    throw new Error('BUILD_MISMATCH');
  }
}
