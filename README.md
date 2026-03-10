# Archon

**Model-agnostic AI coding extension for VS Code** with visual workflow orchestration, semantic memory, and multi-provider LLM support.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/JohnnyCode-ai.archon)](https://marketplace.visualstudio.com/items?itemName=JohnnyCode-ai.archon)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Archon is an open-source AI coding assistant that runs inside VS Code. It connects to multiple LLM providers, executes tools autonomously (file editing, terminal commands, web search, LSP queries), remembers context across sessions through a 6-layer semantic memory system, and supports visual pipeline orchestration for complex multi-step workflows.

## Features

### Multi-Provider LLM Support

Connect to any of three providers — or switch between them mid-conversation:

- **OpenRouter** — Access 200+ models with automatic routing and cost tracking
- **OpenAI** — API key or OAuth (ChatGPT subscription) authentication
- **Claude CLI** — Native Claude Code integration with session resumption

### Agentic Tool Use

Archon ships with 22 built-in tools that the AI can invoke autonomously:

| Tool | Description |
|------|-------------|
| `read_file` | Read files with optional line ranges |
| `write_file` | Create or overwrite files |
| `edit_file` | SEARCH/REPLACE with 3-level fallback (exact, whitespace-normalized, fuzzy) |
| `search_files` | Regex search across the workspace |
| `find_files` | Glob-based file discovery |
| `list_directory` | Directory listing with file sizes |
| `run_terminal` | Shell command execution with stdout/stderr capture |
| `ask_user` | Prompt with markdown, clickable options, or multi-select |
| `attempt_completion` | Signal task completion |
| `web_search` | Brave Search API integration |
| `web_fetch` | HTTP GET with redirect following |
| `lookup_docs` | Documentation search |
| `search_codebase` | Semantic search using the memory system |
| `search_history` | Query past interactions |
| `spawn_agent` | Launch parallel sub-agents |
| `diff_view` | Show unified diffs before applying edits |
| `tool_search` | MCP tool discovery and introspection |
| `todo_write` | Task tracking with status management |
| Pipeline tools | `create_pipeline`, `edit_pipeline`, `list_pipelines`, `delete_pipeline` |

### Four-Tier Security

Control what the AI can do without confirmation:

| Level | Behavior |
|-------|----------|
| **Yolo** | Auto-approve everything |
| **Permissive** | Auto-approve most; confirm destructive commands (`rm -rf`, `git reset --hard`, etc.) |
| **Standard** (default) | Auto-approve reads; confirm writes and commands |
| **Strict** | Confirm everything |

Security is enforced by the `SecurityManager`, which classifies every command into categories: `readonly`, `mutating_local`, `mutating_remote`, or `destructive`.

### Semantic Memory System

A 6-layer memory architecture backed by SQLite (`better-sqlite3` + `sqlite-vec`) that persists across sessions:

| Layer | Component | Purpose |
|-------|-----------|---------|
| 1 | Rules Engine | File-scoped project conventions |
| 2 | AST Chunker + Graph Builder | Code knowledge graph — 11-language tree-sitter parsing, symbol extraction, dependency edges |
| 3 | Codebase Indexer | Semantic RAG with RRF hybrid search (embedding + keyword) |
| 4 | Session Memory | LLM-powered summaries with confidence decay and forgetting cycles |
| 5 | Interaction Archive | Full searchable history of past conversations |
| 6 | Context Manager | Token budgeting, relevance scoring, observation masking |

The memory system uses an independent LLM provider (auto-detected: OpenRouter → OpenAI → Ollama) for summarization and pattern learning.

### Visual Pipeline Editor

Build multi-step workflows with a drag-and-drop node editor. Eight node types:

- **Agent** — LLM reasoning with configurable model, tools, and system prompt
- **Tool** — Direct tool execution with parameters
- **Decision Gate** — Route flow based on conditions (deterministic or AI-evaluated)
- **User Checkpoint** — Pause and wait for user input
- **Loop** — Iterate with exit conditions
- **Parallel** — Branch into concurrent execution paths
- **Verification** — Quality gates (LSP diagnostics, test runner, syntax check)
- **Plugin** — Custom extensibility

### MCP (Model Context Protocol) Support

Connect to external MCP servers for additional tools, resources, and prompts:

- **Transports**: stdio (subprocess) and HTTP (streamable)
- **Tool adapter**: MCP tools integrate into the agent loop with full security gating
- **Resource adapter**: MCP resources exposed as readable tools
- **Prompt adapter**: MCP prompts injected as context
- **Configuration**: Per-project (`.archon/mcp.json`) or global (`~/.archon/mcp.json`)

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["server.js"],
      "env": { "API_KEY": "..." },
      "alwaysAllow": ["tool1"],
      "timeout": 30000
    }
  }
}
```

### Skills System

Create reusable, user-defined agents from markdown templates:

- Auto-generate skills from chat conversations
- Version management with rollback support
- Global or project scope
- Trigger patterns for automatic invocation

### Hooks Engine

Event-driven automation with composable hook chains:

- Pre/post tool execution hooks
- Variable stores with template resolution
- LLM evaluation nodes for dynamic decisions
- Script execution and conditional branching

### Additional Features

- **Git checkpoints** — Automatic commits before edit batches for safe rollback
- **Diff view** — Side-by-side preview before applying file changes
- **File attachments** — Send images, PDFs, and files in chat
- **Code block actions** — Copy buttons on AI-generated code blocks
- **Context meter** — Real-time token usage bar with compression controls
- **Network monitor** — Request log color-coded by status and threat level
- **Benchmark dashboard** — Model comparisons from LiveCodeBench, LMSYS, and more
- **Memory dashboard** — CRUD for sessions, preferences, and rules with health metrics

## Installation

### From the Marketplace

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for **"Archon"**
4. Click **Install**

Or install directly: [Archon on VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JohnnyCode-ai.archon)

### From Source

```bash
git clone https://github.com/newtro/ArchonVsCodeExt.git
cd ArchonVsCodeExt
pnpm install
pnpm build
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Getting Started

