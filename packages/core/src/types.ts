/**
 * Core types for the Archon agent system.
 */

// ── Ask-User option (supports label + optional description) ──

export interface AskUserOption {
  label: string;
  description?: string;
}

export type AskUserOptionInput = string | AskUserOption;

// ── Messages ──

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: number;
  /** Attachments for multimodal messages (images, files, PDFs). */
  attachments?: Attachment[];
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
  /** Collected sub-agent activity (for spawn_agent tool calls). */
  subMessages?: SubAgentMessage[];
}

/** A single activity record from a spawned sub-agent. */
export interface SubAgentMessage {
  role: 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  isError?: boolean;
}

// ── Todos ──

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'error' | 'skipped';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoList {
  title?: string;
  items: TodoItem[];
  turnId: string;
  startedAt: number;
}

export interface TodoSummary {
  title?: string;
  total: number;
  completed: number;
  error: number;
  skipped: number;
  abandoned: number;
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
  askUser: (prompt: string, options?: AskUserOptionInput[], multiSelect?: boolean) => Promise<string>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  executeCommand: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  getDiagnostics: (uri: string) => Promise<DiagnosticInfo[]>;
  applyEdit: (uri: string, edits: TextEditInfo[]) => Promise<boolean>;

  // Pipeline management (optional — available when running inside the extension)
  savePipeline?: (pipeline: import('./pipeline/types').Pipeline, target: 'project' | 'global') => Promise<void>;
  getPipeline?: (id: string) => Promise<import('./pipeline/types').Pipeline | undefined>;
  getAvailablePipelines?: () => Promise<PipelineInfo[]>;
  deletePipeline?: (id: string) => Promise<boolean>;

  // Todo management (optional — available when running inside the extension)
  updateTodos?: (title: string | undefined, todos: TodoItem[]) => void;
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
  type: 'file' | 'image' | 'pdf';
  content: string;
  dataUri?: string;
  /** MIME type for images (e.g., 'image/png', 'image/jpeg') */
  mimeType?: string;
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

// ── Pipeline Info (for webview pipeline selector) ──

export interface PipelineInfo {
  id: string;
  name: string;
  description?: string;
  source: 'builtin' | 'global' | 'project';
}

// ── Events (extension ↔ webview) ──

export type ExtensionMessage =
  | { type: 'streamToken'; token: StreamToken; branchId?: string }
  | { type: 'messageComplete'; message: ChatMessage; branchId?: string }
  | { type: 'toolCallStart'; toolCall: ToolCall; branchId?: string }
  | { type: 'toolCallResult'; result: ToolResult; branchId?: string }
  | { type: 'parallelStart'; branches: ParallelBranchInfo[] }
  | { type: 'parallelBranchComplete'; branchId: string; label: string }
  | { type: 'parallelComplete' }
  | { type: 'modelsLoaded'; models: ModelInfo[] }
  | { type: 'modelChanged'; modelId: string }
  | { type: 'error'; error: string }
  | { type: 'askUser'; id: string; prompt: string; options?: AskUserOptionInput[]; multiSelect?: boolean }
  | { type: 'filePicked'; path: string; content: string }
  | { type: 'workspaceFilesResult'; files: string[] }
  | { type: 'settingsLoaded'; securityLevel: string; archiveEnabled: boolean; modelPool: string[]; hasBraveApiKey: boolean; webSearchEnabled: boolean; activeProvider: string; claudeCliPath?: string; mcpConfigPath?: string }
  | { type: 'chatSessionsLoaded'; sessions: ChatSessionSummary[] }
  | { type: 'chatSessionLoaded'; session: ChatSession }
  | { type: 'benchmarksLoaded'; sources: BenchmarkSource[] }
  | { type: 'benchmarkError'; error: string }
  | { type: 'modelPoolUpdated'; modelPool: string[] }
  | { type: 'indexingStatus'; state: 'idle' | 'indexing' | 'ready' | 'error'; filesIndexed?: number; totalFiles?: number; chunkCount?: number; error?: string }
  | { type: 'agentLoopDone' }
  | { type: 'pipelinesLoaded'; pipelines: PipelineInfo[] }
  | { type: 'pipelineChanged'; pipelineId: string }
  | { type: 'pipelineNodeStatus'; nodeId: string; status: string; result?: string; error?: string }
  | { type: 'pipelineGraphLoaded'; nodes: PipelineGraphNode[]; edges: PipelineGraphEdge[] }
  | { type: 'pipelineSaved'; pipelineId: string }
  | { type: 'pipelineDeleted'; pipelineId: string }
  | { type: 'promptEnhanced'; nodeId: string; enhanced: string }
  | { type: 'promptEnhanceError'; nodeId: string; error: string }
  // Skills
  | { type: 'skillsLoaded'; skills: import('./skills/types').SkillInfo[] }
  | { type: 'skillSaved'; skillName: string }
  | { type: 'skillDeleted'; skillName: string }
  | { type: 'skillToggled'; skillName: string; enabled: boolean }
  | { type: 'skillError'; error: string }
  | { type: 'skillTemplatesLoaded'; templates: import('./skills/skill-templates').SkillTemplate[] }
  | { type: 'skillVersionsLoaded'; skillName: string; versions: import('./skills/types').SkillVersion[] }
  | { type: 'skillVersionContent'; skillName: string; version: number; content: string }
  | { type: 'skillVersionRestored'; skillName: string }
  | { type: 'skillContentLoaded'; skillName: string; content: string }
  | { type: 'conversationSkillGenerated'; skill: { name: string; description: string; tags: string[]; content: string } }
  // Todos
  | { type: 'todosUpdated'; title?: string; todos: TodoItem[] }
  | { type: 'todosTurnComplete'; summary: TodoSummary }
  // Providers
  | { type: 'providersLoaded'; providers: ProviderInfo[] }
  | { type: 'providerChanged'; providerId: string }
  | { type: 'providerStatus'; providerId: string; available: boolean; error?: string }
  | { type: 'claudeCliStatusResult'; installed: boolean; authenticated: boolean; version?: string; error?: string }
  // OpenAI
  | { type: 'openaiAuthStatus'; mode: string; authenticated: boolean; planType?: string; email?: string; error?: string }
  // Context meter
  | { type: 'contextMeterUpdate'; data: ContextMeterData | null }
  // Hooks
  | { type: 'hookConfigLoaded'; config: { chains: import('./hooks/types').HookChain[]; templates: import('./hooks/types').HookTemplate[]; variables: import('./hooks/types').VariableDefinition[]; enabled: boolean } }
  | { type: 'hookDebug'; event: import('./hooks/types').HookExecutionEvent }
  | { type: 'hookVariables'; variables: Record<string, unknown> };

export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
}

