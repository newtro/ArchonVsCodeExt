import React, { useEffect, useRef, useState } from 'react';
import { useChatStore } from './store';
import { postMessage, onMessage } from './vscode-api';
import { MessageBubble } from './components/MessageBubble';
import { ChatInput } from './components/ChatInput';
import { AskUserDialog } from './components/AskUserDialog';
import { PipelineEditor } from './components/PipelineEditor';
import type { EditorNode, EditorEdge } from './components/PipelineEditor';
import { NetworkMonitorPanel } from './components/NetworkMonitorPanel';
import type { NetworkRequestUI } from './components/NetworkMonitorPanel';
import { BenchmarkDashboard } from './components/BenchmarkDashboard';
import { SettingsPanel } from './components/SettingsPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { ConvertToSkillWizard } from './components/ConvertToSkillWizard';
import { ChatHistoryDropdown } from './components/ChatHistoryDropdown';
import { ParallelBranchGroup } from './components/ParallelBranchGroup';
import { TodoListWidget } from './components/TodoListWidget';
import { PlusIcon, ClipboardIcon, RefreshIcon } from './components/Icons';
import type { ExtensionMessage, Attachment, ChatSessionMessage, BenchmarkSource, PipelineInfo, SkillInfo, SkillTemplate, SkillVersion, TodoItem, TodoSummary, ProviderInfo, ContextMeterData } from '@archon/core';

type Tab = 'chat' | 'pipeline' | 'skills' | 'network' | 'benchmarks' | 'settings';

/** All tool names available in the extension (core + LSP + extended). */
const AVAILABLE_TOOLS = [
  'read_file', 'write_file', 'edit_file', 'search_files', 'find_files',
  'list_directory', 'run_terminal', 'ask_user', 'attempt_completion',
  'go_to_definition', 'find_references', 'get_hover_info',
  'get_workspace_symbols', 'get_document_symbols', 'get_code_actions', 'get_diagnostics',
  'web_search', 'web_fetch', 'lookup_docs', 'search_codebase',
  'search_history', 'spawn_agent', 'diff_view', 'tool_search', 'todo_write',
];

