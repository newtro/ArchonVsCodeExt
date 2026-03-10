/**
 * MCP Registry — deferred tool loading with semantic search.
 * Tools are registered but not included in prompts by default.
 * The `tool_search` meta-tool queries this registry to discover tools on-demand.
 */

import type { ToolDefinition } from '../types';
import type { McpToolEntry } from './mcp-types';
import { estimateToolTokens } from './mcp-tool-adapter';

const MAX_ALWAYS_LOADED = 5;

export class McpRegistry {
  /** All registered MCP tool entries (deferred and always-loaded). */
  private entries = new Map<string, McpToolEntry>();
  /** The actual ToolDefinition objects for execution. */
  private toolDefs = new Map<string, ToolDefinition>();
  /** Tools activated by tool_search during this session. */
  private activatedTools = new Set<string>();
  /** Tools marked as always-loaded (bypass deferred loading). */
  private alwaysLoadedTools = new Set<string>();
  /** Optional embedding function for semantic search. */
  private embedFn?: (text: string) => Promise<Float32Array>;
  /** Cached embeddings for BM25 fallback: tool name → tokenized description. */
  private descriptionTokens = new Map<string, string[]>();

  // ── Registration ──

  /**
   * Register tools from an MCP server.
   * By default all MCP tools are deferred (not sent to the LLM).
   */
  registerTools(
    serverName: string,
    tools: Array<{ name: string; description?: string; inputSchema: unknown }>,
    toolDefs: ToolDefinition[],
    alwaysLoad?: string[],
  ): void {
    const alwaysLoadSet = new Set(alwaysLoad ?? []);

    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      const def = toolDefs[i];
      if (!def) continue;

      const archonName = def.name;
      const isAlwaysLoaded = alwaysLoadSet.has(tool.name);

      const entry: McpToolEntry = {
        name: archonName,
        originalName: tool.name,
        serverName,
        description: tool.description ?? '',
        deferred: !isAlwaysLoaded,
        tokenEstimate: estimateToolTokens(tool),
      };

      this.entries.set(archonName, entry);
      this.toolDefs.set(archonName, def);

      // Index for keyword search
      const text = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
      this.descriptionTokens.set(archonName, tokenize(text));

      if (isAlwaysLoaded) {
        this.alwaysLoadedTools.add(archonName);
      }
    }
  }

  /**
   * Unregister all tools from a server (e.g. on disconnect).
   */
  unregisterServer(serverName: string): void {
    for (const [name, entry] of this.entries) {
      if (entry.serverName === serverName) {
        this.entries.delete(name);
        this.toolDefs.delete(name);
        this.descriptionTokens.delete(name);
        this.activatedTools.delete(name);
        this.alwaysLoadedTools.delete(name);
      }
    }
  }

  // ── Search ──

  /**
   * Search for tools by natural language query.
   * Uses BM25 keyword matching (semantic embedding search is a future enhancement).
   * Returns the top-N matching ToolDefinitions.
   */
  searchTools(query: string, limit: number = 5): ToolDefinition[] {
    const queryTokens = tokenize(query.toLowerCase());
    if (queryTokens.length === 0) return [];

    const scores: Array<{ name: string; score: number }> = [];

    for (const [name, tokens] of this.descriptionTokens) {
      const score = bm25Score(queryTokens, tokens);
      if (score > 0) {
        scores.push({ name, score });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    const results: ToolDefinition[] = [];
    for (const { name } of scores.slice(0, limit)) {
      const def = this.toolDefs.get(name);
      if (def) results.push(def);
    }

    return results;
  }

  /**
   * Activate tools (mark them as discovered in this session).
   * Activated tools are included in the prompt on subsequent turns.
   */
  activateTools(toolNames: string[]): void {
    for (const name of toolNames) {
      if (this.toolDefs.has(name)) {
        this.activatedTools.add(name);
      }
    }
  }

  /**
   * Clear activated tools (on session reset).
   */
  clearActivated(): void {
    this.activatedTools.clear();
  }

  // ── Tool list building ──

  /**
   * Get tools that should always be loaded (not deferred).
   * Includes always-load MCP tools (capped at MAX_ALWAYS_LOADED).
   */
  getAlwaysLoadedTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    let count = 0;

    for (const name of this.alwaysLoadedTools) {
      if (count >= MAX_ALWAYS_LOADED) {
        console.warn(`MCP: More than ${MAX_ALWAYS_LOADED} always-loaded tools — excess tools will be deferred`);
        break;
      }
      const def = this.toolDefs.get(name);
      if (def) {
        tools.push(def);
        count++;
      }
    }

    return tools;
  }

  /**
   * Get tools activated during this session (via tool_search).
   */
  getActivatedTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const name of this.activatedTools) {
      // Skip if already in always-loaded
      if (this.alwaysLoadedTools.has(name)) continue;
      const def = this.toolDefs.get(name);
      if (def) tools.push(def);
    }
    return tools;
  }

  /**
   * Get all deferred tool entries (for UI display / token estimation).
   */
  getDeferredEntries(): McpToolEntry[] {
    return [...this.entries.values()].filter(e => e.deferred && !this.activatedTools.has(e.name));
  }

  /**
   * Get a tool definition by name (for execution after discovery).
   */
  getToolDef(name: string): ToolDefinition | undefined {
    return this.toolDefs.get(name);
  }

  // ── Token estimation ──

  getToolCount(): { loaded: number; deferred: number; total: number } {
    const total = this.entries.size;
    const loaded = this.alwaysLoadedTools.size + this.activatedTools.size;
    const deferred = total - loaded;
    return { loaded: Math.min(loaded, total), deferred: Math.max(deferred, 0), total };
  }

  estimateTokenUsage(): { loaded: number; deferred: number; saved: number } {
    let loaded = 0;
    let deferred = 0;

    for (const [name, entry] of this.entries) {
      if (this.alwaysLoadedTools.has(name) || this.activatedTools.has(name)) {
        loaded += entry.tokenEstimate;
      } else {
        deferred += entry.tokenEstimate;
      }
    }

    return { loaded, deferred, saved: deferred };
  }

  // ── Always-load management ──

  setAlwaysLoad(toolName: string, enabled: boolean): void {
    const entry = this.entries.get(toolName);
    if (!entry) return;

    if (enabled) {
      if (this.alwaysLoadedTools.size >= MAX_ALWAYS_LOADED) {
        console.warn(`MCP: Cannot mark "${toolName}" as always-loaded — limit of ${MAX_ALWAYS_LOADED} reached`);
        return;
      }
      this.alwaysLoadedTools.add(toolName);
      entry.deferred = false;
    } else {
      this.alwaysLoadedTools.delete(toolName);
      entry.deferred = true;
    }
  }

  // ── Embedding support (future) ──

  setEmbeddingFunction(fn: (text: string) => Promise<Float32Array>): void {
    this.embedFn = fn;
  }

  // ── Queries for UI ──

  getAllEntries(): McpToolEntry[] {
    return [...this.entries.values()];
  }

  getServerEntries(serverName: string): McpToolEntry[] {
    return [...this.entries.values()].filter(e => e.serverName === serverName);
  }
}

