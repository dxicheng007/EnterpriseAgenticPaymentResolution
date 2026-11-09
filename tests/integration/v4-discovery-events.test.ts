import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { beforeAll, expect, test } from 'vitest';
import { decodeDiscoveryCursor, encodeDiscoveryCursor } from '@eapr/contracts';
import { mountDiscoveryEvents } from '../../apps/control/src/routes/events.js';
import { discoveryError } from '../../packages/discovery/src/repository.js';
import { publishActivity, readControlActivityPage, readControlActivityWindow } from '../../packages/storage/src/activity.js';
import { withTransaction } from '../../packages/storage/src/transaction.js';
import { migrate } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';
import Fastify from 'fastify';
import { composeDiscovery } from '../../apps/control/src/discovery-composition.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';

test('the composed discovery cursor requires a reviewer session before accessing storage', async () => {
  const app = Fastify();
  const db = createControlDb({ connectionString: 'postgres://unused:unused@127.0.0.1:55438/unused' });
  const reviewer = { reviewerId: 'reviewer', allowedSourceRefs: [], allowedAccountIds: [] };
  const session = createLocalSessionService({ webOrigin: 'http://127.0.0.1:5179', ...reviewer });
  try {
    await app.register(composeDiscovery({
      catalog: new Map(), store: { get: async () => { throw Error('unexpected evidence read'); } },
      reviewer, authorizeReviewer: session.authorizeReviewer,
    }), { db, clock: () => new Date() });
    const response = await app.inject('/api/discovery/runs/A/events/cursor');
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ code: 'LOCAL_SESSION_REQUIRED' });
  } finally {
    await app.close();
    await db.end();
  }
});

beforeAll(startNativeDb);

const origin = 'http://127.0.0.1:5179';
const route = '/api/discovery/runs/A/events';
const cursor = (controlCursor: number, runId = 'A') => encodeDiscoveryCursor({ v: 1, runId, controlCursor });
const resync = 'event: resync_required\ndata: {"code":"RESYNC_REQUIRED"}\n\n';

async function withDb(label: string, run: (db: Pool) => Promise<void>) {
  const namespace = testNamespace(label);
  const pair = await provisionTest(namespace);
  const db = createControlDb({ connectionString: pair.control.appUrl });
  try {
    await migrate(pair, ['control']);
    await run(db);
  } finally {
    await db.end();
    await dropTest(namespace);
  }
}

async function publish(db: Pool, runs: string[]) {
  await withTransaction(db, async client => {
    for (const runId of runs) {
      await publishActivity(client, {
        stream: 'control', runId, phase: 'build', type: 'system.status',
        at: '2026-11-08T00:00:00.000Z', payload: { status: 'ready', hidden: 'private' },
      });
    }
  });
}

type Overrides = Partial<Parameters<typeof mountDiscoveryEvents>[0]>;

async function openApp(db: Pool, overrides: Overrides = {}) {
  const app = Fastify();
  const session = createLocalSessionService({
    webOrigin: origin, reviewerId: 'reviewer', allowedSourceRefs: ['source-A'], allowedAccountIds: [],
  });
  await app.register(session.plugin);
  await app.register(mountDiscoveryEvents({
    db,
    async authorizeReviewer(request, access) {
      const caller = await session.authorizeReviewer(request, access);
      return { reviewerId: caller.reviewer.reviewerId, allowedSourceRefs: caller.allowedSourceRefs };
    },
    async readState(reviewer, runId) {
      if (!reviewer.allowedSourceRefs.includes('source-' + runId)) throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
    },
    ...overrides,
  }));
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const bootstrap = await app.inject({
    method: 'POST', url: '/api/local-session',
    headers: { origin, 'x-eapr-local-ui': '1', 'content-type': 'application/json' }, payload: {},
  });
  const cookie = String(bootstrap.headers['set-cookie']).split(';')[0]!;
  return {
    app, cookie,
    get: (path: string, headers: Record<string, string> = {}) =>
      fetch(address + path, { headers: { cookie, ...headers }, signal: AbortSignal.timeout(3000) }),
  };
}

function controlledTiming() {
  const retirement = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  let time = 0;
  return {
    retirement, waiting,
    now: () => time,
    async delay(ms: number, signal: AbortSignal) {
      if (ms === 60000) {
        const abort = Promise.withResolvers<void>();
        const stop = () => abort.resolve();
        signal.addEventListener('abort', stop, { once: true });
        try { await Promise.race([retirement.promise, abort.promise]); }
        finally { signal.removeEventListener('abort', stop); }
        return;
      }
      time += ms;
      waiting.resolve();
      await delay(10000, undefined, { signal });
    },
  };
}

