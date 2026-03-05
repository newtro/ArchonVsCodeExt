import React, { useCallback, useMemo, useState } from 'react';
import { marked } from 'marked';
import type { UIMessage } from '../store';
import { ChevronDownIcon } from './Icons';

interface Props {
  message: UIMessage;
}

// Configure marked for safe rendering inside VS Code webview
marked.setOptions({
  breaks: true,
  gfm: true,
});

const COPY_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h1V2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h1zm1 1H3v8h6v-2H6a1 1 0 0 1-1-1V5zm1-2v7h6V2H6z"/></svg>';
const CHECK_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>';

// Custom renderer: wrap <pre> blocks with a container that includes a copy button
const renderer = new marked.Renderer();
const originalCode = renderer.code;
renderer.code = function (this: marked.Renderer, code: marked.Tokens.Code): string {
  const raw = originalCode.call(this, code);
  return `<div class="code-block-wrapper">${raw}<button class="code-copy-btn" title="Copy to clipboard" aria-label="Copy code">${COPY_ICON_SVG}</button></div>`;
};
marked.use({ renderer });

export function MessageBubble({ message }: Props) {
  const { role, content, isStreaming } = message;

  if (role === 'tool') {
    return <ToolCallMessage message={message} />;
  }

  const renderedHtml = useMemo(() => renderMarkdown(content), [content]);

  const handleCodeCopy = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest('.code-copy-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const wrapper = btn.closest('.code-block-wrapper');
    const pre = wrapper?.querySelector('pre');
    if (!pre) return;
    const text = pre.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = CHECK_ICON_SVG;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = COPY_ICON_SVG;
        btn.classList.remove('copied');
      }, 2000);
    });
  }, []);

  return (
    <div className={`message ${role}`}>
      {role === 'user' && <div className="message-role">You</div>}
      <div className="message-content">
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
          onClick={handleCodeCopy}
        />
        {isStreaming && <span className="cursor">|</span>}
      </div>
    </div>
  );
}

/**
 * Generate a succinct one-liner summary for a tool call, similar to
 * how Claude Code shows "Read src/file.ts (lines 1-50)".
 */
