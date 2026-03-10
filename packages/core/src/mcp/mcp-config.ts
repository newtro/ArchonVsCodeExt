/**
 * MCP Configuration — load, merge, save, and validate MCP server configs.
 * Supports global (~/.archon/mcp.json) and project-level (.archon/mcp.json) configs.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { McpServerConfig, McpConfigFile } from './mcp-types';

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.archon');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'mcp.json');
const PROJECT_CONFIG_NAME = path.join('.archon', 'mcp.json');

// ── Loading ──

export function loadGlobalConfig(): Record<string, McpServerConfig> {
  return loadConfigFile(GLOBAL_CONFIG_PATH);
}

export function loadProjectConfig(workspacePath: string): Record<string, McpServerConfig> {
  const configPath = path.join(workspacePath, PROJECT_CONFIG_NAME);
  return loadConfigFile(configPath);
}

/**
 * Merge global + project configs. Project overrides global for same server name.
 */
export function mergeConfigs(
  global: Record<string, McpServerConfig>,
  project: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  return { ...global, ...project };
}

/**
 * Load and merge global + project configs in one call.
 */
export function loadMergedConfig(workspacePath?: string): Record<string, McpServerConfig> {
  const global = loadGlobalConfig();
  const project = workspacePath ? loadProjectConfig(workspacePath) : {};
  return mergeConfigs(global, project);
}

// ── Saving ──

export function saveGlobalConfig(servers: Record<string, McpServerConfig>): void {
  saveConfigFile(GLOBAL_CONFIG_PATH, servers);
}

export function saveProjectConfig(workspacePath: string, servers: Record<string, McpServerConfig>): void {
  const configPath = path.join(workspacePath, PROJECT_CONFIG_NAME);
  saveConfigFile(configPath, servers);
}

// ── Validation ──

export interface ConfigValidationError {
  serverName: string;
  message: string;
}

export function validateConfig(servers: Record<string, McpServerConfig>): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  for (const [name, config] of Object.entries(servers)) {
    if (!config.command && !config.url) {
      errors.push({ serverName: name, message: 'Must specify either "command" (stdio) or "url" (HTTP)' });
      continue;
    }

    if (config.command && config.url) {
      errors.push({ serverName: name, message: 'Cannot specify both "command" and "url" — choose stdio or HTTP' });
    }

    if (config.url) {
      try {
        new URL(config.url);
      } catch {
        errors.push({ serverName: name, message: `Invalid URL: "${config.url}"` });
      }
    }

    if (config.timeout !== undefined && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
      errors.push({ serverName: name, message: 'Timeout must be a positive number (ms)' });
    }
  }

  return errors;
}

// ── Environment variable resolution ──

/**
 * Resolve ${env:VAR_NAME} and ${workspaceFolder} in config string values.
 */
export function resolveConfigVars(
  config: McpServerConfig,
  workspacePath?: string,
): McpServerConfig {
  const resolve = (value: string): string => {
    let result = value;
    // ${env:VAR_NAME}
    result = result.replace(/\$\{env:([^}]+)\}/g, (_, varName) => {
      const val = process.env[varName];
      if (val === undefined) {
        console.warn(`MCP config: environment variable "${varName}" is not set`);
        return '';
      }
      return val;
    });
    // ${workspaceFolder}
    if (workspacePath) {
      result = result.replace(/\$\{workspaceFolder\}/g, workspacePath);
    }
    return result;
  };

  const resolveRecord = (record?: Record<string, string>): Record<string, string> | undefined => {
    if (!record) return undefined;
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      resolved[key] = resolve(value);
    }
    return resolved;
  };

  return {
    ...config,
    command: config.command ? resolve(config.command) : config.command,
    args: config.args?.map(resolve),
    url: config.url ? resolve(config.url) : config.url,
    env: resolveRecord(config.env),
    headers: resolveRecord(config.headers),
  };
}

// ── Config file paths ──

export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}

export function getProjectConfigPath(workspacePath: string): string {
  return path.join(workspacePath, PROJECT_CONFIG_NAME);
}

// ── Internal helpers ──

function loadConfigFile(filePath: string): Record<string, McpServerConfig> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as McpConfigFile;
    return parsed.mcpServers ?? {};
  } catch (err) {
    console.warn(`Failed to load MCP config from "${filePath}":`, err);
    return {};
  }
}

function saveConfigFile(filePath: string, servers: Record<string, McpServerConfig>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content: McpConfigFile = { mcpServers: servers };
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
}
