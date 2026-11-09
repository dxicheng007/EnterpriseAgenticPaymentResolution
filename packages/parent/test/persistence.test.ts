import { expect, test } from 'vitest';
import { canonicalJson, hashCanonical, TargetStateSchema } from '@eapr/contracts';
import { decodeCanonical, readVersion } from '../src/snapshots.js';
import { emptyTargetA } from '../../../tests/fixtures/index.js';

test('decodes exact canonical bytes with their digest and strict schema', () => {
  const digest = hashCanonical(emptyTargetA);
  expect(decodeCanonical(TargetStateSchema, canonicalJson(emptyTargetA), digest)).toEqual(emptyTargetA);
  expect(() => decodeCanonical(TargetStateSchema, JSON.stringify(emptyTargetA), digest)).toThrow();
  expect(() => decodeCanonical(TargetStateSchema, canonicalJson({ ...emptyTargetA, extra: 1 }), digest)).toThrow();
});

test('reads only explicit safe nonnegative BIGINT text', () => {
  expect(readVersion('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  for (const invalid of ['9007199254740992', '01', '-1', '1e1', '', 1, null]) {
    expect(() => readVersion(invalid)).toThrow();
  }
});
