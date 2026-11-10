import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  CommittedAuthorityIdentityV1Schema, IsoInstantSchema, MutationPlanSchema, SemanticPreflightSchema, SyncReceiptSchema,
  hashCanonical, hashPlan, hashTargetSnapshot,
  type CommittedAuthorityIdentityV1, type MutationPlan, type ReceiptResponse, type SemanticPreflight,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { checkedAdd, FinanceError } from '@eapr/finance/validate';
import { readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
import { lockImportIdentities } from '@eapr/parent/persistence';
import { readStoredTarget, scopeValues } from '@eapr/parent/snapshots';
import { projectTarget, type FinancialMutation } from '@eapr/parent/state';
import {
  persistSyncUnit, readSyncCommit, readSyncTargetOrigins, readSyncUnit, replayResponse, syncEventRef,
  type ReplayResponse, type SyncUnitAudit, type UnitMember,
} from '@eapr/parent/sync-store';
import { publishActivity } from '@eapr/storage/activity';
import { sqlState, withTransaction } from '@eapr/storage/transaction';
import { ActivationError, selectedProfile, validateSemantics } from '../activation-validation.js';
import { classifyCapturedGroup, prepareCapturedUnit, readCoverageCut } from './apply-coverage.js';
import { equal, hashPreparedUnit, PreparedSyncUnitSchema, requireSync, SyncApplyError, type PreparedSyncUnit } from './apply-types.js';
import { authorityError, AuthorityError } from './current-authority-errors.js';
import { assertActiveAuthority, lockCurrentAuthority } from './current-authority-store.js';

export { SyncApplyError, type SyncApplyCode } from './apply-types.js';

async function readStorage<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof SyncApplyError || error instanceof AuthorityError) throw error;
    const state = sqlState(error);
    // The transaction wrapper has already handled retries. Retain the SQLSTATE
    // for callers without returning the database error detail or statement.
    if (state && /^[0-9A-Z]{5}$/.test(state)) {
      throw Object.assign(new Error('Synchronization storage transaction failed'), { code: state });
    }
    throw new SyncApplyError('SYNC_STORAGE_INVALID');
  }
}

function checkEpoch(actual: number, expected: number) {
  if (!Number.isSafeInteger(expected) || expected <= 0) throw authorityError('AUTHORITY_INPUT_INVALID');
  if (actual !== expected) throw authorityError('AUTHORITY_STALE');
}

function checkPlanBinding(plan: MutationPlan, stored: StoredActivation) {
  const { artifactHash, profileHash, scope } = stored.activation;
  requireSync(equal(plan.scope, scope) && plan.artifactHash === artifactHash && plan.profileHash === profileHash,
    'SYNC_BINDING_MISMATCH');
}

type Attempt = {
  prepared: PreparedSyncUnit; expectedEpoch: number; observation: SemanticPreflight; committedAt: string;
  recover(client: PoolClient): Promise<ReceiptResponse | ReplayResponse | null>;
};

