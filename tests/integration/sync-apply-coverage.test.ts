import type { PoolClient } from 'pg';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { hashBytes, hashCanonical, hashEvent, hashManifest, type ChangePage, type RawSourceEvent } from '@eapr/contracts';
import { classifyBatch, planBatch } from '@eapr/compiler/plan-batch';
import { encodeCanonical, scopeValues } from '@eapr/parent/snapshots';
import { SyncUnitAuditSchema, syncEventRef, type ReceiptOrigin } from '@eapr/parent/sync-store';
import { withTransaction } from '@eapr/storage/transaction';
import { selectedProfile } from '../../apps/worker/src/activation-validation.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { createSyncApplyFixture, syncApplyClock, syncApplyInstant } from '../fixtures/sync-apply.js';

const financial = 'a-finance';
const semantic = 'a-semantics';
const unsupported = { code: 'SYNC_COVERAGE_UNSUPPORTED' };
const invalid = { code: 'SYNC_STORAGE_INVALID' };
const noPending = { code: 'SYNC_NO_PENDING' };
type Fixture = Awaited<ReturnType<typeof createSyncApplyFixture>>;
let fixture: Fixture;
let first: ChangePage;
let second: ChangePage;

const implementation = () => import('../../apps/worker/src/sync/apply-coverage.js');
const profile = (data: Fixture) => selectedProfile(data.stored.bundle);
const baseline = (data: Fixture, streamId = financial) =>
  data.stored.bundle.manifest.streams.find(stream => stream.streamId === streamId)!.resumeAfter;
const open = (data: Fixture) => createRuntimeCapture({ db: data.db, clock: syncApplyClock }).openCommitted(data.identity);
const fetch = (data: Fixture, after = baseline(data), streamId = financial) =>
  data.source.fetchChanges(data.stored.bundle.manifest.sourceRef, streamId, after);
const account = (data: Fixture) => profile(data).sourceAccountIds[0]!;
const prepare = async (client: PoolClient, data = fixture) =>
  (await implementation()).prepareCapturedUnit(client, data.identity, syncApplyInstant);

