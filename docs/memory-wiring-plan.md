# Memory System Wiring — User Control & Observability

## 1. Vision

The Archon memory system has a fully implemented backend — SQLite storage, AST chunking, graph builder, session memory, context manager, auto-summarizer, edit tracker, telemetry — but none of it is connected to the actual LLM call path. The engine exists; the driveshaft is missing.

This plan wires everything together with two guiding principles:

1. **User controllability** — The user decides exactly which context layers are included when they send a message. Not a black box. Every layer has independent read (inject) and write (record) switches.
2. **User observability** — The user can see what memories exist, inspect them, perform CRUD operations, and trace which memories influenced the agent's responses.

### The User Experience We're Building

- A compact **memory indicator** next to the provider/model/pipeline selectors. Hover to see what's active. Click to toggle layers on/off.
- A **context preview** before each send — the user sees estimated tokens per layer and what context will be assembled.
- **Inline memory citations** in agent responses — when the agent uses a session memory or RAG result, the user sees a clickable citation showing the source.
- A dedicated **Memory Dashboard** webview tab for full CRUD management of summaries, preferences, and rules.
- **Progressive auto-compaction** that pauses the agent loop, shows inline status, and tells the agent what was compressed so it can continue seamlessly.

---

## 2. Current State Assessment

### What Works at Runtime
| Component | Status |
|-----------|--------|
| MemoryDatabase (SQLite) | Active — creates `.archon/memory.db` |
| CodebaseIndexer | Active — indexes files into `chunks` table on startup |
| Embeddings | Conditional — generated if OpenRouter API key exists |
| InteractionArchive writes | Active — logs all messages to `interactions` table |
| Rules Engine loading | Active — loads `.archon/rules/*.md` into memory |
| SessionMemory.applyDecay() | Active — runs on startup (but on empty tables) |
| ContextMeter UI | Active — shows conversation token usage |
| getQuickHealth() | Active — feeds meter (conversation tokens only) |

### Three Severed Connections
1. **`assembleContext()` is never called** — The retrieval pipeline (session memory, RAG, graph, rules, deps → LLM prompt) is dead code. `buildSystemPrompt()` assembles only static content.
2. **`setLlmFn()` is never called** — AutoSummarizer and EditTracker can't do LLM work. Session summaries are never created. `sessions` table stays empty.
3. **`GraphBuilder.indexFile()` is never called** — The `symbols` and `edges` tables are permanently empty. Graph queries return nothing.

### Additional Dead Code
- `EditTracker.observe()` — zero callsites, no edit tracking occurs
- `interactionArchive.search()` — archive is write-only, never queried
- `rulesEngine.getRulesForContext()` / `formatRulesForPrompt()` — only called inside `assembleContext()`
- `depAwareness.formatForPrompt()` — only called inside `assembleContext()`
- All auto-summarizer and edit-tracker telemetry metrics — never fire

---

## 3. Memory Layer Control System

### 3.1 Toggle UI — Compact Indicator + Popover

**Location:** Next to the existing provider, model, and pipeline selectors in the chat header area.

**Compact indicator:** A small icon (e.g., brain/memory icon) with a badge showing the count of active inject layers (e.g., "6/8"). Color-coded:
- Green: all layers healthy
- Yellow: some layers disabled or memory model not configured
- Gray: memory system unavailable (native modules failed)

**Hover tooltip:** Quick summary of what's enabled:
```
Memory Layers: 6/8 active
  CLAUDE.md .......... inject ON | record N/A
  Rules .............. inject ON | record N/A
  Session Memory ..... inject ON | record ON
  RAG Code Search .... inject ON | record ON
  Code Graph ......... inject OFF | record ON
  Dependencies ....... inject ON | record N/A
  Archive ............ inject OFF | record ON
  Preferences ........ inject ON | record ON
```

**Click → Popover/Dropdown:** Full toggle controls for each layer:

