import type { PoolClient } from 'pg';
import {
  canonicalJson, hashBytes, HashSchema, NonnegativeIntegerSchema, ParentViewSchema, ScopeSchema,
  hashTargetSnapshot, TargetStateSchema, type ParentView, type Scope, type TargetState,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { financialRecords, sameScope, validateTarget } from '@eapr/finance/validate';
import { projectBootstrapTarget } from './bootstrap.js';

export type ScopeRow = { account_id: string; company_id: string; seller_entity_id: string };
export function scopeOf(row: ScopeRow): Scope {
  return ScopeSchema.parse({ accountId: row.account_id, companyId: row.company_id, sellerEntityId: row.seller_entity_id });
}

export function scopeValues(scope: Scope) {
  return [scope.accountId, scope.companyId, scope.sellerEntityId];
}

export function encodeCanonical(value: unknown): [canonical: string, digest: string] {
  const canonical = canonicalJson(value);
  return [canonical, hashBytes(Buffer.from(canonical, 'utf8'))];
}

export function decodeCanonical<T>(schema: { parse(input: unknown): T }, canonical: string, digest: string): T {
  if (typeof canonical !== 'string' || hashBytes(Buffer.from(canonical, 'utf8')) !== HashSchema.parse(digest)) {
    throw new Error('Stored canonical digest differs');
  }
  const parsed = schema.parse(JSON.parse(canonical));
  if (canonicalJson(parsed) !== canonical) throw new Error('Stored JSON is not canonical');
  return parsed;
}

export function readVersion(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid stored BIGINT');
  return NonnegativeIntegerSchema.parse(Number(value));
}

export type SnapshotRow = ScopeRow & {
  target_version: string; snapshot_hash: string; recorded_as_of: string; canonical: string; digest: string;
};
export type StoredTarget = { records: TargetState; snapshotHash: string; digest: string };

export function validateSnapshot(records: TargetState): TargetState {
  const { state } = validateTarget(records);
  // The bootstrap projection verifies metadata ID uniqueness and scoped record shapes.
  projectBootstrapTarget(state, []);
  const customers = new Set(state.customers.map(customer => customer.id));
  if (state.accounts.some(account => account.id !== state.scope.accountId || !customers.has(account.parentCustomerId))) {
    throw new Error('Invalid stored account or customer association');
  }
  return state;
}

export function decodeSnapshot(row: SnapshotRow): StoredTarget {
  const records = validateSnapshot(decodeCanonical(TargetStateSchema, row.canonical, row.digest));
  const snapshotHash = hashTargetSnapshot(records);
  if (!sameScope(scopeOf(row), records.scope) || readVersion(row.target_version) !== records.version ||
      row.recorded_as_of !== records.asOf || row.snapshot_hash !== snapshotHash) {
    throw new Error('Stored snapshot bindings differ');
  }
  return { records, snapshotHash, digest: row.digest };
}

export async function readStoredTarget(client: PoolClient, input: Scope, snapshotHash?: string): Promise<StoredTarget | null> {
  const scope = ScopeSchema.parse(input);
  const values = scopeValues(scope);
  const filter = 's.account_id = $1 AND s.company_id = $2 AND s.seller_entity_id = $3';
  const { rows: [row] } = snapshotHash === undefined
    ? await client.query<SnapshotRow & { pointer_version: string }>(
      `SELECT s.*, t.target_version AS pointer_version
       FROM parent_targets t JOIN parent_snapshots s USING (account_id, company_id, seller_entity_id, snapshot_hash)
       WHERE ${filter}`, values,
    )
    : await client.query<SnapshotRow>(
      `SELECT s.* FROM parent_snapshots s WHERE ${filter} AND s.snapshot_hash = $4`, [...values, HashSchema.parse(snapshotHash)],
    );
  if (!row) return null;
  const decoded = decodeSnapshot(row);
  if (!sameScope(scope, decoded.records.scope) || (snapshotHash !== undefined && snapshotHash !== decoded.snapshotHash) ||
      ('pointer_version' in row && readVersion(row.pointer_version) !== decoded.records.version)) {
    throw new Error('Stored target pointer differs');
  }
  return decoded;
}

export function projectStoredParentView(records: TargetState, evaluationAsOf: string): ParentView {
  const state = validateSnapshot(records);
  const legacyReferences = financialRecords(state).map(record => ({
    targetRecordId: record.id, identity: record.identity,
    sourceRecordVersion: record.sourceRecordVersion, sourceEventId: record.sourceEventId,
  })).sort((left, right) => left.targetRecordId < right.targetRecordId ? -1 : left.targetRecordId > right.targetRecordId ? 1 : 0);
  return ParentViewSchema.parse({
    scope: state.scope, version: state.version, asOf: evaluationAsOf, snapshotHash: hashTargetSnapshot(state),
    balanceCents: computeBalance(state, evaluationAsOf), records: state, legacyReferences,
  });
}
