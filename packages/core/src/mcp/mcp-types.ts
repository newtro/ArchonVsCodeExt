/**
 * MCP (Model Context Protocol) shared types.
 */

// ── Server configuration ──

export interface McpServerConfig {
  /** Command to spawn (stdio transport). */
  command?: string;
  /** Arguments for the command (stdio transport). */
  args?: string[];
  /** Environment variables passed to the subprocess (stdio transport). */
  env?: Record<string, string>;
  /** URL for Streamable HTTP transport. */
  url?: string;
  /** HTTP headers (HTTP transport). */
  headers?: Record<string, string>;
  /** Whether this server is disabled. */
  disabled?: boolean;
  /** Tool names that bypass security confirmation. */
  alwaysAllow?: string[];
  /** Tool names always included in prompts (bypass deferred loading). */
  alwaysLoad?: string[];
  /** Connection timeout in ms (default 30000). */
  timeout?: number;
}

// ── Server state ──

export type McpServerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface McpServerState {
  name: string;
  status: McpServerStatus;
  error?: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  transport: 'stdio' | 'http';
}

// ── Tool entries ──

export interface McpToolEntry {
  /** Archon tool name: mcp_{serverName}_{toolName} */
  name: string;
  /** Original MCP tool name. */
  originalName: string;
  /** Server this tool belongs to. */
  serverName: string;
  /** Tool description. */
  description: string;
  /** Whether this tool is deferred (not loaded into prompt by default). */
  deferred: boolean;
  /** Estimated token count for the tool schema. */
  tokenEstimate: number;
}

// ── Config file format ──

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

// ── Events ──

export type McpEventType =
  | 'server:connecting'
  | 'server:connected'
  | 'server:disconnected'
  | 'server:error'
  | 'tools:updated';

export interface McpEvent {
  type: McpEventType;
  serverName: string;
  data?: unknown;
}

export type McpEventListener = (event: McpEvent) => void;
