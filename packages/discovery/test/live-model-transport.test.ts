import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelResultV2Schema, type ModelTurnV2 } from '../../contracts/src/index.js';
import { estimateTokens } from '../src/live-model-tokens.js';
import { modelLimits } from '../src/model.js';
import { createLiveModelTransport } from '../src/live-model-transport.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

const transport = (fetchMock: typeof fetch, estimate = estimateTokens) => createLiveModelTransport({
  configured: true, modelId: 'gpt-test', baseUrl: 'https://example.test/v1', apiKey: 'secret',
  fetch: fetchMock, estimateTokens: estimate,
});

it('refuses without network when unconfigured', async () => {
  const fetchMock = vi.fn();
  await expect(createLiveModelTransport({
    configured: false, modelId: 'gpt-test', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    fetch: fetchMock as typeof fetch, estimateTokens,
  }).run(turn())).rejects.toThrow('MODEL_UNCONFIGURED');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('requires a valid budget preflight before calling the provider', async () => {
  const fetchMock = vi.fn();
  await expect(transport(fetchMock as typeof fetch, () => ({
    input: modelLimits.maxInputTokens + 1, output: 1,
  })).run(turn())).rejects.toThrow('MODEL_BUDGET_EXCEEDED');
  await expect(transport(fetchMock as typeof fetch, () => ({ input: Number.NaN, output: 1 })).run(turn()))
    .rejects.toThrow('MODEL_BUDGET_EXCEEDED');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('preserves assistant tool calls and tool results in the provider transcript', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    id: 'chatcmpl-abc',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }],
    usage: { prompt_tokens: 12, completion_tokens: 4 },
  }));
  await transport(fetchMock as typeof fetch).run(turn({
    messages: [
      { kind: 'text', role: 'user', text: 'What accounts are present?' },
      {
        kind: 'assistant_tool_calls',
        calls: [{
          toolStepId: 'step-1', providerToolCallId: 'call-1', name: 'describeSource', arguments: { pinned: true },
        }],
      },
      { kind: 'tool_result', toolStepId: 'step-1', name: 'describeSource', result: { accounts: ['a'] } },
    ],
  }));
  const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
  expect(body.messages).toEqual([
    { role: 'system', content: 'Investigate the pinned source capture.' },
    { role: 'user', content: 'What accounts are present?' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call-1', type: 'function',
        function: { name: 'describeSource', arguments: '{"pinned":true}' },
      }],
    },
    { role: 'tool', tool_call_id: 'call-1', content: '{"accounts":["a"]}' },
  ]);
});

it('maps a chat completion into ModelResultV2', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    id: 'chatcmpl-abc',
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'describeSource', arguments: '{}' } }],
      },
    }],
    usage: { prompt_tokens: 12, completion_tokens: 4 },
  }));
  const result = await transport(fetchMock as typeof fetch).run(turn());
  expect(ModelResultV2Schema.parse(result)).toMatchObject({
    dispatchId: 'dispatch-1',
    providerCallId: 'chatcmpl-abc',
    stopReason: 'tool_calls',
    toolCalls: [{ id: 'call-1', name: 'describeSource', arguments: {} }],
    usage: { inputTokens: 12, outputTokens: 4 },
  });
});

it('rejects missing provider usage instead of inventing zeros', async () => {
  await expect(transport(vi.fn().mockResolvedValue(Response.json({
    id: 'chatcmpl-abc',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
  })) as typeof fetch).run(turn())).rejects.toThrow('MODEL_PROVIDER_ERROR');
});

it('rejects empty choices and invented completion ids', async () => {
  await expect(transport(vi.fn().mockResolvedValue(Response.json({
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  })) as typeof fetch).run(turn())).rejects.toThrow('MODEL_PROVIDER_ERROR');
});

it('maps length finish with tool calls to non-executable limit', async () => {
  const result = await transport(vi.fn().mockResolvedValue(Response.json({
    id: 'chatcmpl-len',
    choices: [{
      finish_reason: 'length',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'describeSource', arguments: '{}' } }],
      },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  })) as typeof fetch).run(turn());
  expect(result.stopReason).toBe('limit');
  expect(result.toolCalls).toEqual([]);
});

it('fails closed on non-OK provider responses', async () => {
  await expect(transport(vi.fn().mockResolvedValue(new Response('nope', { status: 503 })) as typeof fetch)
    .run(turn())).rejects.toThrow('MODEL_PROVIDER_ERROR');
});

it('maps malformed tool-call arguments to MODEL_PROVIDER_ERROR', async () => {
  await expect(transport(vi.fn().mockResolvedValue(Response.json({
    id: 'chatcmpl-bad',
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'describeSource', arguments: '{' } }],
      },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  })) as typeof fetch).run(turn())).rejects.toThrow('MODEL_PROVIDER_ERROR');
});

it('rejects oversized provider bodies before normalization', async () => {
  const huge = 'x'.repeat(300_000);
  await expect(transport(vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: 'chatcmpl-huge',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: huge } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }))) as typeof fetch).run(turn())).rejects.toThrow('MODEL_PROVIDER_ERROR');
});

it('keeps product env reads out of the transport module', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/live-model-transport.ts', import.meta.url)), 'utf8');
  expect(source).not.toMatch(/process\.env|OPENAI_|ANTHROPIC_|EAPR_MODEL_/);
});
