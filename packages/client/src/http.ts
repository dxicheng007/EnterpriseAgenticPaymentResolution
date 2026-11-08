import type { ZodType } from 'zod';
import { ApiErrorSchema, type ApiError } from '../../contracts/src/activity.js';
import type { Diagnostic } from '../../contracts/src/common.js';

export class LocalApiError extends Error {
  readonly code: string;
  readonly diagnostics: Diagnostic[];
  readonly correlationId?: string;

  constructor(readonly status: number, code: string, message: string, details?: ApiError) {
    super(message);
    this.name = 'LocalApiError';
    this.code = code;
    this.diagnostics = details?.diagnostics ?? [];
    this.correlationId = details?.correlationId;
  }
}

let csrfToken: string | undefined;
const expirationListeners = new Set<() => void>();

export function onSessionExpiration(listener: () => void) {
  expirationListeners.add(listener);
  return () => { expirationListeners.delete(listener); };
}

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export function clearCsrfToken() {
  if (csrfToken === undefined) return;
  csrfToken = undefined;
  for (const listener of expirationListeners) listener();
}

export async function requestLocal<T>(
  url: string, schema: ZodType<T>, options: RequestInit = {}, mutation = false,
): Promise<T> {
  const requestToken = csrfToken;
  const headers = new Headers(options.headers);
  if (mutation) {
    if (!requestToken) {
      throw new LocalApiError(401, 'SESSION_REQUIRED', 'The demo reviewer session is unavailable.');
    }
    headers.set('X-EAPR-CSRF', requestToken);
  }

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    options.signal?.throwIfAborted();
    throw new LocalApiError(0, 'NETWORK_UNAVAILABLE', 'The local service could not be reached.');
  }

  if (response.status === 401 && requestToken === csrfToken) clearCsrfToken();
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    options.signal?.throwIfAborted();
    throw new LocalApiError(response.status, 'MALFORMED_RESPONSE', 'The local service returned an unreadable response.');
  }
  if (!response.ok) {
    const error = ApiErrorSchema.safeParse(body);
    if (error.success) {
      throw new LocalApiError(response.status, error.data.code, error.data.message, error.data);
    }
    throw new LocalApiError(response.status, 'REQUEST_FAILED', 'The local service could not complete the request.');
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new LocalApiError(response.status, 'MALFORMED_RESPONSE', 'The local service returned an invalid response.');
  }
  return result.data;
}

export function jsonPost(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
}
