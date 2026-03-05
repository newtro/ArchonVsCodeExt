import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { exec } from 'child_process';
import {
  OpenRouterClient,
  AgentLoop,
  createCoreTools,
  createExtendedTools,
  SecurityManager,
  NetworkMonitor,
} from '@archon/core';
import { CodebaseIndexer, ApiEmbeddingProvider } from '@archon/memory';
import type {
  WebviewMessage,
  ExtensionMessage,
  ModelInfo,
  ToolContext,
  ToolCall,
  ToolResult,
  StreamToken,
  ChatMessage,
  ToolDefinition,
  SecurityLevel,
  ChatSession,
  ChatSessionSummary,
  ChatSessionMessage,
  BenchmarkSource,
  BenchmarkModelEntry,
} from '@archon/core';
import { createLspTools } from '../lsp/lsp-tools';
import { DiffViewManager } from './diff-view';
import { GitCheckpoint } from './git-checkpoint';

const SYSTEM_PROMPT = `You are Archon, an expert AI coding assistant running inside VS Code. You help developers write, edit, debug, and understand code.

Rules:
- Never guess API signatures. If you are uncertain about an API's current parameters, return type, or behavior, use the lookup_docs tool to verify before writing code. Your training data may be outdated.
- Always read files before editing them to understand the current content.
- Use the edit_file tool for surgical edits to existing files (SEARCH/REPLACE).
- Use the write_file tool only for creating new files.
- Use LSP tools (go_to_definition, find_references, get_hover_info, etc.) to understand code structure.
- Use search_codebase for semantic code search when you need to find relevant code.
- Explain your reasoning concisely.
- When you have completed the task, use attempt_completion to summarize what you did.
`;

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private client: OpenRouterClient;
  private agentLoop?: AgentLoop;
  private models: ModelInfo[] = [];
  private selectedModelId = '';
  private context: vscode.ExtensionContext;
  private pendingAskUser: Map<string, (response: string) => void> = new Map();
  private securityManager: SecurityManager;
  private networkMonitor: NetworkMonitor;
  private diffViewManager: DiffViewManager;
  private gitCheckpoint: GitCheckpoint;
  private benchmarkCache: BenchmarkSource[] = [];
  private indexer: CodebaseIndexer | null = null;
  private indexingInProgress = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.client = new OpenRouterClient({ apiKey: '' });
    this.selectedModelId = context.globalState.get<string>('archon.selectedModelId', '');
    const savedLevel = context.globalState.get<string>('archon.securityLevel', 'standard') as 'permissive' | 'standard' | 'strict';
    this.securityManager = new SecurityManager({ level: savedLevel });
    this.networkMonitor = new NetworkMonitor();
    this.diffViewManager = new DiffViewManager();

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    this.gitCheckpoint = new GitCheckpoint(workspaceRoot);

    // Initialize codebase indexer if we have a workspace
    if (workspaceRoot) {
      this.indexer = new CodebaseIndexer(workspaceRoot);
    }

    // Forward network events to webview (as generic messages via postMessage)
    this.networkMonitor.onRequest((_req) => {
      // Network events forwarded directly through webview.postMessage
      // without going through the typed ExtensionMessage union
      this.view?.webview.postMessage({ type: 'networkRequest', request: _req });
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
      ],
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleWebviewMessage(msg),
      undefined,
      this.context.subscriptions,
    );

    // Start indexing after webview is ready to receive status messages
    if (this.indexer) {
      this.initializeIndexer();
    }
  }

  private async initializeIndexer(): Promise<void> {
    if (!this.indexer || this.indexingInProgress) return;
    this.indexingInProgress = true;

    try {
      // Load existing index from disk first
      const loaded = await this.indexer.loadIndex();
      if (loaded) {
        this.postMessage({
          type: 'indexingStatus',
          state: 'ready',
          chunkCount: this.indexer.getChunkCount(),
        });
      }

      // Set up embedding provider if API key is available
      const apiKey = await this.context.secrets.get('archon.openRouterApiKey');
      if (apiKey) {
        this.indexer.setEmbeddingProvider(new ApiEmbeddingProvider(apiKey));
      }

      // Run incremental indexing (only processes changed files)
      this.postMessage({ type: 'indexingStatus', state: 'indexing', filesIndexed: 0, totalFiles: 0 });

      await this.indexer.indexWorkspace((current, total, phase) => {
        // Throttle progress updates to avoid flooding the webview
        if (current % 10 === 0 || current === total) {
          this.postMessage({
            type: 'indexingStatus',
            state: 'indexing',
            filesIndexed: current,
            totalFiles: total,
          });
        }
      });

      this.postMessage({
        type: 'indexingStatus',
        state: 'ready',
        chunkCount: this.indexer.getChunkCount(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'indexingStatus', state: 'error', error: msg });
    } finally {
      this.indexingInProgress = false;
    }
  }

  private buildSystemPrompt(workspaceRoot: string): string {
    let prompt = SYSTEM_PROMPT;

    // Load CLAUDE.md from workspace root if it exists
    const claudeMdPath = path.join(workspaceRoot, 'CLAUDE.md');
    try {
      if (fs.existsSync(claudeMdPath)) {
        const claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
        prompt += `\n\n## Project Instructions (from CLAUDE.md)\n\n${claudeMd}`;
      }
    } catch {
      // Ignore read errors
    }

    return prompt;
  }

  setApiKey(key: string): void {
    this.client.setApiKey(key);
    this.loadModels();
  }

  setSecurityLevel(level: SecurityLevel): void {
    this.securityManager.setLevel(level);
    this.context.globalState.update('archon.securityLevel', level);
  }

  async newChat(): Promise<void> {
    this.agentLoop = undefined;
    // Send newChat directly through webview postMessage
    this.view?.webview.postMessage({ type: 'newChat' });
  }

  async showModelPicker(): Promise<void> {
    if (this.models.length === 0) {
      await this.loadModels();
    }

    const items = this.models.map(m => ({
      label: m.name,
      description: m.id,
      detail: m.pricing
        ? `$${m.pricing.prompt.toFixed(2)}/$${m.pricing.completion.toFixed(2)} per 1M tokens | ${(m.contextLength / 1000).toFixed(0)}K context`
        : `${(m.contextLength / 1000).toFixed(0)}K context`,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a model',
    });

    if (picked) {
      this.selectedModelId = picked.description!;
      this.context.globalState.update('archon.selectedModelId', this.selectedModelId);
      this.postMessage({ type: 'modelChanged', modelId: this.selectedModelId });
    }
  }

  private async loadModels(): Promise<void> {
    try {
      this.models = await this.client.listModels();
      this.models.sort((a, b) => a.name.localeCompare(b.name));
      this.postMessage({ type: 'modelsLoaded', models: this.models });

      if (this.selectedModelId) {
        // Verify the saved model still exists in the list
        const exists = this.models.some(m => m.id === this.selectedModelId);
        if (!exists) this.selectedModelId = '';
      }
      if (!this.selectedModelId && this.models.length > 0) {
        const sonnet = this.models.find(m => m.id.includes('claude') && m.id.includes('sonnet'));
        this.selectedModelId = sonnet?.id ?? this.models[0].id;
        this.context.globalState.update('archon.selectedModelId', this.selectedModelId);
      }
      this.postMessage({ type: 'modelChanged', modelId: this.selectedModelId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'error', error: `Failed to load models: ${msg}` });
    }
  }

  private async handleWebviewMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'sendMessage':
        await this.handleUserMessage(msg.content, msg.attachments);
        break;
      case 'cancelRequest':
        this.agentLoop?.cancel();
        break;
      case 'selectModel':
        this.selectedModelId = msg.modelId;
        this.context.globalState.update('archon.selectedModelId', msg.modelId);
        break;
      case 'loadModels':
        await this.loadModels();
        break;
      case 'newChat':
        this.agentLoop = undefined;
        break;
      case 'setApiKey':
        this.client.setApiKey(msg.key);
        await this.context.secrets.store('archon.openRouterApiKey', msg.key);
        await this.loadModels();
        break;
      case 'askUserResponse': {
        const resolver = this.pendingAskUser.get(msg.id);
        if (resolver) {
          resolver(msg.response);
          this.pendingAskUser.delete(msg.id);
        }
        break;
      }
      case 'pickFile':
        await this.handlePickFile();
        break;
      case 'searchWorkspaceFiles':
        await this.handleSearchWorkspaceFiles(msg.query);
        break;
      case 'loadSettings': {
        const secLevel = this.context.globalState.get<string>('archon.securityLevel', 'standard');
        const archEnabled = this.context.globalState.get<boolean>('archon.archiveEnabled', true);
        const pool = this.context.globalState.get<string[]>('archon.modelPool', []);
        const braveKey = await this.context.secrets.get('archon.braveApiKey');
        const webSearchEnabled = this.context.globalState.get<boolean>('archon.webSearchEnabled', true);
        this.postMessage({ type: 'settingsLoaded', securityLevel: secLevel, archiveEnabled: archEnabled, modelPool: pool, hasBraveApiKey: !!braveKey, webSearchEnabled });
        break;
      }
      case 'setBraveApiKey':
        if (msg.key.trim()) {
          await this.context.secrets.store('archon.braveApiKey', msg.key.trim());
        } else {
          await this.context.secrets.delete('archon.braveApiKey');
        }
        break;
      case 'setSecurityLevel':
        this.setSecurityLevel(msg.level as SecurityLevel);
        break;
      case 'setArchiveEnabled':
        this.context.globalState.update('archon.archiveEnabled', msg.enabled);
        break;
      case 'setWebSearchEnabled':
        this.context.globalState.update('archon.webSearchEnabled', msg.enabled);
        break;
      case 'loadChatSessions':
        this.sendChatSessionsList();
        break;
      case 'loadChatSession':
        this.loadChatSession(msg.sessionId);
        break;
      case 'saveChatSession':
        this.saveChatSession(msg.messages);
        break;
      case 'refreshBenchmarks':
        await this.fetchBenchmarks();
        break;
      case 'saveModelPool':
        this.context.globalState.update('archon.modelPool', msg.modelPool);
        this.postMessage({ type: 'modelPoolUpdated', modelPool: msg.modelPool });
        break;
      case 'addToModelPool': {
        const currentPool = this.context.globalState.get<string[]>('archon.modelPool', []);
        if (!currentPool.includes(msg.modelId)) {
          const newPool = [...currentPool, msg.modelId];
          this.context.globalState.update('archon.modelPool', newPool);
          this.postMessage({ type: 'modelPoolUpdated', modelPool: newPool });
        }
        break;
      }
      case 'reindexCodebase':
        this.initializeIndexer();
        break;
    }
  }

  private async handlePickFile(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Attach',
    });
    if (!uris || uris.length === 0) return;
    const uri = uris[0];
    try {
      const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
      const relPath = vscode.workspace.asRelativePath(uri);
      this.postMessage({ type: 'filePicked', path: relPath, content });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'error', error: `Failed to read file: ${msg}` });
    }
  }

  private async handleSearchWorkspaceFiles(query: string): Promise<void> {
    try {
      const pattern = query ? `**/*${query}*` : '**/*';
      const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 200);
      const files = uris.map(u => vscode.workspace.asRelativePath(u)).sort();
      this.postMessage({ type: 'workspaceFilesResult', files });
    } catch {
      this.postMessage({ type: 'workspaceFilesResult', files: [] });
    }
  }

  private async handleUserMessage(content: string, attachments?: import('@archon/core').Attachment[]): Promise<void> {
    if (!this.selectedModelId) {
      this.postMessage({ type: 'error', error: 'No model selected. Use "Archon: Select Model" command.' });
      return;
    }

    // Build content with attachments
    let fullContent = content;
    if (attachments && attachments.length > 0) {
      const parts: string[] = [content];
      for (const att of attachments) {
        if (att.type === 'file' && att.content) {
          parts.push(`\n\n--- Attached file: ${att.name} ---\n${att.content}`);
        } else if (att.type === 'image') {
          parts.push(`\n\n[Attached image: ${att.name}]`);
        }
      }
      fullContent = parts.join('');
    }
    content = fullContent;

    const toolContext = this.createToolContext();

    // Gather all tools: core + LSP + extended
    const coreTools = createCoreTools();
    const lspTools = createLspTools();
    const braveApiKey = await this.context.secrets.get('archon.braveApiKey');
    const workspaceRoot = toolContext.workspaceRoot;
    const extendedTools = createExtendedTools({
      showDiff: async (filePath: string, original: string, modified: string) => {
        const uri = vscode.Uri.file(
          path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath)
        );
        return this.diffViewManager.showDiff(uri, original, modified, 'AI Edit');
      },
      braveApiKey: braveApiKey ?? undefined,
      searchCodebase: this.indexer ? async (query: string, topK?: number) => {
        const results = await this.indexer!.search(query, topK);
        return results.map(r => ({
          filePath: path.relative(workspaceRoot, r.chunk.filePath),
          startLine: r.chunk.startLine,
          endLine: r.chunk.endLine,
          content: r.chunk.content,
          score: r.score,
        }));
      } : undefined,
    });

    const allTools: ToolDefinition[] = [...coreTools, ...lspTools, ...extendedTools];

    // Create git checkpoint before edit batch
    await this.gitCheckpoint.createCheckpoint('pre-archon-edit');

    const webSearchEnabled = this.context.globalState.get<boolean>('archon.webSearchEnabled', true);

    if (!this.agentLoop) {
      this.agentLoop = new AgentLoop(
        this.client,
        {
          model: this.selectedModelId,
          systemPrompt: this.buildSystemPrompt(workspaceRoot),
          tools: allTools,
          maxIterations: 25,
          webSearch: webSearchEnabled,
        },
        toolContext,
        {
          onToken: (token: StreamToken) => this.postMessage({ type: 'streamToken', token }),
          onToolCall: (tc: ToolCall) => this.postMessage({ type: 'toolCallStart', toolCall: tc }),
          onToolResult: (result: ToolResult) => this.postMessage({ type: 'toolCallResult', result }),
          onMessageComplete: (msg: ChatMessage) => this.postMessage({ type: 'messageComplete', message: msg }),
        },
      );
    }

    try {
      await this.agentLoop.run(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'error', error: msg });
    }
  }

  private createToolContext(): ToolContext {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

    return {
      workspaceRoot,
      sendMessage: (msg: string) => {
        this.postMessage({ type: 'streamToken', token: { type: 'text', content: msg } });
      },
      askUser: (prompt: string, options?: string[]) => {
        return new Promise<string>((resolve) => {
          const id = Math.random().toString(36).slice(2, 11);
          this.pendingAskUser.set(id, resolve);
          this.postMessage({ type: 'askUser', id, prompt, options });
        });
      },
      readFile: async (filePath: string) => {
        const uri = vscode.Uri.file(filePath);
        const content = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(content).toString('utf-8');
      },
      writeFile: async (filePath: string, content: string) => {
        const uri = vscode.Uri.file(filePath);
        const edit = new vscode.WorkspaceEdit();
        try {
          await vscode.workspace.fs.stat(uri);
          const doc = await vscode.workspace.openTextDocument(uri);
          const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
          edit.replace(uri, fullRange, content);
        } catch {
          edit.createFile(uri, { contents: Buffer.from(content, 'utf-8') });
        }
        await vscode.workspace.applyEdit(edit);
      },
      executeCommand: async (command: string) => {
        // Security gate for terminal commands
        const decision = this.securityManager.checkCommand(command);
        if (decision === 'block') {
          return { stdout: '', stderr: `Command blocked by security policy: ${command}`, exitCode: 1 };
        }
        if (decision === 'confirm') {
          const choice = await vscode.window.showWarningMessage(
            `Archon wants to run: ${command}`,
            { modal: false },
            'Allow',
            'Deny',
          );
          if (choice !== 'Allow') {
            return { stdout: '', stderr: 'Command denied by user', exitCode: 1 };
          }
        }

        // Record in network monitor if it's a network command
        if (/^(curl|wget|fetch)\b/.test(command)) {
          this.networkMonitor.recordRequest('CLI', command, 0, 'run_terminal');
        }

        return new Promise((resolve) => {
          exec(command, { cwd: workspaceRoot, timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exitCode: error?.code ?? 0,
            });
          });
        });
      },
      getDiagnostics: async (uriStr: string) => {
        const uri = vscode.Uri.file(uriStr);
        const diagnostics = vscode.languages.getDiagnostics(uri);
        return diagnostics.map(d => ({
          message: d.message,
          severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' as const
            : d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' as const
            : d.severity === vscode.DiagnosticSeverity.Information ? 'info' as const
            : 'hint' as const,
          range: {
            startLine: d.range.start.line,
            startCharacter: d.range.start.character,
            endLine: d.range.end.line,
            endCharacter: d.range.end.character,
          },
          source: d.source,
        }));
      },
      applyEdit: async (uriStr: string, edits: Array<{ range: { startLine: number; startCharacter: number; endLine: number; endCharacter: number }; newText: string }>) => {
        const uri = vscode.Uri.file(uriStr);
        const edit = new vscode.WorkspaceEdit();
        for (const e of edits) {
          const range = new vscode.Range(
            new vscode.Position(e.range.startLine, e.range.startCharacter),
            new vscode.Position(e.range.endLine, e.range.endCharacter),
          );
          edit.replace(uri, range, e.newText);
        }
        return vscode.workspace.applyEdit(edit);
      },
    };
  }

  // ── Chat Session Storage ──

  private getChatSessions(): ChatSession[] {
    return this.context.globalState.get<ChatSession[]>('archon.chatSessions', []);
  }

  private saveChatSessions(sessions: ChatSession[]): void {
    // Keep last 50 sessions
    const trimmed = sessions.slice(-50);
    this.context.globalState.update('archon.chatSessions', trimmed);
  }

  private sendChatSessionsList(): void {
    const sessions = this.getChatSessions();
    const summaries: ChatSessionSummary[] = sessions.map(s => ({
      id: s.id,
      title: s.title,
      timestamp: s.timestamp,
      messageCount: s.messages.length,
    }));
    // Most recent first
    summaries.reverse();
    this.postMessage({ type: 'chatSessionsLoaded', sessions: summaries });
  }

  private loadChatSession(sessionId: string): void {
    const sessions = this.getChatSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      this.agentLoop = undefined;
      this.postMessage({ type: 'chatSessionLoaded', session });
    }
  }

  private saveChatSession(messages: ChatSessionMessage[]): void {
    if (messages.length === 0) return;

    // Auto-generate title from first user message
    const firstUserMsg = messages.find(m => m.role === 'user');
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? '...' : '')
      : 'Untitled Chat';

    // Check if we're updating an existing session (same first message)
    const sessions = this.getChatSessions();
    const existingIdx = sessions.findIndex(s => s.title === title);

    const session: ChatSession = {
      id: existingIdx >= 0 ? sessions[existingIdx].id : Math.random().toString(36).slice(2, 11),
      title,
      timestamp: Date.now(),
      messages,
    };

    if (existingIdx >= 0) {
      sessions[existingIdx] = session;
    } else {
      sessions.push(session);
    }

    this.saveChatSessions(sessions);
  }

  // ── Benchmark Fetching ──

  private async fetchBenchmarks(): Promise<void> {
    const results: BenchmarkSource[] = [];
    const errors: string[] = [];

    const fetchers = [
      this.fetchSWEBench(),
      this.fetchLiveCodeBench(),
      this.fetchAiderBench(),
    ];

    const settled = await Promise.allSettled(fetchers);
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      } else if (result.status === 'rejected') {
        errors.push(String(result.reason));
      }
    }

    this.benchmarkCache = results;
    this.postMessage({ type: 'benchmarksLoaded', sources: results });
    if (errors.length > 0) {
      this.postMessage({ type: 'benchmarkError', error: `Some benchmarks failed to load: ${errors.join('; ')}` });
    }
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'Archon-VSCode-Extension' } }, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.httpGet(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode && res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
    });
  }

  private inferProvider(modelName: string): string {
    const lower = modelName.toLowerCase();
    if (lower.includes('claude') || lower.includes('anthropic')) return 'Anthropic';
    if (lower.includes('gpt') || lower.includes('openai') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4')) return 'OpenAI';
    if (lower.includes('gemini') || lower.includes('google')) return 'Google';
    if (lower.includes('grok') || lower.includes('xai')) return 'xAI';
    if (lower.includes('deepseek')) return 'DeepSeek';
    if (lower.includes('llama') || lower.includes('meta')) return 'Meta';
    if (lower.includes('qwen') || lower.includes('alibaba')) return 'Alibaba';
    if (lower.includes('mistral')) return 'Mistral';
    if (lower.includes('codestral')) return 'Mistral';
    if (lower.includes('command') || lower.includes('cohere')) return 'Cohere';
    return 'Other';
  }

  /**
   * Extract the raw model name from a SWE-Bench entry which often includes
   * agent system names like "live-SWE-agent + Claude 4.5 Opus medium (20251101)".
   * We want just "Claude 4.5 Opus".
   */
  private extractRawModelName(name: string): string {
    let raw = name;

    // Strip agent prefixes: "AgentName + ModelName" → "ModelName"
    const plusIdx = raw.indexOf('+');
    if (plusIdx > 0) {
      raw = raw.slice(plusIdx + 1).trim();
    }

    // Strip trailing parenthesized dates/versions: "(20251101)", "(v2)", etc.
    raw = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();

    // Strip trailing qualifiers like "high", "medium", "low" (reasoning effort levels)
    raw = raw.replace(/\s+(?:high|medium|low|default|latest)\s*$/i, '').trim();

    // Strip leading/trailing whitespace and dashes
    raw = raw.replace(/^[\s\-]+|[\s\-]+$/g, '');

    return raw || name; // Fall back to original if extraction yields empty
  }

  private async fetchSWEBench(): Promise<BenchmarkSource> {
    const html = await this.httpGet('https://www.swebench.com/');
    // Extract JSON from <script type="application/json" id="leaderboard-data">
    const scriptMatch = html.match(/<script[^>]*id="leaderboard-data"[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) throw new Error('Could not find SWE-Bench leaderboard data');

    const data = JSON.parse(scriptMatch[1]) as Array<{ name: string; results: Array<{ name: string; resolved: number; date?: string; cost?: number; tags?: string[] }> }>;
    // Use "Verified" split
    const verified = data.find(d => d.name === 'Verified') ?? data[0];
    if (!verified) throw new Error('No SWE-Bench Verified data found');

    const rawEntries = verified.results
      .filter(r => r.resolved > 0)
      .map(r => {
        // Try to extract org from tags
        let provider = 'Other';
        if (r.tags) {
          const orgTag = r.tags.find(t => t.startsWith('Org: '));
          if (orgTag) provider = orgTag.replace('Org: ', '');
        }
        // Extract raw model name (strip agent prefix, date suffix, etc.)
        const rawName = this.extractRawModelName(r.name);
        if (provider === 'Other') provider = this.inferProvider(rawName);
        return {
          model: rawName,
          provider,
          score: r.resolved,
          cost: r.cost,
          date: r.date,
        };
      });

    // Aggregate by raw model name — keep the best score per model
    const bestPerModel = new Map<string, BenchmarkModelEntry>();
    for (const entry of rawEntries) {
      const key = entry.model.toLowerCase().replace(/[^a-z0-9]/g, '');
      const existing = bestPerModel.get(key);
      if (!existing || entry.score > existing.score) {
        bestPerModel.set(key, entry);
      }
    }

    const entries = Array.from(bestPerModel.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    return {
      name: 'SWE-Bench Verified',
      url: 'https://www.swebench.com/',
      lastFetched: Date.now(),
      entries,
    };
  }

  private async fetchLiveCodeBench(): Promise<BenchmarkSource> {
    const raw = await this.httpGet('https://livecodebench.github.io/performances_generation.json');
    const data = JSON.parse(raw) as { performances: Array<{ model: string; 'pass@1': number; date: number; difficulty: string }> };

    // Only use recent problems (last 6 months) to get current model rankings.
    // The dataset contains problems dating back to 2023 — averaging over all of them
    // inflates scores for older models tested on easier early problems.
    const sixMonthsAgo = Date.now() - (6 * 30 * 24 * 60 * 60 * 1000);
    const recentPerformances = data.performances.filter(p => p.date >= sixMonthsAgo);

    // Fall back to last 12 months if 6 months yields too few results
    const performances = recentPerformances.length >= 100
      ? recentPerformances
      : data.performances.filter(p => p.date >= Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));

    // Aggregate pass@1 per model
    const modelScores = new Map<string, { total: number; count: number }>();
    for (const p of performances) {
      const existing = modelScores.get(p.model) ?? { total: 0, count: 0 };
      existing.total += p['pass@1'];
      existing.count += 1;
      modelScores.set(p.model, existing);
    }

    const entries: BenchmarkModelEntry[] = Array.from(modelScores.entries())
      .map(([model, { total, count }]) => ({
        model,
        provider: this.inferProvider(model),
        score: Math.round((total / count) * 10) / 10,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    return {
      name: 'LiveCodeBench',
      url: 'https://livecodebench.github.io/',
      lastFetched: Date.now(),
      entries,
    };
  }

  /**
   * Convert Aider API-style model IDs to human-readable names.
   * e.g. "claude-3-5-sonnet-20241022" → "Claude 3.5 Sonnet"
   */
  private cleanAiderModelName(raw: string): string {
    // Strip provider prefixes like "openrouter/", "anthropic/", etc.
    let name = raw.replace(/^[a-z]+\//, '');

    // Strip date suffixes like "-20241022", "-20250301"
    name = name.replace(/-\d{8}$/, '');

    // Common model name mappings
    const mappings: [RegExp, string][] = [
      [/^claude-(\d+)-(\d+)-opus$/i, 'Claude $1.$2 Opus'],
      [/^claude-(\d+)-(\d+)-sonnet$/i, 'Claude $1.$2 Sonnet'],
      [/^claude-(\d+)-(\d+)-haiku$/i, 'Claude $1.$2 Haiku'],
      [/^claude-(\d+)-opus$/i, 'Claude $1 Opus'],
      [/^claude-(\d+)-sonnet$/i, 'Claude $1 Sonnet'],
      [/^claude-(\d+)-haiku$/i, 'Claude $1 Haiku'],
      [/^gpt-(\d+)o$/i, 'GPT-$1o'],
      [/^gpt-(\d+)o-mini$/i, 'GPT-$1o Mini'],
      [/^gpt-(\d+)-turbo$/i, 'GPT-$1 Turbo'],
      [/^o(\d+)-mini$/i, 'O$1 Mini'],
      [/^o(\d+)$/i, 'O$1'],
      [/^gemini-(\d+)\.(\d+)-(.+)$/i, 'Gemini $1.$2 $3'],
      [/^gemini-(.+)$/i, 'Gemini $1'],
      [/^deepseek-(.+)$/i, 'DeepSeek $1'],
      [/^grok-(.+)$/i, 'Grok $1'],
      [/^qwen-(.+)$/i, 'Qwen $1'],
      [/^mistral-(.+)$/i, 'Mistral $1'],
      [/^codestral-(.+)$/i, 'Codestral $1'],
      [/^llama-(.+)$/i, 'Llama $1'],
    ];

    for (const [pattern, replacement] of mappings) {
      if (pattern.test(name)) {
        name = name.replace(pattern, replacement);
        // Capitalize first letter of each word after model family
        return name.replace(/\b\w/g, c => c.toUpperCase()).replace(/Gpt/g, 'GPT');
      }
    }

    // Fallback: replace dashes with spaces, title-case
    return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  private async fetchAiderBench(): Promise<BenchmarkSource> {
    const raw = await this.httpGet('https://raw.githubusercontent.com/aider-ai/aider/main/aider/website/_data/edit_leaderboard.yml');

    // Simple YAML array parser — each entry starts with "- " at top level
    const entries: BenchmarkModelEntry[] = [];
    const blocks = raw.split(/\n- /).map((b, i) => i === 0 ? b.replace(/^- /, '') : b);

    for (const block of blocks) {
      const lines = block.split('\n');
      const fields: Record<string, string> = {};
      for (const line of lines) {
        const match = line.match(/^\s*(\w[\w_]*):\s*(.+)$/);
        if (match) fields[match[1]] = match[2].trim();
      }
      if (fields['model'] && fields['pass_rate_1']) {
        const modelName = this.cleanAiderModelName(fields['model'].replace(/^["']|["']$/g, ''));
        entries.push({
          model: modelName,
          provider: this.inferProvider(modelName),
          score: parseFloat(fields['pass_rate_1']),
          secondaryScore: fields['pass_rate_2'] ? parseFloat(fields['pass_rate_2']) : undefined,
          cost: fields['total_cost'] ? parseFloat(fields['total_cost']) : undefined,
          date: fields['date']?.replace(/^["']|["']$/g, ''),
        });
      }
    }

    // Deduplicate: keep highest score per model
    const bestPerModel = new Map<string, BenchmarkModelEntry>();
    for (const entry of entries) {
      const existing = bestPerModel.get(entry.model);
      if (!existing || entry.score > existing.score) {
        bestPerModel.set(entry.model, entry);
      }
    }

    const sorted = Array.from(bestPerModel.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    return {
      name: 'Aider Code Editing',
      url: 'https://aider.chat/docs/leaderboards/',
      lastFetched: Date.now(),
      entries: sorted,
    };
  }

  private postMessage(msg: ExtensionMessage): void {
    this.view?.webview.postMessage(msg);
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const distPath = path.join(this.context.extensionPath, 'dist');
    const scriptPath = path.join(distPath, 'assets', 'index.js');
    const stylePath = path.join(distPath, 'assets', 'index.css');
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(scriptPath));

    let styleTag = '';
    if (fs.existsSync(stylePath)) {
      const styleUri = webview.asWebviewUri(vscode.Uri.file(stylePath));
      styleTag = `<link rel="stylesheet" href="${styleUri}">`;
    }

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src data: ${webview.cspSource}; connect-src https://www.swebench.com https://livecodebench.github.io https://raw.githubusercontent.com;">
  ${styleTag}
  <title>Archon</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
