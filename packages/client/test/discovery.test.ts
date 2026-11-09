import { afterEach, expect, it, vi } from 'vitest';
import { clearCsrfToken, onSessionExpiration } from '../src/http.js';
import { getLocalSession } from '../src/session.js';
import * as discovery from '../src/discovery.js';

const runId = 'run-a';
const activity = {
  runId, stream: 'control', phase: 'build', sequence: 1, type: 'task.started',
  at: '2026-11-08T08:00:00.000Z', payload: {},
};
const frame = `event: activity\nid: C1\ndata: ${JSON.stringify(activity)}\n\n`;
const encoder = new TextEncoder();

function response(parts: string[], cancel = vi.fn(), close = true) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      if (close) controller.close();
    },
    cancel,
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  clearCsrfToken();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('delivers only a complete validated activity frame', async () => {
  const fetch = vi.fn().mockResolvedValue(response([frame.slice(0, -1), '\n']));
  vi.stubGlobal('fetch', fetch);
  const deliver = vi.fn();
  await discovery.streamDiscovery(runId, 'C0', new AbortController().signal, vi.fn(), deliver);
  expect(deliver).toHaveBeenCalledExactlyOnceWith(activity, 'C1');
  expect(fetch).toHaveBeenCalledWith('/api/discovery/runs/run-a/events?after=C0', expect.objectContaining({
    credentials: 'same-origin', cache: 'no-store',
  }));
});

it.each(['oversized', 'malformed', 'truncated'])('requires resync for a %s frame', async kind => {
  const cancel = vi.fn();
  const parts = kind === 'oversized' ? ['a'.repeat(65537)] : kind === 'truncated' ? [frame.slice(0, -1)] :
    [frame.replace('run-a', 'run-b')];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(parts, cancel, kind === 'truncated')));
  const deliver = vi.fn();
  await expect(discovery.streamDiscovery(runId, 'C0', new AbortController().signal, vi.fn(), deliver))
    .rejects.toMatchObject({ code: 'RESYNC_REQUIRED' });
  expect(deliver).not.toHaveBeenCalled();
  if (kind !== 'truncated') expect(cancel).toHaveBeenCalledOnce();
});

it('cancels an idle reader when the generation aborts', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([], cancel, false)));
  const controller = new AbortController();
  const connected = vi.fn(() => controller.abort());
  await expect(discovery.streamDiscovery(runId, 'C0', controller.signal, connected, vi.fn()))
    .rejects.toMatchObject({ name: 'AbortError' });
  expect(cancel).toHaveBeenCalledOnce();
});

const session = {
  demoOnly: true, reviewer: { reviewerId: 'reviewer', sessionId: 'session-1' },
  allowedSourceRefs: ['legacy-a'], allowedAccountIds: ['account-a'], csrfToken: 'token-1',
};

function state(revision: number) {
  return {
    schemaVersion: 2, id: runId, revision, status: 'running', modelId: 'scripted-test', mode: 'scripted',
    binding: { companyId: 'company-a', sourceRef: 'legacy-a', manifestId: 'manifest-a',
      snapshotId: 'snapshot-a', manifestHash: '0'.repeat(64), snapshotHash: '1'.repeat(64) },
    inFlightModelCalls: 0, inFlightToolSteps: 0, tasks: [], findings: [], proposals: [], verificationJobs: [],
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, unknownUsageCalls: 0, cost: { status: 'unavailable' } },
    diagnostics: [],
  };
}

const base = '/api/discovery/runs/run-a';
const cursorPath = base + '/events/cursor';
const streamPath = base + '/events?after=';
const bootstrap = '/api/local-session';

function monitor() {
  const controller = new AbortController();
  const callbacks = { state: vi.fn(), activity: vi.fn(), connection: vi.fn() };
  return { controller, callbacks, ...discovery.createDiscoveryMonitor(runId, controller.signal, callbacks) };
}

it('reads cursor then state, deduplicates events, and reconnects using the last delivered cursor', async () => {
  vi.useFakeTimers();
  const active = monitor();
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ cursor: 'C0' }))
    .mockResolvedValueOnce(Response.json(state(2)))
    .mockResolvedValueOnce(response([frame, frame]))
    .mockResolvedValueOnce(Response.json(state(1)))
    .mockImplementationOnce(() => {
      active.controller.abort();
      return response([]);
    });
  vi.stubGlobal('fetch', fetch);
  const stopped = expect(active.watch()).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(499);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([cursorPath, base, streamPath + 'C0', base]);
  await vi.advanceTimersByTimeAsync(1);
  await stopped;
  expect(fetch.mock.calls.at(-1)?.[0]).toBe(streamPath + 'C1');
  expect(active.callbacks.activity).toHaveBeenCalledExactlyOnceWith(activity);
  expect(active.callbacks.state).toHaveBeenCalledExactlyOnceWith(state(2));
});

