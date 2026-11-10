import { ModelResultV2Schema, type Id, type ModelMessageV2, type ModelResultV2, type ModelTurnV2 } from '../../contracts/src/index.js';
import { exceedsModelCeilings, type ModelClient } from './model.js';

const MAX_RESPONSE_BYTES = 256 * 1024;

export type LiveModelTransportOptions = {
  configured: boolean;
  modelId: Id;
  /** API root such as https://api.openai.com/v1 — injected, never read from env here. */
  baseUrl: string;
  /** Injected credential — not a product env binding. */
  apiKey: string;
  fetch?: typeof fetch;
  /** Required deterministic preflight meter — refuse live I/O when absent/invalid/over ceiling. */
  estimateTokens: (turn: ModelTurnV2) => { input: number; output: number };
};

function providerMessages(messages: ModelMessageV2[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const nativeByStep = new Map<string, string>();
  for (const message of messages) {
    if (message.kind === 'text') {
      out.push({ role: message.role, content: message.text });
      continue;
    }
    if (message.kind === 'assistant_tool_calls') {
      for (const call of message.calls) nativeByStep.set(call.toolStepId, call.providerToolCallId);
      out.push({
        role: 'assistant',
        content: null,
        tool_calls: message.calls.map(call => ({
          id: call.providerToolCallId,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      });
      continue;
    }
    const toolCallId = nativeByStep.get(message.toolStepId);
    if (!toolCallId) throw new Error('MODEL_PROVIDER_ERROR');
    out.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify(message.result),
    });
  }
  return out;
}

function safeUsage(raw: unknown): { inputTokens: number; outputTokens: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('MODEL_PROVIDER_ERROR');
  const { prompt_tokens: input, completion_tokens: output } = raw as Record<string, unknown>;
  if (!Number.isInteger(input) || !Number.isInteger(output) || (input as number) < 0 || (output as number) < 0) {
    throw new Error('MODEL_PROVIDER_ERROR');
  }
  return { inputTokens: input as number, outputTokens: output as number };
}

function finishStopReason(finish: unknown, toolCount: number): ModelResultV2['stopReason'] {
  if (finish === 'tool_calls') {
    if (toolCount < 1) throw new Error('MODEL_PROVIDER_ERROR');
    return 'tool_calls';
  }
  if (finish === 'length') return 'limit';
  if (finish === 'content_filter' || finish === 'refusal') return 'error';
  if (finish === 'stop') {
    if (toolCount > 0) throw new Error('MODEL_PROVIDER_ERROR');
    return 'done';
  }
  throw new Error('MODEL_PROVIDER_ERROR');
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const buffer = Buffer.from(await response.arrayBuffer().catch(() => {
    throw new Error('MODEL_PROVIDER_ERROR');
  }));
  if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error('MODEL_PROVIDER_ERROR');
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    throw new Error('MODEL_PROVIDER_ERROR');
  }
}

/**
 * OpenAI-compatible chat completions ModelClient.
 * Composition injects baseUrl/apiKey; default composition stays unmounted until Blocker D.
 */
export function createLiveModelTransport(options: LiveModelTransportOptions): ModelClient {
  const { configured, modelId, baseUrl, apiKey, estimateTokens } = options;
  const fetchImpl = options.fetch ?? fetch;
  return {
    mode: 'live',
    modelId,
    async run(turn: ModelTurnV2): Promise<ModelResultV2> {
      const root = baseUrl.replace(/\/+$/, '');
      if (!configured || root === '' || apiKey.trim() === '') throw new Error('MODEL_UNCONFIGURED');
      if (typeof estimateTokens !== 'function') throw new Error('MODEL_BUDGET_EXCEEDED');
      const estimate = estimateTokens(turn);
      if (
        !estimate ||
        !Number.isInteger(estimate.input) || !Number.isInteger(estimate.output) ||
        estimate.input < 0 || estimate.output < 0 ||
        exceedsModelCeilings(estimate, turn.limits)
      ) {
        throw new Error('MODEL_BUDGET_EXCEEDED');
      }

      const messages = [
        { role: 'system', content: turn.instructions },
        ...providerMessages(turn.messages),
      ];
      const tools = turn.toolSchemas.flatMap(schema => {
        if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
        const { name, description, inputSchema } = schema as Record<string, unknown>;
        if (typeof name !== 'string' || !inputSchema || typeof inputSchema !== 'object') return [];
        return [{
          type: 'function',
          function: {
            name,
            description: typeof description === 'string' ? description : '',
            parameters: inputSchema,
          },
        }];
      });

      const requestBody = JSON.stringify({
        model: modelId,
        messages,
        tools,
        max_tokens: turn.limits.maxOutputTokens,
      });
      // Bound the actual serialized provider payload against the same ceilings.
      const requestTokens = {
        input: Math.max(1, Math.ceil(Buffer.byteLength(requestBody, 'utf8') / 4)),
        output: turn.limits.maxOutputTokens,
      };
      if (exceedsModelCeilings(requestTokens, turn.limits)) throw new Error('MODEL_BUDGET_EXCEEDED');

      const response = await fetchImpl(`${root}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: requestBody,
      }).catch(() => {
        throw new Error('MODEL_PROVIDER_ERROR');
      });
      if (!response.ok) throw new Error('MODEL_PROVIDER_ERROR');

      const body = await readBoundedJson(response);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('MODEL_PROVIDER_ERROR');
      const record = body as Record<string, unknown>;
      if (typeof record.id !== 'string' || record.id.trim() === '') throw new Error('MODEL_PROVIDER_ERROR');
      const usage = safeUsage(record.usage);
      const choices = record.choices;
      if (!Array.isArray(choices) || choices.length !== 1 || !choices[0] || typeof choices[0] !== 'object') {
        throw new Error('MODEL_PROVIDER_ERROR');
      }
      const choice = choices[0] as Record<string, unknown>;
      const message = choice.message;
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('MODEL_PROVIDER_ERROR');
      const msg = message as Record<string, unknown>;
      const rawCalls = msg.tool_calls;
      let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
      if (rawCalls !== undefined) {
        if (!Array.isArray(rawCalls)) throw new Error('MODEL_PROVIDER_ERROR');
        try {
          toolCalls = rawCalls.map(call => {
            if (!call || typeof call !== 'object' || Array.isArray(call)) throw new Error('bad call');
            const entry = call as Record<string, unknown>;
            const fn = entry.function;
            if (typeof entry.id !== 'string' || entry.id.trim() === '') throw new Error('bad id');
            if (!fn || typeof fn !== 'object' || Array.isArray(fn)) throw new Error('bad fn');
            const fnRec = fn as Record<string, unknown>;
            if (typeof fnRec.name !== 'string' || fnRec.name.trim() === '') throw new Error('bad name');
            if (typeof fnRec.arguments !== 'string') throw new Error('bad args');
            const parsed = JSON.parse(fnRec.arguments) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad args obj');
            return { id: entry.id, name: fnRec.name, arguments: parsed as Record<string, unknown> };
          });
        } catch {
          throw new Error('MODEL_PROVIDER_ERROR');
        }
      }

      const stopReason = finishStopReason(choice.finish_reason, toolCalls.length);
      if (typeof msg.content === 'string' && Buffer.byteLength(msg.content, 'utf8') > 2000) {
        throw new Error('MODEL_PROVIDER_ERROR');
      }
      const text = typeof msg.content === 'string' ? msg.content : undefined;

      return ModelResultV2Schema.parse({
        schemaVersion: 2,
        dispatchId: turn.dispatchId,
        providerCallId: record.id,
        ...(text ? { message: text } : {}),
        toolCalls: stopReason === 'tool_calls' ? toolCalls : [],
        usage,
        stopReason,
      });
    },
  };
}
