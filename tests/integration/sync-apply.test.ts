import type { Pool } from 'pg';
import { expect, test } from 'vitest';
import { canonicalJson, hashCanonical, hashPlan, targetRecordId, type MutationPlan, type RawSourceEvent, type SyncReceipt } from '@eapr/contracts';
import { classifyBatch, planBatch } from '@eapr/compiler/plan-batch';
import { computeBalance } from '@eapr/finance/balance';
import { encodeCanonical } from '@eapr/parent/snapshots';
import { syncEventRef, type SyncUnitAudit } from '@eapr/parent/sync-store';
import { createSyncApplier } from '../../apps/worker/src/sync/apply.js';
import { createCurrentAuthority } from '../../apps/worker/src/sync/current-authority.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { selectedProfile } from '../../apps/worker/src/activation-validation.js';
import {
  applyBaseline, applyEvent, applyFinancialStream, applySemanticStream, captureApplyEvents,
  createSyncApplyFixture, partialAllocationEvents, syncApplyClock, syncApplyInstant, type SyncApplyFixture,
} from '../fixtures/sync-apply.js';

test('new_unit_atomic_state: applies an accepted captured invoice and acknowledges its full delivery', async () => {
  const fixture = await createSyncApplyFixture();
  try {
    const { db, identity, source, stored } = fixture;
    const { artifact, manifest } = stored.bundle;
    const profile = selectedProfile(stored.bundle);
    const capture = await createRuntimeCapture({ db, clock: syncApplyClock }).openCommitted(identity);
    const streamId = 'a-finance';
    const baseline = manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
    await fixture.addInvoice('atomic-invoice', profile.sourceAccountIds[0]!);
    const page = await source.fetchChanges(manifest.sourceRef, streamId, baseline);
    expect(await capture.capturePage(page)).toMatchObject({ captured: 1 });
    const [plan] = planBatch(artifact, profile, page.events, { ...stored.approvedTarget.records, asOf: syncApplyInstant }).plans;
    expect(plan.eventIds).toEqual(page.events.map(event => event.id));
    const apply = createSyncApplier({ db, clock: syncApplyClock, identity, observe: source.readCurrentSemantics });
    expect((await apply.prepare(syncApplyInstant)).plan).toEqual(plan);
    const result = await apply.applyBatch(plan, 1);
    expect(result).toMatchObject({ replayed: false, receipt: { eventIds: plan.eventIds } });
    expect(result.receipt.afterBalanceCents - result.receipt.beforeBalanceCents).toBe(1200);
    const { rows } = await db.query('SELECT source_ref, event_id, sequence FROM runtime_sync_event_outcomes');
    expect(rows).toEqual([{ source_ref: manifest.sourceRef, event_id: page.events[0]!.id, sequence: page.next }]);
  } finally {
    await fixture.close();
  }
}, 120_000);

function service(data: SyncApplyFixture, observe = data.source.readCurrentSemantics) {
  return createSyncApplier({ db: data.db, clock: syncApplyClock, identity: data.identity, observe });
}

const financeTables = [
  'parent_financial_records', 'parent_targets', 'parent_snapshots', 'runtime_financial_origins',
  'runtime_economic_outcomes', 'runtime_delivery_outcomes', 'runtime_sync_economic_outcomes',
  'runtime_sync_delivery_outcomes', 'runtime_sync_receipts', 'runtime_activation_imports',
];
const writerTables = [
  ...financeTables, 'runtime_authority_heads', 'runtime_authority_commands', 'runtime_sync_units', 'runtime_sync_event_outcomes',
  'runtime_sync_application_heads', 'activity_events', 'activity_counter',
];
const captureTables = ['runtime_inbox', 'runtime_source_positions', 'runtime_deliveries', 'runtime_capture_pages', 'runtime_capture_checkpoints'];

