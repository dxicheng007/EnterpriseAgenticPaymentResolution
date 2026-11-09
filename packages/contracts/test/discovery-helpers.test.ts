import { expect, test } from 'vitest';
import { InvalidCursorError } from '../src/activity.js';
import {
  createToolStepId, decodeDiscoveryCursor, DiscoveryResyncRequiredError, encodeDiscoveryCursor,
} from '../src/discovery-helpers.js';

const cursor = { v: 1, runId: 'run-a', controlCursor: 0 } as const;
const bounds = { runId: 'run-a', highWater: 4, retainedAfter: 0 };
const zero = 'eyJjb250cm9sQ3Vyc29yIjowLCJydW5JZCI6InJ1bi1hIiwidiI6MX0';
const three = 'eyJjb250cm9sQ3Vyc29yIjozLCJydW5JZCI6InJ1bi1hIiwidiI6MX0';
const wire = (json: string) => Buffer.from(json, 'utf8').toString('base64url');

test('derives exact step IDs scoped to dispatch and native call ID', () => {
  const native = { providerToolCallId: 'call-1' };
  for (const [dispatchId, id] of [
    ['d1', 'step:639b1ce6bb54e5d1b35f5648b06704d688cc562cf4325d11449f89c2fde0461d'],
    ['d2', 'step:c4bef3bf03ec0d8cb537dc998a1968af3eee4799dfae84705c15fb6ea301aa2a'],
    ['d3', 'step:3aaa9770344c9d9919f522d1cafb4d4c37abe392cd8adceab42525039cc845f2'],
  ]) {
    expect(createToolStepId({ dispatchId, ...native })).toBe(id);
  }
  const extra = { dispatchId: 'd1', ...native, name: 'readEvidence' };
  expect(() => createToolStepId(extra)).toThrow();
  expect(() => createToolStepId({ dispatchId: 'd1', providerToolCallId: '' })).toThrow();
});

test('encodes and decodes exact canonical discovery cursors', () => {
  expect(encodeDiscoveryCursor(cursor)).toBe(zero);
  expect(encodeDiscoveryCursor({ ...cursor, controlCursor: 3 })).toBe(three);
  expect(decodeDiscoveryCursor(zero, bounds)).toEqual(cursor);
  expect(decodeDiscoveryCursor(three, bounds)).toEqual({ ...cursor, controlCursor: 3 });
});

test('rejects malformed, noncanonical, wrong-run and future cursors', () => {
  const invalidUtf8 = Buffer.concat([
    Buffer.from('{"controlCursor":0,"runId":"run-'),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from('","v":1}'),
  ]).toString('base64url');
  for (const invalid of [
    '', 'A'.repeat(1025), zero + '=', zero + '+', zero + '/', invalidUtf8, wire('{'),
    zero.slice(0, -1) + '1',
    wire('{"runId":"run-a","controlCursor":0,"v":1}'),
    wire('{"controlCursor":0,"runId":"run-a","v":1,"extra":0}'),
    wire('{"controlCursor":0,"controlCursor":0,"runId":"run-a","v":1}'),
    wire('{"controlCursor":0, "runId":"run-a","v":1}'),
    wire('{"controlCursor":0,"runId":"run-\\u0061","v":1}'),
    wire('{"controlCursor":0,"runId":"run-b","v":1}'),
    ...['-0', '-1', '0.1', '9007199254740992', '5'].map(
      value => wire(`{"controlCursor":${value},"runId":"run-a","v":1}`),
    ),
  ]) {
    expect(() => decodeDiscoveryCursor(invalid, { ...bounds, retainedAfter: 2 })).toThrow(InvalidCursorError);
  }
});

test('distinguishes valid retained cursors, old cursors, and invalid server bounds', () => {
  const retained = { ...bounds, retainedAfter: 2 };
  const floor = { ...cursor, controlCursor: 2 };
  expect(decodeDiscoveryCursor(encodeDiscoveryCursor(floor), retained)).toEqual(floor);
  expect(() => decodeDiscoveryCursor(encodeDiscoveryCursor({ ...floor, controlCursor: 1 }), retained))
    .toThrow(DiscoveryResyncRequiredError);
  expect(new DiscoveryResyncRequiredError().code).toBe('RESYNC_REQUIRED');
  for (const invalid of [
    { ...bounds, retainedAfter: 5 }, { ...bounds, highWater: Number.MAX_SAFE_INTEGER + 1 },
    { ...bounds, runId: '' },
  ]) {
    const decode = () => decodeDiscoveryCursor(three, invalid);
    expect(decode).toThrow();
    expect(decode).not.toThrow(InvalidCursorError);
    expect(decode).not.toThrow(DiscoveryResyncRequiredError);
  }
});
