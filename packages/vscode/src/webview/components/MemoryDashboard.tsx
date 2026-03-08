/**
 * MemoryDashboard — Full CRUD interface for session memories, preferences, and rules.
 */

import React, { useState, useEffect, useCallback } from 'react';
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

  // Session editing
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editDecisions, setEditDecisions] = useState<string>('');
  const [editOpenItems, setEditOpenItems] = useState<string>('');

  // Bulk selection
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());

  // Rule creation/editing
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleContent, setRuleContent] = useState('');
  const [ruleMode, setRuleMode] = useState<'always' | 'manual'>('always');
  const [ruleFileMatch, setRuleFileMatch] = useState('');

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

  // ── Session editing ──
  const startEditSession = useCallback((s: MemorySessionEntry) => {
    setEditingSessionId(s.id);
    setEditDecisions(s.decisions.join('\n'));
    setEditOpenItems(s.openItems.join('\n'));
  }, []);

  const saveEditSession = useCallback(() => {
    if (!editingSessionId) return;
    postMessage({
      type: 'updateMemorySession',
      sessionId: editingSessionId,
      updates: {
        decisions: editDecisions.split('\n').filter(d => d.trim()),
        openItems: editOpenItems.split('\n').filter(o => o.trim()),
      },
    } as any);
    setSessions(prev => prev.map(s => s.id === editingSessionId ? {
      ...s,
      decisions: editDecisions.split('\n').filter(d => d.trim()),
      openItems: editOpenItems.split('\n').filter(o => o.trim()),
    } : s));
    setEditingSessionId(null);
  }, [editingSessionId, editDecisions, editOpenItems]);

  // ── Bulk actions ──
  const toggleSelectSession = useCallback((id: string) => {
    setSelectedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllSessions = useCallback(() => {
    if (selectedSessionIds.size === sessions.length) {
      setSelectedSessionIds(new Set());
    } else {
      setSelectedSessionIds(new Set(sessions.map(s => s.id)));
    }
  }, [sessions, selectedSessionIds.size]);

  const deleteSelectedSessions = useCallback(() => {
    for (const id of selectedSessionIds) {
      postMessage({ type: 'deleteMemorySession', sessionId: id });
    }
    setSessions(prev => prev.filter(s => !selectedSessionIds.has(s.id)));
    setSelectedSessionIds(new Set());
  }, [selectedSessionIds]);

  const cleanupLowConfidence = useCallback(() => {
    const threshold = 0.3;
    const toDelete = sessions.filter(s => s.confidence < threshold && !s.pinned);
    for (const s of toDelete) {
      postMessage({ type: 'deleteMemorySession', sessionId: s.id });
    }
    setSessions(prev => prev.filter(s => s.confidence >= threshold || s.pinned));
  }, [sessions]);

  // ── Rule CRUD ──
  const openNewRuleForm = useCallback(() => {
    setEditingRuleId(null);
    setRuleName('');
    setRuleContent('');
    setRuleMode('always');
    setRuleFileMatch('');
    setShowRuleForm(true);
  }, []);

  const openEditRuleForm = useCallback((r: MemoryRuleEntry) => {
    setEditingRuleId(r.id);
    setRuleName(r.name.replace(/\.md$/, ''));
    setRuleContent(r.contentPreview);
    setRuleMode(r.mode as 'always' | 'manual');
    setRuleFileMatch(r.fileMatch ?? '');
    setShowRuleForm(true);
  }, []);

  const saveRule = useCallback(() => {
    if (!ruleName.trim()) return;
    if (editingRuleId) {
      postMessage({
        type: 'updateMemoryRule',
        ruleId: editingRuleId,
        updates: { content: ruleContent, mode: ruleMode, fileMatch: ruleFileMatch || undefined },
      } as any);
    } else {
      postMessage({
        type: 'createMemoryRule',
        name: ruleName.trim(),
        content: ruleContent,
        mode: ruleMode,
        fileMatch: ruleFileMatch || undefined,
      } as any);
    }
    setShowRuleForm(false);
    // Reload rules after a short delay for filesystem to settle
    setTimeout(() => postMessage({ type: 'loadMemoryRules' }), 300);
  }, [editingRuleId, ruleName, ruleContent, ruleMode, ruleFileMatch]);

  const deleteRule = useCallback((ruleId: string) => {
    postMessage({ type: 'deleteMemoryRule', ruleId } as any);
    setRules(prev => prev.filter(r => r.id !== ruleId));
  }, []);

  // ── Promote preference to rule ──
  const promoteToRule = useCallback((p: MemoryPreferenceEntry) => {
    postMessage({ type: 'promotePreferenceToRule', preferenceId: p.id } as any);
    setTimeout(() => postMessage({ type: 'loadMemoryRules' }), 300);
  }, []);

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
          {sessions.length > 0 && (
            <div className="memory-bulk-bar">
              <label className="memory-bulk-select">
                <input
                  type="checkbox"
                  checked={selectedSessionIds.size === sessions.length && sessions.length > 0}
                  onChange={selectAllSessions}
                />
                <span>Select all</span>
              </label>
              {selectedSessionIds.size > 0 && (
                <button className="settings-btn-sm danger" onClick={deleteSelectedSessions}>
                  Delete selected ({selectedSessionIds.size})
                </button>
              )}
              <button className="settings-btn-sm" onClick={cleanupLowConfidence} title="Remove sessions below 30% confidence (unpinned)">
                Cleanup low confidence
              </button>
            </div>
          )}
          {sessions.length === 0 && (
            <p className="memory-empty">No session summaries yet. Sessions are summarized automatically when the memory model is configured.</p>
          )}
          {sessions.map(s => (
            <div key={s.id} className={`memory-card ${selectedSessionIds.has(s.id) ? 'selected' : ''}`}>
              <div className="memory-card-header" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                <div className="memory-card-title">
                  <input
                    type="checkbox"
                    className="memory-card-checkbox"
                    checked={selectedSessionIds.has(s.id)}
                    onChange={(e) => { e.stopPropagation(); toggleSelectSession(s.id); }}
                    onClick={(e) => e.stopPropagation()}
                  />
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
                  {editingSessionId === s.id ? (
                    // ── Inline editing mode ──
                    <div className="memory-edit-form">
                      <div className="memory-edit-field">
                        <label>Decisions (one per line):</label>
                        <textarea
                          value={editDecisions}
                          onChange={(e) => setEditDecisions(e.target.value)}
                          rows={4}
                          className="memory-edit-textarea"
                        />
                      </div>
                      <div className="memory-edit-field">
                        <label>Open Items (one per line):</label>
                        <textarea
                          value={editOpenItems}
                          onChange={(e) => setEditOpenItems(e.target.value)}
                          rows={3}
                          className="memory-edit-textarea"
                        />
                      </div>
                      <div className="memory-card-actions">
                        <button className="settings-btn-sm" onClick={saveEditSession}>Save</button>
                        <button className="settings-btn-sm" onClick={() => setEditingSessionId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    // ── Read-only view ──
                    <>
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
                        <button className="settings-btn-sm" onClick={() => startEditSession(s)}>Edit</button>
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
                    </>
                  )}
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
                  {p.confidence != null && (
                    <span className={`memory-card-confidence ${p.confidence >= 0.7 ? 'high' : p.confidence >= 0.3 ? 'med' : 'low'}`}>
                      {(p.confidence * 100).toFixed(0)}%
                    </span>
                  )}
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
                <button className="settings-btn-sm" onClick={() => promoteToRule(p)} title="Create a rule from this preference">
                  Promote to Rule
                </button>
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
          <div className="memory-bulk-bar">
            <button className="settings-btn-sm" onClick={openNewRuleForm}>+ New Rule</button>
          </div>

          {showRuleForm && (
            <div className="memory-card memory-rule-form">
              <div className="memory-edit-form">
                <div className="memory-edit-field">
                  <label>Rule name:</label>
                  <input
                    type="text"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="my-rule"
                    className="memory-edit-input"
                  />
                </div>
                <div className="memory-edit-field">
                  <label>Mode:</label>
                  <select
                    value={ruleMode}
                    onChange={(e) => setRuleMode(e.target.value as 'always' | 'manual')}
                    className="memory-edit-select"
                  >
                    <option value="always">Always (auto-inject)</option>
                    <option value="manual">Manual (on-demand)</option>
                  </select>
                </div>
                <div className="memory-edit-field">
                  <label>File match pattern (optional):</label>
                  <input
                    type="text"
                    value={ruleFileMatch}
                    onChange={(e) => setRuleFileMatch(e.target.value)}
                    placeholder="*.tsx, src/**/*.ts"
                    className="memory-edit-input"
                  />
                </div>
                <div className="memory-edit-field">
                  <label>Content (markdown):</label>
                  <textarea
                    value={ruleContent}
                    onChange={(e) => setRuleContent(e.target.value)}
                    rows={8}
                    className="memory-edit-textarea"
                    placeholder="# Rule Title&#10;&#10;Instructions for the agent..."
                  />
                </div>
                <div className="memory-card-actions">
                  <button className="settings-btn-sm" onClick={saveRule} disabled={!ruleName.trim()}>
                    {editingRuleId ? 'Update' : 'Create'}
                  </button>
                  <button className="settings-btn-sm" onClick={() => setShowRuleForm(false)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {rules.length === 0 && !showRuleForm && (
            <p className="memory-empty">No rules found. Click "+ New Rule" or add .archon/rules/*.md files to your workspace.</p>
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
              <div className="memory-card-actions">
                <button className="settings-btn-sm" onClick={() => openEditRuleForm(r)}>Edit</button>
                <button className="settings-btn-sm danger" onClick={() => deleteRule(r.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