async function bytes(db: Pool, tables: string[]) {
  const result = await db.query<{ relation: string; rows: string[] }>(tables.map(table => `
    SELECT '${table}' AS relation, ARRAY(SELECT row::text FROM (
      SELECT to_jsonb(t) AS row FROM ${table} t
    ) contents ORDER BY row::text) AS rows
  `).join(' UNION ALL '));
  return Object.fromEntries(result.rows.map(row => [row.relation, row.rows]));
}

function replay(event: RawSourceEvent, id: string) {
  return applyEvent(event, { id: 'evt:sync-apply-replay-' + id });
}

function recordId(data: SyncApplyFixture, event: RawSourceEvent) {
  if (event.kind === 'semantic_change') throw new Error('Expected financial input');
  return targetRecordId({ sourceRef: event.sourceRef, sellerEntityId: data.identity.scope.sellerEntityId, kind: event.kind, recordId: event.recordId });
}

function firstEvents(data: SyncApplyFixture) {
  const { invoiceEvent, paymentEvent, p1, a1 } = partialAllocationEvents(data);
  return [replay(invoiceEvent, 'i0'), replay(paymentEvent, 'p0'), p1, a1];
}

function authority(data: SyncApplyFixture) {
  const api = createCurrentAuthority({
    db: data.db, clock: syncApplyClock, observe: data.source.readCurrentSemantics,
    admission: { authorize: async () => ({
      reviewer: { reviewerId: 'sync-apply-test-reviewer', sessionId: 'sync-apply-test-session' },
      allowedAccountIds: [data.identity.scope.accountId], allowedSourceRefs: [data.stored.bundle.manifest.sourceRef],
    }) },
  });
  return (action: 'pause' | 'resume' | 'revoke', expectedEpoch: number) =>
    api.command({}, { schemaVersion: '1', identity: data.identity, action, expectedEpoch, idempotencyKey: 'sync-apply-' + action });
}

async function assertUnit(data: SyncApplyFixture, input: {
  events: RawSourceEvent[]; from: string; through: string; version: number; receipt: SyncReceipt | null;
  associations: [string, SyncReceipt, 'new' | 'replay' | 'coalesced'][];
}) {
  const { db, stored } = data;
  const { rows: [row] } = await db.query<{
    unit_hash: string; audit: string; audit_digest: string; receipt_id: string | null; before_version: string; after_version: string;
  }>('SELECT * FROM runtime_sync_units WHERE from_cursor = $1', [input.from]);
  expect(row).toMatchObject({
    receipt_id: input.receipt?.id ?? null, after_version: String(input.version),
    before_version: String(input.version - (input.receipt ? 1 : 0)),
  });
  const audit = JSON.parse(row!.audit) as SyncUnitAudit;
  expect(row!.audit).toBe(canonicalJson(audit));
  expect(row!.audit_digest).toBe(hashCanonical(audit));
  expect(audit).toMatchObject({
    identity: data.identity, unitHash: row!.unit_hash, fromCursor: input.from, throughCursor: input.through,
    afterTargetVersion: input.version, planHash: input.receipt?.planHash ?? null,
  });
  const members = input.associations.map(([recordId, receipt, disposition], index) => ({
    event: syncEventRef(input.events[index]!), recordId, disposition,
    origin: receipt.id === stored.receipt.id
      ? { kind: 'initial', recordId, importKey: stored.request.idempotencyKey, receipt }
      : { kind: 'sync', recordId, receipt },
  }));
  expect(audit.members).toEqual(members);
  const { rows: outcomes } = await db.query(`
    SELECT source_ref, event_id, sequence, record_id, unit_hash, disposition, canonical, digest
    FROM runtime_sync_event_outcomes WHERE unit_hash = $1 ORDER BY sequence
  `, [row!.unit_hash]);
  expect(outcomes).toEqual(members.map(member => {
    const value = { identity: data.identity, lane: audit.lane, unitHash: audit.unitHash, ...member };
    return {
      source_ref: member.event.sourceRef, event_id: member.event.eventId, sequence: String(member.event.sequence),
      record_id: member.recordId, unit_hash: audit.unitHash, disposition: member.disposition,
      canonical: canonicalJson(value), digest: hashCanonical(value),
    };
  }));
  expect((await db.query(`
    SELECT stream_id, baseline_cursor, applied_through, last_unit_hash FROM runtime_sync_application_heads ORDER BY stream_id
  `)).rows).toEqual([
    { stream_id: applyFinancialStream, baseline_cursor: applyBaseline(data), applied_through: input.through, last_unit_hash: audit.unitHash },
    { stream_id: applySemanticStream, baseline_cursor: applyBaseline(data, applySemanticStream),
      applied_through: applyBaseline(data, applySemanticStream), last_unit_hash: null },
  ]);
  return audit;
}