// ── BM25 keyword search implementation ──

function tokenize(text: string): string[] {
  return text
    .replace(/[^a-z0-9_\-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * Simplified BM25 scoring between query tokens and document tokens.
 * k1=1.2, b=0.75, avgdl estimated at 15 tokens.
 */
function bm25Score(queryTokens: string[], docTokens: string[]): number {
  const k1 = 1.2;
  const b = 0.75;
  const avgdl = 15;
  const dl = docTokens.length;

  // Build term frequency map for document
  const tf = new Map<string, number>();
  for (const token of docTokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  let score = 0;
  for (const qt of queryTokens) {
    const freq = tf.get(qt) ?? 0;
    if (freq === 0) {
      // Check for partial match (substring)
      let partialFreq = 0;
      for (const dt of docTokens) {
        if (dt.includes(qt) || qt.includes(dt)) {
          partialFreq += 0.5;
        }
      }
      if (partialFreq > 0) {
        const numerator = partialFreq * (k1 + 1);
        const denominator = partialFreq + k1 * (1 - b + b * dl / avgdl);
        score += numerator / denominator * 0.5; // Partial match discount
      }
      continue;
    }

    const numerator = freq * (k1 + 1);
    const denominator = freq + k1 * (1 - b + b * dl / avgdl);
    score += numerator / denominator;
  }

  return score;
}
