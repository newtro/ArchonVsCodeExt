/**
 * Extended tools — web_search, web_fetch, lookup_docs, search_codebase,
 * search_history, spawn_agent, diff_view, tool_search.
 */

import type { ToolDefinition } from '../types';
import type { McpRegistry } from '../mcp/mcp-registry';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Create extended tools that require external dependencies to be injected.
 */
export function createExtendedTools(deps: {
  searchCodebase?: (query: string, topK?: number) => Promise<Array<{ filePath: string; startLine: number; endLine: number; content: string; score: number }>>;
  searchHistory?: (query: string, topK?: number) => Promise<Array<{ type: string; content: string; timestamp: number; score: number }>>;
  spawnAgent?: (systemPrompt: string, task: string, model?: string) => Promise<string>;
  showDiff?: (path: string, original: string, modified: string) => Promise<boolean>;
  braveApiKey?: string;
  mcpRegistry?: McpRegistry;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    createWebSearchTool(deps.braveApiKey),
    webFetchTool,
    createLookupDocsTool(deps.braveApiKey),
  ];

  if (deps.searchCodebase) {
    tools.push(createSearchCodebaseTool(deps.searchCodebase));
  }
  if (deps.searchHistory) {
    tools.push(createSearchHistoryTool(deps.searchHistory));
  }
  if (deps.spawnAgent) {
    tools.push(createSpawnAgentTool(deps.spawnAgent));
  }
  if (deps.showDiff) {
    tools.push(createDiffViewTool(deps.showDiff));
  }

  tools.push(createToolSearchTool(deps.mcpRegistry));

  return tools;
}

// ── HTTP helper ──

function httpGet(url: string, timeoutMs = 10000, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Archon/1.0 (VS Code Extension)',
        'Accept': 'text/html,application/json,*/*',
        ...headers,
      },
    };
    const req = mod.get(options, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }

      const chunks: Buffer[] = [];
      let totalSize = 0;
      const maxSize = 512 * 1024; // 512KB max

      res.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize <= maxSize) {
          chunks.push(chunk);
        }
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

// ── web_search ──

