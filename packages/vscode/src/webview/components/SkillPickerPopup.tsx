/**
 * SkillPickerPopup — autocomplete popup for / command skill selection.
 */

import React, { useState, useEffect, useRef } from 'react';

export interface SkillPickerItem {
  name: string;
  description: string;
}

interface Props {
  query: string;
  skills: SkillPickerItem[];
  onSelect: (skillName: string) => void;
  onClose: () => void;
}

export function SkillPickerPopup({ query, skills, onSelect, onClose }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = skills
    .filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
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
        case 'Tab':
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) onSelect(filtered[selectedIndex].name);
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
    <div className="skill-picker-popup" ref={listRef}>
      {filtered.map((skill, i) => (
        <div
          key={skill.name}
          className={`skill-picker-item ${i === selectedIndex ? 'selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(skill.name); }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className="skill-picker-name">/{skill.name}</span>
          <span className="skill-picker-desc">{skill.description}</span>
        </div>
      ))}
    </div>
  );
}
