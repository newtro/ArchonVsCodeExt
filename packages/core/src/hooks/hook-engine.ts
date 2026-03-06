/**
 * HookEngine — the core orchestrator for the agentic loop hook system.
 *
 * Sits between the executor and AgentLoop, firing hooks at each lifecycle point.
 * Manages hook registration, chain execution, and the variable store.
 */

import type {
  HookPoint,
  HookChain,
  HookNode,
  HookConfiguration,
  HookContext,
  HookPointData,
  HookResult,
  HookAction,
  HookExecutionEvent,
  HookExecutionStatus,
  HookDebugState,
  CompositionBlock,
} from './types';
import { HookVariableStore } from './variable-store';
import { executeScriptNode } from './executors/script-executor';
import { executeDecisionNode } from './executors/decision-executor';
import { executeLLMNode } from './executors/llm-executor';

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export interface HookEngineConfig {
  /** Callback for debugger events. */
  onDebugEvent?: (event: HookExecutionEvent) => void;
  /** Callback for variable updates. */
  onVariableUpdate?: (variables: Record<string, unknown>) => void;
  /** LLM invocation function for LLM/template nodes. */
  invokeLLM?: (prompt: string, config: { model?: string; maxTokens?: number; temperature?: number }) => Promise<string>;
  /** Working directory for script execution. */
  workspaceRoot?: string;
}

export class HookEngine {
  private chains: Map<HookPoint, HookChain[]> = new Map();
  private compositionBlocks: Map<string, CompositionBlock> = new Map();
  private variables: HookVariableStore;
  private config: HookEngineConfig;
  private debugState: HookDebugState;
  private turnCount = 0;
  private enabled = true;
  private deferredQueue: Array<() => Promise<void>> = [];
  private asyncTasks: Promise<void>[] = [];

  constructor(config: HookEngineConfig = {}) {
    this.config = config;
    this.variables = new HookVariableStore();
    this.debugState = {
      turn: 0,
      hookPointStates: new Map(),
      events: [],
      variables: {},
    };
  }

  // ── Configuration ──

  /** Load a full hook configuration (from file/settings). */
  loadConfiguration(hookConfig: HookConfiguration): void {
    this.chains.clear();
    this.compositionBlocks.clear();

    // Register variable definitions
    this.variables.registerDefinitions(hookConfig.variables);

    // Register chains grouped by hook point
    for (const chain of hookConfig.chains) {
      if (!this.chains.has(chain.hookPoint)) {
        this.chains.set(chain.hookPoint, []);
      }
      this.chains.get(chain.hookPoint)!.push(chain);
    }

    // Sort each hook point's chains by priority
    for (const chains of this.chains.values()) {
      chains.sort((a, b) => a.priority - b.priority);
    }

    // Register composition blocks
    for (const block of hookConfig.compositionBlocks) {
      this.compositionBlocks.set(block.id, block);
    }
  }

  /** Add a single chain to a hook point. */
  addChain(chain: HookChain): void {
    if (!this.chains.has(chain.hookPoint)) {
      this.chains.set(chain.hookPoint, []);
    }
    this.chains.get(chain.hookPoint)!.push(chain);
    this.chains.get(chain.hookPoint)!.sort((a, b) => a.priority - b.priority);
  }

  /** Remove a chain by ID. */
  removeChain(chainId: string): boolean {
    for (const [hookPoint, chains] of this.chains) {
      const idx = chains.findIndex(c => c.id === chainId);
      if (idx !== -1) {
        chains.splice(idx, 1);
        if (chains.length === 0) this.chains.delete(hookPoint);
        return true;
      }
    }
    return false;
  }

  /** Get current configuration as a serializable object. */
  getConfiguration(): HookConfiguration {
    const allChains: HookChain[] = [];
    for (const chains of this.chains.values()) {
      allChains.push(...chains);
    }
    return {
      version: 1,
      variables: this.variables.getDefinitions(),
      chains: allChains,
      compositionBlocks: Array.from(this.compositionBlocks.values()),
    };
  }

  /** Enable/disable the entire hook system. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Check if any hooks are registered for a given point (fast-path check). */
  hasHooks(hookPoint: HookPoint): boolean {
    const chains = this.chains.get(hookPoint);
    return !!chains && chains.some(c => c.enabled);
  }

  // ── Composition Blocks ──

  /** Save a chain's nodes as a reusable composition block. */
  saveCompositionBlock(block: CompositionBlock): void {
    this.compositionBlocks.set(block.id, block);
  }

