/**
 * Decision Node executor — evaluates conditions to control hook chain flow.
 *
 * Supports three modes: regex, expression, and LLM-based decisions.
 */

import type { HookNode, HookContext, HookResult, DecisionNodeConfig } from '../types';

export async function executeDecisionNode(
  node: HookNode,
  context: HookContext,
): Promise<HookResult> {
  const config = node.config as DecisionNodeConfig;

  switch (config.mode) {
    case 'regex':
      return evaluateRegex(config, context);
    case 'expression':
      return evaluateExpression(config, context);
    case 'llm':
      // LLM-based decisions are handled by the LLM executor path
      // For now, return a placeholder
      return { action: 'pass', decision: true, summary: 'LLM decision mode not yet configured' };
    default:
      return { action: 'pass', error: `Unknown decision mode: ${config.mode}` };
  }
}

function evaluateRegex(config: DecisionNodeConfig, context: HookContext): HookResult {
  if (!config.pattern) {
    return { action: 'pass', decision: false, error: 'No regex pattern configured' };
  }

  // Resolve the target value from variables or data
  const targetValue = resolveTarget(config.target, context);
  if (targetValue === undefined) {
    return { action: 'pass', decision: false, summary: `Target "${config.target}" not found` };
  }

  try {
    const regex = new RegExp(config.pattern);
    const matches = regex.test(String(targetValue));
    return {
      action: 'pass',
      decision: matches,
      summary: `Regex /${config.pattern}/ ${matches ? 'matched' : 'did not match'} "${String(targetValue).slice(0, 100)}"`,
    };
  } catch (err) {
    return {
      action: 'pass',
      decision: false,
      error: `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function evaluateExpression(config: DecisionNodeConfig, context: HookContext): HookResult {
  if (!config.expression) {
    return { action: 'pass', decision: false, error: 'No expression configured' };
  }

  try {
    const result = safeEvaluateExpression(config.expression, context.variables);
    return {
      action: 'pass',
      decision: !!result,
      summary: `Expression "${config.expression}" evaluated to ${result}`,
    };
  } catch (err) {
    return {
      action: 'pass',
      decision: false,
      error: `Expression error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Resolve a target reference to its actual value.
 * Targets can be:
 * - Variable references: "$variableName"
 * - Data field paths: "data.fieldName"
 */
function resolveTarget(target: string | undefined, context: HookContext): unknown {
  if (!target) return undefined;

  // Variable reference
  if (target.startsWith('$')) {
    return context.variables[target] ?? context.variables[target.slice(1)];
  }

  // Data field path (dot-separated)
  const parts = target.split('.');
  let current: unknown = context.data;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Safely evaluate a simple expression with variable substitution.
 *
 * Supports basic comparisons: ==, !=, >, <, >=, <=, &&, ||
 * Variables are referenced with $ prefix in the expression.
 *
 * SECURITY: Uses a simple parser instead of eval() to prevent code injection.
 */
function safeEvaluateExpression(expr: string, variables: Record<string, unknown>): boolean {
  // Replace variable references with their values
  let processed = expr;

  // Sort variable names by length (longest first) to avoid partial replacements
  const varNames = Object.keys(variables).sort((a, b) => b.length - a.length);
  for (const name of varNames) {
    const value = variables[name];
    const replacement = typeof value === 'string' ? `"${value}"` : String(value ?? 'undefined');
    // Replace $name and name (for keys already prefixed with $)
    processed = processed.replace(new RegExp(`\\$${name.replace(/^\$/, '')}`, 'g'), replacement);
  }

  // Handle && and || by splitting
  if (processed.includes('&&')) {
    const parts = processed.split('&&').map(p => p.trim());
    return parts.every(p => safeEvaluateSimple(p));
  }
  if (processed.includes('||')) {
    const parts = processed.split('||').map(p => p.trim());
    return parts.some(p => safeEvaluateSimple(p));
  }

  return safeEvaluateSimple(processed);
}

function safeEvaluateSimple(expr: string): boolean {
  const trimmed = expr.trim();

  // Boolean literals
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Comparison operators (order matters: >= before >, etc.)
  const operators = ['!==', '===', '!=', '==', '>=', '<=', '>', '<'] as const;
  for (const op of operators) {
    const idx = trimmed.indexOf(op);
    if (idx !== -1) {
      const left = parseValue(trimmed.slice(0, idx).trim());
      const right = parseValue(trimmed.slice(idx + op.length).trim());

      switch (op) {
        case '===': case '==': return left === right;
        case '!==': case '!=': return left !== right;
        case '>': return Number(left) > Number(right);
        case '<': return Number(left) < Number(right);
        case '>=': return Number(left) >= Number(right);
        case '<=': return Number(left) <= Number(right);
      }
    }
  }

  // Truthy check on a single value
  return !!parseValue(trimmed);
}

function parseValue(raw: string): string | number | boolean | null {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === 'undefined') return null;
  if (s === "''") return '';

  // Quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }

  // Number
  const num = Number(s);
  if (!isNaN(num) && s !== '') return num;

  // Return as-is (string)
  return s;
}
