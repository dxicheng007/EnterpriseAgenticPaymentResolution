import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, hashBytes, hashCanonical, IdSchema } from '@eapr/contracts';
import type { CaptureBinding, SafeVerificationPin } from '../../../apps/control/src/verification-composition.js';
import { decodeTruth } from '../../../packages/evaluator/src/fixtures.js';

export const fixedProtectedRoot = new URL('../../../.local/protected-evaluator/', import.meta.url);

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function requireAbsent(path: URL) {
  try {
    await lstat(path);
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  throw new Error('Browser fixture pin path already exists');
}

async function fingerprint(path: URL) {
  const stat = await lstat(path);
  if (!stat.isFile()) throw new Error('Browser fixture pin is not a file');
  return hashCanonical([stat.dev, stat.ino, stat.mode, hashBytes(await readFile(path))]);
}

export function browserVerificationFixtures({
  root, originalTruthRoot, protectedRoot = fixedProtectedRoot, nonce = randomUUID(),
}: { root: string; originalTruthRoot: string; protectedRoot?: URL; nonce?: string }) {
  const owned = new Map<URL, string>();

  return {
    async prepare(bindings: CaptureBinding[], pin: (truthRoot: string) => Promise<SafeVerificationPin[]>) {
      const truthRoot = join(root, 'verification-truth');
      await mkdir(truthRoot, { mode: 0o700 });
      const copies: { path: URL; expected: SafeVerificationPin }[] = [];
      for (const company of ['a', 'b']) {
        const filename = 'expected-' + company + '.json';
        const original = decodeTruth(await readFile(join(originalTruthRoot, filename), 'utf8'));
        const { hash: _originalHash, fixtureSetId: _originalId, ...facts } = original;
        const fixtureSetId = IdSchema.parse('browser-fixture:' + nonce + ':' + company);
        const fixtureSetVersion = '1';
        if (facts.fixtureSetVersion !== fixtureSetVersion) throw new Error('Browser fixture requires v1 truth');
        const copy = { ...facts, fixtureSetId };
        const json = canonicalJson({ ...copy, hash: hashCanonical(copy) });
        const { hash: _copyHash, fixtureSetId: copyId, ...copiedFacts } = decodeTruth(json);
        if (copyId !== fixtureSetId || canonicalJson(copiedFacts) !== canonicalJson(facts)) {
          throw new Error('Browser fixture copy changed protected facts');
        }
        const path = new URL(hashCanonical([fixtureSetId, fixtureSetVersion]) + '.json', protectedRoot);
        await requireAbsent(path);
        await writeFile(join(truthRoot, filename), json, { flag: 'wx', mode: 0o600 });
        const binding = bindings.find(candidate => candidate.companyId === facts.companyId);
        if (!binding || binding.sourceRef !== facts.sourceRef || binding.manifestId !== facts.manifestId ||
            binding.manifestHash !== facts.manifestHash) throw new Error('Browser fixture capture does not match truth');
        if (facts.purpose !== 'construction') throw new Error('Browser fixture requires construction truth');
        copies.push({ path, expected: { ...binding, fixtureSetId, fixtureSetVersion, purpose: facts.purpose } });
      }

      // A partial prepare can publish a file without confirming ownership. Leave it in place.
      const pins = await pin(truthRoot);
      if (pins.length !== copies.length || !copies.every(({ expected }) =>
        pins.some(pin => canonicalJson(pin) === canonicalJson(expected)))) {
        throw new Error('Browser fixture pin bindings do not match the owned copies');
      }
      const confirmed = await Promise.all(copies.map(async ({ path }) => ({ path, bytes: await fingerprint(path) })));
      for (const { path, bytes } of confirmed) owned.set(path, bytes);
      return pins;
    },

    async close() {
      for (const [path, expected] of owned) {
        try {
          if (await fingerprint(path) === expected) await rm(path);
        } catch (error) {
          if (!missing(error)) throw error;
        }
        owned.delete(path);
      }
    },
  };
}
