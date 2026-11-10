import { ModelResultV2Schema, type Id, type ModelResultV2, type ModelTurnV2 } from '../../contracts/src/index.js';
import { exceedsModelCeilings, type ModelClient } from './model.js';

export type LiveModelTransportOptions = {
  configured: boolean;
  modelId: Id;
  /** API root such as https://api.openai.com/v1 — injected, never read from env here. */
  baseUrl: string;
  /** Injected credential — not a product env binding. */
  apiKey: string;
  fetch?: typeof fetch;
  estimateTokens?: (turn: ModelTurnV2) => { input: number; output: number };
};

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
      if (estimateTokens && exceedsModelCeilings(estimateTokens(turn), turn.limits)) {
        throw new Error('MODEL_BUDGET_EXCEEDED');
      }

      const messages: Array<Record<string, unknown>> = [{ role: 'system', content: turn.instructions }];
      for (const message of turn.messages) {
        if (message.kind === 'text') messages.push({ role: message.role, content: message.text });
      }
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

      const response = await fetchImpl(`${root}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages,
          tools,
          max_tokens: turn.limits.maxOutputTokens,
        }),
      }).catch(() => {
        throw new Error('MODEL_PROVIDER_ERROR');
      });
      if (!response.ok) throw new Error('MODEL_PROVIDER_ERROR');

      const body = await response.json() as {
        id?: string;
        choices?: Array<{ finish_reason?: string; message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = body.choices?.[0];
      let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      try {
        toolCalls = (choice?.message?.tool_calls ?? []).map(call => ({
          id: call.id ?? 'tool-1',
          name: call.function?.name ?? '',
          arguments: JSON.parse(call.function?.arguments ?? '{}') as Record<string, unknown>,
        }));
      } catch {
        throw new Error('MODEL_PROVIDER_ERROR');
      }
      const text = typeof choice?.message?.content === 'string' ? choice.message.content.slice(0, 2000) : undefined;
      const stopReason = toolCalls.length > 0 ? 'tool_calls'
        : choice?.finish_reason === 'length' ? 'limit' : 'done';

      return ModelResultV2Schema.parse({
        schemaVersion: 2,
        dispatchId: turn.dispatchId,
        providerCallId: body.id ?? 'provider-call',
        ...(text ? { message: text } : {}),
        toolCalls: stopReason === 'tool_calls' ? toolCalls : [],
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
        },
        stopReason,
      });
    },
  };
}
