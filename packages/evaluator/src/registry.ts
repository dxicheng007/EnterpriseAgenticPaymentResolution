import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import type { ZodType } from 'zod';
import type { CandidateRegistration, CandidateRegistry } from '@eapr/compiler/preview-adapters';
import { compile } from '@eapr/compiler/compile';
import {
  BootstrapManifestSchema, CompiledArtifactSchema, ConnectorSpecSchema, CustomerProfileSchema, HashSchema,
  SourceSnapshotSchema, canonicalJson, hashBytes, hashCanonical, hashManifest, hashProfile, hashSpec,
} from '@eapr/contracts';
import { withTransaction } from '@eapr/storage/transaction';

export class RegistryFailure extends Error {
  constructor(readonly statusCode: 404 | 409) {
    super(statusCode === 404 ? 'Candidate object is not registered' : 'Candidate identity conflict');
  }
}

function sorted<T>(items: readonly T[], key: (item: T) => string) {
  return [...items].sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
}

function assertArtifact(spec: CandidateRegistration['spec'], profiles: CandidateRegistration['profiles'], artifact: CandidateRegistration['artifact']) {
  const compiled = compile(spec, profiles);
  if (!compiled.ok || canonicalJson(compiled.value) !== canonicalJson(artifact)) throw new RegistryFailure(409);
}

function registration(input: CandidateRegistration): CandidateRegistration {
  const spec = ConnectorSpecSchema.parse(input.spec);
  const artifact = CompiledArtifactSchema.parse(input.artifact);
  const profiles = sorted(CustomerProfileSchema.array().parse(input.profiles), profile => profile.hash);
  const manifest = BootstrapManifestSchema.parse(input.manifest);
  const snapshot = SourceSnapshotSchema.parse(input.snapshot);
  assertArtifact(spec, profiles, artifact);
  const eventIds = sorted(snapshot.eventIds, id => id);
  const evidenceIds = sorted(snapshot.evidenceIds, id => id);
  const manifestEventIds = sorted(manifest.streams.flatMap(stream => stream.eventIds), id => id);
  const streams = sorted(manifest.streams, stream => stream.streamId)
    .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash }));
  const files = sorted(manifest.files, file => file.fileId).map(({ fileId, sha256 }) => ({ fileId, sha256 }));
  const manifestHash = hashManifest(manifest);
  if (profiles.some(profile => profile.hash !== hashProfile(profile) || profile.scope.companyId !== manifest.companyId) ||
    artifact.sourceRef !== manifest.sourceRef || snapshot.sourceRef !== manifest.sourceRef ||
    snapshot.id !== 'snapshot:' + manifest.id || snapshot.manifestId !== manifest.id || manifest.hash !== manifestHash ||
    new Set(eventIds).size !== eventIds.length || new Set(evidenceIds).size !== evidenceIds.length ||
    canonicalJson(eventIds) !== canonicalJson(manifestEventIds) ||
    snapshot.contentHash !== hashCanonical({ manifestHash, streams, files, eventIds, evidenceIds })) {
    throw new RegistryFailure(409);
  }
  return { spec, artifact, profiles, manifest, snapshot };
}

type ObjectKind = 'spec' | 'artifact' | 'profile' | 'manifest' | 'snapshot';
type ObjectRow = { identity: string; object_hash: string; bytes_hash: string };

