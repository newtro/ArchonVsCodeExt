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
  SubAgentMessage,
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
  private pendingInjections: string[] = [];
  private onToken: (token: StreamToken) => void;
  private onToolCall: (tc: ToolCall) => void;
  private onToolResult: (result: ToolResult) => void;
  private onMessageComplete: (msg: ChatMessage) => void;
  private parallelSpawn?: (tasks: Array<{ systemPrompt: string; task: string; model?: string }>) => Promise<Array<{ content: string; subMessages: SubAgentMessage[] }>>;

  constructor(
    client: OpenRouterClient,
    config: AgentConfig,
    toolContext: ToolContext,
    callbacks: {
      onToken: (token: StreamToken) => void;
      onToolCall: (tc: ToolCall) => void;
      onToolResult: (result: ToolResult) => void;
      onMessageComplete: (msg: ChatMessage) => void;
      parallelSpawn?: (tasks: Array<{ systemPrompt: string; task: string; model?: string }>) => Promise<Array<{ content: string; subMessages: SubAgentMessage[] }>>;
    },
  ) {
    this.client = client;
    this.config = config;
    this.toolContext = toolContext;
    this.onToken = callbacks.onToken;
    this.onToolCall = callbacks.onToolCall;
    this.onToolResult = callbacks.onToolResult;
    this.onMessageComplete = callbacks.onMessageComplete;
    this.parallelSpawn = callbacks.parallelSpawn;

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

    const maxIterations = this.config.maxIterations ?? Infinity;

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

      // If no tool calls, check for injected user messages before stopping
      if (toolCalls.length === 0) {
        if (!this.drainInjections()) break;
        // User message was injected — continue the loop
        continue;
      }

      // Execute tool calls — parallelise spawn_agent when the callback is available
      const allSpawn = toolCalls.every(tc => tc.name === 'spawn_agent');

      if (allSpawn && toolCalls.length >= 1 && this.parallelSpawn) {
        // Delegate parallel spawn to the executor for branch-isolated streaming
        for (const tc of toolCalls) this.onToolCall(tc);

        const tasks = toolCalls.map(tc => ({
          systemPrompt: tc.arguments.system_prompt as string,
          task: tc.arguments.task as string,
          model: tc.arguments.model as string | undefined,
        }));

        const spawnResults = await this.parallelSpawn(tasks);

        for (let i = 0; i < toolCalls.length; i++) {
          const sr = spawnResults[i];
          const result: ToolResult = {
            toolCallId: toolCalls[i].id,
            content: sr?.content ?? 'No result',
            subMessages: sr?.subMessages,
          };
          this.onToolResult(result);
          this.messages.push({
            id: generateId(),
            role: 'tool',
            content: result.content,
            toolCallId: result.toolCallId,
            timestamp: Date.now(),
          });
        }
      } else {
        // Sequential execution for tools that may have ordering dependencies
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

      // Drain any user messages that arrived during tool execution
      this.drainInjections();
    }

    this.abortController = null;
  }

  cancel(): void {
    this.abortController?.abort();
  }

  /**
   * Inject a user message into the running agent loop.
   * The message will be picked up after the current LLM response or tool
   * execution completes, keeping the agent in its existing conversation context.
   */
  injectMessage(message: string): void {
    this.pendingInjections.push(message);
  }

  /**
   * Drain all pending injections into the message history as user messages.
   * Returns true if any messages were drained.
   */
  private drainInjections(): boolean {
    if (this.pendingInjections.length === 0) return false;
    while (this.pendingInjections.length > 0) {
      const text = this.pendingInjections.shift()!;
      this.messages.push({
        id: generateId(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      });
    }
    return true;
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [this.messages[0]]; // Keep system prompt
  }

  /**
   * Load prior conversation history (e.g. from a saved session).
   * Replaces all messages after the system prompt.
   */
  loadHistory(history: ChatMessage[]): void {
    this.messages = [this.messages[0], ...history];
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
