import React, { useState } from 'react';
import type { AskUserRequest } from '../store';

interface Props {
  request: AskUserRequest;
  onRespond: (response: string) => void;
}

export function AskUserDialog({ request, onRespond }: Props) {
  const [customInput, setCustomInput] = useState('');

  return (
    <div className="ask-user-dialog">
      <div className="ask-user-prompt">{request.prompt}</div>
      {request.options && request.options.length > 0 ? (
        <div className="ask-user-options">
          {request.options.map((opt, i) => (
            <button key={i} onClick={() => onRespond(opt)}>
              {opt}
            </button>
          ))}
          <div className="ask-user-custom">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Or type a custom response..."
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
      ) : (
        <div className="ask-user-custom">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="Type your response..."
            autoFocus
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
      )}
    </div>
  );
}
