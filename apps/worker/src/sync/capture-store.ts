import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  BootstrapManifestSchema, CaptureIncidentSummaryV1Schema, CaptureProgressV1Schema, CaptureStreamProgressV1Schema,
  CaptureStreamSchema, ChangePageSchema, CursorSchema, HashSchema, IdSchema, IsoInstantSchema,
  RawSourceEventSchema, canonicalJson, hashCanonical, hashEvent, hashManifest, setOf, strict, unique,
  type BootstrapManifest, type CaptureIncidentSummaryV1, type CaptureLaneV1, type CaptureProgressV1,
  type CaptureResultV1, type CaptureStream, type CaptureStreamProgressV1, type ChangePage, type RawSourceEvent,
} from '@eapr/contracts';
import { lockImportIdentities, lockParentKeys } from '@eapr/parent/persistence';
import { decodeCanonical, encodeCanonical } from '@eapr/parent/snapshots';
import { publishActivity } from '@eapr/storage/activity';
import type { Clock } from '@eapr/storage/control-db';
import { sqlState, withTransaction } from '@eapr/storage/transaction';
import { CaptureError, CaptureIncident, requireStorage, safeCaptureError, storageValue } from './capture-errors.js';

const captureDefinition = setOf(CaptureStreamSchema, stream => stream.streamId);
const pageEnvelope = strict({
  sourceRef: IdSchema, streamId: IdSchema, after: CursorSchema, next: CursorSchema, complete: z.boolean(),
  events: z.array(RawSourceEventSchema).max(1000),
});

type LaneRow = {
  source_ref: string; manifest_hash: string; initial_activation_id: string; initialized_at: string;
  manifest_canonical: string; manifest_digest: string; capture_canonical: string; capture_digest: string;
};
type CaptureBinding = {
  manifest: BootstrapManifest; capture: CaptureStream[];
  manifestDigest: string; captureDigest: string; initialActivationId: string; initializedAt: string;
};
type BoundCaptureLane = { lane: CaptureLaneV1; binding: CaptureBinding };
type CheckpointRow = {
  stream_id: string; transport: string; baseline_cursor: string; capture_cursor: string;
  captured_pages: string; last_captured_at: string | null;
};
type IncidentRow = {
  incident_hash: string; code: string; page_hash: string; source_ids_canonical: string; source_ids_digest: string; observed_at: string;
};
type PageRow = { next_cursor: string; event_count: string; canonical: string; digest: string; captured_at: string };
type DeliveryRow = { event_id: string; canonical: string; digest: string; content_hash: string };
type PositionRow = { stream_id: string; sequence: string; event_id: string };
type SourceIdentity = { event: RawSourceEvent; delivery: boolean; position: boolean };

function parseInstant(value: string) {
  const instant = IsoInstantSchema.parse(value);
  requireStorage(instant === value);
  return instant;
}

const values = (lane: CaptureLaneV1) => [lane.sourceRef, lane.manifestHash];
const cursor = (value: unknown) => Number(CursorSchema.parse(value));
const positionKey = (streamId: string, sequence: number) => canonicalJson([streamId, sequence]);

export const sourceStreamLock = (sourceRef: string, streamId: string) =>
  canonicalJson(['capture-source-stream', sourceRef, streamId]);

export function matchesEvent(event: RawSourceEvent, manifest: BootstrapManifest, stream: CaptureStream) {
  return event.sourceRef === manifest.sourceRef && event.streamId === stream.streamId &&
    event.rawIdentity.companyId === manifest.companyId && stream.resources.includes(event.resource) &&
    Number.isSafeInteger(event.sequence) && Number.isSafeInteger(event.recordVersion) &&
    event.contentHash === hashEvent(event);
}

