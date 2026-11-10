import type { Pool, PoolClient } from 'pg';
import {
  ChangePageSchema, MutationPlanSchema, canonicalJson, targetRecordId,
  type ChangePage, type Id, type MutationPlan, type RawSourceEvent, type ReceiptResponse, type SemanticPreflight,
} from '@eapr/contracts';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { decodeCanonical } from '@eapr/parent/snapshots';
import { readSyncReceipt, readSyncUnit, type SyncUnitAudit } from '@eapr/parent/sync-store';
import type { Clock } from '@eapr/storage/control-db';
import { withTransaction } from '@eapr/storage/transaction';
import { companyADemo } from '../../../packages/contracts/src/demo-company-a.js';
import { selectedProfile } from './activation-validation.js';
import { readIngressAuthorityIdentity } from './authority-identity.js';
import { createSyncApplier } from './sync/apply.js';
import { createRuntimeCapture } from './sync/capture.js';

const requestBudget = 24;
const eventBudget = 1000;
const expectedEventIds = [
  companyADemo.scenario.paymentEventId,
  companyADemo.scenario.allocationEventId,
] as const;

type RegisteredReader = {
  readSnapshot(): Promise<{
    resolveRegisteredScope(accountId: string): {
      entry: {
        accountId: string;
        scope: { accountId: string; companyId: string; sellerEntityId: string };
        profileHash: string; manifestId: string; manifestHash: string; manifestAsOf: string;
      };
      profile: {
        id: string; version: number; hash: string; sourceRef: string;
        scope: { accountId: string; companyId: string; sellerEntityId: string };
        parentCustomerId: string; sourceAccountIds: string[];
      };
      manifest: {
        id: string; companyId: string; sourceRef: string; epoch: number; asOf: string; hash: string;
      };
    } | null;
  }>;
};

export class CompanyADemoSyncError extends Error {
  constructor(readonly code:
    | 'DEMO_BINDING_INVALID' | 'DEMO_HISTORY_INVALID' | 'DEMO_CAPTURE_INCOMPLETE' | 'DEMO_SCENARIO_INVALID',
  ) {
    super(code);
    this.name = 'CompanyADemoSyncError';
  }
}

function requireDemo(condition: unknown, code: CompanyADemoSyncError['code']): asserts condition {
  if (!condition) throw new CompanyADemoSyncError(code);
}

const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

function expectedScope() {
  return {
    accountId: companyADemo.accountId,
    companyId: companyADemo.companyId,
    sellerEntityId: companyADemo.sellerEntityId,
  };
}

function validateEvent(event: RawSourceEvent) {
  const common = event.sourceRef === companyADemo.sourceRef &&
    event.streamId === 'a-finance' &&
    event.rawIdentity.companyId === companyADemo.companyId &&
    event.rawIdentity.sellerEntityId === companyADemo.sellerEntityId &&
    event.rawIdentity.sourceAccountId === companyADemo.sourceAccountId &&
    event.recordVersion === 1 &&
    event.effectiveAt === companyADemo.scenario.effectiveDate + 'T00:00:00.000Z' &&
    event.observedAt === companyADemo.scenario.observedAt;
  if (!common) return false;
  if (event.id === companyADemo.scenario.paymentEventId) {
    return event.kind === 'payment' && event.resource === 'a-payments' &&
      event.recordId === companyADemo.scenario.paymentRecordId &&
      equal(event.payload, {
        amount: companyADemo.scenario.amount,
        id: companyADemo.scenario.paymentRecordId,
        version: 1,
        account: companyADemo.sourceAccountId,
        effective_date: companyADemo.scenario.effectiveDate,
      });
  }
  return event.id === companyADemo.scenario.allocationEventId &&
    event.kind === 'allocation' && event.resource === 'a-allocations' &&
    event.recordId === companyADemo.scenario.allocationRecordId &&
    equal(event.payload, {
      amount: companyADemo.scenario.amount,
      funding_kind: 'payment',
      funding_id: companyADemo.scenario.paymentRecordId,
      invoice_id: companyADemo.scenario.invoiceId,
      id: companyADemo.scenario.allocationRecordId,
      version: 1,
      account: companyADemo.sourceAccountId,
      effective_date: companyADemo.scenario.effectiveDate,
    });
}

