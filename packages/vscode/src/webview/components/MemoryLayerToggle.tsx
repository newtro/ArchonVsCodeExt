/**
 * MemoryLayerToggle — compact indicator + popover for controlling which
 * memory layers are injected into LLM prompts.
 */

import React, { useState, useRef, useEffect } from 'react';
import { postMessage } from '../vscode-api';
import type { MemoryLayerToggles } from '@archon/core';

const LAYER_LABELS: Record<string, { label: string; desc: string }> = {
  claudeMd: { label: 'CLAUDE.md', desc: 'Project instructions from CLAUDE.md' },
  rules: { label: 'Rules', desc: 'Project conventions and coding rules' },
  sessionMemory: { label: 'Session', desc: 'Current session context and history' },
  ragSearch: { label: 'RAG', desc: 'Semantic code search results' },
  codeGraph: { label: 'Graph', desc: 'Symbol relationships and call graph' },
  dependencies: { label: 'Deps', desc: 'Project dependency awareness' },
  archive: { label: 'Archive', desc: 'Past interaction summaries' },
  preferences: { label: 'Prefs', desc: 'Learned coding preferences' },
};

interface Props {
  layerToggles: MemoryLayerToggles;
}

export function MemoryLayerToggle({ layerToggles }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const activeCount = Object.values(layerToggles).filter(v => v.inject).length;
  const totalCount = Object.keys(layerToggles).length;

  // Position the popover using fixed positioning to avoid clipping
  useEffect(() => {
    if (open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const popoverHeight = 320; // approximate max height
      const spaceAbove = rect.top;

      if (spaceAbove >= popoverHeight) {
        // Open upward
        setPopoverStyle({
          position: 'fixed',
          bottom: window.innerHeight - rect.top + 8,
          right: window.innerWidth - rect.right,
        });
      } else {
        // Not enough space above — open downward
        setPopoverStyle({
          position: 'fixed',
          top: rect.bottom + 8,
          right: window.innerWidth - rect.right,
        });
      }
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = (layer: string, mode: 'inject' | 'record', enabled: boolean) => {
    postMessage({ type: 'setMemoryLayerToggle', layer, mode, enabled });
  };

  return (
    <div className="memory-toggle-container" ref={containerRef}>
      <button
        className="memory-toggle-btn"
        onClick={() => setOpen(!open)}
        title={`Memory layers: ${activeCount}/${totalCount} active`}
      >
        <span className="memory-toggle-icon">M</span>
        <span className="memory-toggle-count">{activeCount}/{totalCount}</span>
      </button>

      {open && (
        <div className="memory-toggle-popover" ref={popoverRef} style={popoverStyle}>
          <div className="memory-toggle-header">Memory Layers</div>
          {Object.entries(LAYER_LABELS).map(([key, { label, desc }]) => {
            const toggle = layerToggles[key];
            if (!toggle) return null;
            return (
              <div key={key} className="memory-toggle-row">
                <div className="memory-toggle-info">
                  <span className="memory-toggle-label">{label}</span>
                  <span className="memory-toggle-desc">{desc}</span>
                </div>
                <div className="memory-toggle-switches">
                  <label className="memory-switch" title="Include in prompts">
                    <input
                      type="checkbox"
                      checked={toggle.inject}
                      onChange={(e) => handleToggle(key, 'inject', e.target.checked)}
                    />
                    <span className="memory-switch-label">Read</span>
                  </label>
                  <label className="memory-switch" title="Record to memory">
                    <input
                      type="checkbox"
                      checked={toggle.record}
                      onChange={(e) => handleToggle(key, 'record', e.target.checked)}
                    />
                    <span className="memory-switch-label">Write</span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
