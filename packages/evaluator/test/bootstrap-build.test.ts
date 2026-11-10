import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, vi } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import {
  bootstrapRequiredAssertions, bootstrapRequiredCases, hashBootstrapVerificationResult, hashCanonical,
  type BootstrapVerificationResultV1,
} from '@eapr/contracts';
import { baselineEventsA, baselineManifestA, emptyTargetA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { bootstrapBuildSources, readBootstrapBuildPins } from '../src/bootstrap-runner.js';
import { createProtectedBootstrapLauncher } from '../src/bootstrap-launcher.js';
import { BootstrapEvaluatorInputV1Schema } from '../src/bootstrap-protocol.js';
import { deriveBootstrapBinding } from '../src/bootstrap-verify.js';

const runtime = vi.hoisted(() => ({
  copiedSource: undefined as string | undefined,
  child: vi.fn(),
}));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    readFile: (name: string | URL) => fs.readFile(
      name instanceof URL && name.pathname.endsWith('/packages/evaluator/src/transport.ts') && runtime.copiedSource
        ? runtime.copiedSource : name,
    ),
  };
});
vi.mock('../src/bootstrap-runner.js', async importOriginal => {
  const runner = await importOriginal<typeof import('../src/bootstrap-runner.js')>();
  return { ...runner, runBootstrapEvaluator: runtime.child };
});

const checkout = fileURLToPath(new URL('../../../', import.meta.url));
const families = [
  ['packages/evaluator/src/bootstrap-comparison.ts', false],
  ['packages/evaluator/src/bootstrap-reference.ts', false],
  ['packages/compiler/src/plan-bootstrap.ts', true],
  ['packages/parent/src/bootstrap.ts', true],
  ['packages/finance/src/balance.ts', true],
  ['packages/contracts/src/canonical.ts', true],
  ['packages/contracts/src/sync-capture.ts', true],
  ['packages/contracts/src/discovery-tools.ts', true],
  ['packages/contracts/src/activation-authority.ts', true],
  ['packages/contracts/src/activation-authority-hash.ts', true],
  ['packages/contracts/src/activation-bundle-v2.ts', true],
  ['packages/sources/src/company-b.ts', false],
  ['packages/evidence/src/extract.ts', false],
  ['packages/evaluator/src/transport.ts', false],
  ['packages/evaluator/src/bootstrap-runner.ts', true],
  ['package-lock.json', true],
  ['tsconfig.json', true],
] as const;

