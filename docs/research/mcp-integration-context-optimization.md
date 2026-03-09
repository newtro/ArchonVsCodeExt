# Research Report: MCP Integration for Archon VS Code Extension
*Generated: 2026-03-09 | Time budget: 5m | Sources consulted: 22*

## Executive Summary

- **MCP integration is straightforward** via `@modelcontextprotocol/sdk` v1.x — the `Client` class with `StdioClientTransport` handles local servers; `StreamableHTTPClientTransport` covers remote
- **Context bloat is the #1 risk**: 5 MCP servers consume ~55K tokens in tool definitions before any work happens; 10+ servers can consume the entire context window
- **Deferred tool loading + tool search** is the proven mitigation — Anthropic's `defer_loading` reduces token usage by ~85% while improving accuracy from 49% to 74%
- **Config format**: adopt the `{ "mcpServers": {...} }` de facto standard (used by Cline, Roo Code, Claude Desktop, Cursor) for maximum compatibility
- **Security is a real concern** for one-click install: no official curated registry, tool poisoning attacks documented in the wild, and MCP servers execute with full user permissions

## Project Context

- TypeScript monorepo: pnpm + turborepo (packages: core, memory, vscode)
- CJS output, `"module": "CommonJS"`, `"moduleResolution": "Node10"`
- Existing `ToolDefinition` interface in `packages/core/src/types.ts`
- Tool registry pattern: `createCoreTools()` returns array of `ToolDefinition` objects
- No MCP integration exists yet

## 1. MCP SDK & Client Architecture

### The SDK

The official TypeScript SDK is `@modelcontextprotocol/sdk` (v1.27.1, 31K+ dependents) [1]. It requires `zod` for schema validation. A v2 is anticipated but v1.x is recommended for production.

**Key API surface:**
- `Client` class: `listTools()`, `callTool(name, args)`, `listResources()`, `readResource()`, `listPrompts()`, `getPrompt()` [2]
- Constructor: `new Client({ name, version }, { capabilities: {} })`
- Connection: `await client.connect(transport)`
- Transports: `StdioClientTransport` (subprocess), `StreamableHTTPClientTransport` (remote HTTP) [3]

**Import paths:**
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsResultSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
```

### Transport Protocols

The MCP spec (revision 2025-03-26) defines two transports [3]:
1. **stdio** — client spawns server as subprocess, JSON-RPC over stdin/stdout, newline-delimited. Most common for local servers.
2. **Streamable HTTP** — server runs independently, HTTP POST/GET with optional SSE. Supports stateless operation behind load balancers.

SSE transport is **deprecated** as of 2025-03-26 [4]. For backwards compatibility, attempt POST first, fall back to SSE GET if it fails.

### Integration Pattern for Archon

MCP tools would need to be adapted to Archon's `ToolDefinition` interface. Each MCP tool's `inputSchema` maps to `ToolDefinition.parameters`, and execution would delegate to `client.callTool(name, args)`. A `McpToolAdapter` would bridge the gap:

```typescript
// Conceptual adapter
function mcpToolToArchonTool(mcpTool: McpTool, client: Client): ToolDefinition {
  return {
    name: `mcp_${serverName}_${mcpTool.name}`,
    description: mcpTool.description,
    parameters: mcpTool.inputSchema,
    execute: async (args, ctx) => {
      const result = await client.callTool({ name: mcpTool.name, arguments: args });
      return formatResult(result);
    },
  };
}
```

## 2. Configuration Format & UX Patterns

### De Facto Standard Config

The ecosystem has converged on this format [5][6][7]:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": { "API_KEY": "..." },
      "disabled": false,
      "alwaysAllow": ["tool_name"]
    }
  }
}
```

For remote servers: `{ "url": "https://...", "headers": {...} }`

**Note:** VS Code's native format uses `"servers"` instead of `"mcpServers"` [8]. Archon should use `"mcpServers"` for compatibility with the broader ecosystem (Cline, Roo Code, Claude Desktop).

### How Competitors Handle MCP Server Management

