import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson, hashBytes, hashCanonical } from '@eapr/contracts';
import { expect, test } from 'vitest';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { decodeTruth } from '../../packages/evaluator/src/fixtures.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { localDemoRecipe } from '../../scripts/load-demo.js';
import { browserVerificationFixtures } from '../e2e/support/verification-fixtures.js';

const companies = ['a', 'b'] as const;
const inputNames = ['evidence-a.json', 'evidence-b.json', 'expected-a.json', 'expected-b.json'];
const fixtureId = (nonce: string, company: string) => 'browser-fixture:' + nonce + ':' + company;
const seal = (value: object) => canonicalJson({ ...value, hash: hashCanonical(value) });

async function inventory(dir: string | URL) {
  const root = typeof dir === 'string' ? pathToFileURL(dir + '/') : dir;
  return canonicalJson(await Promise.all((await readdir(root)).sort().map(async filename => {
    const file = new URL(filename, root);
    return [filename, (await lstat(file)).mode, hashBytes(await readFile(file))];
  })));
}

async function setup() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-c3-v2-pin-test-'));
  try {
    const originalTruthRoot = join(root, 'original');
    const visibleRoot = join(root, 'visible');
    await generateFixtures({ ...localDemoRecipe, visibleRoot, truthRoot: originalTruthRoot });
    const protectedRoot = pathToFileURL(join(root, 'pins') + '/');
    await mkdir(protectedRoot, { mode: 0o700 });
    const pinPath = (id: string, version = '2') => new URL(hashCanonical([id, version]) + '.json', protectedRoot);
    const sentinel = pinPath('historical-pin', '1');
    await writeFile(sentinel, 'historical pin', { mode: 0o400, flag: 'wx' });
    const originalBefore = await inventory(originalTruthRoot);
    const truths = await Promise.all(companies.map(async company =>
      decodeTruth(await readFile(join(originalTruthRoot, 'expected-' + company + '.json'), 'utf8'))));
    const bindings = truths.map(({ companyId, sourceRef, manifestId, manifestHash }) =>
      ({ companyId, sourceRef, manifestId, manifestHash, snapshotHash: hashCanonical(companyId) }));
    const readProducer = async (root: string, company: string) =>
      decodeEvidenceProducer(await readFile(join(root, 'evidence-' + company + '.json'), 'utf8'));

    return {
      root, originalTruthRoot, protectedRoot, pinPath, sentinel, truths, bindings, readProducer, originalBefore,
      async run(nonce: string, mode?: 'evidence-v2', originalRoot = originalTruthRoot) {
        const runRoot = await mkdtemp(join(root, 'run-'));
        const version = mode === 'evidence-v2' ? '2' : '1';
        const pins = bindings.map((binding, i) => ({
          ...binding, fixtureSetId: fixtureId(nonce, companies[i]), fixtureSetVersion: version,
          purpose: 'construction' as const,
        }));
        const paths = pins.map(pin => pinPath(pin.fixtureSetId, version));
        return {
          fixtures: browserVerificationFixtures({ root: runRoot, originalTruthRoot: originalRoot, protectedRoot, nonce, mode }),
          paths,
          pins,
          async publish() {
            for (const path of paths) await writeFile(path, 'new pin', { mode: 0o400, flag: 'wx' });
            return pins;
          },
        };
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

test('v2_browser_copy_preserves_facts_and_rebinds_producer', async () => {
  const context = await setup();
  try {
    const { root, protectedRoot, originalTruthRoot, truths, bindings, readProducer, originalBefore } = context;
    const run = await context.run('coherent-pair', 'evidence-v2');
    const before = await inventory(protectedRoot);
    const prepared = await run.fixtures.prepare(bindings, async truthRoot => {
      expect((await readdir(truthRoot)).sort().join(',') === inputNames.join(',')).toBe(true);
      expect((await lstat(truthRoot)).mode & 0o777).toBe(0o700);
      for (const filename of inputNames) expect((await lstat(join(truthRoot, filename))).mode & 0o777).toBe(0o600);
      for (const [index, company] of companies.entries()) {
        const { hash: oldTruthHash, fixtureSetId: oldId, ...oldTruthFacts } = truths[index];
        const { hash: truthHash, fixtureSetId, ...truthFacts } = decodeTruth(
          await readFile(join(truthRoot, 'expected-' + company + '.json'), 'utf8'));
        const { hash: oldProducerHash, fixtureSetId: oldProducerId, producerTruthHash: oldProducerTruthHash,
          ...oldProducerFacts } = await readProducer(originalTruthRoot, company);
        const { hash: producerHash, fixtureSetId: producerId, producerTruthHash, ...producerFacts } =
          await readProducer(truthRoot, company);
        expect(fixtureSetId === fixtureId('coherent-pair', company) && fixtureSetId === producerId).toBe(true);
        expect(oldId === oldProducerId && oldTruthHash === oldProducerTruthHash).toBe(true);
        expect(producerTruthHash === truthHash && truthHash !== oldTruthHash && producerHash !== oldProducerHash).toBe(true);
        expect(truthFacts.fixtureSetVersion === '1' && producerFacts.producerFixtureSetVersion === '1').toBe(true);
        expect(canonicalJson(truthFacts) === canonicalJson(oldTruthFacts)).toBe(true);
        expect(canonicalJson(producerFacts) === canonicalJson(oldProducerFacts)).toBe(true);
      }
      return run.publish();
    });
    expect(canonicalJson(prepared) === canonicalJson(run.pins)).toBe(true);
    await run.fixtures.close();

    const stale = join(root, 'stale');
    await mkdir(stale, { mode: 0o700 });
    for (const name of inputNames) await writeFile(join(stale, name), await readFile(join(originalTruthRoot, name)), { mode: 0o600 });
    const { hash: _hash, ...truth } = truths[0];
    await writeFile(join(stale, 'expected-a.json'), seal({ ...truth, fixtureSetId: 'changed-truth-id' }));
    const rejected = await context.run('stale-pair', 'evidence-v2', stale);
    let called = false;
    await expect(rejected.fixtures.prepare(bindings, async () => {
      called = true;
      return rejected.publish();
    })).rejects.toThrow('Browser fixture evidence producer does not match truth');
    await rejected.fixtures.close();
    expect(called).toBe(false);
    expect(await inventory(protectedRoot) === before).toBe(true);
    expect(await inventory(originalTruthRoot) === originalBefore).toBe(true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('v2_browser_pin_collision_preserves_existing_files', async () => {
  const context = await setup();
  try {
    const run = await context.run('existing-second', 'evidence-v2');
    await writeFile(run.paths[1], 'preexisting second pin', { mode: 0o400, flag: 'wx' });
    const before = await inventory(context.protectedRoot);
    let called = false;
    await expect(run.fixtures.prepare(context.bindings, async () => {
      called = true;
      return run.publish();
    })).rejects.toThrow('Browser fixture pin path already exists');
    await run.fixtures.close();
    expect(called).toBe(false);
    expect(await inventory(context.protectedRoot) === before).toBe(true);
    expect(await inventory(context.originalTruthRoot) === context.originalBefore).toBe(true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('v2_browser_partial_publication_is_not_owned', async () => {
  const context = await setup();
  try {
    const run = await context.run('partial-second', 'evidence-v2');
    const historical = hashBytes(await readFile(context.sentinel));
    await expect(run.fixtures.prepare(context.bindings, async () => {
      await writeFile(run.paths[0], 'first partial pin', { mode: 0o400, flag: 'wx' });
      throw new Error('Simulated second publication failure');
    })).rejects.toThrow('Simulated second publication failure');
    const partial = await inventory(context.protectedRoot);
    await run.fixtures.close();
    expect((await readdir(context.protectedRoot)).length).toBe(2);
    expect(hashBytes(await readFile(context.sentinel)) === historical).toBe(true);
    expect(await inventory(context.protectedRoot) === partial).toBe(true);
    expect(await inventory(context.originalTruthRoot) === context.originalBefore).toBe(true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('v2_browser_cleanup_preserves_replaced_and_changed_pins', async () => {
  const context = await setup();
  try {
    const historical = await inventory(context.protectedRoot);
    for (const change of ['inode', 'bytes', 'mode', 'symlink']) {
      const run = await context.run('cleanup-' + change, 'evidence-v2');
      await run.fixtures.prepare(context.bindings, run.publish);
      const [changed, clean] = run.paths;
      const original = await lstat(changed);
      if (change === 'inode' || change === 'symlink') {
        const moved = join(context.root, 'moved-' + change);
        await rename(changed, moved);
        if (change === 'inode') await writeFile(changed, await readFile(moved), { mode: 0o400, flag: 'wx' });
        else await symlink(context.sentinel, changed);
      } else if (change === 'bytes') {
        await chmod(changed, 0o600);
        await writeFile(changed, 'changed bytes');
        await chmod(changed, 0o400);
      } else {
        await chmod(changed, 0o600);
      }
      const modified = await lstat(changed);
      expect((modified.ino === original.ino) === (change === 'bytes' || change === 'mode')).toBe(true);
      const contents = hashBytes(await readFile(changed));
      await run.fixtures.close();
      await expect(lstat(clean)).rejects.toMatchObject({ code: 'ENOENT' });
      const after = await lstat(changed);
      expect(after.ino === modified.ino && after.mode === modified.mode).toBe(true);
      expect(hashBytes(await readFile(changed)) === contents).toBe(true);
      await rm(changed);
      expect(await inventory(context.protectedRoot) === historical).toBe(true);
    }
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('v2_browser_repeated_runs_preserve_prior_pins_and_inputs', async () => {
  const context = await setup();
  try {
    const before = await inventory(context.protectedRoot);
    const first = await context.run('first-run', 'evidence-v2');
    const second = await context.run('second-run', 'evidence-v2');
    await first.fixtures.prepare(context.bindings, first.publish);
    const prior = await inventory(context.protectedRoot);
    await second.fixtures.prepare(context.bindings, second.publish);
    await second.fixtures.close();
    expect(await inventory(context.protectedRoot) === prior).toBe(true);
    await first.fixtures.close();
    expect(await inventory(context.protectedRoot) === before).toBe(true);

    const v1 = await context.run('legacy-default');
    const pins = await v1.fixtures.prepare(context.bindings, async truthRoot => {
      expect((await readdir(truthRoot)).sort().join(',') === 'expected-a.json,expected-b.json').toBe(true);
      return v1.publish();
    });
    expect(pins.map(pin => pin.fixtureSetVersion)).toEqual(['1', '1']);
    await v1.fixtures.close();
    expect(await inventory(context.protectedRoot) === before).toBe(true);
    expect(await inventory(context.originalTruthRoot) === context.originalBefore).toBe(true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
