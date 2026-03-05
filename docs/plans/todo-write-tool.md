# TodoWrite Tool — Implementation Plan

## Vision

Give Archon's agent a built-in task tracker so it can plan multi-step work, show real-time progress to the user, and produce a summary when done — similar to Claude Code's TodoWrite, but with configurable UI modes, richer statuses, and VS Code-native integration.

## Problem Statement

When the agent works on complex requests, the user has no structured visibility into what the agent is doing, what remains, or whether something failed. Chat messages scroll by quickly and tool calls are transient. A persistent, live checklist solves this by giving the agent a way to externalize its plan and the user a way to monitor progress at a glance.

## Goals

- **LLM-driven todo tool** — the agent calls `todo_write` to create and update a flat checklist
- **Three configurable display modes** — pinned panel, inline message, floating overlay (user picks in settings)
- **Turn-scoped lifecycle** — todos live for one user→agent turn, then collapse into a chat summary
- **Five statuses** — `pending`, `in_progress`, `completed`, `error`, `skipped`
- **Full-replacement semantics** — each tool call sends the complete list (no incremental patching)
- **Status bar progress** — VS Code status bar shows "3/7 tasks" with a mini progress indicator
- **Optional title** — the agent can label the todo list (e.g., "Refactoring auth module")
- **Animated transitions** — pulse on in_progress, pop on completed, shake on error
- **Cancellation awareness** — on cancel, summarize completed vs. abandoned items

## Non-Goals

- No cross-agent sharing — spawned sub-agents do NOT share the parent's todo list
- No disk persistence — todos are purely in-memory UI state
- No user editing of todo content — the LLM controls the list (user can view only)
- No nested/hierarchical todos — flat list only

## Tool Design

### Tool Definition

```
name: "todo_write"
description: "Create or update a todo list to plan and track progress on multi-step tasks.
              Call this at the start of complex work to outline your plan, then call it again
              as you complete each step. Each call replaces the entire list."
```

### Parameters

```typescript
{
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Optional label for this todo list (e.g., "Refactoring auth module")'
    },
    todos: {
      type: 'array',
      description: 'The complete todo list. Each call replaces the entire list.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stable identifier for this item (e.g., "1", "setup", "test")' },
          content: { type: 'string', description: 'Description of the task' },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'error', 'skipped'],
            description: 'Current status of this item'
          }
        },
        required: ['id', 'content', 'status']
      }
    }
  },
  required: ['todos']
}
```

### Execution

The `execute` function does NOT perform file I/O or side effects. It:
1. Validates the input (well-formed todos, valid statuses)
2. Calls a new `ToolContext` method: `ctx.updateTodos(title, todos)`
3. Returns a confirmation string: `"Todo list updated: 2/5 completed, 1 in progress"`

The `updateTodos` context method sends an `ExtensionMessage` to the webview.

## Data Model

### Core Types (in `packages/core/src/types.ts`)

```typescript
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'error' | 'skipped';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoList {
  title?: string;
  items: TodoItem[];
  turnId: string;       // links to the user message that started this turn
  startedAt: number;    // timestamp for elapsed time tracking
}
```

### New ExtensionMessage Variants

```typescript
| { type: 'todosUpdated'; title?: string; todos: TodoItem[] }
| { type: 'todosTurnComplete'; summary: TodoSummary }
```

### TodoSummary (for the chat summary message)

```typescript
export interface TodoSummary {
  title?: string;
  total: number;
  completed: number;
  error: number;
  skipped: number;
  abandoned: number;  // items still pending/in_progress when turn ended or was cancelled
}
```

## Architecture — Data Flow

```
1. LLM calls todo_write tool
2. tool-registry.ts execute() validates → calls ctx.updateTodos()
3. chat-view-provider.ts receives updateTodos → stores current TodoList
4. chat-view-provider.ts posts { type: 'todosUpdated', ... } to webview
5. Zustand store updates todoList state
6. React component re-renders based on display mode setting
7. VS Code status bar item updates progress count

On turn complete / cancel:
8. chat-view-provider.ts computes TodoSummary
9. Posts { type: 'todosTurnComplete', summary } to webview
10. Zustand store clears live todoList, inserts summary into messages[]
11. Status bar clears
```

## UI Components

### 1. TodoListWidget (shared core)