function decodeLane(row: LaneRow, lane: CaptureLaneV1, expected?: CaptureBinding): CaptureBinding {
  return storageValue(() => {
    const manifest = decodeCanonical(BootstrapManifestSchema, row.manifest_canonical, row.manifest_digest);
    const capture = decodeCanonical(captureDefinition, row.capture_canonical, row.capture_digest);
    const streamIds = new Set(manifest.streams.map(stream => stream.streamId));
    requireStorage(row.source_ref === lane.sourceRef && row.manifest_hash === lane.manifestHash &&
      manifest.sourceRef === lane.sourceRef && manifest.hash === lane.manifestHash &&
      manifest.hash === hashManifest(manifest) && capture.length === streamIds.size &&
      capture.every(stream => stream.transport !== 'csv' && streamIds.has(stream.streamId)) &&
      manifest.files.every(file => file.kind !== 'event_csv'));
    const binding = {
      manifest, capture, manifestDigest: row.manifest_digest, captureDigest: row.capture_digest,
      initialActivationId: IdSchema.parse(row.initial_activation_id), initializedAt: parseInstant(row.initialized_at),
    };
    requireStorage(!expected || (binding.manifestDigest === expected.manifestDigest &&
      binding.captureDigest === expected.captureDigest && binding.initialActivationId === expected.initialActivationId &&
      binding.initializedAt === expected.initializedAt));
    return binding;
  });
}

export async function readCaptureLane(client: PoolClient, lane: CaptureLaneV1, expected?: CaptureBinding) {
  const { rows: [row] } = await client.query<LaneRow>(
    'SELECT * FROM runtime_capture_lanes WHERE source_ref = $1 AND manifest_hash = $2', values(lane),
  );
  return row ? decodeLane(row, lane, expected) : null;
}

export async function compareSourceIdentities(
  client: PoolClient, sourceRef: string, events: RawSourceEvent[],
): Promise<SourceIdentity[]> {
  const ids = events.map(event => event.id);
  const { rows: positions } = await client.query<PositionRow>(`
    SELECT stream_id, sequence::text, event_id FROM runtime_source_positions
    WHERE source_ref = $1 AND (event_id = ANY($2) OR (stream_id, sequence) IN (
      SELECT * FROM unnest($3::text[], $4::bigint[])
    ))
  `, [sourceRef, ids, events.map(event => event.streamId), events.map(event => event.sequence)]);
  const { rows: deliveries } = await client.query<DeliveryRow>(`
    SELECT event_id, canonical, digest, content_hash FROM runtime_deliveries
    WHERE source_ref = $1 AND event_id = ANY($2)
  `, [sourceRef, [...new Set([...ids, ...positions.map(row => row.event_id)])]]);

  const stored = new Map(deliveries.map(row => [row.event_id, storageValue(() => {
    const event = decodeCanonical(RawSourceEventSchema, row.canonical, row.digest);
    requireStorage(event.sourceRef === sourceRef && event.id === row.event_id &&
      event.contentHash === row.content_hash && hashEvent(event) === event.contentHash &&
      Number.isSafeInteger(event.sequence) && Number.isSafeInteger(event.recordVersion));
    return event;
  })]));
  const byPosition = new Map(positions.map(row => storageValue(() => {
    const sequence = cursor(row.sequence);
    const event = stored.get(row.event_id);
    requireStorage(event && event.streamId === row.stream_id && event.sequence === sequence && sequence > 0);
    return [positionKey(row.stream_id, sequence), row.event_id];
  })));
  const positioned = new Set(positions.map(row => row.event_id));
  const conflicts = new Set<string>();
  const identities = events.map(event => {
    const existing = stored.get(event.id);
    const occupant = byPosition.get(positionKey(event.streamId, event.sequence));
    if (existing && canonicalJson(event) !== canonicalJson(existing)) conflicts.add(event.id);
    if (occupant !== undefined && occupant !== event.id) {
      conflicts.add(event.id);
      conflicts.add(occupant);
    }
    return { event, delivery: existing !== undefined, position: positioned.has(event.id) };
  });
  if (conflicts.size) throw new CaptureIncident('CAPTURE_IDENTITY_CONFLICT', [...conflicts]);
  return identities;
}

export async function insertSourceIdentities(client: PoolClient, identities: SourceIdentity[]) {
  for (const { event, delivery, position } of identities) {
    if (!delivery) await client.query(`
      INSERT INTO runtime_deliveries (source_ref, event_id, content_hash, canonical, digest) VALUES ($1, $2, $3, $4, $5)
    `, [event.sourceRef, event.id, event.contentHash, ...encodeCanonical(event)]);
    if (!position) await client.query(`
      INSERT INTO runtime_source_positions (source_ref, stream_id, sequence, event_id) VALUES ($1, $2, $3, $4)
    `, [event.sourceRef, event.streamId, event.sequence, event.id]);
  }
}

