/**
 * Auto-Summarizer — LLM-powered session summarization and mid-session compression.
 *
 * Generates structured session summaries at session end, and performs
 * progressive compression when context budget is strained.
 *
 * The LLM is accessed via a callback so this module stays provider-agnostic.
 */

import type { MemoryDatabase } from '../db/memory-database';
import type { SessionMemory, SessionSummary } from './session-memory';
import type { InteractionArchive } from '../archive/interaction-archive';

/** Callback the host provides to run an LLM completion. */
export type LlmCompletionFn = (
  systemPrompt: string,
  userMessage: string,
) => Promise<string>;

export interface SummarizerConfig {
  /** Whether auto-summarization is enabled. */
  enabled: boolean;
  /** Max tokens the LLM should produce for a summary. */
  maxSummaryTokens: number;
  /** Max conversation tokens to send for summarization (truncate if larger). */
  maxInputTokens: number;
}

const DEFAULT_CONFIG: SummarizerConfig = {
  enabled: true,
  maxSummaryTokens: 1000,
  maxInputTokens: 8000,
};

const SUMMARIZE_SYSTEM_PROMPT = `You are a session summarizer for an AI coding assistant.
Given a conversation between a user and an AI coding assistant, extract a structured summary.

Respond ONLY with valid JSON in this exact format:
{
  "decisions": ["decision 1", "decision 2"],
  "filesModified": [{"path": "file/path.ts", "reason": "why it was modified"}],
  "patternsDiscovered": ["pattern 1"],
  "openItems": ["incomplete work or follow-ups"]
}

Rules:
- Be concise — each item should be one sentence
- Focus on technical decisions, not conversation flow
- Only include files that were actually modified
- Open items = things mentioned but not completed
- If nothing fits a category, use an empty array`;

const COMPRESS_SYSTEM_PROMPT = `You are a context compressor for an AI coding assistant.
Compress the following conversation excerpt into a brief summary.
Preserve: key decisions, file modifications, technical facts, user preferences.
Discard: greetings, filler, verbose tool outputs, repeated information.
Be extremely concise — aim for 20% of the original length.`;

export class AutoSummarizer {
  private memDb: MemoryDatabase;
  private sessionMemory: SessionMemory;
  private archive?: InteractionArchive;
  private llmFn?: LlmCompletionFn;
  private config: SummarizerConfig;

  constructor(
    memDb: MemoryDatabase,
    sessionMemory: SessionMemory,
    archive?: InteractionArchive,
    config?: Partial<SummarizerConfig>,
  ) {
    this.memDb = memDb;
    this.sessionMemory = sessionMemory;
    this.archive = archive;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Set the LLM completion function. Must be called before summarization works. */
  setLlmFn(fn: LlmCompletionFn): void {
    this.llmFn = fn;
  }

  /** Check if the summarizer is ready (LLM function available and enabled). */
  isReady(): boolean {
    return this.config.enabled && !!this.llmFn;
  }

  /**
   * Generate a structured session summary from conversation history.
   * Call at session end or when context is exhausted.
   */
  async summarizeSession(
    messages: Array<{ role: string; content: string }>,
  ): Promise<SessionSummary | null> {
    if (!this.isReady()) return null;

    // Truncate to max input tokens (~4 chars per token)
    const maxChars = this.config.maxInputTokens * 4;
    let conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');

    if (conversationText.length > maxChars) {
      // Keep the most recent messages
      conversationText = conversationText.slice(-maxChars);
    }

    try {
      const response = await this.llmFn!(
        SUMMARIZE_SYSTEM_PROMPT,
        conversationText,
      );

      const parsed = this.parseSummaryResponse(response);
      if (!parsed) return null;

      // Save to session memory
      this.sessionMemory.saveSummary(parsed);

      // Archive the summarization event
      if (this.archive) {
        this.archive.add('tool_result', `Session auto-summarized: ${parsed.decisions.length} decisions, ${parsed.filesModified.length} files`, {
          toolName: 'auto_summarizer',
        });
      }

      this.memDb.recordMetric('auto_summarize', {
        decisions: parsed.decisions.length,
        filesModified: parsed.filesModified.length,
        patterns: parsed.patternsDiscovered.length,
        openItems: parsed.openItems.length,
      });

      // Return the full summary (saveSummary adds id/timestamp/confidence)
      return {
        id: '', // filled by caller if needed
        timestamp: Date.now(),
        ...parsed,
        confidence: 1.0,
        lastReferenced: Date.now(),
      };
    } catch (err) {
      this.memDb.recordMetric('auto_summarize_error', {
        error: String(err),
      });
      return null;
    }
  }

  /**
   * Compress a block of conversation messages using the LLM.
   * Returns the compressed text, or null if compression fails.
   */
  async compressMessages(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string | null> {
    if (!this.isReady()) return null;

    const text = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');

    try {
      const compressed = await this.llmFn!(COMPRESS_SYSTEM_PROMPT, text);

      this.memDb.recordMetric('llm_compression', {
        originalChars: text.length,
        compressedChars: compressed.length,
        ratio: (compressed.length / text.length).toFixed(2),
      });

      return compressed;
    } catch {
      return null;
    }
  }

  /**
   * Run intelligent forgetting across all memory layers.
   * Call on startup or periodically.
   */
  runForgettingCycle(): ForgettingReport {
    const report: ForgettingReport = {
      sessionsDecayed: 0,
      sessionsPurged: 0,
      interactionsDecayed: 0,
    };

    // 1. Session memory decay (time-based + purge)
    const beforeSessions = this.sessionMemory.getActiveSummaries().length;
    this.sessionMemory.applyDecay();
    const afterSessions = this.sessionMemory.getActiveSummaries().length;
    report.sessionsPurged = Math.max(0, beforeSessions - afterSessions);

    this.memDb.recordMetric('forgetting_cycle', { ...report });
    return report;
  }

  /**
   * Decay memories linked to a changed file across all layers.
   */
  decayForFileChange(filePath: string): void {
    this.sessionMemory.decayForFileChange(filePath);
    if (this.archive) {
      this.archive.decayForFile(filePath);
    }
  }

  /** Update configuration. */
  setConfig(config: Partial<SummarizerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ── Private ──

  private parseSummaryResponse(
    response: string,
  ): Omit<SessionSummary, 'id' | 'timestamp' | 'confidence' | 'lastReferenced'> | null {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response;
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const data = JSON.parse(jsonStr.trim());

      return {
        decisions: Array.isArray(data.decisions) ? data.decisions : [],
        filesModified: Array.isArray(data.filesModified) ? data.filesModified : [],
        patternsDiscovered: Array.isArray(data.patternsDiscovered) ? data.patternsDiscovered : [],
        openItems: Array.isArray(data.openItems) ? data.openItems : [],
      };
    } catch {
      return null;
    }
  }
}

export interface ForgettingReport {
  sessionsDecayed: number;
  sessionsPurged: number;
  interactionsDecayed: number;
}
