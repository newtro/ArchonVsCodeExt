import React, { useMemo, useState } from 'react';
import { marked } from 'marked';
import type { UIMessage } from '../store';

interface Props {
  message: UIMessage;
}

// Configure marked for safe rendering inside VS Code webview
marked.setOptions({
  breaks: true,
  gfm: true,
});

export function MessageBubble({ message }: Props) {
  const { role, content, toolName, isStreaming, isError } = message;

  if (role === 'tool') {
    return <ToolOutput content={content} toolName={toolName} isError={isError} />;
  }

  const renderedHtml = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div className={`message ${role}`}>
      <div className="message-role">{role === 'user' ? 'You' : 'Archon'}</div>
      <div className="message-content">
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
        {isStreaming && <span className="cursor">|</span>}
      </div>
    </div>
  );
}

const PREVIEW_LINES = 4;
const PREVIEW_CHARS = 300;

function ToolOutput({ content, toolName, isError }: { content: string; toolName?: string; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const isLong = content.split('\n').length > PREVIEW_LINES || content.length > PREVIEW_CHARS;

  const displayContent = useMemo(() => {
    if (expanded || !isLong) return content;
    const lines = content.split('\n').slice(0, PREVIEW_LINES);
    let preview = lines.join('\n');
    if (preview.length > PREVIEW_CHARS) {
      preview = preview.slice(0, PREVIEW_CHARS);
    }
    return preview + '\n...';
  }, [content, expanded, isLong]);

  const renderedHtml = useMemo(() => renderMarkdown(displayContent), [displayContent]);

  return (
    <div className={`message tool ${isError ? 'tool-error' : ''}`}>
      {(toolName || isLong) && (
        <div className="tool-header" onClick={() => isLong && setExpanded(!expanded)}>
          {toolName && <span className="tool-name">{toolName}</span>}
          {isLong && (
            <button className="tool-expand-btn" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
      )}
      <div
        className="tool-output markdown-body"
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    </div>
  );
}

function renderMarkdown(content: string): string {
  try {
    const html = marked.parse(content);
    if (typeof html === 'string') return html;
    return content;
  } catch {
    return escapeHtml(content);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
