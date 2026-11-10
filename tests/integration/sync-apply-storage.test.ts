import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  ChangePageSchema, canonicalJson, hashCanonical, hashEvent, hashTargetSnapshot, type ChangePage, type MutationPlan, type SyncReceipt, type TargetState,
} from '@eapr/contracts';
import { classifyBatch, planBatch } from '@eapr/compiler/plan-batch';
import { computeBalance } from '@eapr/finance/balance';
import { financialRecords, type FinancialRecord } from '@eapr/finance/validate';
import { encodeCanonical, scopeValues } from '@eapr/parent/snapshots';
import { projectTarget, type FinancialMutation } from '@eapr/parent/state';
import { withTransaction } from '@eapr/storage/transaction';
import * as store from '@eapr/parent/sync-store';
import { selectedProfile } from '../../apps/worker/src/activation-validation.js';
import { createCurrentAuthority } from '../../apps/worker/src/sync/current-authority.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { migrate, readMigrationCatalog } from '../../scripts/migrate.js';
import { createSyncApplyFixture, syncApplyClock, syncApplyInstant } from '../fixtures/sync-apply.js';

let fixture: Awaited<ReturnType<typeof createSyncApplyFixture>>;
let plan: MutationPlan;
let receipt: SyncReceipt;
let original: FinancialRecord;
let ongoing: FinancialRecord;
let captured: Awaited<ReturnType<typeof fixture.source.fetchChanges>>;

const invalid = { code: 'SYNC_STORE_INVALID' };
const streamId = 'a-finance';

beforeAll(async () => {
  fixture = await createSyncApplyFixture(5);
  const { db, identity, stored, source, addInvoice } = fixture;
  const { bundle, approvedTarget } = stored;
  const profile = selectedProfile(bundle);
  await addInvoice('storage-legacy-invoice', profile.sourceAccountIds[0]!);
  const baseline = bundle.manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
  captured = await source.fetchChanges(bundle.manifest.sourceRef, streamId, baseline);
  expect(captured.events).toHaveLength(1);
  const capture = await createRuntimeCapture({ db, clock: syncApplyClock }).openCommitted(identity);
  await capture.capturePage(captured);
  const outcome = planBatch(bundle.artifact, profile, captured.events, { ...approvedTarget.records, asOf: syncApplyInstant });
  expect(outcome.holds).toEqual([]);
  expect(outcome.plans).toHaveLength(1);
  plan = outcome.plans[0]!;
  original = financialRecords(approvedTarget.records)[0]!;
  ongoing = plan.operations[0]!.record as FinancialRecord;
  await insertRuntime005Commit();
  await migrate(fixture.pair, ['runtime'], readMigrationCatalog());
}, 120_000);

type Fixture = Awaited<ReturnType<typeof createSyncApplyFixture>>;

async function insertRuntime005Commit() {
  // Retain the runtime005 representation independently of later writer changes.
  const { db, identity } = fixture;
  await withTransaction(db, async client => {
    ({ receipt } = await insertMonetaryFixture(client, fixture, plan, 'receipt:storage-legacy'));
    await client.query('INSERT INTO runtime_sync_delivery_outcomes VALUES ($1, $2, $3, $4, $5, $6)',
      [...scopeValues(identity.scope), captured.sourceRef, ongoing.sourceEventId, receipt.id]);
  });
}

