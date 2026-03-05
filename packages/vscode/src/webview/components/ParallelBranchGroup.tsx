import React, { useState } from 'react';
import type { ParallelGroupState, ParallelBranchState } from '../store';
import { MessageBubble } from './MessageBubble';
import { ChevronDownIcon } from './Icons';

interface Props {
  group: ParallelGroupState;
}

export function ParallelBranchGroup({ group }: Props) {
  const isRunning = group.status === 'running';
  const completedCount = group.branches.filter(b => b.status === 'completed').length;
  const totalCount = group.branches.length;

  return (
    <div className={`parallel-group ${isRunning ? 'parallel-group-running' : 'parallel-group-completed'}`}>
      <div className="parallel-group-header">
        <span className="parallel-group-icon">{isRunning ? '⟁' : '⟁'}</span>
        <span className="parallel-group-title">
          {isRunning
            ? `Running ${totalCount} parallel branches`
            : `${totalCount} parallel branches completed`}
        </span>
        {isRunning && (
          <span className="parallel-group-progress">
            {completedCount}/{totalCount} done
          </span>
        )}
      </div>
      <div className="parallel-group-branches">
        {group.branches.map(branch => (
          <BranchCard key={branch.branchId} branch={branch} defaultExpanded={isRunning} />
        ))}
      </div>
    </div>
  );
}

function BranchCard({ branch, defaultExpanded }: { branch: ParallelBranchState; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isRunning = branch.status === 'running';
  const hasContent = branch.messages.length > 0 || branch.streamingContent.length > 0 || !!branch.errorMessage;

  const statusClass = isRunning ? 'branch-running' : branch.status === 'completed' ? 'branch-completed' : 'branch-error';

  return (
    <div className={`parallel-branch ${statusClass}`}>
      <div
        className="parallel-branch-header"
        onClick={() => hasContent && setExpanded(!expanded)}
        role={hasContent ? 'button' : undefined}
        tabIndex={hasContent ? 0 : undefined}
      >
        <span className="parallel-branch-dot" />
        <span className="parallel-branch-label">{branch.label}</span>
        {isRunning && branch.streamingContent.length > 0 && (
          <span className="parallel-branch-status">streaming...</span>
        )}
        {isRunning && branch.streamingContent.length === 0 && (
          <span className="parallel-branch-status">working...</span>
        )}
        {!isRunning && (
          <span className="parallel-branch-status">{branch.status}</span>
        )}
        {hasContent && (
          <span className={`parallel-branch-chevron ${expanded ? 'parallel-branch-chevron-open' : ''}`}>
            <ChevronDownIcon />
          </span>
        )}
      </div>
      {expanded && hasContent && (
        <div className="parallel-branch-content">
          {branch.messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {branch.streamingContent && (
            <MessageBubble
              message={{
                id: `streaming-${branch.branchId}`,
                role: 'assistant',
                content: branch.streamingContent,
                isStreaming: true,
                timestamp: Date.now(),
              }}
            />
          )}
          {branch.errorMessage && (
            <div className="branch-error-message">{branch.errorMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