function expectedTargetIds() {
  const identity = (kind: 'payment' | 'allocation', recordId: string) => targetRecordId({
    sourceRef: companyADemo.sourceRef, sellerEntityId: companyADemo.sellerEntityId, kind, recordId,
  });
  return [
    identity('payment', companyADemo.scenario.paymentRecordId),
    identity('allocation', companyADemo.scenario.allocationRecordId),
  ];
}

function validatePlan(plan: MutationPlan | null) {
  requireDemo(plan && plan.asOf === companyADemo.scenario.asOf &&
    equal(plan.scope, expectedScope()) && equal(plan.eventIds, expectedEventIds) &&
    plan.operations.length === 2, 'DEMO_SCENARIO_INVALID');
  const records = plan.operations.map(operation => operation.record);
  const payment = records.find(record => 'kind' in record && record.kind === 'payment');
  const allocation = records.find(record => 'kind' in record && record.kind === 'allocation');
  requireDemo(payment && allocation && 'amountCents' in payment && 'amountCents' in allocation &&
    payment.sourceEventId === companyADemo.scenario.paymentEventId &&
    payment.identity.recordId === companyADemo.scenario.paymentRecordId &&
    payment.amountCents === companyADemo.scenario.amountCents &&
    allocation.sourceEventId === companyADemo.scenario.allocationEventId &&
    allocation.identity.recordId === companyADemo.scenario.allocationRecordId &&
    allocation.amountCents === companyADemo.scenario.amountCents &&
    'fundingKind' in allocation && allocation.fundingKind === 'payment' &&
    allocation.fundingRecordId === companyADemo.scenario.paymentRecordId &&
    allocation.invoiceRecordId === companyADemo.scenario.invoiceId &&
    equal(records.map(record => record.id), expectedTargetIds()), 'DEMO_SCENARIO_INVALID');
}

type HistoryLocator = {
  unit_hash: string; receipt_id: string; plan_hash: string; plan: string; plan_digest: string; candidate_count: string;
};

async function locateHistory(client: PoolClient): Promise<HistoryLocator | null> {
  const { rows } = await client.query<HistoryLocator>(`
    SELECT candidate.unit_hash, candidate.receipt_id, candidate.plan_hash, candidate.plan, candidate.plan_digest,
      count(*) OVER ()::text AS candidate_count
    FROM (
      SELECT DISTINCT u.unit_hash, u.receipt_id, r.plan_hash, r.plan, r.plan_digest
      FROM runtime_sync_units u
      JOIN runtime_sync_receipts r ON r.receipt_id = u.receipt_id
      JOIN runtime_sync_event_outcomes o ON o.unit_hash = u.unit_hash
      WHERE (u.account_id, u.company_id, u.seller_entity_id) = ($1, $2, $3)
        AND o.event_id = ANY($4::text[]) AND u.receipt_id IS NOT NULL
    ) candidate
    ORDER BY candidate.unit_hash
    LIMIT 2
  `, [companyADemo.accountId, companyADemo.companyId, companyADemo.sellerEntityId, expectedEventIds]);
  if (rows.length === 0) return null;
  requireDemo(rows.length === 1 && rows[0]!.candidate_count === '1', 'DEMO_HISTORY_INVALID');
  return rows[0]!;
}

