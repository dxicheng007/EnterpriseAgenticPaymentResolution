import type { Pool, PoolClient } from 'pg';
import { ChangePageSchema, type ChangePage, type RawSourceEvent, type ReceiptResponse, type SemanticPreflight } from '@eapr/contracts';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { scopeValues } from '@eapr/parent/snapshots';
import { readSyncReceipt, readSyncUnit } from '@eapr/parent/sync-store';
import type { Clock } from '@eapr/storage/control-db';
import { withTransaction } from '@eapr/storage/transaction';
import { companyADemo as demo } from '../../../packages/contracts/src/demo-company-a.js';
import { selectedProfile } from './activation-validation.js';
import { readIngressAuthorityIdentity } from './authority-identity.js';
import type { RegisteredScopeReader } from './parent-reads.js';
import { createSyncApplier } from './sync/apply.js';
import { equal, requireSync, syncHistoryLimit } from './sync/apply-types.js';
import { createRuntimeCapture } from './sync/capture.js';

type FetchChanges = (sourceRef: string, streamId: string, after: string) => Promise<ChangePage>;
type Capture = Awaited<ReturnType<ReturnType<typeof createRuntimeCapture>['openCommitted']>>;
type Ingress = Awaited<ReturnType<typeof readIngressAuthorityIdentity>>;
type Dependencies = {
  db: Pool; clock: Clock; registered: RegisteredScopeReader;
  fetchChanges: FetchChanges; observe: (sourceRef: string) => Promise<SemanticPreflight>;
};
type DemoSyncCode = 'DEMO_SYNC_BINDING_MISMATCH' | 'DEMO_SYNC_FETCH_LIMIT' |
  'DEMO_SYNC_FEED_INVALID' | 'DEMO_SYNC_SCENARIO_MISMATCH';

export class DemoSyncError extends Error {
  constructor(readonly code: DemoSyncCode) {
    super(code);
    this.name = 'DemoSyncError';
  }
}

export async function drainCompanyADemoFeed(capture: Pick<Capture, 'readProgress' | 'capturePage'>, fetchChanges: FetchChanges) {
  // Room for ten full source pages, two terminal probes, and concurrent refetches.
  const maxRequests = 32;
  let requests = 0;
  let fetchedEvents = 0;
  async function readCursor(streamId: string) {
    const progress = (await capture.readProgress()).streams.find(stream => stream.streamId === streamId);
    if (!progress) throw new DemoSyncError('DEMO_SYNC_FEED_INVALID');
    return progress.captureCursor;
  }

  for (const streamId of demo.streams) {
    let after = await readCursor(streamId);
    for (;;) {
      if (++requests > maxRequests) throw new DemoSyncError('DEMO_SYNC_FETCH_LIMIT');
      const page = await fetchChanges(demo.sourceRef, streamId, after);
      if (!ChangePageSchema.safeParse(page).success || !page.complete ||
          page.sourceRef !== demo.sourceRef || page.streamId !== streamId || page.after !== after) {
        throw new DemoSyncError('DEMO_SYNC_FEED_INVALID');
      }
      fetchedEvents += page.events.length;
      if (fetchedEvents > syncHistoryLimit) throw new DemoSyncError('DEMO_SYNC_FETCH_LIMIT');
      const result = await capture.capturePage(page);
      const cursor = await readCursor(streamId);
      if (page.events.length === 0 && result.disposition === 'empty' && cursor === after) break;
      if (Number(cursor) <= Number(after)) throw new DemoSyncError('DEMO_SYNC_FEED_INVALID');
      after = cursor;
    }
  }
}

function isScenario(events: RawSourceEvent[]) {
  const { scenario, recordIds, eventIds } = demo;
  return events.length === 2 && eventIds.every((id, index) => {
    const event = events.find(candidate => candidate.id === id);
    const recordId = recordIds[index];
    return event && event.sourceRef === demo.sourceRef && event.streamId === demo.streams[0] &&
      event.kind === (index === 0 ? 'payment' : 'allocation') &&
      event.recordId === recordId && event.recordVersion === 1 &&
      event.effectiveAt === scenario.observedAt && event.observedAt === scenario.observedAt &&
      equal(event.rawIdentity, {
        companyId: demo.scope.companyId, sellerEntityId: demo.scope.sellerEntityId, sourceAccountId: scenario.accountId,
      }) && equal(event.payload, {
        id: recordId, version: 1, account: scenario.accountId, effective_date: scenario.effectiveDate,
        amount: scenario.amount,
        ...(index === 0 ? {} : { funding_kind: 'payment', funding_id: recordIds[0], invoice_id: scenario.invoiceId }),
      });
  });
}

function isEventPair(ids: string[]) {
  return ids.length === 2 && demo.eventIds.every(id => ids.includes(id));
}

function readOnly<T>(db: Pool, read: (client: PoolClient) => Promise<T>) {
  return withTransaction(db, async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return read(client);
  });
}

