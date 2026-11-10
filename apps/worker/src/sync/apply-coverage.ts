import type { PoolClient } from 'pg';
import {
  ActivationBundleV2Schema, BootstrapManifestSchema, CaptureStreamSchema, ChangePageSchema,
  CommittedAuthorityIdentityV1Schema, CurrentAuthorityV1Schema, CustomerActivationSchema, IsoInstantSchema,
  RawSourceEventSchema, SyncReceiptSchema, hashCanonical, hashTargetSnapshot, setOf, targetRecordId,
  type CommittedAuthorityIdentityV1, type CompiledArtifact, type CustomerActivation, type CustomerProfile, type RawSourceEvent,
} from '@eapr/contracts';
import { classifyBatch, type TypedPrerequisite } from '@eapr/compiler/plan-batch';
import { fundingIdFor, invoiceIdFor } from '@eapr/finance/allocations';
import { financialRecords, referenceId, type FinancialRecord } from '@eapr/finance/validate';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { decodeCanonical, readStoredTarget, readVersion, scopeOf, scopeValues, type ScopeRow, type StoredTarget } from '@eapr/parent/snapshots';
import {
  CoverageCutSchema, SyncEventOutcomeSchema, readFinancialOrigins, readSyncUnit, syncEventRef,
  type CoverageCut, type ReceiptOrigin, type SyncUnitAudit,
} from '@eapr/parent/sync-store';
import { sqlState } from '@eapr/storage/transaction';
import { freezeJson } from '../../../../packages/storage/src/activation-files.js';
import { selectedProfile } from '../activation-validation.js';
import { PreparedSyncUnitSchema, SyncApplyError, equal, requireSync, syncHistoryLimit, validateCoverage, validatePlanIndexes,
  type PreparedSyncUnit } from './apply-types.js';
import { authorityError, AuthorityError } from './current-authority-errors.js';

type BoundRow = ScopeRow & { activation_id: string; bundle_hash: string; source_ref: string; manifest_hash: string };
type PositionRow = { source_ref: string; stream_id: string; sequence: string; event_id: string };
type CanonicalRow = { canonical: string; digest: string };
type LaneRow = {
  source_ref: string; manifest_hash: string; initial_activation_id: string; initialized_at: string;
  manifest_canonical: string; manifest_digest: string; capture_canonical: string; capture_digest: string;
};
type CheckpointRow = {
  stream_id: string; transport: 'api' | 'semantic'; baseline_cursor: string; capture_cursor: string;
  captured_pages: string; last_captured_at: string | null;
};
type HeadRow = BoundRow & { stream_id: string; baseline_cursor: string; applied_through: string; last_unit_hash: string | null };
type UnitRow = BoundRow & {
  unit_hash: string; audit_digest: string; stream_id: string; from_cursor: string; through_cursor: string;
  before_version: string; before_snapshot_hash: string; after_version: string; after_snapshot_hash: string; receipt_id: string | null;
};
type OutcomeRow = BoundRow & PositionRow & CanonicalRow & { unit_hash: string; record_id: string; disposition: string };
type AuthorityRow = ScopeRow & {
  initial_import_key: string; initial_receipt_id: string; grant_canonical: string; grant_digest: string;
  epoch: string; status: string; changed_at: string;
};
type CutRow = BoundRow & {
  idempotency_key: string; receipt_id: string; approved_snapshot_hash: string; target_version: string;
  activation: string; activation_digest: string; bundle: string; bundle_digest: string; receipt: string; receipt_digest: string;
  lanes: LaneRow[]; checkpoints: CheckpointRow[]; heads: HeadRow[]; units: UnitRow[]; outcomes: OutcomeRow[];
  origins: CoverageCut['historyOrigins']; guards: CoverageCut['guards'];
  positions: PositionRow[];
  inbox: (PositionRow & { manifest_hash: string; after_cursor: string })[];
  deliveries: (CanonicalRow & { source_ref: string; event_id: string; content_hash: string })[];
  pages: (CanonicalRow & {
    source_ref: string; manifest_hash: string; stream_id: string; after_cursor: string; next_cursor: string;
    event_count: string; captured_at: string;
  })[];
  authority: AuthorityRow | null; authority_history: boolean;
  target: { version: string; hash: string } | null;
};