function validateRecoveredUnit(
  audit: SyncUnitAudit, receipt: ReceiptResponse['receipt'], plan: MutationPlan, locator: HistoryLocator,
) {
  try {
    validatePlan(plan);
  } catch {
    throw new CompanyADemoSyncError('DEMO_HISTORY_INVALID');
  }
  requireDemo(audit.receiptId === locator.receipt_id && audit.planHash === locator.plan_hash &&
    audit.asOf === companyADemo.scenario.asOf &&
    audit.lane.sourceRef === companyADemo.sourceRef &&
    audit.identity.scope.accountId === companyADemo.accountId &&
    equal(audit.members.map(member => member.event.eventId), expectedEventIds) &&
    equal(receipt.eventIds, expectedEventIds) &&
    equal(receipt.targetRecordIds, expectedTargetIds()) &&
    receipt.id === locator.receipt_id && receipt.planHash === locator.plan_hash &&
    plan.hash === locator.plan_hash && receipt.afterBalanceCents === plan.expectedBalanceCents &&
    receipt.beforeBalanceCents - receipt.afterBalanceCents === companyADemo.scenario.amountCents,
  'DEMO_HISTORY_INVALID');
  const events = expectedEventIds.map(id =>
    audit.coverage.deliveries.find(delivery => delivery.event.id === id)?.event);
  requireDemo(events.every((event): event is RawSourceEvent => Boolean(event)) &&
    events.every(validateEvent), 'DEMO_HISTORY_INVALID');
}

