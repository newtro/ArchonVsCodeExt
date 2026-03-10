/**
 * MCP Tool Adapter — bridges MCP tools into Archon's ToolDefinition interface.
 * Each MCP tool becomes a ToolDefinition that delegates execution to the MCP client.
 */

import type { ToolDefinition, ToolParameters, ToolParameterProperty } from '../types';
import type { McpClientManager } from './mcp-client-manager';
import type { SecurityManager } from '../security/security-manager';

/**
 * Convert an MCP tool listing into an Archon ToolDefinition.
 * Tool name is namespaced: mcp_{serverName}_{toolName}
 */
export function mcpToolToArchonTool(
  tool: { name: string; description?: string; inputSchema: unknown },
  serverName: string,
  manager: McpClientManager,
  security?: SecurityManager,
  alwaysAllow?: string[],
): ToolDefinition {
  const archonName = `mcp_${serverName}_${tool.name}`;
  const alwaysAllowSet = new Set(alwaysAllow ?? []);

  return {
    name: archonName,
    description: tool.description ?? `MCP tool: ${tool.name} (server: ${serverName})`,
    parameters: convertInputSchema(tool.inputSchema),
    execute: async (args, context) => {
      // Security check — MCP tool calls default to mutating_remote
      if (security) {
        const decision = security.checkMcpTool(serverName, tool.name, alwaysAllow);
        if (decision === 'block') {
          return `Error: MCP tool "${archonName}" was blocked by security policy`;
        }
        if (decision === 'confirm') {
          const answer = await context.askUser(
            `MCP tool "${tool.name}" (server: ${serverName}) wants to execute.\n\nArguments: ${JSON.stringify(args, null, 2)}\n\nAllow this tool call?`,
            ['Allow', 'Deny'],
          );
          if (answer !== 'Allow') {
            return `MCP tool "${archonName}" was denied by user`;
          }
          // Remember approval for this session
          security.approveMcpToolForSession(serverName, tool.name);
        }
      }

      try {
        const result = await manager.callTool(serverName, tool.name, args);

        if (result.isError) {
          const errorText = result.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
          return `Error from MCP tool "${tool.name}": ${errorText || 'Unknown error'}`;
        }

        return formatToolResult(result.content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error executing MCP tool "${tool.name}" on server "${serverName}": ${message}`;
      }
    },
  };
}

/**
 * Convert all tools from an MCP server into ToolDefinitions.
 */
export async function createMcpServerTools(
  serverName: string,
  manager: McpClientManager,
  security?: SecurityManager,
  alwaysAllow?: string[],
): Promise<ToolDefinition[]> {
  const mcpTools = await manager.listTools(serverName);
  return mcpTools.map(tool =>
    mcpToolToArchonTool(tool, serverName, manager, security, alwaysAllow),
  );
}

// ── Schema conversion ──

function convertInputSchema(schema: unknown): ToolParameters {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {}, required: [] };
  }

  const s = schema as Record<string, unknown>;
  const properties: Record<string, ToolParameterProperty> = {};
  const required: string[] = [];

  if (s.properties && typeof s.properties === 'object') {
    for (const [key, value] of Object.entries(s.properties as Record<string, unknown>)) {
      if (value && typeof value === 'object') {
        const prop = value as Record<string, unknown>;
        properties[key] = {
          type: (prop.type as string) ?? 'string',
          description: (prop.description as string) ?? '',
          ...(prop.enum ? { enum: prop.enum as string[] } : {}),
          ...(prop.items ? { items: prop.items as { type: string } } : {}),
          ...(prop.default !== undefined ? { default: prop.default } : {}),
        };
      }
    }
  }

  if (Array.isArray(s.required)) {
    required.push(...(s.required as string[]));
  }

  return { type: 'object', properties, required };
}

// ── Result formatting ──

function formatToolResult(content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>): string {
  const parts: string[] = [];

  for (const item of content) {
    switch (item.type) {
      case 'text':
        if (item.text) parts.push(item.text);
        break;
      case 'image':
        parts.push(`[Image: ${item.mimeType ?? 'unknown'}, ${item.data ? Math.round(item.data.length * 0.75) : 0} bytes]`);
        break;
      case 'resource':
        parts.push(`[Embedded resource: ${item.mimeType ?? 'unknown'}]`);
        break;
      default:
        parts.push(`[Unknown content type: ${item.type}]`);
    }
  }

  return parts.join('\n') || 'Tool executed successfully (no output)';
}

/**
 * Estimate token count for a tool definition schema.
 * Uses ~4 chars per token heuristic on the JSON schema string.
 */
export function estimateToolTokens(tool: { name: string; description?: string; inputSchema: unknown }): number {
  const schemaStr = JSON.stringify({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
  });
  return Math.ceil(schemaStr.length / 4);
}
