# Implementation Plan: MCP Integration
*Based on: [docs/research/mcp-integration-context-optimization.md](../research/mcp-integration-context-optimization.md)*
*Generated: 2026-03-09*

## Overview

Archon will integrate full MCP (Model Context Protocol) support — tools, resources, and prompts — enabling users to connect any MCP-compliant server and use its capabilities within the agent loop. The implementation uses deferred tool loading with semantic search (via existing sqlite-vec) to prevent context bloat (the #1 risk, where 5+ servers can consume 27%+ of the context window). Configuration follows the ecosystem-standard `mcpServers` format with both global and project-level scoping. Security integrates with Archon's existing 4-tier SecurityManager rather than creating a new trust system. A full management UI with LLM-assisted server installation rounds out the experience.

## Scope

### In Scope
- MCP client with stdio and Streamable HTTP transports
- Tool, resource, and prompt adapters bridging MCP → Archon's `ToolDefinition` interface
- Global + project-level config (`mcpServers` format)
- Server lifecycle management (spawn, connect, reconnect, restart, shutdown)
- Deferred tool loading with client-side semantic search (sqlite-vec)
- `tool_search` meta-tool for on-demand tool discovery
- Full management UI in settings panel (server list, status, toggles, restart, tool list)
- LLM-assisted server installation (agent reads repo README → configures server)
- ContextMeter extension showing MCP token consumption
- Security via existing SecurityManager tiers (yolo/permissive/standard/strict)

### Out of Scope
- MCP server hosting (Archon is a client only)
- Tool profiles / server grouping by task context (future enhancement)
- Response filtering / MCP+ pattern (future enhancement)
- Cloudflare-style meta-tool code generation (future enhancement)
- One-click install from arbitrary URLs (security risk per research)
- MCP spec v2 features (not yet public)
- Sandboxed server execution (requires OS-level containment; deferred until security tier usage data informs priority)

## Key Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | MCP feature scope | Tools + Resources + Prompts | Complete implementation — all three MCP primitives |
| 2 | Transports | stdio + Streamable HTTP | Both from day one for local and remote servers |
| 3 | Context optimization | Deferred loading + semantic search | 85% token reduction using existing sqlite-vec [source 11] |
| 4 | Config format | Global + project-level | `mcpServers` format, project config in `.archon/mcp.json` |
| 5 | Security model | Existing SecurityManager tiers | yolo/permissive/standard/strict — no new trust system |
| 6 | Server installation | Manual + UI wizard + LLM-assisted | Agent reads repo docs to auto-configure; safer than one-click |
| 7 | Settings UI | Full management panel | Status indicators, toggles, restart, tool list per server |
| 8 | Token display | Extend ContextMeter | MCP Tools category in existing token breakdown |
| 9 | Phasing approach | Comprehensive end-to-end | Full implementation across all phases |

## Architecture

### High-Level Component Map

```
packages/core/src/mcp/
├── mcp-client-manager.ts    # Manages MCP client instances (connect/disconnect/restart)
├── mcp-transport.ts         # Transport factory (stdio + Streamable HTTP)
├── mcp-tool-adapter.ts      # Bridges MCP tools → ToolDefinition
├── mcp-resource-adapter.ts  # Bridges MCP resources → ToolDefinition (read_resource tool)
├── mcp-prompt-adapter.ts    # Bridges MCP prompts → ToolDefinition (get_prompt tool)
├── mcp-config.ts            # Config loading, merging (global + project)
├── mcp-registry.ts          # Deferred tool registry + semantic search
└── mcp-types.ts             # Shared types

packages/vscode/src/webview/components/
├── McpSettingsPanel.tsx      # Server management UI
├── McpServerForm.tsx         # Add/edit server form
└── McpToolList.tsx           # Per-server tool/resource/prompt list

packages/vscode/src/extension/
└── mcp-extension-host.ts    # Extension-side MCP lifecycle + file watchers
```

### Data Flow

1. **Config loading**: Extension reads global config + project `.archon/mcp.json` → merges → passes to `McpClientManager`
2. **Server connection**: `McpClientManager` creates transport (stdio or HTTP) → connects `Client` → calls `listTools()`, `listResources()`, `listPrompts()`
3. **Tool registration**: Adapters convert MCP tools/resources/prompts → `ToolDefinition[]` → registered with `defer_loading: true` in `McpRegistry`
4. **Agent loop**: Core tools always loaded + `tool_search` meta-tool. Model calls `tool_search` → `McpRegistry` performs semantic search → returns matching tool definitions → model calls discovered tool → adapter delegates to `client.callTool()`
5. **Security**: Before tool execution, `SecurityManager.checkCommand()` is consulted based on current tier. In `standard` mode, MCP tool calls are treated as `mutating_remote` (require confirmation). In `yolo` mode, auto-approved.

### Naming Convention

MCP tools are namespaced: `mcp_{serverName}_{toolName}` (e.g., `mcp_filesystem_read_file`). This avoids collisions with Archon's core tools and makes the source clear in logs/UI.

---

## Phase 1: MCP Client & Adapter Foundation

**Estimated scope:** Large
**Prerequisites:** None — greenfield implementation
**Goal:** Connect to MCP servers and bridge their tools/resources/prompts into Archon's tool system

### Steps

1. **Install SDK dependency**
   - Add `@modelcontextprotocol/sdk` (v1.x) and `zod` to `packages/core/package.json`
   - Verify CJS compatibility with `"moduleResolution": "Node10"` — SDK uses `.js` import extensions that may need path mapping

2. **Create `packages/core/src/mcp/mcp-types.ts`**
   - Define `McpServerConfig` interface matching the `mcpServers` format:
     ```typescript
     interface McpServerConfig {
       command?: string;        // stdio
       args?: string[];         // stdio
       env?: Record<string, string>;  // stdio
       url?: string;            // HTTP
       headers?: Record<string, string>;  // HTTP
       disabled?: boolean;
       alwaysAllow?: string[];  // per-tool auto-approve (bypass security confirmation)
       alwaysLoad?: string[];   // per-tool always-loaded (bypass deferred loading)
       timeout?: number;        // connection timeout in ms (default 30000)
     }
     ```
   - Define `McpServerState` (status enum: `connecting`, `connected`, `disconnected`, `error`)
   - Define `McpToolEntry` (tool definition + server name + deferred flag + token estimate)

3. **Create `packages/core/src/mcp/mcp-transport.ts`**
   - Factory function `createTransport(config: McpServerConfig)`:
     - If `command` present → `StdioClientTransport` with `{ command, args, env }`
     - If `url` present → `StreamableHTTPClientTransport` with URL + headers
     - For HTTP: attempt POST first, fall back to SSE GET for deprecated servers [source 4]
   - Handle `spawn` errors gracefully (command not found, permission denied)
   - Implement timeout with user feedback (emit "connecting..." status)

4. **Create `packages/core/src/mcp/mcp-client-manager.ts`**
   - `McpClientManager` class:
     - `connect(name: string, config: McpServerConfig): Promise<void>` — create transport, connect client, call `listTools()`/`listResources()`/`listPrompts()`
     - `disconnect(name: string): Promise<void>` — close client, kill subprocess
     - `restart(name: string): Promise<void>` — disconnect + reconnect
     - `getStatus(name: string): McpServerState`
     - `getTools(name: string): McpTool[]`
     - `getResources(name: string): McpResource[]`
     - `getPrompts(name: string): McpPrompt[]`
     - `callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<CallToolResult>`
     - `readResource(serverName: string, uri: string): Promise<ReadResourceResult>`
     - `getPrompt(serverName: string, promptName: string, args: Record<string, string>): Promise<GetPromptResult>`
   - EventEmitter pattern for status changes (UI subscribes)
   - Auto-reconnect on unexpected disconnect (max 3 retries with backoff)

5. **Create `packages/core/src/mcp/mcp-tool-adapter.ts`**
   - `mcpToolToArchonTool(tool: McpTool, serverName: string, client: Client, security: SecurityManager): ToolDefinition`
   - Map `inputSchema` → `ToolDefinition.parameters`
   - `execute` function:
     1. Classify MCP tool call via `SecurityManager` — default classification: `mutating_remote` (MCP tools can do anything). Override: stdio servers marked "local-only" → `mutating_local`
     2. Check approval based on current security tier (yolo=auto, standard=confirm first use, strict=confirm always)
     3. If approved, delegate to `client.callTool({ name, arguments })`
   - Format `CallToolResult` content (text, image, embedded resource) → string output
   - Handle tool execution errors (timeout, server crash) with clear error messages
   - **Note:** This ensures security is active from day one — no phase ships MCP tool execution without SecurityManager gating

6. **Create `packages/core/src/mcp/mcp-resource-adapter.ts`**
   - Create one `read_mcp_resource` tool per server (avoids tool count explosion, consistent with deferred loading strategy)
   - The tool accepts a `uri` parameter; calling it without a URI lists available resources
   - Resources with `mimeType` handling (text vs binary)

7. **Create `packages/core/src/mcp/mcp-prompt-adapter.ts`**
   - Create a `get_mcp_prompt` tool per server that lists and retrieves prompts
   - Map prompt arguments to tool parameters
   - Return prompt messages as formatted text

8. **Wire into tool registry**
   - Extend `packages/core/src/tools/tool-registry.ts` to accept MCP tools
   - Add `createMcpTools(manager: McpClientManager): ToolDefinition[]` function
   - MCP tools returned with a `deferred: true` metadata flag (used in Phase 3)

### Deliverables
- Can connect to any stdio or HTTP MCP server programmatically
- MCP tools/resources/prompts appear as `ToolDefinition` objects
- Agent can call MCP tools through the standard tool execution path

### Verification
- Unit test: connect to `@modelcontextprotocol/server-everything` (test server), list tools, call a tool
- Unit test: stdio transport spawns and communicates correctly
- Unit test: HTTP transport connects and handles SSE fallback
- Integration test: MCP tool appears in agent loop tool list and can be called

---

## Phase 2: Configuration System & Server Lifecycle

**Estimated scope:** Medium
**Prerequisites:** Phase 1 (client manager exists)
**Goal:** Users can configure MCP servers via config files, with proper lifecycle management

### Steps

1. **Create `packages/core/src/mcp/mcp-config.ts`**
   - `loadGlobalConfig(): Record<string, McpServerConfig>` — reads from Archon's global config location
   - `loadProjectConfig(workspacePath: string): Record<string, McpServerConfig>` — reads `.archon/mcp.json`
   - `mergeConfigs(global, project): Record<string, McpServerConfig>` — project overrides global for same server name
   - `saveGlobalConfig(servers: Record<string, McpServerConfig>): void`
   - `saveProjectConfig(workspacePath: string, servers: Record<string, McpServerConfig>): void`
   - Config file watcher: reload on external changes
   - Validate config on load (required fields, valid URLs, command existence check)

2. **Define config file locations**
   - Global: `~/.archon/mcp.json` (or VS Code globalStorageUri)
   - Project: `{workspaceRoot}/.archon/mcp.json`
   - Format:
     ```json
     {
       "mcpServers": {
         "filesystem": {
           "command": "npx",
           "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
           "timeout": 30000
         },
         "remote-api": {
           "url": "https://api.example.com/mcp",
           "headers": { "Authorization": "Bearer ..." }
         }
       }
     }
     ```

3. **Server lifecycle in extension host**
   - Create `packages/vscode/src/extension/mcp-extension-host.ts`
   - On extension activation: load config → connect all enabled servers
   - On config change: diff → connect new servers, disconnect removed, restart changed
   - On extension deactivation: disconnect all servers, kill subprocesses
   - Handle workspace folder changes (reload project config)

4. **Environment variable resolution**
   - Support `${env:VAR_NAME}` syntax in config values (especially for API keys)
   - Support `${workspaceFolder}` for project-relative paths
   - Warn if referenced env vars are missing

5. **Timeout and slow-start handling**
   - Configurable timeout per server (default 30s, research notes `npx` servers can be slow [source 26])
   - Show "Connecting to [server]..." status during startup
   - Don't silently drop slow servers — show error state with retry option

### Deliverables
- MCP servers auto-connect on extension startup based on config files
- Global and project configs merge correctly
- Config changes trigger live server reconnection
- Slow/failing servers show clear status, not silent failure

### Verification
- Test: create config file → extension loads and connects server
- Test: edit config → server restarts with new settings
- Test: project config overrides global config for same server name
- Test: invalid config shows validation errors
- Test: slow server shows timeout error, not silent drop

---

## Phase 3: Deferred Loading & Semantic Search

**Estimated scope:** Large
**Prerequisites:** Phase 1 (tool adapter), Phase 2 (config), existing sqlite-vec infrastructure
**Goal:** MCP tools are deferred by default, discovered on-demand via semantic search, keeping context lean

### Steps

1. **Create `packages/core/src/mcp/mcp-registry.ts`**
   - `McpRegistry` class:
     - `registerTools(serverName: string, tools: ToolDefinition[]): void` — store with deferred flag
     - `getAlwaysLoadedTools(): ToolDefinition[]` — core Archon tools (never deferred)
     - `getDeferredTools(): McpToolEntry[]` — all MCP tools (deferred by default)
     - `searchTools(query: string, limit?: number): ToolDefinition[]` — semantic search, returns top-N
     - `getToolCount(): { loaded: number, deferred: number, total: number }`
     - `estimateTokenUsage(): { loaded: number, deferred: number, saved: number }`

2. **Embed tool definitions for semantic search**
   - On tool registration, compute embedding for: `name + " " + description + " " + parameterDescriptions`
   - Store in sqlite-vec (reuse existing `MemoryDatabase` infrastructure or create `mcp_tool_embeddings` table)
   - Use the same embedding provider as memory system (`MemoryLlmProvider`)
   - Fallback: if no embedding model available, use BM25 keyword search on tool name + description

3. **Create `tool_search` meta-tool**
   - A `ToolDefinition` that is ALWAYS loaded (never deferred):
     ```typescript
     {
       name: "tool_search",
       description: "Search for available MCP tools by describing what you need. Returns matching tool definitions that you can then call.",
       parameters: {
         type: "object",
         properties: {
           query: { type: "string", description: "Natural language description of the tool capability you need" },
           limit: { type: "number", description: "Max results to return (default 5)" }
         },
         required: ["query"]
       },
       execute: async (args) => {
         const results = registry.searchTools(args.query, args.limit || 5);
         return formatToolSearchResults(results);
       }
     }
     ```
   - Format results to include tool name, description, and parameter schema so the model can call the tool directly
   - Include server name in results for disambiguation

4. **Modify agent loop tool injection**
   - In `packages/core/src/agent/` (agent loop), change tool list construction:
     - Maintain a session-level `activatedTools: Set<ToolDefinition>` that persists across turns within a session
     - On each agent turn, the tool list sent to the LLM is: `coreTools + tool_search + activatedTools`
     - When model calls `tool_search` → `McpRegistry` returns matching `ToolDefinition` objects → these are added to `activatedTools`
     - On subsequent turns, activated tools remain available without re-searching
     - `activatedTools` is cleared on session reset or when the user starts a new conversation
     - This ensures discovered tools are callable in the same turn AND in follow-up turns without repeated search overhead

5. **Token estimation**
   - Estimate tokens per tool definition: ~250 tokens per tool for the schema definition [source 9] (tools with many parameters will be higher)
   - Track loaded vs deferred token counts
   - Expose via `McpRegistry.estimateTokenUsage()` for ContextMeter (Phase 5)

6. **Always-loaded exceptions**
   - Allow users to mark specific MCP tools as "always loaded" (via config `alwaysLoad` or UI toggle)
   - These bypass deferred loading and are included in every prompt
   - Cap at 5 always-loaded MCP tools with a warning if exceeded

### Deliverables
- MCP tools are not included in the prompt by default
- `tool_search` meta-tool lets the model discover tools on-demand
- Semantic search returns relevant tools with high accuracy
- Token usage drops ~85% compared to loading all MCP tools

### Verification
- Test: with 50 MCP tools registered, only core tools + `tool_search` appear in prompt
- Test: `tool_search("read a file from filesystem")` returns the filesystem server's read tool
- Test: model can call `tool_search` then call the discovered tool in sequence
- Test: token estimate shows savings vs full load
- Benchmark: semantic search accuracy on 50-100 tool corpus (target >70% relevance in top-5)

---

## Phase 4: Management UI & Settings Panel

**Estimated scope:** Large
**Prerequisites:** Phase 2 (config system), Phase 1 (client manager with status events)
**Goal:** Full-featured MCP server management in the webview settings panel

### Steps

1. **Create `McpSettingsPanel.tsx`**
   - New tab/section in existing `SettingsPanel.tsx`
   - Server list with:
     - Server name
     - Transport type icon (stdio / HTTP)
     - Status indicator (green=connected, yellow=connecting, red=error, gray=disabled)
     - Enable/disable toggle
     - Restart button
     - Remove button
   - "Add Server" button → opens `McpServerForm`

2. **Create `McpServerForm.tsx`**
   - Add/edit form with fields:
     - Server name (unique identifier)
     - Transport type selector (stdio / HTTP)
     - For stdio: command, args (comma-separated or JSON array), env vars (key-value pairs)
     - For HTTP: URL, headers (key-value pairs)
     - Timeout (ms, default 30000)
     - Scope selector (global / project)
   - Validation: required fields, URL format, command existence
   - Save → writes to appropriate config file

3. **Create `McpToolList.tsx`**
   - Expandable section per server showing:
     - Tools: name, description, parameter count
     - Resources: name, URI, mimeType
     - Prompts: name, description, argument list
   - Per-tool "Always Load" toggle (bypasses deferred loading)
   - Per-tool "Always Allow" toggle (bypasses security confirmation)
   - Token estimate per tool

4. **LLM-assisted installation flow**
   - "Install from Repository" button in MCP panel
   - User pastes a GitHub URL or npm package name
   - Extension fetches the repo's README (via `web_fetch` or GitHub API)
   - Sends README to the LLM with a prompt: "Extract the MCP server configuration from this README. Return the command, args, and env vars needed."
   - LLM returns structured config → pre-fills `McpServerForm`
   - User reviews and confirms before saving
   - Security: always show what will be configured, never auto-execute

5. **Status and error display**
   - Connection errors show inline with retry button
   - Server logs viewable in a collapsible section per server
   - "Test Connection" button that connects and lists tools without persisting

6. **Message passing**
   - Define webview ↔ extension messages for MCP operations:
     - `mcp:getServers`, `mcp:addServer`, `mcp:removeServer`, `mcp:updateServer`
     - `mcp:restart`, `mcp:enable`, `mcp:disable`
     - `mcp:getTools`, `mcp:setAlwaysLoad`, `mcp:setAlwaysAllow`
     - `mcp:installFromRepo` (LLM-assisted)
     - `mcp:statusChanged` (extension → webview push)

### Deliverables
- Users can add, edit, remove, enable/disable, and restart MCP servers from the UI
- Tool/resource/prompt list visible per server
- LLM-assisted install from repo URL
- Real-time status indicators

### Verification
- Manual test: add a stdio server via form → connects and shows tools
- Manual test: add an HTTP server → connects
- Manual test: disable/enable toggle → server disconnects/reconnects
- Manual test: restart button → server reconnects
- Manual test: LLM install → paste repo URL → form pre-fills correctly
- Manual test: error state shown when server command is invalid

---

## Phase 5: ContextMeter Extension & Token Budgeting

**Estimated scope:** Small
**Prerequisites:** Phase 3 (registry with token estimates), existing ContextMeter component
**Goal:** Users can see how much context MCP tools consume in the existing ContextMeter

### Steps

1. **Extend `ContextMeterData` type**
   - Add `mcpTools` category to the token breakdown:
     ```typescript
     {
       category: 'mcpTools',
       label: 'MCP Tools',
       tokens: number,        // currently loaded MCP tool tokens
       percentage: number,
       details: {
         loaded: number,      // always-loaded MCP tools
         deferred: number,    // deferred tools (not counted against budget)
         totalAvailable: number,
         serverBreakdown: { name: string, tools: number, tokens: number }[]
       }
     }
     ```

2. **Update `ContextMeter.tsx`**
   - Add MCP segment to the token bar (distinct color)
   - Hover tooltip shows: "MCP Tools: X loaded (Y deferred) — Z tokens"
   - Modal breakdown includes per-server tool count and token estimate

3. **Wire data from McpRegistry**
   - `McpRegistry.estimateTokenUsage()` → `ContextMeterData.mcpTools`
   - Update on tool load/unload events (when `tool_search` activates tools)
   - Show deferred count as "available but not consuming context"

4. **Token budget warnings**
   - If MCP tools exceed 20% of context window, show yellow warning in meter
   - Suggest enabling deferred loading if disabled
   - Show "X tokens saved by deferred loading" in tooltip
   - **Note on accuracy**: Research found client-side estimates can be ~3x higher than actual API consumption [source 9, 10]. Label displayed values as "estimated" and calibrate against actual API usage counts where possible

### Deliverables
- ContextMeter shows MCP token usage as a distinct category
- Per-server breakdown in the detail modal
- Budget warnings when MCP tools consume too much context

### Verification
- Test: connect 3 servers with 20 tools each → ContextMeter shows MCP segment
- Test: deferred tools show as "available" without counting against budget
- Test: activating a tool via `tool_search` updates the meter in real-time
- Test: exceeding 20% threshold shows warning

---

## Phase 6: Security Integration & Description Auditing

**Estimated scope:** Medium
**Prerequisites:** Phase 1 (tool execution), Phase 4 (UI), existing SecurityManager
**Goal:** MCP tool execution respects Archon's security tiers, with visibility into tool descriptions

### Steps

1. **Classify MCP tool calls in SecurityManager**
   - Add MCP tool execution as a command category in `packages/core/src/security/security-manager.ts`
   - Default classification: `mutating_remote` (MCP tools can do anything — network, filesystem, etc.)
   - Allow override: tools from servers marked as "local-only" (stdio, no network access) → `mutating_local`
   - Tier behavior:
     - `yolo`: auto-approve all MCP tool calls
     - `permissive`: auto-approve most, confirm MCP tools classified as destructive (aligns with existing tier behavior)
     - `standard`: confirm first use of each tool (then remember choice per session)
     - `strict`: confirm every MCP tool call

2. **Per-tool approval persistence**
   - `alwaysAllow` list in config: tools the user has permanently approved
   - Session-allow: tools approved once in current session (not persisted)
   - UI: "Always allow this tool" checkbox in the approval dialog

3. **Tool description auditing**
   - In `McpToolList.tsx`, show full raw tool descriptions (not just names)
   - Flag suspiciously long descriptions (>500 chars) with a warning icon
   - Flag descriptions containing instruction-like text ("you must", "always", "ignore previous") with a security warning
   - Tooltip explains why the description was flagged: "This tool description contains instruction-like text that could be a prompt injection attempt"

4. **Server verification indicators**
   - In the UI, show whether a server was installed from:
     - npm (verifiable via registry)
     - Local path (user-controlled)
     - Remote URL (highest risk)
   - Different icon/badge per source type

5. **Credential isolation**
   - MCP servers must NOT receive Archon's own API keys or OAuth tokens
   - Only `env` variables explicitly defined in the server's config are passed to the subprocess
   - Document this boundary clearly: each server's `env` block is its only credential channel

6. **Audit logging**
   - Log all MCP tool calls to Archon's interaction history (existing `InteractionArchive`)
   - Include: server name, tool name, arguments (sanitized), result summary, approval status
   - Visible in session history for review

**Note:** Basic SecurityManager gating is wired in Phase 1 (tool adapter). This phase adds the advanced security features: description auditing UI, verification indicators, credential isolation, and audit logging.

### Deliverables
- MCP tool calls go through SecurityManager approval based on current tier
- Tool descriptions visible and flagged for suspicious content
- Approval choices persist per config
- All MCP interactions logged

### Verification
- Test: in `standard` mode, first MCP tool call prompts for approval
- Test: in `yolo` mode, MCP tools execute without prompts
- Test: "Always allow" persists across sessions
- Test: tool with suspicious description shows warning flag
- Test: MCP tool calls appear in interaction history

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Context bloat with many servers** | Model accuracy degrades, context window exhausted | Deferred loading + semantic search (Phase 3) reduces token usage ~85% |
| **CJS compatibility with MCP SDK** | SDK uses `.js` extensions in imports; may break with Node10 module resolution | Test early in Phase 1; may need path aliasing or bundler config |
| **stdio transport breaks in remote/WSL** | MCP servers won't work in remote development scenarios | HTTP transport available as alternative; document limitation |
| **Slow-starting servers (npx)** | Servers silently dropped or timeout | Configurable timeout with UI feedback (Phase 2) |
| **Tool poisoning via descriptions** | Malicious servers inject prompts into tool descriptions | Description auditing UI with flagging (Phase 6) |
| **Embedding model unavailable** | Semantic search fails if no embedding provider configured | BM25 keyword fallback in McpRegistry (Phase 3) |
| **MCP SDK v2 breaking changes** | Future SDK version may require refactoring | Abstract transport/client behind interfaces; pin SDK version |
| **LLM-assisted install hallucination** | LLM generates incorrect server config from README | User must review and confirm all config before saving (Phase 4) |

## Open Questions

1. **sqlite-vec embedding table**: Should MCP tool embeddings share the existing `MemoryDatabase` or use a separate SQLite DB? Sharing is simpler but couples MCP to the memory system.
2. **Multi-workspace support**: How should project-level MCP configs work when multiple workspace folders are open?
3. **Server output capture**: Should stdio server stderr be captured and shown in the UI for debugging? (Yes likely, but need to decide on buffering/truncation.)
4. **Resource subscription**: MCP resources support `subscribe()` for live updates — should Archon support this in v1 or defer?
5. **Prompt integration depth**: Should MCP prompts be exposed as slash commands in the chat UI, or only as tools?
6. **Registry-based discovery**: Evaluate mcp.so, Smithery, and other emerging registries for curated server lists that could power safer server discovery as a follow-on to LLM-assisted install [research follow-up 5]

## References

- Research document: [docs/research/mcp-integration-context-optimization.md](../research/mcp-integration-context-optimization.md)
- MCP SDK: [@modelcontextprotocol/sdk v1.x](https://www.npmjs.com/package/@modelcontextprotocol/sdk) [source 1]
- Deferred loading + tool search: [Claude API docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) [source 11]
- Config format standard: Cline [source 5], Roo Code [source 6], Claude Desktop
- Security risks: Pillar Security [source 18], tool poisoning [source 19], credential theft [source 20]
- Token consumption data: ~250 tokens/tool [source 9], 5 servers = ~55K tokens [source 12]
- Existing SecurityManager: `packages/core/src/security/security-manager.ts`
- Existing ContextMeter: `packages/vscode/src/webview/components/ContextMeter.tsx`
- Existing ToolDefinition: `packages/core/src/types.ts:96-101`
