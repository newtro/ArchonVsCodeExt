# Archon: Model-Agnostic AI Coding Extension for VS Code

## 1. Vision & Elevator Pitch

Archon is an open-source VS Code extension that gives developers full control over their AI coding workflow. Unlike existing tools where you're locked into a fixed agentic loop, Archon lets you design, visualize, and modify AI workflows in real-time through a visual node-based graph editor — like n8n for AI coding agents.

**Key value proposition:** You are the orchestrator. Archon gives you a visual pipeline where you choose the models, design the workflow, and maintain full visibility into every action the AI takes. No vendor lock-in, no black-box agents, no surprise costs.

**Target audience:** Open-source community — developers who want power, transparency, and ownership over their AI tooling.

---

## 2. Core Differentiators

### 2.1 Visual Agentic Workflow Graph
A drag-and-drop node-based editor where users design AI coding workflows. Each node is an agent step, tool execution, decision gate, or user checkpoint. Workflows are editable while running. No other AI coding tool offers this level of visual workflow control.

### 2.2 Composable Pipeline with Orchestrator Agent
Two levels of control:
- **Level 1 (User-Designed):** Users create workflow templates visually
- **Level 2 (AI-Managed):** An orchestrator agent dynamically generates, selects, or modifies workflows based on the task. The user always has override authority.

### 2.3 Four-Layer Memory System
Persistent, cross-session memory that actually learns:
1. Rules (file-scoped project conventions)
2. Codebase RAG (local semantic search over your code)
3. Session Memory (auto-summarized, confidence-weighted)
4. Interaction Archive (full searchable history)

### 2.4 Anti-Staleness System
The agent never guesses API signatures. Built-in documentation lookup, dependency awareness, LSP verification, and a live model benchmark dashboard that pulls current rankings from major benchmark providers.

### 2.5 GlassWire-Style Network Monitor
Real-time visibility into every outbound request the agent makes. Color-coded, logged, and auditable. Full transparency as a feature, not an afterthought.

---

## 3. Architecture Overview

### 3.1 Monorepo Structure

```
archon/
├── packages/
│   ├── core/              # Agent loop, pipeline engine, tool execution, OpenRouter client
│   │   ├── src/
│   │   │   ├── agent/     # Agentic loop, message handling, streaming
│   │   │   ├── pipeline/  # Workflow graph engine, node types, execution
│   │   │   ├── tools/     # Tool definitions, execution, tool search
│   │   │   ├── models/    # OpenRouter client, model registry, routing
│   │   │   └── editing/   # File edit strategies, format selection, fallback cascade
│   │   └── package.json
│   ├── memory/            # Memory system, RAG, embeddings
│   │   ├── src/
│   │   │   ├── rules/     # Layer 1: File-scoped rules engine
│   │   │   ├── rag/       # Layer 2: LanceDB + embedding indexer
│   │   │   ├── session/   # Layer 3: Session summaries, confidence decay
│   │   │   └── archive/   # Layer 4: Full interaction archive
│   │   └── package.json
│   └── vscode/            # VS Code extension, webview UI
│       ├── src/
│       │   ├── extension/  # Extension host: activation, providers, commands
│       │   ├── webview/    # React app: chat, pipeline editor, dashboards
│       │   └── lsp/        # LSP tool wrappers
│       └── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### 3.2 Data Flow

```
User Input (Webview)
    ↓ postMessage
Extension Host (Node.js)
    ↓
@archon/core: Pipeline Engine
    ↓ selects workflow
    ↓ executes nodes
    ├── Agent Node → OpenRouter API (streaming)
    ├── Tool Node → VS Code APIs (file, terminal, LSP)
    ├── Decision Gate → AI routing logic
    ├── User Checkpoint → pause, await user input
    └── Verification Node → LSP diagnostics, test runner
    ↓ results
@archon/memory: Persistence
    ├── Session summary → Layer 3
    ├── Interaction log → Layer 4 (LanceDB)
    └── RAG index updates → Layer 2
    ↓ postMessage