| Feature | Cline | Roo Code | Continue | VS Code Native |
|---------|-------|----------|----------|----------------|
| Config file | `cline_mcp_settings.json` | `mcp_settings.json` + `.roo/mcp.json` | `.continue/mcpServers/` (YAML/JSON) | `.vscode/mcp.json` |
| One-click add | Give GitHub URL, auto-builds | Manual JSON edit | Auto-detect from other tools | Manual JSON edit |
| Enable/disable toggle | Yes | Yes | N/A | N/A |
| Restart button | Yes | Yes | N/A | N/A |
| Timeout config | 30s-1hr (default 1min) | 1-3600s | N/A | N/A |
| Tool auto-approval | Per-tool `alwaysAllow` | Per-tool checkboxes | N/A | N/A |
| Project-level config | No | Yes (`.roo/mcp.json`) | N/A | Yes (`.vscode/mcp.json`) |

**Cline's one-click pattern** is the most user-friendly: paste a GitHub URL, Cline clones/builds/configures automatically [5].

### VS Code Extension API

VS Code provides `vscode.lm.registerMcpServerDefinitionProvider()` for extensions to programmatically register MCP servers with Copilot [8]. However, this is for contributing servers *to Copilot*, not for consuming servers as a client. **Archon should use the SDK directly as a client.**

## 3. Context Bloat: The Core Problem

### Token Consumption Data

| Servers | Estimated Tokens | % of 200K Window |
|---------|-----------------|-------------------|
| 1 server (20 tools) | ~5K-15K | 2.5-7.5% |
| 5 servers | ~55K | 27.5% |
| 7+ servers | ~100-140K | 50-70% |
| 10 servers | ~80-110K | 40-55% |
| 20 servers | ~160-220K | 80-110% (unusable) |

Per-tool average: ~250 tokens for the schema definition alone [9]. A single server like XcodeBuildMCP with ~60 tools consumes ~15K tokens [10].

**Critical threshold**: LLM tool selection accuracy degrades significantly beyond 30-50 available tools [11]. This is not just a token issue — it's a cognitive overload problem for the model.

### The Degradation Pattern

With 7+ MCP servers, users lose 50-70% of their context window before writing a single prompt [12]. The model then has less room for conversation history, code context, and reasoning — directly hurting output quality.

## 4. Context Optimization Strategies

### Strategy 1: Deferred Loading + Tool Search (Recommended Primary)

Anthropic's `defer_loading` pattern [11][13]:
- Tools marked `defer_loading: true` are NOT included in the active prompt
- A `ToolSearch` meta-tool is injected instead
- Model searches for relevant tools on-demand (regex or BM25)
- Only 3-5 relevant tools (~3K tokens) are loaded per query
- **Result**: 85% token reduction, accuracy improvement from 49% to 74%

Two search variants available via Anthropic API:
1. **Regex-based** (`tool_search_tool_regex_20251119`): Python `re.search()` syntax, max 200 chars
2. **BM25-based** (`tool_search_tool_bm25_20251119`): natural language queries

**For Archon's custom provider approach**, implement client-side tool search:
- Maintain a registry of all MCP tool definitions (name, description, parameter names)
- On each agent turn, embed only core tools + the `tool_search` meta-tool
- When the model calls `tool_search`, return matching tool definitions
- Model then calls the discovered tool normally

**Key constraint**: At least one tool must be non-deferred [11]. Keep 3-5 most-used tools always loaded.

### Strategy 2: Semantic Tool Discovery (Enhancement)

Use vector embeddings for tool matching [14]:
- Embed all tool definitions (name + description + parameter descriptions) at registration time
- At query time, embed the user request and return top-N semantically similar tools
- Achieves 12.5% higher accuracy on average over keyword-based approaches
- Archon already has `sqlite-vec` in its memory system — could reuse for tool embeddings

### Strategy 3: Tool Grouping / Profiles

Group MCP servers by task context:
- "Web Development" profile: only enable web-related MCP servers
- "Database" profile: enable DB-related servers
- User selects active profile, reducing loaded tools to relevant subset
- Similar to Windsurf's "Flows" concept [15]

### Strategy 4: Response Filtering (MCP+)

Post-process MCP tool outputs before they reach the agent [16]:
- Use a cheap model (GPT-4-mini) to filter tool responses
- Add `expected_info` parameter to tool calls specifying what to extract
- Reduces response tokens by up to 95% (7K → 200 tokens in one case)
- Addresses output bloat, not input bloat

### Strategy 5: Cloudflare Code Mode Pattern

Instead of exposing individual tools, expose two meta-tools: `search()` and `execute()` [17]:
- Model writes JavaScript code against a typed SDK representation
- Reduces 1.17M tokens of tool definitions to ~1K tokens
- Extreme but effective for API-heavy MCP servers

