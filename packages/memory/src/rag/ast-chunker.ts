/**
 * AST-Aware Code Chunker — semantic chunking via tree-sitter WASM.
 *
 * Instead of fixed-line sliding windows, parses code into AST and chunks
 * at semantic boundaries (functions, classes, methods). Follows the cAST
 * approach: split large nodes recursively, merge small siblings.
 *
 * Each chunk is a self-contained, semantically coherent unit.
 */

import * as path from 'path';
import type { CodeChunk } from './codebase-indexer';
import * as crypto from 'crypto';

// web-tree-sitter types (loaded dynamically via WASM)
interface TreeSitterParser {
  setLanguage(lang: TreeSitterLanguage): void;
  parse(input: string): TreeSitterTree;
  delete(): void;
}

interface TreeSitterTree {
  rootNode: TreeSitterNode;
  delete(): void;
}

interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TreeSitterNode[];
  childCount: number;
  namedChildren: TreeSitterNode[];
  namedChildCount: number;
  parent: TreeSitterNode | null;
}

interface TreeSitterLanguage {}

interface TreeSitterInit {
  init(options?: { locateFile?: (scriptName: string) => string }): Promise<void>;
  Language: {
    load(path: string): Promise<TreeSitterLanguage>;
  };
  new (): TreeSitterParser;
  prototype: { setLanguage(lang: TreeSitterLanguage): void };
}

/** Node types that represent top-level semantic units worth chunking individually */
const TOP_LEVEL_TYPES: Record<string, Set<string>> = {
  typescript: new Set([
    'function_declaration', 'arrow_function', 'class_declaration',
    'interface_declaration', 'type_alias_declaration', 'enum_declaration',
    'export_statement', 'method_definition', 'lexical_declaration',
    'variable_declaration',
  ]),
  tsx: new Set([
    'function_declaration', 'arrow_function', 'class_declaration',
    'interface_declaration', 'type_alias_declaration', 'enum_declaration',
    'export_statement', 'method_definition', 'lexical_declaration',
    'variable_declaration',
  ]),
  javascript: new Set([
    'function_declaration', 'arrow_function', 'class_declaration',
    'export_statement', 'method_definition', 'lexical_declaration',
    'variable_declaration',
  ]),
  jsx: new Set([
    'function_declaration', 'arrow_function', 'class_declaration',
    'export_statement', 'method_definition', 'lexical_declaration',
    'variable_declaration',
  ]),
  python: new Set([
    'function_definition', 'class_definition', 'decorated_definition',
  ]),
  rust: new Set([
    'function_item', 'struct_item', 'enum_item', 'impl_item',
    'trait_item', 'mod_item', 'type_item', 'const_item', 'static_item',
  ]),
  go: new Set([
    'function_declaration', 'method_declaration', 'type_declaration',
    'const_declaration', 'var_declaration',
  ]),
  java: new Set([
    'class_declaration', 'method_declaration', 'interface_declaration',
    'enum_declaration', 'constructor_declaration',
  ]),
  csharp: new Set([
    'class_declaration', 'method_declaration', 'interface_declaration',
    'enum_declaration', 'struct_declaration', 'namespace_declaration',
    'constructor_declaration', 'property_declaration',
  ]),
  css: new Set(['rule_set', 'media_statement', 'keyframes_statement']),
  html: new Set(['element']),
};

/** Max lines per chunk before recursive splitting */
const MAX_CHUNK_LINES = 100;
/** Min lines to keep a chunk (below this, merge with neighbors) */
const MIN_CHUNK_LINES = 5;

/** Language to WASM file mapping */
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
  css: 'tree-sitter-css.wasm',
  html: 'tree-sitter-html.wasm',
};

export class ASTChunker {
  private TreeSitter: TreeSitterInit | null = null;
  private loadedLanguages: Map<string, TreeSitterLanguage> = new Map();
  private wasmDir: string;
  private initialized = false;

  constructor() {
    // tree-sitter-wasms package provides pre-built WASM files
    this.wasmDir = path.join(
      path.dirname(require.resolve('tree-sitter-wasms/package.json')),
      'out',
    );
  }

  /**
   * Initialize the tree-sitter WASM runtime.
   * Must be called before chunking.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Dynamic import since web-tree-sitter is ESM-like
    const TreeSitterModule = require('web-tree-sitter') as TreeSitterInit;
    await TreeSitterModule.init({
      locateFile: (scriptName: string) => {
        // web-tree-sitter needs to find its own WASM file
        return path.join(
          path.dirname(require.resolve('web-tree-sitter/package.json')),
          scriptName,
        );
      },
    });
    this.TreeSitter = TreeSitterModule;
    this.initialized = true;
  }

  /**
   * Chunk a file using AST-aware semantic boundaries.
   * Falls back to line-based chunking if the language isn't supported or parsing fails.
   */
  async chunkFile(
    filePath: string,
    content: string,
    language: string,
  ): Promise<CodeChunk[]> {
    // Try AST-based chunking for supported languages
    if (LANG_WASM_MAP[language]) {
      try {
        await this.init();
        const lang = await this.getLanguage(language);
        if (lang) {
          return this.astChunk(filePath, content, language, lang);
        }
      } catch {
        // Fall through to line-based chunking
      }
    }

    // Fallback: line-based chunking (same as before)
    return this.lineChunk(filePath, content, language);
  }

