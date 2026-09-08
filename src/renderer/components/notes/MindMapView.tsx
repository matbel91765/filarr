/**
 * MindMapView Component — Filarr Notes
 *
 * SVG-based mind map visualization of a note's heading structure.
 * Parses TipTap JSON content, builds a tree from H1->H2->H3 hierarchy,
 * and renders a zoomable/pannable mind map with curved bezier connections.
 *
 * LES TITRES NE SONT PLUS EXTRAITS ICI. Cette vue portait sa propre boucle,
 * NON récursive, sur `doc.content` : un titre posé dans un encadré, une
 * colonne ou un volet repliable était visible dans le sommaire latéral et
 * proposé par `![[Note#`, mais restait absent de la carte mentale. Elle
 * consomme désormais `extractHeadings`, comme toutes les autres surfaces.
 *
 * CONSÉQUENCE SUR `pos` : ce champ n'est plus un index dans `doc.content`,
 * c'est le RANG DU TITRE dans le document (titres vides compris). NoteEditor
 * résout `pendingScrollToHeading` avec la même convention — les deux doivent
 * changer ensemble.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { requestScrollToHeading } from '../../../store/slices/notesSlice';
import { extractHeadingsFromJson } from '../../../services/notes/transclusionHelpers';
import './MindMapView.css';

import * as profileStorage from '../../../services/core/profileStorage';
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
  note: { id: string; title: string; content: string } | null;
  onHeadingClick?: (pos: number) => void;
  /**
   * Click a node → switch back to list mode + focus the editor on
   * this note. Same pattern as Masonry / Sticky / Kanban / Database /
   * Calendar so the user can drill from overview to editor in one
   * click. Called with the active note's id (the mind map only ever
   * shows one note at a time).
   */
  onOpenNote?: (id: string) => void;
}

const COLLAPSE_STORAGE_KEY = 'filarr.mindmap.collapsed.v1';

