import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  AllocationSchema, CommittedAuthorityIdentityV1Schema, FullReversalSchema, FundingSchema, HashSchema, InvoiceSchema,
  MutationPlanSchema, RawSourceEventSchema, ScopeSchema, SyncReceiptSchema, canonicalJson, hashCanonical, hashEvent,
  hashPlan, hashTargetSnapshot, targetRecordId, unique,
  type CommittedAuthorityIdentityV1, type MutationPlan, type RawSourceEvent, type ReceiptResponse,
  type Scope, type SyncReceipt, type TargetState, type EconomicIdentity,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { financialRecords, sameScope, type FinancialRecord } from '@eapr/finance/validate';
import { sqlState } from '@eapr/storage/transaction';
import { readStoredActivation, type StoredActivation } from './activation-store.js';
import { requireImportIdentityLocks, type ImportIdentityLocks } from './persistence.js';
import {
  decodeCanonical, decodeSnapshot, encodeCanonical, readVersion, scopeOf, scopeValues, validateSnapshot,
  type ScopeRow, type SnapshotRow, type StoredTarget,
} from './snapshots.js';
import { projectTarget, type FinancialMutation } from './state.js';
import { ReceiptOriginSchema, SyncEventOutcomeSchema, SyncUnitAuditSchema, syncEventRef, type CoverageCut, type ReceiptOrigin, type ReplayResponse, type SyncUnitAudit, type UnitMember } from './sync-types.js';

export * from './sync-types.js';

export type SyncUnitCommit = {
  audit: SyncUnitAudit; previous: StoredTarget; next: TargetState;
  plan: MutationPlan | null; receipt: SyncReceipt | null; members: UnitMember[];
  identities: readonly EconomicIdentity[]; identityLocks: ImportIdentityLocks;
  expectedHeads: CoverageCut['applicationHeads'];
};

export class SyncStoreError extends Error {
  constructor(readonly code: 'SYNC_STORE_INVALID', message: string) {
    super(message);
    this.name = 'SyncStoreError';
  }
}

function valid(condition: unknown): asserts condition {
  if (!condition) throw new SyncStoreError('SYNC_STORE_INVALID', 'Invalid synchronization history binding');
}

async function storageRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof SyncStoreError || /^[0-9A-Z]{5}$/.test(sqlState(error) ?? '')) throw error;
    throw new SyncStoreError('SYNC_STORE_INVALID', 'Invalid synchronization history');
  }
}

const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const financialRecord = z.union([InvoiceSchema, FundingSchema, AllocationSchema, FullReversalSchema]);

type ReceiptRow = ScopeRow & {
  receipt_id: string; plan_hash: string; activation_id: string; epoch: string; before_version: string; after_version: string;
  after_snapshot_hash: string; receipt: string; receipt_digest: string; plan: string; plan_digest: string;
};
type UnitRow = ScopeRow & {
  unit_hash: string; activation_id: string; bundle_hash: string; source_ref: string; manifest_hash: string; stream_id: string;
  epoch: string; from_cursor: string; through_cursor: string; before_version: string; before_snapshot_hash: string;
  after_version: string; after_snapshot_hash: string; receipt_id: string | null; audit: string; audit_digest: string;
};
type FinancialOriginRow = ScopeRow & {
  record_id: string; source_ref: string; kind: string; source_record_id: string; source_record_version: string; event_id: string;
  canonical: string; digest: string; initial_import_key: string | null; initial_receipt_id: string | null;
  sync_receipt_id: string | null; initial_count: number; sync_count: number;
  initial_key: string | null; initial_id: string | null; sync_id: string | null;
};

function activationIdentity(stored: StoredActivation): CommittedAuthorityIdentityV1 {
  return { scope: stored.activation.scope, activationId: stored.activation.id, bundleHash: stored.bundleHash };
}

async function readActivation(client: PoolClient, scope: Scope, identity?: CommittedAuthorityIdentityV1) {
  const stored = await readStoredActivation(client, scope);
  valid(stored && (!identity || equal(identity, activationIdentity(stored))));
  return stored;
}

function lineageBindsOperation(plan: MutationPlan) {
  return plan.lineage.every(lineage => {
    let value: unknown = plan.operations[lineage.operationIndex]?.record;
    for (const segment of lineage.targetField.slice(1).split('/')) {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
      value = (value as Record<string, unknown>)[key];
    }
    return value !== undefined && lineage.sourceEventIds.every(id => plan.eventIds.includes(id));
  });
}

type VerifiedReceipt = Awaited<ReturnType<typeof readReceiptCore>>;
type HistoryRead = {
  receipts: Map<string, VerifiedReceipt>;
  snapshots: Map<number, StoredTarget>;
};

function historyRead(stored: StoredActivation): HistoryRead {
  return {
    receipts: new Map(),
    snapshots: new Map([[stored.approvedTarget.records.version, stored.approvedTarget]]),
  };
}

async function readHistoricalSnapshot(
  client: PoolClient, scope: Scope, version: number, history: HistoryRead, expectedHash?: string,
) {
  let snapshot = history.snapshots.get(version);
  if (!snapshot) {
    const { rows: [row] } = await client.query<SnapshotRow>(
      `SELECT * FROM parent_snapshots WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3
        AND target_version = $4`, [...scopeValues(scope), version],
    );
    valid(row);
    snapshot = decodeSnapshot(row);
    valid(sameScope(snapshot.records.scope, scope) && snapshot.records.version === version);
    history.snapshots.set(version, snapshot);
  }
  valid(expectedHash === undefined || snapshot.snapshotHash === expectedHash);
  return snapshot;
}

async function readReceiptCore(client: PoolClient, row: ReceiptRow, stored: StoredActivation, history: HistoryRead) {
  const { activation, bundle } = stored;
  const { scope } = activation;
  const plan = decodeCanonical(MutationPlanSchema, row.plan, row.plan_digest);
  const receipt = decodeCanonical(SyncReceiptSchema, row.receipt, row.receipt_digest);
  const beforeVersion = readVersion(row.before_version);
  const afterVersion = readVersion(row.after_version);
  const operations = plan.operations.filter((operation): operation is FinancialMutation => 'identity' in operation.record);
  const records = operations.map(operation => operation.record);
  valid(sameScope(scopeOf(row), scope) && sameScope(plan.scope, scope) && sameScope(receipt.scope, scope) &&
    plan.hash === row.plan_hash && hashPlan(plan) === plan.hash &&
    receipt.id === row.receipt_id && receipt.planHash === plan.hash &&
    row.activation_id === activation.id && receipt.activationId === activation.id && receipt.epoch === readVersion(row.epoch) &&
    receipt.artifactHash === activation.artifactHash && plan.artifactHash === activation.artifactHash &&
    plan.profileHash === activation.profileHash && plan.expectedTargetVersion === beforeVersion &&
    beforeVersion >= stored.approvedTarget.records.version && afterVersion === beforeVersion + 1 &&
    operations.length === plan.operations.length && operations.length > 0 &&
    plan.eventIds.length > 0 && plan.eventIds.length <= activation.limits.maxRecordsPerCycle &&
    operations.length <= activation.limits.maxRecordsPerCycle &&
    unique(plan.eventIds, id => id) && unique(records, record => record.id) &&
    records.every(record => sameScope(record.scope, scope) && record.identity.sourceRef === bundle.manifest.sourceRef &&
      activation.allowedKinds.includes(record.kind) && plan.eventIds.includes(record.sourceEventId)) &&
    equal(plan.eventIds, receipt.eventIds) && equal(records.map(record => record.id), receipt.targetRecordIds) &&
    lineageBindsOperation(plan));

  const before = await readHistoricalSnapshot(client, scope, beforeVersion, history);
  const after = await readHistoricalSnapshot(client, scope, afterVersion, history, row.after_snapshot_hash);
  const projected = { ...projectTarget({ ...before.records, asOf: plan.asOf }, operations), version: afterVersion };
  valid(equal(projected, after.records) && receipt.beforeBalanceCents === computeBalance(before.records, plan.asOf) &&
    receipt.afterBalanceCents === computeBalance(after.records, plan.asOf) &&
    receipt.afterBalanceCents === plan.expectedBalanceCents);
  return { receipt, plan, records, before, after };
}

