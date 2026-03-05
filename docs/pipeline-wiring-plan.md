# Pipeline Wiring Plan

## 1. Vision

Every chat session runs through the PipelineEngine. The current AgentLoop behavior becomes the "Default" pipeline — a single agent node that handles the prompt→LLM→tools→repeat cycle internally. Users can clone, modify, or create new pipelines and select which one drives each conversation.

There is no "non-pipeline" code path. The pipeline *is* the execution model.

---

## 2. Architecture

### PipelineExecutor (New Adapter Layer)

A new class in `packages/core/src/pipeline/pipeline-executor.ts` that bridges the existing infrastructure with PipelineEngine.

**Constructor dependencies:**
- OpenRouter client (for LLM calls)
- Tool registry (for tool execution)
- Webview message sender (for UI updates)
- Model configuration (currently selected model, model pool)

**Implements `PipelineCallbacks`:**
- `executeAgent(config)` → Creates an `AgentLoop` instance with the node's model/tools/system prompt. Uses the same streaming and tool execution callbacks as today. Returns the agent's final output.
- `executeTool(config)` → Delegates to `ToolRegistry.execute()` with the configured tool name and parameters.
- `evaluateCondition(condition, context)` → For deterministic conditions, uses string matching. For AI-evaluated conditions, makes a lightweight LLM call.
- `askUser(prompt)` → Sends a webview message prompting the user. Returns their response.
- `runVerification(type, context)` → Runs LSP diagnostics, test runner, or syntax checks via existing tool infrastructure.
- Status callbacks (`onNodeStart`, `onNodeComplete`, `onNodeFail`, etc.) → Forward to webview for real-time pipeline graph updates.

**Key principle:** The adapter uses the *exact same* underlying infrastructure the current system uses. No new LLM client, no new tool execution path. Just new orchestration on top.

### Integration in chat-view-provider

When a user sends a message:
1. Look up the selected pipeline (default if none chosen)
2. Create a `PipelineExecutor` with the current infrastructure
3. Create a `PipelineEngine` with the pipeline definition and the executor's callbacks
4. Run the pipeline with the user's message as input
5. Pipeline drives execution; chat-view-provider receives status updates via callbacks

### Data Flow

```
User sends message
    ↓
chat-view-provider
    ↓ creates
PipelineExecutor (adapter)
    ↓ provides callbacks to
PipelineEngine
    ↓ executes nodes
    ├── Agent node → PipelineExecutor.executeAgent()
    │       ↓ creates
    │   AgentLoop (same as today)
    │       ↓ streams to webview
    ├── Tool node → PipelineExecutor.executeTool()
    │       ↓ uses existing ToolRegistry
    ├── Decision gate → PipelineExecutor.evaluateCondition()
    ├── User checkpoint → PipelineExecutor.askUser()
    ├── Verification → PipelineExecutor.runVerification()
    ├── Loop → engine handles iteration
    └── Parallel → engine spawns concurrent branches
    ↓ results
Pipeline completes → final response to webview
```

---

## 3. Default Pipeline

The default pipeline replicates the current AgentLoop behavior as a single-node pipeline:

```json
{
  "id": "default",
  "name": "Default",
  "description": "Standard agentic loop — the AI processes your request using available tools",
  "entryNodeId": "agent-main",
  "nodes": [
    {
      "id": "agent-main",
      "type": "agent",
      "label": "Agent",
      "position": { "x": 300, "y": 200 },
      "config": {
        "model": "default",
        "systemPrompt": null,
        "tools": "all",
        "maxIterations": 50
      }
    }
  ],
  "edges": []
}
```

- `model: "default"` means use whatever model is selected in the chat dropdown
- `systemPrompt: null` means use the standard system prompt
- `tools: "all"` means all available tools
- This pipeline behaves identically to the current system — users notice no difference

This pipeline is built-in and cannot be deleted, but can be cloned.

---

## 4. Pipeline Storage

### Layered System

