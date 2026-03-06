# Agentic Loop Hooks — Pluggable Middleware System

## 1. Vision & Elevator Pitch

A pluggable hook system that lets users intercept, modify, and augment the agentic loop at any point — without writing code. Instead of designing entire workflows (like pipelines), users attach small, focused hooks to specific moments in the agent's think/act/observe cycle. Think of it as middleware for your AI agent: composable, configurable, and visual.

The UI presents the agentic loop as a vertical spine (like a subway map) with hooks branching off at attachment points. Users drag nodes onto hook points, chain them together, and watch them fire in real-time through a built-in debugger.

## 2. Problem Statement

The existing pipeline system is a powerful graph-based workflow engine, but it has friction:

- **Too complex for simple customizations** — users who just want "scan for things to remember after each turn" shouldn't need to design a multi-node graph
- **Defines the workflow, not the loop** — pipelines replace the agentic loop with a custom flow. Users want to augment the existing loop, not replace it
- **All-or-nothing** — you either use a pipeline or you don't. No way to add a small hook to the default agent behavior

The hook system solves this by being **simpler** (attach a hook, configure it), **additive** (hooks augment the existing loop), and **composable** (mix and match small hooks instead of designing entire flows).

## 3. Goals & Non-Goals

### Goals (v1)
- Pluggable hook points at every major transition in the agentic loop
- Three execution modes: LLM-prompted, pre-built templates, custom scripts
- Full control hooks: observe, inject, modify, block, redirect, abort
- Spine + branches visual UI with live debugger and state inspector
- Variable system with turn, session, and persistent scopes
- Composition blocks for reusable hook chains
- Every agentic loop instance (main + spawned) runs hooks automatically
- Separate from and coexists with the pipeline system

