/**
 * MCP Extension Host — manages MCP server lifecycle within the VS Code extension.
 * Handles config loading, server connection/disconnection, file watching, and
 * bridges MCP events to the webview.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  McpClientManager,
  McpServerConfig,
  McpServerState,
  McpEventListener,
  ToolDefinition,
  SecurityManager,
  McpRegistry,
} from '@archon/core';
import {
  loadGlobalConfig,
  loadProjectConfig,
  mergeConfigs,
  resolveConfigVars,
  validateConfig,
  saveGlobalConfig,
  saveProjectConfig,
  getGlobalConfigPath,
  getProjectConfigPath,
  createMcpServerTools,
  createResourceTool,
  createPromptTool,
} from '@archon/core';

export interface McpExtensionHostConfig {
  manager: McpClientManager;
  security?: SecurityManager;
  registry?: McpRegistry;
  workspacePath?: string;
  onStatusChange?: (states: McpServerState[]) => void;
  onToolsChange?: (tools: ToolDefinition[]) => void;
  onLog?: (serverName: string, message: string) => void;
}

export class McpExtensionHost {
  private manager: McpClientManager;
  private security?: SecurityManager;
  private registry?: McpRegistry;
  private workspacePath?: string;
  private configs: Record<string, McpServerConfig> = {};
  private mcpTools: ToolDefinition[] = [];
  private fileWatchers: Array<{ close(): void }> = [];
  private onStatusChange?: (states: McpServerState[]) => void;
  private onToolsChange?: (tools: ToolDefinition[]) => void;
  private onLog?: (serverName: string, message: string) => void;
  private unsubscribeEvents?: () => void;

  constructor(config: McpExtensionHostConfig) {
    this.manager = config.manager;
    this.security = config.security;
    this.registry = config.registry;
    this.workspacePath = config.workspacePath;
    this.onStatusChange = config.onStatusChange;
    this.onToolsChange = config.onToolsChange;
    this.onLog = config.onLog;

    // Subscribe to manager events
    this.unsubscribeEvents = this.manager.on(this.handleEvent.bind(this));
  }

  // ── Lifecycle ──

  /**
   * Initialize: load configs, connect enabled servers, watch config files.
   */
  async initialize(): Promise<void> {
    this.loadConfigs();
    await this.connectEnabledServers();
    this.watchConfigFiles();
  }

  /**
   * Shutdown: disconnect all servers, close watchers.
   */
  async dispose(): Promise<void> {
    for (const watcher of this.fileWatchers) {
      watcher.close();
    }
    this.fileWatchers = [];

    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
    }

    await this.manager.disconnectAll();
    this.mcpTools = [];
  }

  // ── Config management ──

  private loadConfigs(): void {
    const global = loadGlobalConfig();
    const project = this.workspacePath ? loadProjectConfig(this.workspacePath) : {};
    this.configs = mergeConfigs(global, project);

    const errors = validateConfig(this.configs);
    for (const err of errors) {
      this.onLog?.(err.serverName, `Config validation error: ${err.message}`);
    }
  }

  /**
   * Reconnect servers after config change.
   * Diffs current vs new config to determine what changed.
   */
  async reloadConfigs(): Promise<void> {
    const oldConfigs = { ...this.configs };
    this.loadConfigs();

    const oldNames = new Set(Object.keys(oldConfigs));
    const newNames = new Set(Object.keys(this.configs));

    // Disconnect removed servers
    for (const name of oldNames) {
      if (!newNames.has(name)) {
        this.onLog?.(name, 'Server removed from config, disconnecting');
        await this.manager.disconnect(name);
      }
    }

    // Connect new or changed servers
    for (const [name, config] of Object.entries(this.configs)) {
      if (config.disabled) {
        if (this.manager.isConnected(name)) {
          await this.manager.disconnect(name);
        }
        continue;
      }

      const oldConfig = oldConfigs[name];
      const configChanged = !oldConfig || JSON.stringify(oldConfig) !== JSON.stringify(config);

      if (configChanged) {
        this.onLog?.(name, oldConfig ? 'Config changed, reconnecting' : 'New server, connecting');
        await this.connectServer(name, config);
      }
    }

    await this.rebuildToolList();
  }

  // ── Server operations ──

  async connectServer(name: string, config?: McpServerConfig): Promise<void> {
    const serverConfig = config ?? this.configs[name];
    if (!serverConfig) {
      throw new Error(`No config for server "${name}"`);
    }

    const resolved = resolveConfigVars(serverConfig, this.workspacePath);

    try {
      this.onLog?.(name, 'Connecting...');
      await this.manager.connect(name, resolved);
      this.onLog?.(name, 'Connected');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onLog?.(name, `Connection failed: ${msg}`);
    }
  }

  private async connectEnabledServers(): Promise<void> {
    const entries = Object.entries(this.configs).filter(([, c]) => !c.disabled);

    // Connect all enabled servers concurrently
    await Promise.allSettled(
      entries.map(([name, config]) => this.connectServer(name, config)),
    );

    await this.rebuildToolList();
  }

  async restartServer(name: string): Promise<void> {
    this.onLog?.(name, 'Restarting...');
    await this.manager.restart(name);
    await this.rebuildToolList();
  }

  async enableServer(name: string): Promise<void> {
    const config = this.configs[name];
    if (!config) return;
    config.disabled = false;
    await this.connectServer(name, config);
    await this.rebuildToolList();
  }

  async disableServer(name: string): Promise<void> {
    const config = this.configs[name];
    if (config) config.disabled = true;
    await this.manager.disconnect(name);
    await this.rebuildToolList();
  }

  // ── Server CRUD ──

  async addServer(name: string, config: McpServerConfig, scope: 'global' | 'project'): Promise<void> {
    this.configs[name] = config;
    this.saveConfig(name, config, scope);

    if (!config.disabled) {
      await this.connectServer(name, config);
      await this.rebuildToolList();
    }
  }

  async removeServer(name: string, scope: 'global' | 'project'): Promise<void> {
    await this.manager.disconnect(name);
    delete this.configs[name];
    this.removeFromConfig(name, scope);
    await this.rebuildToolList();
  }

  async updateServer(name: string, config: McpServerConfig, scope: 'global' | 'project'): Promise<void> {
    this.configs[name] = config;
    this.saveConfig(name, config, scope);

    if (config.disabled) {
      await this.manager.disconnect(name);
    } else {
      await this.connectServer(name, config);
    }
    await this.rebuildToolList();
  }

  // ── Tool access ──

  getMcpTools(): ToolDefinition[] {
    return this.mcpTools;
  }

  getServerStates(): McpServerState[] {
    return this.manager.getAllStates();
  }

  getConfigs(): Record<string, McpServerConfig> {
    return { ...this.configs };
  }

  // ── Private helpers ──

  private async rebuildToolList(): Promise<void> {
    const tools: ToolDefinition[] = [];
    const connectedServers = this.manager.getServerNames().filter((n: string) => this.manager.isConnected(n));

    for (const name of connectedServers) {
      const config = this.configs[name];
      try {
        // Get raw MCP tool listings for registry registration
        const mcpToolListings = await this.manager.listTools(name);

        const serverTools = await createMcpServerTools(
          name, this.manager, this.security, config?.alwaysAllow,
        );
        tools.push(...serverTools);

        // Register tools in the registry for deferred loading / semantic search
        if (this.registry) {
          this.registry.unregisterServer(name);
          this.registry.registerTools(name, mcpToolListings, serverTools, config?.alwaysLoad);
        }

        // Add resource and prompt tools
        tools.push(createResourceTool(name, this.manager));
        tools.push(createPromptTool(name, this.manager));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.onLog?.(name, `Failed to build tool list: ${msg}`);
      }
    }

    // Unregister tools from disconnected servers
    if (this.registry) {
      const connectedSet = new Set(connectedServers);
      for (const entry of this.registry.getAllEntries()) {
        if (!connectedSet.has(entry.serverName)) {
          this.registry.unregisterServer(entry.serverName);
        }
      }
    }

    this.mcpTools = tools;
    this.onToolsChange?.(tools);
  }

  private handleEvent = (event: { type: string; serverName: string; data?: unknown }) => {
    this.onStatusChange?.(this.manager.getAllStates());

    if (event.type === 'server:connected') {
      // Rebuild tools when a server connects
      this.rebuildToolList().catch(() => {});
    }
  };

  private watchConfigFiles(): void {
    const globalPath = getGlobalConfigPath();
    this.watchFile(globalPath);

    if (this.workspacePath) {
      const projectPath = getProjectConfigPath(this.workspacePath);
      this.watchFile(projectPath);
    }
  }

  private watchFile(filePath: string): void {
    try {
      // Only watch if directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) return;

      const watcher = fs.watch(dir, (_eventType: string, filename: string | null) => {
        if (filename === path.basename(filePath)) {
          // Debounce config reloads
          this.reloadConfigs().catch(err => {
            this.onLog?.('config', `Config reload failed: ${err}`);
          });
        }
      });
      this.fileWatchers.push(watcher);
    } catch {
      // File watching not critical — skip silently
    }
  }

  private saveConfig(name: string, config: McpServerConfig, scope: 'global' | 'project'): void {
    if (scope === 'global') {
      const global = loadGlobalConfig();
      global[name] = config;
      saveGlobalConfig(global);
    } else if (this.workspacePath) {
      const project = loadProjectConfig(this.workspacePath);
      project[name] = config;
      saveProjectConfig(this.workspacePath, project);
    }
  }

  private removeFromConfig(name: string, scope: 'global' | 'project'): void {
    if (scope === 'global') {
      const global = loadGlobalConfig();
      delete global[name];
      saveGlobalConfig(global);
    } else if (this.workspacePath) {
      const project = loadProjectConfig(this.workspacePath);
      delete project[name];
      saveProjectConfig(this.workspacePath, project);
    }
  }
}
