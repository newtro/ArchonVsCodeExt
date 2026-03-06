/**
 * LLM Node executor — sends context to an LLM with a user-written prompt.
 * Also handles Template nodes (which are pre-configured LLM nodes).
 */

import type { HookNode, HookContext, HookResult, LLMNodeConfig, TemplateNodeConfig } from '../types';
import { getHookTemplates } from '../templates';

type InvokeLLM = (prompt: string, config: { model?: string; maxTokens?: number; temperature?: number }) => Promise<string>;

export async function executeLLMNode(
  node: HookNode,
  context: HookContext,
  invokeLLM?: InvokeLLM,
): Promise<HookResult> {
  if (!invokeLLM) {
    return { action: 'pass', error: 'No LLM invocation function configured for hook engine' };
  }

  let config: LLMNodeConfig;

  if (node.type === 'template') {
    const templateConfig = node.config as TemplateNodeConfig;
    const template = getHookTemplates().find(t => t.id === templateConfig.templateId);
    if (!template) {
      return { action: 'pass', error: `Template "${templateConfig.templateId}" not found` };
    }
    // Template nodes have exactly one LLM node — extract its config
    const llmNode = template.nodes.find(n => n.type === 'llm');
    if (!llmNode) {
      return { action: 'pass', error: `Template "${templateConfig.templateId}" has no LLM node` };
    }
    config = {
      ...(llmNode.config as LLMNodeConfig),
      ...templateConfig.overrides,
    };
  } else {
    config = node.config as LLMNodeConfig;
  }

  // Build the prompt with variable interpolation
  const resolvedPrompt = interpolateVariables(config.prompt, context.variables);

  // Build the full prompt with context data
  const fullPrompt = buildLLMPrompt(resolvedPrompt, context);

  try {
    const response = await invokeLLM(fullPrompt, {
      model: config.model,
      maxTokens: config.maxTokens || undefined,  // 0 = unlimited (omit from request)
      temperature: config.temperature,
    });

    // Try to parse structured response
    return parseLLMResponse(response);
  } catch (err) {
    return {
      action: 'pass',
      error: `LLM node error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function buildLLMPrompt(userPrompt: string, context: HookContext): string {
  const parts: string[] = [];

  parts.push(`You are a hook node executing at hook point "${context.hookPoint}".`);
  parts.push('');
  parts.push('## Context Data');
  parts.push('```json');
  parts.push(JSON.stringify(context.data, null, 2).slice(0, 4000));
  parts.push('```');
  parts.push('');
  parts.push('## Current Variables');
  parts.push('```json');
  parts.push(JSON.stringify(context.variables, null, 2).slice(0, 1000));
  parts.push('```');
  parts.push('');
  parts.push('## Instructions');
  parts.push(userPrompt);
  parts.push('');
  parts.push('## Response Format');
  parts.push('Respond with a JSON object:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "pass" | "modify" | "block" | "abort",');
  parts.push('  "modifications": { /* optional: fields to modify in the hook data */ },');
  parts.push('  "variables": { /* optional: variable updates like "$varName": value */ },');
  parts.push('  "summary": "brief description of what you did"');
  parts.push('}');
  parts.push('```');
  parts.push('If you have no modifications, respond with: {"action": "pass", "summary": "..."}');

  return parts.join('\n');
}

function parseLLMResponse(response: string): HookResult {
  // Try to extract JSON from the response (may be wrapped in markdown code blocks)
  const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : response.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      action: parsed.action ?? 'pass',
      modifications: parsed.modifications,
      variables: parsed.variables,
      summary: parsed.summary,
    };
  } catch {
    // If we can't parse JSON, treat the whole response as a summary
    return {
      action: 'pass',
      summary: response.slice(0, 200),
    };
  }
}

function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{(\$\w+)\}\}/g, (_, varRef: string) => {
    const value = variables[varRef] ?? variables[varRef.slice(1)];
    return value !== undefined ? String(value) : varRef;
  });
}
