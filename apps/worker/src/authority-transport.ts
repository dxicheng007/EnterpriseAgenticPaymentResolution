import { ApiErrorSchema } from '@eapr/contracts';
import { authorityError } from './sync/current-authority-errors.js';

const maximumResponseBytes = 256 * 1024;
const authorityCodes: Record<Parameters<typeof authorityError>[0], true> = {
  AUTHORITY_INPUT_INVALID: true,
  AUTHORITY_UNAUTHORIZED: true,
  AUTHORITY_FORBIDDEN: true,
  AUTHORITY_NOT_FOUND: true,
  AUTHORITY_IDEMPOTENCY_CONFLICT: true,
  AUTHORITY_STALE: true,
  AUTHORITY_REVOKED: true,
  AUTHORITY_EPOCH_EXHAUSTED: true,
  AUTHORITY_INACTIVE: true,
  AUTHORITY_SEMANTICS_MISMATCH: true,
  AUTHORITY_SEMANTICS_UNAVAILABLE: true,
  AUTHORITY_STORAGE_INVALID: true,
  AUTHORITY_UNAVAILABLE: true,
};

export function responseError(status: number, json: unknown) {
  const parsed = ApiErrorSchema.safeParse(json);
  if (parsed.success && Object.hasOwn(authorityCodes, parsed.data.code)) {
    const error = authorityError(parsed.data.code as keyof typeof authorityCodes);
    if (error.statusCode === status) return error;
  }
  return authorityError('AUTHORITY_UNAVAILABLE');
}

export async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw authorityError('AUTHORITY_UNAVAILABLE');
  const reader = response.body.getReader();
  // Cancel the read without waiting for the stream source to finish cleanup.
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) cancel();
    signal.throwIfAborted();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumResponseBytes) {
        cancel();
        throw authorityError('AUTHORITY_UNAVAILABLE');
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