### Recommended Approach for Archon

**Layered strategy:**
1. **Always-loaded core tools**: Archon's built-in tools (read_file, write_file, etc.) — always in prompt
2. **Deferred MCP tools**: All MCP server tools registered with `defer_loading: true`
3. **Tool search**: Client-side BM25 or semantic search over deferred tools
4. **Server profiles** (optional): Let users group servers by context
5. **Token budget display**: Show users how much context MCP tools consume (extend existing ContextMeter)

## 5. Security Considerations

### Real Risks for One-Click Install

1. **No curated registry**: Attackers upload fake MCP servers with legitimate branding [18]
2. **Tool poisoning**: Malicious servers manipulate tool descriptions to trick the LLM — a fake "Postmark MCP Server" was caught injecting BCC copies of emails to attackers [19]
3. **Credential theft**: MCP servers access stored OAuth tokens for connected services [20]
4. **Command injection**: CVE-2025-6514 found in `mcp-remote`, a popular OAuth proxy [21]
5. **Prompt injection via sampling**: Malicious servers use sampling to inject prompts back into the LLM [22]

### Recommended Mitigations

- **Trust tiers**: Distinguish between "verified" servers (from known registries like npm with signatures) and "unverified" servers (arbitrary URLs/commands)
- **Tool approval**: Require explicit user approval before any MCP tool executes (Cline's `alwaysAllow` per-tool pattern)
- **Sandboxing**: Consider running stdio servers in restricted environments (limited filesystem access, no network by default)
- **Description auditing**: Show users the raw tool descriptions from MCP servers, flag suspiciously long or instruction-injecting descriptions
- **Archon's existing trust system**: Leverage the existing trust framework in `packages/vscode/src/extension/trust/` for MCP server trust decisions

## Counter-Arguments

### Deferred Loading Has Real Bugs
- With 91+ tools, 400 errors on deferred tool load attempts are reported [23]
- Tools proxied via `mcp-remote` fail to appear as deferred [23]
- Custom agents/skills cannot use deferred MCP tools [24]
- **Assessment**: These are implementation bugs in Claude Code, not fundamental design flaws. Archon's client-side implementation can avoid these by controlling the search mechanism directly.

### stdio Transport Is Fundamentally Local
- Breaks in remote/WSL/SSH scenarios — extension spawns `cmd.exe` locally instead of using remote shell [25]
- Slow-starting servers (e.g., `npx`) get silently dropped during config loading [26]
- **Assessment**: Valid concern. Archon should implement timeout feedback (show "connecting..." state) and document remote workspace limitations. Streamable HTTP transport solves remote use cases.

### One-Click Install Is Actively Being Exploited
- The ecosystem lacks a verified registry comparable to npm or VS Code marketplace [18]
- **Assessment**: This is the strongest counter-argument. Archon should NOT enable fully automatic one-click install from arbitrary sources. Instead: curate a list of known-good servers, require manual confirmation for unknown sources, and show security warnings.

## Contradictions & Disagreements

1. **Token counting discrepancy**: Claude Code's `/context` command reports ~45K tokens for 60 tools, but actual API consumption is ~15K [10]. The discrepancy is due to shared system instructions being counted per-tool. **Takeaway**: measure actual API token usage, not client-side estimates.

2. **Tool count threshold**: Anthropic docs suggest degradation at 30-50 tools [11], but some users report issues as low as 20 tools while others handle 100+ with tool search. **Takeaway**: the threshold depends heavily on tool description quality and query complexity.

## Gaps & Limitations

- **No benchmarks found** for client-side tool search implementations (BM25 vs semantic) specifically in VS Code extension contexts
- **MCP spec v2** details are not yet public — may change transport or discovery mechanisms
- **Token costs of tool search itself** (the meta-tool description + search results) are not well-documented
- **Multi-provider support**: Research focused on Claude API's `defer_loading`; other LLM providers (OpenRouter, Ollama) may not support equivalent features, requiring Archon to implement tool search entirely client-side
- **No production-scale case studies** found for VS Code extensions managing 10+ MCP servers simultaneously

## Suggested Follow-ups

1. **Prototype the McpToolAdapter**: Build a minimal adapter that connects one MCP server and bridges its tools to Archon's `ToolDefinition` interface
2. **Benchmark client-side tool search**: Test BM25 vs semantic (using existing sqlite-vec) search accuracy on a realistic set of 50-100 MCP tools
3. **Design the MCP settings UI**: Wireframe the server management panel (add/remove/enable/disable/restart) for the webview
4. **Investigate Archon's trust system**: Evaluate how `packages/vscode/src/extension/trust/` can be extended for MCP server trust decisions
5. **Research MCP server registries**: Investigate mcp.so, Smithery, and other emerging registries for curated server lists that could power one-click install safely

## Sources

1. [@modelcontextprotocol/sdk - npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — current — Official MCP TypeScript SDK package
2. [MCP TypeScript SDK API Docs](https://ts.sdk.modelcontextprotocol.io/) — current — Client class API reference
3. [MCP Specification - Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) — 2025-03-26 — Official transport protocol definitions
4. [Why MCP Deprecated SSE](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/) — 2025-06 — SSE deprecation rationale
5. [Configuring MCP Servers - Cline](https://docs.cline.bot/mcp/configuring-mcp-servers) — current — Cline's MCP management UX
6. [Using MCP in Roo Code](https://docs.roocode.com/features/mcp/using-mcp-in-roo) — current — Roo Code's dual-config approach
7. [How to Set Up MCP in Continue](https://docs.continue.dev/customize/deep-dives/mcp) — current — Continue's YAML-based MCP config
8. [VS Code MCP Developer Guide](https://code.visualstudio.com/api/extension-guides/ai/mcp) — current — VS Code native MCP extension API
9. [Do MCP Servers Really Eat Half Your Context Window?](https://www.async-let.com/posts/claude-code-mcp-token-reporting/) — recent — Token measurement study (~250 tokens/tool)
10. [XcodeBuildMCP token analysis](https://www.async-let.com/posts/claude-code-mcp-token-reporting/) — recent — 60 tools = ~15K actual tokens
11. [Tool search tool - Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) — current — Deferred loading and tool search API
12. [Optimising MCP Server Context Usage](https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code) — recent — Real-world context consumption data
13. [Claude Code Lazy Loading for MCP Tools](https://jpcaparas.medium.com/claude-code-finally-gets-lazy-loading-for-mcp-tools-explained-39b613d1d5cc) — 2026-01 — Overview of deferred loading feature
14. [Improving agent with semantic search - Cursor](https://cursor.com/blog/semsearch) — 2025 — Semantic tool discovery benchmarks
15. [AI Coding Assistants in 2026](https://dev.to/kainorden/ai-coding-assistants-in-2026-cursor-vs-github-copilot-vs-windsurf-2mm9) — 2026 — Windsurf Flows concept
16. [MCP+: Precision Context Management](https://mcp-plus.github.io/) — recent — Response filtering approach
17. [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode-mcp/) — 2026-02 — Meta-tool pattern reducing 1.17M to 1K tokens
18. [Security Risks of MCP - Pillar Security](https://www.pillar.security/blog/the-security-risks-of-model-context-protocol-mcp) — recent — No curated registry, arbitrary code execution
19. [MCP Security Vulnerabilities](https://www.practical-devsecops.com/mcp-security-vulnerabilities/) — recent — Tool poisoning attack (fake Postmark server)
20. [MCP Security Risks - Red Hat](https://www.redhat.com/en/blog/model-context-protocol-mcp-understanding-security-risks-and-controls) — recent — Credential theft vectors
21. [Timeline of MCP Security Breaches - AuthZed](https://authzed.com/blog/timeline-mcp-breaches) — recent — CVE-2025-6514 in mcp-remote
22. [MCP Sampling Attack Vectors - Unit42](https://unit42.paloaltonetworks.com/model-context-protocol-attack-vectors/) — recent — Prompt injection via sampling
23. [Claude Code Issue #25894](https://github.com/anthropics/claude-code/issues/25894) — recent — 400 errors with 91+ deferred tools
24. [Claude Code Issue #25200](https://github.com/anthropics/claude-code/issues/25200) — recent — Deferred tools unavailable in custom agents
25. [Continue Issue #10842](https://github.com/continuedev/continue/issues/10842) — recent — Remote/WSL stdio breakage
26. [Claude Code Issue #29033](https://github.com/anthropics/claude-code/issues/29033) — recent — Slow servers silently dropped
