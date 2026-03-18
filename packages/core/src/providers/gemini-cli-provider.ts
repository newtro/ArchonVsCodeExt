/**
 * Gemini CLI provider.
 *
 * Spawns the `gemini` CLI as a subprocess with `--output-format stream-json`.
 * Gemini CLI runs its own agent loop with its own tools.
 * Our extension observes the NDJSON stream and maps events to the common interface.
 *
 * IMPORTANT — Terms of Service Notice:
 * Google's Terms of Service prohibit third-party tools from directly accessing
 * the services powering Gemini CLI. Spawning the CLI binary itself (rather than
 * extracting OAuth tokens) is a gray area. Users should be aware of this risk.
 * See: https://geminicli.com/docs/resources/tos-privacy/
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import * as path from 'path';
import { detectGeminiCli } from './gemini-cli-detector';
import type { ModelInfo, ChatMessage, StreamToken, ToolCall, ToolResult } from '../types';
import type { LLMProvider, ProviderId, ExecutorConfig, Executor, ExecutorCallbacks } from './types';

// ── Gemini CLI models ──

const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Most capable Gemini model for complex reasoning',
    contextLength: 1048576,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast, efficient model for everyday tasks',
    contextLength: 1048576,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    description: 'Lightweight model optimized for speed',
    contextLength: 1048576,
    supportsTools: true,
    supportsStreaming: true,
  },
];

// ── Permission level → CLI flags ──

type SecurityLevel = 'yolo' | 'permissive' | 'standard' | 'strict';

function buildApprovalMode(level?: SecurityLevel): string[] {
  switch (level) {
    case 'yolo':
    case 'permissive':
      return ['--approval-mode', 'yolo'];
    case 'strict':
      return ['--approval-mode', 'default'];
    case 'standard':
    default:
      return ['--approval-mode', 'auto_edit'];
  }
}

// ── Provider ──

export interface GeminiCliConfig {
  cliPath?: string;
}

export class GeminiCliProvider implements LLMProvider {
  readonly id: ProviderId = 'gemini-cli';
  readonly name = 'Gemini CLI';
  private cliPath: string;

  constructor(config?: GeminiCliConfig) {
    this.cliPath = config?.cliPath ?? 'gemini';
  }

  setCliPath(path: string): void {
    this.cliPath = path;
  }

  getCliPath(): string {
    return this.cliPath;
  }

  async isAvailable(): Promise<boolean> {
    const status = await detectGeminiCli(this.cliPath);
    return status.installed && status.authenticated;
  }

  async getStatus() {
    return detectGeminiCli(this.cliPath);
  }

  async getModels(): Promise<ModelInfo[]> {
    // Gemini CLI models are fixed — no API call needed
    return GEMINI_MODELS;
  }

  createExecutor(config: ExecutorConfig): Executor {
    return new GeminiCliExecutor(this.cliPath, config);
  }

  async simpleChat(
    model: string,
    messages: Array<{ role: string; content: string }>,
    _temperature?: number,
  ): Promise<string> {
    const systemMsg = messages.find(m => m.role === 'system')?.content ?? '';
    const userMsg = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n');
    const prompt = systemMsg ? `${systemMsg}\n\n${userMsg}` : userMsg;

    return new Promise<string>((resolve, reject) => {
      const args = ['-p', '--output-format', 'json', '--model', model];
      const proc = spawn(this.cliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });

      proc.on('error', (err) => reject(new Error(`Gemini CLI error: ${err.message}`)));
      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout) as { response?: string };
            resolve(parsed.response ?? stdout.trim());
          } catch {
            resolve(stdout.trim());
          }
        } else {
          reject(new Error(`Gemini CLI exited with code ${code}: ${stderr}`));
        }
      });

      if (proc.stdin) {
        proc.stdin.write(prompt);
        proc.stdin.end();
      }
    });
  }
}

// ── Executor ──

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

class GeminiCliExecutor implements Executor {
  private cliPath: string;
  private config: ExecutorConfig;
  private process: ChildProcess | null = null;
  private sessionId: string | null = null;
  private aborted = false;

  constructor(cliPath: string, config: ExecutorConfig) {
    this.cliPath = cliPath;
    this.config = config;
    if (config.sessionId) {
      this.sessionId = config.sessionId;
    }
  }

  async run(userMessage: string, callbacks: ExecutorCallbacks): Promise<void> {
    this.aborted = false;

    const args = this.buildArgs();
    const cwd = this.config.workspaceRoot || process.cwd();
    const resolvedCli = this.resolveCliPath();

    this.process = spawn(resolvedCli, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let buffer = '';
    let fullText = '';
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
          this.handleStreamMessage(msg, callbacks, emittedToolIds, appendText, getAndResetText);
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

    // Pipe user message via stdin
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
            this.handleStreamMessage(msg, callbacks, emittedToolIds, appendText, getAndResetText);
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
          const errorMsg = stderr.trim() || `Gemini CLI exited with code ${code}`;
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
        const errorMsg = `Failed to start Gemini CLI: ${err.message}`;
        callbacks.onToken({ type: 'error', error: errorMsg }, undefined);
        reject(new Error(errorMsg));
      });
    });
  }

  abort(): void {
    this.aborted = true;
    if (this.process) {
      this.process.kill('SIGTERM');
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
   */
  private resolveCliPath(): string {
    if (path.isAbsolute(this.cliPath)) {
      return this.cliPath;
    }

    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const result = execSync(`${cmd} ${this.cliPath}`, { encoding: 'utf-8', timeout: 5000 }).trim();
      const firstLine = result.split('\n')[0].trim();
      if (firstLine) return firstLine;
    } catch {
      // Fall through
    }

    return this.cliPath;
  }

  private buildArgs(): string[] {
    // User message is piped via stdin; -p enables non-interactive headless mode
    const args: string[] = [
      '-p',
      '--output-format', 'stream-json',
    ];

    // Model selection
    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // Session resume
    if (this.sessionId) {
      args.push('--resume', this.sessionId);
    }

    // Approval mode (maps from security level)
    args.push(...buildApprovalMode(this.config.securityLevel as SecurityLevel));

    // System prompt — Gemini CLI supports --system-prompt for custom instructions
    if (this.config.systemPrompt) {
      args.push('--system-prompt', this.config.systemPrompt);
    }

    return args;
  }

  /**
   * Handle a single parsed NDJSON message from the Gemini CLI stream.
   *
   * Actual Gemini CLI stream-json event format (from source):
   *
   * init:        { type: "init", timestamp, session_id, model }
   * message:     { type: "message", timestamp, role: "user"|"assistant", content: string, delta?: boolean }
   *              When delta=true, content is a streaming chunk (append to current text).
   *              When delta is absent/false, content is a complete message (non-streaming or user echo).
   * tool_use:    { type: "tool_use", timestamp, tool_name: string, tool_id: string, parameters: object }
   * tool_result: { type: "tool_result", timestamp, tool_id: string, status: "success"|..., output: string }
   * error:       { type: "error", timestamp, message?: string, ... }
   * result:      { type: "result", timestamp, stats: { response, tokenUsage, perModelStats, toolStats } }
   */
  private handleStreamMessage(
    msg: Record<string, unknown>,
    callbacks: ExecutorCallbacks,
    emittedToolIds: Set<string>,
    appendText: (text: string) => void,
    getAndResetText: () => string,
  ): void {
    const msgType = msg.type as string;

    switch (msgType) {
      case 'init': {
        // Session metadata — extract session ID
        if (msg.session_id && typeof msg.session_id === 'string') {
          this.sessionId = msg.session_id;
        }
        break;
      }

      case 'message': {
        const role = msg.role as string | undefined;
        const content = msg.content as string | undefined;
        const isDelta = msg.delta === true;

        if (role === 'assistant' && content) {
          if (isDelta) {
            // Streaming text chunk — append and emit token for live rendering
            appendText(content);
            callbacks.onToken({ type: 'text', content }, undefined);
          } else {
            // Complete assistant message (non-streaming) — finalize any
            // prior streamed text first, then emit this as a complete message.
            const priorText = getAndResetText();
            const fullContent = priorText || content;
            const assistantMsg: ChatMessage = {
              id: generateId(),
              role: 'assistant',
              content: fullContent,
              timestamp: Date.now(),
            };
            callbacks.onMessageComplete(assistantMsg, undefined);
          }
        }
        // User messages are just echoes — skip them
        break;
      }

      case 'tool_use': {
        // Finalize any streamed text before the tool call
        const priorText = getAndResetText();
        if (priorText) {
          const assistantMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: priorText,
            timestamp: Date.now(),
          };
          callbacks.onMessageComplete(assistantMsg, undefined);
        }

        // Gemini CLI uses tool_name, tool_id, parameters
        const toolId = (msg.tool_id as string) ?? generateId();
        const toolName = (msg.tool_name as string) ?? 'unknown';
        const toolArgs = (msg.parameters ?? {}) as Record<string, unknown>;

        if (!emittedToolIds.has(toolId)) {
          const tc: ToolCall = { id: toolId, name: toolName, arguments: toolArgs };
          callbacks.onToken({ type: 'tool_call_start', toolCall: { id: toolId, name: toolName } }, undefined);
          callbacks.onToken({ type: 'tool_call_end', toolCall: tc }, undefined);
          callbacks.onToolCall(tc, undefined);
          emittedToolIds.add(toolId);
        }
        break;
      }

      case 'tool_result': {
        // Gemini CLI uses tool_id, status, output
        const toolId = (msg.tool_id as string) ?? '';
        const output = (msg.output as string) ?? '';
        const status = msg.status as string | undefined;
        const isError = status !== undefined && status !== 'success';

        const result: ToolResult = {
          toolCallId: toolId,
          content: output,
          isError,
        };
        callbacks.onToolResult(result, undefined);
        break;
      }

      case 'error': {
        // Non-fatal errors / warnings
        const errorMsg = (msg.message as string) ?? (msg.error as string) ?? 'Unknown error';
        callbacks.onToken({ type: 'error', error: errorMsg }, undefined);
        break;
      }

      case 'result': {
        // Final result with stats — finalize remaining text
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
        break;
      }
    }
  }
}
