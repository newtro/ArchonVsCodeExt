/**
 * MemoryDashboard — CRUD interface for session memories, preferences, and rules.
 */

import React, { useState, useEffect } from 'react';
import { postMessage } from '../vscode-api';
import type { MemorySessionEntry, MemoryPreferenceEntry, MemoryRuleEntry } from '@archon/core';

type Tab = 'sessions' | 'preferences' | 'rules';

interface DashboardStats {
  sessions?: number;
  preferences?: number;
  chunks?: number;
  symbols?: number;
  rules?: number;
  summarizerReady?: number;
}

export function MemoryDashboard() {
  const [tab, setTab] = useState<Tab>('sessions');
  const [sessions, setSessions] = useState<MemorySessionEntry[]>([]);
  const [preferences, setPreferences] = useState<MemoryPreferenceEntry[]>([]);
  const [rules, setRules] = useState<MemoryRuleEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case 'memorySessionsLoaded':
          setSessions(msg.sessions);
          break;
        case 'memoryPreferencesLoaded':
          setPreferences(msg.preferences);
          break;
        case 'memoryRulesLoaded':
          setRules(msg.rules);
          break;
        case 'memoryDashboardLoaded':
          setStats(msg.stats);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    if (tab === 'sessions') postMessage({ type: 'loadMemorySessions' });
    if (tab === 'preferences') postMessage({ type: 'loadMemoryPreferences' });
    if (tab === 'rules') postMessage({ type: 'loadMemoryRules' });
  }, [tab]);

  // Load initial data + stats
  useEffect(() => {
    postMessage({ type: 'loadMemorySessions' });
    postMessage({ type: 'loadMemoryDashboard' });
  }, []);

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="memory-dashboard">
      <h3>Memory Dashboard</h3>

      {/* Overview stats */}
      <div className="memory-stats-bar">
        <span className="memory-stat" title="Indexed code chunks">{stats.chunks ?? 0} chunks</span>
        <span className="memory-stat" title="Code symbols (functions, classes)">{stats.symbols ?? 0} symbols</span>
        <span className="memory-stat" title="Session summaries">{stats.sessions ?? 0} sessions</span>
        <span className="memory-stat" title="Learned preferences">{stats.preferences ?? 0} prefs</span>
        <span className="memory-stat" title="Active rules">{stats.rules ?? 0} rules</span>
        <span className={`memory-stat ${stats.summarizerReady ? 'ready' : 'not-ready'}`} title={stats.summarizerReady ? 'Summarizer active' : 'Summarizer not configured — set memory model in Settings'}>
          {stats.summarizerReady ? 'LLM active' : 'LLM not configured'}
        </span>
      </div>

      <div className="memory-tabs">
        {(['sessions', 'preferences', 'rules'] as Tab[]).map(t => (
          <button
            key={t}
            className={`memory-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'sessions' ? `Sessions (${sessions.length})`
              : t === 'preferences' ? `Preferences (${preferences.length})`
              : `Rules (${rules.length})`}
          </button>
        ))}
      </div>

      {/* Sessions */}
      {tab === 'sessions' && (
        <div className="memory-list">
          {sessions.length === 0 && (
            <p className="memory-empty">No session summaries yet. Sessions are summarized automatically when the memory model is configured.</p>
          )}
          {sessions.map(s => (
            <div key={s.id} className="memory-card">
              <div className="memory-card-header" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                <div className="memory-card-title">
                  <span className="memory-card-date">{formatDate(s.timestamp)}</span>
                  <span className={`memory-card-confidence ${s.confidence >= 0.7 ? 'high' : s.confidence >= 0.3 ? 'med' : 'low'}`}>
                    {(s.confidence * 100).toFixed(0)}%
                  </span>
                  {s.pinned && <span className="memory-card-pin" title="Pinned">P</span>}
                </div>
                <div className="memory-card-summary">
                  {s.decisions.slice(0, 2).join('; ') || 'No decisions recorded'}
                </div>
              </div>

              {expandedId === s.id && (
                <div className="memory-card-detail">
                  {s.decisions.length > 0 && (
                    <div className="memory-detail-section">
                      <strong>Decisions:</strong>
                      <ul>{s.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
                    </div>
                  )}
                  {s.filesModified.length > 0 && (
                    <div className="memory-detail-section">
                      <strong>Files Modified:</strong>
                      <ul>{s.filesModified.map((f, i) => <li key={i}>{f.path}{f.reason ? ` — ${f.reason}` : ''}</li>)}</ul>
                    </div>
                  )}
                  {s.openItems.length > 0 && (
                    <div className="memory-detail-section">
                      <strong>Open Items:</strong>
                      <ul>{s.openItems.map((o, i) => <li key={i}>{o}</li>)}</ul>
                    </div>
                  )}
                  <div className="memory-card-actions">
                    <button className="settings-btn-sm" onClick={() => {
                      postMessage({ type: 'pinMemorySession', sessionId: s.id, pinned: !s.pinned });
                      postMessage({ type: 'loadMemorySessions' });
                    }}>{s.pinned ? 'Unpin' : 'Pin'}</button>
                    <button className="settings-btn-sm" onClick={() => {
                      postMessage({ type: 'boostMemorySession', sessionId: s.id, delta: 0.2 });
                      postMessage({ type: 'loadMemorySessions' });
                    }}>Boost</button>
                    <button className="settings-btn-sm danger" onClick={() => {
                      postMessage({ type: 'deleteMemorySession', sessionId: s.id });
                      setSessions(prev => prev.filter(x => x.id !== s.id));
                    }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Preferences */}
      {tab === 'preferences' && (
        <div className="memory-list">
          {preferences.length === 0 && (
            <p className="memory-empty">No learned preferences yet. Preferences are extracted when you edit agent-written code.</p>
          )}
          {preferences.map(p => (
            <div key={p.id} className="memory-card">
              <div className="memory-card-header">
                <div className="memory-card-title">
                  <span className="memory-card-pattern">{p.pattern}</span>
                  <span className="memory-card-occurrences">{p.occurrences}x</span>
                </div>
                <div className="memory-card-summary">{p.description}</div>
              </div>
              <div className="memory-card-actions">
                <label className="memory-switch">
                  <input
                    type="checkbox"
                    checked={p.autoApplied}
                    onChange={(e) => {
                      postMessage({ type: 'togglePreferenceAutoApply', preferenceId: p.id, autoApply: e.target.checked } as any);
                      setPreferences(prev => prev.map(x => x.id === p.id ? { ...x, autoApplied: e.target.checked } : x));
                    }}
                  />
                  <span className="memory-switch-label">Auto-apply</span>
                </label>
                <button className="settings-btn-sm danger" onClick={() => {
                  postMessage({ type: 'deleteMemoryPreference', preferenceId: p.id } as any);
                  setPreferences(prev => prev.filter(x => x.id !== p.id));
                }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rules */}
      {tab === 'rules' && (
        <div className="memory-list">
          {rules.length === 0 && (
            <p className="memory-empty">No rules found. Add .archon/rules/*.md files to your workspace.</p>
          )}
          {rules.map(r => (
            <div key={r.id} className="memory-card">
              <div className="memory-card-header">
                <div className="memory-card-title">
                  <span className="memory-card-rule-name">{r.name}</span>
                  <span className={`memory-card-mode ${r.mode}`}>{r.mode}</span>
                </div>
                {r.fileMatch && <div className="memory-card-summary">Match: {r.fileMatch}</div>}
                <div className="memory-card-preview">{r.contentPreview}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
