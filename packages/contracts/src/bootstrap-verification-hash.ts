import { BootstrapVerificationResultV1Schema, type BootstrapVerificationResultV1 } from './bootstrap-verification.js';
import { hashCanonical } from './canonical.js';
import type { Hash } from './common.js';

const placeholderHash = '0'.repeat(64);

export function hashBootstrapVerificationResult(
  input: Omit<BootstrapVerificationResultV1, 'hash'> & {hash?: Hash},
): Hash {
  const { hash: _hash, ...preimage } = BootstrapVerificationResultV1Schema.parse(
    Object.hasOwn(input, 'hash') ? input : { ...input, hash: placeholderHash },
  );
  return hashCanonical(preimage);
}
