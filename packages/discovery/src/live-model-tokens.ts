import type { ModelTurnV2 } from '../../contracts/src/index.js';

/** Policy-meter heuristic only; not claimed provider billing. */
const BYTES_PER_TOKEN = 4;

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Deterministic UTF-8 byte heuristic for live-model preflight.
 * Inject as `createLiveModelTransport({ estimateTokens })`. Does not throw
 * budget errors — callers use `exceedsModelCeilings`.
 */
export function estimateTokens(turn: ModelTurnV2): { input: number; output: number } {
  const bytes = utf8Bytes(turn.instructions)
    + turn.messages.reduce((sum, message) => sum + utf8Bytes(JSON.stringify(message)), 0)
    + utf8Bytes(JSON.stringify(turn.toolSchemas));
  return {
    input: Math.max(1, Math.ceil(bytes / BYTES_PER_TOKEN)),
    output: turn.limits.maxOutputTokens,
  };
}
