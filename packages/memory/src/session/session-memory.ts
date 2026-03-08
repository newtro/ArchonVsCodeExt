/**
 * Layer 4: Session Memory — auto-summarized, confidence-weighted storage.
 *
 * At session end, generates a structured summary. Entries gain or lose
 * confidence based on subsequent usage and intelligent forgetting rules.
 *
 * Storage: Unified SQLite via MemoryDatabase (sessions + preferences tables).
 */

import type Database from 'better-sqlite3';
import type { MemoryDatabase } from '../db/memory-database';

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
  autoApplied: boolean;
  confidence: number;
}

export class SessionMemory {
  private memDb: MemoryDatabase;
  private db: Database.Database;
  private decayDays = 30;
  private archiveThreshold = 0.15;
  private purgeThreshold = 0.05;

  // Prepared statements
  private stmts: {
    insertSession?: Database.Statement;
    getActiveSessions?: Database.Statement;
    updateSessionConfidence?: Database.Statement;
    deleteSession?: Database.Statement;
    upsertPreference?: Database.Statement;
    getPreference?: Database.Statement;
    getSuggestable?: Database.Statement;
    markAutoApplied?: Database.Statement;
    getAllSessions?: Database.Statement;
  } = {};

  constructor(memDb: MemoryDatabase) {
    this.memDb = memDb;
    this.db = memDb.getDb();
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmts.insertSession = this.db.prepare(
      `INSERT INTO sessions (id, timestamp, decisions, files_modified, patterns_discovered, open_items, confidence, last_referenced, summary_embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.stmts.getActiveSessions = this.db.prepare(
      'SELECT * FROM sessions WHERE confidence >= ? ORDER BY confidence DESC',
    );
    this.stmts.updateSessionConfidence = this.db.prepare(
      'UPDATE sessions SET confidence = ?, last_referenced = ? WHERE id = ?',
    );
    this.stmts.deleteSession = this.db.prepare(
      'DELETE FROM sessions WHERE id = ?',
    );
    this.stmts.getAllSessions = this.db.prepare(
      'SELECT * FROM sessions ORDER BY timestamp DESC',
    );
    this.stmts.upsertPreference = this.db.prepare(
      `INSERT INTO preferences (id, pattern, description, occurrences, first_seen, last_seen, auto_applied, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         occurrences = excluded.occurrences,
         last_seen = excluded.last_seen,
         confidence = excluded.confidence`,
    );
    this.stmts.getPreference = this.db.prepare(
      'SELECT * FROM preferences WHERE pattern = ?',
    );
    this.stmts.getSuggestable = this.db.prepare(
      'SELECT * FROM preferences WHERE occurrences >= 3 AND auto_applied = 0',
    );
    this.stmts.markAutoApplied = this.db.prepare(
      'UPDATE preferences SET auto_applied = 1 WHERE id = ?',
    );
  }

  /**
   * Apply confidence decay and purge expired entries.
   * Call on startup.
   */
  applyDecay(): void {
    const now = Date.now();
    const decayMs = this.decayDays * 24 * 60 * 60 * 1000;

    const sessions = this.stmts.getAllSessions!.all() as Array<{
      id: string;
      confidence: number;
      last_referenced: number;
      timestamp: number;
    }>;

    this.memDb.transaction(() => {
      for (const session of sessions) {
        const age = now - session.last_referenced;

        // Purge: below threshold for 60+ days
        if (session.confidence < this.purgeThreshold) {
          const daysBelowThreshold = age / (24 * 60 * 60 * 1000);
          if (daysBelowThreshold > 60) {
            this.stmts.deleteSession!.run(session.id);
            this.memDb.recordMetric('forgetting', {
              sessionId: session.id,
              reason: 'purge_threshold',
              confidence: session.confidence,
            });
            continue;
          }
        }

        // Decay: unreferenced entries lose confidence over time
        if (age > decayMs) {
          const weeksOverdue = Math.floor(age / (7 * 24 * 60 * 60 * 1000));
          const newConfidence = Math.max(0, session.confidence - 0.05 * weeksOverdue);
          if (newConfidence !== session.confidence) {
            this.stmts.updateSessionConfidence!.run(
              newConfidence,
              session.last_referenced,
              session.id,
            );
          }
        }
      }
    });
  }

  /**
   * Save a new session summary.
   */
  saveSummary(
    summary: Omit<SessionSummary, 'id' | 'timestamp' | 'confidence' | 'lastReferenced'>,
  ): void {
    const id = Math.random().toString(36).slice(2, 11);
    const now = Date.now();

    this.stmts.insertSession!.run(
      id,
      now,
      JSON.stringify(summary.decisions),
      JSON.stringify(summary.filesModified),
      JSON.stringify(summary.patternsDiscovered),
      JSON.stringify(summary.openItems),
      1.0,
      now,
      null, // embedding generated separately
    );

    this.memDb.recordMetric('session_save', { sessionId: id });
  }

  /**
   * Get active summaries (above archive threshold).
   */
  getActiveSummaries(): SessionSummary[] {
    const rows = this.stmts.getActiveSessions!.all(this.archiveThreshold) as Array<{
      id: string;
      timestamp: number;
      decisions: string;
      files_modified: string;
      patterns_discovered: string;
      open_items: string;
      confidence: number;
      last_referenced: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      decisions: JSON.parse(r.decisions || '[]'),
      filesModified: JSON.parse(r.files_modified || '[]'),
      patternsDiscovered: JSON.parse(r.patterns_discovered || '[]'),
      openItems: JSON.parse(r.open_items || '[]'),
      confidence: r.confidence,
      lastReferenced: r.last_referenced,
    }));
  }

  /**
   * Boost confidence of a summary (referenced in current session).
   */
  referenceSummary(id: string): void {
    const row = this.db
      .prepare('SELECT confidence FROM sessions WHERE id = ?')
      .get(id) as { confidence: number } | undefined;
    if (row) {
      const newConfidence = Math.min(1.0, row.confidence + 0.1);
      this.stmts.updateSessionConfidence!.run(newConfidence, Date.now(), id);
    }
  }

  /**
   * Decay confidence due to contradiction with newer information.
   */
  contradictSummary(id: string): void {
    const row = this.db
      .prepare('SELECT confidence FROM sessions WHERE id = ?')
      .get(id) as { confidence: number } | undefined;
    if (row) {
      const newConfidence = Math.max(0, row.confidence - 0.3);
      this.stmts.updateSessionConfidence!.run(newConfidence, Date.now(), id);
      this.memDb.recordMetric('forgetting', {
        sessionId: id,
        reason: 'contradiction',
        oldConfidence: row.confidence,
        newConfidence,
      });
    }
  }

  /**
   * Decay confidence for summaries linked to significantly changed files.
   */
  decayForFileChange(filePath: string): void {
    const sessions = this.stmts.getAllSessions!.all() as Array<{
      id: string;
      files_modified: string;
      confidence: number;
    }>;

    for (const session of sessions) {
      const filesModified = JSON.parse(session.files_modified || '[]') as Array<{
        path: string;
      }>;
      if (filesModified.some((f) => f.path === filePath)) {
        const newConfidence = Math.max(0, session.confidence - 0.2);
        this.stmts.updateSessionConfidence!.run(newConfidence, Date.now(), session.id);
        this.memDb.recordMetric('forgetting', {
          sessionId: session.id,
          reason: 'file_changed',
          filePath,
        });
      }
    }
  }

  /**
   * Format session memory for system prompt injection.
   */
  formatForPrompt(): string {
    const active = this.getActiveSummaries().slice(0, 5);
    if (active.length === 0) return '';

    const sections = active.map((s) => {
      const lines: string[] = [];
      lines.push(
        `### Session ${new Date(s.timestamp).toLocaleDateString()} (confidence: ${s.confidence.toFixed(1)})`,
      );
      if (s.decisions.length > 0) {
        lines.push('Decisions:');
        s.decisions.forEach((d) => lines.push(`  - ${d}`));
      }
      if (s.patternsDiscovered.length > 0) {
        lines.push('Patterns:');
        s.patternsDiscovered.forEach((p) => lines.push(`  - ${p}`));
      }
      if (s.openItems.length > 0) {
        lines.push('Open items:');
        s.openItems.forEach((o) => lines.push(`  - ${o}`));
      }
      return lines.join('\n');
    });

