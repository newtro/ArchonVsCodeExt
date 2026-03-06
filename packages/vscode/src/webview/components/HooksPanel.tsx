/**
 * HooksPanel — Spine + Branches UI for the agentic loop hook system.
 *
 * Displays the agentic loop lifecycle as a vertical spine (like a subway map)
 * with hooks branching off at attachment points. Supports configuration mode
 * (add/edit/reorder hooks) and live debugger mode (real-time execution).
 */

import React, { useState } from 'react';
import type {
  HookPoint,
  HookChain,
  HookNode,
  HookNodeType,
  HookTiming,
  HookExecutionStatus,
  HookExecutionEvent,
  HookTemplate,
  LLMNodeConfig,
  ScriptNodeConfig,
  DecisionNodeConfig,
  TemplateNodeConfig,
  ProviderInfo,
  ModelInfo,
  VariableDefinition,
  VariableScope,
  VariableType,
} from '@archon/core';

// ── Spine Data ──

interface SpinePoint {
  hookPoint: HookPoint;
  label: string;
  group: string;
  description: string;
  dataExposed: string[];
  canModify: string[];
  examples: string[];
}

const SPINE_POINTS: SpinePoint[] = [
  {
    hookPoint: 'turn:start', label: 'Turn Start', group: 'Turn',
    description: 'Fires at the beginning of each turn, before the user message is processed. Use this to inject context, modify the user message, or initialize turn-scoped variables.',
    dataExposed: ['userMessage', 'attachments', 'sessionState'],
    canModify: ['userMessage', 'attachments'],
    examples: ['Prepend system instructions based on project type', 'Auto-attach relevant files from memory', 'Log turn start for analytics'],
  },
  {
    hookPoint: 'llm:before', label: 'LLM Before', group: 'LLM',
    description: 'Fires before each LLM API call. Use this to inject context into the message history, modify the system prompt, or block unnecessary calls.',
    dataExposed: ['messages', 'systemPrompt', 'model'],
    canModify: ['messages', 'systemPrompt'],
    examples: ['Inject relevant code context from codebase search', 'Add memory/preferences to system prompt', 'Rate-limit LLM calls per turn'],
  },
  {
    hookPoint: 'llm:after', label: 'LLM After', group: 'LLM',
    description: 'Fires after the LLM returns a response. Use this to review, filter, or transform the response before tool calls are executed.',
    dataExposed: ['textContent', 'toolCalls'],
    canModify: ['textContent', 'toolCalls'],
    examples: ['Filter out unwanted tool calls', 'Add safety warnings to responses', 'Log token usage for budgeting'],
  },
  {
    hookPoint: 'llm:stream', label: 'LLM Stream', group: 'LLM',
    description: 'Fires during LLM streaming (not yet wired). Will allow observing or transforming streamed tokens in real-time.',
    dataExposed: ['chunk', 'accumulated'],
    canModify: [],
    examples: ['Real-time content filtering', 'Progress indicators during long responses', 'Stream-based keyword detection'],
  },
  {
    hookPoint: 'tool:before', label: 'Tool Before', group: 'Tool',
    description: 'Fires before each tool execution. Use this to audit, modify arguments, or block dangerous tool calls.',
    dataExposed: ['toolCall', 'toolName', 'arguments'],
    canModify: ['toolCall', 'arguments'],
    examples: ['Block destructive operations (rm -rf, DROP TABLE)', 'Add confirmation prompts for file writes', 'Restrict tool access by project policy'],
  },
  {
    hookPoint: 'tool:after', label: 'Tool After', group: 'Tool',
    description: 'Fires after each tool execution completes. Use this to review results, log activity, or trigger follow-up actions.',
    dataExposed: ['toolCall', 'result', 'duration'],
    canModify: ['result'],
    examples: ['Code review after write_file/edit_file', 'Track which files were modified', 'Validate test results after run_terminal'],
  },
  {
    hookPoint: 'tool:error', label: 'Tool Error', group: 'Tool',
    description: 'Fires when a tool execution fails (not yet wired). Use this to log errors, retry, or provide fallback behavior.',
    dataExposed: ['toolCall', 'error'],
    canModify: [],
    examples: ['Auto-retry failed commands', 'Notify user of persistent errors', 'Log error patterns for debugging'],
  },
  {
    hookPoint: 'loop:iterate', label: 'Loop Iterate', group: 'Loop',
    description: 'Fires at each iteration of the agent loop. Use this to monitor progress, enforce limits, or inject guidance.',
    dataExposed: ['iteration', 'messages', 'toolCallHistory'],
    canModify: [],
    examples: ['Track progress and summarize work done', 'Stop the loop if going in circles', 'Inject mid-task reminders or constraints'],
  },
  {
    hookPoint: 'loop:complete', label: 'Loop Complete', group: 'Loop',
    description: 'Fires when the agent loop finishes normally (not yet wired). Use this for cleanup, final summaries, or post-task actions.',
    dataExposed: ['messages', 'totalIterations', 'toolCallsMade'],
    canModify: [],
    examples: ['Generate a task completion summary', 'Archive conversation to memory', 'Trigger post-task workflows'],
  },
  {
    hookPoint: 'loop:max_iterations', label: 'Max Iterations', group: 'Loop',
    description: 'Fires when the loop hits the maximum iteration limit (not yet wired). Use this to handle timeouts gracefully.',
    dataExposed: ['iteration', 'messages'],
    canModify: [],
    examples: ['Save partial progress before stopping', 'Notify user with a summary of incomplete work', 'Suggest next steps'],
  },
  {
    hookPoint: 'turn:end', label: 'Turn End', group: 'Turn',
    description: 'Fires at the end of each turn, after the assistant has finished responding. Use this for post-processing, memory updates, or analytics.',
    dataExposed: ['messages', 'toolCallsMade', 'finalResponse'],
    canModify: [],
    examples: ['Extract and save key decisions to memory', 'Update session progress variables', 'Log turn metrics (tool calls, duration)'],
  },
  {
    hookPoint: 'turn:error', label: 'Turn Error', group: 'Turn',
    description: 'Fires when an unhandled error occurs during a turn. Use this for error logging, recovery, or user notification.',
    dataExposed: ['error', 'partialHistory'],
    canModify: [],
    examples: ['Log error details for debugging', 'Save partial work before crash', 'Send error notification'],
  },
  {
    hookPoint: 'agent:spawn', label: 'Agent Spawn', group: 'Agent',
    description: 'Fires when a sub-agent is spawned (not yet wired). Use this to configure, restrict, or monitor child agents.',
    dataExposed: ['agentConfig', 'parentContext'],
    canModify: ['agentConfig'],
    examples: ['Restrict sub-agent tool access', 'Inject parent context into child', 'Track agent hierarchy'],
  },
  {
    hookPoint: 'agent:complete', label: 'Agent Complete', group: 'Agent',
    description: 'Fires when a sub-agent completes (not yet wired). Use this to process results or clean up agent state.',
    dataExposed: ['agentResult', 'duration'],
    canModify: [],
    examples: ['Merge sub-agent findings into parent context', 'Log agent performance metrics', 'Validate sub-agent output quality'],
  },
];

