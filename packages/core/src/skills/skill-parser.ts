/**
 * SkillParser — Parses SKILL.md files, validates frontmatter, extracts instructions.
 *
 * Supports both simple skills (single .md file) and rich skills (directory with SKILL.md).
 */

import type { SkillMetadata, Skill } from './types';

// ── Frontmatter Parsing ──

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

interface ParsedFrontmatter {
  metadata: SkillMetadata;
  body: string;
}

/**
 * Parse a SKILL.md file content into metadata and body.
 */
export function parseSkillContent(content: string, scope: 'global' | 'project'): ParsedFrontmatter {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new SkillParseError('Missing YAML frontmatter (--- delimiters)');
  }

  const [, yamlBlock, body] = match;
  const raw = parseYamlSimple(yamlBlock);

  // Validate required fields
  if (!raw.name || typeof raw.name !== 'string') {
    throw new SkillParseError('Missing or invalid "name" in frontmatter');
  }
  if (!raw.description || typeof raw.description !== 'string') {
    throw new SkillParseError('Missing or invalid "description" in frontmatter');
  }

  // Validate name format
  if (raw.name.length > 64) {
    throw new SkillParseError(`Skill name exceeds 64 characters: "${raw.name}"`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw.name)) {
    throw new SkillParseError(`Invalid skill name "${raw.name}": must be lowercase letters, numbers, and hyphens`);
  }

  // Validate description length
  if (raw.description.length > 1024) {
    throw new SkillParseError(`Skill description exceeds 1024 characters`);
  }

  const metadata: SkillMetadata = {
    name: raw.name,
    description: raw.description,
    scope: raw.scope === 'global' || raw.scope === 'project' ? raw.scope : scope,
    enabled: raw.enabled !== false, // default true
    tags: parseTags(raw.tags),
    version: typeof raw.version === 'number' ? raw.version : 1,
    trigger: typeof raw.trigger === 'string' ? raw.trigger : undefined,
    tools: parseTags(raw.tools),
    modelInvocable: raw['model-invocable'] !== false, // default true
  };

  return { metadata, body: body.trim() };
}

/**
 * Build a Skill object from parsed content and path info.
 */
export function buildSkill(
  parsed: ParsedFrontmatter,
  path: string,
  type: 'simple' | 'rich',
  extras?: { scripts?: string[]; references?: string[]; assets?: string[] }
): Skill {
  return {
    metadata: parsed.metadata,
    body: parsed.body,
    path,
    type,
    scripts: extras?.scripts,
    references: extras?.references,
    assets: extras?.assets,
  };
}

/**
 * Build a metadata-only Skill (body = null) for progressive disclosure.
 */
export function buildSkillSummaryOnly(
  parsed: ParsedFrontmatter,
  path: string,
  type: 'simple' | 'rich',
  extras?: { scripts?: string[]; references?: string[]; assets?: string[] }
): Skill {
  return {
    metadata: parsed.metadata,
    body: null, // not loaded yet
    path,
    type,
    scripts: extras?.scripts,
    references: extras?.references,
    assets: extras?.assets,
  };
}

// ── Simple YAML Parser ──

/**
 * Minimal YAML parser for frontmatter. Handles flat key-value pairs and
 * simple arrays (both inline [a, b] and block - item style).
 * No dependency on a YAML library.
 */
function parseYamlSimple(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Block array item: "  - value"
    if (trimmed.startsWith('- ') && currentKey && currentArray) {
      currentArray.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''));
      continue;
    }

    // Flush pending array
    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    // Key-value pair: "key: value"
    const kvMatch = trimmed.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/i);
    if (!kvMatch) continue;

    const [, key, rawValue] = kvMatch;
    const value = rawValue.trim();

    // Inline array: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      continue;
    }

    // Empty value — might be followed by block array items
    if (!value) {
      currentKey = key;
      currentArray = [];
      continue;
    }

    // Boolean
    if (value === 'true') { result[key] = true; continue; }
    if (value === 'false') { result[key] = false; continue; }

    // Number
    if (/^-?\d+(\.\d+)?$/.test(value)) { result[key] = Number(value); continue; }

    // String (strip quotes)
    result[key] = value.replace(/^["']|["']$/g, '');
  }

  // Flush trailing array
  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

// ── Helpers ──

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

// ── Errors ──

export class SkillParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillParseError';
  }
}