Webview (React): Real-time UI updates
```

### 3.3 Extension Host ↔ Webview Communication

All LLM calls, file I/O, and process execution happen in the extension host. The webview (React) is purely UI, communicating via `postMessage` / `onDidReceiveMessage`. This is the standard pattern used by Cline, Continue, and Roo Code.

---

## 4. Visual Workflow System

### 4.1 Node Types

| Node Type | Description | Configurable |
|-----------|-------------|-------------|
| **Agent** | Sends a prompt to an LLM, receives response | Model, system prompt, temperature, tools available |
| **Tool** | Executes a specific tool (read file, run terminal, etc.) | Tool selection, parameters, timeout |
| **Decision Gate** | If/else routing based on previous output | Condition (AI-evaluated or deterministic) |
| **User Checkpoint** | Pauses execution, awaits user input/approval | Prompt text, timeout, auto-approve rules |
| **Loop** | Repeats a sub-graph up to N times or until condition | Max iterations, exit condition |
| **Parallel Split** | Runs multiple branches simultaneously | Branch definitions, merge strategy |
| **Verification** | LSP check, test runner, syntax validation | Verification type, pass/fail routing |
| **Plugin** | Community-developed custom nodes (npm packages) | Plugin-defined configuration |

### 4.2 Orchestrator Agent

The orchestrator is a specialized agent that:
- Analyzes the user's task and selects or generates an appropriate workflow
- Chooses models for each agent node from the user's pre-defined model pool
- Makes conditional routing decisions: "Is this a simple bug or a complex refactor?"
- Can modify the running graph: insert verification steps, reroute on failure, spawn parallel branches
- Reports actions to the user via the pipeline dashboard
- Always yields to user override

### 4.3 Workflow Templates

Pre-built workflows users can start from and customize:
- **Simple Chat** — Basic prompt → agent → response
- **Plan & Execute** — Architect agent → user review → code agent → LSP verify → test
- **TDD** — Write test → write code → run test → fix until pass
- **Code Review** — Read files → analyze → generate review → user checkpoint

Templates are stored as JSON and can be imported/exported.

### 4.4 Plugin Nodes

Community-developed node types distributed as npm packages:
- Defined interface: `ArchonNode` with `execute()`, `configure()`, `validate()`
- Published to npm with an `archon-node-` prefix
- Installed via Archon's settings UI
- Examples: `archon-node-jira`, `archon-node-slack`, `archon-node-docker`

---

## 5. Tool System

### 5.1 Core Built-In Tools

| Tool | Purpose |
|------|---------|
| `read_file` | Read file contents (supports line ranges, images, PDFs) |
| `write_file` | Create new files |
| `edit_file` | SEARCH/REPLACE surgical edits on existing files |
| `search_files` | Regex/text search across codebase |
| `find_files` | Glob pattern file discovery |
| `list_directory` | List directory contents |
| `run_terminal` | Execute shell commands, capture stdout/stderr/exit code |
| `web_search` | Search the web for current information |
| `web_fetch` | Fetch and parse URL content |
| `ask_user` | Ask the user a structured question with options |
| `attempt_completion` | Signal task completion, present result |
| `spawn_agent` | Launch a sub-agent (for orchestrator and pipeline nodes) |
| `tool_search` | Semantic search to discover MCP/extended tools on demand |
| `diff_view` | Show file diffs to user for confirmation |
| `get_diagnostics` | Read VS Code compiler errors and linting issues |
| `lookup_docs` | Look up current API documentation for a library |

### 5.2 LSP Tools

Leverage VS Code's built-in language servers for code intelligence:

| Tool | Purpose |
|------|---------|
| `go_to_definition` | Jump to where a symbol is defined |
| `find_references` | Find all usages of a symbol |
| `get_hover_info` | Get type info and documentation |
| `get_workspace_symbols` | Search for classes/functions/variables by name |
| `get_document_symbols` | Get the outline/structure of a file |
| `get_code_actions` | Get available quick fixes and refactorings |

Implemented via `vscode.commands.executeCommand` — works for any language with a VS Code extension installed.

### 5.3 MCP Extensibility

- Support MCP servers for user-added tools
- Discovered on-demand via semantic tool search (never load all MCP tool definitions into context)
- MCP tools go through the same security gates as built-in tools
- Version pinning and description diffing between sessions (anti-poisoning)

### 5.4 Tool Search

When the agent needs a tool beyond the core set:
- Embed all available tool descriptions (core + MCP) as vectors
- The `tool_search` meta-tool takes a natural language query
- Returns top 3-5 matching tools with full schemas
- Only discovered tools are added to the current context

This keeps the initial tool context at ~5K tokens regardless of how many MCP tools are installed.

---

## 6. Memory System

### 6.1 Layer 1: Rules

File-scoped project conventions loaded into the system prompt.

**Storage:** `.archon/rules/` directory with markdown files.

**Inclusion modes:**
- `always` — injected into every interaction
- `fileMatch: "*.tsx"` — loaded only when working with matching files
- `manual` — available on demand

**Version-controlled:** Committed to git, shareable across team.

### 6.2 Layer 2: Codebase RAG

Local semantic search over the entire project.

**Tech stack:**
- **LanceDB** (~0.26.x) — in-process vector database, no server needed
- **nomic-embed-code** via Ollama — code-specialized embedding model, fully offline
- Falls back to API-based embeddings (OpenAI `text-embedding-3-small`) if Ollama unavailable

**Indexing:**
- Initial full index on first open
- Incremental re-indexing via `vscode.workspace.onDidChangeTextDocument`
- Stored in `.archon/index/` (gitignored)
- Compressed repo map (function/class signatures) generated alongside embeddings

**Search:** The agent calls `search_codebase` with a natural language query. Returns relevant code snippets with file paths and line numbers.

### 6.3 Layer 3: Session Memory

Auto-generated session summaries with intelligent persistence.

**Auto-summarize:** At session end (or when context reaches 70%), generate a structured summary:
- Decisions made and rationale
- Files modified and why
- Patterns discovered
- Next steps / open items

**Confidence-weighted decay:**
- New entries start at confidence 1.0
- Entries confirmed by subsequent sessions gain confidence
- Entries not referenced in 30+ days decay toward 0
- Below 0.2 confidence → archived, no longer auto-injected

**Passive preference learning:**
- Track how users edit AI-generated code
- If a pattern repeats 3+ times (e.g., always converting `forEach` to `for...of`), suggest adding it as a Layer 1 rule

### 6.4 Layer 4: Interaction Archive

Full searchable history of all interactions.

**What's stored:** Every user message, AI response, tool call input, and tool call output — embedded and stored in LanceDB.

**Search:** The agent has a `search_history` tool to query past interactions semantically.

**Staleness handling:** Entries linked to file hashes. When a file changes significantly, related archive entries decay in relevance.

**Privacy:** Opt-in. Users can disable, purge by date range, or exclude specific projects.

---

## 7. Code Editing Strategy

### 7.1 Primary Format: SEARCH/REPLACE

The agent uses an `edit_file` tool with `old_text` and `new_text` parameters. Token-efficient — a 500-line file edit that changes 5 lines costs ~50 tokens of output, not 500+.

For new files, the `write_file` tool writes full content.

### 7.2 Fallback Cascade

When an exact SEARCH match fails:

1. **Exact match** — try as-is
2. **Whitespace normalization** — strip trailing whitespace, normalize tabs/spaces
3. **Levenshtein fuzzy match** — search near expected location, score with edit distance
4. **Re-prompt with context** — tell the agent: "Your search text wasn't found. The actual content near that location is: [excerpt]"
5. **Whole-file fallback** — request the complete file (last resort, expensive)
6. **Human escalation** — report failure with full context

### 7.3 LSP-Verified Edit Loop

After every edit:
1. Check LSP diagnostics — did we introduce new errors?
2. If new errors: feed them back to the agent, auto-retry (1 attempt)
3. If errors persist: report to user with diagnostic details

This catches stale API usage, type mismatches, and missing imports automatically.

### 7.4 VS Code Integration

- All edits via `WorkspaceEdit` API — integrates with VS Code undo/redo
- Show diffs to user before applying (configurable: always show / auto-approve / never show)
- Git checkpoint before each edit batch for rollback

### 7.5 Architect/Editor Split (Pipeline Step)

For complex multi-file tasks:
- An "architect" pipeline node describes changes in natural language
- An "editor" pipeline node produces the actual SEARCH/REPLACE edits
- This is an optional pipeline step, not forced behavior

---

## 8. Anti-Staleness System

### 8.1 Documentation Lookup Tool

A `lookup_docs` tool the agent can call to verify API signatures before writing code. Can use:
- Context7 (MCP-based documentation retrieval)
- Web search for current docs
- Local type stubs from `node_modules` or installed packages

### 8.2 Dependency Awareness

At session start, read dependency versions from:
- `package.json` / `package-lock.json`
- `requirements.txt` / `pyproject.toml`
- `Cargo.toml`, `go.mod`, etc.

Include version summaries in the system prompt so the model knows which major versions it's targeting.

### 8.3 System Prompt Directive

Explicit instruction in the agent's system prompt:
> "Never guess API signatures. If you are uncertain about an API's current parameters, return type, or behavior, use the `lookup_docs` tool to verify before writing code. Your training data may be outdated."

### 8.4 Live Model Benchmark Dashboard

A built-in dashboard that:
- Pulls latest benchmark data from SWE-bench, LMSYS Arena, Aider Leaderboard, Berkeley BFCL
- Shows real-time rankings for coding, tool calling, reasoning, speed
- Filters by what's available on OpenRouter with current pricing
- Highlights new model releases and deprecated models
- Recommends model changes when better options become available

---

## 9. Model Management

### 9.1 OpenRouter Integration

- Primary API: `https://openrouter.ai/api/v1` (OpenAI-compatible)
- SDK: Can use `@openrouter/sdk` (~0.9.x) or `openai` (~6.25.x) with base URL override
- Always stream responses (`stream: true`)
- Model list fetched dynamically from `/api/v1/models` — never hardcoded

