# Archon Feature Plan: Addressing AI-Assisted Development Pain Points

## Vision

Archon's differentiator in the crowded AI coding assistant market is the intersection of **memory + quality + developer control**. While Copilot, Cursor, and others race to generate more code faster, Archon focuses on **finishing what it starts, verifying its own work, and catching bugs before you do**.

This plan introduces three new skill templates that directly address the top developer frustrations identified through research across 50K+ developers (Stack Overflow 2025 Survey, Reddit r/programming, IEEE Spectrum, expert blogs from Addy Osmani and Martin Fowler, and industry reports from Qodo, Atlassian, and Augment Code).

**The core insight**: The #1 frustration isn't that AI writes bad code — it's that AI declares "done" when it isn't, never validates its work, and leaves developers to discover the gaps themselves.

## Problem Statement

### Research Findings (2025-2026)

| Pain Point | Severity | Source |
|---|---|---|
| "Almost right" code — subtle bugs, wrong APIs, hallucinated deps | 66% of devs | Stack Overflow 2025 |
| Context amnesia — AI forgets project context mid-session | 44% blame context issues | Qodo State of AI Code Quality |
| Team standards inconsistency | 40% frustrated | Qodo Report |
| Security vulnerabilities in AI code | 48% of AI code | IEEE Spectrum |
| Flow state destruction | 386 upvotes on Reddit | r/programming |
| Multi-file operations broken | Top complaint in Copilot vs Cursor comparisons | DEV Community, DigitalOcean |
| No quality gates / test integration | "One goal for 2026" | Addy Osmani |
| Token/cost anxiety — incomplete work | $150-300+/month, still running out | Cursor users, Reddit |
| Productivity illusion — 19% slower but think faster | Controlled study | Anthropic/METR |
| No learning from corrections | Repeated mistakes | Multiple sources |
| Autonomy without guardrails | Edits wrong files | Multiple sources |
| QA role missing from AI development | No existing tool does this | Gap in market |

### The Three Core Problems This Plan Addresses

1. **Premature Completion**: AI declares "done" at ~50% of actual work. Builds core logic but skips integration wiring (UI hookups, imports, routing, config), then tells you to test an app that isn't wired up.

2. **No Self-Validation**: AI never checks its output against the original plan. There's no "did I actually do what I said I would?" step. The developer becomes the quality gate.

3. **Missing QA Role**: No AI coding tool acts as a QA analyst. Browser-based testing, edge case discovery, responsive layout checks, accessibility audits, and form validation testing are entirely absent from the AI development workflow.

## Feature 1: Plan-Aware Task Executor (`/execute-plan`)

### What It Does

A skill that takes a markdown plan document and executes it step-by-step, tracking progress with a real-time completion score. Unlike current AI tools that lose track of multi-step tasks, this executor:

- Parses the plan into discrete, trackable tasks
- Executes each task in order
- Maintains a running completion score
- Does NOT declare "done" until all tasks are complete
- Persists state so work survives session boundaries

### Skill Template Design

```
name: execute-plan
description: Execute a markdown plan step-by-step with progress tracking and completion scoring. Reads plan tasks, executes each one, and ensures nothing is skipped or left incomplete.
scope: project
tags: [execution, planning, automation]
trigger: repo:docs/plans
model-invocable: true
```

### How It Works

1. **Plan Parsing**: Reads a markdown plan file and extracts tasks from headings, checkboxes, or numbered lists. Each task becomes a trackable work item.

2. **Execution Loop**: For each task:
   - Mark task as "in progress"
   - Execute the task (write code, create files, modify config, etc.)
   - After execution, do a quick self-check: "Does this task's output exist in the codebase?"
   - Mark task as "done" only after self-check passes
   - Move to next task

3. **Completion Score**: A 0-100% score calculated as `(verified_complete_tasks / total_tasks) * 100`. The score accounts for:
   - Task code exists in codebase (files created/modified)
   - No orphaned code (new modules are imported/referenced somewhere)
   - No build-breaking changes (if build command is available)

4. **Integration Awareness**: The executor specifically checks for the "missing wiring" problem:
   - New components are imported somewhere
   - New routes are registered in the router
   - New API endpoints are connected to the frontend
   - New config values are referenced where needed
   - UI components are rendered in a parent component

5. **Session Persistence**: Plan state is saved to `.archon/plans/<plan-name>.state.md` so work can resume across sessions. The state file tracks which tasks are done, in-progress, or pending.

### Plan Format

