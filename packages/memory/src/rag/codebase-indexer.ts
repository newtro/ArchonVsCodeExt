/**
 * Layer 2: Codebase RAG — incremental code indexer with BM25 + vector search.
 *
 * Search strategy:
 * - BM25 (always available): term-frequency based ranking, zero dependencies
 * - Vector search (when embeddings available): cosine similarity on persisted embeddings
 * - Hybrid mode: combines both scores when embeddings exist
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
  hash: string;
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

      const data = await res.json() as { embedding: number[] };
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

  constructor(apiKey: string, baseUrl = 'https://openrouter.ai/api/v1', model = 'openai/text-embedding-3-small') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) throw new Error(`Embedding API failed: ${res.status}`);

    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map(d => d.embedding);
  }
}

// ── BM25 Index ──

interface BM25Stats {
  avgDocLength: number;
  docCount: number;
  /** Maps term → number of documents containing that term */
  docFreq: Map<string, number>;
  /** Maps chunk ID → { termFreqs, docLength } */
  docStats: Map<string, { termFreqs: Map<string, number>; docLength: number }>;
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_$]+/).filter(t => t.length > 1);
}

function buildBM25Stats(chunks: Map<string, CodeChunk>): BM25Stats {
  const docFreq = new Map<string, number>();
  const docStats = new Map<string, { termFreqs: Map<string, number>; docLength: number }>();
  let totalLength = 0;

  for (const [id, chunk] of chunks) {
    const tokens = tokenize(chunk.content);
    const termFreqs = new Map<string, number>();
    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }
    // Count unique terms for IDF
    for (const term of termFreqs.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
    docStats.set(id, { termFreqs, docLength: tokens.length });
    totalLength += tokens.length;
  }

  return {
    avgDocLength: chunks.size > 0 ? totalLength / chunks.size : 0,
    docCount: chunks.size,
    docFreq,
    docStats,
  };
}

function bm25Search(query: string, chunks: Map<string, CodeChunk>, stats: BM25Stats, topK: number): SearchResult[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const results: SearchResult[] = [];

  for (const [id, chunk] of chunks) {
    const doc = stats.docStats.get(id);
    if (!doc) continue;

    let score = 0;
    for (const term of queryTerms) {
      const tf = doc.termFreqs.get(term) ?? 0;
      if (tf === 0) continue;

      const df = stats.docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (stats.docCount - df + 0.5) / (df + 0.5));
      const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * doc.docLength / stats.avgDocLength));
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
 * hybrid BM25 + vector search.
 */
export class CodebaseIndexer {
  private workspaceRoot: string;
  private indexDir: string;
  private chunks: Map<string, CodeChunk> = new Map();
  private embeddingProvider: EmbeddingProvider | null = null;
  private fileHashes: Map<string, string> = new Map();
  private bm25Stats: BM25Stats | null = null;
  private embeddingDimensions = 0;

  // Patterns to ignore
  private ignorePatterns = [
    'node_modules', '.git', 'dist', 'out', 'build', '.archon',
    '.next', '.nuxt', '__pycache__', '.pyc', 'target', 'vendor',
    '.turbo', 'coverage', '.nyc_output',
    '.vs', '.vscode', '.idea', 'bin', 'obj', 'TestResults',
    'docs', 'publish', 'wwwroot', 'Application Files', 'packages',
    '.augment', '.auto-claude', '.kilocode', '.serena', '.trae', '.playwright-mcp',
  ];

  // Max file size to index (skip large generated files)
  private maxFileSize = 100 * 1024; // 100KB

