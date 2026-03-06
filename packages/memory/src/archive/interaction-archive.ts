/**
 * Layer 5: Interaction Archive — full searchable history of all interactions.
 *
 * Stores every user message, AI response, tool call input, and tool call output.
 * Entries are linked to file hashes and decay when files change significantly.
 * Search uses BM25 + vector hybrid when embeddings are available.
 *
 * Storage: Unified SQLite via MemoryDatabase (interactions table).
 */

import type Database from 'better-sqlite3';
import type { MemoryDatabase } from '../db/memory-database';

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
  relevance: number;
}

export interface ArchiveSearchResult {
  interaction: ArchivedInteraction;
  score: number;
}

// BM25 constants
const BM25_K1 = 1.5;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length > 1);
}

export class InteractionArchive {
  private memDb: MemoryDatabase;
  private db: Database.Database;
  private enabled: boolean;
  private currentSessionId: string;

  // Prepared statements
  private stmts: {
    insert?: Database.Statement;
    search?: Database.Statement;
    getCount?: Database.Statement;
    getByFile?: Database.Statement;
    updateRelevance?: Database.Statement;
    purge?: Database.Statement;
    getAll?: Database.Statement;
  } = {};

  constructor(memDb: MemoryDatabase, enabled = true) {
    this.memDb = memDb;
    this.db = memDb.getDb();
    this.enabled = enabled;
    this.currentSessionId = Math.random().toString(36).slice(2, 11);
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmts.insert = this.db.prepare(
      `INSERT INTO interactions (id, session_id, timestamp, type, content, metadata, relevance, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.stmts.getCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM interactions',
    );
    this.stmts.getByFile = this.db.prepare(
      `SELECT id, relevance FROM interactions WHERE metadata LIKE ?`,
    );
    this.stmts.updateRelevance = this.db.prepare(
      'UPDATE interactions SET relevance = ? WHERE id = ?',
    );
    this.stmts.purge = this.db.prepare(
      'DELETE FROM interactions WHERE timestamp BETWEEN ? AND ?',
    );
    this.stmts.getAll = this.db.prepare(
      'SELECT id, session_id, timestamp, type, content, metadata, relevance FROM interactions WHERE relevance >= 0.1 ORDER BY timestamp DESC',
    );
  }

  /**
   * Archive a new interaction.
   */
  add(
    type: ArchivedInteraction['type'],
    content: string,
    metadata?: ArchivedInteraction['metadata'],
  ): void {
    if (!this.enabled) return;

    const id = Math.random().toString(36).slice(2, 11);
    this.stmts.insert!.run(
      id,
      this.currentSessionId,
      Date.now(),
      type,
      content,
      metadata ? JSON.stringify(metadata) : null,
      1.0,
      null, // embedding generated separately
    );
  }

  /**
   * Search the archive with BM25 text search.
   * Relevance decay is applied as a score multiplier.
   */
  search(query: string, topK = 10): ArchiveSearchResult[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const rows = this.stmts.getAll!.all() as Array<{
      id: string;
      session_id: string;
      timestamp: number;
      type: string;
      content: string;
      metadata: string | null;
      relevance: number;
    }>;

    // Build per-query BM25 stats
    let totalLength = 0;
    const docFreq = new Map<string, number>();
    const docInfos: Array<{
      row: (typeof rows)[0];
      termFreqs: Map<string, number>;
      docLength: number;
    }> = [];

    for (const row of rows) {
      const tokens = tokenize(row.content);
      const termFreqs = new Map<string, number>();
      for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
      }
      for (const term of termFreqs.keys()) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
      totalLength += tokens.length;
      docInfos.push({ row, termFreqs, docLength: tokens.length });
    }

    const avgDocLength = rows.length > 0 ? totalLength / rows.length : 0;
    const results: ArchiveSearchResult[] = [];

    for (const { row, termFreqs, docLength } of docInfos) {
      let score = 0;
      for (const term of queryTerms) {
        const tf = termFreqs.get(term) ?? 0;
        if (tf === 0) continue;

        const df = docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (rows.length - df + 0.5) / (df + 0.5));
        const tfNorm =
          (tf * (BM25_K1 + 1)) /
          (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgDocLength)));
        score += idf * tfNorm;
      }

      if (score > 0) {
        // Apply relevance decay as a multiplier
        score *= row.relevance;
        results.push({
          interaction: {
            id: row.id,
            sessionId: row.session_id,
            timestamp: row.timestamp,
            type: row.type as ArchivedInteraction['type'],
            content: row.content,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            relevance: row.relevance,
          },
          score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Decay relevance of interactions linked to changed files.
   */
  decayForFile(filePath: string): void {
    // Search for interactions that mention this file in metadata
    const pattern = `%${filePath.replace(/\\/g, '\\\\').replace(/%/g, '\\%')}%`;
    const rows = this.stmts.getByFile!.all(pattern) as Array<{
      id: string;
      relevance: number;
    }>;

    for (const row of rows) {
      const newRelevance = Math.max(0, row.relevance - 0.2);
      this.stmts.updateRelevance!.run(newRelevance, row.id);
    }

    if (rows.length > 0) {
      this.memDb.recordMetric('forgetting', {
        reason: 'file_changed',
        filePath,
        interactionsDecayed: rows.length,
      });
    }
  }

  /**
   * Purge interactions by date range.
   */
  purge(after: Date, before: Date): number {
    const result = this.stmts.purge!.run(after.getTime(), before.getTime());
    return result.changes;
  }

  /**
   * Get interaction count.
   */
  getCount(): number {
    return (this.stmts.getCount!.get() as { count: number }).count;
  }

  /**
   * Enable or disable archiving.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Start a new session (call at session start).
   */
  startSession(): string {
    this.currentSessionId = Math.random().toString(36).slice(2, 11);
    return this.currentSessionId;
  }
}
