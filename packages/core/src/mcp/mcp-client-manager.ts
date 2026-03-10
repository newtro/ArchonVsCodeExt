/**
 * MCP Client Manager — manages MCP client instances (connect/disconnect/restart).
 * Each MCP server gets its own Client instance with transport.
 */

import { Client } from '@modelcontextprotocol/sdk/client';
import { createTransport, getTransportType, type McpTransport } from './mcp-transport';
import type {
  McpServerConfig,
  McpServerState,
  McpServerStatus,
  McpEvent,
  McpEventListener,
} from './mcp-types';

interface ManagedServer {
  name: string;
  config: McpServerConfig;
  client: Client;
  transport: McpTransport;
  status: McpServerStatus;
  error?: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  retryCount: number;
}

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 3000, 8000];

export class McpClientManager {
  private servers = new Map<string, ManagedServer>();
  private listeners: McpEventListener[] = [];

  // ── Event emitter ──

  on(listener: McpEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(event: McpEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* listener errors don't propagate */ }
    }
  }

  // ── Connection lifecycle ──

  async connect(name: string, config: McpServerConfig): Promise<void> {
    // Disconnect existing if reconnecting
    if (this.servers.has(name)) {
      await this.disconnect(name);
    }

    const transport = createTransport(config);
    const client = new Client(
      { name: `archon-mcp-${name}`, version: '1.0.0' },
      { capabilities: {} },
    );

    const managed: ManagedServer = {
      name,
      config,
      client,
      transport,
      status: 'connecting',
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      retryCount: 0,
    };

    this.servers.set(name, managed);
    this.emit({ type: 'server:connecting', serverName: name });

    try {
      const timeout = config.timeout ?? 30000;
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout),
        ),
      ]);

      // Enumerate capabilities
      const [tools, resources, prompts] = await Promise.all([
        this.safeListTools(client),
        this.safeListResources(client),
        this.safeListPrompts(client),
      ]);

      managed.toolCount = tools.length;
      managed.resourceCount = resources.length;
      managed.promptCount = prompts.length;
      managed.status = 'connected';
      managed.retryCount = 0;

      this.emit({ type: 'server:connected', serverName: name, data: { tools, resources, prompts } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      managed.status = 'error';
      managed.error = message;
      this.emit({ type: 'server:error', serverName: name, data: { error: message } });
      throw new Error(`Failed to connect to MCP server "${name}": ${message}`);
    }
  }

  async disconnect(name: string): Promise<void> {
    const managed = this.servers.get(name);
    if (!managed) return;

    try {
      await managed.client.close();
    } catch {
      // Best-effort close
    }

    managed.status = 'disconnected';
    this.servers.delete(name);
    this.emit({ type: 'server:disconnected', serverName: name });
  }

  async restart(name: string): Promise<void> {
    const managed = this.servers.get(name);
    if (!managed) throw new Error(`No server named "${name}" to restart`);

    const config = managed.config;
    await this.disconnect(name);
    await this.connect(name, config);
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.allSettled(names.map(n => this.disconnect(n)));
  }

  // ── Auto-reconnect ──

  async attemptReconnect(name: string): Promise<boolean> {
    const managed = this.servers.get(name);
    if (!managed || managed.retryCount >= MAX_RETRIES) return false;

    const delay = RETRY_BACKOFF_MS[managed.retryCount] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    managed.retryCount++;

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect(name, managed.config);
      return true;
    } catch {
      return false;
    }
  }

  // ── Querying ──

  getStatus(name: string): McpServerState | undefined {
    const managed = this.servers.get(name);
    if (!managed) return undefined;

    return {
      name: managed.name,
      status: managed.status,
      error: managed.error,
      toolCount: managed.toolCount,
      resourceCount: managed.resourceCount,
      promptCount: managed.promptCount,
      transport: getTransportType(managed.config),
    };
  }

  getAllStates(): McpServerState[] {
    return [...this.servers.values()].map(m => this.getStatus(m.name)!);
  }

  getClient(name: string): Client | undefined {
    return this.servers.get(name)?.client;
  }

  isConnected(name: string): boolean {
    return this.servers.get(name)?.status === 'connected';
  }

  getServerNames(): string[] {
    return [...this.servers.keys()];
  }

  // ── Tool/resource/prompt access ──

  async listTools(name: string): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>> {
    const client = this.getConnectedClient(name);
    return this.safeListTools(client);
  }

  async listResources(name: string): Promise<Array<{ name: string; uri: string; description?: string; mimeType?: string }>> {
    const client = this.getConnectedClient(name);
    return this.safeListResources(client);
  }

  async listPrompts(name: string): Promise<Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>> {
    const client = this.getConnectedClient(name);
    return this.safeListPrompts(client);
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
  }> {
    const client = this.getConnectedClient(serverName);
    const result = await client.callTool({ name: toolName, arguments: args });
    return result as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    };
  }

  async readResource(serverName: string, uri: string): Promise<{
    contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
  }> {
    const client = this.getConnectedClient(serverName);
    const result = await client.readResource({ uri });
    return result as {
      contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
    };
  }

  async getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<{
    description?: string;
    messages: Array<{ role: string; content: { type: string; text?: string } }>;
  }> {
    const client = this.getConnectedClient(serverName);
    const result = await client.getPrompt({ name: promptName, arguments: args });
    return result as {
      description?: string;
      messages: Array<{ role: string; content: { type: string; text?: string } }>;
    };
  }

  // ── Private helpers ──

  private getConnectedClient(name: string): Client {
    const managed = this.servers.get(name);
    if (!managed) throw new Error(`MCP server "${name}" not found`);
    if (managed.status !== 'connected') throw new Error(`MCP server "${name}" is not connected (status: ${managed.status})`);
    return managed.client;
  }

  private async safeListTools(client: Client): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>> {
    try {
      const result = await client.listTools();
      return (result.tools ?? []).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    } catch {
      return [];
    }
  }

  private async safeListResources(client: Client): Promise<Array<{ name: string; uri: string; description?: string; mimeType?: string }>> {
    try {
      const result = await client.listResources();
      return (result.resources ?? []).map(r => ({
        name: r.name,
        uri: r.uri,
        description: r.description,
        mimeType: r.mimeType,
      }));
    } catch {
      return [];
    }
  }

  private async safeListPrompts(client: Client): Promise<Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>> {
    try {
      const result = await client.listPrompts();
      return (result.prompts ?? []).map(p => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map(a => ({
          name: a.name,
          description: a.description,
          required: a.required,
        })),
      }));
    } catch {
      return [];
    }
  }
}