function decodeCheckpoint(row: CheckpointRow, binding: CaptureBinding, stream: CaptureStream, incident: CaptureIncidentSummaryV1 | null) {
  return storageValue(() => {
    const baseline = binding.manifest.streams.find(candidate => candidate.streamId === row.stream_id);
    requireStorage(baseline && row.stream_id === stream.streamId &&
      baseline.resumeAfter === row.baseline_cursor && stream.transport === row.transport);
    return CaptureStreamProgressV1Schema.parse({
      streamId: row.stream_id, transport: row.transport, baselineCursor: row.baseline_cursor, captureCursor: row.capture_cursor,
      capturedRecords: cursor(row.capture_cursor) - cursor(row.baseline_cursor), capturedPages: cursor(row.captured_pages),
      lastCapturedAt: row.last_captured_at === null ? null : parseInstant(row.last_captured_at), lastIncident: incident,
    });
  });
}

function incidentHash(lane: CaptureLaneV1, streamId: string, { code, pageHash, sourceIds }: CaptureIncidentSummaryV1) {
  return hashCanonical({ lane, streamId, code, pageHash, sourceIds });
}

function decodeIncident(lane: CaptureLaneV1, streamId: string, row: IncidentRow) {
  return storageValue(() => {
    const incident = CaptureIncidentSummaryV1Schema.parse({
      code: row.code, pageHash: row.page_hash, observedAt: parseInstant(row.observed_at),
      sourceIds: decodeCanonical(z.array(IdSchema).max(20), row.source_ids_canonical, row.source_ids_digest),
    });
    requireStorage(incidentHash(lane, streamId, incident) === HashSchema.parse(row.incident_hash));
    return incident;
  });
}

export async function readBoundProgress(db: Pool, bound: BoundCaptureLane): Promise<CaptureProgressV1> {
  const { lane, binding: expected } = bound;
  try {
    const { rows } = await db.query<LaneRow & (CheckpointRow | { stream_id: null }) & {
      incident: IncidentRow | null;
    }>(`
      SELECT l.*, c.stream_id, c.transport, c.baseline_cursor::text, c.capture_cursor::text,
        c.captured_pages::text, c.last_captured_at, incident.summary AS incident
      FROM runtime_capture_lanes l
      LEFT JOIN runtime_capture_checkpoints c USING (source_ref, manifest_hash)
      LEFT JOIN LATERAL (
        SELECT to_jsonb(i) AS summary FROM runtime_capture_incidents i
        WHERE (i.source_ref, i.manifest_hash, i.stream_id) = (c.source_ref, c.manifest_hash, c.stream_id)
        ORDER BY i.observed_at DESC, i.incident_hash DESC LIMIT 1
      ) incident ON TRUE
      WHERE l.source_ref = $1 AND l.manifest_hash = $2
      ORDER BY c.stream_id COLLATE "C"
    `, values(lane));
    requireStorage(rows[0]);
    const binding = decodeLane(rows[0], lane, expected);
    const streams = rows.flatMap(row => {
      if (row.stream_id === null) return [];
      const stream = binding.capture.find(candidate => candidate.streamId === row.stream_id);
      requireStorage(stream);
      const incident = row.incident && decodeIncident(lane, row.stream_id, row.incident);
      return [decodeCheckpoint(row, binding, stream, incident)];
    });
    requireStorage(streams.length === binding.capture.length);
    return storageValue(() => CaptureProgressV1Schema.parse({ schemaVersion: '1', lane, streams }));
  } catch (error) {
    throw safeCaptureError(error);
  }
}

