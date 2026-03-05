/**
 * Built-in pipeline templates — pre-designed workflows users can start from.
 */

import type { PipelineTemplate } from './types';

export function getBuiltInTemplates(): PipelineTemplate[] {
  return [
    simpleChat,
    planAndExecute,
    tddWorkflow,
    codeReview,
    smartRouting,
  ];
}

const simpleChat: PipelineTemplate = {
  id: 'simple-chat',
  name: 'Simple Chat',
  description: 'Basic prompt → agent → response. No extra steps.',
  category: 'Basic',
  pipeline: {
    id: 'simple-chat-pipeline',
    name: 'Simple Chat',
    nodes: [
      {
        id: 'agent-1',
        type: 'agent',
        label: 'Chat Agent',
        config: {
          type: 'agent',

        },
        position: { x: 200, y: 100 },
        status: 'idle',
      },
    ],
    edges: [],
    entryNodeId: 'agent-1',
  },
};

const planAndExecute: PipelineTemplate = {
  id: 'plan-execute',
  name: 'Plan & Execute',
  description: 'Architect agent plans → user reviews → code agent implements → LSP verifies → test.',
  category: 'Development',
  pipeline: {
    id: 'plan-execute-pipeline',
    name: 'Plan & Execute',
    nodes: [
      {
        id: 'architect',
        type: 'agent',
        label: 'Architect',
        config: {
          type: 'agent',
          systemPrompt: 'You are an architect. Analyze the task and create a detailed plan. List files to modify, changes needed, and potential risks. Do NOT write code.',
        },
        position: { x: 100, y: 100 },
        status: 'idle',
      },
      {
        id: 'user-review',
        type: 'user_checkpoint',
        label: 'User Review',
        config: {
          type: 'user_checkpoint',
          prompt: 'Review the plan. Approve to proceed, or provide feedback.',
        },
        position: { x: 300, y: 100 },
        status: 'idle',
      },
      {
        id: 'coder',
        type: 'agent',
        label: 'Code Agent',
        config: {
          type: 'agent',
          systemPrompt: 'You are a precise code editor. Implement the plan from the architect exactly as specified. Use edit_file for surgical edits.',

        },
        position: { x: 500, y: 100 },
        status: 'idle',
      },
      {
        id: 'verify',
        type: 'verification',
        label: 'LSP Verify',
        config: {
          type: 'verification',
          verificationType: 'lsp_diagnostics',
          passEdge: 'verify-to-complete',
          failEdge: 'verify-to-fix',
        },
        position: { x: 700, y: 100 },
        status: 'idle',
      },
      {
        id: 'fix-agent',
        type: 'agent',
        label: 'Fix Agent',
        config: {
          type: 'agent',
          systemPrompt: 'Fix the errors reported by the LSP diagnostics. Focus only on fixing errors, do not refactor.',
        },
        position: { x: 700, y: 250 },
        status: 'idle',
      },
    ],
    edges: [
      { id: 'arch-to-review', sourceNodeId: 'architect', targetNodeId: 'user-review' },
      { id: 'review-to-code', sourceNodeId: 'user-review', targetNodeId: 'coder' },
      { id: 'code-to-verify', sourceNodeId: 'coder', targetNodeId: 'verify' },
      { id: 'verify-to-complete', sourceNodeId: 'verify', targetNodeId: '', label: 'Pass' },
      { id: 'verify-to-fix', sourceNodeId: 'verify', targetNodeId: 'fix-agent', label: 'Fail' },
      { id: 'fix-to-verify', sourceNodeId: 'fix-agent', targetNodeId: 'verify' },
    ],
    entryNodeId: 'architect',
  },
};

