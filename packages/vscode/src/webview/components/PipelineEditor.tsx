/**
 * Visual Pipeline Editor — node-based workflow graph editor.
 *
 * Uses a simple canvas-based approach (no external dependency on React Flow
 * to keep bundle small). Nodes are draggable, edges are drawn as SVG paths.
 * Nodes have visible input/output connector ports. Drag from an output port
 * to an input port to create edges. Decision gate and verification nodes
 * have two labeled output ports (true/false, pass/fail).
 *
 * Supports horizontal and vertical layout directions, auto-layout via
 * topological sort, and zoom/pan via SVG viewBox.
 *
 * All mouse interactions are managed via a single `Gesture` discriminated union
 * so that only one gesture (node drag, port connect, pan) is active at a time.
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

interface AvailableModel {
  id: string;
  name: string;
}

export type LayoutDirection = 'horizontal' | 'vertical';

interface Props {
  nodes: EditorNode[];
  edges: EditorEdge[];
  onNodeMove: (nodeId: string, position: { x: number; y: number }) => void;
  onNodeSelect: (nodeId: string | null) => void;
  onNodeAdd: (type: string, position: { x: number; y: number }) => void;
  onEdgeAdd: (sourceId: string, targetId: string, label?: string) => void;
  onNodeDelete: (nodeId: string) => void;
  onEdgeDelete?: (edgeId: string) => void;
  onNodeConfigChange?: (nodeId: string, config: Record<string, unknown>) => void;
  onNodeLabelChange?: (nodeId: string, label: string) => void;
  onEnhancePrompt?: (nodeId: string, prompt: string) => void;
  selectedNodeId: string | null;
  availableModels?: AvailableModel[];
  availableTools?: string[];
  enhancingNodeId?: string | null;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 50;
const MIN_PORT_SPACING = 18;
const PORT_RADIUS = 5;
const PORT_HIT_RADIUS = 12;
const LAYER_GAP = 200;
const NODE_GAP = 80;
const ZOOM_FACTOR = 0.8;
const FIT_PADDING = 60;
const DEADZONE = 3;

const NODE_TYPE_COLORS: Record<string, string> = {
  agent: '#3b82f6',
  tool: '#10b981',
  decision_gate: '#f59e0b',
  user_checkpoint: '#8b5cf6',
  loop: '#ec4899',
  parallel: '#06b6d4',
  join: '#0891b2',
  verification: '#84cc16',
  plugin: '#6366f1',
};

/** Nodes with two output ports (branching) */
const BRANCHING_NODE_TYPES: Record<string, [string, string]> = {
  decision_gate: ['true', 'false'],
  verification: ['pass', 'fail'],
};

// ── Port positioning ──

interface PortInfo {
  nodeId: string;
  kind: 'input' | 'output';
  label?: string;
  x: number;
  y: number;
}

/** Compute effective node height — taller for parallel/join nodes with many ports in horizontal layout */
function getNodeHeight(node: EditorNode, dir: LayoutDirection, edges?: EditorEdge[]): number {
  if (dir === 'horizontal' && edges) {
    if (node.type === 'parallel') {
      const outCount = edges.filter(e => e.sourceNodeId === node.id).length + 1; // +1 for "+" port
      const needed = (outCount + 1) * MIN_PORT_SPACING;
      return Math.max(NODE_HEIGHT, needed);
    }
    if (node.type === 'join') {
      const inCount = edges.filter(e => e.targetNodeId === node.id).length;
      const needed = (inCount + 1) * MIN_PORT_SPACING;
      return Math.max(NODE_HEIGHT, needed);
    }
  }
  return NODE_HEIGHT;
}

function getInputPorts(node: EditorNode, dir: LayoutDirection, edges?: EditorEdge[]): PortInfo[] {
  // Join nodes: one input port per incoming edge (mirror of parallel's output ports)
  if (node.type === 'join' && edges) {
    const incoming = edges.filter(e => e.targetNodeId === node.id);
    if (incoming.length === 0) {
      // No connections yet — show single default input port
      return [getInputPort(node, dir)];
    }
    const nodeH = getNodeHeight(node, dir, edges);
    const count = incoming.length;

    if (dir === 'vertical') {
      const spacing = NODE_WIDTH / (count + 1);
      return incoming.map((e, i) => ({
        nodeId: node.id, kind: 'input' as const,
        label: e.label,
        x: node.position.x + spacing * (i + 1),
        y: node.position.y,
      }));
    }
    // Horizontal
    const spacing = nodeH / (count + 1);
    return incoming.map((e, i) => ({
      nodeId: node.id, kind: 'input' as const,
      label: e.label,
      x: node.position.x,
      y: node.position.y + spacing * (i + 1),
    }));
  }

  // All other nodes: single input port
  return [getInputPort(node, dir)];
}

function getInputPort(node: EditorNode, dir: LayoutDirection): PortInfo {
  if (dir === 'vertical') {
    return {
      nodeId: node.id,
      kind: 'input',
      x: node.position.x + NODE_WIDTH / 2,
      y: node.position.y,
    };
  }
  return {
    nodeId: node.id,
    kind: 'input',
    x: node.position.x,
    y: node.position.y + NODE_HEIGHT / 2,
  };
}

