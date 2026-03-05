/**
 * OpenRouter API client with streaming support.
 * Uses the OpenAI-compatible API format.
 */

import type { ChatMessage, ModelInfo, StreamToken, ToolDefinition, ToolCall } from '../types';

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl?: string;
}

interface OpenRouterPlugin {
  id: string;
  engine?: 'native' | 'exa';
  max_results?: number;
  search_prompt?: string;
}

interface OpenRouterChatRequest {
  model: string;
  messages: OpenRouterMessage[];
  tools?: OpenRouterTool[];
  plugins?: OpenRouterPlugin[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
}

interface OpenRouterMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: OpenRouterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1';
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Fetch available models from OpenRouter.
   */
  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as { data: Array<{
      id: string;
      name: string;
      description?: string;
      context_length: number;
      pricing?: { prompt: string; completion: string };
    }> };

    return data.data
      .filter(m => m.context_length > 0)
      .map(m => ({
        id: m.id,
        name: m.name,
        description: m.description,
        contextLength: m.context_length,
        pricing: m.pricing ? {
          prompt: parseFloat(m.pricing.prompt) * 1_000_000,
          completion: parseFloat(m.pricing.completion) * 1_000_000,
        } : undefined,
        supportsTools: true,
        supportsStreaming: true,
      }));
  }

  /**
   * Stream a chat completion from OpenRouter.
   */
  async *streamChat(
    model: string,
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    temperature?: number,
    options?: { webSearch?: boolean },
  ): AsyncGenerator<StreamToken> {
    const body: OpenRouterChatRequest = {
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

    if (options?.webSearch) {
      body.plugins = [{ id: 'web' }];
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://archon.dev',
        'X-Title': 'Archon VS Code Extension',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      yield { type: 'error', error: `OpenRouter error ${res.status}: ${errText}` };
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
              // Emit completed tool calls
              for (const [, tc] of currentToolCalls) {
                let parsedArgs: Record<string, unknown> = {};
                try {
                  parsedArgs = JSON.parse(tc.args) as Record<string, unknown>;
                } catch {
                  // args might be empty for some calls
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

  private convertMessages(messages: ChatMessage[]): OpenRouterMessage[] {
    return messages.map(m => {
      const msg: OpenRouterMessage = {
        role: m.role,
        content: m.content || null,
      };

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