  private supportedExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
    '.kt', '.scala', '.vue', '.svelte', '.astro', '.md',
    '.yaml', '.yml', '.toml', '.sql', '.sh', '.bash', '.zsh',
    '.css', '.scss', '.less', '.html', '.razor',
  ]);

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.indexDir = path.join(workspaceRoot, '.archon', 'index');
  }

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Full index of the workspace with parallel file processing.
   * Phase 1: Chunk all files (fast, local I/O only).
   * Phase 2: Generate embeddings for new chunks (optional, API calls).
   */
  async indexWorkspace(
    onProgress?: (current: number, total: number, phase?: string) => void,
  ): Promise<number> {
    const files = this.collectFiles(this.workspaceRoot);
    let indexed = 0;
    const concurrency = 20;

    // Phase 1: Chunk files (no embedding calls — fast)
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(f => this.indexFile(f)));
      indexed += results.filter(Boolean).length;
      onProgress?.(Math.min(i + concurrency, files.length), files.length, 'chunking');
    }

    // Rebuild BM25 stats — search is usable now even without embeddings
    this.bm25Stats = buildBM25Stats(this.chunks);

    // Phase 2: Generate embeddings for chunks that don't have them yet
    if (this.embeddingProvider) {
      const chunksNeedingEmbeddings = Array.from(this.chunks.values()).filter(c => !c.embedding);
      if (chunksNeedingEmbeddings.length > 0) {
        const embBatchSize = 20;
        let embedded = 0;
        for (let i = 0; i < chunksNeedingEmbeddings.length; i += embBatchSize) {
          const batch = chunksNeedingEmbeddings.slice(i, i + embBatchSize);
          try {
            const embeddings = await this.embeddingProvider.embed(batch.map(c => c.content));
            for (let j = 0; j < embeddings.length; j++) {
              batch[j].embedding = embeddings[j];
            }
            embedded += batch.length;
          } catch {
            // Embedding API failed for this batch — skip, BM25 still works
            break;
          }
          onProgress?.(embedded, chunksNeedingEmbeddings.length, 'embedding');
        }
      }
    }

    await this.saveIndex();
    return indexed;
  }

  /**
   * Incrementally re-index a single file.
   */
  async reindexFile(filePath: string): Promise<boolean> {
    const changed = await this.indexFile(filePath);
    if (changed) {
      this.bm25Stats = buildBM25Stats(this.chunks);
      await this.saveIndex();
    }
    return changed;
  }

  /**
   * Search the index using hybrid BM25 + vector search.
   * When embeddings are available, combines scores (0.4 BM25 + 0.6 vector).
   * Falls back to BM25-only when no embeddings.
   */
  async search(query: string, topK = 10): Promise<SearchResult[]> {
    // Ensure BM25 stats are built
    if (!this.bm25Stats) {
      this.bm25Stats = buildBM25Stats(this.chunks);
    }

    // BM25 search (always available)
    const bm25Results = bm25Search(query, this.chunks, this.bm25Stats, topK * 3);

    // Check if we have embeddings available for vector search
    const hasEmbeddings = this.embeddingProvider && this.hasAnyEmbeddings();

    if (!hasEmbeddings) {
      return bm25Results.slice(0, topK);
    }

    // Vector search
    let vectorResults: SearchResult[] = [];
    try {
      const [queryEmbedding] = await this.embeddingProvider!.embed([query]);
      vectorResults = this.vectorSearch(queryEmbedding, topK * 3);
    } catch {
      // If embedding query fails, fall back to BM25 only
      return bm25Results.slice(0, topK);
    }

    // Hybrid merge: normalize scores and combine
    return this.mergeResults(bm25Results, vectorResults, topK);
  }

  /**
   * Generate a compressed repo map (function/class signatures).
   */
  generateRepoMap(): string {
    const fileMap = new Map<string, CodeChunk[]>();
    for (const chunk of this.chunks.values()) {
      const existing = fileMap.get(chunk.filePath) ?? [];
      existing.push(chunk);
      fileMap.set(chunk.filePath, existing);
    }

    const lines: string[] = ['# Repository Map\n'];
    for (const [filePath, chunks] of fileMap) {
      const relPath = path.relative(this.workspaceRoot, filePath);
      lines.push(`## ${relPath}`);
      for (const chunk of chunks) {
        const firstMeaningfulLine = chunk.content.split('\n')
          .find(l => /^(export |public |private |protected |function |class |interface |type |const |let |var |def |fn |func |async )/.test(l.trim()));
        if (firstMeaningfulLine) {
          lines.push(`  ${firstMeaningfulLine.trim()}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  getChunkCount(): number {
    return this.chunks.size;
  }

  private hasAnyEmbeddings(): boolean {
    for (const chunk of this.chunks.values()) {
      if (chunk.embedding) return true;
    }
    return false;
  }

  private vectorSearch(queryEmbedding: number[], topK: number): SearchResult[] {
    const results: SearchResult[] = [];
    for (const chunk of this.chunks.values()) {
      if (!chunk.embedding) continue;
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      results.push({ chunk, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private mergeResults(bm25Results: SearchResult[], vectorResults: SearchResult[], topK: number): SearchResult[] {
    // Normalize each result set to 0-1 range
    const normBM25 = this.normalizeScores(bm25Results);
    const normVector = this.normalizeScores(vectorResults);

    // Merge into a single map by chunk ID
    const merged = new Map<string, { chunk: CodeChunk; score: number }>();

    for (const r of normBM25) {
      merged.set(r.chunk.id, { chunk: r.chunk, score: r.score * 0.4 });
    }
    for (const r of normVector) {
      const existing = merged.get(r.chunk.id);
      if (existing) {
        existing.score += r.score * 0.6;
      } else {
        merged.set(r.chunk.id, { chunk: r.chunk, score: r.score * 0.6 });
      }
    }

    const results = Array.from(merged.values());
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private normalizeScores(results: SearchResult[]): SearchResult[] {
    if (results.length === 0) return [];
    const maxScore = results[0].score; // Already sorted descending
    if (maxScore === 0) return results;
    return results.map(r => ({ ...r, score: r.score / maxScore }));
  }

  private async indexFile(filePath: string): Promise<boolean> {
    const ext = path.extname(filePath);
    if (!this.supportedExtensions.has(ext)) return false;

    // Skip files that are too large (likely generated)
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

    // Check if file has changed
    const hash = crypto.createHash('md5').update(content).digest('hex');
    if (this.fileHashes.get(filePath) === hash) return false;
    this.fileHashes.set(filePath, hash);

    // Remove old chunks for this file
    for (const [id, chunk] of this.chunks) {
      if (chunk.filePath === filePath) this.chunks.delete(id);
    }

    // Chunk the file (embedding generation happens separately in indexWorkspace phase 2)
    const language = this.getLanguage(ext);
    const newChunks = this.chunkFile(filePath, content, language);

    // Store chunks
    for (const chunk of newChunks) {
      this.chunks.set(chunk.id, chunk);
    }

    return true;
  }

  private chunkFile(filePath: string, content: string, language: string): CodeChunk[] {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    const chunkSize = 50; // lines per chunk
    const overlap = 5;

    for (let i = 0; i < lines.length; i += chunkSize - overlap) {
      const endLine = Math.min(i + chunkSize, lines.length);
      const chunkContent = lines.slice(i, endLine).join('\n');

      if (chunkContent.trim().length < 10) continue; // Skip near-empty chunks

      const id = `${filePath}:${i + 1}-${endLine}`;
      const hash = crypto.createHash('md5').update(chunkContent).digest('hex');

      chunks.push({
        id,
        filePath,
        startLine: i + 1,
        endLine,
        content: chunkContent,
        language,
        hash,
      });
    }

    return chunks;
  }

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

      if (this.ignorePatterns.some(p => entry.name === p)) continue;
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

  // ── Persistence ──

  private async saveIndex(): Promise<void> {
    fs.mkdirSync(this.indexDir, { recursive: true });

    // Save file hashes
    const hashesPath = path.join(this.indexDir, 'file-hashes.json');
    const hashes = Object.fromEntries(this.fileHashes);
    await fs.promises.writeFile(hashesPath, JSON.stringify(hashes));

    // Save chunks metadata (without embeddings — those go in binary file)
    const chunksPath = path.join(this.indexDir, 'chunks.json');
    const chunksData = Array.from(this.chunks.values()).map(c => ({
      id: c.id,
      filePath: c.filePath,
      startLine: c.startLine,
      endLine: c.endLine,
      content: c.content,
      language: c.language,
      hash: c.hash,
      hasEmbedding: !!c.embedding,
    }));
    await fs.promises.writeFile(chunksPath, JSON.stringify(chunksData));

    // Save embeddings as binary Float32Array for efficiency
    this.saveEmbeddings();
  }

  private saveEmbeddings(): void {
    // Collect all chunks that have embeddings
    const embeddedChunks: Array<{ id: string; embedding: number[] }> = [];
    let dimensions = 0;

    for (const chunk of this.chunks.values()) {
      if (chunk.embedding) {
        embeddedChunks.push({ id: chunk.id, embedding: chunk.embedding });
        dimensions = chunk.embedding.length;
      }
    }

    if (embeddedChunks.length === 0) return;

    // Save embedding manifest (maps chunk IDs to their index in the binary file)
    const manifestPath = path.join(this.indexDir, 'embeddings-manifest.json');
    const manifest = {
      dimensions,
      count: embeddedChunks.length,
      chunkIds: embeddedChunks.map(c => c.id),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    // Save embedding vectors as packed Float32Array binary
    const embeddingsPath = path.join(this.indexDir, 'embeddings.bin');
    const buffer = Buffer.alloc(embeddedChunks.length * dimensions * 4);
    for (let i = 0; i < embeddedChunks.length; i++) {
      const emb = embeddedChunks[i].embedding;
      for (let j = 0; j < dimensions; j++) {
        buffer.writeFloatLE(emb[j], (i * dimensions + j) * 4);
      }
    }
    fs.writeFileSync(embeddingsPath, buffer);

    this.embeddingDimensions = dimensions;
  }

  /**
   * Load a previously saved index including persisted embeddings.
   */
  async loadIndex(): Promise<boolean> {
    const hashesPath = path.join(this.indexDir, 'file-hashes.json');
    const chunksPath = path.join(this.indexDir, 'chunks.json');

    if (!fs.existsSync(hashesPath) || !fs.existsSync(chunksPath)) return false;

    try {
      const hashes = JSON.parse(await fs.promises.readFile(hashesPath, 'utf-8')) as Record<string, string>;
      this.fileHashes = new Map(Object.entries(hashes));

      const chunksData = JSON.parse(await fs.promises.readFile(chunksPath, 'utf-8')) as Array<CodeChunk & { hasEmbedding?: boolean }>;
      this.chunks = new Map(chunksData.map(c => [c.id, {
        id: c.id,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        content: c.content,
        language: c.language,
        hash: c.hash,
      }]));

      // Load persisted embeddings
      this.loadEmbeddings();

      // Build BM25 stats from loaded chunks
      this.bm25Stats = buildBM25Stats(this.chunks);

      return true;
    } catch {
      return false;
    }
  }

  private loadEmbeddings(): void {
    const manifestPath = path.join(this.indexDir, 'embeddings-manifest.json');
    const embeddingsPath = path.join(this.indexDir, 'embeddings.bin');

    if (!fs.existsSync(manifestPath) || !fs.existsSync(embeddingsPath)) return;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        dimensions: number;
        count: number;
        chunkIds: string[];
      };

      const buffer = fs.readFileSync(embeddingsPath);
      const expectedSize = manifest.count * manifest.dimensions * 4;
      if (buffer.length !== expectedSize) return;

      this.embeddingDimensions = manifest.dimensions;

      for (let i = 0; i < manifest.count; i++) {
        const chunkId = manifest.chunkIds[i];
        const chunk = this.chunks.get(chunkId);
        if (!chunk) continue;

        const embedding = new Array<number>(manifest.dimensions);
        for (let j = 0; j < manifest.dimensions; j++) {
          embedding[j] = buffer.readFloatLE((i * manifest.dimensions + j) * 4);
        }
        chunk.embedding = embedding;
      }
    } catch {
      // Embeddings failed to load, search will use BM25 only
    }
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