Plans are standard markdown files. The executor understands several formats:

```markdown
# Feature: User Authentication

## Phase 1: Backend
- [ ] Create User model with email, password hash, created_at
- [ ] Implement bcrypt password hashing utility
- [ ] Build POST /api/auth/register endpoint
- [ ] Build POST /api/auth/login endpoint with JWT
- [ ] Add auth middleware for protected routes

## Phase 2: Frontend
- [ ] Create LoginForm component with email/password fields
- [ ] Create RegisterForm component
- [ ] Add auth context provider with token storage
- [ ] Wire login form to POST /api/auth/login
- [ ] Add protected route wrapper component
- [ ] Add login/register pages to router

## Phase 3: Integration
- [ ] Connect auth middleware to existing API routes
- [ ] Add logout button to navbar
- [ ] Redirect unauthenticated users to login page
```

### Key Design Decisions

- **Markdown as source of truth**: Plans are human-readable, version-controllable, and editable. No proprietary format.
- **Completion score is verification-based**: Not based on the AI saying "I did it" — based on checking the codebase.
- **Integration checks are the secret sauce**: This is what solves the "builds core but skips wiring" problem.

## Feature 2: Plan Self-Validator (`/validate-plan`)

### What It Does

A skill that audits completed work against the original plan by comparing the plan document to the actual git diff of the branch. It's essentially an **AI code reviewer that reviews against the spec, not just code quality**.

### Skill Template Design

```
name: validate-plan
description: Audit completed work against the original plan. Reads the plan, analyzes the git diff, and identifies gaps where the plan says something should exist but it doesn't. Auto-fixes gaps when found.
scope: project
tags: [validation, quality, review]
model-invocable: true
```

### How It Works

1. **Input Gathering**:
   - Read the plan document (markdown file)
   - Run `git diff main...HEAD` (or appropriate base branch) to get all changes
   - Optionally read the task execution history from the executor's state file

2. **LLM-Powered Audit**: Send the plan + diff to the LLM with a structured prompt:
   - "Here is the plan that was supposed to be implemented"
   - "Here is the git diff of what was actually implemented"
   - "For each plan item, determine: DONE (implemented correctly), PARTIAL (started but incomplete), MISSING (not implemented at all), or WRONG (implemented incorrectly)"

3. **Gap Report**: Generate a structured report:
   ```
   Plan Validation Report
   =====================
   Overall: 7/10 tasks complete (70%)

   DONE:
   - [x] Create User model
   - [x] Implement bcrypt utility
   - [x] Build register endpoint
   ...

   PARTIAL:
   - [~] Auth context provider — created but missing token refresh logic

   MISSING:
   - [ ] Redirect unauthenticated users to login page
   - [ ] Add logout button to navbar

   WRONG:
   - [!] Auth middleware — checks token but doesn't verify expiry
   ```

4. **Auto-Fix Loop**: For each PARTIAL, MISSING, or WRONG item:
   - Generate a fix task
   - Execute the fix
   - Re-validate just that item
   - Continue until all items are DONE or the fix attempt limit is reached (default: 3 attempts per item)

5. **Chain to QA** (optional): After auto-fix completes, optionally trigger the QA Analyst skill to verify fixes in the browser.

### Key Design Decisions