async function readAcceptedPage(
  client: PoolClient, lane: CaptureLaneV1, page: ChangePage, stream: CaptureStream,
  manifest: BootstrapManifest, progress: CaptureStreamProgressV1,
) {
  const key = [...values(lane), page.streamId, page.after];
  const { rows: [row] } = await client.query<PageRow>(`
    SELECT next_cursor::text, event_count::text, canonical, digest, captured_at FROM runtime_capture_pages
    WHERE source_ref = $1 AND manifest_hash = $2 AND stream_id = $3 AND after_cursor = $4
  `, key);
  if (!row) return null;
  const accepted = storageValue(() => {
    const saved = decodeCanonical(ChangePageSchema, row.canonical, row.digest);
    parseInstant(row.captured_at);
    requireStorage(saved.sourceRef === lane.sourceRef && saved.streamId === page.streamId && saved.after === page.after &&
      saved.next === row.next_cursor && saved.complete && saved.events.length === cursor(row.event_count) &&
      cursor(saved.after) >= cursor(progress.baselineCursor) && cursor(saved.next) <= cursor(progress.captureCursor) &&
      saved.events.length > 0 && saved.events.length <= stream.pageSize && unique(saved.events, event => event.id) &&
      saved.events.every(event => matchesEvent(event, manifest, stream)));
    return saved;
  });
  const { rows: members } = await client.query<DeliveryRow & { sequence: string }>(`
    SELECT i.event_id, i.sequence::text, d.canonical, d.digest, d.content_hash FROM runtime_inbox i
    JOIN runtime_deliveries d USING (source_ref, event_id)
    WHERE i.source_ref = $1 AND i.manifest_hash = $2 AND i.stream_id = $3 AND i.after_cursor = $4
    ORDER BY i.sequence
  `, key);
  requireStorage(members.length === accepted.events.length && members.every((member, index) => {
    const event = accepted.events[index]!;
    const [canonical, digest] = encodeCanonical(event);
    return member.event_id === event.id && member.sequence === String(event.sequence) &&
      member.canonical === canonical && member.digest === digest && member.content_hash === event.contentHash;
  }));
  return { accepted, canonical: row.canonical };
}