**Global pipelines (user-level):**
- Location: VS Code `globalState` or a user-level config directory
- Available across all projects
- Contains the built-in templates and user-created global pipelines

**Project pipelines:**
- Location: `.archon/pipelines/` directory
- Version-controlled with git, shareable with team
- Each pipeline is a JSON file (e.g., `.archon/pipelines/tdd-workflow.json`)

**Resolution order:** Project pipelines take precedence over global pipelines when names collide.

### Pipeline CRUD Operations

- **Create:** From blank, from template, or clone existing
- **Read:** List all available pipelines (global + project)
- **Update:** Edit in visual editor, save back to storage
- **Delete:** Remove pipeline file (built-in templates cannot be deleted)
- **Export/Import:** Pipelines are plain JSON files — copy/paste, share via git

---

## 5. UI Changes

### Pipeline Selector in Chat Input

- Dropdown positioned next to the existing model selector in the chat input area
- Shows all available pipelines: built-in templates + global + project
- Default selection: "Default" pipeline
- **Locked during execution** — dropdown is disabled while a pipeline is running
- **Unlocked between messages** — user can switch pipelines after the current execution completes

### Slash Command

- `/pipeline` or `/workflow` command in chat
- Lists available pipelines, allows switching
- Also provides quick access to pipeline editor

### Side-by-Side Split View

When a user is running a non-default pipeline:
- Chat panel on the left
- Pipeline graph visualization on the right
- Currently executing node is highlighted (e.g., pulsing border, different color)
- Completed nodes show checkmarks, failed nodes show X marks
- Edges animate to show flow direction

For the default (single-node) pipeline, the split view is optional — can show just the chat.

### Pipeline Editor Integration

- The existing pipeline editor tab gains save/load functionality
- "Save as Pipeline" button to persist the current graph
- "Use in Chat" button to apply the pipeline to the active chat session
- Right-click context menu on nodes to configure model, tools, system prompt

---

## 6. Node Configuration

### Per-Node Config Schema

Each agent node supports:

```typescript
interface AgentNodeConfig {
  model: string | 'default';       // Model ID or 'default' for chat-selected model
  systemPrompt: string | null;     // Custom system prompt, null for standard
  tools: string[] | 'all';         // Specific tool IDs or 'all'
  maxIterations: number;           // Max tool-call loops (safety limit)
  temperature?: number;            // Model temperature override
  inheritContext: boolean;         // Whether to inherit conversation history
}
```

### Context Passing Between Nodes