/** New units use the complete committed lane suffix. Exact recovery reads immutable history first. */
export function createSyncApplier({ db, clock, identity: inputIdentity, observe }: {
  db: Pool; clock: () => Date; identity: CommittedAuthorityIdentityV1;
  observe: (sourceRef: string) => Promise<SemanticPreflight>;
}): {
  prepare(asOf: string): Promise<PreparedSyncUnit>;
  applyBatch(plan: MutationPlan, expectedEpoch: number): Promise<ReceiptResponse>;
  applyReplay(prepared: PreparedSyncUnit, expectedEpoch: number): Promise<ReplayResponse>;
} {
  const parsedIdentity = CommittedAuthorityIdentityV1Schema.safeParse(inputIdentity);
  requireSync(parsedIdentity.success && equal(parsedIdentity.data, inputIdentity), 'SYNC_BINDING_MISMATCH');
  const identity = parsedIdentity.data;
  const { scope } = identity;

  function read<T>(reader: (client: PoolClient) => Promise<T>): Promise<T> {
    return readStorage(() => withTransaction(db, async client => {
      await client.query('SET TRANSACTION READ ONLY');
      return reader(client);
    }));
  }

  async function prepareAttempt<T>(
    recover: (client: PoolClient) => Promise<T | null>,
    prepare: () => Promise<Omit<Attempt, 'recover' | 'expectedEpoch'>>,
  ): Promise<{ saved: T; work?: never } | { saved?: never; work: Omit<Attempt, 'recover' | 'expectedEpoch'> }> {
    const saved = await read(recover);
    if (saved) return { saved };
    try {
      return { work: await prepare() };
    } catch (error) {
      // A winner may commit between the first lookup and preparation, leaving
      // no pending suffix, a stale epoch, or a temporarily unavailable source.
      // This lookup is outside the write attempt and cannot mask its COMMIT.
      if (error instanceof SyncApplyError || error instanceof AuthorityError || error instanceof ActivationError) {
        const winner = await read(recover);
        if (winner) return { saved: winner };
      }
      throw error;
    }
  }

  async function readGrant(client: PoolClient) {
    const stored = await readStoredActivation(client, scope);
    requireSync(stored && stored.bundleHash === identity.bundleHash && stored.activation.id === identity.activationId, 'SYNC_BINDING_MISMATCH');
    return stored;
  }

  async function preflight(prepared: PreparedSyncUnit, stored: StoredActivation) {
    let observation;
    try {
      observation = SemanticPreflightSchema.parse(await observe(prepared.lane.sourceRef));
    } catch {
      throw new SyncApplyError('SYNC_SOURCE_UNAVAILABLE');
    }
    validateSemantics(stored.bundle, selectedProfile(stored.bundle), observation);
    return { observation, committedAt: IsoInstantSchema.parse(clock().toISOString()) };
  }

  async function commit({ prepared, expectedEpoch, observation, committedAt, recover }: Attempt) {
    return readStorage(() => withTransaction(db, async client => {
      // lockCurrentAuthority acquires the shared parent-scope advisory lock before the head.
      const locked = await lockCurrentAuthority(client, identity);
      const saved = await recover(client);
      if (saved) return saved;
      assertActiveAuthority(client, locked, expectedEpoch);
      const { activation, bundle } = locked.stored;

      const targetLock = await client.query(`
        SELECT 1 FROM parent_targets WHERE (account_id, company_id, seller_entity_id) = ($1, $2, $3) FOR UPDATE
      `, scopeValues(scope));
      const previous = await readStoredTarget(client, scope);
      requireSync(targetLock.rowCount === 1 && previous);
      requireSync(previous.records.version === prepared.expectedTargetVersion &&
        previous.snapshotHash === prepared.beforeSnapshotHash, 'SYNC_TARGET_STALE');

      const coverage = await readCoverageCut(client, identity).catch(error => {
        if (error instanceof SyncApplyError && error.code === 'SYNC_COVERAGE_UNSUPPORTED') {
          throw new SyncApplyError('SYNC_COVERAGE_CHANGED');
        }
        throw error;
      });
      requireSync(hashCanonical(coverage) === prepared.coverageHash && equal(coverage, prepared.coverage), 'SYNC_COVERAGE_CHANGED');
      const events = coverage.deliveries.slice(coverage.historyOutcomes.length).map(row => row.event);
      const { plan, items } = classifyCapturedGroup({
        activation, artifact: bundle.artifact, profile: selectedProfile(bundle), identity, events,
      }, previous, prepared.asOf);
      requireSync(equal(plan, prepared.plan), 'SYNC_PLAN_MISMATCH');

      const identities = items.flatMap(({ mapped }) => [mapped.identity, ...mapped.prerequisites.map(item => item.identity)]);
      const identityLocks = await lockImportIdentities(client, identities, events);
      const origins = await readSyncTargetOrigins(client, scope, previous);
      const { asOf, streamId } = prepared;
      const operations = plan?.operations.filter((operation): operation is FinancialMutation => 'identity' in operation.record) ?? [];
      requireSync(operations.length === (plan?.operations.length ?? 0), 'SYNC_INVALID_PLAN');
      let next = previous.records;
      let receipt = null;
      if (plan) {
        const before = { ...previous.records, asOf };
        try {
          next = { ...projectTarget(before, operations), version: checkedAdd(before.version, 1) };
          receipt = SyncReceiptSchema.parse({
            id: 'receipt:' + randomUUID(), scope, activationId: activation.id, epoch: expectedEpoch,
            artifactHash: activation.artifactHash, planHash: plan.hash, eventIds: plan.eventIds,
            targetRecordIds: operations.map(({ record }) => record.id), beforeBalanceCents: computeBalance(before, asOf),
            afterBalanceCents: computeBalance(next, asOf), status: 'applied', committedAt,
          });
        } catch (error) {
          if (error instanceof FinanceError) throw new SyncApplyError('SYNC_INVALID_PLAN');
          throw error;
        }
        requireSync(receipt.afterBalanceCents === plan.expectedBalanceCents, 'SYNC_PLAN_MISMATCH');
      }

      const members: UnitMember[] = items.map(({ record, disposition }, index) => {
        const event = syncEventRef(events[index]!);
        if (disposition === 'financial_replay') {
          const origin = origins.get(record.id);
          requireSync(origin);
          return { event, recordId: record.id, origin, disposition: 'replay' };
        }
        requireSync(receipt, 'SYNC_INVALID_PLAN');
        return {
          event, recordId: record.id, origin: { kind: 'sync', recordId: record.id, receipt },
          disposition: disposition === 'financial_new' ? 'new' : 'coalesced',
        };
      });
      const checkpoint = coverage.checkpoints.find(row => row.streamId === streamId);
      requireSync(checkpoint);
      const fromCursor = coverage.applicationHeads.find(row => row.streamId === streamId)?.appliedThrough ?? checkpoint.baselineCursor;
      const audit: SyncUnitAudit = {
        identity, lane: coverage.lane, streamId, expectedEpoch, expectedTargetVersion: prepared.expectedTargetVersion,
        beforeSnapshotHash: prepared.beforeSnapshotHash, asOf, coverage, coverageHash: prepared.coverageHash,
        unitHash: hashPreparedUnit(prepared), planHash: plan?.hash ?? null, fromCursor, throughCursor: checkpoint.captureCursor,
        afterTargetVersion: next.version, afterSnapshotHash: hashTargetSnapshot(next), receiptId: receipt?.id ?? null,
        semanticObservation: observation, committedAt, members,
      };
      const result = await persistSyncUnit(client, {
        audit, previous, next, plan, receipt, members, identities, identityLocks, expectedHeads: coverage.applicationHeads,
      });
      await publishActivity(client, {
        stream: 'runtime', phase: 'run', scope, at: committedAt, type: receipt ? 'batch.applied' : 'batch.replayed',
        payload: {
          sourceRef: audit.lane.sourceRef, manifestHash: audit.lane.manifestHash, count: members.length,
          status: receipt ? 'applied' : 'replayed',
          ...(receipt ? { receiptId: receipt.id, planHash: receipt.planHash } : {}),
        },
      });
      assertActiveAuthority(client, locked, expectedEpoch);
      return result;
    }));
  }

  return {
    prepare(asOf) {
      return read(client => prepareCapturedUnit(client, identity, asOf));
    },
    async applyBatch(input, expectedEpoch) {
      const parsed = MutationPlanSchema.safeParse(input);
      requireSync(parsed.success && equal(parsed.data, input) && equal(parsed.data.scope, scope) &&
        hashPlan(parsed.data) === parsed.data.hash, 'SYNC_BINDING_MISMATCH');
      const plan = parsed.data;
      requireSync(plan.operations.length > 0 && plan.eventIds.length > 0 &&
        plan.operations.every(operation => 'identity' in operation.record), 'SYNC_INVALID_PLAN');
      const recover = (client: PoolClient) => readSyncCommit(client, identity, plan);
      const attempt = await prepareAttempt(recover, async () => {
        const { prepared, stored } = await read(async client => {
          const stored = await readGrant(client);
          checkPlanBinding(plan, stored);
          const prepared = await prepareCapturedUnit(client, identity, plan.asOf);
          return { prepared, stored };
        });
        checkEpoch(prepared.expectedEpoch, expectedEpoch);
        requireSync(prepared.expectedTargetVersion === plan.expectedTargetVersion, 'SYNC_TARGET_STALE');
        requireSync(equal(prepared.plan, plan), 'SYNC_PLAN_MISMATCH');
        return { prepared, ...await preflight(prepared, stored) };
      });
      if (attempt.saved) return attempt.saved;
      const result = await commit({ ...attempt.work, expectedEpoch, recover });
      requireSync('receipt' in result);
      return result;
    },
    async applyReplay(input, expectedEpoch) {
      const parsed = PreparedSyncUnitSchema.safeParse(input);
      requireSync(parsed.success && equal(parsed.data, input) && equal(parsed.data.identity, identity) &&
        parsed.data.plan === null, 'SYNC_INVALID_PLAN');
      const requested = parsed.data;
      const recover = async (client: PoolClient) => {
        const unit = await readSyncUnit(client, identity, hashPreparedUnit(requested));
        if (!unit) return null;
        const { coverage, identity: committedIdentity, lane, streamId, expectedEpoch, expectedTargetVersion,
          beforeSnapshotHash, asOf, coverageHash } = unit;
        requireSync(unit.planHash === null && unit.receiptId === null && equal(requested, {
          identity: committedIdentity, lane, streamId, expectedEpoch, expectedTargetVersion, beforeSnapshotHash, asOf, coverageHash,
          coverage, events: coverage.deliveries.slice(coverage.historyOutcomes.length).map(row => row.event), plan: null,
        }), 'SYNC_INVALID_PLAN');
        return replayResponse(unit, true);
      };
      const attempt = await prepareAttempt(recover, async () => {
        const { prepared, stored } = await read(async client => ({
          prepared: await prepareCapturedUnit(client, identity, requested.asOf), stored: await readGrant(client),
        }));
        checkEpoch(prepared.expectedEpoch, expectedEpoch);
        checkEpoch(prepared.expectedEpoch, requested.expectedEpoch);
        requireSync(prepared.expectedTargetVersion === requested.expectedTargetVersion &&
          prepared.beforeSnapshotHash === requested.beforeSnapshotHash, 'SYNC_TARGET_STALE');
        requireSync(prepared.coverageHash === requested.coverageHash && equal(prepared.coverage, requested.coverage), 'SYNC_COVERAGE_CHANGED');
        requireSync(equal(prepared, requested), 'SYNC_PLAN_MISMATCH');
        return { prepared, ...await preflight(prepared, stored) };
      });
      if (attempt.saved) return attempt.saved;
      const result = await commit({ ...attempt.work, expectedEpoch, recover });
      requireSync('receipts' in result);
      return result;
    },
  };
}