### Non-Goals (v1)
- Sharing/marketplace for hook configurations
- Cross-loop coordination (hooks on Agent A talking to Agent B's hooks)
- Replacing the pipeline system (may happen later, not now)

## 4. Core Concepts

### Hook Points
Well-defined moments in the agentic loop lifecycle where hooks can attach. Each hook point exposes specific data and allows specific modifications. See Section 5 for the full catalog.

### Chains
A sequential middleware pipeline at a single hook point. Hooks in a chain execute in priority order — each hook sees the output of the previous one. Chains can block, modify, or inject into the loop flow.

### Branches
Multiple independent chains can run at the same hook point in parallel. Parallel branches are **async/observe-only** — they cannot modify or block the loop. Only sequential chains within a single branch have blocking/modification power.

**Rule:** Sequential chains block/modify. Parallel branches observe.

### Nodes
The atomic unit of a hook chain. Four types:

| Node Type | Execution | Can Modify Loop? | Use Case |
|-----------|-----------|-------------------|----------|
| **LLM Node** | Sends context to an LLM with a user-written prompt | Yes (via tool calls or return value) | Complex reasoning — "analyze this conversation" |
| **Template Node** | Pre-configured LLM node with curated prompt + tools | Yes | One-click presets — "Memory Scanner", "Code Reviewer" |
| **Script Node** | Runs a JS/Python/shell script | Yes (via return value) | Deterministic logic, API calls, file operations |
| **Decision Node** | Evaluates a condition (regex, expression, or LLM) | Controls flow (continue/short-circuit) | Conditional activation — "only if Python files changed" |

### Variables
User-defined key-value pairs that flow through the agentic loop. Hooks can get/set variables. Three scopes:

| Scope | Lifetime | Storage | Example |
|-------|----------|---------|---------|
| **Turn** | Single turn (user message → response) | In-memory | `$toolCallCount`, `$lastError` |
| **Session** | Entire conversation session | In-memory | `$projectContext`, `$userPreferences` |
| **Persistent** | Across sessions | Memory DB / disk | `$codePatterns`, `$teamConventions` |

Variables are available in:
- LLM node prompts via template syntax (e.g., `{{$lastError}}`)
- Script nodes via environment variables or a context API
- Decision node conditions (e.g., `$toolCallCount > 5`)

### Composition Blocks
A saved chain of nodes that can be reused as a single unit. Users create a chain, save it as a block, and drag it onto any hook point. Blocks are like functions — define once, use everywhere.

## 5. Hook Point Catalog

The agentic loop has the following attachment points:

### Turn Lifecycle
| Hook Point | Fires When | Data Exposed | Allowed Modifications |
|------------|------------|--------------|----------------------|
| `turn:start` | User message received, before any processing | User message, attachments, session state | Modify message, inject context, set variables, abort turn |
| `turn:end` | Final response delivered to user | Full message history for this turn, tool calls made, final response | Inject follow-up actions, update variables, trigger side effects |
| `turn:error` | Unrecoverable error in the loop | Error details, partial history | Retry, fallback response, log/alert |

### LLM Lifecycle
| Hook Point | Fires When | Data Exposed | Allowed Modifications |
|------------|------------|--------------|----------------------|
| `llm:before` | Before each LLM API call | Messages array, system prompt, model config | Modify messages, inject context, change model, modify system prompt |
| `llm:after` | After LLM response received (before parsing) | Raw LLM response, token usage | Modify response text, filter content, log usage |
| `llm:stream` | On each streamed token (high frequency) | Token, accumulated text so far | Observe only (async) — monitoring and logging |

### Tool Lifecycle
| Hook Point | Fires When | Data Exposed | Allowed Modifications |
|------------|------------|--------------|----------------------|
| `tool:before` | Before a tool is executed | Tool name, arguments, tool definition | Modify args, block execution, substitute tool, inject approval gate |
| `tool:after` | After tool returns result | Tool name, arguments, result, duration | Modify result, inject follow-up, log, trigger side effects |
| `tool:error` | Tool execution fails | Tool name, arguments, error | Retry with modified args, fallback result, abort loop |

### Loop Control
| Hook Point | Fires When | Data Exposed | Allowed Modifications |
|------------|------------|--------------|----------------------|
| `loop:iterate` | Before each loop iteration (after tool results, before next LLM call) | Iteration count, accumulated messages, tool call history | Inject messages, modify history, force completion, abort |
| `loop:complete` | Agent signals task completion (attempt_completion) | Full conversation history, completion result | Modify completion message, reject completion (force continue), trigger post-completion actions |
| `loop:max_iterations` | Max iteration limit reached | Iteration count, history | Override limit, force completion, escalate to user |

### Agent Lifecycle
| Hook Point | Fires When | Data Exposed | Allowed Modifications |
|------------|------------|--------------|----------------------|
| `agent:spawn` | Sub-agent is about to be spawned | Spawn config, parent context | Modify spawn config, attach hooks to child, block spawn |
| `agent:complete` | Sub-agent finishes | Child's result, message history | Modify result before parent sees it |

## 6. Node Types — Detailed Configuration

### LLM Node
```yaml
type: llm
config:
  prompt: "Review the conversation and identify key decisions made..."
  model: "default"           # or specific model override
  tools: ["search_codebase", "write_file"]  # tools the LLM can use
  maxTokens: 2000
  temperature: 0.3
timing: sync | async | deferred
```

The LLM receives:
- The hook point's exposed data (messages, tool results, etc.)
- Current variable state
- The user's prompt instructions
- Access to specified tools

The LLM's response determines the hook's action:
- Return structured output → modifications applied to the loop
- Call tools → side effects executed
- Return nothing → no modification (observe-only)

### Template Node
Pre-configured LLM nodes shipped as built-in presets:

| Template | Hook Point | What It Does |
|----------|------------|--------------|
| **Memory Scanner** | `turn:end` | Reviews conversation history, extracts key insights, saves to memory DB |
| **Context Injector** | `llm:before` | Queries memory/codebase for relevant context and injects it into the prompt |
| **Tool Auditor** | `tool:before` | Reviews tool calls for safety — blocks destructive operations without confirmation |
| **Code Reviewer** | `tool:after` (write_file) | Reviews code changes for quality, suggests improvements |
| **Progress Tracker** | `loop:iterate` | Summarizes progress so far, updates a running status |

Templates are editable — users can clone and customize the prompt, tools, and configuration.

### Script Node
```yaml
type: script
config:
  runtime: node | python | shell
  entrypoint: ".archon/hooks/my-script.js"  # or inline
  timeout: 5000  # ms
timing: sync | async | deferred
```

Scripts receive a JSON payload on stdin (or as function argument for JS):
```json
{
  "hookPoint": "tool:after",
  "data": { /* hook point data */ },
  "variables": { "$toolCallCount": 3, "$lastFile": "src/index.ts" },
  "config": { /* user-defined config params */ }
}
```

Scripts return a JSON response on stdout:
```json
{
  "action": "modify",         // "pass" | "modify" | "block" | "abort"
  "modifications": { /* changes to apply */ },
  "variables": { "$toolCallCount": 4 }  // variable updates
}
```

### Decision Node
```yaml
type: decision
config:
  mode: regex | expression | llm
  # For regex mode:
  pattern: "\\.(py|pyx)$"
  target: "$lastFile"         # variable or data field to test
  # For expression mode:
  expression: "$toolCallCount > 5"
  # For LLM mode:
  prompt: "Is this conversation about a bug fix?"
  model: "fast"               # use cheapest/fastest model
onTrue: continue              # proceed to next node in chain
onFalse: skip                 # short-circuit the rest of the chain
```

## 7. Variable System

### Defining Variables
Users define variables in the hook configuration UI:

```yaml
variables:
  - name: toolCallCount
    scope: turn
    type: number
    default: 0
  - name: projectContext
    scope: session
    type: string
    default: ""
  - name: codePatterns
    scope: persistent
    type: json
    default: {}
```

### Access Patterns

**In LLM prompts:**
```
The user has made {{$toolCallCount}} tool calls this turn.
Project context: {{$projectContext}}
```

**In script nodes:**
```javascript
// JS — received in payload
const { variables } = JSON.parse(input);
const count = variables.$toolCallCount;
// Return updated variables
return { variables: { $toolCallCount: count + 1 } };
```

**In decision nodes:**
```yaml
expression: "$toolCallCount > 10 && $lastError != ''"
```

### Variable Updates
- Any node in a chain can update variables
- Updates are visible to subsequent nodes in the same chain
- Parallel branches see the variable state at fork time (snapshot isolation)
- Persistent variables are flushed to storage at turn end

## 8. Architecture Overview

### Integration with AgentLoop

The hook system wraps the existing `AgentLoop` without modifying its core logic. A new `HookEngine` class sits between the executor and the agent loop:

```
┌─────────────────────────────────────────────┐
│                 Executor                     │
│  (chat-view-provider / pipeline-executor)    │
└──────────────────┬──────────────────────────┘
                   │
          ┌────────▼────────┐
          │   HookEngine    │  ← NEW
          │                 │
          │  • Hook registry│
          │  • Chain runner │
          │  • Variable store│
          │  • Debugger bus │
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │   AgentLoop     │  ← EXISTING (minimal changes)
          │                 │
          │  • streamResponse│
          │  • executeTool  │
          │  • callbacks    │
          └─────────────────┘
```

### Runtime Flow

1. User sends a message
2. **HookEngine** fires `turn:start` hooks → chains execute → modifications applied
3. **AgentLoop** begins iteration
4. **HookEngine** fires `llm:before` hooks → context injected/modified
5. **AgentLoop** calls LLM, streams response
6. **HookEngine** fires `llm:after` hooks → response potentially modified
7. **AgentLoop** parses tool calls
8. For each tool call:
   - **HookEngine** fires `tool:before` → may block/modify
   - **AgentLoop** executes tool
   - **HookEngine** fires `tool:after` → may modify result
9. **HookEngine** fires `loop:iterate` → may inject messages or force completion
10. If loop continues → back to step 4
11. On completion: **HookEngine** fires `loop:complete` and `turn:end`

### Changes to AgentLoop

Minimal. The `AgentLoop` class gets new callback slots that the `HookEngine` wires into:

- `onBeforeLLMCall(messages) → messages` (can modify)
- `onAfterLLMCall(response) → response` (can modify)
- `onBeforeToolExec(toolCall) → toolCall | null` (can modify or block)
- `onAfterToolExec(toolCall, result) → result` (can modify)
- `onIteration(state) → state` (can inject or stop)

These are thin extension points — the `AgentLoop` calls them and uses the return value. All complex logic lives in `HookEngine`.

### Relationship to Pipeline System

- **Independent systems** — hooks and pipelines coexist
- When a pipeline runs an `agent` node, that agent's loop has hooks active
- Pipeline nodes and hook nodes are different concepts (pipeline nodes define workflow; hook nodes augment the loop)
- Future: hooks could eventually replace pipelines for simpler use cases

## 9. UI Design: Spine + Branches

### Webview Panel Layout

The hook configuration panel lives in the extension's webview, accessible from the sidebar or a command.

```
┌──────────────────────────────────────────────┐
│  Agentic Loop Hooks          [+ Add Hook] ⚙  │
├──────────────────────────────────────────────┤
│                                              │
│  ● turn:start                                │
│  │                                           │
│  ├── [Context Injector] ─ sync               │
│  │                                           │
│  ● llm:before                                │
│  │                                           │
│  ├── [Prompt Enhancer] ─ sync                │
│  │                                           │
│  ● llm:after                                 │
│  │                                           │
│  ● tool:before                               │
│  │                                           │
│  ├── [Safety Check] ─ sync                   │
│  │   └── [Decision: destructive?]            │
│  │       └── [Ask User Confirmation]         │
│  │                                           │
│  ● tool:after                                │
│  │                                           │
│  ● loop:iterate                              │
│  │                                           │
│  ● loop:complete                             │
│  │                                           │
│  ● turn:end                                  │
│  │                                           │
│  ├── [Memory Scanner] ─ async    ──┐         │
│  │                                 │ parallel │
│  ├── [Progress Logger] ─ async   ──┘         │
│  │                                           │
│  ○ (end)                                     │
│                                              │
└──────────────────────────────────────────────┘
```

**Interaction model:**
- The spine (vertical line with dots) is fixed — it represents the loop lifecycle
- Users click a hook point dot to attach a new hook (opens node config panel)
- Drag to reorder hooks within a chain (changes priority)
- Click a hook node to configure it (prompt, tools, timing, variables)
- Parallel branches shown as forked lines from the same hook point
- Disabled hooks shown as grayed-out nodes

### Live Debugger View

When the agent is running, the spine view switches to a live mode:

```
┌──────────────────────────────────────────────┐
│  🔴 LIVE  Agentic Loop — Turn 3             │
├──────────────────────────────────────────────┤
│                                              │
│  ✓ turn:start                     0ms        │
│  │                                           │
│  ├── ✓ [Context Injector]        45ms        │
│  │      injected 3 context chunks            │
│  │                                           │
│  ✓ llm:before                                │
│  │                                           │
│  ▶ llm:after                    (running)    │
│  │                                           │
│  ○ tool:before                  (pending)    │
│  │                                           │
│  ...                                         │
│                                              │
│  Variables:                                  │
│  $toolCallCount = 2                          │
│  $lastFile = "src/utils.ts"                  │
│  $sessionGoal = "refactor auth module"       │
│                                              │
└──────────────────────────────────────────────┘
```

- Green checkmark: hook point fired, all hooks completed
- Blue play icon: currently executing
- Gray circle: pending (hasn't fired yet)
- Red X: hook errored
- Each node shows execution time and a brief summary of what it did

### Visual State Inspector

Click any completed hook point in the debugger to expand a detail panel:

```
┌──────────────────────────────────────────────┐
│  tool:after — read_file("src/auth.ts")       │
├──────────────────────────────────────────────┤
│  Input:                                      │
│    tool: read_file                            │
│    result: "export class AuthService..."      │
│    variables: { $toolCallCount: 1 }          │
│                                              │
│  Hook: [Code Reviewer] — 120ms               │
│    Output: "No issues found"                 │
│    Variable changes:                         │
│      $toolCallCount: 1 → 2                   │
│                                              │
│  Final state:                                │
│    result: (unchanged)                       │
│    variables: { $toolCallCount: 2 }          │
└──────────────────────────────────────────────┘
```

## 10. Implementation Phases

### Phase 1: Core Engine
- `HookEngine` class with hook point registry
- Hook configuration schema (YAML/JSON)
- Sequential chain execution with priority ordering
- Integration with `AgentLoop` (new callback slots)
- Basic node types: Script Node, Decision Node
- Turn-scoped variables

### Phase 2: LLM Nodes & Templates
- LLM Node execution with tool access
- Template system with built-in presets (Memory Scanner, Context Injector, Tool Auditor)
- Template cloning and customization
- Session-scoped and persistent variables

### Phase 3: Spine UI
- Webview panel with spine + branches visualization
- Hook point attachment workflow (click to add)
- Node configuration panel (prompt, tools, timing)
- Chain ordering (drag to reorder)
- Parallel branch visualization

### Phase 4: Async & Parallel
- Async/deferred hook timing
- Parallel branch execution at hook points
- Snapshot isolation for variables in parallel branches

### Phase 5: Debugger & Inspector
- Live debugger view (real-time hook execution)
- Visual state inspector (click to inspect variables/data)
- Execution time and summary display
- Error visualization

### Phase 6: Composition & Polish
- Composition blocks (save/reuse chains)
- Hook enable/disable toggle
- Import/export hook configurations (file-based, no marketplace)
- Performance optimization (lazy loading, caching)

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Performance overhead** — sync hooks on every LLM call/tool exec add latency | High | Default to async where possible; show timing in debugger so users can optimize; fast-path when no hooks attached |
| **LLM cost explosion** — LLM nodes at high-frequency hook points (llm:stream) drain tokens | High | Warn users about cost in UI when configuring LLM nodes at high-frequency points; recommend async/deferred for expensive hooks |
| **Complexity creep** — system becomes as complex as pipelines | Medium | Keep the spine metaphor strict — no freeform graph. Hooks attach to fixed points only |
| **Script security** — malicious or buggy scripts could crash the extension | Medium | Timeout enforcement on scripts; catch and display errors gracefully; trust-the-user model with clear warnings |
| **Variable conflicts** — multiple hooks writing the same variable | Medium | Priority ordering determines write order; last writer wins within a chain; snapshot isolation for parallel branches |
| **Debugging difficulty** — hard to understand why the agent behaved a certain way with many hooks | Medium | Live debugger + state inspector makes hook behavior transparent |

## 12. Open Questions

1. **Hook configuration storage** — where do hook configs live? `.archon/hooks.yaml`? SQLite alongside memory DB? VS Code settings?
2. **Hook point extensibility** — should users (or future development) be able to define custom hook points beyond the built-in catalog?
3. **Template contribution model** — how do new built-in templates get added? Just code changes, or a more structured template authoring workflow?
4. **Pipeline migration path** — if hooks eventually replace pipelines, what's the migration story for users with existing pipeline configs?
5. **Model selection for LLM nodes** — should LLM hook nodes use the same model as the main agent, or should users configure a separate (potentially cheaper) model?
6. **Variable type system** — how strict? Simple (string/number/boolean/json) or support arrays, typed objects, validation?
7. **Hook point granularity** — is `tool:before` one hook point for ALL tools, or should there be per-tool hook points (e.g., `tool:before:write_file`)?