it('ignores a slower state refetch after a newer state has been published', async () => {
  const active = monitor();
  const slower = Promise.withResolvers<Response>();
  const fetch = vi.fn().mockReturnValueOnce(slower.promise).mockResolvedValueOnce(Response.json(state(4)));
  vi.stubGlobal('fetch', fetch);
  const pending = active.refresh();
  await active.refresh();
  slower.resolve(Response.json(state(3)));
  await pending;
  expect(active.callbacks.state).toHaveBeenCalledExactlyOnceWith(state(4));
});

it('does not clear the shared session for a previous run generation', async () => {
  const previous = monitor();
  const stale = Promise.withResolvers<Response>();
  const entered = Promise.withResolvers<void>();
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(Response.json({ cursor: 'C0' }))
    .mockResolvedValueOnce(Response.json(state(1)))
    .mockImplementationOnce(() => { entered.resolve(); return stale.promise; });
  vi.stubGlobal('fetch', fetch);
  const cached = await getLocalSession();
  const stopped = expect(previous.watch()).rejects.toMatchObject({ name: 'AbortError' });
  await entered.promise;
  previous.controller.abort();
  stale.resolve(new Response(null, { status: 401 }));
  await stopped;
  expect(await getLocalSession()).toBe(cached);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('clears a cached session once on 401 and shares recovery with the expiration listener', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(Response.json({ cursor: 'C0' }))
    .mockResolvedValueOnce(Response.json(state(1)))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ ...session, csrfToken: 'token-2' }))
    .mockResolvedValueOnce(Response.json({ cursor: 'C2' }))
    .mockResolvedValueOnce(Response.json(state(2)))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  await getLocalSession();
  const listener = vi.fn(getLocalSession);
  const unsubscribe = onSessionExpiration(listener);
  try {
    await expect(monitor().watch()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      bootstrap, cursorPath, base, streamPath + 'C0', bootstrap, cursorPath, base, streamPath + 'C2',
    ]);
  } finally {
    unsubscribe();
  }
});

it('stops if automatic session bootstrap fails', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  await getLocalSession();
  await expect(monitor().watch()).rejects.toMatchObject({ status: 503 });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([bootstrap, cursorPath, bootstrap]);
});

const resyncFrame = 'event: resync_required\ndata: {"code":"RESYNC_REQUIRED"}\n\n';

it('acquires cursor and state again after a post-header resync', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ cursor: 'C0' }))
    .mockResolvedValueOnce(Response.json(state(1)))
    .mockResolvedValueOnce(response([resyncFrame]))
    .mockResolvedValueOnce(Response.json({ cursor: 'C2' }))
    .mockResolvedValueOnce(Response.json(state(2)))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  await expect(monitor().watch()).rejects.toMatchObject({ status: 403 });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    cursorPath, base, streamPath + 'C0', cursorPath, base, streamPath + 'C2',
  ]);
});

it.each([401, 403])('uses actual HTTP %s after post-header resync', async status => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(Response.json({ cursor: 'C0' }))
    .mockResolvedValueOnce(Response.json(state(1)))
    .mockResolvedValueOnce(response([resyncFrame]))
    .mockResolvedValueOnce(new Response(null, { status }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  await getLocalSession();
  await expect(monitor().watch()).rejects.toMatchObject({ status: status === 401 ? 503 : 403 });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    bootstrap, cursorPath, base, streamPath + 'C0', cursorPath, ...(status === 401 ? [bootstrap] : []),
  ]);
});

it('surfaces mutation conflict without replaying the request', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(Response.json({
      code: 'DISCOVERY_CONFLICT', message: 'Run revision changed.', diagnostics: [], correlationId: 'req-1',
    }, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  await getLocalSession();
  await expect(discovery.changeDiscoveryStatus(runId, 'pause', 3, new AbortController().signal))
    .rejects.toMatchObject({ status: 409, code: 'DISCOVERY_CONFLICT' });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([bootstrap, base + '/pause']);
  const request = fetch.mock.calls[1]![1] as RequestInit;
  expect(new Headers(request.headers).get('X-EAPR-CSRF')).toBe('token-1');
  expect(JSON.parse(request.body as string)).toMatchObject({
    schemaVersion: 2, expectedRevision: 3, idempotencyKey: expect.any(String),
  });
});
