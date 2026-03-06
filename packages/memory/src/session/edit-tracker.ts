/**
 * Edit Tracker — autonomous preference learning from user edits.
 *
 * Observes diffs between AI-generated code and user's final version.
 * After enough similar edits, extracts patterns and stores them as preferences.
 * High-confidence preferences are auto-applied to future AI output.
 */

import type { MemoryDatabase } from '../db/memory-database';
import type { SessionMemory } from './session-memory';
import type { LlmCompletionFn } from './auto-summarizer';

export interface EditObservation {
  filePath: string;
  aiOutput: string;
  userVersion: string;
  timestamp: number;
}

export interface LearnedPattern {
  id: string;
  pattern: string;
  description: string;
  category: PatternCategory;
  occurrences: number;
  confidence: number;
  autoApply: boolean;
  examples: string[];
}

export type PatternCategory =
  | 'code_style'
  | 'naming'
  | 'error_handling'
  | 'architecture'
  | 'tool_usage'
  | 'other';

const EXTRACT_PATTERN_PROMPT = `You are a pattern extraction system for an AI coding assistant.
Given a set of edit diffs (AI output → user's version), identify consistent patterns.

Respond ONLY with valid JSON in this format:
{
  "patterns": [
    {
      "pattern": "short_pattern_key",
      "description": "Human-readable description of what the user prefers",
      "category": "code_style|naming|error_handling|architecture|tool_usage|other",
      "examples": ["brief example of the transformation"]
    }
  ]
}

Rules:
- Only include patterns that appear in 2+ of the diffs
- Be specific — "prefers const over let" not "prefers certain styles"
- pattern key should be snake_case, unique, and descriptive
- If no consistent patterns, return {"patterns": []}`;

/** Minimum edits before attempting pattern extraction. */
const MIN_OBSERVATIONS = 3;

/** Confidence threshold for auto-applying a pattern. */
const AUTO_APPLY_THRESHOLD = 0.8;

export class EditTracker {
  private memDb: MemoryDatabase;
  private sessionMemory: SessionMemory;
  private llmFn?: LlmCompletionFn;
  private pendingObservations: EditObservation[] = [];

  constructor(memDb: MemoryDatabase, sessionMemory: SessionMemory) {
    this.memDb = memDb;
    this.sessionMemory = sessionMemory;
  }

  /** Set the LLM function for pattern extraction. */
  setLlmFn(fn: LlmCompletionFn): void {
    this.llmFn = fn;
  }

  /**
   * Record an edit observation: AI produced some code, user changed it.
   * Computes a simple diff and stores for later pattern extraction.
   */
  observe(filePath: string, aiOutput: string, userVersion: string): void {
    // Skip if identical
    if (aiOutput.trim() === userVersion.trim()) return;

    this.pendingObservations.push({
      filePath,
      aiOutput,
      userVersion,
      timestamp: Date.now(),
    });

    // Track as a raw preference observation
    const diffSummary = this.computeDiffSummary(aiOutput, userVersion);
    if (diffSummary) {
      this.sessionMemory.trackPreference(
        `edit:${diffSummary.key}`,
        diffSummary.description,
      );
    }

    this.memDb.recordMetric('edit_observation', {
      filePath,
      aiLength: aiOutput.length,
      userLength: userVersion.length,
    });
  }

  /**
   * Attempt to extract patterns from accumulated observations.
   * Call periodically (e.g., at session end or after N observations).
   */
  async extractPatterns(): Promise<LearnedPattern[]> {
    if (this.pendingObservations.length < MIN_OBSERVATIONS) return [];
    if (!this.llmFn) return [];

    const diffsText = this.pendingObservations
      .slice(-10) // Use last 10 observations max
      .map((obs, i) => {
        const aiLines = obs.aiOutput.split('\n').slice(0, 20);
        const userLines = obs.userVersion.split('\n').slice(0, 20);
        return `--- Diff ${i + 1} (${obs.filePath}) ---\nAI output:\n${aiLines.join('\n')}\n\nUser version:\n${userLines.join('\n')}`;
      })
      .join('\n\n');

    try {
      const response = await this.llmFn(EXTRACT_PATTERN_PROMPT, diffsText);
      const parsed = this.parsePatternResponse(response);

      for (const p of parsed) {
        this.sessionMemory.trackPreference(p.pattern, p.description);
      }

      // Clear processed observations
      this.pendingObservations = [];

      this.memDb.recordMetric('pattern_extraction', {
        observationsProcessed: this.pendingObservations.length,
        patternsFound: parsed.length,
      });

      return parsed;
    } catch {
      return [];
    }
  }

