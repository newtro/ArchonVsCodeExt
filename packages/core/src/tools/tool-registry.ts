/**
 * Tool registry — defines and manages all available tools.
 */

import type { ToolDefinition, ToolContext } from '../types';
import type { Pipeline, PipelineNode, PipelineEdge, NodeType } from '../pipeline/types';
import * as path from 'path';
import * as fs from 'fs';

const VALID_NODE_TYPES: NodeType[] = [
  'agent', 'tool', 'decision_gate', 'user_checkpoint',
  'loop', 'parallel', 'verification', 'plugin',
];

export function createCoreTools(): ToolDefinition[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    searchFilesTool,
    findFilesTool,
    listDirectoryTool,
    runTerminalTool,
    askUserTool,
    attemptCompletionTool,
    createPipelineTool,
    editPipelineTool,
    listPipelinesTool,
    deletePipelineTool,
  ];
}

// ── read_file ──

const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Returns the full file content with line numbers. Supports line ranges via start_line/end_line.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file from workspace root' },
      start_line: { type: 'number', description: 'Optional start line (1-based)' },
      end_line: { type: 'number', description: 'Optional end line (1-based, inclusive)' },
    },
    required: ['path'],
  },
  execute: async (args, ctx) => {
    const filePath = resolvePath(ctx.workspaceRoot, args.path as string);
    const content = await ctx.readFile(filePath);
    const lines = content.split('\n');
    const start = ((args.start_line as number) ?? 1) - 1;
    const end = (args.end_line as number) ?? lines.length;
    const slice = lines.slice(start, end);
    const numbered = slice.map((line, i) => `${start + i + 1} | ${line}`).join('\n');
    return numbered;
  },
};

// ── write_file ──

const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Create a new file or completely overwrite an existing file with the provided content.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file from workspace root' },
      content: { type: 'string', description: 'Full content to write to the file' },
    },
    required: ['path', 'content'],
  },
  execute: async (args, ctx) => {
    const filePath = resolvePath(ctx.workspaceRoot, args.path as string);
    await ctx.writeFile(filePath, args.content as string);
    return `File written: ${filePath}`;
  },
};

// ── edit_file ──

