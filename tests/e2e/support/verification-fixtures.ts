import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, hashBytes, hashCanonical, IdSchema } from '@eapr/contracts';
import type { CaptureBinding, SafeVerificationPin } from '../../../apps/control/src/verification-composition.js';
import { decodeEvidenceProducer } from '../../../packages/evaluator/src/evidence-fixtures.js';
import { decodeTruth } from '../../../packages/evaluator/src/fixtures.js';

export const fixedProtectedRoot = new URL('../../../.local/protected-evaluator/', import.meta.url);

function hasCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function requireAbsent(path: URL) {
  try {
    await lstat(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return;
    throw new Error('Browser fixture pin path could not be inspected');
  }
  throw new Error('Browser fixture pin path already exists');
}

async function fingerprint(path: URL) {
  try {
    const before = await lstat(path);
    if (!before.isFile()) return;
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.mode !== before.mode) return;
      const bytes = await file.readFile();
      const current = await lstat(path);
      if (stat.dev === current.dev && stat.ino === current.ino && stat.mode === current.mode &&
          stat.mtimeMs === current.mtimeMs && stat.ctimeMs === current.ctimeMs) {
        return hashCanonical([stat.dev, stat.ino, stat.mode, hashBytes(bytes)]);
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!hasCode(error, 'ENOENT') && !hasCode(error, 'ELOOP')) {
      throw new Error('Browser fixture pin could not be fingerprinted');
    }
  }
}

async function readInput(root: string, filename: string) {
  try {
    return await readFile(join(root, filename), 'utf8');
  } catch {
    throw new Error('Browser fixture input could not be read');
  }
}

async function copyProducer(root: string, filename: string, original: ReturnType<typeof decodeTruth>,
  copied: ReturnType<typeof decodeTruth>) {
  const { hash: _originalHash, fixtureSetId, producerTruthHash, ...facts } =
    decodeEvidenceProducer(await readInput(root, filename));
  const { companyId, sourceRef, sellerEntityId, manifestId, manifestHash, generator } = original;
  const { identities: _identities, contracts: _contracts, schemaVersion: _schemaVersion, kind: _kind, ...metadata } = facts;
  if (fixtureSetId !== original.fixtureSetId || producerTruthHash !== original.hash ||
      canonicalJson(metadata) !== canonicalJson({
        companyId, sourceRef, sellerEntityId, manifestId, manifestHash, generator, producerFixtureSetVersion: '1',
      })) throw new Error('Browser fixture evidence producer does not match truth');

  const copy = { ...facts, fixtureSetId: copied.fixtureSetId, producerTruthHash: copied.hash };
  const json = canonicalJson({ ...copy, hash: hashCanonical(copy) });
  const { hash: _copyHash, fixtureSetId: copyId, producerTruthHash: copyTruthHash, ...copiedFacts } = decodeEvidenceProducer(json);
  if (copyId !== copied.fixtureSetId || copyTruthHash !== copied.hash || canonicalJson(copiedFacts) !== canonicalJson(facts)) {
    throw new Error('Browser fixture copy changed protected evidence facts');
  }
  return json;
}

export function browserVerificationFixtures({
  root, originalTruthRoot, protectedRoot = fixedProtectedRoot, nonce = randomUUID(), mode = 'expected-v1',
}: {
  root: string;
  originalTruthRoot: string;
  protectedRoot?: URL;
  nonce?: string;
  mode?: 'expected-v1' | 'evidence-v2';
}) {
  const owned = new Map<URL, string>();

  return {
    async prepare(bindings: CaptureBinding[], pin: (truthRoot: string) => Promise<SafeVerificationPin[]>) {
      const truthRoot = join(root, 'verification-truth');
      const fixtureSetVersion = mode === 'evidence-v2' ? '2' : '1';
      const copies: { path: URL; expected: SafeVerificationPin }[] = [];
      const inputs = new Map<string, string>();
      for (const company of ['a', 'b']) {
        const filename = 'expected-' + company + '.json';
        const original = decodeTruth(await readInput(originalTruthRoot, filename));
        const { hash: _originalHash, fixtureSetId: _originalId, ...facts } = original;
        if (facts.fixtureSetVersion !== '1') throw new Error('Browser fixture requires v1 truth');
        if (facts.purpose !== 'construction') throw new Error('Browser fixture requires construction truth');
        const fixtureSetId = IdSchema.parse('browser-fixture:' + nonce + ':' + company);
        const copy = { ...facts, fixtureSetId };
        const json = canonicalJson({ ...copy, hash: hashCanonical(copy) });
        const copied = decodeTruth(json);
        const { hash: _copyHash, fixtureSetId: copyId, ...copiedFacts } = copied;
        if (copyId !== fixtureSetId || canonicalJson(copiedFacts) !== canonicalJson(facts)) {
          throw new Error('Browser fixture copy changed protected facts');
        }
        inputs.set(filename, json);
        if (mode === 'evidence-v2') {
          const producerFile = 'evidence-' + company + '.json';
          inputs.set(producerFile, await copyProducer(originalTruthRoot, producerFile, original, copied));
        }
        const binding = bindings.find(candidate => candidate.companyId === facts.companyId);
        if (!binding || binding.sourceRef !== facts.sourceRef || binding.manifestId !== facts.manifestId ||
            binding.manifestHash !== facts.manifestHash) throw new Error('Browser fixture capture does not match truth');
        const path = new URL(hashCanonical([fixtureSetId, fixtureSetVersion]) + '.json', protectedRoot);
        copies.push({ path, expected: { ...binding, fixtureSetId, fixtureSetVersion, purpose: facts.purpose } });
      }
      try {
        await mkdir(truthRoot, { mode: 0o700 });
        for (const [filename, json] of inputs) {
          await writeFile(join(truthRoot, filename), json, { flag: 'wx', mode: 0o600 });
        }
      } catch {
        throw new Error('Browser fixture input could not be written');
      }
      for (const { path } of copies) await requireAbsent(path);

      // A partial prepare can publish a file without confirming ownership. Leave it in place.
      const pins = await pin(truthRoot);
      if (pins.length !== copies.length || !copies.every(({ expected }) =>
        pins.some(pin => canonicalJson(pin) === canonicalJson(expected)))) {
        throw new Error('Browser fixture pin bindings do not match the owned copies');
      }
      const confirmed = await Promise.all(copies.map(async ({ path }) => {
        const bytes = await fingerprint(path);
        if (bytes === undefined) throw new Error('Browser fixture pin is not a confirmed file');
        return { path, bytes };
      }));
      for (const { path, bytes } of confirmed) owned.set(path, bytes);
      return pins;
    },

    async close() {
      for (const [path, expected] of owned) {
        try {
          if (await fingerprint(path) === expected) await unlink(path);
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw new Error('Browser fixture pin cleanup failed');
        }
        owned.delete(path);
      }
    },
  };
}