function receiptByPlan(client: PoolClient, scope: Scope, hash: string) {
  return client.query<ReceiptRow>(
    'SELECT * FROM runtime_sync_receipts WHERE account_id = $1 AND plan_hash = $2', [scope.accountId, hash],
  ).then(result => result.rows[0]);
}

async function readHistoricalReceipt(client: PoolClient, receiptId: string, stored: StoredActivation, history: HistoryRead) {
  let saved = history.receipts.get(receiptId);
  if (!saved) {
    const { rows: [row] } = await client.query<ReceiptRow>(
      'SELECT * FROM runtime_sync_receipts WHERE receipt_id = $1', [receiptId],
    );
    valid(row && row.receipt_id === receiptId);
    saved = await readReceiptCore(client, row, stored, history);
    history.receipts.set(receiptId, saved);
  }
  return saved;
}

function recordForEvent(scope: Scope, event: RawSourceEvent) {
  valid(event.kind !== 'semantic_change' && event.rawIdentity.companyId === scope.companyId &&
    event.rawIdentity.sellerEntityId === scope.sellerEntityId);
  return targetRecordId({
    sourceRef: event.sourceRef, sellerEntityId: scope.sellerEntityId, kind: event.kind, recordId: event.recordId,
  });
}

type DeliveryRow = { event_id: string; source_ref: string; canonical: string; digest: string; content_hash: string };
function readDelivery(row: DeliveryRow) {
  const event = decodeCanonical(RawSourceEventSchema, row.canonical, row.digest);
  valid(event.id === row.event_id && event.sourceRef === row.source_ref &&
    event.contentHash === row.content_hash && hashEvent(event) === event.contentHash);
  return event;
}

async function verifyLegacyReceiptDeliveries(client: PoolClient, stored: StoredActivation, receipt: SyncReceipt,
  records: readonly FinancialRecord[],
) {
  const { scope } = receipt;
  const { sourceRef } = stored.bundle.manifest;
  const profile = stored.bundle.profiles.find(candidate => candidate.hash === stored.activation.profileHash);
  valid(profile);
  const { rows } = await client.query<DeliveryRow & ScopeRow & { receipt_id: string; initial_association: boolean }>(`
    SELECT o.*, d.canonical, d.digest, d.content_hash, (i.event_id IS NOT NULL) AS initial_association
    FROM runtime_sync_delivery_outcomes o JOIN runtime_deliveries d USING (source_ref, event_id)
    LEFT JOIN runtime_delivery_outcomes i USING (source_ref, event_id)
    WHERE o.receipt_id = $1 OR (o.source_ref = $2 AND o.event_id = ANY($3))
  `, [receipt.id, sourceRef, receipt.eventIds]);
  const byId = new Map(records.map(record => [record.id, record]));
  valid(rows.length === receipt.eventIds.length && rows.every(row => {
    const event = readDelivery(row);
    const record = byId.get(recordForEvent(scope, event));
    return !row.initial_association && row.receipt_id === receipt.id && sameScope(scopeOf(row), scope) &&
      row.source_ref === sourceRef && receipt.eventIds.includes(row.event_id) &&
      profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId ?? '') && record !== undefined &&
      (record.sourceEventId !== event.id || record.sourceRecordVersion === event.recordVersion);
  }));
}

async function readOrigins(
  client: PoolClient, scope: Scope, records: readonly FinancialRecord[], stored: StoredActivation, history = historyRead(stored),
) {
  if (records.length === 0) return [];
  const { rows } = await client.query<FinancialOriginRow>(`
    SELECT r.*, o.initial_import_key, o.initial_receipt_id, o.sync_receipt_id,
      i.count AS initial_count, i.import_key AS initial_key, i.receipt_id AS initial_id,
      (s.record_id IS NOT NULL)::int AS sync_count, s.receipt_id AS sync_id
    FROM parent_financial_records r JOIN runtime_financial_origins o USING (account_id, company_id, seller_entity_id, record_id)
    JOIN LATERAL (
      SELECT count(*)::int AS count, min(idempotency_key) AS import_key, min(receipt_id) AS receipt_id
      FROM runtime_economic_outcomes e
      WHERE e.record_id = r.record_id AND
        (e.account_id, e.company_id, e.seller_entity_id, e.source_ref, e.kind, e.source_record_id) =
        (r.account_id, r.company_id, r.seller_entity_id, r.source_ref, r.kind, r.source_record_id)
    ) i ON TRUE
    LEFT JOIN runtime_sync_economic_outcomes s USING (account_id, company_id, seller_entity_id, record_id)
    WHERE r.record_id = ANY($1)
  `, [records.map(record => record.id)]);
  const byId = new Map(rows.map(row => [row.record_id, row]));
  const initialRecords = new Map(financialRecords(stored.approvedTarget.records).map(record => [record.id, record]));
  const origins: ReceiptOrigin[] = [];
  for (const record of records) {
    const row = byId.get(record.id);
    valid(row && sameScope(scopeOf(row), scope) && sameScope(record.scope, scope) &&
      record.id === targetRecordId(record.identity) && record.identity.sellerEntityId === scope.sellerEntityId &&
      row.source_ref === record.identity.sourceRef && row.kind === record.kind && row.source_record_id === record.identity.recordId &&
      row.event_id === record.sourceEventId && readVersion(row.source_record_version) === record.sourceRecordVersion &&
      equal(record, decodeCanonical(financialRecord, row.canonical, row.digest)));
    if (row.sync_receipt_id === null) {
      valid(row.initial_count === 1 && row.sync_count === 0 &&
        row.initial_import_key === row.initial_key && row.initial_receipt_id === row.initial_id &&
        row.initial_import_key === stored.request.idempotencyKey && row.initial_receipt_id === stored.receipt.id &&
        initialRecords.has(record.id) && equal(initialRecords.get(record.id), record));
      origins.push(ReceiptOriginSchema.parse({
        kind: 'initial', recordId: record.id, importKey: row.initial_import_key, receipt: stored.receipt,
      }));
    } else {
      valid(row.sync_count === 1 && row.initial_count === 0 && row.sync_receipt_id === row.sync_id &&
        row.initial_import_key === null && row.initial_receipt_id === null);
      const committed = await readHistoricalReceipt(client, row.sync_receipt_id, stored, history);
      valid(committed.records.some(candidate => candidate.id === record.id && equal(candidate, record)));
      origins.push(ReceiptOriginSchema.parse({ kind: 'sync', recordId: record.id, receipt: committed.receipt }));
    }
  }

  await verifyOldAssociations(client, scope, records.map((record, index) => ({
    sourceRef: record.identity.sourceRef, eventId: record.sourceEventId, origin: origins[index]!,
  })));
  return origins;
}

async function verifyOldAssociations(client: PoolClient, scope: Scope, events: readonly {
  sourceRef: string; eventId: string; origin: ReceiptOrigin;
}[]) {
  const { rows } = await client.query<ScopeRow & {
    source_ref: string; event_id: string; import_key: string | null; receipt_id: string;
  }>(`
    SELECT account_id, company_id, seller_entity_id, source_ref, event_id, idempotency_key AS import_key, receipt_id
      FROM runtime_delivery_outcomes WHERE (source_ref, event_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))
    UNION ALL
    SELECT account_id, company_id, seller_entity_id, source_ref, event_id, NULL AS import_key, receipt_id
      FROM runtime_sync_delivery_outcomes WHERE (source_ref, event_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))
  `, [events.map(event => event.sourceRef), events.map(event => event.eventId)]);
  const byDelivery = new Map(events.map(event => [canonicalJson([event.sourceRef, event.eventId]), event.origin]));
  valid(rows.every(row => {
    const origin = byDelivery.get(canonicalJson([row.source_ref, row.event_id]));
    return origin && sameScope(scopeOf(row), scope) && origin.receipt.id === row.receipt_id &&
      (origin.kind === 'initial' ? origin.importKey === row.import_key : row.import_key === null);
  }));
}

