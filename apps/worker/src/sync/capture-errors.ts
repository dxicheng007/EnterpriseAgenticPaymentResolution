import type { CaptureIncidentCodeV1 } from '@eapr/contracts';

const errors = {
  CAPTURE_INPUT_INVALID: [400, 'Capture input is invalid'],
  CAPTURE_ACTIVATION_NOT_FOUND: [404, 'Committed activation was not found'],
  CAPTURE_TRANSPORT_UNSUPPORTED: [422, 'Capture transport is unsupported'],
  CAPTURE_BINDING_CONFLICT: [409, 'Capture lane definitions differ'],
  CAPTURE_GAP: [409, 'Capture page is incomplete or outside its checkpoint'],
  CAPTURE_IDENTITY_CONFLICT: [409, 'Source delivery or position differs'],
  CAPTURE_PAGE_CONFLICT: [409, 'Accepted capture page differs'],
  CAPTURE_STORAGE_INVALID: [503, 'Stored capture data is invalid'],
  CAPTURE_UNAVAILABLE: [503, 'Capture storage is unavailable'],
} as const;

export class CaptureError extends Error {
  readonly statusCode: number;

  constructor(readonly code: keyof typeof errors) {
    const [statusCode, message] = errors[code];
    super(message);
    this.name = 'CaptureError';
    this.statusCode = statusCode;
  }
}

export class CaptureIncident extends CaptureError {
  constructor(override readonly code: CaptureIncidentCodeV1, readonly sourceIds: string[] = []) {
    super(code);
  }
}

export function safeCaptureError(error: unknown): CaptureError {
  // Persist the diagnostics separately. Callers only receive the fixed public error fields.
  return error instanceof CaptureError ? new CaptureError(error.code) : new CaptureError('CAPTURE_UNAVAILABLE');
}

export function storageValue<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw new CaptureError('CAPTURE_STORAGE_INVALID');
  }
}

export function requireStorage(condition: unknown): asserts condition {
  if (!condition) throw new CaptureError('CAPTURE_STORAGE_INVALID');
}