- **Git diff as ground truth**: The validator doesn't trust the AI's memory of what it did — it reads the actual code changes.
- **LLM-powered comparison**: No fragile regex matching. The LLM understands semantic equivalence (e.g., plan says "password hashing" and code uses bcrypt — that's a match).
- **Auto-fix is bounded**: Maximum 3 fix attempts per item prevents infinite loops.
- **Separate from executor**: Can be used independently on any branch, not just executor-managed plans. Useful for validating manual work or other AI tool output too.

## Feature 3: AI QA Analyst (`/qa-test`)

### What It Does

A full QA analyst persona that uses Playwright (via MCP) to test web applications in a real browser. It reads the plan + git diff to understand what was built, launches the app, and systematically tests it — finding edge cases, checking responsive layouts, verifying forms, and reporting bugs with screenshots and repro steps.

### Skill Template Design

```
name: qa-test
description: AI QA analyst that tests your web app in a real browser. Reads the plan and git diff to understand what changed, auto-detects the dev server, then systematically tests the app — finding edge cases, checking forms, responsive layouts, and accessibility. Reports bugs inline with screenshots.
scope: project
tags: [testing, qa, browser, playwright]
trigger: repo:package.json
model-invocable: true
```

### How It Works

1. **Context Gathering**:
   - Read the plan document to understand WHAT should work
   - Read the git diff to understand WHERE changes were made
   - Combine into a test context: "These features were built, test them"

2. **App Auto-Detection & Launch**:
   - Scan `package.json` for dev scripts (`dev`, `start`, `serve`)
   - Check for common frameworks: Next.js (`next dev`), Vite (`vite`), CRA (`react-scripts start`), etc.
   - Start the dev server via `run_terminal`
   - Wait for the server to be ready (poll the URL)
   - Detect the local URL from server output or common defaults (localhost:3000, :5173, :8080)

3. **Test Strategy Generation**: Based on plan + diff, generate a test strategy:
   - **Happy path**: Test each feature as described in the plan
   - **Edge cases**: Empty inputs, very long strings, special characters, rapid clicks
   - **Responsive**: Test at mobile (375px), tablet (768px), and desktop (1280px) widths
   - **Accessibility**: Check for ARIA labels, keyboard navigation, focus management
   - **Error states**: Invalid inputs, network failures (if applicable), boundary conditions
   - **Navigation**: All new routes are reachable, back button works, deep links work

4. **Browser Testing Loop** (via Playwright MCP):
   - Navigate to the app
   - Take accessibility snapshots to understand the page structure
   - Interact with elements: fill forms, click buttons, navigate between pages
   - Take screenshots at key moments (before/after actions, error states)
   - Check console for JavaScript errors
   - Verify visual elements are present and positioned correctly

5. **Bug Reporting**: Report findings inline in the chat:
   - Screenshot of the issue
   - Steps to reproduce
   - Expected vs actual behavior
   - Severity (critical / major / minor / cosmetic)
   - Suggested fix (when possible)

6. **QA Memory** (leveraging Archon's memory system):
   - Remember the app's page structure across QA sessions
   - Learn common navigation flows (login, dashboard, settings)
   - Track known issues to avoid re-reporting fixed bugs
   - Build a mental model of the app's critical paths over time

### Test Persona Modes

The QA analyst can focus on specific aspects:

- **General QA** (default): Broad testing across all categories
- **Security focus**: XSS via input fields, CSRF token presence, auth bypass attempts, exposed API keys in source
- **Accessibility focus**: WCAG 2.1 AA compliance, screen reader compatibility, color contrast, keyboard navigation
- **Edge case focus**: Boundary values, empty states, concurrent actions, browser back/forward
- **Mobile focus**: Responsive breakpoints, touch targets, viewport behavior, orientation changes

### Key Design Decisions

- **Plan + diff combined context**: Plan tells it WHAT should work, diff tells it WHERE to look. This is more effective than either alone.
- **Auto-detect dev server**: Zero config for common setups. Reads package.json, figures out the right command.
- **Chat inline output**: Bug reports appear in the conversation — no separate dashboard needed. Screenshots are embedded.
- **QA memory via Archon's memory system**: The QA analyst gets smarter over time by remembering the app's structure, reducing redundant testing and focusing on what changed.
- **Validator chain**: When used after the validator, QA only needs to test the areas that were fixed — not the entire app.

## Integration Model: Archon Skill Templates

All three features ship as **built-in skill templates** in `packages/core/src/skills/skill-templates.ts`, alongside the existing 16 templates (code-review, write-tests, refactor, etc.).

### How They Work Together

```
Developer writes plan (or uses /brainstorm to generate one)
         |
         v
  /execute-plan — executes all tasks with completion tracking
         |
         v
  /validate-plan — audits work against plan via git diff
         |
    [gaps found?]
     /        \
   yes         no
    |           |
    v           v
 auto-fix    /qa-test (optional)
    |           |
    v           v
 re-validate   browser testing
    |           |
    v           v
  [done]     bug report + fix cycle
```

### Standalone Usage

Each skill works independently:
- `/execute-plan` — Use when you have a plan and want tracked execution
- `/validate-plan` — Use on any branch to audit work against a spec (even work done by other tools or manually)
- `/qa-test` — Use anytime to get a QA pass on your web app, with or without a plan

### Skill Composition

Users can chain skills manually:
```
/execute-plan docs/plans/auth-feature.md
/validate-plan docs/plans/auth-feature.md
/qa-test
```

Or the executor can be configured to automatically chain:
- After execution completes, suggest running validation
- After validation passes, suggest running QA (for web apps)

## Expansion Features (Post-MVP)

### Completion Score UI
Real-time completion percentage shown in the VS Code status bar (e.g., "Plan: 5/8 tasks - 62%"). Clicking opens a panel showing task-by-task status.

### QA-Validator Chain
When the validator auto-fixes gaps, it optionally triggers a QA re-test on just the fixed areas. This creates a self-healing loop: execute -> validate -> fix -> QA -> fix -> done.

### QA App Memory
QA analyst uses Archon's existing memory system (SQLite, sessions, preferences) to remember:
- App page structure and navigation flows
- Previously found bugs and their fix status
- Critical paths that should always be tested
- Login credentials for authenticated testing

## Pain Points Addressed

| Feature | Pain Points Solved | How |
|---|---|---|
| Execute Plan | #5 Flow state, #6 Multi-file ops, #8 Token anxiety, #9 Productivity illusion | Tracked execution, integration checks, session persistence, measurable progress |
| Validate Plan | #1 "Almost right" code, #2 Context amnesia, #3 Team standards, #11 Guardrails | Git diff audit, plan-vs-reality comparison, auto-fix with bounds |
| QA Analyst | #4 Security vulns, #7 No quality gates, #12 Missing QA role | Browser testing, edge cases, security checks, accessibility audits |
| All three together | #10 Learning from corrections | Memory system tracks what was wrong and how it was fixed |

## Open Questions

1. **Plan parsing robustness**: How flexible should the markdown parser be? Should it handle free-form prose plans, or require structured checkbox/list format?

2. **Auto-fix limits**: Is 3 attempts per item the right bound? Should it be configurable?

3. **QA test duration**: Full QA can take a while. Should there be a "quick" mode (smoke test) vs "thorough" mode (full QA)?

4. **Dev server lifecycle**: Should the QA skill manage the dev server lifecycle (start before, stop after), or assume it's already running?

5. **Multi-framework support**: The QA analyst is browser-focused. How should it handle non-web projects (CLI tools, libraries, APIs)?

6. **Validation without git**: What if the project doesn't use git, or the developer is working on uncommitted changes? Should the validator fall back to file system analysis?

## Research Sources

- [Stack Overflow 2025 Developer Survey — AI Section](https://survey.stackoverflow.co/2025/ai/)
- [Stack Overflow Blog — Developers remain willing but reluctant](https://stackoverflow.blog/2025/12/29/developers-remain-willing-but-reluctant-to-use-ai-the-2025-developer-survey-results-are-here/)
- [Qodo — State of AI Code Quality 2025](https://www.qodo.ai/reports/state-of-ai-code-quality/)
- [IEEE Spectrum — AI Coding Degrades: Silent Failures Emerge](https://spectrum.ieee.org/ai-coding-degrades)
- [Cerbos — The Productivity Paradox of AI Coding Assistants](https://www.cerbos.dev/blog/productivity-paradox-of-ai-coding-assistants)
- [Addy Osmani — My LLM Coding Workflow Going Into 2026](https://addyosmani.com/blog/ai-coding-workflow/)
- [Martin Fowler — How Far Can We Push AI Autonomy in Code Generation](https://martinfowler.com/articles/pushing-ai-autonomy.html)
- [Simon Willison — Hallucinations in Code](https://simonwillison.net/2025/Mar/2/hallucinations-in-code/)
- [Factory.ai — The Context Window Problem](https://factory.ai/news/context-window-problem)
- [Augment Code — Enterprise Coding Standards for AI-Ready Teams](https://www.augmentcode.com/guides/enterprise-coding-standards-12-rules-for-ai-ready-teams)
- [Atlassian — Developer Experience Report 2025](https://www.atlassian.com/blog/developer/developer-experience-report-2025)
- [Faros AI — Best AI Coding Agents for 2026](https://www.faros.ai/blog/best-ai-coding-agents-2026)
- [Reddit r/programming — AI Coding Killed My Flow State](https://www.reddit.com/r/programming/comments/1r2l8i5/ai_coding_killed_my_flow_state/) (386 votes, 174 comments)
- [Reddit r/programming — Anthropic: AI Assisted Coding Doesn't Show Efficiency Gains](https://www.reddit.com/r/programming/comments/1qqxvlw/anthropic_ai_assisted_coding_doesnt_show/) (4K votes, 700 comments)
- [Reddit r/programming — Newer AI Coding Assistants Are Failing in Insidious Ways](https://www.reddit.com/r/programming/comments/1qdv6h0/newer_ai_coding_assistants_are_failing_in/) (463 votes, 188 comments)