export interface ParallelBranchInfo {
  branchId: string;
  label: string;
  nodeId: string;
}

export interface PipelineGraphNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  status: string;
  config: Record<string, unknown>;
}

export interface PipelineGraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
}

export type WebviewMessage =
  | { type: 'sendMessage'; content: string; attachments?: Attachment[] }
  | { type: 'cancelRequest' }
  | { type: 'selectModel'; modelId: string }
  | { type: 'loadModels' }
  | { type: 'newChat' }
  | { type: 'setApiKey'; key: string }
  | { type: 'askUserResponse'; id: string; response: string }
  | { type: 'askUserCancel'; id: string }
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
  | { type: 'reindexCodebase' }
  | { type: 'selectPipeline'; pipelineId: string }
  | { type: 'loadPipelines' }
  | { type: 'savePipeline'; pipeline: PipelineGraphData; target: 'project' | 'global' }
  | { type: 'deletePipeline'; pipelineId: string }
  | { type: 'confirmDeletePipeline'; pipelineId: string }
  | { type: 'clonePipeline'; sourceId: string; newName: string; target: 'project' | 'global' }
  | { type: 'promptClonePipeline'; sourceId: string }
  | { type: 'promptNewPipeline' }
  | { type: 'updateNodeConfig'; nodeId: string; config: Record<string, unknown> }
  | { type: 'enhancePrompt'; nodeId: string; prompt: string }
  // Skills management
  | { type: 'loadSkills' }
  | { type: 'saveSkill'; skill: { name: string; description: string; scope: 'global' | 'project'; enabled: boolean; tags: string[]; content: string; trigger?: string; modelInvocable?: boolean } }
  | { type: 'deleteSkill'; skillName: string }
  | { type: 'toggleSkill'; skillName: string; enabled: boolean }
  | { type: 'refreshSkills' }
  | { type: 'loadSkillTemplates' }
  | { type: 'loadSkillVersions'; skillName: string }
  | { type: 'loadSkillVersionContent'; skillName: string; versionPath: string; version: number }
  | { type: 'restoreSkillVersion'; skillName: string; versionPath: string }
  | { type: 'generateSkillFromConversation' }
  | { type: 'loadSkillContent'; skillName: string }
  // Providers
  | { type: 'selectProvider'; providerId: string }
  | { type: 'loadProviders' }
  | { type: 'setClaudeCliPath'; path: string }
  | { type: 'setMcpConfigPath'; path: string }
  // OpenAI
  | { type: 'setOpenAIApiKey'; key: string }
  | { type: 'setOpenAIAuthMode'; mode: string }
  | { type: 'startOpenAIOAuth' }
  | { type: 'disconnectOpenAI' }
  // Context meter
  | { type: 'compressContext' }
  | { type: 'resetContext' }
  // Hooks
  | { type: 'loadHooks' }
  | { type: 'saveHookConfig'; chains: import('./hooks/types').HookChain[]; variables: import('./hooks/types').VariableDefinition[]; enabled: boolean }
  | { type: 'setHooksEnabled'; enabled: boolean }
  | { type: 'exportHookConfig' }
  | { type: 'importHookConfig' };

export interface ContextMeterData {
  totalTokens: number;
  maxTokens: number;
  utilization: number;
  healthScore: number;
  compressionRecommended: boolean;
  resetRecommended: boolean;
  breakdown: Array<{
    category: string;
    tokens: number;
    itemCount: number;
    avgRelevance: number;
  }>;
}

export interface PipelineGraphData {
  id: string;
  name: string;
  description?: string;
  entryNodeId: string;
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
}
