import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';
import { expect, test } from 'vitest';
import { planBatch } from '@eapr/compiler/plan-batch';
import { canonicalJson, hashCanonical, targetRecordId, type RawSourceEvent, type SyncReceipt } from '@eapr/contracts';
import { encodeCanonical, scopeValues } from '@eapr/parent/snapshots';
import { lockParentKeys } from '@eapr/parent/persistence';
import { syncEventRef, type SyncUnitAudit } from '@eapr/parent/sync-store';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { sqlState, withTransaction } from '@eapr/storage/transaction';
import { selectedProfile } from '../../apps/worker/src/activation-validation.js';
import { createConnectionReads } from '../../apps/worker/src/connections.js';
import { createParentReads } from '../../apps/worker/src/parent-reads.js';
import { createSyncApplier } from '../../apps/worker/src/sync/apply.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { createCurrentAuthority } from '../../apps/worker/src/sync/current-authority.js';
import { eventA, type RecordA } from '../../packages/sources/src/company-a.js';
import {
  applyBaseline, applyEvent, applyFinancialStream, applySemanticStream, captureApplyEvents,
  createSyncApplyFixture, partialAllocationEvents, syncApplyClock, syncApplyInstant, type SyncApplyFixture,
} from '../fixtures/sync-apply.js';

const testTimeout = 120_000;
const gateTimeout = 8_000;
const scopeLock = 'SELECT pg_advisory_xact_lock($1::bigint)';
const activityWrite = 'UPDATE activity_counter SET sequence = sequence + 1';
const captureTables = [
  'runtime_capture_lanes', 'runtime_capture_checkpoints', 'runtime_capture_pages', 'runtime_inbox',
  'runtime_source_positions', 'runtime_deliveries', 'runtime_capture_incidents',
] as const;
const tables = [
  ...captureTables, 'parent_scopes', 'parent_metadata', 'parent_financial_records', 'parent_targets',
  'parent_snapshots', 'runtime_activation_imports', 'runtime_import_lineage', 'runtime_economic_outcomes',
  'runtime_delivery_outcomes', 'runtime_sync_economic_outcomes', 'runtime_sync_delivery_outcomes',
  'runtime_financial_origins', 'runtime_sync_receipts', 'runtime_sync_units', 'runtime_sync_event_outcomes',
  'runtime_sync_application_heads', 'runtime_authority_heads', 'runtime_authority_commands',
  'activity_counter', 'activity_events',
] as const;

type Table = typeof tables[number];
type Row = Record<string, unknown>;
type State = Record<Table, Row[]>;

async function state(data: SyncApplyFixture): Promise<State> {
  const { rows } = await data.db.query<{ relation: Table; contents: Row[] }>(tables.map(table => `
    SELECT '${table}' AS relation,
           COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') AS contents
    FROM ${table} t
  `).join(' UNION ALL '));
  return Object.fromEntries(rows.map(row => [row.relation, row.contents])) as State;
}

async function fixture(run: (data: SyncApplyFixture) => Promise<void>, baselineVersion?: number) {
  const data = await createSyncApplyFixture(undefined, baselineVersion);
  try { await run(data); } finally { await data.close(); }
}

function service(data: SyncApplyFixture, db = data.db, observe = data.source.readCurrentSemantics) {
  return createSyncApplier({ db, clock: syncApplyClock, identity: data.identity, observe });
}

function authority(data: SyncApplyFixture, db = data.db) {
  const api = createCurrentAuthority({
    db, clock: syncApplyClock, observe: data.source.readCurrentSemantics,
    admission: { authorize: async () => ({
      reviewer: { reviewerId: 'sync-apply-race-reviewer', sessionId: 'sync-apply-race-session' },
      allowedAccountIds: [data.identity.scope.accountId], allowedSourceRefs: [data.stored.bundle.manifest.sourceRef],
    }) },
  });
  return (action: 'pause' | 'resume' | 'revoke', epoch: number) =>
    api.command({}, { schemaVersion: '1', identity: data.identity, action, expectedEpoch: epoch, idempotencyKey: 'race-' + action });
}

function settle<T>(promise: Promise<T>) {
  return promise.then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
}

function gate<T>() {
  const entered = Promise.withResolvers<T>();
  const resume = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    release: () => resume.resolve(),
    async hold(value: T) {
      entered.resolve(value);
      await resume.promise;
    },
  };
}

async function reached<T>(entered: Promise<T>, pending: Promise<{ error: unknown }>, label: string) {
  const timer = new AbortController();
  try {
    return await Promise.race([
      entered,
      pending.then(({ error }) => { throw new Error('Operation finished before ' + label, { cause: error }); }),
      delay(gateTimeout, undefined, { signal: timer.signal }).then(() => { throw new Error('Timed out at ' + label); }),
    ]);
  } finally { timer.abort(); }
}

type Checkout = { client: PoolClient; pid: number; statements: string[]; readOnly: boolean };
type Intercept = (checkout: Checkout, sql: string, proceed: () => Promise<unknown>) => Promise<unknown>;

