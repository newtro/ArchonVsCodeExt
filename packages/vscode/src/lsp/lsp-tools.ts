/**
 * LSP tool wrappers — leverage VS Code's built-in language servers
 * for code intelligence. Works for any language with a VS Code extension.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { ToolDefinition } from '@archon/core';

export function createLspTools(): ToolDefinition[] {
  return [
    goToDefinitionTool,
    findReferencesTool,
    getHoverInfoTool,
    getWorkspaceSymbolsTool,
    getDocumentSymbolsTool,
    getCodeActionsTool,
    getDiagnosticsTool,
  ];
}

function hasWorkspace(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

function resolveUri(workspaceRoot: string, relativePath: string): vscode.Uri {
  const fullPath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(workspaceRoot, relativePath);
  return vscode.Uri.file(fullPath);
}

async function ensureDocumentOpen(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.openTextDocument(uri);
    return true;
  } catch {
    return false;
  }
}

const goToDefinitionTool: ToolDefinition = {
  name: 'go_to_definition',
  description: 'Jump to where a symbol is defined. Provide the file path and position (line/character) of the symbol.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to workspace root)' },
      line: { type: 'number', description: 'Line number (0-based)' },
      character: { type: 'number', description: 'Character offset (0-based)' },
    },
    required: ['path', 'line', 'character'],
  },
  execute: async (args, ctx) => {
    if (!hasWorkspace()) return 'Error: No workspace folder is open. Open a folder first.';

    const uri = resolveUri(ctx.workspaceRoot, args.path as string);
    if (!await ensureDocumentOpen(uri)) {
      return `Error: Could not open file "${args.path}". Make sure the file exists in the workspace.`;
    }

    const position = new vscode.Position(args.line as number, args.character as number);

    try {
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider', uri, position
      );

      if (!locations || locations.length === 0) {
        return 'No definition found at this position.';
      }

      const results = locations.map(loc => {
        const relPath = vscode.workspace.asRelativePath(loc.uri);
        return `${relPath}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`;
      });

      return `Definition found:\n${results.join('\n')}`;
    } catch (err) {
      return `Error finding definition: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const findReferencesTool: ToolDefinition = {
  name: 'find_references',
  description: 'Find all usages of a symbol. Returns file paths and line numbers of all references.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to workspace root)' },
      line: { type: 'number', description: 'Line number (0-based)' },
      character: { type: 'number', description: 'Character offset (0-based)' },
    },
    required: ['path', 'line', 'character'],
  },
  execute: async (args, ctx) => {
    if (!hasWorkspace()) return 'Error: No workspace folder is open. Open a folder first.';

    const uri = resolveUri(ctx.workspaceRoot, args.path as string);
    if (!await ensureDocumentOpen(uri)) {
      return `Error: Could not open file "${args.path}". Make sure the file exists in the workspace.`;
    }

    const position = new vscode.Position(args.line as number, args.character as number);

    try {
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider', uri, position
      );

      if (!locations || locations.length === 0) {
        return 'No references found.';
      }

      const results = locations.slice(0, 50).map(loc => {
        const relPath = vscode.workspace.asRelativePath(loc.uri);
        return `${relPath}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`;
      });

      let output = `Found ${locations.length} reference(s):\n${results.join('\n')}`;
      if (locations.length > 50) {
        output += `\n... and ${locations.length - 50} more`;
      }
      return output;
    } catch (err) {
      return `Error finding references: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const getHoverInfoTool: ToolDefinition = {
  name: 'get_hover_info',
  description: 'Get type information and documentation for a symbol at a given position.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to workspace root)' },
      line: { type: 'number', description: 'Line number (0-based)' },
      character: { type: 'number', description: 'Character offset (0-based)' },
    },
    required: ['path', 'line', 'character'],
  },
  execute: async (args, ctx) => {
    if (!hasWorkspace()) return 'Error: No workspace folder is open. Open a folder first.';

    const uri = resolveUri(ctx.workspaceRoot, args.path as string);
    if (!await ensureDocumentOpen(uri)) {
      return `Error: Could not open file "${args.path}". Make sure the file exists in the workspace.`;
    }

    const position = new vscode.Position(args.line as number, args.character as number);

    try {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider', uri, position
      );

      if (!hovers || hovers.length === 0) {
        return 'No hover information available.';
      }

      const parts: string[] = [];
      for (const hover of hovers) {
        for (const content of hover.contents) {
          if (typeof content === 'string') {
            parts.push(content);
          } else if ('value' in content) {
            parts.push(content.value);
          }
        }
      }

      return parts.join('\n\n') || 'No hover information available.';
    } catch (err) {
      return `Error getting hover info: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const getWorkspaceSymbolsTool: ToolDefinition = {
  name: 'get_workspace_symbols',
  description: 'Search for classes, functions, variables, and other symbols by name across the entire workspace.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Symbol name or pattern to search for' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    if (!hasWorkspace()) return 'Error: No workspace folder is open. Open a folder first.';

    try {
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider', args.query as string
      );

      if (!symbols || symbols.length === 0) {
        return 'No symbols found.';
      }

      const results = symbols.slice(0, 50).map(s => {
        const relPath = vscode.workspace.asRelativePath(s.location.uri);
        const kind = vscode.SymbolKind[s.kind];
        return `${kind} ${s.name} — ${relPath}:${s.location.range.start.line + 1}`;
      });

      let output = `Found ${symbols.length} symbol(s):\n${results.join('\n')}`;
      if (symbols.length > 50) {
        output += `\n... and ${symbols.length - 50} more`;
      }
      return output;
    } catch (err) {
      return `Error searching symbols: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const getDocumentSymbolsTool: ToolDefinition = {
  name: 'get_document_symbols',
  description: 'Get the outline/structure of a file — all classes, functions, variables, and their locations.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to workspace root)' },
    },
    required: ['path'],
  },
  execute: async (args, ctx) => {
    if (!hasWorkspace()) return 'Error: No workspace folder is open. Open a folder first.';

    const uri = resolveUri(ctx.workspaceRoot, args.path as string);
    if (!await ensureDocumentOpen(uri)) {
      return `Error: Could not open file "${args.path}". Make sure the file exists in the workspace.`;
    }

    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', uri
      );

      if (!symbols || symbols.length === 0) {
        return 'No symbols found in this file.';
      }

      const lines: string[] = [];
      flattenSymbols(symbols, lines, 0);
      return lines.join('\n');
    } catch (err) {
      return `Error getting document symbols: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

function flattenSymbols(symbols: vscode.DocumentSymbol[], lines: string[], indent: number): void {
  for (const s of symbols) {
    const kind = vscode.SymbolKind[s.kind];
    const prefix = '  '.repeat(indent);
    lines.push(`${prefix}${kind} ${s.name} [${s.range.start.line + 1}-${s.range.end.line + 1}]${s.detail ? ` — ${s.detail}` : ''}`);
    if (s.children && s.children.length > 0) {
      flattenSymbols(s.children, lines, indent + 1);
    }
  }
}

const getCodeActionsTool: ToolDefinition = {
  name: 'get_code_actions',
  description: 'Get available quick fixes and refactorings at a specific location.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to workspace root)' },
      line: { type: 'number', description: 'Line number (0-based)' },
      character: { type: 'number', description: 'Character offset (0-based)' },
    },
    required: ['path', 'line', 'character'],
  },
  execute: async (args, ctx) => {
    if (!hasWorkspace()) return 'Error: No workspace folder is open. Open a folder first.';

    const uri = resolveUri(ctx.workspaceRoot, args.path as string);
    if (!await ensureDocumentOpen(uri)) {
      return `Error: Could not open file "${args.path}". Make sure the file exists in the workspace.`;
    }

    const position = new vscode.Position(args.line as number, args.character as number);
    const range = new vscode.Range(position, position);

    try {
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider', uri, range
      );

      if (!actions || actions.length === 0) {
        return 'No code actions available at this position.';
      }

      const results = actions.map((a, i) => {
        const kind = a.kind?.value ?? 'unknown';
        return `${i + 1}. [${kind}] ${a.title}`;
      });

      return `Available code actions:\n${results.join('\n')}`;
    } catch (err) {
      return `Error getting code actions: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const getDiagnosticsTool: ToolDefinition = {
  name: 'get_diagnostics',
  description: 'Get compiler errors, warnings, and linting issues for a file or the entire workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Optional file path. If omitted, returns diagnostics for all files.' },
    },
  },
  execute: async (args, ctx) => {
    if (args.path) {
      const uri = resolveUri(ctx.workspaceRoot, args.path as string);
      const diagnostics = vscode.languages.getDiagnostics(uri);
      if (diagnostics.length === 0) return 'No diagnostics for this file.';
      return formatDiagnostics(args.path as string, diagnostics);
    }

    // All workspace diagnostics
    const allDiagnostics = vscode.languages.getDiagnostics();
    const results: string[] = [];
    for (const [uri, diags] of allDiagnostics) {
      if (diags.length === 0) continue;
      const relPath = vscode.workspace.asRelativePath(uri);
      results.push(formatDiagnostics(relPath, diags));
    }

    return results.length > 0 ? results.join('\n\n') : 'No diagnostics in workspace.';
  },
};

function formatDiagnostics(filePath: string, diagnostics: vscode.Diagnostic[]): string {
  const lines = diagnostics.map(d => {
    const severity = ['Error', 'Warning', 'Info', 'Hint'][d.severity] ?? 'Unknown';
    return `  ${severity} [${d.range.start.line + 1}:${d.range.start.character + 1}]: ${d.message}${d.source ? ` (${d.source})` : ''}`;
  });
  return `${filePath}:\n${lines.join('\n')}`;
}
