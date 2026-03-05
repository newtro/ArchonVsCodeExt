/**
 * GlassWire-style Network Monitor Panel — shows all outbound requests.
 */

import React from 'react';

export interface NetworkRequestUI {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  payloadSize: number;
  responseStatus?: number;
  duration?: number;
  status: string;
  threatLevel: string;
  source: string;
}

interface Props {
  requests: NetworkRequestUI[];
  onClear: () => void;
}

export function NetworkMonitorPanel({ requests, onClear }: Props) {
  return (
    <div className="network-monitor">
      <div className="network-header">
        <h3>Network Monitor</h3>
        <span className="network-count">{requests.length} requests</span>
        <button className="network-clear" onClick={onClear}>Clear</button>
      </div>

      <div className="network-list">
        {requests.length === 0 ? (
          <div className="network-empty">No network requests yet.</div>
        ) : (
          requests.map(req => (
            <div key={req.id} className={`network-item threat-${req.threatLevel}`}>
              <div className="network-item-header">
                <span className={`network-method method-${req.method.toLowerCase()}`}>
                  {req.method}
                </span>
                <span className="network-host">{req.host}</span>
                <span className={`network-status status-${req.status}`}>
                  {req.responseStatus ?? req.status}
                </span>
                <span className="network-time">
                  {req.duration ? `${req.duration}ms` : '...'}
                </span>
              </div>
              <div className="network-item-details">
                <span className="network-url" title={req.url}>
                  {req.url.length > 80 ? req.url.slice(0, 77) + '...' : req.url}
                </span>
                <span className="network-meta">
                  {formatBytes(req.payloadSize)} | {req.source} | {formatTime(req.timestamp)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}