function instrument(db: Pool, intercept: Intercept) {
  // Wrap per checkout rather than mutating the shared pool or its reusable clients.
  return new Proxy(db, {
    get(pool, property, receiver) {
      if (property !== 'connect') return Reflect.get(pool, property, receiver);
      return async () => {
        const client = await pool.connect();
        let pid: number;
        try {
          const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          pid = result.rows[0]!.pid;
        } catch (error) {
          client.release(true);
          throw error;
        }
        const checkout: Checkout = { client, pid, statements: [], readOnly: false };
        return new Proxy(client, {
          get(target, key, targetReceiver) {
            if (key !== 'query') return Reflect.get(target, key, targetReceiver);
            return (sql: string, values?: unknown[]) => {
              const normalized = sql.trim().replace(/\s+/g, ' ');
              if (normalized === 'SET TRANSACTION READ ONLY' ||
                  normalized === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') checkout.readOnly = true;
              checkout.statements.push(normalized);
              return intercept(checkout, normalized, () => target.query(sql, values));
            };
          },
        });
      };
    },
  });
}

async function blockedBy(data: SyncApplyFixture, waiter: number, holder: number) {
  const until = performance.now() + gateTimeout;
  do {
    const { rows: [row] } = await data.owner.query<{ blocked: boolean }>(
      'SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked', [holder, waiter],
    );
    if (row!.blocked) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  } while (performance.now() < until);
  throw new Error(`Backend ${waiter} never waited on ${holder}`);
}

function observed(data: SyncApplyFixture, boundary: ReturnType<typeof gate<void>>) {
  return async (sourceRef: string) => {
    const result = await data.source.readCurrentSemantics(sourceRef);
    await boundary.hold(undefined);
    return result;
  };
}

function replay(event: RawSourceEvent, suffix: string) {
  return applyEvent(event, { id: 'evt:race-replay-' + suffix });
}

function recordId(data: SyncApplyFixture, event: RawSourceEvent) {
  if (event.kind === 'semantic_change') throw new Error('Expected financial delivery');
  return targetRecordId({
    sourceRef: event.sourceRef, sellerEntityId: data.identity.scope.sellerEntityId, kind: event.kind, recordId: event.recordId,
  });
}

function fresh(data: SyncApplyFixture, record: Omit<RecordA, 'sourceAccountId'>) {
  return eventA({ ...record, sourceAccountId: selectedProfile(data.stored.bundle).sourceAccountIds[0]! }, 1, syncApplyInstant);
}

type Page = Awaited<ReturnType<typeof captureApplyEvents>>['page'];
type Member = { receipt: SyncReceipt; disposition: 'new' | 'replay' };

async function assertCommit(data: SyncApplyFixture, before: State, page: Page, receipt: SyncReceipt | null, members: Member[]) {
  const after = await state(data);
  const monetary = Number(receipt !== null);
  const newRecords = members.filter(member => member.disposition === 'new').length;
  const beforeVersion = Number(before.parent_targets[0]!.target_version);
  const version = beforeVersion + monetary;
  const countDeltas: Partial<Record<Table, number>> = {
    parent_financial_records: newRecords, runtime_financial_origins: newRecords,
    runtime_sync_economic_outcomes: newRecords, parent_snapshots: monetary, runtime_sync_receipts: monetary,
    runtime_sync_units: 1, runtime_sync_event_outcomes: page.events.length, activity_events: 1,
    runtime_authority_heads: before.runtime_authority_heads.length === 0 ? 1 : 0,
  };
  const replaced: Table[] = ['parent_targets', 'runtime_sync_application_heads', 'activity_counter'];
  for (const table of tables) {
    if (replaced.includes(table)) continue;
    expect(after[table], table).toHaveLength(before[table].length + (countDeltas[table] ?? 0));
    expect(after[table], table).toEqual(expect.arrayContaining(before[table]));
  }
  const unitRow = after.runtime_sync_units.find(row => row.from_cursor === Number(page.after))!;
  const audit = JSON.parse(String(unitRow.audit)) as SyncUnitAudit;
  expect(unitRow).toMatchObject({
    from_cursor: Number(page.after), through_cursor: Number(page.next), before_version: beforeVersion,
    after_version: version, receipt_id: receipt?.id ?? null, audit_digest: hashCanonical(audit),
  });
  expect(unitRow.audit).toBe(canonicalJson(audit));
  expect(audit).toMatchObject({
    identity: data.identity, fromCursor: page.after, throughCursor: page.next,
    unitHash: unitRow.unit_hash, planHash: receipt?.planHash ?? null,
  });
  const expected = page.events.map((event, index) => {
    const { receipt: original, disposition } = members[index]!;
    const id = recordId(data, event);
    return {
      event: syncEventRef(event), recordId: id, disposition,
      origin: original.id === data.stored.receipt.id
        ? { kind: 'initial', recordId: id, importKey: data.stored.request.idempotencyKey, receipt: original }
        : { kind: 'sync', recordId: id, receipt: original },
    };
  });
  expect(audit.members).toEqual(expected);
  expect(after.runtime_sync_event_outcomes.filter(row => row.unit_hash === audit.unitHash))
    .toEqual(expect.arrayContaining(expected.map(member => {
      const canonical = { identity: data.identity, lane: audit.lane, unitHash: audit.unitHash, ...member };
      return expect.objectContaining({
        source_ref: member.event.sourceRef, event_id: member.event.eventId, sequence: member.event.sequence,
        record_id: member.recordId, disposition: member.disposition, canonical: canonicalJson(canonical),
        digest: hashCanonical(canonical),
      });
    })));
  expect(after.parent_targets).toEqual([expect.objectContaining({ target_version: version, snapshot_hash: audit.afterSnapshotHash })]);
  if (receipt) {
    expect(receipt.eventIds).toEqual(page.events.map(event => event.id));
    expect(receipt.targetRecordIds).toEqual(expected.filter(member => member.disposition === 'new').map(member => member.recordId));
    expect(after.runtime_sync_receipts).toContainEqual(expect.objectContaining({ receipt_id: receipt.id, receipt: canonicalJson(receipt) }));
    for (const member of expected.filter(member => member.disposition === 'new')) {
      expect(after.runtime_financial_origins).toContainEqual(expect.objectContaining({
        record_id: member.recordId, initial_receipt_id: null, sync_receipt_id: receipt.id,
      }));
    }
  } else {
    expect(after.parent_targets).toEqual(before.parent_targets);
  }
  expect(after.runtime_authority_heads).toEqual([expect.objectContaining({ status: 'active', epoch: 1 })]);
  expect(after.runtime_sync_application_heads).toHaveLength(2);
  expect(after.runtime_sync_application_heads).toEqual(expect.arrayContaining([
    expect.objectContaining({ stream_id: applyFinancialStream, applied_through: Number(page.next), last_unit_hash: audit.unitHash }),
    expect.objectContaining({
      stream_id: applySemanticStream, applied_through: Number(applyBaseline(data, applySemanticStream)), last_unit_hash: null,
    }),
  ]));
  const sequence = Number(before.activity_counter[0]!.sequence) + 1;
  expect(after.activity_counter).toEqual([expect.objectContaining({ sequence })]);
  expect(after.activity_events).toContainEqual(expect.objectContaining({
    sequence, event: expect.objectContaining({
      type: receipt ? 'batch.applied' : 'batch.replayed',
      scope: data.identity.scope, payload: expect.objectContaining({ count: page.events.length }),
    }),
  }));
  return after;
}

test('coverage_changed_before_locked_cut', () => fixture(async data => {
  const { p1, a1 } = partialAllocationEvents(data);
  const first = await captureApplyEvents(data, applyBaseline(data), [p1]);
  const api = service(data);
  const prepared = await api.prepare(syncApplyInstant);
  const outside = gate<void>();
  const pending = settle(service(data, data.db, observed(data, outside)).applyBatch(prepared.plan!, 1));
  try {
    await reached(outside.entered, pending, 'semantic observation after W');
    const second = await captureApplyEvents(data, first.page.next, [a1]);
    const afterCapture = await state(data);
    outside.release();
    expect((await pending).error).toMatchObject({ code: 'SYNC_COVERAGE_CHANGED' });
    expect(await state(data)).toEqual(afterCapture);
    const freshUnit = await api.prepare(syncApplyInstant);
    expect(freshUnit.events).toEqual([...first.page.events, ...second.page.events]);
    expect(freshUnit.plan).toMatchObject({ eventIds: [p1.id, a1.id], expectedBalanceCents: 78000 });
    expect(await state(data)).toEqual(afterCapture);
  } finally { outside.release(); await pending; }
}), testTimeout);

test('capture_after_locked_cut', () => fixture(async data => {
  const { p1, a1 } = partialAllocationEvents(data);
  const first = await captureApplyEvents(data, applyBaseline(data), [p1]);
  const prepared = await service(data).prepare(syncApplyInstant);
  const cut = gate<void>();
  const db = instrument(data.db, async (checkout, sql, proceed) => {
    const result = await proceed();
    if (!checkout.readOnly && sql.startsWith('WITH source AS (')) {
      expect(checkout.statements.some(statement => /^SELECT 1 FROM parent_targets .* FOR UPDATE$/.test(statement))).toBe(true);
      await cut.hold(undefined);
    }
    return result;
  });
  const pending = settle(service(data, db).applyBatch(prepared.plan!, 1));
  const profile = selectedProfile(data.stored.bundle);
  try {
    await reached(cut.entered, pending, 'locked W′ query');
    const second = await captureApplyEvents(data, first.page.next, [a1]);
    await data.addSemantic('race-change', profile.sourceAccountIds[0]!, 'race-changed-semantics');
    await data.addSemantic('race-return', profile.sourceAccountIds[0]!, profile.semanticVersion);
    const semantic = await data.source.fetchChanges(first.page.sourceRef, applySemanticStream, applyBaseline(data, applySemanticStream));
    expect(semantic.events).toHaveLength(2);
    expect(await first.capture.capturePage(semantic)).toMatchObject({ disposition: 'captured', captured: 2 });
    const { versions } = await data.source.readCurrentSemantics(first.page.sourceRef);
    expect(versions[data.identity.scope.sellerEntityId + '/' + profile.sourceAccountIds[0]!]).toBe(profile.semanticVersion);
    const afterCapture = await state(data);
    cut.release();
    const applied = (await pending).value!;
    expect(applied).toMatchObject({ replayed: false, receipt: { beforeBalanceCents: 80000, afterBalanceCents: 80000 } });
    const after = await assertCommit(data, afterCapture, first.page, applied.receipt, [{ receipt: applied.receipt, disposition: 'new' }]);
    expect(after.runtime_sync_event_outcomes.map(row => row.event_id)).toEqual([p1.id]);
    for (const event of [...second.page.events, ...semantic.events]) {
      expect(after.runtime_inbox).toContainEqual(expect.objectContaining({ event_id: event.id }));
    }
    await expect(service(data).prepare(syncApplyInstant)).rejects.toMatchObject({ code: 'SYNC_COVERAGE_UNSUPPORTED' });
    expect(await state(data)).toEqual(after);
  } finally { cut.release(); await pending; }
}), testTimeout);

async function assertStatusOnly(data: SyncApplyFixture, before: State, mode: 'revoke' | 'pause-resume') {
  const after = await state(data);
  const expectedTypes = mode === 'revoke' ? ['connection.revoked'] : ['connection.paused', 'system.status'];
  const count = expectedTypes.length;
  const fromSequence = Number(before.activity_counter[0]!.sequence);
  for (const table of tables) {
    if (['runtime_authority_heads', 'runtime_authority_commands', 'activity_events', 'activity_counter'].includes(table)) continue;
    expect(after[table], table).toEqual(before[table]);
  }
  expect(after.runtime_authority_heads).toEqual([expect.objectContaining({
    status: mode === 'revoke' ? 'revoked' : 'active', epoch: 1 + count,
  })]);
  expect(after.runtime_authority_commands.map(row => row.idempotency_key).sort()).toEqual(
    mode === 'revoke' ? ['race-revoke'] : ['race-pause', 'race-resume'],
  );
  expect(after.activity_counter).toEqual([expect.objectContaining({ sequence: fromSequence + count })]);
  expect(after.activity_events).toEqual(expect.arrayContaining(before.activity_events));
  expect(after.activity_events.filter(row => Number(row.sequence) > fromSequence)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence)).map(row => (row.event as Row).type)).toEqual(expectedTypes);
  return after;
}

