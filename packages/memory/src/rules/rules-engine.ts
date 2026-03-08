/**
 * Layer 1: Rules Engine — file-scoped project conventions loaded into system prompt.
 *
 * Rules are stored in `.archon/rules/` as markdown files with frontmatter:
 *   ---
 *   mode: always | manual
 *   fileMatch: "*.tsx"    # optional glob pattern
 *   ---
 *   Your rule content here...
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Rule {
  id: string;
  filePath: string;
  mode: 'always' | 'manual';
  fileMatch?: string;
  content: string;
}

export class RulesEngine {
  private rules: Rule[] = [];
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Load all rules from `.archon/rules/` directory.
   */
  async loadRules(): Promise<void> {
    const rulesDir = path.join(this.workspaceRoot, '.archon', 'rules');
    this.rules = [];

    if (!fs.existsSync(rulesDir)) return;

    const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(rulesDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const rule = this.parseRule(file, filePath, raw);
      if (rule) this.rules.push(rule);
    }
  }

  /**
   * Get rules applicable to the current context.
   */
  getRulesForContext(activeFiles?: string[]): Rule[] {
    return this.rules.filter(rule => {
      if (rule.mode === 'always') return true;
      if (rule.mode === 'manual') return false;

      // File match mode
      if (rule.fileMatch && activeFiles) {
        return activeFiles.some(f => this.matchGlob(f, rule.fileMatch!));
      }

      return false;
    });
  }

  /**
   * Get all rules (for manual selection).
   */
  getAllRules(): Rule[] {
    return [...this.rules];
  }

  /**
   * Format rules as text for injection into system prompt.
   */
  formatRulesForPrompt(rules: Rule[]): string {
    if (rules.length === 0) return '';

    const sections = rules.map(r =>
      `## Rule: ${r.id}\n${r.content}`
    );

    return `# Project Rules\n\n${sections.join('\n\n')}`;
  }

  private parseRule(filename: string, filePath: string, raw: string): Rule | null {
    const id = filename.replace(/\.md$/, '');

    // Parse frontmatter
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      // No frontmatter — treat as always-on rule
      return {
        id,
        filePath,
        mode: 'always',
        content: raw.trim(),
      };
    }

    const frontmatter = frontmatterMatch[1];
    const content = frontmatterMatch[2].trim();

    let mode: 'always' | 'manual' = 'always';
    let fileMatch: string | undefined;

    for (const line of frontmatter.split('\n')) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim().replace(/^["']|["']$/g, '');

      if (key.trim() === 'mode') {
        if (value === 'manual' || value === 'always') {
          mode = value;
        }
      } else if (key.trim() === 'fileMatch') {
        fileMatch = value;
        if (!mode) mode = 'always'; // fileMatch implies conditional loading
      }
    }

    return { id, filePath, mode, fileMatch, content };
  }

  /** Create a new rule file and reload. */
  async createRule(name: string, content: string, mode: 'always' | 'manual' = 'always', fileMatch?: string): Promise<Rule> {
    const rulesDir = path.join(this.workspaceRoot, '.archon', 'rules');
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }
    const filename = name.replace(/[^a-zA-Z0-9_-]/g, '-') + '.md';
    const filePath = path.join(rulesDir, filename);
    const frontmatter = [
      '---',
      `mode: ${mode}`,
      ...(fileMatch ? [`fileMatch: "${fileMatch}"`] : []),
      '---',
    ].join('\n');
    fs.writeFileSync(filePath, `${frontmatter}\n${content}`, 'utf-8');
    await this.loadRules();
    return this.rules.find(r => r.id === name.replace(/[^a-zA-Z0-9_-]/g, '-'))!;
  }

  /** Update an existing rule file. */
  async updateRule(id: string, updates: { content?: string; mode?: 'always' | 'manual'; fileMatch?: string }): Promise<void> {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return;
    const mode = updates.mode ?? rule.mode;
    const fileMatch = updates.fileMatch ?? rule.fileMatch;
    const content = updates.content ?? rule.content;
    const frontmatter = [
      '---',
      `mode: ${mode}`,
      ...(fileMatch ? [`fileMatch: "${fileMatch}"`] : []),
      '---',
    ].join('\n');
    fs.writeFileSync(rule.filePath, `${frontmatter}\n${content}`, 'utf-8');
    await this.loadRules();
  }

  /** Delete a rule file. */
  async deleteRule(id: string): Promise<void> {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return;
    if (fs.existsSync(rule.filePath)) {
      fs.unlinkSync(rule.filePath);
    }
    await this.loadRules();
  }

  private matchGlob(filePath: string, pattern: string): boolean {
    // Simple glob matching (supports * and **)
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
    return new RegExp(`(^|/)${regex}$`).test(filePath);
  }
}
