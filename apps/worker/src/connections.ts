import type { Pool } from 'pg';
import { ConnectionStateV1Schema, SyncReceiptSchema, type ConnectionStateV1 } from '@eapr/contracts';
import type { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { ParentReadError } from './routes/parent.js';

type RegisteredScopeReader = ReturnType<typeof createRegisteredScopeReader>;
type Row = Record<string, unknown>;

/** Authoritative read-only operations view; one consistent snapshot, no writes and no source or model access. */
export function createConnectionReads(db: Pool, registry: RegisteredScopeReader) {
  return {
    async readConnection(accountId: string): Promise<ConnectionStateV1> {
      const member = (await registry.readSnapshot()).resolveRegisteredScope(accountId);
      if (!member) throw new ParentReadError(404);
      const { scope } = member.entry;
      const client = await db.connect();
      let discard = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const one = async (text: string) => (await client.query<Row>(text, [accountId])).rows;
        const [head] = await one('SELECT status, epoch, changed_at FROM runtime_authority_heads WHERE account_id = $1');
        const [initial] = await one('SELECT activation_id, receipt, target_version FROM runtime_activation_imports WHERE account_id = $1');
        const [target] = await one('SELECT target_version FROM parent_targets WHERE account_id = $1');
        const synced = await one('SELECT receipt, before_version, after_version FROM runtime_sync_receipts WHERE account_id = $1 ORDER BY after_version DESC LIMIT 50');
        const [total] = await one('SELECT count(*) AS total FROM runtime_sync_receipts WHERE account_id = $1');
        // Resolve the lane from this account's own committed source and manifest; enrolled accounts share one lane.
        const lane = 'JOIN runtime_activation_imports a ON a.account_id = $1 AND c.source_ref = a.bundle::jsonb->\'manifest\'->>\'sourceRef\' ' +
          'AND c.manifest_hash = a.activation::jsonb->>\'manifestHash\' ';
        const streams = await one('SELECT c.source_ref, c.stream_id, c.transport, c.baseline_cursor, c.capture_cursor, c.captured_pages, c.last_captured_at ' +
          'FROM runtime_capture_checkpoints c ' + lane + 'ORDER BY c.source_ref, c.stream_id LIMIT 50');
        const incidents = await one('SELECT c.source_ref, c.stream_id, c.code, c.observed_at, c.source_ids_canonical ' +
          'FROM runtime_capture_incidents c ' + lane + 'ORDER BY c.observed_at DESC, c.incident_hash LIMIT 50');
        await client.query('COMMIT');

        const initialReceipt = initial ? SyncReceiptSchema.parse(JSON.parse(String(initial.receipt))) : undefined;
        const receipts = [
          ...synced.map(row => {
            const receipt = SyncReceiptSchema.parse(JSON.parse(String(row.receipt)));
            return { receipt, kind: 'sync' as const, before: Number(row.before_version), after: Number(row.after_version) };
          }),
          ...(initialReceipt ? [{ receipt: initialReceipt, kind: 'initial' as const, before: null, after: Number(initial!.target_version) }] : []),
        ].map(({ receipt, kind, before, after }) => ({
          id: receipt.id, kind, activationId: receipt.activationId, epoch: receipt.epoch, planHash: receipt.planHash,
          beforeVersion: before, afterVersion: after, eventCount: receipt.eventIds.length,
          recordCount: receipt.targetRecordIds.length, beforeBalanceCents: receipt.beforeBalanceCents,
          afterBalanceCents: receipt.afterBalanceCents, committedAt: receipt.committedAt,
        }));
        return ConnectionStateV1Schema.parse({
          schemaVersion: '1', scope,
          status: head ? head.status : initial ? 'active' : 'inactive',
          epoch: head ? Number(head.epoch) : initial ? 1 : 0,
          activationId: initial ? initial.activation_id : null,
          statusChangedAt: head ? head.changed_at : initialReceipt?.committedAt ?? null,
          parentVersion: target ? Number(target.target_version) : 0,
          streams: streams.map(row => ({
            sourceRef: row.source_ref, streamId: row.stream_id, transport: row.transport,
            baselineCursor: Number(row.baseline_cursor), capturedThrough: Number(row.capture_cursor),
            capturedPages: Number(row.captured_pages), lastCapturedAt: row.last_captured_at, lagEvents: null,
          })),
          incidents: incidents.map(row => ({
            sourceRef: row.source_ref, streamId: row.stream_id, code: row.code, observedAt: row.observed_at,
            sourceIds: JSON.parse(String(row.source_ids_canonical)),
          })),
          receipts: receipts.slice(0, 50),
          counts: { appliedBatches: Number(total?.total ?? 0), pendingEvents: null, quarantinedEvents: null },
          lastReceiptId: receipts.sort((a, b) => b.afterVersion - a.afterVersion)[0]?.id ?? null,
          runtimeModelCalls: null,
        });
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { discard = true; }
        if (error instanceof ParentReadError) throw error;
        throw new ParentReadError(503);
      } finally {
        client.release(discard);
      }
    },
  };
}
