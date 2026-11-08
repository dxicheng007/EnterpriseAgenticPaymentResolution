import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import {
  HashSchema, IdSchema, RawSourceEventSchema, SourceSnapshotSchema, canonicalJson, hashCanonical, strict,
  type BootstrapManifest, type RawSourceEvent, type SourceSnapshot,
} from '@eapr/contracts';
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

function verifyCaptureBinding(manifest: BootstrapManifest, snapshot: SourceSnapshot) {
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
  const snapshot = SourceSnapshotSchema.parse(input.snapshot);
  const events = RawSourceEventSchema.array().parse(input.events).sort((a, b) => a.id < b.id ? -1 : 1);
  verifyTruthMembers(truth, input.manifest, snapshot, events);
  verifyCaptureBinding(input.manifest, snapshot);
  const pin = { fixtureSetId: truth.fixtureSetId, fixtureSetVersion: truth.fixtureSetVersion, hash: truth.hash };
  const target = fixturePath(root, pin.fixtureSetId, pin.fixtureSetVersion);
  const bytes = canonicalJson({ pin, truthJson: canonicalJson(truth), snapshot, events });
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
  return { fixtureSetId: truth.fixtureSetId, fixtureSetVersion: truth.fixtureSetVersion,
    purpose: truth.purpose, snapshotHash: snapshot.contentHash };
}

export async function readProtectedFixture(id: string, version: string, manifest: BootstrapManifest) {
  try {
    const bundle = bundleSchema.parse(JSON.parse(await readBounded(fixturePath(protectedRoot, id, version))));
    const truth = decodeTruth(bundle.truthJson, bundle.pin);
    if (truth.fixtureSetId !== id || truth.fixtureSetVersion !== version) throw new Error();
    verifyTruthMembers(truth, manifest, bundle.snapshot, bundle.events);
    verifyCaptureBinding(manifest, bundle.snapshot);
    return { truth, events: bundle.events };
  } catch {
    throw new Error('Protected fixture invalid');
  }
}