1. Open the Archon panel from the activity bar (or `Ctrl+Shift+A`)
2. Configure your LLM provider in Settings:
   - **OpenRouter**: Enter your API key
   - **OpenAI**: Enter your API key or sign in with OAuth
   - **Claude CLI**: Detected automatically if installed
3. Select a model and start chatting
4. The AI can read, edit, and create files, run terminal commands, search the web, and more — all within your configured security level

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` (`Cmd+Shift+A` on Mac) | Focus Archon chat |
| `Ctrl+Shift+N` (`Cmd+Shift+N` on Mac) | New chat (when panel is visible) |

## Project Structure

Archon is a monorepo with three packages:

```
packages/
├── core/       # Agent loop, tools, pipeline engine, providers, MCP, security
├── memory/     # SQLite storage, AST chunking, graph builder, RAG, session memory
└── vscode/     # Extension host, React webview, UI components
```

- **Build system**: Turborepo + pnpm workspaces
- **Output format**: CommonJS (required by VS Code extension host)
- **TypeScript**: Strict mode, ES2022 target

### Build Commands

```bash
pnpm build          # Build all packages (core → memory → vscode)
pnpm dev            # Watch mode for development
pnpm clean          # Remove build artifacts
```

## Configuration

### VS Code Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `archon.securityLevel` | `standard` | Security level for approvals (`yolo`, `permissive`, `standard`, `strict`) |
| `archon.enableInteractionArchive` | `true` | Enable semantic search of past conversations |
| `archon.diffViewMode` | `auto` | When to show diff views (`always`, `auto`, `never`) |
| `archon.gitCheckpoints` | `true` | Create git commits before edit batches |

### File Locations

| Path | Purpose |
|------|---------|
| `.archon/memory.db` | Project memory database |
| `.archon/mcp.json` | Project MCP server config |
| `.archon/pipelines/` | Project pipeline definitions |
| `~/.archon/mcp.json` | Global MCP server config |
| `~/.archon/pipelines/` | Global pipeline definitions |

## Requirements

- VS Code 1.96.0 or later
- Node.js (for building from source)
- An API key for at least one LLM provider (OpenRouter, OpenAI, or Claude CLI installed)

## License

[MIT](LICENSE)