  /**
   * Check if a language has AST support.
   */
  supportsLanguage(language: string): boolean {
    return language in LANG_WASM_MAP;
  }

  private async getLanguage(language: string): Promise<TreeSitterLanguage | null> {
    const cached = this.loadedLanguages.get(language);
    if (cached) return cached;

    const wasmFile = LANG_WASM_MAP[language];
    if (!wasmFile || !this.TreeSitter) return null;

    try {
      const wasmPath = path.join(this.wasmDir, wasmFile);
      const lang = await this.TreeSitter.Language.load(wasmPath);
      this.loadedLanguages.set(language, lang);
      return lang;
    } catch {
      return null;
    }
  }

  private astChunk(
    filePath: string,
    content: string,
    language: string,
    lang: TreeSitterLanguage,
  ): CodeChunk[] {
    const parser = new this.TreeSitter!();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    const lines = content.split('\n');
    const topLevelTypes = TOP_LEVEL_TYPES[language] ?? new Set<string>();

    const chunks: CodeChunk[] = [];
    const rootNode = tree.rootNode;

    // Collect top-level semantic nodes
    const semanticNodes: TreeSitterNode[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.children[i];
      this.collectSemanticNodes(child, topLevelTypes, semanticNodes);
    }

    if (semanticNodes.length === 0) {
      // No semantic nodes found — fall back to line-based
      tree.delete();
      parser.delete();
      return this.lineChunk(filePath, content, language);
    }

    // Process nodes: split large, merge small
    let pendingSmall: TreeSitterNode[] = [];

    for (const node of semanticNodes) {
      const nodeLines = node.endPosition.row - node.startPosition.row + 1;

      if (nodeLines > MAX_CHUNK_LINES) {
        // Flush pending small nodes first
        if (pendingSmall.length > 0) {
          chunks.push(this.mergeNodesToChunk(filePath, lines, language, pendingSmall));
          pendingSmall = [];
        }
        // Split large node recursively
        const subChunks = this.splitLargeNode(filePath, lines, language, node, topLevelTypes);
        chunks.push(...subChunks);
      } else if (nodeLines < MIN_CHUNK_LINES) {
        // Accumulate small nodes for merging
        pendingSmall.push(node);
        const totalLines = this.totalLinesOfNodes(pendingSmall);
        if (totalLines >= MAX_CHUNK_LINES / 2) {
          chunks.push(this.mergeNodesToChunk(filePath, lines, language, pendingSmall));
          pendingSmall = [];
        }
      } else {
        // Normal-sized node: flush pending, then add as chunk
        if (pendingSmall.length > 0) {
          chunks.push(this.mergeNodesToChunk(filePath, lines, language, pendingSmall));
          pendingSmall = [];
        }
        chunks.push(this.nodeToChunk(filePath, lines, language, node));
      }
    }

    // Flush remaining small nodes
    if (pendingSmall.length > 0) {
      chunks.push(this.mergeNodesToChunk(filePath, lines, language, pendingSmall));
    }

    // Handle any content between/before/after semantic nodes (imports, comments, etc.)
    const coveredRanges = chunks.map(c => ({ start: c.startLine, end: c.endLine }));
    const gapChunks = this.fillGaps(filePath, lines, language, coveredRanges);
    chunks.push(...gapChunks);

    // Sort by start line
    chunks.sort((a, b) => a.startLine - b.startLine);

    tree.delete();
    parser.delete();
    return chunks;
  }

  private collectSemanticNodes(
    node: TreeSitterNode,
    topLevelTypes: Set<string>,
    result: TreeSitterNode[],
  ): void {
    if (topLevelTypes.has(node.type)) {
      result.push(node);
      return;
    }
    // For export_statement wrapping a declaration, use the export
    for (let i = 0; i < node.childCount; i++) {
      const child = node.children[i];
      if (topLevelTypes.has(child.type)) {
        result.push(child);
      }
    }
  }

  private nodeToChunk(
    filePath: string,
    lines: string[],
    language: string,
    node: TreeSitterNode,
  ): CodeChunk {
    const startLine = node.startPosition.row + 1; // 1-indexed
    const endLine = node.endPosition.row + 1;
    const content = lines.slice(startLine - 1, endLine).join('\n');
    const id = `${filePath}:${startLine}-${endLine}`;
    const hash = crypto.createHash('md5').update(content).digest('hex');

    return { id, filePath, startLine, endLine, content, language, hash };
  }