| Layer | Inject (Read) | Record (Write) | Notes |
|-------|:---:|:---:|-------|
| CLAUDE.md | Toggle | N/A | Read from filesystem, no write control needed |
| Rules | Toggle | N/A | Managed via Rules UI, always loaded |
| Session Memory | Toggle | Toggle | Inject past summaries / Record new summaries |
| RAG Code Search | Toggle | Toggle | Inject retrieved chunks / Index files |
| Code Graph | Toggle | Toggle | Inject graph context / Build graph |
| Dependencies | Toggle | N/A | Read from package files |
| Interaction Archive | Toggle | Toggle | Inject archive search / Record interactions |
| Learned Preferences | Toggle | Toggle | Apply preferences / Track edit patterns |

**Layers with N/A for Record:** These are filesystem-based or derived — there's no "recording" to toggle. They're either loaded or not.

### 3.2 State Persistence

Toggle states persist in VS Code `workspaceState` (per-workspace). When the user changes a toggle, it persists until they change it again. New workspaces start with all layers enabled by default.

### 3.3 Data Flow

```
User types message
    ↓
Toggle states read from workspaceState
    ↓
assembleContext(query, activeFiles, systemPrompt, enabledLayers)
    ↓
For each enabled inject layer:
    ├── CLAUDE.md → load from filesystem
    ├── Rules → rulesEngine.getRulesForContext(activeFiles)
    ├── Session Memory → sessionMemory.formatForPrompt()
    ├── RAG → indexer.search(query) + graphBuilder.expandWithNeighbors()
    ├── Code Graph → graphBuilder.generateStructuralRepoMap()
    ├── Dependencies → depAwareness.formatForPrompt()
    ├── Archive → interactionArchive.search(query)
    └── Preferences → editTracker.getAutoApplyPatterns()
    ↓
Token budget allocation + priority ranking
    ↓
Assembled context → LLM call
```

---

## 4. Context Assembly Pipeline (Read Path)

### 4.1 Wiring assembleContext() into the LLM Call Path

**Modify `assembleContext()` signature** to accept a set of enabled layers:

```typescript
interface LayerConfig {
  claudeMd: boolean;
  rules: boolean;
  sessionMemory: boolean;
  ragSearch: boolean;
  codeGraph: boolean;
  dependencies: boolean;
  archive: boolean;
  preferences: boolean;
}

async assembleContext(
  query: string,
  activeFiles?: string[],
  systemPrompt?: string,
  layers?: LayerConfig,
): Promise<AssembledContext>
```

Each layer section in `assembleContext()` checks its corresponding flag before executing.

**Integration points in chat-view-provider.ts:**

1. **OpenRouter/OpenAI pipeline path** (~line 1591): Before creating the PipelineExecutor, call `assembleContext()` with the user's message and enabled layers. The assembled context becomes the system prompt + injected context.

2. **Claude CLI path** (~line 1429): Same — call `assembleContext()` and merge the result into the system prompt passed to the Claude CLI executor.

### 4.2 Context Preview Before Send

When the user types a message (or on a debounced interval), the extension runs a lightweight version of `assembleContext()` that returns token estimates per layer without doing full retrieval. This feeds a preview tooltip in the chat input area.

