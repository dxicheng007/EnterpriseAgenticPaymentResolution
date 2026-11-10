import {
  ActivationAuthorityDiagnosticCodeSchema, ApiErrorSchema, IdSchema, InternalActivationRequestSchema,
  ReceiptResponseSchema, ScopedReceiptQuerySchema, type InternalActivationRequest, type ScopedReceiptQuery,
} from '@eapr/contracts';
import { ReviewError } from './review-repository.js';

const maximumResponseBytes = 512 * 1024;

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Worker response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumResponseBytes) {
      await reader.cancel();
      throw new Error('Worker response exceeded its size limit');
    }
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
}

export function createActivationWorkerClient(baseUrl: string, serviceToken: string) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== baseUrl || !serviceToken) {
    throw new Error('Activation delivery requires a fixed local worker origin and service credential');
  }

  async function send(url: URL, body?: InternalActivationRequest) {
    try {
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + serviceToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      const json = await readJson(response);
      if (response.status === 200) {
        const result = ReceiptResponseSchema.parse(json);
        if (!body && !result.replayed) throw new Error('Scoped receipt response must be a replay');
        return { status: 'receipt' as const, result };
      }
      const { code } = ApiErrorSchema.parse(json);
      if (!body && response.status === 404 && code === 'RECEIPT_NOT_FOUND') return { status: 'absent' as const };
      if (response.status === 409 && ActivationAuthorityDiagnosticCodeSchema.safeParse(code).success) {
        throw new ReviewError(409, code);
      }
      if ((response.status === 403 || response.status === 404 || response.status === 503) &&
          (code === 'REGISTERED_SCOPE_NOT_FOUND' || code === 'SOURCE_SEMANTICS_UNAVAILABLE' ||
           code === 'ACTIVATION_POLICY_UNAVAILABLE')) throw new ReviewError(response.status, code);
      return { status: 'pending' as const };
    } catch (error) {
      if (error instanceof ReviewError) throw error;
      return { status: 'pending' as const };
    }
  }

  return {
    activate(request: InternalActivationRequest) {
      return send(new URL('/internal/activate', origin), InternalActivationRequestSchema.parse(request));
    },
    receipt(key: string, input: ScopedReceiptQuery) {
      const { scope, expectedRequestHash, expectedBundleHash } = ScopedReceiptQuerySchema.parse(input);
      const url = new URL('/internal/receipts/' + encodeURIComponent(IdSchema.parse(key)), origin);
      url.search = new URLSearchParams({ ...scope, expectedRequestHash, expectedBundleHash }).toString();
      return send(url);
    },
  };
}

export type ActivationWorkerClient = ReturnType<typeof createActivationWorkerClient>;
