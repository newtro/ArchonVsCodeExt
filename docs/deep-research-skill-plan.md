# Deep Research Skill for Claude Code

## Vision

A portable, standalone Claude Code skill that performs rigorous, multi-source deep research on any topic and produces a comprehensive, citation-backed report. Unlike existing deep research skills that rely on linear search-and-summarize patterns, this skill uses **STORM-style multi-perspective questioning**, **adaptive parallelism** tied to a user-specified time budget, **contradiction detection**, **counter-research**, and **self-critique loops** to produce research outputs that are honest about what they found *and* what they didn't.

The skill is codebase-aware: when run inside a project, it scans the local environment to ground external research in the actual tech stack and constraints.

**Invocation:** `/research <time> <topic>`
- Example: `/research 10m best WebSocket libraries for Node.js`
- Example: `/research 20m RBAC patterns for microservices`
- Example: `/research 5m how does our auth system compare to industry best practices`

---

## Goals

1. **General-purpose research** — handles technical decisions, broad topic deep-dives, and codebase-contextual questions
2. **Time-bounded execution** — user specifies a time budget; the skill maps this to parallelism and depth
3. **Multi-perspective exploration** — automatically identifies 3-5 diverse angles on the topic (STORM-inspired)
4. **Source rigor** — recency-weighted credibility, source chain auditing, triangulation, and contradiction surfacing
5. **Honest output** — reports include contradictions, gaps, limitations, and counter-arguments — not just confirmations
6. **Codebase awareness** — quick-scans the project (package.json, configs, tech stack) to ground research
7. **Actionable reports** — hybrid format with executive summary, themed sections, bibliography, and follow-up suggestions
8. **Transparency** — verbose progress updates so the user sees what's happening at every phase

## Non-Goals

- **No code implementation** — the skill researches and reports; it never writes code or modifies the project

---

## Invocation & UX

### Command Syntax

```
/research <time> <topic>
```

- `<time>` — Duration budget: `5m`, `10m`, `20m`, `30m` (parsed from the argument string)
- `<topic>` — Everything after the time value is the research topic
- If no time is specified, default to `10m`

### Progress Updates

The skill provides **verbose updates** throughout execution:

```
--- Phase 1: Codebase Quick Scan ---
Detected: Node.js project, TypeScript, Express, PostgreSQL
Relevant config: tsconfig uses ESM, Node 20+

--- Phase 2: Source Discovery ---
Topic involves specific libraries -> will use Context7 for official docs
Topic is a technical comparison -> will search for benchmarks and real-world reports
Identified 4 source categories: official docs, benchmarks, community experience, academic papers

--- Phase 3: Decomposition & Perspectives ---
Generated 4 perspectives: Performance, Developer Experience, Security, Ecosystem Maturity
Decomposed into 6 sub-questions...

--- Phase 4: Parallel Research (4 threads) ---
Thread 1 (Performance): Searching "WebSocket library Node.js benchmark 2026"...
Thread 2 (Developer Experience): Querying Context7 for ws, Socket.IO docs...
Thread 3 (Security): Searching "WebSocket security vulnerabilities Node.js"...
Thread 4 (Ecosystem): Searching "WebSocket Node.js adoption production 2025 2026"...
[... findings as they come in ...]

--- Phase 5: Cross-referencing ---
Found contradiction: Source A claims ws is 10x faster than Socket.IO, Source B shows only 2x difference...

--- Phase 6: Counter-Research ---
Searching for arguments AGAINST top recommendations...

--- Phase 7: Self-Critique ---
Critic found: "The security section relies on a single 2024 audit. Need more recent data."
Conducting targeted follow-up search...

--- Phase 8: Synthesis ---
Writing report to docs/research/websocket-libraries-nodejs.md...
```

### Output

1. **Report file** saved to `docs/research/<slugified-topic>.md`
2. **Chat summary** — concise key findings, top recommendation (if clear), and the report file path
3. **Follow-up suggestions** — 2-3 related research questions the user might want to explore next

---

## Architecture Overview

The research pipeline has 8 phases. Not all phases run for every query — shorter time budgets may compress or skip phases (see Adaptive Parallelism).

### Phase 1: Codebase Quick Scan

**Purpose:** Ground the research in the user's actual project context.

**Process:**
- Check if running inside a project (look for package.json, Cargo.toml, pyproject.toml, go.mod, etc.)
- If yes: read the manifest file(s) to identify language, framework, dependencies, and versions
- Extract: tech stack, existing dependencies related to the topic, config conventions
- Store as structured context that informs all subsequent phases

