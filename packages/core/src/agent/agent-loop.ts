/**
 * Core agentic loop: receives user message, streams LLM response,
 * executes tool calls, feeds results back, repeats until completion.
 */

import { OpenRouterClient } from '../models/openrouter-client';
import type {
  AgentConfig,
  ChatMessage,
  StreamToken,
  ToolCall,
  ToolDefinition,
  ToolContext,
  ToolResult,
} from '../types';

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export class AgentLoop {
  private client: OpenRouterClient;
  private config: AgentConfig;
  private messages: ChatMessage[] = [];
  private toolContext: ToolContext;
  private abortController: AbortController | null = null;
  private onToken: (token: StreamToken) => void;
  private onToolCall: (tc: ToolCall) => void;
  private onToolResult: (result: ToolResult) => void;
  private onMessageComplete: (msg: ChatMessage) => void;

  constructor(
    client: OpenRouterClient,
    config: AgentConfig,
    toolContext: ToolContext,
    callbacks: {
      onToken: (token: StreamToken) => void;
      onToolCall: (tc: ToolCall) => void;
      onToolResult: (result: ToolResult) => void;
      onMessageComplete: (msg: ChatMessage) => void;
    },
  ) {
    this.client = client;
    this.config = config;
    this.toolContext = toolContext;
    this.onToken = callbacks.onToken;
    this.onToolCall = callbacks.onToolCall;
    this.onToolResult = callbacks.onToolResult;
    this.onMessageComplete = callbacks.onMessageComplete;

    // Initialize with system prompt
    this.messages.push({
      id: generateId(),
      role: 'system',
      content: config.systemPrompt,
      timestamp: Date.now(),
    });
  }

  /**
   * Send a user message and run the agent loop until the LLM
   * either responds with text only (no tool calls) or max iterations reached.
   */
  async run(userMessage: string): Promise<void> {
    this.abortController = new AbortController();

    this.messages.push({
      id: generateId(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    const maxIterations = this.config.maxIterations ?? 25;

    for (let i = 0; i < maxIterations; i++) {
      if (this.abortController.signal.aborted) break;

      const { textContent, toolCalls } = await this.streamResponse();

      // Build the assistant message
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: Date.now(),
      };
      this.messages.push(assistantMsg);
      this.onMessageComplete(assistantMsg);

      // If no tool calls, we're done
      if (toolCalls.length === 0) break;

      // Execute tool calls and feed results back
      for (const tc of toolCalls) {
        if (this.abortController.signal.aborted) break;

        this.onToolCall(tc);
        const result = await this.executeTool(tc);
        this.onToolResult(result);

        this.messages.push({
          id: generateId(),
          role: 'tool',
          content: result.content,
          toolCallId: result.toolCallId,
          timestamp: Date.now(),
        });
      }
    }

    this.abortController = null;
  }

  cancel(): void {
    this.abortController?.abort();
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [this.messages[0]]; // Keep system prompt
  }

  private async streamResponse(): Promise<{ textContent: string; toolCalls: ToolCall[] }> {
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    const stream = this.client.streamChat(
      this.config.model,
      this.messages,
      this.config.tools,
      this.config.temperature,
      { webSearch: this.config.webSearch },
    );

    for await (const token of stream) {
      if (this.abortController?.signal.aborted) break;

      this.onToken(token);

      switch (token.type) {
        case 'text':
          textContent += token.content ?? '';
          break;
        case 'tool_call_end':
          if (token.toolCall?.id && token.toolCall?.name) {
            toolCalls.push({
              id: token.toolCall.id,
              name: token.toolCall.name,
              arguments: (token.toolCall.arguments ?? {}) as Record<string, unknown>,
            });
          }
          break;
        case 'error':
          throw new Error(token.error);
      }
    }

    return { textContent, toolCalls };
  }

  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.config.tools.find(t => t.name === toolCall.name);

    if (!tool) {
      return {
        toolCallId: toolCall.id,
        content: `Error: Unknown tool "${toolCall.name}"`,
        isError: true,
      };
    }

    try {
      const content = await tool.execute(toolCall.arguments, this.toolContext);
      return { toolCallId: toolCall.id, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: toolCall.id,
        content: `Error executing ${toolCall.name}: ${message}`,
        isError: true,
      };
    }
  }
}
