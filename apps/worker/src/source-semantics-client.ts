import { IdSchema, SemanticPreflightSchema } from '@eapr/contracts';

export class SourceSemanticsError extends Error {
  readonly code = 'SOURCE_SEMANTICS_UNAVAILABLE';

  constructor(readonly statusCode: 403 | 404 | 503) {
    super('Current source semantics are unavailable');
  }
}

const maxBytes = 256 * 1024;

export function createSourceSemanticsClient({ baseUrl, token, sourceRefs }: {
  baseUrl: string; token: string; sourceRefs: readonly string[];
}) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== baseUrl ||
      !/^[A-Za-z0-9._~+/-]+=*$/.test(token) || token.length > 1024) {
    throw new Error('Source semantics requires a fixed loopback origin and read capability');
  }
  const allowed = new Set(IdSchema.array().parse(sourceRefs));
  return async (sourceRef: string) => {
    if (!allowed.has(sourceRef)) throw new SourceSemanticsError(403);
    try {
      const url = new URL('/internal/sources/' + encodeURIComponent(sourceRef) + '/semantics', origin);
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        redirect: 'error', signal: AbortSignal.timeout(2000),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new SourceSemanticsError(response.status === 403 || response.status === 404 ? response.status : 503);
      }
      if (!response.body) throw new SourceSemanticsError(503);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new SourceSemanticsError(503);
        }
        chunks.push(value);
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
      const result = SemanticPreflightSchema.parse(JSON.parse(decoded));
      if (result.sourceRef !== sourceRef) throw new SourceSemanticsError(503);
      return result;
    } catch (error) {
      if (error instanceof SourceSemanticsError) throw error;
      throw new SourceSemanticsError(503);
    }
  };
}
