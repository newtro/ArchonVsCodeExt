/**
 * Pipeline Engine — executes workflow graphs.
 *
 * Traverses the graph from the entry node, executing each node according
 * to its type, following edges based on conditions and results.
 */

import type {
  Pipeline,
  PipelineNode,
  PipelineEdge,
  PipelineExecutionContext,
  PipelineLogEntry,
  NodeStatus,
  AgentNodeConfig,
  ToolNodeConfig,
  DecisionGateConfig,
  UserCheckpointConfig,
  LoopConfig,
  JoinConfig,
  VerificationConfig,
} from './types';
import type { ToolContext, ParallelBranchInfo, AskUserOptionInput } from '../types';

export interface PipelineCallbacks {
  onNodeStart: (node: PipelineNode) => void;
  onNodeComplete: (node: PipelineNode, result: string) => void;
  onNodeFail: (node: PipelineNode, error: string) => void;
  onPipelineComplete: (context: PipelineExecutionContext) => void;
  onPipelineError: (error: string) => void;
  onParallelStart: (branches: ParallelBranchInfo[]) => void;
  onBranchComplete: (branchId: string, label: string) => void;
  onParallelComplete: () => void;
  executeAgent: (node: PipelineNode, config: AgentNodeConfig, input: string) => Promise<string>;
  executeTool: (config: ToolNodeConfig, context: ToolContext) => Promise<string>;
  evaluateCondition: (condition: string, context: PipelineExecutionContext) => Promise<boolean>;
  askUser: (prompt: string, options?: AskUserOptionInput[], multiSelect?: boolean) => Promise<string>;
  runVerification: (type: string, command?: string) => Promise<{ passed: boolean; output: string }>;
}

export class PipelineEngine {
  private pipeline: Pipeline;
  private context: PipelineExecutionContext;
  private callbacks: PipelineCallbacks;
  private toolContext: ToolContext;
  private aborted = false;
  /** Tracks pending branch results for join nodes to collect */
  private branchResults = new Map<string, Promise<string>>();

  constructor(
    pipeline: Pipeline,
    callbacks: PipelineCallbacks,
    toolContext: ToolContext,
  ) {
    this.pipeline = pipeline;
    this.callbacks = callbacks;
    this.toolContext = toolContext;
    this.context = {
      variables: new Map(),
      results: new Map(),
      currentNodeId: null,
      executionLog: [],
    };
  }

  /**
   * Execute the pipeline from the entry node.
   */
  async execute(input: string): Promise<PipelineExecutionContext> {
    this.context.variables.set('input', input);
    this.aborted = false;

    try {
      await this.executeNode(this.pipeline.entryNodeId, input);
      this.callbacks.onPipelineComplete(this.context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.callbacks.onPipelineError(msg);
    }

    return this.context;
  }

  /**
   * Abort the running pipeline.
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Get the current execution context.
   */
  getContext(): PipelineExecutionContext {
    return this.context;
  }

  private async executeNode(nodeId: string, input: string): Promise<string> {
    if (this.aborted) throw new Error('Pipeline aborted');

    const node = this.pipeline.nodes.find(n => n.id === nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    this.context.currentNodeId = nodeId;
    this.setNodeStatus(node, 'running');
    this.log(node, 'start');
    this.callbacks.onNodeStart(node);

    const maxRetries = node.retryCount ?? 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeNodeByType(node, input);
        node.result = result;
        this.context.results.set(nodeId, result);
        this.setNodeStatus(node, 'completed');
        this.log(node, 'complete', result.slice(0, 200));
        this.callbacks.onNodeComplete(node, result);

        // Follow outgoing edges
        const nextNodeId = await this.resolveNextNode(node, result);
        if (nextNodeId) {
          return this.executeNode(nextNodeId, result);
        }

        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          this.log(node, 'fail', `Attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}. Retrying...`);
        }
      }
    }

    // All retries exhausted — check for on_failure edge
    const failureEdge = this.pipeline.edges.find(
      e => e.sourceNodeId === nodeId && e.condition === 'on_failure'
    );

    if (failureEdge && failureEdge.targetNodeId) {
      const msg = lastError?.message ?? 'Unknown error';
      node.error = msg;
      this.setNodeStatus(node, 'failed');
      this.log(node, 'fail', msg);
      this.callbacks.onNodeFail(node, msg);
      // Follow failure edge instead of throwing
      return this.executeNode(failureEdge.targetNodeId, `Error from ${node.label}: ${msg}`);
    }

