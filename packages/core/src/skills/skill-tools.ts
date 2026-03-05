/**
 * Skill tools — Agent-facing tools for invoking and creating skills.
 *
 * These tools are registered in the agent's tool list so it can:
 * 1. Invoke skills by name (skill_invoke)
 * 2. Create new skills on behalf of the user (create_skill)
 * 3. List available skills (list_skills)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types';
import type { SkillRegistry } from './skill-registry';
import type { SkillExecutor } from './skill-executor';

export interface SkillToolsDependencies {
  registry: SkillRegistry;
  executor: SkillExecutor;
}

/**
 * Create the skill-related tools for the agent.
 */
export function createSkillTools(deps: SkillToolsDependencies): ToolDefinition[] {
  return [
    createSkillInvokeTool(deps),
    createCreateSkillTool(deps),
    createListSkillsTool(deps),
  ];
}

// ── skill_invoke ──

function createSkillInvokeTool(deps: SkillToolsDependencies): ToolDefinition {
  return {
    name: 'skill_invoke',
    description:
      'Invoke a skill by name. This loads the skill\'s instructions and context into the current conversation. ' +
      'Use this when a skill is relevant to the user\'s request, or when the user explicitly invokes a skill with /skill-name.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The skill name to invoke (without the leading /)',
        },
      },
      required: ['name'],
    },
    execute: async (args) => {
      const skillName = (args.name as string).replace(/^\//, '');
      const result = await deps.executor.invoke(skillName);

      if (result.error) {
        return `Error: ${result.error}`;
      }

      const lines = [
        `Skill "/${result.skillName}" activated.`,
        '',
        '--- SKILL INSTRUCTIONS ---',
        result.instructions,
        '--- END SKILL INSTRUCTIONS ---',
      ];

      if (result.hasScripts) {
        lines.push('');
        lines.push('This skill has executable scripts available. Use the run_terminal tool to execute them when needed.');
      }

      return lines.join('\n');
    },
  };
}

// ── create_skill ──

function createCreateSkillTool(deps: SkillToolsDependencies): ToolDefinition {
  return {
    name: 'create_skill',
    description:
      'Create a new skill file. Use this when the user asks to save a pattern, workflow, or set of instructions as a reusable skill. ' +
      'The skill will be saved as a .md file with YAML frontmatter.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name — lowercase, hyphens, max 64 chars (e.g., "code-review", "fix-tests")',
        },
        description: {
          type: 'string',
          description: 'What the skill does and when to use it (max 1024 chars)',
        },
        scope: {
          type: 'string',
          description: 'Where to save: "project" (workspace only) or "global" (all workspaces)',
          enum: ['project', 'global'],
        },
        content: {
          type: 'string',
          description: 'The markdown instructions for the skill (the body, without frontmatter)',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags for categorization (e.g., "code-quality, review")',
        },
      },
      required: ['name', 'description', 'scope', 'content'],
    },
    execute: async (args, ctx) => {
      const name = args.name as string;
      const description = args.description as string;
      const scope = args.scope as 'project' | 'global';
      const content = args.content as string;
      const tags = args.tags ? (args.tags as string).split(',').map(t => t.trim()).filter(Boolean) : [];

      // Validate name
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > 64) {
        return 'Error: Invalid skill name. Must be lowercase letters, numbers, and hyphens, max 64 chars.';
      }

      // Check for existing skill
      if (deps.registry.has(name)) {
        return `Error: Skill "/${name}" already exists. Choose a different name or edit the existing skill.`;
      }

      // Build the skill file content
      const tagsLine = tags.length > 0 ? `\ntags: [${tags.join(', ')}]` : '';
      const skillFile = [
        '---',
        `name: ${name}`,
        `description: ${description}`,
        `scope: ${scope}`,
        `enabled: true${tagsLine}`,
        'version: 1',
        '---',
        '',
        content,
      ].join('\n');

      // Determine save path
      const loader = deps.registry.getLoader();
      const dir = scope === 'project' ? loader.getProjectDir() : loader.getGlobalDir();
      const filePath = path.join(dir, `${name}.md`);

      // Ensure directory exists
      fs.mkdirSync(dir, { recursive: true });

      // Write the file
      fs.writeFileSync(filePath, skillFile, 'utf-8');

      // Refresh registry
      await deps.registry.refresh();

      deps.registry.emit('skill-created', name, `Created at ${filePath}`);

      return `Skill "/${name}" created successfully at ${filePath}.\n\nThe skill is now available and can be invoked with /${name}.`;
    },
  };
}

// ── list_skills ──

function createListSkillsTool(deps: SkillToolsDependencies): ToolDefinition {
  return {
    name: 'list_skills',
    description: 'List all available skills with their names, descriptions, and status.',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Optional filter: "enabled", "disabled", "global", "project", or a tag name',
        },
      },
    },
    execute: async (args) => {
      let skills = deps.registry.getAll();

      // Apply filter
      const filter = args.filter as string | undefined;
      if (filter) {
        switch (filter) {
          case 'enabled': skills = skills.filter(s => s.enabled); break;
          case 'disabled': skills = skills.filter(s => !s.enabled); break;
          case 'global': skills = skills.filter(s => s.scope === 'global'); break;
          case 'project': skills = skills.filter(s => s.scope === 'project'); break;
          default: skills = skills.filter(s => s.tags.includes(filter)); break;
        }
      }

      if (skills.length === 0) {
        return 'No skills found' + (filter ? ` matching filter "${filter}"` : '') + '.';
      }

      const lines = [`Found ${skills.length} skill(s):`, ''];
      for (const skill of skills) {
        const status = skill.enabled ? 'enabled' : 'disabled';
        const tags = skill.tags.length > 0 ? ` [${skill.tags.join(', ')}]` : '';
        const scope = skill.scope === 'global' ? '(global)' : '(project)';
        lines.push(`- /${skill.name} ${scope} — ${skill.description} [${status}]${tags}`);
      }

      return lines.join('\n');
    },
  };
}
