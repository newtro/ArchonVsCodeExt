# Claude Code CLI Provider — Implementation Plan

## Vision

Add Claude Code CLI as a first-class LLM provider in the Archon VS Code extension, enabling users to leverage their Claude Pro/Max subscription ($20-$200/mo for unlimited usage) through the official `claude` CLI. This is ToS-compliant because the CLI is Anthropic's own tool — unlike extracting OAuth tokens or using the Agent SDK with subscription auth, which Anthropic explicitly banned in February 2026.

## Problem Statement

1. **Cost**: OpenRouter API billing for Claude models ($3/$15 per million tokens for Sonnet) makes intensive usage expensive. Pro/Max subscribers already pay for unlimited Claude access.
2. **Terms of Service**: Anthropic prohibits using subscription OAuth tokens in third-party tools. The only compliant way to access subscription models programmatically is through the official Claude Code CLI.
3. **Tool Quality**: Claude Code's built-in tools (Read, Edit, Bash, Grep, Glob) are battle-tested and actively maintained by Anthropic. Leveraging them gives users a more reliable experience for file operations and terminal commands.
4. **Single Provider Lock-in**: The current architecture is tightly coupled to `OpenRouterClient` with no provider abstraction, making it impossible to support alternative LLM backends.

## Architecture

### Two-Executor Pattern with Shared Event Interface

The two providers have fundamentally different execution models:
- **OpenRouter**: Our extension controls the agent loop, tool definitions, and tool execution. OpenRouter is purely an LLM API.
- **Claude CLI**: Claude Code runs its own agent loop with its own tools. Our extension observes and renders.

Rather than forcing a leaky abstraction, we use **two distinct execution paths** that emit a **common event interface** for the UI:

```
ChatViewProvider (UI Layer)
    ↓ common ExecutionEvent stream
    ├── OpenRouterExecutor
    │   └── AgentLoop + CoreTools + OpenRouterClient
    └── ClaudeCliExecutor
        └── Subprocess spawn + NDJSON parser + Event mapper
```

### Common Event Interface

Both executors emit these event types:

```typescript
type ExecutionEvent =
  | { type: 'text'; content: string; partial?: boolean }
  | { type: 'tool_start'; tool: string; input: Record<string, unknown>; id: string }
  | { type: 'tool_result'; id: string; output: string; isError?: boolean }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'complete'; sessionId?: string; usage?: TokenUsage }
  | { type: 'thinking'; content: string };
```

The UI layer consumes this stream identically regardless of which executor is running.

## Provider System

### Provider Registration

```typescript
interface LLMProvider {
  id: string;                    // 'openrouter' | 'claude-cli'
  name: string;                  // Display name
  isAvailable(): Promise<boolean>;  // Can this provider be used?
  getModels(): Promise<ModelInfo[]>;
  createExecutor(config: ExecutorConfig): Executor;
}

interface Executor {
  run(message: string, history: ChatMessage[]): AsyncGenerator<ExecutionEvent>;
  abort(): void;
}
```

### Provider Manager

A `ProviderManager` class handles:
- Registering providers
- Checking availability (is `claude` in PATH? is OpenRouter API key set?)
- Switching active provider
- Persisting provider preference in VS Code global state

### UI Integration

- **Global default**: Settings page has a provider dropdown (Claude CLI / OpenRouter)
- **In-chat override**: Provider selector widget in the chat input area
  - Selecting a provider filters the model dropdown to that provider's models
  - Claude CLI: shows opus, sonnet, haiku
  - OpenRouter: shows full model list from API
  - Override is session-scoped — reverts to global default on new chat
- **Pipeline nodes**: Each node can optionally specify a provider override

## Claude CLI Executor

### Subprocess Management

Spawn `claude` as a child process with these flags:

```bash
claude -p "<user_message>" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --model <selected_model> \
  --add-dir <workspace_path>
```

For follow-up messages in the same session:

```bash
claude -p "<follow_up_message>" \
  --resume <session_id> \
  --output-format stream-json \
  --verbose \
  --include-partial-messages
```

### NDJSON Stream Parsing

Each line from stdout is a JSON object. Key message types to handle:

| Stream Event Type | Maps To |
|---|---|
| `content_block_delta` + `text_delta` | `ExecutionEvent.text` |
| `content_block_start` + `tool_use` | `ExecutionEvent.tool_start` |
| `content_block_delta` + `input_json_delta` | Accumulate tool input |
| `content_block_stop` (after tool) | Tool call assembled |
| `message_stop` | Turn complete |
| AssistantMessage (non-stream) | Full turn with tool results |
| ResultMessage | `ExecutionEvent.complete` |

### Event Mapping

The ClaudeCliExecutor parses NDJSON lines and maps them to `ExecutionEvent`s:

1. **Text streaming**: `stream_event` with `content_block_delta` + `text_delta` → emit `{ type: 'text', content: delta.text, partial: true }`
2. **Tool start**: `stream_event` with `content_block_start` + `tool_use` content block → emit `{ type: 'tool_start', tool: name, input: {}, id: toolUseId }`
3. **Tool input accumulation**: `input_json_delta` events → accumulate partial JSON for the tool input
4. **Tool results**: AssistantMessage contains complete tool results → emit `{ type: 'tool_result', id, output }`
5. **Completion**: ResultMessage → emit `{ type: 'complete', sessionId }`

### Process Lifecycle

