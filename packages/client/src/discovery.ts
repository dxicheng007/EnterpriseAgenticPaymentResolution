import type { ZodType } from 'zod';
import { ActivityEventSchema, EventCursorResponseSchema,
  type ActivityEvent } from '../../contracts/src/activity.js';
import {
  DiscoveryActionRequestV2Schema, DiscoveryCapabilitiesResponseV2Schema, DiscoveryStateV2Schema,
  type DiscoveryStateV2,
} from '../../contracts/src/discovery.js';
import { clearCsrfToken, jsonPost, LocalApiError, requestLocal } from './http.js';
import { getLocalSession } from './session.js';

const frameBytes = 64 * 1024;
const reconnectMs = 500;
const runPath = (runId: string) => '/api/discovery/runs/' + encodeURIComponent(runId);
const validCursor = (value: string) => /^[A-Za-z0-9_-]{1,1024}$/.test(value);

const resync = () => new LocalApiError(409, 'RESYNC_REQUIRED', 'Discovery activity needs to resynchronize.');
const networkError = () => new LocalApiError(0, 'NETWORK_UNAVAILABLE', 'The local service could not be reached.');
const malformed = () => new LocalApiError(200, 'MALFORMED_RESPONSE', 'The local service returned an invalid response.');

async function discoveryFetch(url: string, signal: AbortSignal, accept: string) {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: accept } });
  } catch {
    signal.throwIfAborted();
    throw networkError();
  }
  if (signal.aborted || !response.ok) {
    if (response.body) void response.body.cancel().catch(() => {});
    signal.throwIfAborted();
    if (response.status === 409) throw resync();
    throw new LocalApiError(response.status, 'REQUEST_FAILED', 'The discovery request could not be completed.');
  }
  return response;
}

// Run reads leave session recovery to the current monitor generation.
async function read<T>(url: string, schema: ZodType<T>, signal: AbortSignal): Promise<T> {
  const response = await discoveryFetch(url, signal, 'application/json');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    signal.throwIfAborted();
    throw malformed();
  }
  signal.throwIfAborted();
  const result = schema.safeParse(body);
  if (!result.success) throw malformed();
  return result.data;
}

export function readDiscoveryCapabilities(signal: AbortSignal) {
  return requestLocal('/api/discovery/capabilities', DiscoveryCapabilitiesResponseV2Schema, { signal });
}

async function readDiscoveryState(runId: string, signal: AbortSignal) {
  const state = await read(runPath(runId), DiscoveryStateV2Schema, signal);
  if (state.id !== runId) throw malformed();
  return state;
}

export function changeDiscoveryStatus(
  runId: string, action: 'pause' | 'resume', expectedRevision: number, signal: AbortSignal,
) {
  const body = DiscoveryActionRequestV2Schema.parse({
    schemaVersion: 2, expectedRevision, idempotencyKey: globalThis.crypto.randomUUID(),
  });
  return requestLocal(runPath(runId) + '/' + action, DiscoveryStateV2Schema, jsonPost(body, signal), true);
}

function parseFrame(bytes: Uint8Array, runId: string) {
  try {
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r?\n/);
    const fields = new Map<string, string>();
    for (const line of lines) {
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      if (colon < 1) throw resync();
      const name = line.slice(0, colon);
      if (!['event', 'id', 'data'].includes(name) || fields.has(name)) throw resync();
      fields.set(name, line.slice(colon + 1).replace(/^ /, ''));
    }
    if (fields.size === 0) return undefined;
    if (fields.get('event') !== 'activity') throw resync();
    const cursor = fields.get('id');
    if (cursor === undefined || !validCursor(cursor)) throw resync();
    const event = ActivityEventSchema.parse(JSON.parse(fields.get('data') ?? ''));
    if (event.stream !== 'control' || event.runId !== runId) throw resync();
    return { cursor, event };
  } catch {
    throw resync();
  }
}

