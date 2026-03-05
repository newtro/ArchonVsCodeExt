/**
 * ChatHistoryDropdown — dropdown in the header to browse and load past chat sessions.
 */

import React, { useState, useRef, useEffect } from 'react';
import type { ChatSessionSummary } from '@archon/core';
import { HistoryIcon } from './Icons';

interface Props {
  sessions: ChatSessionSummary[];
  onLoadSession: (sessionId: string) => void;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ChatHistoryDropdown({ sessions, onLoadSession }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="history-dropdown" ref={ref}>
      <button
        className="icon-btn header-icon-btn"
        onClick={() => setOpen(!open)}
        title="Chat history"
      >
        <HistoryIcon />
      </button>

      {open && (
        <div className="history-menu">
          {sessions.length === 0 ? (
            <div className="history-empty">No chat history</div>
          ) : (
            sessions.map(s => (
              <button
                key={s.id}
                className="history-item"
                onClick={() => { onLoadSession(s.id); setOpen(false); }}
              >
                <span className="history-title">{s.title}</span>
                <span className="history-meta">
                  {s.messageCount} msgs &middot; {timeAgo(s.timestamp)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