/** Resolve every requested record against both immutable origin domains. */
export async function readFinancialOrigins(
  client: PoolClient, inputScope: Scope, records: readonly FinancialRecord[],
): Promise<ReceiptOrigin[]> {
  return storageRead(async () => {
    const scope = ScopeSchema.parse(inputScope);
    if (records.length === 0) return [];
    return readOrigins(client, scope, records, await readActivation(client, scope));
  });
}

function decodeUnit(row: UnitRow) {
  const audit = decodeCanonical(SyncUnitAuditSchema, row.audit, row.audit_digest);
  valid(equal(audit.identity, { scope: scopeOf(row), activationId: row.activation_id, bundleHash: row.bundle_hash }) &&
    audit.lane.sourceRef === row.source_ref && audit.lane.manifestHash === row.manifest_hash && audit.streamId === row.stream_id &&
    audit.unitHash === row.unit_hash && audit.expectedEpoch === readVersion(row.epoch) &&
    audit.fromCursor === row.from_cursor && audit.throughCursor === row.through_cursor &&
    audit.expectedTargetVersion === readVersion(row.before_version) && audit.beforeSnapshotHash === row.before_snapshot_hash &&
    audit.afterTargetVersion === readVersion(row.after_version) && audit.afterSnapshotHash === row.after_snapshot_hash &&
    audit.receiptId === row.receipt_id);
  return audit;
}

function verifyUnitGrant(audit: SyncUnitAudit, stored: StoredActivation) {
  const { coverage, semanticObservation } = audit;
  const { bundle, activation } = stored;
  const profile = bundle.profiles.find(profile => profile.hash === activation.profileHash);
  valid(profile && equal(audit.identity, activationIdentity(stored)) && equal(coverage.manifest, bundle.manifest) && equal(coverage.capture, bundle.artifact.normalizedPlan.capture) &&
    coverage.baseline.importKey === stored.request.idempotencyKey && coverage.baseline.receiptId === stored.receipt.id &&
    coverage.baseline.activationDigest === hashCanonical(activation) && coverage.baseline.bundleDigest === hashCanonical(bundle) &&
    coverage.baseline.approvedSnapshotHash === stored.approvedTarget.snapshotHash &&
    coverage.baseline.approvedTargetVersion === stored.approvedTarget.records.version &&
    !Object.hasOwn(semanticObservation.versions, '*') && !Object.hasOwn(bundle.manifest.semanticVersions, '*') &&
    profile.sourceAccountIds.every(id => {
      const key = profile.scope.sellerEntityId + '/' + id;
      return semanticObservation.versions[key] === profile.semanticVersion && bundle.manifest.semanticVersions[key] === profile.semanticVersion;
    }) && coverage.deliveries.every(({ event }) => profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId ?? '')));
}

async function verifyUnitLane(client: PoolClient, { lane, coverage }: SyncUnitAudit) {
  const { rows: [laneRow] } = await client.query<{
    manifest_canonical: string; manifest_digest: string; capture_canonical: string; capture_digest: string;
    initial_activation_id: string; initialized_at: string;
  }>(`
    SELECT * FROM runtime_capture_lanes WHERE source_ref = $1 AND manifest_hash = $2
  `, [lane.sourceRef, lane.manifestHash]);
  valid(laneRow?.initial_activation_id === coverage.initialActivationId && laneRow.initialized_at === coverage.initializedAt &&
    laneRow.manifest_digest === coverage.manifestDigest && laneRow.capture_digest === coverage.captureDigest &&
    laneRow.manifest_canonical === canonicalJson(coverage.manifest) && laneRow.capture_canonical === canonicalJson(coverage.capture));
}

type UnitBindings = Omit<SyncUnitAudit, 'coverage'>;

async function readPriorUnits(client: PoolClient, audit: SyncUnitAudit, stored: StoredActivation) {
  const { coverage: cut } = audit;
  const origins = new Map(cut.historyOrigins.map(origin => [origin.recordId, origin]));
  const verified: UnitBindings[] = [];
import { z } from 'zod';
import {
  AllocationSchema, CommittedAuthorityIdentityV1Schema, FullReversalSchema, FundingSchema, HashSchema, InvoiceSchema,
  MutationPlanSchema, RawSourceEventSchema, ScopeSchema, SyncReceiptSchema, canonicalJson, hashCanonical, hashEvent,
  hashPlan, hashTargetSnapshot, targetRecordId, unique,
  type CommittedAuthorityIdentityV1, type MutationPlan, type RawSourceEvent, type ReceiptResponse,
  type Scope, type SyncReceipt, type TargetState, type EconomicIdentity,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { financialRecords, sameScope, type FinancialRecord } from '@eapr/finance/validate';
import { sqlState } from '@eapr/storage/transaction';
import { readStoredActivation, type StoredActivation } from './activation-store.js';
import { requireImportIdentityLocks, type ImportIdentityLocks } from './persistence.js';
import {
  decodeCanonical, decodeSnapshot, encodeCanonical, readVersion, scopeOf, scopeValues, validateSnapshot,
  type ScopeRow, type SnapshotRow, type StoredTarget,
} from './snapshots.js';
import { projectTarget, type FinancialMutation } from './state.js';
import { ReceiptOriginSchema, SyncEventOutcomeSchema, SyncUnitAuditSchema, syncEventRef, type CoverageCut, type ReceiptOrigin, type ReplayResponse, type SyncUnitAudit, type UnitMember } from './sync-types.js';

export * from './sync-types.js';

export type SyncUnitCommit = {
  audit: SyncUnitAudit; previous: StoredTarget; next: TargetState;
  plan: MutationPlan | null; receipt: SyncReceipt | null; members: UnitMember[];
  identities: readonly EconomicIdentity[]; identityLocks: ImportIdentityLocks;
  expectedHeads: CoverageCut['applicationHeads'];
};

export class SyncStoreError extends Error {
  constructor(readonly code: 'SYNC_STORE_INVALID', message: string) {
    super(message);
    this.name = 'SyncStoreError';
  }
}

function valid(condition: unknown): asserts condition {
  if (!condition) throw new SyncStoreError('SYNC_STORE_INVALID', 'Invalid synchronization history binding');
}

async function storageRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof SyncStoreError || /^[0-9A-Z]{5}$/.test(sqlState(error) ?? '')) throw error;
    throw new SyncStoreError('SYNC_STORE_INVALID', 'Invalid synchronization history');
  }
}

const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const financialRecord = z.union([InvoiceSchema, FundingSchema, AllocationSchema, FullReversalSchema]);

type ReceiptRow = ScopeRow & {
  receipt_id: string; plan_hash: string; activation_id: string; epoch: string; before_version: string; after_version: string;
  after_snapshot_hash: string; receipt: string; receipt_digest: string; plan: string; plan_digest: string;
};
type UnitRow = ScopeRow & {
  unit_hash: string; activation_id: string; bundle_hash: string; source_ref: string; manifest_hash: string; stream_id: string;
  epoch: string; from_cursor: string; through_cursor: string; before_version: string; before_snapshot_hash: string;
  after_version: string; after_snapshot_hash: string; receipt_id: string | null; audit: string; audit_digest: string;
};
type FinancialOriginRow = ScopeRow & {
  record_id: string; source_ref: string; kind: string; source_record_id: string; source_record_version: string; event_id: string;
  canonical: string; digest: string; initial_import_key: string | null; initial_receipt_id: string | null;
  sync_receipt_id: string | null; initial_count: number; sync_count: number;
  initial_key: string | null; initial_id: string | null; sync_id: string | null;
};

function activationIdentity(stored: StoredActivation): CommittedAuthorityIdentityV1 {
  return { scope: stored.activation.scope, activationId: stored.activation.id, bundleHash: stored.bundleHash };
}

async function readActivation(client: PoolClient, scope: Scope, identity?: CommittedAuthorityIdentityV1) {
  const stored = await readStoredActivation(client, scope);
  valid(stored && (!identity || equal(identity, activationIdentity(stored))));
  return stored;
}

function lineageBindsOperation(plan: MutationPlan) {
  return plan.lineage.every(lineage => {
    let value: unknown = plan.operations[lineage.operationIndex]?.record;
    for (const segment of lineage.targetField.slice(1).split('/')) {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
      value = (value as Record<string, unknown>)[key];
    }
    return value !== undefined && lineage.sourceEventIds.every(id => plan.eventIds.includes(id));
  });
}

