/**
 * Claude Code CLI provider.
 *
 * Spawns the `claude` CLI as a subprocess with `--output-format stream-json`.
 * Claude Code runs its own agent loop with its own tools.
 * Our extension observes the NDJSON stream and maps events to the common interface.
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import * as path from 'path';
import { detectClaudeCli } from './claude-cli-detector';
import type { ModelInfo, ChatMessage, StreamToken, ToolCall, ToolResult } from '../types';
import type { LLMProvider, ProviderId, ExecutorConfig, Executor, ExecutorCallbacks } from './types';

// ── Claude CLI models ──

const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    description: 'Fast, intelligent model for everyday tasks',
    contextLength: 200000,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    description: 'Most capable model for complex tasks',
    contextLength: 200000,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    description: 'Fastest, most compact model',
    contextLength: 200000,
    supportsTools: true,
    supportsStreaming: true,
  },
];

// Model alias mapping: short names → full IDs
const MODEL_ALIASES: Record<string, string> = {
  'sonnet': 'claude-sonnet-4-6',
  'opus': 'claude-opus-4-6',
  'haiku': 'claude-haiku-4-5',
};

// ── Permission level → CLI flags ──

type SecurityLevel = 'yolo' | 'permissive' | 'standard' | 'strict';

function buildPermissionFlags(level?: SecurityLevel): string[] {
  switch (level) {
    case 'strict':
      return ['--allowedTools', 'Read,Glob,Grep,Bash(git status *),Bash(git log *),Bash(git diff *)'];
    case 'yolo':
    case 'permissive':
      return ['--dangerously-skip-permissions'];
    case 'standard':
    default:
      // Default Claude Code behavior — no extra flags
      return [];
  }
}

// ── Provider ──

export interface ClaudeCliConfig {
  cliPath?: string;
}

export class ClaudeCliProvider implements LLMProvider {
  readonly id: ProviderId = 'claude-cli';
  readonly name = 'Claude Code CLI';
  private cliPath: string;

  constructor(config?: ClaudeCliConfig) {
    this.cliPath = config?.cliPath ?? 'claude';
  }

  setCliPath(path: string): void {
    this.cliPath = path;
  }

  getCliPath(): string {
    return this.cliPath;
  }

  async isAvailable(): Promise<boolean> {
    const status = await detectClaudeCli(this.cliPath);
    return status.installed && status.authenticated;
  }

  async getStatus() {
    return detectClaudeCli(this.cliPath);
  }

  async getModels(): Promise<ModelInfo[]> {
    // Claude CLI models are fixed — no API call needed
    return CLAUDE_MODELS;
  }

  createExecutor(config: ExecutorConfig): Executor {
    return new ClaudeCliExecutor(this.cliPath, config);
  }
}

// ── Executor ──

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

class ClaudeCliExecutor implements Executor {
  private cliPath: string;
  private config: ExecutorConfig;
  private process: ChildProcess | null = null;
  private sessionId: string | null = null;
  private aborted = false;
  private activeToolId: string | undefined;
  private activeToolIndex: number | undefined;

  constructor(cliPath: string, config: ExecutorConfig) {
    this.cliPath = cliPath;
    this.config = config;
    // Restore session ID from a previous run for --resume support
    if (config.sessionId) {
      this.sessionId = config.sessionId;
    }
  }

  async run(userMessage: string, callbacks: ExecutorCallbacks): Promise<void> {
    this.aborted = false;

    const args = this.buildArgs();
    const cwd = this.config.workspaceRoot || process.cwd();

    // Resolve CLI path to avoid needing shell: true on Windows.
    // shell: true triggers cmd.exe which has an ~8191 char command line limit.
    // Without shell, Node uses CreateProcessW directly (32K limit per arg).
    const resolvedCli = this.resolveCliPath();

    this.process = spawn(resolvedCli, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let buffer = '';
    let fullText = '';
    const currentToolCalls = new Map<string, { name: string; inputJson: string }>();
    const emittedToolIds = new Set<string>();

    const appendText = (text: string) => { fullText += text; };
    const getAndResetText = () => {
      const text = fullText;
      fullText = '';
      return text;
    };

    // Parse NDJSON from stdout
    this.process.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const msg = JSON.parse(trimmed);
          this.handleStreamMessage(msg, callbacks, fullText, currentToolCalls, emittedToolIds, appendText, getAndResetText);
        } catch {
          // Skip unparseable lines
        }
      }
    });

    // Collect stderr for error reporting
    let stderr = '';
    this.process.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    // Pipe user message via stdin instead of -p arg to avoid command line length limits
    if (this.process.stdin) {
      this.process.stdin.write(userMessage);
      this.process.stdin.end();
    }

    // Wait for process to exit
    return new Promise<void>((resolve, reject) => {
      this.process?.on('close', (code) => {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const msg = JSON.parse(buffer.trim());
            this.handleStreamMessage(msg, callbacks, fullText, currentToolCalls, emittedToolIds, appendText, getAndResetText);
          } catch {
            // ignore
          }
        }

        this.process = null;

        if (this.aborted) {
          resolve();
          return;
        }

        if (code !== 0 && code !== null) {
          const errorMsg = stderr.trim() || `Claude CLI exited with code ${code}`;
          callbacks.onToken({ type: 'error', error: errorMsg }, undefined);
          reject(new Error(errorMsg));
          return;
        }

        // Finalize any remaining text from the last turn
        if (fullText) {
          const assistantMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: fullText,
            timestamp: Date.now(),
          };
          callbacks.onMessageComplete(assistantMsg, undefined);
        }

        callbacks.onToken({ type: 'done' }, undefined);
        resolve();
      });

      this.process?.on('error', (err) => {
        this.process = null;
        const errorMsg = `Failed to start Claude CLI: ${err.message}`;
        callbacks.onToken({ type: 'error', error: errorMsg }, undefined);
        reject(new Error(errorMsg));
      });
    });
  }

  abort(): void {
    this.aborted = true;
    if (this.process) {
      // Try graceful shutdown first
      this.process.kill('SIGTERM');
      // Force kill after 3 seconds
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
          this.process = null;
        }
      }, 3000);
    }
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Resolve the CLI path to an absolute path so we can spawn without shell: true.
   * On Windows, shell: true uses cmd.exe which has an ~8191 char command line limit.
   * Without shell, Node uses CreateProcessW directly (32K limit).
   */
  private resolveCliPath(): string {
    // If already absolute, use as-is
    if (path.isAbsolute(this.cliPath)) {
      return this.cliPath;
    }

    // Try to resolve via PATH using `which`/`where`
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const result = execSync(`${cmd} ${this.cliPath}`, { encoding: 'utf-8', timeout: 5000 }).trim();
      // `where` on Windows may return multiple lines; take the first
      const firstLine = result.split('\n')[0].trim();
      if (firstLine) return firstLine;
    } catch {
      // Fall through to using the path as-is
    }

    return this.cliPath;
  }

  private buildArgs(): string[] {
    // User message is piped via stdin; -p enables non-interactive print mode
    const args: string[] = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    // Model selection
    const modelId = this.config.model;
    const alias = Object.entries(MODEL_ALIASES).find(([, id]) => id === modelId)?.[0];
    if (alias) {
      args.push('--model', alias);
    } else if (modelId) {
      args.push('--model', modelId);
    }

    // Session resume
    if (this.sessionId) {
      args.push('--resume', this.sessionId);
    }

    // Permission flags
    args.push(...buildPermissionFlags(this.config.securityLevel as SecurityLevel));

    // Working directory
    if (this.config.workspaceRoot) {
      args.push('--add-dir', this.config.workspaceRoot);
    }

    // System prompt customization
    // Safe to pass as arg since we avoid shell: true (no 8191 char cmd.exe limit)
    if (this.config.systemPrompt) {
      args.push('--append-system-prompt', this.config.systemPrompt);
    }

    // MCP config passthrough
    if (this.config.mcpConfigPath) {
      args.push('--mcp-config', this.config.mcpConfigPath);
    }

    return args;
  }

  /**
   * Handle a single parsed NDJSON message from the Claude CLI stream.
   *
   * The stream-json format emits several message types:
   * - stream_event: Raw Claude API streaming events (text deltas, tool use, etc.)
   * - assistant: Complete assistant message with content blocks
   * - result: Final result message with session_id and usage
   */
  private handleStreamMessage(
    msg: Record<string, unknown>,
    callbacks: ExecutorCallbacks,
    _fullText: string,
    currentToolCalls: Map<string, { name: string; inputJson: string }>,
    emittedToolIds: Set<string>,
    appendText: (text: string) => void,
    getAndResetText: () => string,
  ): void {
    const msgType = msg.type as string;

    // Extract session_id from any message that has it
    if (msg.session_id && typeof msg.session_id === 'string') {
      this.sessionId = msg.session_id;
    }

    switch (msgType) {
      case 'stream_event':
        this.handleStreamEvent(msg.event as Record<string, unknown>, callbacks, currentToolCalls, emittedToolIds, appendText, getAndResetText);
        break;

      case 'assistant': {
        // Complete assistant message — may contain tool_use blocks we haven't seen via streaming
        const content = msg.content as Array<Record<string, unknown>> | undefined;
        if (content && Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              const toolId = block.id as string;
              const toolName = block.name as string;
              const toolInput = block.input as Record<string, unknown>;

              // Only emit if we haven't already emitted this tool via stream events
              if (!emittedToolIds.has(toolId)) {
                const tc: ToolCall = { id: toolId, name: toolName, arguments: toolInput };
                callbacks.onToolCall(tc, undefined);
                emittedToolIds.add(toolId);

                // Synthetic result for non-streamed tool calls
                const syntheticResult: ToolResult = {
                  toolCallId: toolId,
                  content: '',
                  isError: false,
                };
                callbacks.onToolResult(syntheticResult, undefined);
              }
              currentToolCalls.delete(toolId);
            }
          }
        }
        break;
      }

      case 'user': {
        // User messages contain tool_result blocks from Claude Code's internal tool execution
        const content = msg.content as Array<Record<string, unknown>> | undefined;
        if (content && Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              const toolUseId = block.tool_use_id as string;
              const resultContent = block.content as string | Array<Record<string, unknown>>;
              let output = '';
              if (typeof resultContent === 'string') {
                output = resultContent;
              } else if (Array.isArray(resultContent)) {
                output = resultContent
                  .filter(c => c.type === 'text')
                  .map(c => c.text as string)
                  .join('\n');
              }
              const result: ToolResult = {
                toolCallId: toolUseId,
                content: output,
                isError: (block.is_error as boolean) ?? false,
              };
              callbacks.onToolResult(result, undefined);
            }
          }
        }
        break;
      }

      case 'result': {
        // Final result — contains session_id and usage stats
        if (msg.session_id) {
          this.sessionId = msg.session_id as string;
        }
        break;
      }
    }
  }

  /**
   * Handle a raw Claude API stream event.
   */
  private handleStreamEvent(
    event: Record<string, unknown>,
    callbacks: ExecutorCallbacks,
    currentToolCalls: Map<string, { name: string; inputJson: string }>,
    emittedToolIds: Set<string>,
    appendText: (text: string) => void,
    getAndResetText: () => string,
  ): void {
    if (!event) return;
    const eventType = event.type as string;

    switch (eventType) {
      case 'content_block_start': {
        const block = event.content_block as Record<string, unknown>;
        if (block?.type === 'tool_use') {
          const toolId = block.id as string;
          const toolName = block.name as string;
          currentToolCalls.set(toolId, { name: toolName, inputJson: '' });
          // Track which tool is currently being built (by content block index)
          this.activeToolIndex = event.index as number | undefined;
          this.activeToolId = toolId;
          callbacks.onToken({ type: 'tool_call_start', toolCall: { id: toolId, name: toolName } }, undefined);
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta as Record<string, unknown>;
        if (!delta) break;

        if (delta.type === 'text_delta') {
          const text = delta.text as string;
          if (text) {
            appendText(text);
            callbacks.onToken({ type: 'text', content: text }, undefined);
          }
        }

        if (delta.type === 'input_json_delta') {
          const partialJson = delta.partial_json as string;
          if (partialJson && this.activeToolId) {
            const tc = currentToolCalls.get(this.activeToolId);
            if (tc) {
              tc.inputJson += partialJson;
            }
            callbacks.onToken({ type: 'tool_call_args', content: partialJson }, undefined);
          }
        }
        break;
      }

      case 'content_block_stop': {
        // Emit the completed tool call for the active tool
        if (this.activeToolId) {
          const tc = currentToolCalls.get(this.activeToolId);
          if (tc && tc.inputJson) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(tc.inputJson);
            } catch {
              // partial/malformed JSON
            }
            const toolCall: ToolCall = { id: this.activeToolId, name: tc.name, arguments: parsedArgs };
            callbacks.onToken({ type: 'tool_call_end', toolCall }, undefined);
            callbacks.onToolCall(toolCall, undefined);
            emittedToolIds.add(this.activeToolId);

            // Claude CLI executes tools internally — emit a synthetic result
            // so the UI marks the tool call as completed (not stuck on yellow/running)
            const syntheticResult: ToolResult = {
              toolCallId: this.activeToolId,
              content: '',
              isError: false,
            };
            callbacks.onToolResult(syntheticResult, undefined);

            currentToolCalls.delete(this.activeToolId);
          }
          this.activeToolId = undefined;
          this.activeToolIndex = undefined;
        }
        break;
      }

      case 'message_stop': {
        // Turn complete — finalize any accumulated text as a separate assistant message
        const turnText = getAndResetText();
        if (turnText) {
          const assistantMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: turnText,
            timestamp: Date.now(),
          };
          callbacks.onMessageComplete(assistantMsg, undefined);
        }
        currentToolCalls.clear();
        break;
      }
    }
  }
}