export function createCompanyADemoSync({ db, clock, registered, fetchChanges, observe }: {
  db: Pool;
  clock: Clock;
  registered: RegisteredReader;
  fetchChanges(sourceRef: Id, streamId: Id, after: string): Promise<ChangePage>;
  observe(sourceRef: Id): Promise<SemanticPreflight>;
}) {
  async function resolveIdentity() {
    const subject = await readIngressAuthorityIdentity(db, companyADemo.accountId);
    const member = (await registered.readSnapshot()).resolveRegisteredScope(companyADemo.accountId);
    requireDemo(member && equal(subject.identity.scope, expectedScope()) &&
      subject.sourceRef === companyADemo.sourceRef &&
      subject.profileHash === member.entry.profileHash &&
      subject.manifestHash === member.entry.manifestHash &&
      member.entry.accountId === companyADemo.accountId &&
      equal(member.entry.scope, expectedScope()) &&
      member.entry.manifestId === companyADemo.manifestId &&
      member.entry.manifestAsOf === companyADemo.cutover &&
      member.profile.id === companyADemo.profileId &&
      member.profile.version === companyADemo.profileVersion &&
      member.profile.hash === member.entry.profileHash &&
      member.profile.sourceRef === companyADemo.sourceRef &&
      equal(member.profile.scope, expectedScope()) &&
      member.profile.parentCustomerId === companyADemo.parentCustomerId &&
      equal(member.profile.sourceAccountIds, [companyADemo.sourceAccountId]) &&
      member.manifest.id === companyADemo.manifestId &&
      member.manifest.hash === member.entry.manifestHash &&
      member.manifest.companyId === companyADemo.companyId &&
      member.manifest.sourceRef === companyADemo.sourceRef &&
      member.manifest.epoch === companyADemo.manifestEpoch &&
      member.manifest.asOf === companyADemo.cutover, 'DEMO_BINDING_INVALID');
    await withTransaction(db, async client => {
      await client.query('SET TRANSACTION READ ONLY');
      const stored = await readStoredActivation(client, subject.identity.scope);
      const profile = stored && selectedProfile(stored.bundle);
      requireDemo(stored && stored.bundleHash === subject.identity.bundleHash &&
        stored.activation.id === subject.identity.activationId &&
        stored.activation.artifactHash === subject.artifactHash &&
        stored.activation.profileHash === subject.profileHash &&
        stored.activation.manifestHash === subject.manifestHash &&
        stored.bundle.manifest.id === companyADemo.manifestId &&
        stored.bundle.manifest.asOf === companyADemo.cutover &&
        stored.bundle.manifest.epoch === companyADemo.manifestEpoch &&
        stored.bundle.artifact.hash === subject.artifactHash &&
        stored.bundle.artifact.sourceRef === companyADemo.sourceRef, 'DEMO_BINDING_INVALID');
      requireDemo(profile && profile.id === companyADemo.profileId &&
        profile.version === companyADemo.profileVersion &&
        equal(profile.scope, expectedScope()) &&
        profile.parentCustomerId === companyADemo.parentCustomerId &&
        equal(profile.sourceAccountIds, [companyADemo.sourceAccountId]) &&
        equal(stored.bundle.artifact.requiredProfileHashes, [profile.hash]) &&
        stored.bundle.artifact.normalizedPlan.runtimeModelCalls === 'forbidden' &&
        equal(stored.bundle.artifact.normalizedPlan.capture.map(stream => ({
          streamId: stream.streamId, transport: stream.transport, pageSize: stream.pageSize,
        })), [
          { streamId: 'a-finance', transport: 'api', pageSize: 100 },
          { streamId: 'a-semantics', transport: 'semantic', pageSize: 100 },
        ]), 'DEMO_BINDING_INVALID');
    });
    return subject;
  }

  async function recover(identity: Awaited<ReturnType<typeof resolveIdentity>>['identity']) {
    return withTransaction(db, async client => {
      await client.query('SET TRANSACTION READ ONLY');
      const locator = await locateHistory(client);
      if (!locator) return null;
      const receipt = await readSyncReceipt(client, identity.scope, locator.plan_hash);
      const unit = await readSyncUnit(client, identity, locator.unit_hash);
      requireDemo(receipt && unit, 'DEMO_HISTORY_INVALID');
      let plan: MutationPlan;
      try {
        plan = decodeCanonical(MutationPlanSchema, locator.plan, locator.plan_digest);
      } catch {
        throw new CompanyADemoSyncError('DEMO_HISTORY_INVALID');
      }
      validateRecoveredUnit(unit, receipt, plan, locator);
      return { receipt, replayed: true } satisfies ReceiptResponse;
    });
  }

  async function drain(identity: Awaited<ReturnType<typeof resolveIdentity>>['identity']) {
    const capture = await createRuntimeCapture({ db, clock }).openCommitted(identity);
    let requests = 0;
    let events = 0;
    for (const initial of (await capture.readProgress()).streams) {
      let cursor = initial.captureCursor;
      for (;;) {
        requireDemo(requests < requestBudget, 'DEMO_CAPTURE_INCOMPLETE');
        requests += 1;
        const parsed = ChangePageSchema.safeParse(await fetchChanges(capture.lane.sourceRef, initial.streamId, cursor));
        requireDemo(parsed.success && parsed.data.sourceRef === capture.lane.sourceRef &&
          parsed.data.streamId === initial.streamId && parsed.data.after === cursor &&
          parsed.data.complete, 'DEMO_CAPTURE_INCOMPLETE');
        const page = parsed.data;
        events += page.events.length;
        requireDemo(events <= eventBudget, 'DEMO_CAPTURE_INCOMPLETE');
        if (page.events.length === 0) {
          const current = (await capture.readProgress()).streams.find(stream => stream.streamId === initial.streamId);
          requireDemo(current?.captureCursor === cursor, 'DEMO_CAPTURE_INCOMPLETE');
          break;
        }
        await capture.capturePage(page);
        const current = (await capture.readProgress()).streams.find(stream => stream.streamId === initial.streamId);
        requireDemo(current && Number(current.captureCursor) >= Number(page.next) &&
          Number(current.captureCursor) > Number(cursor), 'DEMO_CAPTURE_INCOMPLETE');
        cursor = current.captureCursor;
      }
    }
  }

  return {
    async runOnce(): Promise<ReceiptResponse> {
      const { identity } = await resolveIdentity();
      const saved = await recover(identity);
      if (saved) return saved;
      await drain(identity);
      const applier = createSyncApplier({ db, clock, identity, observe });
      let prepared;
      try {
        prepared = await applier.prepare(companyADemo.scenario.asOf);
      } catch (error) {
        const winner = await recover(identity);
        if (winner) return winner;
        throw error;
      }
      requireDemo(equal(prepared.events.map(event => event.id), expectedEventIds) &&
        prepared.events.every(validateEvent), 'DEMO_SCENARIO_INVALID');
      validatePlan(prepared.plan);
      try {
        return await applier.applyBatch(prepared.plan!, prepared.expectedEpoch);
      } catch (error) {
        const winner = await recover(identity);
        if (winner) return winner;
        throw error;
      }
    },
  };
}
