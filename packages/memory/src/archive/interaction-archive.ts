/**
 * Layer 4: Interaction Archive — full searchable history of all interactions.
 *
 * Stores every user message, AI response, tool call input, and tool call output.
 * Entries are linked to file hashes and decay when files change significantly.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ArchivedInteraction {
  id: string;
  sessionId: string;
  timestamp: number;
  type: 'user_message' | 'assistant_message' | 'tool_call' | 'tool_result';
  content: string;
  metadata?: {
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    relatedFiles?: string[];
    fileHashes?: Record<string, string>;
  };
  relevance: number; // Decays as related files change
  embedding?: number[];
}

export interface ArchiveSearchResult {
  interaction: ArchivedInteraction;
  score: number;
}

export class InteractionArchive {
  private interactions: ArchivedInteraction[] = [];
  private storageDir: string;
  private enabled: boolean;
  private currentSessionId: string;

  constructor(workspaceRoot: string, enabled = true) {
    this.storageDir = path.join(workspaceRoot, '.archon', 'archive');
    this.enabled = enabled;
    this.currentSessionId = Math.random().toString(36).slice(2, 11);
  }

  /**
   * Load archive from disk.
   */
  async load(): Promise<void> {
    if (!this.enabled) return;

    const archivePath = path.join(this.storageDir, 'interactions.json');
    if (fs.existsSync(archivePath)) {
      try {
        this.interactions = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
      } catch {
        this.interactions = [];
      }
    }
  }

  /**
   * Archive a new interaction.
   */
  async add(
    type: ArchivedInteraction['type'],
    content: string,
    metadata?: ArchivedInteraction['metadata'],
  ): Promise<void> {
    if (!this.enabled) return;

    const interaction: ArchivedInteraction = {
      id: Math.random().toString(36).slice(2, 11),
      sessionId: this.currentSessionId,
      timestamp: Date.now(),
      type,
      content,
      metadata,
      relevance: 1.0,
    };

    this.interactions.push(interaction);

    // Auto-persist every 10 interactions
    if (this.interactions.length % 10 === 0) {
      await this.persist();
    }
  }

  /**
   * Search the archive with a text query.
   * Falls back to simple text search when no embeddings available.
   */
  search(query: string, topK = 10): ArchiveSearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const results: ArchiveSearchResult[] = [];

    for (const interaction of this.interactions) {
      if (interaction.relevance < 0.1) continue;

      const content = interaction.content.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (content.includes(term)) score += 1;
      }
      if (score > 0) {
        score = (score / queryTerms.length) * interaction.relevance;
        results.push({ interaction, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Decay relevance of interactions linked to changed files.
   */
  decayForFile(filePath: string): void {
    for (const interaction of this.interactions) {
      if (interaction.metadata?.relatedFiles?.includes(filePath)) {
        interaction.relevance = Math.max(0, interaction.relevance - 0.2);
      }
    }
  }

  /**
   * Purge interactions by date range.
   */
  purge(before?: Date, after?: Date): number {
    const startLen = this.interactions.length;
    this.interactions = this.interactions.filter(i => {
      if (before && i.timestamp > before.getTime()) return true;
      if (after && i.timestamp < after.getTime()) return true;
      if (before && after) {
        return i.timestamp < after.getTime() || i.timestamp > before.getTime();
      }
      return false;
    });
    return startLen - this.interactions.length;
  }

  /**
   * Get interaction count.
   */
  getCount(): number {
    return this.interactions.length;
  }

  /**
   * Enable or disable archiving.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Persist archive to disk.
   */
  async persist(): Promise<void> {
    if (!this.enabled) return;
    fs.mkdirSync(this.storageDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.storageDir, 'interactions.json'),
      JSON.stringify(this.interactions),
    );
  }
}