test('mixed_original_receipts, ongoing_origin_replay, all_replay_multiple_origins and exact_lost_response_recovery', async () => {
  const data = await createSyncApplyFixture();
  try {
    const { db, stored, identity } = data;
    const initial = stored.approvedTarget.records;
    const r0 = stored.receipt;
    const { invoice, payment, allocation, invoiceEvent, p1, a1, a2 } = partialAllocationEvents(data);
    expect([invoice.amountCents, payment.amountCents, allocation.amountCents]).toEqual([300000, 200000, 200000]);
    expect(computeBalance(initial, syncApplyInstant)).toBe(80000);
    const immutableTables = ['runtime_activation_imports', 'parent_snapshots', 'parent_financial_records',
      'runtime_financial_origins', 'runtime_economic_outcomes', 'runtime_delivery_outcomes'];
    const originals = await bytes(db, immutableTables);
    const api = service(data);
    const first = await captureApplyEvents(data, applyBaseline(data), firstEvents(data));
    const classifier = classifyBatch(stored.bundle.artifact, selectedProfile(stored.bundle), first.page.events,
      { ...initial, asOf: syncApplyInstant });
    expect(classifier.details).toMatchObject({
      kind: 'classified', groups: [{ inputIndexes: [0, 1, 2, 3], disposition: 'accepted', holdIndexes: [] }], sourceBlockers: [],
    });
    expect(classifier.outcome.holds).toEqual([]);
    const captureBytes = await bytes(db, captureTables);
    expect(await first.capture.capturePage(first.page)).toEqual({ disposition: 'replayed', captured: 0, cursor: first.page.next, replayed: true });
    expect(await bytes(db, captureTables)).toEqual(captureBytes);

    const firstPlan = (await api.prepare(syncApplyInstant)).plan!;
    // Discard the original response. The later caller gets the original stored receipt.
    await api.applyBatch(firstPlan, 1);
    const { rows: [r1Row] } = await db.query<{ receipt: string; plan: string }>('SELECT receipt, plan FROM runtime_sync_receipts');
    const r1 = JSON.parse(r1Row!.receipt) as SyncReceipt;
    expect(r1Row!.plan).toBe(canonicalJson(firstPlan));
    expect(r1Row!.receipt).toBe(canonicalJson(r1));
    const p1Id = recordId(data, p1);
    const a1Id = recordId(data, a1);
    const a2Id = recordId(data, a2);
    expect(r1).toMatchObject({
      activationId: identity.activationId, epoch: 1, scope: identity.scope, eventIds: first.page.events.map(event => event.id),
      targetRecordIds: [p1Id, a1Id], beforeBalanceCents: 80000, afterBalanceCents: 78000,
    });
    await assertUnit(data, {
      events: first.page.events, from: first.page.after, through: first.page.next, version: initial.version + 1, receipt: r1,
      associations: [[invoice.id, r0, 'replay'], [payment.id, r0, 'replay'], [p1Id, r1, 'new'], [a1Id, r1, 'new']],
    });
    const p1Bytes = (await db.query('SELECT canonical, digest FROM parent_financial_records WHERE record_id = $1', [p1Id])).rows;
    const { rows: [p1Record] } = await db.query<{ canonical: string }>('SELECT canonical FROM parent_financial_records WHERE record_id = $1', [p1Id]);
    expect(JSON.parse(p1Record!.canonical)).toMatchObject({ id: p1Id, amountCents: 4000, sourceEventId: p1.id });

    const second = await captureApplyEvents(data, first.page.next, [replay(p1, 'p1-second'), a2]);
    const secondPlan = (await api.prepare(syncApplyInstant)).plan!;
    // The owner-only corruption simulates the same initial record claimed in both origin domains.
    await data.owner.query('ALTER TABLE runtime_sync_economic_outcomes DISABLE TRIGGER USER');
    await data.owner.query(`
      INSERT INTO runtime_sync_economic_outcomes (account_id,company_id,seller_entity_id,record_id,receipt_id)
      VALUES ($1,$2,$3,$4,$5)
    `, [identity.scope.accountId, identity.scope.companyId, identity.scope.sellerEntityId, invoice.id, r1.id]);
    const ambiguous = await bytes(db, writerTables);
    await expect(api.applyBatch(secondPlan, 1)).rejects.toMatchObject({ code: 'SYNC_STORAGE_INVALID' });
    expect(await bytes(db, writerTables)).toEqual(ambiguous);
    await data.owner.query('DELETE FROM runtime_sync_economic_outcomes WHERE record_id = $1', [invoice.id]);
    await data.owner.query('ALTER TABLE runtime_sync_economic_outcomes ENABLE TRIGGER USER');

    const { receipt: r2 } = await api.applyBatch(secondPlan, 1);
    expect(r2).toMatchObject({
      eventIds: second.page.events.map(event => event.id), targetRecordIds: [a2Id],
      beforeBalanceCents: 78000, afterBalanceCents: 77000,
    });
    await assertUnit(data, {
      events: second.page.events, from: second.page.after, through: second.page.next, version: initial.version + 2, receipt: r2,
      associations: [[p1Id, r1, 'replay'], [a2Id, r2, 'new']],
    });

    const third = await captureApplyEvents(data, second.page.next, [replay(invoiceEvent, 'i0-third'), replay(p1, 'p1-third'), replay(a2, 'a2-third')]);
    const prepared = await api.prepare(syncApplyInstant);
    expect(prepared.plan).toBeNull();
    const beforeReplay = await bytes(db, financeTables);
    const acknowledged = await api.applyReplay(prepared, 1);
    expect(acknowledged).toEqual({
      unitHash: expect.stringMatching(/^[0-9a-f]{64}$/), replayed: false,
      receipts: [r0, r1, r2].sort((a, b) => a.id < b.id ? -1 : 1),
      appliedThrough: [{ streamId: applyFinancialStream, cursor: third.page.next },
        { streamId: applySemanticStream, cursor: applyBaseline(data, applySemanticStream) }],
    });
    expect(await bytes(db, financeTables)).toEqual(beforeReplay);
    await assertUnit(data, {
      events: third.page.events, from: third.page.after, through: third.page.next, version: initial.version + 2, receipt: null,
      associations: [[invoice.id, r0, 'replay'], [p1Id, r1, 'replay'], [a2Id, r2, 'replay']],
    });
    expect((await db.query('SELECT canonical, digest FROM parent_financial_records WHERE record_id = $1', [p1Id])).rows).toEqual(p1Bytes);
    expect((await db.query('SELECT receipt, plan FROM runtime_sync_receipts WHERE receipt_id = $1', [r1.id])).rows).toEqual([r1Row]);
    const unchanged = await bytes(db, immutableTables);
    for (const table of immutableTables) expect(unchanged[table]).toEqual(expect.arrayContaining(originals[table]!));
    const { rows: activity } = await db.query(`SELECT event->>'type' AS type, event->'payload' AS payload
      FROM activity_events WHERE event->>'type' IN ('batch.applied','batch.replayed') ORDER BY sequence`);
    const { sourceRef, manifestHash } = prepared.lane;
    expect(activity).toEqual([
      { type: 'batch.applied', payload: { sourceRef, manifestHash, count: 4, status: 'applied', receiptId: r1.id, planHash: r1.planHash } },
      { type: 'batch.applied', payload: { sourceRef, manifestHash, count: 2, status: 'applied', receiptId: r2.id, planHash: r2.planHash } },
      { type: 'batch.replayed', payload: { sourceRef, manifestHash, count: 3, status: 'replayed' } },
    ]);
    expect((await authority(data)('revoke', 1)).result.state).toMatchObject({ status: 'revoked', epoch: 2 });
    const offline = service(data, async () => { throw new Error('offline'); });
    const beforeRecovery = await bytes(db, writerTables);
    expect(await offline.applyBatch(firstPlan, 2)).toEqual({ receipt: r1, replayed: true });
    expect(await offline.applyReplay(prepared, 2)).toEqual({ ...acknowledged, replayed: true });
    expect(await bytes(db, writerTables)).toEqual(beforeRecovery);
  } finally {
    await data.close();
  }
}, 120_000);

