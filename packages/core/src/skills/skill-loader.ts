/**
 * SkillLoader — Scans skill directories and loads skill metadata.
 *
 * Supports two storage locations:
 *   Project-level:  <workspace>/.archon/skills/
 *   Global:         ~/.archon/skills/
 *
 * Supports two skill formats:
 *   Simple: single .md file (e.g., review.md)
 *   Rich:   directory with SKILL.md + scripts/, references/, assets/
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SkillLoaderConfig, Skill, SkillSummary } from './types';
import { parseSkillContent, buildSkillSummaryOnly, buildSkill, SkillParseError } from './skill-parser';

export class SkillLoader {
  private readonly projectDir: string;
  private readonly globalDir: string;

  constructor(private readonly config: SkillLoaderConfig) {
    this.projectDir = path.join(
      config.workspaceRoot,
      config.projectSkillsDir ?? '.archon/skills'
    );
    this.globalDir = path.join(
      config.userHome,
      config.globalSkillsDir ?? '.archon/skills'
    );
  }

  /**
   * Scan both directories and return lightweight skill summaries (metadata only).
   * Project-level skills override global skills with the same name.
   */
  async loadAllSummaries(): Promise<SkillSummary[]> {
    const globalSkills = await this.scanDirectory(this.globalDir, 'global');
    const projectSkills = await this.scanDirectory(this.projectDir, 'project');

    // Project overrides global by name
    const merged = new Map<string, Skill>();
    for (const skill of globalSkills) {
      merged.set(skill.metadata.name, skill);
    }
    for (const skill of projectSkills) {
      merged.set(skill.metadata.name, skill);
    }

    return Array.from(merged.values()).map(toSummary);
  }

  /**
   * Load the full skill (including body) by name. Used when a skill is invoked.
   */
  async loadFull(name: string): Promise<Skill | null> {
    // Check project first (higher priority), then global
    const projectSkill = await this.tryLoadFromDir(this.projectDir, name, 'project');
    if (projectSkill) return projectSkill;

    return this.tryLoadFromDir(this.globalDir, name, 'global');
  }

  /**
   * Load the full skill from a specific path.
   */
  async loadFromPath(skillPath: string, scope: 'global' | 'project'): Promise<Skill | null> {
    try {
      const stat = await fsStat(skillPath);
      if (!stat) return null;

      if (stat.isDirectory()) {
        return this.loadRichSkill(skillPath, scope);
      } else if (stat.isFile() && skillPath.endsWith('.md')) {
        return this.loadSimpleSkill(skillPath, scope);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get the project skills directory path.
   */
  getProjectDir(): string {
    return this.projectDir;
  }

  /**
   * Get the global skills directory path.
   */
  getGlobalDir(): string {
    return this.globalDir;
  }

  // ── Private Methods ──

  private async scanDirectory(dir: string, scope: 'global' | 'project'): Promise<Skill[]> {
    if (!fs.existsSync(dir)) return [];

    const entries = await fsReaddir(dir);
    const skills: Skill[] = [];

    for (const entry of entries) {
      // Skip hidden files/dirs and history directory
      if (entry.startsWith('.') || entry === '.history') continue;

      const fullPath = path.join(dir, entry);
      const stat = await fsStat(fullPath);
      if (!stat) continue;

      try {
        if (stat.isDirectory()) {
          // Rich skill: directory with SKILL.md
          const skillMdPath = path.join(fullPath, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            const skill = await this.loadRichSkillMetadataOnly(fullPath, scope);
            if (skill) skills.push(skill);
          }
        } else if (stat.isFile() && entry.endsWith('.md')) {
          // Simple skill: single .md file
          const skill = await this.loadSimpleSkillMetadataOnly(fullPath, scope);
          if (skill) skills.push(skill);
        }
      } catch (err) {
        // Skip skills that fail to parse — don't break the whole loader
        console.warn(`[SkillLoader] Failed to parse skill at ${fullPath}:`, err);
      }
    }

    return skills;
  }

  private async tryLoadFromDir(dir: string, name: string, scope: 'global' | 'project'): Promise<Skill | null> {
    if (!fs.existsSync(dir)) return null;

    // Try rich skill first (directory)
    const richPath = path.join(dir, name);
    const richStat = await fsStat(richPath);
    if (richStat?.isDirectory() && fs.existsSync(path.join(richPath, 'SKILL.md'))) {
      return this.loadRichSkill(richPath, scope);
    }

    // Try simple skill (file)
    const simplePath = path.join(dir, `${name}.md`);
    if (fs.existsSync(simplePath)) {
      return this.loadSimpleSkill(simplePath, scope);
    }

    return null;
  }

  private async loadSimpleSkill(filePath: string, scope: 'global' | 'project'): Promise<Skill> {
    const content = await fsReadFile(filePath);
    const parsed = parseSkillContent(content, scope);
    return buildSkill(parsed, filePath, 'simple');
  }

  private async loadSimpleSkillMetadataOnly(filePath: string, scope: 'global' | 'project'): Promise<Skill> {
    const content = await fsReadFile(filePath);
    const parsed = parseSkillContent(content, scope);
    return buildSkillSummaryOnly(parsed, filePath, 'simple');
  }

  private async loadRichSkill(dirPath: string, scope: 'global' | 'project'): Promise<Skill> {
    const skillMdPath = path.join(dirPath, 'SKILL.md');
    const content = await fsReadFile(skillMdPath);
    const parsed = parseSkillContent(content, scope);

    const scripts = await listSubdir(dirPath, 'scripts');
    const references = await listSubdir(dirPath, 'references');
    const assets = await listSubdir(dirPath, 'assets');

    return buildSkill(parsed, dirPath, 'rich', { scripts, references, assets });
  }

  private async loadRichSkillMetadataOnly(dirPath: string, scope: 'global' | 'project'): Promise<Skill> {
    const skillMdPath = path.join(dirPath, 'SKILL.md');
    const content = await fsReadFile(skillMdPath);
    const parsed = parseSkillContent(content, scope);

    const scripts = await listSubdir(dirPath, 'scripts');
    const references = await listSubdir(dirPath, 'references');
    const assets = await listSubdir(dirPath, 'assets');

    return buildSkillSummaryOnly(parsed, dirPath, 'rich', { scripts, references, assets });
  }
}

// ── Helpers ──

function toSummary(skill: Skill): SkillSummary {
  return {
    name: skill.metadata.name,
    description: skill.metadata.description,
    scope: skill.metadata.scope,
    enabled: skill.metadata.enabled,
    tags: skill.metadata.tags ?? [],
    type: skill.type,
    path: skill.path,
    trigger: skill.metadata.trigger,
    modelInvocable: skill.metadata.modelInvocable ?? true,
  };
}

async function listSubdir(dirPath: string, subdir: string): Promise<string[]> {
  const fullPath = path.join(dirPath, subdir);
  if (!fs.existsSync(fullPath)) return [];
  try {
    const entries = await fsReaddir(fullPath);
    return entries.filter(e => !e.startsWith('.'));
  } catch {
    return [];
  }
}

// ── Async FS wrappers ──

function fsReaddir(dir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    fs.readdir(dir, (err, files) => err ? reject(err) : resolve(files));
  });
}

function fsReadFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf-8', (err, data) => err ? reject(err) : resolve(data));
  });
}

function fsStat(p: string): Promise<fs.Stats | null> {
  return new Promise((resolve) => {
    fs.stat(p, (err, stat) => resolve(err ? null : stat));
  });
}

export { SkillParseError };