const statusModes = ['revoke', 'pause-resume'] as const;
async function changeAuthority(command: ReturnType<typeof authority>, mode: typeof statusModes[number]) {
  if (mode === 'revoke') {
    expect((await command('revoke', 1)).result.state).toMatchObject({ epoch: 2, status: 'revoked' });
  } else {
    expect((await command('pause', 1)).result.state).toMatchObject({ epoch: 2, status: 'paused' });
    expect((await command('resume', 2)).result.state).toMatchObject({ epoch: 3, status: 'active' });
  }
}

test.each(statusModes)('revoke_apply_both_winners: %s wins against new monetary apply', mode => fixture(async data => {
  const { p1 } = partialAllocationEvents(data);
  await captureApplyEvents(data, applyBaseline(data), [p1]);
  const unit = await service(data).prepare(syncApplyInstant);
  const before = await state(data);
  const observer = gate<void>();
  const pending = settle(service(data, data.db, observed(data, observer)).applyBatch(unit.plan!, 1));
  try {
    await reached(observer.entered, pending, 'monetary apply preflight');
    await changeAuthority(authority(data), mode);
    const after = await assertStatusOnly(data, before, mode);
    observer.release();
    expect((await pending).error).toMatchObject({ code: mode === 'revoke' ? 'AUTHORITY_INACTIVE' : 'AUTHORITY_STALE' });
    expect(await state(data)).toEqual(after);
  } finally { observer.release(); await pending; }
}), testTimeout);

