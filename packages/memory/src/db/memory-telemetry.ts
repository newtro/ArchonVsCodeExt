/**
 * Memory Telemetry — query and aggregate metrics from the memory_metrics table.
 *
 * All data stays local. Provides computed statistics for the context meter
 * modal and memory health dashboard.
 */

import type Database from 'better-sqlite3';
import type { MemoryDatabase } from './memory-database';

export interface MetricSummary {
  /** Average context health score over recent requests. */
  avgHealthScore: number;
  /** Total compression events. */
  compressionEvents: number;
  /** Total tokens saved by compression. */
  tokensSaved: number;
  /** Total forgetting events (decay + purge). */
  forgettingEvents: number;
  /** Total pattern extractions. */
  patternsExtracted: number;
  /** Total edit observations. */
  editObservations: number;
  /** Average retrieval results per query. */
  avgRetrievalResults: number;
  /** Total auto-summarization events. */
  autoSummarizations: number;
}

export interface MetricTimeSeries {
  timestamp: number;
  value: number;
}

export class MemoryTelemetry {
  private db: Database.Database;
  private stmts: {
    getByType?: Database.Statement;
    getByTypeRange?: Database.Statement;
    getCount?: Database.Statement;
    getCountRange?: Database.Statement;
    purgeOld?: Database.Statement;
  } = {};

  constructor(memDb: MemoryDatabase) {
    this.db = memDb.getDb();
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmts.getByType = this.db.prepare(
      'SELECT timestamp, details FROM memory_metrics WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?',
    );
    this.stmts.getByTypeRange = this.db.prepare(
      'SELECT timestamp, details FROM memory_metrics WHERE event_type = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp DESC',
    );
    this.stmts.getCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM memory_metrics WHERE event_type = ?',
    );
    this.stmts.getCountRange = this.db.prepare(
      'SELECT COUNT(*) as count FROM memory_metrics WHERE event_type = ? AND timestamp BETWEEN ? AND ?',
    );
    this.stmts.purgeOld = this.db.prepare(
      'DELETE FROM memory_metrics WHERE timestamp < ?',
    );
  }

  /**
   * Get a summary of all memory metrics.
   * Defaults to last 7 days.
   */
  getSummary(days = 7): MetricSummary {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Context health scores
    const healthRows = this.stmts.getByTypeRange!.all(
      'context_assembly', since, now,
    ) as Array<{ details: string | null }>;
    const healthScores = healthRows
      .map((r) => {
        try { return JSON.parse(r.details ?? '{}').healthScore as number; }
        catch { return null; }
      })
      .filter((s): s is number => s != null);

    // Compression stats
    const compressionRows = this.stmts.getByTypeRange!.all(
      'compression', since, now,
    ) as Array<{ details: string | null }>;
    let tokensSaved = 0;
    for (const r of compressionRows) {
      try { tokensSaved += JSON.parse(r.details ?? '{}').tokensSaved ?? 0; }
      catch { /* skip */ }
    }

    // LLM compression stats
    const llmCompressionRows = this.stmts.getByTypeRange!.all(
      'llm_compression', since, now,
    ) as Array<{ details: string | null }>;

    return {
      avgHealthScore: healthScores.length > 0
        ? healthScores.reduce((a, b) => a + b, 0) / healthScores.length
        : 0,
      compressionEvents: compressionRows.length + llmCompressionRows.length,
      tokensSaved,
      forgettingEvents: this.countInRange('forgetting', since, now)
        + this.countInRange('forgetting_cycle', since, now),
      patternsExtracted: this.countInRange('pattern_extraction', since, now),
      editObservations: this.countInRange('edit_observation', since, now),
      avgRetrievalResults: this.computeAvgRetrievalResults(since, now),
      autoSummarizations: this.countInRange('auto_summarize', since, now),
    };
  }

  /**
   * Get a time series of context health scores.
   */
  getHealthTimeline(days = 7, maxPoints = 50): MetricTimeSeries[] {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this.stmts.getByTypeRange!.all(
      'context_assembly', since, Date.now(),
    ) as Array<{ timestamp: number; details: string | null }>;

    const points: MetricTimeSeries[] = [];
    for (const r of rows) {
      try {
        const score = JSON.parse(r.details ?? '{}').healthScore;
        if (typeof score === 'number') {
          points.push({ timestamp: r.timestamp, value: score });
        }
      } catch { /* skip */ }
    }

    // Downsample if too many points
    if (points.length > maxPoints) {
      const step = Math.ceil(points.length / maxPoints);
      return points.filter((_, i) => i % step === 0);
    }

    return points;
  }

  /**
   * Get recent events of a specific type.
   */
  getRecentEvents(eventType: string, limit = 20): Array<{
    timestamp: number;
    details: Record<string, unknown>;
  }> {
    const rows = this.stmts.getByType!.all(eventType, limit) as Array<{
      timestamp: number;
      details: string | null;
    }>;

    return rows.map((r) => ({
      timestamp: r.timestamp,
      details: r.details ? JSON.parse(r.details) : {},
    }));
  }

  /**
   * Get total event count for a type.
   */
  getEventCount(eventType: string): number {
    return (this.stmts.getCount!.get(eventType) as { count: number }).count;
  }

  /**
   * Purge metrics older than the given number of days.
   * Default: keep 30 days.
   */
  purgeOldMetrics(keepDays = 30): number {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const result = this.stmts.purgeOld!.run(cutoff);
    return result.changes;
  }

  // ── Private ──

  private countInRange(eventType: string, since: number, until: number): number {
    return (this.stmts.getCountRange!.get(eventType, since, until) as { count: number }).count;
  }

  private computeAvgRetrievalResults(since: number, until: number): number {
    const rows = this.stmts.getByTypeRange!.all(
      'context_assembly', since, until,
    ) as Array<{ details: string | null }>;

    const counts = rows
      .map((r) => {
        try { return JSON.parse(r.details ?? '{}').totalItems as number; }
        catch { return null; }
      })
      .filter((c): c is number => c != null);

    return counts.length > 0
      ? counts.reduce((a, b) => a + b, 0) / counts.length
      : 0;
  }
}