export function App() {
  const {
    messages, isLoading, streamingContent, selectedModelId, models,
    askUserRequest, error, attachments, workspaceFiles, chatSessions,
    parallelGroup, completedParallelGroups,
    todoList,
    addMessage, updateToolMessage, appendStreamingContent, finalizeAssistantMessage,
    setLoading, setModels, setSelectedModel, setAskUser, setError, clearMessages,
    addAttachment, removeAttachment, clearAttachments, setWorkspaceFiles,
    setChatSessions, setMessages,
    startParallelGroup, appendBranchStreamingContent, finalizeBranchAssistantMessage,
    addBranchMessage, updateBranchToolMessage, completeBranch, setBranchError, completeParallelGroup,
    setTodoList, addTodoSnapshot, completeTodoTurn,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  // Pipeline editor state
  const [pipelineNodes, setPipelineNodes] = useState<EditorNode[]>([]);
  const [pipelineEdges, setPipelineEdges] = useState<EditorEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Pipeline selector state
  const [availablePipelines, setAvailablePipelines] = useState<PipelineInfo[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState('default');
  const [pipelinesLoaded, setPipelinesLoaded] = useState(false);
  const [enhancingNodeId, setEnhancingNodeId] = useState<string | null>(null);

  // Network monitor state
  const [networkRequests, setNetworkRequests] = useState<NetworkRequestUI[]>([]);

  // Benchmark state
  const [benchmarkSources, setBenchmarkSources] = useState<BenchmarkSource[]>([]);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkFetched, setBenchmarkFetched] = useState(false);

  // Settings state
  const [securityLevel, setSecurityLevel] = useState('standard');
  const [archiveEnabled, setArchiveEnabled] = useState(true);
  const [hasBraveApiKey, setHasBraveApiKey] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);

  // Model pool state
  const [modelPool, setModelPool] = useState<string[]>([]);

  // Provider state
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProviderId, setActiveProviderId] = useState('openrouter');
  const [claudeCliPath, setClaudeCliPath] = useState('claude');
  const [claudeCliStatus, setClaudeCliStatus] = useState<{ installed: boolean; authenticated: boolean; version?: string; error?: string } | undefined>(undefined);
  const [mcpConfigPath, setMcpConfigPath] = useState('');

  // Indexing state
  const [indexingStatus, setIndexingStatus] = useState<{
    state: 'idle' | 'indexing' | 'ready' | 'error';
    filesIndexed?: number;
    totalFiles?: number;
    chunkCount?: number;
    error?: string;
  }>({ state: 'idle' });

  // Context meter state
  const [contextMeter, setContextMeter] = useState<ContextMeterData | null>(null);

  // Todo display mode
  const [todoDisplayMode, setTodoDisplayMode] = useState<'pinned' | 'inline' | 'floating'>('pinned');
  const todoDisplayModeRef = React.useRef(todoDisplayMode);
  todoDisplayModeRef.current = todoDisplayMode;

  // Skills state
  const [skillsList, setSkillsList] = useState<SkillInfo[]>([]);
  const [skillTemplates, setSkillTemplates] = useState<SkillTemplate[]>([]);
  const [skillVersions, setSkillVersions] = useState<SkillVersion[]>([]);
  const [skillVersionsFor, setSkillVersionsFor] = useState<string | null>(null);
  const [skillVersionContent, setSkillVersionContent] = useState<string | null>(null);
  const [editingSkillContent, setEditingSkillContent] = useState<string | null>(null);
  const [editingSkillName, setEditingSkillName] = useState<string | null>(null);
  const [showConvertWizard, setShowConvertWizard] = useState(false);
  const [convertingSkill, setConvertingSkill] = useState(false);
  const [generatedSkill, setGeneratedSkill] = useState<{ name: string; description: string; tags: string[]; content: string } | null>(null);

  // Listen for messages from the extension host
  useEffect(() => {
    const unsubscribe = onMessage((msg: ExtensionMessage) => {
      switch (msg.type) {
        case 'streamToken':
          if (msg.token.type === 'text' && msg.token.content) {
            if (msg.branchId) {
              appendBranchStreamingContent(msg.branchId, msg.token.content);
            } else {
              appendStreamingContent(msg.token.content);
            }
          } else if (msg.token.type === 'error') {
            const errMsg = msg.token.error ?? 'Unknown error';
            if (msg.branchId) {
              // Branch-scoped error — mark that branch, don't disrupt the global UI
              setBranchError(msg.branchId, errMsg);
            } else {
              setError(errMsg);
            }
            // Don't clear loading — the pipeline may still be running
            // (e.g., waiting for user retry/skip/abort or other branches).
          }
          break;

        case 'messageComplete':
          if (msg.message.role === 'assistant') {
            if (msg.branchId) {
              finalizeBranchAssistantMessage(msg.branchId, msg.message.content);
            } else {
              finalizeAssistantMessage(msg.message.content);
            }
          }
          // Auto-save session after each completed message
          saveCurrentSession();
          break;

        case 'toolCallStart':
          if (msg.branchId) {
            addBranchMessage(msg.branchId, {
              id: msg.toolCall.id,
              role: 'tool',
              content: '',
              toolName: msg.toolCall.name,
              toolCallId: msg.toolCall.id,
              toolArgs: msg.toolCall.arguments,
              toolStatus: 'running',
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              id: msg.toolCall.id,
              role: 'tool',
              content: '',
              toolName: msg.toolCall.name,
              toolCallId: msg.toolCall.id,
              toolArgs: msg.toolCall.arguments,
              toolStatus: 'running',
              timestamp: Date.now(),
            });
          }
          break;

        case 'toolCallResult':
          if (msg.branchId) {
            updateBranchToolMessage(msg.branchId, msg.result.toolCallId, {
              toolResult: msg.result.content,
              toolStatus: msg.result.isError ? 'error' : 'done',
              isError: msg.result.isError,
              subMessages: msg.result.subMessages,
            });
          } else {
            updateToolMessage(msg.result.toolCallId, {
              toolResult: msg.result.content,
              toolStatus: msg.result.isError ? 'error' : 'done',
              isError: msg.result.isError,
              subMessages: msg.result.subMessages,
            });
          }
          break;

        case 'parallelStart':
          startParallelGroup(msg.branches);
          break;

        case 'parallelBranchComplete':
          completeBranch(msg.branchId);
          break;

        case 'parallelComplete':
          completeParallelGroup();
          break;

        case 'modelsLoaded':
          setModels(msg.models);
          break;

        case 'modelChanged':
          setSelectedModel(msg.modelId);
          break;

        case 'error':
          setError(msg.error);
          // Don't clear loading — 'agentLoopDone' handles that when the pipeline truly stops.
          break;

        case 'askUser':
          setAskUser({ id: msg.id, prompt: msg.prompt, options: msg.options, multiSelect: msg.multiSelect });
          break;

        case 'filePicked':
          addAttachment({
            id: Math.random().toString(36).slice(2, 11),
            name: msg.path,
            type: 'file',
            content: msg.content,
          });
          break;

        case 'workspaceFilesResult':
          setWorkspaceFiles(msg.files);
          break;

        case 'settingsLoaded':
          setSecurityLevel(msg.securityLevel);
          setArchiveEnabled(msg.archiveEnabled);
          setModelPool(msg.modelPool);
          setHasBraveApiKey(msg.hasBraveApiKey);
          setWebSearchEnabled(msg.webSearchEnabled);
          if (msg.activeProvider) {
            setActiveProviderId(msg.activeProvider);
          }
          break;

        case 'providersLoaded':
          setProviders(msg.providers);
          break;

        case 'providerChanged':
          setActiveProviderId(msg.providerId);
          break;

        case 'providerStatus':
          setProviders(prev => prev.map(p =>
            p.id === msg.providerId ? { ...p, available: msg.available } : p
          ));
          break;

        case 'claudeCliStatusResult':
          setClaudeCliStatus({
            installed: msg.installed,
            authenticated: msg.authenticated,
            version: msg.version,
            error: msg.error,
          });
          break;

        case 'chatSessionsLoaded':
          setChatSessions(msg.sessions);
          break;

        case 'chatSessionLoaded':
          // Load messages from session
          setMessages(msg.session.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolName: m.toolName,
            isError: m.isError,
            timestamp: m.timestamp,
          })));
          break;

        case 'benchmarksLoaded':
          setBenchmarkSources(msg.sources);
          setBenchmarkLoading(false);
          setBenchmarkFetched(true);
          break;

        case 'benchmarkError':
          setError(msg.error);
          setBenchmarkLoading(false);
          break;

        case 'modelPoolUpdated':
          setModelPool(msg.modelPool);
          break;

        case 'agentLoopDone':
          setLoading(false);
          break;

        case 'indexingStatus':
          setIndexingStatus({
            state: msg.state,
            filesIndexed: msg.filesIndexed,
            totalFiles: msg.totalFiles,
            chunkCount: msg.chunkCount,
            error: msg.error,
          });
          break;

        case 'pipelinesLoaded':
          setAvailablePipelines(msg.pipelines);
          setPipelinesLoaded(true);
          break;

        case 'pipelineChanged':
          setSelectedPipelineId(msg.pipelineId);
          break;

        case 'pipelineNodeStatus':
          setPipelineNodes(prev => prev.map(n =>
            n.id === msg.nodeId ? { ...n, status: msg.status } : n
          ));
          break;

        case 'pipelineSaved':
          // Pipelines list will be refreshed by the extension host
          break;

        case 'pipelineDeleted':
          if (selectedPipelineId === msg.pipelineId) {
            setSelectedPipelineId('default');
          }
          break;

        case 'pipelineGraphLoaded':
          setPipelineNodes(msg.nodes.map(n => ({
            id: n.id,
            type: n.type,
            label: n.label,
            position: n.position,
            status: n.status,
            config: n.config,
          })));
          setPipelineEdges(msg.edges.map(e => ({
            id: e.id,
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
            label: e.label,
          })));
          setSelectedNodeId(null);
          break;

        case 'promptEnhanced':
          setEnhancingNodeId(null);
          setPipelineNodes(prev => prev.map(n =>
            n.id === msg.nodeId ? { ...n, config: { ...n.config, systemPrompt: msg.enhanced } } : n
          ));
          break;

        case 'promptEnhanceError':
          setEnhancingNodeId(null);
          setError(msg.error);
          break;

        // Skills messages
        case 'skillsLoaded':
          setSkillsList(msg.skills);
          break;

        case 'skillSaved':
        case 'skillDeleted':
        case 'skillToggled':
          // Skills list is auto-refreshed by extension host after these events
          break;

        case 'skillError':
          setError(msg.error);
          break;

        case 'skillTemplatesLoaded':
          setSkillTemplates(msg.templates);
          break;

        case 'skillVersionsLoaded':
          setSkillVersionsFor(msg.skillName);
          setSkillVersions(msg.versions);
          break;

        case 'skillVersionContent':
          setSkillVersionContent(msg.content);
          break;

        case 'skillContentLoaded':
          setEditingSkillName(msg.skillName);
          setEditingSkillContent(msg.content);
          break;

        case 'skillVersionRestored':
          postMessage({ type: 'loadSkills' });
          break;

        case 'conversationSkillGenerated':
          setConvertingSkill(false);
          setGeneratedSkill(msg.skill);
          break;

        // Todo messages
        case 'todosUpdated':
          setTodoList(msg.title, msg.todos);
          if (todoDisplayModeRef.current === 'inline') {
            addTodoSnapshot(msg.title, msg.todos);
          }
          break;

        case 'todosTurnComplete':
          completeTodoTurn(msg.summary);
          break;

        case 'contextMeterUpdate':
          setContextMeter(msg.data);
          break;
      }
    });

    if (isFirstLoad) {
      postMessage({ type: 'loadModels' });
      postMessage({ type: 'loadSettings' });
      postMessage({ type: 'loadProviders' });
      postMessage({ type: 'searchWorkspaceFiles', query: '' });
      postMessage({ type: 'loadChatSessions' });
      postMessage({ type: 'loadPipelines' });
      postMessage({ type: 'loadSkills' });
      setIsFirstLoad(false);
    }

    return unsubscribe;
  }, [isFirstLoad]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, parallelGroup, completedParallelGroups]);

  // Request pipeline graph data when pipeline tab opens or selection changes
  useEffect(() => {
    if (activeTab === 'pipeline') {
      postMessage({ type: 'selectPipeline', pipelineId: selectedPipelineId });
    }
  }, [activeTab, selectedPipelineId]);

  // Auto-fetch benchmarks when switching to tab for the first time
  useEffect(() => {
    if (activeTab === 'benchmarks' && !benchmarkFetched && !benchmarkLoading) {
      handleRefreshBenchmarks();
    }
  }, [activeTab]);

  // Refresh skills list when switching to skills tab
  useEffect(() => {
    if (activeTab === 'skills') {
      postMessage({ type: 'loadSkills' });
    }
  }, [activeTab]);

  const saveCurrentSession = () => {
    // Get fresh messages from store
    const currentMessages = useChatStore.getState().messages;
    if (currentMessages.length === 0) return;
    const sessionMessages: ChatSessionMessage[] = currentMessages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolName: m.toolName,
      isError: m.isError,
      timestamp: m.timestamp,
    }));
    postMessage({ type: 'saveChatSession', messages: sessionMessages });
  };

  const handleSend = (content: string, sendAttachments: Attachment[]) => {
    if (!content.trim()) return;
    addMessage({ id: Math.random().toString(36).slice(2, 11), role: 'user', content, timestamp: Date.now() });
    if (!isLoading) {
      setLoading(true);
    }
    setError(null);
    postMessage({ type: 'sendMessage', content, attachments: sendAttachments.length > 0 ? sendAttachments : undefined });
    clearAttachments();
  };

  const handleCancel = () => {
    postMessage({ type: 'cancelRequest' });
    setLoading(false);
  };

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId);
    postMessage({ type: 'selectModel', modelId });
  };

  const handleProviderChange = (providerId: string) => {
    setActiveProviderId(providerId);
    postMessage({ type: 'selectProvider', providerId });
  };

  const handleNewChat = () => {
    // Save current session before clearing
    saveCurrentSession();
    clearMessages();
    clearAttachments();
    postMessage({ type: 'newChat' });
    // Refresh sessions list
    postMessage({ type: 'loadChatSessions' });
  };

  const handleLoadSession = (sessionId: string) => {
    // Save current session first
    saveCurrentSession();
    postMessage({ type: 'loadChatSession', sessionId });
  };

  const handlePickFile = () => {
    postMessage({ type: 'pickFile' });
  };

  const handleSecurityLevelChange = (level: string) => {
    setSecurityLevel(level);
    postMessage({ type: 'setSecurityLevel', level });
  };

  const handleArchiveToggle = (enabled: boolean) => {
    setArchiveEnabled(enabled);
    postMessage({ type: 'setArchiveEnabled', enabled });
  };

  const handleWebSearchToggle = (enabled: boolean) => {
    setWebSearchEnabled(enabled);
    postMessage({ type: 'setWebSearchEnabled', enabled });
  };

  const handleModelPoolChange = (pool: string[]) => {
    setModelPool(pool);
    postMessage({ type: 'saveModelPool', modelPool: pool });
  };

  const handleAddToPool = (modelId: string) => {
    if (!modelPool.includes(modelId)) {
      const newPool = [...modelPool, modelId];
      setModelPool(newPool);
      postMessage({ type: 'addToModelPool', modelId });
    }
  };

  const handleSetDefaultModel = (modelId: string) => {
    setSelectedModel(modelId);
    postMessage({ type: 'selectModel', modelId });
  };

  const handleRefreshBenchmarks = () => {
    setBenchmarkLoading(true);
    postMessage({ type: 'refreshBenchmarks' });
  };

  const handleAskUserResponse = (response: string) => {
    if (askUserRequest) {
      postMessage({ type: 'askUserResponse', id: askUserRequest.id, response });
      setAskUser(null);
    }
  };

  const handleAskUserCancel = () => {
    if (askUserRequest) {
      postMessage({ type: 'askUserCancel', id: askUserRequest.id });
      setAskUser(null);
    }
  };

  const [debugCopied, setDebugCopied] = useState(false);

  const formatMessageForTranscript = (msg: typeof messages[0], lines: string[]) => {
    const time = new Date(msg.timestamp).toISOString();
    if (msg.role === 'user') {
      lines.push(`## User [${time}]`, '', msg.content, '');
    } else if (msg.role === 'assistant') {
      lines.push(`## Assistant [${time}]`, '', msg.content, '');
    } else if (msg.role === 'tool') {
      const label = msg.toolName || 'tool';
      const errorTag = msg.isError ? ' [ERROR]' : '';
      const argsStr = msg.toolArgs ? '\n' + JSON.stringify(msg.toolArgs, null, 2) : '';
      lines.push(`### Tool: ${label}${errorTag} [${time}]`, '', '```', `Calling: ${label}${argsStr}`, '```', '');
      if (msg.toolResult) {
        lines.push(`### Tool: ${label} [${time}]`, '', '```', msg.toolResult, '```', '');
      }
    }
  };

  const formatParallelGroupForTranscript = (group: typeof completedParallelGroups[0], lines: string[]) => {
    lines.push(`## Parallel Execution (${group.branches.length} branches)`, '');
    for (const branch of group.branches) {
      lines.push(`### Branch: ${branch.label} [${branch.status}]`, '');
      for (const msg of branch.messages) {
        formatMessageForTranscript(msg, lines);
      }
      if (branch.streamingContent) {
        lines.push(`## Assistant [streaming — ${branch.label}]`, '', branch.streamingContent, '');
      }
    }
    lines.push('---', '');
  };

  const handleCopyDebugTranscript = () => {
    const lines: string[] = ['# Chat Debug Transcript', ''];
    for (const msg of messages) {
      formatMessageForTranscript(msg, lines);
    }
    // Include completed parallel groups
    for (const group of completedParallelGroups) {
      formatParallelGroupForTranscript(group, lines);
    }
    // Include active parallel group
    if (parallelGroup) {
      formatParallelGroupForTranscript(parallelGroup, lines);
    }
    if (streamingContent) {
      lines.push(`## Assistant [streaming]`, '', streamingContent, '');
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setDebugCopied(true);
      setTimeout(() => setDebugCopied(false), 2000);
    });
  };

  // Pipeline handlers
  const handleNodeMove = (nodeId: string, position: { x: number; y: number }) => {
    setPipelineNodes(prev => prev.map(n => n.id === nodeId ? { ...n, position } : n));
  };

  const handleNodeAdd = (type: string, position: { x: number; y: number }) => {
    const id = `node-${Math.random().toString(36).slice(2, 8)}`;
    let config: Record<string, unknown> = { type };
    if (type === 'join') {
      config = { type, mergeStrategy: 'wait_all', failurePolicy: 'collect_partial' };
    }
    setPipelineNodes(prev => [...prev, {
      id, type, label: `${type.replace(/_/g, ' ')}`, position, status: 'idle', config,
    }]);
  };

  const handleEdgeAdd = (sourceId: string, targetId: string, label?: string) => {
    const id = `edge-${Math.random().toString(36).slice(2, 8)}`;
    // Auto-label edges from parallel nodes
    let edgeLabel = label;
    const sourceNode = pipelineNodes.find(n => n.id === sourceId);
    if (sourceNode?.type === 'parallel' && (!label || label === '+')) {
      const existingBranches = pipelineEdges.filter(e => e.sourceNodeId === sourceId);
      edgeLabel = `Branch ${existingBranches.length + 1}`;
    }
    setPipelineEdges(prev => [...prev, { id, sourceNodeId: sourceId, targetNodeId: targetId, label: edgeLabel }]);
  };

  const handleNodeDelete = (nodeId: string) => {
    setPipelineNodes(prev => prev.filter(n => n.id !== nodeId));
    setPipelineEdges(prev => prev.filter(e => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId));
    setSelectedNodeId(null);
  };

  const handleEdgeDelete = (edgeId: string) => {
    setPipelineEdges(prev => prev.filter(e => e.id !== edgeId));
  };

  const handleNodeConfigChange = (nodeId: string, config: Record<string, unknown>) => {
    setPipelineNodes(prev => prev.map(n => n.id === nodeId ? { ...n, config } : n));
  };

  const handleNodeLabelChange = (nodeId: string, label: string) => {
    setPipelineNodes(prev => prev.map(n => n.id === nodeId ? { ...n, label } : n));
  };

  const handleSavePipeline = (target: 'project' | 'global') => {
    const selectedPipeline = availablePipelines.find(p => p.id === selectedPipelineId);
    postMessage({
      type: 'savePipeline',
      pipeline: {
        id: selectedPipelineId,
        name: selectedPipeline?.name ?? 'Untitled',
        description: selectedPipeline?.description,
        entryNodeId: pipelineNodes[0]?.id ?? '',
        nodes: pipelineNodes,
        edges: pipelineEdges,
      },
      target,
    });
  };

  const handleNewPipeline = () => {
    postMessage({ type: 'promptNewPipeline' });
  };

  const handleClonePipeline = () => {
    // Use postMessage to ask extension host for input (prompt() doesn't work in webviews)
    postMessage({ type: 'promptClonePipeline', sourceId: selectedPipelineId });
  };

  const handleDeletePipeline = () => {
    // Use postMessage to ask extension host for confirmation (confirm() doesn't work in webviews)
    postMessage({ type: 'confirmDeletePipeline', pipelineId: selectedPipelineId });
  };

  // Is the currently selected pipeline a non-default pipeline? (for split view)
  const showPipelineSplitView = isLoading && selectedPipelineId !== 'default' && activeProviderId !== 'claude-cli';

  // Filter models for chat input based on pool.
  // Model pool only applies to OpenRouter — Claude CLI always shows all its models.
  const chatModels = modelPool.length > 0 && activeProviderId === 'openrouter'
    ? models.filter(m => modelPool.includes(m.id))
    : models;

  return (
    <div className="app">
      {/* Tab bar */}
      <div className="tab-bar">
        {(['chat', 'pipeline', 'skills', 'network', 'benchmarks', 'settings'] as Tab[])
          .filter(tab => !(tab === 'pipeline' && activeProviderId === 'claude-cli'))
          .map(tab => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'chat' ? 'Chat' :
             tab === 'pipeline' ? 'Pipeline' :
             tab === 'skills' ? 'Skills' :
             tab === 'network' ? 'Network' :
             tab === 'benchmarks' ? 'Benchmarks' : 'Settings'}
          </button>
        ))}
      </div>

      {/* Chat Tab */}
      {activeTab === 'chat' && (
        <>
          <div className="header">
            <button className="icon-btn header-icon-btn" onClick={handleNewChat} title="New Chat">
              <PlusIcon />
            </button>
            <ChatHistoryDropdown sessions={chatSessions} onLoadSession={handleLoadSession} />
            <span className="header-title">Archon</span>
            <div className="header-right">
              {indexingStatus.state === 'indexing' && (
                <span className="index-status index-status-active" title={`Indexing ${indexingStatus.filesIndexed ?? 0}/${indexingStatus.totalFiles ?? '?'} files`}>
                  Indexing {indexingStatus.filesIndexed ?? 0}/{indexingStatus.totalFiles ?? '?'}...
                </span>
              )}
              {indexingStatus.state === 'ready' && (
                <span className="index-status index-status-ready" title={`${indexingStatus.chunkCount} chunks indexed`}>
                  {indexingStatus.chunkCount} chunks
                </span>
              )}
              {indexingStatus.state === 'error' && (
                <span className="index-status index-status-error" title={indexingStatus.error ?? 'Indexing error'}>
                  Index error
                </span>
              )}
              <button
                className="icon-btn header-icon-btn"
                onClick={() => postMessage({ type: 'reindexCodebase' })}
                title="Re-index codebase"
                disabled={indexingStatus.state === 'indexing'}
                style={{ opacity: indexingStatus.state === 'indexing' ? 0.4 : 1 }}
              >
                <RefreshIcon />
              </button>
              {messages.length > 2 && !isLoading && (
                <button
                  className="icon-btn header-icon-btn"
                  onClick={() => {
                    setShowConvertWizard(true);
                    setConvertingSkill(true);
                    setGeneratedSkill(null);
                    postMessage({ type: 'generateSkillFromConversation' });
                  }}
                  title="Convert conversation to skill"
                >
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>Skill</span>
                </button>
              )}
              {messages.length > 0 && (
                <button
                  className="icon-btn header-icon-btn"
                  onClick={handleCopyDebugTranscript}
                  title={debugCopied ? 'Copied!' : 'Copy debug transcript'}
                  style={{ opacity: debugCopied ? 0.6 : 1 }}
                >
                  {debugCopied ? <span style={{ fontSize: '12px' }}>Copied</span> : <ClipboardIcon />}
                </button>
              )}
            </div>
          </div>

          {/* Pipeline progress bar when running a non-default pipeline */}
          {showPipelineSplitView && pipelineNodes.length > 0 && (
            <div className="pipeline-progress-bar">
              {pipelineNodes.map(node => {
                const statusClass = node.status === 'running' ? 'progress-running' :
                  node.status === 'completed' ? 'progress-completed' :
                  node.status === 'failed' ? 'progress-failed' :
                  node.status === 'skipped' ? 'progress-skipped' : 'progress-idle';
                return (
                  <div key={node.id} className={`progress-node ${statusClass}`} title={`${node.label} (${node.status})`}>
                    <span className="progress-node-label">{node.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pinned todo panel */}
          {todoList && todoDisplayMode === 'pinned' && (
            <TodoListWidget title={todoList.title} items={todoList.items} mode="pinned" />
          )}

          <div className="messages">
            {messages.length === 0 && !streamingContent && (
              <div className="welcome">
                <h2>Archon</h2>
                <p>AI coding assistant with full workflow control.</p>
                <p className="hint">
                  {selectedModelId
                    ? 'Type a message to get started.'
                    : 'Set your API key first: Ctrl+Shift+P \u2192 "Archon: Set OpenRouter API Key"'}
                </p>
              </div>
            )}

            {messages.map((msg) => {
              // Parallel group marker — render the completed group inline
              if (msg.toolName === '__parallel_group__') {
                const groupId = msg.id.replace('parallel-marker-', '');
                const group = completedParallelGroups.find(g => g.id === groupId);
                return group ? <ParallelBranchGroup key={msg.id} group={group} /> : null;
              }
              // Todo summary marker
              if (msg.toolName === '__todo_summary__') {
                return (
                  <div key={msg.id} className="todo-summary-msg">
                    <span className="todo-summary-icon">&#10003;</span>
                    <span>{msg.content}</span>
                  </div>
                );
              }
              // Inline todo snapshot
              if (msg.toolName === '__todo_inline__' && msg.todoItems) {
                return <TodoListWidget key={msg.id} title={msg.todoTitle} items={msg.todoItems} mode="inline" />;
              }
              return <MessageBubble key={msg.id} message={msg} />;
            })}

            {/* Render active parallel group (always at the bottom while running) */}
            {parallelGroup && (
              <ParallelBranchGroup group={parallelGroup} />
            )}

            {streamingContent && (
              <MessageBubble message={{ id: 'streaming', role: 'assistant', content: streamingContent, isStreaming: true, timestamp: Date.now() }} />
            )}

            {error && (
              <div className="error-banner">
                {error}
                <button onClick={() => setError(null)}>Dismiss</button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Floating todo overlay */}
          {todoList && todoDisplayMode === 'floating' && (
            <TodoListWidget title={todoList.title} items={todoList.items} mode="floating" />
          )}

          {showConvertWizard && (
            <ConvertToSkillWizard
              generatedSkill={generatedSkill}
              isGenerating={convertingSkill}
              onSave={(skill) => {
                postMessage({ type: 'saveSkill', skill: { ...skill, trigger: undefined, modelInvocable: true } });
                setShowConvertWizard(false);
                setGeneratedSkill(null);
              }}
              onCancel={() => {
                setShowConvertWizard(false);
                setConvertingSkill(false);
                setGeneratedSkill(null);
              }}
            />
          )}
          {askUserRequest && <AskUserDialog request={askUserRequest} onRespond={handleAskUserResponse} onCancel={handleAskUserCancel} />}
          <ChatInput
            onSend={handleSend}
            onCancel={handleCancel}
            isLoading={isLoading}
            disabled={!selectedModelId}
            models={chatModels}
            selectedModelId={selectedModelId}
            onModelChange={handleModelSelect}
            onPickFile={handlePickFile}
            workspaceFiles={workspaceFiles}
            attachments={attachments}
            onAddAttachment={addAttachment}
            onRemoveAttachment={removeAttachment}
            pipelines={availablePipelines}
            selectedPipelineId={selectedPipelineId}
            onPipelineChange={(pipelineId) => {
              setSelectedPipelineId(pipelineId);
              postMessage({ type: 'selectPipeline', pipelineId });
            }}
            providers={providers}
            activeProviderId={activeProviderId}
            onProviderChange={handleProviderChange}
            skills={skillsList.filter(s => s.enabled).map(s => ({ name: s.name, description: s.description }))}
            contextMeter={contextMeter}
            onContextCompress={() => postMessage({ type: 'compressContext' })}
            onContextReset={() => postMessage({ type: 'resetContext' })}
          />
        </>
      )}

      {/* Pipeline Tab */}
      {activeTab === 'pipeline' && (
        <div className="pipeline-tab">
          <div className="pipeline-toolbar">
            <label htmlFor="pipeline-select">Pipeline:</label>
            <select
              id="pipeline-select"
              value={selectedPipelineId}
              onChange={e => {
                setSelectedPipelineId(e.target.value);
                postMessage({ type: 'selectPipeline', pipelineId: e.target.value });
              }}
            >
              {availablePipelines.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.source !== 'builtin' ? ` (${p.source})` : ''}</option>
              ))}
              {availablePipelines.length === 0 && (
                <option value="default">Default</option>
              )}
            </select>
            <div className="pipeline-save-toolbar">
              <button onClick={handleNewPipeline} title="Create new blank pipeline">New</button>
              <button onClick={() => handleSavePipeline('project')} title="Save to project">Save</button>
              <button onClick={handleClonePipeline} title="Clone pipeline">Clone</button>
              {availablePipelines.find(p => p.id === selectedPipelineId)?.source !== 'builtin' && (
                <button onClick={handleDeletePipeline} title="Delete pipeline">Delete</button>
              )}
            </div>
          </div>
          <PipelineEditor
            nodes={pipelineNodes}
            edges={pipelineEdges}
            onNodeMove={handleNodeMove}
            onNodeSelect={setSelectedNodeId}
            onNodeAdd={handleNodeAdd}
            onEdgeAdd={handleEdgeAdd}
            onNodeDelete={handleNodeDelete}
            onEdgeDelete={handleEdgeDelete}
            onNodeConfigChange={handleNodeConfigChange}
            onNodeLabelChange={handleNodeLabelChange}
            onEnhancePrompt={(nodeId, prompt) => {
              setEnhancingNodeId(nodeId);
              postMessage({ type: 'enhancePrompt', nodeId, prompt });
            }}
            selectedNodeId={selectedNodeId}
            availableModels={chatModels.map(m => ({ id: m.id, name: m.name }))}
            availableTools={AVAILABLE_TOOLS}
            enhancingNodeId={enhancingNodeId}
          />
        </div>
      )}

      {/* Skills Tab */}
      {activeTab === 'skills' && (
        <SkillsPanel
          skills={skillsList}
          templates={skillTemplates}
          versions={skillVersions}
          versionsSkillName={skillVersionsFor}
          versionContent={skillVersionContent}
          editingSkillContent={editingSkillContent}
          editingSkillName={editingSkillName}
          onToggle={(name, enabled) => postMessage({ type: 'toggleSkill', skillName: name, enabled })}
          onDelete={(name) => postMessage({ type: 'deleteSkill', skillName: name })}
          onSave={(skill) => postMessage({ type: 'saveSkill', skill })}
          onRefresh={() => postMessage({ type: 'refreshSkills' })}
          onLoadTemplates={() => postMessage({ type: 'loadSkillTemplates' })}
          onLoadSkillContent={(name) => { setEditingSkillContent(null); setEditingSkillName(null); postMessage({ type: 'loadSkillContent', skillName: name }); }}
          onLoadVersions={(name) => postMessage({ type: 'loadSkillVersions', skillName: name })}
          onLoadVersionContent={(name, versionPath, version) => postMessage({ type: 'loadSkillVersionContent', skillName: name, versionPath, version })}
          onRestoreVersion={(name, versionPath) => postMessage({ type: 'restoreSkillVersion', skillName: name, versionPath })}
          onReorder={() => { /* order stored locally in component */ }}
        />
      )}

      {/* Network Tab */}
      {activeTab === 'network' && (
        <NetworkMonitorPanel
          requests={networkRequests}
          onClear={() => setNetworkRequests([])}
        />
      )}

      {/* Benchmarks Tab */}
      {activeTab === 'benchmarks' && (
        <BenchmarkDashboard
          sources={benchmarkSources}
          onRefresh={handleRefreshBenchmarks}
          isLoading={benchmarkLoading}
          modelPool={modelPool}
          selectedModelId={selectedModelId}
          models={models}
          onAddToPool={handleAddToPool}
          onSetDefault={handleSetDefaultModel}
        />
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <SettingsPanel
          currentModel={selectedModelId}
          securityLevel={securityLevel}
          archiveEnabled={archiveEnabled}
          onSecurityLevelChange={handleSecurityLevelChange}
          onArchiveToggle={handleArchiveToggle}
          models={models}
          modelPool={modelPool}
          onModelPoolChange={handleModelPoolChange}
          hasBraveApiKey={hasBraveApiKey}
          webSearchEnabled={webSearchEnabled}
          onWebSearchToggle={handleWebSearchToggle}
          todoDisplayMode={todoDisplayMode}
          onTodoDisplayModeChange={setTodoDisplayMode}
          claudeCliStatus={claudeCliStatus}
          claudeCliPath={claudeCliPath}
          onClaudeCliPathChange={(path) => {
            setClaudeCliPath(path);
            postMessage({ type: 'setClaudeCliPath', path });
          }}
          onCheckClaudeCliStatus={() => {
            postMessage({ type: 'setClaudeCliPath', path: claudeCliPath });
          }}
          mcpConfigPath={mcpConfigPath}
          onMcpConfigPathChange={(path) => {
            setMcpConfigPath(path);
            postMessage({ type: 'setMcpConfigPath', path });
          }}
        />
      )}
    </div>
  );
}
