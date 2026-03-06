/**
 * Built-in hook templates — pre-configured LLM nodes shipped as presets.
 * Users can clone and customize these.
 */

import type { HookTemplate, HookNode, LLMNodeConfig } from './types';

function makeNode(overrides: Partial<HookNode> & { id: string; name: string; config: HookNode['config'] }): HookNode {
  return {
    type: 'llm',
    timing: 'sync',
    enabled: true,
    ...overrides,
  };
}

const MEMORY_SCANNER: HookTemplate = {
  id: 'memory-scanner',
  name: 'Memory Scanner',
  description: 'Reviews conversation history after each turn, extracts key insights, and saves to memory.',
  hookPoint: 'turn:end',
  nodes: [
    makeNode({
      id: 'memory-scanner-llm',
      name: 'Memory Scanner',
      type: 'llm',
      timing: 'async',
      config: {
        prompt: [
          'Review the conversation history for this turn.',
          'Identify and extract:',
          '1. Key decisions made',
          '2. Important code patterns discovered',
          '3. User preferences expressed',
          '4. Technical insights worth remembering',
          '',
          'Return any findings as variable updates to persist them.',
        ].join('\n'),
        maxTokens: 1000,
        temperature: 0.3,
      },
    }),
  ],
};

const CONTEXT_INJECTOR: HookTemplate = {
  id: 'context-injector',
  name: 'Context Injector',
  description: 'Queries memory and codebase for relevant context and injects it into the prompt before each LLM call.',
  hookPoint: 'llm:before',
  nodes: [
    makeNode({
      id: 'context-injector-llm',
      name: 'Context Injector',
      config: {
        prompt: [
          'Based on the current conversation, identify what additional context would help the assistant.',
          'Consider:',
          '- Relevant code files',
          '- Past decisions from memory',
          '- User preferences',
          '',
          'If context should be injected, return it as a modification to the messages array.',
        ].join('\n'),
        maxTokens: 1500,
        temperature: 0.2,
      },
    }),
  ],
};

const TOOL_AUDITOR: HookTemplate = {
  id: 'tool-auditor',
  name: 'Tool Auditor',
  description: 'Reviews tool calls for safety — blocks destructive operations without confirmation.',
  hookPoint: 'tool:before',
  nodes: [
    makeNode({
      id: 'tool-auditor-decision',
      name: 'Destructive Check',
      type: 'decision',
      config: {
        mode: 'regex',
        pattern: '(rm\\s+-rf|DROP\\s+TABLE|DELETE\\s+FROM|git\\s+push\\s+--force)',
        target: 'data.arguments',
        onTrue: 'continue',
        onFalse: 'skip',
      },
    }),
    makeNode({
      id: 'tool-auditor-llm',
      name: 'Safety Review',
      config: {
        prompt: [
          'This tool call appears to involve a potentially destructive operation.',
          'Review the tool call and determine if it should be blocked.',
          '',
          'If the operation is safe, return {"action": "pass"}.',
          'If it should be blocked, return {"action": "block", "summary": "reason"}.',
        ].join('\n'),
        maxTokens: 500,
        temperature: 0.1,
      },
    }),
  ],
};

const CODE_REVIEWER: HookTemplate = {
  id: 'code-reviewer',
  name: 'Code Reviewer',
  description: 'Reviews code changes after write_file or edit_file tool calls for quality and suggests improvements.',
  hookPoint: 'tool:after',
  nodes: [
    makeNode({
      id: 'code-reviewer-decision',
      name: 'Write Check',
      type: 'decision',
      config: {
        mode: 'regex',
        pattern: '(write_file|edit_file)',
        target: 'data.toolName',
        onTrue: 'continue',
        onFalse: 'skip',
      },
    }),
    makeNode({
      id: 'code-reviewer-llm',
      name: 'Code Review',
      timing: 'async',
      config: {
        prompt: [
          'Review the code that was just written/edited.',
          'Check for:',
          '1. Security vulnerabilities (XSS, injection, etc.)',
          '2. Logic errors',
          '3. Missing error handling at system boundaries',
          '4. Code style issues',
          '',
          'If issues are found, summarize them. Do not modify the result.',
        ].join('\n'),
        maxTokens: 1000,
        temperature: 0.3,
      },
    }),
  ],
};

const PROGRESS_TRACKER: HookTemplate = {
  id: 'progress-tracker',
  name: 'Progress Tracker',
  description: 'Summarizes progress at each loop iteration and updates a running status variable.',
  hookPoint: 'loop:iterate',
  nodes: [
    makeNode({
      id: 'progress-tracker-llm',
      name: 'Progress Summary',
      timing: 'async',
      config: {
        prompt: [
          'Review the conversation so far and provide a brief progress summary.',
          'Current iteration: {{$iteration}}',
          '',
          'Summarize:',
          '1. What has been accomplished so far',
          '2. What appears to be remaining',
          '',
          'Update the $progressSummary variable with your summary.',
        ].join('\n'),
        maxTokens: 500,
        temperature: 0.3,
      },
    }),
  ],
};

const ALL_TEMPLATES: HookTemplate[] = [
  MEMORY_SCANNER,
  CONTEXT_INJECTOR,
  TOOL_AUDITOR,
  CODE_REVIEWER,
  PROGRESS_TRACKER,
];

export function getHookTemplates(): HookTemplate[] {
  return ALL_TEMPLATES;
}

export function getHookTemplate(id: string): HookTemplate | undefined {
  return ALL_TEMPLATES.find(t => t.id === id);
}