// Every mutable capture predicate uses this statement snapshot. Independent bounded rowsets and
// source-wide EXISTS checks prevent missing counterpart rows from disappearing in an inner join.
const coverageSql = `
  WITH source AS (
    SELECT i.account_id, i.company_id, i.seller_entity_id, i.activation_id, i.bundle_hash, i.idempotency_key, i.receipt_id,
      i.capture_source_ref AS source_ref, i.capture_manifest_hash AS manifest_hash, i.approved_snapshot_hash,
      i.target_version::text, i.activation, i.activation_digest, i.bundle, i.bundle_digest, i.receipt, i.receipt_digest
    FROM runtime_activation_imports i
    WHERE (i.account_id, i.company_id, i.seller_entity_id, i.activation_id, i.bundle_hash) = ($1, $2, $3, $4, $5)
  ), lanes AS (
    SELECT l.* FROM runtime_capture_lanes l JOIN source s USING (source_ref)
    ORDER BY l.manifest_hash LIMIT 2
  ), checkpoints AS (
    SELECT c.* FROM runtime_capture_checkpoints c JOIN source s USING (source_ref, manifest_hash)
    ORDER BY c.stream_id COLLATE "C" LIMIT 3
  ), baseline_events AS (
    SELECT event FROM source s CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(parent_index_projection(s.bundle)->'bootstrapEvents') = 'array'
        THEN parent_index_projection(s.bundle)->'bootstrapEvents' ELSE '[]'::jsonb END
    ) AS e(event)
  ), positions AS (
    SELECT p.source_ref, p.stream_id, p.sequence::text, p.event_id
    FROM runtime_source_positions p JOIN source s USING (source_ref)
    LEFT JOIN checkpoints c USING (source_ref, stream_id)
    WHERE c.stream_id IS NULL OR p.sequence > c.baseline_cursor
    ORDER BY p.stream_id COLLATE "C", p.sequence LIMIT 1001
  ), inbox AS (
    SELECT i.source_ref, i.manifest_hash, i.stream_id, i.sequence::text, i.event_id, i.after_cursor::text
    FROM runtime_inbox i JOIN source s USING (source_ref)
    ORDER BY i.stream_id COLLATE "C", i.sequence, i.manifest_hash LIMIT 1001
  ), pages AS (
    SELECT p.source_ref, p.manifest_hash, p.stream_id, p.after_cursor::text, p.next_cursor::text,
      p.event_count::text, p.canonical, p.digest, p.captured_at
    FROM runtime_capture_pages p JOIN source s USING (source_ref)
    ORDER BY p.stream_id COLLATE "C", p.after_cursor, p.manifest_hash LIMIT 1001
  ), deliveries AS (
    SELECT d.source_ref, d.event_id, d.content_hash, d.canonical, d.digest, p.stream_id, p.sequence
    FROM runtime_deliveries d JOIN source s USING (source_ref)
    LEFT JOIN runtime_source_positions p USING (source_ref, event_id)
    LEFT JOIN checkpoints c ON (p.source_ref, p.stream_id) = (c.source_ref, c.stream_id)
    WHERE p.sequence IS NULL OR c.stream_id IS NULL OR p.sequence > c.baseline_cursor
    ORDER BY p.stream_id COLLATE "C", p.sequence, d.event_id LIMIT 1001
  ), heads AS (
    SELECT h.account_id, h.company_id, h.seller_entity_id, h.activation_id, h.bundle_hash, h.source_ref, h.manifest_hash,
      h.stream_id, h.baseline_cursor::text, h.applied_through::text, h.last_unit_hash
    FROM runtime_sync_application_heads h JOIN source s ON h.account_id = s.account_id OR h.activation_id = s.activation_id
    ORDER BY h.stream_id COLLATE "C" LIMIT 3
  ), units AS (
    SELECT u.account_id, u.company_id, u.seller_entity_id, u.activation_id, u.bundle_hash, u.source_ref, u.manifest_hash,
      u.unit_hash, u.audit_digest, u.stream_id, u.from_cursor::text, u.through_cursor::text, u.before_version::text,
      u.before_snapshot_hash, u.after_version::text, u.after_snapshot_hash, u.receipt_id
    FROM runtime_sync_units u JOIN source s ON u.account_id = s.account_id OR u.activation_id = s.activation_id
    ORDER BY u.from_cursor, u.unit_hash LIMIT 1001
  ), outcomes AS (
    SELECT o.account_id, o.company_id, o.seller_entity_id, o.activation_id, o.bundle_hash, o.source_ref, o.manifest_hash,
      o.stream_id, o.sequence::text, o.event_id, o.record_id, o.unit_hash, o.disposition, o.canonical, o.digest
    FROM runtime_sync_event_outcomes o JOIN source s
      ON o.source_ref = s.source_ref OR o.account_id = s.account_id OR o.activation_id = s.activation_id
    ORDER BY o.stream_id COLLATE "C", o.sequence, o.event_id LIMIT 1001
  ), origins AS (
    SELECT o.record_id AS "recordId", f.initial_import_key AS "initialImportKey", f.initial_receipt_id AS "initialReceiptId",
      f.sync_receipt_id AS "syncReceiptId", COALESCE(i.receipt_digest, r.receipt_digest) AS "receiptDigest"
    FROM (SELECT DISTINCT account_id, company_id, seller_entity_id, record_id FROM outcomes) o
    LEFT JOIN runtime_financial_origins f USING (account_id, company_id, seller_entity_id, record_id)
    LEFT JOIN runtime_activation_imports i ON (i.account_id, i.company_id, i.seller_entity_id, i.idempotency_key, i.receipt_id)
      = (f.account_id, f.company_id, f.seller_entity_id, f.initial_import_key, f.initial_receipt_id)
    LEFT JOIN runtime_sync_receipts r ON (r.account_id, r.company_id, r.seller_entity_id, r.receipt_id)
      = (f.account_id, f.company_id, f.seller_entity_id, f.sync_receipt_id)
  ), bounds AS (
    SELECT (SELECT count(*) FROM positions) > 1000 OR (SELECT count(*) FROM inbox) > 1000 OR
      (SELECT count(*) FROM pages) > 1000 OR (SELECT count(*) FROM deliveries) > 1000 OR
      (SELECT count(*) FROM units) > 1000 OR (SELECT count(*) FROM outcomes) > 1000 OR
      EXISTS (SELECT 1 FROM checkpoints WHERE capture_cursor - baseline_cursor > 1000) AS overflow,
      COALESCE((SELECT sum(event_count::bigint) FROM pages), 0) > 1000 AS oversized_pages
  )
  SELECT s.*, ARRAY(SELECT to_jsonb(l) FROM lanes l) AS lanes,
    ARRAY(SELECT jsonb_build_object('stream_id', stream_id, 'transport', transport, 'baseline_cursor', baseline_cursor::text,
      'capture_cursor', capture_cursor::text, 'captured_pages', captured_pages::text, 'last_captured_at', last_captured_at)
      FROM checkpoints ORDER BY stream_id COLLATE "C") AS checkpoints,
    ARRAY(SELECT to_jsonb(h) FROM heads h ORDER BY stream_id COLLATE "C") AS heads,
    ARRAY(SELECT to_jsonb(p) FROM positions p ORDER BY stream_id COLLATE "C", sequence::bigint) AS positions,
    ARRAY(SELECT to_jsonb(i) FROM inbox i ORDER BY stream_id COLLATE "C", sequence::bigint, manifest_hash) AS inbox,
    ARRAY(SELECT to_jsonb(d) - 'stream_id' - 'sequence' FROM deliveries d ORDER BY stream_id COLLATE "C", sequence, event_id) AS deliveries,
    CASE WHEN bounds.overflow OR bounds.oversized_pages THEN ARRAY[]::jsonb[]
      ELSE ARRAY(SELECT to_jsonb(p) FROM pages p ORDER BY stream_id COLLATE "C", after_cursor::bigint, manifest_hash) END AS pages,
    ARRAY(SELECT to_jsonb(u) FROM units u ORDER BY from_cursor::bigint, unit_hash) AS units,
    ARRAY(SELECT to_jsonb(o) FROM outcomes o ORDER BY stream_id COLLATE "C", sequence::bigint, event_id) AS outcomes,
    ARRAY(SELECT to_jsonb(o) FROM origins o ORDER BY "recordId" COLLATE "C") AS origins,
    jsonb_build_object(
      'overflow', bounds.overflow,
      'extraLane', (SELECT count(*) FROM lanes) > 1,
      'undeclaredStream',
        (SELECT count(*) FROM checkpoints) > 2 OR
        EXISTS (SELECT 1 FROM runtime_source_positions p WHERE p.source_ref = s.source_ref AND
          NOT EXISTS (SELECT 1 FROM checkpoints c WHERE c.stream_id = p.stream_id)),
      'nonselectedPostBaseline',
        EXISTS (SELECT 1 FROM checkpoints WHERE transport = 'semantic' AND capture_cursor > baseline_cursor),
      'outOfCut', bounds.oversized_pages OR
        EXISTS (SELECT 1 FROM runtime_capture_checkpoints c WHERE c.source_ref = s.source_ref AND c.manifest_hash <> s.manifest_hash) OR
        EXISTS (SELECT 1 FROM runtime_source_positions p JOIN checkpoints c USING (source_ref, stream_id)
          WHERE p.source_ref = s.source_ref AND p.sequence > c.capture_cursor) OR
        EXISTS (SELECT 1 FROM runtime_inbox i WHERE i.source_ref = s.source_ref AND NOT EXISTS (
          SELECT 1 FROM checkpoints c WHERE (c.manifest_hash, c.stream_id) = (i.manifest_hash, i.stream_id)
            AND i.sequence > c.baseline_cursor AND i.sequence <= c.capture_cursor)) OR
        EXISTS (SELECT 1 FROM runtime_capture_pages p WHERE p.source_ref = s.source_ref AND NOT EXISTS (
          SELECT 1 FROM checkpoints c WHERE (c.manifest_hash, c.stream_id) = (p.manifest_hash, p.stream_id)
            AND p.after_cursor >= c.baseline_cursor AND p.next_cursor <= c.capture_cursor)) OR
        EXISTS (SELECT 1 FROM runtime_deliveries d WHERE d.source_ref = s.source_ref AND NOT EXISTS (
          SELECT 1 FROM runtime_source_positions p WHERE (p.source_ref, p.event_id) = (d.source_ref, d.event_id))) OR
        EXISTS (SELECT 1 FROM baseline_events b WHERE NOT EXISTS (
          SELECT 1 FROM runtime_source_positions p JOIN runtime_deliveries d USING (source_ref, event_id)
          WHERE (p.source_ref, p.stream_id, p.event_id) = (s.source_ref, b.event->>'streamId', b.event->>'id')
            AND to_jsonb(p.sequence) = b.event->'sequence' AND d.content_hash = b.event->>'contentHash'
            AND d.digest = encode(sha256(convert_to(d.canonical, 'UTF8')), 'hex')
            AND parent_index_projection(d.canonical) = b.event)) OR
        EXISTS (SELECT 1 FROM runtime_source_positions p JOIN checkpoints c USING (source_ref, stream_id)
          WHERE p.source_ref = s.source_ref AND p.sequence <= c.baseline_cursor AND NOT EXISTS (
            SELECT 1 FROM baseline_events b WHERE p.event_id = b.event->>'id' AND p.stream_id = b.event->>'streamId'
              AND to_jsonb(p.sequence) = b.event->'sequence')),
      'incident', EXISTS (SELECT 1 FROM runtime_capture_incidents i WHERE i.source_ref = s.source_ref),
      'unmatchedLegacyHistory',
        EXISTS (SELECT 1 FROM runtime_sync_receipts r WHERE r.account_id = s.account_id AND NOT EXISTS (
          SELECT 1 FROM runtime_sync_units u WHERE (u.account_id, u.company_id, u.seller_entity_id, u.receipt_id)
            = (r.account_id, r.company_id, r.seller_entity_id, r.receipt_id))) OR
        EXISTS (SELECT 1 FROM runtime_sync_delivery_outcomes o WHERE (o.account_id = s.account_id OR o.source_ref = s.source_ref)
          AND NOT EXISTS (SELECT 1 FROM runtime_sync_event_outcomes n
            WHERE (n.source_ref, n.event_id) = (o.source_ref, o.event_id)))
    ) AS guards,
    (SELECT to_jsonb(h) || jsonb_build_object('epoch', h.epoch::text)
      FROM runtime_authority_heads h WHERE h.account_id = s.account_id) AS authority,
    EXISTS (SELECT 1 FROM runtime_authority_commands a WHERE a.account_id = s.account_id) AS authority_history,
    (SELECT jsonb_build_object('version', t.target_version::text, 'hash', t.snapshot_hash)
      FROM parent_targets t WHERE (t.account_id, t.company_id, t.seller_entity_id) =
        (s.account_id, s.company_id, s.seller_entity_id)) AS target
  FROM source s CROSS JOIN bounds
`;

