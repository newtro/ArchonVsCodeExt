/**
 * Types for the agentic loop hook/middleware system.
 */

import type { ChatMessage, ToolCall, ToolResult, StreamToken } from '../types';

// ── Hook Points ──

export type HookPoint =
  // Turn lifecycle
  | 'turn:start'
  | 'turn:end'
  | 'turn:error'
  // LLM lifecycle
  | 'llm:before'
  | 'llm:after'
  | 'llm:stream'
  // Tool lifecycle
  | 'tool:before'
  | 'tool:after'
  | 'tool:error'
  // Loop control
  | 'loop:iterate'
  | 'loop:complete'
  | 'loop:max_iterations'
  // Agent lifecycle
  | 'agent:spawn'
  | 'agent:complete';

// ── Hook Timing ──

export type HookTiming = 'sync' | 'async' | 'deferred';

// ── Node Types ──

export type HookNodeType = 'llm' | 'template' | 'script' | 'decision';

// ── Hook Actions ──

/** What a hook wants to do after executing. */
export type HookAction = 'pass' | 'modify' | 'block' | 'abort';

// ── Variable System ──

export type VariableScope = 'turn' | 'session' | 'persistent';
export type VariableType = 'string' | 'number' | 'boolean' | 'json';

export interface VariableDefinition {
  name: string;
  scope: VariableScope;
  type: VariableType;
  default: unknown;
}

export interface VariableStore {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  getAll(): Record<string, unknown>;
  snapshot(): Record<string, unknown>;
  clearScope(scope: VariableScope): void;
}

// ── Node Configurations ──

export interface LLMNodeConfig {
  prompt: string;
  provider?: string;
  model?: string;
  tools?: string[];
  maxTokens?: number;
  temperature?: number;
}

export interface TemplateNodeConfig {
  templateId: string;
  overrides?: Partial<LLMNodeConfig>;
}

export interface ScriptNodeConfig {
  runtime: 'node' | 'python' | 'shell';
  entrypoint?: string;
  inline?: string;
  timeout?: number;
}

export interface DecisionNodeConfig {
  mode: 'regex' | 'expression' | 'llm';
  // Regex mode
  pattern?: string;
  target?: string;
  // Expression mode
  expression?: string;
  // LLM mode
  prompt?: string;
  model?: string;
  // Flow control
  onTrue?: 'continue' | 'skip';
  onFalse?: 'continue' | 'skip';
}

export type HookNodeConfig =
  | { type: 'llm'; config: LLMNodeConfig }
  | { type: 'template'; config: TemplateNodeConfig }
  | { type: 'script'; config: ScriptNodeConfig }
  | { type: 'decision'; config: DecisionNodeConfig };

// ── Hook Node ──

export interface HookNode {
  id: string;
  name: string;
  type: HookNodeType;
  config: LLMNodeConfig | TemplateNodeConfig | ScriptNodeConfig | DecisionNodeConfig;
  timing: HookTiming;
  enabled: boolean;
}

// ── Hook Chain ──

export interface HookChain {
  id: string;
  hookPoint: HookPoint;
  /** Priority within the hook point (lower = earlier). */
  priority: number;
  /** Whether this chain runs in parallel (observe-only) or sequential (can modify). */
  mode: 'sequential' | 'parallel';
  nodes: HookNode[];
  enabled: boolean;
}

// ── Hook Configuration (persisted) ──

export interface HookConfiguration {
  version: number;
  variables: VariableDefinition[];
  chains: HookChain[];
  compositionBlocks: CompositionBlock[];
}

export interface CompositionBlock {
  id: string;
  name: string;
  description?: string;
  nodes: HookNode[];
}

// ── Hook Execution Context ──

/** Data passed to hooks at each hook point. */
export interface HookContext {
  hookPoint: HookPoint;
  data: HookPointData;
  variables: Record<string, unknown>;
}

/** Union of all data shapes for each hook point. */
export type HookPointData =
  | TurnStartData
  | TurnEndData
  | TurnErrorData
  | LLMBeforeData
  | LLMAfterData
  | LLMStreamData
  | ToolBeforeData
  | ToolAfterData
  | ToolErrorData
  | LoopIterateData
  | LoopCompleteData
  | LoopMaxIterationsData
  | AgentSpawnData
  | AgentCompleteData;

export interface TurnStartData {
  type: 'turn:start';
  userMessage: string;
  attachments?: unknown[];
  sessionState: Record<string, unknown>;
}

export interface TurnEndData {
  type: 'turn:end';
  messages: ChatMessage[];
  toolCallsMade: ToolCall[];
  finalResponse: string;
}

export interface TurnErrorData {
  type: 'turn:error';
  error: Error;
  partialHistory: ChatMessage[];
}

export interface LLMBeforeData {
  type: 'llm:before';
  messages: ChatMessage[];
  systemPrompt: string;
  model: string;
  temperature?: number;
}

export interface LLMAfterData {
  type: 'llm:after';
  textContent: string;
  toolCalls: ToolCall[];
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

export interface LLMStreamData {
  type: 'llm:stream';
  token: StreamToken;
  accumulatedText: string;
}

export interface ToolBeforeData {
  type: 'tool:before';
  toolCall: ToolCall;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolAfterData {
  type: 'tool:after';
  toolCall: ToolCall;
  result: ToolResult;
  duration: number;
}

export interface ToolErrorData {
  type: 'tool:error';
  toolCall: ToolCall;
  error: Error;
}

export interface LoopIterateData {
  type: 'loop:iterate';
  iteration: number;
  messages: ChatMessage[];
  toolCallHistory: ToolCall[];
}

export interface LoopCompleteData {
  type: 'loop:complete';
  messages: ChatMessage[];
  completionResult: string;
}

export interface LoopMaxIterationsData {
  type: 'loop:max_iterations';
  iteration: number;
  messages: ChatMessage[];
}

export interface AgentSpawnData {
  type: 'agent:spawn';
  spawnConfig: Record<string, unknown>;
  parentContext: Record<string, unknown>;
}

export interface AgentCompleteData {
  type: 'agent:complete';
  result: string;
  childMessages: ChatMessage[];
}

// ── Hook Result ──

/** What a hook node returns after execution. */
export interface HookResult {
  action: HookAction;
  modifications?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  /** For decision nodes: whether the condition was true. */
  decision?: boolean;
  /** Execution metadata. */
  duration?: number;
  summary?: string;
  error?: string;
}

// ── Debugger Events ──

export type HookExecutionStatus = 'pending' | 'running' | 'completed' | 'error' | 'skipped';

export interface HookExecutionEvent {
  id: string;
  timestamp: number;
  hookPoint: HookPoint;
  chainId: string;
  nodeId: string;
  nodeName: string;
  status: HookExecutionStatus;
  input?: HookContext;
  result?: HookResult;
  duration?: number;
}

export interface HookDebugState {
  turn: number;
  hookPointStates: Map<HookPoint, HookExecutionStatus>;
  events: HookExecutionEvent[];
  variables: Record<string, unknown>;
}

// ── Template Definitions ──

export interface HookTemplate {
  id: string;
  name: string;
  description: string;
  hookPoint: HookPoint;
  nodes: HookNode[];
}

// ── Extension ↔ Webview Messages ──

export interface HookConfigMessage {
  type: 'hookConfig';
  config: HookConfiguration;
}

export interface HookDebugMessage {
  type: 'hookDebug';
  event: HookExecutionEvent;
}

export interface HookVariableMessage {
  type: 'hookVariables';
  variables: Record<string, unknown>;
}