async function publishPage(
  client: PoolClient, clock: Clock, lane: CaptureLaneV1, page: ChangePage, canonical: string, digest: string,
  progress: CaptureStreamProgressV1, identities: SourceIdentity[],
) {
  const at = IsoInstantSchema.parse(clock().toISOString());
  const key = [...values(lane), page.streamId, page.after];
  const pages = progress.capturedPages + 1;
  requireStorage(Number.isSafeInteger(pages));
  await insertSourceIdentities(client, identities);
  await client.query(`
    INSERT INTO runtime_capture_pages
      (source_ref, manifest_hash, stream_id, after_cursor, next_cursor, event_count, canonical, digest, captured_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [...key, page.next, page.events.length, canonical, digest, at]);
  await client.query(`
    INSERT INTO runtime_inbox (source_ref, manifest_hash, stream_id, after_cursor, sequence, event_id)
    SELECT $1, $2, $3, $4, sequence, id FROM unnest($5::bigint[], $6::text[]) AS member(sequence, id)
  `, [...key, page.events.map(event => event.sequence), page.events.map(event => event.id)]);
  const updated = await client.query(`
    UPDATE runtime_capture_checkpoints SET capture_cursor = $5, captured_pages = $6, last_captured_at = $7
    WHERE source_ref = $1 AND manifest_hash = $2 AND stream_id = $3 AND capture_cursor = $4
  `, [...key, page.next, pages, at]);
  if (updated.rowCount !== 1) throw new CaptureError('CAPTURE_UNAVAILABLE');
  await publishActivity(client, {
    stream: 'runtime', phase: 'run', type: 'source.captured', at,
    payload: { sourceRef: lane.sourceRef, manifestHash: lane.manifestHash, captured: page.events.length },
  });
}

async function persistIncident(
  db: Pool, clock: Clock, lane: CaptureLaneV1, streamId: string, pageHash: string, error: CaptureIncident,
) {
  const incident = CaptureIncidentSummaryV1Schema.parse({
    code: error.code, pageHash, sourceIds: [...new Set(error.sourceIds)].sort().slice(0, 20),
    observedAt: clock().toISOString(),
  });
  await withTransaction(db, async client => {
    const key = [...values(lane), streamId, incidentHash(lane, streamId, incident)];
    const inserted = await client.query(`
      INSERT INTO runtime_capture_incidents
        (source_ref, manifest_hash, stream_id, incident_hash, code, page_hash, source_ids_canonical, source_ids_digest, observed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (source_ref, manifest_hash, stream_id, incident_hash) DO NOTHING
    `, [...key, incident.code, pageHash, ...encodeCanonical(incident.sourceIds), incident.observedAt]);
    if (inserted.rowCount === 0) {
      const { rows: [row] } = await client.query<IncidentRow>(`
        SELECT incident_hash, code, page_hash, source_ids_canonical, source_ids_digest, observed_at
        FROM runtime_capture_incidents WHERE source_ref = $1 AND manifest_hash = $2 AND stream_id = $3 AND incident_hash = $4
      `, key);
      requireStorage(row);
      decodeIncident(lane, streamId, row);
    }
  });
}

export async function captureBoundPage(
  db: Pool, clock: Clock, bound: BoundCaptureLane, input: ChangePage,
): Promise<CaptureResultV1> {
  const { lane, binding: expected } = bound;
  let page: ChangePage;
  let encoded: [string, string];
  try {
    page = pageEnvelope.parse(input);
    encoded = encodeCanonical(page);
  } catch {
    throw new CaptureError('CAPTURE_INPUT_INVALID');
  }
  const [canonical, digest] = encoded;

  const run = (recheck = false) => withTransaction<CaptureResultV1>(db, async client => {
    const binding = await readCaptureLane(client, lane, expected);
    requireStorage(binding);
    const stream = binding.capture.find(candidate => candidate.streamId === page.streamId);
    if (page.sourceRef !== lane.sourceRef || !stream || page.events.length > stream.pageSize ||
      !unique(page.events, event => event.id) || !page.events.every(event => matchesEvent(event, binding.manifest, stream))) {
      throw new CaptureError('CAPTURE_INPUT_INVALID');
    }
    const { rows: [row] } = await client.query<CheckpointRow>(`
      SELECT stream_id, transport, baseline_cursor::text, capture_cursor::text, captured_pages::text, last_captured_at
      FROM runtime_capture_checkpoints WHERE source_ref = $1 AND manifest_hash = $2 AND stream_id = $3 FOR UPDATE
    `, [...values(lane), page.streamId]);
    requireStorage(row);
    const progress = decodeCheckpoint(row, binding, stream, null);
    await lockParentKeys(client, [sourceStreamLock(lane.sourceRef, page.streamId)]);
    await lockImportIdentities(client, [], page.events);

    const identities = await compareSourceIdentities(client, lane.sourceRef, page.events);
    const saved = await readAcceptedPage(client, lane, page, stream, binding.manifest, progress);
    if (saved && saved.accepted.next === page.next && saved.canonical !== canonical) {
      throw new CaptureIncident('CAPTURE_PAGE_CONFLICT', page.events.map(event => event.id));
    }
    const current = progress.captureCursor;
    const after = cursor(page.after);
    const contiguous = cursor(page.next) - after === page.events.length &&
      page.events.every((event, index) => event.sequence - after === index + 1);
    if (!page.complete || !contiguous || after > cursor(current)) {
      throw new CaptureIncident('CAPTURE_GAP');
    }
    requireStorage(identities.every(({ event, delivery, position }) =>
      event.sequence > cursor(current) || (delivery && position)));
    if (recheck) throw new CaptureError('CAPTURE_UNAVAILABLE');
    if (after < cursor(current)) {
      const replayed = saved?.canonical === canonical;
      return { disposition: replayed ? 'replayed' : 'refetch', captured: 0, cursor: current, replayed };
    }
    if (!page.events.length) return { disposition: 'empty', captured: 0, cursor: current, replayed: false };
    await publishPage(client, clock, lane, page, canonical, digest, progress, identities);
    return { disposition: 'captured', captured: page.events.length, cursor: page.next, replayed: false };
  });

  try {
    return await run().catch(error => {
      if (sqlState(error) === '23505') return run(true);
      throw error;
    });
  } catch (error) {
    if (error instanceof CaptureIncident) {
      try {
        await persistIncident(db, clock, lane, page.streamId, digest, error);
      } catch {
        throw new CaptureError('CAPTURE_UNAVAILABLE');
      }
    }
    throw safeCaptureError(error);
  }
}