function recoverScenario(db: Pool, { identity, artifactHash, manifestHash }: Ingress): Promise<ReceiptResponse | null> {
  return readOnly(db, async client => {
    // Locate partial overlaps from both canonical subjects and their delivery indexes.
    const { rows } = await client.query<{ receipt_id: string | null; plan_hash: string | null; unit_hash: string | null }>(`
      WITH receipts AS (
        SELECT receipt_id, plan_hash, receipt, plan FROM runtime_sync_receipts
        WHERE (account_id, company_id, seller_entity_id) = ($1,$2,$3)
      ), units AS (
        SELECT receipt_id, unit_hash, audit FROM runtime_sync_units
        WHERE (account_id, company_id, seller_entity_id) = ($1,$2,$3)
      )
      SELECT r.receipt_id, r.plan_hash, u.unit_hash
      FROM receipts r FULL JOIN units u ON u.receipt_id = r.receipt_id
      WHERE (parent_index_projection(r.receipt)->'eventIds') ?| $4::text[]
         OR (parent_index_projection(r.plan)->'eventIds') ?| $4::text[]
         OR jsonb_path_query_array(parent_index_projection(u.audit), '$.members[*].event.eventId') ?| $4::text[]
         OR EXISTS (
           SELECT 1 FROM runtime_sync_delivery_outcomes d
           WHERE d.receipt_id = r.receipt_id AND d.source_ref = $5 AND d.event_id = ANY($4::text[])
         )
         OR EXISTS (
           SELECT 1 FROM runtime_sync_event_outcomes o
           WHERE o.unit_hash = u.unit_hash AND o.source_ref = $5 AND o.event_id = ANY($4::text[])
         )
      LIMIT 2
    `, [...scopeValues(identity.scope), [...demo.eventIds], demo.sourceRef]);
    if (!rows.length) return null;
    const [candidate] = rows;
    requireSync(rows.length === 1 && candidate?.receipt_id && candidate.plan_hash && candidate.unit_hash);
    const receipt = await readSyncReceipt(client, identity.scope, candidate.plan_hash);
    const unit = await readSyncUnit(client, identity, candidate.unit_hash);
    requireSync(receipt && unit && receipt.id === candidate.receipt_id && receipt.activationId === identity.activationId &&
      receipt.artifactHash === artifactHash && isEventPair(receipt.eventIds) &&
      unit.receiptId === receipt.id && unit.planHash === receipt.planHash &&
      unit.asOf === demo.scenario.observedAt && unit.streamId === demo.streams[0] &&
      unit.lane.sourceRef === demo.sourceRef && unit.lane.manifestHash === manifestHash &&
      equal(unit.identity, identity) && isEventPair(unit.members.map(member => member.event.eventId)) &&
      unit.members.every(member => member.disposition === 'new') &&
      isScenario(unit.coverage.deliveries.slice(unit.coverage.historyOutcomes.length).map(delivery => delivery.event)));
    return { receipt, replayed: true };
  });
}

export function createCompanyADemoSync({ db, clock, registered, fetchChanges, observe }: Dependencies): { runOnce(): Promise<ReceiptResponse> } {
  return {
    async runOnce() {
      const member = (await registered.readSnapshot()).resolveRegisteredScope(demo.scope.accountId);
      if (!member) throw new DemoSyncError('DEMO_SYNC_BINDING_MISMATCH');
      const ingress = await readIngressAuthorityIdentity(db, demo.scope.accountId);
      const { identity, artifactHash, profileHash, manifestHash } = ingress;
      const stored = await readOnly(db, client => readStoredActivation(client, identity.scope));
      if (!stored || stored.bundleHash !== identity.bundleHash || !equal(identity.scope, demo.scope) ||
          !equal(member.entry.scope, demo.scope) || member.entry.profileHash !== profileHash ||
          member.entry.manifestHash !== manifestHash || ingress.sourceRef !== demo.sourceRef ||
          stored.bundle.manifest.id !== demo.manifestId || stored.bundle.manifest.asOf !== demo.cutover ||
          stored.bundle.artifact.hash !== artifactHash || stored.bundle.artifact.sourceRef !== demo.sourceRef ||
          stored.activation.epoch !== 1 ||
          !equal(stored.bundle.manifest.streams.map(stream => stream.streamId).sort(), demo.streams)) {
        throw new DemoSyncError('DEMO_SYNC_BINDING_MISMATCH');
      }
      const profile = selectedProfile(stored.bundle);
      if (!equal(profile, member.profile) || profile.id !== demo.profileId || profile.version !== demo.profileVersion ||
          profile.parentCustomerId !== demo.parentCustomerId || !equal(profile.sourceAccountIds, [demo.scenario.accountId])) {
        throw new DemoSyncError('DEMO_SYNC_BINDING_MISMATCH');
      }

      const saved = await recoverScenario(db, ingress);
      if (saved) return saved;

      const capture = await createRuntimeCapture({ db, clock }).openCommitted(identity);
      await drainCompanyADemoFeed(capture, fetchChanges);
      const applier = createSyncApplier({ db, clock, identity, observe });
      try {
        const prepared = await applier.prepare(demo.scenario.observedAt);
        const { plan } = prepared;
        if (!plan || !isScenario(prepared.events) || !isEventPair(plan.eventIds) ||
            plan.operations.length !== 2 || !isEventPair(plan.operations.flatMap(({ record }) =>
              'sourceEventId' in record ? [record.sourceEventId] : []))) {
          throw new DemoSyncError('DEMO_SYNC_SCENARIO_MISMATCH');
        }
        return await applier.applyBatch(plan, prepared.expectedEpoch);
      } catch (error) {
        const saved = await recoverScenario(db, ingress);
        if (saved) return saved;
        throw error;
      }
    },
  };
}
