import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  canonicalJson, hashPlan, SyncReceiptSchema,
  type CommittedAuthorityIdentityV1, type CompiledArtifact, type CustomerProfile, type MutationPlan, type RawSourceEvent, type ReceiptResponse, type Scope,
} from '@eapr/contracts';
import { planBatch } from '@eapr/compiler/plan-batch';
import { computeBalance } from '@eapr/finance/balance';
import { checkedAdd, FinanceError, sameScope, type FinancialRecord } from '@eapr/finance/validate';
import { lockImportIdentities } from '@eapr/parent/persistence';
import { projectTarget, type FinancialMutation } from '@eapr/parent/state';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { persistSyncBatch, readSyncReceipt } from '@eapr/parent/sync-store';
import { withTransaction } from '@eapr/storage/transaction';
import { assertActiveAuthority, lockCurrentAuthority } from './current-authority-store.js';

export type SyncApplyCode =
  | 'SYNC_BINDING_MISMATCH' | 'SYNC_TARGET_STALE' | 'SYNC_PLAN_MISMATCH' | 'SYNC_INVALID_PLAN';

export class SyncApplyError extends Error {
  constructor(readonly code: SyncApplyCode, message: string = code) {
    super(message);
    this.name = 'SyncApplyError';
  }
}

const financial = (operation: MutationPlan['operations'][number]): operation is MutationPlan['operations'][number] & FinancialMutation =>
  'identity' in operation.record;

/**
 * Applies one ongoing plan for the exact artifact and profile this closure was built with.
 * The caller's plan is never trusted: it is recomputed against locked target facts and compared byte for byte.
 * `events` are the captured inbox events the plan was selected from, loaded outside this transaction.
 */
export function createSyncApplier({ db, clock, artifact, profile, identity }: {
  db: Pool; clock: () => Date; artifact: CompiledArtifact; profile: CustomerProfile; identity: CommittedAuthorityIdentityV1;
}) {
  const scope: Scope = profile.scope;

  return async function applyBatch(plan: MutationPlan, events: RawSourceEvent[], expectedEpoch: number): Promise<ReceiptResponse> {
    if (hashPlan(plan) !== plan.hash || !sameScope(plan.scope, scope) || plan.artifactHash !== artifact.hash ||
        plan.profileHash !== profile.hash) throw new SyncApplyError('SYNC_BINDING_MISMATCH');
    return withTransaction(db, async client => {
      const locked = await lockCurrentAuthority(client, identity);
      const prior = await readSyncReceipt(client, scope, plan.hash);
      if (prior) return { receipt: prior, replayed: true };
      const activation = locked.stored;
      if (activation.activation.artifactHash !== artifact.hash ||
          activation.activation.profileHash !== profile.hash) throw new SyncApplyError('SYNC_BINDING_MISMATCH');
      assertActiveAuthority(client, locked, expectedEpoch);

      await client.query(
        'SELECT 1 FROM parent_targets WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3 FOR UPDATE',
        [scope.accountId, scope.companyId, scope.sellerEntityId],
      );
      const previous = await readStoredTarget(client, scope);
      if (!previous || previous.records.version !== plan.expectedTargetVersion) throw new SyncApplyError('SYNC_TARGET_STALE');

      const planner = { ...previous.records, asOf: plan.asOf };
      const outcome = planBatch(artifact, profile, events, planner);
      const [recomputed] = outcome.plans;
      if (outcome.plans.length !== 1 || !recomputed || canonicalJson(recomputed) !== canonicalJson(plan)) {
        throw new SyncApplyError('SYNC_PLAN_MISMATCH');
      }
      if (!plan.operations.length || !plan.operations.every(financial)) throw new SyncApplyError('SYNC_INVALID_PLAN');

      const records = plan.operations.map(operation => operation.record as FinancialRecord);
      const byId = new Map(events.map(event => [event.id, event]));
      const planned = plan.eventIds.map(id => {
        const event = byId.get(id);
        if (!event) throw new SyncApplyError('SYNC_PLAN_MISMATCH');
        return event;
      });
      const identityLocks = await lockImportIdentities(client, records.map(record => record.identity), planned);

      let next;
      try {
        next = { ...projectTarget(planner, plan.operations as FinancialMutation[]), version: checkedAdd(planner.version, 1) };
      } catch (error) {
        if (error instanceof FinanceError) throw new SyncApplyError('SYNC_INVALID_PLAN', error.code);
        throw error;
      }
      const receipt = SyncReceiptSchema.parse({
        id: 'receipt:' + randomUUID(), scope, activationId: activation.activation.id, epoch: expectedEpoch,
        artifactHash: artifact.hash, planHash: plan.hash, eventIds: plan.eventIds, targetRecordIds: records.map(record => record.id),
        beforeBalanceCents: computeBalance(planner, plan.asOf), afterBalanceCents: computeBalance(next, plan.asOf),
        status: 'applied', committedAt: clock().toISOString(),
      });
      if (receipt.afterBalanceCents !== plan.expectedBalanceCents) throw new SyncApplyError('SYNC_PLAN_MISMATCH');
      await persistSyncBatch(client, { scope, plan, receipt, previous, next, records, events: planned, identityLocks });
      return { receipt, replayed: false };
    });
  };
        }