async function insertMonetaryFixture(
  client: PoolClient, fixture: Fixture, plan: MutationPlan, receiptId: string,
  before: TargetState = fixture.stored.approvedTarget.records,
) {
  const { identity } = fixture;
  const operations = plan.operations as FinancialMutation[];
  const records = operations.map(operation => operation.record);
  const after = { ...projectTarget({ ...before, asOf: plan.asOf }, operations), version: before.version + 1 };
  const snapshotHash = hashTargetSnapshot(after);
  const receipt: SyncReceipt = {
    id: receiptId, scope: identity.scope, activationId: identity.activationId, epoch: 1,
    artifactHash: plan.artifactHash, planHash: plan.hash, eventIds: plan.eventIds, targetRecordIds: records.map(record => record.id),
    beforeBalanceCents: computeBalance(before, plan.asOf), afterBalanceCents: computeBalance(after, plan.asOf),
    status: 'applied', committedAt: syncApplyInstant,
  };
  const scope = scopeValues(identity.scope);
  await client.query(
    'INSERT INTO parent_snapshots VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [...scope, after.version, snapshotHash, plan.asOf, ...encodeCanonical(after)],
  );
  await client.query(`
    UPDATE parent_targets SET target_version = $4, snapshot_hash = $5
    WHERE (account_id, company_id, seller_entity_id) = ($1, $2, $3)
  `, [...scope, after.version, snapshotHash]);
  await client.query(`
    INSERT INTO runtime_sync_receipts
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `, [...scope, receipt.id, plan.hash, receipt.activationId, receipt.epoch, before.version, after.version, snapshotHash,
    ...encodeCanonical(receipt), ...encodeCanonical(plan)]);
  for (const record of records) {
    await client.query(`
      INSERT INTO parent_financial_records
        (account_id, company_id, seller_entity_id, source_ref, kind, source_record_id, record_id,
         source_record_version, event_id, canonical, digest)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [...scope, record.identity.sourceRef, record.kind, record.identity.recordId, record.id,
      record.sourceRecordVersion, record.sourceEventId, ...encodeCanonical(record)]);
    await client.query('INSERT INTO runtime_sync_economic_outcomes VALUES ($1, $2, $3, $4, $5)',
      [...scope, record.id, receipt.id]);
  }
  return { receipt, snapshotHash, after };
}

async function makeAudit(client: PoolClient, fixture: Fixture, page: ChangePage, plan: MutationPlan, receipt: SyncReceipt,
  afterSnapshotHash: string, members: store.UnitMember[], prior?: store.SyncUnitAudit,
): Promise<store.SyncUnitAudit> {
  const { identity, stored } = fixture;
  const { manifest, artifact, semanticPreflight } = stored.bundle;
  const lane = { schemaVersion: '1' as const, sourceRef: page.sourceRef, manifestHash: manifest.hash };
  const { rows: [laneRow] } = await client.query<{ initialized_at: string; initial_activation_id: string }>(
    'SELECT initialized_at, initial_activation_id FROM runtime_capture_lanes WHERE source_ref = $1 AND manifest_hash = $2',
    [lane.sourceRef, lane.manifestHash],
  );
  const positions = page.events.map(event => ({
    sourceRef: event.sourceRef, streamId, sequence: event.sequence, eventId: event.id,
  }));
  const capture = artifact.normalizedPlan.capture;
  const coverage: store.CoverageCut = {
    identity, lane, manifest, capture, manifestDigest: hashCanonical(manifest), captureDigest: hashCanonical(capture),
    initialActivationId: laneRow!.initial_activation_id, initializedAt: laneRow!.initialized_at,
    baseline: {
      importKey: stored.request.idempotencyKey, receiptId: stored.receipt.id, activationDigest: hashCanonical(stored.activation),
      bundleDigest: hashCanonical(stored.bundle), approvedSnapshotHash: stored.approvedTarget.snapshotHash,
      approvedTargetVersion: stored.approvedTarget.records.version,
    },
    checkpoints: capture.map(stream => {
      if (stream.transport === 'csv') throw new Error('Expected API fixture');
      const baseline = manifest.streams.find(row => row.streamId === stream.streamId)!.resumeAfter;
      const financial = stream.streamId === streamId;
      return {
        streamId: stream.streamId, transport: stream.transport, baselineCursor: baseline,
        captureCursor: financial ? page.next : baseline,
        capturedPages: financial ? String((prior?.coverage.pages.length ?? 0) + 1) : '0',
        lastCapturedAt: financial ? syncApplyInstant : null,
      };
    }),
    applicationHeads: prior ? [{
      streamId, baselineCursor: prior.fromCursor, appliedThrough: prior.throughCursor, lastUnitHash: prior.unitHash,
    }] : [],
    positions: [...(prior?.coverage.positions ?? []), ...positions],
    inbox: [...(prior?.coverage.inbox ?? []), ...positions.map(position => ({
      ...position, manifestHash: lane.manifestHash, afterCursor: page.after,
    }))],
    deliveries: [...(prior?.coverage.deliveries ?? []), ...page.events.map(event => ({ event, digest: hashCanonical(event) }))],
    pages: [...(prior?.coverage.pages ?? []), {
      sourceRef: lane.sourceRef, manifestHash: lane.manifestHash, streamId, afterCursor: page.after,
      nextCursor: page.next, eventCount: page.events.length, digest: hashCanonical(page), capturedAt: syncApplyInstant,
    }],
    historyUnits: prior ? [{
      unitHash: prior.unitHash, auditDigest: hashCanonical(prior), streamId,
      fromCursor: prior.fromCursor, throughCursor: prior.throughCursor,
      beforeTargetVersion: prior.expectedTargetVersion, beforeSnapshotHash: prior.beforeSnapshotHash,
      afterTargetVersion: prior.afterTargetVersion, afterSnapshotHash: prior.afterSnapshotHash, receiptId: prior.receiptId,
    }] : [],
    historyOutcomes: prior?.members.map(({ event, recordId, disposition, origin }) => ({
      event, recordId, disposition, unitHash: prior.unitHash,
      digest: hashCanonical({ identity, lane, unitHash: prior.unitHash, event, recordId, disposition, origin }),
    })) ?? [],
    historyOrigins: (prior?.members ?? []).map(({ recordId, origin }) => ({
      recordId, receiptDigest: hashCanonical(origin.receipt),
      initialImportKey: origin.kind === 'initial' ? origin.importKey : null,
      initialReceiptId: origin.kind === 'initial' ? origin.receipt.id : null,
      syncReceiptId: origin.kind === 'sync' ? origin.receipt.id : null,
    })).sort((a, b) => a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0),
    guards: {
      overflow: false, extraLane: false, undeclaredStream: false, nonselectedPostBaseline: false,
      outOfCut: false, incident: false, unmatchedLegacyHistory: false,
    },
  };
  const keys = {
    identity, lane, streamId, expectedEpoch: receipt.epoch, expectedTargetVersion: plan.expectedTargetVersion,
    beforeSnapshotHash: prior?.afterSnapshotHash ?? stored.approvedTarget.snapshotHash, asOf: plan.asOf,
    coverageHash: hashCanonical(coverage), planHash: plan.hash,
  };
  return {
    ...keys, coverage, unitHash: store.hashSyncUnit(keys), fromCursor: page.after, throughCursor: page.next,
    afterTargetVersion: plan.expectedTargetVersion + 1, afterSnapshotHash,
    receiptId: receipt.id, semanticObservation: semanticPreflight, committedAt: receipt.committedAt, members,
  };
}

function unitScope({ identity, lane, streamId }: store.SyncUnitAudit) {
  return [...scopeValues(identity.scope), identity.activationId, identity.bundleHash, lane.sourceRef, lane.manifestHash, streamId];
}

const unitInsert = `INSERT INTO runtime_sync_units
  (account_id, company_id, seller_entity_id, activation_id, bundle_hash, source_ref, manifest_hash, stream_id,
   unit_hash, epoch, from_cursor, through_cursor, before_version, before_snapshot_hash,
   after_version, after_snapshot_hash, receipt_id, audit, audit_digest)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`;

function unitValues(audit: store.SyncUnitAudit) {
  return [
    ...unitScope(audit), audit.unitHash, audit.expectedEpoch, audit.fromCursor, audit.throughCursor, audit.expectedTargetVersion,
    audit.beforeSnapshotHash, audit.afterTargetVersion, audit.afterSnapshotHash, audit.receiptId, ...encodeCanonical(audit),
  ];
}

function insertOutcome(client: PoolClient, audit: store.SyncUnitAudit, member: store.UnitMember) {
  const outcome = { identity: audit.identity, lane: audit.lane, unitHash: audit.unitHash, ...member };
  return client.query(`
    INSERT INTO runtime_sync_event_outcomes
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [...unitScope(audit), member.event.sequence, member.event.eventId, member.recordId, audit.unitHash, member.disposition,
    ...encodeCanonical(outcome)]);
}

afterAll(async () => { await fixture?.close(); });

async function withClient<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await fixture.db.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

async function withOwnerRollback<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await fixture.owner.connect();
  try {
    await client.query('BEGIN');
    return await run(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

test('legacy_receipt_read_without_progress', async () => {
  const { identity, db } = fixture;
  const saved = await withClient(client => store.readSyncCommit(client, identity, plan));
  expect(saved).toEqual({ replayed: true, receipt });
  expect(canonicalJson(saved?.receipt)).toBe(canonicalJson(receipt));
  for (const table of ['runtime_sync_units', 'runtime_sync_event_outcomes', 'runtime_sync_application_heads']) {
    expect((await db.query('SELECT count(*)::int AS count FROM ' + table)).rows).toEqual([{ count: 0 }]);
  }
});

test('origin_domain_exclusivity', async () => {
  const { db, identity, stored } = fixture;
  expect(await withClient(client => store.readFinancialOrigins(client, identity.scope, [original, ongoing]))).toEqual([
    { kind: 'initial', recordId: original.id, importKey: stored.request.idempotencyKey, receipt: stored.receipt },
    { kind: 'sync', recordId: ongoing.id, receipt },
  ]);
  const values = scopeValues(identity.scope);
  await expect(db.query(
    'INSERT INTO runtime_sync_economic_outcomes VALUES ($1, $2, $3, $4, $5)', [...values, original.id, receipt.id],
  )).rejects.toMatchObject({ code: '23505' });
  await expect(db.query(
    'INSERT INTO runtime_economic_outcomes VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [...values, ongoing.identity.sourceRef, ongoing.kind, ongoing.identity.recordId, ongoing.id,
      stored.request.idempotencyKey, stored.receipt.id],
  )).rejects.toMatchObject({ code: '23505' });
});

test('concurrent origin claims serialize on the shared record key', async () => {
  const { db, owner, identity, stored } = fixture;
  // Remove the fixture's ongoing claim temporarily so both app-role inserts
  // contend for a vacant key. The original valid association is the winner.
  await withTransaction(owner, async client => {
    await client.query('ALTER TABLE runtime_financial_origins DISABLE TRIGGER USER');
    await client.query('ALTER TABLE runtime_sync_economic_outcomes DISABLE TRIGGER USER');
    await client.query('DELETE FROM runtime_financial_origins WHERE record_id = $1', [ongoing.id]);
    await client.query('DELETE FROM runtime_sync_economic_outcomes WHERE record_id = $1', [ongoing.id]);
    await client.query('ALTER TABLE runtime_sync_economic_outcomes ENABLE TRIGGER USER');
    await client.query('ALTER TABLE runtime_financial_origins ENABLE TRIGGER USER');
  });

  const winner = await db.connect();
  const contender = await db.connect();
  const scope = scopeValues(identity.scope);
  let competing: Promise<unknown> | undefined;
  try {
    const { rows: [{ pid }] } = await contender.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    await winner.query('BEGIN');
    await winner.query('INSERT INTO runtime_sync_economic_outcomes VALUES ($1, $2, $3, $4, $5)',
      [...scope, ongoing.id, receipt.id]);
    competing = contender.query(
      'INSERT INTO runtime_economic_outcomes VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [...scope, ongoing.identity.sourceRef, ongoing.kind, ongoing.identity.recordId, ongoing.id,
        stored.request.idempotencyKey, stored.receipt.id],
    ).then(() => null, error => error);
    let blocked = false;
    for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
      const { rows: [state] } = await owner.query<{ blocked: boolean }>(
        'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid],
      );
      blocked = state!.blocked;
      if (!blocked) await delay(10);
    }
    await winner.query('COMMIT');
    expect(blocked).toBe(true);
    expect(await competing).toMatchObject({ code: '23505', constraint: 'runtime_financial_origins_pkey' });
  } finally {
    await winner.query('ROLLBACK');
    await competing;
    winner.release();
    contender.release();
  }
  await expect(withClient(client => store.readFinancialOrigins(client, identity.scope, [ongoing])))
    .resolves.toEqual([{ kind: 'sync', recordId: ongoing.id, receipt }]);
});