test('coalesced_and_repeat: a distinct allocation delivery acknowledges the same record once', async () => {
  const data = await createSyncApplyFixture();
  try {
    const { stored } = data;
    const { invoice, payment, p1, a1 } = partialAllocationEvents(data);
    const { page } = await captureApplyEvents(data, applyBaseline(data), [...firstEvents(data), replay(a1, 'a1-coalesced')]);
    const apply = service(data);
    const prepared = await apply.prepare(syncApplyInstant);
    const { receipt } = await apply.applyBatch(prepared.plan!, 1);
    expect(receipt).toMatchObject({
      eventIds: page.events.map(event => event.id), targetRecordIds: [recordId(data, p1), recordId(data, a1)],
      beforeBalanceCents: 80000, afterBalanceCents: 78000,
    });
    await assertUnit(data, { events: page.events, from: page.after, through: page.next, version: stored.approvedTarget.records.version + 1, receipt,
      associations: [[invoice.id, stored.receipt, 'replay'], [payment.id, stored.receipt, 'replay'],
        [recordId(data, p1), receipt, 'new'], [recordId(data, a1), receipt, 'new'], [recordId(data, a1), receipt, 'coalesced']],
    });
    expect((await data.db.query('SELECT record_id FROM runtime_sync_economic_outcomes ORDER BY record_id')).rows)
      .toEqual(receipt.targetRecordIds.toSorted().map(record_id => ({ record_id })));
  } finally {
    await data.close();
  }
}, 120_000);

