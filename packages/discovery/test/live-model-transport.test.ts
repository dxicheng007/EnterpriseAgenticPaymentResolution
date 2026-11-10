import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelResultV2Schema, type ModelTurnV2 } from '../../contracts/src/index.js';
import { modelLimits } from '../src/model.js';
import { createLiveModelTransport } from '../src/live-model-transport.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const turn = (): ModelTurnV2 => ({
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
});

it('refuses without network when unconfigured', async () => {
  const fetchMock = vi.fn();
  await expect(createLiveModelTransport({
    configured: false, modelId: 'gpt-test', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    fetch: fetchMock as typeof fetch,
  }).run(turn())).rejects.toThrow('MODEL_UNCONFIGURED');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('refuses over-budget turns before calling the provider', async () => {
  const fetchMock = vi.fn();
  await expect(createLiveModelTransport({
    configured: true, modelId: 'gpt-test', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    fetch: fetchMock as typeof fetch,
    estimateTokens: () => ({ input: modelLimits.maxInputTokens + 1, output: 1 }),
  }).run(turn())).rejects.toThrow('MODEL_BUDGET_EXCEEDED');
  expect(fetchMock).not.toHaveBeenCalled();
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
  const result = await createLiveModelTransport({
    configured: true, modelId: 'gpt-test', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    fetch: fetchMock as typeof fetch,
  }).run(turn());
  expect(ModelResultV2Schema.parse(result)).toMatchObject({
    dispatchId: 'dispatch-1',
    providerCallId: 'chatcmpl-abc',
    stopReason: 'tool_calls',
    toolCalls: [{ id: 'call-1', name: 'describeSource', arguments: {} }],
    usage: { inputTokens: 12, outputTokens: 4 },
  });
  expect(fetchMock.mock.calls[0]![0]).toBe('https://example.test/v1/chat/completions');
});

it('fails closed on non-OK provider responses', async () => {
  await expect(createLiveModelTransport({
    configured: true, modelId: 'gpt-test', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    fetch: vi.fn().mockResolvedValue(new Response('nope', { status: 503 })) as typeof fetch,
  }).run(turn())).rejects.toThrow('MODEL_PROVIDER_ERROR');
});

it('maps malformed tool-call arguments to MODEL_PROVIDER_ERROR', async () => {
  await expect(createLiveModelTransport({
    configured: true, modelId: 'gpt-test', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    fetch: vi.fn().mockResolvedValue(Response.json({
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
    })) as typeof fetch,
  }).run(turn())).rejects.toThrow('MODEL_PROVIDER_ERROR');
});

it('keeps product env reads out of the transport module', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/live-model-transport.ts', import.meta.url)), 'utf8');
  expect(source).not.toMatch(/process\.env|OPENAI_|ANTHROPIC_|EAPR_MODEL_/);
});
