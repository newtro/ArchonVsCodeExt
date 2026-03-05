/**
 * SkillRegistry — In-memory index of all available skills.
 *
 * Implements progressive disclosure:
 *   Level 1: Metadata only (name, description, tags, trigger) — always loaded
 *   Level 2: Full body (instructions) — loaded on invocation
 *   Level 3: Scripts/references/assets — loaded on demand during execution
 *
 * Project-level skills override global skills with the same name.
 */

import type { SkillSummary, Skill, SkillLoaderConfig, SkillEvent, SkillEventType } from './types';
import { SkillLoader } from './skill-loader';

export type SkillEventHandler = (event: SkillEvent) => void;

export class SkillRegistry {
  private summaries = new Map<string, SkillSummary>();
  private loader: SkillLoader;
  private listeners: SkillEventHandler[] = [];
  private initialized = false;

  constructor(config: SkillLoaderConfig) {
    this.loader = new SkillLoader(config);
  }

  /**
   * Initialize the registry by scanning skill directories.
   * Call this once at startup, and again when skills change.
   */
  async initialize(): Promise<void> {
    const summaryList = await this.loader.loadAllSummaries();
    this.summaries.clear();
    for (const s of summaryList) {
      this.summaries.set(s.name, s);
    }
    this.initialized = true;
  }

  /**
   * Refresh the registry (re-scan directories).
   */
  async refresh(): Promise<void> {
    await this.initialize();
  }

  /**
   * Get all skill summaries (level 1 — metadata only).
   */
  getAll(): SkillSummary[] {
    return Array.from(this.summaries.values());
  }

  /**
   * Get only enabled skills.
   */
  getEnabled(): SkillSummary[] {
    return this.getAll().filter(s => s.enabled);
  }

  /**
   * Get skills that the model can auto-invoke.
   */
  getModelInvocable(): SkillSummary[] {
    return this.getEnabled().filter(s => s.modelInvocable);
  }

  /**
   * Find a skill by name (level 1).
   */
  find(name: string): SkillSummary | undefined {
    return this.summaries.get(name);
  }

  /**
   * Load the full skill content (level 2 — body loaded).
   */
  async loadFull(name: string): Promise<Skill | null> {
    return this.loader.loadFull(name);
  }

  /**
   * Check if a skill exists.
   */
  has(name: string): boolean {
    return this.summaries.has(name);
  }

  /**
   * Detect which skills are relevant to the given user message and context.
   * Returns enabled, model-invocable skills whose triggers or descriptions match.
   */
  detectRelevant(userMessage: string, context?: { currentFile?: string; repoFiles?: string[] }): SkillSummary[] {
    const candidates = this.getModelInvocable();
    const messageLower = userMessage.toLowerCase();
    const results: Array<{ skill: SkillSummary; score: number }> = [];

    for (const skill of candidates) {
      let score = 0;

      // Check trigger conditions
      if (skill.trigger && context) {
        score += this.evaluateTrigger(skill.trigger, context);
      }

      // Check description keyword overlap with message
      const descWords = skill.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.length > 3 && messageLower.includes(word)) {
          score += 1;
        }
      }

      // Check tag overlap
      for (const tag of skill.tags) {
        if (messageLower.includes(tag.toLowerCase())) {
          score += 2;
        }
      }

      // Check name mention
      if (messageLower.includes(skill.name)) {
        score += 5;
      }

      if (score > 0) {
        results.push({ skill, score });
      }
    }

    // Return sorted by relevance, top 3
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(r => r.skill);
  }

  /**
   * Generate the skills context block for the agent system prompt.
   * Includes only metadata (names, descriptions) for progressive disclosure.
   */
  generateSystemPromptContext(): string {
    const enabled = this.getEnabled();
    if (enabled.length === 0) return '';

    const lines = [
      '# Available Skills',
      '',
      'You have the following skills available. Use them when relevant to the user\'s request.',
      'Invoke a skill by calling the skill_invoke tool with the skill name.',
      '',
    ];

    for (const skill of enabled) {
      const tags = skill.tags.length > 0 ? ` [${skill.tags.join(', ')}]` : '';
      const autoTag = skill.modelInvocable ? '' : ' (user-only)';
      lines.push(`- **/${skill.name}**: ${skill.description}${tags}${autoTag}`);
    }

    return lines.join('\n');
  }

  /**
   * Subscribe to skill events.
   */
  on(handler: SkillEventHandler): void {
    this.listeners.push(handler);
  }

  /**
   * Emit a skill event.
   */
  emit(type: SkillEventType, skillName: string, detail?: string): void {
    const event: SkillEvent = { type, skillName, timestamp: Date.now(), detail };
    for (const handler of this.listeners) {
      try { handler(event); } catch { /* ignore listener errors */ }
    }
  }

  /**
   * Get the skill loader instance (for direct path-based loading).
   */
  getLoader(): SkillLoader {
    return this.loader;
  }

  /**
   * Whether the registry has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ── Private Methods ──

  private evaluateTrigger(trigger: string, context: { currentFile?: string; repoFiles?: string[] }): number {
    // Simple trigger evaluation
    // Supports: "file:.py", "file:.ts", "repo:Dockerfile", "repo:package.json"
    const parts = trigger.split(',').map(s => s.trim());
    let score = 0;

    for (const part of parts) {
      if (part.startsWith('file:') && context.currentFile) {
        const ext = part.slice(5);
        if (context.currentFile.endsWith(ext)) score += 3;
      } else if (part.startsWith('repo:') && context.repoFiles) {
        const fileName = part.slice(5);
        if (context.repoFiles.some(f => f.includes(fileName))) score += 3;
      }
    }

    return score;
  }
}