/** Search using Brave Search API (requires API key). */
async function braveSearch(query: string, numResults: number, apiKey: string): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${numResults}`;
  const response = await httpGet(url, 10000, {
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': apiKey,
  });

  if (response.status >= 400) {
    throw new Error(`Brave Search API returned HTTP ${response.status}`);
  }

  const data = JSON.parse(response.body) as {
    web?: { results?: Array<{ title?: string; description?: string; url?: string }> };
  };

  const results = data.web?.results ?? [];
  if (results.length === 0) {
    return '';
  }

  return results
    .map((r, i) => `${i + 1}. **${r.title ?? 'Untitled'}**\n${r.description ?? ''}\nURL: ${r.url ?? ''}`)
    .join('\n\n');
}

/** Search using DuckDuckGo HTML (no API key needed). */
async function duckDuckGoSearch(query: string, numResults: number): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await httpGet(url, 10000);

  if (!response.body) {
    return '';
  }

  // Parse DuckDuckGo HTML results
  const results: Array<{ title: string; snippet: string; url: string }> = [];

  // Match result blocks: each result has a class="result__a" link and class="result__snippet"
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(response.body)) !== null) {
    const rawUrl = linkMatch[1];
    const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    // DuckDuckGo wraps URLs in a redirect; extract the actual URL
    const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
    const actualUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : rawUrl;
    links.push({ url: actualUrl, title });
  }

  const snippets: string[] = [];
  let snippetMatch;
  while ((snippetMatch = snippetRegex.exec(response.body)) !== null) {
    snippets.push(snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim());
  }

  for (let i = 0; i < Math.min(links.length, numResults); i++) {
    results.push({
      title: links[i].title,
      snippet: snippets[i] ?? '',
      url: links[i].url,
    });
  }

  if (results.length === 0) {
    return '';
  }

  return results
    .map((r, i) => `${i + 1}. **${r.title}**\n${r.snippet}\nURL: ${r.url}`)
    .join('\n\n');
}

function createWebSearchTool(braveApiKey?: string): ToolDefinition {
  return {
    name: 'web_search',
    description: 'Search the web for current information. Returns search result snippets with URLs.' +
      (braveApiKey ? ' (Using Brave Search)' : ' (Using DuckDuckGo)'),
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        num_results: { type: 'number', description: 'Number of results (default 5, max 10)' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = args.query as string;
      const numResults = Math.min((args.num_results as number) ?? 5, 10);

      try {
        // Try Brave Search first if API key is available
        if (braveApiKey) {
          try {
            const result = await braveSearch(query, numResults, braveApiKey);
            if (result) return result;
          } catch {
            // Fall through to DuckDuckGo
          }
        }

        // DuckDuckGo HTML fallback (or default)
        const result = await duckDuckGoSearch(query, numResults);
        if (result) return result;

        return `No results found for "${query}". Try a different query.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Web search failed: ${msg}. Try a different query.`;
      }
    },
  };
}

// ── web_fetch ──

const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch and parse content from a URL. Returns the text content of the page.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      max_length: { type: 'number', description: 'Max characters to return (default 5000)' },
    },
    required: ['url'],
  },
  execute: async (args) => {
    let url = args.url as string;
    const maxLength = (args.max_length as number) ?? 5000;

    // Ensure URL has a protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      const response = await httpGet(url);

      if (response.status >= 400) {
        return `Failed to fetch ${url}: HTTP ${response.status}`;
      }

      // Strip HTML tags for readability
      let content = response.body
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

      if (content.length > maxLength) {
        content = content.slice(0, maxLength) + '\n... (truncated)';
      }

      return content || `No content at ${url}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Failed to fetch ${url}: ${msg}`;
    }
  },
};

// ── lookup_docs ──

function createLookupDocsTool(braveApiKey?: string): ToolDefinition {
  return {
    name: 'lookup_docs',
    description: 'Look up current API documentation for a library. Use this before writing code with any library API you are not 100% certain about. Your training data may be outdated.',
    parameters: {
      type: 'object',
      properties: {
        library: { type: 'string', description: 'Library/package name (e.g., "react", "@tanstack/react-query")' },
        query: { type: 'string', description: 'Specific API or concept to look up (e.g., "useQuery hook parameters")' },
      },
      required: ['library', 'query'],
    },
    execute: async (args, ctx) => {
      const library = args.library as string;
      const query = args.query as string;
      const searchTerm = query.split(' ')[0];

      let output = '';

      // Try to find types in node_modules (cross-platform)
      if (ctx.workspaceRoot) {
        const typesDir = path.join(ctx.workspaceRoot, 'node_modules', '@types', library);
        const libDir = path.join(ctx.workspaceRoot, 'node_modules', library);

        const searchDirs = [typesDir, libDir].filter(d => fs.existsSync(d));

        for (const dir of searchDirs) {
          const dtsFiles = findDtsFiles(dir, searchTerm, 3);
          for (const file of dtsFiles) {
            try {
              const content = fs.readFileSync(file, 'utf-8');
              const lines = content.split('\n');
              const matchIdx = lines.findIndex(l => l.includes(searchTerm));
              if (matchIdx !== -1) {
                const start = Math.max(0, matchIdx - 10);
                const end = Math.min(lines.length, matchIdx + 50);
                const relFile = path.relative(ctx.workspaceRoot, file);
                output += `\n## From ${relFile}:\n\`\`\`typescript\n${lines.slice(start, end).join('\n')}\n\`\`\`\n`;
              }
            } catch {
              // Skip unreadable files
            }
          }
          if (output) break;
        }
      }

      // Try web search as fallback using the same providers as web_search
      if (!output) {
        try {
          const searchQuery = `${library} ${query} API documentation`;
          if (braveApiKey) {
            try {
              const result = await braveSearch(searchQuery, 3, braveApiKey);
              if (result) output = result;
            } catch {
              // Fall through to DuckDuckGo
            }
          }
          if (!output) {
            const result = await duckDuckGoSearch(searchQuery, 3);
            if (result) output = result;
          }
        } catch {
          // Skip web search failure
        }
      }

      return output || `No documentation found for ${library} "${query}". Try a web_search with more specific terms.`;
    },
  };
}

