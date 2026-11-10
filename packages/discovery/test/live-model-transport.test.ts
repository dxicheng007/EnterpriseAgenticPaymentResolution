import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelResultV2Schema, type ModelResultV2, type ModelTurnV2 } from '../../contracts/src/index.js';
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

it('refuses without network when unconfigured or credentials are missing', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(createLiveModelTransport({
    configured: false, provider: 'openai', modelId: 'gpt-test', baseUrl: 'https://example.test/v1', apiKey: 'secret',
  }).run(turn())).rejects.toThrow('MODEL_UNCONFIGURED');
  await expect(createLiveModelTransport({
    configured: true, provider: 'openai', modelId: 'gpt-test', baseUrl: '', apiKey: 'secret',
  }).run(turn())).rejects.toThrow('MODEL_UNCONFIGURED');
  await expect(createLiveModelTransport({
    configured: true, provider: 'anthropic', modelId: 'claude-test', baseUrl: 'https://example.test/v1', apiKey: '  ',
  }).run(turn())).rejects.toThrow('MODEL_UNCONFIGURED');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('refuses over-budget turns before calling the provider', async () => {
  const fetchMock = vi.fn();
  const model = createLiveModelTransport({
    configured: true, provider: 'openai', modelId: 'gpt-test',
    baseUrl: 'https://example.test/v1', apiKey: 'secret', fetch: fetchMock as typeof fetch,
    estimateTokens: () => ({ input: modelLimits.maxInputTokens + 1, output: 1 }),
  });
  await expect(model.run(turn())).rejects.toThrow('MODEL_BUDGET_EXCEEDED');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('maps an OpenAI chat completion into a validated ModelResultV2', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    id: 'chatcmpl-abc',
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'describeSource', arguments: '{}' },
        }],
      },
    }],
    usage: { prompt_tokens: 12, completion_tokens: 4 },
  }));
  const model = createLiveModelTransport({
    configured: true, provider: 'openai', modelId: 'gpt-test',
    baseUrl: 'https://example.test/v1', apiKey: 'secret', fetch: fetchMock as typeof fetch,
  });
  const result = await model.run(turn());
  expect(ModelResultV2Schema.parse(result)).toMatchObject({
    schemaVersion: 2,
    dispatchId: 'dispatch-1',
    providerCallId: 'chatcmpl-abc',
    stopReason: 'tool_calls',
    toolCalls: [{ id: 'call-1', name: 'describeSource', arguments: {} }],
    usage: { inputTokens: 12, outputTokens: 4 },
  } satisfies Partial<ModelResultV2>);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe('https://example.test/v1/chat/completions');
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
  const body = JSON.parse(init.body as string);
  expect(body.model).toBe('gpt-test');
  expect(body.messages[0]).toEqual({ role: 'system', content: 'Investigate the pinned source capture.' });
  expect(body.tools[0]).toMatchObject({
    type: 'function', function: { name: 'describeSource', parameters: { type: 'object' } },
  });
});

it('maps an Anthropic messages response into a validated ModelResultV2', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    id: 'msg-abc',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'No accounts yet.' }],
    usage: { input_tokens: 9, output_tokens: 3 },
  }));
  const model = createLiveModelTransport({
    configured: true, provider: 'anthropic', modelId: 'claude-test',
    baseUrl: 'https://example.test/v1', apiKey: 'secret', fetch: fetchMock as typeof fetch,
  });
  const result = await model.run(turn());
  expect(ModelResultV2Schema.parse(result)).toMatchObject({
    dispatchId: 'dispatch-1',
    providerCallId: 'msg-abc',
    message: 'No accounts yet.',
    stopReason: 'done',
    toolCalls: [],
    usage: { inputTokens: 9, outputTokens: 3 },
  });
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe('https://example.test/v1/messages');
  expect(new Headers(init.headers).get('x-api-key')).toBe('secret');
  expect(new Headers(init.headers).get('anthropic-version')).toBe('2023-06-01');
  const body = JSON.parse(init.body as string);
  expect(body.system).toBe('Investigate the pinned source capture.');
  expect(body.tools[0]).toMatchObject({ name: 'describeSource', input_schema: { type: 'object' } });
});

it('fails closed on non-OK provider responses without inventing usage', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
  const model = createLiveModelTransport({
    configured: true, provider: 'openai', modelId: 'gpt-test',
    baseUrl: 'https://example.test/v1', apiKey: 'secret', fetch: fetchMock as typeof fetch,
  });
  await expect(model.run(turn())).rejects.toThrow('MODEL_PROVIDER_ERROR');
});

it('keeps product env reads out of the transport module', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/live-model-transport.ts', import.meta.url)), 'utf8');
  expect(source).not.toMatch(/process\.env/);
  expect(source).not.toMatch(/OPENAI_/);
  expect(source).not.toMatch(/ANTHROPIC_/);
  expect(source).not.toMatch(/EAPR_MODEL_/);
});
