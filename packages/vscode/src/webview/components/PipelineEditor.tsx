/**
 * Visual Pipeline Editor — node-based workflow graph editor.
 *
 * Uses a simple canvas-based approach (no external dependency on React Flow
 * to keep bundle small). Nodes are draggable, edges are drawn as SVG paths.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';

export interface EditorNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  status: string;
  config: Record<string, unknown>;
}

export interface EditorEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
}

interface Props {
  nodes: EditorNode[];
  edges: EditorEdge[];
  onNodeMove: (nodeId: string, position: { x: number; y: number }) => void;
  onNodeSelect: (nodeId: string | null) => void;
  onNodeAdd: (type: string, position: { x: number; y: number }) => void;
  onEdgeAdd: (sourceId: string, targetId: string) => void;
  onNodeDelete: (nodeId: string) => void;
  selectedNodeId: string | null;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 50;

const NODE_TYPE_COLORS: Record<string, string> = {
  agent: '#3b82f6',
  tool: '#10b981',
  decision_gate: '#f59e0b',
  user_checkpoint: '#8b5cf6',
  loop: '#ec4899',
  parallel: '#06b6d4',
  verification: '#84cc16',
  plugin: '#6366f1',
};

export function PipelineEditor({
  nodes, edges, onNodeMove, onNodeSelect, onNodeAdd, onEdgeAdd, onNodeDelete, selectedNodeId,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [connecting, setConnecting] = useState<{ sourceId: string; mouseX: number; mouseY: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    if (e.shiftKey) {
      // Start edge connection
      setConnecting({ sourceId: nodeId, mouseX: e.clientX, mouseY: e.clientY });
    } else {
      setDragging({ nodeId, offsetX: e.clientX - node.position.x, offsetY: e.clientY - node.position.y });
      onNodeSelect(nodeId);
    }
  }, [nodes, onNodeSelect]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      onNodeMove(dragging.nodeId, {
        x: e.clientX - dragging.offsetX,
        y: e.clientY - dragging.offsetY,
      });
    }
    if (connecting) {
      setConnecting({ ...connecting, mouseX: e.clientX, mouseY: e.clientY });
    }
  }, [dragging, connecting, onNodeMove]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (connecting) {
      // Check if we dropped on a node
      const targetNode = nodes.find(n => {
        const rect = { x: n.position.x, y: n.position.y, w: NODE_WIDTH, h: NODE_HEIGHT };
        return e.clientX >= rect.x && e.clientX <= rect.x + rect.w &&
               e.clientY >= rect.y && e.clientY <= rect.y + rect.h;
      });
      if (targetNode && targetNode.id !== connecting.sourceId) {
        onEdgeAdd(connecting.sourceId, targetNode.id);
      }
      setConnecting(null);
    }
    setDragging(null);
  }, [connecting, nodes, onEdgeAdd]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === svgRef.current) {
      onNodeSelect(null);
      setContextMenu(null);
    }
  }, [onNodeSelect]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleAddNode = useCallback((type: string) => {
    if (contextMenu) {
      onNodeAdd(type, contextMenu);
      setContextMenu(null);
    }
  }, [contextMenu, onNodeAdd]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Delete' && selectedNodeId) {
      onNodeDelete(selectedNodeId);
    }
  }, [selectedNodeId, onNodeDelete]);

  return (
    <div className="pipeline-editor" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="pipeline-toolbar">
        <span className="pipeline-title">Pipeline Editor</span>
        <span className="pipeline-hint">Shift+drag to connect nodes | Right-click to add | Delete to remove</span>
      </div>

      <svg
        ref={svgRef}
        className="pipeline-canvas"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleCanvasClick}
        onContextMenu={handleContextMenu}
      >
        {/* Edges */}
        {edges.map(edge => {
          const source = nodes.find(n => n.id === edge.sourceNodeId);
          const target = nodes.find(n => n.id === edge.targetNodeId);
          if (!source || !target) return null;

          const sx = source.position.x + NODE_WIDTH;
          const sy = source.position.y + NODE_HEIGHT / 2;
          const tx = target.position.x;
          const ty = target.position.y + NODE_HEIGHT / 2;
          const cx = (sx + tx) / 2;

          return (
            <g key={edge.id}>
              <path
                d={`M ${sx} ${sy} C ${cx} ${sy}, ${cx} ${ty}, ${tx} ${ty}`}
                fill="none"
                stroke="var(--vscode-foreground)"
                strokeWidth="2"
                strokeOpacity="0.4"
                markerEnd="url(#arrowhead)"
              />
              {edge.label && (
                <text x={cx} y={Math.min(sy, ty) - 5} textAnchor="middle" className="edge-label">
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Connecting line */}
        {connecting && (
          <line
            x1={nodes.find(n => n.id === connecting.sourceId)!.position.x + NODE_WIDTH}
            y1={nodes.find(n => n.id === connecting.sourceId)!.position.y + NODE_HEIGHT / 2}
            x2={connecting.mouseX}
            y2={connecting.mouseY}
            stroke="var(--vscode-focusBorder)"
            strokeWidth="2"
            strokeDasharray="5,5"
          />
        )}

        {/* Arrow marker */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-foreground)" fillOpacity="0.4" />
          </marker>
        </defs>

        {/* Nodes */}
        {nodes.map(node => {
          const color = NODE_TYPE_COLORS[node.type] ?? '#666';
          const isSelected = node.id === selectedNodeId;
          const statusIndicator = node.status === 'running' ? '\u25CF' :
            node.status === 'completed' ? '\u2713' :
            node.status === 'failed' ? '\u2717' : '';

          return (
            <g key={node.id} onMouseDown={(e) => handleMouseDown(e, node.id)}>
              <rect
                x={node.position.x}
                y={node.position.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx="6"
                ry="6"
                fill="var(--vscode-editor-background)"
                stroke={isSelected ? 'var(--vscode-focusBorder)' : color}
                strokeWidth={isSelected ? 2 : 1.5}
                style={{ cursor: 'grab' }}
              />
              {/* Type indicator bar */}
              <rect
                x={node.position.x}
                y={node.position.y}
                width="6"
                height={NODE_HEIGHT}
                rx="6"
                ry="6"
                fill={color}
              />
              <text
                x={node.position.x + NODE_WIDTH / 2 + 3}
                y={node.position.y + 20}
                textAnchor="middle"
                className="node-label"
                fill="var(--vscode-foreground)"
              >
                {node.label}
              </text>
              <text
                x={node.position.x + NODE_WIDTH / 2 + 3}
                y={node.position.y + 36}
                textAnchor="middle"
                className="node-type"
                fill="var(--vscode-descriptionForeground)"
              >
                {node.type} {statusIndicator}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Context menu */}
      {contextMenu && (
        <div className="pipeline-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {Object.keys(NODE_TYPE_COLORS).map(type => (
            <button key={type} onClick={() => handleAddNode(type)}>
              <span className="node-color-dot" style={{ background: NODE_TYPE_COLORS[type] }} />
              {type.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
