# Changelog

## 0.2.0 (2026-03-10)

### Added
- MCP (Model Context Protocol) support — connect to external MCP servers for additional tools, prompts, and resources
- MCP settings UI with server configuration form, tool discovery, and enable/disable controls
- MCP transport layer with stdio and SSE support
- MCP tool adapter integrating external tools into the agent loop with security gating

## 0.1.5 (2026-03-08)

### Added
- Publish-to-marketplace skill for automated release workflow
- Backfilled changelog for all previous versions (0.1.0–0.1.4)

## 0.1.4 (2026-03-08)

### Added
- Memory system wiring — context assembly pipeline now injects memory into LLM prompts
- Memory Dashboard with full CRUD for session memories, learned preferences, and rules
- Memory layer toggle UI — per-layer inject/record control for all context sources
- Context preview bar showing estimated tokens per memory layer before each send
- Inline memory citations — `[mem:ID]` markers rendered as clickable badges in responses
- Auto-compaction system with progressive stages at 70/85/95% context utilization
- Memory Model configuration in Settings with provider auto-detection (OpenRouter, OpenAI, Ollama)
- Background graph population from indexed files on workspace load
- Manual "Save Memory" and "Cleanup Sessions" actions in dashboard

### Fixed
- Native module resolution — better-sqlite3 now resolves correctly from extension runtime
- GraphBuilder.indexFile() call signature (was missing required content/language/hash args)
- Race condition in memory LLM initialization during first message send
- Memory dashboard showing "LLM not configured" even when configured in Settings

## 0.1.3 (2026-03-07)

### Added
- OpenAI provider with dual authentication — API key and ChatGPT subscription support
- Hooks engine for pre/post tool execution customization
- Skill templates for common workflows

## 0.1.2 (2026-03-06)

### Added
- Memory system v0.2.0 — unified SQLite storage with better-sqlite3
- AST chunking with tree-sitter WASM (11 languages)
- Code knowledge graph with symbol extraction and edge tracking
- Session memory with auto-summarization and confidence decay
- Context meter showing real-time token usage
- Interaction archive for semantic search of past conversations
- Edit tracker for learning user preferences from code modifications
- Memory telemetry and health monitoring

## 0.1.1 (2026-03-05)

### Added
- Claude Code CLI provider with provider abstraction layer
- Skill system with picker UI and version management
- Todo widget for task tracking
- Rich ask-user options with multi-select support
- Pipeline executor with parallel spawn_agent support
- Code block copy buttons in chat responses
- File attachment support for chat messages

### Fixed
- Skill cache invalidation issues
- Tool UX improvements for better feedback

## 0.1.0 (2026-03-04)

### Added
- Initial beta release
- AI chat panel with OpenRouter provider support
- Agentic tool use: file ops, terminal, LSP, web tools
- Four-tier security levels (yolo, permissive, standard, strict)
- Git checkpoint system for edit safety
- Diff view mode for reviewing changes
