const errors = {
  AUTHORITY_INPUT_INVALID: [400, 'Authority input is invalid'],
  AUTHORITY_UNAUTHORIZED: [401, 'Authority admission is required'],
  AUTHORITY_FORBIDDEN: [403, 'Authority admission is forbidden'],
  AUTHORITY_NOT_FOUND: [404, 'Committed authority was not found'],
  AUTHORITY_IDEMPOTENCY_CONFLICT: [409, 'Authority command key is already bound'],
  AUTHORITY_STALE: [409, 'Authority epoch has changed'],
  AUTHORITY_REVOKED: [409, 'Authority has been revoked'],
  AUTHORITY_EPOCH_EXHAUSTED: [409, 'Authority epoch is exhausted'],
  AUTHORITY_INACTIVE: [409, 'Authority is inactive'],
  AUTHORITY_SEMANTICS_MISMATCH: [409, 'Current source semantics differ from the approval'],
  AUTHORITY_SEMANTICS_UNAVAILABLE: [503, 'Current source semantics are unavailable'],
  AUTHORITY_STORAGE_INVALID: [503, 'Stored authority is invalid'],
  AUTHORITY_UNAVAILABLE: [503, 'Current authority is unavailable'],
} as const;

type Code = keyof typeof errors;
type Status = (typeof errors)[Code][0];

export class AuthorityError extends Error {
  constructor(readonly statusCode: Status, readonly code: Code) {
    super(errors[code][1]);
    this.name = 'AuthorityError';
  }
}

export function authorityError(code: Code): AuthorityError {
  return new AuthorityError(errors[code][0], code);
}
