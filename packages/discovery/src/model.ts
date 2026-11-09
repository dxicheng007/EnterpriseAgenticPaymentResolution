import type { Id, ModelResultV2, ModelTurnV2 } from '../../contracts/src/index.js';

export interface ModelClient {
  readonly mode: 'scripted' | 'live';
  readonly modelId: Id;
  run(turn: ModelTurnV2): Promise<ModelResultV2>;
}

export const modelLimits = Object.freeze({ maxInputTokens: 8192, maxOutputTokens: 2048, timeoutMs: 60000 });
