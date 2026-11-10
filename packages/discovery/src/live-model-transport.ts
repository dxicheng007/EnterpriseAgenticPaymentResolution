import {
  IdSchema, ModelResultV2Schema, type Id, type ModelResultV2, type ModelTurnV2,
} from '../../contracts/src/index.js';
import { exceedsModelCeilings, type ModelClient } from './model.js';

export type LiveModelProvider = 'openai' | 'anthropic';

export type LiveModelTransportOptions = {
  configured: boolean;
  provider: LiveModelProvider;
  modelId: Id;
  /** Absolute provider API root, e.g. https://api.openai.com/v1 — injected by composition, never read from env here. */
  baseUrl: string;
  /** Injected credential. Discovery does not read product env names in this module. */
  apiKey: string;
  fetch?: typeof fetch;
  estimateTokens?: (turn: ModelTurnV2) => { input: number; output: number };
  /** Anthropic-only header; defaults to a known Messages API version. */
  anthropicVersion?: string;
};

type DiscoveryToolSchema = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

function trimRoot(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function asToolSchema(value: unknown): DiscoveryToolSchema | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || !record.inputSchema || typeof record.inputSchema !== 'object') {
    return undefined;
  }
  return {
    name: record.name,
    description: typeof record.description === 'string' ? record.description : undefined,
    inputSchema: record.inputSchema as Record<string, unknown>,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new Error('MODEL_PROVIDER_INVALID');
}

function requireId(value: unknown, label: string): Id {
  const parsed = typeof value === 'string' ? IdSchema.safeParse(value) : undefined;
  if (!parsed?.success) throw new Error(`MODEL_PROVIDER_INVALID:${label}`);
  return parsed.data;
}

function providerToolCallId(turn: ModelTurnV2, toolStepId: string): string {
  for (const message of turn.messages) {
    if (message.kind !== 'assistant_tool_calls') continue;
    const match = message.calls.find(call => call.toolStepId === toolStepId);
    if (match) return match.providerToolCallId;
  }
  throw new Error('MODEL_PROVIDER_INVALID:toolStepId');
}

function openaiMessages(turn: ModelTurnV2) {
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: turn.instructions },
  ];
  for (const message of turn.messages) {
    if (message.kind === 'text') {
      messages.push({ role: message.role, content: message.text });
    } else if (message.kind === 'assistant_tool_calls') {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: message.calls.map(call => ({
          id: call.providerToolCallId,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      });
    } else {
      messages.push({
        role: 'tool',
        tool_call_id: providerToolCallId(turn, message.toolStepId),
        content: JSON.stringify(message.result),
      });
    }
  }
  return messages;
}

function anthropicMessages(turn: ModelTurnV2) {
  const messages: Array<Record<string, unknown>> = [];
  for (const message of turn.messages) {
    if (message.kind === 'text') {
      messages.push({ role: message.role, content: message.text });
    } else if (message.kind === 'assistant_tool_calls') {
      messages.push({
        role: 'assistant',
        content: message.calls.map(call => ({
          type: 'tool_use',
          id: call.providerToolCallId,
          name: call.name,
          input: call.arguments,
        })),
      });
    } else {
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: providerToolCallId(turn, message.toolStepId),
          content: JSON.stringify(message.result),
        }],
      });
    }
  }
  return messages;
}

function openaiTools(turn: ModelTurnV2) {
  return turn.toolSchemas.flatMap(schema => {
    const tool = asToolSchema(schema);
    if (!tool) return [];
    return [{
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
      },
    }];
  });
}

function anthropicTools(turn: ModelTurnV2) {
  return turn.toolSchemas.flatMap(schema => {
    const tool = asToolSchema(schema);
    if (!tool) return [];
    return [{
      name: tool.name,
      description: tool.description ?? '',
      input_schema: tool.inputSchema,
    }];
  });
}

