import { expect, test } from 'vitest';
import {
  CaptureProgressV1Schema, CaptureResultV1Schema, CommittedCaptureIdentityV1Schema,
} from '../src/sync-capture.js';

const hash = 'a'.repeat(64);
const at = '2026-11-09T08:00:00.000Z';
const lane = { schemaVersion: '1', sourceRef: 'legacy-a', manifestHash: hash };
const incident = { code: 'CAPTURE_IDENTITY_CONFLICT', pageHash: hash, sourceIds: ['A', 'a'], observedAt: at };
const stream = {
  streamId: 'a-finance', transport: 'api', baselineCursor: '5', captureCursor: '7', capturedRecords: 2,
  capturedPages: 1, lastCapturedAt: at, lastIncident: incident,
};
const progress = { schemaVersion: '1', lane, streams: [stream] };

test('accepts ordered capture-only progress including a historical incident and a zero baseline', () => {
  const zero = {
    ...stream, streamId: 'a-semantics', transport: 'semantic', baselineCursor: '0', captureCursor: '0',
    capturedRecords: 0, capturedPages: 0, lastCapturedAt: null, lastIncident: null,
  };
  expect(CaptureProgressV1Schema.parse({ ...progress, streams: [stream, zero] })).toEqual({
    ...progress, streams: [stream, zero],
  });
  expect(CaptureProgressV1Schema.parse({ ...progress, streams: [] })).toEqual({ ...progress, streams: [] });
});

test.each([
  { captureCursor: '9007199254740992' }, { captureCursor: '05' }, { captureCursor: '4' },
  { capturedRecords: 9007199254740992 }, { capturedRecords: -0 }, { capturedRecords: 1 },
  { capturedPages: 9007199254740992 }, { capturedPages: 3 }, { capturedPages: 0 },
  { lastCapturedAt: null }, { lastCapturedAt: '2026-02-30T08:00:00.000Z' },
  { captureCursor: '5', capturedRecords: 0, capturedPages: 0 },
  { applyCursor: '7' }, { lastIncident: { ...incident, sourceIds: ['a', 'A'] } },
  { lastIncident: { ...incident, sourceIds: ['A', 'A'] } },
  { lastIncident: { ...incident, sourceIds: Array.from({ length: 21 }, (_, i) => 'event-' + String(i).padStart(2, '0')) } },
  { lastIncident: { ...incident, rawPage: {} } },
])('rejects malformed progress fields %j', (patch) => {
  expect(CaptureProgressV1Schema.safeParse({ ...progress, streams: [{ ...stream, ...patch }] }).success).toBe(false);
});

test('rejects unknown fields, forbidden nested keys and unordered or duplicate streams', () => {
  expect(CaptureProgressV1Schema.safeParse({ ...progress, sourceHighWater: '7' }).success).toBe(false);
  expect(CaptureProgressV1Schema.safeParse({ ...progress, streams: [stream, stream] }).success).toBe(false);
  expect(CaptureProgressV1Schema.safeParse({
    ...progress, streams: [{ ...stream, streamId: 'z' }, stream],
  }).success).toBe(false);
  const selector = { activationId: 'activation:1', bundleHash: hash, scope: {
    companyId: 'company-a', sellerEntityId: 'seller-a', accountId: 'customer-1',
  } };
  expect(CommittedCaptureIdentityV1Schema.parse(selector)).toEqual(selector);
  expect(CommittedCaptureIdentityV1Schema.safeParse({
    ...selector, scope: { ...selector.scope, ...JSON.parse('{"__proto__":null}') },
  }).success).toBe(false);
});

test('accepts only the count and replay flag corresponding to the disposition', () => {
  const result = { cursor: '9', disposition: 'captured', captured: 2, replayed: false };
  expect(CaptureResultV1Schema.parse(result)).toEqual(result);
  expect(CaptureResultV1Schema.parse({ ...result, disposition: 'replayed', captured: 0, replayed: true }))
    .toEqual({ ...result, disposition: 'replayed', captured: 0, replayed: true });
  for (const disposition of ['empty', 'refetch']) {
    const current = { ...result, disposition, captured: 0 };
    expect(CaptureResultV1Schema.parse(current)).toEqual(current);
  }
  for (const patch of [
    { captured: 0 }, { captured: -1 }, { captured: 9007199254740992 }, { replayed: true },
    { disposition: 'replayed', captured: 0 }, { disposition: 'empty', captured: 0, replayed: true },
    { disposition: 'refetch' }, { cursor: '9007199254740992' },
  ]) expect(CaptureResultV1Schema.safeParse({ ...result, ...patch }).success).toBe(false);
});
