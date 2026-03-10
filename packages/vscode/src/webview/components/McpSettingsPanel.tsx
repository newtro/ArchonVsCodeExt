/**
 * MCP Settings Panel — server management UI.
 * Shows server list with status, add/edit/remove, enable/disable/restart.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { postMessage, onMessage } from '../vscode-api';
import type { McpServerInfo, McpToolInfo } from '@archon/core';
import { McpServerForm } from './McpServerForm';
import { McpToolList } from './McpToolList';

export function McpSettingsPanel() {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, McpToolInfo[]>>({});
  const [showInstallInput, setShowInstallInput] = useState(false);
  const [installUrl, setInstallUrl] = useState('');
  const [installLoading, setInstallLoading] = useState(false);
  const [installError, setInstallError] = useState('');
  const [prefillConfig, setPrefillConfig] = useState<{ name?: string; config?: import('@archon/core').McpServerConfigMsg } | null>(null);

  useEffect(() => {
    postMessage({ type: 'loadMcpServers' });

    const unsub = onMessage((msg) => {
      if (msg.type === 'mcpServersLoaded' || msg.type === 'mcpStatusChanged') {
        setServers(msg.servers);
      } else if (msg.type === 'mcpToolsLoaded') {
        setServerTools(prev => ({ ...prev, [msg.serverName]: msg.tools }));
      } else if (msg.type === 'mcpInstallResult') {
        setInstallLoading(false);
        if (msg.error) {
          setInstallError(msg.error);
        } else if (msg.config) {
          setPrefillConfig({ name: msg.name, config: msg.config });
          setShowInstallInput(false);
          setInstallUrl('');
          setShowAddForm(true);
          setEditingServer(null);
        }
      }
    });

    return unsub;
  }, []);

  const handleRestart = useCallback((name: string) => {
    postMessage({ type: 'restartMcpServer', name });
  }, []);

  const handleToggle = useCallback((name: string, disabled: boolean) => {
    if (disabled) {
      postMessage({ type: 'enableMcpServer', name });
    } else {
      postMessage({ type: 'disableMcpServer', name });
    }
  }, []);

  const handleRemove = useCallback((name: string) => {
    postMessage({ type: 'removeMcpServer', name, scope: 'global' });
  }, []);

  const handleInstallFromRepo = useCallback(() => {
    if (!installUrl.trim()) return;
    setInstallLoading(true);
    setInstallError('');
    postMessage({ type: 'installMcpFromRepo', url: installUrl.trim() });
  }, [installUrl]);

  const handleExpand = useCallback((name: string) => {
    if (expandedServer === name) {
      setExpandedServer(null);
    } else {
      setExpandedServer(name);
      postMessage({ type: 'loadMcpTools', serverName: name });
    }
  }, [expandedServer]);

  const statusIndicator = (status: string) => {
    const colors: Record<string, string> = {
      connected: '#22c55e',
      connecting: '#eab308',
      error: '#ef4444',
      disconnected: '#6b7280',
    };
    return (
      <span style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: colors[status] ?? '#6b7280',
        marginRight: 8,
      }} />
    );
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>MCP Servers</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowInstallInput(prev => !prev)}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              backgroundColor: 'transparent',
              color: 'var(--vscode-foreground)',
              border: '1px solid var(--vscode-panel-border)',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            Install from Repo
          </button>
          <button
            onClick={() => { setShowAddForm(true); setEditingServer(null); setPrefillConfig(null); }}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              backgroundColor: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            + Add Server
          </button>
        </div>
      </div>

      {/* Install from repository */}
      {showInstallInput && (
        <div style={{
          marginBottom: 12,
          padding: 12,
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 4,
          backgroundColor: 'var(--vscode-editor-background)',
        }}>
          <div style={{ fontSize: 12, marginBottom: 8, color: 'var(--vscode-descriptionForeground)' }}>
            Paste a GitHub URL or npm package name. The LLM will read the README and extract the server configuration for you to review.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={installUrl}
              onChange={e => { setInstallUrl(e.target.value); setInstallError(''); }}
              placeholder="e.g., https://github.com/org/mcp-server or @org/mcp-server"
              disabled={installLoading}
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: 12,
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: 3,
              }}
              onKeyDown={e => { if (e.key === 'Enter') handleInstallFromRepo(); }}
            />
            <button
              onClick={handleInstallFromRepo}
              disabled={installLoading || !installUrl.trim()}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                backgroundColor: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
                border: 'none',
                borderRadius: 3,
                cursor: installLoading ? 'wait' : 'pointer',
                opacity: installLoading || !installUrl.trim() ? 0.6 : 1,
              }}
            >
              {installLoading ? 'Analyzing...' : 'Install'}
            </button>
            <button
              onClick={() => { setShowInstallInput(false); setInstallUrl(''); setInstallError(''); }}
              style={{
                padding: '4px 8px',
                fontSize: 12,
                backgroundColor: 'transparent',
                color: 'var(--vscode-foreground)',
                border: '1px solid var(--vscode-panel-border)',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          {installError && (
            <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{installError}</div>
          )}
        </div>
      )}

      {servers.length === 0 && !showAddForm && (
        <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 12, padding: '8px 0' }}>
          No MCP servers configured. Click "Add Server" to connect an MCP server.
        </div>
      )}

      {/* Server list */}
      {servers.map(server => (
        <div key={server.name} style={{
          marginBottom: 8,
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 4,
          overflow: 'hidden',
        }}>
          {/* Server header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 12px',
              backgroundColor: 'var(--vscode-editor-background)',
              cursor: 'pointer',
              gap: 8,
            }}
            onClick={() => handleExpand(server.name)}
          >
            {statusIndicator(server.status)}
            <span style={{ fontWeight: 500, fontSize: 13, flex: 1 }}>{server.name}</span>
            <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
              {server.transport === 'stdio' ? 'stdio' : 'HTTP'}
            </span>
            {server.status === 'connected' && (
              <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
                {server.toolCount} tools
              </span>
            )}
            {server.status === 'error' && server.error && (
              <span style={{ fontSize: 11, color: '#ef4444', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {server.error}
              </span>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => handleToggle(server.name, !!server.disabled)}
                title={server.disabled ? 'Enable' : 'Disable'}
                style={actionBtnStyle}
              >
                {server.disabled ? '▶' : '⏸'}
              </button>
              <button
                onClick={() => handleRestart(server.name)}
                title="Restart"
                style={actionBtnStyle}
              >
                ↻
              </button>
              <button
                onClick={() => { setEditingServer(server.name); setShowAddForm(true); }}
                title="Edit"
                style={actionBtnStyle}
              >
                ✎
              </button>
              <button
                onClick={() => handleRemove(server.name)}
                title="Remove"
                style={{ ...actionBtnStyle, color: '#ef4444' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Expanded tool list */}
          {expandedServer === server.name && server.status === 'connected' && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--vscode-panel-border)' }}>
              <McpToolList
                tools={serverTools[server.name] ?? []}
                serverName={server.name}
              />
            </div>
          )}
        </div>
      ))}

      {/* Add/Edit form */}
      {showAddForm && (
        <McpServerForm
          editingName={editingServer}
          editingConfig={editingServer
            ? servers.find(s => s.name === editingServer)?.config
            : prefillConfig?.config}
          prefillName={prefillConfig?.name}
          onSave={(name, config, scope) => {
            if (editingServer) {
              postMessage({ type: 'updateMcpServer', name, config, scope });
            } else {
              postMessage({ type: 'addMcpServer', name, config, scope });
            }
            setShowAddForm(false);
            setEditingServer(null);
            setPrefillConfig(null);
          }}
          onCancel={() => { setShowAddForm(false); setEditingServer(null); setPrefillConfig(null); }}
        />
      )}
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 12,
  backgroundColor: 'transparent',
  color: 'var(--vscode-foreground)',
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 3,
  cursor: 'pointer',
  lineHeight: 1,
};