function sequences(body: string, highWater: number) {
  return [...body.matchAll(/^id: (.+)$/gm)].map(([, wire]) =>
    decodeDiscoveryCursor(wire!, { runId: 'A', highWater, retainedAfter: 0 }).controlCursor);
}

test('validates the authenticated cursor window before writing headers and rejects old sessions after restart', async () => {
  await withDb('v4evcursor', async db => {
    await publish(db, ['A', 'B']);
    const first = await openApp(db, {
      async readWindow(pool) { return { ...await readControlActivityWindow(pool), retainedAfter: 1 }; },
    });
    try {
      expect(await (await first.get(route + '/cursor')).json()).toEqual({ cursor: cursor(2) });
      for (const [path, status, code] of [
        ['/api/discovery/runs/B/events?after=bad', 403, 'DISCOVERY_FORBIDDEN'],
        [route + '?after=bad', 400, 'CURSOR_INVALID'],
        [route + '?after=' + cursor(1, 'B'), 400, 'CURSOR_INVALID'],
        [route + '?after=' + cursor(3), 400, 'CURSOR_INVALID'],
        [route + '?after=' + cursor(1) + '&after=' + cursor(2), 400, 'CURSOR_INVALID'],
        [route + '?token=secret', 400, 'DISCOVERY_INVALID'],
        [route, 409, 'RESYNC_REQUIRED'],
        [route + '?after=' + cursor(0), 409, 'RESYNC_REQUIRED'],
      ] as const) {
        const response = await first.get(path);
        expect(response.status, path).toBe(status);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const error = await response.json();
        expect(error).toMatchObject({ code, correlationId: expect.any(String) });
        expect(JSON.stringify(error)).not.toContain('secret');
      }
      const atFloor = await first.get(route + '?after=' + cursor(1));
      expect(atFloor.status).toBe(200);
      await atFloor.body!.cancel();
    } finally {
      await first.app.close();
    }

    const restarted = await openApp(db, {
      async readWindow() { throw Error('private database details'); },
    });
    try {
      const stale = await restarted.get(route + '/cursor', { cookie: first.cookie });
      expect(stale.status).toBe(401);
      const broken = await restarted.get(route);
      expect(broken.status).toBe(503);
      expect(await broken.json()).toMatchObject({
        code: 'DISCOVERY_UNAVAILABLE', message: 'The discovery service is unavailable.', diagnostics: [],
      });
    } finally {
      await restarted.app.close();
    }
  });
});

test.each([1, 100])('replays bounded pages of size %s with per-event cursors and explicit query precedence', async limit => {
  await withDb('v4eventpage', async db => {
    const runs = ['A', 'B', 'A', 'A', ...Array.from({ length: limit === 1 ? 0 : 100 }, () => 'A')];
    await publish(db, runs);
    const timing = controlledTiming();
    const afters: number[] = [];
    const server = await openApp(db, {
      timing,
      async readPage(pool, input) {
        expect(input.limit).toBe(100);
        afters.push(input.after);
        return readControlActivityPage(pool, { ...input, limit });
      },
    });
    try {
      const response = await server.get(route + '?after=' + cursor(0), { 'last-event-id': cursor(runs.length) });
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-store');
      await timing.waiting.promise;
      timing.retirement.resolve();
      const body = await response.text();
      expect(sequences(body, runs.length)).toEqual(runs.flatMap((run, index) => run === 'A' ? [index + 1] : []));
      expect(body).not.toContain('private');
      expect(body).not.toContain('resync_required');
      expect(afters).toEqual(limit === 1 ? [0, 1, 3] : [0, 101]);
    } finally {
      await server.app.close();
    }
  });
});

test('a storage failure after headers uses the redacted resync frame', async () => {
  await withDb('v4eventerror', async db => {
    const server = await openApp(db, { async readPage() { throw Error('private storage details'); } });
    try {
      const response = await server.get(route);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(resync);
    } finally {
      await server.app.close();
    }
  });
});

