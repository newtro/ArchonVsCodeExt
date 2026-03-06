/**
 * ContextMeter — compact token budget visualization in the chat input area.
 *
 * Shows a thin progress bar indicating context utilization.
 * Hover: tooltip with token breakdown by category.
 * Click: opens a detailed modal with health score, category breakdown, and timeline.
 */

import React, { useState, useRef, useEffect } from 'react';
import type { ContextMeterData } from '@archon/core';

export type { ContextMeterData } from '@archon/core';

interface Props {
  data: ContextMeterData | null;
  onCompress?: () => void;
  onReset?: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  system_prompt: '#6b7280',
  rules: '#8b5cf6',
  dependencies: '#06b6d4',
  repo_map: '#10b981',
  code_context: '#3b82f6',
  session_memory: '#f59e0b',
  conversation: '#ef4444',
  current_turn: '#ec4899',
  reserved: '#374151',
};

const CATEGORY_LABELS: Record<string, string> = {
  system_prompt: 'System',
  rules: 'Rules',
  dependencies: 'Deps',
  repo_map: 'Repo Map',
  code_context: 'Code',
  session_memory: 'Memory',
  conversation: 'Chat',
  current_turn: 'Turn',
  reserved: 'Reserved',
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function getBarColor(utilization: number): string {
  // Smooth gradient: soft blue → yellow → orange → red
  const t = Math.min(100, Math.max(0, utilization)) / 100;
  if (t < 0.5) {
    // Blue (#5b9bd5) → Yellow (#e6c040)
    const r = Math.round(91 + (230 - 91) * (t / 0.5));
    const g = Math.round(155 + (192 - 155) * (t / 0.5));
    const b = Math.round(213 + (64 - 213) * (t / 0.5));
    return `rgb(${r},${g},${b})`;
  }
  if (t < 0.8) {
    // Yellow (#e6c040) → Orange (#e67a30)
    const p = (t - 0.5) / 0.3;
    const r = Math.round(230 + (230 - 230) * p);
    const g = Math.round(192 + (122 - 192) * p);
    const b = Math.round(64 + (48 - 64) * p);
    return `rgb(${r},${g},${b})`;
  }
  // Orange (#e67a30) → Red (#dc2626)
  const p = (t - 0.8) / 0.2;
  const r = Math.round(230 + (220 - 230) * p);
  const g = Math.round(122 + (38 - 122) * p);
  const b = Math.round(48 + (38 - 48) * p);
  return `rgb(${r},${g},${b})`;
}

function getHealthEmoji(score: number): string {
  if (score >= 80) return '';
  if (score >= 60) return '';
  if (score >= 40) return '';
  return '';
}

export function ContextMeter({ data, onCompress, onReset }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    };
  }, []);

  if (!data) return null;

  const { totalTokens, maxTokens, utilization, healthScore, breakdown } = data;

  const handleMouseEnter = () => {
    tooltipTimeout.current = setTimeout(() => setShowTooltip(true), 300);
  };

  const handleMouseLeave = () => {
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    setShowTooltip(false);
  };

  return (
    <>
      {/* Compact meter bar */}
      <div
        ref={meterRef}
        className="context-meter"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={() => setShowModal(true)}
        title={`Context: ${formatTokens(totalTokens)} / ${formatTokens(maxTokens)} tokens`}
      >
        <div className="context-meter-bar">
          <div
            className="context-meter-fill"
            style={{
              width: `${Math.min(100, utilization)}%`,
              backgroundColor: getBarColor(utilization),
            }}
          />
        </div>
        <span className="context-meter-label">
          {utilization < 10 ? utilization.toFixed(1) : Math.round(utilization)}%
        </span>
      </div>

      {/* Hover tooltip */}
      {showTooltip && !showModal && (
        <div className="context-tooltip">
          <div className="context-tooltip-header">
            <span>Context Budget</span>
            <span className="context-tooltip-health">
              Health: {healthScore}%
            </span>
          </div>
          <div className="context-tooltip-bar">
            {breakdown
              .filter((b) => b.tokens > 0)
              .map((b) => (
                <div
                  key={b.category}
                  className="context-tooltip-segment"
                  style={{
                    width: `${Math.max(2, (b.tokens / maxTokens) * 100)}%`,
                    backgroundColor: CATEGORY_COLORS[b.category] ?? '#6b7280',
                  }}
                  title={`${CATEGORY_LABELS[b.category] ?? b.category}: ${formatTokens(b.tokens)}`}
                />
              ))}
          </div>
          <div className="context-tooltip-legend">
            {breakdown
              .filter((b) => b.tokens > 0)
              .map((b) => (
                <div key={b.category} className="context-tooltip-legend-item">
                  <span
                    className="context-tooltip-dot"
                    style={{ backgroundColor: CATEGORY_COLORS[b.category] ?? '#6b7280' }}
                  />
                  <span>{CATEGORY_LABELS[b.category] ?? b.category}</span>
                  <span className="context-tooltip-value">{formatTokens(b.tokens)}</span>
                </div>
              ))}
          </div>
          <div className="context-tooltip-footer">
            {formatTokens(totalTokens)} / {formatTokens(maxTokens)} tokens ({utilization.toFixed(1)}%)
          </div>
        </div>
      )}

      {/* Detailed modal */}
      {showModal && (
        <div className="context-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="context-modal" onClick={(e) => e.stopPropagation()}>
            <div className="context-modal-header">
              <h3>Context Details</h3>
              <button className="context-modal-close" onClick={() => setShowModal(false)}>
                &times;
              </button>
            </div>

            {/* Health score */}
            <div className="context-modal-health">
              <div className="context-modal-health-score">
                <span className="context-modal-health-number">{healthScore}</span>
                <span className="context-modal-health-label">Health Score</span>
              </div>
              <div className="context-modal-health-bar">
                <div
                  className="context-modal-health-fill"
                  style={{
                    width: `${healthScore}%`,
                    backgroundColor: getBarColor(100 - healthScore),
                  }}
                />
              </div>
              <span className="context-modal-health-emoji">{getHealthEmoji(healthScore)}</span>
            </div>

            {/* Token budget overview */}
            <div className="context-modal-budget">
              <div className="context-modal-budget-header">
                <span>Token Budget</span>
                <span>
                  {formatTokens(totalTokens)} / {formatTokens(maxTokens)} ({utilization.toFixed(1)}%)
                </span>
              </div>
              <div className="context-modal-budget-bar">
                <div
                  className="context-modal-budget-fill"
                  style={{
                    width: `${Math.min(100, utilization)}%`,
                    backgroundColor: getBarColor(utilization),
                  }}
                />
              </div>
            </div>

            {/* Category breakdown table */}
            <div className="context-modal-breakdown">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Tokens</th>
                    <th>Items</th>
                    <th>Relevance</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown
                    .sort((a, b) => b.tokens - a.tokens)
                    .map((b) => (
                      <tr key={b.category}>
                        <td>
                          <span
                            className="context-tooltip-dot"
                            style={{ backgroundColor: CATEGORY_COLORS[b.category] ?? '#6b7280' }}
                          />
                          {CATEGORY_LABELS[b.category] ?? b.category}
                        </td>
                        <td>{formatTokens(b.tokens)}</td>
                        <td>{b.itemCount}</td>
                        <td>{(b.avgRelevance * 100).toFixed(0)}%</td>
                        <td>{maxTokens > 0 ? ((b.tokens / maxTokens) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="context-modal-actions">
              {data.compressionRecommended && onCompress && (
                <button className="context-modal-btn compress" onClick={onCompress}>
                  Compress Context
                </button>
              )}
              {data.resetRecommended && onReset && (
                <button className="context-modal-btn reset" onClick={onReset}>
                  Reset Session
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
