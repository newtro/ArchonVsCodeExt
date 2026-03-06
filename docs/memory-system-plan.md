# Archon Memory & Context Management System

## 1. Vision & Goals

Build a memory and context management system that leapfrogs every AI coding tool on the market. Where Cursor indexes files and Claude Code compresses context, Archon will **understand your codebase structurally**, **remember across sessions intelligently**, **never lose context during long sessions**, and **get smarter the more you use it**.

### The Four Magic Moments

1. **"It already knows"** — The agent remembers decisions, patterns, and conventions from weeks ago without being told. It feels like a teammate who was there the whole time.
2. **"It understands the whole repo"** — Ask about any part of the codebase and it knows the relationships — who calls what, how data flows, why that pattern exists.
3. **"It never loses context"** — Even on hour-long sessions with 50+ tool calls, it stays sharp. No forgetting earlier decisions, no repeating mistakes.
4. **"It gets smarter over time"** — The more you use it, the better it gets. It learns your style, anticipates your preferences, and proactively surfaces relevant history.

### Success Metrics (built-in from day one)

- **Retrieval quality**: Recall@K for code search, relevance scores for context items
- **Context utilization**: % of context window that's actually relevant (context health score)
- **Memory hit rates**: How often session/archive memory contributes to successful completions
- **User override frequency**: How often users correct the agent's memory-informed behavior
- **Token efficiency**: Tokens used vs. task complexity compared to no-memory baseline

---

## 2. Architecture Overview

The memory system evolves from 4 layers to **6 layers** plus a **Context Manager** that orchestrates them:

```
┌─────────────────────────────────────────────────────┐
│                  Context Manager                     │
│  (token budgeting, tiered compression, health score) │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│ Layer 1  │ Layer 2  │ Layer 3  │ Layer 4  │ Layer 5 │
│  Rules   │  Code    │ Codebase │ Session  │ Inter-  │
│ Engine   │  Graph   │  RAG     │ Memory   │ action  │
│          │  (NEW)   │          │          │ Archive │
├──────────┴──────────┴──────────┴──────────┴─────────┤
│              Unified SQLite Storage                  │
│        (better-sqlite3 + sqlite-vec)                 │
├─────────────────────────────────────────────────────┤
│          Tree-sitter WASM + LSP Validation           │
│              (AST Parsing Layer)                     │
└─────────────────────────────────────────────────────┘
```

### Data Flow

```
File Change Event (VS Code watcher)
    ↓
Tree-sitter WASM Parser (worker thread)
    ├── AST → Code Graph update (symbols, edges)
    ├── AST → Semantic Chunks → Embedding → RAG index
    └── Hash comparison → Intelligent Forgetting (decay stale memories)
    ↓
SQLite Storage (single .archon/memory.db file)

Agent Request (needs context)
    ↓
Context Manager
    ├── Rules Engine → always-on + file-matched rules
    ├── Code Graph → structural context (callers, callees, types)
    ├── RAG Search → semantic code search (BM25 + vector hybrid)
    ├── Session Memory → relevant past decisions + patterns
    └── Archive Search → historical interactions
    ↓
Token Budget Allocation
    ├── Priority ranking of all retrieved context
    ├── Compression of lower-priority items
    └── Context Health Score computation
    ↓
Assembled Context → LLM
```

---

## 3. Storage Backend

### Decision: SQLite Unified

**Package**: `better-sqlite3` v12.6.2 + `sqlite-vec` v0.1.7-alpha

Single file: `.archon/memory.db` per project (gitignored).

> **Note on sqlite-vec**: Currently alpha (v0.1.7-alpha.2). If stability issues arise, fall back to storing embeddings as BLOB columns in SQLite and performing vector search in JavaScript (the current binary Float32 approach, but over SQLite BLOBs instead of flat files). This is a low-risk fallback because the cosine similarity computation is already implemented in the codebase.

### Schema Overview