test.each(statusModes)('revoke_apply_both_winners: %s wins against new all-replay bookkeeping', mode => fixture(async data => {
  const { invoiceEvent } = partialAllocationEvents(data);
  await captureApplyEvents(data, applyBaseline(data), [replay(invoiceEvent, 'authority')]);
  const unit = await service(data).prepare(syncApplyInstant);
  expect(unit.plan).toBeNull();
  const before = await state(data);
  const observer = gate<void>();
  const pending = settle(service(data, data.db, observed(data, observer)).applyReplay(unit, 1));
  try {
    await reached(observer.entered, pending, 'all-replay preflight');
    await changeAuthority(authority(data), mode);
    const after = await assertStatusOnly(data, before, mode);
    observer.release();
    expect((await pending).error).toMatchObject({ code: mode === 'revoke' ? 'AUTHORITY_INACTIVE' : 'AUTHORITY_STALE' });
    expect(await state(data)).toEqual(after);
  } finally { observer.release(); await pending; }
}), testTimeout);

test.each(statusModes)('revoke_apply_both_winners: apply commits before %s', mode => fixture(async data => {
  const { p1, a1 } = partialAllocationEvents(data);
  const first = await captureApplyEvents(data, applyBaseline(data), [p1]);
  const api = service(data);
  const unit = await api.prepare(syncApplyInstant);
  const before = await state(data);
  const applyCommit = gate<number>();
  const statusCommit = gate<void>();
  const statusWait = Promise.withResolvers<number>();
  const writer = instrument(data.db, async ({ pid, readOnly }, sql, proceed) => {
    if (!readOnly && sql === 'COMMIT') await applyCommit.hold(pid);
    return proceed();
  });
  const statusDb = instrument(data.db, async ({ pid, readOnly }, sql, proceed) => {
    if (sql === scopeLock) statusWait.resolve(pid);
    if (!readOnly && sql === 'COMMIT') await statusCommit.hold(undefined);
    return proceed();
  });
  const applying = settle(service(data, writer).applyBatch(unit.plan!, 1));
  let changing: Promise<{ error: unknown }> | undefined;
  try {
    const holder = await reached(applyCommit.entered, applying, 'apply before COMMIT');
    const command = authority(data, statusDb);
    const pending = settle(command(mode === 'revoke' ? 'revoke' : 'pause', 1));
    changing = pending;
    const waiter = await reached(statusWait.promise, pending, 'status waiting for scope lock');
    await blockedBy(data, waiter, holder);
    expect(await state(data)).toEqual(before);
    applyCommit.release();
    await reached(statusCommit.entered, pending, 'status after acquiring the released scope lock');
    const applied = (await applying).value!;
    expect(applied).toMatchObject({ replayed: false, receipt: { epoch: 1, beforeBalanceCents: 80000, afterBalanceCents: 80000 } });
    const afterApply = await assertCommit(data, before, first.page, applied.receipt, [{ receipt: applied.receipt, disposition: 'new' }]);
    statusCommit.release();
    const result = await pending;
    expect(result.value?.result.state).toMatchObject({ epoch: 2, status: mode === 'revoke' ? 'revoked' : 'paused' });
    if (mode === 'pause-resume') {
      expect((await authority(data)('resume', 2)).result.state).toMatchObject({ epoch: 3, status: 'active' });
    }
    await assertStatusOnly(data, afterApply, mode);

    // Supply a distinct valid plan against the new target and require the old epoch to fail.
    const second = await captureApplyEvents(data, first.page.next, [a1]);
    expect(second.page.events).toHaveLength(1);
    const target = await createParentReads(data.db, syncApplyClock, data.scopeReader).readParent(data.identity.scope.accountId, {});
    const plan = planBatch(data.stored.bundle.artifact, selectedProfile(data.stored.bundle), second.page.events, target.records).plans[0]!;
    expect(plan.expectedTargetVersion).toBe(unit.expectedTargetVersion + 1);
    const afterStatusAndCapture = await state(data);
    await expect(api.applyBatch(plan, 1)).rejects.toMatchObject({ code: mode === 'revoke' ? 'AUTHORITY_INACTIVE' : 'AUTHORITY_STALE' });
    await expect(api.applyBatch(unit.plan!, 1)).resolves.toEqual({ replayed: true, receipt: applied.receipt });
    expect(await state(data)).toEqual(afterStatusAndCapture);
  } finally {
    applyCommit.release();
    statusCommit.release();
    await applying;
    await changing;
  }
}), testTimeout);

test('duplicate_writers_and_restart', () => fixture(async data => {
  const { p1, a1 } = partialAllocationEvents(data);
  const first = await captureApplyEvents(data, applyBaseline(data), [p1]);
  const api = service(data);
  const unit = await api.prepare(syncApplyInstant);
  const before = await state(data);
  const firstObserver = gate<void>();
  const secondObserver = gate<void>();
  const commit = gate<number>();
  const secondLock = Promise.withResolvers<number>();
  let confirmedCommits = 0;
  const winnerDb = instrument(data.db, async ({ pid, readOnly }, sql, proceed) => {
    if (readOnly || sql !== 'COMMIT') return proceed();
    await commit.hold(pid);
    await proceed();
    confirmedCommits++;
    throw new Error('Test discarded a confirmed COMMIT response');
  });
  const contenderDb = instrument(data.db, ({ pid }, sql, proceed) => {
    if (sql === scopeLock) secondLock.resolve(pid);
    return proceed();
  });
  const winner = settle(service(data, winnerDb, observed(data, firstObserver)).applyBatch(unit.plan!, 1));
  const contender = settle(service(data, contenderDb, observed(data, secondObserver)).applyBatch(unit.plan!, 1));
  try {
    await reached(firstObserver.entered, winner, 'first preflight');
    await reached(secondObserver.entered, contender, 'second preflight');
    firstObserver.release();
    const holder = await reached(commit.entered, winner, 'winner before COMMIT');
    secondObserver.release();
    const waiter = await reached(secondLock.promise, contender, 'duplicate awaiting scope lock');
    await blockedBy(data, waiter, holder);
    expect(await state(data)).toEqual(before);
    commit.release();
    expect((await winner).error).toMatchObject({ code: 'SYNC_STORAGE_INVALID' });
    expect(confirmedCommits).toBe(1);
    const recovered = (await contender).value!;
    expect(recovered).toMatchObject({ replayed: true, receipt: { beforeBalanceCents: 80000, afterBalanceCents: 80000 } });
    await assertCommit(data, before, first.page, recovered.receipt, [{ receipt: recovered.receipt, disposition: 'new' }]);

    const second = await captureApplyEvents(data, first.page.next, [a1]);
    const beforeSecond = await state(data);
    const next = await api.applyBatch((await api.prepare(syncApplyInstant)).plan!, 1);
    expect(next.receipt).toMatchObject({ beforeBalanceCents: 80000, afterBalanceCents: 78000 });
    const afterSecond = await assertCommit(data, beforeSecond, second.page, next.receipt, [{ receipt: next.receipt, disposition: 'new' }]);
    await changeAuthority(authority(data), 'revoke');
    const afterRevoke = await assertStatusOnly(data, afterSecond, 'revoke');
    const restartedDb = createRuntimeDb({ connectionString: data.pair.runtime.appUrl });
    try {
      let observations = 0;
      const restarted = service(data, restartedDb, async () => { observations++; throw new Error('Source is offline'); });
      await expect(restarted.applyBatch(unit.plan!, 1)).resolves.toEqual(recovered);
      expect(observations).toBe(0);
      expect(await state(data)).toEqual(afterRevoke);
    } finally { await restartedDb.end(); }
  } finally {
    firstObserver.release();
    secondObserver.release();
    commit.release();
    await Promise.all([winner, contender]);
  }
}), testTimeout);

