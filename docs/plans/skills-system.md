# Archon Skills System — Plan

## 1. Vision

Archon Skills transforms the Archon VS Code Extension from a general-purpose AI coding agent into a **customizable, skill-aware assistant** where users can create, manage, and invoke reusable capabilities through a first-class visual interface.

Unlike every other AI coding tool where skills are invisible files managed via terminal, Archon makes skills a **first-class managed resource** with a dedicated UI for creation, editing, organization, versioning, and discovery.

The agent can also create skills on the user's behalf and suggest turning repeated patterns into reusable skills.

## 2. Problem Statement

Current AI coding tools (Claude Code, Codex, Cursor) all support some form of skills/commands, but they all share the same UX problems:

- **Invisible** — Skills are files on disk with no visual presence in the IDE
- **Unmanageable** — No enable/disable toggle; users delete or rename files
- **No editing UI** — Users must manually edit markdown files in a text editor
- **No overview** — No way to see all available skills, their status, or what they do at a glance
- **No creation wizard** — Users must know the file format and directory structure
- **No versioning** — No way to track changes or rollback a broken skill
- **No onboarding** — New users get zero skills and must figure out the format themselves

Archon solves all of these with a dedicated Skills Management UI and an intelligent skills engine.

## 3. Goals & Non-Goals

### Goals (v1)
- Skills engine: loader, parser, executor with progressive disclosure
- Skill format: Archon's own SKILL.md format (markdown + YAML frontmatter)
- Two-tier skill structure: simple (single file) and rich (directory with scripts)
- Invocation via slash commands (`/skill-name`) and auto-detection
- Agent can create skills when user requests it
- Agent can suggest creating a skill after completing a task
- Skills scoped to global or project level, user chooses
- Dedicated Skills Management UI tab (dashboard + editor + organization)
- Built-in template gallery with 10-15 starter skills
- Conversation-to-Skill wizard
- Skill versioning with rollback
- Script execution integrated with existing security levels

### Non-Goals (deferred)
- Visual workflow builder for multi-step skills (users edit markdown directly)
- Marketplace or community sharing features
- Cross-platform compatibility with Claude Code/Codex skill formats
- Skill analytics/usage tracking
- Skill dependencies or chaining
- Skill parameters/variables system

## 4. Skill Format Specification

### 4.1 Simple Skills (Single File)

A simple skill is a single markdown file with YAML frontmatter:

```
.archon/skills/review.md          (project-level)
~/.archon/skills/review.md        (global)
```

```markdown
---
name: review
description: Performs a thorough code review of the current file or selection
scope: project
enabled: true
tags: [code-quality, review]
version: 1
---

# Code Review

Review the provided code for:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Code style and readability
- Missing error handling

Provide actionable feedback with specific line references.
```

### 4.2 Rich Skills (Directory)

A rich skill is a directory containing a SKILL.md and optional supporting files:

```
.archon/skills/deploy/
  SKILL.md              # Instructions + frontmatter metadata
  scripts/              # Executable code
    validate.py
    deploy.sh
  references/           # Context docs loaded on demand
    deployment-guide.md
  assets/               # Templates, configs
    dockerfile.template
```

### 4.3 Frontmatter Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier, lowercase, hyphens allowed (max 64 chars) |
| `description` | string | Yes | What the skill does and when to use it (max 1024 chars) |
| `scope` | `"global"` \| `"project"` | Yes | Where this skill is available |
| `enabled` | boolean | Yes | Whether the skill is active |
| `tags` | string[] | No | Categories for organization and filtering |
| `version` | number | No | Auto-incremented revision number |
| `trigger` | string | No | Activation condition for auto-detection (e.g., `"file:.py"`, `"repo:Dockerfile"`) |
| `tools` | string[] | No | Tools this skill is allowed to use |
| `model-invocable` | boolean | No | Whether the agent can auto-invoke this skill (default: true) |

### 4.4 Storage Locations

```
Project-level:  <workspace>/.archon/skills/
Global:         ~/.archon/skills/
```

Both locations are scanned. Project-level skills with the same name override global skills.

## 5. Skills Engine Architecture

### 5.1 Components

The skills engine lives in `packages/core/src/skills/` and consists of:

