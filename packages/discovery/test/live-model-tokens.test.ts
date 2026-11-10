import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import type { ModelTurnV2 } from '../../contracts/src/index.js';
import { exceedsModelCeilings, modelLimits } from '../src/model.js';
import { estimateTokens } from '../src/live-model-tokens.js';
import { createLiveModelTransport } from '../src/live-model-transport.js';

const turn = (overrides: Partial<ModelTurnV2> = {}): ModelTurnV2 => ({
  schemaVersion: 2,
  dispatchId: 'dispatch-1',
  runId: 'run-1',
  taskId: 'task-1',
  role: 'coordinator',
  instructions: 'Investigate the pinned source capture.',
  messages: [{ kind: 'text', role: 'user', text: 'What accounts are present?' }],
  toolSchemas: [{
    name: 'describeSource',
    description: 'Describe the pinned source.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  }],
  limits: { ...modelLimits },
  ...overrides,
});

it('returns a deterministic input/output estimate from turn content', () => {
  const first = estimateTokens(turn());
  const second = estimateTokens(turn());
  expect(first).toEqual(second);
  expect(first.input).toBeGreaterThan(0);
  expect(first.output).toBeGreaterThan(0);
  expect(Number.isSafeInteger(first.input)).toBe(true);
  expect(Number.isSafeInteger(first.output)).toBe(true);
});

it('grows the input estimate with messages and toolSchemas', () => {
  const base = estimateTokens(turn({ messages: [], toolSchemas: [] }));
  const withMessage = estimateTokens(turn({
    messages: [{ kind: 'text', role: 'user', text: 'x'.repeat(400) }],
    toolSchemas: [],
  }));
  const withSchemas = estimateTokens(turn({
    messages: [],
    toolSchemas: [{ name: 'tool', description: 'd'.repeat(400), inputSchema: { type: 'object' } }],
  }));
  expect(withMessage.input).toBeGreaterThan(base.input);
  expect(withSchemas.input).toBeGreaterThan(base.input);
});

it('counts UTF-8 bytes so multi-byte text exceeds same-length ASCII', () => {
  const ascii = estimateTokens(turn({
    messages: [{ kind: 'text', role: 'user', text: 'aaaa' }],
    toolSchemas: [],
  }));
  const multiByte = estimateTokens(turn({
    messages: [{ kind: 'text', role: 'user', text: 'ääää' }],
    toolSchemas: [],
  }));
  expect(multiByte.input).toBeGreaterThan(ascii.input);
});

it('stays under ceilings for modest turns and over for oversized input', () => {
  const modest = estimateTokens(turn());
  expect(exceedsModelCeilings(modest, turn().limits)).toBe(false);

  const oversized = estimateTokens(turn({
    instructions: 'i'.repeat(modelLimits.maxInputTokens * 8),
    messages: [],
    toolSchemas: [],
  }));
  expect(oversized.input).toBeGreaterThan(modelLimits.maxInputTokens);
  expect(exceedsModelCeilings(oversized, turn().limits)).toBe(true);
});

it('is injectable into live transport preflight without throwing from the helper', async () => {
  const fetchMock = vi.fn();
  await expect(createLiveModelTransport({
    configured: true,
    modelId: 'gpt-test',
    baseUrl: 'https://example.test/v1',
    apiKey: 'secret',
    fetch: fetchMock as typeof fetch,
    estimateTokens,
  }).run(turn({
    instructions: 'i'.repeat(modelLimits.maxInputTokens * 8),
    messages: [],
    toolSchemas: [],
  }))).rejects.toThrow('MODEL_BUDGET_EXCEEDED');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(() => estimateTokens(turn())).not.toThrow();
});

it('keeps product env reads out of the tokens module', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/live-model-tokens.ts', import.meta.url)), 'utf8');
  expect(source).not.toMatch(/process\.env|OPENAI_|ANTHROPIC_|EAPR_MODEL_/);
});
