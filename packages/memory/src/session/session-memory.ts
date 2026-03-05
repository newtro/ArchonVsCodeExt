/**
 * Layer 3: Session Memory — auto-summarized, confidence-weighted storage.
 *
 * At session end, generates a structured summary. Entries gain or lose
 * confidence based on subsequent usage. Below 0.2 → archived.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SessionSummary {
  id: string;
  timestamp: number;
  decisions: string[];
  filesModified: Array<{ path: string; reason: string }>;
  patternsDiscovered: string[];
  openItems: string[];
  confidence: number;
  lastReferenced: number;
}

export interface PreferencePattern {
  id: string;
  pattern: string;
  description: string;
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
  suggested: boolean;
}

export class SessionMemory {
  private summaries: SessionSummary[] = [];
  private preferences: PreferencePattern[] = [];
  private storageDir: string;
  private decayDays = 30;
  private archiveThreshold = 0.2;

  constructor(workspaceRoot: string) {
    this.storageDir = path.join(workspaceRoot, '.archon', 'memory');
  }

  /**
   * Load persisted session memory.
   */
  async load(): Promise<void> {
    const summariesPath = path.join(this.storageDir, 'sessions.json');
    const prefsPath = path.join(this.storageDir, 'preferences.json');

    if (fs.existsSync(summariesPath)) {
      try {
        this.summaries = JSON.parse(fs.readFileSync(summariesPath, 'utf-8'));
      } catch {
        this.summaries = [];
      }
    }

    if (fs.existsSync(prefsPath)) {
      try {
        this.preferences = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
      } catch {
        this.preferences = [];
      }
    }

    // Apply decay
    this.applyDecay();
  }

  /**
   * Save a new session summary.
   */
  async saveSummary(summary: Omit<SessionSummary, 'id' | 'timestamp' | 'confidence' | 'lastReferenced'>): Promise<void> {
    const entry: SessionSummary = {
      ...summary,
      id: Math.random().toString(36).slice(2, 11),
      timestamp: Date.now(),
      confidence: 1.0,
      lastReferenced: Date.now(),
    };

    this.summaries.push(entry);
    await this.persist();
  }

  /**
   * Get active summaries (above archive threshold).
   */
  getActiveSummaries(): SessionSummary[] {
    return this.summaries
      .filter(s => s.confidence >= this.archiveThreshold)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Boost confidence of a summary (referenced in current session).
   */
  referenceSummary(id: string): void {
    const summary = this.summaries.find(s => s.id === id);
    if (summary) {
      summary.confidence = Math.min(1.0, summary.confidence + 0.1);
      summary.lastReferenced = Date.now();
    }
  }

  /**
   * Format session memory for system prompt injection.
   */
  formatForPrompt(): string {
    const active = this.getActiveSummaries().slice(0, 5);
    if (active.length === 0) return '';

    const sections = active.map(s => {
      const lines: string[] = [];
      lines.push(`### Session ${new Date(s.timestamp).toLocaleDateString()} (confidence: ${s.confidence.toFixed(1)})`);
      if (s.decisions.length > 0) {
        lines.push('Decisions:');
        s.decisions.forEach(d => lines.push(`  - ${d}`));
      }
      if (s.patternsDiscovered.length > 0) {
        lines.push('Patterns:');
        s.patternsDiscovered.forEach(p => lines.push(`  - ${p}`));
      }
      if (s.openItems.length > 0) {
        lines.push('Open items:');
        s.openItems.forEach(o => lines.push(`  - ${o}`));
      }
      return lines.join('\n');
    });

    return `# Previous Session Context\n\n${sections.join('\n\n')}`;
  }

  /**
   * Track a user edit pattern for passive preference learning.
   */
  trackPreference(pattern: string, description: string): void {
    const existing = this.preferences.find(p => p.pattern === pattern);
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = Date.now();
    } else {
      this.preferences.push({
        id: Math.random().toString(36).slice(2, 11),
        pattern,
        description,
        occurrences: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        suggested: false,
      });
    }
  }

  /**
   * Get patterns that have been repeated enough to suggest as rules.
   */
  getSuggestablePatterns(): PreferencePattern[] {
    return this.preferences.filter(p => p.occurrences >= 3 && !p.suggested);
  }

  /**
   * Mark a pattern as suggested (so we don't re-suggest).
   */
  markSuggested(id: string): void {
    const pref = this.preferences.find(p => p.id === id);
    if (pref) pref.suggested = true;
  }

  private applyDecay(): void {
    const now = Date.now();
    const decayMs = this.decayDays * 24 * 60 * 60 * 1000;

    for (const summary of this.summaries) {
      const age = now - summary.lastReferenced;
      if (age > decayMs) {
        const decayFactor = age / decayMs;
        summary.confidence = Math.max(0, summary.confidence - (0.1 * decayFactor));
      }
    }
  }

  private async persist(): Promise<void> {
    fs.mkdirSync(this.storageDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.storageDir, 'sessions.json'),
      JSON.stringify(this.summaries, null, 2),
    );
    fs.writeFileSync(
      path.join(this.storageDir, 'preferences.json'),
      JSON.stringify(this.preferences, null, 2),
    );
  }
}
