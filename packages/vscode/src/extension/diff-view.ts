/**
 * Diff view — show file diffs to user for confirmation before applying edits.
 */

import * as vscode from 'vscode';

export interface PendingDiff {
  id: string;
  uri: vscode.Uri;
  originalContent: string;
  newContent: string;
  description: string;
}

export class DiffViewManager {
  private pendingDiffs: Map<string, PendingDiff> = new Map();

  /**
   * Show a diff view for a file edit and optionally wait for user approval.
   */
  async showDiff(
    uri: vscode.Uri,
    originalContent: string,
    newContent: string,
    description: string,
  ): Promise<boolean> {
    const id = Math.random().toString(36).slice(2, 11);
    const diff: PendingDiff = { id, uri, originalContent, newContent, description };
    this.pendingDiffs.set(id, diff);

    // Create temporary URIs for the diff editor
    const scheme = 'archon-diff';
    const originalUri = uri.with({ scheme, query: `original-${id}` });
    const modifiedUri = uri.with({ scheme, query: `modified-${id}` });

    // Register a temporary content provider
    const disposable = vscode.workspace.registerTextDocumentContentProvider(scheme, {
      provideTextDocumentContent: (docUri: vscode.Uri) => {
        const query = docUri.query;
        if (query === `original-${id}`) return originalContent;
        if (query === `modified-${id}`) return newContent;
        return '';
      },
    });

    try {
      // Open the diff editor
      const title = `${vscode.workspace.asRelativePath(uri)} — ${description}`;
      await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title);

      // Ask user to approve or reject
      const choice = await vscode.window.showInformationMessage(
        `Apply changes to ${vscode.workspace.asRelativePath(uri)}?`,
        { modal: false },
        'Apply',
        'Reject',
      );

      return choice === 'Apply';
    } finally {
      disposable.dispose();
      this.pendingDiffs.delete(id);
    }
  }

  /**
   * Show a diff for multiple files as a batch.
   */
  async showBatchDiff(
    diffs: Array<{ uri: vscode.Uri; original: string; modified: string; description: string }>,
  ): Promise<boolean> {
    const summaryLines = diffs.map(d =>
      `  ${vscode.workspace.asRelativePath(d.uri)}: ${d.description}`
    );

    const choice = await vscode.window.showInformationMessage(
      `Apply ${diffs.length} file change(s)?\n${summaryLines.join('\n')}`,
      { modal: true },
      'Apply All',
      'Review Each',
      'Reject All',
    );

    if (choice === 'Reject All') return false;

    if (choice === 'Review Each') {
      for (const d of diffs) {
        const approved = await this.showDiff(d.uri, d.original, d.modified, d.description);
        if (!approved) return false;
      }
      return true;
    }

    return choice === 'Apply All';
  }
}