type VerifiedReceipt = Awaited<ReturnType<typeof readReceiptCore>>;
type HistoryRead = {
  receipts: Map<string, VerifiedReceipt>;
  snapshots: Map<number, StoredTarget>;
};

function historyRead(stored: StoredActivation): HistoryRead {
  return {
    receipts: new Map(),
    snapshots: new Map([[stored.approvedTarget.records.version, stored.approvedTarget]]),
  };
}

async function readHistoricalSnapshot(
  client: PoolClient, scope: Scope, version: number, history: HistoryRead, expectedHash?: string,
) {
  let snapshot = history.snapshots.get(version);
  if (!snapshot) {
    const { rows: [row] } = await client.query<SnapshotRow>(
      `SELECT * FROM parent_snapshots WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3
        AND target_version = $4`, [...scopeValues(scope), version],
    );
    valid(row);
    snapshot = decodeSnapshot(row);
    valid(sameScope(snapshot.records.scope, scope) && snapshot.records.version === version);
    history.snapshots.set(version, snapshot);
  }
  valid(expectedHash === undefined || snapshot.snapshotHash === expectedHash);
  return snapshot;
}

async function readReceiptCore(client: PoolClient, row: ReceiptRow, stored: StoredActivation, history: HistoryRead) {
  const { activation, bundle } = stored;
  const { scope } = activation;
  const plan = decodeCanonical(MutationPlanSchema, row.plan, row.plan_digest);
  const receipt = decodeCanonical(SyncReceiptSchema, row.receipt, row.receipt_digest);
  const beforeVersion = readVersion(row.before_version);
  const afterVersion = readVersion(row.after_version);
  const operations = plan.operations.filter((operation): operation is FinancialMutation => 'identity' in operation.record);
  const records = operations.map(operation => operation.record);
  valid(sameScope(scopeOf(row), scope) && sameScope(plan.scope, scope) && sameScope(receipt.scope, scope) &&
    plan.hash === row.plan_hash && hashPlan(plan) === plan.hash &&
    receipt.id === row.receipt_id && receipt.planHash === plan.hash &&
    row.activation_id === activation.id && receipt.activationId === activation.id && receipt.epoch === readVersion(row.epoch) &&
    receipt.artifactHash === activation.artifactHash && plan.artifactHash === activation.artifactHash &&
    plan.profileHash === activation.profileHash && plan.expectedTargetVersion === beforeVersion &&
    beforeVersion >= stored.approvedTarget.records.version && afterVersion === beforeVersion + 1 &&
    operations.length === plan.operations.length && operations.length > 0 &&
    plan.eventIds.length > 0 && plan.eventIds.length <= activation.limits.maxRecordsPerCycle &&
    operations.length <= activation.limits.maxRecordsPerCycle &&
    unique(plan.eventIds, id => id) && unique(records, record => record.id) &&
    records.every(record => sameScope(record.scope, scope) && record.identity.sourceRef === bundle.manifest.sourceRef &&
      activation.allowedKinds.includes(record.kind) && plan.eventIds.includes(record.sourceEventId)) &&
    equal(plan.eventIds, receipt.eventIds) && equal(records.map(record => record.id), receipt.targetRecordIds) &&
    lineageBindsOperation(plan));

  const before = await readHistoricalSnapshot(client, scope, beforeVersion, history);
  const after = await readHistoricalSnapshot(client, scope, afterVersion, history, row.after_snapshot_hash);
  const projected = { ...projectTarget({ ...before.records, asOf: plan.asOf }, operations), version: afterVersion };
  valid(equal(projected, after.records) && receipt.beforeBalanceCents === computeBalance(before.records, plan.asOf) &&
    receipt.afterBalanceCents === computeBalance(after.records, plan.asOf) &&
    receipt.afterBalanceCents === plan.expectedBalanceCents);
  return { receipt, plan, records, before, after };
}

function receiptByPlan(client: PoolClient, scope: Scope, hash: string) {
  return client.query<ReceiptRow>(
    'SELECT * FROM runtime_sync_receipts WHERE account_id = $1 AND plan_hash = $2', [scope.accountId, hash],
  ).then(result => result.rows[0]);
}

async function readHistoricalReceipt(client: PoolClient, receiptId: string, stored: StoredActivation, history: HistoryRead) {
  let saved = history.receipts.get(receiptId);
  if (!saved) {
    const { rows: [row] } = await client.query<ReceiptRow>(
      'SELECT * FROM runtime_sync_receipts WHERE receipt_id = $1', [receiptId],
    );
    valid(row && row.receipt_id === receiptId);
    saved = await readReceiptCore(client, row, stored, history);
    history.receipts.set(receiptId, saved);
  }
  return saved;
}

function recordForEvent(scope: Scope, event: RawSourceEvent) {
  valid(event.kind !== 'semantic_change' && event.rawIdentity.companyId === scope.companyId &&
    event.rawIdentity.sellerEntityId === scope.sellerEntityId);
  return targetRecordId({
    sourceRef: event.sourceRef, sellerEntityId: scope.sellerEntityId, kind: event.kind, recordId: event.recordId,
  });
}

type DeliveryRow = { event_id: string; source_ref: string; canonical: string; digest: string; content_hash: string };
function readDelivery(row: DeliveryRow) {
  const event = decodeCanonical(RawSourceEventSchema, row.canonical, row.digest);
  valid(event.id === row.event_id && event.sourceRef === row.source_ref &&
    event.contentHash === row.content_hash && hashEvent(event) === event.contentHash);
  return event;
}

async function verifyLegacyReceiptDeliveries(client: PoolClient, stored: StoredActivation, receipt: SyncReceipt,
  records: readonly FinancialRecord[],
) {
  const { scope } = receipt;
  const { sourceRef } = stored.bundle.manifest;
  const profile = stored.bundle.profiles.find(candidate => candidate.hash === stored.activation.profileHash);
  valid(profile);
  const { rows } = await client.query<DeliveryRow & ScopeRow & { receipt_id: string; initial_association: boolean }>(`
    SELECT o.*, d.canonical, d.digest, d.content_hash, (i.event_id IS NOT NULL) AS initial_association
    FROM runtime_sync_delivery_outcomes o JOIN runtime_deliveries d USING (source_ref, event_id)
    LEFT JOIN runtime_delivery_outcomes i USING (source_ref, event_id)
    WHERE o.receipt_id = $1 OR (o.source_ref = $2 AND o.event_id = ANY($3))
  `, [receipt.id, sourceRef, receipt.eventIds]);
  const byId = new Map(records.map(record => [record.id, record]));
  valid(rows.length === receipt.eventIds.length && rows.every(row => {
    const event = readDelivery(row);
    const record = byId.get(recordForEvent(scope, event));
    return !row.initial_association && row.receipt_id === receipt.id && sameScope(scopeOf(row), scope) &&
      row.source_ref === sourceRef && receipt.eventIds.includes(row.event_id) &&
      profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId ?? '') && record !== undefined &&
      (record.sourceEventId !== event.id || record.sourceRecordVersion === event.recordVersion);
  }));
}

