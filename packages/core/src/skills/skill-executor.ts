/**
 * SkillExecutor — Handles skill invocation, context injection, and script execution.
 *
 * Responsibilities:
 * - Load full skill content on invocation
 * - Inject skill instructions into the agent context
 * - Execute skill scripts with security level checks
 * - Handle rich skill resources (references, assets)
 */

import * as path from 'path';
import type { Skill, SkillExecutorConfig } from './types';
import type { SkillRegistry } from './skill-registry';

export interface SkillInvocationResult {
  /** The skill instructions that should be injected into the agent context. */
  instructions: string;
  /** Whether the skill has scripts available. */
  hasScripts: boolean;
  /** The skill name. */
  skillName: string;
  /** Error message if invocation failed. */
  error?: string;
}

export interface ScriptExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Whether execution was skipped (user declined or security blocked). */
  skipped: boolean;
  skipReason?: string;
}

export class SkillExecutor {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly config: SkillExecutorConfig
  ) {}

  /**
   * Invoke a skill by name. Returns the instructions to inject into agent context.
   */
  async invoke(skillName: string): Promise<SkillInvocationResult> {
    const summary = this.registry.find(skillName);
    if (!summary) {
      return {
        instructions: '',
        hasScripts: false,
        skillName,
        error: `Skill "/${skillName}" not found. Use /skills to see available skills.`,
      };
    }

    if (!summary.enabled) {
      return {
        instructions: '',
        hasScripts: false,
        skillName,
        error: `Skill "/${skillName}" is disabled. Enable it in the Skills Manager.`,
      };
    }

    // Load full skill content (progressive disclosure level 2)
    const skill = await this.registry.loadFull(skillName);
    if (!skill || !skill.body) {
      return {
        instructions: '',
        hasScripts: false,
        skillName,
        error: `Failed to load skill "/${skillName}" content.`,
      };
    }

    this.registry.emit('skill-invoked', skillName);

    // Build the instructions block
    const instructions = this.buildInstructions(skill);

    return {
      instructions,
      hasScripts: (skill.scripts?.length ?? 0) > 0,
      skillName,
    };
  }

  /**
   * Execute a script from a rich skill.
   */
  async executeScript(
    skillName: string,
    scriptName: string
  ): Promise<ScriptExecutionResult> {
    const skill = await this.registry.loadFull(skillName);
    if (!skill) {
      return { stdout: '', stderr: `Skill "${skillName}" not found`, exitCode: 1, skipped: true, skipReason: 'not found' };
    }

    if (skill.type !== 'rich' || !skill.scripts?.includes(scriptName)) {
      return { stdout: '', stderr: `Script "${scriptName}" not found in skill "${skillName}"`, exitCode: 1, skipped: true, skipReason: 'script not found' };
    }

    const scriptPath = path.join(skill.path, 'scripts', scriptName);

    // Security check
    const allowed = await this.checkScriptPermission(skillName, scriptName, scriptPath);
    if (!allowed) {
      return { stdout: '', stderr: '', exitCode: 0, skipped: true, skipReason: 'user declined' };
    }

    // Determine how to run the script based on extension
    const ext = path.extname(scriptName).toLowerCase();
    const command = this.buildScriptCommand(scriptPath, ext);

    try {
      const result = await this.config.executeCommand(command);
      return { ...result, skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { stdout: '', stderr: message, exitCode: 1, skipped: false };
    }
  }

  /**
   * Load a reference file from a rich skill.
   */
  async loadReference(skillName: string, refName: string): Promise<string | null> {
    const skill = await this.registry.loadFull(skillName);
    if (!skill || skill.type !== 'rich' || !skill.references?.includes(refName)) {
      return null;
    }
    const refPath = path.join(skill.path, 'references', refName);
    try {
      return await this.config.readFile(refPath);
    } catch {
      return null;
    }
  }

  // ── Private Methods ──

  private buildInstructions(skill: Skill): string {
    const lines: string[] = [];
    lines.push(`# Skill: ${skill.metadata.name}`);
    lines.push(`> ${skill.metadata.description}`);
    lines.push('');

    if (skill.body) {
      lines.push(skill.body);
    }

    // List available scripts if any
    if (skill.scripts && skill.scripts.length > 0) {
      lines.push('');
      lines.push('## Available Scripts');
      lines.push('You can execute these scripts using the run_terminal tool:');
      for (const script of skill.scripts) {
        const scriptPath = path.join(skill.path, 'scripts', script);
        const ext = path.extname(script).toLowerCase();
        const cmd = this.buildScriptCommand(scriptPath, ext);
        lines.push(`- \`${script}\` → \`${cmd}\``);
      }
    }

    // List available references if any
    if (skill.references && skill.references.length > 0) {
      lines.push('');
      lines.push('## Available References');
      lines.push('You can read these files for additional context:');
      for (const ref of skill.references) {
        lines.push(`- ${path.join(skill.path, 'references', ref)}`);
      }
    }

    return lines.join('\n');
  }

  private async checkScriptPermission(
    skillName: string,
    scriptName: string,
    scriptPath: string
  ): Promise<boolean> {
    const level = this.config.securityLevel;

    // YOLO mode — auto-approve everything
    if (level === 'yolo') return true;

    // Strict mode — block all scripts
    if (level === 'strict') return false;

    // Standard / permissive — ask user
    let scriptContent: string;
    try {
      scriptContent = await this.config.readFile(scriptPath);
    } catch {
      scriptContent = '(unable to read script content)';
    }

    const prompt = [
      `Skill "/${skillName}" wants to execute script: ${scriptName}`,
      '',
      '```',
      scriptContent.length > 500 ? scriptContent.slice(0, 500) + '\n...(truncated)' : scriptContent,
      '```',
      '',
      'Allow execution?',
    ].join('\n');

    const response = await this.config.askUser(prompt, ['Run', 'Skip']);
    return response.toLowerCase() === 'run';
  }

  private buildScriptCommand(scriptPath: string, ext: string): string {
    // Normalize path for the shell
    const normalized = scriptPath.replace(/\\/g, '/');

    switch (ext) {
      case '.py': return `python "${normalized}"`;
      case '.ts': return `npx tsx "${normalized}"`;
      case '.js': return `node "${normalized}"`;
      case '.sh': return `bash "${normalized}"`;
      case '.ps1': return `powershell -File "${normalized}"`;
      default: return `"${normalized}"`;
    }
  }
}