test('hashes actual source bytes from every owned family', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'eapr-bootstrap-build-'));
  const root = pathToFileURL(temporary + '/');
  try {
    await Promise.all(bootstrapBuildSources.evaluator.map(async name => {
      const destination = join(temporary, name);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(join(checkout, name)));
    }));
    const baseline = await readBootstrapBuildPins(root);
    expect(baseline).toEqual(await readBootstrapBuildPins());
    for (const [name, shared] of families) {
      const path = join(temporary, name);
      const original = await readFile(path);
      await appendFile(path, '\n');
      const updated = await readBootstrapBuildPins(root);
      expect(updated.evaluatorBuildHash === baseline.evaluatorBuildHash, name).toBe(false);
      expect(updated.subjectBuildHash === baseline.subjectBuildHash, name).toBe(!shared);
      await writeFile(path, original);
    }
    await rm(join(temporary, 'package-lock.json'));
    await expect(readBootstrapBuildPins(root)).rejects.toThrow('BUILD_MISMATCH');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('pins the recursive runtime import graph of each bootstrap entrypoint', async () => {
  const require = createRequire(import.meta.url);
  const subjectEntrypoints = ['packages/evaluator/src/bootstrap-subject-runner.ts'];
  const evaluatorEntrypoints = [
    ...subjectEntrypoints,
    'packages/evaluator/src/bootstrap-launcher.ts', 'packages/evaluator/src/bootstrap-evaluator-runner.ts',
    'packages/evaluator/src/runner.ts',
  ];
  for (const [entrypoints, manifest] of [
    [subjectEntrypoints, bootstrapBuildSources.subject],
    [evaluatorEntrypoints, bootstrapBuildSources.evaluator],
  ] as const) {
    const paths = new Set(entrypoints);
    for (const name of paths) {
      const source = await readFile(join(checkout, name)).then(bytes => bytes.toString());
      const imports = new Set([
        ...source.matchAll(/^(?:import|export) (?!type\b)(?:[^'";]+?\bfrom\s*)?['"]([^'"]+)['"]/gm),
        ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map(match => match[1]!));
      for (const specifier of imports) {
        if (specifier.startsWith('.')) paths.add(join(dirname(name), specifier.replace(/\.js$/, '.ts')));
        else if (specifier.startsWith('@eapr/')) {
          paths.add(relative(checkout, require.resolve(specifier)));
          expect(manifest).toContain('packages/' + specifier.split('/')[1] + '/package.json');
        }
      }
    }
    expect([...paths].filter(name => !manifest.includes(name))).toEqual([]);
  }
});

test('discards a completion when the executing closure changes during the exchange', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'eapr-bootstrap-race-'));
  try {
    const copiedSource = join(temporary, 'transport.ts');
    const original = await readFile(join(checkout, 'packages/evaluator/src/transport.ts'));
    await writeFile(copiedSource, original);
    runtime.copiedSource = copiedSource;
    const builds = await readBootstrapBuildPins();
    const compiled = compile(validSpecA, [profileA]);
    if (!compiled.ok) throw new Error('Public test input unavailable');
    const { value: artifact } = compiled;
    const fixtureHash = hashCanonical('public-fixture');
    const request = BootstrapEvaluatorInputV1Schema.parse({
      protocolVersion: 'bootstrap-1', jobId: 'build-race', artifact, profiles: [profileA],
      selectedProfileHash: profileA.hash, manifest: baselineManifestA, events: baselineEventsA,
      snapshot: {
        id: 'snapshot:' + baselineManifestA.id, manifestId: baselineManifestA.id, sourceRef: baselineManifestA.sourceRef,
        capturedAt: baselineManifestA.asOf, contentHash: fixtureHash, evidenceIds: [], eventIds: baselineEventsA.map(event => event.id),
      },
      target: { ...emptyTargetA, asOf: baselineManifestA.asOf },
      pin: { ...builds, runnerId: 'eapr-bootstrap-1', protocolVersion: '1', fixtureSetId: 'public-fixture',
        fixtureSetVersion: '1', fixtureHash },
    });
    const result: Omit<BootstrapVerificationResultV1, 'hash'> = {
      schemaVersion: '1', id: 'bootstrap-result:' + request.jobId, jobId: request.jobId, pin: request.pin,
      binding: deriveBootstrapBinding(request), planHash: null, passed: false, createdAt: request.manifest.asOf,
      assertions: bootstrapRequiredAssertions.map(id => ({ id, status: 'unavailable', caseIds: [] })),
      cases: bootstrapRequiredCases.map(id => ({ id, status: 'unavailable' })),
    };
    const completion = {
      protocolVersion: 'bootstrap-completion-1', jobId: request.jobId, requestHash: hashCanonical(request),
      result: { ...result, hash: hashBootstrapVerificationResult(result) },
      observedBaselinePlan: null, observedBaselinePlanBytesHash: null,
    };
    const launcher = createProtectedBootstrapLauncher({
      // Unit seam only. The real registration path is covered by bootstrap-runner.test.ts under the integration project.
      registry: { getCandidate: async () => request },
      roots: { sidecarRoot: 'test', evidencePinRoot: 'test', servedRoots: [] }, pin: request.pin,
    });
    runtime.child.mockResolvedValueOnce({ ok: true, value: completion });
    await expect(launcher.launch(request)).resolves.toEqual(completion);
    runtime.child.mockImplementationOnce(async () => {
      await appendFile(copiedSource, '\n');
      return { ok: true, value: completion };
    });
    await expect(launcher.launch(request)).rejects.toThrow('BUILD_MISMATCH');
    expect(runtime.child).toHaveBeenCalledTimes(2);
    await expect(launcher.launch(request)).rejects.toThrow('BUILD_MISMATCH');
    expect(runtime.child).toHaveBeenCalledTimes(2);
  } finally {
    runtime.copiedSource = undefined;
    await rm(temporary, { recursive: true, force: true });
  }
});