export function createCandidateRegistry(pool: Pool, root: string): CandidateRegistry & {
  getCandidate(artifactHash: string, manifestId: string): Promise<CandidateRegistration>;
} {
  async function prepare(kind: ObjectKind, identity: string, objectHash: string, object: unknown) {
    const bytes = Buffer.from(canonicalJson(object));
    const bytesHash = hashBytes(bytes);
    const path = join(root, bytesHash);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = join(root, '.' + randomUUID());
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o400 });
    try {
      await link(temporary, path);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      if (!(await readFile(path)).equals(bytes)) throw new RegistryFailure(409);
    } finally {
      await unlink(temporary);
    }
    return { kind, identity, objectHash, bytesHash };
  }

  async function pin(client: PoolClient, object: Awaited<ReturnType<typeof prepare>>) {
    const { kind, identity, objectHash, bytesHash } = object;
    await client.query(
      'INSERT INTO artifact_objects VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [kind, identity, objectHash, bytesHash],
    );
    const { rows: [row] } = await client.query<ObjectRow>(
      'SELECT * FROM artifact_objects WHERE kind = $1 AND identity = $2', [kind, identity],
    );
    if (row?.object_hash !== objectHash || row.bytes_hash !== bytesHash) throw new RegistryFailure(409);
  }

  async function read<T>(
    kind: ObjectKind, key: 'identity' | 'object_hash', value: string, schema: ZodType<T>,
    objectIdentity: (object: T) => string, objectHash: (object: T) => string,
  ): Promise<T> {
    const { rows: [row] } = await pool.query<ObjectRow>(
      'SELECT * FROM artifact_objects WHERE kind = $1 AND ' + key + ' = $2', [kind, value],
    );
    if (!row) throw new RegistryFailure(404);
    const bytes = await readFile(join(root, HashSchema.parse(row.bytes_hash)));
    if (hashBytes(bytes) !== row.bytes_hash) throw new RegistryFailure(409);
    const object = schema.parse(JSON.parse(bytes.toString('utf8')));
    if (objectIdentity(object) !== row.identity || objectHash(object) !== row.object_hash) throw new RegistryFailure(409);
    return object;
  }

  const versioned = (object: { id: string; version: number }) => object.id + '@' + object.version;
  const getProfile = (hash: string) => read('profile', 'object_hash', hash, CustomerProfileSchema, versioned, profile => {
    if (hashProfile(profile) !== profile.hash) throw new RegistryFailure(409);
    return profile.hash;
  });
  const getManifest = (id: string) => read('manifest', 'identity', id, BootstrapManifestSchema, value => value.id, value => {
    if (hashManifest(value) !== value.hash) throw new RegistryFailure(409);
    return value.hash;
  });
  async function resolveArtifact(hash: string) {
    const artifact = await read('artifact', 'object_hash', hash, CompiledArtifactSchema, value => value.id, value => value.hash);
    const spec = await read('spec', 'object_hash', artifact.specHash, ConnectorSpecSchema, versioned, hashSpec);
    const profiles = await Promise.all(artifact.requiredProfileHashes.map(getProfile));
    return { artifact, spec, profiles };
  }

  return {
    async registerCandidate(input) {
      const { spec, artifact, profiles, manifest, snapshot } = registration(input);
      const objects = await Promise.all([
        prepare('spec', versioned(spec), hashSpec(spec), spec),
        prepare('artifact', artifact.id, artifact.hash, artifact),
        ...profiles.map(profile => prepare('profile', versioned(profile), profile.hash, profile)),
        prepare('manifest', manifest.id, manifest.hash, manifest),
        prepare('snapshot', snapshot.id, hashCanonical(snapshot), snapshot),
      ]);
      await withTransaction(pool, async client => {
        for (const object of objects) await pin(client, object);
        const pair = [artifact.hash, manifest.id];
        await client.query('INSERT INTO artifact_captures VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [...pair, snapshot.id]);
        const { rows: [row] } = await client.query<{ snapshot_id: string }>(
          'SELECT snapshot_id FROM artifact_captures WHERE artifact_hash = $1 AND manifest_id = $2', pair,
        );
        if (row?.snapshot_id !== snapshot.id) throw new RegistryFailure(409);
      });
    },
    async getArtifact(hash) {
      const { artifact, spec, profiles } = await resolveArtifact(hash);
      assertArtifact(spec, profiles, artifact);
      return { artifact, spec };
    },
    getProfile,
    getManifest,
    async getCandidate(hash, manifestId) {
      const { rows: [row] } = await pool.query<{ snapshot_id: string }>(
        'SELECT snapshot_id FROM artifact_captures WHERE artifact_hash = $1 AND manifest_id = $2', [hash, manifestId],
      );
      if (!row) throw new RegistryFailure(404);
      const [{ artifact, spec, profiles }, manifest, snapshot] = await Promise.all([
        resolveArtifact(hash), getManifest(manifestId),
        read('snapshot', 'identity', row.snapshot_id, SourceSnapshotSchema, value => value.id, hashCanonical),
      ]);
      return registration({ artifact, spec, profiles, manifest, snapshot });
    },
  };
}

export { createVerificationJobs } from './jobs.js';