- Spawn with `child_process.spawn` (not exec — we need streaming stdout)
- On Windows: use `CREATE_NEW_PROCESS_GROUP` for clean process tree management
- Pipe stdout line-by-line, parse each JSON line
- stderr → log for debugging, surface errors to UI
- Handle process exit codes: 0 = success, non-zero = error
- `abort()` → send SIGTERM to process group, then SIGKILL after timeout

## Session Management

- **New chat**: Fresh `claude -p` invocation. Extract `session_id` from the output JSON.
- **Follow-up in same chat**: `claude -p --resume <session_id>` with the new message.
- **Store mapping**: Each Archon chat session stores the associated Claude CLI session ID.
- **Cross-provider limitation**: Sessions started with one provider cannot be resumed with the other. This is expected and should be communicated in the UI if the user tries to switch providers mid-session.

## Permission Mapping

Map Archon's security levels to Claude Code CLI flags:

| Archon Level | Claude Code Flags | Behavior |
|---|---|---|
| **Green (Strict)** | `--permission-mode plan` | Read-only tools auto-approved, writes need confirmation |
| **Yellow (Balanced)** | `--dangerously-skip-permissions` | Full autonomy — Claude Code handles everything |
| **Red (Locked)** | `--allowedTools "Read,Glob,Grep,Bash(git status *),Bash(git log *),Bash(git diff *)"` | Only safe read operations |

## UI Changes

### Chat Input Area

Add a provider selector (dropdown or segmented control) next to the existing model selector:

```
[Claude CLI ▾] [claude-sonnet-4-6 ▾] [Send]
```

When provider changes:
1. Filter model dropdown to that provider's models
2. Store as session-level override
3. If switching mid-session, warn that history won't carry over

### Tool Display

Parse Claude Code's tool events and render them using our existing tool result components:
- File reads → collapsible panel with syntax-highlighted content
- File edits → diff view component
- Terminal commands → terminal output panel
- Search results → grouped file matches

This ensures the Claude CLI experience looks native to our extension.

### Settings Page

New section: "LLM Providers"
- Default provider: dropdown (Claude CLI / OpenRouter)
- Claude CLI section:
  - Status indicator (detected / not found / not authenticated)
  - Path override (optional, defaults to PATH lookup)
  - Setup guide link
- OpenRouter section:
  - API key input (existing)
  - Model list refresh button (existing)

## MCP Server Passthrough

When using the Claude CLI provider, forward configured MCP servers via `--mcp-config`:

1. Collect MCP server configurations from our extension settings
2. Generate a temporary JSON config file in the expected format
3. Pass to Claude CLI: `--mcp-config /tmp/archon-mcp-config.json`
4. This gives Claude Code access to any MCP tools configured in our extension

This is powerful because it extends Claude Code's capabilities with the user's custom MCP tools (databases, APIs, specialized tools) without the user having to configure them separately in Claude Code.

## Error Handling

### Error Types

1. **CLI not found**: Provider disabled, show setup guide
2. **Not authenticated**: Show "Run `claude auth login`" message with terminal button
3. **Process crash**: Show error in chat, offer retry button
4. **Rate limiting**: Show rate limit message, offer "Switch to OpenRouter" if available
5. **Timeout**: Configurable timeout (default: none for long-running tasks), show warning after extended silence

### Fallback Flow

When an error occurs with Claude CLI:
1. Display the error message in the chat UI
2. Show a "Retry" button
3. If OpenRouter is configured (API key exists), also show "Switch to OpenRouter" button
4. If user switches, start a fresh session with OpenRouter (cannot resume CLI session)

## CLI Detection and Setup

### On Extension Activation

1. Run `claude --version` to check if CLI is in PATH
2. If found, run `claude auth status` (returns JSON with auth state)
3. Cache the result; re-check periodically or on provider switch

### Setup Guide (shown when CLI not detected or not authenticated)

Display an inline guide in the settings or chat panel:
1. Install: `npm install -g @anthropic-ai/claude-code`
2. Authenticate: `claude auth login`
3. Verify: Extension auto-detects after install

## Implementation Phases

### Phase 1: Provider Abstraction (Foundation)
- Define `LLMProvider` and `Executor` interfaces
- Define `ExecutionEvent` types
- Refactor `OpenRouterClient` → `OpenRouterExecutor` implementing the new interface
- Refactor `ChatViewProvider` to use the executor abstraction instead of direct `OpenRouterClient` calls
- Refactor `PipelineExecutor` to use the provider abstraction
- Ensure existing functionality is preserved (no behavior changes)

### Phase 2: Claude CLI Executor (Core)
- Implement `ClaudeCliProvider` (availability check, model listing)
- Implement `ClaudeCliExecutor` (subprocess spawn, NDJSON parsing, event mapping)
- Handle process lifecycle (spawn, abort, cleanup)
- Session ID tracking and `--resume` support
- Permission level → CLI flag mapping

### Phase 3: UI Integration
- Provider selector in chat input area
- Model list filtering by provider
- Provider settings section
- CLI detection and setup guide
- Session-scoped provider override

### Phase 4: Tool Display + MCP Passthrough
- Map Claude Code tool events to our existing tool UI components
- MCP config generation and `--mcp-config` passthrough
- Error handling with retry and fallback UI

### Phase 5: Pipeline Integration
- Per-node provider override in pipeline editor
- Provider-aware model pool resolution
- Cross-provider pipeline execution