const replayBoundaries = [
  ['runtime_authority_heads', 'INSERT'],
  ['runtime_sync_units', 'INSERT'], ['runtime_sync_event_outcomes', 'INSERT'],
  ['runtime_sync_application_heads', 'INSERT'], ['runtime_sync_application_heads', 'UPDATE'],
  ['activity_counter', 'UPDATE'], ['activity_events', 'INSERT'],
] as const;
const financialBoundaries = [
  ['parent_snapshots', 'INSERT'], ['parent_targets', 'UPDATE'], ['runtime_sync_receipts', 'INSERT'],
  ['parent_financial_records', 'INSERT'], ['runtime_sync_economic_outcomes', 'INSERT'], ['runtime_financial_origins', 'INSERT'],
  ...replayBoundaries,
] as const;

async function sqlFault(
  data: SyncApplyFixture, table: Table, action: 'INSERT' | 'UPDATE',
  code: 'P0001' | '40001' | '40P01', run: () => Promise<void>,
) {
  await withTransaction(data.owner, async client => {
    await client.query(`CREATE FUNCTION test_apply_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test sync apply after ${table} ${action}' USING ERRCODE = '${code}'; END; $$`);
    await client.query(`CREATE TRIGGER test_apply_fault AFTER ${action} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION test_apply_fault()`);
  });
  try { await run(); }
  finally {
    await withTransaction(data.owner, async client => {
      await client.query(`DROP TRIGGER test_apply_fault ON ${table}`);
      await client.query('DROP FUNCTION test_apply_fault()');
    });
  }
}

test.each(['monetary', 'all-replay'] as const)('rollback_every_write_boundary: %s', kind => fixture(async data => {
  const { p1, invoiceEvent } = partialAllocationEvents(data);
  const financial = kind === 'monetary';
  const { page } = await captureApplyEvents(data, applyBaseline(data), [financial ? p1 : replay(invoiceEvent, 'rollback')]);
  const api = service(data);
  const unit = await api.prepare(syncApplyInstant);
  expect(unit.plan === null).toBe(!financial);
  const before = await state(data);
  for (const [table, action] of financial ? financialBoundaries : replayBoundaries) {
    await sqlFault(data, table, action, 'P0001', async () => {
      const operation = financial ? api.applyBatch(unit.plan!, 1) : api.applyReplay(unit, 1);
      await expect(operation, table + ' ' + action).rejects.toMatchObject({ code: 'P0001' });
      expect(await state(data), table + ' ' + action).toEqual(before);
    });
  }
  if (financial) {
    const { receipt } = await api.applyBatch(unit.plan!, 1);
    expect(receipt).toMatchObject({ beforeBalanceCents: 80000, afterBalanceCents: 80000 });
    await assertCommit(data, before, page, receipt, [{ receipt, disposition: 'new' }]);
  } else {
    const result = await api.applyReplay(unit, 1);
    expect(result).toMatchObject({ replayed: false, receipts: [data.stored.receipt] });
    await assertCommit(data, before, page, null, [{ receipt: data.stored.receipt, disposition: 'replay' }]);
  }
}), testTimeout);

function isScopeLock(checkout: Checkout, sql: string) {
  return !checkout.readOnly && sql === scopeLock && checkout.statements.indexOf(scopeLock) === checkout.statements.length - 1;
}

function assertWriteAttempt(checkout: Checkout, finish: 'COMMIT' | 'ROLLBACK') {
  const statements = checkout.statements;
  const boundaries = [
    (sql: string) => sql === 'BEGIN',
    (sql: string) => sql === scopeLock,
    (sql: string) => sql.startsWith('SELECT * FROM runtime_authority_heads') && sql.endsWith('FOR UPDATE'),
    (sql: string) => sql.startsWith('SELECT 1 FROM parent_targets') && sql.endsWith('FOR UPDATE'),
    (sql: string) => sql.startsWith('WITH source AS ('),
    (sql: string) => sql === scopeLock,
    (sql: string) => sql.startsWith(activityWrite),
    (sql: string) => sql === finish,
  ];
  let last = -1;
  for (const predicate of boundaries) {
    const index = statements.findIndex((sql, index) => index > last && predicate(sql));
    expect(index, JSON.stringify(statements)).toBeGreaterThan(last);
    last = index;
  }
}

