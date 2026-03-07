/**
 * Provider abstraction layer.
 *
 * Two execution models coexist:
 * - OpenRouter: our AgentLoop + our tools + OpenRouter API (LLM-only provider)
 * - Claude CLI: Claude Code subprocess with native tools (full agent provider)
 *
 * Both emit a common ExecutionEvent stream consumed by the UI layer.
 */

import type { ChatMessage, ModelInfo, StreamToken, ToolCall, ToolResult, ToolDefinition, ToolContext, AgentConfig, SubAgentMessage, ParallelBranchInfo } from '../types';

// ── Execution Events (common UI interface) ──

export type ExecutionEvent =
  | { type: 'text'; content: string; partial?: boolean }
  | { type: 'tool_start'; tool: string; input: Record<string, unknown>; id: string }
  | { type: 'tool_result'; id: string; output: string; isError?: boolean }
  | { type: 'thinking'; content: string }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'message_complete'; message: ChatMessage }
  | { type: 'complete'; sessionId?: string; usage?: TokenUsage }
  // Legacy StreamToken passthrough (for OpenRouter executor compatibility)
  | { type: 'stream_token'; token: StreamToken };

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

// ── Provider Interface ──

export type ProviderId = 'openrouter' | 'claude-cli' | 'openai';

export interface LLMProvider {
  readonly id: ProviderId;
  readonly name: string;

  /** Check if this provider can be used (API key set, CLI available, etc.) */
  isAvailable(): Promise<boolean>;

  /** Get available models for this provider */
  getModels(): Promise<ModelInfo[]>;

  /** Create an executor for running a conversation */
  createExecutor(config: ExecutorConfig): Executor;
}

export interface ExecutorConfig {
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  toolContext: ToolContext;
  temperature?: number;
  webSearch?: boolean;
  conversationHistory?: ChatMessage[];
  modelPool?: Record<string, string>;
  /** Security level for permission mapping (Claude CLI uses this) */
  securityLevel?: 'yolo' | 'permissive' | 'standard' | 'strict';
  /** Working directory (Claude CLI uses this for --add-dir) */
  workspaceRoot?: string;
  /** Path to MCP config JSON file (Claude CLI uses this for --mcp-config) */
  mcpConfigPath?: string;
  /** Session ID for resuming a previous conversation (Claude CLI --resume) */
  sessionId?: string;
}

export interface Executor {
  /**
   * Run a user message through the provider.
   * For OpenRouter: runs the agent loop with tool execution.
   * For Claude CLI: spawns a subprocess and streams NDJSON.
   */
  run(
    userMessage: string,
    callbacks: ExecutorCallbacks,
  ): Promise<void>;

  /** Abort the current execution */
  abort(): void;

  /** Inject a follow-up user message into a running execution */
  injectMessage?(message: string): boolean;

  /** Get conversation history (for session continuity) */
  getMessages?(): ChatMessage[];

  /** Load prior conversation history */
  loadHistory?(history: ChatMessage[]): void;

  /** Clear conversation (keep system prompt) */
  clearMessages?(): void;

  /** Get session ID (for Claude CLI --resume) */
  getSessionId?(): string | null;
}

export interface ExecutorCallbacks {
  onToken: (token: StreamToken, branchId?: string) => void;
  onToolCall: (tc: ToolCall, branchId?: string) => void;
  onToolResult: (result: ToolResult, branchId?: string) => void;
  onMessageComplete: (msg: ChatMessage, branchId?: string) => void;
  parallelSpawn?: (tasks: Array<{ systemPrompt: string; task: string; model?: string }>) => Promise<Array<{ content: string; subMessages: SubAgentMessage[] }>>;
}