const tddWorkflow: PipelineTemplate = {
  id: 'tdd',
  name: 'TDD (Test-Driven Development)',
  description: 'Write test → write code → run test → fix until pass.',
  category: 'Development',
  pipeline: {
    id: 'tdd-pipeline',
    name: 'TDD',
    nodes: [
      {
        id: 'test-writer',
        type: 'agent',
        label: 'Write Test',
        config: {
          type: 'agent',
          systemPrompt: 'Write a failing test for the requested feature. Do NOT implement the feature itself.',
        },
        position: { x: 100, y: 100 },
        status: 'idle',
      },
      {
        id: 'code-writer',
        type: 'agent',
        label: 'Write Code',
        config: {
          type: 'agent',
          systemPrompt: 'Implement the minimum code needed to make the tests pass.',
        },
        position: { x: 300, y: 100 },
        status: 'idle',
      },
      {
        id: 'run-tests',
        type: 'verification',
        label: 'Run Tests',
        config: {
          type: 'verification',
          verificationType: 'test_runner',
          passEdge: 'tests-pass',
          failEdge: 'tests-fail',
        },
        position: { x: 500, y: 100 },
        status: 'idle',
      },
      {
        id: 'fix-code',
        type: 'agent',
        label: 'Fix Code',
        config: {
          type: 'agent',
          systemPrompt: 'Fix the code to make the failing tests pass. Only modify implementation, not tests.',
        },
        position: { x: 500, y: 250 },
        status: 'idle',
      },
    ],
    edges: [
      { id: 'test-to-code', sourceNodeId: 'test-writer', targetNodeId: 'code-writer' },
      { id: 'code-to-test', sourceNodeId: 'code-writer', targetNodeId: 'run-tests' },
      { id: 'tests-pass', sourceNodeId: 'run-tests', targetNodeId: '', label: 'Pass' },
      { id: 'tests-fail', sourceNodeId: 'run-tests', targetNodeId: 'fix-code', label: 'Fail' },
      { id: 'fix-to-test', sourceNodeId: 'fix-code', targetNodeId: 'run-tests' },
    ],
    entryNodeId: 'test-writer',
  },
};

const codeReview: PipelineTemplate = {
  id: 'code-review',
  name: 'Code Review',
  description: 'Fetches PR diff, analyzes code changes, and presents a structured review.',
  category: 'Review',
  pipeline: {
    id: 'code-review-pipeline',
    name: 'Code Review',
    nodes: [
      {
        id: 'reviewer',
        type: 'agent',
        label: 'Code Reviewer',
        config: {
          type: 'agent',
          systemPrompt: `You are a code reviewer. Your job is to review a pull request and present findings to the user.

## Workflow
1. **Gather the PR diff** — Use the tools available (e.g., az CLI, git, or gh) to fetch the PR metadata and the actual changed files. Try multiple approaches if one doesn't work.
2. **Analyze** — Review the code changes for bugs, security issues, performance problems, style concerns, and missing error handling.
3. **Present findings** — You MUST produce a structured review as your final output:

### PR Review: [title]
**Files changed:** [list]

#### Findings
- **[Critical/Warning/Info]** [file:line] — Description and suggested fix.

#### Summary
Overall assessment and recommendation (approve, request changes, or comment).

IMPORTANT: Do NOT end your turn without presenting your review findings. If you cannot fetch the diff, ask the user for help rather than stopping silently. If the user sends follow-up messages (corrections, questions, requests to post comments), address them and continue working.`,
        },
        position: { x: 200, y: 100 },
        status: 'idle',
      },
    ],
    edges: [],
    entryNodeId: 'reviewer',
  },
};

const smartRouting: PipelineTemplate = {
  id: 'smart-routing',
  name: 'Smart Routing',
  description: 'Analyzes task complexity and routes to the appropriate model — fast for simple tasks, powerful for complex ones.',
  category: 'Advanced',
  pipeline: {
    id: 'smart-routing-pipeline',
    name: 'Smart Routing',
    nodes: [
      {
        id: 'classifier',
        type: 'decision_gate',
        label: 'Complexity Analyzer',
        config: {
          type: 'decision_gate',
          condition: 'Is this task complex enough to require deep reasoning (architectural changes, multi-file refactoring, or debugging subtle bugs)? Simple tasks include: quick lookups, single-line fixes, formatting, renaming.',
          mode: 'ai_evaluated',
          trueEdge: 'route-complex',
          falseEdge: 'route-simple',
        },
        position: { x: 200, y: 150 },
        status: 'idle',
      },
      {
        id: 'fast-agent',
        type: 'agent',
        label: 'Fast Agent',
        config: {
          type: 'agent',
          model: 'pool:fast',
        },
        position: { x: 450, y: 80 },
        status: 'idle',
      },
      {
        id: 'reasoning-agent',
        type: 'agent',
        label: 'Reasoning Agent',
        config: {
          type: 'agent',
          model: 'pool:architect',
        },
        position: { x: 450, y: 220 },
        status: 'idle',
      },
    ],
    edges: [
      { id: 'route-simple', sourceNodeId: 'classifier', targetNodeId: 'fast-agent', label: 'Simple' },
      { id: 'route-complex', sourceNodeId: 'classifier', targetNodeId: 'reasoning-agent', label: 'Complex' },
    ],
    entryNodeId: 'classifier',
  },
};
