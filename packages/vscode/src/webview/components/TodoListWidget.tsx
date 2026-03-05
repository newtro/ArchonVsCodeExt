import React, { useState } from 'react';
import type { TodoItem, TodoStatus } from '@archon/core';
import { ChevronDownIcon } from './Icons';

interface Props {
  title?: string;
  items: TodoItem[];
  mode: 'pinned' | 'inline' | 'floating';
}

const STATUS_ICONS: Record<TodoStatus, string> = {
  pending: '\u25CB',       // ○
  in_progress: '\u25C9',   // ◉
  completed: '\u2713',     // ✓
  error: '\u2717',         // ✗
  skipped: '\u2298',       // ⊘
};

export function TodoListWidget({ title, items, mode }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const completed = items.filter(i => i.status === 'completed').length;
  const progressText = `${completed}/${items.length}`;

  if (mode === 'floating' && minimized) {
    return (
      <div className="todo-float todo-float-minimized" onClick={() => setMinimized(false)}>
        <span className="todo-float-badge">{progressText}</span>
      </div>
    );
  }

  const wrapperClass = mode === 'pinned' ? 'todo-pinned'
    : mode === 'inline' ? 'todo-inline'
    : 'todo-float';

  return (
    <div className={wrapperClass}>
      <div className="todo-header" onClick={() => mode === 'pinned' ? setCollapsed(!collapsed) : mode === 'floating' ? setMinimized(true) : undefined}>
        <span className="todo-header-title">
          {title || 'Tasks'}
          <span className="todo-header-count">{progressText}</span>
        </span>
        {mode === 'pinned' && (
          <span className={`todo-chevron ${collapsed ? '' : 'todo-chevron-open'}`}>
            <ChevronDownIcon />
          </span>
        )}
        {mode === 'floating' && (
          <span className="todo-minimize" title="Minimize">&ndash;</span>
        )}
      </div>

      {!collapsed && (
        <ul className="todo-list">
          {items.map(item => (
            <li key={item.id} className={`todo-item todo-status-${item.status}`}>
              <span className={`todo-icon todo-icon-${item.status}`}>
                {STATUS_ICONS[item.status]}
              </span>
              <span className="todo-content">{item.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
