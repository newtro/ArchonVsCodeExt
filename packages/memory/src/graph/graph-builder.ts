/**
 * Code Knowledge Graph Builder — extracts symbols and relationships from AST.
 *
 * Parses code with tree-sitter and builds a graph of:
 * - Symbols: functions, classes, methods, interfaces, types, variables
 * - Edges: calls, imports, extends, implements, uses_type
 *
 * Stored in SQLite (symbols + edges tables) for SQL-based graph traversal.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { MemoryDatabase } from '../db/memory-database';

export interface SymbolInfo {
  id?: number;
  filePath: string;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string;
  fileHash: string;
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'variable'
  | 'enum'
  | 'import'
  | 'export';

export interface EdgeInfo {
  sourceId: number;
  targetId: number;
  kind: EdgeKind;
}

export type EdgeKind = 'calls' | 'imports' | 'extends' | 'implements' | 'uses_type' | 'tests';

export interface GraphQueryResult {
  symbol: SymbolInfo;
  depth: number;
}

// Tree-sitter types (minimal interface for what we need)
interface TSParser {
  parse(input: string): TSTree;
  setLanguage(lang: TSLanguage): void;
  delete(): void;
}
interface TSTree { rootNode: TSNode; delete(): void; }
interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TSNode[];
  childCount: number;
  namedChildren: TSNode[];
  parent: TSNode | null;
  childForFieldName(name: string): TSNode | null;
}
interface TSLanguage {}
interface TSInit {
  init(options?: { locateFile?: (s: string) => string }): Promise<void>;
  Language: { load(path: string): Promise<TSLanguage> };
  new(): TSParser;
  prototype: { setLanguage(lang: TSLanguage): void };
}

const LANG_WASM_MAP: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  rust: 'tree-sitter-rust.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
};

export class GraphBuilder {
  private memDb: MemoryDatabase;
  private db: Database.Database;
  private TreeSitter: TSInit | null = null;
  private loadedLanguages: Map<string, TSLanguage> = new Map();
  private wasmDir: string;
  private initialized = false;

  private stmts: {
    insertSymbol?: Database.Statement;
    deleteSymbolsForFile?: Database.Statement;
    deleteEdgesForSymbols?: Database.Statement;
    insertEdge?: Database.Statement;
    getSymbolsByFile?: Database.Statement;
    getSymbolByName?: Database.Statement;
    getCallers?: Database.Statement;
    getCallees?: Database.Statement;
    getImportsOf?: Database.Statement;
    getSymbolById?: Database.Statement;
    getAllSymbolIds?: Database.Statement;
  } = {};

  constructor(memDb: MemoryDatabase) {
    this.memDb = memDb;
    this.db = memDb.getDb();
    this.wasmDir = path.join(
      path.dirname(require.resolve('tree-sitter-wasms/package.json')),
      'out',
    );
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmts.insertSymbol = this.db.prepare(
      `INSERT OR REPLACE INTO symbols (file_path, name, kind, start_line, end_line, signature, file_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.stmts.deleteSymbolsForFile = this.db.prepare(
      'DELETE FROM symbols WHERE file_path = ?',
    );
    this.stmts.deleteEdgesForSymbols = this.db.prepare(
      `DELETE FROM edges WHERE source_id IN (SELECT id FROM symbols WHERE file_path = ?)
       OR target_id IN (SELECT id FROM symbols WHERE file_path = ?)`,
    );
    this.stmts.insertEdge = this.db.prepare(
      'INSERT OR IGNORE INTO edges (source_id, target_id, kind) VALUES (?, ?, ?)',
    );
    this.stmts.getSymbolsByFile = this.db.prepare(
      'SELECT * FROM symbols WHERE file_path = ? ORDER BY start_line',
    );
    this.stmts.getSymbolByName = this.db.prepare(
      'SELECT * FROM symbols WHERE name = ? LIMIT 10',
    );
    this.stmts.getCallers = this.db.prepare(
      `SELECT s.* FROM edges e JOIN symbols s ON e.source_id = s.id
       WHERE e.target_id = ? AND e.kind = 'calls'`,
    );
    this.stmts.getCallees = this.db.prepare(
      `SELECT s.* FROM edges e JOIN symbols s ON e.target_id = s.id
       WHERE e.source_id = ? AND e.kind = 'calls'`,
    );
    this.stmts.getImportsOf = this.db.prepare(
      `SELECT s.* FROM edges e JOIN symbols s ON e.target_id = s.id
       WHERE e.source_id = ? AND e.kind = 'imports'`,
    );
    this.stmts.getSymbolById = this.db.prepare(
      'SELECT * FROM symbols WHERE id = ?',
    );
    this.stmts.getAllSymbolIds = this.db.prepare(
      'SELECT id FROM symbols WHERE file_path = ?',
    );
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const TSModule = require('web-tree-sitter') as TSInit;
    await TSModule.init({
      locateFile: (scriptName: string) =>
        path.join(path.dirname(require.resolve('web-tree-sitter/package.json')), scriptName),
    });
    this.TreeSitter = TSModule;
    this.initialized = true;
  }

  /**
   * Index a file: extract symbols and edges, store in SQLite.
   */
  async indexFile(filePath: string, content: string, language: string, fileHash: string): Promise<number> {
    if (!LANG_WASM_MAP[language]) return 0;

    await this.init();
    const lang = await this.getLanguage(language);
    if (!lang) return 0;

    const parser = new this.TreeSitter!();
    parser.setLanguage(lang);
    const tree = parser.parse(content);

    // Extract symbols
    const symbols: SymbolInfo[] = [];
    const importEdges: Array<{ fromName: string; toModule: string }> = [];

    this.extractSymbols(tree.rootNode, filePath, language, fileHash, symbols, importEdges);

    // Store in database
    this.memDb.transaction(() => {
      // Clear old data for this file
      this.stmts.deleteEdgesForSymbols!.run(filePath, filePath);
      this.stmts.deleteSymbolsForFile!.run(filePath);

      // Insert new symbols
      for (const sym of symbols) {
        this.stmts.insertSymbol!.run(
          sym.filePath, sym.name, sym.kind,
          sym.startLine, sym.endLine,
          sym.signature, sym.fileHash,
        );
      }
    });

    // Resolve import edges (cross-file linking)
    this.resolveImportEdges(filePath, importEdges);

    tree.delete();
    parser.delete();

    return symbols.length;
  }

  /**
   * Remove graph data for a file.
   */
  removeFile(filePath: string): void {
    this.memDb.transaction(() => {
      this.stmts.deleteEdgesForSymbols!.run(filePath, filePath);
      this.stmts.deleteSymbolsForFile!.run(filePath);
    });
  }

  // ── Query Methods ──

  /** Get all symbols in a file. */
  getSymbolsInFile(filePath: string): SymbolInfo[] {
    return this.mapSymbolRows(this.stmts.getSymbolsByFile!.all(filePath));
  }

  /** Find symbols by name. */
  findSymbol(name: string): SymbolInfo[] {
    return this.mapSymbolRows(this.stmts.getSymbolByName!.all(name));
  }

  /** Get callers of a symbol. */
  getCallers(symbolId: number): SymbolInfo[] {
    return this.mapSymbolRows(this.stmts.getCallers!.all(symbolId));
  }

  /** Get callees of a symbol. */
  getCallees(symbolId: number): SymbolInfo[] {
    return this.mapSymbolRows(this.stmts.getCallees!.all(symbolId));
  }

  /** Get imports of a symbol (what a file imports). */
  getImports(symbolId: number): SymbolInfo[] {
    return this.mapSymbolRows(this.stmts.getImportsOf!.all(symbolId));
  }

  /**
   * Expand a set of file paths with graph neighbors.
   * Given retrieved file paths from RAG, pull in structurally related files.
   */
  expandWithNeighbors(filePaths: string[], maxExpansion = 5): string[] {
    const expanded = new Set(filePaths);
    const neighborFiles = new Set<string>();

    for (const fp of filePaths) {
      const symbolIds = this.stmts.getAllSymbolIds!.all(fp) as Array<{ id: number }>;
      for (const { id } of symbolIds) {
        // Get callers and callees
        const callers = this.getCallers(id);
        const callees = this.getCallees(id);
        for (const s of [...callers, ...callees]) {
          if (!expanded.has(s.filePath)) {
            neighborFiles.add(s.filePath);
          }
        }
      }
    }

    // Add top neighbors up to limit
    const neighbors = Array.from(neighborFiles).slice(0, maxExpansion);
    for (const n of neighbors) expanded.add(n);
    return Array.from(expanded);
  }

  /**
   * Get call chain to a symbol (recursive, up to maxDepth).
   */
  getCallChain(symbolId: number, direction: 'callers' | 'callees', maxDepth = 3): GraphQueryResult[] {
    const edgeKind = direction === 'callers' ? 'source_id' : 'target_id';
    const joinCol = direction === 'callers' ? 'target_id' : 'source_id';

    const sql = `
      WITH RECURSIVE chain AS (
        SELECT ${edgeKind} as sym_id, 1 as depth
        FROM edges WHERE ${joinCol} = ? AND kind = 'calls'
        UNION ALL
        SELECT e.${edgeKind}, c.depth + 1
        FROM edges e JOIN chain c ON e.${joinCol} = c.sym_id
        WHERE e.kind = 'calls' AND c.depth < ?
      )
      SELECT DISTINCT s.*, chain.depth FROM chain
      JOIN symbols s ON chain.sym_id = s.id
      ORDER BY chain.depth
    `;

    const rows = this.db.prepare(sql).all(symbolId, maxDepth) as Array<SymbolRow & { depth: number }>;
    return rows.map(r => ({
      symbol: this.mapSymbolRow(r),
      depth: r.depth,
    }));
  }

  /**
   * Generate a structural repo map from the graph.
   */
  generateStructuralRepoMap(maxTokens = 3000): string {
    const files = this.db.prepare(
      'SELECT DISTINCT file_path FROM symbols ORDER BY file_path',
    ).all() as Array<{ file_path: string }>;

    const lines: string[] = ['# Repository Structure\n'];
    let estimatedTokens = 10;

    for (const { file_path } of files) {
      const symbols = this.getSymbolsInFile(file_path);
      if (symbols.length === 0) continue;

      const relPath = file_path; // Will be relativized by consumer
      const headerLine = `## ${relPath}`;
      const symbolLines = symbols
        .filter(s => s.kind !== 'import' && s.kind !== 'variable')
        .map(s => `  ${s.signature}`);

      const sectionTokens = (headerLine.length + symbolLines.join('\n').length) / 4;
      if (estimatedTokens + sectionTokens > maxTokens) break;

      lines.push(headerLine);
      lines.push(...symbolLines);
      lines.push('');
      estimatedTokens += sectionTokens;
    }

    return lines.join('\n');
  }

  /** Get total symbol count. */
  getSymbolCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number }).c;
  }

  /** Get total edge count. */
  getEdgeCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
  }

  // ── Private: Extraction ──

  private extractSymbols(
    node: TSNode,
    filePath: string,
    language: string,
    fileHash: string,
    symbols: SymbolInfo[],
    importEdges: Array<{ fromName: string; toModule: string }>,
  ): void {
    const tsLangs = ['typescript', 'tsx', 'javascript', 'jsx'];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.children[i];

      if (tsLangs.includes(language)) {
        this.extractTSSymbol(child, filePath, fileHash, symbols, importEdges);
      } else if (language === 'python') {
        this.extractPythonSymbol(child, filePath, fileHash, symbols, importEdges);
      }
      // Other languages can be added incrementally
    }
  }

  private extractTSSymbol(
    node: TSNode,
    filePath: string,
    fileHash: string,
    symbols: SymbolInfo[],
    importEdges: Array<{ fromName: string; toModule: string }>,
  ): void {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    switch (node.type) {
      case 'function_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const sig = this.extractFirstLine(node.text);
          symbols.push({ filePath, name: nameNode.text, kind: 'function', startLine, endLine, signature: sig, fileHash });
        }
        break;
      }
      case 'class_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const sig = this.extractFirstLine(node.text);
          symbols.push({ filePath, name: nameNode.text, kind: 'class', startLine, endLine, signature: sig, fileHash });
          // Extract methods from class body
          this.extractClassMembers(node, filePath, fileHash, symbols);
        }
        break;
      }
      case 'interface_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ filePath, name: nameNode.text, kind: 'interface', startLine, endLine, signature: `interface ${nameNode.text}`, fileHash });
        }
        break;
      }
      case 'type_alias_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ filePath, name: nameNode.text, kind: 'type', startLine, endLine, signature: this.extractFirstLine(node.text), fileHash });
        }
        break;
      }
      case 'enum_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ filePath, name: nameNode.text, kind: 'enum', startLine, endLine, signature: `enum ${nameNode.text}`, fileHash });
        }
        break;
      }
      case 'import_statement': {
        // Extract import specifiers and source
        const source = node.children.find(c => c.type === 'string')?.text?.replace(/['"]/g, '');
        if (source) {
          const specifiers = node.text.match(/\{([^}]+)\}/)?.[1];
          if (specifiers) {
            for (const spec of specifiers.split(',')) {
              const name = spec.trim().split(/\s+as\s+/)[0].trim();
              if (name) {
                importEdges.push({ fromName: name, toModule: source });
                symbols.push({ filePath, name, kind: 'import', startLine, endLine, signature: `import { ${name} } from '${source}'`, fileHash });
              }
            }
          }
        }
        break;
      }
      case 'export_statement': {
        // Recurse into the exported declaration
        for (const child of node.namedChildren) {
          this.extractTSSymbol(child, filePath, fileHash, symbols, importEdges);
        }
        break;
      }
      case 'lexical_declaration':
      case 'variable_declaration': {
        // const/let/var declarations
        for (const child of node.namedChildren) {
          if (child.type === 'variable_declarator') {
            const nameNode = child.childForFieldName('name');
            if (nameNode) {
              // Check if it's an arrow function
              const value = child.childForFieldName('value');
              const kind: SymbolKind = value?.type === 'arrow_function' ? 'function' : 'variable';
              symbols.push({ filePath, name: nameNode.text, kind, startLine, endLine, signature: this.extractFirstLine(node.text), fileHash });
            }
          }
        }
        break;
      }
    }
  }

  private extractClassMembers(
    classNode: TSNode,
    filePath: string,
    fileHash: string,
    symbols: SymbolInfo[],
  ): void {
    const body = classNode.children.find(c => c.type === 'class_body');
    if (!body) return;

    for (const member of body.namedChildren) {
      if (member.type === 'method_definition' || member.type === 'public_field_definition') {
        const nameNode = member.childForFieldName('name');
        if (nameNode) {
          const className = classNode.childForFieldName('name')?.text ?? '';
          symbols.push({
            filePath,
            name: `${className}.${nameNode.text}`,
            kind: 'method',
            startLine: member.startPosition.row + 1,
            endLine: member.endPosition.row + 1,
            signature: this.extractFirstLine(member.text),
            fileHash,
          });
        }
      }
    }
  }

  private extractPythonSymbol(
    node: TSNode,
    filePath: string,
    fileHash: string,
    symbols: SymbolInfo[],
    importEdges: Array<{ fromName: string; toModule: string }>,
  ): void {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    switch (node.type) {
      case 'function_definition': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ filePath, name: nameNode.text, kind: 'function', startLine, endLine, signature: this.extractFirstLine(node.text), fileHash });
        }
        break;
      }
      case 'class_definition': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ filePath, name: nameNode.text, kind: 'class', startLine, endLine, signature: this.extractFirstLine(node.text), fileHash });
        }
        break;
      }
      case 'import_statement':
      case 'import_from_statement': {
        const moduleNode = node.childForFieldName('module_name') ?? node.children.find(c => c.type === 'dotted_name');
        if (moduleNode) {
          symbols.push({ filePath, name: moduleNode.text, kind: 'import', startLine, endLine, signature: node.text.trim(), fileHash });
          importEdges.push({ fromName: moduleNode.text, toModule: moduleNode.text });
        }
        break;
      }
      case 'decorated_definition': {
        // Recurse into the decorated function/class
        for (const child of node.namedChildren) {
          this.extractPythonSymbol(child, filePath, fileHash, symbols, importEdges);
        }
        break;
      }
    }
  }

  private resolveImportEdges(
    filePath: string,
    importEdges: Array<{ fromName: string; toModule: string }>,
  ): void {
    // For each import, try to find the target symbol in the database
    for (const { fromName, toModule } of importEdges) {
      // Find source symbol (the import statement itself)
      const sourceRows = this.db.prepare(
        `SELECT id FROM symbols WHERE file_path = ? AND name = ? AND kind = 'import' LIMIT 1`,
      ).all(filePath, fromName) as Array<{ id: number }>;

      if (sourceRows.length === 0) continue;

      // Find target symbol (the actual definition)
      const targetRows = this.db.prepare(
        `SELECT id FROM symbols WHERE name = ? AND kind != 'import' LIMIT 1`,
      ).all(fromName) as Array<{ id: number }>;

      if (targetRows.length > 0) {
        this.stmts.insertEdge!.run(sourceRows[0].id, targetRows[0].id, 'imports');
      }
    }
  }

  private async getLanguage(language: string): Promise<TSLanguage | null> {
    const cached = this.loadedLanguages.get(language);
    if (cached) return cached;

    const wasmFile = LANG_WASM_MAP[language];
    if (!wasmFile || !this.TreeSitter) return null;

    try {
      const lang = await this.TreeSitter.Language.load(path.join(this.wasmDir, wasmFile));
      this.loadedLanguages.set(language, lang);
      return lang;
    } catch {
      return null;
    }
  }

  private extractFirstLine(text: string): string {
    const firstLine = text.split('\n')[0].trim();
    return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
  }

  // ── Row Mapping ──

  private mapSymbolRows(rows: unknown[]): SymbolInfo[] {
    return (rows as SymbolRow[]).map(this.mapSymbolRow);
  }

  private mapSymbolRow(r: SymbolRow): SymbolInfo {
    return {
      id: r.id,
      filePath: r.file_path,
      name: r.name,
      kind: r.kind as SymbolKind,
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature,
      fileHash: r.file_hash,
    };
  }
}

interface SymbolRow {
  id: number;
  file_path: string;
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
  signature: string;
  file_hash: string;
}
