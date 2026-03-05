/**
 * Settings Panel — UI for all Archon configuration.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { postMessage } from '../vscode-api';
import type { ModelInfo } from '@archon/core';

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
}: Props) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [braveKeyInput, setBraveKeyInput] = useState('');
  const [addModelSearch, setAddModelSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

      {/* API Key */}
      <section className="settings-section">
        <h4>API Key</h4>
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

      {/* Model Pool */}
      <section className="settings-section">
        <h4>Model Pool</h4>
        <p className="settings-hint">
          Models that appear in the chat dropdown. Empty pool = all models shown.
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
                  {models.length === 0 ? 'No models loaded. Set your API key first.' : 'No more models to add.'}
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
