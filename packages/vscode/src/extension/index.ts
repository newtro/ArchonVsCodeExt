import * as vscode from 'vscode';
import { ChatViewProvider } from './chat-view-provider';
import { ProjectTrustGate } from './project-trust-gate';

let chatProvider: ChatViewProvider;

export function activate(context: vscode.ExtensionContext) {
  chatProvider = new ChatViewProvider(context);

  // Register webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('archon.chatView', chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('archon.newChat', () => chatProvider.newChat()),
    vscode.commands.registerCommand('archon.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your OpenRouter API key',
        password: true,
        placeHolder: 'sk-or-...',
      });
      if (key) {
        await context.secrets.store('archon.openRouterApiKey', key);
        chatProvider.setApiKey(key);
        vscode.window.showInformationMessage('Archon: API key saved.');
      }
    }),
    vscode.commands.registerCommand('archon.selectModel', () => chatProvider.showModelPicker()),
    vscode.commands.registerCommand('archon.focusChat', () => {
      vscode.commands.executeCommand('archon.chatView.focus');
    }),
    vscode.commands.registerCommand('archon.toggleSecurityLevel', async () => {
      const level = await vscode.window.showQuickPick(
        [
          { label: 'yolo', description: 'No confirmation for anything' },
          { label: 'permissive', description: 'Confirm destructive commands only' },
          { label: 'standard', description: 'Confirm writes and commands' },
          { label: 'strict', description: 'Confirm everything' },
        ],
        { placeHolder: 'Select security level' },
      );
      if (level) {
        chatProvider.setSecurityLevel(level.label as 'yolo' | 'permissive' | 'standard' | 'strict');
        vscode.window.showInformationMessage(`Archon: Security level set to ${level.label}`);
      }
    }),
  );

  // Load API keys from SecretStorage on activation
  context.secrets.get('archon.openRouterApiKey').then(key => {
    if (key) chatProvider.setApiKey(key);
  });
  context.secrets.get('archon.openaiApiKey').then(key => {
    if (key) chatProvider.setOpenAIApiKey(key);
  });
  // Load OpenAI subscription tokens (OAuth)
  chatProvider.loadOpenAITokens();

  // Project trust gate
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const trustGate = new ProjectTrustGate(context.globalState);
    trustGate.checkTrust(workspaceRoot);
  }
}

export function deactivate() {
  // Cleanup
}