```sql
-- Layer 1: Rules (metadata only — content stays in .archon/rules/*.md)
CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  mode TEXT NOT NULL,  -- 'always' | 'manual' | 'fileMatch'
  file_match TEXT,
  content_hash TEXT,
  last_loaded INTEGER
);

-- Layer 2: Code Graph
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,  -- 'function' | 'class' | 'method' | 'interface' | 'variable' | 'type' | 'import'
  start_line INTEGER,
  end_line INTEGER,
  signature TEXT,      -- e.g., "async function fetchUser(id: string): Promise<User>"
  file_hash TEXT,
  UNIQUE(file_path, name, kind, start_line)
);

CREATE TABLE edges (
  source_id INTEGER REFERENCES symbols(id),
  target_id INTEGER REFERENCES symbols(id),
  kind TEXT NOT NULL,  -- 'calls' | 'imports' | 'extends' | 'implements' | 'uses_type' | 'tests'
  PRIMARY KEY (source_id, target_id, kind)
);

-- Layer 3: RAG Chunks
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  content TEXT NOT NULL,
  language TEXT,
  content_hash TEXT,
  symbol_id INTEGER REFERENCES symbols(id),  -- links chunk to its parent symbol
  embedding BLOB  -- Float32 vector via sqlite-vec, or raw BLOB for JS-side search
);

-- Layer 4: Session Memory
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  decisions TEXT,         -- JSON array
  files_modified TEXT,    -- JSON array of {path, reason}
  patterns_discovered TEXT, -- JSON array
  open_items TEXT,        -- JSON array
  confidence REAL DEFAULT 1.0,
  last_referenced INTEGER,
  summary_embedding BLOB
);

-- Layer 5: Interaction Archive
CREATE TABLE interactions (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,  -- 'user_message' | 'assistant_message' | 'tool_call' | 'tool_result'
  content TEXT NOT NULL,
  metadata TEXT,       -- JSON
  relevance REAL DEFAULT 1.0,
  embedding BLOB
);

-- Autonomous Learning
CREATE TABLE preferences (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  description TEXT,
  occurrences INTEGER DEFAULT 1,
  first_seen INTEGER,
  last_seen INTEGER,
  auto_applied INTEGER DEFAULT 0,  -- boolean: has been promoted to auto-apply
  confidence REAL DEFAULT 0.5
);

-- Telemetry
CREATE TABLE memory_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER,
  event_type TEXT,  -- 'retrieval' | 'compression' | 'forgetting' | 'learning'
  details TEXT      -- JSON with metric-specific data
);

-- Indexes
CREATE INDEX idx_symbols_file ON symbols(file_path);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_chunks_file ON chunks(file_path);
CREATE INDEX idx_interactions_timestamp ON interactions(timestamp);
CREATE INDEX idx_sessions_confidence ON sessions(confidence);
```

### Why Not LanceDB

LanceDB has known issues with VS Code extension bundling via esbuild — native bindings resolve incorrectly (`nativeBinding` becomes a string instead of a module object). better-sqlite3 is battle-tested in VS Code extensions and provides a synchronous API ideal for extension host work.

---

## 4. Layer 1: Rules Engine (Upgrade)

### Current State
Working basics — loads `.archon/rules/*.md`, parses frontmatter, file-match globbing.

### Upgrades
1. **Auto-suggest rules from learned patterns**: When the autonomous learning system detects a repeated pattern (3+ occurrences), prompt: *"I noticed you always convert forEach to for...of. Add this as a project rule?"*
2. **Rule effectiveness tracking**: Track which rules are in context when tasks succeed vs. fail. Surface underperforming rules.
3. **SQLite metadata**: Store rule metadata in the database for fast querying; content stays in markdown files for version control.

---

## 5. Layer 2: Code Knowledge Graph (NEW)

This is the biggest new addition — a structural understanding of the entire codebase.

### What Gets Indexed

For every file, tree-sitter parses the AST and extracts:

| Node Type | Examples |
|-----------|----------|
| **Symbols** | functions, classes, methods, interfaces, types, variables, exports |
| **Call edges** | `functionA()` calls `functionB()` |
| **Import edges** | `import { X } from './module'` |
| **Inheritance edges** | `class B extends A`, `class C implements I` |
| **Type usage edges** | `function f(x: SomeType)` uses `SomeType` |
| **Test edges** | `describe('ModuleName')` tests `ModuleName` |

### Graph Queries (via SQL recursive CTEs)

```sql
-- "Who calls this function?" (1 level)
SELECT s2.* FROM edges e
JOIN symbols s2 ON e.source_id = s2.id
WHERE e.target_id = ? AND e.kind = 'calls';

-- "Full call chain to this function" (recursive)
WITH RECURSIVE callers AS (
  SELECT source_id, 1 as depth FROM edges WHERE target_id = ? AND kind = 'calls'
  UNION ALL
  SELECT e.source_id, c.depth + 1 FROM edges e
  JOIN callers c ON e.target_id = c.source_id
  WHERE e.kind = 'calls' AND c.depth < 5
)
SELECT DISTINCT s.* FROM callers c JOIN symbols s ON c.source_id = s.id;

-- "What does this module depend on?" (imports)
SELECT s2.* FROM edges e
JOIN symbols s ON e.source_id = s.id
JOIN symbols s2 ON e.target_id = s2.id
WHERE s.file_path = ? AND e.kind = 'imports';
```

### How Graph Enhances RAG

When RAG retrieves code chunks, the graph **expands** results:
1. RAG returns top-K chunks for a query
2. For each chunk, look up its parent symbol in the graph
3. Pull in 1-hop neighbors: callers, callees, type definitions, related tests
4. De-duplicate and rank expanded results
5. This gives the agent not just "relevant code" but "relevant code in context"

### Incremental Updates

- File watcher triggers re-parse on save
- Tree-sitter re-parses only changed files
- Old symbols/edges for that file are deleted, new ones inserted
- Graph is always consistent with current code

---

## 6. Layer 3: Codebase RAG (Major Upgrade)

### AST-Aware Chunking

Replace the current fixed 50-line sliding window with **semantic chunking**:

1. **Tree-sitter parses the file** into an AST
2. **Top-level symbols become chunks**: each function, class, method, interface is one chunk
3. **Large symbols are recursively split**: if a function exceeds the chunk size limit (e.g., 100 lines), split at inner block boundaries (if/else, loops, nested functions)
4. **Small siblings are merged**: consecutive small declarations (type aliases, constants, single-line functions) are merged into a single chunk up to the size limit
5. **Chunks retain context**: each chunk includes a header with file path, parent class/namespace, and import context

This follows the **cAST** approach (EMNLP 2025) which showed +4.3 Recall@5 and +2.67 Pass@1 improvements over line-based chunking.

### Hybrid Search (Upgraded)

Current: BM25 (0.4) + vector (0.6) with simple normalization.

Upgraded:
1. **Reciprocal Rank Fusion (RRF)** instead of linear score combination — more robust to score distribution differences
2. **Graph-expanded results** — after initial retrieval, expand with structurally related code
3. **Recency boost** — recently modified files get a small score boost (files changed in the last session are more likely relevant)
4. **File-scope boost** — if the user has files open in the editor, chunks from those files get priority

### Embedding Strategy

