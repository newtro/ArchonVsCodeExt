/**
 * Detects whether the Claude Code CLI is installed and authenticated.
 */

import { execFile } from 'child_process';

export interface ClaudeCliStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  error?: string;
}

/** Run a command and return stdout, or throw on failure. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/** Check if the Claude CLI is installed and authenticated. */
export async function detectClaudeCli(cliPath = 'claude'): Promise<ClaudeCliStatus> {
  // 1. Check if claude is in PATH
  let version: string | undefined;
  try {
    version = await run(cliPath, ['--version']);
  } catch {
    return { installed: false, authenticated: false, error: 'Claude CLI not found in PATH. Install with: npm install -g @anthropic-ai/claude-code' };
  }

  // 2. Check auth status
  try {
    const authJson = await run(cliPath, ['auth', 'status']);
    // `claude auth status` returns JSON by default; exit code 0 = logged in
    const auth = JSON.parse(authJson) as { authenticated?: boolean; loggedIn?: boolean };
    const isAuth = auth.authenticated ?? auth.loggedIn ?? true; // if parse works and exit 0, assume authed
    return { installed: true, authenticated: isAuth, version };
  } catch {
    return { installed: true, authenticated: false, version, error: 'Claude CLI is not authenticated. Run: claude auth login' };
  }
}
