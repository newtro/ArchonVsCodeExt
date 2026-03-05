/**
 * Pipeline/workflow graph types — the visual workflow system.
 */

export type NodeType =
  | 'agent'
  | 'tool'
  | 'decision_gate'
  | 'user_checkpoint'
  | 'loop'
  | 'parallel'
  | 'join'
  | 'verification'
  | 'plugin';

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'paused' | 'skipped';

export interface PipelineNode {
  id: string;
  type: NodeType;
  label: string;
  config: NodeConfig;
  position: { x: number; y: number };
  status: NodeStatus;
  result?: string;
  error?: string;
  retryCount?: number;  // Number of retry attempts on failure (default: 0)
  /** Set at runtime when this node runs inside a parallel branch */
  branchId?: string;
}

export type NodeConfig =
  | AgentNodeConfig
  | ToolNodeConfig
  | DecisionGateConfig
  | UserCheckpointConfig
  | LoopConfig
  | ParallelConfig
  | JoinConfig
  | VerificationConfig
  | PluginConfig;

export interface AgentNodeConfig {
  type: 'agent';
  model?: string;          // If empty or 'default', use the chat-selected model
  systemPrompt?: string;
  temperature?: number;
  tools?: string[];        // Tool names available to this agent; undefined = all
  maxIterations?: number;
  inheritContext?: boolean; // Whether to inherit conversation history from prior nodes
}

export interface ToolNodeConfig {
  type: 'tool';
  toolName: string;
  parameters: Record<string, unknown>;
  timeout?: number;
}

export interface DecisionGateConfig {
  type: 'decision_gate';
  condition: string;        // Expression or AI-evaluated condition
  mode: 'deterministic' | 'ai_evaluated';
  trueEdge: string;         // Edge ID for true condition
  falseEdge: string;        // Edge ID for false condition
}

export interface UserCheckpointConfig {
  type: 'user_checkpoint';
  prompt: string;
  timeout?: number;         // Auto-approve after timeout (ms)
  autoApproveRules?: string[];
}

export interface LoopConfig {
  type: 'loop';
  maxIterations: number;
  exitCondition?: string;   // AI-evaluated condition to break
  subGraphNodeIds: string[];
}

export interface ParallelConfig {
  type: 'parallel';
  // Branches are edge-driven — each outgoing edge is a branch.
  // No internal branch config needed.
}

export interface JoinConfig {
  type: 'join';
  mergeStrategy: 'wait_all' | 'first_completed' | 'custom';
  failurePolicy: 'fail_fast' | 'collect_partial' | 'ignore_failures';
  branchTimeout?: number;  // ms — per-branch timeout; proceed without slow branches
}

export interface VerificationConfig {
  type: 'verification';
  verificationType: 'lsp_diagnostics' | 'test_runner' | 'syntax_check' | 'custom';
  command?: string;         // For custom verification
  passEdge: string;
  failEdge: string;
}

export interface PluginConfig {
  type: 'plugin';
  pluginId: string;
  pluginConfig: Record<string, unknown>;
}

export interface PipelineEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  condition?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  entryNodeId: string;
  metadata?: {
    createdAt: number;
    updatedAt: number;
    author?: string;
    tags?: string[];
  };
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  pipeline: Pipeline;
}

export interface PipelineExecutionContext {
  variables: Map<string, unknown>;
  results: Map<string, string>;
  currentNodeId: string | null;
  executionLog: PipelineLogEntry[];
}

export interface PipelineLogEntry {
  timestamp: number;
  nodeId: string;
  nodeLabel: string;
  event: 'start' | 'complete' | 'fail' | 'skip' | 'pause' | 'resume';
  detail?: string;
}