  private mergeNodesToChunk(
    filePath: string,
    lines: string[],
    language: string,
    nodes: TreeSitterNode[],
  ): CodeChunk {
    const startLine = Math.min(...nodes.map(n => n.startPosition.row + 1));
    const endLine = Math.max(...nodes.map(n => n.endPosition.row + 1));
    const content = lines.slice(startLine - 1, endLine).join('\n');
    const id = `${filePath}:${startLine}-${endLine}`;
    const hash = crypto.createHash('md5').update(content).digest('hex');

    return { id, filePath, startLine, endLine, content, language, hash };
  }

  private splitLargeNode(
    filePath: string,
    lines: string[],
    language: string,
    node: TreeSitterNode,
    topLevelTypes: Set<string>,
  ): CodeChunk[] {
    // Try to split at named children (methods within a class, etc.)
    const children = node.namedChildren;
    if (children.length <= 1) {
      // Can't split further — just return as one chunk
      return [this.nodeToChunk(filePath, lines, language, node)];
    }

    const chunks: CodeChunk[] = [];
    let pendingSmall: TreeSitterNode[] = [];

    for (const child of children) {
      const childLines = child.endPosition.row - child.startPosition.row + 1;

      if (childLines > MAX_CHUNK_LINES) {
        if (pendingSmall.length > 0) {
          chunks.push(this.mergeNodesToChunk(filePath, lines, language, pendingSmall));
          pendingSmall = [];
        }
        // Recurse
        chunks.push(...this.splitLargeNode(filePath, lines, language, child, topLevelTypes));
      } else if (childLines < MIN_CHUNK_LINES) {
        pendingSmall.push(child);
        if (this.totalLinesOfNodes(pendingSmall) >= MAX_CHUNK_LINES / 2) {
          chunks.push(this.mergeNodesToChunk(filePath, lines, language, pendingSmall));
          pendingSmall = [];
        }
      } else {
        if (pendingSmall.length > 0) {
          chunks.push(this.mergeNodesToChunk(filePath, lines, language, pendingSmall));
          pendingSmall = [];
        }
        chunks.push(this.nodeToChunk(filePath, lines, language, child));
      }
    }

    if (pendingSmall.length > 0) {
      chunks.push(this.mergeNodesToChunk(filePath, lines, language, pendingSmall));
    }

    return chunks;
  }

  private totalLinesOfNodes(nodes: TreeSitterNode[]): number {
    return nodes.reduce(
      (sum, n) => sum + (n.endPosition.row - n.startPosition.row + 1),
      0,
    );
  }

  /**
   * Fill gaps between semantic chunks with line-based chunks.
   * This captures imports, top-level comments, module-level code.
   */
  private fillGaps(
    filePath: string,
    lines: string[],
    language: string,
    coveredRanges: Array<{ start: number; end: number }>,
  ): CodeChunk[] {
    const gaps: CodeChunk[] = [];
    const sorted = [...coveredRanges].sort((a, b) => a.start - b.start);

    let currentLine = 1;
    for (const range of sorted) {
      if (range.start > currentLine) {
        const gapContent = lines.slice(currentLine - 1, range.start - 1).join('\n');
        if (gapContent.trim().length >= 10) {
          const id = `${filePath}:${currentLine}-${range.start - 1}`;
          const hash = crypto.createHash('md5').update(gapContent).digest('hex');
          gaps.push({
            id,
            filePath,
            startLine: currentLine,
            endLine: range.start - 1,
            content: gapContent,
            language,
            hash,
          });
        }
      }
      currentLine = Math.max(currentLine, range.end + 1);
    }

    // Trailing content after last chunk
    if (currentLine <= lines.length) {
      const gapContent = lines.slice(currentLine - 1).join('\n');
      if (gapContent.trim().length >= 10) {
        const id = `${filePath}:${currentLine}-${lines.length}`;
        const hash = crypto.createHash('md5').update(gapContent).digest('hex');
        gaps.push({
          id,
          filePath,
          startLine: currentLine,
          endLine: lines.length,
          content: gapContent,
          language,
          hash,
        });
      }
    }

    return gaps;
  }

  /**
   * Fallback: fixed-size line-based chunking (for unsupported languages).
   */
  private lineChunk(filePath: string, content: string, language: string): CodeChunk[] {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    const chunkSize = 50;
    const overlap = 5;

    for (let i = 0; i < lines.length; i += chunkSize - overlap) {
      const endLine = Math.min(i + chunkSize, lines.length);
      const chunkContent = lines.slice(i, endLine).join('\n');

      if (chunkContent.trim().length < 10) continue;

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
}