**Duration:** ~10 seconds. Always runs regardless of time budget.

**Output:** A structured context block like:
```
Project: Node.js 20+, TypeScript, ESM
Framework: Express 5.x
Relevant deps: jsonwebtoken 9.x, passport 0.7
Config notes: strict TypeScript, ESLint with security rules
```

### Phase 2: Source Discovery

**Purpose:** Determine which source types are relevant BEFORE starting to search. This prevents wasting time on irrelevant source categories.

**Process:**
- Analyze the topic to identify what kinds of sources would be valuable:
  - **Official docs** — if specific libraries/frameworks are mentioned, flag for Context7 lookup
  - **Benchmarks/comparisons** — if the topic is a "which is better" question
  - **Community experience** — if the topic benefits from real-world usage reports
  - **Academic papers** — if the topic has a theoretical/research dimension
  - **Security advisories** — if the topic involves security-sensitive components
  - **Project-specific** — if the topic relates to the scanned codebase
- Produce a source plan that guides Phase 4

**Duration:** ~10 seconds. Always runs.

### Phase 3: Query Decomposition & Perspective Generation

**Purpose:** Break the research question into sub-questions and identify diverse perspectives (STORM-inspired).

**Process:**

1. **Perspective generation** — identify 3-5 distinct angles from which to research the topic. These are not random — they emerge from the topic itself:
   - For a tech choice: Performance, DX, Security, Ecosystem, Cost
   - For an architecture question: Scalability, Maintainability, Team Familiarity, Migration Path
   - For a broad topic: Historical Context, Current State, Future Direction, Criticisms

2. **Sub-question decomposition** — for each perspective, generate 1-3 specific, searchable sub-questions:
   - Perspective "Performance" → "What are the benchmark results for X vs Y in 2025-2026?"
   - Perspective "Security" → "What known CVEs exist for X? How does X handle [relevant threat]?"

3. **Assign sub-questions to research threads** based on the parallelism budget (see Adaptive Parallelism)

**Duration:** ~15 seconds. Always runs.

### Phase 4: Parallel Research Execution

**Purpose:** The core research phase. Spawn parallel subagents to research different perspectives simultaneously.

**Process:**
- Launch N subagents (where N is determined by time budget — see Adaptive Parallelism)
- Each subagent is assigned one or more perspectives and their sub-questions
- Each subagent:
  1. Uses **Context7** (`resolve-library-id` + `query-docs`) for any specific library/framework mentioned
  2. Uses **WebSearch** for each sub-question, with recency-appropriate queries (include current year)
  3. Uses **WebFetch** to read promising URLs in full when search snippets aren't enough
  4. Extracts **structured learnings** from each source:
     ```
     Finding: [the specific finding]
     Source: [URL, title, date]
     Recency: [how old]
     Confidence: [based on source type and corroboration]
     ```
  5. Performs **iterative refinement** — if initial results are thin, reformulates queries and searches again (up to 3 iterations per sub-question)
  6. Returns accumulated structured learnings to the main agent

**Duration:** This is where most time is spent. Scales with parallelism.

### Phase 5: Cross-Referencing & Contradiction Detection

**Purpose:** Compare findings across all threads. Surface agreements and disagreements.

**Process:**
- Merge all structured learnings from Phase 4
- Group findings by theme/claim
- For each major claim, check:
  - **Agreement**: How many independent sources support this? (triangulation)
  - **Contradiction**: Do any sources disagree? If so, surface both sides with evidence strength
  - **Source chain**: Does Source B just cite Source A? If so, it's one source, not two. Follow citation chains to originals
- Flag contradictions for explicit inclusion in the report
- Flag claims with only a single source as lower confidence

**Duration:** ~30 seconds.

### Phase 6: Counter-Research

**Purpose:** Deliberately search for evidence AGAINST the emerging conclusions. Stress-test findings.

**Process:**
- Identify the top 2-3 emerging conclusions/recommendations from Phase 5
- For each, search for:
  - "[recommendation] problems"
  - "[recommendation] vs [alternative] disadvantages"
  - "why not [recommendation]"
  - "[recommendation] criticism"
- Extract counter-arguments and assess their validity
- Include legitimate counter-arguments in the report's analysis

**Duration:** ~30-60 seconds. May be compressed for short time budgets.

### Phase 7: Self-Critique Loop

**Purpose:** Challenge the draft findings before synthesis. Catch gaps and weak spots.

