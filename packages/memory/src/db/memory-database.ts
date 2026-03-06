/**
 * MemoryDatabase — Unified SQLite storage for all memory layers.
 *
 * Single `.archon/memory.db` file per project containing:
 * - Layer 1: Rules metadata
 * - Layer 2: Code knowledge graph (symbols + edges)
 * - Layer 3: RAG chunks with embeddings
 * - Layer 4: Session memory summaries
 * - Layer 5: Interaction archive
 * - Autonomous learning preferences
 * - Telemetry metrics
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

/** Schema version — bump when schema changes require migration */
const SCHEMA_VERSION = 1;

export class MemoryDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(workspaceRoot: string) {
    const archonDir = path.join(workspaceRoot, '.archon');
    fs.mkdirSync(archonDir, { recursive: true });

    this.dbPath = path.join(archonDir, 'memory.db');
    this.db = new Database(this.dbPath);

    // Performance pragmas
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
  }

  /** Get the underlying better-sqlite3 Database instance for direct queries. */
  getDb(): Database.Database {
    return this.db;
  }

  /** Close the database connection. */
  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  /** Check if the database is open. */
  isOpen(): boolean {
    return this.db.open;
  }

  private initSchema(): void {
    const version = this.getSchemaVersion();

    if (version === 0) {
      this.createSchema();
      this.setSchemaVersion(SCHEMA_VERSION);
    } else if (version < SCHEMA_VERSION) {
      this.migrateSchema(version);
      this.setSchemaVersion(SCHEMA_VERSION);
    }
  }

  private getSchemaVersion(): number {
    try {
      const row = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
        | { version: number }
        | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  private setSchemaVersion(version: number): void {
    this.db.prepare('INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, ?)').run(
      version,
    );
  }

  private createSchema(): void {
    this.db.exec(`
      -- Schema versioning
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );

      -- Layer 2: Code Knowledge Graph
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        signature TEXT,
        file_hash TEXT,
        UNIQUE(file_path, name, kind, start_line)
      );

      CREATE TABLE IF NOT EXISTS edges (
        source_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
        target_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id, kind)
      );

      -- Layer 3: RAG Chunks
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        content TEXT NOT NULL,
        language TEXT,
        content_hash TEXT,
        symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
        embedding BLOB
      );

      -- File tracking for incremental indexing
      CREATE TABLE IF NOT EXISTS file_hashes (
        file_path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        last_indexed INTEGER NOT NULL
      );

      -- Layer 4: Session Memory
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        decisions TEXT,
        files_modified TEXT,
        patterns_discovered TEXT,
        open_items TEXT,
        confidence REAL DEFAULT 1.0,
        last_referenced INTEGER,
        summary_embedding BLOB
      );

      -- Layer 5: Interaction Archive
      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        relevance REAL DEFAULT 1.0,
        embedding BLOB
      );

      -- Autonomous Learning
      CREATE TABLE IF NOT EXISTS preferences (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL,
        description TEXT,
        occurrences INTEGER DEFAULT 1,
        first_seen INTEGER,
        last_seen INTEGER,
        auto_applied INTEGER DEFAULT 0,
        confidence REAL DEFAULT 0.5
      );

      -- Telemetry
      CREATE TABLE IF NOT EXISTS memory_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        details TEXT
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);
      CREATE INDEX IF NOT EXISTS idx_interactions_session ON interactions(session_id);
      CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp);
      CREATE INDEX IF NOT EXISTS idx_interactions_type ON interactions(type);
      CREATE INDEX IF NOT EXISTS idx_sessions_confidence ON sessions(confidence);
      CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp);
      CREATE INDEX IF NOT EXISTS idx_metrics_type ON memory_metrics(event_type);
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON memory_metrics(timestamp);
    `);
  }

  private migrateSchema(_fromVersion: number): void {
    // Future migrations go here
    // if (fromVersion < 2) { ... migrate to v2 ... }
  }

  // ── Convenience Methods ──

  /** Run a transaction. Rolls back on error. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Record a telemetry event. */
  recordMetric(eventType: string, details?: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO memory_metrics (timestamp, event_type, details) VALUES (?, ?, ?)')
      .run(Date.now(), eventType, details ? JSON.stringify(details) : null);
  }
}