    return `# Previous Session Context\n\n${sections.join('\n\n')}`;
  }

  /**
   * Track a user edit pattern for passive preference learning.
   */
  trackPreference(pattern: string, description: string): void {
    const existing = this.stmts.getPreference!.get(pattern) as
      | {
          id: string;
          occurrences: number;
          confidence: number;
        }
      | undefined;

    if (existing) {
      const newOccurrences = existing.occurrences + 1;
      const newConfidence = Math.min(1.0, existing.confidence + 0.1);
      this.stmts.upsertPreference!.run(
        existing.id,
        pattern,
        description,
        newOccurrences,
        0, // first_seen unchanged (ON CONFLICT ignores it)
        Date.now(),
        0,
        newConfidence,
      );
    } else {
      const id = Math.random().toString(36).slice(2, 11);
      this.stmts.upsertPreference!.run(
        id,
        pattern,
        description,
        1,
        Date.now(),
        Date.now(),
        0,
        0.5,
      );
    }
  }

  /**
   * Get patterns repeated enough to suggest as rules.
   */
  getSuggestablePatterns(): PreferencePattern[] {
    const rows = this.stmts.getSuggestable!.all() as Array<{
      id: string;
      pattern: string;
      description: string;
      occurrences: number;
      first_seen: number;
      last_seen: number;
      auto_applied: number;
      confidence: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      description: r.description,
      occurrences: r.occurrences,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      autoApplied: r.auto_applied === 1,
      confidence: r.confidence,
    }));
  }

  /**
   * Mark a pattern as auto-applied.
   */
  markAutoApplied(id: string): void {
    this.stmts.markAutoApplied!.run(id);
  }

  /** Get all sessions (for dashboard CRUD). */
  getSessions(): SessionSummary[] {
    const rows = this.stmts.getAllSessions!.all() as Array<{
      id: string;
      timestamp: number;
      decisions: string;
      files_modified: string;
      patterns_discovered: string;
      open_items: string;
      confidence: number;
      last_referenced: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      decisions: JSON.parse(r.decisions || '[]'),
      filesModified: JSON.parse(r.files_modified || '[]'),
      patternsDiscovered: JSON.parse(r.patterns_discovered || '[]'),
      openItems: JSON.parse(r.open_items || '[]'),
      confidence: r.confidence,
      lastReferenced: r.last_referenced,
    }));
  }

  /** Delete a session by ID. */
  deleteSessionById(id: string): void {
    this.stmts.deleteSession!.run(id);
  }

  /** Pin a session (set confidence to max so decay doesn't remove it). */
  pinSession(id: string, pinned: boolean): void {
    if (pinned) {
      this.stmts.updateSessionConfidence!.run(1.0, Date.now(), id);
    }
  }

  /** Update a session's editable fields (decisions, openItems). */
  updateSessionContent(id: string, updates: { decisions?: string[]; openItems?: string[] }): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.decisions) {
      sets.push('decisions = ?');
      params.push(JSON.stringify(updates.decisions));
    }
    if (updates.openItems) {
      sets.push('open_items = ?');
      params.push(JSON.stringify(updates.openItems));
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  /** Boost a session's confidence by delta. */
  boostSession(id: string, delta: number): void {
    const row = this.db.prepare('SELECT confidence FROM sessions WHERE id = ?').get(id) as { confidence: number } | undefined;
    if (row) {
      const newConf = Math.min(1, Math.max(0, row.confidence + delta));
      this.stmts.updateSessionConfidence!.run(newConf, Date.now(), id);
    }
  }

  /** Get all preferences (for dashboard CRUD). */
  getAllPreferences(): PreferencePattern[] {
    const rows = this.db.prepare('SELECT * FROM preferences ORDER BY last_seen DESC').all() as Array<{
      id: string;
      pattern: string;
      description: string;
      occurrences: number;
      first_seen: number;
      last_seen: number;
      auto_applied: number;
      confidence: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      description: r.description,
      occurrences: r.occurrences,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      autoApplied: r.auto_applied === 1,
      confidence: r.confidence,
    }));
  }

  /** Delete a preference by ID. */
  deletePreference(id: string): void {
    this.db.prepare('DELETE FROM preferences WHERE id = ?').run(id);
  }

  /** Toggle auto-applied flag on a preference. */
  togglePreferenceAutoApply(id: string, autoApply: boolean): void {
    this.db.prepare('UPDATE preferences SET auto_applied = ? WHERE id = ?').run(autoApply ? 1 : 0, id);
  }
}
