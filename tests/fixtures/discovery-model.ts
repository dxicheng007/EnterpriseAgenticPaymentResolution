import type { ModelResultV2, ModelTurnV2 } from '../../packages/contracts/src/index.js';
import type { ModelClient } from '../../packages/discovery/src/model.js';

export function barrier<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function modelResult(turn: ModelTurnV2, toolCalls: ModelResultV2['toolCalls'] = []): ModelResultV2 {
  return { schemaVersion: 2, dispatchId: turn.dispatchId, providerCallId: 'provider-call',
    toolCalls, usage: { inputTokens: 11, outputTokens: 7 }, stopReason: toolCalls.length ? 'tool_calls' : 'done' };
}

export function scriptedModel() {
  const pending: ReturnType<typeof barrier<ModelTurnV2>>[] = [];
  const results: ReturnType<typeof barrier<ModelResultV2>>[] = [];
  let calls = 0;
  function at(index: number) {
    return { turn: (pending[index] ??= barrier<ModelTurnV2>()), result: (results[index] ??= barrier<ModelResultV2>()) };
  }
  const model: ModelClient = {
    mode: 'scripted', modelId: 'script',
    run(turn) {
      const invocation = at(calls++);
      invocation.turn.resolve(turn);
      return invocation.result.promise;
    },
  };
  return { at, model, get calls() { return calls; } };
}