**Implementation:** Add `previewContext(query, layers)` method to ContextManager that:
- Estimates tokens per enabled layer (fast: count existing data, don't re-search)
- Returns breakdown: `{ claudeMd: 1200, rules: 800, sessionMemory: 2100, rag: 0, ... }`
- For RAG: show "will search" indicator, not actual results (too expensive on every keystroke)

**UI:** Small expandable section above the chat input (or in the toggle popover) showing:
```
Context preview: ~42K tokens
  CLAUDE.md: 1.2K | Rules: 0.8K | Memory: 2.1K | RAG: ~15K | Graph: 3K | Deps: 0.5K
```

### 4.3 Inline Memory Citations

When the agent's response uses information from session memory or RAG, include inline citations that the user can click to inspect the source.

**Implementation approach:**
1. When assembling context, tag each context item with a citation ID
2. Include citation markers in the system prompt: `[mem:session_abc123]`, `[mem:rag_chunk_42]`
3. Instruct the LLM (in the system prompt) to cite sources using these markers when referencing injected context
4. In the webview, render citations as clickable badges that show the source memory in a tooltip or side panel

**System prompt addition:**
```
When your response draws on information from the injected context below,
cite the source using the provided [mem:ID] markers. This helps the user
trace where information comes from.
```

**Fallback:** If the LLM doesn't cite (some models ignore instructions), the feature degrades gracefully — no citations shown, no harm done.

---

## 5. Memory Write Pipeline

### 5.1 Wiring setLlmFn()

Create a `MemoryLlmProvider` class that wraps the user's configured memory model:

```typescript
class MemoryLlmProvider {
  private provider: 'openrouter' | 'openai' | 'ollama';
  private apiKey?: string;
  private modelId: string;
  private baseUrl?: string;  // For Ollama

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    // Route to configured provider
  }

  toLlmCompletionFn(): LlmCompletionFn {
    return (system, user) => this.complete(system, user);
  }
}
```

**Wiring in chat-view-provider.ts** (after memory system initialization):
```typescript
const memoryLlm = new MemoryLlmProvider(config);
this.autoSummarizer.setLlmFn(memoryLlm.toLlmCompletionFn());
this.editTracker.setLlmFn(memoryLlm.toLlmCompletionFn());
```

**Auto-detection on first run:**
1. Check if OpenRouter API key exists → suggest a cheap model (gemini-2.0-flash, claude-haiku)
2. Check if OpenAI API key exists → suggest gpt-4o-mini
3. Check if Ollama is running (localhost:11434) → suggest a local model
4. If nothing found → show Settings prompt, gracefully degrade (non-LLM features still work)

### 5.2 Wiring GraphBuilder.indexFile()

**During workspace indexing** (in `initializeIndexer()`):
After CodebaseIndexer indexes a file, also call `graphBuilder.indexFile()` on the same file.

```typescript
// In initializeIndexer(), after indexWorkspace completes:
if (this.graphBuilder) {
  for (const filePath of indexedFiles) {
    await this.graphBuilder.indexFile(filePath);
  }
}
```

**On file save** (file watcher):
The existing file watcher at chat-view-provider.ts:239 already triggers on file changes. Add graph re-indexing:

```typescript
this.fileWatcher.onDidChange((uri) => {
  const relPath = vscode.workspace.asRelativePath(uri);
  this.autoSummarizer?.decayForFileChange(relPath);
  this.graphBuilder?.indexFile(uri.fsPath);  // ADD THIS
});
```

### 5.3 Wiring EditTracker.observe()

**When:** After the agent writes/edits a file, and then the user modifies that same file.

**Implementation:**
1. Track which files the agent modified during a turn (already logged via tool calls)
2. On file save (file watcher), check if this file was recently agent-modified
3. If yes, compute diff between agent's version and user's saved version
4. Call `editTracker.observe(filePath, agentContent, userContent)`

```typescript
// Track agent-modified files during tool execution
private agentModifiedFiles = new Map<string, string>(); // path → agent's content

// In tool execution (write_file/edit_file handlers):
this.agentModifiedFiles.set(filePath, newContent);

// In file watcher:
this.fileWatcher.onDidChange((uri) => {
  const relPath = vscode.workspace.asRelativePath(uri);
  const agentVersion = this.agentModifiedFiles.get(relPath);
  if (agentVersion && this.editTracker) {
    const userVersion = fs.readFileSync(uri.fsPath, 'utf-8');
    if (userVersion !== agentVersion) {
      this.editTracker.observe(relPath, agentVersion, userVersion);
      this.agentModifiedFiles.delete(relPath);
    }
  }
});
```

### 5.4 Summarization Triggers

Four triggers, all calling `autoSummarizer.summarizeSession(history)`:

| Trigger | When | How |
|---------|------|-----|
| **Manual** | User clicks "Save Memory" button | New button in chat header or context meter |
| **Context reset** | User clicks "Reset Context" | Already wired but blocked by missing LLM fn |
| **Turn completion** | Agentic loop completes | After final assistant message, before next user input |
| **Auto-compaction** | Context approaching model limit | Triggered by compaction system (Section 6) |

**Record toggle check:** Before summarizing, check if the Session Memory record toggle is ON. If OFF, skip summarization.

---

## 6. Auto-Compaction System

### 6.1 Progressive Strategy

Inspired by Claude Code's approach — multi-stage, not a single threshold:

**Stage 1: Observation Masking (cheap, no LLM)**
- Triggered at ~70% context utilization
- Mask old tool results (keep first/last line, replace middle with `[masked]`)
- Already implemented in `ContextManager.compressHistory()`
- Transparent — no user notification for this stage

**Stage 2: LLM Summarization (costs tokens)**
- Triggered at ~85% context utilization (after Stage 1 wasn't enough)
- Send older conversation blocks to memory model for compression
- Uses `AutoSummarizer.compressMessages()`
- **Pauses the agent loop**
- Shows inline chat message: "Compacting context..."
- On completion, shows stats

**Stage 3: Session Summary + Partial Reset**
- Triggered at ~95% context utilization (after Stage 2 wasn't enough)
- Full session summarization → save to `sessions` table
- Clear oldest conversation history, keep recent turns
- Re-inject all persistent layers (CLAUDE.md, rules, deps)

### 6.2 Agent Loop Pause/Resume

When compaction triggers during an agentic loop:

1. **Pause:** Set a flag that prevents the next LLM call from executing
2. **Compact:** Run the appropriate compaction stage
3. **Inject continuity message:** Prepend to the next LLM call:
   ```
   [SYSTEM NOTE: Context compaction just occurred. The conversation history
   has been compressed to free space. Key preserved context:
   - Current task: [extracted from recent messages]
   - Decisions made this session: [from compressed summary]
   - Files being worked on: [from recent tool calls]
   Continue your current task. Do not repeat completed work.]
   ```
4. **Resume:** Clear the pause flag, continue the agent loop

### 6.3 Inline Chat Messages

**When compaction starts:**
```
--- Context Compaction ---
Compacting context to free up space...
```

**When compaction completes:**
```
--- Compaction Complete ---
Freed: 32K tokens (85K → 53K)
Compressed: 14 tool results, 8 messages
Preserved: Current task context, 3 key decisions
Context utilization: 53%
```

### 6.4 Memory Diff (in Dashboard)

Each compaction event is logged to `memory_metrics` with details:
- Tokens before/after
- Items compressed vs preserved
- Summary of what was kept

The Memory Dashboard shows a compaction history with expandable diffs.

---

## 7. Memory Model Configuration

### 7.1 Settings Panel Addition

Add a "Memory Model" section to the existing Settings webview panel:

**Fields:**
- **Provider:** Dropdown — OpenRouter, OpenAI, Ollama, Custom
- **API Key:** Password field (if provider requires one). Can reuse existing keys.
- **Base URL:** Text field (for Ollama or custom endpoints, default: `http://localhost:11434`)
- **Model:** Dropdown populated based on selected provider
  - OpenRouter: filtered list of cheap/fast models
  - OpenAI: gpt-4o-mini, gpt-3.5-turbo
  - Ollama: auto-detected from running instance
  - Custom: text field for model ID
- **Status indicator:** Green/red dot showing if the memory model is reachable
- **Test button:** "Test Connection" to verify the model responds

### 7.2 Auto-Detection Flow

On extension activation (or when Settings panel opens):
1. Check `globalState` for saved memory model config
2. If none saved:
   a. Check if OpenRouter API key exists → suggest `google/gemini-2.0-flash-001`
   b. Check if OpenAI API key exists → suggest `gpt-4o-mini`
   c. Probe `localhost:11434/api/tags` for Ollama → suggest first available model
   d. If nothing found → show subtle notification: "Configure a memory model in Settings to enable session memory, auto-summarization, and pattern learning"

### 7.3 Graceful Degradation

When no memory model is configured, features degrade gracefully:

| Feature | Without Memory Model | With Memory Model |
|---------|---------------------|-------------------|
| CLAUDE.md injection | Works | Works |
| Rules injection | Works | Works |
| RAG code search | Works | Works |
| Code graph | Works | Works |
| Dependencies | Works | Works |
| Interaction archive recording | Works | Works |
| Session summarization | Disabled | Active |
| Mid-session compression | Falls back to observation masking only | Full LLM compression |
| Edit pattern extraction | Heuristic-only (const/let, forEach/for-of) | Full LLM extraction |
| Auto-compaction Stage 2+ | Disabled (Stage 1 only) | Active |

---

## 8. Memory Management Dashboard

### 8.1 New Webview Tab

A dedicated webview tab (like Settings) accessible from:
- The sidebar icon row (new "Memory" icon)
- The toggle popover ("Manage Memories" link)
- Command palette: "Archon: Open Memory Dashboard"

### 8.2 Dashboard Overview

The landing view shows summary cards:

```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Session Memory  │ │    Preferences   │ │      Rules       │
│                  │ │                  │ │                  │
│   12 summaries   │ │  5 learned       │ │  3 active        │
│   avg conf: 0.7  │ │  2 auto-applied  │ │  1 always-on     │
│   oldest: 2w ago │ │  3 pending       │ │  2 file-match    │
│                  │ │                  │ │                  │
│   [View All →]   │ │   [View All →]   │ │   [View All →]   │
└─────────────────┘ └─────────────────┘ └─────────────────┘

┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Code Index      │ │    Archive       │ │   Health         │
│                  │ │                  │ │                  │
│   847 chunks     │ │  1,234 entries   │ │   Score: 84%     │
│   312 symbols    │ │  3 sessions      │ │   Last compact:  │
│   89 edges       │ │  oldest: 1mo     │ │   2 hours ago    │
│                  │ │                  │ │                  │
│   [View All →]   │ │   [View All →]   │ │   [View All →]   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 8.3 Session Memory Detail View

**List view:** Table of all session summaries sorted by date, showing:
- Date/time
- Confidence score (with visual bar)
- Pinned status (pin icon)
- Summary preview (first decision)
- File count modified

**Actions per summary:**
- **Expand** — Full view of decisions, patterns, files modified, open items
- **Edit** — Inline editing of any field (decisions, patterns, open items)
- **Pin/Unpin** — Toggle pin (pinned summaries never decay)
- **Boost/Reduce confidence** — Manual slider or +/- buttons
- **Delete** — Remove with confirmation

**Bulk actions:**
- Select multiple → Delete selected
- "Clean up" — Remove all summaries below confidence threshold

### 8.4 Learned Preferences Detail View

**List view:** Table showing:
- Pattern name/description
- Confidence score
- Occurrences count
- Auto-applied status (toggle)
- Category (code_style, naming, error_handling, etc.)

**Actions per preference:**
- **Edit** — Modify the pattern description
- **Toggle auto-apply** — Enable/disable automatic application
- **Promote to rule** — Creates a `.archon/rules/` file from this preference
- **Delete** — Remove with confirmation

### 8.5 Rules Detail View

**List view:** Table showing:
- Rule name (filename)
- Mode (always / manual / fileMatch)
- File match pattern (if applicable)
- Content preview

**Actions:**
- **Create new** — Form: name, mode dropdown, file match pattern, markdown content editor
- **Edit** — Full markdown editor for rule content + mode/match settings
- **Delete** — Remove the rule file with confirmation

**Promote from preference:** Button or drag action that:
1. Takes a learned preference
2. Opens the "Create rule" form pre-filled with the preference description as content
3. User edits/confirms
4. Creates `.archon/rules/{name}.md` with proper frontmatter

---

## 9. Implementation Phases

### Phase 1: Memory Model Configuration + LLM Wiring (Foundation)
**Dependencies:** None
**What:**
- Build `MemoryLlmProvider` class
- Add Memory Model section to Settings panel UI
- Wire `setLlmFn()` for AutoSummarizer and EditTracker
- Implement auto-detection logic
- Test: verify summarization works end-to-end with a configured model

**Why first:** Everything LLM-dependent (summarization, compression, pattern extraction) is blocked until this works.

### Phase 2: Context Assembly Pipeline (Core Read Path)
**Dependencies:** None (can parallel with Phase 1)
**What:**
- Add `LayerConfig` to `assembleContext()` signature
- Wire `assembleContext()` into both execution paths (CLI + API)
- Replace static `buildSystemPrompt()` with assembled context
- Ensure CLAUDE.md, rules, deps still inject correctly
- Test: verify context assembly produces correct prompts

**Why second:** This is the core "read" path — making the LLM actually see memory data.

### Phase 3: Toggle UI + State Persistence
**Dependencies:** Phase 2
**What:**
- Build compact indicator component (icon + badge)
- Build toggle popover with read/write switches per layer
- Wire toggle state to `assembleContext()` calls
- Persist toggle state in VS Code workspaceState
- Test: toggling layers on/off changes what the LLM sees

### Phase 4: Graph Builder + Write Path Wiring
**Dependencies:** Phase 1
**What:**
- Wire `GraphBuilder.indexFile()` into workspace indexing
- Wire `GraphBuilder.indexFile()` into file watcher
- Wire `EditTracker.observe()` into file watcher (agent-modified file tracking)
- Wire summarization triggers (manual, context reset, turn completion)
- Test: verify graph populates, edit tracking fires, summaries are created

### Phase 5: Auto-Compaction System
**Dependencies:** Phase 1, Phase 2
**What:**
- Implement progressive compaction (Stage 1 → 2 → 3)
- Agent loop pause/resume mechanism
- Continuity message injection post-compaction
- Inline chat messages for compaction events
- Compaction stats display
- Test: verify compaction fires at thresholds, agent resumes correctly

### Phase 6: Memory Management Dashboard
**Dependencies:** Phase 4 (needs data in tables)
**What:**
- New webview tab registration + sidebar icon
- Dashboard overview with summary cards
- Session Memory detail view with full CRUD
- Learned Preferences detail view with CRUD + promote
- postMessage protocol for all CRUD operations
- Test: verify CRUD operations affect SQLite correctly

### Phase 7: Rules Management UI
**Dependencies:** Phase 6 (part of dashboard)
**What:**
- Rules detail view in dashboard
- Create/edit/delete rule forms
- Markdown editor for rule content
- Preference-to-rule promotion flow
- Test: verify rule files created/modified/deleted on filesystem

### Phase 8: Context Preview + Inline Citations
**Dependencies:** Phase 2, Phase 3
**What:**
- `previewContext()` method in ContextManager
- Preview UI in chat input area
- Citation ID tagging in assembled context
- System prompt citation instructions
- Citation rendering in webview (clickable badges)
- Memory diff on compaction (dashboard integration)
- Test: verify preview updates, citations render when LLM cites

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Memory model API costs add up | User gets unexpected bills from summarization calls | Show estimated cost per operation. Default to cheapest model. Let user set a monthly token budget for memory ops. |
| Compaction loses important context | Agent forgets critical decisions mid-task | Continuity message injection. Pin mechanism for critical memories. Always re-inject CLAUDE.md and rules. |
| Toggle complexity overwhelms users | Users ignore memory system entirely | Good defaults (all ON). Auto-detection removes setup friction. Compact indicator is non-intrusive. |
| Graph indexing slows extension | Large repos make startup slow | Index in background worker thread. Show progress. Skip node_modules/dist. Allow user to disable graph recording. |
| Claude CLI path has different prompt format | Memory injection breaks CLI execution | Test thoroughly with Claude CLI. May need to inject context differently (as user message prefix vs system prompt). |
| Native SQLite modules fail on some platforms | Memory system completely unavailable | Existing graceful degradation. Clear messaging in UI. Consider pure-JS SQLite fallback. |
| LLM citations unreliable | Some models ignore citation instructions | Graceful degradation — no citations shown, no errors. Track citation accuracy in telemetry. |
| Session summaries accumulate indefinitely | Dashboard becomes unwieldy, storage grows | Intelligent forgetting already implemented. Add "Clean up" bulk action. Show storage usage in dashboard. |

---

## 11. Open Questions

1. **Token budget for memory model ops:** Should there be a configurable limit on how many tokens the memory model can consume per day/session for summarization and compression?
2. **Archive search integration:** Should the interaction archive be searchable from the Memory Dashboard, or is it purely background data?
3. **Multi-workspace memory:** Should session summaries from one workspace be visible (read-only) in another workspace's dashboard for cross-project reference?
4. **Embedding provider for memory model:** Should the memory model provider also handle embeddings, or keep embeddings on the separate OpenRouter/API path?