test('retry_reacquires_authority: genuine serialization failure then intervening revoke', () => fixture(async data => {
  const { p1 } = partialAllocationEvents(data);
  await captureApplyEvents(data, applyBaseline(data), [p1]);
  const unit = await service(data).prepare(syncApplyInstant);
  const before = await state(data);
  const activity = gate<void>();
  const retry = gate<void>();
  const attempts: Checkout[] = [];
  const errors: (string | undefined)[] = [];
  const db = instrument(data.db, async (checkout, sql, proceed) => {
    if (!checkout.readOnly && sql.startsWith('SELECT DISTINCT hashtextextended') &&
        !attempts.includes(checkout)) {
      attempts.push(checkout);
      if (attempts.length === 1) await checkout.client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    }
    if (isScopeLock(checkout, sql) && attempts[1] === checkout) await retry.hold(undefined);
    if (sql.startsWith(activityWrite) && attempts[0] === checkout) {
      await activity.hold(undefined);
      try { return await proceed(); }
      catch (error) { errors.push(sqlState(error)); throw error; }
    }
    return proceed();
  });
  const applying = settle(service(data, db).applyBatch(unit.plan!, 1));
  try {
    await reached(activity.entered, applying, 'first write before activity');
    await data.owner.query('UPDATE activity_counter SET sequence = sequence WHERE singleton');
    expect(await state(data)).toEqual(before);
    activity.release();
    await reached(retry.entered, applying, 'retry before scope acquisition');
    expect(errors).toEqual(['40001']);
    assertWriteAttempt(attempts[0]!, 'ROLLBACK');
    expect(await state(data)).toEqual(before);
    await changeAuthority(authority(data), 'revoke');
    const afterRevoke = await assertStatusOnly(data, before, 'revoke');
    retry.release();
    expect((await applying).error).toMatchObject({ code: 'AUTHORITY_INACTIVE' });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).not.toBe(attempts[1]);
    expect(attempts[1]!.statements).toContain(scopeLock);
    expect(attempts[1]!.statements).toContain('SELECT * FROM runtime_authority_heads WHERE account_id = $1 FOR UPDATE');
    expect(attempts[1]!.statements.at(-1)).toBe('ROLLBACK');
    expect(attempts[1]!.statements.some(sql => sql.startsWith('SELECT 1 FROM parent_targets'))).toBe(false);
    expect(await state(data)).toEqual(afterRevoke);
  } finally { activity.release(); retry.release(); await applying; }
}), testTimeout);

test('retry_reacquires_authority: genuine deadlock rolls back and retries the full write', () => fixture(async data => {
  const { p1 } = partialAllocationEvents(data);
  const { page } = await captureApplyEvents(data, applyBaseline(data), [p1]);
  const unit = await service(data).prepare(syncApplyInstant);
  const before = await state(data);
  const attempts: Checkout[] = [];
  const errors: (string | undefined)[] = [];
  const owner = new Pool({ connectionString: data.pair.runtime.migrationUrl, query_timeout: gateTimeout + 1000 });
  const app = new Pool({ connectionString: data.pair.runtime.appUrl, query_timeout: gateTimeout + 1000 });
  const blocker = await owner.connect();
  const privateLock = 'SELECT pg_advisory_xact_lock(214100, 42104)';
  const appWait = Promise.withResolvers<number>();
  const db = instrument(app, async (checkout, sql, proceed) => {
    if (isScopeLock(checkout, sql)) attempts.push(checkout);
    if (sql.startsWith(activityWrite) && attempts[0] === checkout) {
      appWait.resolve(checkout.pid);
      try { await checkout.client.query(privateLock); }
      catch (error) { errors.push(sqlState(error)); throw error; }
    }
    return proceed();
  });
  let applying: Promise<{ error: unknown }> | undefined;
  let cycling: Promise<{ error: unknown }> | undefined;
  try {
    const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    await blocker.query('BEGIN');
    await blocker.query(privateLock);
    const pending = settle(service(data, db).applyBatch(unit.plan!, 1));
    applying = pending;
    const waiter = await reached(appWait.promise, pending, 'apply before test-only lock');
    await blockedBy(data, waiter, pid);
    // Apply begins waiting first, so its deadlock detector can see the cycle before the helper's.
    const helper = settle(lockParentKeys(blocker, [canonicalJson(['parent-scope', data.identity.scope.accountId])]));
    cycling = helper;
    await blockedBy(data, pid, waiter);
    expect((await helper).error).toBeUndefined();
    expect(errors).toEqual(['40P01']);
    expect(await state(data)).toEqual(before);
    await blocker.query('COMMIT');
    const result = (await pending).value!;
    expect(result).toMatchObject({ replayed: false, receipt: { beforeBalanceCents: 80000, afterBalanceCents: 80000 } });
    expect(attempts).toHaveLength(2);
    assertWriteAttempt(attempts[0]!, 'ROLLBACK');
    assertWriteAttempt(attempts[1]!, 'COMMIT');
    await assertCommit(data, before, page, result.receipt, [{ receipt: result.receipt, disposition: 'new' }]);
  } finally {
    await blocker.query('ROLLBACK').catch(() => undefined);
    blocker.release();
    await cycling;
    await applying;
    await Promise.all([owner.end(), app.end()]);
  }
}), testTimeout);

test('retry_reacquires_authority: exactly three retryable callbacks and one nonretryable callback', () => fixture(async data => {
  const { p1 } = partialAllocationEvents(data);
  await captureApplyEvents(data, applyBaseline(data), [p1]);
  const unit = await service(data).prepare(syncApplyInstant);
  const before = await state(data);
  for (const [code, count] of [['40001', 3], ['40P01', 3], ['P0001', 1]] as const) {
    const attempts: Checkout[] = [];
    const db = instrument(data.db, (checkout, sql, proceed) => {
      if (isScopeLock(checkout, sql)) attempts.push(checkout);
      return proceed();
    });
    await sqlFault(data, 'activity_events', 'INSERT', code, async () => {
      await expect(service(data, db).applyBatch(unit.plan!, 1)).rejects.toMatchObject({ code });
      expect(attempts).toHaveLength(count);
      expect(new Set(attempts).size).toBe(count);
      for (const attempt of attempts) assertWriteAttempt(attempt, 'ROLLBACK');
      expect(await state(data)).toEqual(before);
    });
  }
}), testTimeout);