  /** Remove a composition block. */
  removeCompositionBlock(blockId: string): boolean {
    return this.compositionBlocks.delete(blockId);
  }

  /** Get all composition blocks. */
  getCompositionBlocks(): CompositionBlock[] {
    return Array.from(this.compositionBlocks.values());
  }

  /** Instantiate a composition block as nodes in a chain (creates copies with new IDs). */
  instantiateBlock(blockId: string): HookNode[] | null {
    const block = this.compositionBlocks.get(blockId);
    if (!block) return null;
    return block.nodes.map(node => ({
      ...node,
      id: generateId(),
    }));
  }

  // ── Variable Access ──

  getVariables(): HookVariableStore {
    return this.variables;
  }

  getVariableSnapshot(): Record<string, unknown> {
    return this.variables.getAll();
  }

  // ── Turn Lifecycle ──

  /** Call at the start of each turn to reset turn-scoped state. */
  beginTurn(): void {
    this.turnCount++;
    this.variables.clearScope('turn');
    this.debugState = {
      turn: this.turnCount,
      hookPointStates: new Map(),
      events: [],
      variables: this.variables.getAll(),
    };
  }

  /** Call at the end of each turn: run deferred hooks, await async tasks, flush persistent variables. */
  async endTurn(): Promise<void> {
    // Run deferred hooks
    for (const task of this.deferredQueue) {
      try {
        await task();
      } catch {
        // Deferred hook errors are logged via debug events, not propagated
      }
    }
    this.deferredQueue = [];

    // Wait for any outstanding async tasks
    if (this.asyncTasks.length > 0) {
      await Promise.allSettled(this.asyncTasks);
      this.asyncTasks = [];
    }

    this.variables.flushPersistent();
  }

  // ── Hook Firing ──

