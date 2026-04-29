/**
 * GraphView Component — Filarr Notes
 *
 * Force-directed graph visualization with:
 * - Automatic cluster detection (simplified Louvain)
 * - Dynamic filter (search, type)
 * - Heat map mode (recency-based coloring)
 * - Interactive force layout (RAF + node dragging)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  selectAllNotes,
  selectAllNotebooks,
  setEditingNote,
  setNotesViewMode,
  setNotesFilterNotebook,
  updateNoteContent,
  resolveNoteLinks,
} from '../../../store/slices/notesSlice';
import { setCurrentFolder } from '../../../store/slices/foldersSlice';
import type { GraphNode, GraphEdge } from '../../../types/notes';
import { detectClusters, recencyScore, heatColor } from '../../../services/notes/graphAlgorithms';
import {
  filterNotesByDate,
  sliderToDate,
  dateToSlider,
} from '../../../services/notes/graphTimeTravel';
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import './GraphView.css';

// ==================== Colors ====================

const NODE_COLORS: Record<string, { fill: string; glow: string; light: string }> = {
  note: { fill: '#4a9eed', glow: 'rgba(74, 158, 237, 0.4)', light: '#7ab8f5' },
  file: { fill: '#34d399', glow: 'rgba(52, 211, 153, 0.4)', light: '#6ee7b7' },
  folder: { fill: '#fbbf24', glow: 'rgba(251, 191, 36, 0.4)', light: '#fcd34d' },
  notebook: { fill: '#a855f7', glow: 'rgba(168, 85, 247, 0.4)', light: '#c084fc' },
};

// ==================== Force Simulation (RAF-based) ====================

interface SimNode extends GraphNode {
  fx?: number | null;
  fy?: number | null;
  clusterId?: number;
  updatedAt?: string;
}

function initializePositions(nodes: SimNode[]): void {
  // Spread around origin — simulation runs in unbounded space (like Obsidian)
  const spread = Math.max(300, nodes.length * 12);
  nodes.forEach((n) => {
    if (!n.x || !n.y) {
      n.x = (Math.random() - 0.5) * spread;
      n.y = (Math.random() - 0.5) * spread;
    }
    n.vx = 0;
    n.vy = 0;
  });
}

/**
 * Compute the bounding box of all nodes and return a transform that fits
 * them into the viewport with padding.
 */
function computeFitTransform(
  nodes: SimNode[],
  viewWidth: number,
  viewHeight: number
): { x: number; y: number; scale: number } {
  if (nodes.length === 0) return { x: 0, y: 0, scale: 1 };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const padding = 80;
  const graphW = maxX - minX + padding * 2;
  const graphH = maxY - minY + padding * 2;
  const scale = Math.min(1.5, Math.min(viewWidth / graphW, viewHeight / graphH));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    x: viewWidth / 2 - cx * scale,
    y: viewHeight / 2 - cy * scale,
    scale,
  };
}

// d3-force simulation is used instead of custom physics — same library as Obsidian

// ==================== Helpers ====================

function getNodeRadius(connections: number): number {
  // Logarithmic scaling for better visual range: 6px (0 connections) → 40px (100+ connections)
  if (connections <= 0) return 6;
  return Math.min(40, 6 + Math.sqrt(connections) * 5);
}

// ==================== Component ====================

