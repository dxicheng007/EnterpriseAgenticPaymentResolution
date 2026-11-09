import type { Id, ModelResultV2, ModelTurnV2 } from '../../contracts/src/index.js';
import { modelLimits, type ModelClient } from './model.js';

export type OfflineLiveModelOptions = {
  configured: boolean;
  modelId: Id;
  hangUntilAbort?: boolean;
  preflightTokens?: { input: number; output: number };
  result?: ModelResultV2;
};

function exceedsCeilings(
  tokens: { input: number; output: number },
  limits: ModelTurnV2['limits'],
): boolean {
  // Deterministic policy meter only; not claimed provider billing.
  return tokens.input > limits.maxInputTokens
    || tokens.output > limits.maxOutputTokens
    || tokens.input > modelLimits.maxInputTokens
    || tokens.output > modelLimits.maxOutputTokens;
}

/** Offline live ModelClient. Options are Discovery stub knobs, not product env secrets. */
export function offlineLiveModel(options: OfflineLiveModelOptions): ModelClient {
  const { configured, modelId, hangUntilAbort, preflightTokens, result } = options;
  return {
    mode: 'live',
    modelId,
    async run(turn: ModelTurnV2): Promise<ModelResultV2> {
      if (!configured) {
        throw new Error('MODEL_UNCONFIGURED');
      }
      if (preflightTokens && exceedsCeilings(preflightTokens, turn.limits)) {
        throw new Error('MODEL_BUDGET_EXCEEDED');
      }
      if (hangUntilAbort) {
        // Never resolves: supervisor timeout / interrupt fences prove unknown accounting without AbortSignal.
        return new Promise(() => {});
      }
      if (!result) {
        throw new Error('MODEL_NO_RESULT');
      }
      return { ...result, dispatchId: turn.dispatchId };
    },
  };
}
