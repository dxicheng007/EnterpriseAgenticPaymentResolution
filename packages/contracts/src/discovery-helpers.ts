import { InvalidCursorError } from './activity.js';
import { canonicalJson, hashCanonical } from './canonical.js';
import { IdSchema, strict, type Id } from './common.js';
import { ControlActivityWindowSchema, DiscoveryCursorV1Schema, type DiscoveryCursorV1 } from './discovery.js';

const toolStepInput = strict({ dispatchId: IdSchema, providerToolCallId: IdSchema });

export function createToolStepId(input: { dispatchId: Id; providerToolCallId: Id }): Id {
  return 'step:' + hashCanonical(toolStepInput.parse(input));
}

export class DiscoveryResyncRequiredError extends Error {
  readonly code = 'RESYNC_REQUIRED';
  constructor() { super('Discovery activity cursor precedes the retained window'); }
}

export function encodeDiscoveryCursor(input: DiscoveryCursorV1): string {
  return Buffer.from(canonicalJson(DiscoveryCursorV1Schema.parse(input)), 'utf8').toString('base64url');
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

export function decodeDiscoveryCursor(
  wire: string,
  expected: { runId: Id; highWater: number; retainedAfter: number },
): DiscoveryCursorV1 {
  const runId = IdSchema.parse(expected.runId);
  const { highWater, retainedAfter } = ControlActivityWindowSchema.parse({
    highWater: expected.highWater, retainedAfter: expected.retainedAfter,
  });
  if (wire.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(wire)) throw new InvalidCursorError();

  let cursor: DiscoveryCursorV1;
  try {
    cursor = DiscoveryCursorV1Schema.parse(JSON.parse(utf8.decode(Buffer.from(wire, 'base64url'))));
    if (encodeDiscoveryCursor(cursor) !== wire || cursor.runId !== runId || cursor.controlCursor > highWater) {
      throw new InvalidCursorError();
    }
  } catch {
    throw new InvalidCursorError();
  }
  if (cursor.controlCursor < retainedAfter) throw new DiscoveryResyncRequiredError();
  return cursor;
}
