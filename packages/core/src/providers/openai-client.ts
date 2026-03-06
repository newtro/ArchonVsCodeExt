/**
 * OpenAI API client with streaming support and dual auth modes.
 *
 * Uses the Chat Completions API (same format as OpenRouter) so our
 * AgentLoop works unchanged. Switches baseUrl and auth headers based
 * on whether the user is using an API key or ChatGPT subscription.
 */

import type { ChatMessage, ModelInfo, StreamToken, ToolDefinition } from '../types';
import type { OpenAIAuthMode, OpenAITokens } from './openai-auth';

// ── Configuration ──

export interface OpenAIClientConfig {
  authMode: OpenAIAuthMode;
  apiKey?: string;
  tokens?: OpenAITokens;
}

// ── Static model catalog (OpenAI doesn't have a public models-with-pricing endpoint like OpenRouter) ──

const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-4.1', name: 'GPT-4.1', contextLength: 1047576, pricing: { prompt: 2.00, completion: 8.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextLength: 1047576, pricing: { prompt: 0.40, completion: 1.60 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', contextLength: 1047576, pricing: { prompt: 0.10, completion: 0.40 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4o', name: 'GPT-4o', contextLength: 128000, pricing: { prompt: 2.50, completion: 10.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextLength: 128000, pricing: { prompt: 0.15, completion: 0.60 }, supportsTools: true, supportsStreaming: true },
  { id: 'o3', name: 'o3', description: 'Deep reasoning model', contextLength: 200000, pricing: { prompt: 2.00, completion: 8.00 }, supportsTools: true, supportsStreaming: true },
  { id: 'o4-mini', name: 'o4-mini', description: 'Budget reasoning model', contextLength: 200000, pricing: { prompt: 1.10, completion: 4.40 }, supportsTools: true, supportsStreaming: true },
];

// ── Content part types ──

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAIMessage {
  role: string;
  content: string | ContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  stream: boolean;
  temperature?: number;
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
      // Subscription users get a curated list — the Codex backend
      // doesn't expose a /models endpoint the same way
      return OPENAI_MODELS;
    }

    // For API key users, try fetching from the API, fall back to static list
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.authHeaders,
      });

      if (!res.ok) return OPENAI_MODELS;

      const data = await res.json() as { data: Array<{ id: string; owned_by?: string }> };

      // Filter to chat-capable models and merge with our pricing catalog
      const catalogMap = new Map(OPENAI_MODELS.map(m => [m.id, m]));
      const apiModels = data.data
        .filter(m => m.id.startsWith('gpt-') || m.id.startsWith('o3') || m.id.startsWith('o4'))
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

      // Ensure all catalog models are present even if API didn't return them
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

  // ── Simple (non-streaming) chat ──

  async simpleChat(
    model: string,
    messages: Array<{ role: string; content: string }>,
    temperature?: number,
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders,
      },
      body: JSON.stringify({ model, messages, temperature }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${errText}`);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  // ── Streaming chat (same interface as OpenRouterClient) ──

  async *streamChat(
    model: string,
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    temperature?: number,
    _options?: { webSearch?: boolean },
  ): AsyncGenerator<StreamToken> {
    const body: OpenAIChatRequest = {
      model,
      messages: this.convertMessages(messages),
      stream: true,
      temperature,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as unknown as Record<string, unknown>,
        },
      }));
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      yield { type: 'error', error: `OpenAI error ${res.status}: ${errText}` };
      return;
    }

    if (!res.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const currentToolCalls = new Map<number, { id: string; name: string; args: string }>();

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
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6)) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string;
              }>;
            };

            const choice = json.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (delta?.content) {
              yield { type: 'text', content: delta.content };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (tc.id) {
                  currentToolCalls.set(idx, { id: tc.id, name: '', args: '' });
                  yield { type: 'tool_call_start', toolCall: { id: tc.id } };
                }
                const current = currentToolCalls.get(idx);
                if (current) {
                  if (tc.function?.name) {
                    current.name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    current.args += tc.function.arguments;
                    yield { type: 'tool_call_args', content: tc.function.arguments };
                  }
                }
              }
            }

            if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
              for (const [, tc] of currentToolCalls) {
                let parsedArgs: Record<string, unknown> = {};
                try {
                  parsedArgs = JSON.parse(tc.args) as Record<string, unknown>;
                } catch {
                  // args might be empty
                }
                yield {
                  type: 'tool_call_end',
                  toolCall: { id: tc.id, name: tc.name, arguments: parsedArgs },
                };
              }
              currentToolCalls.clear();
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }

  // ── Message conversion (identical to OpenRouterClient) ──

  private convertMessages(messages: ChatMessage[]): OpenAIMessage[] {
    return messages.map(m => {
      const msg: OpenAIMessage = {
        role: m.role,
        content: m.content || null,
      };

      // Build multimodal content if the message has image/PDF attachments
      if (m.attachments && m.attachments.length > 0 && m.role === 'user') {
        const parts: ContentPart[] = [];
        if (m.content) {
          parts.push({ type: 'text', text: m.content });
        }
        for (const att of m.attachments) {
          if ((att.type === 'image' || att.type === 'pdf') && att.dataUri) {
            parts.push({ type: 'image_url', image_url: { url: att.dataUri } });
          }
        }
        if (parts.length > 0) {
          msg.content = parts;
        }
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
        if (!msg.content) msg.content = null;
      }

      if (m.toolCallId) {
        msg.tool_call_id = m.toolCallId;
      }

      return msg;
    });
  }
}
