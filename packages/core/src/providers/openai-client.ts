/**
 * OpenAI API client with streaming support and dual auth modes.
 *
 * Uses the Responses API (recommended by OpenAI):
 * - Semantic streaming events (response.output_text.delta, function_call_arguments.delta, etc.)
 * - Built-in tool/function calling support
 * - System prompt via `instructions` parameter
 *
 * Auth modes:
 * - API key: Bearer sk-... against api.openai.com/v1
 * - Subscription: OAuth JWT against chatgpt.com/backend-api/codex (same API format)
 *
 * Both paths use the Responses API and emit the same StreamToken stream.
 */

import type { ChatMessage, ModelInfo, StreamToken, ToolDefinition } from '../types';
import type { OpenAIAuthMode, OpenAITokens } from './openai-auth';

// ── Configuration ──

export interface OpenAIClientConfig {
  authMode: OpenAIAuthMode;
  apiKey?: string;
  tokens?: OpenAITokens;
}

// ── Static model catalog ──

const OPENAI_MODELS: ModelInfo[] = [
  // GPT-5.4 (latest flagship)
  { id: 'gpt-5.4', name: 'GPT-5.4', description: 'Most capable — reasoning + coding', contextLength: 1047576, pricing: { prompt: 2.50, completion: 15.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', description: 'Maximum performance', contextLength: 1047576, pricing: { prompt: 30.00, completion: 180.00 }, supportsTools: true, supportsStreaming: true },
  // GPT-5.3 Codex
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', description: 'Frontier agentic coding', contextLength: 1047576, pricing: { prompt: 1.75, completion: 14.00 }, supportsTools: true, supportsStreaming: true },
  // GPT-5.2 family
  { id: 'gpt-5.2', name: 'GPT-5.2', description: 'Flagship reasoning', contextLength: 1047576, pricing: { prompt: 1.75, completion: 14.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-5.2-pro', name: 'GPT-5.2 Pro', description: 'Heavy reasoning', contextLength: 1047576, pricing: { prompt: 21.00, completion: 168.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', description: 'Agentic coding', contextLength: 1047576, pricing: { prompt: 1.75, completion: 14.00 }, supportsTools: true, supportsStreaming: true },
  // GPT-5.1 family
  { id: 'gpt-5.1', name: 'GPT-5.1', contextLength: 1047576, pricing: { prompt: 1.25, completion: 10.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', description: 'Agentic coding', contextLength: 1047576, pricing: { prompt: 1.25, completion: 10.00 }, supportsTools: true, supportsStreaming: true },
  // GPT-5 family (base)
  { id: 'gpt-5', name: 'GPT-5', description: 'Reasoning + coding', contextLength: 1047576, pricing: { prompt: 1.25, completion: 10.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Fast, cost-efficient', contextLength: 1047576, pricing: { prompt: 0.25, completion: 2.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', description: 'Cheapest and fastest', contextLength: 1047576, pricing: { prompt: 0.05, completion: 0.40 }, supportsTools: true, supportsStreaming: true },
  // GPT-4.1 family
  { id: 'gpt-4.1', name: 'GPT-4.1', contextLength: 1047576, pricing: { prompt: 2.00, completion: 8.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextLength: 1047576, pricing: { prompt: 0.40, completion: 1.60 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', contextLength: 1047576, pricing: { prompt: 0.10, completion: 0.40 }, supportsTools: true, supportsStreaming: true },
  // GPT-4o family
  { id: 'gpt-4o', name: 'GPT-4o', contextLength: 128000, pricing: { prompt: 2.50, completion: 10.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextLength: 128000, pricing: { prompt: 0.15, completion: 0.60 }, supportsTools: true, supportsStreaming: true },
  // Reasoning (o-series)
  { id: 'o3', name: 'o3', description: 'Deep reasoning', contextLength: 200000, pricing: { prompt: 2.00, completion: 8.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'o3-pro', name: 'o3-pro', description: 'Heavy reasoning', contextLength: 200000, pricing: { prompt: 20.00, completion: 80.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'o4-mini', name: 'o4-mini', description: 'Budget reasoning', contextLength: 200000, pricing: { prompt: 1.10, completion: 4.40 }, supportsTools: true, supportsStreaming: true },
];

/**
 * Models NOT supported by the ChatGPT subscription Codex endpoint
 * (chatgpt.com/backend-api/codex).
 *
 * Retired from ChatGPT Feb 13 2026:
 *   gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, o4-mini, gpt-5
 * Confirmed errors on subscription endpoint:
 *   gpt-5-mini, gpt-5-nano, gpt-5.1, gpt-5.1-codex
 *
 * Sources:
 *   https://openai.com/index/retiring-gpt-4o-and-older-models/
 *   https://github.com/openai/codex/issues/6603
 */
const SUBSCRIPTION_UNSUPPORTED_MODELS = new Set([
  // Retired from ChatGPT Feb 2026
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o4-mini',
  // GPT-5 base family — not available on subscription endpoint
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  // GPT-5.1 — confirmed unsupported on subscription endpoint
  'gpt-5.1',
  'gpt-5.1-codex',
]);

// ── Types for Responses API ──

/** Items in the Responses API `input` array. */
type ResponseInputItem =
  | { role: 'user'; content: string | ResponseContentPart[] }
  | { role: 'assistant'; content: string }
  | { type: 'function_call'; name: string; call_id: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

type ResponseContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

/** Tool definition for the Responses API (flat format — NOT wrapped in function:). */
interface ResponseTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ── Reasoning model detection ──

/**
 * Reasoning models (GPT-5.x, codex variants, o-series) do NOT support
 * `temperature`. They use `reasoning.effort` instead (low/medium/high).
 * Non-reasoning models (GPT-4.1, GPT-4o) use `temperature` as usual.
 */
function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return (
    m.startsWith('gpt-5') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.includes('codex')
  );
}

// ── Client ──

export class OpenAIClient {
  private authMode: OpenAIAuthMode;
  private apiKey: string;
  private tokens: OpenAITokens | null;

  constructor(config: OpenAIClientConfig) {
    this.authMode = config.authMode;
    this.apiKey = config.apiKey ?? '';
    this.tokens = config.tokens ?? null;
  }

  // ── Auth management ──

  setApiKey(key: string): void {
    this.apiKey = key;
    this.authMode = 'api-key';
  }

  setTokens(tokens: OpenAITokens): void {
    this.tokens = tokens;
    this.authMode = 'subscription';
  }

  setAuthMode(mode: OpenAIAuthMode): void {
    this.authMode = mode;
  }

  getAuthMode(): OpenAIAuthMode {
    return this.authMode;
  }

  private get baseUrl(): string {
    return this.authMode === 'subscription'
      ? 'https://chatgpt.com/backend-api/codex'
      : 'https://api.openai.com/v1';
  }

  private get authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.authMode === 'subscription' && this.tokens) {
      headers['Authorization'] = `Bearer ${this.tokens.accessToken}`;
      if (this.tokens.accountId) {
        headers['ChatGPT-Account-ID'] = this.tokens.accountId;
      }
    } else {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  // ── Model listing ──

  async listModels(): Promise<ModelInfo[]> {
    if (this.authMode === 'subscription') {
      return OPENAI_MODELS.filter(m => !SUBSCRIPTION_UNSUPPORTED_MODELS.has(m.id));
    }

    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.authHeaders,
      });

      if (!res.ok) return OPENAI_MODELS;

      const data = await res.json() as { data: Array<{ id: string; owned_by?: string }> };

      const catalogMap = new Map(OPENAI_MODELS.map(m => [m.id, m]));
      const apiModels = data.data
        .filter(m => m.id.startsWith('gpt-') || m.id.startsWith('o3') || m.id.startsWith('o4') || m.id.startsWith('codex-'))
        .map(m => {
          const catalogEntry = catalogMap.get(m.id);
          if (catalogEntry) return catalogEntry;
          return {
            id: m.id,
            name: m.id,
            contextLength: 128000,
            supportsTools: true,
            supportsStreaming: true,
          };
        });

      const resultIds = new Set(apiModels.map(m => m.id));
      for (const catalogModel of OPENAI_MODELS) {
        if (!resultIds.has(catalogModel.id)) {
          apiModels.push(catalogModel);
        }
      }

      return apiModels;
    } catch {
      return OPENAI_MODELS;
    }
  }

  // ── Simple chat via Responses API ──
  // Subscription mode requires stream:true, so we always stream and collect.

  async simpleChat(
    model: string,
    messages: Array<{ role: string; content: string }>,
    temperature?: number,
  ): Promise<string> {
    const instructions = messages.find(m => m.role === 'system')?.content ?? '';
    const input = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const useStream = this.authMode === 'subscription';

    const res = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders },
      body: JSON.stringify({
        model,
        instructions,
        input,
        store: false,
        ...(useStream ? { stream: true } : {}),
        ...(isReasoningModel(model)
          ? { reasoning: { effort: 'medium' } }
          : temperature !== undefined ? { temperature } : {}),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${errText}`);
    }

    if (!useStream) {
      const data = await res.json() as { output_text?: string };
      return data.output_text ?? '';
    }

    // Streaming mode: collect text deltas
    let result = '';
    let fallbackText = '';
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          let jsonStr: string | null = null;
          if (trimmed.startsWith('data: ')) jsonStr = trimmed.slice(6);
          else if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5);
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const event = JSON.parse(jsonStr) as Record<string, unknown>;
            if (event.type === 'response.output_text.delta') {
              result += (event.delta as string) ?? '';
            } else if (event.type === 'response.completed') {
              const response = event.response as Record<string, unknown> | undefined;
              if (response?.output_text) fallbackText = response.output_text as string;
            }
          } catch { /* skip unparseable */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return result || fallbackText;
  }

  // ── Streaming chat via Responses API (StreamingLLMClient interface) ──

  async *streamChat(
    model: string,
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    temperature?: number,
    _options?: { webSearch?: boolean },
  ): AsyncGenerator<StreamToken> {
    const { instructions, input } = this.convertToResponsesInput(messages);

    const body: Record<string, unknown> = {
      model,
      instructions,
      input,
      stream: true,
      store: false,
    };

    // Reasoning models (GPT-5.x, codex, o-series) use reasoning.effort
    // instead of temperature. Sending temperature causes silent failures.
    if (isReasoningModel(model)) {
      body.reasoning = { effort: 'medium' };
    } else if (temperature !== undefined) {
      body.temperature = temperature;
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t): ResponseTool => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as Record<string, unknown>,
      }));
    }

    // Debug: log the request for troubleshooting
    console.log('[OpenAI] streamChat request:', {
      url: `${this.baseUrl}/responses`,
      model,
      inputLength: input.length,
      hasTools: !!(tools && tools.length > 0),
      toolCount: tools?.length ?? 0,
      isReasoning: isReasoningModel(model),
      bodyKeys: Object.keys(body),
    });

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error('[OpenAI] fetch failed:', msg);
      yield { type: 'error', error: `OpenAI fetch failed: ${msg}` };
      return;
    }

    console.log('[OpenAI] response status:', res.status, res.statusText);

    if (!res.ok) {
      const errText = await res.text();
      console.error('[OpenAI] API error:', res.status, errText);
      yield { type: 'error', error: `OpenAI error ${res.status}: ${errText}` };
      return;
    }

    if (!res.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    // Track function calls in progress.
    // Keyed by BOTH item.id (item_id in argument events) and item.call_id
    // because argument events reference item_id while we need call_id for tool execution.
    const pendingCalls = new Map<string, { callId: string; name: string; args: string }>();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let hasYieldedContent = false;
    let responseStatus: string | undefined;
    let fallbackText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          // Handle both "data: {...}" and "data:{...}" (with/without space)
          let jsonStr: string | null = null;
          if (trimmed.startsWith('data: ')) {
            jsonStr = trimmed.slice(6);
          } else if (trimmed.startsWith('data:')) {
            jsonStr = trimmed.slice(5);
          }
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const event = JSON.parse(jsonStr) as Record<string, unknown>;
            const eventType = event.type as string;

            // Debug: log each SSE event type (except high-frequency deltas)
            if (eventType && !eventType.includes('.delta')) {
              console.log('[OpenAI] SSE event:', eventType);
            }

            switch (eventType) {
              // ── Text streaming ──
              case 'response.output_text.delta': {
                const delta = event.delta as string;
                if (delta) {
                  hasYieldedContent = true;
                  yield { type: 'text', content: delta };
                }
                break;
              }

              // ── Function call started ──
              case 'response.output_item.added': {
                const item = event.item as Record<string, unknown> | undefined;
                if (item?.type === 'function_call') {
                  const itemId = item.id as string;
                  const callId = (item.call_id ?? item.id) as string;
                  const name = item.name as string;
                  const entry = { callId, name, args: '' };
                  // Store by item.id (used by argument events as item_id)
                  pendingCalls.set(itemId, entry);
                  // Also store by call_id if different (belt-and-suspenders)
                  if (callId !== itemId) {
                    pendingCalls.set(callId, entry);
                  }
                  hasYieldedContent = true;
                  yield { type: 'tool_call_start', toolCall: { id: callId } };
                }
                break;
              }

              // ── Function call arguments streaming ──
              case 'response.function_call_arguments.delta': {
                // Responses API uses item_id (not call_id) in argument events
                const lookupId = (event.item_id ?? event.call_id) as string;
                const delta = event.delta as string;
                const pending = pendingCalls.get(lookupId);
                if (pending && delta) {
                  pending.args += delta;
                  yield { type: 'tool_call_args', content: delta };
                }
                break;
              }

              // ── Function call arguments complete ──
              case 'response.function_call_arguments.done': {
                // Responses API uses item_id (not call_id) in argument events
                const lookupId = (event.item_id ?? event.call_id) as string;
                const fullArgs = event.arguments as string;
                const pending = pendingCalls.get(lookupId);
                if (pending) {
                  let parsedArgs: Record<string, unknown> = {};
                  try {
                    parsedArgs = JSON.parse(fullArgs || pending.args) as Record<string, unknown>;
                  } catch { /* empty args */ }
                  yield {
                    type: 'tool_call_end',
                    toolCall: { id: pending.callId, name: pending.name, arguments: parsedArgs },
                  };
                  pendingCalls.delete(lookupId);
                }
                break;
              }

              // ── Response completed — extract fallback text ──
              case 'response.completed': {
                responseStatus = (event.response as Record<string, unknown>)?.status as string | undefined;
                const response = event.response as Record<string, unknown> | undefined;
                if (response?.output_text) {
                  fallbackText = response.output_text as string;
                }
                // Also check output array for text
                const output = response?.output as Array<Record<string, unknown>> | undefined;
                if (output && !fallbackText) {
                  for (const item of output) {
                    if (item.type === 'message') {
                      const content = item.content as Array<Record<string, unknown>> | undefined;
                      if (content) {
                        for (const part of content) {
                          if (part.type === 'output_text' && part.text) {
                            fallbackText += part.text as string;
                          }
                        }
                      }
                    }
                  }
                }
                break;
              }

              // ── Response failed / incomplete ──
              case 'response.failed':
              case 'response.incomplete': {
                const response = event.response as Record<string, unknown> | undefined;
                const status = response?.status as string | undefined;
                const statusDetails = response?.incomplete_details ?? response?.error;
                const errorDetail = statusDetails
                  ? JSON.stringify(statusDetails)
                  : `Response ${eventType.split('.')[1]} (status: ${status ?? 'unknown'})`;
                yield { type: 'error', error: `OpenAI: ${errorDetail}` };
                break;
              }

              // ── Error event ──
              case 'error': {
                const errorMsg = (event.message ?? event.error ?? 'Unknown API error') as string;
                yield { type: 'error', error: errorMsg };
                break;
              }

              // Other events: response.created, response.in_progress,
              // response.output_item.done, response.content_part.added,
              // response.output_text.done, etc. — no action needed.
            }
          } catch (parseErr) {
            // Log unparseable lines for debugging
            console.warn('[OpenAI] Unparseable SSE line:', jsonStr?.slice(0, 200));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // If we never yielded any content but have fallback text from response.completed,
    // emit it now — this handles edge cases where delta events were missed.
    if (!hasYieldedContent && fallbackText) {
      yield { type: 'text', content: fallbackText };
    }

    // If we got absolutely nothing, surface an informative error
    if (!hasYieldedContent && !fallbackText) {
      const detail = responseStatus ? ` (response status: ${responseStatus})` : '';
      yield { type: 'error', error: `OpenAI returned an empty response${detail}. The model may not be available for your account.` };
      return;
    }

    yield { type: 'done' };
  }

  /**
   * Convert our internal ChatMessage[] to Responses API input format.
   *
   * The Responses API input array accumulates ALL prior exchanges:
   * - System messages → extracted to `instructions` parameter
   * - User messages → { role: 'user', content: '...' }
   * - Assistant text → { role: 'assistant', content: '...' }
   * - Assistant tool calls → { type: 'function_call', call_id, name, arguments }
   *   (these are the model's output items appended back as input for the next turn)
   * - Tool results → { type: 'function_call_output', call_id, output }
   *
   * Key: function_call items come BEFORE the assistant text for that turn,
   * matching the order the model produced them (tool calls first, then summary text).
   */
  private convertToResponsesInput(messages: ChatMessage[]): { instructions: string; input: ResponseInputItem[] } {
    let instructions = '';
    const input: ResponseInputItem[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        instructions = msg.content;
        continue;
      }

      if (msg.role === 'user') {
        if (msg.attachments && msg.attachments.length > 0) {
          const parts: ResponseContentPart[] = [];
          if (msg.content) {
            parts.push({ type: 'input_text', text: msg.content });
          }
          for (const att of msg.attachments) {
            if ((att.type === 'image' || att.type === 'pdf') && att.dataUri) {
              parts.push({ type: 'input_image', image_url: att.dataUri });
            }
          }
          input.push({ role: 'user', content: parts.length > 0 ? parts : msg.content });
        } else {
          input.push({ role: 'user', content: msg.content });
        }
        continue;
      }

      if (msg.role === 'assistant') {
        // The Responses API expects the model's output items appended back as input.
        // Tool calls become function_call items; text becomes an assistant message.
        // Order: function_call items first (as they were in the model output),
        // then the assistant text (if any).
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            input.push({
              type: 'function_call',
              name: tc.name,
              call_id: tc.id,
              arguments: JSON.stringify(tc.arguments),
            });
          }
        }
        if (msg.content) {
          input.push({ role: 'assistant', content: msg.content });
        }
        continue;
      }

      if (msg.role === 'tool' && msg.toolCallId) {
        input.push({
          type: 'function_call_output',
          call_id: msg.toolCallId,
          output: msg.content,
        });
      }
    }

    return { instructions, input };
  }
}