function findDtsFiles(dir: string, searchTerm: string, maxFiles: number): string[] {
  const results: string[] = [];
  findDtsRecursive(dir, searchTerm, results, maxFiles, 0);
  return results;
}

function findDtsRecursive(dir: string, searchTerm: string, results: string[], maxFiles: number, depth: number): void {
  if (results.length >= maxFiles || depth > 3) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxFiles) return;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() && entry.name !== 'node_modules') {
      findDtsRecursive(fullPath, searchTerm, results, maxFiles, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.includes(searchTerm)) {
          results.push(fullPath);
        }
      } catch {
        // Skip
      }
    }
  }
}

// ── search_codebase ──

function createSearchCodebaseTool(
  searchFn: (query: string, topK?: number) => Promise<Array<{ filePath: string; startLine: number; endLine: number; content: string; score: number }>>,
): ToolDefinition {
  return {
    name: 'search_codebase',
    description: 'Semantic search over the codebase using RAG. Returns relevant code snippets with file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language query describing what you are looking for' },
        top_k: { type: 'number', description: 'Number of results to return (default 10)' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const results = await searchFn(args.query as string, args.top_k as number);

      if (results.length === 0) {
        return 'No relevant code found. Try search_files for exact text matches.';
      }

      return results.map((r, i) => {
        // Truncate long chunks to keep results concise
        const lines = r.content.split('\n');
        const truncated = lines.length > 20 ? lines.slice(0, 20).join('\n') + '\n// ... (truncated)' : r.content;
        return `### Result ${i + 1} (score: ${r.score.toFixed(2)})\n**${r.filePath}** [lines ${r.startLine}-${r.endLine}]\n\`\`\`\n${truncated}\n\`\`\``;
      }).join('\n\n');
    },
  };
}

// ── search_history ──

function createSearchHistoryTool(
  searchFn: (query: string, topK?: number) => Promise<Array<{ type: string; content: string; timestamp: number; score: number }>>,
): ToolDefinition {
  return {
    name: 'search_history',
    description: 'Search past interactions and conversations semantically. Use when the user references something discussed before.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for in past interactions' },
        top_k: { type: 'number', description: 'Number of results (default 5)' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const results = await searchFn(args.query as string, args.top_k as number);

      if (results.length === 0) {
        return 'No relevant past interactions found.';
      }

      return results.map((r, i) => {
        const date = new Date(r.timestamp).toLocaleString();
        return `### ${i + 1}. [${r.type}] ${date} (score: ${r.score.toFixed(2)})\n${r.content.slice(0, 500)}`;
      }).join('\n\n');
    },
  };
}

// ── spawn_agent ──

function createSpawnAgentTool(
  spawnFn: (systemPrompt: string, task: string, model?: string) => Promise<string>,
): ToolDefinition {
  return {
    name: 'spawn_agent',
    description: 'Launch a sub-agent to handle a specific sub-task. The sub-agent runs independently and returns its result.',
    parameters: {
      type: 'object',
      properties: {
        system_prompt: { type: 'string', description: 'System prompt for the sub-agent' },
        task: { type: 'string', description: 'The task for the sub-agent to perform' },
        model: { type: 'string', description: 'Optional model ID override' },
      },
      required: ['system_prompt', 'task'],
    },
    execute: async (args) => {
      return spawnFn(
        args.system_prompt as string,
        args.task as string,
        args.model as string | undefined,
      );
    },
  };
}

// ── diff_view ──

