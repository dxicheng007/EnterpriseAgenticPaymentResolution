import { Pool } from 'pg';
import { beforeAll, expect, test } from 'vitest';
import { InvalidCursorError } from '../../packages/contracts/src/index.js';
import * as activity from '../../packages/storage/src/activity.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { withTransaction } from '../../packages/storage/src/transaction.js';
import { migrate } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

beforeAll(startNativeDb);
const { publishActivity, readActivity, readControlActivityPage, readControlActivityWindow } = activity;
const event = (runId: string) => ({
  stream: 'control' as const, phase: 'build' as const, type: 'system.status',
  at: '2026-11-08T00:00:00.000Z', runId, payload: { status: 'ready' },
});

async function withControlDb(label: string, run: (db: Pool, owner: Pool) => Promise<void>) {
  const namespace = testNamespace(label);
  const pair = await provisionTest(namespace);
  const db = createControlDb({ connectionString: pair.control.appUrl });
  const owner = new Pool({ connectionString: pair.control.migrationUrl });
  try {
    await migrate(pair, ['control']);
    await run(db, owner);
  } finally {
    await Promise.all([db.end(), owner.end()]);
    await dropTest(namespace);
  }
}

async function storedState(db: Pool) {
  const { rows } = await db.query(`
    SELECT
      (SELECT jsonb_agg(c) FROM activity_counter c) AS counter,
      (SELECT jsonb_agg(e ORDER BY e.sequence) FROM activity_events e) AS events,
      (SELECT jsonb_agg(t ORDER BY t.table_name) FROM information_schema.tables t
        WHERE t.table_schema = 'public') AS tables,
      (SELECT jsonb_agg(m ORDER BY m.version) FROM migration_ledger m) AS migrations,
      (SELECT jsonb_agg(s ORDER BY s.version) FROM seed_ledger s) AS seeds
  `);
  return rows;
}