// ── Props ──

export interface HooksPanelProps {
  chains: HookChain[];
  templates: HookTemplate[];
  debugEvents: HookExecutionEvent[];
  debugVariables: Record<string, unknown>;
  isLive: boolean;
  hooksEnabled: boolean;
  variableDefs: VariableDefinition[];
  providers: ProviderInfo[];
  models: ModelInfo[];
  modelPool: string[];
  activeProviderId: string;
  onAddChain: (hookPoint: HookPoint) => void;
  onRemoveChain: (chainId: string) => void;
  onToggleChain: (chainId: string, enabled: boolean) => void;
  onUpdateChainPriority: (chainId: string, priority: number) => void;
  onAddNode: (chainId: string, nodeType: HookNodeType) => void;
  onRemoveNode: (chainId: string, nodeId: string) => void;
  onUpdateNode: (chainId: string, nodeId: string, updates: Partial<HookNode>) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onSaveConfig: () => void;
  onLoadConfig: () => void;
  onApplyTemplate: (template: HookTemplate) => void;
  onUpdateVariableDefs: (defs: VariableDefinition[]) => void;
  onExportConfig: () => void;
  onImportConfig: () => void;
}

// ── Component ──

export function HooksPanel({
  chains,
  templates,
  debugEvents,
  debugVariables,
  isLive,
  hooksEnabled,
  variableDefs,
  providers,
  models,
  modelPool,
  activeProviderId,
  onAddChain,
  onRemoveChain,
  onToggleChain,
  onAddNode,
  onRemoveNode,
  onUpdateNode,
  onToggleEnabled,
  onApplyTemplate,
  onUpdateVariableDefs,
  onSaveConfig,
  onExportConfig,
  onImportConfig,
}: HooksPanelProps) {
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showVariables, setShowVariables] = useState(false);
  const [expandedHookPoint, setExpandedHookPoint] = useState<HookPoint | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // Group chains by hook point
  const chainsByPoint = new Map<HookPoint, HookChain[]>();
  for (const chain of chains) {
    if (!chainsByPoint.has(chain.hookPoint)) {
      chainsByPoint.set(chain.hookPoint, []);
    }
    chainsByPoint.get(chain.hookPoint)!.push(chain);
  }

  // Get debug status for a hook point
  const getPointStatus = (hp: HookPoint): HookExecutionStatus => {
    if (!isLive) return 'pending';
    const events = debugEvents.filter(e => e.hookPoint === hp);
    if (events.length === 0) return 'pending';
    if (events.some(e => e.status === 'error')) return 'error';
    if (events.some(e => e.status === 'running')) return 'running';
    if (events.every(e => e.status === 'completed' || e.status === 'skipped')) return 'completed';
    return 'pending';
  };

  // Get the selected chain and node for the config panel
  const selectedChain = chains.find(c => c.id === selectedChainId);
  const selectedNode = selectedChain?.nodes.find(n => n.id === selectedNodeId);

  return (
    <div className="hooks-panel">
      {/* Toolbar */}
      <div className="hooks-toolbar">
        <label className="hooks-toggle">
          <input
            type="checkbox"
            checked={hooksEnabled}
            onChange={e => onToggleEnabled(e.target.checked)}
          />
          <span>Hooks {hooksEnabled ? 'Enabled' : 'Disabled'}</span>
        </label>
        <div className="hooks-toolbar-actions">
          {isLive && (
            <button
              className={`hooks-debug-btn ${showDebugPanel ? 'active' : ''}`}
              onClick={() => setShowDebugPanel(!showDebugPanel)}
            >
              {isLive ? 'Live' : 'Debug'}
            </button>
          )}
          <button
            className={`hooks-vars-btn ${showVariables ? 'active' : ''}`}
            onClick={() => {
              setShowVariables(!showVariables);
              if (!showVariables) {
                setSelectedChainId(null);
                setSelectedNodeId(null);
              }
            }}
            title="Manage hook variables"
          >
            Variables
          </button>
          <button onClick={onSaveConfig} title="Save hook configuration">Save</button>
          <button onClick={onExportConfig} title="Export hooks to file">Export</button>
          <button onClick={onImportConfig} title="Import hooks from file">Import</button>
        </div>
      </div>

      <div className="hooks-content">
        {/* Spine Column */}
        <div className="hooks-spine">
          {SPINE_POINTS.map((point, idx) => {
            const pointChains = chainsByPoint.get(point.hookPoint) ?? [];
            const status = getPointStatus(point.hookPoint);
            const isExpanded = expandedHookPoint === point.hookPoint;
            const prevGroup = idx > 0 ? SPINE_POINTS[idx - 1].group : null;
            const showGroupLabel = point.group !== prevGroup;

            return (
              <div key={point.hookPoint} className="spine-point-container">
                {showGroupLabel && (
                  <div className="spine-group-label">{point.group}</div>
                )}

                {/* Spine line connector */}
                {idx > 0 && <div className="spine-line" />}

                {/* Hook point dot */}
                <div
                  className={`spine-point ${status} ${pointChains.length > 0 ? 'has-hooks' : ''}`}
                  onClick={() => {
                    setExpandedHookPoint(isExpanded ? null : point.hookPoint);
                    setSelectedChainId(null);
                    setSelectedNodeId(null);
                    setShowVariables(false);
                  }}
                  title={`${point.label} — ${pointChains.length} chain(s)`}
                >
                  <div className={`spine-dot ${status}`}>
                    {status === 'completed' && <span>&#10003;</span>}
                    {status === 'running' && <span>&#9654;</span>}
                    {status === 'error' && <span>&#10007;</span>}
                  </div>
                  <span className="spine-label">{point.label}</span>
                  {pointChains.length > 0 && (
                    <span className="spine-chain-count">{pointChains.length}</span>
                  )}
                  {isLive && debugEvents.some(e => e.hookPoint === point.hookPoint && e.duration) && (
                    <span className="spine-timing">
                      {Math.max(...debugEvents.filter(e => e.hookPoint === point.hookPoint).map(e => e.duration ?? 0))}ms
                    </span>
                  )}
                </div>

                {/* Branches — chains attached to this hook point */}
                {(isExpanded || pointChains.length > 0) && (
                  <div className="spine-branches">
                    {pointChains.map(chain => (
                      <ChainBranch
                        key={chain.id}
                        chain={chain}
                        isSelected={selectedChainId === chain.id}
                        debugEvents={debugEvents.filter(e => e.chainId === chain.id)}
                        isLive={isLive}
                        onSelect={() => {
                          setSelectedChainId(chain.id);
                          setSelectedNodeId(null);
                          setShowVariables(false);
                        }}
                        onSelectNode={(nodeId) => {
                          setSelectedChainId(chain.id);
                          setSelectedNodeId(nodeId);
                          setShowVariables(false);
                        }}
                        onToggle={(enabled) => onToggleChain(chain.id, enabled)}
                        onRemove={() => {
                          onRemoveChain(chain.id);
                          if (selectedChainId === chain.id) {
                            setSelectedChainId(null);
                            setSelectedNodeId(null);
                          }
                        }}
                      />
                    ))}

                    {/* Add hook button */}
                    {isExpanded && (
                      <button
                        className="spine-add-hook"
                        onClick={() => {
                          onAddChain(point.hookPoint);
                          setSelectedChainId(null);
                          setSelectedNodeId(null);
                        }}
                        title={`Add hook at ${point.label}`}
                      >
                        + Add Hook
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* End marker */}
          <div className="spine-point-container">
            <div className="spine-line" />
            <div className="spine-point end">
              <div className="spine-dot end" />
              <span className="spine-label">(end)</span>
            </div>
          </div>
        </div>

        {/* Config / Debug Panel (right side) */}
        <div className="hooks-detail-panel">
          {showVariables ? (
            <VariablesPanel
              definitions={variableDefs}
              runtimeValues={debugVariables}
              onUpdate={onUpdateVariableDefs}
            />
          ) : showDebugPanel && isLive ? (
            <DebugPanel
              events={debugEvents}
              variables={debugVariables}
            />
          ) : selectedNode && selectedChain ? (
            <NodeConfigPanel
              node={selectedNode}
              chainId={selectedChain.id}
              templates={templates}
              providers={providers}
              models={models}
              modelPool={modelPool}
              activeProviderId={activeProviderId}
              onUpdate={(updates) => onUpdateNode(selectedChain.id, selectedNode.id, updates)}
              onRemove={() => {
                onRemoveNode(selectedChain.id, selectedNode.id);
                setSelectedNodeId(null);
              }}
            />
          ) : selectedChain ? (
            <ChainConfigPanel
              chain={selectedChain}
              onAddNode={(nodeType) => onAddNode(selectedChain.id, nodeType)}
            />
          ) : expandedHookPoint ? (
            <HookPointDetail
              point={SPINE_POINTS.find(p => p.hookPoint === expandedHookPoint)!}
              templates={templates.filter(t => t.hookPoint === expandedHookPoint)}
              allTemplates={templates}
              onApplyTemplate={onApplyTemplate}
            />
          ) : (
            <div className="hooks-detail-empty">
              <p>Click a hook point on the spine to see details, or select a chain/node to configure.</p>
              <div className="hooks-detail-templates">
                <h4>Quick Templates</h4>
                {templates.map(t => (
                  <div
                    key={t.id}
                    className="template-card clickable"
                    title={t.description}
                    onClick={() => onApplyTemplate(t)}
                  >
                    <span className="template-name">{t.name}</span>
                    <span className="template-point">{t.hookPoint}</span>
                    <span className="template-desc">{t.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──

function ChainBranch({
  chain,
  isSelected,
  debugEvents,
  isLive,
  onSelect,
  onSelectNode,
  onToggle,
  onRemove,
}: {
  chain: HookChain;
  isSelected: boolean;
  debugEvents: HookExecutionEvent[];
  isLive: boolean;
  onSelect: () => void;
  onSelectNode: (nodeId: string) => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className={`chain-branch ${isSelected ? 'selected' : ''} ${!chain.enabled ? 'disabled' : ''}`}>
      <div className="chain-branch-header" onClick={onSelect}>
        <span className="chain-branch-connector">&#9500;&#9472;</span>
        <span className={`chain-mode-badge ${chain.mode}`}>
          {chain.mode === 'sequential' ? 'seq' : 'par'}
        </span>
        <div className="chain-branch-actions">
          <button
            className="chain-toggle-btn"
            onClick={e => { e.stopPropagation(); onToggle(!chain.enabled); }}
            title={chain.enabled ? 'Disable' : 'Enable'}
          >
            {chain.enabled ? 'on' : 'off'}
          </button>
          <button
            className="chain-remove-btn"
            onClick={e => { e.stopPropagation(); onRemove(); }}
            title="Remove chain"
          >
            &#10005;
          </button>
        </div>
      </div>

      {/* Node list */}
      <div className="chain-nodes">
        {chain.nodes.map(node => {
          const event = debugEvents.find(e => e.nodeId === node.id);
          return (
            <div
              key={node.id}
              className={`chain-node ${event?.status ?? ''} ${!node.enabled ? 'disabled' : ''}`}
              onClick={() => onSelectNode(node.id)}
            >
              <span className="chain-node-connector">&#9492;&#9472;</span>
              <span className={`node-type-badge ${node.type}`}>{nodeTypeLabel(node.type)}</span>
              <span className="chain-node-name">{node.name}</span>
              <span className={`chain-node-timing ${node.timing}`}>{node.timing}</span>
              {isLive && event?.duration !== undefined && (
                <span className="chain-node-time">{event.duration}ms</span>
              )}
              {isLive && event?.result?.summary && (
                <span className="chain-node-summary" title={event.result.summary}>
                  {event.result.summary.slice(0, 40)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChainConfigPanel({
  chain,
  onAddNode,
}: {
  chain: HookChain;
  onAddNode: (nodeType: HookNodeType) => void;
}) {
  return (
    <div className="chain-config-panel">
      <h3>Chain at {chain.hookPoint}</h3>
      <div className="config-field">
        <label>Mode</label>
        <span className={`chain-mode-badge ${chain.mode}`}>{chain.mode}</span>
      </div>
      <div className="config-field">
        <label>Priority</label>
        <span>{chain.priority}</span>
      </div>
      <div className="config-field">
        <label>Nodes ({chain.nodes.length})</label>
      </div>
      <div className="chain-add-nodes">
        <h4>Add Node</h4>
        <div className="node-type-grid">
          {(['llm', 'template', 'script', 'decision'] as HookNodeType[]).map(t => (
            <button
              key={t}
              className={`node-type-btn ${t}`}
              onClick={() => onAddNode(t)}
            >
              {nodeTypeLabel(t)}
              <span className="node-type-desc">{nodeTypeDesc(t)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function NodeConfigPanel({
  node,
  chainId,
  templates,
  providers,
  models,
  modelPool,
  activeProviderId,
  onUpdate,
  onRemove,
}: {
  node: HookNode;
  chainId: string;
  templates: HookTemplate[];
  providers: ProviderInfo[];
  models: ModelInfo[];
  modelPool: string[];
  activeProviderId: string;
  onUpdate: (updates: Partial<HookNode>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="node-config-panel">
      <div className="node-config-header">
        <h3>{node.name}</h3>
        <button className="node-remove-btn" onClick={onRemove}>Remove</button>
      </div>

      <div className="config-field">
        <label>Name</label>
        <input
          type="text"
          value={node.name}
          onChange={e => onUpdate({ name: e.target.value })}
        />
      </div>

      <div className="config-field">
        <label>Type</label>
        <span className={`node-type-badge ${node.type}`}>{nodeTypeLabel(node.type)}</span>
      </div>

      <div className="config-field">
        <label>Timing</label>
        <select
          value={node.timing}
          onChange={e => onUpdate({ timing: e.target.value as HookTiming })}
        >
          <option value="sync">Sync (blocking)</option>
          <option value="async">Async (non-blocking)</option>
          <option value="deferred">Deferred (after turn)</option>
        </select>
      </div>

      <div className="config-field">
        <label>Enabled</label>
        <input
          type="checkbox"
          checked={node.enabled}
          onChange={e => onUpdate({ enabled: e.target.checked })}
        />
      </div>

      {/* Type-specific config */}
      {node.type === 'llm' && (
        <LLMConfigFields
          config={node.config as LLMNodeConfig}
          providers={providers}
          models={models}
          modelPool={modelPool}
          activeProviderId={activeProviderId}
          onUpdate={(config) => onUpdate({ config })}
        />
      )}
      {node.type === 'script' && (
        <ScriptConfigFields
          config={node.config as ScriptNodeConfig}
          onUpdate={(config) => onUpdate({ config })}
        />
      )}
      {node.type === 'decision' && (
        <DecisionConfigFields
          config={node.config as DecisionNodeConfig}
          onUpdate={(config) => onUpdate({ config })}
        />
      )}
      {node.type === 'template' && (
        <TemplateConfigFields
          config={node.config as TemplateNodeConfig}
          templates={templates}
          onUpdate={(config) => onUpdate({ config })}
        />
      )}
    </div>
  );
}

function LLMConfigFields({
  config,
  providers,
  models,
  modelPool,
  activeProviderId,
  onUpdate,
}: {
  config: LLMNodeConfig;
  providers: ProviderInfo[];
  models: ModelInfo[];
  modelPool: string[];
  activeProviderId: string;
  onUpdate: (c: LLMNodeConfig) => void;
}) {
  const selectedProvider = config.provider || activeProviderId;
  const isOpenRouter = selectedProvider === 'openrouter';

  // For OpenRouter: show model pool models. For Claude CLI: show all models.
  const availableModels = isOpenRouter && modelPool.length > 0
    ? models.filter(m => modelPool.includes(m.id))
    : models;

  return (
    <div className="type-config-fields">
      <div className="config-field">
        <label>Prompt</label>
        <textarea
          rows={6}
          value={config.prompt ?? ''}
          onChange={e => onUpdate({ ...config, prompt: e.target.value })}
          placeholder="Instructions for the LLM hook node..."
        />
      </div>
      <div className="config-field">
        <label>Provider</label>
        <select
          value={selectedProvider}
          onChange={e => {
            const newProvider = e.target.value || undefined;
            onUpdate({ ...config, provider: newProvider, model: undefined });
          }}
        >
          {providers.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}{!p.available ? ' (unavailable)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="config-field">
        <label>Model</label>
        <select
          value={config.model ?? ''}
          onChange={e => onUpdate({ ...config, model: e.target.value || undefined })}
        >
          <option value="">Default (active model)</option>
          {availableModels.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>
      <div className="config-row">
        <div className="config-field">
          <label>Max Tokens (0 = unlimited)</label>
          <input
            type="number"
            min="0"
            value={config.maxTokens ?? 0}
            onChange={e => onUpdate({ ...config, maxTokens: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="config-field">
          <label>Temperature</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={config.temperature ?? 0.3}
            onChange={e => onUpdate({ ...config, temperature: parseFloat(e.target.value) || undefined })}
          />
        </div>
      </div>
    </div>
  );
}

function ScriptConfigFields({ config, onUpdate }: { config: ScriptNodeConfig; onUpdate: (c: ScriptNodeConfig) => void }) {
  return (
    <div className="type-config-fields">
      <div className="config-field">
        <label>Runtime</label>
        <select
          value={config.runtime}
          onChange={e => onUpdate({ ...config, runtime: e.target.value as 'node' | 'python' | 'shell' })}
        >
          <option value="node">Node.js</option>
          <option value="python">Python</option>
          <option value="shell">Shell</option>
        </select>
      </div>
      <div className="config-field">
        <label>Entry Point</label>
        <input
          type="text"
          value={config.entrypoint ?? ''}
          onChange={e => onUpdate({ ...config, entrypoint: e.target.value || undefined })}
          placeholder=".archon/hooks/my-script.js"
        />
      </div>
      <div className="config-field">
        <label>Inline Script</label>
        <textarea
          rows={6}
          value={config.inline ?? ''}
          onChange={e => onUpdate({ ...config, inline: e.target.value || undefined })}
          placeholder="// Script receives JSON on stdin, returns JSON on stdout"
        />
      </div>
      <div className="config-field">
        <label>Timeout (ms)</label>
        <input
          type="number"
          value={config.timeout ?? 5000}
          onChange={e => onUpdate({ ...config, timeout: parseInt(e.target.value) || undefined })}
        />
      </div>
    </div>
  );
}

function DecisionConfigFields({ config, onUpdate }: { config: DecisionNodeConfig; onUpdate: (c: DecisionNodeConfig) => void }) {
  return (
    <div className="type-config-fields">
      <div className="config-field">
        <label>Mode</label>
        <select
          value={config.mode}
          onChange={e => onUpdate({ ...config, mode: e.target.value as 'regex' | 'expression' | 'llm' })}
        >
          <option value="regex">Regex</option>
          <option value="expression">Expression</option>
          <option value="llm">LLM</option>
        </select>
      </div>
      {config.mode === 'regex' && (
        <>
          <div className="config-field">
            <label>Pattern</label>
            <input
              type="text"
              value={config.pattern ?? ''}
              onChange={e => onUpdate({ ...config, pattern: e.target.value })}
              placeholder="\\.(py|tsx?)$"
            />
          </div>
          <div className="config-field">
            <label>Target</label>
            <input
              type="text"
              value={config.target ?? ''}
              onChange={e => onUpdate({ ...config, target: e.target.value })}
              placeholder="$lastFile or data.toolName"
            />
          </div>
        </>
      )}
      {config.mode === 'expression' && (
        <div className="config-field">
          <label>Expression</label>
          <input
            type="text"
            value={config.expression ?? ''}
            onChange={e => onUpdate({ ...config, expression: e.target.value })}
            placeholder="$toolCallCount > 5"
          />
        </div>
      )}
      {config.mode === 'llm' && (
        <div className="config-field">
          <label>Prompt</label>
          <textarea
            rows={3}
            value={config.prompt ?? ''}
            onChange={e => onUpdate({ ...config, prompt: e.target.value })}
            placeholder="Is this conversation about a bug fix?"
          />
        </div>
      )}
      <div className="config-row">
        <div className="config-field">
          <label>On True</label>
          <select
            value={config.onTrue ?? 'continue'}
            onChange={e => onUpdate({ ...config, onTrue: e.target.value as 'continue' | 'skip' })}
          >
            <option value="continue">Continue</option>
            <option value="skip">Skip rest</option>
          </select>
        </div>
        <div className="config-field">
          <label>On False</label>
          <select
            value={config.onFalse ?? 'skip'}
            onChange={e => onUpdate({ ...config, onFalse: e.target.value as 'continue' | 'skip' })}
          >
            <option value="continue">Continue</option>
            <option value="skip">Skip rest</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function TemplateConfigFields({
  config,
  templates,
  onUpdate,
}: {
  config: TemplateNodeConfig;
  templates: HookTemplate[];
  onUpdate: (c: TemplateNodeConfig) => void;
}) {
  const selected = templates.find(t => t.id === config.templateId);
  return (
    <div className="type-config-fields">
      <div className="config-field">
        <label>Template</label>
        <select
          value={config.templateId}
          onChange={e => onUpdate({ ...config, templateId: e.target.value })}
        >
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      {selected && (
        <p className="template-description">{selected.description}</p>
      )}
    </div>
  );
}

function DebugPanel({
  events,
  variables,
}: {
  events: HookExecutionEvent[];
  variables: Record<string, unknown>;
}) {
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const event = events.find(e => e.id === selectedEvent);

  return (
    <div className="debug-panel">
      <h3>Live Debugger</h3>

      <div className="debug-events">
        {events.length === 0 && <p className="debug-empty">No hook events yet...</p>}
        {events.map(evt => (
          <div
            key={evt.id}
            className={`debug-event ${evt.status} ${selectedEvent === evt.id ? 'selected' : ''}`}
            onClick={() => setSelectedEvent(evt.id)}
          >
            <span className={`debug-status-dot ${evt.status}`} />
            <span className="debug-event-point">{evt.hookPoint}</span>
            <span className="debug-event-node">{evt.nodeName}</span>
            {evt.duration !== undefined && (
              <span className="debug-event-time">{evt.duration}ms</span>
            )}
          </div>
        ))}
      </div>

      {/* Event detail */}
      {event && (
        <div className="debug-event-detail">
          <h4>{event.hookPoint} — {event.nodeName}</h4>
          <div className="debug-detail-field">
            <label>Status</label>
            <span className={`debug-status ${event.status}`}>{event.status}</span>
          </div>
          {event.duration !== undefined && (
            <div className="debug-detail-field">
              <label>Duration</label>
              <span>{event.duration}ms</span>
            </div>
          )}
          {event.result?.summary && (
            <div className="debug-detail-field">
              <label>Summary</label>
              <span>{event.result.summary}</span>
            </div>
          )}
          {event.result?.action && event.result.action !== 'pass' && (
            <div className="debug-detail-field">
              <label>Action</label>
              <span className={`debug-action ${event.result.action}`}>{event.result.action}</span>
            </div>
          )}
          {event.result?.error && (
            <div className="debug-detail-field error">
              <label>Error</label>
              <span>{event.result.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Variables */}
      <div className="debug-variables">
        <h4>Variables</h4>
        {Object.keys(variables).length === 0 ? (
          <p className="debug-empty">No variables set</p>
        ) : (
          <div className="debug-var-list">
            {Object.entries(variables).map(([key, value]) => (
              <div key={key} className="debug-var">
                <span className="debug-var-key">{key}</span>
                <span className="debug-var-value">{JSON.stringify(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VariablesPanel({
  definitions,
  runtimeValues,
  onUpdate,
}: {
  definitions: VariableDefinition[];
  runtimeValues: Record<string, unknown>;
  onUpdate: (defs: VariableDefinition[]) => void;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const addVariable = () => {
    onUpdate([...definitions, {
      name: `newVar${definitions.length + 1}`,
      scope: 'session',
      type: 'string',
      default: '',
    }]);
    setEditingIdx(definitions.length);
  };

  const removeVariable = (idx: number) => {
    onUpdate(definitions.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
  };

  const updateVariable = (idx: number, updates: Partial<VariableDefinition>) => {
    onUpdate(definitions.map((d, i) => i === idx ? { ...d, ...updates } : d));
  };

  return (
    <div className="variables-panel">
      <div className="variables-header">
        <h3>Hook Variables</h3>
        <button className="variables-add-btn" onClick={addVariable}>+ Add Variable</button>
      </div>

      <p className="variables-description">
        Variables are shared state that hooks can read and write. Use <code>{'{{$varName}}'}</code> in LLM prompts or <code>$varName</code> in expressions.
      </p>

      {definitions.length === 0 ? (
        <div className="variables-empty">
          <p>No variables defined. Add one to get started.</p>
          <div className="variables-scope-info">
            <div><strong>Turn</strong> — reset at the start of each turn</div>
            <div><strong>Session</strong> — persists across turns in the current session</div>
            <div><strong>Persistent</strong> — saved to disk and restored between sessions</div>
          </div>
        </div>
      ) : (
        <div className="variables-list">
          {definitions.map((def, idx) => (
            <div
              key={idx}
              className={`variable-item ${editingIdx === idx ? 'editing' : ''}`}
            >
              <div className="variable-item-header" onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}>
                <span className="variable-name">${def.name}</span>
                <span className={`variable-scope-badge ${def.scope}`}>{def.scope}</span>
                <span className="variable-type-badge">{def.type}</span>
                {runtimeValues[`$${def.name}`] !== undefined && (
                  <span className="variable-runtime-value" title={JSON.stringify(runtimeValues[`$${def.name}`])}>
                    = {String(runtimeValues[`$${def.name}`]).slice(0, 30)}
                  </span>
                )}
                <button
                  className="variable-remove-btn"
                  onClick={e => { e.stopPropagation(); removeVariable(idx); }}
                  title="Remove variable"
                >
                  &#10005;
                </button>
              </div>

              {editingIdx === idx && (
                <div className="variable-edit-form" onClick={e => e.stopPropagation()}>
                  <div className="config-field">
                    <label>Name</label>
                    <input
                      type="text"
                      value={def.name}
                      onChange={e => updateVariable(idx, { name: e.target.value })}
                      placeholder="variableName"
                    />
                  </div>
                  <div className="config-row">
                    <div className="config-field">
                      <label>Scope</label>
                      <select
                        value={def.scope}
                        onChange={e => updateVariable(idx, { scope: e.target.value as VariableScope })}
                      >
                        <option value="turn">Turn</option>
                        <option value="session">Session</option>
                        <option value="persistent">Persistent</option>
                      </select>
                    </div>
                    <div className="config-field">
                      <label>Type</label>
                      <select
                        value={def.type}
                        onChange={e => updateVariable(idx, { type: e.target.value as VariableType })}
                      >
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="json">JSON</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-field">
                    <label>Default Value</label>
                    {def.type === 'boolean' ? (
                      <select
                        value={String(def.default ?? 'false')}
                        onChange={e => updateVariable(idx, { default: e.target.value === 'true' })}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : def.type === 'json' ? (
                      <textarea
                        rows={3}
                        value={typeof def.default === 'string' ? def.default : JSON.stringify(def.default ?? {}, null, 2)}
                        onChange={e => updateVariable(idx, { default: e.target.value })}
                        placeholder="{}"
                      />
                    ) : (
                      <input
                        type={def.type === 'number' ? 'number' : 'text'}
                        value={String(def.default ?? '')}
                        onChange={e => updateVariable(idx, {
                          default: def.type === 'number' ? Number(e.target.value) : e.target.value,
                        })}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HookPointDetail({
  point,
  templates: pointTemplates,
  allTemplates,
  onApplyTemplate,
}: {
  point: SpinePoint;
  templates: HookTemplate[];
  allTemplates: HookTemplate[];
  onApplyTemplate: (template: HookTemplate) => void;
}) {
  return (
    <div className="hook-point-detail">
      <h3>{point.label}</h3>
      <p className="hook-point-description">{point.description}</p>

      <div className="hook-point-section">
        <h4>Data Exposed</h4>
        <div className="hook-point-tags">
          {point.dataExposed.map(d => (
            <span key={d} className="hook-point-tag data">{d}</span>
          ))}
        </div>
      </div>

      {point.canModify.length > 0 && (
        <div className="hook-point-section">
          <h4>Can Modify</h4>
          <div className="hook-point-tags">
            {point.canModify.map(d => (
              <span key={d} className="hook-point-tag modify">{d}</span>
            ))}
          </div>
        </div>
      )}

      <div className="hook-point-section">
        <h4>Example Uses</h4>
        <ul className="hook-point-examples">
          {point.examples.map((ex, i) => (
            <li key={i}>{ex}</li>
          ))}
        </ul>
      </div>

      {pointTemplates.length > 0 && (
        <div className="hook-point-section">
          <h4>Templates for this Hook Point</h4>
          {pointTemplates.map(t => (
            <div
              key={t.id}
              className="template-card clickable"
              onClick={() => onApplyTemplate(t)}
            >
              <span className="template-name">{t.name}</span>
              <span className="template-desc">{t.description}</span>
            </div>
          ))}
        </div>
      )}

      {pointTemplates.length === 0 && (
        <div className="hook-point-section">
          <h4>Quick Templates</h4>
          <p className="hook-point-no-templates">No built-in templates for this hook point. Click "+ Add Hook" on the spine to create a custom chain.</p>
          <div className="hook-point-other-templates">
            <h4>Other Templates</h4>
            {allTemplates.map(t => (
              <div
                key={t.id}
                className="template-card clickable compact"
                onClick={() => onApplyTemplate(t)}
              >
                <span className="template-name">{t.name}</span>
                <span className="template-point">{t.hookPoint}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function nodeTypeLabel(type: HookNodeType): string {
  switch (type) {
    case 'llm': return 'LLM';
    case 'template': return 'Template';
    case 'script': return 'Script';
    case 'decision': return 'Decision';
  }
}

function nodeTypeDesc(type: HookNodeType): string {
  switch (type) {
    case 'llm': return 'Send context to an LLM';
    case 'template': return 'Pre-configured preset';
    case 'script': return 'Run JS/Python/shell';
    case 'decision': return 'Conditional gate';
  }
}
