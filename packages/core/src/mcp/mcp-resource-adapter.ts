/**
 * MCP Resource Adapter — creates one read_mcp_resource tool per server.
 * Calling without a URI lists available resources; with a URI reads the resource.
 */

import type { ToolDefinition } from '../types';
import type { McpClientManager } from './mcp-client-manager';

/**
 * Create a `read_mcp_resource` tool for an MCP server.
 * When called with no uri, it lists available resources.
 * When called with a uri, it reads that resource.
 */
export function createResourceTool(
  serverName: string,
  manager: McpClientManager,
): ToolDefinition {
  return {
    name: `mcp_${serverName}_read_resource`,
    description: `Read a resource from MCP server "${serverName}". Call with no uri to list available resources, or provide a uri to read a specific resource.`,
    parameters: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Resource URI to read. Omit to list all available resources.',
        },
      },
    },
    execute: async (args) => {
      const uri = args.uri as string | undefined;

      if (!uri) {
        // List available resources
        try {
          const resources = await manager.listResources(serverName);
          if (resources.length === 0) {
            return `No resources available from server "${serverName}".`;
          }
          const lines = resources.map(r =>
            `- ${r.name} (${r.uri})${r.description ? `: ${r.description}` : ''}${r.mimeType ? ` [${r.mimeType}]` : ''}`,
          );
          return `Available resources from "${serverName}":\n${lines.join('\n')}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error listing resources from "${serverName}": ${msg}`;
        }
      }

      // Read specific resource
      try {
        const result = await manager.readResource(serverName, uri);
        const parts: string[] = [];

        for (const content of result.contents) {
          if (content.text) {
            parts.push(content.text);
          } else if (content.blob) {
            parts.push(`[Binary data: ${content.mimeType ?? 'unknown'}, ${Math.round(content.blob.length * 0.75)} bytes]`);
          } else {
            parts.push(`[Resource: ${content.uri}]`);
          }
        }

        return parts.join('\n') || `Resource "${uri}" returned no content.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error reading resource "${uri}" from "${serverName}": ${msg}`;
      }
    },
  };
}
