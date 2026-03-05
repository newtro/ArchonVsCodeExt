/**
 * VS Code webview API wrapper.
 * Provides typed postMessage and event listener.
 */

import type { WebviewMessage, ExtensionMessage } from '@archon/core';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

function getApi(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

export function postMessage(msg: WebviewMessage): void {
  getApi().postMessage(msg);
}

export function onMessage(handler: (msg: ExtensionMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    handler(event.data as ExtensionMessage);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