function getOutputPorts(node: EditorNode, dir: LayoutDirection, edges?: EditorEdge[]): PortInfo[] {
  const branches = BRANCHING_NODE_TYPES[node.type];

  // Parallel nodes: one port per outgoing edge + one extra for new connections
  if (node.type === 'parallel' && edges) {
    const outgoing = edges.filter(e => e.sourceNodeId === node.id);
    const portLabels = outgoing.map((e, i) => e.label ?? `Branch ${i + 1}`);
    // Always add an extra port for new connections
    portLabels.push('+');
    const count = portLabels.length;

    if (dir === 'vertical') {
      const spacing = NODE_WIDTH / (count + 1);
      return portLabels.map((label, i) => ({
        nodeId: node.id, kind: 'output' as const, label,
        x: node.position.x + spacing * (i + 1),
        y: node.position.y + NODE_HEIGHT,
      }));
    }
    // Horizontal: distribute ports vertically along right edge
    const nodeH = getNodeHeight(node, dir, edges);
    const spacing = nodeH / (count + 1);
    return portLabels.map((label, i) => ({
      nodeId: node.id, kind: 'output' as const, label,
      x: node.position.x + NODE_WIDTH,
      y: node.position.y + spacing * (i + 1),
    }));
  }

  if (dir === 'vertical') {
    if (branches) {
      const spacing = NODE_WIDTH / 3;
      return [
        { nodeId: node.id, kind: 'output', label: branches[0], x: node.position.x + spacing, y: node.position.y + NODE_HEIGHT },
        { nodeId: node.id, kind: 'output', label: branches[1], x: node.position.x + spacing * 2, y: node.position.y + NODE_HEIGHT },
      ];
    }
    return [{ nodeId: node.id, kind: 'output', x: node.position.x + NODE_WIDTH / 2, y: node.position.y + NODE_HEIGHT }];
  }
  // Horizontal
  if (branches) {
    const spacing = NODE_HEIGHT / 3;
    return [
      { nodeId: node.id, kind: 'output', label: branches[0], x: node.position.x + NODE_WIDTH, y: node.position.y + spacing },
      { nodeId: node.id, kind: 'output', label: branches[1], x: node.position.x + NODE_WIDTH, y: node.position.y + spacing * 2 },
    ];
  }
  return [{ nodeId: node.id, kind: 'output', x: node.position.x + NODE_WIDTH, y: node.position.y + NODE_HEIGHT / 2 }];
}

function getTargetPort(targetNode: EditorNode, edge: EditorEdge, dir: LayoutDirection, edges: EditorEdge[]): PortInfo {
  const ports = getInputPorts(targetNode, dir, edges);
  if (ports.length === 1) return ports[0];
  // For join nodes: find the port corresponding to this specific edge
  const edgeIndex = edges.filter(e => e.targetNodeId === targetNode.id).indexOf(edge);
  return ports[edgeIndex] ?? ports[0];
}

function getSourcePort(sourceNode: EditorNode, edgeLabel: string | undefined, dir: LayoutDirection, edges?: EditorEdge[]): PortInfo {
  const ports = getOutputPorts(sourceNode, dir, edges);
  if (ports.length === 1) return ports[0];
  if (edgeLabel) {
    const match = ports.find(p => p.label === edgeLabel);
    if (match) return match;
  }
  return ports[0];
}

/** Build a Bezier path between two points respecting layout direction.
 *  Control points extend outward from ports by at least MIN_CTRL_OFFSET
 *  so curves never cut through node bodies. */
const MIN_CTRL_OFFSET = 50;

function buildEdgePath(sx: number, sy: number, tx: number, ty: number, dir: LayoutDirection): string {
  if (dir === 'vertical') {
    // Outputs go downward, inputs come from above
    const dist = Math.abs(ty - sy);
    const offset = Math.max(dist / 2, MIN_CTRL_OFFSET);
    return `M ${sx} ${sy} C ${sx} ${sy + offset}, ${tx} ${ty - offset}, ${tx} ${ty}`;
  }
  // Horizontal: outputs go rightward, inputs come from the left
  const dist = Math.abs(tx - sx);
  const offset = Math.max(dist / 2, MIN_CTRL_OFFSET);
  return `M ${sx} ${sy} C ${sx + offset} ${sy}, ${tx - offset} ${ty}, ${tx} ${ty}`;
}

/** Edge label position */
function edgeLabelPos(sx: number, sy: number, tx: number, ty: number, dir: LayoutDirection): { x: number; y: number } {
  if (dir === 'vertical') {
    return { x: Math.min(sx, tx) - 10, y: (sy + ty) / 2 };
  }
  return { x: (sx + tx) / 2, y: Math.min(sy, ty) - 5 };
}

// ── Port label offset ──

function portLabelOffset(dir: LayoutDirection, portIndex: number): { dx: number; dy: number } {
  if (dir === 'vertical') {
    return { dx: portIndex === 0 ? -4 : 4, dy: 14 };
  }
  return { dx: 8, dy: 3 };
}

function portLabelAnchor(dir: LayoutDirection, portIndex: number): 'start' | 'end' {
  if (dir === 'vertical') {
    return portIndex === 0 ? 'end' : 'start';
  }
  return 'start';
}

// ── Auto-layout (topological sort + layer assignment) ──

