import type { Id, ModelResultV2, ModelTurnV2 } from '../../contracts/src/index.js';
import type { ModelClient } from './model.js';

export type OfflineLiveModelOptions = {
  configured: boolean;
  modelId: Id;
  hangUntilAbort?: boolean;
  preflightTokens?: { input: number; output: number };
  result?: ModelResultV2;
};

/** Offline live ModelClient. Options are Discovery stub knobs, not product env secrets. */
export function offlineLiveModel(options: OfflineLiveModelOptions): ModelClient {
  const { configured, modelId, hangUntilAbort, result } = options;
  return {
    mode: 'live',
    modelId,
    async run(turn: ModelTurnV2): Promise<ModelResultV2> {
      if (!configured) {
        throw new Error('MODEL_UNCONFIGURED');
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
