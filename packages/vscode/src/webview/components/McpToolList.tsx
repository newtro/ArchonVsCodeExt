/**
 * MCP Tool List — per-server tool/resource/prompt listing with toggles.
 */

import React from 'react';
import { postMessage } from '../vscode-api';
import type { McpToolInfo } from '@archon/core';

const SUSPICIOUS_PATTERNS = [
  /you must/i,
  /always /i,
  /ignore previous/i,
  /forget/i,
  /override/i,
  /system prompt/i,
];

const DESCRIPTION_LENGTH_WARNING = 500;

interface Props {
  tools: McpToolInfo[];
  serverName: string;
}

export function McpToolList({ tools, serverName }: Props) {
  if (tools.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)', padding: '4px 0' }}>
        No tools available from this server.
      </div>
    );
  }

  const handleAlwaysLoad = (toolName: string, enabled: boolean) => {
    postMessage({ type: 'setMcpToolAlwaysLoad', toolName, enabled });
  };

  const handleAlwaysAllow = (toolName: string, enabled: boolean) => {
    postMessage({ type: 'setMcpToolAlwaysAllow', serverName, toolName, enabled });
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginBottom: 8 }}>
        {tools.length} tool{tools.length !== 1 ? 's' : ''} available
      </div>

      {tools.map(tool => {
        const isSuspicious = SUSPICIOUS_PATTERNS.some(p => p.test(tool.description));
        const isLong = tool.description.length > DESCRIPTION_LENGTH_WARNING;

        return (
          <div
            key={tool.name}
            style={{
              padding: '6px 8px',
              marginBottom: 4,
              borderRadius: 3,
              backgroundColor: 'var(--vscode-list-hoverBackground)',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: 11 }}>
                {tool.originalName}
              </span>
              {tool.deferred && (
                <span style={{ fontSize: 10, padding: '1px 4px', borderRadius: 2, backgroundColor: 'var(--vscode-badge-background)', color: 'var(--vscode-badge-foreground)' }}>
                  deferred
                </span>
              )}
              {(isSuspicious || isLong) && (
                <span
                  title={
                    isSuspicious
                      ? 'This tool description contains instruction-like text that could be a prompt injection attempt'
                      : 'This tool has an unusually long description'
                  }
                  style={{ fontSize: 12, cursor: 'help' }}
                >
                  ⚠️
                </span>
              )}
              <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', marginLeft: 'auto' }}>
                ~{tool.tokenEstimate} tokens
              </span>
            </div>

            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginTop: 2, lineHeight: 1.4 }}>
              {tool.description.length > 200
                ? tool.description.slice(0, 200) + '...'
                : tool.description}
            </div>

            {tool.paramCount > 0 && (
              <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', marginTop: 2 }}>
                {tool.paramCount} parameter{tool.paramCount !== 1 ? 's' : ''}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={tool.alwaysLoad}
                  onChange={e => handleAlwaysLoad(tool.name, e.target.checked)}
                />
                Always Load
              </label>
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={tool.alwaysAllow}
                  onChange={e => handleAlwaysAllow(tool.originalName, e.target.checked)}
                />
                Always Allow
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
