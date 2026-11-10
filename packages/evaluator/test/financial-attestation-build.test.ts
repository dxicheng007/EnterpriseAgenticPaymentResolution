import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { financialBuildSources, readFinancialBuildHash } from '../src/financial-attestation-build.js';

const checkout = new URL('../../../', import.meta.url);
const sources = new Set(financialBuildSources);
const constructionTools = 'packages/contracts/src/discovery-construction-tools.ts';
const read = (name: string) => readFile(new URL(name, checkout), 'utf8');

test('every local import of every pinned source is pinned, including package export targets', async () => {
  expect(sources.size).toBe(financialBuildSources.length);
  for (const file of financialBuildSources.filter(name => name.endsWith('.ts'))) {
    const localImports = (await read(file)).matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"]((?:\.|@eapr\/)[^'"]+)['"]/g);
    for (const [, path] of localImports) {
      if (path!.startsWith('.')) {
        const dependency = new URL(path!, new URL(file, checkout)).href.slice(checkout.href.length).replace(/\.js$/, '.ts');
        expect(sources.has(dependency), file + ' → ' + dependency).toBe(true);
      } else {
        const [, pkg, subpath] = /^@eapr\/([^/]+)(?:\/(.*))?$/.exec(path!)!;
        const manifest = 'packages/' + pkg + '/package.json';
        expect(sources.has(manifest), file + ' → ' + manifest).toBe(true);
        const { exports } = JSON.parse(await read(manifest));
        const target: string = typeof exports === 'string' ? exports : exports[subpath ? './' + subpath : '.'];
        expect(sources.has(new URL(target, new URL(manifest, checkout)).href.slice(checkout.href.length)), file + ' → ' + path).toBe(true);
      }
    }
  }
});

async function withBuildCopy(check: (root: URL) => Promise<void>) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'financial-build-'));
  try {
    const root = pathToFileURL(directory + '/');
    await Promise.all([...new Set([...financialBuildSources, constructionTools])].map(async name => {
      const target = new URL(name, root);
      await mkdir(new URL('.', target), { recursive: true });
      await writeFile(target, await readFile(new URL(name, checkout)));
    }));
    await check(root);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('compiler, finance, contracts, evaluator and lock mutations each change the financial build pin', async () => {
  expect(financialBuildSources).toContain('packages/compiler/src/plan-batch.ts');
  await withBuildCopy(async root => {
    const original = await readFinancialBuildHash();
    expect(await readFinancialBuildHash(root)).toBe(original);
    for (const name of [
      'packages/compiler/src/plan-batch.ts', 'packages/finance/src/validate.ts',
      'packages/contracts/src/sync-capture.ts',
      'packages/contracts/src/current-authority.ts',
      'packages/contracts/src/connection-state.ts',
      constructionTools,
      'packages/contracts/src/activation-authority.ts', 'packages/evaluator/src/financial-evaluate.ts',
      'packages/evaluator/src/financial-attestation-evaluator.ts', 'package-lock.json',
      'packages/evaluator/src/discovery-verification.ts', 'packages/evaluator/src/financial-attestation-jobs.ts', 'packages/evaluator/src/financial-attestation-registry.ts',
    ]) {
      const target = new URL(name, root);
      const bytes = await readFile(target);
      await writeFile(target, Buffer.concat([bytes, Buffer.from('\n')]));
      expect(await readFinancialBuildHash(root), name).not.toBe(original);
      await writeFile(target, bytes);
    }
    await rm(new URL('packages/contracts/src/connection-state.ts', root));
    await expect(readFinancialBuildHash(root)).rejects.toThrow('FINANCIAL_ATTESTATION_UNAVAILABLE');
  });
});

test('rejects the financial build hash when the construction tool leaf is missing', async () => {
  await withBuildCopy(async root => {
    expect(await readFinancialBuildHash(root)).toBe(await readFinancialBuildHash());
    await rm(new URL(constructionTools, root));
    await expect(readFinancialBuildHash(root)).rejects.toThrow('FINANCIAL_ATTESTATION_UNAVAILABLE');
  });
});