function autoLayout(
  nodes: EditorNode[],
  edges: EditorEdge[],
  dir: LayoutDirection,
  onNodeMove: (id: string, pos: { x: number; y: number }) => void,
) {
  if (nodes.length === 0) return;

  // Build adjacency
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    children.set(n.id, []);
  }
  for (const e of edges) {
    if (inDegree.has(e.targetNodeId)) {
      inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1);
    }
    children.get(e.sourceNodeId)?.push(e.targetNodeId);
  }

  // Kahn's algorithm — assign layers
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) { queue.push(id); layer.set(id, 0); }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const currentLayer = layer.get(id) ?? 0;
    for (const child of children.get(id) ?? []) {
      const newLayer = currentLayer + 1;
      layer.set(child, Math.max(layer.get(child) ?? 0, newLayer));
      inDegree.set(child, (inDegree.get(child) ?? 0) - 1);
      if (inDegree.get(child) === 0) queue.push(child);
    }
  }

  // Assign remaining (cyclic) nodes to layer 0
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, 0);
  }

  // Group by layer
  const layers = new Map<number, string[]>();
  for (const [id, l] of layer) {
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(id);
  }

  // Position nodes
  const maxLayer = Math.max(...layers.keys(), 0);
  for (let l = 0; l <= maxLayer; l++) {
    const ids = layers.get(l) ?? [];
    ids.forEach((id, idx) => {
      let x: number, y: number;
      if (dir === 'horizontal') {
        x = FIT_PADDING + l * LAYER_GAP;
        y = FIT_PADDING + idx * (NODE_HEIGHT + NODE_GAP);
      } else {
        x = FIT_PADDING + idx * (NODE_WIDTH + NODE_GAP);
        y = FIT_PADDING + l * LAYER_GAP;
      }
      onNodeMove(id, { x, y });
    });
  }
}

// ── ViewBox helpers ──

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function computeFitViewBox(nodes: EditorNode[], containerW: number, containerH: number, dir?: LayoutDirection, edges?: EditorEdge[]): ViewBox {
  if (nodes.length === 0) {
    return { x: 0, y: 0, w: containerW, h: containerH };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const nH = (dir && edges) ? getNodeHeight(n, dir, edges) : NODE_HEIGHT;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + NODE_WIDTH);
    maxY = Math.max(maxY, n.position.y + nH);
  }
  const contentW = maxX - minX + FIT_PADDING * 2;
  const contentH = maxY - minY + FIT_PADDING * 2;
  // Maintain aspect ratio
  const scaleX = contentW / containerW;
  const scaleY = contentH / containerH;
  const scale = Math.max(scaleX, scaleY, 1);
  const w = containerW * scale;
  const h = containerH * scale;
  const x = minX - FIT_PADDING - (w - contentW) / 2;
  const y = minY - FIT_PADDING - (h - contentH) / 2;
  return { x, y, w, h };
}

// ── Gesture type — discriminated union, one gesture at a time ──

type Gesture =
  | { type: 'idle' }
  | { type: 'nodeDrag'; nodeId: string; offsetX: number; offsetY: number; started: boolean; startCX: number; startCY: number }
  | { type: 'connect'; sourceNodeId: string; portLabel?: string; startX: number; startY: number; mouseX: number; mouseY: number }
  | { type: 'pan'; startCX: number; startCY: number; vbX: number; vbY: number; moved: boolean };

const IDLE: Gesture = { type: 'idle' };

// ── Component ──