async function readOrigins(
  client: PoolClient, scope: Scope, records: readonly FinancialRecord[], stored: StoredActivation, history = historyRead(stored),
) {
  if (records.length === 0) return [];
  const { rows } = await client.query<FinancialOriginRow>(`
    SELECT r.*, o.initial_import_key, o.initial_receipt_id, o.sync_receipt_id,
      i.count AS initial_count, i.import_key AS initial_key, i.receipt_id AS initial_id,
      (s.record_id IS NOT NULL)::int AS sync_count, s.receipt_id AS sync_id
    FROM parent_financial_records r JOIN runtime_financial_origins o USING (account_id, company_id, seller_entity_id, record_id)
    JOIN LATERAL (
      SELECT count(*)::int AS count, min(idempotency_key) AS import_key, min(receipt_id) AS receipt_id
      FROM runtime_economic_outcomes e
      WHERE e.record_id = r.record_id AND
        (e.account_id, e.company_id, e.seller_entity_id, e.source_ref, e.kind, e.source_record_id) =
        (r.account_id, r.company_id, r.seller_entity_id, r.source_ref, r.kind, r.source_record_id)
    ) i ON TRUE
    LEFT JOIN runtime_sync_economic_outcomes s USING (account_id, company_id, seller_entity_id, record_id)
    WHERE r.record_id = ANY($1)
  `, [records.map(record => record.id)]);
  const byId = new Map(rows.map(row => [row.record_id, row]));
  const initialRecords = new Map(financialRecords(stored.approvedTarget.records).map(record => [record.id, record]));
  const origins: ReceiptOrigin[] = [];
  for (const record of records) {
    const row = byId.get(record.id);
    valid(row && sameScope(scopeOf(row), scope) && sameScope(record.scope, scope) &&
      record.id === targetRecordId(record.identity) && record.identity.sellerEntityId === scope.sellerEntityId &&
      row.source_ref === record.identity.sourceRef && row.kind === record.kind && row.source_record_id === record.identity.recordId &&
      row.event_id === record.sourceEventId && readVersion(row.source_record_version) === record.sourceRecordVersion &&
      equal(record, decodeCanonical(financialRecord, row.canonical, row.digest)));
    if (row.sync_receipt_id === null) {
      valid(row.initial_count === 1 && row.sync_count === 0 &&
        row.initial_import_key === row.initial_key && row.initial_receipt_id === row.initial_id &&
        row.initial_import_key === stored.request.idempotencyKey && row.initial_receipt_id === stored.receipt.id &&
        initialRecords.has(record.id) && equal(initialRecords.get(record.id), record));
      origins.push(ReceiptOriginSchema.parse({
        kind: 'initial', recordId: record.id, importKey: row.initial_import_key, receipt: stored.receipt,
      }));
    } else {
      valid(row.sync_count === 1 && row.initial_count === 0 && row.sync_receipt_id === row.sync_id &&
        row.initial_import_key === null && row.initial_receipt_id === null);
      const committed = await readHistoricalReceipt(client, row.sync_receipt_id, stored, history);
      valid(committed.records.some(candidate => candidate.id === record.id && equal(candidate, record)));
      origins.push(ReceiptOriginSchema.parse({ kind: 'sync', recordId: record.id, receipt: committed.receipt }));
    }
  }

  await verifyOldAssociations(client, scope, records.map((record, index) => ({
    sourceRef: record.identity.sourceRef, eventId: record.sourceEventId, origin: origins[index]!,
  })));
  return origins;
}

async function verifyOldAssociations(client: PoolClient, scope: Scope, events: readonly {
  sourceRef: string; eventId: string; origin: ReceiptOrigin;
}[]) {
  const { rows } = await client.query<ScopeRow & {
    source_ref: string; event_id: string; import_key: string | null; receipt_id: string;
  }>(`
    SELECT account_id, company_id, seller_entity_id, source_ref, event_id, idempotency_key AS import_key, receipt_id
      FROM runtime_delivery_outcomes WHERE (source_ref, event_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))
    UNION ALL
    SELECT account_id, company_id, seller_entity_id, source_ref, event_id, NULL AS import_key, receipt_id
      FROM runtime_sync_delivery_outcomes WHERE (source_ref, event_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))
  `, [events.map(event => event.sourceRef), events.map(event => event.eventId)]);
  const byDelivery = new Map(events.map(event => [canonicalJson([event.sourceRef, event.eventId]), event.origin]));
  valid(rows.every(row => {
    const origin = byDelivery.get(canonicalJson([row.source_ref, row.event_id]));
    return origin && sameScope(scopeOf(row), scope) && origin.receipt.id === row.receipt_id &&
      (origin.kind === 'initial' ? origin.importKey === row.import_key : row.import_key === null);
  }));
}

/** Resolve every requested record against both immutable origin domains. */
export async function readFinancialOrigins(
  client: PoolClient, inputScope: Scope, records: readonly FinancialRecord[],
): Promise<ReceiptOrigin[]> {
  return storageRead(async () => {
    const scope = ScopeSchema.parse(inputScope);
    if (records.length === 0) return [];
    return readOrigins(client, scope, records, await readActivation(client, scope));
  });
}

function decodeUnit(row: UnitRow) {
  const audit = decodeCanonical(SyncUnitAuditSchema, row.audit, row.audit_digest);
  valid(equal(audit.identity, { scope: scopeOf(row), activationId: row.activation_id, bundleHash: row.bundle_hash }) &&
    audit.lane.sourceRef === row.source_ref && audit.lane.manifestHash === row.manifest_hash && audit.streamId === row.stream_id &&
    audit.unitHash === row.unit_hash && audit.expectedEpoch === readVersion(row.epoch) &&
    audit.fromCursor === row.from_cursor && audit.throughCursor === row.through_cursor &&
    audit.expectedTargetVersion === readVersion(row.before_version) && audit.beforeSnapshotHash === row.before_snapshot_hash &&
    audit.afterTargetVersion === readVersion(row.after_version) && audit.afterSnapshotHash === row.after_snapshot_hash &&
    audit.receiptId === row.receipt_id);
  return audit;
}

function verifyUnitGrant(audit: SyncUnitAudit, stored: StoredActivation) {
  const { coverage, semanticObservation } = audit;
  const { bundle, activation } = stored;
  const profile = bundle.profiles.find(profile => profile.hash === activation.profileHash);
  valid(profile && equal(audit.identity, activationIdentity(stored)) && equal(coverage.manifest, bundle.manifest) && equal(coverage.capture, bundle.artifact.normalizedPlan.capture) &&
    coverage.baseline.importKey === stored.request.idempotencyKey && coverage.baseline.receiptId === stored.receipt.id &&
    coverage.baseline.activationDigest === hashCanonical(activation) && coverage.baseline.bundleDigest === hashCanonical(bundle) &&
    coverage.baseline.approvedSnapshotHash === stored.approvedTarget.snapshotHash &&
    coverage.baseline.approvedTargetVersion === stored.approvedTarget.records.version &&
    !Object.hasOwn(semanticObservation.versions, '*') && !Object.hasOwn(bundle.manifest.semanticVersions, '*') &&
    profile.sourceAccountIds.every(id => {
      const key = profile.scope.sellerEntityId + '/' + id;
      return semanticObservation.versions[key] === profile.semanticVersion && bundle.manifest.semanticVersions[key] === profile.semanticVersion;
    }) && coverage.deliveries.every(({ event }) => profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId ?? '')));
}

async function verifyUnitLane(client: PoolClient, { lane, coverage }: SyncUnitAudit) {
  const { rows: [laneRow] } = await client.query<{
    manifest_canonical: string; manifest_digest: string; capture_canonical: string; capture_digest: string;
    initial_activation_id: string; initialized_at: string;
  }>(`
    SELECT * FROM runtime_capture_lanes WHERE source_ref = $1 AND manifest_hash = $2
  `, [lane.sourceRef, lane.manifestHash]);
  valid(laneRow?.initial_activation_id === coverage.initialActivationId && laneRow.initialized_at === coverage.initializedAt &&
    laneRow.manifest_digest === coverage.manifestDigest && laneRow.capture_digest === coverage.captureDigest &&
    laneRow.manifest_canonical === canonicalJson(coverage.manifest) && laneRow.capture_canonical === canonicalJson(coverage.capture));
}

type UnitBindings = Omit<SyncUnitAudit, 'coverage'>;