test('typed_origin_fk_scope', async () => {
  const { db, identity, stored } = fixture;
  const values = scopeValues(identity.scope);
  await expect(db.query(
    `INSERT INTO runtime_financial_origins
       (account_id, company_id, seller_entity_id, record_id, initial_import_key, initial_receipt_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    [...values, 'missing-parent-record', stored.request.idempotencyKey, stored.receipt.id],
  )).rejects.toMatchObject({ code: '23503' });
  await expect(db.query(
    `INSERT INTO runtime_sync_economic_outcomes VALUES ($1, $2, $3, $4, $5)`,
    [values[0], 'foreign-company', values[2], original.id, receipt.id],
  )).rejects.toMatchObject({ code: '23503' });
  await expect(db.query(
    `INSERT INTO runtime_financial_origins
       (account_id, company_id, seller_entity_id, record_id, sync_receipt_id)
       VALUES ($1, $2, $3, $4, $5)`,
    [...values, 'missing-parent-record', stored.receipt.id],
  )).rejects.toMatchObject({ code: '23503' });
});

test('history_privileges', async () => {
  for (const table of ['runtime_financial_origins', 'runtime_sync_units', 'runtime_sync_event_outcomes',
    'runtime_sync_application_heads', 'runtime_sync_delivery_outcomes']) {
    await expect(fixture.db.query('DELETE FROM ' + table)).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.db.query('TRUNCATE ' + table)).rejects.toMatchObject({ code: '42501' });
  }
  for (const [table, column] of [
    ['runtime_financial_origins', 'record_id'], ['runtime_sync_units', 'unit_hash'],
    ['runtime_sync_event_outcomes', 'record_id'], ['runtime_sync_application_heads', 'baseline_cursor'],
    ['runtime_sync_delivery_outcomes', 'receipt_id'],
  ]) {
    await expect(fixture.db.query('UPDATE ' + table + ' SET ' + column + ' = ' + column))
      .rejects.toMatchObject({ code: '42501' });
  }
  expect((await fixture.db.query(
    "SELECT has_table_privilege(current_user, 'runtime_sync_delivery_outcomes', 'INSERT') AS allowed",
  )).rows).toEqual([{ allowed: false }]);
});

test('canonical_recovery_binding', async () => {
  const { identity } = fixture;
  await withClient(async client => {
    await expect(store.readSyncCommit(client, identity, { ...plan, expectedBalanceCents: plan.expectedBalanceCents + 1 }))
      .rejects.toMatchObject(invalid);
    await expect(store.readSyncCommit(client, { ...identity, activationId: 'foreign-activation' }, plan))
      .rejects.toMatchObject(invalid);
    await expect(store.readSyncCommit(client, { ...identity, scope: { ...identity.scope, companyId: 'foreign-company' } }, plan))
      .rejects.toMatchObject(invalid);
  });
});

test('legacy_delivery_origin_mismatch', async () => {
  const { identity, stored } = fixture;
  await withOwnerRollback(async client => {
    await client.query('ALTER TABLE runtime_sync_delivery_outcomes DISABLE TRIGGER USER');
    await client.query('UPDATE runtime_sync_delivery_outcomes SET event_id = $1', [stored.receipt.eventIds[0]]);
    await expect(store.readSyncCommit(client, identity, plan)).rejects.toMatchObject(invalid);
  });
});

test('canonical_receipt_epoch_matches_index', async () => {
  await withOwnerRollback(async client => {
    await client.query('ALTER TABLE runtime_sync_receipts DISABLE TRIGGER USER');
    await client.query('UPDATE runtime_sync_receipts SET epoch = 2 WHERE receipt_id = $1', [receipt.id]);
    await expect(store.readSyncCommit(client, fixture.identity, plan)).rejects.toMatchObject(invalid);
  });
});

test('canonical_unit_epoch_matches_receipt', async () => {
  const { identity } = fixture;
  await withOwnerRollback(async client => {
    const { rows: [after] } = await client.query<{ after_snapshot_hash: string }>(
      'SELECT after_snapshot_hash FROM runtime_sync_receipts WHERE receipt_id = $1', [receipt.id],
    );
    const audit = await makeAudit(client, fixture, captured, plan, receipt, after!.after_snapshot_hash, [{
      event: store.syncEventRef(captured.events[0]!), recordId: ongoing.id,
      origin: { kind: 'sync', recordId: ongoing.id, receipt }, disposition: 'new',
    }]);
    const values = unitValues(audit);
    await client.query('SAVEPOINT mismatch');
    await expect(client.query(unitInsert, values.with(1, 'foreign-company'))).rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK TO mismatch');
    await client.query(unitInsert, values);
    await insertOutcome(client, audit, audit.members[0]!);
    const headScope = values.slice(0, 7);
    for (const checkpoint of audit.coverage.checkpoints) {
      await client.query(`
        INSERT INTO runtime_sync_application_heads
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NULL)
      `, [...headScope, checkpoint.streamId, checkpoint.baselineCursor]);
    }
    const advance = `UPDATE runtime_sync_application_heads SET applied_through = $2, last_unit_hash = $3 WHERE stream_id = $1`;
    await client.query(advance, [streamId, captured.next, audit.unitHash]);
    expect((await client.query(
      'SELECT applied_through, last_unit_hash FROM runtime_sync_application_heads WHERE stream_id = $1', [streamId],
    )).rows).toEqual([{ applied_through: captured.next, last_unit_hash: audit.unitHash }]);
    await client.query('SAVEPOINT progress');
    await expect(client.query(advance, [streamId, captured.after, null])).rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK TO progress');
    await expect(client.query(advance, ['a-semantics', captured.next, audit.unitHash])).rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK TO progress');
    expect(await store.readSyncUnit(client, identity, audit.unitHash)).toEqual(audit);
    expect(await store.readSyncCommit(client, identity, plan)).toEqual({ receipt, replayed: true });
    await client.query('ALTER TABLE runtime_sync_receipts DISABLE TRIGGER USER');
    await client.query('UPDATE runtime_sync_receipts SET epoch = 2, receipt = $2, receipt_digest = $3 WHERE receipt_id = $1',
      [receipt.id, ...encodeCanonical({ ...receipt, epoch: 2 })]);
    await expect(store.readSyncUnit(client, identity, audit.unitHash)).rejects.toMatchObject(invalid);
    await expect(store.readSyncCommit(client, identity, plan)).rejects.toMatchObject(invalid);
  });
});


test('mixed_original_receipts', async () => {
  const subject = await createSyncApplyFixture();
  try {
    const { db, identity, stored } = subject;
    const { bundle, approvedTarget } = stored;
    const profile = selectedProfile(bundle);
    const originalInvoice = approvedTarget.records.invoices.find(invoice => invoice.effectiveAt === '2026-09-01T00:00:00.000Z');
    expect(originalInvoice?.amountCents).toBe(300_000);
    if (!originalInvoice) throw new Error('Expected the partially paid fixture invoice');
    const initialDelivery = bundle.bootstrapEvents.find(event => event.id === originalInvoice.sourceEventId)!;
    const appended = await subject.addPayment('storage-mixed', profile.sourceAccountIds[0]!, originalInvoice.identity.recordId);
    const baseline = bundle.manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
    const replay = { ...initialDelivery, id: 'event:storage-replay', observedAt: syncApplyInstant };
    const events = [replay, ...appended].map((event, index) => {
      const positioned = { ...event, sequence: Number(baseline) + index + 1 };
      return { ...positioned, contentHash: hashEvent(positioned) };
    });
    const page = ChangePageSchema.parse({
      sourceRef: bundle.manifest.sourceRef, streamId, after: baseline,
      next: String(Number(baseline) + events.length), complete: true, events,
    });
    const capture = await createRuntimeCapture({ db, clock: syncApplyClock }).openCommitted(identity);
    await capture.capturePage(page);
    const classification = classifyBatch(bundle.artifact, profile, events, { ...approvedTarget.records, asOf: syncApplyInstant });
    expect(classification.outcome.holds).toEqual([]);
    expect(classification.details).toMatchObject({ kind: 'classified', groups: [{ disposition: 'accepted' }] });
    expect(classification.outcome.plans).toHaveLength(1);
    const plan = classification.outcome.plans[0]!;
    expect(plan.eventIds).toEqual(events.map(event => event.id));

    const first = await withTransaction(db, async client => {
      const initial: store.ReceiptOrigin = {
        kind: 'initial', recordId: originalInvoice.id, importKey: stored.request.idempotencyKey, receipt: stored.receipt,
      };
      const { receipt, snapshotHash, after } = await insertMonetaryFixture(client, subject, plan, 'receipt:storage-mixed');
      const members: store.UnitMember[] = [{
        event: store.syncEventRef(events[0]!), recordId: originalInvoice.id, disposition: 'replay', origin: initial,
      }];
      for (const event of events.slice(1)) {
        const recordId = plan.operations.find(operation =>
          'sourceEventId' in operation.record && operation.record.sourceEventId === event.id)!.record.id;
        members.push({ event: store.syncEventRef(event), recordId, disposition: 'new', origin: { kind: 'sync', recordId, receipt } });
      }
      const audit = await makeAudit(client, subject, page, plan, receipt, snapshotHash, members);
      await client.query(unitInsert, unitValues(audit));
      await client.query('SAVEPOINT wrong_origin');
      await expect(insertOutcome(client, audit, {
        ...members[0]!, origin: { kind: 'sync', recordId: originalInvoice.id, receipt },
      })).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO wrong_origin');
      for (const member of members) await insertOutcome(client, audit, member);

      const saved = await store.readSyncUnit(client, identity, audit.unitHash);
      expect(saved?.members.map(member => member.origin)).toEqual(members.map(member => member.origin));
      expect(saved?.members[0]?.origin).toEqual(initial);
      expect(await store.readSyncCommit(client, identity, plan)).toEqual({ receipt, replayed: true });
      expect(receipt.targetRecordIds).not.toContain(originalInvoice.id);
      expect(await store.readFinancialOrigins(client, identity.scope, [originalInvoice])).toEqual([initial]);
      await client.query(`
        INSERT INTO runtime_sync_application_heads
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NULL)
      `, [...unitScope(audit), audit.fromCursor]);
      await advanceFixtureHead(client, audit);
      return { audit, after, receipt };
    });

    async function captureFixtureInvoice(id: string, after: string) {
      await subject.addInvoice(id, profile.sourceAccountIds[0]!);
      // The replay above was captured without writing it to the synthetic source ledger.
      const sourcePage = await subject.source.fetchChanges(bundle.manifest.sourceRef, streamId, String(Number(after) - 1));
      expect(sourcePage.events).toHaveLength(1);
      const positioned = { ...sourcePage.events[0]!, sequence: Number(after) + 1 };
      const next = ChangePageSchema.parse({
        ...sourcePage, after, next: String(positioned.sequence),
        events: [{ ...positioned, contentHash: hashEvent(positioned) }],
      });
      await capture.capturePage(next);
      return next;
    }

    const next = await captureFixtureInvoice('storage-successor', page.next);
    const successorPlan = planBatch(bundle.artifact, profile, next.events, first.after).plans[0]!;
    const second = await withTransaction(db, async client => {
      const { receipt, snapshotHash } = await insertMonetaryFixture(client, subject, successorPlan, 'receipt:storage-next', first.after);
      const recordId = receipt.targetRecordIds[0]!;
      const audit = await makeAudit(client, subject, next, successorPlan, receipt, snapshotHash, [{
        event: store.syncEventRef(next.events[0]!), recordId, disposition: 'new', origin: { kind: 'sync', recordId, receipt },
      }], first.audit);
      await client.query(unitInsert, unitValues(audit));
      await insertOutcome(client, audit, audit.members[0]!);
      await advanceFixtureHead(client, audit);
      return { audit, receipt };
    });
    await captureFixtureInvoice('storage-later-capture', next.next);
    await withTransaction(db, async client => {
      await client.query('SET TRANSACTION READ ONLY');
      expect(await store.readSyncCommit(client, identity, plan)).toEqual({ receipt: first.receipt, replayed: true });
      expect(await store.readSyncUnit(client, identity, first.audit.unitHash)).toEqual(first.audit);
      expect(await store.readSyncCommit(client, identity, successorPlan)).toEqual({ receipt: second.receipt, replayed: true });
      expect(await store.readSyncUnit(client, identity, second.audit.unitHash)).toEqual(second.audit);
    });

    await withTransaction(subject.owner, async client => {
      const { coverage } = second.audit;
      const alternateHash = hashCanonical('wrong-history-binding');
      const badOrigin = coverage.historyOrigins.find(origin => origin.syncReceiptId !== null)!;
      const corruptFirst = {
        ...first.audit,
        members: first.audit.members.with(0, {
          ...first.audit.members[0]!, event: { ...first.audit.members[0]!.event, contentHash: alternateHash },
        }),
      };
      const cases: { name: string; coverage: store.CoverageCut; corruptPrior?: boolean }[] = [
        { name: 'unit digest', coverage: {
          ...coverage, historyUnits: [{ ...coverage.historyUnits[0]!, auditDigest: alternateHash }],
        } },
        { name: 'outcome digest', coverage: {
          ...coverage, historyOutcomes: coverage.historyOutcomes.with(0, { ...coverage.historyOutcomes[0]!, digest: alternateHash }),
        } },
        { name: 'origin receipt ID', coverage: {
          ...coverage, historyOrigins: coverage.historyOrigins.map(origin =>
            origin === badOrigin ? { ...origin, syncReceiptId: 'receipt:wrong-origin' } : origin),
        } },
        { name: 'origin receipt digest', coverage: {
          ...coverage, historyOrigins: coverage.historyOrigins.map(origin =>
            origin === badOrigin ? { ...origin, receiptDigest: alternateHash } : origin),
        } },
        { name: 'actual referenced audit corruption with matching digest', coverage: {
          ...coverage, historyUnits: [{ ...coverage.historyUnits[0]!, auditDigest: hashCanonical(corruptFirst) }],
        }, corruptPrior: true },
      ];
      for (const testCase of cases) {
        await client.query('SAVEPOINT corrupt_history');
        if (testCase.corruptPrior) {
          await client.query('ALTER TABLE runtime_sync_units DISABLE TRIGGER runtime_sync_units_immutable');
          await client.query('UPDATE runtime_sync_units SET audit = $2, audit_digest = $3 WHERE unit_hash = $1',
            [first.audit.unitHash, ...encodeCanonical(corruptFirst)]);
        }
        const forged = rehashAudit(second.audit, testCase.coverage);
        await replaceFixtureUnit(client, second.audit, forged);
        await expect.soft(store.readSyncUnit(client, identity, forged.unitHash), testCase.name).rejects.toMatchObject(invalid);
        await expect.soft(store.readSyncCommit(client, identity, successorPlan), testCase.name).rejects.toMatchObject(invalid);
        await client.query('ROLLBACK TO corrupt_history');
      }
    });
  } finally {
    await subject.close();
  }
}, 120_000);

async function advanceFixtureHead(client: PoolClient, audit: store.SyncUnitAudit) {
  await client.query(`
    UPDATE runtime_sync_application_heads SET applied_through = $2, last_unit_hash = $3 WHERE stream_id = $1
  `, [audit.streamId, audit.throughCursor, audit.unitHash]);
}

function rehashAudit(audit: store.SyncUnitAudit, coverage: store.CoverageCut): store.SyncUnitAudit {
  const { identity, lane, streamId, expectedEpoch, expectedTargetVersion, beforeSnapshotHash, asOf, planHash } = audit;
  const coverageHash = hashCanonical(coverage);
  const unitHash = store.hashSyncUnit({
    identity, lane, streamId, expectedEpoch, expectedTargetVersion, beforeSnapshotHash, asOf, coverageHash, planHash,
  });
  return { ...audit, coverage, coverageHash, unitHash };
}

async function replaceFixtureUnit(client: PoolClient, old: store.SyncUnitAudit, replacement: store.SyncUnitAudit) {
  await client.query('ALTER TABLE runtime_sync_application_heads DISABLE TRIGGER runtime_sync_application_heads_guard');
  await client.query('ALTER TABLE runtime_sync_event_outcomes DISABLE TRIGGER runtime_sync_event_outcomes_immutable');
  await client.query('ALTER TABLE runtime_sync_units DISABLE TRIGGER runtime_sync_units_immutable');
  await client.query('DELETE FROM runtime_sync_application_heads WHERE last_unit_hash = $1', [old.unitHash]);
  await client.query('DELETE FROM runtime_sync_event_outcomes WHERE unit_hash = $1', [old.unitHash]);
  await client.query('DELETE FROM runtime_sync_units WHERE unit_hash = $1', [old.unitHash]);
  await client.query(unitInsert, unitValues(replacement));
  for (const member of replacement.members) await insertOutcome(client, replacement, member);
}

test('exact receipt recovery preserves the committed epoch after authority advances', async () => {
  const { db, identity, source, stored } = fixture;
  const authority = createCurrentAuthority({
    db, clock: syncApplyClock, observe: source.readCurrentSemantics,
    admission: { authorize: async () => ({
      reviewer: { reviewerId: 'sync-apply-test-reviewer', sessionId: 'sync-apply-epoch-test' },
      allowedAccountIds: [identity.scope.accountId], allowedSourceRefs: [stored.bundle.manifest.sourceRef],
    }) },
  });
  const { result } = await authority.command({}, {
    schemaVersion: '1', identity, action: 'pause', expectedEpoch: 1, idempotencyKey: 'storage-test-pause',
  });
  expect(result.state).toMatchObject({ epoch: 2, status: 'paused' });
  await withClient(async client => {
    const before = await client.query('SELECT sequence FROM activity_counter');
    const saved = await store.readSyncCommit(client, identity, plan);
    expect(saved).toEqual({ receipt, replayed: true });
    expect(saved?.receipt.epoch).toBe(1);
    expect((await client.query('SELECT sequence FROM activity_counter')).rows).toEqual(before.rows);
  });
});