- Each node receives the output of the previous node via the pipeline context (`context.variables`, `context.results`)
- The `inheritContext` flag controls whether the node also gets the broader conversation history
- Default: `false` (fresh context with just the previous node's output)
- When `true`: node receives a summary of the conversation plus previous outputs

### "Use Default" Option

- `model: "default"` → use the model selected in the chat dropdown
- `systemPrompt: null` → use the standard Archon system prompt
- `tools: "all"` → all registered tools available
- This is what the default pipeline uses, making it behave identically to today

---

## 7. Error Handling

### Node-Level Retry

Each node can specify a `retryCount` (default: 0). On failure:
1. Retry up to `retryCount` times
2. If still failing, follow the failure edge (if one exists)
3. If no failure edge, stop the pipeline and report to the user

### Fallback Edges

Pipeline edges can have a `condition` of `"on_failure"`. When a node fails (after retries exhausted), the engine follows the failure edge to a recovery node.

Example: Code Agent → (on_failure) → Fix Agent → (loop back to) → Verification

### User Escalation (Default Fallback)

If a node fails and has no failure edge, the pipeline pauses and presents the error to the user with options:
- Retry the node
- Skip the node and continue
- Abort the pipeline

---

## 8. Conditional Model Routing

Decision gate nodes can evaluate task complexity and route to different agent nodes with different models:

```
User Message → Complexity Analyzer (decision gate)
    ├── (simple) → Fast Agent (gemini-flash, low cost)
    ├── (moderate) → Standard Agent (claude-sonnet)
    └── (complex) → Reasoning Agent (deepseek-r1 or claude-opus)
```

### Implementation

- Decision gate nodes already support AI-evaluated conditions
- The condition prompt analyzes the task: "Is this a simple lookup, a moderate code change, or a complex architectural task?"
- The LLM call for the decision gate uses the cheapest available model (it's a classification task)
- Each branch leads to an agent node configured with the appropriate model from the user's model pool

### Model Pool Reference

Agent node configs can reference the user's model pool by role name:
```json
{ "model": "pool:architect" }
{ "model": "pool:coder" }
{ "model": "pool:fast" }
```

This maps to the model pool defined in settings (from the original plan §9.3).

---

## 9. spawn_agent Wiring

### Current State

The `spawn_agent` tool is defined in `extended-tools.ts` but the callback is not provided in `chat-view-provider.ts`.

### Implementation

In `PipelineExecutor`, implement the spawn callback:

```
spawnAgent(systemPrompt, task, model?) → {
  1. Create a new AgentLoop instance
  2. Configure it with the given system prompt, task, and model
  3. Run it to completion
  4. Return its final output as a string
}
```

This callback is provided to the tool registry when creating extended tools, completing the wiring.

The `spawn_agent` tool is also used internally by the parallel node type — each parallel branch spawns a sub-agent via this mechanism.

---

## 10. Implementation Phases

### Phase A: PipelineExecutor Adapter

1. Create `packages/core/src/pipeline/pipeline-executor.ts`
2. Implement all `PipelineCallbacks` methods delegating to existing infrastructure
3. Create the default pipeline definition
4. Wire into `chat-view-provider.ts` — replace direct AgentLoop usage with PipelineExecutor → PipelineEngine → (agent node creates AgentLoop)
5. Verify that the default pipeline produces identical behavior to the current system

**Success criteria:** Existing chat behavior is unchanged. Users don't notice any difference.

### Phase B: Pipeline Storage & Management

1. Implement pipeline storage (global + project-level)
2. Add pipeline CRUD operations
3. Wire save/load into the pipeline editor webview
4. Add "clone" and "create blank" functionality

### Phase C: Chat UI Integration

1. Add pipeline selector dropdown to chat input (next to model selector)
2. Implement execution locking (disable dropdown during pipeline run)
3. Add `/pipeline` slash command
4. Implement side-by-side split view (chat + live pipeline graph)
5. Add real-time node status highlighting during execution

### Phase D: Node Configuration UI

1. Add node configuration panel in pipeline editor (click node → configure model, tools, prompt)
2. Implement "use default" option for all config fields
3. Add context passing configuration (inheritContext toggle)
4. Implement per-node model selection (direct model ID or pool reference)

### Phase E: Error Handling & Retry

1. Add `retryCount` field to node schema
2. Implement retry logic in PipelineEngine
3. Add "on_failure" edge condition support
4. Implement user escalation UI when no failure edge exists

### Phase F: Conditional Model Routing

1. Implement AI-evaluated decision gate execution in PipelineExecutor
2. Add model pool reference resolution (`pool:architect` → actual model ID)
3. Create a "Smart Routing" template pipeline that demonstrates complexity-based model selection
4. Wire model pool configuration into settings

### Phase G: spawn_agent Completion

1. Implement spawn callback in PipelineExecutor
2. Wire it into extended tools creation in chat-view-provider
3. Connect parallel node execution to spawn mechanism

---

## Open Questions

1. **Pipeline versioning:** When a user updates a project pipeline, should we keep previous versions? Git handles this for project-level, but global pipelines might need versioning.
2. **Pipeline permissions:** In strict security mode, should users be required to approve each node's tool access, or is pipeline-level approval sufficient?
3. **Max parallel branches:** Should there be a hard limit on parallel sub-agents to prevent runaway token costs?
4. **Pipeline sharing format:** Should exported pipelines include model pool references, or resolve to specific model IDs?
