import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  AllocationSchema, CommittedAuthorityIdentityV1Schema, FullReversalSchema, FundingSchema, HashSchema, InvoiceSchema,
  MutationPlanSchema, RawSourceEventSchema, ScopeSchema, SyncReceiptSchema, canonicalJson, hashCanonical, hashEvent,
  hashPlan, hashTargetSnapshot, targetRecordId, unique,
  type CommittedAuthorityIdentityV1, type MutationPlan, type RawSourceEvent, type ReceiptResponse,
  type Scope, type SyncReceipt, type TargetState,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { financialRecords, sameScope, type FinancialRecord } from '@eapr/finance/validate';
import { sqlState } from '@eapr/storage/transaction';
import { readStoredActivation, type StoredActivation } from './activation-store.js';
import { requireImportIdentityLocks, type ImportIdentityLocks } from './persistence.js';
import {
  decodeCanonical, decodeSnapshot, encodeCanonical, readStoredTarget, readVersion, scopeOf, scopeValues, validateSnapshot,
  type ScopeRow, type SnapshotRow, type StoredTarget,
} from './snapshots.js';
import { projectTarget, type FinancialMutation } from './state.js';
import { ReceiptOriginSchema, SyncEventOutcomeSchema, SyncUnitAuditSchema, syncEventRef, type ReceiptOrigin, type SyncUnitAudit } from './sync-types.js';

export * from './sync-types.js';

export type SyncCommit = {
  scope: Scope; plan: MutationPlan; receipt: SyncReceipt; previous: StoredTarget; next: TargetState;
  records: FinancialRecord[]; events: RawSourceEvent[]; identityLocks: ImportIdentityLocks;
};

