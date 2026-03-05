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
          maxIterations: 25,
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
          maxIterations: 5,
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
          maxIterations: 25,
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
          maxIterations: 10,
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
          maxIterations: 10,
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
          maxIterations: 15,
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
          maxIterations: 10,
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
  description: 'Read files → analyze → generate review → user checkpoint.',
  category: 'Review',
  pipeline: {
    id: 'code-review-pipeline',
    name: 'Code Review',
    nodes: [
      {
        id: 'analyzer',
        type: 'agent',
        label: 'Code Analyzer',
        config: {
          type: 'agent',
          systemPrompt: 'Analyze the code thoroughly. Look for bugs, security issues, performance problems, code style violations, and architectural concerns. Provide a structured review.',
          maxIterations: 15,
        },
        position: { x: 200, y: 100 },
        status: 'idle',
      },
      {
        id: 'checkpoint',
        type: 'user_checkpoint',
        label: 'Review Results',
        config: {
          type: 'user_checkpoint',
          prompt: 'Review the analysis. Apply suggested fixes?',
        },
        position: { x: 450, y: 100 },
        status: 'idle',
      },
    ],
    edges: [
      { id: 'analyze-to-review', sourceNodeId: 'analyzer', targetNodeId: 'checkpoint' },
    ],
    entryNodeId: 'analyzer',
  },
};
