/**
 * MCP (Model Context Protocol) integration module.
 */

export * from './mcp-types';
export { McpClientManager } from './mcp-client-manager';
export { createTransport, getTransportType } from './mcp-transport';
export type { McpTransport } from './mcp-transport';
export { mcpToolToArchonTool, createMcpServerTools, estimateToolTokens } from './mcp-tool-adapter';
export { createResourceTool } from './mcp-resource-adapter';
export { createPromptTool } from './mcp-prompt-adapter';
export {
  loadGlobalConfig, loadProjectConfig, mergeConfigs, loadMergedConfig,
  saveGlobalConfig, saveProjectConfig,
  validateConfig, resolveConfigVars,
  getGlobalConfigPath, getProjectConfigPath,
} from './mcp-config';
export type { ConfigValidationError } from './mcp-config';
export { McpRegistry } from './mcp-registry';