- **Provider**: API-first via OpenRouter (user's existing key)
- **Model**: `text-embedding-3-small` (1536 dims) as default, configurable
- **Batching**: Embed in batches of 20, with retry and graceful degradation to BM25-only
- **Caching**: Embeddings stored in SQLite, only re-embed when chunk content hash changes
- **Fallback chain**: API embeddings → Ollama (if available) → BM25-only

### Compressed Repo Map (Upgraded)

Current: Simple first-line extraction.

Upgraded: Use the Code Graph to generate a **structural repo map**:
```
# Repository Structure

## src/agent/agent-loop.ts
  class AgentLoop
    async run(messages): Promise<AgentResult>
    private executeToolCall(call): Promise<ToolResult>
    → calls: ToolExecutor.execute, OpenRouterClient.chat
    → uses: AgentMessage, ToolCall, AgentConfig

## src/tools/tool-executor.ts
  class ToolExecutor
    async execute(name, args): Promise<ToolResult>
    → calls: ReadFileTool.execute, WriteFileTool.execute, ...
    → called by: AgentLoop.executeToolCall
```

This gives the LLM a global architectural view with call relationships, not just flat signatures.

---

## 7. Layer 4: Session Memory (Major Upgrade)

### Auto-Summarization

At **session end** (or when context hits 70% capacity), the Context Manager triggers summarization:

1. Collect the full conversation and tool call history for the session
2. Send to the user's configured memory model with a structured prompt:
   ```
   Summarize this coding session. Extract:
   - Key decisions made and their rationale
   - Files modified and why
   - Patterns discovered in the codebase
   - Open items / incomplete work
   - User preferences observed (coding style, tool usage, etc.)
   ```
3. Store the structured summary in the `sessions` table with confidence 1.0
4. Embed the summary text for semantic search

### Confidence Decay + Intelligent Forgetting

The current decay system (30-day linear) is upgraded to **intelligent forgetting**:

1. **Time-based decay**: Unreferenced memories lose 0.05 confidence per week (slower than current)
2. **Contradiction detection**: When a new session's decisions contradict an older memory, the older memory's confidence drops by 0.3 immediately
3. **File-linked decay**: When files referenced in a memory are significantly changed (>50% diff), the memory's confidence drops by 0.2
4. **Reinforcement**: When the agent retrieves and uses a memory successfully (no user correction), confidence boosts by 0.1
5. **Auto-archive threshold**: Below 0.15 confidence → moved to archive, no longer auto-injected
6. **Auto-purge threshold**: Below 0.05 confidence for 60+ days → deleted entirely

### Mid-Session Compression

When context reaches **70% of the token budget**:
1. Identify the oldest tool results and assistant messages
2. Send them to the memory model: *"Compress these interactions into a concise summary, preserving key decisions and facts"*
3. Replace the original messages with the compressed summary
4. Log the compression event for telemetry

This is the MemGPT-inspired "paging" — information moves from working memory to compressed short-term memory, freeing space for new work.

---

## 8. Layer 5: Interaction Archive (Upgrade)

### Search Upgrade

Replace current substring matching with **hybrid BM25 + vector search**:
- Reuse the same BM25 implementation from the RAG layer
- Embed archive entries using the same embedding provider
- Apply relevance decay as a score multiplier (not a filter)

### Semantic Relevance Decay

Current: Fixed -0.2 decay per file change.

Upgraded:
- Compute **semantic similarity** between the changed code and archive entries
- High similarity = higher decay (the information is directly stale)
- Low similarity = minimal decay (tangentially related, may still be useful)
- This prevents over-eager purging of still-relevant historical context

### Storage Optimization

- Only embed the most recent 1000 interactions (configurable)
- Older interactions are text-searchable only (BM25)
- Batch embedding generation during idle time

---

## 9. Context Manager (NEW — Core Innovation)

The Context Manager is the orchestrator that sits above all memory layers. It's responsible for **assembling the right context** for each LLM call.

### Tiered Memory Architecture

Inspired by MemGPT's virtual context management:

| Tier | Content | Lifetime | Format |
|------|---------|----------|--------|
| **Working** | Current turn: user message, active tool results, in-progress reasoning | Single turn | Verbatim |
| **Short-term** | Recent conversation history (last 5-10 turns) | Current session | Verbatim → compressed when space is needed |
| **Long-term** | Session summaries, learned preferences, archived decisions | Cross-session | Compressed summaries, retrieved on demand |
| **Structural** | Rules, dependency info, repo map, code graph context | Always available | Injected per configuration |

### Token Budget Allocation

Each LLM call has a **fixed token budget** (configurable, default: 80% of model's context window). The Context Manager allocates it:

```
Token Budget (e.g., 100K tokens for a 128K model)
├── System prompt + Rules       : ~5K  (fixed)
├── Dependency info              : ~1K  (fixed)
├── Repo map (compressed)        : ~3K  (fixed, adaptive for large repos)
├── Retrieved code context       : ~15K (adaptive — more for complex tasks)
├── Session memory summaries     : ~3K  (top-N by relevance)
├── Conversation history         : ~50K (compressed progressively)
├── Current turn                 : ~20K (reserved for user message + tool results)
└── Response headroom            : ~3K  (reserved for model output)
```

Allocations are **adaptive**: when the task is code-heavy, retrieved context gets more budget. When it's conversational, history gets more.

### Context Health Score

A novel metric displayed in the UI:

```
Health = (relevant_tokens / total_tokens) * retrieval_confidence
```

Where:
- `relevant_tokens`: tokens from context items that score above a relevance threshold for the current query
- `total_tokens`: total tokens in context
- `retrieval_confidence`: average similarity score of retrieved items

**Interpretation:**
- 90%+ health: Context is highly focused and relevant
- 60-90%: Good, normal working state
- Below 60%: Context is cluttered — suggest refreshing (start new session with summary carryover)

The health score triggers **automatic actions**:
- Below 50%: Compress older conversation history
- Below 30%: Purge low-relevance context items, re-retrieve fresh context
- Below 20%: Suggest session reset with summary carryover

---

## 10. Context Meter UI

Progressive disclosure pattern integrated into the chat interface:

### Compact Meter (always visible)
- Small bar/ring next to the chat input showing context utilization %
- Color-coded: green (< 50%), yellow (50-75%), orange (75-90%), red (> 90%)
- Health score badge: small indicator of context quality

### Hover Details
On hover, show a tooltip breakdown:
```
Context: 72K / 100K tokens (72%)
Health: 84%

  Rules & Config     4.2K  ████░░░░░░
  Code Context      14.8K  ████████░░
  Session Memory     2.1K  █░░░░░░░░░
  Conversation      48.3K  ████████████████████
  Reserved           2.6K  █░░░░░░░░░
```

### Expanded Modal (click to open)
Full memory dashboard with tabs:
1. **Budget View**: Detailed token allocation with ability to adjust priorities
2. **Memory Timeline**: Chronological view of session summaries, preferences, with confidence scores and ability to pin/delete/edit
3. **Memory Health**: Metrics over time — hit rates, compression events, forgetting events
4. **Active Context**: What's currently loaded, with relevance scores. Click to inspect any item.

---

## 11. Autonomous Learning System

### Pattern Detection Pipeline

1. **Observation**: Track every user edit to AI-generated code (diff between AI output and what user keeps)
2. **Extraction**: After 3+ similar edits, use the memory model to extract the pattern:
   *"The user consistently changes `Array.forEach` to `for...of` loops"*
3. **Storage**: Save as a preference with confidence based on consistency
4. **Application**: When confidence > 0.8, automatically apply the pattern to future AI output
5. **Dashboard**: All learned preferences visible and editable in the memory modal

### What Gets Learned

| Category | Example |
|----------|---------|
| **Code style** | Prefers `const` over `let`, uses trailing commas, puts types on separate lines |
| **Naming** | Uses camelCase for functions, PascalCase for types, prefixes interfaces with `I` |
| **Error handling** | Always wraps async calls in try/catch, prefers early returns |
| **Architecture** | Prefers dependency injection, separates interfaces from implementations |
| **Tool usage** | Prefers `edit_file` over `write_file` for modifications, always runs tests after edits |

### Memory Dashboard Integration

The expanded modal includes a "Learned Preferences" section:
- List of all detected patterns with confidence scores
- Toggle: auto-apply on/off per pattern
- Edit: modify the extracted pattern description
- Promote: convert a preference to a Layer 1 rule (creates the `.archon/rules/*.md` file)
- Delete: remove a false positive

---

## 12. Telemetry & Metrics

Built-in measurement system, all local (no data leaves the machine):

### Tracked Metrics

| Metric | What It Measures | How |
|--------|------------------|-----|
| **Retrieval Recall@K** | Are we finding the right code? | Compare retrieved chunks to files actually used in tool calls |
| **Context Health** | Is the context relevant? | Health score computation per request |
| **Memory Hit Rate** | Does session memory help? | Track when session memories are retrieved and not overridden |
| **Compression Quality** | Does compression preserve key info? | Compare pre/post compression, check if agent asks for info that was compressed away |
| **Forgetting Accuracy** | Are we forgetting the right things? | Track if purged memories are ever re-asked for |
| **Learning Accuracy** | Are learned preferences correct? | Track user override rate on auto-applied preferences |
| **Token Efficiency** | Cost vs. capability | Tokens per successful task completion |

### Storage

All metrics go to the `memory_metrics` table in SQLite. Aggregated for display in the Memory Health tab of the context modal.

---

## 13. Tech Stack

### Verified Dependencies (March 2026)

| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `better-sqlite3` | 12.6.2 | SQLite database (all memory storage) | Stable, released Jan 2026 |
| `sqlite-vec` | 0.1.7-alpha.2 | Vector search extension for SQLite | Alpha — fallback to JS-side cosine search if unstable |
| `web-tree-sitter` | 0.26.6 | WASM-based AST parsing | Stable, released Mar 2026 |
| `@vscode/tree-sitter-wasm` | — | VS Code-specific tree-sitter WASM bindings | Alternative to web-tree-sitter, evaluate during implementation |
| `tree-sitter-typescript` | — | TypeScript grammar for tree-sitter | Needed per language |
| `tree-sitter-javascript` | — | JavaScript grammar | Needed per language |
| `tree-sitter-python` | — | Python grammar | Needed per language |

### Embedding Models (via OpenRouter API)

| Model | Dimensions | Use Case |
|-------|-----------|----------|
| `text-embedding-3-small` | 1536 | Default — good balance of quality and cost |
| `text-embedding-3-large` | 3072 | Optional upgrade for larger codebases |
| `nomic-embed-text` (Ollama) | 768 | Optional local fallback |

### Memory Operations Model

User-configurable. Recommendations in settings:
- **Budget**: `google/gemini-2.0-flash` or `anthropic/claude-haiku-4-5` — fast, cheap, good at summarization
- **Quality**: `anthropic/claude-sonnet-4-6` — better pattern extraction, higher cost

---

## 14. Implementation Phases

### Phase A: Storage Migration (Foundation)
**Dependencies**: None
**Effort**: Medium

1. Add `better-sqlite3` and `sqlite-vec` dependencies
2. Create `MemoryDatabase` class that manages the unified `.archon/memory.db`
3. Define schema (all tables from Section 3)
4. Migrate existing JSON/Map-based storage to SQLite
5. Update `CodebaseIndexer` to read/write from SQLite instead of JSON + binary files
6. Update `SessionMemory` and `InteractionArchive` to use SQLite
7. Verify all existing functionality works with new storage

### Phase B: AST-Aware Chunking
**Dependencies**: Phase A
**Effort**: High

1. Add `web-tree-sitter` with TypeScript, JavaScript, Python grammars
2. Build `ASTChunker` that parses files and produces semantic chunks
3. Handle the chunk-splitting algorithm: top-level symbols → recursive split for large → merge small siblings
4. Add chunk-to-symbol linking (each chunk knows its parent symbol)
5. Replace the fixed 50-line chunker in `CodebaseIndexer`
6. Re-index produces significantly better chunks
7. Add more language grammars incrementally (Rust, Go, Java, C#, etc.)

### Phase C: Code Knowledge Graph
**Dependencies**: Phase B (needs tree-sitter)
**Effort**: High

1. Build `GraphBuilder` that extracts symbols and edges from AST
2. Handle cross-file resolution: imports → find target file → link symbols
3. Store in `symbols` and `edges` tables
4. Build graph query utilities (callers, callees, dependency chain)
5. Integrate with RAG: graph-expanded retrieval
6. Generate structural repo map from graph
7. Incremental graph updates on file change

### Phase D: Context Manager
**Dependencies**: Phase A
**Effort**: High

1. Build `ContextManager` class with token budget allocation
2. Implement tiered memory assembly (working, short-term, long-term, structural)
3. Add context health score computation
4. Implement progressive compression (70% threshold triggers LLM summarization)
5. Add configurable memory model setting
6. Integrate with agent loop — Context Manager assembles system prompt + context for each LLM call

### Phase E: Auto-Summarization & Intelligent Forgetting
**Dependencies**: Phase D (needs Context Manager and memory model)
**Effort**: Medium

1. Implement session-end summarization (LLM generates structured summary)
2. Implement mid-session compression (progressive summarization at 70%)
3. Build intelligent forgetting system (contradiction detection, file-linked decay, semantic relevance decay)
4. Add reinforcement (boost confidence on successful memory use)
5. Auto-archive and auto-purge thresholds

### Phase F: Context Meter UI
**Dependencies**: Phase D (needs Context Manager)
**Effort**: Medium

1. Add compact context meter component to chat input area
2. Implement hover tooltip with token breakdown
3. Build expanded modal with tabs (Budget, Timeline, Health, Active Context)
4. Wire real-time updates from Context Manager to UI via postMessage
5. Add interactive controls (pin/delete/edit memories, adjust budget priorities)

### Phase G: Autonomous Learning System
**Dependencies**: Phase E (needs working memory system)
**Effort**: Medium

1. Build edit-tracking pipeline (diff AI output vs. user's final version)
2. Pattern extraction via memory model
3. Preference storage and confidence tracking
4. Auto-application of high-confidence preferences
5. Dashboard UI in the context modal (list, toggle, edit, promote, delete)

### Phase H: Telemetry & Optimization
**Dependencies**: All previous phases
**Effort**: Low-Medium

1. Instrument all memory operations with metric events
2. Build aggregation queries for the Memory Health dashboard tab
3. Add retrieval quality measurement (compare retrieved to actually-used)
4. Performance optimization based on real telemetry data

---

## 15. Non-Goals & Future Work

### Explicitly Out of Scope (v1)

- **Multi-user/team memory** — no shared knowledge across developers
- **Cross-project memory** — each project has isolated memory
- **Real-time collaboration** — no sync between Archon instances
- **Offline-first operation** — graceful degradation yes, but not a design priority
- **Plugin memory providers** — single SQLite backend, no pluggable storage

### Future Phases (post v1)

- **Memory Replay**: DVR for coding sessions — replay decision points with reasoning chains
- **Predictive Context Loading**: Pre-load context based on file-open patterns and workflow graphs
- **Code Archaeology**: Reconstruct evolutionary history by combining git blame + session memory + archive
- **Semantic Diff Memory**: Track and understand code changes semantically across sessions
- **Pattern DNA**: Automatic codebase style profiles that go beyond explicit rules
- **Context Recipes**: Saved context configurations for common task types
- **Cross-project learning**: Transfer common patterns (not code) between projects
- **Team memory**: Shared knowledge graphs for team codebases

---

## Research Sources

- [MemGPT/Letta](https://www.letta.com/) — Virtual context management, tiered memory, self-editing memory tools
- [Mem0](https://mem0.ai/) — Hybrid graph+vector+KV memory, auto-extraction, 91% latency reduction ([paper](https://arxiv.org/abs/2504.19413))
- [cAST: AST-aware code chunking](https://arxiv.org/abs/2506.15655) — Structural chunking via AST, +4.3 Recall@5, EMNLP 2025
- [Code-Graph-RAG](https://github.com/vitali87/code-graph-rag) — Graph-based codebase understanding with tree-sitter
- [Cursor Codebase Indexing](https://docs.cursor.com/context/codebase-indexing) — Background indexing, semantic chunks, PR history
- [JetBrains Context Management Research](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) — Cutting through noise for LLM agents
- [Context Engineering Toolkit](https://github.com/jstilb/context-engineering-toolkit) — Compression, prioritization, benchmarking
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — Vector search SQLite extension
- [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter) — WASM-based tree-sitter bindings