async function readPriorUnits(client: PoolClient, audit: SyncUnitAudit, stored: StoredActivation) {
  const { coverage: cut } = audit;
  const origins = new Map(cut.historyOrigins.map(origin => [origin.recordId, origin]));
  const verified: UnitBindings[] = [];
  // Each stored audit contains a growing witness. Retain only its validated
  // bindings and members, and limit how many full audit rows are loaded at once.
  const batchSize = 16;
  for (let start = 0; start < cut.historyUnits.length; start += batchSize) {
    const refs = cut.historyUnits.slice(start, start + batchSize);
    const { rows } = await client.query<UnitRow>(
      'SELECT * FROM runtime_sync_units WHERE unit_hash = ANY($1::text[])', [refs.map(unit => unit.unitHash)],
    );
    const byHash = new Map(rows.map(row => [row.unit_hash, row]));
    for (const ref of refs) {
      const row = byHash.get(ref.unitHash);
      valid(row && row.audit_digest === ref.auditDigest);
      const prior = decodeUnit(row);
      verifyUnitGrant(prior, stored);
      const { coverage: priorCut, ...bindings } = prior;
      valid(equal(prior.lane, audit.lane) && prior.streamId === ref.streamId &&
        prior.fromCursor === ref.fromCursor && prior.throughCursor === ref.throughCursor &&
        prior.expectedTargetVersion === ref.beforeTargetVersion && prior.beforeSnapshotHash === ref.beforeSnapshotHash &&
        prior.afterTargetVersion === ref.afterTargetVersion && prior.afterSnapshotHash === ref.afterSnapshotHash &&
        prior.receiptId === ref.receiptId &&
        priorCut.initialActivationId === cut.initialActivationId && priorCut.initializedAt === cut.initializedAt);
      // Every predecessor already occurs in this flat, bounded cut. Resolve a
      // prior audit's references through that same list instead of recursing.
      valid(equal(priorCut.historyUnits, cut.historyUnits.slice(0, verified.length)) &&
        priorCut.historyOutcomes.every((outcome, position) =>
          cut.historyOutcomes[position] && equal(outcome, cut.historyOutcomes[position])) &&
        priorCut.historyOrigins.every(origin => {
          const binding = origins.get(origin.recordId);
          return binding && equal(origin, binding);
        }));
      verified.push(bindings);
    }
  }
  return verified;
}

async function verifyUnitTarget(client: PoolClient, audit: UnitBindings, stored: StoredActivation, history: HistoryRead) {
  if (audit.receiptId === null) {
    return readHistoricalSnapshot(client, audit.identity.scope, audit.afterTargetVersion, history, audit.afterSnapshotHash);
  }
  const { receipt, plan, before, after } = await readHistoricalReceipt(client, audit.receiptId, stored, history);
  valid(receipt.id === audit.receiptId && receipt.epoch === audit.expectedEpoch && receipt.committedAt === audit.committedAt &&
    plan.hash === audit.planHash && plan.expectedTargetVersion === audit.expectedTargetVersion && plan.asOf === audit.asOf &&
    before.snapshotHash === audit.beforeSnapshotHash && after.snapshotHash === audit.afterSnapshotHash &&
    after.records.version === audit.afterTargetVersion &&
    equal(plan.eventIds, audit.members.map(member => member.event.eventId)) &&
    equal([...receipt.targetRecordIds].sort(), audit.members.filter(member => member.disposition === 'new').map(member => member.recordId).sort()));
  return after;
}

function originBinding(origin: ReceiptOrigin) {
  return {
    recordId: origin.recordId, receiptDigest: hashCanonical(origin.receipt),
    initialImportKey: origin.kind === 'initial' ? origin.importKey : null,
    initialReceiptId: origin.kind === 'initial' ? origin.receipt.id : null,
    syncReceiptId: origin.kind === 'sync' ? origin.receipt.id : null,
  };
}

async function verifyUnitMembers(
  client: PoolClient, audit: SyncUnitAudit, prior: readonly UnitBindings[], stored: StoredActivation, history: HistoryRead,
) {
  const { identity, lane, coverage: cut } = audit;
  const { scope } = identity;
  const members: { member: UnitMember; unitHash: string }[] = [];
  const records = new Map<string, FinancialRecord>();
  for (const unit of [...prior, audit]) {
    const after = await verifyUnitTarget(client, unit, stored, history);
    const byId = new Map(financialRecords(after.records).map(record => [record.id, record]));
    for (const member of unit.members) {
      const record = byId.get(member.recordId);
      const previous = records.get(member.recordId);
      valid(record && (!previous || equal(previous, record)));
      records.set(member.recordId, record);
      members.push({ member, unitHash: unit.unitHash });
    }
  }
  const origins = await readOrigins(client, scope, [...records.values()], stored, history);
  const byRecord = new Map(origins.map(origin => [origin.recordId, origin]));
  for (const ref of cut.historyOrigins) {
    const origin = byRecord.get(ref.recordId);
    valid(origin && equal(ref, originBinding(origin)));
  }

  const replayedDeliveries = members.flatMap(({ member }) => member.event.eventId === records.get(member.recordId)?.sourceEventId
    ? []
    : [{ ...member.event, origin: member.origin }]);
  if (replayedDeliveries.length > 0) await verifyOldAssociations(client, scope, replayedDeliveries);
  const { rows } = await client.query<DeliveryRow & ScopeRow & {
    sequence: string; stream_id: string; after_cursor: string; outcome: string; outcome_digest: string; unit_hash: string;
    record_id: string; disposition: string; outcome_sequence: string; outcome_stream_id: string;
    activation_id: string; bundle_hash: string; manifest_hash: string;
  }>(`
    SELECT d.*, i.sequence, i.stream_id, i.after_cursor,
      o.canonical AS outcome, o.digest AS outcome_digest, o.unit_hash, o.record_id, o.disposition,
      o.sequence AS outcome_sequence, o.stream_id AS outcome_stream_id,
      o.account_id, o.company_id, o.seller_entity_id, o.activation_id, o.bundle_hash, o.manifest_hash
    FROM runtime_inbox i
    JOIN runtime_deliveries d USING (source_ref, event_id)
    JOIN runtime_source_positions p USING (source_ref, stream_id, sequence, event_id)
    JOIN runtime_sync_event_outcomes o USING (source_ref, event_id)
    WHERE i.source_ref = $1 AND i.manifest_hash = $2 AND i.stream_id = $3
      AND i.sequence > $4 AND i.sequence <= $5
    ORDER BY i.sequence
  `, [lane.sourceRef, lane.manifestHash, audit.streamId, prior[0]?.fromCursor ?? audit.fromCursor, audit.throughCursor]);
  valid(rows.length === members.length && rows.length === cut.deliveries.length);
  for (const [index, { member, unitHash }] of members.entries()) {
    const row = rows[index]!;
    const event = readDelivery(row);
    const outcome = decodeCanonical(SyncEventOutcomeSchema, row.outcome, row.outcome_digest);
    // A bounded prefix assigns each distinct position to exactly one unit.
    const expectedOutcome = { identity, lane, unitHash, ...member };
    valid(equal(outcome, expectedOutcome) && equal(syncEventRef(event), member.event) &&
      row.digest === cut.deliveries[index]!.digest && row.sequence === row.outcome_sequence &&
      readVersion(row.sequence) === event.sequence && row.stream_id === event.streamId && row.outcome_stream_id === event.streamId &&
      row.after_cursor === cut.inbox[index]!.afterCursor &&
      byRecord.has(member.recordId) && equal(member.origin, byRecord.get(member.recordId)) && sameScope(scopeOf(row), scope) &&
      row.activation_id === identity.activationId && row.bundle_hash === identity.bundleHash &&
      row.manifest_hash === lane.manifestHash && row.unit_hash === unitHash &&
      row.record_id === member.recordId && row.disposition === member.disposition && recordForEvent(scope, event) === member.recordId);
    if (index < cut.historyOutcomes.length) {
      const { event, recordId, disposition } = member;
      valid(equal(cut.historyOutcomes[index], { event, recordId, disposition, unitHash, digest: row.outcome_digest }));
    }
    if (member.disposition === 'new') {
      const record = records.get(member.recordId)!;
      valid(record.sourceEventId === event.id && record.sourceRecordVersion === event.recordVersion);
    }
  }
}

async function readValidatedUnit(client: PoolClient, row: UnitRow, stored: StoredActivation, history = historyRead(stored)) {
  const audit = decodeUnit(row);
  verifyUnitGrant(audit, stored);
  await verifyUnitLane(client, audit);
  const prior = await readPriorUnits(client, audit, stored);
  await verifyUnitMembers(client, audit, prior, stored, history);
  return audit;
}