const captureSchema = setOf(CaptureStreamSchema, stream => stream.streamId);

function position(row: PositionRow) {
  return { sourceRef: row.source_ref, streamId: row.stream_id, sequence: readVersion(row.sequence), eventId: row.event_id };
}

function sameBinding(row: BoundRow, identity: CommittedAuthorityIdentityV1, lane: CoverageCut['lane']) {
  return equal(scopeOf(row), identity.scope) && row.activation_id === identity.activationId &&
    row.bundle_hash === identity.bundleHash && row.source_ref === lane.sourceRef && row.manifest_hash === lane.manifestHash;
}

function readPages(raw: CutRow, deliveryById: Map<string, CoverageCut['deliveries'][number]['event']>) {
  return raw.pages.map(row => {
    const page = decodeCanonical(ChangePageSchema, row.canonical, row.digest);
    const eventCount = readVersion(row.event_count);
    requireSync(page.sourceRef === row.source_ref && page.streamId === row.stream_id && page.after === row.after_cursor &&
      page.next === row.next_cursor && page.complete && page.events.length === eventCount &&
      page.events.every(event => {
        const delivery = deliveryById.get(event.id);
        return delivery !== undefined && equal(delivery, event);
      }));
    return {
      sourceRef: row.source_ref, manifestHash: row.manifest_hash, streamId: row.stream_id, afterCursor: row.after_cursor,
      nextCursor: row.next_cursor, eventCount, digest: row.digest, capturedAt: row.captured_at,
    };
  });
}