**Process:**
- Spawn a critic subagent that reviews all accumulated findings
- The critic checks:
  - Are any major claims supported by only 1 source?
  - Are there obvious follow-up questions that weren't explored?
  - Is the recency of sources appropriate for the topic?
  - Are there perspectives that were identified but under-explored?
  - Do any findings contradict the codebase context from Phase 1?
- If the critic identifies actionable gaps, conduct targeted follow-up searches
- One critique round for short budgets, up to 2 rounds for longer budgets

**Duration:** ~30-60 seconds per round.

### Phase 8: Synthesis & Report Generation

**Purpose:** Produce the final report and chat summary.

**Process:**
1. Organize findings by **theme** (not by sub-question or perspective)
2. Write the report in the hybrid format (see Report Format below)
3. Generate the chat summary (key findings + report path)
4. Generate 2-3 follow-up research suggestions
5. Save the report to `docs/research/<slugified-topic>.md`
6. Display the summary and suggestions in chat

**Duration:** ~30-60 seconds.

---

## Adaptive Parallelism

The time budget maps to research intensity through subagent parallelism:

| Time Budget | Parallel Threads | Perspectives | Search Iterations | Counter-Research | Critique Rounds |
|-------------|-----------------|--------------|-------------------|------------------|-----------------|
| 5m          | 2               | 2-3          | 1-2 per question  | Abbreviated      | 1               |
| 10m         | 3-4             | 3-4          | 2-3 per question  | Full             | 1               |
| 20m         | 5-6             | 4-5          | 3 per question    | Full + deep      | 2               |
| 30m         | 7-8             | 5+           | 3+ per question   | Full + deep      | 2               |

The mapping is approximate — actual execution time depends on search latency, content volume, and the complexity of findings. The skill optimizes for **coverage within the budget**, not precise timing.

For short budgets (5m), phases 6 (counter-research) and 7 (self-critique) are compressed but never skipped entirely — intellectual honesty is non-negotiable.

---

## Source Handling

### Recency Weighting

Sources are prioritized by recency. For fast-moving topics (tech, security), sources older than 18 months are flagged and deprioritized. For stable topics (algorithms, design patterns), older sources remain valid.

The skill should include the current year in search queries (e.g., "WebSocket Node.js 2026") to pull recent results.

### Source Chain Auditing

When multiple sources appear to support a claim, check whether they're actually independent:
- If Blog B cites Blog A, and Blog A cites the Original Study, that's **one source** (the study), not three
- Follow citation chains to the original when possible
- Report the actual source count after deduplication

### Context7 Integration

When the research topic involves specific libraries or frameworks:
1. Call `resolve-library-id` with the library name
2. Call `query-docs` to get current official documentation
3. Use official docs as a primary source, weighted above blog posts and tutorials
4. This catches version-specific details that web searches often miss

### Triangulation

For major claims in the report:
- 2+ independent sources = included with normal confidence
- 1 source = included but flagged as "single-source finding"
- 0 sources (inference) = clearly marked as the skill's analysis, not a researched finding

---

## Report Format

Reports use a **hybrid structure**: executive summary up top, themed detailed sections, bibliography and gaps at the end.

```markdown
# Research Report: [Topic]
*Generated: [date] | Time budget: [Xm] | Sources: [N]*

## Executive Summary
[3-5 bullet points with the key findings and any clear recommendations]

## Project Context
[What was found in the codebase scan — tech stack, relevant existing code]
[Only included if a codebase was detected]

## [Theme 1]
[Detailed findings organized by theme, with inline citations [1][2]]
[Contradictions surfaced inline: "Source A claims X [3], but Source B argues Y [4]"]

## [Theme 2]
...

## Counter-Arguments
[Findings from the counter-research phase]
[What the strongest arguments AGAINST the main conclusions are]

## Contradictions & Disagreements
[Explicit section for any unresolved contradictions between sources]

## Gaps & Limitations
- [What the research did NOT find or couldn't verify]
- [Topics that need deeper investigation]
- [Sources that were unavailable or paywalled]

## Suggested Follow-ups
1. [Follow-up research question 1]
2. [Follow-up research question 2]
3. [Follow-up research question 3]

## Sources
1. [Title](URL) — [date] — [brief relevance note]
2. [Title](URL) — [date] — [brief relevance note]
...
```

### Citation Style

- Inline numbered citations: `[1]`, `[2]`
- Each citation links to the Sources section
- Sources include title, URL, date, and a one-line relevance note

---

## Post-Report Behavior

After saving the report and showing the chat summary:

1. **Display the file path** so the user can open it
2. **Show 2-3 smart follow-up suggestions** — these are NOT generic related topics. They are generated from:
   - **Gaps identified** in Phase 7 (self-critique) that weren't filled due to time budget
   - **Contradictions** that remain unresolved and need deeper investigation
   - **Under-explored perspectives** that were identified in Phase 3 but didn't receive full coverage
   - **Codebase-specific questions** that emerged from the intersection of external research and local project context
3. **Do not take further action** — the skill's job is done. The user decides what to do next

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Portability | Standalone skill, no Archon dependency | Maximum reach — works for any Claude Code user |
| Time model | Subagent parallelism | Maps directly to actual concurrent execution; more intuitive than iteration counts |
| Perspectives | Auto-generated, not user-selected | Reduces friction; the skill should be smart about angles without requiring input |
| Source credibility | Recency-weighted | In tech, freshness matters more than domain prestige |
| Report style | Hybrid (summary + themed sections) | Best of executive-first and narrative approaches |
| Codebase scan | Quick scan only | 30 seconds max — enough to ground research without eating into the time budget |
| Non-goal | No code implementation only | The skill MAY give opinionated recommendations; it just won't write code |
| Contradiction handling | Surface both sides | Intellectual honesty > clean narratives |
| Counter-research | Always included | Even compressed for short budgets — prevents confirmation bias |
| Progress updates | Verbose | User wants to see the research process, not just the output |

---

## Prior Art & Influences

This design was informed by research into the current deep research agent landscape:

### Existing Products
- **ChatGPT Deep Research** — 5-step pipeline (decompose → browse → synthesize → structure → refine), 5-30 min autonomous browsing, GPT-5.2-based
- **Gemini Deep Research** — 1M token context, iterative plan-search-read-gap-identify loop, Workspace integration
- **Perplexity Deep Research** — 3-layer architecture (retrieval/orchestration/verification), 100-300 cited sources, dedicated verification agent
- **Grok DeepSearch** — Multi-agent system with coordinator, researcher, logic, and creative agents

### Existing Claude Code Skills
- **[199-biotechnologies/claude-deep-research-skill](https://github.com/199-biotechnologies/claude-deep-research-skill)** — 8-phase pipeline, 4 research modes (Quick/Standard/Deep/UltraDeep), source credibility scoring, auto-continuation
- **[Weizhena/Deep-Research-skills](https://github.com/Weizhena/Deep-Research-skills)** — 5 slash commands, human-in-the-loop at every stage

### Academic & Framework Influences
- **Stanford STORM** — Multi-perspective questioning: discover diverse angles, simulate conversations from each perspective with a retrieval-augmented expert, merge into unified outline
- **Adaptive RAG** — Classify query complexity to determine retrieval depth (simple → direct, moderate → single-step, complex → multi-step iterative)
- **Tree of Thoughts** — Branching exploration with scoring and pruning; explore multiple hypotheses, go deeper on promising branches
- **LangChain Open Deep Research** — LangGraph-based, provider-agnostic, 4-model pipeline, MCP-native
- **GPT Researcher** — Supervisor-researcher pattern, outperformed Perplexity on Carnegie Mellon benchmarks

### Key Pattern: Structured Learnings as Unit of Flow
The most critical architectural insight from the research: sub-agents should produce **structured learnings with citations**, not independent chapters. A single supervisor then weaves a coherent narrative. This solves the "information isolation" problem in multi-agent systems.

---

## Declined Ideas

These ideas were considered during the brainstorm and explicitly declined:

| Idea | Why Declined |
|------|-------------|
| Research tree visualization (mermaid diagram) | Added complexity without proportional value for the output format |
| Confidence heatmap (HIGH/MEDIUM/LOW per finding) | Recency weighting + triangulation provide implicit confidence signals |
| Query expansion via LLM (systematic synonym/phrasing generation) | Iterative refinement within threads achieves similar results more naturally |
| Intermediate findings file (save raw findings to disk during research) | Adds file management complexity; in-memory state between phases is sufficient |

---

## Open Questions

1. **Default time budget** — 10m is proposed as default when no time is specified. Is this appropriate?
2. **Report naming** — Should reports use slugified topic names (`websocket-libraries-nodejs.md`) or timestamps (`2026-03-09-research.md`)?
3. **Existing report handling** — If `docs/research/` already contains a report on a similar topic, should the skill reference or build on it?
4. **MCP tool availability** — The skill assumes Context7 MCP is available. Should it gracefully degrade if it's not installed?
5. **Maximum report length** — Should there be a cap, or let the depth of findings determine length?
6. **Subagent prompt engineering** — The quality of parallel research threads depends heavily on how well the subagent prompts are crafted. This needs careful iteration during implementation.
