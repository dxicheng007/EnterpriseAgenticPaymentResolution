import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import {
  HashSchema, IdSchema, RawSourceEventSchema, SourceSnapshotSchema, canonicalJson, hashCanonical, strict,
  type BootstrapManifest, type RawSourceEvent, type SourceSnapshot,
} from '@eapr/contracts';
import type { EvidenceFixtureInput } from './evidence-fixtures.js';
import { decodeTruth, verifyTruthMembers } from './fixtures.js';

const protectedRoot = new URL('../../../.local/protected-evaluator/', import.meta.url);
const maxBytes = 10 * 1024 * 1024;
const pinSchema = strict({ fixtureSetId: IdSchema, fixtureSetVersion: IdSchema, hash: HashSchema });
const bundleSchema = strict({
  pin: pinSchema, truthJson: z.string(), snapshot: SourceSnapshotSchema,
  events: RawSourceEventSchema.array(),
});

function fixturePath(root: URL, id: string, version: string) {
  return new URL(hashCanonical([IdSchema.parse(id), IdSchema.parse(version)]) + '.json', root);
}

async function readBounded(path: URL) {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length <= maxBytes) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error('Protected fixture invalid');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    await file.close();
  }
}

export function verifyCaptureBinding(manifest: BootstrapManifest, snapshot: SourceSnapshot) {
  const sort = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const evidenceIds = [...snapshot.evidenceIds].sort(sort);
  const eventIds = [...snapshot.eventIds].sort(sort);
  const streams = [...manifest.streams].sort((a, b) => sort(a.streamId, b.streamId))
    .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash }));
  const files = [...manifest.files].sort((a, b) => sort(a.fileId, b.fileId)).map(({ fileId, sha256 }) => ({ fileId, sha256 }));
  if (snapshot.id !== 'snapshot:' + manifest.id || snapshot.sourceRef !== manifest.sourceRef || snapshot.manifestId !== manifest.id ||
    evidenceIds.length !== new Set(evidenceIds).size ||
    snapshot.contentHash !== hashCanonical({ manifestHash: manifest.hash, streams, files, eventIds, evidenceIds })) {
    throw new Error('Protected fixture invalid');
  }
}

/** Operator-only registration. Linking a complete temp file reserves an immutable fixture version. */
export async function pinProtectedFixture(
  input: { truthJson: string; snapshot: SourceSnapshot; manifest: BootstrapManifest; events: RawSourceEvent[] },
  root: URL = protectedRoot,
) {
  const truth = decodeTruth(input.truthJson);
  if (truth.fixtureSetVersion === '2') throw new Error('Protected fixture invalid');
  const snapshot = SourceSnapshotSchema.parse(input.snapshot);
  const events = RawSourceEventSchema.array().parse(input.events).sort((a, b) => a.id < b.id ? -1 : 1);
  verifyTruthMembers(truth, input.manifest, snapshot, events);
  verifyCaptureBinding(input.manifest, snapshot);
  const pin = { fixtureSetId: truth.fixtureSetId, fixtureSetVersion: truth.fixtureSetVersion, hash: truth.hash };
  const bytes = canonicalJson({ pin, truthJson: canonicalJson(truth), snapshot, events });
  await publishProtectedPin(root, pin, bytes);
  return { fixtureSetId: truth.fixtureSetId, fixtureSetVersion: truth.fixtureSetVersion,
    purpose: truth.purpose, snapshotHash: snapshot.contentHash };
}

async function publishProtectedPin(
  root: URL, pin: { fixtureSetId: string; fixtureSetVersion: string }, bytes: string,
) {
  const target = fixturePath(root, pin.fixtureSetId, pin.fixtureSetVersion);
  if (Buffer.byteLength(bytes) > maxBytes) throw new Error('Protected fixture invalid');
  await mkdir(root, { mode: 0o700, recursive: true });
  const temp = new URL('.' + randomUUID(), root);
  await writeFile(temp, bytes, { mode: 0o400, flag: 'wx' });
  try {
    await link(temp, target);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST') ||
      await readBounded(target) !== bytes) throw new Error('Protected fixture invalid');
  } finally {
    await unlink(temp);
  }
}

export async function pinProtectedEvidenceFixture(input: EvidenceFixtureInput, root: URL = protectedRoot) {
  const { prepareProtectedEvidenceBundle } = await import('./evidence-fixtures.js');
  const { pin, bytes, purpose, snapshotHash } = await prepareProtectedEvidenceBundle(input);
  await publishProtectedPin(root, pin, bytes);
  return { fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, purpose, snapshotHash };
}

export async function readProtectedFixture(id: string, version: string, manifest: BootstrapManifest) {
  try {
    const text = await readBounded(fixturePath(protectedRoot, id, version));
    const input: unknown = JSON.parse(text);
    if (input && typeof input === 'object' && Object.hasOwn(input, 'schemaVersion')) {
      const { decodeProtectedEvidenceBundle } = await import('./evidence-fixtures.js');
      const result = await decodeProtectedEvidenceBundle(text, manifest);
      if (result.truth.fixtureSetId !== id || result.truth.fixtureSetVersion !== version) throw new Error();
      return result;
    }
    if (version === '2') throw new Error();
    const bundle = bundleSchema.parse(input);
    const truth = decodeTruth(bundle.truthJson, bundle.pin);
    if (truth.fixtureSetId !== id || truth.fixtureSetVersion !== version) throw new Error();
    verifyTruthMembers(truth, manifest, bundle.snapshot, bundle.events);
    verifyCaptureBinding(manifest, bundle.snapshot);
    return { truth, snapshot: bundle.snapshot, events: bundle.events, evidence: undefined };
  } catch {
    throw new Error('Protected fixture invalid');
  }
}