function decodeCut(raw: CutRow, identity: CommittedAuthorityIdentityV1) {
  requireSync(!raw.guards.unmatchedLegacyHistory);
  requireSync(!raw.guards.extraLane && !raw.guards.overflow && !raw.guards.undeclaredStream, 'SYNC_COVERAGE_UNSUPPORTED');
  const [laneRow] = raw.lanes;
  requireSync(laneRow && laneRow.manifest_hash === raw.manifest_hash, 'SYNC_COVERAGE_UNSUPPORTED');
  requireSync(!raw.guards.outOfCut);
  const lane = { schemaVersion: '1' as const, sourceRef: raw.source_ref, manifestHash: raw.manifest_hash };
  const activation = decodeCanonical(CustomerActivationSchema, raw.activation, raw.activation_digest);
  const bundle = decodeCanonical(ActivationBundleV2Schema, raw.bundle, raw.bundle_digest);
  const receipt = decodeCanonical(SyncReceiptSchema, raw.receipt, raw.receipt_digest);
  const manifest = decodeCanonical(BootstrapManifestSchema, laneRow.manifest_canonical, laneRow.manifest_digest);
  const capture = decodeCanonical(captureSchema, laneRow.capture_canonical, laneRow.capture_digest);
  requireSync(sameBinding(raw, identity, lane) && laneRow.source_ref === lane.sourceRef && laneRow.manifest_hash === lane.manifestHash &&
    bundle.hash === identity.bundleHash && activation.id === identity.activationId && equal(activation.scope, identity.scope) &&
    activation.manifestHash === manifest.hash && activation.artifactHash === bundle.artifact.hash &&
    activation.profileHash === bundle.request.expectedProfileHash && bundle.request.idempotencyKey === raw.idempotency_key &&
    receipt.id === raw.receipt_id && receipt.activationId === activation.id && equal(receipt.scope, identity.scope) &&
    receipt.artifactHash === activation.artifactHash && receipt.epoch === activation.epoch &&
    equal(manifest, bundle.manifest) && equal(capture, bundle.artifact.normalizedPlan.capture) &&
    activation.baselineCursors.length === manifest.streams.length &&
    activation.baselineCursors.every(({ streamId, resumeAfter }) =>
      manifest.streams.some(stream => stream.streamId === streamId && stream.resumeAfter === resumeAfter)));
  requireSync(capture.length === 2 && manifest.streams.length === 2, 'SYNC_COVERAGE_UNSUPPORTED');
  requireSync(raw.checkpoints.length === 2 && raw.checkpoints.every(row =>
    capture.some(stream => stream.streamId === row.stream_id && stream.transport === row.transport) &&
    manifest.streams.some(stream => stream.streamId === row.stream_id && stream.resumeAfter === row.baseline_cursor)));
  requireSync(!raw.guards.nonselectedPostBaseline && !raw.guards.incident, 'SYNC_COVERAGE_UNSUPPORTED');
  const profile = selectedProfile(bundle);
  const deliveries = raw.deliveries.map(row => {
    const event = decodeCanonical(RawSourceEventSchema, row.canonical, row.digest);
    requireSync(event.id === row.event_id && event.sourceRef === row.source_ref && event.contentHash === row.content_hash);
    return { event, digest: row.digest };
  });
  const deliveryById = new Map(deliveries.map(row => [row.event.id, row.event]));
  const coverage = CoverageCutSchema.parse({
    identity, lane, manifest, capture, manifestDigest: laneRow.manifest_digest, captureDigest: laneRow.capture_digest,
    initialActivationId: laneRow.initial_activation_id, initializedAt: laneRow.initialized_at,
    baseline: {
      importKey: raw.idempotency_key, receiptId: receipt.id, activationDigest: raw.activation_digest,
      bundleDigest: raw.bundle_digest, approvedSnapshotHash: raw.approved_snapshot_hash,
      approvedTargetVersion: readVersion(raw.target_version),
    },
    checkpoints: raw.checkpoints.map(row => ({
      streamId: row.stream_id, transport: row.transport, baselineCursor: row.baseline_cursor, captureCursor: row.capture_cursor,
      capturedPages: row.captured_pages, lastCapturedAt: row.last_captured_at,
    })),
    applicationHeads: raw.heads.map(row => {
      requireSync(sameBinding(row, identity, lane));
      return {
        streamId: row.stream_id, baselineCursor: row.baseline_cursor,
        appliedThrough: row.applied_through, lastUnitHash: row.last_unit_hash,
      };
    }),
    positions: raw.positions.map(position),
    inbox: raw.inbox.map(row => ({ ...position(row), manifestHash: row.manifest_hash, afterCursor: row.after_cursor })),
    deliveries,
    pages: readPages(raw, deliveryById),
    historyUnits: raw.units.map(row => {
      requireSync(sameBinding(row, identity, lane));
      return {
        unitHash: row.unit_hash, auditDigest: row.audit_digest, streamId: row.stream_id,
        fromCursor: row.from_cursor, throughCursor: row.through_cursor,
        beforeTargetVersion: readVersion(row.before_version), beforeSnapshotHash: row.before_snapshot_hash,
        afterTargetVersion: readVersion(row.after_version), afterSnapshotHash: row.after_snapshot_hash, receiptId: row.receipt_id,
      };
    }),
    historyOutcomes: raw.outcomes.map(row => {
      const outcome = decodeCanonical(SyncEventOutcomeSchema, row.canonical, row.digest);
      const event = deliveryById.get(row.event_id);
      requireSync(event && sameBinding(row, identity, lane) && equal(outcome.identity, identity) && equal(outcome.lane, lane) &&
        row.stream_id === event.streamId && readVersion(row.sequence) === event.sequence &&
        equal(outcome.event, syncEventRef(event)) && row.record_id === outcome.recordId &&
        row.unit_hash === outcome.unitHash && row.disposition === outcome.disposition);
      return { event: outcome.event, recordId: outcome.recordId, unitHash: outcome.unitHash, disposition: outcome.disposition, digest: row.digest };
    }),
    historyOrigins: raw.origins,
    guards: raw.guards,
  });
  const selected = validateCoverage(coverage);
  requireSync(deliveries.every(({ event }) => profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId ?? '') &&
    event.semanticVersion === profile.semanticVersion), 'SYNC_COVERAGE_UNSUPPORTED');
  return { coverage, selected, activation, bundle, profile };
}

