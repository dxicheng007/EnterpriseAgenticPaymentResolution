import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { modelLimits } from '../src/model.js';
import { offlineLiveModel } from '../src/live-model-stub.js';
import type { ModelResultV2, ModelTurnV2 } from '../../contracts/src/index.js';

const turn = (limits: ModelTurnV2['limits'] = { ...modelLimits }): ModelTurnV2 => ({
  schemaVersion: 2,
  dispatchId: 'dispatch-1',
  runId: 'run-1',
  taskId: 'task-1',
  role: 'coordinator',
  instructions: 'Investigate the pinned source capture.',
  messages: [],
  toolSchemas: [],
  limits,
});

const result: ModelResultV2 = {
  schemaVersion: 2,
  dispatchId: 'placeholder',
  providerCallId: 'provider-call',
  toolCalls: [],
  usage: { inputTokens: 11, outputTokens: 7 },
  stopReason: 'done',
};

it('refuses every run when the live stub is unconfigured', async () => {
  const model = offlineLiveModel({ configured: false, modelId: 'live-stub' });
  expect(model.mode).toBe('live');
  await expect(model.run(turn())).rejects.toThrow('MODEL_UNCONFIGURED');
});

it('refuses when preflight tokens exceed turn or model ceilings', async () => {
  const overInput = offlineLiveModel({
    configured: true, modelId: 'live-stub',
    preflightTokens: { input: modelLimits.maxInputTokens + 1, output: 1 },
    result,
  });
  await expect(overInput.run(turn())).rejects.toThrow('MODEL_BUDGET_EXCEEDED');

  const tightTurn = offlineLiveModel({
    configured: true, modelId: 'live-stub',
    preflightTokens: { input: 100, output: 50 },
    result,
  });
  await expect(tightTurn.run(turn({
    maxInputTokens: 50, maxOutputTokens: 2048, timeoutMs: 1000,
  }))).rejects.toThrow('MODEL_BUDGET_EXCEEDED');
});

it('returns an injected result without network and hangs until supervisor timeout', async () => {
  const ready = offlineLiveModel({ configured: true, modelId: 'live-stub', result });
  await expect(ready.run(turn())).resolves.toMatchObject({
    dispatchId: 'dispatch-1',
    providerCallId: 'provider-call',
    usage: { inputTokens: 11, outputTokens: 7 },
    stopReason: 'done',
  });

  let release!: () => void;
  const hangUntil = new Promise<void>(resolve => { release = resolve; });
  const hanging = offlineLiveModel({
    configured: true, modelId: 'live-stub', hangUntilAbort: true, hangUntil,
  });
  const pending = hanging.run(turn());
  const raced = await Promise.race([
    pending.then(() => 'settled', () => 'rejected'),
    new Promise<'hanging'>(resolve => setTimeout(() => resolve('hanging'), 20)),
  ]);
  expect(raced).toBe('hanging');
  release();
  await expect(pending).rejects.toThrow('MODEL_HUNG');
});

it('keeps credentials and product env reads out of the stub module', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/live-model-stub.ts', import.meta.url)), 'utf8');
  expect(source).not.toMatch(/OPENAI_|API_KEY|apiKey|process\.env/);
});
