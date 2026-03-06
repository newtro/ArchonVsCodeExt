/**
 * Context Manager — orchestrates all memory layers for optimal LLM context assembly.
 *
 * Responsibilities:
 * - Tiered memory: working (verbatim), short-term (recent, compressible),
 *   long-term (archived, retrievable), structural (rules, deps, repo map)
 * - Token budget allocation across context categories
 * - Progressive compression at 70% capacity (observation masking first, then summarization)
 * - Context health score computation
 * - Telemetry for all context operations
 */

import type { MemoryDatabase } from '../db/memory-database';
import type { RulesEngine } from '../rules/rules-engine';
import type { CodebaseIndexer } from '../rag/codebase-indexer';
import type { SessionMemory } from '../session/session-memory';
import type { InteractionArchive } from '../archive/interaction-archive';
import type { GraphBuilder } from '../graph/graph-builder';
import type { DependencyAwareness } from '../deps/dependency-awareness';

/** A single item in the assembled context. */
export interface ContextItem {
  id: string;
  category: ContextCategory;
  content: string;
  tokens: number;
  relevance: number;  // 0-1, how relevant to current query
  source: string;     // which layer provided this
  metadata?: Record<string, unknown>;
}

export type ContextCategory =
  | 'system_prompt'
  | 'rules'
  | 'dependencies'
  | 'repo_map'
  | 'code_context'
  | 'session_memory'
  | 'conversation'
  | 'current_turn'
  | 'reserved';

/** Token budget configuration. */
export interface TokenBudget {
  total: number;
  systemPrompt: number;
  rules: number;
  dependencies: number;
  repoMap: number;
  codeContext: number;
  sessionMemory: number;
  conversation: number;
  currentTurn: number;
  reserved: number;
}

/** Context health metrics. */
export interface ContextHealth {
  /** Total tokens currently in context. */
  totalTokens: number;
  /** Maximum token budget. */
  maxTokens: number;
  /** Utilization percentage (0-100). */
  utilization: number;
  /** Health score (0-100): relevance-weighted quality. */
  healthScore: number;
  /** Breakdown by category. */
  breakdown: Array<{
    category: ContextCategory;
    tokens: number;
    itemCount: number;
    avgRelevance: number;
  }>;
  /** Whether compression is recommended. */
  compressionRecommended: boolean;
  /** Whether session reset is recommended. */
  resetRecommended: boolean;
}

/** Message in conversation history. */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokens: number;
  timestamp: number;
  compressed?: boolean;
  originalTokens?: number;
}

/** Result of context assembly. */
export interface AssembledContext {
  items: ContextItem[];
  totalTokens: number;
  health: ContextHealth;
}

