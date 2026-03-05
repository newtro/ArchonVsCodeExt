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
import { ChatHistoryDropdown } from './components/ChatHistoryDropdown';
import { PlusIcon, ClipboardIcon, RefreshIcon } from './components/Icons';
import type { ExtensionMessage, Attachment, ChatSessionMessage, BenchmarkSource } from '@archon/core';

type Tab = 'chat' | 'pipeline' | 'network' | 'benchmarks' | 'settings';

export function App() {
  const {
    messages, isLoading, streamingContent, selectedModelId, models,
    askUserRequest, error, attachments, workspaceFiles, chatSessions,
    addMessage, appendStreamingContent, finalizeAssistantMessage,
    setLoading, setModels, setSelectedModel, setAskUser, setError, clearMessages,
    addAttachment, removeAttachment, clearAttachments, setWorkspaceFiles,
    setChatSessions, setMessages,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  // Pipeline editor state
  const [pipelineNodes, setPipelineNodes] = useState<EditorNode[]>([]);
  const [pipelineEdges, setPipelineEdges] = useState<EditorEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  // Indexing state
  const [indexingStatus, setIndexingStatus] = useState<{
    state: 'idle' | 'indexing' | 'ready' | 'error';
    filesIndexed?: number;
    totalFiles?: number;
    chunkCount?: number;
    error?: string;
  }>({ state: 'idle' });

  // Listen for messages from the extension host
  useEffect(() => {
    const unsubscribe = onMessage((msg: ExtensionMessage) => {
      switch (msg.type) {
        case 'streamToken':
          if (msg.token.type === 'text' && msg.token.content) {
            appendStreamingContent(msg.token.content);
          } else if (msg.token.type === 'error') {
            setError(msg.token.error ?? 'Unknown error');
            setLoading(false);
          }
          break;

        case 'messageComplete':
          if (msg.message.role === 'assistant') {
            finalizeAssistantMessage(msg.message.content);
          }
          // Auto-save session after each completed message
          saveCurrentSession();
          break;

        case 'toolCallStart': {
          const argsStr = msg.toolCall.arguments && Object.keys(msg.toolCall.arguments).length > 0
            ? '\n' + JSON.stringify(msg.toolCall.arguments, null, 2)
            : '';
          addMessage({
            id: msg.toolCall.id,
            role: 'tool',
            content: `Calling: ${msg.toolCall.name}${argsStr}`,
            toolName: msg.toolCall.name,
            toolCallId: msg.toolCall.id,
            timestamp: Date.now(),
          });
          break;
        }

        case 'toolCallResult': {
          // Look up tool name from the matching toolCallStart message
          const startMsg = useChatStore.getState().messages.find(
            m => m.role === 'tool' && m.toolCallId === msg.result.toolCallId && m.toolName
          );
          addMessage({
            id: Math.random().toString(36).slice(2, 11),
            role: 'tool',
            content: msg.result.content,
            toolName: startMsg?.toolName,
            toolCallId: msg.result.toolCallId,
            isError: msg.result.isError,
            timestamp: Date.now(),
          });
          break;
        }

        case 'modelsLoaded':
          setModels(msg.models);
          break;

        case 'modelChanged':
          setSelectedModel(msg.modelId);
          break;

        case 'error':
          setError(msg.error);
          setLoading(false);
          break;

        case 'askUser':
          setAskUser({ id: msg.id, prompt: msg.prompt, options: msg.options });
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

        case 'indexingStatus':
          setIndexingStatus({
            state: msg.state,
            filesIndexed: msg.filesIndexed,
            totalFiles: msg.totalFiles,
            chunkCount: msg.chunkCount,
            error: msg.error,
          });
          break;
      }
    });

    if (isFirstLoad) {
      postMessage({ type: 'loadModels' });
      postMessage({ type: 'loadSettings' });
      postMessage({ type: 'searchWorkspaceFiles', query: '' });
      postMessage({ type: 'loadChatSessions' });
      setIsFirstLoad(false);
    }

    return unsubscribe;
  }, [isFirstLoad]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Auto-fetch benchmarks when switching to tab for the first time
  useEffect(() => {
    if (activeTab === 'benchmarks' && !benchmarkFetched && !benchmarkLoading) {
      handleRefreshBenchmarks();
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
    if (!content.trim() || isLoading) return;
    addMessage({ id: Math.random().toString(36).slice(2, 11), role: 'user', content, timestamp: Date.now() });
    setLoading(true);
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

  const [debugCopied, setDebugCopied] = useState(false);

  const handleCopyDebugTranscript = () => {
    const lines: string[] = ['# Chat Debug Transcript', ''];
    for (const msg of messages) {
      const time = new Date(msg.timestamp).toISOString();
      if (msg.role === 'user') {
        lines.push(`## User [${time}]`, '', msg.content, '');
      } else if (msg.role === 'assistant') {
        lines.push(`## Assistant [${time}]`, '', msg.content, '');
      } else if (msg.role === 'tool') {
        const label = msg.toolName || 'tool';
        const errorTag = msg.isError ? ' [ERROR]' : '';
        lines.push(`### Tool: ${label}${errorTag} [${time}]`, '', '```', msg.content, '```', '');
      }
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
    setPipelineNodes(prev => [...prev, {
      id, type, label: `${type.replace(/_/g, ' ')}`, position, status: 'idle', config: { type },
    }]);
  };

  const handleEdgeAdd = (sourceId: string, targetId: string) => {
    const id = `edge-${Math.random().toString(36).slice(2, 8)}`;
    setPipelineEdges(prev => [...prev, { id, sourceNodeId: sourceId, targetNodeId: targetId }]);
  };

  const handleNodeDelete = (nodeId: string) => {
    setPipelineNodes(prev => prev.filter(n => n.id !== nodeId));
    setPipelineEdges(prev => prev.filter(e => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId));
    setSelectedNodeId(null);
  };

  // Filter models for chat input based on pool
  const chatModels = modelPool.length > 0
    ? models.filter(m => modelPool.includes(m.id))
    : models;

  return (
    <div className="app">
      {/* Tab bar */}
      <div className="tab-bar">
        {(['chat', 'pipeline', 'network', 'benchmarks', 'settings'] as Tab[]).map(tab => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'chat' ? 'Chat' :
             tab === 'pipeline' ? 'Pipeline' :
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

            {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}

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

          {askUserRequest && <AskUserDialog request={askUserRequest} onRespond={handleAskUserResponse} />}
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
          />
        </>
      )}

      {/* Pipeline Tab */}
      {activeTab === 'pipeline' && (
        <PipelineEditor
          nodes={pipelineNodes}
          edges={pipelineEdges}
          onNodeMove={handleNodeMove}
          onNodeSelect={setSelectedNodeId}
          onNodeAdd={handleNodeAdd}
          onEdgeAdd={handleEdgeAdd}
          onNodeDelete={handleNodeDelete}
          selectedNodeId={selectedNodeId}
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
        />
      )}
    </div>
  );
}
