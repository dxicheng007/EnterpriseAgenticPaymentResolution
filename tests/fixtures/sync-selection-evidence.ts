import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { hashBytes, hashCanonical } from '@eapr/contracts';
import { BootstrapEvaluatorInputV1Schema } from '../../packages/evaluator/src/bootstrap-protocol.js';
import type { runBootstrapEvaluator } from '../../packages/evaluator/src/bootstrap-runner.js';
import { FinancialRequestSchema } from '../../packages/evaluator/src/financial-attestation-protocol.js';
import type { runFinancialEvaluator } from '../../packages/evaluator/src/financial-attestation-runner.js';

export type InventoryEntry = { path: string; sha256: string; bytes: number } | { path: string; absent: true };

export async function statIfPresent(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function inventory(path: string, label: string): Promise<InventoryEntry[]> {
  const stats = await statIfPresent(path);
  if (!stats) return [{ path: label, absent: true }];
  if (stats.isDirectory()) return (await Promise.all((await readdir(path)).sort()
    .map(name => inventory(join(path, name), label + '/' + name)))).flat();
  if (!stats.isFile()) throw new Error('Unexpected file type in inventory ' + label);
  const bytes = await readFile(path);
  return [{ path: label, sha256: hashBytes(bytes), bytes: bytes.length }];
}

export async function resolveEvidenceDirectory(root: string, task: 2 | 3) {
  const evidenceParent = join(root, '.superpowers/sdd/2026-11-10-sync-selection-variants/evidence', 'task-' + task);
  const configured = process.env.EAPR_SELECTION_FIXTURE_EVIDENCE_DIR;
  const path = configured && resolve(configured);
  if (configured && (!isAbsolute(configured) || dirname(path!) !== evidenceParent || !basename(path!).startsWith('run-'))) {
    throw new Error('Expected a Task ' + task + ' evidence run directory');
  }
  let directory = resolve(root);
  for (const segment of relative(root, evidenceParent).split('/')) {
    directory = join(directory, segment);
    const info = await statIfPresent(directory);
    if (!info) await mkdir(directory, { mode: 0o700 });
    else if (!info.isDirectory()) throw new Error('Unexpected evidence directory type');
  }
  if (await realpath(evidenceParent) !== evidenceParent) throw new Error('Unexpected evidence directory symlink');
  if (!path) return mkdtemp(join(evidenceParent, 'run-'));
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (await realpath(path) !== path || relative(evidenceParent, path) !== basename(path)) {
    throw new Error('Unexpected evidence run directory symlink');
  }
  return path;
}

export async function originalsAt(root: string) {
  return (await Promise.all(['visible', 'truth'].map(label => inventory(join(root, label), label))))
    .flat().sort((a, b) => a.path.localeCompare(b.path));
}
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
async function pinLength(root: string, pin: { fixtureSetId: string; fixtureSetVersion: string }) {
  const stats = await lstat(join(root, hashCanonical([pin.fixtureSetId, pin.fixtureSetVersion]) + '.json'));
  if (!stats.isFile()) throw new Error('Unexpected pin file type');
  return stats.size;
}

export type Measurement = {
  stage: 'financial-probe' | 'financial-launch' | 'bootstrap';
  jobId: string; manifestHash: string; requestHash: string;
  requestJsonBytes: number; framedRequestBytes: number; framedContextBytes: number;
  returnedResponseObjectJsonBytes: number | null; elapsedMs: number; status: string;
  evidencePinBytes?: number; sidecarBytes?: number;
};

export async function measureFinancialOuter(run: typeof runFinancialEvaluator, ...[request, context]: Parameters<typeof runFinancialEvaluator>) {
  const requestJsonBytes = jsonBytes(FinancialRequestSchema.parse(request));
  const start = performance.now();
  const result = await run(request, context);
  const elapsedMs = performance.now() - start;
  const measurement: Measurement = {
    stage: request.protocolVersion === 'financial-attestation-probe-1' ? 'financial-probe' : 'financial-launch',
    jobId: request.jobId, manifestHash: request.capture.manifest.hash, requestHash: context.requestHash,
    requestJsonBytes, framedRequestBytes: requestJsonBytes + 1, framedContextBytes: jsonBytes(context) + 1,
    returnedResponseObjectJsonBytes: result.ok ? jsonBytes(result.value) : null,
    elapsedMs, status: result.ok ? 'ok' : result.code,
    evidencePinBytes: result.ok ? await pinLength(context.roots.evidencePinRoot, result.value.evidencePin) : undefined,
  };
  return { result, measurement };
}

export async function measureBootstrapOuter(run: typeof runBootstrapEvaluator, ...[request, context]: Parameters<typeof runBootstrapEvaluator>) {
  const requestJsonBytes = jsonBytes(BootstrapEvaluatorInputV1Schema.parse(request));
  const start = performance.now();
  const result = await run(request, context);
  const elapsedMs = performance.now() - start;
  const measurement: Measurement = {
    stage: 'bootstrap', jobId: request.jobId, manifestHash: request.manifest.hash, requestHash: context.requestHash,
    requestJsonBytes, framedRequestBytes: requestJsonBytes + 1, framedContextBytes: jsonBytes(context) + 1,
    returnedResponseObjectJsonBytes: result.ok ? jsonBytes(result.value) : null,
    elapsedMs, status: result.ok ? 'ok' : result.code,
    sidecarBytes: await pinLength(context.roots.sidecarRoot, request.pin),
  };
  return { result, measurement };
}

export function writePrivateEvidence(path: string, data: unknown) {
  return writeFile(path, JSON.stringify({ version: 1, data }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