/** Read one terminal unit by exact immutable key. */
export async function readSyncUnit(
  client: PoolClient, input: CommittedAuthorityIdentityV1, unitHash: string,
): Promise<SyncUnitAudit | null> {
  return storageRead(async () => {
    const identity = CommittedAuthorityIdentityV1Schema.parse(input);
    const { rows: [row] } = await client.query<UnitRow>(
      'SELECT * FROM runtime_sync_units WHERE unit_hash = $1', [HashSchema.parse(unitHash)],
    );
    if (!row) return null;
    valid(sameScope(scopeOf(row), identity.scope));
    return readValidatedUnit(client, row, await readActivation(client, identity.scope, identity));
  });
}

async function verifyReceiptHistory(client: PoolClient, row: ReceiptRow, stored: StoredActivation, inputPlan?: MutationPlan) {
  const history = historyRead(stored);
  const saved = await readReceiptCore(client, row, stored, history);
  history.receipts.set(saved.receipt.id, saved);
  const { receipt, plan, records } = saved;
  valid(!inputPlan || equal(plan, inputPlan));
  const { rows: [unit] } = await client.query<UnitRow>('SELECT * FROM runtime_sync_units WHERE receipt_id = $1', [receipt.id]);
  if (unit) {
    await readValidatedUnit(client, unit, stored, history);
  } else {
    const origins = await readOrigins(client, receipt.scope, records, stored, history);
    valid(origins.every(origin => origin.kind === 'sync' && equal(origin.receipt, receipt)));
    await verifyLegacyReceiptDeliveries(client, stored, receipt, records);
  }
  return receipt;
}

/** Recover the original receipt only for the exact committed plan and activation. */
export async function readSyncCommit(
  client: PoolClient, input: CommittedAuthorityIdentityV1, inputPlan: MutationPlan,
): Promise<ReceiptResponse | null> {
  return storageRead(async () => {
    const identity = CommittedAuthorityIdentityV1Schema.parse(input);
    const plan = MutationPlanSchema.parse(inputPlan);
    valid(equal(plan, inputPlan) && hashPlan(plan) === plan.hash && sameScope(plan.scope, identity.scope));
    const row = await receiptByPlan(client, identity.scope, plan.hash);
    if (!row) return null;
    const stored = await readActivation(client, identity.scope, identity);
    return { receipt: await verifyReceiptHistory(client, row, stored, plan), replayed: true };
  });
}

/** A validated historical read for the inherited receipt consumer. */
export async function readSyncReceipt(client: PoolClient, inputScope: Scope, planHash: string): Promise<SyncReceipt | null> {
  return storageRead(async () => {
    const scope = ScopeSchema.parse(inputScope);
    const row = await receiptByPlan(client, scope, HashSchema.parse(planHash));
    return row ? verifyReceiptHistory(client, row, await readActivation(client, scope)) : null;
  });
}

export async function readLatestSyncVersion(client: PoolClient, scope: Scope): Promise<number> {
  const { rows: [row] } = await client.query<{ version: string | null }>(
    `SELECT max(after_version)::text AS version FROM runtime_sync_receipts
      WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3`, scopeValues(scope),
  );
  return row?.version ? readVersion(row.version) : 0;
}

/** Verify relational target membership and original ownership after identity locks. */
export async function readSyncTargetOrigins(client: PoolClient, scope: Scope, target: StoredTarget) {
  return storageRead(async () => {
    const records = financialRecords(target.records);
    const { rows: [row] } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM parent_financial_records
       WHERE (account_id, company_id, seller_entity_id) = ($1, $2, $3)`, scopeValues(scope),
    );
    valid(row && readVersion(row.count) === records.length);
    const origins = await readFinancialOrigins(client, scope, records);
    return new Map(origins.map(origin => [origin.recordId, origin]));
  });
}

function unitBinding(identity: CommittedAuthorityIdentityV1, lane: SyncUnitAudit['lane']) {
  return [...scopeValues(identity.scope), identity.activationId, identity.bundleHash, lane.sourceRef, lane.manifestHash];
}

export function replayResponse(audit: SyncUnitAudit, replayed: boolean): ReplayResponse {
  const receipts = new Map(audit.members.map(({ origin }) =>
    [canonicalJson([origin.kind, origin.receipt.id]), origin.receipt] as const));
  return {
    unitHash: audit.unitHash, replayed,
    receipts: [...receipts.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    appliedThrough: audit.coverage.checkpoints.map(checkpoint => ({
      streamId: checkpoint.streamId, cursor: checkpoint.streamId === audit.streamId ? audit.throughCursor : checkpoint.baselineCursor,
    })),
  };
}

async function lockApplicationHeads(client: PoolClient, audit: SyncUnitAudit, expected: SyncUnitCommit['expectedHeads']) {
  type Head = ScopeRow & {
    activation_id: string; bundle_hash: string; source_ref: string; manifest_hash: string;
    stream_id: string; baseline_cursor: string; applied_through: string; last_unit_hash: string | null;
  };
  const { rows } = await client.query<Head>(`
    SELECT * FROM runtime_sync_application_heads WHERE account_id = $1 OR activation_id = $2
    ORDER BY stream_id COLLATE "C" FOR UPDATE
  `, [audit.identity.scope.accountId, audit.identity.activationId]);
  const binding = unitBinding(audit.identity, audit.lane);
  valid(rows.every(row => equal(
    [...scopeValues(scopeOf(row)), row.activation_id, row.bundle_hash, row.source_ref, row.manifest_hash], binding,
  )));
  valid(equal(rows.map(row => ({
    streamId: row.stream_id, baselineCursor: row.baseline_cursor, appliedThrough: row.applied_through, lastUnitHash: row.last_unit_hash,
  })), expected));
  return binding;
}

async function advanceApplicationHeads(client: PoolClient, audit: SyncUnitAudit, binding: string[]) {
  for (const { streamId, baselineCursor } of audit.coverage.checkpoints) {
    if (!audit.coverage.applicationHeads.some(head => head.streamId === streamId)) {
      await client.query(`
        INSERT INTO runtime_sync_application_heads (account_id, company_id, seller_entity_id, activation_id, bundle_hash,
          source_ref, manifest_hash, stream_id, baseline_cursor, applied_through, last_unit_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,NULL)
      `, [...binding, streamId, baselineCursor]);
    }
  }
  const previous = audit.coverage.applicationHeads.find(head => head.streamId === audit.streamId);
  const advanced = await client.query(`
    UPDATE runtime_sync_application_heads SET applied_through = $9, last_unit_hash = $10
    WHERE (account_id, company_id, seller_entity_id, activation_id, bundle_hash, source_ref, manifest_hash, stream_id)
      = ($1,$2,$3,$4,$5,$6,$7,$8) AND applied_through = $11 AND last_unit_hash IS NOT DISTINCT FROM $12
  `, [...binding, audit.streamId, audit.throughCursor, audit.unitHash, audit.fromCursor, previous?.lastUnitHash ?? null]);
  valid(advanced.rowCount === 1);
}

async function validateUnitDeliveries(client: PoolClient, audit: SyncUnitAudit, events: RawSourceEvent[]) {
  const { identity, lane, unitHash, members } = audit;
  const { rows } = await client.query<DeliveryRow>(`
    SELECT * FROM runtime_deliveries
    WHERE (source_ref, event_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))
  `, [events.map(event => event.sourceRef), events.map(event => event.id)]);
  const deliveries = new Map(rows.map(row => [row.event_id, readDelivery(row)]));
  valid(deliveries.size === events.length && events.every(event => equal(deliveries.get(event.id), event)));
  await verifyOldAssociations(client, identity.scope, members.map(({ event, origin }) => ({ ...event, origin })));

  const { rows: outcomes } = await client.query<ScopeRow & {
    activation_id: string; bundle_hash: string; source_ref: string; manifest_hash: string;
    stream_id: string; sequence: string; event_id: string; record_id: string; unit_hash: string;
    disposition: string; canonical: string; digest: string;
  }>(`
    SELECT * FROM runtime_sync_event_outcomes
    WHERE (source_ref, event_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))
  `, [events.map(event => event.sourceRef), events.map(event => event.id)]);
  const byEvent = new Map(members.map(member => [member.event.eventId, member]));
  for (const row of outcomes) {
    const member = byEvent.get(row.event_id);
    valid(member && equal(decodeCanonical(SyncEventOutcomeSchema, row.canonical, row.digest), { identity, lane, unitHash, ...member }) &&
      equal(scopeOf(row), identity.scope) && row.activation_id === identity.activationId && row.bundle_hash === identity.bundleHash &&
      row.source_ref === lane.sourceRef && row.manifest_hash === lane.manifestHash && row.stream_id === member.event.streamId &&
      readVersion(row.sequence) === member.event.sequence && row.record_id === member.recordId &&
      row.unit_hash === unitHash && row.disposition === member.disposition);
  }
  return new Set(outcomes.map(row => row.event_id));
}

async function requireUnclaimedRecords(client: PoolClient, records: FinancialRecord[]) {
  if (records.length === 0) return;
  const { rowCount } = await client.query(`
    SELECT 1 FROM parent_financial_records WHERE record_id = ANY($1::text[])
       OR (source_ref, seller_entity_id, kind, source_record_id) IN (
         SELECT * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])
       ) LIMIT 1
  `, [records.map(record => record.id), records.map(record => record.identity.sourceRef),
    records.map(record => record.identity.sellerEntityId), records.map(record => record.kind),
    records.map(record => record.identity.recordId)]);
  valid(rowCount === 0);
}

async function appendFinancialRecords(
  client: PoolClient, previous: StoredTarget, next: TargetState, plan: MutationPlan, receipt: SyncReceipt, records: FinancialRecord[],
) {
  const values = scopeValues(receipt.scope);
  const hash = hashTargetSnapshot(next);
  await client.query(
    `INSERT INTO parent_snapshots (account_id, company_id, seller_entity_id, target_version, snapshot_hash, recorded_as_of, canonical, digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [...values, next.version, hash, next.asOf, ...encodeCanonical(next)],
  );
  const moved = await client.query(
    `UPDATE parent_targets SET target_version = $4, snapshot_hash = $5
     WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3 AND target_version = $6 AND snapshot_hash = $7`,
    [...values, next.version, hash, previous.records.version, previous.snapshotHash],
  );
  valid(moved.rowCount === 1);
  await client.query(
    `INSERT INTO runtime_sync_receipts
       (account_id, company_id, seller_entity_id, receipt_id, plan_hash, activation_id, epoch, before_version, after_version,
        after_snapshot_hash, receipt, receipt_digest, plan, plan_digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [...values, receipt.id, plan.hash, receipt.activationId, receipt.epoch, previous.records.version, next.version, hash,
      ...encodeCanonical(receipt), ...encodeCanonical(plan)],
  );
  for (const record of records) {
    const { identity } = record;
    await client.query(
      `INSERT INTO parent_financial_records
         (account_id, company_id, seller_entity_id, source_ref, kind, source_record_id, record_id,
          source_record_version, event_id, canonical, digest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [...values, identity.sourceRef, record.kind, identity.recordId, record.id, record.sourceRecordVersion,
        record.sourceEventId, ...encodeCanonical(record)],
    );
    await client.query(
      'INSERT INTO runtime_sync_economic_outcomes (account_id, company_id, seller_entity_id, record_id, receipt_id) VALUES ($1, $2, $3, $4, $5)',
      [...values, record.id, receipt.id],
    );
  }
}

