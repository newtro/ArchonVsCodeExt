/**
 * Default pipeline definition — a single agent node that replicates
 * the current AgentLoop behavior exactly.
 */

import type { Pipeline } from './types';

/**
 * The default pipeline: one agent node with "use defaults" for everything.
 * - model: 'default' → use whatever model is selected in the chat dropdown
 * - systemPrompt: undefined → use the standard Archon system prompt
 * - tools: undefined → all available tools
 * - maxIterations: 25 → same as current AgentLoop default
 */
export const DEFAULT_PIPELINE: Pipeline = {
  id: 'default',
  name: 'Default',
  description: 'Standard agentic loop — the AI processes your request using available tools',
  entryNodeId: 'agent-main',
  nodes: [
    {
      id: 'agent-main',
      type: 'agent',
      label: 'Agent',
      config: {
        type: 'agent',
        maxIterations: 25,
      },
      position: { x: 300, y: 200 },
      status: 'idle',
    },
  ],
  edges: [],
};

/**
 * Check whether a pipeline is the built-in default.
 */
export function isDefaultPipeline(pipeline: Pipeline): boolean {
  return pipeline.id === 'default';
}
