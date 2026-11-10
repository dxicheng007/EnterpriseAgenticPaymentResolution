import type { Id, ModelResultV2, ModelTurnV2 } from '../../contracts/src/index.js';

export interface ModelClient {
  readonly mode: 'scripted' | 'live';
  readonly modelId: Id;
  run(turn: ModelTurnV2): Promise<ModelResultV2>;
}

export const modelLimits = Object.freeze({ maxInputTokens: 8192, maxOutputTokens: 2048, timeoutMs: 60000 });

/** Deterministic policy meter against turn and package ceilings; not claimed provider billing. */
export function exceedsModelCeilings(
  tokens: { input: number; output: number },
  limits: ModelTurnV2['limits'],
): boolean {
  if (!Number.isInteger(tokens.input) || !Number.isInteger(tokens.output) || tokens.input < 0 || tokens.output < 0) {
    return true;
  }
  return tokens.input > limits.maxInputTokens
    || tokens.output > limits.maxOutputTokens
    || tokens.input > modelLimits.maxInputTokens
    || tokens.output > modelLimits.maxOutputTokens;
}