export function PipelineEditor({
  nodes, edges, onNodeMove, onNodeSelect, onNodeAdd, onEdgeAdd, onNodeDelete, onEdgeDelete,
  onNodeConfigChange, onNodeLabelChange, onEnhancePrompt, selectedNodeId,
  availableModels = [], availableTools = [], enhancingNodeId,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture>(IDLE);
  const [gesture, _setGesture] = useState<Gesture>(IDLE);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; screenX: number; screenY: number } | null>(null);
  const [hoveredPort, setHoveredPort] = useState<{ nodeId: string; kind: 'input' | 'output' } | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [layoutDir, setLayoutDir] = useState<LayoutDirection>('horizontal');
  const [viewBox, setViewBox] = useState<ViewBox>({ x: 0, y: 0, w: 800, h: 600 });
  const viewBoxRef = useRef<ViewBox>({ x: 0, y: 0, w: 800, h: 600 });
  /** True when the most recent mousedown→mouseup involved real movement or an interactive element was clicked. Prevents the subsequent click from deselecting. */
  const suppressClickRef = useRef(false);

  // Keep refs in sync with state so event handlers always read latest values
  const setGesture = useCallback((g: Gesture) => {
    gestureRef.current = g;
    _setGesture(g);
  }, []);

  const setViewBoxTracked = useCallback((updater: ViewBox | ((vb: ViewBox) => ViewBox)) => {
    setViewBox(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      viewBoxRef.current = next;
      return next;
    });
  }, []);

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;

  // Convenience: is a connection being drawn?
  const connecting = gesture.type === 'connect' ? gesture : null;

  // Initialize viewBox from container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width > 0 && height > 0) {
      const vb = { x: 0, y: 0, w: width, h: height };
      setViewBoxTracked(vb);
    }
  }, [setViewBoxTracked]);

  /** Convert client (screen) coords to SVG (viewBox) coords.
   *  Uses the SVG's native getScreenCTM() which correctly accounts for
   *  preserveAspectRatio, viewBox scaling, and centering offsets. */
  const getSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    // Invert the CTM to go from screen → SVG coordinates
    const inv = ctm.inverse();
    return {
      x: inv.a * clientX + inv.c * clientY + inv.e,
      y: inv.b * clientX + inv.d * clientY + inv.f,
    };
  }, []);

  // ── Zoom ──

  const zoomBy = useCallback((factor: number, centerX?: number, centerY?: number) => {
    setViewBoxTracked(vb => {
      const cx = centerX ?? (vb.x + vb.w / 2);
      const cy = centerY ?? (vb.y + vb.h / 2);
      const newW = vb.w * factor;
      const newH = vb.h * factor;
      return {
        x: cx - (cx - vb.x) * factor,
        y: cy - (cy - vb.y) * factor,
        w: newW,
        h: newH,
      };
    });
  }, [setViewBoxTracked]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const pt = getSvgPoint(e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    zoomBy(factor, pt.x, pt.y);
  }, [getSvgPoint, zoomBy]);

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setViewBoxTracked(computeFitViewBox(nodes, width, height, layoutDir, edges));
  }, [nodes, edges, layoutDir, setViewBoxTracked]);

  // ── Auto-layout ──

  const handleAutoLayout = useCallback((dir: LayoutDirection) => {
    setLayoutDir(dir);
    autoLayout(nodes, edges, dir, onNodeMove);
    setTimeout(() => fitToView(), 50);
  }, [nodes, edges, onNodeMove, fitToView]);

  // ── Mouse down handlers ──
  // Each handler sets the gesture and calls stopPropagation so the canvas
  // mousedown doesn't also fire. Only one gesture can be active.

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (e.button !== 0) return;
    // Don't start a node drag if a connection is being drawn — let the
    // mouseup handler complete the connection to this node instead.
    if (gestureRef.current.type === 'connect') return;
    e.stopPropagation();
    e.preventDefault();
    suppressClickRef.current = true;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const pt = getSvgPoint(e.clientX, e.clientY);
    setGesture({
      type: 'nodeDrag',
      nodeId,
      offsetX: pt.x - node.position.x,
      offsetY: pt.y - node.position.y,
      started: false,
      startCX: e.clientX,
      startCY: e.clientY,
    });
    onNodeSelect(nodeId);
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, [nodes, onNodeSelect, getSvgPoint, setGesture]);

  const handlePortMouseDown = useCallback((e: React.MouseEvent, port: PortInfo) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    suppressClickRef.current = true;
    if (port.kind === 'output') {
      setGesture({
        type: 'connect',
        sourceNodeId: port.nodeId,
        portLabel: port.label,
        startX: port.x,
        startY: port.y,
        mouseX: port.x,
        mouseY: port.y,
      });
    }
  }, [setGesture]);

  const handleEdgeMouseDown = useCallback((e: React.MouseEvent, edgeId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    suppressClickRef.current = true;
    setSelectedEdgeId(edgeId);
    onNodeSelect(null);
    setContextMenu(null);
  }, [onNodeSelect]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start pan if no gesture is active
    if (gestureRef.current.type !== 'idle') return;
    // Middle-mouse anywhere, or left-click directly on SVG background
    if (e.button === 1 || (e.button === 0 && e.target === svgRef.current)) {
      e.preventDefault();
      const vb = viewBoxRef.current;
      setGesture({ type: 'pan', startCX: e.clientX, startCY: e.clientY, vbX: vb.x, vbY: vb.y, moved: false });
    }
  }, [setGesture]);

  // ── Mouse move — single gesture at a time ──

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const g = gestureRef.current;
    switch (g.type) {
      case 'nodeDrag': {
        if (!g.started) {
          const dx = e.clientX - g.startCX;
          const dy = e.clientY - g.startCY;
          if (Math.abs(dx) > DEADZONE || Math.abs(dy) > DEADZONE) {
            setGesture({ ...g, started: true });
          }
        } else {
          const pt = getSvgPoint(e.clientX, e.clientY);
          onNodeMove(g.nodeId, {
            x: pt.x - g.offsetX,
            y: pt.y - g.offsetY,
          });
        }
        break;
      }
      case 'connect': {
        const pt = getSvgPoint(e.clientX, e.clientY);
        setGesture({ ...g, mouseX: pt.x, mouseY: pt.y });
        break;
      }
      case 'pan': {
        const svg = svgRef.current;
        if (!svg) return;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        // CTM.a is the x scale (screen pixels per SVG unit), invert for SVG units per pixel
        const scaleX = 1 / ctm.a;
        const scaleY = 1 / ctm.d;
        const dx = e.clientX - g.startCX;
        const dy = e.clientY - g.startCY;
        const moved = g.moved || Math.abs(dx) > DEADZONE || Math.abs(dy) > DEADZONE;
        if (moved) {
          const vb = viewBoxRef.current;
          setViewBoxTracked({
            ...vb,
            x: g.vbX - dx * scaleX,
            y: g.vbY - dy * scaleY,
          });
          if (!g.moved) {
            setGesture({ ...g, moved: true });
          }
        }
        break;
      }
    }
  }, [onNodeMove, getSvgPoint, setGesture, setViewBoxTracked]);

  // ── Mouse up — finish gesture ──

  const handleMouseUp = useCallback((_e: React.MouseEvent) => {
    const g = gestureRef.current;
    switch (g.type) {
      case 'connect': {
        const pt = getSvgPoint(_e.clientX, _e.clientY);
        // Try input port proximity first, then node body
        const targetNode = nodes.find(n => {
          if (n.id === g.sourceNodeId) return false;
          const ports = getInputPorts(n, layoutDir, edges);
          return ports.some(ip => {
            const dx = pt.x - ip.x;
            const dy = pt.y - ip.y;
            return Math.sqrt(dx * dx + dy * dy) <= PORT_HIT_RADIUS;
          });
        }) ?? nodes.find(n => {
          if (n.id === g.sourceNodeId) return false;
          const nH = getNodeHeight(n, layoutDir, edges);
          return pt.x >= n.position.x && pt.x <= n.position.x + NODE_WIDTH &&
                 pt.y >= n.position.y && pt.y <= n.position.y + nH;
        });
        if (targetNode) {
          onEdgeAdd(g.sourceNodeId, targetNode.id, g.portLabel);
        }
        suppressClickRef.current = true; // Always suppress click after connection attempt
        break;
      }
      case 'nodeDrag':
        suppressClickRef.current = true;
        break;
      case 'pan':
        suppressClickRef.current = g.moved;
        break;
    }
    setGesture(IDLE);
  }, [nodes, edges, onEdgeAdd, getSvgPoint, layoutDir, setGesture]);

  // ── Mouse leave SVG — cancel gesture to avoid stuck states ──

  const handleMouseLeave = useCallback(() => {
    const g = gestureRef.current;
    if (g.type !== 'idle') {
      suppressClickRef.current = (g.type === 'nodeDrag' && g.started) || (g.type === 'pan' && g.moved);
      setGesture(IDLE);
    }
  }, [setGesture]);

  // ── Canvas click — deselect only if no movement occurred ──

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // Deselect only when clicking directly on SVG background
    if (e.target === svgRef.current) {
      onNodeSelect(null);
      setSelectedEdgeId(null);
      setContextMenu(null);
    }
  }, [onNodeSelect]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const pt = getSvgPoint(e.clientX, e.clientY);
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    setContextMenu({
      x: pt.x,
      y: pt.y,
      screenX: rect ? e.clientX - rect.left : e.clientX,
      screenY: rect ? e.clientY - rect.top : e.clientY,
    });
  }, [getSvgPoint]);

  const handleAddNode = useCallback((type: string) => {
    if (contextMenu) {
      onNodeAdd(type, contextMenu);
      setContextMenu(null);
    }
  }, [contextMenu, onNodeAdd]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Delete') {
      if (selectedEdgeId && onEdgeDelete) {
        onEdgeDelete(selectedEdgeId);
        setSelectedEdgeId(null);
      } else if (selectedNodeId) {
        onNodeDelete(selectedNodeId);
      }
    }
    if (e.key === 'Escape') {
      setGesture(IDLE);
      setContextMenu(null);
    }
  }, [selectedNodeId, selectedEdgeId, onNodeDelete, onEdgeDelete, setGesture]);

  const updateConfig = (key: string, value: unknown) => {
    if (selectedNode && onNodeConfigChange) {
      onNodeConfigChange(selectedNode.id, { ...selectedNode.config, [key]: value });
    }
  };

  const vbStr = `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`;

  return (
    <div className="pipeline-editor" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="pipeline-toolbar">
        <span className="pipeline-title">Pipeline Editor</span>
        <div className="pipeline-toolbar-actions">
          <div className="pipeline-toolbar-group">
            <button
              className={`pipeline-toolbar-btn${layoutDir === 'horizontal' ? ' active' : ''}`}
              onClick={() => handleAutoLayout('horizontal')}
              title="Auto-layout: left to right"
            >
              Layout &rarr;
            </button>
            <button
              className={`pipeline-toolbar-btn${layoutDir === 'vertical' ? ' active' : ''}`}
              onClick={() => handleAutoLayout('vertical')}
              title="Auto-layout: top to bottom"
            >
              Layout &darr;
            </button>
          </div>
          <div className="pipeline-toolbar-sep" />
          <div className="pipeline-toolbar-group">
            <button className="pipeline-toolbar-btn" onClick={() => zoomBy(ZOOM_FACTOR)} title="Zoom in">+</button>
            <button className="pipeline-toolbar-btn" onClick={() => zoomBy(1 / ZOOM_FACTOR)} title="Zoom out">&minus;</button>
            <button className="pipeline-toolbar-btn" onClick={fitToView} title="Fit to view">Fit</button>
          </div>
        </div>
        <span className="pipeline-hint">Drag port to connect | Right-click to add | Scroll to zoom</span>
      </div>

      <div className="pipeline-editor-body" ref={containerRef}>
        <svg
          ref={svgRef}
          className="pipeline-canvas"
          viewBox={vbStr}
          preserveAspectRatio="xMidYMid meet"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={handleCanvasClick}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
        >
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-foreground)" fillOpacity="0.4" />
            </marker>
            <marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-focusBorder)" fillOpacity="0.8" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map(edge => {
            const source = nodes.find(n => n.id === edge.sourceNodeId);
            const target = nodes.find(n => n.id === edge.targetNodeId);
            if (!source || !target) return null;

            const sp = getSourcePort(source, edge.label, layoutDir, edges);
            const tp = getTargetPort(target, edge, layoutDir, edges);
            const lp = edgeLabelPos(sp.x, sp.y, tp.x, tp.y, layoutDir);
            const isSelected = edge.id === selectedEdgeId;
            const pathD = buildEdgePath(sp.x, sp.y, tp.x, tp.y, layoutDir);

            return (
              <g key={edge.id}>
                {/* Invisible wider hit area for easier clicking */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="14"
                  style={{ cursor: 'pointer' }}
                  onMouseDown={(e) => handleEdgeMouseDown(e, edge.id)}
                />
                <path
                  d={pathD}
                  fill="none"
                  stroke={isSelected ? 'var(--vscode-focusBorder)' : 'var(--vscode-foreground)'}
                  strokeWidth={isSelected ? 2.5 : 2}
                  strokeOpacity={isSelected ? 0.9 : 0.4}
                  markerEnd={isSelected ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                  style={{ pointerEvents: 'none' }}
                />
                {edge.label && (
                  <text x={lp.x} y={lp.y} textAnchor="middle" className="edge-label" style={{ pointerEvents: 'none' }}>
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Connecting line (drag preview) */}
          {connecting && (
            <path
              d={buildEdgePath(connecting.startX, connecting.startY, connecting.mouseX, connecting.mouseY, layoutDir)}
              fill="none"
              stroke="var(--vscode-focusBorder)"
              strokeWidth="2"
              strokeDasharray="5,5"
              markerEnd="url(#arrowhead-active)"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Nodes */}
          {nodes.map(node => {
            const color = NODE_TYPE_COLORS[node.type] ?? '#666';
            const isSelected = node.id === selectedNodeId;
            const isRunning = node.status === 'running';
            const statusIndicator = isRunning ? '\u25CF' :
              node.status === 'completed' ? '\u2713' :
              node.status === 'failed' ? '\u2717' :
              node.status === 'skipped' ? '\u2014' : '';

            const nodeH = getNodeHeight(node, layoutDir, edges);
            const inputPorts = getInputPorts(node, layoutDir, edges);
            const outputPorts = getOutputPorts(node, layoutDir, edges);

            return (
              <g key={node.id}>
                {/* Node body */}
                <rect
                  x={node.position.x}
                  y={node.position.y}
                  width={NODE_WIDTH}
                  height={nodeH}
                  rx="6"
                  ry="6"
                  fill="var(--vscode-editor-background)"
                  stroke={isSelected ? 'var(--vscode-focusBorder)' : color}
                  strokeWidth={isSelected ? 2 : 1.5}
                  style={{ cursor: 'grab' }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                >
                  {isRunning && (
                    <animate attributeName="stroke-opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />
                  )}
                </rect>
                {/* Type indicator bar */}
                <rect
                  x={node.position.x}
                  y={node.position.y}
                  width="6"
                  height={nodeH}
                  rx="6"
                  ry="6"
                  fill={color}
                  style={{ pointerEvents: 'none' }}
                />
                <text
                  x={node.position.x + NODE_WIDTH / 2 + 3}
                  y={node.position.y + 20}
                  textAnchor="middle"
                  className="node-label"
                  fill="var(--vscode-foreground)"
                  style={{ pointerEvents: 'none' }}
                >
                  {node.label}
                </text>
                <text
                  x={node.position.x + NODE_WIDTH / 2 + 3}
                  y={node.position.y + 36}
                  textAnchor="middle"
                  className="node-type"
                  fill="var(--vscode-descriptionForeground)"
                  style={{ pointerEvents: 'none' }}
                >
                  {node.type.replace(/_/g, ' ')} {statusIndicator}
                </text>

                {/* Input port(s) — join nodes have multiple, others have one */}
                {inputPorts.map((ip, ipIdx) => (
                  <g key={`in-${ipIdx}`}>
                    <circle
                      cx={ip.x}
                      cy={ip.y}
                      r={PORT_HIT_RADIUS}
                      fill="transparent"
                      style={{ cursor: 'crosshair' }}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); suppressClickRef.current = true; }}
                      onMouseEnter={() => setHoveredPort({ nodeId: node.id, kind: 'input' })}
                      onMouseLeave={() => setHoveredPort(null)}
                    />
                    <circle
                      cx={ip.x}
                      cy={ip.y}
                      r={PORT_RADIUS}
                      className={`port port-input${hoveredPort?.nodeId === node.id && hoveredPort?.kind === 'input' ? ' port-hover' : ''}${connecting ? ' port-connectable' : ''}`}
                      style={{ pointerEvents: 'none' }}
                    />
                    {ip.label && node.type === 'join' && (
                      <text
                        x={ip.x + (layoutDir === 'vertical' ? 0 : -8)}
                        y={ip.y + (layoutDir === 'vertical' ? -8 : 3)}
                        textAnchor={layoutDir === 'vertical' ? 'middle' : 'end'}
                        className="port-label"
                        fill="#0891b2"
                        style={{ pointerEvents: 'none' }}
                      >
                        {ip.label}
                      </text>
                    )}
                  </g>
                ))}

                {/* Output port(s) */}
                {outputPorts.map((port, i) => {
                  const lblOff = portLabelOffset(layoutDir, i);
                  return (
                    <g key={`out-${i}`}>
                      {/* Invisible larger hit area */}
                      <circle
                        cx={port.x}
                        cy={port.y}
                        r={PORT_HIT_RADIUS}
                        fill="transparent"
                        style={{ cursor: 'crosshair' }}
                        onMouseDown={(e) => handlePortMouseDown(e, port)}
                        onMouseEnter={() => setHoveredPort({ nodeId: node.id, kind: 'output' })}
                        onMouseLeave={() => setHoveredPort(null)}
                      />
                      <circle
                        cx={port.x}
                        cy={port.y}
                        r={PORT_RADIUS}
                        className={`port port-output${hoveredPort?.nodeId === node.id && hoveredPort?.kind === 'output' ? ' port-hover' : ''}${port.label === '+' ? ' port-add' : ''}`}
                        style={{ pointerEvents: 'none' }}
                      />
                      {port.label && (
                        <text
                          x={port.x + lblOff.dx}
                          y={port.y + lblOff.dy}
                          textAnchor={portLabelAnchor(layoutDir, i)}
                          className="port-label"
                          fill={
                            port.label === '+' ? 'var(--vscode-descriptionForeground)' :
                            node.type === 'parallel' ? '#06b6d4' :
                            i === 0 ? '#4ade80' : '#f87171'
                          }
                          style={{ pointerEvents: 'none' }}
                        >
                          {port.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Node Configuration Panel */}
        {selectedNode && (
          <div className="node-config-panel">
            <div className="node-config-header">
              <span className="node-color-dot" style={{ background: NODE_TYPE_COLORS[selectedNode.type] ?? '#666' }} />
              <span>{selectedNode.type.replace(/_/g, ' ')}</span>
            </div>

            <label className="node-config-field">
              <span>Label</span>
              <input
                type="text"
                value={selectedNode.label}
                onChange={e => onNodeLabelChange?.(selectedNode.id, e.target.value)}
              />
            </label>

            {/* Agent node config */}
            {selectedNode.type === 'agent' && (() => {
              const currentModel = (selectedNode.config.model as string) ?? '';
              const selectedTools = Array.isArray(selectedNode.config.tools) ? (selectedNode.config.tools as string[]) : [];
              const allToolsMode = selectedTools.length === 0;

              return (
                <>
                  <label className="node-config-field">
                    <span>Model</span>
                    <select
                      value={currentModel || 'default'}
                      onChange={e => updateConfig('model', e.target.value === 'default' ? undefined : e.target.value)}
                    >
                      <option value="default">Default (chat-selected model)</option>
                      {availableModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="node-config-field">
                    <div className="node-config-field-header">
                      <span>System Prompt</span>
                      <button
                        className="enhance-prompt-btn"
                        title="Enhance prompt with AI"
                        disabled={!((selectedNode.config.systemPrompt as string)?.trim()) || enhancingNodeId === selectedNode.id}
                        onClick={() => {
                          const prompt = (selectedNode.config.systemPrompt as string)?.trim();
                          if (prompt && onEnhancePrompt) {
                            onEnhancePrompt(selectedNode.id, prompt);
                          }
                        }}
                      >
                        {enhancingNodeId === selectedNode.id ? '⏳' : '✨'}
                      </button>
                    </div>
                    <textarea
                      className="system-prompt-textarea"
                      value={(selectedNode.config.systemPrompt as string) ?? ''}
                      placeholder="(use default system prompt)"
                      rows={8}
                      onChange={e => updateConfig('systemPrompt', e.target.value || undefined)}
                    />
                  </div>
                  <label className="node-config-field">
                    <span>Max Iterations</span>
                    <input
                      type="number"
                      value={(selectedNode.config.maxIterations as number) ?? 25}
                      min={1}
                      max={100}
                      onChange={e => updateConfig('maxIterations', parseInt(e.target.value) || 25)}
                    />
                  </label>
                  <label className="node-config-field">
                    <span>Temperature</span>
                    <input
                      type="number"
                      value={(selectedNode.config.temperature as number) ?? ''}
                      placeholder="(default)"
                      min={0}
                      max={2}
                      step={0.1}
                      onChange={e => updateConfig('temperature', e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </label>
                  <label className="node-config-field node-config-checkbox">
                    <input
                      type="checkbox"
                      checked={(selectedNode.config.inheritContext as boolean) ?? false}
                      onChange={e => updateConfig('inheritContext', e.target.checked)}
                    />
                    <span>Inherit conversation context</span>
                  </label>
                  <div className="node-config-field">
                    <span>Tools</span>
                    <label className="node-config-checkbox" style={{ marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={allToolsMode}
                        onChange={e => updateConfig('tools', e.target.checked ? undefined : [])}
                      />
                      <span>All tools</span>
                    </label>
                    {!allToolsMode && (
                      <div className="tool-multi-select">
                        {availableTools.map(tool => (
                          <label key={tool} className="tool-select-item">
                            <input
                              type="checkbox"
                              checked={selectedTools.includes(tool)}
                              onChange={e => {
                                const next = e.target.checked
                                  ? [...selectedTools, tool]
                                  : selectedTools.filter(t => t !== tool);
                                updateConfig('tools', next.length > 0 ? next : undefined);
                              }}
                            />
                            <span>{tool}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {/* Tool node config */}
            {selectedNode.type === 'tool' && (
              <>
                <label className="node-config-field">
                  <span>Tool Name</span>
                  <select
                    value={(selectedNode.config.toolName as string) ?? ''}
                    onChange={e => updateConfig('toolName', e.target.value)}
                  >
                    <option value="">Select a tool...</option>
                    {availableTools.map(tool => (
                      <option key={tool} value={tool}>{tool}</option>
                    ))}
                  </select>
                </label>
                <label className="node-config-field">
                  <span>Parameters (JSON)</span>
                  <textarea
                    value={JSON.stringify(selectedNode.config.parameters ?? {}, null, 2)}
                    rows={4}
                    onChange={e => {
                      try { updateConfig('parameters', JSON.parse(e.target.value)); } catch { /* invalid JSON */ }
                    }}
                  />
                </label>
              </>
            )}

            {/* Decision gate config */}
            {selectedNode.type === 'decision_gate' && (
              <>
                <label className="node-config-field">
                  <span>Condition</span>
                  <textarea
                    value={(selectedNode.config.condition as string) ?? ''}
                    rows={3}
                    onChange={e => updateConfig('condition', e.target.value)}
                  />
                </label>
                <label className="node-config-field">
                  <span>Mode</span>
                  <select
                    value={(selectedNode.config.mode as string) ?? 'ai_evaluated'}
                    onChange={e => updateConfig('mode', e.target.value)}
                  >
                    <option value="ai_evaluated">AI Evaluated</option>
                    <option value="deterministic">Deterministic</option>
                  </select>
                </label>
              </>
            )}

            {/* Parallel node config */}
            {selectedNode.type === 'parallel' && (
              <div className="node-config-field">
                <span>Fan-out</span>
                <span className="node-config-hint">
                  Connect child nodes from the output ports. Each connection creates a concurrent branch.
                  Use a Join node downstream to collect results.
                </span>
              </div>
            )}

            {/* Join node config */}
            {selectedNode.type === 'join' && (
              <>
                <label className="node-config-field">
                  <span>Merge Strategy</span>
                  <select
                    value={(selectedNode.config.mergeStrategy as string) ?? 'wait_all'}
                    onChange={e => updateConfig('mergeStrategy', e.target.value)}
                  >
                    <option value="wait_all">Wait for all branches</option>
                    <option value="first_completed">First completed wins</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
                <label className="node-config-field">
                  <span>Failure Policy</span>
                  <select
                    value={(selectedNode.config.failurePolicy as string) ?? 'collect_partial'}
                    onChange={e => updateConfig('failurePolicy', e.target.value)}
                  >
                    <option value="collect_partial">Collect partial results</option>
                    <option value="fail_fast">Fail fast (any failure stops)</option>
                    <option value="ignore_failures">Ignore failures</option>
                  </select>
                </label>
                <label className="node-config-field">
                  <span>Branch Timeout (ms)</span>
                  <input
                    type="number"
                    value={(selectedNode.config.branchTimeout as number) ?? ''}
                    placeholder="(no timeout)"
                    min={0}
                    step={1000}
                    onChange={e => updateConfig('branchTimeout', e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                  <span className="node-config-hint">Proceed without slow branches after this timeout</span>
                </label>
              </>
            )}

            {/* User checkpoint config */}
            {selectedNode.type === 'user_checkpoint' && (
              <label className="node-config-field">
                <span>Prompt</span>
                <textarea
                  value={(selectedNode.config.prompt as string) ?? ''}
                  rows={3}
                  onChange={e => updateConfig('prompt', e.target.value)}
                />
              </label>
            )}

            {/* Verification config */}
            {selectedNode.type === 'verification' && (
              <>
                <label className="node-config-field">
                  <span>Verification Type</span>
                  <select
                    value={(selectedNode.config.verificationType as string) ?? 'lsp_diagnostics'}
                    onChange={e => updateConfig('verificationType', e.target.value)}
                  >
                    <option value="lsp_diagnostics">LSP Diagnostics</option>
                    <option value="test_runner">Test Runner</option>
                    <option value="syntax_check">Syntax Check</option>
                    <option value="custom">Custom Command</option>
                  </select>
                </label>
                {(selectedNode.config.verificationType === 'test_runner' || selectedNode.config.verificationType === 'custom') && (
                  <label className="node-config-field">
                    <span>Command</span>
                    <input
                      type="text"
                      value={(selectedNode.config.command as string) ?? ''}
                      placeholder="npm test"
                      onChange={e => updateConfig('command', e.target.value)}
                    />
                  </label>
                )}
              </>
            )}

            {/* Retry config (all node types) */}
            <label className="node-config-field">
              <span>Retry Count</span>
              <input
                type="number"
                value={(selectedNode.config.retryCount as number) ?? 0}
                min={0}
                max={5}
                onChange={e => updateConfig('retryCount', parseInt(e.target.value) || 0)}
              />
              <span className="node-config-hint">Retries on failure before following error edge or escalating</span>
            </label>

            <button className="node-config-delete" onClick={() => onNodeDelete(selectedNode.id)}>
              Delete Node
            </button>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="pipeline-context-menu" style={{ left: contextMenu.screenX, top: contextMenu.screenY }}>
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