    // No failure edge — escalate to user if askUser is available, otherwise throw
    const msg = lastError?.message ?? 'Unknown error';
    node.error = msg;
    this.setNodeStatus(node, 'failed');
    this.log(node, 'fail', msg);
    this.callbacks.onNodeFail(node, msg);

    // User escalation: offer retry, skip, or abort
    try {
      const response = await this.callbacks.askUser(
        `Node "${node.label}" failed: ${msg}\n\nWhat would you like to do?`,
        ['Retry', 'Skip', 'Abort'],
      );
      if (response === 'Retry') {
        this.setNodeStatus(node, 'running');
        return this.executeNode(nodeId, input);
      } else if (response === 'Skip') {
        this.setNodeStatus(node, 'skipped');
        this.log(node, 'skip', 'User chose to skip');
        const nextNodeId = await this.resolveNextNode(node, '');
        if (nextNodeId) {
          return this.executeNode(nextNodeId, input);
        }
        return '';
      }
    } catch {
      // askUser failed or was cancelled — fall through to throw
    }

    throw lastError ?? new Error(`Node ${node.label} failed`);
  }

  private async executeNodeByType(node: PipelineNode, input: string): Promise<string> {
    const config = node.config;

    switch (config.type) {
      case 'agent':
        return this.callbacks.executeAgent(node, config, input);

      case 'tool':
        return this.callbacks.executeTool(config, this.toolContext);

      case 'decision_gate':
        return this.executeDecisionGate(node, config, input);

      case 'user_checkpoint':
        return this.executeUserCheckpoint(config);

      case 'loop':
        return this.executeLoop(config, input);

      case 'parallel':
        return this.executeParallel(node, input);

      case 'join':
        return this.executeJoin(node, config);

      case 'verification':
        return this.executeVerification(node, config);

      case 'plugin':
        return `Plugin ${config.pluginId} executed`; // Placeholder for plugin system

      default:
        throw new Error(`Unknown node type: ${(config as { type: string }).type}`);
    }
  }

  private async executeDecisionGate(
    _node: PipelineNode,
    config: DecisionGateConfig,
    input: string,
  ): Promise<string> {
    let result: boolean;

    if (config.mode === 'deterministic') {
      // Simple expression evaluation
      result = this.evaluateDeterministicCondition(config.condition, input);
    } else {
      result = await this.callbacks.evaluateCondition(config.condition, this.context);
    }

    return result ? 'true' : 'false';
  }

  private async executeUserCheckpoint(config: UserCheckpointConfig): Promise<string> {
    const response = await this.callbacks.askUser(config.prompt);
    return response;
  }

  private async executeLoop(config: LoopConfig, input: string): Promise<string> {
    let lastResult = input;

    for (let i = 0; i < config.maxIterations; i++) {
      if (this.aborted) throw new Error('Pipeline aborted');

      // Execute sub-graph nodes in order
      for (const subNodeId of config.subGraphNodeIds) {
        lastResult = await this.executeNode(subNodeId, lastResult);
      }

      // Check exit condition
      if (config.exitCondition) {
        const shouldExit = await this.callbacks.evaluateCondition(config.exitCondition, this.context);
        if (shouldExit) break;
      }
    }

    return lastResult;
  }

  /**
   * Parallel (fork) node — fires all outgoing branches concurrently.
   * Does NOT wait for results; the join node handles collection.
   * Each branch is executed as an independent chain starting from the edge target.
   */
  private async executeParallel(node: PipelineNode, input: string): Promise<string> {
    const outgoingEdges = this.pipeline.edges.filter(
      e => e.sourceNodeId === node.id && e.condition !== 'on_failure'
    );

    // Build branch info and notify UI that parallel execution is starting
    const branches: ParallelBranchInfo[] = outgoingEdges.map(edge => {
      const targetNode = this.pipeline.nodes.find(n => n.id === edge.targetNodeId);
      const branchId = edge.targetNodeId;
      const nodeName = targetNode?.label;
      const edgeLabel = edge.label;
      // Combine edge label + node name: "Branch 1 — Qwen", or just the node name / edge label
      let label: string;
      if (edgeLabel && nodeName && edgeLabel !== nodeName) {
        label = `${edgeLabel} — ${nodeName}`;
      } else {
        label = nodeName ?? edgeLabel ?? branchId;
      }
      return { branchId, label, nodeId: edge.targetNodeId };
    });
    this.callbacks.onParallelStart(branches);

    for (const edge of outgoingEdges) {
      const branchId = edge.targetNodeId;
      const branchLabel = branches.find(b => b.branchId === branchId)?.label ?? branchId;

      // Tag all nodes in this branch chain with the branchId
      this.tagBranchNodes(edge.targetNodeId, branchId);

      // Execute each branch, notify UI on completion
      const branchPromise = this.executeBranchChain(edge.targetNodeId, input).then(result => {
        this.callbacks.onBranchComplete(branchId, branchLabel);
        return result;
      });
      this.branchResults.set(edge.targetNodeId, branchPromise);
    }

    // Parallel node completes immediately — pass input through
    return input;
  }

  /**
   * Tag all nodes in a branch chain with a branchId so agent execution
   * callbacks can be routed to the correct UI container.
   */
  private tagBranchNodes(startNodeId: string, branchId: string): void {
    let currentNodeId: string | null = startNodeId;
    const visited = new Set<string>();

    while (currentNodeId && !visited.has(currentNodeId)) {
      visited.add(currentNodeId);
      const node = this.pipeline.nodes.find(n => n.id === currentNodeId);
      if (!node || node.config.type === 'join') break;

      node.branchId = branchId;

      const outgoing = this.pipeline.edges.filter(
        e => e.sourceNodeId === currentNodeId && e.condition !== 'on_failure'
      );
      currentNodeId = outgoing.length === 1 ? outgoing[0].targetNodeId : null;
    }
  }

  /**
   * Execute a branch chain starting from nodeId.
   * Edge traversal is handled by executeNode; resolveNextNode guards against
   * entering join nodes from branch-tagged nodes, so the chain stops naturally.
   */
  private async executeBranchChain(startNodeId: string, input: string): Promise<string> {
    return this.executeNode(startNodeId, input);
  }

  /**
   * Join (fan-in) node — collects results from all incoming branches.
   */
  private async executeJoin(node: PipelineNode, config: JoinConfig): Promise<string> {
    const incomingEdges = this.pipeline.edges.filter(e => e.targetNodeId === node.id);

    // Collect branch promises — look up by source node's branch chain
    const branchEntries: Array<{ label: string; promise: Promise<string> }> = [];
    for (const edge of incomingEdges) {
      const sourceNode = this.pipeline.nodes.find(n => n.id === edge.sourceNodeId);
      const label = edge.label ?? sourceNode?.label ?? edge.sourceNodeId;

      // Find the branch result: check if the source node was a branch start,
      // or walk back to find the registered branch promise
      const promise = this.branchResults.get(edge.sourceNodeId)
        ?? this.findBranchPromise(edge.sourceNodeId)
        ?? Promise.resolve(this.context.results.get(edge.sourceNodeId) ?? '');

      branchEntries.push({ label, promise });
    }

    // Apply timeout if configured
    const withTimeout = branchEntries.map(entry => {
      if (!config.branchTimeout) return entry;
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`Branch "${entry.label}" timed out after ${config.branchTimeout}ms`)), config.branchTimeout)
      );
      return { label: entry.label, promise: Promise.race([entry.promise, timeoutPromise]) };
    });

    // Collect results based on merge strategy
    if (config.mergeStrategy === 'first_completed') {
      const first = await Promise.race(
        withTimeout.map(async e => ({ label: e.label, result: await e.promise }))
      );
      return `[${first.label}]: ${first.result}`;
    }

    // wait_all (default) — collect all, handle failures per policy
    const results: Array<{ label: string; result?: string; error?: string }> = [];
    await Promise.all(withTimeout.map(async entry => {
      try {
        const result = await entry.promise;
        results.push({ label: entry.label, result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (config.failurePolicy === 'fail_fast') {
          throw err;
        }
        results.push({ label: entry.label, error: msg });
      }
    }));

    // Format output
    const merged = results.map(r => {
      if (r.error && config.failurePolicy !== 'ignore_failures') {
        return `[${r.label}]: ERROR: ${r.error}`;
      }
      if (r.error) return null; // ignore_failures: skip failed branches
      return `[${r.label}]: ${r.result}`;
    }).filter(Boolean).join('\n\n');

    this.callbacks.onParallelComplete();
    return merged;
  }

  /**
   * Walk backward from a node to find a registered branch promise.
   * Handles cases where the branch chain has intermediate nodes.
   */
  /**
   * Find the downstream join node for a parallel node by walking
   * forward along branch edges until a join node is found.
   */
  private findDownstreamJoin(parallelNodeId: string): string | null {
    const visited = new Set<string>();
    const queue: string[] = [];

    // Start from all direct targets of the parallel node
    const outgoing = this.pipeline.edges.filter(e => e.sourceNodeId === parallelNodeId);
    for (const edge of outgoing) {
      queue.push(edge.targetNodeId);
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.pipeline.nodes.find(n => n.id === nodeId);
      if (!node) continue;
      if (node.config.type === 'join') return nodeId;

      // Follow outgoing edges
      const edges = this.pipeline.edges.filter(e => e.sourceNodeId === nodeId);
      for (const edge of edges) {
        queue.push(edge.targetNodeId);
      }
    }

    return null; // No join found — branches are fire-and-forget
  }

  private findBranchPromise(nodeId: string): Promise<string> | undefined {
    // Check if this node itself is registered
    const direct = this.branchResults.get(nodeId);
    if (direct) return direct;

    // Walk backward through incoming edges to find a registered branch start
    const incoming = this.pipeline.edges.filter(e => e.targetNodeId === nodeId);
    for (const edge of incoming) {
      const found = this.branchResults.get(edge.sourceNodeId);
      if (found) return found;
    }
    return undefined;
  }

  private async executeVerification(
    node: PipelineNode,
    config: VerificationConfig,
  ): Promise<string> {
    const { passed, output } = await this.callbacks.runVerification(
      config.verificationType,
      config.command,
    );

    return passed ? `PASS: ${output}` : `FAIL: ${output}`;
  }

  private async resolveNextNode(node: PipelineNode, result: string): Promise<string | null> {
    // Parallel nodes fire branches themselves — don't follow outgoing edges here.
    // Instead, find the downstream join node (if any) to continue the main flow.
    if (node.config.type === 'parallel') {
      return this.findDownstreamJoin(node.id);
    }

    const outgoingEdges = this.pipeline.edges.filter(
      e => e.sourceNodeId === node.id && e.condition !== 'on_failure'
    );

    if (outgoingEdges.length === 0) return null;

    if (outgoingEdges.length === 1) {
      const targetId = outgoingEdges[0].targetNodeId;
      // Branch nodes must not follow edges into join nodes — the main flow
      // reaches the join via findDownstreamJoin and executes it once.
      if (node.branchId && targetId) {
        const target = this.pipeline.nodes.find(n => n.id === targetId);
        if (target?.config.type === 'join') return null;
      }
      return targetId || null;
    }

    // For decision gates and verification nodes
    const config = node.config;
    if (config.type === 'decision_gate') {
      const isTrue = result === 'true';
      const edgeId = isTrue ? config.trueEdge : config.falseEdge;
      const edge = this.pipeline.edges.find(e => e.id === edgeId);
      return edge ? this.guardJoinTarget(node, edge.targetNodeId) : null;
    }

    if (config.type === 'verification') {
      const passed = result.startsWith('PASS');
      const edgeId = passed ? config.passEdge : config.failEdge;
      const edge = this.pipeline.edges.find(e => e.id === edgeId);
      return edge ? this.guardJoinTarget(node, edge.targetNodeId) : null;
    }

    // For conditional edges, evaluate conditions
    for (const edge of outgoingEdges) {
      if (edge.condition) {
        const matches = await this.callbacks.evaluateCondition(edge.condition, this.context);
        if (matches) return this.guardJoinTarget(node, edge.targetNodeId);
      }
    }

    // Default: first edge
    return this.guardJoinTarget(node, outgoingEdges[0].targetNodeId);
  }

  /** Prevent branch nodes from following edges into join nodes. */
  private guardJoinTarget(sourceNode: PipelineNode, targetId: string): string | null {
    if (sourceNode.branchId && targetId) {
      const target = this.pipeline.nodes.find(n => n.id === targetId);
      if (target?.config.type === 'join') return null;
    }
    return targetId || null;
  }

  private evaluateDeterministicCondition(condition: string, input: string): boolean {
    // Simple condition evaluation
    if (condition.startsWith('contains:')) {
      return input.includes(condition.slice(9).trim());
    }
    if (condition.startsWith('equals:')) {
      return input.trim() === condition.slice(7).trim();
    }
    if (condition.startsWith('length>')) {
      return input.length > parseInt(condition.slice(7).trim());
    }
    return input.toLowerCase().includes(condition.toLowerCase());
  }

  private setNodeStatus(node: PipelineNode, status: NodeStatus): void {
    node.status = status;
  }

  private log(node: PipelineNode, event: PipelineLogEntry['event'], detail?: string): void {
    this.context.executionLog.push({
      timestamp: Date.now(),
      nodeId: node.id,
      nodeLabel: node.label,
      event,
      detail,
    });
  }
}
