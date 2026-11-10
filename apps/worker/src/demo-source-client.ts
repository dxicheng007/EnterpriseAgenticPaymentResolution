import { ChangePageSchema, CursorSchema, type ChangePage } from '@eapr/contracts';
import { validateChangePage } from '@eapr/sources';
import { companyADemo as demo } from '../../../packages/contracts/src/demo-company-a.js';
import { SyncApplyError } from './sync/apply.js';

const demoSourcePageBytes = 1024 * 1024;

export function validDemoBearer(token: string): boolean {
  return typeof token === 'string' && token.length <= 1024 && /^[A-Za-z0-9._~+/-]+=*$/.test(token);
}

export function createDemoSourceClient({ baseUrl, token }: { baseUrl: string; token: string }) {
  const origin = URL.parse(baseUrl);
  if (!origin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
      origin.origin !== baseUrl || !validDemoBearer(token)) {
    throw new Error('Demo source requires a fixed loopback origin and read capability');
  }
  const streams = new Set<string>(demo.streams);

  return async (sourceRef: string, streamId: string, after: string): Promise<ChangePage> => {
    try {
      if (sourceRef !== demo.sourceRef || !streams.has(streamId) || !CursorSchema.safeParse(after).success) {
        throw new SyncApplyError('SYNC_SOURCE_UNAVAILABLE');
      }
      const url = new URL('/internal/demo/company-a/changes/' + streamId + '?after=' + after, origin);
      const response = await fetch(url, {
        headers: { authorization: 'Bearer ' + token },
        redirect: 'error', signal: AbortSignal.timeout(2000),
      });
      if (response.status !== 200 || !response.body ||
          response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json' ||
          Number(response.headers.get('content-length')) > demoSourcePageBytes) {
        await response.body?.cancel();
        throw new SyncApplyError('SYNC_SOURCE_UNAVAILABLE');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > demoSourcePageBytes) {
          await reader.cancel();
          throw new SyncApplyError('SYNC_SOURCE_UNAVAILABLE');
        }
        chunks.push(value);
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
      const page = ChangePageSchema.parse(JSON.parse(text));
      if (page.events.length > 100) throw new SyncApplyError('SYNC_SOURCE_UNAVAILABLE');
      return validateChangePage(page, sourceRef, streamId, after);
    } catch {
      throw new SyncApplyError('SYNC_SOURCE_UNAVAILABLE');
    }
  };
}
