/**
 * Project Trust Gate — prompt user before loading project configs
 * from untrusted repositories.
 */

import * as vscode from 'vscode';

export class ProjectTrustGate {
  private globalState: vscode.Memento;
  private trustedKey = 'archon.trustedProjects';

  constructor(globalState: vscode.Memento) {
    this.globalState = globalState;
  }

  /**
   * Check if a project is trusted. If not, prompt the user.
   */
  async checkTrust(workspacePath: string): Promise<boolean> {
    const trusted = this.getTrustedProjects();
    if (trusted.includes(workspacePath)) return true;

    const choice = await vscode.window.showInformationMessage(
      `Archon: Trust this project? Archon will load project-level configuration from "${workspacePath}".`,
      { modal: false },
      'Trust',
      'Trust Once',
      'Deny',
    );

    if (choice === 'Trust') {
      await this.trustProject(workspacePath);
      return true;
    }

    return choice === 'Trust Once';
  }

  /**
   * Permanently trust a project.
   */
  async trustProject(workspacePath: string): Promise<void> {
    const trusted = this.getTrustedProjects();
    if (!trusted.includes(workspacePath)) {
      trusted.push(workspacePath);
      await this.globalState.update(this.trustedKey, trusted);
    }
  }

  /**
   * Check if a project is trusted (no prompt).
   */
  isTrusted(workspacePath: string): boolean {
    return this.getTrustedProjects().includes(workspacePath);
  }

  private getTrustedProjects(): string[] {
    return this.globalState.get<string[]>(this.trustedKey, []);
  }
}
