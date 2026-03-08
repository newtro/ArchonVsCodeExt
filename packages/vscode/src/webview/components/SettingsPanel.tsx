/**
 * Settings Panel — UI for all Archon configuration.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { postMessage } from '../vscode-api';
import type { ModelInfo, MemoryModelConfig, MemoryAvailableProvider } from '@archon/core';

interface Props {
  currentModel: string;
  securityLevel: string;
  archiveEnabled: boolean;
  onSecurityLevelChange: (level: string) => void;
  onArchiveToggle: (enabled: boolean) => void;
  models: ModelInfo[];
  modelPool: string[];
  onModelPoolChange: (pool: string[]) => void;
  hasBraveApiKey: boolean;
  webSearchEnabled: boolean;
  onWebSearchToggle: (enabled: boolean) => void;
  todoDisplayMode: 'pinned' | 'inline' | 'floating';
  onTodoDisplayModeChange: (mode: 'pinned' | 'inline' | 'floating') => void;
  claudeCliStatus?: { installed: boolean; authenticated: boolean; version?: string; error?: string };
  claudeCliPath: string;
  onClaudeCliPathChange: (path: string) => void;
  onCheckClaudeCliStatus: () => void;
  mcpConfigPath: string;
  onMcpConfigPathChange: (path: string) => void;
  openaiAuthStatus?: { mode: string; authenticated: boolean; planType?: string; email?: string; error?: string };
  memoryModelConfig?: MemoryModelConfig | null;
  memoryModelStatus?: { configured: boolean; provider?: string; model?: string; error?: string };
  memoryAvailableProviders: MemoryAvailableProvider[];
}

export function SettingsPanel({
  currentModel,
  securityLevel,
  archiveEnabled,
  onSecurityLevelChange,
  onArchiveToggle,
  models,
  modelPool,
  onModelPoolChange,
  hasBraveApiKey,
  webSearchEnabled,
  onWebSearchToggle,
  todoDisplayMode,
  onTodoDisplayModeChange,
  claudeCliStatus,
  claudeCliPath,
  onClaudeCliPathChange,
  onCheckClaudeCliStatus,
  mcpConfigPath,
  onMcpConfigPathChange,
  openaiAuthStatus,
  memoryModelConfig,
  memoryModelStatus,
  memoryAvailableProviders,
}: Props) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [braveKeyInput, setBraveKeyInput] = useState('');
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [openaiAuthMode, setOpenaiAuthMode] = useState<'api-key' | 'subscription'>(
    (openaiAuthStatus?.mode as 'api-key' | 'subscription') ?? 'api-key'
  );
  const [addModelSearch, setAddModelSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Memory model state
  const [memProvider, setMemProvider] = useState<string>(memoryModelConfig?.provider ?? '');
  const [memModelId, setMemModelId] = useState(memoryModelConfig?.modelId ?? '');
  const [memBaseUrl, setMemBaseUrl] = useState(memoryModelConfig?.baseUrl ?? 'http://localhost:11434');
  const [memTestResult, setMemTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [memTesting, setMemTesting] = useState(false);
  const memConfigLoaded = useRef(false);

  // Sync auth mode when status comes in from extension
  useEffect(() => {
    if (openaiAuthStatus?.mode === 'api-key' || openaiAuthStatus?.mode === 'subscription') {
      setOpenaiAuthMode(openaiAuthStatus.mode);
    }
  }, [openaiAuthStatus?.mode]);

  // Sync memory config from extension (initial load and subsequent updates)
  useEffect(() => {
    if (memoryModelConfig) {
      setMemProvider(memoryModelConfig.provider);
      setMemModelId(memoryModelConfig.modelId);
      if (memoryModelConfig.baseUrl) setMemBaseUrl(memoryModelConfig.baseUrl);
      // Mark as loaded so auto-save skips the initial sync round
      if (!memConfigLoaded.current) {
        // Defer setting the flag so the auto-save effect triggered by the
        // state updates above still sees loaded=false and skips.
        requestAnimationFrame(() => { memConfigLoaded.current = true; });
      }
    }
  }, [memoryModelConfig]);

  const handleSetApiKey = () => {
    if (apiKeyInput.trim()) {
      postMessage({ type: 'setApiKey', key: apiKeyInput.trim() });
      setApiKeyInput('');
    }
  };

  const handleSetBraveApiKey = () => {
    postMessage({ type: 'setBraveApiKey', key: braveKeyInput.trim() });
    setBraveKeyInput('');
  };

  const handleSetOpenAIApiKey = () => {
    if (openaiKeyInput.trim()) {
      postMessage({ type: 'setOpenAIApiKey', key: openaiKeyInput.trim() });
      setOpenaiKeyInput('');
    }
  };

  const handleOpenAIAuthModeChange = (mode: 'api-key' | 'subscription') => {
    setOpenaiAuthMode(mode);
    postMessage({ type: 'setOpenAIAuthMode', mode });
  };

  const handleStartOpenAIOAuth = () => {
    postMessage({ type: 'startOpenAIOAuth' });
  };

  const handleDisconnectOpenAI = () => {
    postMessage({ type: 'disconnectOpenAI' });
  };

  // When available providers load and no saved config exists, auto-select the first.
  useEffect(() => {
    if (memoryModelConfig?.provider) return;
    if (!memProvider && memoryAvailableProviders.length > 0) {
      const first = memoryAvailableProviders[0];
      setMemProvider(first.id);
      if (!memModelId && first.models.length > 0) {
        setMemModelId(first.models[0]);
      }
      // No saved config — allow auto-save to persist the auto-selected defaults
      memConfigLoaded.current = true;
    }
  }, [memoryAvailableProviders, memoryModelConfig]);

  const selectedProviderModels = useMemo(() => {
    return memoryAvailableProviders.find(p => p.id === memProvider)?.models ?? [];
  }, [memoryAvailableProviders, memProvider]);

  // Auto-save memory model config whenever provider, model, or base URL changes.
  // Skip until after the initial config has been loaded from the extension to
  // avoid overwriting saved config with auto-selected defaults.
  useEffect(() => {
    if (!memConfigLoaded.current) return;
    if (!memProvider || !memModelId) return;
    postMessage({
      type: 'setMemoryModelConfig',
      config: {
        provider: memProvider,
        modelId: memModelId,
        baseUrl: memProvider === 'ollama' ? memBaseUrl : undefined,
      },
    });
    setMemTestResult(null);
  }, [memProvider, memModelId, memBaseUrl]);

  const handleTestMemoryModel = useCallback(() => {
    setMemTesting(true);
    setMemTestResult(null);
    postMessage({ type: 'testMemoryModel' });
  }, []);

  // Listen for test result
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'memoryTestResult') {
        setMemTesting(false);
        setMemTestResult({ ok: msg.ok, error: msg.error });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Models not yet in the pool, filtered by search
  const availableModels = useMemo(() => {
    const poolSet = new Set(modelPool);
    let available = models.filter(m => !poolSet.has(m.id));
    if (addModelSearch.trim()) {
      const q = addModelSearch.toLowerCase();
      available = available.filter(m =>
        m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
      );
    }
    return available;
  }, [models, modelPool, addModelSearch]);

  // Selected models with full info
  const selectedModels = useMemo(() => {
    const modelMap = new Map(models.map(m => [m.id, m]));
    return modelPool.map(id => modelMap.get(id)).filter(Boolean) as ModelInfo[];
  }, [models, modelPool]);

  const handleAddModel = (modelId: string) => {
    onModelPoolChange([...modelPool, modelId]);
    setAddModelSearch('');
    setDropdownOpen(false);
  };

  const handleRemoveModel = (modelId: string) => {
    onModelPoolChange(modelPool.filter(id => id !== modelId));
  };

  const handleClearAll = () => {
    onModelPoolChange([]);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="settings-panel">
      <h3>Settings</h3>

      {/* OpenRouter API Key */}
      <section className="settings-section">
        <h4>OpenRouter API Key</h4>
        <div className="settings-row">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="sk-or-..."
            className="settings-input"
          />
          <button onClick={handleSetApiKey} className="settings-btn">Save</button>
        </div>
        <p className="settings-hint">Stored securely in VS Code SecretStorage.</p>
      </section>

      {/* Claude CLI */}
      <section className="settings-section">
        <h4>Claude Code CLI</h4>
        <p className="settings-hint">
          Use your Claude Pro/Max subscription through the official Claude Code CLI.
          Install it from <a href="https://docs.anthropic.com/en/docs/claude-code/overview" target="_blank" rel="noopener">docs.anthropic.com</a>.
        </p>
        <div className="settings-row">
          <input
            type="text"
            value={claudeCliPath}
            onChange={(e) => onClaudeCliPathChange(e.target.value)}
            placeholder="claude (or full path)"
            className="settings-input"
          />
          <button onClick={onCheckClaudeCliStatus} className="settings-btn">Check</button>
        </div>
        {claudeCliStatus && (
          <div className={`cli-status ${claudeCliStatus.installed && claudeCliStatus.authenticated ? 'cli-status-ok' : 'cli-status-warn'}`}>
            {claudeCliStatus.installed
              ? claudeCliStatus.authenticated
                ? `Connected (v${claudeCliStatus.version ?? 'unknown'})`
                : 'Installed but not authenticated. Run: claude auth login'
              : claudeCliStatus.error ?? 'Not found. Install Claude Code CLI first.'}
          </div>
        )}
        <h4 style={{ marginTop: '12px' }}>MCP Config (optional)</h4>
        <p className="settings-hint">
          Path to an MCP server config JSON file. Passed to Claude CLI via --mcp-config.
        </p>
        <div className="settings-row">
          <input
            type="text"
            value={mcpConfigPath}
            onChange={(e) => onMcpConfigPathChange(e.target.value)}
            placeholder="/path/to/mcp-config.json"
            className="settings-input"
          />
        </div>
      </section>

      {/* OpenAI */}
      <section className="settings-section">
        <h4>OpenAI</h4>
        <p className="settings-hint">
          Use OpenAI models (GPT-4.1, o3, o4-mini, etc.) via API key or ChatGPT subscription.
        </p>

        <div className="settings-radio-group" style={{ marginBottom: '8px' }}>
          <label className="settings-radio">
            <input
              type="radio"
              name="openaiAuth"
              value="api-key"
              checked={openaiAuthMode === 'api-key'}
              onChange={() => handleOpenAIAuthModeChange('api-key')}
            />
            <span className="radio-label">API Key</span>
            <span className="radio-desc">Pay-as-you-go with an OpenAI API key.</span>
          </label>
          <label className="settings-radio">
            <input
              type="radio"
              name="openaiAuth"
              value="subscription"
              checked={openaiAuthMode === 'subscription'}
              onChange={() => handleOpenAIAuthModeChange('subscription')}
            />
            <span className="radio-label">ChatGPT Subscription</span>
            <span className="radio-desc">Use your Plus/Pro/Team/Enterprise plan.</span>
          </label>
        </div>

        {openaiAuthMode === 'api-key' ? (
          <div>
            <div className="settings-row">
              <input
                type="password"
                value={openaiKeyInput}
                onChange={(e) => setOpenaiKeyInput(e.target.value)}
                placeholder="sk-..."
                className="settings-input"
              />
              <button onClick={handleSetOpenAIApiKey} className="settings-btn">Save</button>
            </div>
            <p className="settings-hint">Stored securely in VS Code SecretStorage.</p>
          </div>
        ) : (
          <div>
            {openaiAuthStatus?.authenticated && openaiAuthStatus.mode === 'subscription' ? (
              <div>
                <div className="cli-status cli-status-ok">
                  Connected{openaiAuthStatus.planType ? ` (${openaiAuthStatus.planType} plan)` : ''}
                  {openaiAuthStatus.email ? ` — ${openaiAuthStatus.email}` : ''}
                </div>
                <button onClick={handleDisconnectOpenAI} className="settings-btn" style={{ marginTop: '6px' }}>
                  Disconnect
                </button>
              </div>
            ) : (
              <div>
                <button onClick={handleStartOpenAIOAuth} className="settings-btn">
                  Sign in with ChatGPT
                </button>
                {openaiAuthStatus?.error && (
                  <div className="cli-status cli-status-warn" style={{ marginTop: '6px' }}>
                    {openaiAuthStatus.error}
                  </div>
                )}
                <p className="settings-hint" style={{ marginTop: '6px' }}>
                  Opens a browser window to authenticate with your ChatGPT account.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Memory Model */}
      <section className="settings-section">
        <h4>Memory Model</h4>
        <p className="settings-hint">
          Small LLM used for session summarization, edit pattern extraction, and context compression.
          Uses your existing provider API keys — no separate key needed.
        </p>

        {memoryAvailableProviders.length === 0 ? (
          <div className="cli-status cli-status-warn">
            No providers configured. Add an OpenRouter API key, OpenAI API key, or start Ollama above, then return here.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '8px' }}>
              <label className="settings-label">Provider</label>
              <select
                className="settings-select"
                value={memProvider}
                onChange={(e) => {
                  const prov = e.target.value;
                  setMemProvider(prov);
                  setMemTestResult(null);
                  const provModels = memoryAvailableProviders.find(p => p.id === prov)?.models ?? [];
                  if (provModels.length > 0) setMemModelId(provModels[0]);
                }}
              >
                {memoryAvailableProviders.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '8px' }}>
              <label className="settings-label">Model</label>
              <select
                className="settings-select"
                value={memModelId}
                onChange={(e) => setMemModelId(e.target.value)}
              >
                {selectedProviderModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {memProvider === 'openai' && openaiAuthStatus?.mode === 'subscription' && (
                <p className="settings-hint" style={{ marginTop: '4px', opacity: 0.8 }}>
                  Using ChatGPT subscription — only subscription-supported models are shown.
                </p>
              )}
            </div>

            {memProvider === 'ollama' && (
              <div style={{ marginBottom: '8px' }}>
                <label className="settings-label">Base URL</label>
                <input
                  type="text"
                  value={memBaseUrl}
                  onChange={(e) => setMemBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="settings-input"
                />
              </div>
            )}

            <div className="settings-row">
              <button onClick={handleTestMemoryModel} className="settings-btn" disabled={memTesting}>
                {memTesting ? 'Testing...' : 'Test'}
              </button>
            </div>

            {memTestResult && (
              <div className={`cli-status ${memTestResult.ok ? 'cli-status-ok' : 'cli-status-warn'}`}>
                {memTestResult.ok ? 'Connection successful' : `Error: ${memTestResult.error}`}
              </div>
            )}
          </>
        )}

        {memoryModelStatus && (
          <p className="settings-hint" style={{ marginTop: '4px' }}>
            {memoryModelStatus.configured
              ? `Active: ${memoryModelStatus.provider}/${memoryModelStatus.model}`
              : 'Not configured — auto-summarization and edit tracking are disabled.'}
          </p>
        )}
      </section>

      {/* Web Search */}
      <section className="settings-section">
        <h4>Web Search</h4>

        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={webSearchEnabled}
            onChange={(e) => onWebSearchToggle(e.target.checked)}
          />
          Enable OpenRouter native web search
        </label>
        <p className="settings-hint">
          Uses each provider's built-in search (Anthropic, OpenAI, xAI, Perplexity).
          Billed through your OpenRouter API key. Best quality results.
        </p>

        <h4 style={{ marginTop: '12px' }}>Tool Search (Brave / DuckDuckGo)</h4>
        <p className="settings-hint">
          {hasBraveApiKey ? 'Brave Search is active for tool calls.' : 'Using DuckDuckGo for tool calls (default).'}
          {' '}Used when the model calls the web_search tool directly.
          {' '}Optional: add a Brave Search API key for better results (free at api.search.brave.com).
        </p>
        <div className="settings-row">
          <input
            type="password"
            value={braveKeyInput}
            onChange={(e) => setBraveKeyInput(e.target.value)}
            placeholder={hasBraveApiKey ? '••••••••' : 'Brave API Key (optional)'}
            className="settings-input"
          />
          <button onClick={handleSetBraveApiKey} className="settings-btn">
            {braveKeyInput.trim() ? 'Save' : hasBraveApiKey ? 'Clear' : 'Save'}
          </button>
        </div>
      </section>

      {/* Current Model */}
      <section className="settings-section">
        <h4>Current Model</h4>
        <p className="settings-value">{currentModel || 'None selected'}</p>
      </section>

      {/* Security Level */}
      <section className="settings-section">
        <h4>Security Level</h4>
        <div className="settings-radio-group">
          {([
            { id: 'yolo', desc: 'No confirmation for anything — full auto-approve.' },
            { id: 'permissive', desc: 'Auto-approve most commands, confirm destructive ones.' },
            { id: 'standard', desc: 'Auto-approve reads, confirm writes and commands.' },
            { id: 'strict', desc: 'Confirm everything. Full sandbox, complete audit log.' },
          ] as const).map(({ id, desc }) => (
            <label key={id} className="settings-radio">
              <input
                type="radio"
                name="security"
                value={id}
                checked={securityLevel === id}
                onChange={() => onSecurityLevelChange(id)}
              />
              <span className="radio-label">{id}</span>
              <span className="radio-desc">{desc}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Interaction Archive */}
      <section className="settings-section">
        <h4>Interaction Archive</h4>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={archiveEnabled}
            onChange={(e) => onArchiveToggle(e.target.checked)}
          />
          Enable interaction archive (stores all messages for semantic search)
        </label>
      </section>

      {/* Todo Display Mode */}
      <section className="settings-section">
        <h4>Todo List Display</h4>
        <p className="settings-hint">How the agent's task list is shown during multi-step work.</p>
        <div className="settings-radio-group">
          {([
            { id: 'pinned' as const, desc: 'Fixed panel above the chat messages.' },
            { id: 'inline' as const, desc: 'Appears in the chat message stream.' },
            { id: 'floating' as const, desc: 'Floating overlay in the bottom-right corner.' },
          ]).map(({ id, desc }) => (
            <label key={id} className="settings-radio">
              <input
                type="radio"
                name="todoDisplay"
                value={id}
                checked={todoDisplayMode === id}
                onChange={() => onTodoDisplayModeChange(id)}
              />
              <span className="radio-label">{id}</span>
              <span className="radio-desc">{desc}</span>
            </label>
          ))}
        </div>
      </section>

      {/* OpenRouter Model Pool */}
      <section className="settings-section">
        <h4>OpenRouter Model Pool</h4>
        <p className="settings-hint">
          Filter the OpenRouter model list to a shorter set. Empty pool = all OpenRouter models shown.
          Does not affect Claude CLI or OpenAI model lists.
        </p>

        {/* Add model dropdown */}
        <div className="model-pool-add" ref={dropdownRef}>
          <input
            type="text"
            value={addModelSearch}
            onChange={(e) => { setAddModelSearch(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            placeholder="Search and add a model..."
            className="settings-input model-pool-search"
          />
          {dropdownOpen && (
            <div className="model-pool-dropdown">
              {availableModels.length === 0 ? (
                <div className="model-pool-empty">
                  {models.length === 0 ? 'No models loaded. Set your OpenRouter API key first.' : 'No more models to add.'}
                </div>
              ) : (
                availableModels.slice(0, 50).map(m => (
                  <div
                    key={m.id}
                    className="model-pool-dropdown-item"
                    onClick={() => handleAddModel(m.id)}
                  >
                    <span className="model-pool-name">{m.name}</span>
                    {m.pricing && (
                      <span className="model-pool-price">
                        ${m.pricing.prompt.toFixed(2)}/${m.pricing.completion.toFixed(2)}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Selected models list */}
        {selectedModels.length > 0 && (
          <>
            <div className="model-pool-header">
              <span className="model-pool-count">{selectedModels.length} selected</span>
              <button onClick={handleClearAll} className="settings-btn-sm">Clear All</button>
            </div>
            <div className="model-pool-list">
              {selectedModels.map(m => (
                <div key={m.id} className="model-pool-item selected">
                  <span className="model-pool-name">{m.name}</span>
                  {m.pricing && (
                    <span className="model-pool-price">
                      ${m.pricing.prompt.toFixed(2)}/${m.pricing.completion.toFixed(2)}
                    </span>
                  )}
                  <button
                    className="model-pool-remove"
                    onClick={() => handleRemoveModel(m.id)}
                    title="Remove from pool"
                  >×</button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