export class SyncStoreError extends Error {
  constructor(readonly code: 'SYNC_STORE_CONFLICT' | 'SYNC_STORE_INVALID', message: string) {
    super(message);
    this.name = 'SyncStoreError';
  }
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SyncStoreError('SYNC_STORE_CONFLICT', message);
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

async function readReceiptCore(client: PoolClient, row: ReceiptRow, stored: StoredActivation) {
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

  const { rows: [beforeRow] } = await client.query<SnapshotRow>(
    `SELECT * FROM parent_snapshots WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3
      AND target_version = $4`, [...scopeValues(scope), beforeVersion],
  );
  const after = await readStoredTarget(client, scope, row.after_snapshot_hash);
  valid(beforeRow && after?.records.version === afterVersion);
  const before = decodeSnapshot(beforeRow);
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

function receiptById(client: PoolClient, receiptId: string) {
  return client.query<ReceiptRow>(
    'SELECT * FROM runtime_sync_receipts WHERE receipt_id = $1', [receiptId],
  ).then(result => result.rows[0]);
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

async function readOrigins(client: PoolClient, scope: Scope, records: readonly FinancialRecord[], stored: StoredActivation) {
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
  const receipts = new Map<string, Awaited<ReturnType<typeof readReceiptCore>>>();
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
      let committed = receipts.get(row.sync_receipt_id);
      if (!committed) {
        const receiptRow = await receiptById(client, row.sync_receipt_id);
        valid(receiptRow);
        committed = await readReceiptCore(client, receiptRow, stored);
        receipts.set(row.sync_receipt_id, committed);
      }
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

async function verifyUnitCoverageBindings(client: PoolClient, audit: SyncUnitAudit, stored: StoredActivation) {
  const { lane, coverage, semanticObservation } = audit;
  const { bundle, activation } = stored;
  const profile = bundle.profiles.find(profile => profile.hash === activation.profileHash);
  valid(profile && equal(coverage.manifest, bundle.manifest) && equal(coverage.capture, bundle.artifact.normalizedPlan.capture) &&
    coverage.baseline.importKey === stored.request.idempotencyKey && coverage.baseline.receiptId === stored.receipt.id &&
    coverage.baseline.activationDigest === hashCanonical(activation) && coverage.baseline.bundleDigest === hashCanonical(bundle) &&
    coverage.baseline.approvedSnapshotHash === stored.approvedTarget.snapshotHash &&
    coverage.baseline.approvedTargetVersion === stored.approvedTarget.records.version &&
    !Object.hasOwn(semanticObservation.versions, '*') && !Object.hasOwn(bundle.manifest.semanticVersions, '*') &&
    profile.sourceAccountIds.every(id => {
      const key = profile.scope.sellerEntityId + '/' + id;
      return semanticObservation.versions[key] === profile.semanticVersion && bundle.manifest.semanticVersions[key] === profile.semanticVersion;
    }) && coverage.deliveries.every(({ event }) => profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId ?? '')));
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

async function verifyUnitMembers(client: PoolClient, audit: SyncUnitAudit, records: readonly FinancialRecord[], stored: StoredActivation) {
  const scope = audit.identity.scope;
  const byId = new Map(records.map(record => [record.id, record]));
  const memberRecords = audit.members.map(member => {
    const record = byId.get(member.recordId);
    valid(record);
    return record;
  });
  const origins = await readOrigins(client, scope, memberRecords, stored);
  await verifyOldAssociations(client, scope, audit.members.map(member => ({ ...member.event, origin: member.origin })));
  const { rows } = await client.query<DeliveryRow & {
    sequence: string; stream_id: string; after_cursor: string; outcome: string; outcome_digest: string; unit_hash: string;
    record_id: string; disposition: string; account_id: string; company_id: string; seller_entity_id: string;
    activation_id: string; bundle_hash: string; manifest_hash: string;
  }>(`
    SELECT d.*, i.sequence, i.stream_id, i.after_cursor,
      o.canonical AS outcome, o.digest AS outcome_digest, o.unit_hash, o.record_id, o.disposition,
      o.account_id, o.company_id, o.seller_entity_id, o.activation_id, o.bundle_hash, o.manifest_hash
    FROM runtime_inbox i
    JOIN runtime_deliveries d USING (source_ref, event_id)
    JOIN runtime_source_positions p USING (source_ref, stream_id, sequence, event_id)
    JOIN runtime_sync_event_outcomes o USING (source_ref, event_id)
    WHERE i.source_ref = $1 AND i.manifest_hash = $2 AND i.stream_id = $3
      AND i.sequence > $4 AND i.sequence <= $5
    ORDER BY i.sequence
  `, [audit.lane.sourceRef, audit.lane.manifestHash, audit.streamId, audit.fromCursor, audit.throughCursor]);
  valid(rows.length === audit.members.length);
  const previous = new Map(audit.coverage.historyOutcomes.map(row => [row.event.eventId, row]));
  const inbox = new Map(audit.coverage.inbox.map(row => [row.eventId, row]));
  for (const [index, member] of audit.members.entries()) {
    const row = rows[index]!;
    const event = readDelivery(row);
    const outcome = decodeCanonical(SyncEventOutcomeSchema, row.outcome, row.outcome_digest);
    const prior = previous.get(event.id);
    valid(equal(syncEventRef(event), member.event) && equal(outcome.event, member.event) &&
      readVersion(row.sequence) === event.sequence && row.stream_id === event.streamId &&
      row.after_cursor === inbox.get(event.id)?.afterCursor &&
      equal(member.origin, origins[index]) && equal(outcome.origin, member.origin) &&
      equal(outcome.identity, audit.identity) && sameScope(scopeOf(row), scope) && equal(outcome.lane, audit.lane) &&
      row.activation_id === audit.identity.activationId && row.bundle_hash === audit.identity.bundleHash &&
      row.manifest_hash === audit.lane.manifestHash && row.unit_hash === outcome.unitHash &&
      row.record_id === member.recordId && outcome.recordId === member.recordId &&
      row.disposition === outcome.disposition && recordForEvent(scope, event) === member.recordId);
    valid(outcome.unitHash === audit.unitHash
      ? outcome.disposition === member.disposition
      : prior?.unitHash === outcome.unitHash && prior.digest === row.outcome_digest);
    if (member.disposition === 'new') {
      const record = memberRecords[index]!;
      valid(record.sourceEventId === event.id && record.sourceRecordVersion === event.recordVersion);
    }
  }
}

async function readValidatedUnit(client: PoolClient, row: UnitRow, stored: StoredActivation,
  saved?: Awaited<ReturnType<typeof readReceiptCore>>,
) {
  const audit = decodeUnit(row);
  valid(equal(audit.identity, activationIdentity(stored)));
  await verifyUnitCoverageBindings(client, audit, stored);
  let after: StoredTarget | null;
  if (audit.receiptId === null) {
    after = await readStoredTarget(client, audit.identity.scope, audit.afterSnapshotHash);
    valid(after?.records.version === audit.afterTargetVersion);
  } else {
    if (!saved) {
      const receiptRow = await receiptById(client, audit.receiptId);
      valid(receiptRow);
      saved = await readReceiptCore(client, receiptRow, stored);
    }
    const { receipt, plan, before } = saved;
    after = saved.after;
    valid(receipt.id === audit.receiptId && receipt.epoch === audit.expectedEpoch && receipt.committedAt === audit.committedAt &&
      plan.hash === audit.planHash && plan.expectedTargetVersion === audit.expectedTargetVersion && plan.asOf === audit.asOf &&
      before.snapshotHash === audit.beforeSnapshotHash && after.snapshotHash === audit.afterSnapshotHash &&
      after.records.version === audit.afterTargetVersion &&
      equal(plan.eventIds, audit.members.map(member => member.event.eventId)) &&
      equal([...receipt.targetRecordIds].sort(), audit.members.filter(member => member.disposition === 'new').map(member => member.recordId).sort()));
  }
  await verifyUnitMembers(client, audit, financialRecords(after.records), stored);
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
  const saved = await readReceiptCore(client, row, stored);
  const { receipt, plan, records } = saved;
  valid(!inputPlan || equal(plan, inputPlan));
  const { rows: [unit] } = await client.query<UnitRow>('SELECT * FROM runtime_sync_units WHERE receipt_id = $1', [receipt.id]);
  if (unit) {
    await readValidatedUnit(client, unit, stored, saved);
  } else {
    const origins = await readOrigins(client, receipt.scope, records, stored);
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

/**
 * Stores one validated ongoing batch in the caller's transaction. Caller holds the scope, target and
 * identity locks and has recomputed the plan; this only appends facts and moves the target pointer.
 */
export async function persistSyncBatch(client: PoolClient, input: SyncCommit): Promise<SyncReceipt> {
  const { scope, plan, receipt, previous, identityLocks } = input;
  const next = validateSnapshot(input.next);
  require(next.version === previous.records.version + 1, 'next target version');
  requireImportIdentityLocks(client, identityLocks, input.records.map(record => record.identity), input.events);
  const values = scopeValues(scope);
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
  require(moved.rowCount === 1, 'stored target changed during sync');
  await client.query(
    `INSERT INTO runtime_sync_receipts
       (account_id, company_id, seller_entity_id, receipt_id, plan_hash, activation_id, epoch, before_version, after_version,
        after_snapshot_hash, receipt, receipt_digest, plan, plan_digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [...values, receipt.id, plan.hash, receipt.activationId, receipt.epoch, previous.records.version, next.version, hash,
      ...encodeCanonical(receipt), ...encodeCanonical(plan)],
  );
  for (const record of input.records) {
    const { identity } = record;
    const existing = await client.query(
      `SELECT 1 FROM parent_financial_records
       WHERE record_id = $1 OR (source_ref, seller_entity_id, kind, source_record_id) = ($2, $3, $4, $5)`,
      [record.id, identity.sourceRef, identity.sellerEntityId, identity.kind, identity.recordId],
    );
    require(!existing.rowCount, 'global economic identity already exists');
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
  for (const input_event of input.events) {
    const event = RawSourceEventSchema.parse(input_event);
    const key = [event.sourceRef, event.id];
    const prior = await client.query(
      `SELECT 1 FROM runtime_delivery_outcomes WHERE source_ref = $1 AND event_id = $2
       UNION ALL SELECT 1 FROM runtime_sync_delivery_outcomes WHERE source_ref = $1 AND event_id = $2`, key,
    );
    require(!prior.rowCount, 'delivery already acknowledged');
    const [canonical, digest] = encodeCanonical(event);
    const { rows: [stored] } = await client.query<{ canonical: string; digest: string; content_hash: string }>(
      'SELECT canonical, digest, content_hash FROM runtime_deliveries WHERE source_ref = $1 AND event_id = $2', key,
    );
    if (stored) {
      require(stored.canonical === canonical && stored.digest === digest && stored.content_hash === event.contentHash,
        'existing delivery bytes');
    } else {
      await client.query(
        'INSERT INTO runtime_deliveries (source_ref, event_id, content_hash, canonical, digest) VALUES ($1, $2, $3, $4, $5)',
        [...key, event.contentHash, canonical, digest],
      );
    }
    await client.query(
      `INSERT INTO runtime_sync_delivery_outcomes (account_id, company_id, seller_entity_id, source_ref, event_id, receipt_id)
       VALUES ($1, $2, $3, $4, $5, $6)`, [...values, ...key, receipt.id],
    );
  }
  return receipt;
}