function createDiffViewTool(
  showDiffFn: (path: string, original: string, modified: string) => Promise<boolean>,
): ToolDefinition {
  return {
    name: 'diff_view',
    description: 'Show a diff view to the user for a proposed file change. Returns whether the user approved.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        original: { type: 'string', description: 'Original file content' },
        modified: { type: 'string', description: 'Modified file content' },
      },
      required: ['path', 'original', 'modified'],
    },
    execute: async (args) => {
      const approved = await showDiffFn(
        args.path as string,
        args.original as string,
        args.modified as string,
      );
      return approved ? 'User approved the changes.' : 'User rejected the changes.';
    },
  };
}

// ── tool_search ──

const CORE_SUGGESTIONS = [
  { name: 'read_file', desc: 'Read file contents' },
  { name: 'write_file', desc: 'Create or overwrite files' },
  { name: 'edit_file', desc: 'SEARCH/REPLACE edits on existing files' },
  { name: 'search_files', desc: 'Regex/text search across codebase' },
  { name: 'find_files', desc: 'Glob pattern file discovery' },
  { name: 'list_directory', desc: 'List directory contents' },
  { name: 'run_terminal', desc: 'Execute shell commands' },
  { name: 'web_search', desc: 'Search the web' },
  { name: 'web_fetch', desc: 'Fetch URL content' },
  { name: 'lookup_docs', desc: 'Look up library API docs' },
  { name: 'search_codebase', desc: 'Semantic search over code (RAG)' },
  { name: 'search_history', desc: 'Search past interactions' },
  { name: 'go_to_definition', desc: 'Jump to symbol definition' },
  { name: 'find_references', desc: 'Find all usages of a symbol' },
  { name: 'get_hover_info', desc: 'Get type info and docs for a symbol' },
  { name: 'get_workspace_symbols', desc: 'Search symbols by name' },
  { name: 'get_document_symbols', desc: 'Get file outline/structure' },
  { name: 'get_code_actions', desc: 'Get quick fixes and refactorings' },
  { name: 'get_diagnostics', desc: 'Get compiler errors and warnings' },
  { name: 'spawn_agent', desc: 'Launch a sub-agent for a sub-task' },
  { name: 'diff_view', desc: 'Show diff for user approval' },
  { name: 'ask_user', desc: 'Ask the user a question' },
  { name: 'attempt_completion', desc: 'Signal task completion' },
];

function createToolSearchTool(mcpRegistry?: McpRegistry): ToolDefinition {
  return {
    name: 'tool_search',
    description: 'Search for available tools (core + MCP) by natural language description. Use when you need functionality beyond the core tools. Returns matching tool definitions that you can then call directly.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language description of the tool capability you need' },
        limit: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = (args.query as string).toLowerCase();
      const limit = (args.limit as number) ?? 5;
      const parts: string[] = [];

      // Search core tools
      const coreMatches = CORE_SUGGESTIONS
        .filter(s => s.name.includes(query) || s.desc.toLowerCase().includes(query))
        .slice(0, limit);

      if (coreMatches.length > 0) {
        parts.push('**Core tools:**');
        for (const m of coreMatches) {
          parts.push(`- **${m.name}**: ${m.desc}`);
        }
      }

      // Search MCP tools via registry
      if (mcpRegistry) {
        const mcpResults = mcpRegistry.searchTools(args.query as string, limit);
        if (mcpResults.length > 0) {
          // Activate discovered tools so they're available on subsequent turns
          mcpRegistry.activateTools(mcpResults.map(t => t.name));

          parts.push('');
          parts.push('**MCP tools (now available to call):**');
          for (const tool of mcpResults) {
            const params = Object.keys(tool.parameters.properties).join(', ');
            parts.push(`- **${tool.name}**: ${tool.description}${params ? ` (params: ${params})` : ''}`);
          }

          const counts = mcpRegistry.getToolCount();
          parts.push(`\n_${counts.total} MCP tools available, ${counts.loaded} loaded, ${counts.deferred} deferred_`);
        }
      }

      if (parts.length === 0) {
        return `No tools found matching "${args.query}". Available core tools: ${CORE_SUGGESTIONS.map(s => s.name).join(', ')}`;
      }

      return parts.join('\n');
    },
  };
}
