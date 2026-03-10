/**
 * MCP Prompt Adapter — creates one get_mcp_prompt tool per server.
 * Lists available prompts or retrieves a specific prompt by name.
 */

import type { ToolDefinition } from '../types';
import type { McpClientManager } from './mcp-client-manager';

/**
 * Create a `get_mcp_prompt` tool for an MCP server.
 * When called with no name, lists available prompts.
 * When called with a name, retrieves the prompt (with optional arguments).
 */
export function createPromptTool(
  serverName: string,
  manager: McpClientManager,
): ToolDefinition {
  return {
    name: `mcp_${serverName}_get_prompt`,
    description: `Get a prompt from MCP server "${serverName}". Call with no name to list available prompts, or provide a name and optional arguments to retrieve a specific prompt.`,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Prompt name to retrieve. Omit to list all available prompts.',
        },
        arguments: {
          type: 'string',
          description: 'JSON object of prompt arguments (e.g. {"topic": "TypeScript"}). Optional.',
        },
      },
    },
    execute: async (args) => {
      const promptName = args.name as string | undefined;

      if (!promptName) {
        // List available prompts
        try {
          const prompts = await manager.listPrompts(serverName);
          if (prompts.length === 0) {
            return `No prompts available from server "${serverName}".`;
          }
          const lines = prompts.map(p => {
            const argList = p.arguments?.map(a =>
              `${a.name}${a.required ? ' (required)' : ''}${a.description ? `: ${a.description}` : ''}`,
            ).join(', ') ?? 'none';
            return `- ${p.name}${p.description ? `: ${p.description}` : ''}\n  Arguments: ${argList}`;
          });
          return `Available prompts from "${serverName}":\n${lines.join('\n')}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error listing prompts from "${serverName}": ${msg}`;
        }
      }

      // Retrieve specific prompt
      try {
        let promptArgs: Record<string, string> | undefined;
        if (args.arguments && typeof args.arguments === 'string') {
          try {
            promptArgs = JSON.parse(args.arguments);
          } catch {
            return `Error: Invalid JSON in "arguments" parameter: ${args.arguments}`;
          }
        }

        const result = await manager.getPrompt(serverName, promptName, promptArgs);
        const parts: string[] = [];

        if (result.description) {
          parts.push(`Prompt: ${promptName}\nDescription: ${result.description}\n`);
        }

        for (const msg of result.messages) {
          const content = msg.content;
          const text = typeof content === 'string' ? content : (content as { text?: string }).text ?? JSON.stringify(content);
          parts.push(`[${msg.role}]: ${text}`);
        }

        return parts.join('\n') || `Prompt "${promptName}" returned no messages.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error getting prompt "${promptName}" from "${serverName}": ${msg}`;
      }
    },
  };
}