async function storageRead<T>(read: () => T | Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof SyncApplyError || error instanceof AuthorityError || /^[0-9A-Z]{5}$/.test(sqlState(error) ?? '')) throw error;
    throw new SyncApplyError('SYNC_STORAGE_INVALID');
  }
}

async function readCut(client: PoolClient, input: CommittedAuthorityIdentityV1) {
  const parsed = CommittedAuthorityIdentityV1Schema.safeParse(input);
  requireSync(parsed.success, 'SYNC_BINDING_MISMATCH');
  const identity = parsed.data;
  const { rows: [raw] } = await client.query<CutRow>(coverageSql, [...scopeValues(identity.scope), identity.activationId, identity.bundleHash]);
  requireSync(raw, 'SYNC_BINDING_MISMATCH');
  return storageRead(() => ({ raw, ...decodeCut(raw, identity) }));
}

export async function readCoverageCut(client: PoolClient, identity: CommittedAuthorityIdentityV1): Promise<CoverageCut> {
  return (await readCut(client, identity)).coverage;
}

function readEpoch(cut: Awaited<ReturnType<typeof readCut>>) {
  const { raw, activation, coverage: { identity, lane, baseline } } = cut;
  const initial = CurrentAuthorityV1Schema.parse({
    schemaVersion: '1', identity, sourceRef: lane.sourceRef, artifactHash: activation.artifactHash,
    profileHash: activation.profileHash, manifestHash: lane.manifestHash,
    status: 'active', epoch: activation.epoch, changedAt: activation.approvedAt,
  });
  const row = raw.authority;
  if (!row) {
    requireSync(!raw.authority_history);
    return initial.epoch;
  }
  const grant = decodeCanonical(CurrentAuthorityV1Schema, row.grant_canonical, row.grant_digest);
  requireSync(equal(grant, initial) && equal(scopeOf(row), identity.scope) &&
    row.initial_import_key === baseline.importKey && row.initial_receipt_id === baseline.receiptId);
  const state = CurrentAuthorityV1Schema.parse({ ...grant, epoch: readVersion(row.epoch), status: row.status, changedAt: row.changed_at });
  requireSync(state.changedAt === row.changed_at && (state.epoch > initial.epoch || equal(state, initial)));
  if (state.status !== 'active') throw authorityError('AUTHORITY_INACTIVE');
  return state.epoch;
}

