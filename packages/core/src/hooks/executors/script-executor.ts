/**
 * Script Node executor — runs JS/Python/shell scripts as hook nodes.
 *
 * Scripts receive a JSON payload on stdin and return a JSON response on stdout.
 */

import { execFile } from 'child_process';
import * as path from 'path';
import type { HookNode, HookContext, HookResult, ScriptNodeConfig } from '../types';

const DEFAULT_TIMEOUT = 5000;

export async function executeScriptNode(
  node: HookNode,
  context: HookContext,
  workspaceRoot?: string,
): Promise<HookResult> {
  const config = node.config as ScriptNodeConfig;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  const payload = JSON.stringify({
    hookPoint: context.hookPoint,
    data: context.data,
    variables: context.variables,
    config: {},
  });

  // Inline script — execute directly
  if (config.inline) {
    return executeInlineScript(config, payload, timeout, workspaceRoot);
  }

  // File-based script
  if (!config.entrypoint) {
    return { action: 'pass', error: 'Script node has no entrypoint or inline script' };
  }

  const scriptPath = workspaceRoot
    ? path.resolve(workspaceRoot, config.entrypoint)
    : config.entrypoint;

  return executeFileScript(config.runtime, scriptPath, payload, timeout, workspaceRoot);
}

function executeInlineScript(
  config: ScriptNodeConfig,
  payload: string,
  timeout: number,
  cwd?: string,
): Promise<HookResult> {
  const { runtime, inline } = config;

  let command: string;
  let args: string[];

  switch (runtime) {
    case 'node':
      command = process.execPath;
      args = ['-e', inline!];
      break;
    case 'python':
      command = 'python';
      args = ['-c', inline!];
      break;
    case 'shell':
      command = process.platform === 'win32' ? 'cmd' : 'sh';
      args = process.platform === 'win32' ? ['/c', inline!] : ['-c', inline!];
      break;
    default:
      return Promise.resolve({ action: 'pass', error: `Unknown runtime: ${runtime}` });
  }

  return runProcess(command, args, payload, timeout, cwd);
}

function executeFileScript(
  runtime: string,
  scriptPath: string,
  payload: string,
  timeout: number,
  cwd?: string,
): Promise<HookResult> {
  let command: string;
  let args: string[];

  switch (runtime) {
    case 'node':
      command = process.execPath;
      args = [scriptPath];
      break;
    case 'python':
      command = 'python';
      args = [scriptPath];
      break;
    case 'shell':
      command = scriptPath;
      args = [];
      break;
    default:
      return Promise.resolve({ action: 'pass', error: `Unknown runtime: ${runtime}` });
  }

  return runProcess(command, args, payload, timeout, cwd);
}

function runProcess(
  command: string,
  args: string[],
  stdin: string,
  timeout: number,
  cwd?: string,
): Promise<HookResult> {
  return new Promise((resolve) => {
    const child = execFile(command, args, {
      timeout,
      cwd,
      maxBuffer: 1024 * 1024,  // 1MB
      env: { ...process.env, ARCHON_HOOK: '1' },
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          action: 'pass',
          error: `Script error: ${error.message}${stderr ? `\n${stderr}` : ''}`,
        });
        return;
      }

      // Parse JSON response from stdout
      const output = stdout.trim();
      if (!output) {
        resolve({ action: 'pass', summary: 'Script returned no output' });
        return;
      }

      try {
        const response = JSON.parse(output);
        resolve({
          action: (response.action as HookResult['action']) ?? 'pass',
          modifications: response.modifications,
          variables: response.variables,
          summary: response.summary,
        });
      } catch {
        resolve({
          action: 'pass',
          summary: output.slice(0, 200),
          error: 'Script output was not valid JSON',
        });
      }
    });

    // Write payload to stdin
    if (child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}
