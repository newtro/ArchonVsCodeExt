/**
 * Layer 3: Codebase RAG — incremental code indexer with BM25 + vector search.
 *
 * Search strategy:
 * - BM25 (always available): term-frequency based ranking, zero dependencies
 * - Vector search (when embeddings available): cosine similarity on SQLite-stored embeddings
 * - Hybrid mode: combines both scores via Reciprocal Rank Fusion when embeddings exist
 *
 * Storage: Unified SQLite via MemoryDatabase (chunks + file_hashes tables).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { MemoryDatabase } from '../db/memory-database';
import { ASTChunker } from './ast-chunker';

export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
  hash: string;
  symbolId?: number;
  embedding?: number[];
}

export interface SearchResult {
  chunk: CodeChunk;
  score: number;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

/**
 * Ollama-based embedding provider using nomic-embed-code.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 768;
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = 'http://localhost:11434', model = 'nomic-embed-text') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });

      if (!res.ok) throw new Error(`Ollama embedding failed: ${res.status}`);

      const data = (await res.json()) as { embedding: number[] };
      results.push(data.embedding);
    }
    return results;
  }
}

/**
 * API-based embedding provider (OpenAI-compatible via OpenRouter).
 */
export class ApiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    apiKey: string,
    baseUrl = 'https://openrouter.ai/api/v1',
    model = 'openai/text-embedding-3-small',
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) throw new Error(`Embedding API failed: ${res.status}`);

    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => d.embedding);
  }
}

// ── BM25 Index ──

interface BM25Stats {
  avgDocLength: number;
  docCount: number;
  docFreq: Map<string, number>;
  docStats: Map<string, { termFreqs: Map<string, number>; docLength: number }>;
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const RRF_K = 60; // Reciprocal Rank Fusion constant

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length > 1);
}

function buildBM25Stats(chunks: CodeChunk[]): BM25Stats {
  const docFreq = new Map<string, number>();
  const docStats = new Map<string, { termFreqs: Map<string, number>; docLength: number }>();
  let totalLength = 0;

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.content);
    const termFreqs = new Map<string, number>();
    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }
    for (const term of termFreqs.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
    docStats.set(chunk.id, { termFreqs, docLength: tokens.length });
    totalLength += tokens.length;
  }

  return {
    avgDocLength: chunks.length > 0 ? totalLength / chunks.length : 0,
    docCount: chunks.length,
    docFreq,
    docStats,
  };
}

