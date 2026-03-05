import React, { useState, useMemo } from 'react';
import { marked } from 'marked';
import type { AskUserRequest } from '../store';

interface Props {
  request: AskUserRequest;
  onRespond: (response: string) => void;
}

export function AskUserDialog({ request, onRespond }: Props) {
  const [customInput, setCustomInput] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const renderedPrompt = useMemo(() => {
    const html = marked.parse(request.prompt);
    return typeof html === 'string' ? html : '';
  }, [request.prompt]);

  const hasOptions = request.options && request.options.length > 0;
  const isMultiSelect = request.multiSelect === true;

  const toggleOption = (opt: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(opt)) {
        next.delete(opt);
      } else {
        next.add(opt);
      }
      return next;
    });
  };

  const submitMultiSelect = () => {
    if (selected.size > 0) {
      onRespond(Array.from(selected).join(', '));
    }
  };

  return (
    <div className="ask-user-dialog">
      <div
        className="ask-user-prompt markdown-body"
        dangerouslySetInnerHTML={{ __html: renderedPrompt }}
      />

      {hasOptions && isMultiSelect && (
        <div className="ask-user-multi-select">
          {request.options!.map((opt, i) => (
            <label key={i} className="ask-user-checkbox">
              <input
                type="checkbox"
                checked={selected.has(opt)}
                onChange={() => toggleOption(opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
          <button
            className="ask-user-submit"
            onClick={submitMultiSelect}
            disabled={selected.size === 0}
          >
            Submit ({selected.size} selected)
          </button>
        </div>
      )}

      {hasOptions && !isMultiSelect && (
        <div className="ask-user-options">
          {request.options!.map((opt, i) => (
            <button key={i} onClick={() => onRespond(opt)}>
              {opt}
            </button>
          ))}
        </div>
      )}

      <div className="ask-user-custom">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          placeholder={hasOptions ? 'Or type your own response...' : 'Type your response...'}
          autoFocus={!hasOptions}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customInput.trim()) {
              onRespond(customInput.trim());
            }
          }}
        />
        <button
          onClick={() => customInput.trim() && onRespond(customInput.trim())}
          disabled={!customInput.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
