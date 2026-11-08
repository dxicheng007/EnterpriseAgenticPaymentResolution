import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashBytes, hashCanonical } from '@eapr/contracts';
import { expect, test } from 'vitest';
import { decodeTruth } from '../../packages/evaluator/src/fixtures.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { localDemoRecipe } from '../../scripts/load-demo.js';
import { browserVerificationFixtures } from '../e2e/support/verification-fixtures.js';

test.each(['success', 'collision', 'partial'] as const)('isolates browser pins on %s', async scenario => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-c3-pin-test-'));
  try {
    const originalTruthRoot = join(root, 'original');
    await generateFixtures({ ...localDemoRecipe, visibleRoot: join(root, 'visible'), truthRoot: originalTruthRoot });
    const protectedRoot = pathToFileURL(join(root, 'pins') + '/');
    await mkdir(protectedRoot, { mode: 0o700 });
    const nonce = '8c0a9409-79c3-4fa7-bc86-ed4106651fc1';
    const fixtureId = (company: string) => 'browser-fixture:' + nonce + ':' + company;
    const pinPath = (id: string) => new URL(hashCanonical([id, '1']) + '.json', protectedRoot);
    const sentinel = pinPath('c3-preexisting-sentinel');
    const firstPath = pinPath(fixtureId('a'));
    const secondPath = pinPath(fixtureId('b'));
    await writeFile(sentinel, 'preexisting sentinel', { mode: 0o400, flag: 'wx' });
    if (scenario === 'collision') await writeFile(secondPath, 'preexisting pin', { mode: 0o400, flag: 'wx' });

    const inventory = async (dir: URL) => Promise.all((await readdir(dir)).sort().map(async filename => {
      const path = new URL(filename, dir);
      return [filename, hashBytes(await readFile(path)), (await stat(path)).mode];
    }));
    const originalDir = pathToFileURL(originalTruthRoot + '/');
    const originalBefore = await inventory(originalDir);
    const pinsBefore = await inventory(protectedRoot);
    const bindings = await Promise.all(['a', 'b'].map(async company => {
      const truth = decodeTruth(await readFile(new URL('expected-' + company + '.json', originalDir), 'utf8'));
      const { companyId, sourceRef, manifestId, manifestHash } = truth;
      return { companyId, sourceRef, manifestId, manifestHash, snapshotHash: hashCanonical(company) };
    }));
    const fixtures = browserVerificationFixtures({ root, originalTruthRoot, protectedRoot, nonce });
    let called = false;
    const prepared = fixtures.prepare(bindings, async truthRoot => {
      called = true;
      expect(await readdir(truthRoot)).toEqual(['expected-a.json', 'expected-b.json']);
      await writeFile(firstPath, 'first prepared pin', { mode: 0o400, flag: 'wx' });
      if (scenario === 'partial') throw new Error('Simulated partial prepare');
      await writeFile(secondPath, 'second prepared pin', { mode: 0o400, flag: 'wx' });
      return bindings.map((binding, index) => ({
        ...binding, fixtureSetId: fixtureId(index === 0 ? 'a' : 'b'), fixtureSetVersion: '1', purpose: 'construction',
      }));
    });

    if (scenario === 'success') {
      expect((await prepared).length).toBe(2);
      expect((await inventory(protectedRoot)).length).toBe(3);
    } else {
      await expect(prepared).rejects.toThrow(scenario === 'collision'
        ? 'Browser fixture pin path already exists' : 'Simulated partial prepare');
    }
    expect(called).toBe(scenario !== 'collision');
    const expectedAfter = scenario === 'partial' ? await inventory(protectedRoot) : pinsBefore;
    if (scenario === 'partial') expect(expectedAfter.length).toBe(pinsBefore.length + 1);
    await fixtures.close();
    const after = await inventory(protectedRoot);
    expect(JSON.stringify(after) === JSON.stringify(expectedAfter)).toBe(true);
    expect(pinsBefore.every(row => after.some(entry => JSON.stringify(entry) === JSON.stringify(row)))).toBe(true);
    expect(JSON.stringify(await inventory(originalDir)) === JSON.stringify(originalBefore)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
