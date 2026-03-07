# Archon

**Model-agnostic AI coding assistant with a visual workflow editor for VS Code.**

> **Beta** — Archon is under active development. Expect rough edges and breaking changes.

## Features

### AI Chat Panel
- Conversational AI assistant in the VS Code sidebar
- Supports multiple providers: **OpenRouter**, **Claude (Anthropic)**, **OpenAI**, and **ChatGPT**
- Switch models on the fly — use whichever LLM fits the task

### Agentic Tool Use
- **File operations** — read, write, edit, search, and navigate your codebase
- **Terminal execution** — run commands with configurable security levels
- **LSP integration** — go-to-definition, find references, hover info, diagnostics, and more
- **Web tools** — search, fetch, and look up documentation

### Security Levels
Four tiers of command approval to match your comfort level:
| Level | Behavior |
|---|---|
| **Yolo** | Full auto-approve — no confirmations |
| **Permissive** | Auto-approve most, confirm destructive ops |
| **Standard** | Auto-approve reads, confirm writes and commands |
| **Strict** | Confirm everything |

### Memory System
- Persistent project memory powered by SQLite
- Semantic code search with AST-aware chunking
- Session summaries and interaction archive
- Automatic edit pattern tracking

### Hooks and Skills
- **Hooks engine** — trigger custom actions on tool events
- **Skill templates** — reusable prompt workflows

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open the Archon panel from the activity bar (or `Ctrl+Shift+A` / `Cmd+Shift+A`)
3. Set your API key via the command palette: **Archon: Set OpenRouter API Key**
4. Start chatting — Archon can read, edit, and run code in your workspace

## Requirements

- VS Code 1.96.0 or later
- An API key from one of the supported providers (OpenRouter, Anthropic, or OpenAI)

## Configuration

| Setting | Default | Description |
|---|---|---|
| `archon.securityLevel` | `standard` | Command approval tier |
| `archon.enableInteractionArchive` | `true` | Store past conversations for search |
| `archon.diffViewMode` | `auto` | When to show diffs before edits |
| `archon.gitCheckpoints` | `true` | Auto-commit checkpoints before edit batches |

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+A` / `Cmd+Shift+A` | Focus Archon chat |
| `Ctrl+Shift+N` / `Cmd+Shift+N` | New chat (when panel visible) |

## Feedback and Issues

This is a beta release. Please report bugs and feature requests at:
https://github.com/newtro/ArchonVsCodeExt/issues

## License

[MIT](LICENSE)
