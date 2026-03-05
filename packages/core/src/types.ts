/**
 * Core types for the Archon agent system.
 */

// ── Messages ──

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

// ── Models ──

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextLength: number;
  pricing?: {
    prompt: number;   // per million tokens
    completion: number;
  };
  supportsTools?: boolean;
  supportsStreaming?: boolean;
}

// ── Tools ──

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
  default?: unknown;
}

export interface ToolContext {
  workspaceRoot: string;
  sendMessage: (msg: string) => void;
  askUser: (prompt: string, options?: string[]) => Promise<string>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  executeCommand: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  getDiagnostics: (uri: string) => Promise<DiagnosticInfo[]>;
  applyEdit: (uri: string, edits: TextEditInfo[]) => Promise<boolean>;
}

export interface DiagnosticInfo {
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
  source?: string;
}

export interface TextEditInfo {
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
  newText: string;
}

// ── Agent ──

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  maxIterations?: number;
  temperature?: number;
  webSearch?: boolean;
}

export interface StreamToken {
  type: 'text' | 'tool_call_start' | 'tool_call_args' | 'tool_call_end' | 'done' | 'error';
  content?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
}

// ── Attachments ──

export interface Attachment {
  id: string;
  name: string;
  type: 'file' | 'image';
  content: string;
  dataUri?: string;
}

// ── Chat Sessions ──

export interface ChatSessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  isError?: boolean;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  messages: ChatSessionMessage[];
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  timestamp: number;
  messageCount: number;
}

// ── Benchmarks ──

export interface BenchmarkSource {
  name: string;
  url: string;
  lastFetched: number;
  entries: BenchmarkModelEntry[];
}

export interface BenchmarkModelEntry {
  model: string;
  provider: string;
  score: number;
  secondaryScore?: number;
  cost?: number;
  date?: string;
}

// ── Events (extension ↔ webview) ──

export type ExtensionMessage =
  | { type: 'streamToken'; token: StreamToken }
  | { type: 'messageComplete'; message: ChatMessage }
  | { type: 'toolCallStart'; toolCall: ToolCall }
  | { type: 'toolCallResult'; result: ToolResult }
  | { type: 'modelsLoaded'; models: ModelInfo[] }
  | { type: 'modelChanged'; modelId: string }
  | { type: 'error'; error: string }
  | { type: 'askUser'; id: string; prompt: string; options?: string[] }
  | { type: 'filePicked'; path: string; content: string }
  | { type: 'workspaceFilesResult'; files: string[] }
  | { type: 'settingsLoaded'; securityLevel: string; archiveEnabled: boolean; modelPool: string[]; hasBraveApiKey: boolean; webSearchEnabled: boolean }
  | { type: 'chatSessionsLoaded'; sessions: ChatSessionSummary[] }
  | { type: 'chatSessionLoaded'; session: ChatSession }
  | { type: 'benchmarksLoaded'; sources: BenchmarkSource[] }
  | { type: 'benchmarkError'; error: string }
  | { type: 'modelPoolUpdated'; modelPool: string[] }
  | { type: 'indexingStatus'; state: 'idle' | 'indexing' | 'ready' | 'error'; filesIndexed?: number; totalFiles?: number; chunkCount?: number; error?: string }
  | { type: 'agentLoopDone' };

export type WebviewMessage =
  | { type: 'sendMessage'; content: string; attachments?: Attachment[] }
  | { type: 'cancelRequest' }
  | { type: 'selectModel'; modelId: string }
  | { type: 'loadModels' }
  | { type: 'newChat' }
  | { type: 'setApiKey'; key: string }
  | { type: 'askUserResponse'; id: string; response: string }
  | { type: 'pickFile' }
  | { type: 'searchWorkspaceFiles'; query: string }
  | { type: 'setSecurityLevel'; level: string }
  | { type: 'setArchiveEnabled'; enabled: boolean }
  | { type: 'loadSettings' }
  | { type: 'loadChatSessions' }
  | { type: 'loadChatSession'; sessionId: string }
  | { type: 'saveChatSession'; messages: ChatSessionMessage[] }
  | { type: 'refreshBenchmarks' }
  | { type: 'saveModelPool'; modelPool: string[] }
  | { type: 'addToModelPool'; modelId: string }
  | { type: 'setBraveApiKey'; key: string }
  | { type: 'setWebSearchEnabled'; enabled: boolean }
  | { type: 'reindexCodebase' };
