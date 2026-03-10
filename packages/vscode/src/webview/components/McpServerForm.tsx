/**
 * MCP Server Form — add/edit MCP server configuration.
 */

import React, { useState } from 'react';
import type { McpServerConfigMsg } from '@archon/core';

interface Props {
  editingName: string | null;
  editingConfig?: McpServerConfigMsg;
  prefillName?: string;
  onSave: (name: string, config: McpServerConfigMsg, scope: 'global' | 'project') => void;
  onCancel: () => void;
}

export function McpServerForm({ editingName, editingConfig, prefillName, onSave, onCancel }: Props) {
  const [name, setName] = useState(editingName ?? prefillName ?? '');
  const [transportType, setTransportType] = useState<'stdio' | 'http'>(
    editingConfig?.url ? 'http' : 'stdio'
  );
  const [command, setCommand] = useState(editingConfig?.command ?? '');
  const [args, setArgs] = useState(editingConfig?.args?.join(', ') ?? '');
  const [envPairs, setEnvPairs] = useState(
    editingConfig?.env ? Object.entries(editingConfig.env).map(([k, v]) => `${k}=${v}`).join('\n') : ''
  );
  const [url, setUrl] = useState(editingConfig?.url ?? '');
  const [headerPairs, setHeaderPairs] = useState(
    editingConfig?.headers ? Object.entries(editingConfig.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : ''
  );
  const [timeout, setTimeout_] = useState(String(editingConfig?.timeout ?? 30000));
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Server name is required');
      return;
    }

    if (transportType === 'stdio' && !command.trim()) {
      setError('Command is required for stdio transport');
      return;
    }

    if (transportType === 'http' && !url.trim()) {
      setError('URL is required for HTTP transport');
      return;
    }

    const config: McpServerConfigMsg = {
      timeout: parseInt(timeout) || 30000,
    };

    if (transportType === 'stdio') {
      config.command = command.trim();
      config.args = args.split(',').map(a => a.trim()).filter(Boolean);
      if (envPairs.trim()) {
        config.env = {};
        for (const line of envPairs.split('\n')) {
          const eq = line.indexOf('=');
          if (eq > 0) {
            config.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
          }
        }
      }
    } else {
      config.url = url.trim();
      if (headerPairs.trim()) {
        config.headers = {};
        for (const line of headerPairs.split('\n')) {
          const colon = line.indexOf(':');
          if (colon > 0) {
            config.headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
          }
        }
      }
    }

    onSave(name.trim(), config, scope);
  };

  return (
    <div style={{
      marginTop: 12,
      padding: 12,
      border: '1px solid var(--vscode-panel-border)',
      borderRadius: 4,
      backgroundColor: 'var(--vscode-editor-background)',
    }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 13 }}>
        {editingName ? `Edit Server: ${editingName}` : 'Add MCP Server'}
      </h4>

      {error && (
        <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{error}</div>
      )}

      <div style={fieldStyle}>
        <label style={labelStyle}>Server Name</label>
        <input
          value={name}
          onChange={e => { setName(e.target.value); setError(''); }}
          disabled={!!editingName}
          placeholder="e.g., filesystem"
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Transport</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              checked={transportType === 'stdio'}
              onChange={() => setTransportType('stdio')}
            /> stdio
          </label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              checked={transportType === 'http'}
              onChange={() => setTransportType('http')}
            /> HTTP
          </label>
        </div>
      </div>

      {transportType === 'stdio' ? (
        <>
          <div style={fieldStyle}>
            <label style={labelStyle}>Command</label>
            <input
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="e.g., npx"
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Arguments (comma-separated)</label>
            <input
              value={args}
              onChange={e => setArgs(e.target.value)}
              placeholder="e.g., -y, @modelcontextprotocol/server-filesystem, /path"
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Environment Variables (KEY=VALUE, one per line)</label>
            <textarea
              value={envPairs}
              onChange={e => setEnvPairs(e.target.value)}
              placeholder={"API_KEY=${env:MY_API_KEY}"}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }}
            />
          </div>
        </>
      ) : (
        <>
          <div style={fieldStyle}>
            <label style={labelStyle}>URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://api.example.com/mcp"
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Headers (Key: Value, one per line)</label>
            <textarea
              value={headerPairs}
              onChange={e => setHeaderPairs(e.target.value)}
              placeholder="Authorization: Bearer ..."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }}
            />
          </div>
        </>
      )}

      <div style={fieldStyle}>
        <label style={labelStyle}>Timeout (ms)</label>
        <input
          value={timeout}
          onChange={e => setTimeout_(e.target.value)}
          type="number"
          style={{ ...inputStyle, width: 120 }}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Scope</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              checked={scope === 'global'}
              onChange={() => setScope('global')}
            /> Global
          </label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              checked={scope === 'project'}
              onChange={() => setScope('project')}
            /> Project
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={handleSubmit} style={saveBtnStyle}>
          {editingName ? 'Update' : 'Add'} Server
        </button>
        <button onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = { marginBottom: 8 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginBottom: 3 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  fontSize: 12,
  backgroundColor: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border)',
  borderRadius: 3,
  boxSizing: 'border-box' as const,
};
const saveBtnStyle: React.CSSProperties = {
  padding: '4px 16px',
  fontSize: 12,
  backgroundColor: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '4px 16px',
  fontSize: 12,
  backgroundColor: 'transparent',
  color: 'var(--vscode-foreground)',
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 3,
  cursor: 'pointer',
};