function originBinding(origin: ReceiptOrigin): CoverageCut['historyOrigins'][number] {
  return {
    recordId: origin.recordId, receiptDigest: hashCanonical(origin.receipt),
    initialImportKey: origin.kind === 'initial' ? origin.importKey : null,
    initialReceiptId: origin.kind === 'initial' ? origin.receipt.id : null,
    syncReceiptId: origin.kind === 'sync' ? origin.receipt.id : null,
  };
}

function unitBinding(audit: SyncUnitAudit): CoverageCut['historyUnits'][number] {
  return {
    unitHash: audit.unitHash, auditDigest: hashCanonical(audit), streamId: audit.streamId,
    fromCursor: audit.fromCursor, throughCursor: audit.throughCursor,
    beforeTargetVersion: audit.expectedTargetVersion, beforeSnapshotHash: audit.beforeSnapshotHash,
    afterTargetVersion: audit.afterTargetVersion, afterSnapshotHash: audit.afterSnapshotHash, receiptId: audit.receiptId,
  };
}

async function validateHistory(client: PoolClient, cut: CoverageCut) {
  const tip = cut.historyUnits.at(-1);
  if (!tip) return;
  // The accepted history reader validates all earlier flat references via exact immutable keys.
  const audit = await readSyncUnit(client, cut.identity, tip.unitHash);
  requireSync(audit && equal(cut.historyUnits, [...audit.coverage.historyUnits, unitBinding(audit)]));
  const outcomes = audit.members.map(({ event, recordId, disposition, origin }) => ({
    event, recordId, disposition, unitHash: audit.unitHash,
    digest: hashCanonical({ identity: cut.identity, lane: cut.lane, unitHash: audit.unitHash, event, recordId, disposition, origin }),
  }));
  requireSync(equal(cut.historyOutcomes, [...audit.coverage.historyOutcomes, ...outcomes]));
  const origins = new Map(audit.coverage.historyOrigins.map(row => [row.recordId, row]));
  for (const { origin } of audit.members) {
    const binding = originBinding(origin);
    requireSync(!origins.has(binding.recordId) || equal(origins.get(binding.recordId), binding));
    origins.set(binding.recordId, binding);
  }
  requireSync(cut.historyOrigins.length === origins.size && cut.historyOrigins.every(row => equal(row, origins.get(row.recordId))));
}

