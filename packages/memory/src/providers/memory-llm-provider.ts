/**
 * MemoryLlmProvider — wraps a user-configured LLM for memory operations.
 *
 * Supports OpenRouter, OpenAI, and Ollama as independent providers.
 * Used by AutoSummarizer and EditTracker for summarization, compression,
 * and pattern extraction.
 */

import type { LlmCompletionFn } from '../session/auto-summarizer';

export type MemoryLlmProviderId = 'openrouter' | 'openai' | 'ollama';

export interface MemoryLlmConfig {
  provider: MemoryLlmProviderId;
  apiKey?: string;
  modelId: string;
  baseUrl?: string; // For Ollama or custom endpoints
}

export class MemoryLlmProvider {
  private provider: MemoryLlmProviderId;
  private apiKey?: string;
  private modelId: string;
  private baseUrl: string;

  constructor(config: MemoryLlmConfig) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.modelId = config.modelId;
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
  }

  /** Update configuration (e.g. when user changes settings). */
  updateConfig(config: Partial<MemoryLlmConfig>): void {
    if (config.provider !== undefined) this.provider = config.provider;
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
    if (config.modelId !== undefined) this.modelId = config.modelId;
    if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl;
  }

  /** Check if the provider is configured enough to make calls. */
  isConfigured(): boolean {
    if (!this.modelId) return false;
    if (this.provider === 'ollama') return true; // No API key needed
    return !!this.apiKey;
  }

  /** Get the current config (without the API key). */
  getConfig(): Omit<MemoryLlmConfig, 'apiKey'> & { hasApiKey: boolean } {
    return {
      provider: this.provider,
      modelId: this.modelId,
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
    };
  }

  /**
   * Run a completion against the configured provider.
   */
  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    switch (this.provider) {
      case 'openrouter':
        return this.completeOpenRouter(systemPrompt, userMessage);
      case 'openai':
        return this.completeOpenAI(systemPrompt, userMessage);
      case 'ollama':
        return this.completeOllama(systemPrompt, userMessage);
      default:
        throw new Error(`Unknown memory LLM provider: ${this.provider}`);
    }
  }

  /** Convert to the callback type used by AutoSummarizer/EditTracker. */
  toLlmCompletionFn(): LlmCompletionFn {
    return (system, user) => this.complete(system, user);
  }

  /** Test the connection by sending a simple prompt. */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this.complete(
        'You are a test. Respond with exactly: OK',
        'Test connection.',
      );
      return { ok: response.length > 0 };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /**
   * Auto-detect available providers and return suggestions.
   */
  static async detectAvailable(keys: {
    openRouterKey?: string;
    openAiKey?: string;
  }): Promise<MemoryLlmConfig[]> {
    const suggestions: MemoryLlmConfig[] = [];

    // Check OpenRouter
    if (keys.openRouterKey) {
      suggestions.push({
        provider: 'openrouter',
        apiKey: keys.openRouterKey,
        modelId: 'google/gemini-2.0-flash-001',
      });
    }

    // Check OpenAI
    if (keys.openAiKey) {
      suggestions.push({
        provider: 'openai',
        apiKey: keys.openAiKey,
        modelId: 'gpt-4o-mini',
      });
    }

    // Check Ollama
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch('http://localhost:11434/api/tags', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json() as { models?: Array<{ name: string }> };
        if (data.models && data.models.length > 0) {
          suggestions.push({
            provider: 'ollama',
            modelId: data.models[0].name,
            baseUrl: 'http://localhost:11434',
          });
        }
      }
    } catch {
      // Ollama not running — skip
    }

    return suggestions;
  }

  // ── Private provider implementations ──

  private async completeOpenRouter(systemPrompt: string, userMessage: string): Promise<string> {
    if (!this.apiKey) throw new Error('OpenRouter API key not configured for memory model');

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/archon-vscode',
        'X-Title': 'Archon Memory',
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter memory model error (${res.status}): ${text}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async completeOpenAI(systemPrompt: string, userMessage: string): Promise<string> {
    if (!this.apiKey) throw new Error('OpenAI API key not configured for memory model');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI memory model error (${res.status}): ${text}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async completeOllama(systemPrompt: string, userMessage: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama memory model error (${res.status}): ${text}`);
    }

    const data = await res.json() as {
      message?: { content?: string };
    };
    return data.message?.content ?? '';
  }
}