function bm25Search(
  query: string,
  chunks: CodeChunk[],
  stats: BM25Stats,
  topK: number,
): SearchResult[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const results: SearchResult[] = [];

  for (const chunk of chunks) {
    const doc = stats.docStats.get(chunk.id);
    if (!doc) continue;

    let score = 0;
    for (const term of queryTerms) {
      const tf = doc.termFreqs.get(term) ?? 0;
      if (tf === 0) continue;

      const df = stats.docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (stats.docCount - df + 0.5) / (df + 0.5));
      const tfNorm =
        (tf * (BM25_K1 + 1)) /
        (tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.docLength / stats.avgDocLength)));
      score += idf * tfNorm;
    }

    if (score > 0) {
      results.push({ chunk, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// ── Codebase Indexer ──

/**
 * Codebase indexer — chunks code files, manages embeddings, and provides
 * hybrid BM25 + vector search. Backed by SQLite via MemoryDatabase.
 */
export class CodebaseIndexer {
  private workspaceRoot: string;
  private memDb: MemoryDatabase;
  private db: Database.Database;
  private embeddingProvider: EmbeddingProvider | null = null;
  private astChunker: ASTChunker = new ASTChunker();

  // In-memory BM25 index (rebuilt from SQLite on load)
  private bm25Chunks: CodeChunk[] = [];
  private bm25Stats: BM25Stats | null = null;

  // Prepared statements (lazy-initialized)
  private stmts: {
    upsertFileHash?: Database.Statement;
    getFileHash?: Database.Statement;
    deleteChunksForFile?: Database.Statement;
    insertChunk?: Database.Statement;
    getAllChunks?: Database.Statement;
    getChunksWithEmbeddings?: Database.Statement;
    updateChunkEmbedding?: Database.Statement;
    getChunkCount?: Database.Statement;
  } = {};

  // Patterns to ignore
  private ignorePatterns = [
    'node_modules', '.git', 'dist', 'out', 'build', '.archon',
    '.next', '.nuxt', '__pycache__', '.pyc', 'target', 'vendor',
    '.turbo', 'coverage', '.nyc_output',
    '.vs', '.vscode', '.idea', 'bin', 'obj', 'TestResults',
    'docs', 'publish', 'wwwroot', 'Application Files', 'packages',
    '.augment', '.auto-claude', '.kilocode', '.serena', '.trae', '.playwright-mcp',
  ];

  private maxFileSize = 100 * 1024; // 100KB

  private supportedExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
    '.kt', '.scala', '.vue', '.svelte', '.astro', '.md',
    '.yaml', '.yml', '.toml', '.sql', '.sh', '.bash', '.zsh',
    '.css', '.scss', '.less', '.html', '.razor',
  ]);

  constructor(workspaceRoot: string, memDb: MemoryDatabase) {
    this.workspaceRoot = workspaceRoot;
    this.memDb = memDb;
    this.db = memDb.getDb();
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmts.upsertFileHash = this.db.prepare(
      'INSERT OR REPLACE INTO file_hashes (file_path, hash, last_indexed) VALUES (?, ?, ?)',
    );
    this.stmts.getFileHash = this.db.prepare(
      'SELECT hash FROM file_hashes WHERE file_path = ?',
    );
    this.stmts.deleteChunksForFile = this.db.prepare(
      'DELETE FROM chunks WHERE file_path = ?',
    );
    this.stmts.insertChunk = this.db.prepare(
      `INSERT OR REPLACE INTO chunks (id, file_path, start_line, end_line, content, language, content_hash, symbol_id, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.stmts.getAllChunks = this.db.prepare(
      'SELECT id, file_path, start_line, end_line, content, language, content_hash FROM chunks',
    );
    this.stmts.getChunksWithEmbeddings = this.db.prepare(
      'SELECT id, file_path, start_line, end_line, content, language, content_hash, embedding FROM chunks WHERE embedding IS NOT NULL',
    );
    this.stmts.updateChunkEmbedding = this.db.prepare(
      'UPDATE chunks SET embedding = ? WHERE id = ?',
    );
    this.stmts.getChunkCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM chunks',
    );
  }

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Full index of the workspace.
   * Phase 1: Chunk all files (fast, local I/O only) → SQLite.
   * Phase 2: Generate embeddings for new chunks (optional, API calls).
   */
  async indexWorkspace(
    onProgress?: (current: number, total: number, phase?: string) => void,
  ): Promise<number> {
    const files = this.collectFiles(this.workspaceRoot);
    let indexed = 0;
    const concurrency = 20;

    // Phase 1: Chunk files into SQLite
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      const results = await Promise.all(batch.map((f) => this.indexFile(f)));
      indexed += results.filter(Boolean).length;
      onProgress?.(Math.min(i + concurrency, files.length), files.length, 'chunking');
    }

    // Rebuild BM25 in-memory index from SQLite
    this.rebuildBM25Index();

    // Phase 2: Generate embeddings for chunks without them
    if (this.embeddingProvider) {
      const chunksNeedingEmbeddings = this.db
        .prepare('SELECT id, content FROM chunks WHERE embedding IS NULL')
        .all() as Array<{ id: string; content: string }>;

      if (chunksNeedingEmbeddings.length > 0) {
        const embBatchSize = 20;
        let embedded = 0;
        for (let i = 0; i < chunksNeedingEmbeddings.length; i += embBatchSize) {
          const batch = chunksNeedingEmbeddings.slice(i, i + embBatchSize);
          try {
            const embeddings = await this.embeddingProvider.embed(
              batch.map((c) => c.content),
            );
            this.memDb.transaction(() => {
              for (let j = 0; j < embeddings.length; j++) {
                const buf = Buffer.from(new Float32Array(embeddings[j]).buffer);
                this.stmts.updateChunkEmbedding!.run(buf, batch[j].id);
              }
            });
            embedded += batch.length;
          } catch {
            break; // Embedding API failed — BM25 still works
          }
          onProgress?.(embedded, chunksNeedingEmbeddings.length, 'embedding');
        }
      }
    }

    this.memDb.recordMetric('indexing', { filesIndexed: indexed, totalFiles: files.length });
    return indexed;
  }

  /**
   * Incrementally re-index a single file.
   */
  async reindexFile(filePath: string): Promise<boolean> {
    const changed = await this.indexFile(filePath);
    if (changed) {
      this.rebuildBM25Index();
    }
    return changed;
  }

  /**
   * Search the index using hybrid BM25 + vector search.
   * Uses Reciprocal Rank Fusion (RRF) to combine results when embeddings are available.
   * Falls back to BM25-only when no embeddings exist.
   */
  async search(query: string, topK = 10): Promise<SearchResult[]> {
    if (!this.bm25Stats) {
      this.rebuildBM25Index();
    }

    // BM25 search (always available)
    const bm25Results = bm25Search(query, this.bm25Chunks, this.bm25Stats!, topK * 3);

    // Check if we have embeddings for vector search
    const hasEmbeddings =
      this.embeddingProvider &&
      (
        this.db.prepare('SELECT 1 FROM chunks WHERE embedding IS NOT NULL LIMIT 1').get() as
          | unknown
          | undefined
      ) !== undefined;

    if (!hasEmbeddings) {
      return bm25Results.slice(0, topK);
    }

    // Vector search
    let vectorResults: SearchResult[] = [];
    try {
      const [queryEmbedding] = await this.embeddingProvider!.embed([query]);
      vectorResults = this.vectorSearch(queryEmbedding, topK * 3);
    } catch {
      return bm25Results.slice(0, topK);
    }

    // Reciprocal Rank Fusion
    return this.rrfMerge(bm25Results, vectorResults, topK);
  }

  /**
   * Load existing index from SQLite into the BM25 in-memory index.
   * Call this on startup to make search available immediately.
   */
  loadIndex(): boolean {
    const count = (this.stmts.getChunkCount!.get() as { count: number }).count;
    if (count === 0) return false;

    this.rebuildBM25Index();
    return true;
  }

  /**
   * Generate a compressed repo map (function/class signatures).
   */
  generateRepoMap(): string {
    const rows = this.db
      .prepare(
        'SELECT file_path, content FROM chunks ORDER BY file_path, start_line',
      )
      .all() as Array<{ file_path: string; content: string }>;

    const fileMap = new Map<string, string[]>();
    for (const row of rows) {
      const existing = fileMap.get(row.file_path) ?? [];
      const firstMeaningfulLine = row.content
        .split('\n')
        .find((l: string) =>
          /^(export |public |private |protected |function |class |interface |type |const |let |var |def |fn |func |async )/.test(
            l.trim(),
          ),
        );
      if (firstMeaningfulLine) {
        existing.push(firstMeaningfulLine.trim());
      }
      fileMap.set(row.file_path, existing);
    }

    const lines: string[] = ['# Repository Map\n'];
    for (const [filePath, signatures] of fileMap) {
      const relPath = path.relative(this.workspaceRoot, filePath);
      lines.push(`## ${relPath}`);
      for (const sig of signatures) {
        lines.push(`  ${sig}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  getChunkCount(): number {
    return (this.stmts.getChunkCount!.get() as { count: number }).count;
  }

  // ── Private: Indexing ──

  private async indexFile(filePath: string): Promise<boolean> {
    const ext = path.extname(filePath);
    if (!this.supportedExtensions.has(ext)) return false;

    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > this.maxFileSize) return false;
    } catch {
      return false;
    }

    let content: string;
    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      return false;
    }

    const hash = crypto.createHash('md5').update(content).digest('hex');
    const existingHash = this.stmts.getFileHash!.get(filePath) as
      | { hash: string }
      | undefined;
    if (existingHash?.hash === hash) return false;

    // File changed — re-chunk using AST-aware chunking
    const language = this.getLanguage(ext);
    const newChunks = await this.astChunker.chunkFile(filePath, content, language);

    this.memDb.transaction(() => {
      this.stmts.deleteChunksForFile!.run(filePath);
      for (const chunk of newChunks) {
        this.stmts.insertChunk!.run(
          chunk.id,
          chunk.filePath,
          chunk.startLine,
          chunk.endLine,
          chunk.content,
          chunk.language,
          chunk.hash,
          chunk.symbolId ?? null,
          null, // embedding generated in phase 2
        );
      }
      this.stmts.upsertFileHash!.run(filePath, hash, Date.now());
    });

    return true;
  }

  // ── Private: Search ──

  private rebuildBM25Index(): void {
    const rows = this.stmts.getAllChunks!.all() as Array<{
      id: string;
      file_path: string;
      start_line: number;
      end_line: number;
      content: string;
      language: string;
      content_hash: string;
    }>;

    this.bm25Chunks = rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      startLine: r.start_line,
      endLine: r.end_line,
      content: r.content,
      language: r.language,
      hash: r.content_hash,
    }));

    this.bm25Stats = buildBM25Stats(this.bm25Chunks);
  }

  private vectorSearch(queryEmbedding: number[], topK: number): SearchResult[] {
    const rows = this.stmts.getChunksWithEmbeddings!.all() as Array<{
      id: string;
      file_path: string;
      start_line: number;
      end_line: number;
      content: string;
      language: string;
      content_hash: string;
      embedding: Buffer;
    }>;

    const results: SearchResult[] = [];
    for (const row of rows) {
      const embedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      );
      const score = cosineSimilarity(queryEmbedding, Array.from(embedding));
      results.push({
        chunk: {
          id: row.id,
          filePath: row.file_path,
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
          language: row.language,
          hash: row.content_hash,
        },
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Reciprocal Rank Fusion — more robust than linear score combination.
   * RRF_score(d) = sum( 1 / (k + rank_i(d)) ) for each ranking i
   */
  private rrfMerge(
    bm25Results: SearchResult[],
    vectorResults: SearchResult[],
    topK: number,
  ): SearchResult[] {
    const scores = new Map<string, { chunk: CodeChunk; score: number }>();

    for (let rank = 0; rank < bm25Results.length; rank++) {
      const r = bm25Results[rank];
      const existing = scores.get(r.chunk.id);
      const rrfScore = 1 / (RRF_K + rank + 1);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(r.chunk.id, { chunk: r.chunk, score: rrfScore });
      }
    }

    for (let rank = 0; rank < vectorResults.length; rank++) {
      const r = vectorResults[rank];
      const existing = scores.get(r.chunk.id);
      const rrfScore = 1 / (RRF_K + rank + 1);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(r.chunk.id, { chunk: r.chunk, score: rrfScore });
      }
    }

    const results = Array.from(scores.values());
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  // ── Private: File Walking ──

  private collectFiles(dir: string): string[] {
    const files: string[] = [];
    this.walkDir(dir, files);
    return files;
  }

  private walkDir(dir: string, files: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (this.ignorePatterns.some((p) => entry.name === p)) continue;
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        this.walkDir(fullPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (this.supportedExtensions.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  private getLanguage(ext: string): string {
    const map: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
      '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
      '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
      '.cs': 'csharp', '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
      '.kt': 'kotlin', '.scala': 'scala', '.vue': 'vue', '.svelte': 'svelte',
      '.md': 'markdown', '.yaml': 'yaml', '.yml': 'yaml', '.razor': 'razor',
      '.toml': 'toml', '.sql': 'sql', '.sh': 'shell', '.css': 'css',
      '.scss': 'scss', '.html': 'html',
    };
    return map[ext] ?? 'text';
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