The core rendering component used by all three display modes:
- Renders a flat checklist with status icons
- Status icons: ○ pending, ◉ in_progress (animated pulse), ✓ completed (pop animation), ✗ error (shake), ⊘ skipped
- Optional title header
- Color coding: pending=muted, in_progress=blue, completed=green, error=red, skipped=gray

### 2. Display Modes

**Pinned Panel** (`TodoPinnedPanel`):
- Sits above the chat message list
- Collapsible with a chevron toggle
- Shows item count badge when collapsed
- Smooth height animation on expand/collapse

**Inline Message** (`TodoInlineMessage`):
- Renders as a special message bubble in the chat stream (like tool calls today)
- Updates in-place as the agent modifies the list
- Uses a stable message ID so it doesn't duplicate

**Floating Overlay** (`TodoFloatingOverlay`):
- Small draggable/resizable floating panel in the bottom-right of the webview
- Semi-transparent background
- Can be minimized to just show the progress count

### 3. TodoSummaryMessage

Rendered in the chat stream when a turn completes:
- Compact one-liner: "✓ 5/7 tasks completed, 1 error, 1 skipped"
- Expandable to show the full final checklist (read-only)
- Title shown if one was set

### 4. Settings Integration

Add to the existing SettingsPanel:
- `archon.todoDisplayMode`: `"pinned"` | `"inline"` | `"floating"` (default: `"pinned"`)

## Status Bar Integration

- Register a `vscode.StatusBarItem` (priority: right side, near existing items)
- Shows: `$(checklist) 3/7 tasks` when todos are active
- Hidden when no active todo list
- Clicking it focuses the Archon webview panel
- Updates on every `todosUpdated` message

## Cancellation Behavior

When the user cancels mid-turn:
1. The agent loop stops after the current tool call
2. `chat-view-provider.ts` detects cancellation and computes the summary
3. Items still `pending` or `in_progress` are counted as `abandoned` in the summary
4. The summary message shows: "Cancelled — 3/7 completed, 4 abandoned"
5. The live widget clears, status bar clears

## System Prompt Integration

Add one line to the system prompt builder (in the agent config or system prompt template):

> "Use the `todo_write` tool to plan and track progress when working on tasks with multiple steps."

The tool's own description handles the rest. No conditional injection needed.

## Implementation Phases

### Phase 1: Core Tool & Data Model
- Add `TodoStatus`, `TodoItem`, `TodoList`, `TodoSummary` types to `packages/core/src/types.ts`
- Add `todosUpdated` and `todosTurnComplete` to `ExtensionMessage` union
- Add `updateTodos` to `ToolContext` interface
- Implement `todo_write` tool in `packages/core/src/tools/tool-registry.ts`
- Register it in `createCoreTools()`

### Phase 2: Extension Host Wiring
- Add `updateTodos` implementation in `chat-view-provider.ts`
- Store current `TodoList` in the provider
- Post `todosUpdated` messages to webview on tool calls
- Compute and post `todosTurnComplete` on turn end / cancel
- Register VS Code status bar item

### Phase 3: Zustand Store
- Add `todoList: TodoList | null` to store state
- Add `setTodoList`, `clearTodoList` actions
- Handle `todosUpdated` in the webview message listener
- Handle `todosTurnComplete` — clear live list, insert summary message

### Phase 4: UI Components
- Build `TodoListWidget` (shared renderer with animations)
- Build `TodoPinnedPanel`, `TodoInlineMessage`, `TodoFloatingOverlay`
- Build `TodoSummaryMessage` for chat stream
- Add display mode setting to `SettingsPanel`
- Wire the active mode to render the correct component

### Phase 5: Polish
- CSS animations (pulse, pop, shake)
- Status bar item with click-to-focus
- Cancellation flow integration
- System prompt line addition

## Open Questions

1. **Animation library or pure CSS?** — CSS animations are lighter and don't add dependencies. Recommend pure CSS with `@keyframes`.
2. **Floating overlay drag behavior** — Should position persist across turns, or reset to default corner each time?
3. **Maximum todo items?** — Should we cap the list to prevent the LLM from creating 50+ items? Suggested cap: 20.
4. **Summary in session export?** — If/when chat sessions are saved, should todo summaries be included? (Currently no disk persistence, but the summary message in chat would naturally be saved with the session.)