test('active_epoch_bookkeeping: initial payment and allocation resolve to R0 only under current authority', async () => {
  const data = await createSyncApplyFixture();
  try {
    const { db, stored } = data;
    const { payment, allocation, paymentEvent, allocationEvent } = partialAllocationEvents(data);
    const { page } = await captureApplyEvents(data, applyBaseline(data), [replay(paymentEvent, 'initial-pay'), replay(allocationEvent, 'initial-allocation')]);
    const command = authority(data);
    const apply = service(data);
    const original = await apply.prepare(syncApplyInstant);
    expect(original.plan).toBeNull();
    await command('pause', 1);
    const paused = await bytes(db, writerTables);
    await expect(apply.applyReplay(original, 1)).rejects.toMatchObject({ code: 'AUTHORITY_INACTIVE' });
    expect(await bytes(db, writerTables)).toEqual(paused);
    expect((await command('resume', 2)).result.state).toMatchObject({ status: 'active', epoch: 3 });
    const resumed = await bytes(db, writerTables);
    await expect(apply.applyReplay(original, 3)).rejects.toMatchObject({ code: 'AUTHORITY_STALE' });
    await expect(apply.applyReplay(original, 1)).rejects.toMatchObject({ code: 'AUTHORITY_STALE' });
    expect(await bytes(db, writerTables)).toEqual(resumed);

    const prepared = await apply.prepare(syncApplyInstant);
    const immutable = await bytes(db, financeTables);
    expect(prepared.expectedEpoch).toBe(3);
    const result = await apply.applyReplay(prepared, 3);
    expect(result).toMatchObject({ replayed: false, receipts: [stored.receipt] });
    expect(await bytes(db, financeTables)).toEqual(immutable);
    expect((await assertUnit(data, {
      events: page.events, from: page.after, through: page.next, version: stored.approvedTarget.records.version, receipt: null,
      associations: [[payment.id, stored.receipt, 'replay'], [allocation.id, stored.receipt, 'replay']],
    })).expectedEpoch).toBe(3);
    await expect(apply.prepare(syncApplyInstant)).rejects.toMatchObject({ code: 'SYNC_NO_PENDING' });

    await captureApplyEvents(data, page.next, [replay(paymentEvent, 'after-revoke')]);
    const pending = await apply.prepare(syncApplyInstant);
    await command('revoke', 3);
    const revoked = await bytes(db, writerTables);
    await expect(apply.applyReplay(pending, 3)).rejects.toMatchObject({ code: 'AUTHORITY_INACTIVE' });
    expect(await apply.applyReplay(prepared, 4)).toEqual({ ...result, replayed: true });
    expect(await bytes(db, writerTables)).toEqual(revoked);
  } finally {
    await data.close();
  }
}, 120_000);

