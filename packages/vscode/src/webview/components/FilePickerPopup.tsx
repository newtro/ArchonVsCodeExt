/**
 * FilePickerPopup — autocomplete popup for @ command workspace file selection.
 */

import React, { useState, useEffect, useRef } from 'react';
import { FileIcon } from './Icons';

interface Props {
  query: string;
  files: string[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FilePickerPopup({ query, files, onSelect, onClose }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = files
    .filter(f => f.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 10);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) onSelect(filtered[selectedIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, selectedIndex, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div className="file-picker-popup" ref={listRef}>
      {filtered.map((file, i) => (
        <div
          key={file}
          className={`file-picker-item ${i === selectedIndex ? 'selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(file); }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <FileIcon />
          <span>{file}</span>
        </div>
      ))}
    </div>
  );
}