test('global_identity_collision: a foreign scope cannot be rebound by apply', () => fixture(async data => {
  const { p1 } = partialAllocationEvents(data);
  await captureApplyEvents(data, applyBaseline(data), [p1]);
  const unit = await service(data).prepare(syncApplyInstant);
  const other = { ...data.identity.scope, accountId: 'race-foreign-account' };
  const id = recordId(data, p1);
  const record = unit.plan!.operations[0]!.record;
  await withTransaction(data.owner, async client => {
    const values = scopeValues(other);
    await client.query('INSERT INTO parent_scopes (account_id, company_id, seller_entity_id) VALUES ($1,$2,$3)', values);
    await client.query(`
      INSERT INTO parent_financial_records (account_id,company_id,seller_entity_id,record_id,source_ref,kind,
        source_record_id,source_record_version,event_id,canonical,digest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [...values, id, p1.sourceRef, p1.kind, p1.recordId, p1.recordVersion, p1.id, ...encodeCanonical({ ...record, scope: other })]);
  });
  const before = await state(data);
  expect(before.parent_financial_records).toContainEqual(expect.objectContaining({ record_id: id, account_id: other.accountId }));
  await expect(service(data).applyBatch(unit.plan!, 1)).rejects.toMatchObject({ code: 'SYNC_STORAGE_INVALID' });
  expect(await state(data)).toEqual(before);
}), testTimeout);

test('global_identity_collision: competing initial and sync SQL origin claims serialize on one key', () => fixture(async data => {
  const { p1 } = partialAllocationEvents(data);
  const { page } = await captureApplyEvents(data, applyBaseline(data), [p1]);
  const api = service(data);
  const beforeApply = await state(data);
  const { receipt } = await api.applyBatch((await api.prepare(syncApplyInstant)).plan!, 1);
  const afterApply = await assertCommit(data, beforeApply, page, receipt, [{ receipt, disposition: 'new' }]);
  const id = recordId(data, p1);
  const eventOutcome = afterApply.runtime_sync_event_outcomes.find(row => row.record_id === id)!;
  expect(eventOutcome).toBeDefined();
  const values = scopeValues(data.identity.scope);
  await withTransaction(data.owner, async client => {
    // Free the exact key in FK order, retaining the genuine unit and receipt.
    for (const table of ['runtime_sync_event_outcomes', 'runtime_financial_origins', 'runtime_sync_economic_outcomes']) {
      await client.query('ALTER TABLE ' + table + ' DISABLE TRIGGER USER');
      await client.query('DELETE FROM ' + table + ' WHERE record_id = $1', [id]);
      await client.query('ALTER TABLE ' + table + ' ENABLE TRIGGER USER');
    }
  });
  const held = gate<number>();
  const waiting = Promise.withResolvers<number>();
  let winner: Promise<{ error: unknown }> | undefined;
  let loser: Promise<{ error: unknown }> | undefined;
  try {
    const beforeClaim = await state(data);
    const winning = settle(withTransaction(data.db, async client => {
      const { rows: [row] } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await client.query('INSERT INTO runtime_sync_economic_outcomes VALUES ($1,$2,$3,$4,$5)', [...values, id, receipt.id]);
      await held.hold(row!.pid);
    }));
    winner = winning;
    const holder = await reached(held.entered, winning, 'sync origin claim');
    const losing = settle(withTransaction(data.db, async client => {
      const { rows: [row] } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      waiting.resolve(row!.pid);
      await client.query('INSERT INTO runtime_economic_outcomes VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        ...values, p1.sourceRef, p1.kind, p1.recordId, id, data.stored.request.idempotencyKey, data.stored.receipt.id,
      ]);
      throw new Error('Competing initial claim unexpectedly inserted');
    }));
    loser = losing;
    const waiter = await reached(waiting.promise, losing, 'competing initial claim');
    await blockedBy(data, waiter, holder);
    expect(await state(data)).toEqual(beforeClaim);
    held.release();
    expect((await winning).error).toBeUndefined();
    expect((await losing).error).toMatchObject({ code: '23505', constraint: 'runtime_financial_origins_pkey' });
    expect(await state(data)).toEqual({ ...afterApply, runtime_sync_event_outcomes: beforeClaim.runtime_sync_event_outcomes });
  } finally {
    held.release();
    await Promise.all([winner, loser]);
    await withTransaction(data.db, async client => {
      await client.query(
        'INSERT INTO runtime_sync_economic_outcomes VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [...values, id, receipt.id],
      );
      await client.query(`
        INSERT INTO runtime_sync_event_outcomes
        SELECT * FROM jsonb_populate_record(NULL::runtime_sync_event_outcomes, $1::jsonb)
      `, [JSON.stringify(eventOutcome)]);
    });
  }
  expect(await state(data)).toEqual(afterApply);
}), testTimeout);

test('financial_and_snapshot_regression: unallocated funds, effective reversals and backdated history', () => fixture(async data => {
  const { p1, a1 } = partialAllocationEvents(data);
  const initial = data.stored.approvedTarget.records;
  const credit = initial.credits.find(record => record.identity.recordId.endsWith('-2026-09-01'))!;
  expect(credit.amountCents).toBe(20000);
  const paymentReversal = fresh(data, {
    kind: 'reversal', recordId: 'race-reverse-payment', effectiveDate: '2026-10-08',
    fields: { reversed_kind: 'payment', reversed_id: p1.recordId },
  });
  const creditReversal = fresh(data, {
    kind: 'reversal', recordId: 'race-reverse-credit', effectiveDate: '2026-10-09',
    fields: { reversed_kind: 'credit', reversed_id: credit.identity.recordId },
  });
  const backdated = fresh(data, {
    kind: 'invoice', recordId: 'race-backdated-invoice', effectiveDate: '2026-09-03',
    fields: { amount: '12.00', due_date: '2026-10-03' },
  });
  const reads = createParentReads(data.db, syncApplyClock, data.scopeReader);
  const read = (asOf: string, snapshotHash?: string) => reads.readParent(data.identity.scope.accountId, { asOf, snapshotHash });
  const historicalAsOf = '2026-09-10T00:00:00.000Z';
  const original = await read(historicalAsOf, data.stored.approvedTarget.snapshotHash);
  expect(original.balanceCents).toBe(80000);
  const api = service(data);
  let afterCursor = applyBaseline(data);
  async function apply(event: RawSourceEvent, beforeCents: number, afterCents: number) {
    const { page } = await captureApplyEvents(data, afterCursor, [event]);
    const before = await state(data);
    const { receipt } = await api.applyBatch((await api.prepare(syncApplyInstant)).plan!, 1);
    expect(receipt).toMatchObject({ beforeBalanceCents: beforeCents, afterBalanceCents: afterCents });
    await assertCommit(data, before, page, receipt, [{ receipt, disposition: 'new' }]);
    afterCursor = page.next;
  }
  await apply(p1, 80000, 80000);
  await apply(a1, 80000, 78000);
  const allocated = await read(syncApplyInstant);
  expect(allocated.balanceCents).toBe(78000);
  await apply(paymentReversal, 78000, 80000);
  expect((await read('2026-10-07T23:59:59.999Z')).balanceCents).toBe(78000);
  expect((await read('2026-10-08T00:00:00.000Z')).balanceCents).toBe(80000);
  await apply(creditReversal, 80000, 100000);
  const reversed = await read(syncApplyInstant);
  expect(reversed.records.reversals).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: recordId(data, paymentReversal), reversedKind: 'payment', reversedRecordId: p1.recordId, effectiveAt: paymentReversal.effectiveAt }),
    expect.objectContaining({ id: recordId(data, creditReversal), reversedKind: 'credit', reversedRecordId: credit.identity.recordId, effectiveAt: creditReversal.effectiveAt }),
  ]));
  expect(reversed.records.reversals).toHaveLength(2);
  expect((await read('2026-10-08T23:59:59.999Z')).balanceCents).toBe(80000);
  expect((await read('2026-10-09T00:00:00.000Z')).balanceCents).toBe(100000);
  expect((await read(historicalAsOf)).balanceCents).toBe(80000);
  await apply(backdated, 100000, 101200);
  expect((await read(historicalAsOf)).balanceCents).toBe(81200);
  expect(await read(historicalAsOf, original.snapshotHash)).toEqual(original);
  expect(await read(syncApplyInstant, allocated.snapshotHash)).toEqual(allocated);
  expect(await read(syncApplyInstant, reversed.snapshotHash)).toEqual(reversed);
}), testTimeout);

test('financial_and_snapshot_regression: genuine A5 at maximum version rejects an unsafe writer increment', () => fixture(async data => {
  const max = Number.MAX_SAFE_INTEGER;
  expect(data.stored.recordedTarget.version).toBe(max - 1);
  expect(data.stored.approvedTarget.records.version).toBe(max);
  const { p1 } = partialAllocationEvents(data);
  await captureApplyEvents(data, applyBaseline(data), [p1]);
  const api = service(data);
  const unit = await api.prepare(syncApplyInstant);
  expect(unit.plan).toMatchObject({ expectedTargetVersion: max, expectedBalanceCents: 80000 });
  const before = await state(data);
  await expect(api.applyBatch(unit.plan!, 1)).rejects.toMatchObject({ code: 'SYNC_INVALID_PLAN' });
  expect(await state(data)).toEqual(before);
}, Number.MAX_SAFE_INTEGER - 1), testTimeout);

test('financial_and_snapshot_regression: unsafe capture next and sequence leave all state unchanged', () => fixture(async data => {
  const { p1 } = partialAllocationEvents(data);
  const { capture, page } = await captureApplyEvents(data, applyBaseline(data), [p1]);
  const before = await state(data);
  const invalidNext = '9007199254740992';
  const invalidSequence = Number(invalidNext);
  expect(Number.isSafeInteger(invalidSequence)).toBe(false);
  const nextEvent = applyEvent(p1, { id: 'evt:race-unsafe-cursor', sequence: Number(page.next) + 1 });
  const invalidPages = [
    { ...page, after: page.next, next: invalidNext, events: [nextEvent] },
    { ...page, after: page.next, next: String(nextEvent.sequence), events: [{ ...nextEvent, sequence: invalidSequence }] },
  ];
  for (const input of invalidPages) {
    await expect(capture.capturePage(input)).rejects.toMatchObject({ code: 'CAPTURE_INPUT_INVALID' });
    expect(await state(data)).toEqual(before);
  }
}), testTimeout);

test('pr44_receipt_compatibility', () => fixture(async data => {
  const { p1, a1, invoiceEvent } = partialAllocationEvents(data);
  await createRuntimeCapture({ db: data.db, clock: syncApplyClock }).openCommitted(data.identity);
  const reads = createConnectionReads(data.db, data.scopeReader);
  const read = async () => {
    const before = await state(data);
    const view = await reads.readConnection(data.identity.scope.accountId);
    expect(view.counts).toMatchObject({ pendingEvents: null, quarantinedEvents: null });
    expect(view.streams.map(stream => [stream.streamId, stream.lagEvents])).toEqual([
      [applyFinancialStream, null], [applySemanticStream, null],
    ]);
    expect(view.runtimeModelCalls).toBeNull();
    expect(await state(data)).toEqual(before);
    return view;
  };
  const { receipt: initial, approvedTarget } = data.stored;
  const version = approvedTarget.records.version;
  const initialSummary = {
    id: initial.id, kind: 'initial', activationId: data.identity.activationId, epoch: 1, planHash: initial.planHash,
    beforeVersion: null, afterVersion: version, eventCount: initial.eventIds.length, recordCount: initial.targetRecordIds.length,
    beforeBalanceCents: 0, afterBalanceCents: 80000, committedAt: initial.committedAt,
  };
  const before = await read();
  expect(before.receipts).toEqual([initialSummary]);
  expect(before).toMatchObject({ parentVersion: version, lastReceiptId: initial.id, counts: { appliedBatches: 0 } });

  const first = await captureApplyEvents(data, applyBaseline(data), [p1, a1]);
  const beforeApply = await state(data);
  const api = service(data);
  const { receipt } = await api.applyBatch((await api.prepare(syncApplyInstant)).plan!, 1);
  await assertCommit(data, beforeApply, first.page, receipt, [{ receipt, disposition: 'new' }, { receipt, disposition: 'new' }]);
  const syncSummary = {
    id: receipt.id, kind: 'sync', activationId: data.identity.activationId, epoch: 1, planHash: receipt.planHash,
    beforeVersion: version, afterVersion: version + 1, eventCount: 2, recordCount: 2,
    beforeBalanceCents: 80000, afterBalanceCents: 78000, committedAt: receipt.committedAt,
  };
  const applied = await read();
  expect(applied.receipts).toEqual([syncSummary, initialSummary]);
  expect(applied).toMatchObject({ parentVersion: version + 1, lastReceiptId: receipt.id, counts: { appliedBatches: 1 } });

  const second = await captureApplyEvents(data, first.page.next, [replay(invoiceEvent, 'consumer'), replay(p1, 'consumer-p1')]);
  const beforeReplay = await state(data);
  const replayed = await api.applyReplay(await api.prepare(syncApplyInstant), 1);
  const originals = [initial, receipt].sort((a, b) => a.id < b.id ? -1 : 1);
  expect(replayed).toMatchObject({ replayed: false, receipts: originals });
  const afterReplay = await assertCommit(data, beforeReplay, second.page, null, [
    { receipt: initial, disposition: 'replay' }, { receipt, disposition: 'replay' },
  ]);
  expect(afterReplay.runtime_sync_units).toHaveLength(2);
  expect(afterReplay.runtime_sync_receipts).toHaveLength(1);
  const view = await read();
  expect(view.receipts).toEqual(applied.receipts);
  expect(view.counts).toEqual(applied.counts);
  expect(view).toMatchObject({ parentVersion: version + 1, lastReceiptId: receipt.id });
}), testTimeout);