  /**
   * Get all learned patterns from session memory that are ready for suggestion.
   */
  getSuggestablePatterns(): LearnedPattern[] {
    const prefs = this.sessionMemory.getSuggestablePatterns();
    return prefs.map((p) => ({
      id: p.id,
      pattern: p.pattern,
      description: p.description,
      category: this.inferCategory(p.pattern) as PatternCategory,
      occurrences: p.occurrences,
      confidence: p.confidence,
      autoApply: p.autoApplied,
      examples: [],
    }));
  }

  /**
   * Get patterns that should be auto-applied (high confidence).
   */
  getAutoApplyPatterns(): LearnedPattern[] {
    return this.getSuggestablePatterns().filter(
      (p) => p.confidence >= AUTO_APPLY_THRESHOLD,
    );
  }

  /**
   * Mark a pattern as confirmed by the user (boost confidence).
   */
  confirmPattern(patternId: string): void {
    // Use trackPreference to boost occurrences/confidence
    const patterns = this.getSuggestablePatterns();
    const match = patterns.find((p) => p.id === patternId);
    if (match) {
      this.sessionMemory.trackPreference(match.pattern, match.description);
    }
  }

  /**
   * Mark a pattern as rejected (decay confidence).
   */
  rejectPattern(patternId: string): void {
    // Track as negative signal — description prefix marks it
    const patterns = this.getSuggestablePatterns();
    const match = patterns.find((p) => p.id === patternId);
    if (match) {
      this.memDb.recordMetric('pattern_rejected', {
        pattern: match.pattern,
        patternId,
      });
    }
  }

  /**
   * Enable auto-apply for a pattern.
   */
  enableAutoApply(patternId: string): void {
    this.sessionMemory.markAutoApplied(patternId);
  }

  /** Get the count of pending observations. */
  getPendingCount(): number {
    return this.pendingObservations.length;
  }

  // ── Private ──

  private computeDiffSummary(
    aiOutput: string,
    userVersion: string,
  ): { key: string; description: string } | null {
    const aiLines = aiOutput.split('\n');
    const userLines = userVersion.split('\n');

    // Simple heuristic: categorize the type of change
    const aiStr = aiOutput.toLowerCase();
    const userStr = userVersion.toLowerCase();

    // Detect common patterns
    if (aiStr.includes('let ') && !userStr.includes('let ') && userStr.includes('const ')) {
      return { key: 'prefer_const', description: 'User changes let to const' };
    }
    if (aiStr.includes('.foreach') && userStr.includes('for (') || userStr.includes('for...of')) {
      return { key: 'prefer_for_loop', description: 'User changes forEach to for loop' };
    }
    if (!aiStr.includes('try') && userStr.includes('try {')) {
      return { key: 'add_try_catch', description: 'User adds try/catch error handling' };
    }

    // Generic: line count change
    const lineDiff = Math.abs(aiLines.length - userLines.length);
    if (lineDiff > 5) {
      return {
        key: `restructure_${lineDiff > 20 ? 'major' : 'minor'}`,
        description: `User restructured code (${lineDiff} line difference)`,
      };
    }

    return null;
  }

  private inferCategory(pattern: string): string {
    if (pattern.startsWith('edit:prefer_const') || pattern.startsWith('edit:prefer_for')) {
      return 'code_style';
    }
    if (pattern.includes('naming') || pattern.includes('case')) {
      return 'naming';
    }
    if (pattern.includes('try') || pattern.includes('error') || pattern.includes('catch')) {
      return 'error_handling';
    }
    if (pattern.includes('inject') || pattern.includes('interface') || pattern.includes('abstract')) {
      return 'architecture';
    }
    if (pattern.includes('tool') || pattern.includes('edit_file') || pattern.includes('write_file')) {
      return 'tool_usage';
    }
    return 'other';
  }

  private parsePatternResponse(response: string): LearnedPattern[] {
    try {
      let jsonStr = response;
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const data = JSON.parse(jsonStr.trim());
      if (!Array.isArray(data.patterns)) return [];

      return data.patterns.map((p: Record<string, unknown>) => ({
        id: Math.random().toString(36).slice(2, 11),
        pattern: String(p.pattern ?? ''),
        description: String(p.description ?? ''),
        category: (p.category as PatternCategory) ?? 'other',
        occurrences: 1,
        confidence: 0.5,
        autoApply: false,
        examples: Array.isArray(p.examples) ? p.examples.map(String) : [],
      }));
    } catch {
      return [];
    }
  }
}