function toolSummary(name: string, args?: Record<string, unknown>): string {
  if (!args) return name;

  switch (name) {
    case 'read_file': {
      const p = args.path as string ?? '';
      const sl = args.start_line as number | undefined;
      const el = args.end_line as number | undefined;
      const range = sl && el ? ` (lines ${sl}-${el})` : sl ? ` (from line ${sl})` : '';
      return `Read ${p}${range}`;
    }
    case 'write_file':
      return `Write ${args.path ?? ''}`;
    case 'edit_file':
      return `Edit ${args.path ?? ''}`;
    case 'search_files':
      return `Search "${args.pattern ?? ''}"${args.include ? ` in ${args.include}` : ''}`;
    case 'find_files':
      return `Find ${args.pattern ?? ''}`;
    case 'list_directory':
      return `List ${args.path ?? '.'}`;
    case 'run_terminal':
      return `Run \`${truncate(String(args.command ?? ''), 60)}\``;
    case 'search_codebase':
      return `Search codebase "${truncate(String(args.query ?? ''), 50)}"`;
    case 'go_to_definition':
      return `Go to definition: ${args.symbol ?? ''}`;
    case 'find_references':
      return `Find references: ${args.symbol ?? ''}`;
    case 'get_hover_info':
      return `Hover: ${args.file ?? ''}:${args.line ?? ''}`;
    case 'get_diagnostics':
      return `Diagnostics: ${args.file ?? ''}`;
    case 'web_search':
      return `Web search "${truncate(String(args.query ?? ''), 50)}"`;
    case 'web_fetch':
      return `Fetch ${truncate(String(args.url ?? ''), 60)}`;
    case 'lookup_docs':
      return `Docs: ${args.query ?? ''}`;
    case 'ask_user': {
      const question = args.question as string ?? args.prompt as string ?? '';
      return question ? `Ask user: "${truncate(question, 80)}"` : 'Ask user';
    }
    case 'attempt_completion':
      return `Complete`;
    case 'spawn_agent': {
      const task = args.task as string ?? '';
      return `Spawn agent: "${truncate(task, 80)}"`;
    }
    case 'diff_view':
      return `Diff ${args.path ?? ''}`;
    case 'skill_invoke':
      return `Invoke skill /${args.name ?? ''}`;
    case 'list_skills': {
      const filter = args.filter as string | undefined;
      return filter ? `List skills (${filter})` : 'List skills';
    }
    case 'create_skill':
      return `Create skill /${args.name ?? ''}`;
    case 'todo_write': {
      const todoTitle = args.title as string ?? '';
      const todos = args.todos as unknown[] ?? [];
      return todoTitle ? `Todos: ${todoTitle} (${todos.length} items)` : `Todos (${todos.length} items)`;
    }
    // ── Claude Code CLI tool names ──
    case 'Read': {
      const filePath = args.file_path as string ?? args.path as string ?? '';
      return `Read ${filePath}`;
    }
    case 'Write': {
      const filePath = args.file_path as string ?? args.path as string ?? '';
      return `Write ${filePath}`;
    }
    case 'Edit': {
      const filePath = args.file_path as string ?? args.path as string ?? '';
      return `Edit ${filePath}`;
    }
    case 'Bash': {
      const cmd = args.command as string ?? '';
      return `Run \`${truncate(cmd, 60)}\``;
    }
    case 'Glob': {
      const pat = args.pattern as string ?? '';
      return `Find files "${pat}"`;
    }
    case 'Grep': {
      const pat = args.pattern as string ?? '';
      return `Search "${truncate(pat, 50)}"`;
    }
    case 'ToolSearch': {
      const q = args.query as string ?? '';
      return `Tool search: "${truncate(q, 50)}"`;
    }
    case 'Skill': {
      const skill = args.skill as string ?? '';
      const skillArgs = args.args as string ?? '';
      return skillArgs ? `Skill /${skill}: "${truncate(skillArgs, 50)}"` : `Skill /${skill}`;
    }
    case 'TodoWrite': {
      const todos = args.todos as unknown[] ?? [];
      const title = args.title as string | undefined;
      return title ? `Todos: ${title} (${todos.length} items)` : `Todos (${todos.length} items)`;
    }
    case 'AskUserQuestion': {
      const questions = args.questions as Array<{ question?: string }> | undefined;
      const q = questions?.[0]?.question ?? args.question as string ?? '';
      return q ? `Ask user: "${truncate(q, 80)}"` : 'Ask user';
    }
    case 'WebFetch': {
      const url = args.url as string ?? '';
      return `Fetch ${truncate(url, 60)}`;
    }
    case 'WebSearch': {
      const q = args.query as string ?? '';
      return `Web search "${truncate(q, 50)}"`;
    }
    case 'Agent': {
      const desc = args.description as string ?? args.prompt as string ?? '';
      return `Agent: "${truncate(desc, 60)}"`;
    }
    case 'NotebookEdit':
      return `Edit notebook`;
    default:
      return name;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Combined tool call display: one-liner summary with colored status dot,
 * expandable to show args + result.
 */
function ToolCallMessage({ message }: { message: UIMessage }) {
  const [expanded, setExpanded] = useState(false);
  const { toolName, toolArgs, toolResult, toolStatus, isError, subMessages } = message;

  const summary = useMemo(
    () => toolSummary(toolName ?? 'tool', toolArgs),
    [toolName, toolArgs],
  );

  const isSpawnAgent = toolName === 'spawn_agent';
  const hasSubMessages = !!(subMessages && subMessages.length > 0);
  const hasDetails = !!(toolArgs && Object.keys(toolArgs).length > 0) || !!toolResult || hasSubMessages;

  const statusClass = toolStatus === 'running' ? 'tc-running'
    : isError ? 'tc-error'
    : 'tc-done';

  return (
    <div className={`tc ${statusClass}`}>
      <div
        className="tc-header"
        onClick={() => hasDetails && setExpanded(!expanded)}
        role={hasDetails ? 'button' : undefined}
        tabIndex={hasDetails ? 0 : undefined}
      >
        <span className="tc-dot" />
        <span className="tc-summary">{summary}</span>
        {hasDetails && (
          <span className={`tc-chevron ${expanded ? 'tc-chevron-open' : ''}`}>
            <ChevronDownIcon />
          </span>
        )}
      </div>

      {expanded && (
        <div className="tc-details">
          {/* For spawn_agent, show sub-agent activity instead of raw args/result */}
          {isSpawnAgent && hasSubMessages ? (
            <div className="tc-sub-messages">
              {subMessages!.map((sub, i) => {
                if (sub.role === 'tool' && sub.toolName) {
                  const subSummary = toolSummary(sub.toolName, sub.toolArgs);
                  return (
                    <SubToolCall
                      key={i}
                      summary={subSummary}
                      result={sub.toolResult}
                      isError={sub.isError}
                    />
                  );
                }
                if (sub.role === 'assistant' && sub.content) {
                  return (
                    <div key={i} className="tc-sub-assistant">
                      {sub.content.length > 500 ? sub.content.slice(0, 500) + '\n…' : sub.content}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          ) : (
            <>
              {toolArgs && Object.keys(toolArgs).length > 0 && (
                <div className="tc-section">
                  <div className="tc-section-label">Arguments</div>
                  <pre className="tc-pre">{JSON.stringify(toolArgs, null, 2)}</pre>
                </div>
              )}
              {toolResult && (
                <div className="tc-section">
                  <div className="tc-section-label">Result</div>
                  <pre className="tc-pre">{toolResult.length > 2000 ? toolResult.slice(0, 2000) + '\n... (truncated)' : toolResult}</pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Nested tool call inside a spawn_agent expansion — compact, one-liner + optional result. */
function SubToolCall({ summary, result, isError }: { summary: string; result?: string; isError?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasResult = !!result;
  const dotClass = isError ? 'tc-sub-dot-error' : 'tc-sub-dot-done';

  return (
    <div className="tc-sub-tool">
      <div
        className="tc-sub-tool-header"
        onClick={() => hasResult && setOpen(!open)}
        role={hasResult ? 'button' : undefined}
        tabIndex={hasResult ? 0 : undefined}
      >
        <span className={`tc-sub-dot ${dotClass}`} />
        <span className="tc-sub-tool-summary">{summary}</span>
        {hasResult && (
          <span className={`tc-chevron-sm ${open ? 'tc-chevron-open' : ''}`}>
            <ChevronDownIcon />
          </span>
        )}
      </div>
      {open && result && (
        <pre className="tc-sub-result">{result.length > 1000 ? result.slice(0, 1000) + '\n… (truncated)' : result}</pre>
      )}
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