async function readOnly<T>(data: Fixture, read: (client: PoolClient) => Promise<T>) {
  const client = await data.db.connect();
  try {
    await client.query('BEGIN READ ONLY');
    return await read(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const durableTables = [
  'parent_financial_records', 'parent_targets', 'parent_snapshots', 'runtime_financial_origins',
  'runtime_economic_outcomes', 'runtime_delivery_outcomes', 'runtime_sync_economic_outcomes',
  'runtime_sync_delivery_outcomes', 'runtime_sync_receipts', 'runtime_sync_units', 'runtime_sync_event_outcomes',
  'runtime_sync_application_heads', 'runtime_authority_heads', 'runtime_authority_commands', 'activity_events',
  'activity_counter', 'runtime_deliveries', 'runtime_source_positions', 'runtime_inbox', 'runtime_capture_pages',
  'runtime_capture_checkpoints', 'runtime_capture_incidents', 'runtime_capture_lanes',
];

async function durableState(client: PoolClient) {
  const result = await client.query(durableTables.map(table => `
    SELECT '${table}' AS relation, COALESCE(array_agg(row::text ORDER BY row::text), '{}') AS rows
    FROM (SELECT to_jsonb(t) AS row FROM ${table} t) contents
  `).join(' UNION ALL '));
  return result.rows;
}

async function expectRejected(data: Fixture, error: { code: string }) {
  await readOnly(data, async client => {
    const before = await durableState(client);
    await expect(prepare(client, data)).rejects.toMatchObject(error);
    expect(await durableState(client)).toEqual(before);
  });
}

async function withFixture(run: (data: Fixture) => Promise<void>) {
  const data = await createSyncApplyFixture();
  try { await run(data); } finally { await data.close(); }
}

function changed(event: RawSourceEvent, patch: Partial<RawSourceEvent>) {
  const updated = { ...event, ...patch };
  return { ...updated, contentHash: hashEvent(updated) };
}

beforeAll(async () => {
  fixture = await createSyncApplyFixture();
  const capture = await open(fixture);
  await fixture.addInvoice('coverage-invoice', account(fixture));
  first = await fetch(fixture);
  expect(await capture.capturePage(first)).toMatchObject({ disposition: 'captured', captured: 1 });
  await fixture.addPayment('coverage-payment', account(fixture), first.events[0]!.recordId);
  second = await fetch(fixture, first.next);
  expect(await capture.capturePage(second)).toMatchObject({ disposition: 'captured', captured: 2 });
}, 120_000);

afterAll(async () => { await fixture?.close(); }, 120_000);

test('forged_uncaptured_input: a valid source event and matching plan cannot prepare without capture', async () => {
  await withFixture(async data => {
    await open(data);
    await data.addInvoice('uncaptured', account(data));
    const uncaptured = await fetch(data);
    expect(uncaptured.events).toHaveLength(1);
    expect(uncaptured.events[0]!.contentHash).toBe(hashEvent(uncaptured.events[0]!));
    expect(planBatch(data.stored.bundle.artifact, profile(data), uncaptured.events, data.stored.approvedTarget.records).plans).toHaveLength(1);
    await expectRejected(data, noPending);
  });
}, 120_000);

test('full_source_history_cut: prepares the entire connected suffix from two accepted runtime pages', async () => {
  await readOnly(fixture, async client => {
    const before = await durableState(client);
    const { readCoverageCut } = await implementation();
    const query = vi.spyOn(client, 'query');
    const cut = await readCoverageCut(client, fixture.identity).finally(() => {
      expect(query).toHaveBeenCalledTimes(1);
      query.mockRestore();
    });
    expect(cut.checkpoints).toEqual([
      { streamId: financial, transport: 'api', baselineCursor: baseline(fixture), captureCursor: second.next,
        capturedPages: '2', lastCapturedAt: syncApplyInstant },
      { streamId: semantic, transport: 'semantic', baselineCursor: baseline(fixture, semantic),
        captureCursor: baseline(fixture, semantic), capturedPages: '0', lastCapturedAt: null },
    ]);
    expect(cut.applicationHeads).toEqual([]);
    expect(cut.positions.map(row => row.eventId)).toEqual([...first.events, ...second.events].map(event => event.id));
    expect(cut.inbox.map(row => row.afterCursor)).toEqual([first.after, second.after, second.after]);
    expect(cut.pages.map(row => row.digest)).toEqual([hashCanonical(first), hashCanonical(second)]);
    const prepared = await prepare(client);
    expect(prepared.coverage).toEqual(cut);
    expect(prepared.events).toEqual([...first.events, ...second.events]);
    expect(prepared.plan?.eventIds).toEqual(cut.positions.map(row => row.eventId));
    expect(prepared.expectedEpoch).toBe(1);
    expect(await durableState(client)).toEqual(before);
  });
});

async function dropReferencingForeignKeys(client: PoolClient, referenced: string) {
  const { rows } = await client.query<{ table_name: string; constraint_name: string }>(`
    SELECT conrelid::regclass::text AS table_name, quote_ident(conname) AS constraint_name
    FROM pg_constraint WHERE contype = 'f' AND confrelid = $1::regclass
  `, [referenced]);
  for (const row of rows) await client.query(`ALTER TABLE ${row.table_name} DROP CONSTRAINT ${row.constraint_name}`);
}

async function corrupt(run: (client: PoolClient) => Promise<unknown>, error = invalid, data = fixture) {
  const client = await data.owner.connect();
  try {
    await client.query('BEGIN');
    const before = await durableState(client);
    await run(client);
    const damaged = await durableState(client);
    expect(damaged).not.toEqual(before);
    await expect(prepare(client, data)).rejects.toMatchObject(error);
    expect(await durableState(client)).toEqual(damaged);
    await client.query('ROLLBACK');
    expect(await durableState(client)).toEqual(before);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

test.each([
  ['missing global position', 'runtime_source_positions', 'event_id'],
  ['missing inbox', 'runtime_inbox', 'event_id'],
  ['missing delivery', 'runtime_deliveries', 'event_id'],
  ['missing page', 'runtime_capture_pages', 'after_cursor'],
] as const)('coverage_membership_corruption: %s', async (_name, table, column) => {
  await corrupt(async client => {
    await dropReferencingForeignKeys(client, table);
    await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await client.query(`DELETE FROM ${table} WHERE ${column} = $1`, [column === 'event_id' ? first.events[0]!.id : first.after]);
  });
});

test.each(['delivery canonical observedAt', 'page canonical observedAt', 'page bytes with original digest', 'page digest'] as const)(
  'coverage_membership_corruption: %s', async (kind) => {
    const event = first.events[0]!;
    const updated = changed(event, { observedAt: '2026-11-09T08:01:00.000Z' });
    await corrupt(async client => {
      if (kind === 'delivery canonical observedAt') {
        await client.query('ALTER TABLE runtime_deliveries DISABLE TRIGGER USER');
        await client.query('UPDATE runtime_deliveries SET canonical=$2, digest=$3, content_hash=$4 WHERE event_id=$1',
          [event.id, ...encodeCanonical(updated), updated.contentHash]);
      } else {
        await client.query('ALTER TABLE runtime_capture_pages DISABLE TRIGGER USER');
        const [canonical, digest] = encodeCanonical({ ...first, events: kind === 'page digest' ? first.events : [updated] });
        await client.query('UPDATE runtime_capture_pages SET canonical=$2, digest=$3 WHERE after_cursor=$1 AND stream_id=$4',
          [first.after, canonical, kind === 'page digest' ? '0'.repeat(64) : kind === 'page bytes with original digest'
            ? hashCanonical(first) : digest, financial]);
      }
    });
  },
);

test('coverage_membership_corruption: delivery orphan is visible even without a position', async () => {
  const event = changed(first.events[0]!, { id: 'coverage-orphan', sequence: Number(second.next) + 1 });
  await corrupt(client => client.query('INSERT INTO runtime_deliveries VALUES ($1, $2, $3, $4, $5)',
    [event.sourceRef, event.id, event.contentHash, ...encodeCanonical(event)]));
});

test.each(['semantic change', 'unchanged semantic event', 'change then return', 'unknown account', 'missing dependency',
  'multiple groups'] as const)('coverage_blocker_outside_selection and complete_single_group: %s', async kind => {
  await withFixture(async data => {
    const capture = await open(data);
    const initialInvoice = data.stored.approvedTarget.records.invoices[0]!.identity.recordId;
    await data.addPayment('coverage-rejected', account(data), kind === 'missing dependency' ? 'absent-invoice' : initialInvoice);
    await capture.capturePage(await fetch(data));
    if (kind === 'unknown account' || kind === 'multiple groups') {
      const { captureCursor } = (await capture.readProgress()).streams.find(row => row.streamId === financial)!;
      await data.addInvoice('coverage-extra', kind === 'unknown account' ? 'unknown-coverage-account' : account(data));
      await capture.capturePage(await fetch(data, captureCursor));
    } else if (kind !== 'missing dependency') {
      await data.addSemantic('coverage-semantic', account(data),
        kind === 'unchanged semantic event' ? profile(data).semanticVersion : 'coverage-new-semantics');
      if (kind === 'change then return') await data.addSemantic('coverage-return', account(data), profile(data).semanticVersion);
      await capture.capturePage(await fetch(data, baseline(data, semantic), semantic));
      if (kind !== 'semantic change') {
        const { versions } = await data.source.readCurrentSemantics(data.stored.bundle.manifest.sourceRef);
        expect(versions[data.identity.scope.sellerEntityId + '/' + account(data)]).toBe(profile(data).semanticVersion);
      }
    }
    await expectRejected(data, unsupported);
  });
}, 120_000);

async function insertDelivery(client: PoolClient, event: RawSourceEvent) {
  await client.query('INSERT INTO runtime_deliveries VALUES ($1, $2, $3, $4, $5)',
    [event.sourceRef, event.id, event.contentHash, ...encodeCanonical(event)]);
}

async function insertPosition(client: PoolClient, event: RawSourceEvent) {
  await insertDelivery(client, event);
  await client.query('INSERT INTO runtime_source_positions VALUES ($1, $2, $3, $4)',
    [event.sourceRef, event.streamId, event.sequence, event.id]);
}

async function insertPage(client: PoolClient, page: ChangePage) {
  await client.query('INSERT INTO runtime_capture_pages VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    page.sourceRef, fixture.stored.bundle.manifest.hash, page.streamId, page.after, page.next, page.events.length,
    ...encodeCanonical(page), syncApplyInstant,
  ]);
}

function standalonePage(example: RawSourceEvent, cursor: string, id: string): ChangePage {
  const event = changed(example, { id, sequence: Number(cursor) + 1 });
  return { sourceRef: event.sourceRef, streamId: event.streamId, after: cursor, next: String(event.sequence), complete: true, events: [event] };
}

test.each(['extra position beyond C', 'extra inbox beyond C', 'extra page beyond C', 'wrong inbox stream',
  'wrong inbox manifest', 'wrong page range', 'wrong page count', 'incomplete raw page',
  'noncanonical raw page', 'page gap', 'page overlap', 'checkpoint B mismatch',
  'checkpoint C below page', 'checkpoint C above rows'] as const)('coverage_membership_corruption: %s', async kind => {
  await corrupt(async client => {
    const extra = standalonePage(first.events[0]!, second.next, 'coverage-excess');
    if (kind === 'extra position beyond C') return insertPosition(client, extra.events[0]!);
    if (kind === 'extra page beyond C') return insertPage(client, extra);
    if (kind === 'extra inbox beyond C' || kind === 'wrong inbox stream' || kind === 'wrong inbox manifest') {
      await dropForeignKeys(client, 'runtime_inbox', 'runtime_source_positions');
      if (kind === 'extra inbox beyond C') {
        return client.query(`
          INSERT INTO runtime_inbox (source_ref, manifest_hash, stream_id, sequence, event_id, after_cursor)
          SELECT source_ref, manifest_hash, stream_id, $2, $3, after_cursor FROM runtime_inbox WHERE event_id = $1
        `, [second.events[0]!.id, extra.next, extra.events[0]!.id]);
      }
      await dropForeignKeys(client, 'runtime_inbox', 'runtime_capture_pages');
      await client.query('ALTER TABLE runtime_inbox DISABLE TRIGGER USER');
      return kind === 'wrong inbox stream'
        ? client.query('UPDATE runtime_inbox SET stream_id = $2 WHERE event_id = $1', [first.events[0]!.id, semantic])
        : client.query('UPDATE runtime_inbox SET manifest_hash = $2 WHERE event_id = $1', [first.events[0]!.id, '0'.repeat(64)]);
    }
    if (kind.startsWith('checkpoint')) {
      if (kind === 'checkpoint B mismatch') return client.query(
        'UPDATE runtime_capture_checkpoints SET baseline_cursor = baseline_cursor + 1 WHERE stream_id = $1', [financial]);
      return client.query('UPDATE runtime_capture_checkpoints SET capture_cursor = $2 WHERE stream_id = $1', [
        financial, Number(second.next) + (kind === 'checkpoint C below page' ? -1 : 1),
      ]);
    }
    await client.query('ALTER TABLE runtime_capture_pages DISABLE TRIGGER USER');
    if (kind === 'wrong page count') {
      await dropPageChecks(client, 'event_count');
      return client.query('UPDATE runtime_capture_pages SET event_count = 2 WHERE stream_id = $1 AND after_cursor = $2',
        [financial, first.after]);
    }
    if (kind === 'wrong page range') {
      await dropPageChecks(client, 'next_cursor');
      return client.query('UPDATE runtime_capture_pages SET next_cursor = next_cursor + 1 WHERE stream_id = $1 AND after_cursor = $2',
        [financial, first.after]);
    }
    if (kind === 'incomplete raw page' || kind === 'noncanonical raw page') {
      if (kind === 'incomplete raw page') await dropPageChecks(client, 'complete');
      const raw = kind === 'incomplete raw page'
        ? encodeCanonical({ ...first, complete: false })
        : [JSON.stringify(first), hashBytes(Buffer.from(JSON.stringify(first)))];
      return client.query('UPDATE runtime_capture_pages SET canonical = $3, digest = $4 WHERE stream_id = $1 AND after_cursor = $2',
        [financial, first.after, ...raw]);
    }
    if (kind === 'page gap') {
      await dropForeignKeys(client, 'runtime_inbox', 'runtime_capture_pages');
      const gap = { ...second, after: String(Number(second.after) + 1), events: second.events.slice(1) };
      return client.query(`
        UPDATE runtime_capture_pages SET after_cursor = $3, event_count = 1, canonical = $4, digest = $5
        WHERE stream_id = $1 AND after_cursor = $2
      `, [financial, second.after, gap.after, ...encodeCanonical(gap)]);
    }
    const overlap = { ...first, next: String(second.events[0]!.sequence), events: [...first.events, second.events[0]!] };
    return client.query(`
      UPDATE runtime_capture_pages SET next_cursor = $3, event_count = 2, canonical = $4, digest = $5
      WHERE stream_id = $1 AND after_cursor = $2
    `, [financial, first.after, overlap.next, ...encodeCanonical(overlap)]);
  });
});

async function dropForeignKeys(client: PoolClient, table: string, referenced: string) {
  const { rows } = await client.query<{ name: string }>(`
    SELECT quote_ident(conname) AS name FROM pg_constraint
    WHERE contype = 'f' AND conrelid = $1::regclass AND confrelid = $2::regclass
  `, [table, referenced]);
  expect(rows.length).toBeGreaterThan(0);
  for (const { name } of rows) await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
}

async function dropPageChecks(client: PoolClient, field: string) {
  const { rows } = await client.query<{ name: string }>(`
    SELECT quote_ident(conname) AS name FROM pg_constraint WHERE contype = 'c'
      AND conrelid = 'runtime_capture_pages'::regclass AND strpos(pg_get_constraintdef(oid), $1) > 0
  `, [field]);
  expect(rows.length).toBeGreaterThan(0);
  for (const { name } of rows) await client.query(`ALTER TABLE runtime_capture_pages DROP CONSTRAINT ${name}`);
}

test.each(['extra lane', 'undeclared source stream'] as const)('coverage_blocker_outside_selection: %s', async kind => {
  await corrupt(async client => {
    if (kind === 'undeclared source stream') {
      return insertPosition(client, changed(first.events[0]!, { streamId: 'coverage-foreign-stream', id: 'coverage-foreign-stream-event', sequence: 1 }));
    }
    const old = fixture.stored.bundle.manifest;
    const alternate = { ...old, id: 'coverage-extra-manifest' };
    alternate.hash = hashManifest(alternate);
    return client.query(`
      INSERT INTO runtime_capture_lanes
      SELECT source_ref, $2, initial_activation_id, $3, $4, capture_canonical, capture_digest, initialized_at
      FROM runtime_capture_lanes WHERE source_ref = $1
    `, [old.sourceRef, alternate.hash, ...encodeCanonical(alternate)]);
  }, unsupported);
});

test.each(['missing seller', 'foreign seller', 'foreign source account'] as const)('coverage_blocker_outside_selection: %s', async kind => {
  // Rebind both copies of a genuinely captured member to the same legal envelope.
  // Coverage must reject the scope of the complete capture even when its indexes agree.
  const event = first.events[0]!;
  const { sellerEntityId: _seller, ...withoutSeller } = event.rawIdentity;
  const rawIdentity = kind === 'missing seller' ? withoutSeller : {
    ...event.rawIdentity,
    ...(kind === 'foreign seller' ? { sellerEntityId: 'foreign-seller' } : { sourceAccountId: 'foreign-account' }),
  };
  const updated = changed(event, { rawIdentity });
  await corrupt(async client => {
    await client.query('ALTER TABLE runtime_deliveries DISABLE TRIGGER USER');
    await client.query('ALTER TABLE runtime_capture_pages DISABLE TRIGGER USER');
    await client.query('UPDATE runtime_deliveries SET canonical=$2, digest=$3, content_hash=$4 WHERE event_id=$1',
      [event.id, ...encodeCanonical(updated), updated.contentHash]);
    await client.query('UPDATE runtime_capture_pages SET canonical=$2, digest=$3 WHERE after_cursor=$1 AND stream_id=$4',
      [first.after, ...encodeCanonical({ ...first, events: [updated] }), financial]);
  }, unsupported);
});

test('complete_single_group: semantic-only capture cannot prepare', async () => {
  await withFixture(async data => {
    const capture = await open(data);
    await data.addSemantic('coverage-semantic-only', account(data), profile(data).semanticVersion);
    expect(await capture.capturePage(await fetch(data, baseline(data, semantic), semantic))).toMatchObject({ captured: 1 });
    await expectRejected(data, unsupported);
  });
}, 120_000);

function originalInvoice(data: Fixture) {
  const record = data.stored.approvedTarget.records.invoices.find(invoice => invoice.effectiveAt === '2026-09-01T00:00:00.000Z')!;
  expect(record.amountCents).toBe(300_000);
  return { record, event: data.stored.bundle.bootstrapEvents.find(event => event.id === record.sourceEventId)! };
}

type Capture = Awaited<ReturnType<typeof open>>;
async function acceptEvents(data: Fixture, capture: Capture, after: string, input: RawSourceEvent[]) {
  const { pageSize } = data.stored.bundle.artifact.normalizedPlan.capture.find(stream => stream.streamId === financial)!;
  for (let i = 0; i < input.length; i += pageSize) {
    const events = input.slice(i, i + pageSize).map((event, index) => changed(event, { sequence: Number(after) + index + 1 }));
    const next = String(Number(after) + events.length);
    expect(await capture.capturePage({
      sourceRef: events[0]!.sourceRef, streamId: financial, after, next, complete: true, events,
    })).toMatchObject({ disposition: 'captured', captured: events.length, cursor: next });
    after = next;
  }
  return after;
}

test('complete_single_group: accepts new, replay and coalesced members, then rejects a held replay or shortened suffix', async () => {
  await withFixture(async data => {
    const capture = await open(data);
    const { event: original, record } = originalInvoice(data);
    const appended = await data.addPayment('coverage-mixed-payment', account(data), record.identity.recordId);
    const replay = changed(original, { id: 'coverage-mixed-replay' });
    const coalesced = changed(appended[0]!, { id: 'coverage-mixed-coalesced' });
    const input = [replay, ...appended, coalesced];
    const cursor = await acceptEvents(data, capture, baseline(data), input);
    const { details, outcome } = classifyBatch(data.stored.bundle.artifact, profile(data),
      input.map((event, index) => changed(event, { sequence: Number(baseline(data)) + index + 1 })),
      { ...data.stored.approvedTarget.records, asOf: syncApplyInstant });
    expect(outcome.holds.map(hold => hold.code)).toEqual([]);
    expect(details).toMatchObject({ kind: 'classified', items: [
      { disposition: 'financial_replay' }, { disposition: 'financial_new' },
      { disposition: 'financial_new' }, { disposition: 'financial_coalesced' },
    ] });
    const prepared = await readOnly(data, client => prepare(client, data));
    expect(prepared.events.map(event => event.id)).toEqual([replay.id, ...appended.map(event => event.id), coalesced.id]);
    expect(prepared.plan?.operations.map(operation => operation.record.id)).toHaveLength(2);
    expect(prepared.plan?.operations.some(operation => operation.record.id === record.id)).toBe(false);
    const { PreparedSyncUnitSchema } = await import('../../apps/worker/src/sync/apply-types.js');
    const shortened = prepared.events.slice(1);
    const plan = planBatch(data.stored.bundle.artifact, profile(data), shortened, data.stored.approvedTarget.records).plans[0]!;
    expect(plan.eventIds).toHaveLength(3);
    expect(PreparedSyncUnitSchema.safeParse({ ...prepared, events: shortened, plan }).success).toBe(false);
    const conflict = changed(replay, { id: 'coverage-held-replay', payload: { ...replay.payload, amount: '0.01' } });
    await acceptEvents(data, capture, cursor, [conflict]);
    await expectRejected(data, unsupported);
  });
}, 120_000);

async function seedReplayPrefix(data: Fixture, through: string) {
  const prepared = await readOnly(data, client => prepare(client, data));
  expect(prepared.plan).toBeNull();
  const { coverage, events, plan: _plan, ...key } = prepared;
  const { hashPreparedUnit } = await import('../../apps/worker/src/sync/apply-types.js');
  const { record } = originalInvoice(data);
  const origin: ReceiptOrigin = { kind: 'initial', recordId: record.id, importKey: data.stored.request.idempotencyKey, receipt: data.stored.receipt };
  const audit = SyncUnitAuditSchema.parse({
    ...key, coverage, unitHash: hashPreparedUnit(prepared), planHash: null, fromCursor: baseline(data), throughCursor: through,
    receiptId: null, afterTargetVersion: key.expectedTargetVersion, afterSnapshotHash: key.beforeSnapshotHash,
    committedAt: syncApplyInstant, semanticObservation: await data.source.readCurrentSemantics(coverage.lane.sourceRef),
    members: events.map(event => ({ event: syncEventRef(event), recordId: record.id, origin, disposition: 'replay' })),
  });
  const binding = [...scopeValues(key.identity.scope), key.identity.activationId, key.identity.bundleHash,
    key.lane.sourceRef, key.lane.manifestHash, key.streamId];
  await withTransaction(data.db, async client => {
    await client.query(`
      INSERT INTO runtime_sync_units VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $13, $14, NULL, $15, $16)
    `, [audit.unitHash, ...binding, key.expectedEpoch, audit.fromCursor, through, key.expectedTargetVersion,
      key.beforeSnapshotHash, ...encodeCanonical(audit)]);
    for (const member of audit.members) {
      await client.query(`
        INSERT INTO runtime_sync_event_outcomes VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'replay',$13,$14)
      `, [...binding, member.event.sequence, member.event.eventId, member.recordId, audit.unitHash,
        ...encodeCanonical({ identity: key.identity, lane: key.lane, unitHash: audit.unitHash, ...member })]);
    }
    await client.query('INSERT INTO runtime_sync_application_heads VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,NULL)', [...binding, audit.fromCursor]);
    await client.query('UPDATE runtime_sync_application_heads SET applied_through=$2,last_unit_hash=$3 WHERE stream_id=$1',
      [financial, through, audit.unitHash]);
  });
  return audit;
}

test('coverage_bound_and_prefix: exact previous outcomes and origins are required to prepare only the remaining suffix', async () => {
  await withFixture(async data => {
    const capture = await open(data);
    const { event } = originalInvoice(data);
    const through = await acceptEvents(data, capture, baseline(data), [changed(event, { id: 'coverage-prior' })]);
    const audit = await seedReplayPrefix(data, through);
    await expectRejected(data, noPending);
    const cursor = await acceptEvents(data, capture, through, [changed(event, { id: 'coverage-suffix' })]);
    const prepared = await readOnly(data, client => prepare(client, data));
    expect(prepared.events.map(item => item.id)).toEqual(['coverage-suffix']);
    expect(prepared.coverage.positions.map(row => row.eventId)).toEqual(['coverage-prior', 'coverage-suffix']);
    expect(prepared.coverage.historyUnits).toHaveLength(1);
    expect(prepared.coverage.historyOutcomes).toMatchObject([{ unitHash: audit.unitHash, disposition: 'replay' }]);
    expect(prepared.coverage.historyOrigins).toMatchObject([{ initialReceiptId: data.stored.receipt.id }]);
    expect(prepared.coverage.checkpoints[0]?.captureCursor).toBe(cursor);
    for (const table of ['runtime_sync_application_heads', 'runtime_sync_event_outcomes', 'runtime_financial_origins']) {
      await corrupt(async client => {
        await dropReferencingForeignKeys(client, table);
        await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
        return client.query(table === 'runtime_financial_origins'
          ? `DELETE FROM ${table} WHERE record_id = $1`
          : `DELETE FROM ${table} WHERE stream_id = $1`, [table === 'runtime_financial_origins' ? audit.members[0]!.recordId : financial]);
      }, invalid, data);
    }
  });
}, 120_000);

test('coverage_bound_and_prefix: 1,001 retained events exceed the bound even for a one-event suffix', async () => {
  await withFixture(async data => {
    const capture = await open(data);
    const { event } = originalInvoice(data);
    const through = await acceptEvents(data, capture, baseline(data), Array.from({ length: 1000 }, (_, index) =>
      changed(event, { id: 'coverage-bound-' + index })));
    await seedReplayPrefix(data, through);
    await acceptEvents(data, capture, through, [changed(event, { id: 'coverage-bound-sentinel' })]);
    await expectRejected(data, unsupported);
  });
}, 120_000);

test('coverage_membership_corruption: orphan checkpoint outside the matching manifest is visible', async () => {
  await corrupt(async client => {
    await dropForeignKeys(client, 'runtime_capture_checkpoints', 'runtime_capture_lanes');
    return client.query(`
      INSERT INTO runtime_capture_checkpoints (source_ref, manifest_hash, stream_id, transport, baseline_cursor, capture_cursor, captured_pages)
      SELECT source_ref, $1, stream_id, transport, baseline_cursor, baseline_cursor, 0
      FROM runtime_capture_checkpoints WHERE stream_id = $2
    `, ['0'.repeat(64), financial]);
  });
});

test('coverage_blocker_outside_selection: an actual capture incident blocks the existing complete API suffix', async () => {
  const capture = await open(fixture);
  const gap = standalonePage(first.events[0]!, String(Number(second.next) + 1), 'coverage-incident');
  await expect(capture.capturePage(gap)).rejects.toMatchObject({ code: 'CAPTURE_GAP' });
  await expectRejected(fixture, unsupported);
});
