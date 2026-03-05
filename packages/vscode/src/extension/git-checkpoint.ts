/**
 * Git checkpoint system — create commits before edit batches for rollback.
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class GitCheckpoint {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Check if this workspace is a git repo.
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await execAsync('git rev-parse --is-inside-work-tree', { cwd: this.workspaceRoot });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a checkpoint commit before an edit batch.
   * Returns the commit hash, or null if nothing to commit.
   */
  async createCheckpoint(description: string): Promise<string | null> {
    if (!(await this.isGitRepo())) return null;

    try {
      // Check if there are changes to commit
      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: this.workspaceRoot,
      });

      if (!status.trim()) return null; // No changes

      // Stage and commit
      await execAsync('git add -A', { cwd: this.workspaceRoot });
      await execAsync(
        `git commit -m "[archon-checkpoint] ${description.replace(/"/g, '\\"')}"`,
        { cwd: this.workspaceRoot },
      );

      // Get the commit hash
      const { stdout: hash } = await execAsync('git rev-parse HEAD', {
        cwd: this.workspaceRoot,
      });

      return hash.trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(`Archon: Git checkpoint failed: ${msg}`);
      return null;
    }
  }

  /**
   * Rollback to a previous checkpoint.
   */
  async rollback(commitHash: string): Promise<boolean> {
    if (!(await this.isGitRepo())) return false;

    try {
      await execAsync(`git reset --soft ${commitHash}`, { cwd: this.workspaceRoot });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Archon: Rollback failed: ${msg}`);
      return false;
    }
  }

  /**
   * Get the current HEAD hash for comparison.
   */
  async getCurrentHead(): Promise<string | null> {
    if (!(await this.isGitRepo())) return null;
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: this.workspaceRoot });
      return stdout.trim();
    } catch {
      return null;
    }
  }
}
