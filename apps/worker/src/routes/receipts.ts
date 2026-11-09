import { IdSchema, ReceiptResponseSchema, ScopedReceiptQuerySchema } from '@eapr/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { createWorkerActivation } from '../activation.js';
import { authorizeActivationService, invalidActivationRequest, sendActivationError } from './activation.js';

const fields = new Set(['companyId', 'sellerEntityId', 'accountId', 'expectedRequestHash', 'expectedBundleHash']);

function parseQuery(raw: string) {
  if (raw.length > 4096) throw invalidActivationRequest();
  const entries = new Map<string, string>();
  try {
    for (const pair of raw.split('&')) {
      const separator = pair.indexOf('=');
      if (separator < 0) throw invalidActivationRequest();
      const key = decodeURIComponent(pair.slice(0, separator).replaceAll('+', ' '));
      if (!fields.has(key) || entries.has(key)) throw invalidActivationRequest();
      entries.set(key, decodeURIComponent(pair.slice(separator + 1).replaceAll('+', ' ')));
    }
  } catch {
    throw invalidActivationRequest();
  }
  const parsed = ScopedReceiptQuerySchema.safeParse({
    scope: { companyId: entries.get('companyId'), sellerEntityId: entries.get('sellerEntityId'), accountId: entries.get('accountId') },
    expectedRequestHash: entries.get('expectedRequestHash'), expectedBundleHash: entries.get('expectedBundleHash'),
  });
  if (!parsed.success) throw invalidActivationRequest();
  return parsed.data;
}

export function createWorkerReceiptPlugin(service: Pick<ReturnType<typeof createWorkerActivation>, 'receipt'>,
  serviceToken: string): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler(sendActivationError);
    app.get<{ Params: { key: string } }>('/internal/receipts/:key', {
      onRequest: async request => authorizeActivationService(request, serviceToken),
    }, async (request, reply) => {
      const key = IdSchema.safeParse(request.params.key);
      if (!key.success || request.body !== undefined || request.headers['transfer-encoding'] ||
          Number(request.headers['content-length'] ?? '0') !== 0) throw invalidActivationRequest();
      const query = parseQuery(request.url.split('?').slice(1).join('?'));
      return reply.header('Cache-Control', 'no-store').send(ReceiptResponseSchema.parse(await service.receipt(key.data, query)));
    });
  };
}