export async function streamDiscovery(
  runId: string, cursor: string, signal: AbortSignal, connected: () => void,
  deliver: (event: ActivityEvent, cursor: string) => void | Promise<void>,
) {
  const query = new URLSearchParams({ after: cursor });
  const response = await discoveryFetch(runPath(runId) + '/events?' + query, signal, 'text/event-stream');
  if (!response.body || response.headers.get('content-type')?.split(';')[0] !== 'text/event-stream') {
    if (response.body) void response.body.cancel().catch(() => {});
    throw resync();
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const frame = new Uint8Array(frameBytes);
  let length = 0;
  let lineStart = 0;
  try {
    connected();
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read().catch(() => { throw networkError(); });
      signal.throwIfAborted();
      if (done) {
        if (length !== 0) throw resync();
        return;
      }
      let start = 0;
      while (start < value.length) {
        const newline = value.indexOf(10, start);
        const end = newline < 0 ? value.length : newline + 1;
        const slice = value.subarray(start, end);
        if (length + slice.length > frameBytes) throw resync();
        frame.set(slice, length);
        length += slice.length;
        start = end;
        if (newline < 0) continue;

        const lineLength = length - lineStart;
        if (lineLength === 1 || (lineLength === 2 && frame[lineStart] === 13)) {
          const entry = parseFrame(frame.subarray(0, lineStart), runId);
          if (entry) await deliver(entry.event, entry.cursor);
          signal.throwIfAborted();
          length = 0;
        }
        lineStart = length;
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function reconnectDelay(signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, reconnectMs);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

type MonitorCallbacks = {
  state: (state: DiscoveryStateV2) => void;
  activity: (event: ActivityEvent) => void;
  connection: (status: 'connecting' | 'connected' | 'reconnecting' | 'resynchronizing') => void;
};

export function createDiscoveryMonitor(runId: string, signal: AbortSignal, callbacks: MonitorCallbacks) {
  let revision = 0;
  let lastSequence = 0;
  function publish(state: DiscoveryStateV2) {
    signal.throwIfAborted();
    if (state.id === runId && state.revision > revision) {
      revision = state.revision;
      callbacks.state(state);
    }
  }

  async function refresh() {
    publish(await readDiscoveryState(runId, signal));
  }

  async function watch() {
    let cursor: string | undefined;
    let sessionRecoveryUsed = false;
    let resyncUsed = false;
    let refreshPending = false;
    callbacks.connection('connecting');
    for (;;) {
      signal.throwIfAborted();
      try {
        if (cursor === undefined) {
          const response = await read(runPath(runId) + '/events/cursor', EventCursorResponseSchema, signal);
          if (!validCursor(response.cursor)) throw malformed();
          await refresh();
          refreshPending = false;
          cursor = response.cursor;
        } else if (refreshPending) {
          await refresh();
          refreshPending = false;
        }
        await streamDiscovery(runId, cursor, signal, () => {
          sessionRecoveryUsed = false;
          callbacks.connection('connected');
        }, async (event, deliveredCursor) => {
          if (event.sequence > lastSequence) {
            callbacks.activity(event);
            lastSequence = event.sequence;
            cursor = deliveredCursor;
            resyncUsed = false;
            refreshPending = true;
            await refresh();
            refreshPending = false;
          }
        });
        resyncUsed = false;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof LocalApiError)) throw error;
        if (error.status === 401 && !sessionRecoveryUsed) {
          sessionRecoveryUsed = true;
          callbacks.connection('resynchronizing');
          clearCsrfToken();
          await getLocalSession();
          cursor = undefined;
          continue;
        }
        if (error.code === 'RESYNC_REQUIRED' && !resyncUsed) {
          resyncUsed = true;
          callbacks.connection('resynchronizing');
          cursor = undefined;
          continue;
        }
        if (error.status !== 0 || cursor === undefined) throw error;
      }
      callbacks.connection('reconnecting');
      await reconnectDelay(signal);
    }
  }

  return { watch, publish, refresh };
}