test('projects a bounded run page while preserving global progress and stored state', async () => {
  await withControlDb('v4page', async (db, owner) => {
    const page = (after: number, runId = 'A') => readControlActivityPage(db, { after, limit: 1, runId });
    expect(await readControlActivityWindow(db)).toEqual({ highWater: 0, retainedAfter: 0 });
    expect(await page(0)).toEqual({ highWater: 0, retainedAfter: 0, nextAfter: 0, hasMore: false, events: [] });

    const published = await withTransaction(db, async client => {
      const rows = [];
      for (const runId of ['A', 'B', 'A', 'A']) rows.push(await publishActivity(client, event(runId)));
      return rows;
    });
    const before = await storedState(owner);
    const window = { highWater: 4, retainedAfter: 0 };
    expect(await readControlActivityWindow(db)).toEqual(window);
    expect(await page(0)).toEqual({ ...window, events: [published[0]], nextAfter: 1, hasMore: true });
    expect(await page(1)).toEqual({ ...window, events: [published[2]], nextAfter: 3, hasMore: true });
    expect(await page(3)).toEqual({ ...window, events: [published[3]], nextAfter: 4, hasMore: false });
    expect(await page(0, 'B')).toEqual({ ...window, events: [published[1]], nextAfter: 4, hasMore: false });
    expect(await page(0, 'a')).toEqual({ ...window, events: [], nextAfter: 4, hasMore: false });
    expect(await page(4)).toEqual({ ...window, events: [], nextAfter: 4, hasMore: false });
    expect(await readActivity(db, 1, 2)).toEqual(published.slice(1, 3));

    for (const after of [5, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      await expect(page(after)).rejects.toBeInstanceOf(InvalidCursorError);
    }
    for (const input of [
      { after: 0, limit: 0, runId: 'A' }, { after: 0, limit: 1001, runId: 'A' },
      { after: 0, limit: 1.5, runId: 'A' }, { after: 0, limit: 1, runId: "A' OR true" },
      { after: 0, limit: 1, runId: 'A', extra: true },
    ]) {
      await expect(readControlActivityPage(db, input)).rejects.toMatchObject({ name: 'ZodError' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await expect(client.query('SELECT 1 / 0')).rejects.toMatchObject({ code: '22012' });
      await expect(readControlActivityPage(client, { after: 0, limit: 1, runId: 'A' })).rejects.toBeInstanceOf(Error);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await storedState(owner)).toEqual(before);
  });
});

test('keeps the 101st event for the next page and fails closed on a malformed lookahead', async () => {
  await withControlDb('v4lookahead', async (db, owner) => {
    const published = await withTransaction(db, async client => {
      const rows = [];
      for (let index = 0; index < 101; index++) rows.push(await publishActivity(client, event('A')));
      return rows;
    });
    const page = (after: number) => readControlActivityPage(db, { after, limit: 100, runId: 'A' });
    const window = { highWater: 101, retainedAfter: 0 };
    expect(await page(0)).toEqual({ ...window, events: published.slice(0, 100), nextAfter: 100, hasMore: true });
    expect(await page(100)).toEqual({ ...window, events: published.slice(100), nextAfter: 101, hasMore: false });

    await owner.query("UPDATE activity_events SET event = event - 'at' WHERE sequence = 101");
    const corrupted = await storedState(owner);
    await expect(page(0)).rejects.toBeInstanceOf(Error);
    await expect(page(100)).rejects.toBeInstanceOf(Error);
    expect(await storedState(owner)).toEqual(corrupted);
  });
});

test('reads committed activity and preserves a pinned counter and page snapshot', async () => {
  await withControlDb('v4snapshot', async db => {
    const writer = await db.connect();
    const reader = await db.connect();
    const pageInput = { after: 0, limit: 5, runId: 'A' };
    const empty = { highWater: 0, retainedAfter: 0, events: [], nextAfter: 0, hasMore: false };
    try {
      await writer.query('BEGIN');
      expect((await publishActivity(writer, event('A'))).sequence).toBe(1);
      expect(await readControlActivityWindow(db)).toEqual({ highWater: 0, retainedAfter: 0 });
      expect(await readControlActivityPage(db, pageInput)).toEqual(empty);
      await writer.query('ROLLBACK');
      expect(await readControlActivityPage(db, pageInput)).toEqual(empty);

      await writer.query('BEGIN');
      const committed = await publishActivity(writer, event('A'));
      expect(await readControlActivityPage(db, pageInput)).toEqual(empty);
      await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      expect(await readControlActivityWindow(reader)).toEqual({ highWater: 0, retainedAfter: 0 });
      await writer.query('COMMIT');
      expect(await readControlActivityPage(reader, pageInput)).toEqual(empty);
      expect(await readControlActivityPage(db, pageInput)).toEqual({
        highWater: 1, retainedAfter: 0, events: [committed], nextAfter: 1, hasMore: false,
      });
    } finally {
      await Promise.all([writer.query('ROLLBACK'), reader.query('ROLLBACK')]);
      writer.release();
      reader.release();
    }
  });
});

test('publishes only the approved discovery summary fields and event types', async () => {
  await withControlDb('v4summary', async db => {
    const approved = {
      status: 'ready', proposalId: 'proposal-1', dispatchId: 'dispatch-1', toolStepId: 'step-1',
      proposalRevision: 1, findingRevision: 2, taskRevision: 3, inputTokens: 11, outputTokens: 12,
      modelCalls: 2, unknownUsageCalls: 1, repairRound: 0, toolRounds: 3, mode: 'scripted',
    };
    const raw = {
      credentials: 'secret', providerResponse: 'response', sourceDocument: 'document',
      path: 'path', hiddenAnswer: 'answer', prompt: 'prompt', transcript: 'transcript',
    };
    const types = [
      'discovery.started', 'discovery.paused', 'discovery.resumed',
      'discovery.blocked', 'discovery.completed', 'discovery.interrupted', 'system.status',
    ];
    await withTransaction(db, async client => {
      for (const type of types) {
        const published = await publishActivity(client, { ...event('A'), type, payload: { ...approved, ...raw } });
        expect(published.payload).toEqual(approved);
      }
      const invalid = await publishActivity(client, {
        ...event('A'), type: 'discovery.completed',
        payload: { proposalId: 'invalid id', taskRevision: 0, modelCalls: -1, mode: 'live', outputTokens: 1.5 },
      });
      expect(invalid.payload).toEqual({ mode: 'live' });
    });
    const page = await readControlActivityPage(db, { after: 0, limit: 10, runId: 'A' });
    expect(page.events.slice(0, -1).map(row => [row.type, row.payload])).toEqual(types.map(type => [type, approved]));
  });
});