export const GraphView: React.FC = React.memo(function GraphView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  // New Phase 3 state
  const [showClusters, setShowClusters] = useState(true);
  const [showHeatMap, setShowHeatMap] = useState(false);
  const [showNotebooks, setShowNotebooks] = useState<boolean>(() => {
    try {
      return localStorage.getItem('filarr_graph_show_notebooks') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('filarr_graph_show_notebooks', showNotebooks ? '1' : '0');
    } catch {
      /* localStorage full */
    }
  }, [showNotebooks]);
  const [filterQuery, setFilterQuery] = useState('');
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const draggingNodeRef = useRef<string | null>(null);
  const hasDraggedRef = useRef(false);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Draggable filter bar
  const [filterBarPos, setFilterBarPos] = useState<{ x: number; y: number }>({ x: 16, y: 16 });
  const [isDraggingBar, setIsDraggingBar] = useState(false);
  const barDragOffset = useRef({ x: 0, y: 0 });

  const handleBarDragStart = useCallback(
    (e: React.MouseEvent) => {
      // Only drag from the handle area (the bar itself, not inputs/buttons inside)
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'BUTTON'
      )
        return;
      e.preventDefault();
      setIsDraggingBar(true);
      barDragOffset.current = { x: e.clientX - filterBarPos.x, y: e.clientY - filterBarPos.y };
    },
    [filterBarPos]
  );

  useEffect(() => {
    if (!isDraggingBar) return;
    const handleMove = (e: MouseEvent) => {
      setFilterBarPos({
        x: e.clientX - barDragOffset.current.x,
        y: e.clientY - barDragOffset.current.y,
      });
    };
    const handleUp = () => setIsDraggingBar(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingBar]);

  // Link creation state
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [linkMousePos, setLinkMousePos] = useState<{ x: number; y: number } | null>(null);
  const [linkToast, setLinkToast] = useState<string | null>(null);

  // Time travel state
  const [showTimeTravel, setShowTimeTravel] = useState(false);
  const [timeTravelValue, setTimeTravelValue] = useState(1);

  // RAF simulation state (mutable refs for 60fps without React re-renders)
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<GraphEdge[]>([]);
  const simNodeMapRef = useRef<Map<string, SimNode>>(new Map());
  const alphaRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const svgGroupRef = useRef<SVGGElement>(null);
  const getNodeFillRef = useRef<(node: SimNode) => { fill: string; glow: string }>(() => ({
    fill: '#4a9eed',
    glow: 'rgba(74,158,237,0.4)',
  }));
  const [simReady, setSimReady] = useState(false);

  const notes = useSelector(selectAllNotes);
  const filesById = useSelector((s: RootState) => s.files.byId);
  const foldersById = useSelector((s: RootState) => s.folders.byId);
  const selectedNoteId = useSelector((s: RootState) => s.notes.selectedNoteId);
  const notesById = useSelector((s: RootState) => s.notes.byId);
  const notebooks = useSelector(selectAllNotebooks);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const effectiveDimensions = useMemo(
    () => dimensions || { width: 800, height: 600 },
    [dimensions]
  );
  const effectiveDimensionsRef = useRef(effectiveDimensions);
  effectiveDimensionsRef.current = effectiveDimensions;

  // Build graph data + run cluster detection
  const graphData = useMemo(() => {
    const nodeMap = new Map<string, SimNode>();
    const edgeList: GraphEdge[] = [];
    const connectionCount = new Map<string, number>();

    for (const note of notes) {
      nodeMap.set(note.id, {
        id: note.id,
        label: note.title || 'Untitled',
        type: 'note',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        connections: 0,
        updatedAt: note.updatedAt,
      });
    }

    for (const note of notes) {
      for (const targetId of note.linkedNoteIds) {
        if (nodeMap.has(targetId)) {
          edgeList.push({ source: note.id, target: targetId, type: 'note-note' });
          connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
          connectionCount.set(targetId, (connectionCount.get(targetId) || 0) + 1);
        }
      }
      for (const fileId of note.linkedFileIds) {
        const file = filesById[fileId];
        if (file && !nodeMap.has(fileId)) {
          nodeMap.set(fileId, {
            id: fileId,
            label: file.name,
            type: 'file',
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            connections: 0,
          });
        }
        if (nodeMap.has(fileId)) {
          edgeList.push({ source: note.id, target: fileId, type: 'note-file' });
          connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
          connectionCount.set(fileId, (connectionCount.get(fileId) || 0) + 1);
        }
      }
      for (const folderId of note.linkedFolderIds) {
        const folder = foldersById[folderId];
        if (folder && !nodeMap.has(folderId)) {
          nodeMap.set(folderId, {
            id: folderId,
            label: folder.name,
            type: 'folder',
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            connections: 0,
          });
        }
        if (nodeMap.has(folderId)) {
          edgeList.push({ source: note.id, target: folderId, type: 'note-folder' });
          connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
          connectionCount.set(folderId, (connectionCount.get(folderId) || 0) + 1);
        }
      }
    }

    // Optional notebook overlay: adds hub nodes for each notebook with
    // a child note present in the current graph. Kept behind a toggle
    // (`showNotebooks`, persisted) because auto-linking every note to
    // its notebook creates dense artificial clusters that drown out the
    // wiki-link structure — users asked for it back as an opt-in layer.
    if (showNotebooks) {
      const notebookChildCount = new Map<string, number>();
      for (const note of notes) {
        if (!note.notebookId) continue;
        if (!nodeMap.has(note.id)) continue;
        notebookChildCount.set(note.notebookId, (notebookChildCount.get(note.notebookId) || 0) + 1);
      }
      for (const notebook of notebooks) {
        const childCount = notebookChildCount.get(notebook.id) || 0;
        if (childCount === 0) continue;
        const notebookNodeId = `notebook:${notebook.id}`;
        nodeMap.set(notebookNodeId, {
          id: notebookNodeId,
          label: notebook.name,
          type: 'notebook',
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          connections: 0,
        });
      }
      for (const note of notes) {
        if (!note.notebookId) continue;
        if (!nodeMap.has(note.id)) continue;
        const notebookNodeId = `notebook:${note.notebookId}`;
        if (!nodeMap.has(notebookNodeId)) continue;
        edgeList.push({
          source: notebookNodeId,
          target: note.id,
          type: 'notebook-note',
        });
        connectionCount.set(notebookNodeId, (connectionCount.get(notebookNodeId) || 0) + 1);
        connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
      }
    }

    for (const [id, count] of connectionCount) {
      const node = nodeMap.get(id);
      if (node) node.connections = count;
    }

    // Cap node count for performance — keep most-connected nodes
    const MAX_GRAPH_NODES = 2000;
    let finalNodes = Array.from(nodeMap.values());
    let finalEdges = edgeList;

    if (finalNodes.length > MAX_GRAPH_NODES) {
      // Sort by connections (most connected first), keep top N
      finalNodes.sort((a, b) => b.connections - a.connections);
      finalNodes = finalNodes.slice(0, MAX_GRAPH_NODES);
      const keptIds = new Set(finalNodes.map((n) => n.id));
      finalEdges = edgeList.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
    }

    // Cluster detection
    const nodeIds = finalNodes.map((n) => n.id);
    const clusterResult = detectClusters(nodeIds, finalEdges);
    for (const [id, clusterId] of clusterResult.clusters) {
      const node = nodeMap.get(id);
      if (node) node.clusterId = clusterId;
    }

    return {
      nodes: finalNodes,
      edges: finalEdges,
      clusterResult,
    };
  }, [notes, filesById, foldersById, notebooks, showNotebooks]);

  // d3-force simulation ref
  const simulationRef = useRef<Simulation<SimNode, SimulationLinkDatum<SimNode>> | null>(null);

  // Initialize d3-force simulation
  useEffect(() => {
    const { nodes: rawNodes, edges } = graphData;
    if (rawNodes.length === 0) {
      simNodesRef.current = [];
      simEdgesRef.current = [];
      setSimReady(true);
      return;
    }

    // Stop any previous simulation
    if (simulationRef.current) simulationRef.current.stop();

    const simNodes: SimNode[] = rawNodes.map((n) => ({ ...n }));
    const savedPositions = loadPositions();
    let allRestored = true;

    // Restore saved positions
    for (const node of simNodes) {
      const saved = savedPositions[node.id];
      if (saved) {
        node.x = saved.x;
        node.y = saved.y;
      } else {
        allRestored = false;
      }
    }

    // Initialize unpositioned nodes
    const unpositioned = simNodes.filter((n) => !n.x || !n.y);
    if (unpositioned.length > 0) initializePositions(unpositioned);

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    simNodesRef.current = simNodes;
    simEdgesRef.current = edges;
    simNodeMapRef.current = nodeMap;

    // Build d3 links (source/target as node objects, not IDs)
    const d3Links = edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    // Count degree for link strength (d3-force standard approach)
    const degreeCount = new Map<string, number>();
    for (const e of edges) {
      degreeCount.set(e.source, (degreeCount.get(e.source) || 0) + 1);
      degreeCount.set(e.target, (degreeCount.get(e.target) || 0) + 1);
    }

    // ── Layout presets ──
    const n = simNodes.length;

    // Degree-based link strength — weaker for high-degree nodes
    // Using 1/√max(s,t) instead of d3's default 1/min(s,t):
    // This makes hub connections MUCH weaker, letting local structure emerge
    // leaf(3)↔leaf(3): 1/√3=0.58 (strong local bond)
    // leaf(3)↔hub(1000): 1/√1000=0.03 (weak hub pull)
    const degreeLinkStrength = (link: any) => {
      const s =
        degreeCount.get(typeof link.source === 'string' ? link.source : link.source.id) || 1;
      const t =
        degreeCount.get(typeof link.target === 'string' ? link.target : link.target.id) || 1;
      return 1 / Math.sqrt(Math.max(s, t));
    };

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        'charge',
        forceManyBody<SimNode>()
          .strength((d: SimNode) => {
            const c = d.connections || 0;
            return (n > 1000 ? -250 : n > 200 ? -180 : -100) - c * 3;
          })
          .theta(n > 1000 ? 0.9 : 0.8)
      )
      .force(
        'link',
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(d3Links)
          .id((d: SimNode) => d.id)
          .distance(n > 1000 ? 60 : n > 200 ? 45 : 30)
          .strength(degreeLinkStrength)
      )
      .force('center', forceCenter(0, 0).strength(0.01))
      .velocityDecay(0.35)
      .alphaDecay(allRestored ? 0.04 : 0.008)
      .alpha(allRestored ? 0.3 : 1);

    simulationRef.current = sim;

    // Tick handler — render on each simulation step
    sim.on('tick', () => {
      renderCanvas();
    });

    sim.on('end', () => {
      savePositions();
    });

    // Fit viewport after a short settle
    setTimeout(() => {
      const dims = effectiveDimensionsRef.current;
      const fit = computeFitTransform(simNodesRef.current, dims.width, dims.height);
      setTransform(fit);
      setSimReady(true);
    }, 50);

    return () => {
      sim.stop();
    };
  }, [graphData]); // effectiveDimensions removed intentionally — uses ref to avoid simulation restarts on resize

  // Canvas ref for high-performance rendering
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Find node under mouse position (for Canvas hit-testing)
  const findNodeAtPosition = useCallback((clientX: number, clientY: number): SimNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    const graphX = (clientX - rect.left - t.x) / t.scale;
    const graphY = (clientY - rect.top - t.y) / t.scale;

    // Check from top (last rendered) to bottom for correct z-order
    const nodes = simNodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const r = getNodeRadius(node.connections);
      const dx = node.x - graphX;
      const dy = node.y - graphY;
      if (dx * dx + dy * dy <= (r + 4) * (r + 4)) return node;
    }
    return null;
  }, []);

  // Canvas rendering function — replaces SVG DOM updates
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const t = transformRef.current;
    const nodes = simNodesRef.current;
    const edges = simEdgesRef.current;
    const nodeMap = simNodeMapRef.current;

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);

    // Frustum culling bounds (in graph space)
    const viewX0 = -t.x / t.scale;
    const viewY0 = -t.y / t.scale;
    const viewX1 = (w - t.x) / t.scale;
    const viewY1 = (h - t.y) / t.scale;
    const pad = 60; // padding for nodes near edge

    // Resolve refs once per frame
    const currentHovered = hoveredNodeRef.current;
    const currentSelected = selectedNoteId;
    const isDarkTheme = ['dark', 'space', 'aurora', 'crepuscule', 'foret'].includes(
      document.documentElement.getAttribute('data-theme') || 'light'
    );
    const labelColor = isDarkTheme ? '#c8d6e5' : '#334155';
    const labelHighlight = isDarkTheme ? '#ffffff' : '#0f172a';

    // Edge color adapts to theme — sky blue at 20% is invisible on light backgrounds,
    // especially with a single edge where there's no mass of lines to register.
    const edgeBaseColor = isDarkTheme ? 'rgba(135, 206, 235, 0.32)' : 'rgba(71, 85, 105, 0.45)';
    const edgeHoverColor = isDarkTheme ? 'rgba(135, 206, 235, 0.85)' : 'rgba(30, 64, 124, 0.85)';
    // Notebook-note edges are containment, not wiki-links — render them
    // faded + dashed so they stay readable without competing with real links.
    const notebookEdgeColor = isDarkTheme ? 'rgba(168, 85, 247, 0.22)' : 'rgba(147, 51, 234, 0.28)';
    const notebookEdgeHover = isDarkTheme ? 'rgba(192, 132, 252, 0.7)' : 'rgba(126, 34, 206, 0.7)';

    // ── Draw edges ──
    ctx.lineWidth = 1.2 / t.scale;
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      // Frustum culling: skip if both endpoints are off-screen
      if (
        (source.x < viewX0 - pad && target.x < viewX0 - pad) ||
        (source.x > viewX1 + pad && target.x > viewX1 + pad) ||
        (source.y < viewY0 - pad && target.y < viewY0 - pad) ||
        (source.y > viewY1 + pad && target.y > viewY1 + pad)
      )
        continue;

      const isHighlighted = currentHovered === edge.source || currentHovered === edge.target;
      const isNotebookEdge = edge.type === 'notebook-note';

      if (isNotebookEdge) {
        ctx.strokeStyle = isHighlighted ? notebookEdgeHover : notebookEdgeColor;
        ctx.lineWidth = (isHighlighted ? 1.6 : 1) / t.scale;
        ctx.setLineDash([4 / t.scale, 3 / t.scale]);
      } else {
        ctx.strokeStyle = isHighlighted ? edgeHoverColor : edgeBaseColor;
        ctx.lineWidth = (isHighlighted ? 2.2 : 1.4) / t.scale;
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // ── Draw nodes ──
    for (const node of nodes) {
      // Frustum culling
      if (
        node.x < viewX0 - pad ||
        node.x > viewX1 + pad ||
        node.y < viewY0 - pad ||
        node.y > viewY1 + pad
      )
        continue;

      const radius = getNodeRadius(node.connections);
      const isHov = node.id === currentHovered;
      const isSel = node.id === currentSelected;
      const colors = getNodeFillRef.current(node);

      // Ambient glow
      if (isHov || isSel) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 8, 0, Math.PI * 2);
        ctx.fillStyle = colors.glow;
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Node shape
      ctx.beginPath();
      if (node.type === 'note') {
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      } else if (node.type === 'file') {
        const r = radius * 0.85;
        ctx.rect(node.x - r, node.y - r, r * 2, r * 2);
      } else if (node.type === 'notebook') {
        // Diamond for notebooks — larger than other nodes to read as a hub
        const r = radius * 1.15;
        ctx.moveTo(node.x, node.y - r);
        ctx.lineTo(node.x + r, node.y);
        ctx.lineTo(node.x, node.y + r);
        ctx.lineTo(node.x - r, node.y);
        ctx.closePath();
      } else {
        // Hexagon for folders
        for (let k = 0; k < 6; k++) {
          const angle = (k * 60 - 30) * (Math.PI / 180);
          const px = node.x + radius * Math.cos(angle);
          const py = node.y + radius * Math.sin(angle);
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
      ctx.fillStyle = colors.fill;
      ctx.fill();

      // Selection ring
      if (isSel) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5 / t.scale;
        ctx.stroke();
      }

      // Type letter (only if node big enough on screen)
      const screenRadius = radius * t.scale;
      if (screenRadius >= 10) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `600 ${radius * 0.7}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          node.type === 'note'
            ? 'N'
            : node.type === 'file'
              ? 'F'
              : node.type === 'notebook'
                ? 'C'
                : 'D',
          node.x,
          node.y + 1
        );
      }

      // Label — show based on zoom level AND node importance
      const isImportant = node.connections >= 10;
      const showLabel = isHov || isSel || (isImportant && t.scale > 0.3) || t.scale > 1.2;
      if (showLabel) {
        const label = node.label.length > 30 ? node.label.slice(0, 30) + '...' : node.label;
        const fontSize = Math.max(10, Math.min(16, 13 / t.scale));
        ctx.globalAlpha = isHov || isSel ? 1 : 0.8;
        ctx.fillStyle = isHov || isSel ? labelHighlight : labelColor;
        ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, node.x, node.y + radius + 8);
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();
  }, [selectedNoteId]); // hoveredNode uses ref for perf — no need in deps

  // ---- Position persistence ----
  const savePositions = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of simNodesRef.current) {
      positions[node.id] = { x: node.x, y: node.y };
    }
    try {
      localStorage.setItem('filarr_graph_positions', JSON.stringify(positions));
    } catch {
      /* localStorage full */
    }
  }, []);

  const loadPositions = useCallback((): Record<string, { x: number; y: number }> => {
    try {
      const raw = localStorage.getItem('filarr_graph_positions');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  // Restart d3-force simulation (used during drag to propagate forces)
  const reheatSimulation = useCallback(() => {
    const sim = simulationRef.current;
    if (sim) {
      sim.alpha(0.3).restart();
    }
  }, []);

  // Node drag handlers — use refs to avoid stale closures and re-renders during drag
  const handleNodeDragStart = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      draggingNodeRef.current = nodeId;
      hasDraggedRef.current = false;
      setDraggingNode(nodeId);
      const node = simNodeMapRef.current.get(nodeId);
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
      }
      // Reheat simulation so other nodes react to the drag
      reheatSimulation();
    },
    [reheatSimulation]
  );

  const handleMouseMoveForDrag = useCallback(
    (e: React.MouseEvent) => {
      const dragId = draggingNodeRef.current;
      if (dragId) {
        hasDraggedRef.current = true;
        const node = simNodeMapRef.current.get(dragId);
        if (node) {
          // Convert screen coords to graph coords using ref for latest transform
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const t = transformRef.current;
          node.fx = (e.clientX - rect.left - t.x) / t.scale;
          node.fy = (e.clientY - rect.top - t.y) / t.scale;
          node.x = node.fx;
          node.y = node.fy;
          // Keep d3 simulation warm during drag
          const sim = simulationRef.current;
          if (sim && sim.alpha() < 0.1) sim.alpha(0.1).restart();
        }
      } else if (isPanning) {
        setTransform((t) => ({
          ...t,
          x: e.clientX - panStart.current.x,
          y: e.clientY - panStart.current.y,
        }));
      }
    },
    [isPanning, renderCanvas]
  );

  const handleMouseUpForDrag = useCallback(() => {
    const dragId = draggingNodeRef.current;
    if (dragId) {
      const node = simNodeMapRef.current.get(dragId);
      if (node) {
        // Keep node PINNED where the user dropped it (like Obsidian)
        node.fx = node.x;
        node.fy = node.y;
      }
      draggingNodeRef.current = null;
      setDraggingNode(null);
      savePositions();
    }
    setIsPanning(false);
  }, [savePositions]);

  const handleNodeClick = useCallback(
    (nodeId: string, nodeType: string) => {
      // Suppress click if the user was dragging a node
      if (hasDraggedRef.current) return;

      if (nodeType === 'note') {
        dispatch(setEditingNote(nodeId));
        dispatch(setNotesViewMode('list'));
      } else if (nodeType === 'file') {
        // Navigate to file's parent folder
        const file = filesById[nodeId];
        if (file?.parentId) {
          dispatch(setCurrentFolder(file.parentId));
          navigate(`/folder/${file.parentId}`);
        }
      } else if (nodeType === 'folder') {
        dispatch(setCurrentFolder(nodeId));
        navigate(`/folder/${nodeId}`);
      } else if (nodeType === 'notebook') {
        // Node ids for notebooks are prefixed with `notebook:` to avoid
        // collisions with note/file/folder ids — strip the prefix.
        const notebookId = nodeId.startsWith('notebook:') ? nodeId.slice(9) : nodeId;
        dispatch(setNotesFilterNotebook(notebookId));
        dispatch(setNotesViewMode('list'));
      }
    },
    [dispatch, filesById, navigate]
  );

  // Pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && !draggingNodeRef.current) {
      setIsPanning(true);
      panStart.current = {
        x: e.clientX - transformRef.current.x,
        y: e.clientY - transformRef.current.y,
      };
    }
  }, []);

  // Wheel zoom — attached via native listener to bypass React passive mode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setTransform((t) => {
        const newScale = Math.max(0.1, Math.min(6, t.scale * delta));
        const ratio = newScale / t.scale;
        return {
          x: mouseX - (mouseX - t.x) * ratio,
          y: mouseY - (mouseY - t.y) * ratio,
          scale: newScale,
        };
      });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [simReady]); // re-attach when canvas is ready

  // Filter logic
  const filterLower = filterQuery.toLowerCase();
  const isNodeVisible = useCallback(
    (node: SimNode) => {
      if (!filterLower) return true;
      return node.label.toLowerCase().includes(filterLower);
    },
    [filterLower]
  );

  // Get node color based on mode
  const getNodeFill = useCallback(
    (node: SimNode): { fill: string; glow: string } => {
      if (showHeatMap && node.updatedAt) {
        return heatColor(recencyScore(node.updatedAt));
      }
      if (
        showClusters &&
        node.clusterId !== undefined &&
        graphData.clusterResult.colors.has(node.clusterId)
      ) {
        const color = graphData.clusterResult.colors.get(node.clusterId)!;
        return { fill: color, glow: `${color}66` };
      }
      return { fill: NODE_COLORS[node.type].fill, glow: NODE_COLORS[node.type].glow };
    },
    [showHeatMap, showClusters, graphData.clusterResult]
  );
  getNodeFillRef.current = getNodeFill;

  // Time travel filtering
  const timeTravelData = useMemo(() => {
    if (!showTimeTravel) return null;
    // First pass: get date range
    const rangeResult = filterNotesByDate(notesById, new Date().toISOString());
    if (!rangeResult.minDate || !rangeResult.maxDate) return null;
    const targetDate = sliderToDate(timeTravelValue, rangeResult.minDate, rangeResult.maxDate);
    const filtered = filterNotesByDate(notesById, targetDate);
    return {
      visibleNoteIds: filtered.visibleNoteIds,
      targetDate,
      displayDate: new Date(targetDate).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    };
  }, [showTimeTravel, timeTravelValue, notesById]);

  // Escape key cancels link creation mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && linkSource) {
        setLinkSource(null);
        setLinkMousePos(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [linkSource]);

  // Auto-dismiss toast after 2.5s
  useEffect(() => {
    if (!linkToast) return;
    const timer = setTimeout(() => setLinkToast(null), 2500);
    return () => clearTimeout(timer);
  }, [linkToast]);

  // Create wiki-link between two notes
  const createWikiLink = useCallback(
    (sourceId: string, targetId: string) => {
      const sourceNote = notesById[sourceId];
      const targetNote = notesById[targetId];
      if (!sourceNote || !targetNote) return;

      const targetTitle = targetNote.title || 'Untitled';
      const wikiLink = `[[${targetTitle}]]`;

      // Check if this link already exists in plainText
      if (sourceNote.plainText.includes(wikiLink)) {
        setLinkToast(
          t('notes.graphLinkExists', 'Link already exists: {{link}}', { link: wikiLink })
        );
        return;
      }

      // Build new TipTap JSON content
      let newContent: string;
      let newPlainText: string;
      try {
        const doc = JSON.parse(sourceNote.content);
        // Append a new paragraph node with the wiki-link text
        const linkParagraph = {
          type: 'paragraph',
          content: [{ type: 'text', text: wikiLink }],
        };
        if (doc.content && Array.isArray(doc.content)) {
          doc.content.push(linkParagraph);
        } else {
          doc.content = [linkParagraph];
        }
        newContent = JSON.stringify(doc);
        newPlainText = sourceNote.plainText ? sourceNote.plainText + '\n' + wikiLink : wikiLink;
      } catch {
        // Content isn't valid JSON — treat as plain text
        newContent = sourceNote.content;
        newPlainText = sourceNote.plainText ? sourceNote.plainText + '\n' + wikiLink : wikiLink;
      }

      dispatch(updateNoteContent({ id: sourceId, content: newContent, plainText: newPlainText }));
      dispatch(resolveNoteLinks(sourceId));
      setLinkToast(t('notes.graphLinkCreated', 'Link created: {{link}}', { link: wikiLink }));
    },
    [dispatch, notesById, t]
  );

  // Handle node click — supports Shift+click for link creation
  const handleNodeClickWithLink = useCallback(
    (nodeId: string, nodeType: string, e: React.MouseEvent) => {
      // Only notes can participate in link creation
      if (e.shiftKey && nodeType === 'note') {
        if (!linkSource) {
          // Start link creation: select source
          setLinkSource(nodeId);
        } else if (linkSource !== nodeId) {
          // Complete link creation: connect source -> target
          createWikiLink(linkSource, nodeId);
          setLinkSource(null);
          setLinkMousePos(null);
        }
        return;
      }

      // Default click behavior (non-shift)
      if (!linkSource) {
        handleNodeClick(nodeId, nodeType);
      }
    },
    [linkSource, createWikiLink, handleNodeClick]
  );

  // Track mouse position for link creation line (in graph coordinates)
  const handleMouseMoveForLink = useCallback(
    (e: React.MouseEvent) => {
      if (linkSource) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setLinkMousePos({
          x: (e.clientX - rect.left - transform.x) / transform.scale,
          y: (e.clientY - rect.top - transform.y) / transform.scale,
        });
      }
    },
    [linkSource, transform]
  );

  // Combined mouse move handler
  const handleMouseMoveCombined = useCallback(
    (e: React.MouseEvent) => {
      handleMouseMoveForDrag(e);
      handleMouseMoveForLink(e);
    },
    [handleMouseMoveForDrag, handleMouseMoveForLink]
  );

  const zoomPercent = Math.round(transform.scale * 100);

  // Re-render canvas when state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    renderCanvas();
  }, [transform, hoveredNode, selectedNoteId, showClusters, showHeatMap, renderCanvas]);

  // Render nodes using the latest sim positions (kept for legend/stats)
  const renderNodes = simNodesRef.current.length > 0 ? simNodesRef.current : graphData.nodes;
  const renderEdges = simEdgesRef.current.length > 0 ? simEdgesRef.current : graphData.edges;
  const renderNodeMap = new Map(renderNodes.map((n) => [n.id, n]));

  return (
    <div className="graph-view" ref={containerRef}>
      {/* Controls bar */}
      <div className="graph-view__controls">
        <button
          className="graph-view__control-btn"
          onClick={() => setTransform((t) => ({ ...t, scale: Math.min(4, t.scale * 1.25) }))}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="graph-view__control-btn"
          onClick={() => setTransform((t) => ({ ...t, scale: Math.max(0.2, t.scale * 0.8) }))}
          title="Zoom out"
        >
          -
        </button>
        <button
          className="graph-view__control-btn"
          onClick={() =>
            setTransform(
              computeFitTransform(
                simNodesRef.current,
                effectiveDimensions.width,
                effectiveDimensions.height
              )
            )
          }
          title="Reset view"
        >
          R
        </button>
      </div>

      {/* Filter & toggles bar (draggable) */}
      <div
        className="graph-view__filter-bar"
        style={{
          left: filterBarPos.x,
          top: filterBarPos.y,
          cursor: isDraggingBar ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleBarDragStart}
      >
        <div className="graph-view__filter-search">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="graph-view__filter-input"
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={t('notes.graphFilterPlaceholder', 'Filter nodes...')}
          />
        </div>
        <button
          className={`graph-view__toggle-btn ${showClusters ? 'is-active' : ''}`}
          onClick={() => {
            setShowClusters((v) => !v);
            setShowHeatMap(false);
          }}
          title={t('notes.graphClusters', 'Clusters')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="8" cy="8" r="4" />
            <circle cx="16" cy="16" r="4" />
            <circle cx="18" cy="8" r="3" />
          </svg>
        </button>
        <button
          className={`graph-view__toggle-btn ${showHeatMap ? 'is-active' : ''}`}
          onClick={() => {
            setShowHeatMap((v) => !v);
            setShowClusters(false);
          }}
          title={t('notes.graphHeatMap', 'Heat Map')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 2a7 7 0 017 7c0 5-7 13-7 13S5 14 5 9a7 7 0 017-7z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
        </button>
        <button
          className={`graph-view__toggle-btn ${showNotebooks ? 'is-active' : ''}`}
          onClick={() => setShowNotebooks((v) => !v)}
          title={t('notes.graphShowNotebooks', 'Show notebooks')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M4 4h12a2 2 0 012 2v14H6a2 2 0 01-2-2V4z" />
            <line x1="9" y1="4" x2="9" y2="20" />
          </svg>
        </button>
        <button
          className={`graph-view__toggle-btn ${showTimeTravel ? 'is-active' : ''}`}
          onClick={() => setShowTimeTravel((v) => !v)}
          title={t('notes.graphTimeTravel', 'Time Travel')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
      </div>

      {/* Time travel slider (follows filter bar) */}
      {showTimeTravel && timeTravelData && (
        <div
          className="graph-view__time-travel"
          style={{ left: filterBarPos.x, top: filterBarPos.y + 44 }}
        >
          <span className="graph-view__time-travel-label">
            {t('notes.graphTimeTravelDate', 'Showing state at:')} {timeTravelData.displayDate}
          </span>
          <input
            className="graph-view__time-travel-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={timeTravelValue}
            onChange={(e) => setTimeTravelValue(Number(e.target.value))}
          />
        </div>
      )}

      {/* Empty state */}
      {graphData.nodes.length === 0 ? (
        <div className="graph-view__empty">
          <svg
            className="graph-view__empty-icon"
            width="80"
            height="80"
            viewBox="0 0 80 80"
            fill="none"
          >
            <circle
              cx="25"
              cy="30"
              r="8"
              fill="rgba(74, 158, 237, 0.15)"
              stroke="#4a9eed"
              strokeWidth="1.5"
            />
            <circle
              cx="55"
              cy="25"
              r="6"
              fill="rgba(52, 211, 153, 0.15)"
              stroke="#34d399"
              strokeWidth="1.5"
            />
            <circle
              cx="40"
              cy="55"
              r="10"
              fill="rgba(74, 158, 237, 0.15)"
              stroke="#4a9eed"
              strokeWidth="1.5"
            />
            <circle
              cx="65"
              cy="55"
              r="5"
              fill="rgba(251, 191, 36, 0.15)"
              stroke="#fbbf24"
              strokeWidth="1.5"
            />
            <line
              x1="25"
              y1="30"
              x2="40"
              y2="55"
              stroke="rgba(70, 130, 180, 0.35)"
              strokeWidth="1.5"
            />
            <line
              x1="55"
              y1="25"
              x2="40"
              y2="55"
              stroke="rgba(70, 130, 180, 0.35)"
              strokeWidth="1.5"
            />
            <line
              x1="40"
              y1="55"
              x2="65"
              y2="55"
              stroke="rgba(70, 130, 180, 0.35)"
              strokeWidth="1.5"
              strokeDasharray="4,3"
            />
          </svg>
          <p className="graph-view__empty-text">
            {t(
              'notes.graphEmpty',
              'Your knowledge graph will appear here. Link notes together using [[wiki-links]] to build connections.'
            )}
          </p>
          <span className="graph-view__empty-hint">
            [[note name]] &middot; [[file:document.pdf]] &middot; [[folder:Projects]]
          </span>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          width={effectiveDimensions.width * (window.devicePixelRatio || 1)}
          height={effectiveDimensions.height * (window.devicePixelRatio || 1)}
          className="graph-view__svg"
          style={{
            width: effectiveDimensions.width,
            height: effectiveDimensions.height,
            cursor: hoveredNode ? 'pointer' : isPanning ? 'grabbing' : 'grab',
          }}
          onMouseDown={(e) => {
            const node = findNodeAtPosition(e.clientX, e.clientY);
            if (node) {
              handleNodeDragStart(node.id, e);
            } else {
              handleMouseDown(e);
            }
          }}
          onMouseMove={(e) => {
            handleMouseMoveForDrag(e);
            handleMouseMoveForLink(e);
            // Canvas hover detection
            if (!draggingNodeRef.current && !isPanning) {
              const node = findNodeAtPosition(e.clientX, e.clientY);
              const newHovered = node?.id || null;
              hoveredNodeRef.current = newHovered;
              setHoveredNode(newHovered);
            }
          }}
          onMouseUp={(e) => {
            if (draggingNodeRef.current && !hasDraggedRef.current) {
              // Click (not drag) — handle node click
              const node = findNodeAtPosition(e.clientX, e.clientY);
              if (node) handleNodeClickWithLink(node.id, node.type, e);
            }
            handleMouseUpForDrag();
          }}
          onMouseLeave={handleMouseUpForDrag}
        />
      )}

      {/* Legend */}
      <div className="graph-view__legend">
        {showClusters && graphData.clusterResult.count > 1 ? (
          // Cluster legend
          Array.from(graphData.clusterResult.colors.entries()).map(([id, color]) => (
            <div key={id} className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{ background: color, boxShadow: `0 0 6px ${color}` }}
              />
              <span>
                {t('notes.graphCluster', 'Cluster')} {id + 1}
              </span>
            </div>
          ))
        ) : showHeatMap ? (
          // Heat map legend
          <>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{ background: '#ef4444', boxShadow: '0 0 6px #ef4444' }}
              />
              <span>{t('notes.graphHot', 'Recent')}</span>
            </div>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{ background: '#fbbf24', boxShadow: '0 0 6px #fbbf24' }}
              />
              <span>{t('notes.graphWarm', 'This week')}</span>
            </div>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{ background: '#4a9eed', boxShadow: '0 0 6px #4a9eed' }}
              />
              <span>{t('notes.graphCold', 'Older')}</span>
            </div>
          </>
        ) : (
          // Default type legend
          <>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{
                  background: NODE_COLORS.note.fill,
                  boxShadow: `0 0 6px ${NODE_COLORS.note.glow}`,
                }}
              />
              <span>{t('notes.graphNote', 'Note')}</span>
            </div>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{
                  background: NODE_COLORS.file.fill,
                  boxShadow: `0 0 6px ${NODE_COLORS.file.glow}`,
                }}
              />
              <span>{t('notes.graphFile', 'File')}</span>
            </div>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{
                  background: NODE_COLORS.folder.fill,
                  boxShadow: `0 0 6px ${NODE_COLORS.folder.glow}`,
                }}
              />
              <span>{t('notes.graphFolder', 'Folder')}</span>
            </div>
            {showNotebooks && (
              <div className="graph-view__legend-item">
                <span
                  className="graph-view__legend-dot"
                  style={{
                    background: NODE_COLORS.notebook.fill,
                    boxShadow: `0 0 6px ${NODE_COLORS.notebook.glow}`,
                  }}
                />
                <span>{t('notes.graphNotebook', 'Notebook')}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Stats */}
      <div className="graph-view__stats">
        {graphData.nodes.length} {t('notes.graphNodes', 'nodes')} &middot; {graphData.edges.length}{' '}
        {t('notes.graphEdges', 'connections')}
        {showClusters && graphData.clusterResult.count > 1 && (
          <>
            {' '}
            &middot; {graphData.clusterResult.count} {t('notes.graphClusterCount', 'clusters')}
          </>
        )}
      </div>

      {/* Zoom level */}
      <div className="graph-view__zoom">{zoomPercent}%</div>

      {/* Link creation status bar */}
      {linkSource && (
        <div className="graph-view__link-status">
          {t('notes.graphLinkHint', 'Shift+click another note to create a link. Esc to cancel.')}
        </div>
      )}

      {/* Link creation toast */}
      {linkToast && <div className="graph-view__link-toast">{linkToast}</div>}
    </div>
  );
});

export default GraphView;
