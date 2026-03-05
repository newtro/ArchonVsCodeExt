/**
 * Zustand store for the webview UI state.
 */

import { create } from 'zustand';
import type { ModelInfo, Attachment, ChatSessionSummary, TodoItem, TodoSummary } from '@archon/core';

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
  /** Set when this message belongs to a parallel branch */
  branchId?: string;
  /** Sub-agent activity collected during spawn_agent execution */
  subMessages?: Array<{
    role: 'assistant' | 'tool';
    content: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    isError?: boolean;
  }>;
  /** Inline todo snapshot data (for __todo_inline__ marker messages) */
  todoItems?: TodoItem[];
  todoTitle?: string;
}

export interface ParallelBranchState {
  branchId: string;
  label: string;
  nodeId: string;
  status: 'running' | 'completed' | 'error';
  messages: UIMessage[];
  streamingContent: string;
  errorMessage?: string;
}

export interface ParallelGroupState {
  id: string;
  branches: ParallelBranchState[];
  status: 'running' | 'completed';
}

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserRequest {
  id: string;
  prompt: string;
  options?: (string | AskUserOption)[];
  multiSelect?: boolean;
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
  /** Active parallel group (null when not in a parallel section) */
  parallelGroup: ParallelGroupState | null;
  /** Completed parallel groups stored as messages for the chat history */
  completedParallelGroups: ParallelGroupState[];
  /** Active todo list (null when no todos are being tracked) */
  todoList: { title?: string; items: TodoItem[] } | null;

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

  // Parallel branch actions
  startParallelGroup: (branches: Array<{ branchId: string; label: string; nodeId: string }>) => void;
  appendBranchStreamingContent: (branchId: string, chunk: string) => void;
  finalizeBranchAssistantMessage: (branchId: string, content: string) => void;
  addBranchMessage: (branchId: string, msg: UIMessage) => void;
  updateBranchToolMessage: (branchId: string, toolCallId: string, update: Partial<UIMessage>) => void;
  completeBranch: (branchId: string) => void;
  setBranchError: (branchId: string, error: string) => void;
  completeParallelGroup: () => void;

  // Todo actions
  setTodoList: (title: string | undefined, items: TodoItem[]) => void;
  addTodoSnapshot: (title: string | undefined, items: TodoItem[]) => void;
  completeTodoTurn: (summary: TodoSummary) => void;
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
  parallelGroup: null,
  completedParallelGroups: [],
  todoList: null,

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

  clearMessages: () => set({ messages: [], streamingContent: '', error: null, parallelGroup: null, completedParallelGroups: [], todoList: null }),

  addAttachment: (attachment) =>
    set((state) => ({ attachments: [...state.attachments, attachment] })),

  removeAttachment: (id) =>
    set((state) => ({ attachments: state.attachments.filter(a => a.id !== id) })),

  clearAttachments: () => set({ attachments: [] }),

  setWorkspaceFiles: (files) => set({ workspaceFiles: files }),

  setChatSessions: (sessions) => set({ chatSessions: sessions }),

  setMessages: (messages) => set({ messages, streamingContent: '', error: null, isLoading: false, parallelGroup: null, completedParallelGroups: [], todoList: null }),

  // ── Parallel branch actions ──

  startParallelGroup: (branches) =>
    set({
      parallelGroup: {
        id: generateId(),
        status: 'running',
        branches: branches.map(b => ({
          branchId: b.branchId,
          label: b.label,
          nodeId: b.nodeId,
          status: 'running',
          messages: [],
          streamingContent: '',
        })),
      },
    }),

  appendBranchStreamingContent: (branchId, chunk) =>
    set((state) => {
      if (!state.parallelGroup) return {};
      return {
        parallelGroup: {
          ...state.parallelGroup,
          branches: state.parallelGroup.branches.map(b =>
            b.branchId === branchId
              ? {
                  ...b,
                  streamingContent: b.streamingContent + chunk,
                  // Reset error state if branch resumes (e.g., after retry)
                  ...(b.status === 'error' ? { status: 'running' as const, errorMessage: undefined } : {}),
                }
              : b
          ),
        },
      };
    }),

  finalizeBranchAssistantMessage: (branchId, content) =>
    set((state) => {
      if (!state.parallelGroup) return {};
      return {
        parallelGroup: {
          ...state.parallelGroup,
          branches: state.parallelGroup.branches.map(b =>
            b.branchId === branchId
              ? {
                  ...b,
                  messages: [...b.messages, {
                    id: generateId(),
                    role: 'assistant' as const,
                    content,
                    timestamp: Date.now(),
                    branchId,
                  }],
                  streamingContent: '',
                }
              : b
          ),
        },
      };
    }),

  addBranchMessage: (branchId, msg) =>
    set((state) => {
      if (!state.parallelGroup) return {};
      return {
        parallelGroup: {
          ...state.parallelGroup,
          branches: state.parallelGroup.branches.map(b =>
            b.branchId === branchId
              ? { ...b, messages: [...b.messages, { ...msg, branchId }] }
              : b
          ),
        },
      };
    }),

  updateBranchToolMessage: (branchId, toolCallId, update) =>
    set((state) => {
      if (!state.parallelGroup) return {};
      return {
        parallelGroup: {
          ...state.parallelGroup,
          branches: state.parallelGroup.branches.map(b =>
            b.branchId === branchId
              ? {
                  ...b,
                  messages: b.messages.map(m =>
                    m.role === 'tool' && m.toolCallId === toolCallId ? { ...m, ...update } : m
                  ),
                }
              : b
          ),
        },
      };
    }),

  completeBranch: (branchId) =>
    set((state) => {
      if (!state.parallelGroup) return {};
      return {
        parallelGroup: {
          ...state.parallelGroup,
          branches: state.parallelGroup.branches.map(b =>
            b.branchId === branchId ? { ...b, status: 'completed' } : b
          ),
        },
      };
    }),

  setBranchError: (branchId, error) =>
    set((state) => {
      if (!state.parallelGroup) return {};
      return {
        parallelGroup: {
          ...state.parallelGroup,
          branches: state.parallelGroup.branches.map(b =>
            b.branchId === branchId ? { ...b, status: 'error', errorMessage: error } : b
          ),
        },
      };
    }),

  completeParallelGroup: () =>
    set((state) => {
      if (!state.parallelGroup) return {};
      const completed = { ...state.parallelGroup, status: 'completed' as const };
      // Insert a marker message so the parallel group renders in sequence with other messages
      const marker: UIMessage = {
        id: `parallel-marker-${completed.id}`,
        role: 'tool',
        content: '',
        toolName: '__parallel_group__',
        timestamp: Date.now(),
      };
      return {
        messages: [...state.messages, marker],
        parallelGroup: null,
        completedParallelGroups: [...state.completedParallelGroups, completed],
      };
    }),

  // ── Todo actions ──

  setTodoList: (title, items) =>
    set({ todoList: { title, items } }),

  addTodoSnapshot: (title, items) =>
    set((state) => {
      const snapshot: UIMessage = {
        id: `todo-inline-${generateId()}`,
        role: 'tool',
        content: '',
        toolName: '__todo_inline__',
        toolStatus: 'done',
        timestamp: Date.now(),
        todoItems: items,
        todoTitle: title,
      };
      return { messages: [...state.messages, snapshot] };
    }),

  completeTodoTurn: (summary) =>
    set((state) => {
      const label = summary.title ? `${summary.title}: ` : '';
      const parts: string[] = [];
      if (summary.completed) parts.push(`${summary.completed} completed`);
      if (summary.error) parts.push(`${summary.error} error`);
      if (summary.skipped) parts.push(`${summary.skipped} skipped`);
      if (summary.abandoned) parts.push(`${summary.abandoned} abandoned`);
      const detail = parts.length > 0 ? parts.join(', ') : 'no items';

      const summaryMsg: UIMessage = {
        id: `todo-summary-${generateId()}`,
        role: 'tool',
        content: `${label}${summary.completed}/${summary.total} tasks completed (${detail})`,
        toolName: '__todo_summary__',
        toolStatus: 'done',
        timestamp: Date.now(),
      };
      return {
        messages: [...state.messages, summaryMsg],
        todoList: null,
      };
    }),
}));
