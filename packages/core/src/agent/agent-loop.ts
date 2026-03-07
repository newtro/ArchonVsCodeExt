/**
 * Core agentic loop: receives user message, streams LLM response,
 * executes tool calls, feeds results back, repeats until completion.
 */

import type {
  AgentConfig,
  Attachment,
  ChatMessage,
  StreamToken,
  ToolCall,
  ToolDefinition,
  ToolContext,
  ToolResult,
  SubAgentMessage,
} from '../types';

/**
 * Any LLM client that can stream chat completions.
 * Both OpenRouterClient and OpenAIClient implement this interface.
 */
export interface StreamingLLMClient {
  streamChat(
    model: string,
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    temperature?: number,
    options?: { webSearch?: boolean },
  ): AsyncGenerator<StreamToken>;
}

/**
 * Hook callbacks that the HookEngine (or any middleware) can wire into.
 * All are optional — when absent, the loop behaves as before.
 */
export interface AgentLoopHooks {
  /** Called before each LLM API call. Can modify the messages array. */
  onBeforeLLMCall?(messages: ChatMessage[]): Promise<ChatMessage[]>;
  /** Called after LLM response. Can modify text content and tool calls. */
  onAfterLLMCall?(response: { textContent: string; toolCalls: ToolCall[] }): Promise<{ textContent: string; toolCalls: ToolCall[] }>;
  /** Called before each tool execution. Return null to block. */
  onBeforeToolExec?(toolCall: ToolCall): Promise<ToolCall | null>;
  /** Called after each tool execution. Can modify the result. */
  onAfterToolExec?(toolCall: ToolCall, result: ToolResult): Promise<ToolResult>;
  /** Called before each loop iteration. Can inject messages or signal stop. */
  onIteration?(state: { iteration: number; messages: ChatMessage[] }): Promise<{ stop?: boolean; inject?: string[] }>;
  /** Called when the loop starts a turn. */
  onTurnStart?(userMessage: string, attachments?: Attachment[]): Promise<{ userMessage: string; attachments?: Attachment[] }>;
  /** Called when the loop ends a turn. */
  onTurnEnd?(messages: ChatMessage[], toolCallsMade: ToolCall[]): Promise<void>;
  /** Called on unrecoverable error. */
  onTurnError?(error: Error, partialHistory: ChatMessage[]): Promise<void>;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export class AgentLoop {
  private client: StreamingLLMClient;
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
  private hooks: AgentLoopHooks;

  constructor(
    client: StreamingLLMClient,
    config: AgentConfig,
    toolContext: ToolContext,
    callbacks: {
      onToken: (token: StreamToken) => void;
      onToolCall: (tc: ToolCall) => void;
      onToolResult: (result: ToolResult) => void;
      onMessageComplete: (msg: ChatMessage) => void;
      parallelSpawn?: (tasks: Array<{ systemPrompt: string; task: string; model?: string }>) => Promise<Array<{ content: string; subMessages: SubAgentMessage[] }>>;
    },
    hooks?: AgentLoopHooks,
  ) {
    this.client = client;
    this.config = config;
    this.toolContext = toolContext;
    this.onToken = callbacks.onToken;
    this.onToolCall = callbacks.onToolCall;
    this.onToolResult = callbacks.onToolResult;
    this.onMessageComplete = callbacks.onMessageComplete;
    this.parallelSpawn = callbacks.parallelSpawn;
    this.hooks = hooks ?? {};

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
  async run(userMessage: string, attachments?: Attachment[]): Promise<void> {
    this.abortController = new AbortController();

    // Hook: turn:start — allow hooks to modify the user message
    if (this.hooks.onTurnStart) {
      const modified = await this.hooks.onTurnStart(userMessage, attachments);
      userMessage = modified.userMessage;
      attachments = modified.attachments;
    }

    this.messages.push({
      id: generateId(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      attachments: attachments?.length ? attachments : undefined,
    });

    const maxIterations = this.config.maxIterations ?? Infinity;
    const allToolCalls: ToolCall[] = [];

    try {
    for (let i = 0; i < maxIterations; i++) {
      if (this.abortController.signal.aborted) break;

      // Hook: loop:iterate — allow hooks to inject messages or stop
      if (this.hooks.onIteration) {
        const iterResult = await this.hooks.onIteration({ iteration: i, messages: this.messages });
        if (iterResult.stop) break;
        if (iterResult.inject) {
          for (const msg of iterResult.inject) {
            this.messages.push({ id: generateId(), role: 'user', content: msg, timestamp: Date.now() });
          }
        }
      }

      // Hook: llm:before — allow hooks to modify messages before LLM call
      let messagesForLLM = this.messages;
      if (this.hooks.onBeforeLLMCall) {
        messagesForLLM = await this.hooks.onBeforeLLMCall([...this.messages]);
        // Don't mutate internal messages — hooks see a copy
      }

      let { textContent, toolCalls } = await this.streamResponse(messagesForLLM);

      // Hook: llm:after — allow hooks to modify the LLM response
      if (this.hooks.onAfterLLMCall) {
        const modified = await this.hooks.onAfterLLMCall({ textContent, toolCalls });
        textContent = modified.textContent;
        toolCalls = modified.toolCalls;
      }

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
        for (const tc of toolCalls) {
          allToolCalls.push(tc);
          this.onToolCall(tc);
        }

        const tasks = toolCalls.map(tc => ({
          systemPrompt: tc.arguments.system_prompt as string,
          task: tc.arguments.task as string,
          model: tc.arguments.model as string | undefined,
        }));

        const spawnResults = await this.parallelSpawn(tasks);

        for (let j = 0; j < toolCalls.length; j++) {
          const sr = spawnResults[j];
          let result: ToolResult = {
            toolCallId: toolCalls[j].id,
            content: sr?.content ?? 'No result',
            subMessages: sr?.subMessages,
          };
          // Hook: tool:after
          if (this.hooks.onAfterToolExec) {
            result = await this.hooks.onAfterToolExec(toolCalls[j], result);
          }
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

          // Hook: tool:before — can modify args or block execution
          let currentTc: ToolCall | null = tc;
          if (this.hooks.onBeforeToolExec) {
            currentTc = await this.hooks.onBeforeToolExec(tc);
          }

          if (!currentTc) {
            // Hook blocked this tool call — push a blocked result
            const blockedResult: ToolResult = {
              toolCallId: tc.id,
              content: `Tool "${tc.name}" was blocked by a hook`,
              isError: false,
            };
            this.onToolCall(tc);
            this.onToolResult(blockedResult);
            this.messages.push({
              id: generateId(),
              role: 'tool',
              content: blockedResult.content,
              toolCallId: blockedResult.toolCallId,
              timestamp: Date.now(),
            });
            continue;
          }

          allToolCalls.push(currentTc);
          this.onToolCall(currentTc);
          let result = await this.executeTool(currentTc);

          // Hook: tool:after — can modify the result
          if (this.hooks.onAfterToolExec) {
            result = await this.hooks.onAfterToolExec(currentTc, result);
          }

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

    // Hook: turn:end
    if (this.hooks.onTurnEnd) {
      await this.hooks.onTurnEnd(this.messages, allToolCalls);
    }

    } catch (err) {
      // Hook: turn:error
      if (this.hooks.onTurnError) {
        await this.hooks.onTurnError(
          err instanceof Error ? err : new Error(String(err)),
          this.messages,
        );
      }
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  /** Set or replace hook callbacks (used by HookEngine to wire in). */
  setHooks(hooks: AgentLoopHooks): void {
    this.hooks = hooks;
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
   * System messages from history are filtered out — we keep only
   * the system prompt set by this agent loop's config.
   */
  loadHistory(history: ChatMessage[]): void {
    this.messages = [this.messages[0], ...history.filter(m => m.role !== 'system')];
  }

  private async streamResponse(messages?: ChatMessage[]): Promise<{ textContent: string; toolCalls: ToolCall[] }> {
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    const stream = this.client.streamChat(
      this.config.model,
      messages ?? this.messages,
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
