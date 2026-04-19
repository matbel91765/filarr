/**
 * MindMapView Component — Filarr Notes
 *
 * SVG-based mind map visualization of a note's heading structure.
 * Parses TipTap JSON content, builds a tree from H1->H2->H3 hierarchy,
 * and renders a zoomable/pannable mind map with curved bezier connections.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './MindMapView.css';

// ==================== Types ====================

interface MindMapNode {
  id: string;
  text: string;
  level: number;
  children: MindMapNode[];
  pos: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MindMapViewProps {
  note: { title: string; content: string } | null;
  onHeadingClick?: (pos: number) => void;
}

// ==================== Constants ====================

const LEVEL_COLORS: Record<number, { fill: string; stroke: string; text: string }> = {
  0: { fill: '#3b82f6', stroke: '#2563eb', text: '#ffffff' },
  1: { fill: '#4a9eed', stroke: '#2d7dd2', text: '#ffffff' },
  2: { fill: '#34d399', stroke: '#059669', text: '#065f46' },
  3: { fill: '#fb923c', stroke: '#ea580c', text: '#7c2d12' },
  4: { fill: '#a78bfa', stroke: '#7c3aed', text: '#4c1d95' },
  5: { fill: '#f472b6', stroke: '#db2777', text: '#831843' },
};

const NODE_H_GAP = 60;
const NODE_V_GAP = 14;
const NODE_PADDING_X = 16;
const NODE_FONT_SIZE = 13;
const ROOT_FONT_SIZE = 15;
const NODE_BORDER_RADIUS = 8;
const MIN_NODE_WIDTH = 80;
const MAX_NODE_WIDTH = 220;

// ==================== Text Helpers ====================

function extractText(node: any): string {
  if (typeof node === 'string') return node;
  if (node.text) return node.text;
  if (node.content) return node.content.map(extractText).join('');
  return '';
}

function measureText(text: string, fontSize: number): number {
  const avgCharWidth = fontSize * 0.58;
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, text.length * avgCharWidth + NODE_PADDING_X * 2));
}

// ==================== Tree Building ====================

function buildTree(content: string, title: string): MindMapNode {
  const root: MindMapNode = {
    id: 'root',
    text: title || 'Untitled',
    level: 0,
    children: [],
    pos: -1,
    x: 0,
    y: 0,
    width: measureText(title || 'Untitled', ROOT_FONT_SIZE),
    height: 36,
  };

  const headings: { text: string; level: number; pos: number }[] = [];

  try {
    const doc = JSON.parse(content);
    if (doc?.content) {
      let pos = 0;
      for (const node of doc.content) {
        if (node.type === 'heading' && node.attrs?.level) {
          const text = extractText(node).trim();
          if (text) {
            headings.push({ text, level: node.attrs.level, pos });
          }
        }
        pos += 1;
      }
    }
  } catch {
    // content might not be valid JSON
  }

  if (headings.length === 0) return root;

  // Build hierarchy: H1 children of root, H2 children of last H1, etc.
  const stack: MindMapNode[] = [root];

  for (const h of headings) {
    const node: MindMapNode = {
      id: `h-${h.pos}`,
      text: h.text,
      level: h.level,
      children: [],
      pos: h.pos,
      x: 0,
      y: 0,
      width: measureText(h.text, NODE_FONT_SIZE),
      height: 32,
    };

    // Find the correct parent: walk up the stack until we find a node with a lower level
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }

    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return root;
}

// ==================== Layout ====================

function layoutTree(
  node: MindMapNode,
  x: number,
  yStart: number,
  _depth: number,
): number {
  node.x = x;

  if (node.children.length === 0) {
    node.y = yStart + node.height / 2;
    return node.height + NODE_V_GAP;
  }

  const childX = x + node.width + NODE_H_GAP;
  let currentY = yStart;

  for (const child of node.children) {
    const consumed = layoutTree(child, childX, currentY, _depth + 1);
    currentY += consumed;
  }

  // Center parent vertically among its children
  const firstChildY = node.children[0].y;
  const lastChildY = node.children[node.children.length - 1].y;
  node.y = (firstChildY + lastChildY) / 2;

  const totalHeight = currentY - yStart - NODE_V_GAP;
  return totalHeight + NODE_V_GAP;
}

function collectNodes(node: MindMapNode, list: MindMapNode[] = []): MindMapNode[] {
  list.push(node);
  for (const child of node.children) {
    collectNodes(child, list);
  }
  return list;
}

interface Edge {
  from: MindMapNode;
  to: MindMapNode;
}

function collectEdges(node: MindMapNode, list: Edge[] = []): Edge[] {
  for (const child of node.children) {
    list.push({ from: node, to: child });
    collectEdges(child, list);
  }
  return list;
}

function getNodeColor(level: number) {
  return LEVEL_COLORS[level] || LEVEL_COLORS[5];
}

function truncateText(text: string, maxWidth: number): string {
  const maxChars = Math.floor((maxWidth - NODE_PADDING_X * 2) / (NODE_FONT_SIZE * 0.58));
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + '\u2026';
}

// ==================== Component ====================

const MindMapView: React.FC<MindMapViewProps> = ({ note, onHeadingClick }) => {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport state for zoom/pan
  const [viewBox, setViewBox] = useState({ x: -40, y: -40, w: 800, h: 600 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Build and layout tree
  const { nodes, edges, bounds } = useMemo(() => {
    if (!note) {
      return { nodes: [], edges: [], bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600 } };
    }

    const root = buildTree(note.content, note.title);
    layoutTree(root, 0, 0, 0);

    const allNodes = collectNodes(root);
    const allEdges = collectEdges(root);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of allNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y - n.height / 2);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height / 2);
    }

    return {
      nodes: allNodes,
      edges: allEdges,
      bounds: {
        minX: minX - 40,
        minY: minY - 40,
        maxX: maxX + 40,
        maxY: maxY + 40,
      },
    };
  }, [note]);

  // Fit view on mount or when note changes
  useEffect(() => {
    if (nodes.length === 0) return;
    const padding = 60;
    setViewBox({
      x: bounds.minX - padding,
      y: bounds.minY - padding,
      w: bounds.maxX - bounds.minX + padding * 2,
      h: bounds.maxY - bounds.minY + padding * 2,
    });
  }, [nodes, bounds]);

  // Zoom with mouse wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x;
    const mouseY = ((e.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y;

    const newW = viewBox.w * factor;
    const newH = viewBox.h * factor;
    const newX = mouseX - (mouseX - viewBox.x) * factor;
    const newY = mouseY - (mouseY - viewBox.y) * factor;

    setViewBox({ x: newX, y: newY, w: newW, h: newH });
  }, [viewBox]);

  // Pan with mouse drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as SVGElement;
    if (target.closest('.mindmap-node')) return;

    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y };
  }, [viewBox]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    const dx = (e.clientX - panStart.current.x) * scaleX;
    const dy = (e.clientY - panStart.current.y) * scaleY;
    setViewBox(prev => ({
      ...prev,
      x: panStart.current.vx - dx,
      y: panStart.current.vy - dy,
    }));
  }, [isPanning, viewBox.w, viewBox.h]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Fit to view
  const handleFitView = useCallback(() => {
    if (nodes.length === 0) return;
    const padding = 60;
    setViewBox({
      x: bounds.minX - padding,
      y: bounds.minY - padding,
      w: bounds.maxX - bounds.minX + padding * 2,
      h: bounds.maxY - bounds.minY + padding * 2,
    });
  }, [nodes, bounds]);

  const handleNodeClick = useCallback((node: MindMapNode) => {
    if (node.pos >= 0 && onHeadingClick) {
      onHeadingClick(node.pos);
    }
  }, [onHeadingClick]);

  if (!note) {
    return (
      <div className="mindmap-view mindmap-view--empty">
        <div className="mindmap-view__empty-msg">
          {t('notes.mindmap.noNote', 'Select a note to view its mind map')}
        </div>
      </div>
    );
  }

  if (nodes.length <= 1) {
    return (
      <div className="mindmap-view mindmap-view--empty">
        <div className="mindmap-view__empty-msg">
          {t('notes.mindmap.noHeadings', 'No headings found. Add headings (H1, H2, H3...) to build a mind map.')}
        </div>
      </div>
    );
  }

  return (
    <div className="mindmap-view" ref={containerRef}>
      {/* Toolbar */}
      <div className="mindmap-view__toolbar">
        <button
          className="mindmap-view__btn"
          onClick={() => setViewBox(prev => ({ ...prev, w: prev.w * 0.8, h: prev.h * 0.8 }))}
          title={t('notes.mindmap.zoomIn', 'Zoom in')}
        >
          +
        </button>
        <button
          className="mindmap-view__btn"
          onClick={() => setViewBox(prev => ({ ...prev, w: prev.w * 1.2, h: prev.h * 1.2 }))}
          title={t('notes.mindmap.zoomOut', 'Zoom out')}
        >
          &minus;
        </button>
        <button
          className="mindmap-view__btn"
          onClick={handleFitView}
          title={t('notes.mindmap.fitView', 'Fit to view')}
        >
          &#x2293;
        </button>
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        className={`mindmap-view__svg ${isPanning ? 'mindmap-view__svg--panning' : ''}`}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <filter id="mindmap-shadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.12" />
          </filter>
        </defs>

        {/* Edges */}
        <g className="mindmap-view__edges">
          {edges.map((edge, i) => {
            const fromX = edge.from.x + edge.from.width;
            const fromY = edge.from.y;
            const toX = edge.to.x;
            const toY = edge.to.y;
            const cpOffset = (toX - fromX) * 0.5;
            const isHighlighted = hoveredNode === edge.from.id || hoveredNode === edge.to.id;
            const color = getNodeColor(edge.to.level);

            return (
              <path
                key={`edge-${i}`}
                className={`mindmap-view__edge ${isHighlighted ? 'mindmap-view__edge--highlight' : ''}`}
                d={`M ${fromX} ${fromY} C ${fromX + cpOffset} ${fromY}, ${toX - cpOffset} ${toY}, ${toX} ${toY}`}
                fill="none"
                stroke={isHighlighted ? color.stroke : 'var(--color-border, #cbd5e1)'}
                strokeWidth={isHighlighted ? 2.5 : 1.5}
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g className="mindmap-view__nodes">
          {nodes.map(node => {
            const color = getNodeColor(node.level);
            const isRoot = node.level === 0;
            const isHovered = hoveredNode === node.id;
            const fontSize = isRoot ? ROOT_FONT_SIZE : NODE_FONT_SIZE;
            const displayText = truncateText(node.text, node.width);

            return (
              <g
                key={node.id}
                className="mindmap-node"
                transform={`translate(${node.x}, ${node.y - node.height / 2})`}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => handleNodeClick(node)}
                style={{ cursor: node.pos >= 0 ? 'pointer' : 'default' }}
              >
                <rect
                  className="mindmap-node__bg"
                  width={node.width}
                  height={node.height}
                  rx={NODE_BORDER_RADIUS}
                  ry={NODE_BORDER_RADIUS}
                  fill={color.fill}
                  stroke={isHovered ? color.stroke : 'transparent'}
                  strokeWidth={isHovered ? 2 : 0}
                  filter={isRoot || isHovered ? 'url(#mindmap-shadow)' : undefined}
                  opacity={isHovered ? 1 : 0.9}
                />
                <text
                  className="mindmap-node__text"
                  x={node.width / 2}
                  y={node.height / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                  fill={color.text}
                  fontSize={fontSize}
                  fontWeight={isRoot ? 600 : 500}
                >
                  {displayText}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="mindmap-view__legend">
        {[
          { label: 'H1', level: 1 },
          { label: 'H2', level: 2 },
          { label: 'H3', level: 3 },
          { label: 'H4', level: 4 },
        ].map(item => (
          <span key={item.label} className="mindmap-view__legend-item">
            <span
              className="mindmap-view__legend-dot"
              style={{ backgroundColor: getNodeColor(item.level).fill }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export default MindMapView;