function prerequisiteLinks(record: FinancialRecord): [TypedPrerequisite['relation'], string][] {
  if (record.kind === 'allocation') return [
    ['allocation_funding', fundingIdFor(record)], ['allocation_invoice', invoiceIdFor(record)],
  ];
  if (record.kind === 'reversal') return [['reversal_original', referenceId(record, record.reversedKind, record.reversedRecordId)]];
  return [];
}

export function classifyCapturedGroup(
  { activation, artifact, profile, identity, events }: {
    activation: Pick<CustomerActivation, 'allowedKinds' | 'limits'>; artifact: CompiledArtifact; profile: CustomerProfile;
    identity: CommittedAuthorityIdentityV1; events: RawSourceEvent[];
  },
  target: StoredTarget, asOf: string,
) {
  const limits = artifact.normalizedPlan.limits;
  requireSync(artifact.compilerVersion === '1' && artifact.runtimeVersion === '1' &&
    events.length <= limits.maxRecordsPerCycle && events.length <= activation.limits.maxRecordsPerCycle &&
    events.every(event => event.kind !== 'semantic_change' && activation.allowedKinds.includes(event.kind)), 'SYNC_COVERAGE_UNSUPPORTED');
  const inputTarget = { ...target.records, asOf };
  const { details, outcome } = classifyBatch(artifact, profile, events, inputTarget);
  requireSync(details.kind === 'classified' && outcome.holds.length === 0 && details.sourceBlockers.length === 0 &&
    details.groups.length === 1 && details.groups[0]!.disposition === 'accepted' &&
    details.groups[0]!.holdIndexes.length === 0 && outcome.plans.length <= 1 &&
    details.items.length === events.length &&
    equal(details.groups[0]!.inputIndexes, events.map((_, index) => index)), 'SYNC_COVERAGE_UNSUPPORTED');
  requireSync(equal(details.binding, {
    scope: identity.scope, artifactHash: artifact.hash, profileHash: profile.hash,
    expectedTargetVersion: target.records.version, targetSnapshotHash: hashTargetSnapshot(inputTarget), asOf,
  }), 'SYNC_INVALID_PLAN');
  const plan = outcome.plans[0] ?? null;
  if (plan) {
    requireSync(plan.artifactHash === artifact.hash && plan.profileHash === profile.hash, 'SYNC_INVALID_PLAN');
    validatePlanIndexes(plan, { identity, expectedTargetVersion: target.records.version, asOf, events });
  }

  const existing = new Map(financialRecords(target.records).map(record => [record.id, record]));
  const newIndexes = new Set<number>();
  const replayRecords = new Map<string, FinancialRecord>();
  const indexed = details.items.map((item, inputIndex) => {
    const event = events[inputIndex]!;
    requireSync(item.disposition === 'financial_new' || item.disposition === 'financial_replay' ||
      item.disposition === 'financial_coalesced', 'SYNC_COVERAGE_UNSUPPORTED');
    const { mapped } = item;
    requireSync(item.inputIndex === inputIndex && item.groupIndex === 0 && equal(item.event, syncEventRef(event)) &&
      equal(mapped.scope, identity.scope) &&
      equal(mapped.identity, {
        sourceRef: event.sourceRef, sellerEntityId: identity.scope.sellerEntityId, kind: event.kind, recordId: event.recordId,
      }) && mapped.targetRecordId === targetRecordId(mapped.identity), 'SYNC_INVALID_PLAN');
    let record;
    if (item.disposition === 'financial_replay') {
      record = existing.get(mapped.targetRecordId);
      requireSync(record && equal(item.existing, {
        identity: record.identity, targetRecordId: record.id,
        sourceEventId: record.sourceEventId, sourceRecordVersion: record.sourceRecordVersion,
      }), 'SYNC_INVALID_PLAN');
      replayRecords.set(record.id, record);
    } else {
      const producer = item.disposition === 'financial_new' ? item : details.items[item.producerInputIndex];
      requireSync(producer?.disposition === 'financial_new' && producer.planIndex === 0 &&
        (item.disposition === 'financial_new' || item.producerInputIndex < inputIndex), 'SYNC_INVALID_PLAN');
      record = plan?.operations[producer.operationIndex]?.record;
      requireSync(record && 'identity' in record && record.sourceEventId === events[producer.inputIndex]?.id &&
        record.sourceRecordVersion === events[producer.inputIndex]?.recordVersion && !existing.has(record.id), 'SYNC_INVALID_PLAN');
      if (item.disposition === 'financial_new') {
        requireSync(!newIndexes.has(item.operationIndex), 'SYNC_INVALID_PLAN');
        newIndexes.add(item.operationIndex);
      }
    }
    requireSync(record.id === mapped.targetRecordId && equal(record.identity, mapped.identity) &&
      equal(record.scope, mapped.scope), 'SYNC_INVALID_PLAN');
    if ('amountCents' in record) {
      requireSync(Number.isSafeInteger(record.amountCents) && record.amountCents <= limits.maxTransactionCents &&
        record.amountCents <= activation.limits.maxTransactionCents, 'SYNC_INVALID_PLAN');
    }
    return { mapped, record, disposition: item.disposition };
  });
  requireSync(newIndexes.size === (plan?.operations.length ?? 0) &&
    (plan !== null || details.items.every(item => item.disposition === 'financial_replay')), 'SYNC_INVALID_PLAN');

  const providers = new Map<string, number[]>();
  for (const [index, { record }] of indexed.entries()) {
    const providerIndexes = providers.get(record.id) ?? [];
    providerIndexes.push(index);
    providers.set(record.id, providerIndexes);
  }
  for (const { mapped, record } of indexed) {
    const links = prerequisiteLinks(record);
    requireSync(links.length === mapped.prerequisites.length, 'SYNC_INVALID_PLAN');
    for (const [relation, targetId] of links) {
      const prerequisite = mapped.prerequisites.find(value => value.relation === relation);
      const providerInputIndexes = providers.get(targetId);
      const prior = existing.get(targetId);
      const provided = providerInputIndexes && indexed[providerInputIndexes[0]!]!.record;
      const resolved = prior ?? provided;
      requireSync(prerequisite && resolved && prerequisite.targetRecordId === targetId &&
        equal(prerequisite.scope, resolved.scope) && equal(prerequisite.identity, resolved.identity) &&
        targetRecordId(prerequisite.identity) === targetId &&
        equal(prerequisite.presence, prior ? { kind: 'target' } : { kind: 'candidate', providerInputIndexes }), 'SYNC_INVALID_PLAN');
    }
  }
  return { plan, replayRecords: [...replayRecords.values()], items: indexed };
}