### 9.2 Model Selection Levels

1. **Smart defaults + quick switch** — user picks a default model, can switch via dropdown mid-conversation. Cost-per-token displayed for each model.
2. **Per-pipeline-step assignment** — each node in the workflow graph can have a different model.
3. **Orchestrator-driven selection** — the orchestrator agent picks from the user's pre-defined model pool based on sub-task requirements. E.g., use a fast cheap model for simple file reads, an expensive reasoning model for architecture decisions.

### 9.3 Model Pool Configuration

Users define their available model pool:
```json
{
  "models": {
    "architect": "anthropic/claude-opus-4-6",
    "coder": "anthropic/claude-sonnet-4-6",
    "fast": "google/gemini-3-1-flash",
    "free": "qwen/qwen3-coder-480b",
    "reasoning": "deepseek/deepseek-r1"
  }
}
```

The orchestrator selects from this pool. Users can add/remove models anytime.

---

## 10. Security Architecture

### 10.1 Configurable Security Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| **Permissive** | Bypass all approvals. Network monitor runs passively. | Power users who watch the agent work |
| **Standard** (default) | Confirm destructive ops, memory writes, unknown commands | Most developers |
| **Strict** | Whitelist everything, full sandbox, complete audit log | Enterprise, air-gapped, compliance environments |