  /**
   * Fire all hooks at a given hook point.
   * Returns the (potentially modified) data.
   *
   * Sequential chains execute in priority order and can modify data.
   * Parallel chains execute concurrently and are observe-only.
   */
  async fire(hookPoint: HookPoint, data: HookPointData): Promise<HookFireResult> {
    if (!this.enabled) return { data, action: 'pass' };

    const chains = this.chains.get(hookPoint);
    if (!chains || chains.length === 0) return { data, action: 'pass' };

    const enabledChains = chains.filter(c => c.enabled);
    if (enabledChains.length === 0) return { data, action: 'pass' };

    // Update debug state
    this.debugState.hookPointStates.set(hookPoint, 'running');

    // Classify chains by mode and timing
    const sequential = enabledChains.filter(c => c.mode === 'sequential');
    const parallel = enabledChains.filter(c => c.mode === 'parallel');

    // Further split sequential chains by timing of their first node
    const syncChains = sequential.filter(c => !c.nodes.length || c.nodes[0].timing === 'sync');
    const asyncChains = sequential.filter(c => c.nodes.length > 0 && c.nodes[0].timing === 'async');
    const deferredChains = sequential.filter(c => c.nodes.length > 0 && c.nodes[0].timing === 'deferred');

    let currentData = data;
    let finalAction: HookAction = 'pass';

    // Execute sync sequential chains in priority order (blocking)
    for (const chain of syncChains) {
      const result = await this.executeChain(chain, hookPoint, currentData);

      if (result.variables) {
        for (const [key, value] of Object.entries(result.variables)) {
          this.variables.set(key.replace(/^\$/, ''), value);
        }
        this.config.onVariableUpdate?.(this.variables.getAll());
      }

      if (result.action === 'abort') {
        this.debugState.hookPointStates.set(hookPoint, 'completed');
        return { data: currentData, action: 'abort' };
      }
      if (result.action === 'block') {
        finalAction = 'block';
        break;
      }
      if (result.action === 'modify' && result.modifications) {
        currentData = applyModifications(currentData, result.modifications);
        finalAction = 'modify';
      }
    }

    // Fire async sequential chains (non-blocking — fire and track)
    for (const chain of asyncChains) {
      const snapshot = { ...currentData };
      const task = this.executeChain(chain, hookPoint, snapshot).catch(err => {
        this.emitDebugEvent(hookPoint, chain.id, 'engine', 'async-error', 'error', undefined, {
          action: 'pass',
          error: err instanceof Error ? err.message : String(err),
        });
      }).then(() => {});
      this.asyncTasks.push(task);
    }

    // Queue deferred chains for end-of-turn execution
    for (const chain of deferredChains) {
      const snapshot = { ...currentData };
      this.deferredQueue.push(async () => {
        try {
          await this.executeChain(chain, hookPoint, snapshot);
        } catch (err) {
          this.emitDebugEvent(hookPoint, chain.id, 'engine', 'deferred-error', 'error', undefined, {
            action: 'pass',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }

    // Fire parallel chains concurrently (observe-only — snapshot isolation)
    if (parallel.length > 0) {
      const varSnapshot = this.variables.snapshot();
      const parallelPromises = parallel.map(chain =>
        this.executeChain(chain, hookPoint, currentData, varSnapshot).catch(err => {
          this.emitDebugEvent(hookPoint, chain.id, 'engine', 'parallel-error', 'error', undefined, {
            action: 'pass',
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      );
      // Parallel branches don't block — fire and track
      const task = Promise.allSettled(parallelPromises).then(() => {});
      this.asyncTasks.push(task);
    }

    this.debugState.hookPointStates.set(hookPoint, 'completed');
    this.debugState.variables = this.variables.getAll();

    return { data: currentData, action: finalAction };
  }

  // ── Debug State ──

  getDebugState(): HookDebugState {
    return { ...this.debugState };
  }

  // ── Private: Chain Execution ──

  private async executeChain(
    chain: HookChain,
    hookPoint: HookPoint,
    data: HookPointData,
    frozenVars?: Record<string, unknown>,
  ): Promise<HookResult> {
    let cumulativeResult: HookResult = { action: 'pass' };

    for (const node of chain.nodes) {
      if (!node.enabled) continue;

      const context: HookContext = {
        hookPoint,
        data,
        variables: frozenVars ?? this.variables.getAll(),
      };

      this.emitDebugEvent(hookPoint, chain.id, node.id, node.name, 'running', context);

      const startTime = Date.now();
      let result: HookResult;

      try {
        result = await this.executeNode(node, context);
        result.duration = Date.now() - startTime;
      } catch (err) {
        result = {
          action: 'pass',
          duration: Date.now() - startTime,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      this.emitDebugEvent(
        hookPoint, chain.id, node.id, node.name,
        result.error ? 'error' : 'completed',
        context, result,
      );

      // Handle decision node short-circuiting
      if (node.type === 'decision') {
        const decisionConfig = node.config as import('./types').DecisionNodeConfig;
        const shouldSkip = result.decision
          ? decisionConfig.onTrue === 'skip'
          : decisionConfig.onFalse === 'skip';
        if (shouldSkip) break;
        continue;  // Decision nodes don't produce modifications
      }

      // Merge result into cumulative
      if (result.action !== 'pass') {
        cumulativeResult.action = result.action;
      }
      if (result.modifications) {
        cumulativeResult.modifications = {
          ...cumulativeResult.modifications,
          ...result.modifications,
        };
      }
      if (result.variables) {
        cumulativeResult.variables = {
          ...cumulativeResult.variables,
          ...result.variables,
        };
        // Apply variable updates for subsequent nodes in chain
        if (!frozenVars) {
          for (const [key, value] of Object.entries(result.variables)) {
            this.variables.set(key.replace(/^\$/, ''), value);
          }
        }
      }

      // Block/abort stops chain processing
      if (result.action === 'block' || result.action === 'abort') break;
    }

    return cumulativeResult;
  }

  private async executeNode(node: HookNode, context: HookContext): Promise<HookResult> {
    switch (node.type) {
      case 'script':
        return executeScriptNode(node, context, this.config.workspaceRoot);
      case 'decision':
        return executeDecisionNode(node, context);
      case 'llm':
      case 'template':
        return executeLLMNode(node, context, this.config.invokeLLM);
      default:
        return { action: 'pass', error: `Unknown node type: ${node.type}` };
    }
  }

  private emitDebugEvent(
    hookPoint: HookPoint,
    chainId: string,
    nodeId: string,
    nodeName: string,
    status: HookExecutionStatus,
    input?: HookContext,
    result?: HookResult,
  ): void {
    const event: HookExecutionEvent = {
      id: generateId(),
      timestamp: Date.now(),
      hookPoint,
      chainId,
      nodeId,
      nodeName,
      status,
      input,
      result,
      duration: result?.duration,
    };
    this.debugState.events.push(event);
    this.config.onDebugEvent?.(event);
  }
}

// ── Result type ──

export interface HookFireResult {
  data: HookPointData;
  action: HookAction;
}

// ── Helpers ──

function applyModifications(data: HookPointData, modifications: Record<string, unknown>): HookPointData {
  // Shallow merge modifications into data
  return { ...data, ...modifications } as HookPointData;
}
