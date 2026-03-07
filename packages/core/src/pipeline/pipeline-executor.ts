/**
 * PipelineExecutor — adapter layer that bridges existing infrastructure
 * (OpenRouter client, tool registry, webview messaging) with PipelineEngine.
 *
 * For agent nodes it creates AgentLoop instances with the same callbacks
 * the current system uses, preserving streaming, tool execution feedback,
 * and all UI interaction.
 */

import { PipelineEngine } from './pipeline-engine';
import type { PipelineCallbacks } from './pipeline-engine';
import type {
  Pipeline,
  PipelineNode,
  PipelineExecutionContext,
  AgentNodeConfig,
  ToolNodeConfig,
} from './types';
import { AgentLoop } from '../agent/agent-loop';
import type { AgentLoopHooks, StreamingLLMClient } from '../agent/agent-loop';
import type {
  ToolContext,
  ToolDefinition,
  StreamToken,
  ToolCall,
  ToolResult,
  ChatMessage,
  AgentConfig,
  ParallelBranchInfo,
  SubAgentMessage,
} from '../types';

// ── Configuration ──

export interface PipelineExecutorConfig {
  /** LLM client for streaming chat completions */
  client: StreamingLLMClient;

  /** All available tools (core + LSP + extended) */
  tools: ToolDefinition[];

  /** Tool context (workspace root, file I/O, terminal, etc.) */
  toolContext: ToolContext;

  /** Currently selected model ID (from the chat dropdown) */
  defaultModel: string;

  /** Default system prompt (the standard Archon prompt + CLAUDE.md) */
  defaultSystemPrompt: string;

  /** Project-level context (CLAUDE.md contents) — always appended to every agent,
   *  even when the node overrides the system prompt with a custom one. */
  projectContext?: string;

  /** Whether web search is enabled */
  webSearch?: boolean;

  /** Conversation history from prior messages in this chat session.
   *  Always loaded into the first agent node for multi-turn continuity.
   *  Also loaded into other agent nodes when inheritContext is true. */
  conversationHistory?: ChatMessage[];

  /** Model pool mapping: role → model ID (e.g., { architect: 'anthropic/...', coder: '...' }) */
  modelPool?: Record<string, string>;

  /** Optional Claude CLI provider for per-node provider override in pipelines */
  claudeCliProvider?: import('../providers/claude-cli-provider').ClaudeCliProvider;

  /** Security level for Claude CLI permission mapping */
  securityLevel?: 'yolo' | 'permissive' | 'standard' | 'strict';

  /** Workspace root for Claude CLI --add-dir */
  workspaceRoot?: string;

  /** Resolved attachments from the user message (images, files, PDFs). */
  attachments?: import('../types').Attachment[];

  /** Optional hook callbacks for the agentic loop middleware system.
   *  When provided, every AgentLoop created by this executor will have these hooks wired in. */
  agentLoopHooks?: AgentLoopHooks;
}

// ── Callbacks for UI updates ──

export interface PipelineExecutorCallbacks {
  onToken: (token: StreamToken, branchId?: string) => void;
  onToolCall: (tc: ToolCall, branchId?: string) => void;
  onToolResult: (result: ToolResult, branchId?: string) => void;
  onMessageComplete: (msg: ChatMessage, branchId?: string) => void;
  onNodeStart: (node: PipelineNode) => void;
  onNodeComplete: (node: PipelineNode, result: string) => void;
  onNodeFail: (node: PipelineNode, error: string) => void;
  onPipelineComplete: (context: PipelineExecutionContext) => void;
  onPipelineError: (error: string) => void;
  onParallelStart: (branches: ParallelBranchInfo[]) => void;
  onBranchComplete: (branchId: string, label: string) => void;
  onParallelComplete: () => void;
  askUser: (prompt: string, options?: import('../types').AskUserOptionInput[], multiSelect?: boolean) => Promise<string>;
  runVerification: (type: string, command?: string) => Promise<{ passed: boolean; output: string }>;
}

// ── Executor ──

export class PipelineExecutor {
  private config: PipelineExecutorConfig;
  private uiCallbacks: PipelineExecutorCallbacks;
  private engine: PipelineEngine | null = null;
  private currentAgentLoop: AgentLoop | null = null;
  private lastAgentLoop: AgentLoop | null = null;
  /** All concurrently running agent loops (for parallel branches) */
  private activeAgentLoops = new Map<string, AgentLoop>();
  private isFirstAgentNode = true;

  constructor(
    config: PipelineExecutorConfig,
    callbacks: PipelineExecutorCallbacks,
  ) {
    this.config = config;
    this.uiCallbacks = callbacks;
  }

