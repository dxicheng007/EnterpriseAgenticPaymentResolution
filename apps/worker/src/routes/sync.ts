import { ApiErrorSchema, IdSchema, strict, type Id, type SemanticPreflight } from '@eapr/contracts';
import type { Clock } from '@eapr/storage/control-db';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { ActivationError } from '../activation-validation.js';
import { readIngressAuthorityIdentity } from '../authority-identity.js';
import { createSyncApplier, SyncApplyError } from '../sync/apply.js';
import { AuthorityError, authorityError } from '../sync/current-authority-errors.js';
import { authorizeAuthorityService } from './authority.js';

const ApplyRequestSchema = strict({ accountId: IdSchema });

const syncFailures = {
  SYNC_BINDING_MISMATCH: [409, 'Synchronization authority binding changed'],
  SYNC_TARGET_STALE: [409, 'Synchronization target changed'],
  SYNC_PLAN_MISMATCH: [409, 'Synchronization plan changed'],
  SYNC_INVALID_PLAN: [409, 'Synchronization plan is invalid'],
  SYNC_COVERAGE_UNSUPPORTED: [409, 'Synchronization coverage is unsupported'],
  SYNC_COVERAGE_CHANGED: [409, 'Synchronization coverage changed'],
  SYNC_STORAGE_INVALID: [503, 'Synchronization storage is unavailable'],
  SYNC_SOURCE_UNAVAILABLE: [503, 'Synchronization source semantics are unavailable'],
} as const;

function sendSyncError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  let statusCode: number = 503;
  let code = 'SYNC_UNAVAILABLE';
  let message = 'Synchronization is unavailable';
  if (error instanceof SyncApplyError && error.code !== 'SYNC_NO_PENDING') {
    [statusCode, message] = syncFailures[error.code];
    code = error.code;
  } else if (error instanceof AuthorityError) {
    const safe = authorityError(error.code);
    statusCode = safe.statusCode;
    code = safe.code;
    message = safe.message;
  } else if (error instanceof ActivationError) {
    statusCode = error.statusCode;
    code = error.code;
    message = 'Current source semantics do not match the approved activation';
  } else if (error && typeof error === 'object' && 'statusCode' in error &&
      [400, 413, 415].includes(Number(error.statusCode))) {
    statusCode = 400;
    code = 'AUTHORITY_INPUT_INVALID';
    message = 'Authority input is invalid';
  }
  return reply.header('Cache-Control', 'no-store').code(statusCode).send(ApiErrorSchema.parse({
    code, message, correlationId: request.id, diagnostics: [],
  }));
}

/**
 * A trigger with no captured suffix returns `{ status: 'no_work', replayed: false }`.
 * Applied responses retain the existing ReceiptResponse fields.
 */
export function createWorkerSyncPlugin({ db, clock, serviceToken, observe }: {
  db: Pool; clock: Clock; serviceToken: string;
  observe: (sourceRef: Id) => Promise<SemanticPreflight>;
}): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendSyncError);
    app.post('/internal/apply', {
      bodyLimit: 4096,
      onRequest: async request => authorizeAuthorityService(request, serviceToken),
    }, async (request, reply) => {
      const body = ApplyRequestSchema.safeParse(request.body);
      if (!body.success || request.url.includes('?')) throw authorityError('AUTHORITY_INPUT_INVALID');
      const { identity } = await readIngressAuthorityIdentity(db, body.data.accountId);
      const applier = createSyncApplier({ db, clock, identity, observe });
      let prepared;
      try {
        prepared = await applier.prepare(clock().toISOString());
      } catch (error) {
        if (error instanceof SyncApplyError && error.code === 'SYNC_NO_PENDING') {
          return reply.header('Cache-Control', 'no-store').send({ status: 'no_work', replayed: false });
        }
        throw error;
      }
      if (prepared.plan) {
        const result = await applier.applyBatch(prepared.plan, prepared.expectedEpoch);
        return reply.header('Cache-Control', 'no-store').send({
          status: result.replayed ? 'replayed' : 'applied', ...result,
        });
      }
      return reply.header('Cache-Control', 'no-store').send({
        status: 'replayed', ...await applier.applyReplay(prepared, prepared.expectedEpoch),
      });
    });
  };
}