/** Rough token estimator: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ContextManager {
  private memDb: MemoryDatabase;
  private rulesEngine?: RulesEngine;
  private indexer?: CodebaseIndexer;
  private sessionMemory?: SessionMemory;
  private archive?: InteractionArchive;
  private graphBuilder?: GraphBuilder;
  private depAwareness?: DependencyAwareness;

  private conversationHistory: ConversationMessage[] = [];
  private budget: TokenBudget;
  private compressionThreshold = 0.70; // Trigger compression at 70%

  constructor(memDb: MemoryDatabase, maxTokens = 100000) {
    this.memDb = memDb;
    this.budget = this.createDefaultBudget(maxTokens);
  }

  /** Wire up memory layers. Call after initialization. */
  setLayers(layers: {
    rulesEngine?: RulesEngine;
    indexer?: CodebaseIndexer;
    sessionMemory?: SessionMemory;
    archive?: InteractionArchive;
    graphBuilder?: GraphBuilder;
    depAwareness?: DependencyAwareness;
  }): void {
    this.rulesEngine = layers.rulesEngine;
    this.indexer = layers.indexer;
    this.sessionMemory = layers.sessionMemory;
    this.archive = layers.archive;
    this.graphBuilder = layers.graphBuilder;
    this.depAwareness = layers.depAwareness;
  }

  /** Update max token budget (e.g., when model changes). */
  setMaxTokens(maxTokens: number): void {
    this.budget = this.createDefaultBudget(maxTokens);
  }

  /**
   * Assemble context for an LLM call.
   * Gathers from all layers, ranks by relevance, fits to budget.
   */
  async assembleContext(
    query: string,
    activeFiles?: string[],
    systemPrompt?: string,
  ): Promise<AssembledContext> {
    const items: ContextItem[] = [];

    // 1. System prompt (highest priority — always included)
    if (systemPrompt) {
      items.push({
        id: 'system_prompt',
        category: 'system_prompt',
        content: systemPrompt,
        tokens: estimateTokens(systemPrompt),
        relevance: 1.0,
        source: 'system',
      });
    }

    // 2. Rules (high priority — project conventions)
    if (this.rulesEngine) {
      const rules = this.rulesEngine.getRulesForContext(activeFiles);
      const formatted = this.rulesEngine.formatRulesForPrompt(rules);
      if (formatted) {
        items.push({
          id: 'rules',
          category: 'rules',
          content: formatted,
          tokens: estimateTokens(formatted),
          relevance: 0.95,
          source: 'rules_engine',
        });
      }
    }

    // 3. Dependencies (medium priority — version context)
    if (this.depAwareness) {
      const depText = this.depAwareness.formatForPrompt();
      if (depText) {
        items.push({
          id: 'deps',
          category: 'dependencies',
          content: depText,
          tokens: estimateTokens(depText),
          relevance: 0.7,
          source: 'dependency_awareness',
        });
      }
    }

    // 4. Repo map (medium priority — structural overview)
    if (this.graphBuilder && this.graphBuilder.getSymbolCount() > 0) {
      const repoMap = this.graphBuilder.generateStructuralRepoMap(this.budget.repoMap);
      if (repoMap) {
        items.push({
          id: 'repo_map',
          category: 'repo_map',
          content: repoMap,
          tokens: estimateTokens(repoMap),
          relevance: 0.6,
          source: 'graph_builder',
        });
      }
    }

    // 5. Retrieved code context (adaptive — depends on query)
    if (this.indexer && query) {
      const results = await this.indexer.search(query, 10);
      let expandedFiles: string[] | undefined;

      // Graph expansion: pull structurally related files
      if (this.graphBuilder && results.length > 0) {
        const retrievedFiles = [...new Set(results.map(r => r.chunk.filePath))];
        expandedFiles = this.graphBuilder.expandWithNeighbors(retrievedFiles, 3);
      }

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        items.push({
          id: `code_${i}`,
          category: 'code_context',
          content: `// ${r.chunk.filePath}:${r.chunk.startLine}-${r.chunk.endLine}\n${r.chunk.content}`,
          tokens: estimateTokens(r.chunk.content) + 10,
          relevance: r.score,
          source: 'rag_search',
          metadata: { filePath: r.chunk.filePath, startLine: r.chunk.startLine },
        });
      }

      // Add graph-expanded files (lower relevance)
      if (expandedFiles && this.indexer) {
        const retrievedPaths = new Set(results.map(r => r.chunk.filePath));
        for (const fp of expandedFiles) {
          if (retrievedPaths.has(fp)) continue;
          const syms = this.graphBuilder!.getSymbolsInFile(fp);
          if (syms.length > 0) {
            const sigContent = syms
              .filter(s => s.kind !== 'import')
              .map(s => s.signature)
              .join('\n');
            if (sigContent) {
              items.push({
                id: `graph_${fp}`,
                category: 'code_context',
                content: `// Related: ${fp}\n${sigContent}`,
                tokens: estimateTokens(sigContent) + 10,
                relevance: 0.3,
                source: 'graph_expansion',
              });
            }
          }
        }
      }
    }

    // 6. Session memory (cross-session context)
    if (this.sessionMemory) {
      const memText = this.sessionMemory.formatForPrompt();
      if (memText) {
        items.push({
          id: 'session_memory',
          category: 'session_memory',
          content: memText,
          tokens: estimateTokens(memText),
          relevance: 0.65,
          source: 'session_memory',
        });
      }
    }

    // 7. Conversation history
    for (let i = 0; i < this.conversationHistory.length; i++) {
      const msg = this.conversationHistory[i];
      items.push({
        id: `conv_${i}`,
        category: 'conversation',
        content: `${msg.role}: ${msg.content}`,
        tokens: msg.tokens,
        relevance: this.computeRecency(i, this.conversationHistory.length),
        source: 'conversation',
        metadata: { compressed: msg.compressed },
      });
    }

    // Fit to budget
    const fitted = this.fitToBudget(items);

    // Compute health
    const health = this.computeHealth(fitted);

    this.memDb.recordMetric('context_assembly', {
      totalItems: fitted.length,
      totalTokens: health.totalTokens,
      healthScore: health.healthScore,
      query: query.slice(0, 100),
    });

    return { items: fitted, totalTokens: health.totalTokens, health };
  }

  /** Add a message to conversation history. */
  addMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void {
    this.conversationHistory.push({
      role,
      content,
      tokens: estimateTokens(content),
      timestamp: Date.now(),
    });
  }

  /**
   * Compress conversation history using observation masking.
   * Replaces old tool results with placeholders, keeping reasoning chains.
   * Based on JetBrains research: masking matches or beats LLM summarization at 52% lower cost.
   */
  compressHistory(): number {
    let tokensSaved = 0;
    const keepRecent = 5; // Keep last N messages verbatim

    for (let i = 0; i < this.conversationHistory.length - keepRecent; i++) {
      const msg = this.conversationHistory[i];
      if (msg.compressed) continue;

      // Observation masking: compress long tool results
      if (msg.role === 'assistant' && msg.tokens > 200) {
        const originalTokens = msg.tokens;
        // Keep first line (tool name/action) and last line (result summary)
        const lines = msg.content.split('\n');
        if (lines.length > 5) {
          const masked = [
            lines[0],
            `[... ${lines.length - 2} lines masked ...]`,
            lines[lines.length - 1],
          ].join('\n');
          msg.content = masked;
          msg.tokens = estimateTokens(masked);
          msg.compressed = true;
          msg.originalTokens = originalTokens;
          tokensSaved += originalTokens - msg.tokens;
        }
      }

      // Compress long user messages too
      if (msg.role === 'user' && msg.tokens > 500) {
        const originalTokens = msg.tokens;
        msg.content = msg.content.slice(0, 500) + '\n[... truncated ...]';
        msg.tokens = estimateTokens(msg.content);
        msg.compressed = true;
        msg.originalTokens = originalTokens;
        tokensSaved += originalTokens - msg.tokens;
      }
    }

    if (tokensSaved > 0) {
      this.memDb.recordMetric('compression', { tokensSaved, method: 'observation_masking' });
    }

    return tokensSaved;
  }

  /** Get current context health without full assembly. */
  getQuickHealth(): ContextHealth {
    const totalConvTokens = this.conversationHistory.reduce((sum, m) => sum + m.tokens, 0);
    const utilization = (totalConvTokens / this.budget.total) * 100;

    // Break down by role for meaningful categories
    const roleMap: Record<string, { tokens: number; count: number }> = {};
    for (const msg of this.conversationHistory) {
      const cat = msg.role === 'tool' ? 'code_context'
        : msg.role === 'user' ? 'current_turn'
        : 'conversation';
      if (!roleMap[cat]) roleMap[cat] = { tokens: 0, count: 0 };
      roleMap[cat].tokens += msg.tokens;
      roleMap[cat].count += 1;
    }

    const breakdown = Object.entries(roleMap).map(([category, data]) => ({
      category: category as ContextCategory,
      tokens: data.tokens,
      itemCount: data.count,
      avgRelevance: 0.7,
    }));

    return {
      totalTokens: totalConvTokens,
      maxTokens: this.budget.total,
      utilization: Math.round(utilization * 10) / 10,
      healthScore: Math.max(0, 100 - Math.max(0, utilization - 50)),
      breakdown,
      compressionRecommended: utilization > this.compressionThreshold * 100,
      resetRecommended: utilization > 90,
    };
  }

  /** Clear conversation history (session reset). */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /** Get the conversation history. */
  getHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  /** Get the current token budget. */
  getBudget(): TokenBudget {
    return { ...this.budget };
  }

  // ── Private ──

  private createDefaultBudget(maxTokens: number): TokenBudget {
    return {
      total: maxTokens,
      systemPrompt: Math.floor(maxTokens * 0.05),
      rules: Math.floor(maxTokens * 0.03),
      dependencies: Math.floor(maxTokens * 0.01),
      repoMap: Math.floor(maxTokens * 0.03),
      codeContext: Math.floor(maxTokens * 0.15),
      sessionMemory: Math.floor(maxTokens * 0.03),
      conversation: Math.floor(maxTokens * 0.50),
      currentTurn: Math.floor(maxTokens * 0.17),
      reserved: Math.floor(maxTokens * 0.03),
    };
  }

  /**
   * Fit context items to the token budget.
   * Prioritizes by category and relevance.
   */
  private fitToBudget(items: ContextItem[]): ContextItem[] {
    // Category priority (lower = higher priority)
    const priority: Record<ContextCategory, number> = {
      system_prompt: 0,
      rules: 1,
      current_turn: 2,
      code_context: 3,
      session_memory: 4,
      dependencies: 5,
      repo_map: 6,
      conversation: 7,
      reserved: 8,
    };

    // Sort by category priority, then by relevance within category
    const sorted = [...items].sort((a, b) => {
      const pDiff = priority[a.category] - priority[b.category];
      if (pDiff !== 0) return pDiff;
      return b.relevance - a.relevance;
    });

    const result: ContextItem[] = [];
    let totalTokens = 0;
    const categoryTokens = new Map<ContextCategory, number>();

    for (const item of sorted) {
      const catBudget = this.getCategoryBudget(item.category);
      const catUsed = categoryTokens.get(item.category) ?? 0;

      // Check category budget and total budget
      if (catUsed + item.tokens > catBudget) continue;
      if (totalTokens + item.tokens > this.budget.total) continue;

      result.push(item);
      totalTokens += item.tokens;
      categoryTokens.set(item.category, catUsed + item.tokens);
    }

    return result;
  }

  private getCategoryBudget(category: ContextCategory): number {
    const map: Record<ContextCategory, number> = {
      system_prompt: this.budget.systemPrompt,
      rules: this.budget.rules,
      dependencies: this.budget.dependencies,
      repo_map: this.budget.repoMap,
      code_context: this.budget.codeContext,
      session_memory: this.budget.sessionMemory,
      conversation: this.budget.conversation,
      current_turn: this.budget.currentTurn,
      reserved: this.budget.reserved,
    };
    return map[category];
  }

  private computeHealth(items: ContextItem[]): ContextHealth {
    const totalTokens = items.reduce((sum, i) => sum + i.tokens, 0);
    const utilization = (totalTokens / this.budget.total) * 100;

    // Group by category
    const groups = new Map<ContextCategory, ContextItem[]>();
    for (const item of items) {
      const existing = groups.get(item.category) ?? [];
      existing.push(item);
      groups.set(item.category, existing);
    }

    const breakdown = Array.from(groups.entries()).map(([category, catItems]) => ({
      category,
      tokens: catItems.reduce((s, i) => s + i.tokens, 0),
      itemCount: catItems.length,
      avgRelevance: catItems.reduce((s, i) => s + i.relevance, 0) / catItems.length,
    }));

    // Health = weighted relevance * (1 - clutter_penalty)
    const totalRelevance = items.reduce((s, i) => s + i.relevance * i.tokens, 0);
    const relevanceRatio = totalTokens > 0 ? totalRelevance / totalTokens : 1;
    const clutterPenalty = Math.max(0, (utilization - 70) / 30); // Penalty starts at 70%
    const healthScore = Math.round(relevanceRatio * (1 - clutterPenalty * 0.5) * 100);

    return {
      totalTokens,
      maxTokens: this.budget.total,
      utilization: Math.round(utilization * 10) / 10,
      healthScore: Math.max(0, Math.min(100, healthScore)),
      breakdown,
      compressionRecommended: utilization > this.compressionThreshold * 100,
      resetRecommended: utilization > 90,
    };
  }

  /** Compute recency score for conversation messages. Recent = higher. */
  private computeRecency(index: number, total: number): number {
    if (total <= 1) return 1.0;
    return 0.3 + 0.7 * (index / (total - 1));
  }
}