const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: `Make surgical edits to an existing file using SEARCH/REPLACE blocks. Each edit specifies the exact text to find (old_text) and what to replace it with (new_text). Multiple edits can be applied in a single call.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file from workspace root' },
      edits: {
        type: 'array',
        description: 'Array of search/replace edit operations',
        items: { type: 'object' },
      },
    },
    required: ['path', 'edits'],
  },
  execute: async (args, ctx) => {
    const filePath = resolvePath(ctx.workspaceRoot, args.path as string);
    const edits = args.edits as Array<{ old_text: string; new_text: string }>;
    let content = await ctx.readFile(filePath);
    const results: string[] = [];

    for (const edit of edits) {
      const applied = applySearchReplace(content, edit.old_text, edit.new_text);
      if (applied !== null) {
        content = applied;
        results.push(`Replaced: "${truncate(edit.old_text, 50)}" → "${truncate(edit.new_text, 50)}"`);
      } else {
        // Fallback: whitespace-normalized match
        const normalized = applySearchReplaceNormalized(content, edit.old_text, edit.new_text);
        if (normalized !== null) {
          content = normalized;
          results.push(`Replaced (whitespace-normalized): "${truncate(edit.old_text, 50)}"`);
        } else {
          // Fallback: fuzzy match
          const fuzzy = applyFuzzyMatch(content, edit.old_text, edit.new_text);
          if (fuzzy !== null) {
            content = fuzzy;
            results.push(`Replaced (fuzzy match): "${truncate(edit.old_text, 50)}"`);
          } else {
            results.push(`FAILED: Could not find match for "${truncate(edit.old_text, 80)}". The actual file content near the expected location may differ.`);
          }
        }
      }
    }

    await ctx.writeFile(filePath, content);

    // Check diagnostics after edit
    const diagnostics = await ctx.getDiagnostics(filePath);
    const errors = diagnostics.filter(d => d.severity === 'error');
    if (errors.length > 0) {
      results.push(`\nWarning: ${errors.length} error(s) after edit:`);
      for (const e of errors.slice(0, 5)) {
        results.push(`  Line ${e.range.startLine + 1}: ${e.message}`);
      }
    }

    return results.join('\n');
  },
};

// ── search_files ──

const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description: 'Search for text or regex pattern across files in the workspace. Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Text or regex pattern to search for' },
      path: { type: 'string', description: 'Optional directory to search in (relative to workspace root). Defaults to workspace root.' },
      include: { type: 'string', description: 'Optional glob pattern to filter files (e.g., "*.ts")' },
    },
    required: ['pattern'],
  },
  execute: async (args, ctx) => {
    const searchPath = args.path
      ? resolvePath(ctx.workspaceRoot, args.path as string)
      : ctx.workspaceRoot;

    if (!searchPath || !fs.existsSync(searchPath)) {
      return `Error: Directory not found: "${searchPath}". Make sure a workspace folder is open.`;
    }

    const pattern = args.pattern as string;
    const includeGlob = args.include as string | undefined;
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (err) {
      return `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`;
    }
    const results: string[] = [];
    const maxResults = 100;

    searchDirectory(searchPath, regex, includeGlob, results, maxResults, searchPath);

    return results.length > 0 ? results.join('\n') : 'No matches found.';
  },
};

function searchDirectory(
  dir: string,
  regex: RegExp,
  includeGlob: string | undefined,
  results: string[],
  maxResults: number,
  rootPath: string,
): void {
  if (results.length >= maxResults) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    const fullPath = path.join(dir, entry.name);

    // Skip common non-searchable directories
    if (entry.isDirectory()) {
      if ([
        'node_modules', '.git', '.turbo', 'dist', 'out', '.next', '__pycache__',
        '.vs', '.vscode', '.idea', 'bin', 'obj', 'build', 'coverage', '.nyc_output',
        'TestResults', '.archon', '.nuxt', 'target', 'vendor',
        '.playwright-mcp', '.augment', '.auto-claude', '.kilocode', '.serena', '.trae',
        'Application Files', 'publish', 'wwwroot',
      ].includes(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
      searchDirectory(fullPath, regex, includeGlob, results, maxResults, rootPath);
      continue;
    }

    if (!entry.isFile()) continue;

    // Filter by glob (simple extension matching)
    if (includeGlob) {
      const ext = includeGlob.replace('*', '');
      if (!entry.name.endsWith(ext)) continue;
    }

    // Skip binary files by extension
    if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|mp3|mp4|zip|gz|tar|exe|dll|so|dylib|db|sqlite|bin|lock|snk|nupkg|pfx|p12|pdb|cache|suo|user|min\.js|min\.css|map|wasm|pdf|docx?|xlsx?|pptx?|deploy|bak|orig|log)$/i.test(entry.name)) continue;

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(rootPath, fullPath);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
          if (results.length >= maxResults) return;
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }
}

// ── find_files ──

const findFilesTool: ToolDefinition = {
  name: 'find_files',
  description: 'Find files matching a glob pattern in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match (e.g., "**/*.ts", "*.tsx", "package.json")' },
      path: { type: 'string', description: 'Optional directory to search in (relative to workspace root)' },
    },
    required: ['pattern'],
  },
  execute: async (args, ctx) => {
    const searchPath = args.path
      ? resolvePath(ctx.workspaceRoot, args.path as string)
      : ctx.workspaceRoot;

    if (!searchPath || !fs.existsSync(searchPath)) {
      return `Error: Directory not found: "${searchPath}". Make sure a workspace folder is open.`;
    }

    const pattern = args.pattern as string;
    const results: string[] = [];
    findFilesRecursive(searchPath, pattern, results, 200, searchPath);

    return results.length > 0 ? results.join('\n') : 'No files found.';
  },
};

function findFilesRecursive(
  dir: string,
  pattern: string,
  results: string[],
  maxResults: number,
  rootPath: string,
): void {
  if (results.length >= maxResults) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if ([
        'node_modules', '.git', '.turbo', 'dist', 'out', '.next', '__pycache__',
        '.vs', '.vscode', '.idea', 'bin', 'obj', 'build', 'coverage', '.nyc_output',
        'TestResults', '.archon', '.nuxt', 'target', 'vendor',
        '.playwright-mcp', '.augment', '.auto-claude', '.kilocode', '.serena', '.trae',
        'Application Files', 'publish', 'wwwroot',
      ].includes(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
      findFilesRecursive(fullPath, pattern, results, maxResults, rootPath);
      continue;
    }

    if (!entry.isFile()) continue;

    if (matchGlob(entry.name, fullPath, pattern, rootPath)) {
      results.push(path.relative(rootPath, fullPath));
    }
  }
}

function matchGlob(fileName: string, fullPath: string, pattern: string, rootPath: string): boolean {
  // Simple glob matching: support *.ext, **/*.ext, exact name
  if (pattern.startsWith('**/')) {
    const subPattern = pattern.slice(3);
    return matchGlob(fileName, fullPath, subPattern, rootPath);
  }
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1); // e.g., ".ts"
    return fileName.endsWith(ext);
  }
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    return regex.test(fileName) || regex.test(path.relative(rootPath, fullPath).replace(/\\/g, '/'));
  }
  return fileName === pattern;
}

// ── list_directory ──

const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: 'List contents of a directory, showing files and subdirectories.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to directory from workspace root. Defaults to workspace root.' },
    },
  },
  execute: async (args, ctx) => {
    const dirPath = args.path
      ? resolvePath(ctx.workspaceRoot, args.path as string)
      : ctx.workspaceRoot;

    if (!dirPath || !fs.existsSync(dirPath)) {
      return `Error: Directory not found: "${dirPath}". Make sure a workspace folder is open.`;
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const lines: string[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          lines.push(`[DIR]  ${entry.name}/`);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            const size = formatSize(stat.size);
            lines.push(`[FILE] ${entry.name}  (${size})`);
          } catch {
            lines.push(`[FILE] ${entry.name}`);
          }
        } else if (entry.isSymbolicLink()) {
          lines.push(`[LINK] ${entry.name}`);
        }
      }

      return lines.length > 0
        ? `Contents of ${dirPath}:\n${lines.join('\n')}`
        : `Directory is empty: ${dirPath}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error listing directory: ${msg}`;
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── run_terminal ──

const runTerminalTool: ToolDefinition = {
  name: 'run_terminal',
  description: 'Execute a shell command in the workspace directory. Returns stdout, stderr, and exit code.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Optional working directory (relative to workspace root)' },
    },
    required: ['command'],
  },
  execute: async (args, ctx) => {
    const result = await ctx.executeCommand(args.command as string);
    let output = '';
    if (result.stdout) output += `stdout:\n${result.stdout}\n`;
    if (result.stderr) output += `stderr:\n${result.stderr}\n`;
    output += `exit code: ${result.exitCode}`;
    return output;
  },
};

// ── ask_user ──

const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description: 'Ask the user a question and wait for their response. The question supports full markdown formatting (bold, code blocks, blockquotes, lists, etc.). Provide clickable options when possible — the user can always type a custom response instead. Use multiSelect when the user should be able to pick more than one option.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user. Supports markdown formatting.' },
      options: {
        type: 'array',
        description: 'Predefined answer options. In single-select mode (default), shown as clickable buttons — clicking one sends it immediately. In multi-select mode, shown as checkboxes — the user checks one or more and clicks Submit. The user can always type a custom response instead.',
        items: { type: 'string' },
      },
      multiSelect: {
        type: 'boolean',
        description: 'If true, options are shown as checkboxes and the user can select multiple. The response will be a comma-separated list of selected options. Defaults to false (single-select buttons).',
      },
    },
    required: ['question'],
  },
  execute: async (args, ctx) => {
    const response = await ctx.askUser(
      args.question as string,
      args.options as string[] | undefined,
      args.multiSelect as boolean | undefined,
    );
    return `User responded: ${response}`;
  },
};

// ── attempt_completion ──

const attemptCompletionTool: ToolDefinition = {
  name: 'attempt_completion',
  description: 'Signal that you have completed the task. Provide a summary of what was done.',
  parameters: {
    type: 'object',
    properties: {
      result: { type: 'string', description: 'Summary of the completed task' },
      command: { type: 'string', description: 'Optional command the user can run to verify' },
    },
    required: ['result'],
  },
  execute: async (args, ctx) => {
    ctx.sendMessage(args.result as string);
    return `Task completed: ${args.result}`;
  },
};

// ── create_pipeline ──

const createPipelineTool: ToolDefinition = {
  name: 'create_pipeline',
  description: `Create a new workflow pipeline with nodes and edges. Pipelines are directed graphs that orchestrate multi-step agent workflows.

