/**
 * Zustand store for the webview UI state.
 */

import { create } from 'zustand';
import type { ModelInfo, Attachment, ChatSessionSummary } from '@archon/core';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  toolStatus?: 'running' | 'done' | 'error';
  isStreaming?: boolean;
  isError?: boolean;
  timestamp: number;
}

export interface AskUserRequest {
  id: string;
  prompt: string;
  options?: string[];
}

interface ChatState {
  messages: UIMessage[];
  isLoading: boolean;
  streamingContent: string;
  models: ModelInfo[];
  selectedModelId: string;
  askUserRequest: AskUserRequest | null;
  error: string | null;
  attachments: Attachment[];
  workspaceFiles: string[];
  chatSessions: ChatSessionSummary[];

  addMessage: (msg: UIMessage) => void;
  updateToolMessage: (toolCallId: string, update: Partial<UIMessage>) => void;
  updateStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  finalizeAssistantMessage: (content: string) => void;
  setLoading: (loading: boolean) => void;
  setModels: (models: ModelInfo[]) => void;
  setSelectedModel: (modelId: string) => void;
  setAskUser: (req: AskUserRequest | null) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setWorkspaceFiles: (files: string[]) => void;
  setChatSessions: (sessions: ChatSessionSummary[]) => void;
  setMessages: (messages: UIMessage[]) => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  streamingContent: '',
  models: [],
  selectedModelId: '',
  askUserRequest: null,
  error: null,
  attachments: [],
  workspaceFiles: [],
  chatSessions: [],

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateToolMessage: (toolCallId, update) =>
    set((state) => ({
      messages: state.messages.map(m =>
        m.role === 'tool' && m.toolCallId === toolCallId ? { ...m, ...update } : m
      ),
    })),

  updateStreamingContent: (content) =>
    set({ streamingContent: content }),

  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),

  finalizeAssistantMessage: (content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: generateId(),
          role: 'assistant',
          content,
          timestamp: Date.now(),
        },
      ],
      streamingContent: '',
    })),

  setLoading: (loading) => set({ isLoading: loading }),

  setModels: (models) => set({ models }),

  setSelectedModel: (modelId) => set({ selectedModelId: modelId }),

  setAskUser: (req) => set({ askUserRequest: req }),

  setError: (error) => set({ error }),

  clearMessages: () => set({ messages: [], streamingContent: '', error: null }),

  addAttachment: (attachment) =>
    set((state) => ({ attachments: [...state.attachments, attachment] })),

  removeAttachment: (id) =>
    set((state) => ({ attachments: state.attachments.filter(a => a.id !== id) })),

  clearAttachments: () => set({ attachments: [] }),

  setWorkspaceFiles: (files) => set({ workspaceFiles: files }),

  setChatSessions: (sessions) => set({ chatSessions: sessions }),

  setMessages: (messages) => set({ messages, streamingContent: '', error: null, isLoading: false }),
}));