function mapOpenAIResult(dispatchId: Id, body: Record<string, unknown>): ModelResultV2 {
  const choice = Array.isArray(body.choices) ? body.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.message && typeof choice.message === 'object'
    ? choice.message as Record<string, unknown> : undefined;
  const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'stop';
  const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawCalls.map((call, index) => {
    const record = call && typeof call === 'object' ? call as Record<string, unknown> : {};
    const fn = record.function && typeof record.function === 'object'
      ? record.function as Record<string, unknown> : {};
    const argsRaw = typeof fn.arguments === 'string' ? fn.arguments : '{}';
    return {
      id: requireId(record.id ?? `tool-${index + 1}`, 'toolCallId'),
      name: typeof fn.name === 'string' ? fn.name : '',
      arguments: parseJsonObject(argsRaw),
    };
  });
  if (toolCalls.some(call => call.name === '')) throw new Error('MODEL_PROVIDER_INVALID:toolName');
  const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {};
  const text = typeof message?.content === 'string' ? message.content.slice(0, 2000) : undefined;
  const stopReason = toolCalls.length > 0 || finish === 'tool_calls' ? 'tool_calls'
    : finish === 'length' ? 'limit'
      : finish === 'content_filter' ? 'error'
        : 'done';
  return ModelResultV2Schema.parse({
    schemaVersion: 2,
    dispatchId,
    providerCallId: requireId(body.id ?? 'openai-call', 'providerCallId'),
    ...(text ? { message: text } : {}),
    toolCalls: stopReason === 'tool_calls' ? toolCalls : [],
    usage: {
      inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
      outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    },
    stopReason,
  });
}

function mapAnthropicResult(dispatchId: Id, body: Record<string, unknown>): ModelResultV2 {
  const blocks = Array.isArray(body.content) ? body.content : [];
  const toolCalls = [];
  const texts: string[] = [];
  for (const [index, block] of blocks.entries()) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') texts.push(record.text);
    if (record.type === 'tool_use') {
      toolCalls.push({
        id: requireId(record.id ?? `tool-${index + 1}`, 'toolCallId'),
        name: typeof record.name === 'string' ? record.name : '',
        arguments: record.input && typeof record.input === 'object' && !Array.isArray(record.input)
          ? record.input as Record<string, unknown>
          : {},
      });
    }
  }
  if (toolCalls.some(call => call.name === '')) throw new Error('MODEL_PROVIDER_INVALID:toolName');
  const finish = typeof body.stop_reason === 'string' ? body.stop_reason : 'end_turn';
  const stopReason = toolCalls.length > 0 || finish === 'tool_use' ? 'tool_calls'
    : finish === 'max_tokens' ? 'limit'
      : finish === 'refusal' ? 'error'
        : 'done';
  const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {};
  const text = texts.join('\n').slice(0, 2000);
  return ModelResultV2Schema.parse({
    schemaVersion: 2,
    dispatchId,
    providerCallId: requireId(body.id ?? 'anthropic-call', 'providerCallId'),
    ...(text ? { message: text } : {}),
    toolCalls: stopReason === 'tool_calls' ? toolCalls : [],
    usage: {
      inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    },
    stopReason,
  });
}

/**
 * Injected-config live ModelClient for OpenAI Chat Completions or Anthropic Messages.
 * Composition must supply baseUrl/apiKey; this module never reads product env names.
 * Keep default control composition unmounted until Blocker D freezes env/model identity.
 */
export function createLiveModelTransport(options: LiveModelTransportOptions): ModelClient {
  const {
    configured, provider, modelId, baseUrl, apiKey, estimateTokens,
    anthropicVersion = '2023-06-01',
  } = options;
  const fetchImpl = options.fetch ?? fetch;
  return {
    mode: 'live',
    modelId,
    async run(turn: ModelTurnV2): Promise<ModelResultV2> {
      const root = trimRoot(baseUrl);
      if (!configured || root === '' || apiKey.trim() === '') {
        throw new Error('MODEL_UNCONFIGURED');
      }
      if (estimateTokens && exceedsModelCeilings(estimateTokens(turn), turn.limits)) {
        throw new Error('MODEL_BUDGET_EXCEEDED');
      }

      const url = provider === 'openai' ? `${root}/chat/completions` : `${root}/messages`;
      const headers: Record<string, string> = provider === 'openai'
        ? { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        : {
          'x-api-key': apiKey,
          'anthropic-version': anthropicVersion,
          'Content-Type': 'application/json',
        };
      const requestBody = provider === 'openai'
        ? {
          model: modelId,
          messages: openaiMessages(turn),
          tools: openaiTools(turn),
          max_tokens: turn.limits.maxOutputTokens,
        }
        : {
          model: modelId,
          system: turn.instructions,
          messages: anthropicMessages(turn),
          tools: anthropicTools(turn),
          max_tokens: turn.limits.maxOutputTokens,
        };

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        });
      } catch {
        throw new Error('MODEL_PROVIDER_ERROR');
      }
      if (!response.ok) throw new Error('MODEL_PROVIDER_ERROR');

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('MODEL_PROVIDER_INVALID');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('MODEL_PROVIDER_INVALID');
      }
      const responseBody = payload as Record<string, unknown>;
      return provider === 'openai'
        ? mapOpenAIResult(turn.dispatchId, responseBody)
        : mapAnthropicResult(turn.dispatchId, responseBody);
    },
  };
}