function rehash(plan: MutationPlan, changes: Partial<MutationPlan>): MutationPlan {
  const changed = { ...plan, ...changes };
  return { ...changed, hash: hashPlan(changed) };
}

test('caller_plan_cannot_select_foreign_delivery: full identity, pins and plan correspondence precede writes', async () => {
  const data = await createSyncApplyFixture();
  try {
    const { db, identity, stored } = data;
    const { sourceRef } = stored.bundle.manifest;
    const account = selectedProfile(stored.bundle).sourceAccountIds[0]!;
    const [invoice] = await data.addInvoice('apply-selected', account);
    const foreign = applyEvent(invoice!, { sourceRef: 'legacy-foreign', payload: { ...invoice!.payload, amount: '19.00' } });
    await db.query('INSERT INTO runtime_deliveries (source_ref,event_id,content_hash,canonical,digest) VALUES ($1,$2,$3,$4,$5)',
      [foreign.sourceRef, foreign.id, foreign.contentHash, ...encodeCanonical(foreign)]);
    const { page, capture } = await captureApplyEvents(data, applyBaseline(data), [invoice!]);
    const api = service(data);
    const prepared = await api.prepare(syncApplyInstant);
    const plan = prepared.plan!;
    expect(prepared.events).toEqual(page.events);
    expect(prepared.events[0]).toMatchObject({ sourceRef, id: foreign.id, payload: { amount: '12.00' } });
    const operation = plan.operations[0]!;
    if (operation.op !== 'insert_invoice') throw new Error('Expected invoice operation');
    const foreignIdentity = { ...operation.record.identity, sourceRef: foreign.sourceRef };
    const wrongScope = { ...plan.scope, accountId: 'other-account' };
    const otherHash = '9'.repeat(64);
    const malformed = [
      [rehash(plan, { scope: wrongScope }), 'SYNC_BINDING_MISMATCH'],
      [rehash(plan, { artifactHash: otherHash }), 'SYNC_BINDING_MISMATCH'],
      [rehash(plan, { profileHash: otherHash }), 'SYNC_BINDING_MISMATCH'],
      [rehash(plan, { operations: [], eventIds: [], lineage: [] }), 'SYNC_INVALID_PLAN'],
      [rehash(plan, { operations: [{ op: 'ensure_customer', record: stored.approvedTarget.records.customers[0]! }] }), 'SYNC_INVALID_PLAN'],
      [rehash(plan, { operations: [{ ...operation, record: {
        ...operation.record, identity: foreignIdentity, id: targetRecordId(foreignIdentity), amountCents: 1900,
      } }] }), 'SYNC_PLAN_MISMATCH'],
      [rehash(plan, { operations: [{ ...operation, record: { ...operation.record, sourceEventId: 'forged-operation-origin' } }] }),
        'SYNC_PLAN_MISMATCH'],
    ] as const;
    const before = await bytes(db, [...writerTables, ...captureTables]);
    for (const [input, code] of malformed) await expect(api.applyBatch(input, 1)).rejects.toMatchObject({ code });
    for (const wrongIdentity of [
      { ...identity, activationId: 'missing-grant' },
      { ...identity, bundleHash: otherHash },
    ]) {
      const unbound = createSyncApplier({ db, identity: wrongIdentity, clock: syncApplyClock, observe: data.source.readCurrentSemantics });
      await expect(unbound.applyBatch(plan, 1)).rejects.toMatchObject({ code: 'SYNC_BINDING_MISMATCH' });
    }
    await expect(api.applyReplay({ ...prepared, plan: null, lane: { ...prepared.lane, manifestHash: otherHash } }, 1))
      .rejects.toMatchObject({ code: 'SYNC_INVALID_PLAN' });
    await expect(api.applyBatch(plan, 2)).rejects.toMatchObject({ code: 'AUTHORITY_STALE' });
    await expect(service(data, async () => { throw new Error('private source failure'); }).applyBatch(plan, 1))
      .rejects.toMatchObject({ code: 'SYNC_SOURCE_UNAVAILABLE', message: 'SYNC_SOURCE_UNAVAILABLE' });
    expect(await bytes(db, [...writerTables, ...captureTables])).toEqual(before);

    const changed = applyEvent(page.events[0]!, { observedAt: '2026-11-09T08:00:01.000Z' });
    await expect(capture.capturePage({ ...page, events: [changed] })).rejects.toMatchObject({ code: 'CAPTURE_IDENTITY_CONFLICT' });
    const afterIncident = await bytes(db, [...writerTables, ...captureTables]);
    await expect(api.applyBatch(plan, 1)).rejects.toMatchObject({ code: 'SYNC_COVERAGE_UNSUPPORTED' });
    // Capture retains its incident. The writer leaves its existing financial, delivery and frontier rows alone.
    expect(await bytes(db, [...writerTables, ...captureTables])).toEqual(afterIncident);
    const { rows } = await db.query('SELECT canonical FROM runtime_deliveries WHERE event_id = $1 ORDER BY source_ref', [foreign.id]);
    expect(rows).toEqual([page.events[0]!, foreign].map(event => ({ canonical: canonicalJson(event) })));
  } finally {
    await data.close();
  }
}, 120_000);

