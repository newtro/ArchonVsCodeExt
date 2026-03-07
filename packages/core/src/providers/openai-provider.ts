/**
 * OpenAI LLM provider — single provider with dual auth modes.
 *
 * - API key mode: standard pay-as-you-go against api.openai.com
 * - Subscription mode: ChatGPT Plus/Pro/Team/Enterprise via OAuth
 *
 * Uses our AgentLoop for tool execution (same pattern as OpenRouterProvider).
 */

import { OpenAIClient } from './openai-client';
import type { OpenAIClientConfig } from './openai-client';
import type { OpenAIAuthMode, OpenAITokens, OpenAIAuthCallbacks, OpenAISubscriptionInfo } from './openai-auth';
import { startOAuthFlow, extractSubscriptionInfo, TokenRefreshManager, OpenAIAuthError } from './openai-auth';
import { AgentLoop } from '../agent/agent-loop';
import type { ModelInfo } from '../types';
import type { LLMProvider, ProviderId, ExecutorConfig, Executor, ExecutorCallbacks } from './types';

export interface OpenAIProviderConfig {
  authMode?: OpenAIAuthMode;
  apiKey?: string;
  tokens?: OpenAITokens;
}

export class OpenAIProvider implements LLMProvider {
  readonly id: ProviderId = 'openai';
  readonly name = 'OpenAI';
  private client: OpenAIClient;
  private refreshManager: TokenRefreshManager | null = null;
  private subscriptionInfo: OpenAISubscriptionInfo | null = null;
  private currentTokens: OpenAITokens | null = null;

  constructor(config?: OpenAIProviderConfig) {
    this.client = new OpenAIClient({
      authMode: config?.authMode ?? 'api-key',
      apiKey: config?.apiKey,
      tokens: config?.tokens,
    });

    // Extract subscription info if tokens provided
    if (config?.tokens) {
      this.currentTokens = config.tokens;
      if (config.tokens.idToken) {
        this.subscriptionInfo = extractSubscriptionInfo(config.tokens.idToken);
      }
    }
  }

  // ── Auth management ──

  setApiKey(key: string): void {
    this.client.setApiKey(key);
    this.stopRefreshManager();
  }

  setTokens(tokens: OpenAITokens): void {
    this.client.setTokens(tokens);
    this.currentTokens = tokens;
    this.subscriptionInfo = extractSubscriptionInfo(tokens.idToken);
  }

  setAuthMode(mode: OpenAIAuthMode): void {
    this.client.setAuthMode(mode);
    if (mode === 'api-key') {
      this.stopRefreshManager();
    }
  }

  getAuthMode(): OpenAIAuthMode {
    return this.client.getAuthMode();
  }

  getSubscriptionInfo(): OpenAISubscriptionInfo | null {
    return this.subscriptionInfo;
  }

  /**
   * Start the OAuth flow for ChatGPT subscription authentication.
   * The callbacks handle browser opening and token persistence.
   */
  async startOAuth(callbacks: OpenAIAuthCallbacks): Promise<OpenAITokens> {
    const tokens = await startOAuthFlow(callbacks);
    this.setTokens(tokens);
    this.startRefreshManager(callbacks);
    return tokens;
  }

  /**
   * Initialize the token refresh manager with existing tokens.
   * Call this on extension activation when subscription tokens are loaded from storage.
   */
  startRefreshManager(callbacks: Pick<OpenAIAuthCallbacks, 'onTokensUpdated'> & { onError?: (error: string) => void }): void {
    const tokens = this.currentTokens;
    if (!tokens) return;

    this.stopRefreshManager();
    this.refreshManager = new TokenRefreshManager({
      onTokensUpdated: async (newTokens) => {
        this.client.setTokens(newTokens);
        this.currentTokens = newTokens;
        this.subscriptionInfo = extractSubscriptionInfo(newTokens.idToken);
        await callbacks.onTokensUpdated(newTokens);
      },
      onError: (error) => {
        callbacks.onError?.(error);
      },
    });
    this.refreshManager.start(tokens);
  }

  stopRefreshManager(): void {
    if (this.refreshManager) {
      this.refreshManager.stop();
      this.refreshManager = null;
    }
  }

  /** Get current tokens. */
  getTokens(): OpenAITokens | null {
    return this.currentTokens;
  }

  // ── LLMProvider interface ──

  async isAvailable(): Promise<boolean> {
    const mode = this.client.getAuthMode();
    if (mode === 'api-key') {
      try {
        const models = await this.client.listModels();
        return models.length > 0;
      } catch {
        return false;
      }
    }
    // Subscription mode — check if we have tokens
    return this.subscriptionInfo != null;
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

  /** Get the underlying client (for backward compatibility / direct access). */
  getClient(): OpenAIClient {
    return this.client;
  }

  createExecutor(config: ExecutorConfig): Executor {
    return new OpenAIExecutor(this.client, config);
  }
}

// ── Executor ──

class OpenAIExecutor implements Executor {
  private agentLoop: AgentLoop | null = null;
  private client: OpenAIClient;
  private config: ExecutorConfig;

  constructor(client: OpenAIClient, config: ExecutorConfig) {
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

  getAgentLoop(): AgentLoop | null {
    return this.agentLoop;
  }
}