/** Append a captured unit and its exact frontier in the caller's locked transaction. */
export async function persistSyncUnit(client: PoolClient, input: SyncUnitCommit): Promise<ReceiptResponse | ReplayResponse> {
  return storageRead(async () => {
    const { audit, previous, members, expectedHeads, plan, receipt } = input;
    const { identity, lane, streamId, unitHash } = audit;
    const { scope } = identity;
    valid(SyncUnitAuditSchema.safeParse(audit).success && equal(audit.members, members) &&
      equal(audit.coverage.applicationHeads, expectedHeads) && sameScope(previous.records.scope, scope) &&
      audit.expectedTargetVersion === previous.records.version && audit.beforeSnapshotHash === previous.snapshotHash &&
      hashTargetSnapshot(previous.records) === previous.snapshotHash);
    const suffix = audit.coverage.deliveries.slice(audit.coverage.historyOutcomes.length).map(row => row.event);
    requireImportIdentityLocks(client, input.identityLocks, input.identities, suffix);
    valid(suffix.every((event, index) => recordForEvent(scope, event) === members[index]?.recordId));

    const next = validateSnapshot(input.next);
    valid(audit.afterTargetVersion === next.version && audit.afterSnapshotHash === hashTargetSnapshot(next));
    const operations = plan?.operations.filter((operation): operation is FinancialMutation => 'identity' in operation.record) ?? [];
    const records = operations.map(operation => operation.record);
    const requiredRecords = new Map(financialRecords(next).map(record => [record.id, record]));
    requireImportIdentityLocks(client, input.identityLocks, members.map(member => {
      const record = requiredRecords.get(member.recordId);
      valid(record);
      return record.identity;
    }), suffix);
    if (plan && receipt) {
      valid(receipt.id === audit.receiptId && plan.hash === audit.planHash && hashPlan(plan) === plan.hash &&
        sameScope(plan.scope, scope) && sameScope(receipt.scope, scope) && receipt.planHash === plan.hash &&
        receipt.epoch === audit.expectedEpoch && receipt.activationId === identity.activationId &&
        receipt.artifactHash === plan.artifactHash && receipt.committedAt === audit.committedAt &&
        plan.expectedTargetVersion === previous.records.version && plan.asOf === audit.asOf &&
        records.length > 0 && records.length === plan.operations.length &&
        equal(plan.eventIds, members.map(member => member.event.eventId)) && equal(receipt.eventIds, plan.eventIds) &&
        equal(receipt.targetRecordIds, records.map(record => record.id)) &&
        equal([...receipt.targetRecordIds].sort(), members.filter(member => member.disposition === 'new').map(member => member.recordId).sort()) &&
        members.every(member => member.disposition === 'replay' || equal(member.origin.receipt, receipt)) &&
        equal(next, { ...projectTarget({ ...previous.records, asOf: plan.asOf }, operations), version: audit.afterTargetVersion }) &&
        receipt.beforeBalanceCents === computeBalance(previous.records, plan.asOf) &&
        receipt.afterBalanceCents === computeBalance(next, plan.asOf) && receipt.afterBalanceCents === plan.expectedBalanceCents);
    } else {
      valid(plan === null && receipt === null && audit.receiptId === null && equal(next, previous.records));
    }

    await requireUnclaimedRecords(client, records);
    const occupied = await validateUnitDeliveries(client, audit, suffix);
    const binding = await lockApplicationHeads(client, audit, expectedHeads);
    if (plan && receipt) await appendFinancialRecords(client, previous, next, plan, receipt, records);
    await client.query(`
      INSERT INTO runtime_sync_units (account_id, company_id, seller_entity_id, activation_id, bundle_hash,
        source_ref, manifest_hash, stream_id, unit_hash, epoch, from_cursor, through_cursor, before_version,
        before_snapshot_hash, after_version, after_snapshot_hash, receipt_id, audit, audit_digest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    `, [...binding, streamId, unitHash, audit.expectedEpoch, audit.fromCursor, audit.throughCursor, audit.expectedTargetVersion,
      audit.beforeSnapshotHash, audit.afterTargetVersion, audit.afterSnapshotHash, audit.receiptId, ...encodeCanonical(audit)]);
    for (const member of members) {
      if (occupied.has(member.event.eventId)) continue;
      await client.query(`
        INSERT INTO runtime_sync_event_outcomes (account_id, company_id, seller_entity_id, activation_id, bundle_hash,
          source_ref, manifest_hash, stream_id, sequence, event_id, record_id, unit_hash, disposition, canonical, digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      `, [...binding, streamId, member.event.sequence, member.event.eventId, member.recordId, unitHash, member.disposition,
        ...encodeCanonical({ identity, lane, unitHash, ...member })]);
    }
    await advanceApplicationHeads(client, audit, binding);
    return receipt ? { receipt, replayed: false } : replayResponse(audit, false);
  });
}