- **SkillLoader** — Scans skill directories, parses frontmatter, builds skill registry
- **SkillParser** — Parses SKILL.md files, validates frontmatter schema, extracts instructions
- **SkillExecutor** — Handles skill invocation: injects instructions into agent context, runs scripts
- **SkillDetector** — Analyzes user messages and current context to auto-detect relevant skills
- **SkillRegistry** — In-memory index of all available skills with metadata (progressive disclosure)

### 5.2 Progressive Disclosure

Following the pattern established by Claude Code and Codex:

1. **Always loaded**: Skill metadata (name, description, tags, trigger conditions)
2. **On invocation**: Full SKILL.md instructions injected into agent context
3. **On demand**: Scripts, references, and assets loaded only when the skill's instructions reference them

### 5.3 Skill Invocation Flow

```
User types "/review" or agent auto-detects relevance
  → SkillRegistry.find("review")
  → SkillParser.loadFull(skillPath)
  → SkillExecutor.invoke(skill, context)
    → Inject instructions into agent system prompt
    → If scripts: check security level → prompt or auto-execute
    → Agent processes with skill context active
  → Skill context removed after completion
```

### 5.4 Auto-Detection

The SkillDetector runs on each user message:

1. Compare message content against skill descriptions and tags
2. Check trigger conditions against current context (open file type, repo contents)
3. If confidence is high enough, auto-load the skill's instructions
4. The agent sees the skill as available context and uses it naturally

## 6. Agent Integration

### 6.1 Skill Invocation by Agent

The agent loop (in `packages/core/src/agent-loop.ts`) is extended with:

- A `skill_invoke` tool that the agent can call to activate a skill mid-conversation
- Skill metadata injected into the system prompt so the agent knows what's available
- Auto-detected skills appended as optional context

### 6.2 Skill Creation by Agent

A new tool `create_skill` is added to the agent's toolkit:

```
create_skill(name, description, scope, content, tags?)
```

The agent uses this tool when:
- The user explicitly asks: "save this as a skill" or "create a skill for X"
- The user approves a suggestion after the agent says: "I noticed you frequently ask me to [pattern]. Want me to save this as a skill?"

### 6.3 Post-Task Suggestion

After completing a task, the agent evaluates whether the task pattern is:
- Reusable (not one-off)
- Generalizable (not hyper-specific to current context)
- Not already covered by an existing skill

If so, it suggests: "This seems like a pattern worth saving. Want me to create a skill called '/[suggested-name]' for this?"

## 7. Skills Management UI

A new dedicated webview tab in the React app (`packages/vscode/src/webview/`).

### 7.1 Dashboard View

The main view shows all skills in a card/list layout:

- **Skill cards** showing: name, description, scope badge (global/project), enabled toggle, tags
- **Filter bar**: by scope (all/global/project), by tag, by enabled/disabled, search
- **Sort options**: name, recently used, recently modified
- **Quick actions** per card: enable/disable toggle, edit, duplicate, delete
- **Scope indicator**: visual distinction between global and project skills (e.g., color-coded badges)
- **"New Skill" button** prominently placed

### 7.2 Skill Editor

Clicking a skill card opens the editor view:

- **Split pane**: Form-based metadata editor (left) + markdown content editor (right)
- **Metadata form**: Name, description, scope dropdown, tags input, trigger condition, enabled toggle
- **Content editor**: Syntax-highlighted markdown editor with preview toggle
- **For rich skills**: File tree showing scripts/, references/, assets/ with ability to add/edit/delete files
- **Save/Cancel** actions with validation
- **Version history** sidebar showing past revisions with diff view

### 7.3 Organization

- **Drag-and-drop reordering** within the dashboard (affects priority for auto-detection)
- **Tag management**: Create, rename, delete, color-code tags
- **Bulk actions**: Enable/disable multiple skills, change scope, apply tags

### 7.4 Template Gallery

Accessed via "New Skill" → "From Template":

- Grid of template cards with preview
- Categories: Code Quality, Testing, Documentation, DevOps, Refactoring, etc.
- Each template is a complete skill that users can customize after installing
- Templates are bundled with the extension (not fetched remotely)

### 7.5 Conversation-to-Skill Wizard

Accessed from the Chat view after a conversation:

1. User clicks "Convert to Skill" button (appears in chat toolbar after meaningful exchanges)
2. The agent analyzes the conversation to extract:
   - The pattern/workflow that was performed
   - Key instructions and constraints
   - Tools that were used
