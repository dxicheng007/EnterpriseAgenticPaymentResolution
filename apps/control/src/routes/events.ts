import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import {
  ApiErrorSchema, decodeDiscoveryCursor, DiscoveryResyncRequiredError, encodeDiscoveryCursor,
  IdSchema, InvalidCursorError, type Id,
} from '@eapr/contracts';
import { readControlActivityPage, readControlActivityWindow } from '../../../../packages/storage/src/activity.js';
import type { DiscoveryReviewer } from '../../../../packages/discovery/src/service.js';
import { LocalSessionError } from '../local-session.js';

const pollMs = 1000;
const heartbeatMs = 15000;
const lifetimeMs = 60000;
const pageSize = 100;
const resyncFrame = 'event: resync_required\ndata: {"code":"RESYNC_REQUIRED"}\n\n';

const errors = {
  CURSOR_INVALID: [400, 'The discovery cursor is invalid.'],
  RESYNC_REQUIRED: [409, 'The discovery activity must be resynchronized.'],
  DISCOVERY_INVALID: [400, 'Discovery request is invalid.'],
  DISCOVERY_FORBIDDEN: [403, 'Discovery access is forbidden.'],
  DISCOVERY_NOT_FOUND: [404, 'The discovery resource was not found.'],
  DISCOVERY_CONFLICT: [409, 'Discovery state or capture conflicts with the request.'],
  DISCOVERY_UNAVAILABLE: [503, 'The discovery service is unavailable.'],
} as const;

type Timing = {
  delay: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
};
type Transport = {
  write: (response: ServerResponse, frame: string) => boolean;
  drain: (response: ServerResponse, signal: AbortSignal) => Promise<unknown>;
};
type Dependencies = {
  db: Pick<Pool, 'query'>;
  authorizeReviewer: (request: FastifyRequest, access: { mutation: false }) => Promise<DiscoveryReviewer>;
  readState: (reviewer: DiscoveryReviewer, runId: Id) => Promise<unknown>;
  readWindow?: typeof readControlActivityWindow;
  readPage?: typeof readControlActivityPage;
  timing?: Timing;
  transport?: Transport;
};

export function mountDiscoveryEvents({
  db, authorizeReviewer, readState, readWindow = readControlActivityWindow, readPage = readControlActivityPage,
  timing = { delay: (ms, signal) => sleep(ms, undefined, { signal }), now: () => performance.now() },
  transport = { write: (response, frame) => response.write(frame), drain: (response, signal) => once(response, 'drain', { signal }) },
}: Dependencies): FastifyPluginAsync {
  return async app => {
    const active = new Set<() => void>();
    let closing = false;
    app.addHook('preClose', async () => {
      closing = true;
      for (const stop of active) stop();
    });

    app.addHook('onRequest', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
    });
    app.setErrorHandler((error, request, reply) => {
      const raw = error instanceof Error && 'code' in error ? error.code : undefined;
      const code = typeof raw === 'string' && Object.hasOwn(errors, raw) ? raw as keyof typeof errors :
        'DISCOVERY_UNAVAILABLE';
      const [status, message] = errors[code];
      return reply.code(error instanceof LocalSessionError ? error.statusCode : status).send(ApiErrorSchema.parse({
        code: error instanceof LocalSessionError ? error.code : code,
        message: error instanceof LocalSessionError ? error.message : message,
        correlationId: request.id,
        diagnostics: [],
      }));
    });

    async function validate(request: FastifyRequest<{ Params: { runId: string } }>, stream: boolean) {
      const reviewer = await authorizeReviewer(request, { mutation: false });
      const run = IdSchema.safeParse(request.params.runId);
      const query = request.query as Record<string, unknown>;
      if (!run.success || Object.keys(query).some(key => !stream || key !== 'after')) {
        throw Object.assign(new Error(), { code: 'DISCOVERY_INVALID' });
      }
      const runId = run.data;
      await readState(reviewer, runId);
      const window = await readWindow(db);
      return { runId, window, query };
    }

    app.get<{ Params: { runId: string } }>('/api/discovery/runs/:runId/events/cursor', async request => {
      const { runId, window } = await validate(request, false);
      return { cursor: encodeDiscoveryCursor({ v: 1, runId, controlCursor: window.highWater }) };
    });

    app.get<{ Params: { runId: string } }>('/api/discovery/runs/:runId/events', { exposeHeadRoute: false }, async (request, reply) => {
      const { runId, window, query } = await validate(request, true);
      const cursor = query.after ?? request.headers['last-event-id'];
      let after = 0;
      if (cursor === undefined) {
        if (window.retainedAfter > 0) throw new DiscoveryResyncRequiredError();
      } else {
        if (typeof cursor !== 'string') throw new InvalidCursorError();
        after = decodeDiscoveryCursor(cursor, { runId, ...window }).controlCursor;
      }

      const response = reply.raw;
      if (response.destroyed) return reply.hijack();
      if (closing) throw Object.assign(new Error(), { code: 'DISCOVERY_UNAVAILABLE' });
      const controller = new AbortController();
      const { signal } = controller;
      const stop = () => {
        controller.abort();
        if (response.destroyed || response.writableEnded) return;
        // A stalled socket cannot delay retirement or server shutdown.
        if (response.writableNeedDrain) response.destroy();
        else response.end();
      };
      const disconnected = () => controller.abort();
      const failed = () => {
        controller.abort();
        response.destroy();
      };
      async function authorize() {
        signal.throwIfAborted();
        const reviewer = await authorizeReviewer(request, { mutation: false });
        signal.throwIfAborted();
        await readState(reviewer, runId);
        signal.throwIfAborted();
      }
      async function send(frame: string) {
        signal.throwIfAborted();
        if (!transport.write(response, frame)) {
          await transport.drain(response, signal);
          await authorize();
        }
      }
      active.add(stop);
      response.once('close', disconnected);
      response.once('error', failed);
      reply.hijack();
      try {
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/event-stream' });
        response.flushHeaders();
        void timing.delay(lifetimeMs, signal).then(stop, failedOnTimerError);
        let heartbeatAt = timing.now() + heartbeatMs;
        while (!signal.aborted) {
          await authorize();
          const page = await readPage(db, { after, limit: pageSize, runId });
          signal.throwIfAborted();
          if (after < page.retainedAfter || after > page.highWater) throw new DiscoveryResyncRequiredError();
          for (const event of page.events) {
            const id = encodeDiscoveryCursor({ v: 1, runId, controlCursor: event.sequence });
            await send('event: activity\nid: ' + id + '\ndata: ' + JSON.stringify(event) + '\n\n');
          }
          after = page.nextAfter;
          if (timing.now() >= heartbeatAt) {
            await send(': heartbeat\n\n');
            heartbeatAt = timing.now() + heartbeatMs;
          }
          if (!page.hasMore) await timing.delay(pollMs, signal);
        }
      } catch {
        if (!signal.aborted && !response.destroyed) response.end(resyncFrame);
      } finally {
        stop();
        active.delete(stop);
        response.off('close', disconnected);
        response.off('error', failed);
      }

      function failedOnTimerError() {
        if (!signal.aborted) failed();
      }
    });
  };
}
