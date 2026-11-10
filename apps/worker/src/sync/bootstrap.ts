import type { PoolClient } from 'pg';
import {
  CaptureLaneV1Schema, canonicalJson, hashArtifact, hashCanonical, hashManifest, unique,
  type CaptureLaneV1, type CommittedCaptureIdentityV1,
} from '@eapr/contracts';
import { readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
import { lockImportIdentities, lockParentKeys } from '@eapr/parent/persistence';
import { encodeCanonical } from '@eapr/parent/snapshots';
import { sqlState } from '@eapr/storage/transaction';
import {
  compareSourceIdentities, insertSourceIdentities, matchesEvent, readCaptureLane, sourceStreamLock,
} from './capture-store.js';
import { CaptureError, requireStorage, storageValue } from './capture-errors.js';

async function loadCommitted(client: PoolClient, identity: CommittedCaptureIdentityV1) {
  // The existing reader reports decode errors and database errors through one
  // promise. Preserve database failures even when pg supplies no SQLSTATE.
  const reader = new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return (sql: string, parameters?: unknown[]) => target.query(sql, parameters).catch(error => {
        if (sqlState(error)) throw error;
        throw new CaptureError('CAPTURE_UNAVAILABLE');
      });
    },
  });
  let stored: StoredActivation | null;
  try {
    stored = await readStoredActivation(reader, identity.scope);
  } catch (error) {
    if (sqlState(error)) throw error;
    throw new CaptureError('CAPTURE_STORAGE_INVALID');
  }
  if (!stored || stored.activation.id !== identity.activationId || stored.bundleHash !== identity.bundleHash) {
    throw new CaptureError('CAPTURE_ACTIVATION_NOT_FOUND');
  }
  return stored;
}

function verifyBaseline(stored: StoredActivation) {
  const { artifact, manifest, bootstrapEvents } = stored.bundle;
  const { activation } = stored;
  const capture = artifact.normalizedPlan.capture;
  if (capture.some(stream => stream.transport === 'csv') || manifest.files.some(file => file.kind === 'event_csv')) {
    throw new CaptureError('CAPTURE_TRANSPORT_UNSUPPORTED');
  }

  return storageValue(() => {
    requireStorage(artifact.hash === hashArtifact(artifact) && artifact.hash === activation.artifactHash &&
      artifact.sourceRef === manifest.sourceRef && artifact.normalizedPlan.sourceRef === manifest.sourceRef &&
      manifest.hash === hashManifest(manifest) &&
      manifest.hash === activation.manifestHash);
    const streams = new Map(capture.map(stream => [stream.streamId, stream]));
    const baseline = new Map(activation.baselineCursors.map(stream => [stream.streamId, stream.resumeAfter]));
    requireStorage(manifest.streams.length === streams.size && manifest.streams.length === baseline.size &&
      unique(bootstrapEvents, event => event.id));

    const events = new Map(manifest.streams.map(stream => [stream.streamId, [] as typeof bootstrapEvents]));
    for (const event of bootstrapEvents) {
      const members = events.get(event.streamId);
      const stream = streams.get(event.streamId);
      requireStorage(members && stream && matchesEvent(event, manifest, stream));
      members.push(event);
    }
    for (const { streamId, resumeAfter, eventIds, snapshotHash } of manifest.streams) {
      const members = events.get(streamId)!.sort((a, b) => a.sequence - b.sequence);
      const expected = new Set(eventIds);
      requireStorage(streams.has(streamId) && baseline.get(streamId) === resumeAfter &&
        members.length === Number(resumeAfter) && members.length === expected.size &&
        members.every((event, index) => event.sequence === index + 1 && expected.has(event.id)));
      requireStorage(snapshotHash === hashCanonical({
        sourceRef: manifest.sourceRef, streamId, resumeAfter,
        events: members.map(({ id, contentHash }) => ({ id, contentHash })),
      }));
    }
    return { manifest, capture, bootstrapEvents };
  });
}

export async function initializeCommittedCapture(
  client: PoolClient, identity: CommittedCaptureIdentityV1,
): Promise<CaptureLaneV1> {
  const stored = await loadCommitted(client, identity);
  const { manifest, capture, bootstrapEvents } = verifyBaseline(stored);
  const { sourceRef, hash: manifestHash } = manifest;
  const lane = CaptureLaneV1Schema.parse({ schemaVersion: '1', sourceRef, manifestHash });

  await lockParentKeys(client, [canonicalJson(['capture-lane', sourceRef, manifestHash])]);
  const existing = await readCaptureLane(client, lane);
  if (existing && (canonicalJson(existing.manifest) !== canonicalJson(manifest) ||
    canonicalJson(existing.capture) !== canonicalJson(capture))) {
    throw new CaptureError('CAPTURE_BINDING_CONFLICT');
  }

  await lockParentKeys(client, capture.map(({ streamId }) => sourceStreamLock(sourceRef, streamId)));
  await lockImportIdentities(client, [], bootstrapEvents);
  const missing = await compareSourceIdentities(client, sourceRef, bootstrapEvents);
  if (existing) {
    requireStorage(missing.every(entry => entry.delivery && entry.position));
    return lane;
  }
  await insertSourceIdentities(client, missing);
  await client.query(`
    INSERT INTO runtime_capture_lanes
      (source_ref, manifest_hash, initial_activation_id, manifest_canonical, manifest_digest,
       capture_canonical, capture_digest, initialized_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  `, [sourceRef, manifestHash, identity.activationId, ...encodeCanonical(manifest), ...encodeCanonical(capture)]);
  for (const { streamId, resumeAfter } of manifest.streams) {
    await client.query(`
      INSERT INTO runtime_capture_checkpoints
        (source_ref, manifest_hash, stream_id, transport, baseline_cursor, capture_cursor, captured_pages)
      VALUES ($1, $2, $3, $4, $5, $5, 0)
    `, [sourceRef, manifestHash, streamId, capture.find(stream => stream.streamId === streamId)!.transport, resumeAfter]);
  }
  return lane;
}
