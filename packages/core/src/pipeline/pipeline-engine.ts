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
  ParallelConfig,
  VerificationConfig,
} from './types';
import type { ToolContext } from '../types';

export interface PipelineCallbacks {
  onNodeStart: (node: PipelineNode) => void;
  onNodeComplete: (node: PipelineNode, result: string) => void;
  onNodeFail: (node: PipelineNode, error: string) => void;
  onPipelineComplete: (context: PipelineExecutionContext) => void;
  onPipelineError: (error: string) => void;
  executeAgent: (node: PipelineNode, config: AgentNodeConfig, input: string) => Promise<string>;
  executeTool: (config: ToolNodeConfig, context: ToolContext) => Promise<string>;
  evaluateCondition: (condition: string, context: PipelineExecutionContext) => Promise<boolean>;
  askUser: (prompt: string, options?: string[]) => Promise<string>;
  runVerification: (type: string, command?: string) => Promise<{ passed: boolean; output: string }>;
}

export class PipelineEngine {
  private pipeline: Pipeline;
  private context: PipelineExecutionContext;
  private callbacks: PipelineCallbacks;
  private toolContext: ToolContext;
  private aborted = false;

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
      const msg = err instanceof Error ? err.message : String(err);
      node.error = msg;
      this.setNodeStatus(node, 'failed');
      this.log(node, 'fail', msg);
      this.callbacks.onNodeFail(node, msg);
      throw err;
    }
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
        return this.executeParallel(config, input);

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

  private async executeParallel(config: ParallelConfig, input: string): Promise<string> {
    const branchPromises = config.branches.map(async (branch) => {
      let result = input;
      for (const nodeId of branch.nodeIds) {
        result = await this.executeNode(nodeId, result);
      }
      return { label: branch.label, result };
    });

    if (config.mergeStrategy === 'first_completed') {
      const first = await Promise.race(branchPromises);
      return `[${first.label}]: ${first.result}`;
    }

    // wait_all (default)
    const allResults = await Promise.all(branchPromises);
    return allResults.map(r => `[${r.label}]: ${r.result}`).join('\n\n');
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
    const outgoingEdges = this.pipeline.edges.filter(e => e.sourceNodeId === node.id);

    if (outgoingEdges.length === 0) return null;
    if (outgoingEdges.length === 1) return outgoingEdges[0].targetNodeId;

    // For decision gates and verification nodes
    const config = node.config;
    if (config.type === 'decision_gate') {
      const isTrue = result === 'true';
      const edgeId = isTrue ? config.trueEdge : config.falseEdge;
      const edge = this.pipeline.edges.find(e => e.id === edgeId);
      return edge?.targetNodeId ?? null;
    }

    if (config.type === 'verification') {
      const passed = result.startsWith('PASS');
      const edgeId = passed ? config.passEdge : config.failEdge;
      const edge = this.pipeline.edges.find(e => e.id === edgeId);
      return edge?.targetNodeId ?? null;
    }

    // For conditional edges, evaluate conditions
    for (const edge of outgoingEdges) {
      if (edge.condition) {
        const matches = await this.callbacks.evaluateCondition(edge.condition, this.context);
        if (matches) return edge.targetNodeId;
      }
    }

    // Default: first edge
    return outgoingEdges[0].targetNodeId;
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
