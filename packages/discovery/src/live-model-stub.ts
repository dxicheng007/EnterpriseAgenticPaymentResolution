import type { Id, ModelResultV2, ModelTurnV2 } from '../../contracts/src/index.js';
import { modelLimits, type ModelClient } from './model.js';

export type OfflineLiveModelOptions = {
  configured: boolean;
  modelId: Id;
  /** When true, run waits on `hangUntil` (or forever) so supervisor timeout can fire first. */
  hangUntilAbort?: boolean;
  /** Test gate: settle after timeout interrupt so the adapter Promise can finish. */
  hangUntil?: Promise<unknown>;
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
  const { configured, modelId, hangUntilAbort, hangUntil, preflightTokens, result } = options;
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
        // Prefer hangUntil so tests can release after supervisor timeout; forever hang otherwise.
        await (hangUntil ?? new Promise(() => {}));
        throw new Error('MODEL_HUNG');
      }
      if (!result) {
        throw new Error('MODEL_NO_RESULT');
      }
      return { ...result, dispatchId: turn.dispatchId };
    },
  };
}
