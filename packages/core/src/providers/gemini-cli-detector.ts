/**
 * Detects whether the Gemini CLI is installed and authenticated.
 */

import { execFile } from 'child_process';

export interface GeminiCliStatus {
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

/** Check if the Gemini CLI is installed and authenticated. */
export async function detectGeminiCli(cliPath = 'gemini'): Promise<GeminiCliStatus> {
  // 1. Check if gemini is in PATH
  let version: string | undefined;
  try {
    const versionOutput = await run(cliPath, ['--version']);
    // Gemini CLI prints version string, e.g. "Gemini CLI v1.2.3" or just a version number
    version = versionOutput.replace(/^gemini\s*/i, '').trim();
  } catch {
    return {
      installed: false,
      authenticated: false,
      error: 'Gemini CLI not found in PATH. Install with: npm install -g @google/gemini-cli',
    };
  }

  // 2. Check auth by attempting a minimal operation.
  // Gemini CLI doesn't have an `auth status` command like Claude CLI.
  // We run a trivial prompt in headless mode with --output-format json.
  // If auth fails, it exits with a non-zero code and error message.
  // To keep detection fast, we use a very short prompt with max 1 turn.
  try {
    const result = await run(cliPath, [
      '-p', 'ping',
      '--output-format', 'json',
      '--model', 'gemini-2.5-flash',
    ]);
    // If we get valid JSON output with a response field, auth is working
    const parsed = JSON.parse(result) as { response?: string; error?: { message?: string } };
    if (parsed.error) {
      return {
        installed: true,
        authenticated: false,
        version,
        error: parsed.error.message ?? 'Gemini CLI authentication failed. Run: gemini',
      };
    }
    return { installed: true, authenticated: true, version };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish between auth errors and other failures
    if (msg.includes('auth') || msg.includes('login') || msg.includes('credential') || msg.includes('401') || msg.includes('403')) {
      return {
        installed: true,
        authenticated: false,
        version,
        error: 'Gemini CLI is not authenticated. Run: gemini (and follow the login prompts)',
      };
    }
    // If the command ran but returned an error, it might still be authenticated
    // but had a transient issue. Mark as installed, try optimistic auth.
    return {
      installed: true,
      authenticated: false,
      version,
      error: `Gemini CLI auth check failed: ${msg}`,
    };
  }
}