3. A wizard dialog shows:
   - Suggested skill name and description
   - Generated SKILL.md content (editable)
   - Scope selection (global/project)
   - Tag suggestions
4. User reviews, edits if needed, and saves
5. Skill appears immediately in the Skills dashboard

## 8. Built-in Template Gallery

Starter skills that ship with Archon (users can customize or delete):

| Template | Description |
|----------|-------------|
| `code-review` | Thorough code review with security, performance, and style checks |
| `write-tests` | Generate unit tests for selected code or file |
| `refactor` | Suggest and apply refactoring improvements |
| `explain-code` | Explain complex code in plain language |
| `document` | Generate documentation for functions, classes, or modules |
| `fix-bugs` | Analyze and fix bugs based on error messages or failing tests |
| `optimize` | Performance optimization suggestions and implementation |
| `security-audit` | Security-focused review (OWASP top 10, dependency vulnerabilities) |
| `git-commit` | Generate meaningful commit messages from staged changes |
| `api-design` | Design REST/GraphQL API endpoints from requirements |
| `database-schema` | Design or review database schemas |
| `debug-helper` | Systematic debugging workflow with logging and breakpoint suggestions |
| `migration-guide` | Help migrate code between frameworks, versions, or languages |
| `pr-description` | Generate pull request descriptions from branch diff |
| `code-standards` | Enforce project-specific coding standards and conventions |
| `brainstorm` | Interactive brainstorming session with structured phases (seed, discovery, exploration, expansion, crystallize) that produces an actionable plan document |

## 9. Skill Versioning

### 9.1 How It Works

- Every save increments the `version` field in frontmatter
- Previous versions are stored in `.archon/skills/.history/<skill-name>/`
- Each version is a timestamped copy: `<skill-name>.v3.2026-03-05T12-00-00.md`
- Maximum 20 versions retained per skill (oldest pruned automatically)

### 9.2 UI Integration

- Version history sidebar in the skill editor
- Click any version to view it read-only
- "Diff" button to compare any two versions
- "Restore" button to rollback to a previous version (creates a new version)

## 10. Security Model

Skill script execution integrates with Archon's existing security manager:

| Security Level | Script Behavior |
|----------------|----------------|
| **YOLO (Yellow)** | Scripts execute without prompting |
| **Normal** | User is prompted before each script execution with a preview of what will run |
| **Strict** | Scripts are blocked entirely; only prompt-injection skills are allowed |

The prompt shows:
- Script filename and language
- Script content (syntax highlighted)
- Working directory
- "Run" / "Skip" / "Always allow this skill's scripts" options

## 11. Implementation Phases

### Phase 1: Core Engine
- Skill format specification (frontmatter schema, validation)
- SkillLoader + SkillParser (scan directories, parse SKILL.md files)
- SkillRegistry (in-memory index with progressive disclosure)
- Storage locations (project + global)
- Basic slash command invocation (`/skill-name`)

### Phase 2: Agent Integration
- `skill_invoke` tool for the agent
- `create_skill` tool for the agent
- Auto-detection (SkillDetector)
- Post-task skill suggestion logic
- Skill context injection into agent system prompt

### Phase 3: Skills Management UI
- Dedicated webview tab with React components
- Dashboard view (card list, filters, search, enable/disable toggles)
- Skill editor (metadata form + markdown editor)
- New skill creation flow
- Template gallery with built-in templates

### Phase 4: Advanced Features
- Conversation-to-Skill wizard
- Skill versioning + rollback
- Drag-and-drop organization
- Tag management
- Rich skill support (directory with scripts)
- Script execution with security level integration

## 12. Open Questions

1. **Slash command prefix**: Should it be `/` (familiar) or something else to avoid conflicts with existing commands?
2. **Skill size limits**: Should we enforce a max SKILL.md size to prevent context window bloat?
3. **Skill isolation**: Should each skill invocation get a clean context, or can skills build on each other within a conversation?
4. **Template updates**: Should built-in templates update with extension updates, or stay as the user customized them?
5. **Trigger syntax**: What's the exact DSL for trigger conditions? (e.g., `file:.py`, `repo:has:Dockerfile`, `branch:main`)
6. **Auto-detection confidence threshold**: What level of confidence should the agent need before auto-loading a skill?
