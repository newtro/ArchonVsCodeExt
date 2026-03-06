/**
 * Built-in skill templates that ship with Archon.
 * Users can create skills from these templates and customize them.
 */

export interface SkillTemplate {
  name: string;
  description: string;
  tags: string[];
  trigger?: string;
  content: string;
}

export function getBuiltInSkillTemplates(): SkillTemplate[] {
  return TEMPLATES;
}

const TEMPLATES: SkillTemplate[] = [
  {
    name: 'code-review',
    description: 'Thorough code review with security, performance, and style checks',
    tags: ['code-quality', 'review'],
    content: `# Code Review

Review the provided code thoroughly. Check for:

## Correctness
- Logic errors and edge cases
- Off-by-one errors, null/undefined handling
- Race conditions or concurrency issues

## Security
- Input validation and sanitization
- SQL injection, XSS, command injection vulnerabilities
- Hardcoded secrets or credentials
- Insecure dependencies

## Performance
- Unnecessary re-renders or recomputations
- N+1 queries, missing indexes
- Memory leaks, unclosed resources
- Algorithmic complexity issues

## Code Quality
- Naming clarity and consistency
- DRY violations and unnecessary abstractions
- Error handling completeness
- Test coverage gaps

Provide actionable feedback with specific line references. Categorize issues by severity: critical, warning, suggestion.`,
  },
  {
    name: 'write-tests',
    description: 'Generate unit tests for selected code or file',
    tags: ['testing', 'code-quality'],
    content: `# Write Tests

Generate comprehensive unit tests for the provided code.

## Guidelines
1. **Read the code** carefully to understand all branches and edge cases
2. **Identify the testing framework** already in use (Jest, Vitest, pytest, etc.)
3. **Follow existing test patterns** in the project
4. **Cover these scenarios:**
   - Happy path / normal operation
   - Edge cases (empty input, boundary values, null/undefined)
   - Error conditions and exception handling
   - Input validation
5. **Use descriptive test names** that explain the expected behavior
6. **Mock external dependencies** (APIs, databases, file system) appropriately
7. **Avoid testing implementation details** — test behavior, not internals
8. **Run the tests** after writing them to verify they pass`,
  },
  {
    name: 'refactor',
    description: 'Suggest and apply refactoring improvements',
    tags: ['code-quality', 'refactoring'],
    content: `# Refactor Code

Analyze the provided code and suggest refactoring improvements.

## Process
1. **Read and understand** the current code thoroughly
2. **Identify issues:**
   - Duplicated logic that can be extracted
   - Long functions that should be split
   - Complex conditionals that can be simplified
   - Poor naming that reduces readability
   - Tight coupling between components
   - Missing abstractions or over-abstraction
3. **Propose changes** with clear rationale for each
4. **Apply refactoring** incrementally — one change at a time
5. **Verify** the refactored code still passes all tests
6. **Preserve behavior** — refactoring must not change functionality

## Principles
- Favor readability over cleverness
- Extract only when there's genuine duplication (3+ occurrences)
- Keep functions focused on a single responsibility
- Prefer composition over inheritance`,
  },
  {
    name: 'explain-code',
    description: 'Explain complex code in plain language',
    tags: ['documentation', 'learning'],
    content: `# Explain Code

Explain the provided code clearly and thoroughly.

## Structure your explanation:
1. **Overview** — What does this code do at a high level? (1-2 sentences)
2. **Key concepts** — What patterns, algorithms, or techniques does it use?
3. **Step-by-step walkthrough** — Walk through the logic flow
4. **Data flow** — How does data move through the code?
5. **Dependencies** — What external libraries or APIs does it rely on?
6. **Edge cases** — What special cases does it handle?
7. **Potential issues** — Any bugs, performance concerns, or improvements?

## Guidelines
- Use simple, non-jargon language where possible
- Include analogies for complex concepts
- Reference specific line numbers
- If the code is part of a larger system, explain how it fits in`,
  },
  {
    name: 'document',
    description: 'Generate documentation for functions, classes, or modules',
    tags: ['documentation'],
    content: `# Generate Documentation

Create clear, comprehensive documentation for the provided code.

## For functions/methods:
- Purpose and behavior description
- Parameter descriptions with types and constraints
- Return value description
- Thrown exceptions/errors
- Usage examples
- Edge cases and gotchas

## For classes:
- Class purpose and responsibility
- Constructor parameters
- Public API (methods and properties)
- Usage examples
- Relationship to other classes

## For modules/files:
- Module overview and purpose
- Exported API surface
- Configuration options
- Dependencies
- Usage examples

## Style
- Follow the project's existing documentation conventions
- Use JSDoc/TSDoc/docstring format as appropriate
- Keep descriptions concise but complete
- Include code examples that can be copied and run`,
  },
  {
    name: 'fix-bugs',
    description: 'Analyze and fix bugs based on error messages or failing tests',
    tags: ['debugging', 'fix'],
    content: `# Fix Bugs

Systematically diagnose and fix the reported bug.

## Process
1. **Reproduce** — Understand the bug from the error message, stack trace, or failing test
2. **Locate** — Find the relevant source code using search tools
3. **Diagnose** — Trace the root cause:
   - Read the failing code and its dependencies
   - Check recent changes (git log/diff) that might have introduced the bug
   - Look for similar patterns elsewhere that work correctly
4. **Fix** — Apply the minimal change that fixes the root cause
5. **Verify** — Run the failing test or reproduce steps to confirm the fix
6. **Check for regressions** — Run related tests to ensure nothing else broke
7. **Explain** — Summarize what caused the bug and how the fix addresses it

## Guidelines
- Fix the root cause, not the symptom
- Keep the fix minimal — don't refactor while fixing
- If the bug reveals a missing test, add one`,
  },
  {
    name: 'optimize',
    description: 'Performance optimization suggestions and implementation',
    tags: ['performance', 'optimization'],
    content: `# Optimize Performance

Analyze the provided code for performance issues and apply optimizations.

## Analysis
1. **Profile first** — Identify actual bottlenecks, don't guess
2. **Check for common issues:**
   - Unnecessary re-renders (React: missing memo, unstable references)
   - Redundant computations (cache/memoize expensive operations)
   - N+1 queries (batch database calls)
   - Large bundle size (lazy loading, tree shaking)
   - Memory leaks (unclosed streams, event listeners, timers)
   - Blocking operations on the main thread

## Optimization Guidelines
- Measure before and after each change
- Optimize the hot path first
- Trade memory for speed only when justified
- Document why each optimization was made
- Ensure correctness is preserved`,
  },
  {
    name: 'security-audit',
    description: 'Security-focused review covering OWASP top 10 and dependency vulnerabilities',
    tags: ['security', 'audit'],
    content: `# Security Audit

Perform a security-focused review of the provided code.

## Check for OWASP Top 10:
1. **Injection** — SQL, NoSQL, OS command, LDAP injection
2. **Broken Authentication** — Weak passwords, session management
3. **Sensitive Data Exposure** — Unencrypted data, hardcoded secrets
4. **XML External Entities** — XXE attacks
5. **Broken Access Control** — Missing authorization checks
6. **Security Misconfiguration** — Default credentials, verbose errors
7. **XSS** — Reflected, stored, DOM-based cross-site scripting
8. **Insecure Deserialization** — Untrusted data deserialization
9. **Vulnerable Components** — Known CVEs in dependencies
10. **Insufficient Logging** — Missing audit trails

## Additional Checks:
- CSRF protection
- Rate limiting
- Input validation and sanitization
- Secure headers (CSP, HSTS, etc.)
- Dependency audit (npm audit, pip-audit)

## Output
Categorize findings by severity: Critical, High, Medium, Low.
Provide specific remediation steps for each finding.`,
  },
  {
    name: 'git-commit',
    description: 'Generate meaningful commit messages from staged changes',
    tags: ['git', 'workflow'],
    trigger: 'repo:.git',
    content: `# Generate Commit Message

Create a well-structured commit message for the current staged changes.

## Process
1. Run \`git diff --staged\` to see what's being committed
2. Analyze the changes to understand the intent
3. Generate a commit message following conventional commits format:

## Format
\`\`\`
type(scope): concise description

Optional longer explanation of what changed and why.
\`\`\`

## Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation only
- **style**: Formatting, no code change
- **refactor**: Code restructuring, no behavior change
- **test**: Adding or updating tests
- **chore**: Build, CI, dependencies, tooling

## Guidelines
- Subject line: max 72 characters, imperative mood
- Body: wrap at 72 characters, explain "why" not "what"
- Reference issue numbers if applicable`,
  },
  {
    name: 'api-design',
    description: 'Design REST or GraphQL API endpoints from requirements',
    tags: ['api', 'design'],
    content: `# API Design

Design API endpoints based on the provided requirements.

## REST API Design
For each endpoint, specify:
- **Method** (GET, POST, PUT, PATCH, DELETE)
- **Path** (following RESTful naming: plural nouns, hierarchical)
- **Request body** (JSON schema with types and validation)
- **Response body** (JSON schema with example)
- **Status codes** (success and error cases)
- **Authentication** requirements
- **Rate limiting** considerations

## Design Principles
- Use consistent naming conventions
- Version the API (e.g., /v1/)
- Use appropriate HTTP methods and status codes
- Support pagination for list endpoints
- Include filtering and sorting where applicable
- Design for idempotency where possible
- Document error response format

## Output
Provide the complete API specification in a format that can be used as documentation or converted to OpenAPI/Swagger.`,
  },
  {
    name: 'database-schema',
    description: 'Design or review database schemas',
    tags: ['database', 'design'],
    content: `# Database Schema Design

Design or review a database schema based on requirements.

## Process
1. Identify entities and their attributes
2. Define relationships (one-to-one, one-to-many, many-to-many)
3. Choose appropriate data types
4. Define primary keys and indexes
5. Apply normalization rules (aim for 3NF unless denormalization is justified)
6. Consider constraints (NOT NULL, UNIQUE, CHECK, FOREIGN KEY)

## Review Checklist
- Are all relationships properly modeled?
- Are indexes defined for frequently queried columns?
- Is the schema normalized appropriately?
- Are naming conventions consistent?
- Are cascading deletes/updates configured correctly?
- Is there a migration strategy for schema changes?
- Are soft deletes preferred over hard deletes?

## Output
Provide the schema as CREATE TABLE statements or migration files matching the project's ORM.`,
  },
  {
    name: 'debug-helper',
    description: 'Systematic debugging workflow with logging and breakpoint suggestions',
    tags: ['debugging'],
    content: `# Debug Helper

Systematic debugging workflow for tracking down issues.

## Step 1: Gather Information
- What is the expected behavior?
- What is the actual behavior?
- When did it start failing? (check recent git changes)
- Is it reproducible? Under what conditions?

## Step 2: Isolate the Problem
- Add strategic logging/console.log at key points
- Check input data at each stage of the pipeline
- Binary search: comment out half the code to narrow down
- Check environment differences (dev vs prod, OS, versions)

## Step 3: Common Debugging Strategies
- **Stack trace analysis** — Read from bottom to top
- **Rubber duck debugging** — Explain the code flow step by step
- **Git bisect** — Find the exact commit that introduced the bug
- **Minimal reproduction** — Strip away unrelated code
- **Check assumptions** — Verify types, values, and states at runtime

## Step 4: Fix and Verify
- Apply the minimal fix
- Add a test that reproduces the original bug
- Run the full test suite
- Remove any debugging artifacts (console.logs, breakpoints)`,
  },
  {
    name: 'migration-guide',
    description: 'Help migrate code between frameworks, versions, or languages',
    tags: ['migration', 'upgrade'],
    content: `# Migration Guide

Help migrate code from one framework, version, or language to another.

## Process
1. **Audit** — Catalog all code that needs to change
2. **Research** — Look up the migration guide for the target version/framework
3. **Plan** — Create a step-by-step migration plan:
   - Breaking changes to address
   - Deprecated APIs to replace
   - New patterns to adopt
   - Dependencies to update
4. **Execute** — Apply changes incrementally:
   - Update one module at a time
   - Run tests after each change
   - Keep the app functional throughout
5. **Verify** — Run the full test suite and manual smoke tests

## Guidelines
- Never migrate everything at once — do it incrementally
- Use codemods where available
- Keep a rollback plan
- Document any behavior changes
- Update related documentation`,
  },
  {
    name: 'pr-description',
    description: 'Generate pull request descriptions from branch diff',
    tags: ['git', 'documentation'],
    trigger: 'repo:.git',
    content: `# Generate PR Description

Create a comprehensive pull request description.

## Process
1. Run \`git log main..HEAD --oneline\` to see all commits
2. Run \`git diff main...HEAD --stat\` to see changed files
3. Analyze the changes to understand the full scope

## PR Template
\`\`\`markdown
## Summary
[1-3 sentence overview of what this PR does and why]

## Changes
- [Bullet list of key changes]

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing performed
- [ ] Edge cases considered

## Screenshots
[If UI changes, include before/after screenshots]

## Notes
[Any additional context, deployment considerations, or follow-up work]
\`\`\`

## Guidelines
- Focus on "why" not "what" (reviewers can see the diff)
- Call out any risky changes or areas needing careful review
- Link related issues or discussions
- Keep it concise but complete`,
  },
  {
    name: 'code-standards',
    description: 'Enforce project-specific coding standards and conventions',
    tags: ['code-quality', 'standards'],
    content: `# Code Standards Enforcement

Review code against the project's coding standards and conventions.

## Checks
1. **Read project configuration** — Check .editorconfig, eslint/prettier configs, tsconfig
2. **Naming conventions:**
   - Variables: camelCase (or project convention)
   - Functions: camelCase (or project convention)
   - Classes: PascalCase
   - Constants: UPPER_SNAKE_CASE
   - Files: match project convention (kebab-case, camelCase, etc.)
3. **Code organization:**
   - Import ordering (external → internal → relative)
   - File structure follows project patterns
   - Exports are clean and intentional
4. **Error handling:**
   - Errors are caught and handled appropriately
   - No swallowed errors (empty catch blocks)
   - User-facing errors are descriptive
5. **TypeScript/Type safety:**
   - No \`any\` types without justification
   - Proper null checks
   - Discriminated unions over type assertions

Apply fixes automatically where possible. Flag items that need human judgment.`,
  },
  {
    name: 'brainstorm',
    description: 'Interactive brainstorming session with structured phases that produces an actionable plan',
    tags: ['planning', 'ideation'],
    content: `# Brainstorm

Run an interactive brainstorming session through structured phases.

## Phase 1: Seed
Capture the initial idea. Ask clarifying questions to understand the core concept.

## Phase 2: Discovery
Understand goals, context, and motivation through focused questions:
- What problem does this solve?
- Who is the target audience?
- What does success look like?
- What prior art exists?

## Phase 3: Exploration
Dig into details, constraints, and tradeoffs:
- Technical constraints and requirements
- Alternative approaches
- Dependencies and integration points
- Non-goals and out-of-scope items

## Phase 4: Expansion
Suggest bold, creative ideas that stretch beyond the original vision:
- Present 3-4 suggestions per round
- Include ambitious ideas, not just safe ones
- Let the user pick which to adopt

## Phase 5: Crystallize
Produce the final plan document:
- Vision and problem statement
- Goals and non-goals
- Architecture overview
- Key decisions made
- Implementation phases
- Risks and mitigations
- Open questions

Save the plan to a file the user can reference during implementation.`,
  },
  {
    name: 'execute-plan',
    description: 'Execute a markdown plan step-by-step with progress tracking and completion scoring. Reads plan tasks, executes each one, verifies integration wiring, and ensures nothing is skipped or left incomplete.',
    tags: ['execution', 'planning', 'automation'],
    content: `# Execute Plan

Execute a markdown plan document step-by-step with rigorous progress tracking.

## Startup

1. **Load the plan**: Read the plan file specified by the user (or find the most recent plan in docs/plans/ or .archon/plans/)
2. **Parse tasks**: Extract all tasks from headings, checkboxes, or numbered lists. Each becomes a trackable work item.
3. **Check for prior state**: Look for a state file at \`.archon/plans/<plan-name>.state.md\`. If found, resume from where we left off.
4. **Display task list**: Show all parsed tasks with their current status (pending/in-progress/done)

## Execution Loop

For EACH task in the plan, in order:

1. **Announce**: Tell the user which task you're starting and what it involves
2. **Execute**: Write the code, create files, modify config — whatever the task requires
3. **Self-check**: After execution, verify the work:
   - Do the files/functions mentioned actually exist?
   - Does the code compile (run build command if available)?
   - Are there any TypeScript/lint errors in the changed files?
4. **Integration check** (CRITICAL — this is what other AI tools skip):
   - Are new components/modules imported where they need to be?
   - Are new routes registered in the router?
   - Are new API endpoints connected to the frontend?
   - Are new UI components rendered in a parent component?
   - Are new config values referenced where needed?
   - Is there any orphaned code (written but never called/imported)?
5. **Mark done**: Only mark the task complete after self-check AND integration check pass
6. **Update score**: Report completion progress: "Task 3/8 complete (37%)"
7. **Save state**: Write current progress to \`.archon/plans/<plan-name>.state.md\`

## Completion Score

The completion score is verification-based, NOT self-reported:
- Each task is verified by checking the codebase, not by trusting the AI's memory
- Score = (verified_complete_tasks / total_tasks) * 100
- A task is only "verified complete" when its code exists AND is properly integrated

## Rules

- **NEVER declare done early**: Do not say "I've completed the plan" until ALL tasks show as verified complete
- **NEVER skip integration**: The #1 failure mode of AI tools is writing code that isn't wired up. Always check.
- **NEVER skip the last 20%**: The final tasks (UI wiring, config, routing) are often the most important. Do them.
- **If you hit an error**: Debug it. Don't skip the task. If truly blocked, report it and continue to the next task, then come back.
- **Persist state**: Always save progress so work survives session interruptions

## State File Format

\`\`\`markdown
# Plan Execution State: [plan name]
## Source: [path to plan file]
## Started: [timestamp]
## Last Updated: [timestamp]
## Score: 5/8 tasks (62%)

### Tasks
- [x] Task 1 description — DONE (verified)
- [x] Task 2 description — DONE (verified)
- [~] Task 3 description — IN PROGRESS
- [ ] Task 4 description — PENDING
...
\`\`\`

## On Completion

When ALL tasks are verified complete:
1. Report final score (should be 100%)
2. Summarize what was built
3. Suggest running \`/validate-plan\` for an independent audit
4. Suggest running \`/qa-test\` if this is a web application`,
  },
  {
    name: 'validate-plan',
    description: 'Audit completed work against the original plan by comparing the plan document to the git diff. Identifies gaps where the plan says something should exist but it does not, then auto-fixes them.',
    tags: ['validation', 'quality', 'review'],
    content: `# Validate Plan

Audit completed work against the original plan using git diff as ground truth.

## Process

### Step 1: Gather Inputs

1. **Read the plan**: Load the plan document specified by the user
2. **Get the diff**: Run \`git diff main...HEAD\` (or the appropriate base branch) to see ALL changes on this branch
3. **Get file list**: Run \`git diff main...HEAD --stat\` for an overview of changed files
4. **Check execution state**: If a \`.archon/plans/<plan-name>.state.md\` exists, read it for additional context about what was attempted

### Step 2: Plan-vs-Reality Audit

For EACH item in the plan, determine its status:

- **DONE**: The plan item is fully implemented in the diff. The code exists, is correct, and is properly integrated.
- **PARTIAL**: The plan item was started but is incomplete. Some code exists but it's missing pieces (e.g., function exists but isn't called anywhere, component exists but isn't rendered).
- **MISSING**: The plan item has no corresponding code in the diff at all. It was skipped entirely.
- **WRONG**: Code exists but implements the plan item incorrectly (wrong behavior, wrong location, security issue).

### Step 3: Generate Gap Report

Report findings in this format:

\`\`\`
Plan Validation Report
======================
Plan: [plan file path]
Branch: [current branch]
Overall: X/Y tasks verified (Z%)

DONE:
- [x] Task description — verified in [file path]

PARTIAL:
- [~] Task description — [what's missing]

MISSING:
- [ ] Task description — not found in diff

WRONG:
- [!] Task description — [what's wrong]
\`\`\`

### Step 4: Auto-Fix Loop

For each PARTIAL, MISSING, or WRONG item:

1. **Generate a fix task**: Describe exactly what needs to be done
2. **Execute the fix**: Write the code, wire up the integration
3. **Re-validate just this item**: Check that the fix actually resolves the gap
4. **Retry if needed**: Up to 3 attempts per item. If still not fixed after 3 tries, report it as unresolved.

### Step 5: Final Report

After the auto-fix loop:
1. Report the updated validation results
2. Show what was fixed vs what remains unresolved
3. If there are web-app changes, suggest running \`/qa-test\` for browser verification

## Key Principles

- **Git diff is ground truth**: Don't trust the AI's memory of what it did. Read the actual code changes.
- **Semantic matching**: Use understanding, not string matching. "Add password hashing" matches bcrypt implementation.
- **Integration matters**: A function that exists but is never called is PARTIAL, not DONE.
- **Bounded retries**: Max 3 fix attempts per item prevents infinite loops.
- **Independent usage**: This skill works on ANY branch, not just executor-managed plans. Use it to validate manual work or output from other AI tools.`,
  },
  {
    name: 'qa-test',
    description: 'AI QA analyst that tests your web app in a real browser. Reads the plan and git diff to understand what changed, auto-detects the dev server, then systematically tests the app — finding edge cases, checking forms, responsive layouts, and accessibility. Reports bugs inline with screenshots.',
    tags: ['testing', 'qa', 'browser', 'playwright'],
    content: `# QA Test — AI QA Analyst

Act as a thorough QA analyst testing a web application in a real browser.

## Startup

### 1. Gather Context
- **If a plan file is available**: Read it to understand WHAT features should work
- **Get the git diff**: Run \`git diff main...HEAD\` to understand WHAT code changed
- **Combine context**: Plan tells you what SHOULD work, diff tells you WHERE to look

### 2. Auto-Detect Dev Server
Scan the project to figure out how to run the app:
1. Read \`package.json\` — look for scripts: \`dev\`, \`start\`, \`serve\`
2. Detect the framework:
   - Next.js: \`next dev\` (port 3000)
   - Vite: \`vite\` (port 5173)
   - CRA: \`react-scripts start\` (port 3000)
   - Remix: \`remix dev\` (port 3000)
   - Angular: \`ng serve\` (port 4200)
   - Other: read the dev script command
3. Start the dev server via \`run_terminal\`
4. Wait for it to be ready (poll the URL every 2 seconds, up to 30 seconds)
5. If auto-detection fails, ask the user for the start command and URL

### 3. Generate Test Strategy
Based on plan + diff, create a test plan covering:
- **Happy paths**: Test each feature as described in the plan
- **Edge cases**: Empty inputs, very long strings, special characters, rapid clicks, double submits
- **Forms**: Required field validation, error messages, successful submission, reset behavior
- **Navigation**: All new routes are reachable, back button works, deep links work, 404 handling
- **Responsive**: Test at mobile (375px), tablet (768px), and desktop (1280px) widths
- **Accessibility**: ARIA labels present, keyboard navigation works, focus management, color contrast
- **Error states**: Invalid inputs, missing data, network-style errors, empty states
- **Security** (basic): Check for exposed data in page source, open console for errors/warnings

## Testing Loop

For each test scenario:

1. **Navigate** to the relevant page using Playwright browser_navigate
2. **Snapshot** the page using browser_snapshot to understand the structure
3. **Interact**: Fill forms, click buttons, navigate between pages using browser_click, browser_fill_form, browser_press_key
4. **Verify**: Check that the expected outcome occurred (element visible, navigation happened, data displayed)
5. **Screenshot**: Take a screenshot at key moments — especially failures and error states
6. **Console check**: Use browser_console_messages to check for JavaScript errors
7. **Report**: If something is wrong, report it immediately inline

## Bug Report Format

When you find a bug, report it inline in the chat:

**Bug: [Short title]**
- **Severity**: Critical / Major / Minor / Cosmetic
- **Page**: [URL where the bug occurs]
- **Steps to reproduce**:
  1. [Step 1]
  2. [Step 2]
  3. [Step 3]
- **Expected**: [What should happen]
- **Actual**: [What actually happens]
- **Screenshot**: [Attached screenshot]
- **Suggested fix**: [If you can identify what's wrong in the code]

## Test Persona Modes

If the user specifies a focus, adjust your testing accordingly:

- **General** (default): Broad testing across all categories
- **Security**: XSS via input fields, auth bypass, exposed API keys in source, CSRF tokens, open redirects
- **Accessibility**: WCAG 2.1 AA compliance, screen reader paths, keyboard-only navigation, focus traps, color contrast
- **Edge cases**: Boundary values, empty/null states, concurrent actions, browser back/forward, very fast interactions
- **Mobile**: Responsive breakpoints, touch target sizes, viewport behavior, orientation, mobile-specific UI

## QA Memory

Leverage Archon's memory system to get smarter over time:
- Remember the app's page structure and key navigation flows
- Track previously found bugs to avoid re-reporting fixed issues
- Learn login flows and authentication patterns
- Build knowledge of the app's critical paths for regression testing

## On Completion

1. Summarize all findings: X bugs found (Y critical, Z major, W minor)
2. List pages/features that passed all tests
3. If bugs were found, offer to fix them
4. If chained from /validate-plan, focus testing on the areas that were auto-fixed

## Rules

- **Be thorough**: A good QA analyst tries to break things. Don't just verify the happy path.
- **Be specific**: Bug reports should be reproducible. Include exact steps.
- **Be visual**: Screenshots are essential. Take them for every bug and for key test steps.
- **Be practical**: Focus testing on what actually changed. Don't test the entire app if only one feature was added.
- **Don't assume**: If a button looks like it should work, click it and verify.`,
  },
  {
    name: 'build-to-complete',
    description: 'Execute a plan and validate it in a loop until 100% complete. Combines execute-plan and validate-plan into an autonomous cycle that keeps working until every plan item is verified done.',
    tags: ['execution', 'validation', 'automation', 'planning'],
    content: `# Build to Complete

Execute a plan and validate it in a loop until the plan is 100% verified complete.

This skill combines the execute-plan and validate-plan workflows into a single autonomous cycle. It will NOT stop until every plan item is verified done or a hard limit is reached.

## Process

### Step 1: Load the Plan

1. Read the plan file specified by the user (or find the most recent plan in docs/plans/ or .archon/plans/)
2. Parse all tasks from headings, checkboxes, or numbered lists
3. Check for prior state at \`.archon/plans/<plan-name>.state.md\` — resume if found
4. Display the full task list with current status

### Step 2: Execute All Tasks (Execute Phase)

Run the full execute-plan workflow:

1. For EACH task in the plan, in order:
   - Announce the task
   - Execute it (write code, create files, modify config)
   - Self-check: verify files exist, code compiles, no lint errors
   - Integration check: verify new code is imported, wired up, and not orphaned
   - Mark done only after both checks pass
   - Report progress: "Task 3/8 complete (37%)"
   - Save state to \`.archon/plans/<plan-name>.state.md\`

2. After all tasks are attempted, report the execution score

### Step 3: Validate Against Plan (Validate Phase)

Run the full validate-plan workflow:

1. Read the plan document
2. Run \`git diff main...HEAD\` to get all actual code changes
3. For EACH plan item, determine status: DONE / PARTIAL / MISSING / WRONG
4. Generate a gap report with the validation score

### Step 4: Fix Loop (if validation < 100%)

If the validation score is not 100%:

1. For each PARTIAL, MISSING, or WRONG item:
   - Generate a specific fix task
   - Execute the fix
   - Re-validate just that item
   - Retry up to 3 times per item
2. After fixing, go back to **Step 3** (re-validate the full plan)

### Step 5: Repeat Until Done

Continue the validate -> fix -> re-validate loop until:
- **100% validated** — all plan items are DONE (the goal)
- **Max cycles reached** — stop after 5 full validate-fix cycles to prevent runaway loops
- **No progress** — if a cycle produces zero fixes (same items remain broken), stop and report

### Step 6: Final Report

\`\`\`
Build to Complete — Final Report
=================================
Plan: [plan file path]
Branch: [current branch]

Execution: X/Y tasks completed
Validation: X/Y tasks verified (Z%)
Fix cycles: N cycles run
Total items fixed during validation: M

Status: COMPLETE / INCOMPLETE (N items unresolved)

DONE:
- [x] Task description

UNRESOLVED (if any):
- [!] Task description — [why it couldn't be fixed after 3 attempts]
\`\`\`

### Step 7: Next Steps

- If 100% complete and this is a web app, suggest running \`/qa-test\`
- If items remain unresolved, explain what's blocking each one and suggest manual intervention

## Loop Limits

| Limit | Default | Purpose |
|---|---|---|
| Fix attempts per item | 3 | Prevents infinite retry on one stubborn issue |
| Full validate-fix cycles | 5 | Prevents runaway loops if fixes keep breaking other things |
| Stall detection | 0 new fixes in a cycle | Stops if we're not making progress |

## Rules

- **NEVER declare done until validation confirms 100%**: The execute phase saying "done" is not enough. Validation must verify it independently.
- **NEVER skip integration wiring**: Check that new code is imported, routed, rendered, and connected.
- **NEVER skip the last 20%**: UI hookups, config, routing — these are where AI tools always fail. Do them.
- **Fix root causes, not symptoms**: If the same item fails validation repeatedly, the fix approach is wrong. Try a different approach on retry.
- **Persist state after every cycle**: Save progress so work survives interruptions. The state file tracks which cycle we're on.
- **Report honestly**: If something can't be fixed, say so. Don't hide unresolved items.

## State File Format

\`\`\`markdown
# Build to Complete State: [plan name]
## Source: [path to plan file]
## Started: [timestamp]
## Last Updated: [timestamp]
## Cycle: 2 of 5
## Execution Score: 8/8 (100%)
## Validation Score: 7/8 (87%)

### Tasks
- [x] Task 1 — DONE (verified cycle 1)
- [x] Task 2 — DONE (verified cycle 1)
- [x] Task 3 — DONE (fixed cycle 2, attempt 1)
- [~] Task 4 — PARTIAL (attempt 2 of 3)
...
\`\`\``,
  },
];