test.each(['held prerequisite', 'amount limit', 'count limit'])('%s rejects the whole captured unit', async condition => {
  const data = await createSyncApplyFixture();
  try {
    const { db, stored } = data;
    const { invoiceEvent, p1, a1 } = partialAllocationEvents(data);
    const api = service(data);
    const profile = selectedProfile(stored.bundle);
    const newValid = planBatch(stored.bundle.artifact, profile, [p1], { ...stored.approvedTarget.records, asOf: syncApplyInstant }).plans[0]!;
    const baseline = applyBaseline(data);
    if (condition === 'held prerequisite') {
      const badPrerequisite = applyEvent(a1, { payload: { ...a1.payload, funding_id: 'missing-funding' } });
      await captureApplyEvents(data, baseline, [replay(invoiceEvent, 'equivalent-held'), badPrerequisite]);
    } else if (condition === 'amount limit') {
      await captureApplyEvents(data, baseline, [applyEvent(p1, { payload: { ...p1.payload, amount: '50000.01' } })]);
    } else {
      let cursor = baseline;
      const limit = 1000;
      const { pageSize } = stored.bundle.artifact.normalizedPlan.capture.find(stream => stream.streamId === applyFinancialStream)!;
      for (let index = 0; index <= limit; index += pageSize) {
        const events = Array.from({ length: Math.min(pageSize, limit + 1 - index) }, (_, n) => replay(invoiceEvent, 'count-' + (index + n)));
        cursor = (await captureApplyEvents(data, cursor, events)).page.next;
      }
      expect(Number(cursor) - Number(baseline)).toBe(1001);
    }
    const before = await bytes(db, [...writerTables, ...captureTables]);
    await expect(api.applyBatch(newValid, 1)).rejects.toMatchObject({ code: 'SYNC_COVERAGE_UNSUPPORTED' });
    expect(await bytes(db, [...writerTables, ...captureTables])).toEqual(before);
  } finally {
    await data.close();
  }
}, 120_000);