  /**
   * Execute a pipeline with the given user input.
   * Returns the execution context when complete.
   */
  async execute(pipeline: Pipeline, input: string): Promise<PipelineExecutionContext> {
    this.isFirstAgentNode = true;
    const pipelineCallbacks = this.buildPipelineCallbacks();

    this.engine = new PipelineEngine(
      pipeline,
      pipelineCallbacks,
      this.config.toolContext,
    );

    const context = await this.engine.execute(input);
    this.engine = null;
    return context;
  }

  /**
   * Abort the currently running pipeline.
   */
  abort(): void {
    this.currentAgentLoop?.cancel();
    for (const loop of this.activeAgentLoops.values()) {
      loop.cancel();
    }
    this.activeAgentLoops.clear();
    this.engine?.abort();
  }

  /**
   * Inject a user message into the currently running agent loop.
   * Returns true if an agent is running and the message was queued,
   * false if no agent is currently executing (e.g., at a checkpoint or verification node).
   */
  injectUserMessage(message: string): boolean {
    if (this.currentAgentLoop) {
      this.currentAgentLoop.injectMessage(message);
      return true;
    }
    return false;
  }

  /**
   * Get the last AgentLoop that executed (for conversation continuity).
   * Returns the active one if still running, or the most recent completed one.
   */
  getLastAgentLoop(): AgentLoop | null {
    return this.currentAgentLoop ?? this.lastAgentLoop;
  }

  private buildPipelineCallbacks(): PipelineCallbacks {
    return {
      // ── Status callbacks → forward to UI ──
      onNodeStart: (node) => this.uiCallbacks.onNodeStart(node),
      onNodeComplete: (node, result) => this.uiCallbacks.onNodeComplete(node, result),
      onNodeFail: (node, error) => this.uiCallbacks.onNodeFail(node, error),
      onPipelineComplete: (ctx) => this.uiCallbacks.onPipelineComplete(ctx),
      onPipelineError: (error) => this.uiCallbacks.onPipelineError(error),
      onParallelStart: (branches) => this.uiCallbacks.onParallelStart(branches),
      onBranchComplete: (branchId, label) => this.uiCallbacks.onBranchComplete(branchId, label),
      onParallelComplete: () => this.uiCallbacks.onParallelComplete(),

      // ── Agent execution → creates an AgentLoop with full streaming ──
      executeAgent: (node, config, input) => this.executeAgent(node, config, input),

      // ── Tool execution → delegates to tool registry ──
      executeTool: (config, toolContext) => this.executeTool(config, toolContext),

      // ── Condition evaluation → lightweight LLM call ──
      evaluateCondition: (condition, ctx) => this.evaluateCondition(condition, ctx),

      // ── User interaction → webview prompt ──
      askUser: (prompt, options) => this.uiCallbacks.askUser(prompt, options),

      // ── Verification → LSP diagnostics, test runner, etc. ──
      runVerification: (type, command) => this.uiCallbacks.runVerification(type, command),
    };
  }

  /**
   * Execute an agent node by creating a new AgentLoop instance.
   * Uses the same streaming and tool execution callbacks as the current system.
   * When branchId is set (parallel execution), callbacks are tagged so the UI
   * can route output to the correct branch container.
   */
  private async executeAgent(
    node: PipelineNode,
    config: AgentNodeConfig,
    input: string,
  ): Promise<string> {
    // Route to Claude CLI if this node specifies the claude-cli provider
    if (config.provider === 'claude-cli' && this.config.claudeCliProvider) {
      return this.executeAgentViaCli(node, config, input);
    }

    const branchId = node.branchId;
    const model = this.resolveModel(config.model);
    const basePrompt = config.systemPrompt ?? this.config.defaultSystemPrompt;
    // Always append project context (CLAUDE.md) so agents know the project,
    // even when they have a custom system prompt override.
    const systemPrompt = this.config.projectContext
      ? `${basePrompt}\n\n## Project Instructions\n\n${this.config.projectContext}`
      : basePrompt;
    const tools = this.resolveTools(config.tools);

    const agentConfig: AgentConfig = {
      model,
      systemPrompt,
      tools,
      maxIterations: config.maxIterations ?? 25,
      temperature: config.temperature,
      webSearch: this.config.webSearch,
    };

    let finalContent = '';

    const agentLoop = new AgentLoop(
      this.config.client,
      agentConfig,
      this.config.toolContext,
      {
        onToken: (token) => this.uiCallbacks.onToken(token, branchId),
        onToolCall: (tc) => this.uiCallbacks.onToolCall(tc, branchId),
        onToolResult: (result) => this.uiCallbacks.onToolResult(result, branchId),
        onMessageComplete: (msg) => {
          this.uiCallbacks.onMessageComplete(msg, branchId);
          // Capture the last assistant message as the node's output
          if (msg.role === 'assistant' && msg.content) {
            finalContent = msg.content;
          }
        },
        // Delegate spawn_agent calls to the executor for message collection
        parallelSpawn: (tasks) => this.spawnAgentsCollected(tasks),
      },
      this.config.agentLoopHooks,
    );

    // Load conversation history for multi-turn continuity:
    // - First agent node always gets it (so multi-message chats work)
    // - Subsequent agent nodes get it only if inheritContext is true
    // Pass attachments only to the first agent node (they belong to the user's initial message)
    const attachmentsForNode = this.isFirstAgentNode ? this.config.attachments : undefined;

    if (this.config.conversationHistory) {
      if (this.isFirstAgentNode || config.inheritContext) {
        agentLoop.loadHistory(this.config.conversationHistory);
      }
    }
    this.isFirstAgentNode = false;

    // Track the loop — for parallel branches use the map, otherwise use the single ref
    if (branchId) {
      this.activeAgentLoops.set(branchId, agentLoop);
    } else {
      this.currentAgentLoop = agentLoop;
    }

    try {
      await agentLoop.run(input, attachmentsForNode);
    } finally {
      if (branchId) {
        this.activeAgentLoops.delete(branchId);
      } else {
        this.lastAgentLoop = agentLoop;
        this.currentAgentLoop = null;
      }
    }

    return finalContent;
  }

