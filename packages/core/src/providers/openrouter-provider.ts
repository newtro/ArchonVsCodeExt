/**
 * OpenRouter LLM provider.
 *
 * Wraps the existing OpenRouterClient + AgentLoop into the provider abstraction.
 * Our extension controls the agent loop and tool execution.
 */

import { OpenRouterClient } from '../models/openrouter-client';
import type { OpenRouterConfig } from '../models/openrouter-client';
import { AgentLoop } from '../agent/agent-loop';
import type { ModelInfo } from '../types';
import type { LLMProvider, ProviderId, ExecutorConfig, Executor, ExecutorCallbacks } from './types';

export class OpenRouterProvider implements LLMProvider {
  readonly id: ProviderId = 'openrouter';
  readonly name = 'OpenRouter';
  private client: OpenRouterClient;

  constructor(config: OpenRouterConfig) {
    this.client = new OpenRouterClient(config);
  }

  setApiKey(key: string): void {
    this.client.setApiKey(key);
  }

  async isAvailable(): Promise<boolean> {
    // Available if an API key has been set (non-empty)
    try {
      const models = await this.client.listModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    return this.client.listModels();
  }

  /** Simple non-streaming chat (used by pipeline condition evaluation, etc.) */
  async simpleChat(
    model: string,
    messages: Array<{ role: string; content: string }>,
    temperature?: number,
  ): Promise<string> {
    return this.client.simpleChat(model, messages, temperature);
  }

  /** Get the underlying client (for backward compatibility during migration) */
  getClient(): OpenRouterClient {
    return this.client;
  }

  createExecutor(config: ExecutorConfig): Executor {
    return new OpenRouterExecutor(this.client, config);
  }
}

class OpenRouterExecutor implements Executor {
  private agentLoop: AgentLoop | null = null;
  private client: OpenRouterClient;
  private config: ExecutorConfig;

  constructor(client: OpenRouterClient, config: ExecutorConfig) {
    this.client = client;
    this.config = config;
  }

  async run(userMessage: string, callbacks: ExecutorCallbacks): Promise<void> {
    if (!this.agentLoop) {
      this.agentLoop = new AgentLoop(
        this.client,
        {
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          tools: this.config.tools,
          temperature: this.config.temperature,
          webSearch: this.config.webSearch,
        },
        this.config.toolContext,
        {
          onToken: callbacks.onToken,
          onToolCall: callbacks.onToolCall,
          onToolResult: callbacks.onToolResult,
          onMessageComplete: callbacks.onMessageComplete,
          parallelSpawn: callbacks.parallelSpawn,
        },
      );

      // Load any conversation history
      if (this.config.conversationHistory) {
        this.agentLoop.loadHistory(this.config.conversationHistory);
      }
    }

    await this.agentLoop.run(userMessage);
  }

  abort(): void {
    this.agentLoop?.cancel();
  }

  injectMessage(message: string): boolean {
    if (this.agentLoop) {
      this.agentLoop.injectMessage(message);
      return true;
    }
    return false;
  }

  getMessages() {
    return this.agentLoop?.getMessages() ?? [];
  }

  loadHistory(history: import('../types').ChatMessage[]): void {
    this.agentLoop?.loadHistory(history);
  }

  clearMessages(): void {
    this.agentLoop?.clearMessages();
  }

  /** Get the underlying AgentLoop (for backward compatibility) */
  getAgentLoop(): AgentLoop | null {
    return this.agentLoop;
  }
}