Available node types and their config:
- agent: { type: "agent", model?: string, systemPrompt?: string, tools?: string[], maxIterations?: number, temperature?: number, inheritContext?: boolean }
- tool: { type: "tool", toolName: string, parameters: object, timeout?: number }
- decision_gate: { type: "decision_gate", condition: string, mode: "deterministic"|"ai_evaluated", trueEdge: string, falseEdge: string }
- user_checkpoint: { type: "user_checkpoint", prompt: string, timeout?: number }
- loop: { type: "loop", maxIterations: number, exitCondition?: string, subGraphNodeIds: string[] }
- parallel: { type: "parallel", branches: [{ label: string, nodeIds: string[] }], mergeStrategy: "wait_all"|"first_completed" }
- verification: { type: "verification", verificationType: "lsp_diagnostics"|"test_runner"|"syntax_check"|"custom", command?: string, passEdge: string, failEdge: string }
- plugin: { type: "plugin", pluginId: string, pluginConfig: object }

Edges connect nodes: { sourceNodeId: string, targetNodeId: string, label?: string, condition?: string }
For decision_gate and verification nodes, edge IDs must match the trueEdge/falseEdge or passEdge/failEdge config values.`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Display name for the pipeline' },
      description: { type: 'string', description: 'What this pipeline does' },
      nodes: {
        type: 'array',
        description: 'Array of pipeline nodes. Each node needs: id (string), type (NodeType), label (string), config (NodeConfig object with type field matching node type)',
        items: { type: 'object' },
      },
      edges: {
        type: 'array',
        description: 'Array of edges connecting nodes. Each edge needs: sourceNodeId, targetNodeId, and optionally label and condition',
        items: { type: 'object' },
      },
      entryNodeId: { type: 'string', description: 'ID of the first node to execute' },
      target: { type: 'string', description: 'Where to save: "project" (default) or "global"', enum: ['project', 'global'] },
    },
    required: ['name', 'description', 'nodes', 'edges', 'entryNodeId'],
  },
  execute: async (args, ctx) => {
    if (!ctx.savePipeline) {
      return 'Error: Pipeline management is not available in this context.';
    }

    const name = args.name as string;
    const nodes = args.nodes as Array<Record<string, unknown>>;
    const edges = args.edges as Array<Record<string, unknown>>;
    const entryNodeId = args.entryNodeId as string;
    const target = (args.target as 'project' | 'global') ?? 'project';

    // Validate
    const validation = validatePipelineStructure(nodes, edges, entryNodeId);
    if (validation) return `Error: ${validation}`;

    const id = slugify(name) + '-' + Date.now().toString(36);

    const pipeline: Pipeline = {
      id,
      name,
      description: args.description as string,
      entryNodeId,
      nodes: nodes.map(n => ({
        id: n.id as string,
        type: n.type as NodeType,
        label: n.label as string,
        config: n.config as PipelineNode['config'],
        position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
        status: 'idle' as const,
      })),
      edges: edges.map((e, i) => ({
        id: (e.id as string) ?? `edge-${i}`,
        sourceNodeId: e.sourceNodeId as string,
        targetNodeId: e.targetNodeId as string,
        label: e.label as string | undefined,
        condition: e.condition as string | undefined,
      })),
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };

    await ctx.savePipeline(pipeline, target);
    return `Pipeline created successfully!\n  Name: ${name}\n  ID: ${id}\n  Nodes: ${nodes.length}\n  Edges: ${edges.length}\n  Saved to: ${target}`;
  },
};

// ── edit_pipeline ──

const editPipelineTool: ToolDefinition = {
  name: 'edit_pipeline',
  description: 'Edit an existing pipeline. You can update its name, description, nodes, edges, and/or entryNodeId. Only provide the fields you want to change — unspecified fields keep their current values. Use list_pipelines first to find the pipeline ID.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the pipeline to edit' },
      name: { type: 'string', description: 'New display name (optional)' },
      description: { type: 'string', description: 'New description (optional)' },
      nodes: {
        type: 'array',
        description: 'Replace all nodes (optional). Same format as create_pipeline.',
        items: { type: 'object' },
      },
      edges: {
        type: 'array',
        description: 'Replace all edges (optional). Same format as create_pipeline.',
        items: { type: 'object' },
      },
      entryNodeId: { type: 'string', description: 'New entry node ID (optional)' },
    },
    required: ['id'],
  },
  execute: async (args, ctx) => {
    if (!ctx.getPipeline || !ctx.savePipeline) {
      return 'Error: Pipeline management is not available in this context.';
    }

    const id = args.id as string;
    const existing = await ctx.getPipeline(id);
    if (!existing) {
      return `Error: Pipeline not found: "${id}". Use list_pipelines to see available pipelines.`;
    }

    const changes: string[] = [];

    if (args.name !== undefined) {
      existing.name = args.name as string;
      changes.push('name');
    }
    if (args.description !== undefined) {
      existing.description = args.description as string;
      changes.push('description');
    }
    if (args.nodes !== undefined) {
      const nodes = args.nodes as Array<Record<string, unknown>>;
      existing.nodes = nodes.map(n => ({
        id: n.id as string,
        type: n.type as NodeType,
        label: n.label as string,
        config: n.config as PipelineNode['config'],
        position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
        status: 'idle' as const,
      }));
      changes.push('nodes');
    }
    if (args.edges !== undefined) {
      const edges = args.edges as Array<Record<string, unknown>>;
      existing.edges = edges.map((e, i) => ({
        id: (e.id as string) ?? `edge-${i}`,
        sourceNodeId: e.sourceNodeId as string,
        targetNodeId: e.targetNodeId as string,
        label: e.label as string | undefined,
        condition: e.condition as string | undefined,
      }));
      changes.push('edges');
    }
    if (args.entryNodeId !== undefined) {
      existing.entryNodeId = args.entryNodeId as string;
      changes.push('entryNodeId');
    }

    // Validate the merged result
    const validation = validatePipelineStructure(
      existing.nodes.map(n => ({ id: n.id, type: n.type, label: n.label, config: n.config })),
      existing.edges.map(e => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })),
      existing.entryNodeId,
    );
    if (validation) return `Error: ${validation}`;

    if (existing.metadata) {
      existing.metadata.updatedAt = Date.now();
    }

    await ctx.savePipeline(existing, 'project');
    return `Pipeline "${existing.name}" updated.\n  Changed: ${changes.join(', ')}\n  Nodes: ${existing.nodes.length}\n  Edges: ${existing.edges.length}`;
  },
};

// ── list_pipelines ──

const listPipelinesTool: ToolDefinition = {
  name: 'list_pipelines',
  description: 'List all available pipelines with their IDs, names, descriptions, and sources.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (_args, ctx) => {
    if (!ctx.getAvailablePipelines) {
      return 'Error: Pipeline management is not available in this context.';
    }

    const pipelines = await ctx.getAvailablePipelines();
    if (pipelines.length === 0) {
      return 'No pipelines available.';
    }

    const lines = pipelines.map(p =>
      `- ${p.name} (id: ${p.id}, source: ${p.source})${p.description ? `\n  ${p.description}` : ''}`,
    );
    return `Available pipelines:\n${lines.join('\n')}`;
  },
};

// ── delete_pipeline ──

const deletePipelineTool: ToolDefinition = {
  name: 'delete_pipeline',
  description: 'Delete a pipeline by ID. Cannot delete built-in or default pipelines.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the pipeline to delete' },
    },
    required: ['id'],
  },
  execute: async (args, ctx) => {
    if (!ctx.deletePipeline) {
      return 'Error: Pipeline management is not available in this context.';
    }

    const id = args.id as string;
    const deleted = await ctx.deletePipeline(id);
    return deleted
      ? `Pipeline "${id}" deleted successfully.`
      : `Could not delete pipeline "${id}". It may be a built-in pipeline or does not exist.`;
  },
};

// ── Pipeline helpers ──

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function validatePipelineStructure(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
  entryNodeId: string,
): string | null {
  if (!nodes.length) return 'Pipeline must have at least one node.';

  const nodeIds = new Set(nodes.map(n => n.id as string));

  if (!nodeIds.has(entryNodeId)) {
    return `entryNodeId "${entryNodeId}" does not match any node ID.`;
  }

  for (const node of nodes) {
    if (!node.id || !node.type || !node.label) {
      return `Each node must have id, type, and label. Got: ${JSON.stringify(node)}`;
    }
    if (!VALID_NODE_TYPES.includes(node.type as NodeType)) {
      return `Invalid node type "${node.type}". Valid types: ${VALID_NODE_TYPES.join(', ')}`;
    }
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId as string)) {
      return `Edge references unknown source node "${edge.sourceNodeId}".`;
    }
    if (!nodeIds.has(edge.targetNodeId as string)) {
      return `Edge references unknown target node "${edge.targetNodeId}".`;
    }
  }

  return null;
}

// ── Helpers ──

function resolvePath(workspaceRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath;
  if (!workspaceRoot) return path.resolve(relativePath);
  return path.join(workspaceRoot, relativePath);
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

/**
 * Exact SEARCH/REPLACE match.
 */
function applySearchReplace(content: string, oldText: string, newText: string): string | null {
  const idx = content.indexOf(oldText);
  if (idx === -1) return null;
  return content.slice(0, idx) + newText + content.slice(idx + oldText.length);
}

/**
 * Whitespace-normalized match (Level 2 fallback).
 */
function applySearchReplaceNormalized(content: string, oldText: string, newText: string): string | null {
  const normalize = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').trimEnd();
  const contentLines = content.split('\n');
  const oldLines = oldText.split('\n');
  const normalizedOld = oldLines.map(normalize);

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (normalize(contentLines[i + j]) !== normalizedOld[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      const before = contentLines.slice(0, i).join('\n');
      const after = contentLines.slice(i + oldLines.length).join('\n');
      return (before ? before + '\n' : '') + newText + (after ? '\n' + after : '');
    }
  }
  return null;
}

/**
 * Levenshtein fuzzy match (Level 3 fallback).
 * Finds the closest matching block within the file.
 */
function applyFuzzyMatch(content: string, oldText: string, newText: string): string | null {
  const contentLines = content.split('\n');
  const oldLines = oldText.split('\n');
  const windowSize = oldLines.length;

  if (windowSize > contentLines.length) return null;

  let bestScore = Infinity;
  let bestStart = -1;

  for (let i = 0; i <= contentLines.length - windowSize; i++) {
    const window = contentLines.slice(i, i + windowSize).join('\n');
    const distance = levenshteinDistance(window, oldText);
    // Allow up to 20% difference
    if (distance < bestScore && distance < oldText.length * 0.2) {
      bestScore = distance;
      bestStart = i;
    }
  }

  if (bestStart === -1) return null;

  const before = contentLines.slice(0, bestStart).join('\n');
  const after = contentLines.slice(bestStart + windowSize).join('\n');
  return (before ? before + '\n' : '') + newText + (after ? '\n' + after : '');
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length > 1000 || b.length > 1000) {
    // For large strings, use a rough approximation
    const aLines = a.split('\n');
    const bLines = b.split('\n');
    let dist = 0;
    const maxLen = Math.max(aLines.length, bLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (aLines[i] !== bLines[i]) dist += Math.abs((aLines[i]?.length ?? 0) - (bLines[i]?.length ?? 0)) + 1;
    }
    return dist;
  }

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}