  /**
   * Execute an agent node via Claude CLI provider.
   * Used when a pipeline node has provider='claude-cli'.
   */
  private async executeAgentViaCli(
    node: PipelineNode,
    config: AgentNodeConfig,
    input: string,
  ): Promise<string> {
    const branchId = node.branchId;
    const provider = this.config.claudeCliProvider!;
    const model = this.resolveModel(config.model);
    const basePrompt = config.systemPrompt ?? this.config.defaultSystemPrompt;
    const systemPrompt = this.config.projectContext
      ? `${basePrompt}\n\n## Project Instructions\n\n${this.config.projectContext}`
      : basePrompt;

    const executor = provider.createExecutor({
      model,
      systemPrompt,
      tools: this.config.tools,
      toolContext: this.config.toolContext,
      securityLevel: this.config.securityLevel,
      workspaceRoot: this.config.workspaceRoot,
    });

    let finalContent = '';

    this.isFirstAgentNode = false;

    await executor.run(input, {
      onToken: (token) => this.uiCallbacks.onToken(token, branchId),
      onToolCall: (tc) => this.uiCallbacks.onToolCall(tc, branchId),
      onToolResult: (result) => this.uiCallbacks.onToolResult(result, branchId),
      onMessageComplete: (msg) => {
        this.uiCallbacks.onMessageComplete(msg, branchId);
        if (msg.role === 'assistant' && msg.content) {
          finalContent = msg.content;
        }
      },
    });

    return finalContent;
  }

