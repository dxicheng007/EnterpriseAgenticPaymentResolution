import type { PoolClient } from 'pg';
import {
  hashTargetSnapshot, MutationPlanSchema, RawSourceEventSchema, SyncReceiptSchema,
  type MutationPlan, type RawSourceEvent, type Scope, type SyncReceipt, type TargetState,
} from '@eapr/contracts';
import type { FinancialRecord } from '@eapr/finance/validate';
import { requireImportIdentityLocks, type ImportIdentityLocks } from './persistence.js';
import { decodeCanonical, encodeCanonical, readVersion, scopeValues, validateSnapshot, type StoredTarget } from './snapshots.js';

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

/** Returns the exact committed receipt for a plan hash, or null. */
export async function readSyncReceipt(client: PoolClient, scope: Scope, planHash: string): Promise<SyncReceipt | null> {
  const { rows: [row] } = await client.query<{ receipt: string; receipt_digest: string; plan: string; plan_digest: string }>(
    'SELECT receipt, receipt_digest, plan, plan_digest FROM runtime_sync_receipts WHERE account_id = $1 AND plan_hash = $2',
    [scope.accountId, planHash],
  );
  if (!row) return null;
  decodeCanonical(MutationPlanSchema, row.plan, row.plan_digest);
  const receipt = decodeCanonical(SyncReceiptSchema, row.receipt, row.receipt_digest);
  if (receipt.scope.companyId !== scope.companyId || receipt.scope.sellerEntityId !== scope.sellerEntityId) {
    throw new SyncStoreError('SYNC_STORE_INVALID', 'Stored receipt scope differs');
  }
  return receipt;
}

export async function readLatestSyncVersion(client: PoolClient, scope: Scope): Promise<number> {
  const { rows: [row] } = await client.query<{ version: string | null }>(
    'SELECT max(after_version)::text AS version FROM runtime_sync_receipts WHERE account_id = $1', [scope.accountId],
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