### 10.2 Non-Negotiable Security (All Levels)

- **SecretStorage** for all API keys — never in `settings.json` or `globalState`
- **Project trust gate** — refuse to load project configs (`.archon/rules/`, MCP configs) before user explicitly approves the repo
- **Memory write review** — never auto-persist AI-generated content to memory without user confirmation (prevents SpAIware-class attacks)

### 10.3 GlassWire-Style Network Monitor

- Real-time panel showing every outbound request the agent makes
- Columns: timestamp, endpoint, method, payload size, status
- Color-coded: green (known API provider), yellow (new/unknown host), red (blocked)
- Persistent log for audit review
- Optional desktop notifications for new/unknown endpoints

### 10.4 Terminal Command Safety

- **Read-only commands** (ls, cat, git status): auto-approve in Permissive/Standard
- **Mutating local** (file writes, npm install): confirm in Standard, auto in Permissive
- **Mutating remote** (git push, npm publish): always confirm except in Permissive
- **Destructive** (rm -rf, git reset --hard): always confirm in all levels, warning in Permissive

### 10.5 MCP Security

- Display raw tool descriptions before installation
- Pin MCP server versions, verify checksums at load
- Diff descriptions between sessions to detect mutations
- No auto-start from project-local configs without explicit approval

### 10.6 Prompt Injection Resilience

- Treat all file content (READMEs, comments, file names) as untrusted
- Sanitize before injecting into context — scan for instruction-like patterns
- Memory entries carry source provenance for anomaly detection

---

## 11. Performance Strategy

### 11.1 Large Codebases

- **Incremental RAG indexing** — index on first open, re-index only changed files
- **Context budgeting** — hard budget per request (e.g., 50K tokens for context). Agent uses tools to find what it needs rather than dumping everything
- **Compressed repo map** — function/class signatures without bodies (~1/10th token cost)
- LanceDB handles millions of vectors efficiently in-process

### 11.2 Long Sessions

- **Adaptive context compression** at 70% capacity — summarize older tool results, collapse repeated patterns
- **Token budget meter** — real-time display on the mission control dashboard
- **Session continuity** — when context exhausted, auto-save summary to Layer 3 memory, offer fresh context with summary loaded
- Layer 4 interaction archive enables searching earlier session content

### 11.3 Streaming & Latency

