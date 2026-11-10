import { expect, test, vi } from 'vitest';
import type { CaptureResultV1, ChangePage } from '@eapr/contracts';
import { companyADemo } from '../../../packages/contracts/src/demo-company-a.js';
import { eventA } from '../../../packages/sources/src/company-a.js';
import { drainCompanyADemoFeed } from '../src/demo-sync.js';

function feedFixture() {
  const cursors = new Map<string, string>(companyADemo.streams.map(stream => [stream, '0']));
  const lane = { schemaVersion: '1' as const, sourceRef: companyADemo.sourceRef, manifestHash: '0'.repeat(64) };
  const capturePage = vi.fn(async (page: ChangePage): Promise<CaptureResultV1> => {
    if (page.events.length) cursors.set(page.streamId, page.next);
    return {
      disposition: page.events.length ? 'captured' as const : 'empty' as const,
      captured: page.events.length, cursor: page.next, replayed: false,
    };
  });
  return { capturePage, readProgress: async () => ({
    schemaVersion: '1' as const, lane, streams: companyADemo.streams.map(streamId => ({
      streamId, captureCursor: cursors.get(streamId)!, baselineCursor: '0',
      transport: streamId === 'a-finance' ? 'api' as const : 'semantic' as const,
      capturedPages: 0, capturedRecords: 0, lastCapturedAt: null, lastIncident: null,
    })),
  }), cursors };
}

function page(sourceRef: string, streamId: string, after: string, length: number): ChangePage {
  const events = Array.from({ length }, (_, offset) => {
    const sequence = Number(after) + offset + 1;
    return eventA({
      recordId: 'pay-a:budget-' + sequence, kind: 'payment', sourceAccountId: companyADemo.scenario.accountId,
      effectiveDate: companyADemo.scenario.effectiveDate, fields: { amount: '300.00' },
    }, sequence, companyADemo.scenario.observedAt);
  });
  return { sourceRef, streamId, after, next: String(Number(after) + length), complete: true, events };
}

test.each([0, 1])('exact 1000 events requires a terminal probe (extra events %i)', async extra => {
  const capture = feedFixture();
  const fetch = vi.fn(async (source: string, stream: string, after: string) =>
    page(source, stream, after, stream === 'a-semantics' ? 0 : Number(after) < 1000 ? 100 : extra));
  const pending = drainCompanyADemoFeed(capture, fetch);
  if (extra) {
    await expect(pending).rejects.toMatchObject({ code: 'DEMO_SYNC_FETCH_LIMIT' });
    expect(capture.cursors.get('a-finance')).toBe('1000');
  } else {
    await pending;
    expect(fetch.mock.calls.slice(-2)).toEqual([
      ['legacy-a', 'a-finance', '1000'], ['legacy-a', 'a-semantics', '0'],
    ]);
  }
});

test('a stale empty probe is refetched from persisted progress', async () => {
  const capture = feedFixture();
  const fetch = vi.fn(async (source: string, stream: string, after: string) => {
    if (stream === 'a-finance' && after === '0') capture.cursors.set(stream, '1');
    return page(source, stream, after, 0);
  });
  await drainCompanyADemoFeed(capture, fetch);
  expect(fetch.mock.calls).toEqual([
    ['legacy-a', 'a-finance', '0'], ['legacy-a', 'a-finance', '1'], ['legacy-a', 'a-semantics', '0'],
  ]);
});

test('continually stale empty probes exhaust the request cap', async () => {
  const capture = feedFixture();
  const fetch = vi.fn(async (source: string, stream: string, after: string) => {
    capture.cursors.set(stream, String(Number(after) + 1));
    return page(source, stream, after, 0);
  });
  await expect(drainCompanyADemoFeed(capture, fetch)).rejects.toMatchObject({ code: 'DEMO_SYNC_FETCH_LIMIT' });
  expect(fetch).toHaveBeenCalledTimes(32);
});

test('a nonempty page must advance persisted progress', async () => {
  const capture = feedFixture();
  capture.capturePage.mockResolvedValueOnce({ disposition: 'refetch', captured: 0, cursor: '0', replayed: false });
  const fetch = vi.fn(async (source: string, stream: string, after: string) => page(source, stream, after, 1));
  await expect(drainCompanyADemoFeed(capture, fetch)).rejects.toMatchObject({ code: 'DEMO_SYNC_FEED_INVALID' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
