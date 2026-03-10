/**
 * MCP Transport Factory — creates stdio or Streamable HTTP transports.
 */

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import type { McpServerConfig } from './mcp-types';

export type McpTransport = StdioClientTransport | StreamableHTTPClientTransport;

/**
 * Create a transport for an MCP server based on its configuration.
 * - If `command` is present → stdio transport
 * - If `url` is present → Streamable HTTP transport
 */
export function createTransport(config: McpServerConfig): McpTransport {
  if (config.command) {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    });
  }

  if (config.url) {
    const url = new URL(config.url);
    return new StreamableHTTPClientTransport(url, {
      requestInit: config.headers
        ? { headers: config.headers }
        : undefined,
    });
  }

  throw new Error('MCP server config must specify either "command" (stdio) or "url" (HTTP)');
}

/**
 * Determine transport type from config.
 */
export function getTransportType(config: McpServerConfig): 'stdio' | 'http' {
  if (config.command) return 'stdio';
  if (config.url) return 'http';
  throw new Error('MCP server config must specify either "command" or "url"');
}