/** Observe and classify the whole captured suffix without acquiring locks or issuing writes. */
export async function prepareCapturedUnit(
  client: PoolClient, identity: CommittedAuthorityIdentityV1, inputAsOf: string,
): Promise<PreparedSyncUnit> {
  const asOf = IsoInstantSchema.safeParse(inputAsOf);
  requireSync(asOf.success, 'SYNC_INVALID_PLAN');
  const cut = await readCut(client, identity);
  const { raw, coverage, selected } = cut;
  return storageRead(async () => {
    const expectedEpoch = readEpoch(cut);
    const stored = await readStoredActivation(client, identity.scope);
    requireSync(stored && stored.bundleHash === identity.bundleHash && equal(stored.activation, cut.activation) &&
      equal(stored.bundle, cut.bundle) && stored.request.idempotencyKey === coverage.baseline.importKey &&
      stored.receipt.id === coverage.baseline.receiptId && stored.approvedTarget.snapshotHash === coverage.baseline.approvedSnapshotHash &&
      stored.approvedTarget.records.version === coverage.baseline.approvedTargetVersion);
    await validateHistory(client, coverage);
    const { target: pointer } = raw;
    requireSync(pointer);
    requireSync(readVersion(pointer.version) === selected.beforeVersion && pointer.hash === selected.beforeHash, 'SYNC_TARGET_STALE');
    const target = await readStoredTarget(client, identity.scope, pointer.hash);
    requireSync(target && target.records.version === selected.beforeVersion && target.snapshotHash === selected.beforeHash);
    requireSync(selected.events.length > 0, 'SYNC_NO_PENDING');
    const { plan, replayRecords } = classifyCapturedGroup({
      activation: cut.activation, artifact: cut.bundle.artifact, profile: cut.profile, identity, events: selected.events,
    }, target, asOf.data);
    await readFinancialOrigins(client, identity.scope, replayRecords);
    return freezeJson(PreparedSyncUnitSchema.parse({
      identity, lane: coverage.lane, streamId: selected.streamId, expectedEpoch, expectedTargetVersion: selected.beforeVersion,
      beforeSnapshotHash: selected.beforeHash, asOf: asOf.data, coverage, coverageHash: hashCanonical(coverage),
      events: selected.events, plan,
    }));
  });
              }