test('missing or divergent stored origins and a foreign economic owner all fail closed', async () => {
  const data = await createSyncApplyFixture();
  try {
    const { db, owner, stored, identity } = data;
    const { invoice, allocation, p1 } = partialAllocationEvents(data);
    const api = service(data);
    await captureApplyEvents(data, applyBaseline(data), firstEvents(data));
    const plan = (await api.prepare(syncApplyInstant)).plan!;
    const rejected = async () => {
      const before = await bytes(db, writerTables);
      await expect(api.applyBatch(plan, 1)).rejects.toMatchObject({ code: 'SYNC_STORAGE_INVALID' });
      expect(await bytes(db, writerTables)).toEqual(before);
    };
    await owner.query('ALTER TABLE runtime_financial_origins DISABLE TRIGGER USER');
    const { rows: [removed] } = await owner.query(`
      DELETE FROM runtime_financial_origins WHERE record_id = $1
      RETURNING account_id,company_id,seller_entity_id,record_id,initial_import_key,initial_receipt_id,sync_receipt_id
    `, [invoice.id]);
    expect(removed).toMatchObject({ record_id: invoice.id, initial_receipt_id: stored.receipt.id, sync_receipt_id: null });
    await rejected();
    await owner.query(`
      INSERT INTO runtime_financial_origins (account_id,company_id,seller_entity_id,record_id,initial_import_key,initial_receipt_id,sync_receipt_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, Object.values(removed!));
    await owner.query('ALTER TABLE runtime_financial_origins ENABLE TRIGGER USER');

    await owner.query('ALTER TABLE parent_financial_records DISABLE TRIGGER USER');
    await owner.query('UPDATE parent_financial_records SET canonical = $2, digest = $3 WHERE record_id = $1',
      [allocation.id, ...encodeCanonical({ ...allocation, amountCents: allocation.amountCents + 1 })]);
    await rejected();
    await owner.query('UPDATE parent_financial_records SET canonical = $2, digest = $3 WHERE record_id = $1',
      [allocation.id, ...encodeCanonical(allocation)]);
    await owner.query('ALTER TABLE parent_financial_records ENABLE TRIGGER USER');

    const operation = plan.operations.find(operation => operation.op === 'insert_payment')!;
    const other = { ...identity.scope, accountId: 'other-claimed-account' };
    const { companyId, sellerEntityId, accountId } = other;
    await owner.query('INSERT INTO parent_scopes (account_id,company_id,seller_entity_id) VALUES ($1,$2,$3)', [accountId, companyId, sellerEntityId]);
    await owner.query(`
      INSERT INTO parent_financial_records (account_id,company_id,seller_entity_id,record_id,source_ref,kind,
        source_record_id,source_record_version,event_id,canonical,digest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [accountId, companyId, sellerEntityId, recordId(data, p1), p1.sourceRef, p1.kind, p1.recordId, p1.recordVersion,
      p1.id, ...encodeCanonical({ ...operation.record, scope: other })]);
    await rejected();
    expect((await db.query('SELECT account_id FROM parent_financial_records WHERE record_id = $1', [recordId(data, p1)])).rows)
      .toEqual([{ account_id: accountId }]);
  } finally {
    await data.close();
  }
}, 120_000);