test.each(['revoke', 'shutdown', 'disconnect'] as const)('%s during backpressure discards the unsent page suffix', async action => {
  await withDb('v4eventdrain', async db => {
    await publish(db, ['A', 'A']);
    const hold = Promise.withResolvers<void>();
    const draining = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    let allowed = true;
    let pageReads = 0;
    const server = await openApp(db, {
      async readState() { if (!allowed) throw discoveryError(403, 'DISCOVERY_FORBIDDEN'); },
      async readPage(pool, input) { pageReads++; return readControlActivityPage(pool, input); },
      transport: {
        write(response, frame) { response.write(frame); return false; },
        async drain(_response, signal) {
          const abort = () => cancelled.resolve();
          signal.addEventListener('abort', abort, { once: true });
          draining.resolve();
          try { await Promise.race([hold.promise, cancelled.promise]); }
          finally { signal.removeEventListener('abort', abort); }
        },
      },
    });
    try {
      const response = await server.get(route);
      await draining.promise;
      if (action === 'revoke') {
        allowed = false;
        hold.resolve();
        const body = await response.text();
        expect(sequences(body, 2)).toEqual([1]);
        expect(body.endsWith(resync)).toBe(true);
      } else if (action === 'shutdown') {
        await server.app.close();
        await cancelled.promise;
        expect(sequences(await response.text(), 2)).toEqual([1]);
      } else {
        await response.body!.cancel();
        await cancelled.promise;
      }
      expect(pageReads).toBe(1);
    } finally {
      await server.app.close();
    }
  });
});

test('an empty projection advances the internal scan and a later snapshot exposes new activity', async () => {
  await withDb('v4evsnapshot', async db => {
    await publish(db, ['B']);
    const poll = Promise.withResolvers<void>();
    const retirement = controlledTiming();
    const afters: number[] = [];
    const nextPoll = Promise.withResolvers<void>();
    const server = await openApp(db, {
      timing: {
        now: () => 15000 * afters.length,
        async delay(ms, signal) {
          if (ms === 60000) return retirement.delay(ms, signal);
          if (afters.length === 1) return poll.promise;
          nextPoll.resolve();
          await delay(10000, undefined, { signal });
        },
      },
      async readPage(pool, input) {
        afters.push(input.after);
        const page = await readControlActivityPage(pool, input);
        if (afters.length === 1) {
          await publish(db, ['A']);
          poll.resolve();
        }
        return page;
      },
    });
    try {
      const response = await server.get(route);
      await nextPoll.promise;
      retirement.retirement.resolve();
      const body = await response.text();
      expect(afters).toEqual([0, 1]);
      expect(sequences(body, 2)).toEqual([2]);
      expect(body).toContain(': heartbeat\n\n');
    } finally {
      await server.app.close();
    }
  });
});

test('reauthorizes each poll and closes before reading another page on policy revocation', async () => {
  await withDb('v4evpoll', async db => {
    const poll = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    const retirement = controlledTiming();
    let allowed = true;
    let pageReads = 0;
    const server = await openApp(db, {
      timing: {
        now: () => 0,
        async delay(ms, signal) {
          if (ms === 60000) return retirement.delay(ms, signal);
          waiting.resolve();
          const cancelled = Promise.withResolvers<void>();
          const abort = () => cancelled.resolve();
          signal.addEventListener('abort', abort, { once: true });
          try { await Promise.race([poll.promise, cancelled.promise]); }
          finally { signal.removeEventListener('abort', abort); }
        },
      },
      async readState() { if (!allowed) throw discoveryError(403, 'DISCOVERY_FORBIDDEN'); },
      async readPage(pool, input) { pageReads++; return readControlActivityPage(pool, input); },
    });
    try {
      const response = await server.get(route);
      await waiting.promise;
      allowed = false;
      poll.resolve();
      expect(await response.text()).toBe(resync);
      expect(pageReads).toBe(1);
    } finally {
      await server.app.close();
    }
  });
});

test('reconnects from each delivered event ID without skipping the rest of the page', async () => {
  await withDb('v4evresume', async db => {
    await publish(db, ['A', 'B', 'A', 'A']);
    let cancelled = Promise.withResolvers<void>();
    const server = await openApp(db, {
      transport: {
        write(response, frame) { response.write(frame); return false; },
        async drain(_response, signal) {
          await delay(10000, undefined, { signal }).finally(cancelled.resolve);
        },
      },
    });
    try {
      let lastId: string | undefined;
      for (const expected of [1, 3, 4]) {
        cancelled = Promise.withResolvers<void>();
        const response = await server.get(route, lastId ? { 'last-event-id': lastId } : {});
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let frame = '';
        while (!frame.includes('\n\n')) {
          const { done, value } = await reader.read();
          if (done) throw Error('Expected an activity frame');
          frame += decoder.decode(value, { stream: true });
        }
        expect(sequences(frame, 4)).toEqual([expected]);
        lastId = /^id: (.+)$/m.exec(frame)![1]!;
        await reader.cancel();
        await cancelled.promise;
      }
    } finally {
      await server.app.close();
    }
  });
});