  /**
   * Execute a tool node by finding the tool in the registry and running it.
   */
  private async executeTool(config: ToolNodeConfig, toolContext: ToolContext): Promise<string> {
    const tool = this.config.tools.find(t => t.name === config.toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${config.toolName}`);
    }

    const result = await tool.execute(
      config.parameters as Record<string, unknown>,
      toolContext,
    );
    return result;
  }

  /**
   * Evaluate a condition using a lightweight LLM call.
   * The model is asked to respond with "true" or "false".
   */
  private async evaluateCondition(
    condition: string,
    context: PipelineExecutionContext,
  ): Promise<boolean> {
    // Build a context summary for the LLM
    const contextSummary = Array.from(context.results.entries())
      .map(([nodeId, result]) => `[${nodeId}]: ${result.slice(0, 500)}`)
      .join('\n');

    const prompt = `Given the following execution context:\n${contextSummary}\n\nEvaluate this condition and respond with ONLY "true" or "false":\n${condition}`;

    // Use a simple non-streaming call for condition evaluation
    const messages = [
      { id: 'sys', role: 'system' as const, content: 'You are a condition evaluator. Respond with only "true" or "false".', timestamp: Date.now() },
      { id: 'usr', role: 'user' as const, content: prompt, timestamp: Date.now() },
    ];

    let result = '';
    const stream = this.config.client.streamChat(
      this.config.defaultModel,
      messages,
      [], // no tools needed
    );

    for await (const token of stream) {
      if (token.type === 'text' && token.content) {
        result += token.content;
      }
    }

    return result.trim().toLowerCase() === 'true';
  }

  /**
   * Resolve model ID: 'default' or undefined → use chat-selected model,
   * 'pool:role' → look up from model pool, otherwise use as-is.
   */
  private resolveModel(model?: string): string {
    if (!model || model === 'default') {
      return this.config.defaultModel;
    }
    // Resolve 'pool:architect' → actual model ID from user's model pool
    if (model.startsWith('pool:') && this.config.modelPool) {
      const role = model.slice(5);
      const poolModel = this.config.modelPool[role];
      if (poolModel) return poolModel;
      // Unknown role — fall back to default
      return this.config.defaultModel;
    }
    return model;
  }

  /**
   * Spawn a sub-agent for a specific task.
   * Used by the spawn_agent tool and parallel node execution.
   * When branchId is provided, all streaming output is tagged for that branch.
   * When collectMessages is true, sub-agent activity is collected silently
   * instead of streaming to the UI (used by spawn_agent tool calls).
   */
  async spawnAgent(
    systemPrompt: string,
    task: string,
    model?: string,
    branchId?: string,
    collectMessages?: boolean,
  ): Promise<{ content: string; subMessages: SubAgentMessage[] }> {
    const resolvedModel = this.resolveModel(model);

    const agentConfig: AgentConfig = {
      model: resolvedModel,
      systemPrompt,
      tools: this.config.tools,
      maxIterations: 15,
      webSearch: this.config.webSearch,
    };

    let finalContent = '';
    const collected: SubAgentMessage[] = [];

    // Track in-flight tool calls so we can pair results with their names/args
    const pendingTools = new Map<string, { name: string; args: Record<string, unknown> }>();

    const agentLoop = new AgentLoop(
      this.config.client,
      agentConfig,
      this.config.toolContext,
      {
        onToken: collectMessages
          ? () => { /* silent — tokens contribute to onMessageComplete */ }
          : (token) => this.uiCallbacks.onToken(token, branchId),
        onToolCall: collectMessages
          ? (tc) => {
              pendingTools.set(tc.id, { name: tc.name, args: tc.arguments });
              collected.push({
                role: 'tool',
                content: '',
                toolName: tc.name,
                toolArgs: tc.arguments,
              });
            }
          : (tc) => this.uiCallbacks.onToolCall(tc, branchId),
        onToolResult: collectMessages
          ? (result) => {
              // Find the matching collected tool entry and attach the result
              const pending = pendingTools.get(result.toolCallId);
              let entry: SubAgentMessage | undefined;
              for (let j = collected.length - 1; j >= 0; j--) {
                const m = collected[j];
                if (m.role === 'tool' && m.toolName === pending?.name && !m.toolResult) {
                  entry = m;
                  break;
                }
              }
              if (entry) {
                entry.toolResult = result.content;
                entry.isError = result.isError;
              }
            }
          : (result) => this.uiCallbacks.onToolResult(result, branchId),
        onMessageComplete: collectMessages
          ? (msg) => {
              if (msg.role === 'assistant' && msg.content) {
                finalContent = msg.content;
                collected.push({ role: 'assistant', content: msg.content });
              }
            }
          : (msg) => {
              this.uiCallbacks.onMessageComplete(msg, branchId);
              if (msg.role === 'assistant' && msg.content) {
                finalContent = msg.content;
              }
            },
        parallelSpawn: (tasks) => this.spawnAgentsCollected(tasks),
      },
      this.config.agentLoopHooks,
    );

    if (branchId) {
      this.activeAgentLoops.set(branchId, agentLoop);
    }

    try {
      await agentLoop.run(task);
    } finally {
      if (branchId) {
        this.activeAgentLoops.delete(branchId);
      }
    }

    return { content: finalContent, subMessages: collected };
  }

  /**
   * Spawn multiple sub-agents in parallel, collecting their messages silently.
   * Used when the spawn_agent tool is called — output stays inside the tool call bubble.
   */
  async spawnAgentsCollected(
    tasks: Array<{ systemPrompt: string; task: string; model?: string }>,
  ): Promise<Array<{ content: string; subMessages: SubAgentMessage[] }>> {
    return Promise.all(
      tasks.map(async (t) => {
        try {
          return await this.spawnAgent(t.systemPrompt, t.task, t.model, undefined, true);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: `Error: ${msg}`, subMessages: [] };
        }
      }),
    );
  }

  /**
   * Resolve tools: undefined → all tools, specific names → filter to those tools.
   */
  private resolveTools(toolNames?: string[]): ToolDefinition[] {
    if (!toolNames || toolNames.length === 0) {
      return this.config.tools;
    }
    return this.config.tools.filter(t => toolNames.includes(t.name));
  }
}