function loadCollapsed(noteId: string | null): Set<string> {
  if (!noteId) return new Set();
  try {
    const raw = profileStorage.getItemWithLegacyFallback(COLLAPSE_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const arr = parsed?.[noteId];
    if (!Array.isArray(arr)) return new Set();
    // Strip the legacy `'root'` entry. Earlier versions of "Collapse all"
    // included root in the collapsible list, which now traps users in the
    // empty state until they manually expand. Self-healing on every load.
    return new Set(arr.filter((id) => id !== 'root'));
  } catch {
    return new Set();
  }
}

function persistCollapsed(noteId: string | null, collapsed: Set<string>): void {
  if (!noteId) return;
  try {
    const raw = profileStorage.getItemWithLegacyFallback(COLLAPSE_STORAGE_KEY);
    const parsed: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    if (collapsed.size === 0) {
      delete parsed[noteId];
    } else {
      parsed[noteId] = [...collapsed];
    }
    profileStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* quota / disabled — silent */
  }
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

function measureText(text: string, fontSize: number): number {
  const avgCharWidth = fontSize * 0.58;
  return Math.min(
    MAX_NODE_WIDTH,
    Math.max(MIN_NODE_WIDTH, text.length * avgCharWidth + NODE_PADDING_X * 2)
  );
}

// ==================== Tree Building ====================

/**
 * Exporté pour être testé sans DOM (`__tests__/mindMapTree.vitest.ts`) : la
 * pile de construction est le seul endroit où un titre imbriqué sans parent
 * de niveau supérieur pourrait se perdre — et un nœud absent de la carte est
 * un titre qu'on ne peut plus rejoindre d'un clic.
 */
export function buildMindMapTree(content: string, title: string): MindMapNode {
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

  // `entry.index` est le rang du titre dans le document, titres vides
  // compris — on ne le recalcule pas après filtrage, sous peine de faire
  // atterrir le clic sur un autre titre que celui affiché.
  const headings = extractHeadingsFromJson(content)
    .filter((entry) => entry.text.trim().length > 0)
    .map((entry) => ({ text: entry.text.trim(), level: entry.level, pos: entry.index }));

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
  collapsed: Set<string>
): number {
  node.x = x;
  const isCollapsed = collapsed.has(node.id);

  if (node.children.length === 0 || isCollapsed) {
    node.y = yStart + node.height / 2;
    return node.height + NODE_V_GAP;
  }

  const childX = x + node.width + NODE_H_GAP;
  let currentY = yStart;

  for (const child of node.children) {
    const consumed = layoutTree(child, childX, currentY, _depth + 1, collapsed);
    currentY += consumed;
  }

  // Center parent vertically among its children
  const firstChildY = node.children[0].y;
  const lastChildY = node.children[node.children.length - 1].y;
  node.y = (firstChildY + lastChildY) / 2;

  const totalHeight = currentY - yStart - NODE_V_GAP;
  return totalHeight + NODE_V_GAP;
}

function collectNodes(
  node: MindMapNode,
  collapsed: Set<string>,
  list: MindMapNode[] = []
): MindMapNode[] {
  list.push(node);
  if (collapsed.has(node.id)) return list;
  for (const child of node.children) {
    collectNodes(child, collapsed, list);
  }
  return list;
}

interface Edge {
  from: MindMapNode;
  to: MindMapNode;
}

function collectEdges(node: MindMapNode, collapsed: Set<string>, list: Edge[] = []): Edge[] {
  if (collapsed.has(node.id)) return list;
  for (const child of node.children) {
    list.push({ from: node, to: child });
    collectEdges(child, collapsed, list);
  }
  return list;
}

/** All non-root node ids that have at least one child — usable as
 *  targets for "collapse all" without trapping the user. The root
 *  itself is intentionally never collapsible: collapsing it would hide
 *  every node in the tree, including the root's own collapse chevron's
 *  parent (the children that would render it), leaving the user with
 *  just a tiny title and no visible affordance to recover. */
function collectCollapsibleIds(node: MindMapNode, list: string[] = []): string[] {
  for (const child of node.children) {
    if (child.children.length > 0) list.push(child.id);
    collectCollapsibleIds(child, list);
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

const MindMapView: React.FC<MindMapViewProps> = ({ note, onHeadingClick, onOpenNote }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport state for zoom/pan
  const [viewBox, setViewBox] = useState({ x: -40, y: -40, w: 800, h: 600 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Per-note collapsed branches. Hydrated from localStorage when the
  // active note changes — different notes can have different sections
  // collapsed. Persisted on every change.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(note?.id ?? null));
  useEffect(() => {
    setCollapsed(loadCollapsed(note?.id ?? null));
  }, [note?.id]);
  useEffect(() => {
    persistCollapsed(note?.id ?? null, collapsed);
  }, [note?.id, collapsed]);

  // Build and layout tree
  const { nodes, edges, bounds, allCollapsibleIds, hasHeadings } = useMemo(() => {
    if (!note) {
      return {
        nodes: [],
        edges: [],
        bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600 },
        allCollapsibleIds: [] as string[],
        hasHeadings: false,
      };
    }

    const root = buildMindMapTree(note.content, note.title);
    layoutTree(root, 0, 0, 0, collapsed);

    const allNodes = collectNodes(root, collapsed);
    const allEdges = collectEdges(root, collapsed);
    const collapsibleIds = collectCollapsibleIds(root);
    // Source-of-truth empty check: do we have any heading in the parsed
    // tree at all? Independent of the collapse state, so a fully-collapsed
    // tree still renders the root + chevron instead of the empty state.
    const headingsExist = root.children.length > 0;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
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
      allCollapsibleIds: collapsibleIds,
      hasHeadings: headingsExist,
    };
  }, [note, collapsed]);

  const toggleCollapsed = useCallback((nodeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsed(new Set(allCollapsibleIds));
  }, [allCollapsibleIds]);

  const expandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

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
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
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
    },
    [viewBox]
  );

  // Pan with mouse drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as SVGElement;
      if (target.closest('.mindmap-node')) return;

      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y };
    },
    [viewBox]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width;
      const scaleY = viewBox.h / rect.height;
      const dx = (e.clientX - panStart.current.x) * scaleX;
      const dy = (e.clientY - panStart.current.y) * scaleY;
      setViewBox((prev) => ({
        ...prev,
        x: panStart.current.vx - dx,
        y: panStart.current.vy - dy,
      }));
    },
    [isPanning, viewBox.w, viewBox.h]
  );

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

  const handleNodeClick = useCallback(
    (node: MindMapNode) => {
      // Click any node — root or a heading — to drill back into the
      // editor. The mind map only ever represents one note at a time
      // so we always open `note.id` (the prop's note).
      //
      // For a heading node (pos >= 0) we ALSO ask the editor to scroll
      // to that heading via Redux: a transient `pendingScrollToHeading`
      // flag the editor reads + clears after acting on it. Bridges the
      // two views without coupling MindMap to the editor instance.
      if (!note) return;
      if (node.pos >= 0) {
        dispatch(requestScrollToHeading({ noteId: note.id, index: node.pos }));
      }
      if (onOpenNote) onOpenNote(note.id);
      if (node.pos >= 0 && onHeadingClick) onHeadingClick(node.pos);
    },
    [note, onHeadingClick, onOpenNote, dispatch]
  );

  if (!note) {
    return (
      <div className="mindmap-view mindmap-view--empty">
        <div className="mindmap-view__empty-msg">
          {t('notes.mindmap.noNote', 'Select a note to view its mind map')}
        </div>
      </div>
    );
  }

  // Empty state only when the source has zero headings — collapsing
  // every branch must NOT trigger this, otherwise the user gets stuck
  // with no way to expand back from a screen that says "no headings".
  if (!hasHeadings) {
    return (
      <div className="mindmap-view mindmap-view--empty">
        <div className="mindmap-view__empty-msg">
          {t(
            'notes.mindmap.noHeadings',
            'No headings found. Add headings (H1, H2, H3...) to build a mind map.'
          )}
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
          onClick={() => setViewBox((prev) => ({ ...prev, w: prev.w * 0.8, h: prev.h * 0.8 }))}
          title={t('notes.mindmap.zoomIn', 'Zoom in')}
        >
          +
        </button>
        <button
          className="mindmap-view__btn"
          onClick={() => setViewBox((prev) => ({ ...prev, w: prev.w * 1.2, h: prev.h * 1.2 }))}
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
          {nodes.map((node) => {
            const color = getNodeColor(node.level);
            const isRoot = node.level === 0;
            const isHovered = hoveredNode === node.id;
            const fontSize = isRoot ? ROOT_FONT_SIZE : NODE_FONT_SIZE;
            const displayText = truncateText(node.text, node.width);
            const hasChildren = node.children.length > 0;
            const isCollapsed = collapsed.has(node.id);

            return (
              <g
                key={node.id}
                className="mindmap-node"
                transform={`translate(${node.x}, ${node.y - node.height / 2})`}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => handleNodeClick(node)}
                style={{ cursor: 'pointer' }}
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
                {hasChildren && (
                  // Collapse / expand chevron, attached to the right edge
                  // of the node. Click stops propagation so we don't also
                  // jump to the heading position in the editor.
                  <g
                    className="mindmap-node__toggle"
                    transform={`translate(${node.width + 4}, ${node.height / 2 - 8})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapsed(node.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      cx={8}
                      cy={8}
                      r={8}
                      fill={isCollapsed ? color.fill : 'var(--color-surface, #fff)'}
                      stroke={color.stroke}
                      strokeWidth={1.5}
                    />
                    <text
                      x={8}
                      y={9}
                      dominantBaseline="central"
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={700}
                      fill={isCollapsed ? color.text : color.stroke}
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {isCollapsed ? '+' : '−'}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend + collapse controls */}
      <div className="mindmap-view__legend">
        {[
          { label: 'H1', level: 1 },
          { label: 'H2', level: 2 },
          { label: 'H3', level: 3 },
          { label: 'H4', level: 4 },
        ].map((item) => (
          <span key={item.label} className="mindmap-view__legend-item">
            <span
              className="mindmap-view__legend-dot"
              style={{ backgroundColor: getNodeColor(item.level).fill }}
            />
            {item.label}
          </span>
        ))}
        {allCollapsibleIds.length > 0 && (
          <span className="mindmap-view__legend-actions">
            <button
              type="button"
              className="mindmap-view__legend-btn"
              onClick={collapseAll}
              title={t('notes.mindmapCollapseAll', 'Collapse all branches')}
            >
              {t('notes.mindmapCollapseAllShort', 'Collapse')}
            </button>
            <button
              type="button"
              className="mindmap-view__legend-btn"
              onClick={expandAll}
              disabled={collapsed.size === 0}
              title={t('notes.mindmapExpandAll', 'Expand all branches')}
            >
              {t('notes.mindmapExpandAllShort', 'Expand')}
            </button>
          </span>
        )}
      </div>
    </div>
  );
};

export default MindMapView;