- Always stream responses from OpenRouter
- **Parallel tool execution** — independent tool calls run simultaneously
- **Worker threads** for heavy operations (indexing, embedding) so UI never freezes
- **Optimistic rendering** — show pipeline steps as "in progress" immediately
- **Cache hot paths** — cache file reads, LSP results, search results within a session

---

## 12. Tech Stack

### 12.1 Verified Dependencies (March 2026)

| Package | Version | Purpose |
|---------|---------|---------|
| TypeScript | 5.x | Primary language (extension host + webview) |
| React | 19.2.x | Webview UI framework |
| Vite | 7.3.x | Webview bundler |
| Zustand | 5.0.x | Webview state management |
| @openrouter/sdk | 0.9.x | OpenRouter API client |
| openai | 6.25.x | Alternative OpenAI-compatible client |
| @lancedb/lancedb | 0.26.x | Vector database (in-process) |
| tree-sitter | 0.25.x | Syntax parsing for verification |
| pnpm | 10.x | Package manager (workspace support) |
| turborepo | 2.8.x | Monorepo build orchestration |

### 12.2 VS Code API

- Engine: `^1.96.0` (or latest stable)
- Key APIs: WebviewViewProvider, Shell Integration, WorkspaceEdit, SecretStorage, FileSystemWatcher, LanguageModelTool

### 12.3 Embedding Model

- **Primary (local):** `nomic-embed-code` via Ollama — code-specialized, Apache-2.0, runs offline
- **Fallback (API):** OpenAI `text-embedding-3-small` via OpenRouter

---

## 13. Implementation Phases

### Phase 1: Foundation
- Monorepo setup (pnpm workspaces + turborepo)
- VS Code extension scaffold with webview provider
- React webview with basic chat UI
- OpenRouter client with model selection and streaming
- Basic agentic loop: prompt → agent → tool calls → response
- Core tools: `read_file`, `write_file`, `edit_file`, `run_terminal`, `search_files`, `find_files`, `list_directory`

### Phase 2: Editing & Verification
- SEARCH/REPLACE edit strategy with full fallback cascade
- LSP tool integration (diagnostics, go-to-definition, etc.)
- LSP-verified edit loop (auto-check after every edit)
- WorkspaceEdit integration with VS Code undo/redo
- Diff view (show before apply)
- Git checkpoint system

### Phase 3: Memory System
- Layer 1: Rules engine with file-scoped loading
- Layer 2: LanceDB + embedding indexer for codebase RAG
- Layer 3: Session memory with auto-summarization
- Layer 4: Interaction archive with search
- Dependency awareness (read package versions into context)
- `lookup_docs` tool

### Phase 4: Visual Workflow System
- Pipeline engine (node graph execution)
- Node types: Agent, Tool, Decision Gate, User Checkpoint, Loop, Parallel, Verification
- Visual graph editor in the webview (React Flow or similar)
- Workflow template system (save/load/share)
- Orchestrator agent
- `spawn_agent` tool
- Per-step model selection

### Phase 5: Security & Monitoring
- Configurable security levels (Permissive/Standard/Strict)
- SecretStorage integration
- Project trust gate
- GlassWire-style network monitor
- Terminal command classification and safety gates
- Memory write review system
- MCP security (version pinning, description diffing)

### Phase 6: Intelligence Layer
- Live model benchmark dashboard
- Anti-staleness system prompt directives
- Conditional AI routing in orchestrator
- Plugin node system
- Tool search (semantic discovery)
- Passive preference learning

### Phase 7: Community & Polish
- Workflow template sharing/export
- Documentation and contributor guides
- VS Code marketplace publishing
- Performance optimization for large codebases
- Accessibility and keyboard navigation

---

## 14. Open Questions

1. **Graph editor library:** React Flow vs. custom canvas vs. another library for the visual workflow editor?
2. **Embedding strategy:** Should we embed with Ollama by default (requires user to install Ollama) or start with API-based embeddings for zero-setup?
3. **License:** Apache-2.0 (permissive, enterprise-friendly) vs. AGPL-3.0 (copyleft, prevents closed-source forks)?
4. **Plugin node distribution:** npm packages vs. VS Code extension marketplace vs. custom registry?
5. **Offline mode:** Should full offline operation (local models via Ollama) be a first-class feature or a community contribution?
6. **Benchmark data sources:** Which benchmark providers should the live dashboard pull from? Need to verify which have public APIs.
7. **Webview framework:** Single webview with tabs vs. multiple webview panels (chat, pipeline, dashboards)?
