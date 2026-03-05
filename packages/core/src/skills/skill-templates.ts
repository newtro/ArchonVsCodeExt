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
];
