# Plan: Split Parallel Node into Parallel + Join

## Problem Statement

The current `parallel` node type handles two distinct responsibilities:
1. **Fan-out** — dispatching work to N concurrent branches
2. **Merge** — waiting for branches and combining results

This coupling creates problems:
- The node's config (`ParallelConfig`) mixes branch definitions with merge strategy
- All branches must converge at the same point (the parallel node's internal merge)
- The visual representation is ambiguous — it's unclear where forking ends and merging begins
- Impossible to express patterns like partial joins, cascading merges, or fire-and-forget branches

## Design Overview

Split into two node types:

- **`parallel`** — Pure fan-out. Dispatches all outgoing branches concurrently and completes immediately.
- **`join`** (new) — Pure fan-in. Waits for incoming branches and merges results according to its strategy.

Both are edge-driven — the graph topology defines branches, not internal config.

```
        ┌─── Agent A ───┐
Input → Parallel         Join → Output
        └─── Agent B ───┘
```

## Parallel Node (Fan-Out)

### Behavior
- Receives input from its single incoming edge
- Fires all outgoing branches concurrently, passing the same input to each
- Marks itself **complete immediately** — does not wait for branches
- Each branch runs independently until it hits a join node or terminates

### Config
```typescript
export interface ParallelConfig {
  type: 'parallel';
  // No branches array — branches are defined by outgoing edges
  // No mergeStrategy — that lives on the join node
}
```

The config becomes minimal. The parallel node is essentially a marker that says "everything downstream from here runs concurrently."

### Visual Representation
- Keep dynamic output ports: one per outgoing edge + a "+" port for adding new connections
- Dynamic node height in horizontal layout when many branches exist
- Color: cyan (`#06b6d4`) — unchanged

## Join Node (Fan-In)

### Behavior
- Waits for results from all incoming edges (auto-detected)
- Applies merge strategy to combine results
- Passes merged result to its single outgoing edge
- General-purpose convergence point — treats all incoming edges equally regardless of source

### Config
```typescript
export interface JoinConfig {
  type: 'join';
  mergeStrategy: 'wait_all' | 'first_completed' | 'custom';
  failurePolicy: 'fail_fast' | 'collect_partial' | 'ignore_failures';
  branchTimeout?: number; // ms — per-branch timeout; proceed without slow branches
}
```

**Merge strategies:**
- `wait_all` — Wait for every incoming edge to deliver a result, then combine
- `first_completed` — Return the first result that arrives, cancel/ignore the rest
- `custom` — Placeholder for user-defined merge logic

**Failure policies:**
- `fail_fast` — If any branch fails, the join fails immediately
- `collect_partial` — Proceed with whatever results arrived; note failures in output
- `ignore_failures` — Silently skip failed branches

**Branch timeout:** Optional. If a branch doesn't deliver within N ms, the join proceeds without it (respecting the failure policy).

### Visual Representation
- **Mirror of the parallel node**: multiple dynamic input ports (one per incoming edge) + single output port
- Input ports are dynamic — one per incoming edge, auto-generated
- Color: suggest a complementary shade (e.g., `#0891b2` — darker cyan) to visually pair with the parallel node
- Node label: "join" by default

## Type System Changes

### `NodeType` union
```typescript
export type NodeType =
  | 'agent'
  | 'tool'
  | 'decision_gate'
  | 'user_checkpoint'
  | 'loop'
  | 'parallel'
  | 'join'        // NEW
  | 'verification'
  | 'plugin';
```

### `NodeConfig` union
```typescript
export type NodeConfig =
  | AgentNodeConfig
  | ToolNodeConfig
  | DecisionGateConfig
  | UserCheckpointConfig
  | LoopConfig
  | ParallelConfig  // simplified — no branches, no mergeStrategy
  | JoinConfig      // NEW
  | VerificationConfig
  | PluginConfig;
```

### Simplified `ParallelConfig`
```typescript
export interface ParallelConfig {
  type: 'parallel';
  // Empty — branches are edge-driven, merge is on the join node
}
```

### New `JoinConfig`
```typescript
export interface JoinConfig {
  type: 'join';
  mergeStrategy: 'wait_all' | 'first_completed' | 'custom';
  failurePolicy: 'fail_fast' | 'collect_partial' | 'ignore_failures';
  branchTimeout?: number;
}
```

## Engine Changes

### `executeParallel` (simplified)
The parallel node no longer waits for results. It fires all branches and returns immediately.

```typescript
private async executeParallel(node: PipelineNode, input: string): Promise<string> {
  const outgoingEdges = this.pipeline.edges.filter(e => e.sourceNodeId === node.id);

  // Fire all branches concurrently — don't await them here
  for (const edge of outgoingEdges) {
    this.fireBranch(edge.targetNodeId, input); // async, not awaited
  }

  return input; // Pass through — the join will collect results
}
```

### New `executeJoin`
The join node is the blocking synchronization point.

```typescript
private async executeJoin(node: PipelineNode, config: JoinConfig): Promise<string> {
  const incomingEdges = this.pipeline.edges.filter(e => e.targetNodeId === node.id);
  const branchResults = await this.collectBranchResults(incomingEdges, config);
  return this.mergeResults(branchResults, config.mergeStrategy);
}
```

### Execution model
- The engine needs a concept of **pending branch results** — a map of `nodeId → Promise<string>` for branches that have been fired but not yet collected
- When a parallel node fires, it registers promises for each branch
- When a join node executes, it awaits the promises for its incoming edges

### Nesting
Fully nestable. Since everything is edge-driven:
- A branch can contain another parallel → join pair
- Each join independently collects from its own incoming edges
- No special nesting logic needed — the edge topology handles it

## Editor Changes

### Parallel node
- Already has dynamic output ports from recent work — keep as-is
- Remove merge strategy from the parallel config panel (moved to join)
- Config panel becomes minimal: just label + retry count

### Join node
- **Dynamic input ports**: mirror of parallel's output ports — one per incoming edge
- Single output port
- Config panel shows: merge strategy, failure policy, branch timeout
- New color in `NODE_TYPE_COLORS`: `join: '#0891b2'`

### `getInputPort` → `getInputPorts` (plural)
For join nodes, need a new function that returns multiple input ports (one per incoming edge), similar to how `getOutputPorts` works for parallel nodes.

### Validation warning
When a parallel node has outgoing branches that don't eventually reach a join node, the editor should display a visual warning (e.g., dashed border, warning icon, or tooltip) indicating results won't be collected.

## Migration

No existing templates use parallel nodes, so migration is straightforward:
- The old `ParallelConfig` with `branches` array is deprecated
- If any user-created pipelines exist with the old format, convert them:
  1. Create a join node positioned after the parallel node
  2. Move `mergeStrategy` from the parallel config to the join config
  3. Convert internal `branches[].nodeIds` to outgoing edges from the parallel node
  4. Connect branch endpoints to the new join node
  5. Set default `failurePolicy: 'collect_partial'` on the join

## Non-Goals

These ideas were considered but are explicitly out of scope:
- **Visual swim lanes** between parallel and join nodes
- **Auto-pair suggestion** (editor auto-creating join when parallel is connected)
- **Conditional branching** on the parallel node (use a decision gate before the parallel instead)
- **Result transformation** on the join node (use an agent node after the join)
- **Branch weight/priority** on edges
- **Live progress indicator** on join nodes (could be added later)
