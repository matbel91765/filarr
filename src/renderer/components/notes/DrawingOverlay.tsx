/**
 * DrawingOverlay — Filarr Notes
 *
 * Transparent canvas overlay covering the entire note editor.
 * Supports: freehand pen, eraser, rectangle, ellipse, diamond,
 * line, arrow, text, selection/move.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import './DrawingOverlay.css';

// ==================== Types ====================

type ToolType =
  | 'select'
  | 'pen'
  | 'eraser'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'text';

interface BaseElement {
  id: string;
  color: string;
  width: number;
  opacity: number;
}

interface PenElement extends BaseElement {
  type: 'pen';
  points: { x: number; y: number }[];
}

interface EraserElement extends BaseElement {
  type: 'eraser';
  points: { x: number; y: number }[];
}

interface RectElement extends BaseElement {
  type: 'rectangle';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

interface EllipseElement extends BaseElement {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
}

interface DiamondElement extends BaseElement {
  type: 'diamond';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
}

interface LineElement extends BaseElement {
  type: 'line';
  points: { x: number; y: number }[];
}

interface ArrowElement extends BaseElement {
  type: 'arrow';
  points: { x: number; y: number }[];
}

interface TextElement extends BaseElement {
  type: 'text';
  x: number;
  y: number;
  content: string;
  fontSize: number;
}

export type DrawElement =
  | PenElement
  | EraserElement
  | RectElement
  | EllipseElement
  | DiamondElement
  | LineElement
  | ArrowElement
  | TextElement;

// Legacy compat
export interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  tool: 'pen' | 'eraser';
}

interface DrawingOverlayProps {
  strokes: string | undefined;
  isActive: boolean;
  onStrokesChange: (strokes: string) => void;
  editorBodyRef: React.RefObject<HTMLDivElement | null>;
}

// ==================== Constants ====================

const COLORS = [
  '#1a1a2e',
  '#e63946',
  '#457b9d',
  '#2a9d8f',
  '#e9c46a',
  '#f4a261',
  '#8338ec',
  '#ff006e',
];

const FILL_NONE = 'transparent';

const WIDTHS = [2, 4, 6, 10];

let _nextId = 1;
function genId(): string {
  return `el_${Date.now()}_${_nextId++}`;
}

// ==================== Helpers ====================

function migrateLegacy(data: any[]): DrawElement[] {
  if (!data.length) return [];
  // If first element has 'type' field matching our types, already migrated
  if (
    data[0].type &&
    ['pen', 'eraser', 'rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'text'].includes(
      data[0].type
    )
  ) {
    // Migrate old line/arrow format (x1,y1,x2,y2) → points[]
    return data.map((el: any) => {
      if ((el.type === 'line' || el.type === 'arrow') && !el.points && el.x1 != null) {
        return {
          ...el,
          points: [
            { x: el.x1, y: el.y1 },
            { x: el.x2, y: el.y2 },
          ],
        };
      }
      return el;
    }) as DrawElement[];
  }
  // Legacy Stroke[] → PenElement[]
  return data.map((s: any) => ({
    id: genId(),
    type: s.tool === 'eraser' ? 'eraser' : 'pen',
    points: s.points || [],
    color: s.color || '#1a1a2e',
    width: s.width || 4,
    opacity: 1,
  })) as DrawElement[];
}

function getBounds(el: DrawElement): { x: number; y: number; w: number; h: number } {
  switch (el.type) {
    case 'pen':
    case 'eraser': {
      if (!el.points.length) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'rectangle':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'ellipse':
    case 'diamond':
      return { x: el.cx - el.rx, y: el.cy - el.ry, w: el.rx * 2, h: el.ry * 2 };
    case 'line':
    case 'arrow': {
      if (!el.points.length) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'text':
      return {
        x: el.x,
        y: el.y - el.fontSize,
        w: el.content.length * el.fontSize * 0.6,
        h: el.fontSize * 1.2,
      };
  }
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax,
    dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
}

function hitTest(el: DrawElement, px: number, py: number, margin = 8): boolean {
  // For lines/arrows: check distance to each segment
  if ((el.type === 'line' || el.type === 'arrow') && el.points.length >= 2) {
    for (let i = 0; i < el.points.length - 1; i++) {
      const a = el.points[i],
        b = el.points[i + 1];
      if (distToSegment(px, py, a.x, a.y, b.x, b.y) <= margin + el.width / 2) return true;
    }
    return false;
  }
  const b = getBounds(el);
  return (
    px >= b.x - margin && px <= b.x + b.w + margin && py >= b.y - margin && py <= b.y + b.h + margin
  );
}

// ==================== Rendering ====================

function renderElement(ctx: CanvasRenderingContext2D, el: DrawElement) {
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.strokeStyle = el.color;
  ctx.lineWidth = el.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (el.type) {
    case 'pen': {
      if (el.points.length < 2) break;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) {
        const prev = el.points[i - 1];
        const curr = el.points[i];
        const mx = (prev.x + curr.x) / 2;
        const my = (prev.y + curr.y) / 2;
        ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
      }
      const last = el.points[el.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      break;
    }
    case 'eraser': {
      if (el.points.length < 2) break;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) {
        const prev = el.points[i - 1];
        const curr = el.points[i];
        const mx = (prev.x + curr.x) / 2;
        const my = (prev.y + curr.y) / 2;
        ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
      }
      const last = el.points[el.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      break;
    }
    case 'rectangle': {
      ctx.globalCompositeOperation = 'source-over';
      if (el.fill && el.fill !== FILL_NONE) {
        ctx.fillStyle = el.fill;
        ctx.fillRect(el.x, el.y, el.w, el.h);
      }
      ctx.strokeRect(el.x, el.y, el.w, el.h);
      break;
    }
    case 'ellipse': {
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.ellipse(el.cx, el.cy, Math.abs(el.rx), Math.abs(el.ry), 0, 0, Math.PI * 2);
      if (el.fill && el.fill !== FILL_NONE) {
        ctx.fillStyle = el.fill;
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case 'diamond': {
      ctx.globalCompositeOperation = 'source-over';
      const { cx, cy, rx, ry } = el;
      ctx.beginPath();
      ctx.moveTo(cx, cy - ry);
      ctx.lineTo(cx + rx, cy);
      ctx.lineTo(cx, cy + ry);
      ctx.lineTo(cx - rx, cy);
      ctx.closePath();
      if (el.fill && el.fill !== FILL_NONE) {
        ctx.fillStyle = el.fill;
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case 'line': {
      ctx.globalCompositeOperation = 'source-over';
      if (el.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.points[i].x, el.points[i].y);
      }
      ctx.stroke();
      break;
    }
    case 'arrow': {
      ctx.globalCompositeOperation = 'source-over';
      if (el.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.points[i].x, el.points[i].y);
      }
      ctx.stroke();
      // Arrowhead at the last point
      const last = el.points[el.points.length - 1];
      const prev = el.points[el.points.length - 2];
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      const headLen = Math.max(el.width * 3, 12);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - headLen * Math.cos(angle - Math.PI / 6),
        last.y - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - headLen * Math.cos(angle + Math.PI / 6),
        last.y - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();
      break;
    }
    case 'text': {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = el.color;
      ctx.font = `${el.fontSize}px Inter, sans-serif`;
      ctx.textBaseline = 'top';
      const lines = el.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], el.x, el.y + i * el.fontSize * 1.3);
      }
      break;
    }
  }
  ctx.restore();
}

function renderSelectionBox(ctx: CanvasRenderingContext2D, el: DrawElement) {
  ctx.save();

  // Lines and arrows: show control point handles instead of bounding box
  if ((el.type === 'line' || el.type === 'arrow') && el.points.length >= 2) {
    ctx.strokeStyle = '#4682b4';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1.5;
    // Draw dashed line along the path to indicate selection
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(el.points[0].x, el.points[0].y);
    for (let i = 1; i < el.points.length; i++) {
      ctx.lineTo(el.points[i].x, el.points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Draw handles at each control point
    for (let i = 0; i < el.points.length; i++) {
      const p = el.points[i];
      const isEndpoint = i === 0 || i === el.points.length - 1;
      const r = isEndpoint ? 6 : 5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Mark endpoints with a filled inner dot
      if (isEndpoint) {
        ctx.fillStyle = '#4682b4';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 3, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
      }
    }
    // Draw midpoint add-point handles (smaller, semi-transparent)
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < el.points.length - 1; i++) {
      const a = el.points[i],
        b = el.points[i + 1];
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      ctx.beginPath();
      ctx.ellipse(mx, my, 4, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4682b4';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  const b = getBounds(el);
  const pad = 6;
  ctx.strokeStyle = '#4682b4';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
  ctx.setLineDash([]);
  // Corner handles (squares)
  const hs = 5;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#4682b4';
  ctx.lineWidth = 1.5;
  for (const [hx, hy] of [
    [b.x - pad, b.y - pad],
    [b.x + b.w + pad, b.y - pad],
    [b.x - pad, b.y + b.h + pad],
    [b.x + b.w + pad, b.y + b.h + pad],
  ]) {
    ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
    ctx.strokeRect(hx - hs, hy - hs, hs * 2, hs * 2);
  }
  // Edge handles (circles at midpoints)
  const ehs = 4;
  for (const [hx, hy] of [
    [b.x + b.w / 2, b.y - pad],
    [b.x + b.w / 2, b.y + b.h + pad],
    [b.x + b.w + pad, b.y + b.h / 2],
    [b.x - pad, b.y + b.h / 2],
  ]) {
    ctx.beginPath();
    ctx.ellipse(hx, hy, ehs, ehs, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

type HandleDir = 'tl' | 'tr' | 'bl' | 'br' | 'n' | 's' | 'e' | 'w';

/** For lines/arrows: which point index is being dragged, or 'mid-N' for adding a new point */
interface PointHandle {
  type: 'point';
  index: number;
}
interface MidpointHandle {
  type: 'midpoint';
  segmentIndex: number;
}

type LineHandle = PointHandle | MidpointHandle;

function hitTestLineHandle(
  el: LineElement | ArrowElement,
  px: number,
  py: number
): LineHandle | null {
  const hs = 10;
  // Check existing control points
  for (let i = 0; i < el.points.length; i++) {
    const p = el.points[i];
    if (Math.abs(px - p.x) <= hs && Math.abs(py - p.y) <= hs) {
      return { type: 'point', index: i };
    }
  }
  // Check midpoints (for adding new points)
  for (let i = 0; i < el.points.length - 1; i++) {
    const a = el.points[i],
      b = el.points[i + 1];
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    if (Math.abs(px - mx) <= hs && Math.abs(py - my) <= hs) {
      return { type: 'midpoint', segmentIndex: i };
    }
  }
  return null;
}

function hitTestHandle(el: DrawElement, px: number, py: number): HandleDir | null {
  // Lines/arrows use their own point-based handles
  if (el.type === 'line' || el.type === 'arrow') return null;

  const b = getBounds(el);
  const pad = 6;
  const hs = 8;
  // Corner handles (higher priority)
  const corners: [number, number, HandleDir][] = [
    [b.x - pad, b.y - pad, 'tl'],
    [b.x + b.w + pad, b.y - pad, 'tr'],
    [b.x - pad, b.y + b.h + pad, 'bl'],
    [b.x + b.w + pad, b.y + b.h + pad, 'br'],
  ];
  for (const [cx, cy, dir] of corners) {
    if (Math.abs(px - cx) <= hs && Math.abs(py - cy) <= hs) return dir;
  }
  // Edge handles (midpoints)
  const edges: [number, number, HandleDir][] = [
    [b.x + b.w / 2, b.y - pad, 'n'],
    [b.x + b.w / 2, b.y + b.h + pad, 's'],
    [b.x + b.w + pad, b.y + b.h / 2, 'e'],
    [b.x - pad, b.y + b.h / 2, 'w'],
  ];
  for (const [cx, cy, dir] of edges) {
    if (Math.abs(px - cx) <= hs && Math.abs(py - cy) <= hs) return dir;
  }
  return null;
}

function applyResize(
  el: DrawElement,
  snap: DrawElement,
  handle: HandleDir,
  dx: number,
  dy: number
) {
  // Edge handles → delegate to corner with one axis constrained
  if (handle === 'n') return applyResize(el, snap, 'tl', 0, dy);
  if (handle === 's') return applyResize(el, snap, 'br', 0, dy);
  if (handle === 'e') return applyResize(el, snap, 'br', dx, 0);
  if (handle === 'w') return applyResize(el, snap, 'tl', dx, 0);

  switch (el.type) {
    case 'rectangle': {
      const s = snap as RectElement;
      if (handle === 'br') {
        el.w = s.w + dx;
        el.h = s.h + dy;
      } else if (handle === 'tl') {
        el.x = s.x + dx;
        el.y = s.y + dy;
        el.w = s.w - dx;
        el.h = s.h - dy;
      } else if (handle === 'tr') {
        el.w = s.w + dx;
        el.y = s.y + dy;
        el.h = s.h - dy;
      } else if (handle === 'bl') {
        el.x = s.x + dx;
        el.w = s.w - dx;
        el.h = s.h + dy;
      }
      break;
    }
    case 'ellipse':
    case 'diamond': {
      const s = snap as EllipseElement;
      if (handle === 'br') {
        (el as EllipseElement).rx = Math.abs(s.rx + dx / 2);
        (el as EllipseElement).ry = Math.abs(s.ry + dy / 2);
        (el as EllipseElement).cx = s.cx + dx / 2;
        (el as EllipseElement).cy = s.cy + dy / 2;
      } else if (handle === 'tl') {
        (el as EllipseElement).rx = Math.abs(s.rx - dx / 2);
        (el as EllipseElement).ry = Math.abs(s.ry - dy / 2);
        (el as EllipseElement).cx = s.cx + dx / 2;
        (el as EllipseElement).cy = s.cy + dy / 2;
      } else if (handle === 'tr') {
        (el as EllipseElement).rx = Math.abs(s.rx + dx / 2);
        (el as EllipseElement).ry = Math.abs(s.ry - dy / 2);
        (el as EllipseElement).cx = s.cx + dx / 2;
        (el as EllipseElement).cy = s.cy + dy / 2;
      } else if (handle === 'bl') {
        (el as EllipseElement).rx = Math.abs(s.rx - dx / 2);
        (el as EllipseElement).ry = Math.abs(s.ry + dy / 2);
        (el as EllipseElement).cx = s.cx + dx / 2;
        (el as EllipseElement).cy = s.cy + dy / 2;
      }
      break;
    }
    case 'line':
    case 'arrow': {
      // Lines/arrows use point-based handles, not bounding-box handles
      // This case is a fallback — actual point dragging is handled separately
      break;
    }
    case 'pen':
    case 'eraser': {
      // Scale points relative to bounding box
      const sb = getBounds(snap);
      if (sb.w < 1 || sb.h < 1) break;
      let newW = sb.w,
        newH = sb.h,
        newX = sb.x,
        newY = sb.y;
      if (handle === 'br') {
        newW += dx;
        newH += dy;
      } else if (handle === 'tl') {
        newX += dx;
        newY += dy;
        newW -= dx;
        newH -= dy;
      } else if (handle === 'tr') {
        newW += dx;
        newY += dy;
        newH -= dy;
      } else if (handle === 'bl') {
        newX += dx;
        newW -= dx;
        newH += dy;
      }
      if (newW < 5) newW = 5;
      if (newH < 5) newH = 5;
      const sx = newW / sb.w,
        sy = newH / sb.h;
      (el as PenElement).points = (snap as PenElement).points.map((p) => ({
        x: newX + (p.x - sb.x) * sx,
        y: newY + (p.y - sb.y) * sy,
      }));
      break;
    }
    case 'text': {
      const s = snap as TextElement;
      // Resize = change fontSize proportionally
      const origH = s.fontSize * 1.2;
      let newH = origH;
      if (handle === 'br' || handle === 'tr') newH = origH + dy * (handle === 'tr' ? -1 : 1);
      else newH = origH - dy * (handle === 'tl' ? 1 : -1);
      const newSize = Math.max(10, Math.round(newH / 1.2));
      (el as TextElement).fontSize = newSize;
      if (handle === 'tl' || handle === 'bl') (el as TextElement).x = s.x + dx;
      if (handle === 'tl' || handle === 'tr') (el as TextElement).y = s.y + dy;
      break;
    }
  }
}

// ==================== Component ====================

export const DrawingOverlay: React.FC<DrawingOverlayProps> = React.memo(function DrawingOverlay({
  strokes: strokesJson,
  isActive,
  onStrokesChange,
  editorBodyRef,
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentTool, setCurrentTool] = useState<ToolType>('pen');
  const [currentColor, setCurrentColor] = useState(COLORS[0]);
  const [currentWidth, setCurrentWidth] = useState(WIDTHS[1]);
  const [currentFill, setCurrentFill] = useState(FILL_NONE);
  const [isInteracting, setIsInteracting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showFillPicker, setShowFillPicker] = useState(false);
  const [hoverHandle, setHoverHandle] = useState<HandleDir | null>(null);

  // Text editing state
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextContent, setEditingTextContent] = useState('');
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Elements
  const elementsRef = useRef<DrawElement[]>([]);
  const activeElementRef = useRef<DrawElement | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    elSnapshot: DrawElement;
    handle?: HandleDir; // undefined = move, set = resize
    lineHandle?: LineHandle; // for line/arrow point dragging
  } | null>(null);

  // Parse incoming data (with legacy migration)
  useEffect(() => {
    try {
      const raw = strokesJson ? JSON.parse(strokesJson) : [];
      elementsRef.current = migrateLegacy(raw);
    } catch {
      elementsRef.current = [];
    }
    redraw();
  }, [strokesJson]);

  // ---- Canvas sizing ----

  const updateCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const editorBody = editorBodyRef.current;
    if (!canvas || !editorBody) return;

    const proseMirror = editorBody.querySelector('.ProseMirror') as HTMLElement;
    const contentEl = proseMirror || editorBody;
    const width = contentEl.offsetWidth;
    const height = Math.max(contentEl.scrollHeight, editorBody.clientHeight);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
    redraw();
  }, [editorBodyRef]);

  useEffect(() => {
    updateCanvasSize();
    const editorBody = editorBodyRef.current;
    if (!editorBody) return;
    let rafId = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateCanvasSize);
    });
    const proseMirror = editorBody.querySelector('.ProseMirror') as HTMLElement;
    observer.observe(proseMirror || editorBody);
    // Le WRAPPER aussi : la hauteur du canevas retient `editorBody.clientHeight`
    // (voir `updateCanvasSize`), et depuis que l'en-tête se replie au
    // défilement cette hauteur change SANS que `.ProseMirror` ne bouge — la
    // surface dessinable serait restée périmée d'un repli à l'autre.
    if (proseMirror && proseMirror !== editorBody) observer.observe(editorBody);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [updateCanvasSize, editorBodyRef]);

  useEffect(() => {
    requestAnimationFrame(updateCanvasSize);
  }, [isActive, updateCanvasSize]);

  // ---- Redraw ----

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    const allEls = [...elementsRef.current];
    if (activeElementRef.current) allEls.push(activeElementRef.current);

    for (const el of allEls) {
      // Skip rendering text on canvas while the textarea is visible
      if (el.id === editingTextId) continue;
      renderElement(ctx, el);
    }

    // Selection box
    if (selectedId) {
      const sel = elementsRef.current.find((e) => e.id === selectedId);
      if (sel) renderSelectionBox(ctx, sel);
    }

    ctx.globalCompositeOperation = 'source-over';
  }, [selectedId, editingTextId]);

  // ---- Commit ----

  const commit = useCallback(() => {
    onStrokesChange(JSON.stringify(elementsRef.current));
  }, [onStrokesChange]);

  // ---- Canvas point ----

  const getCanvasPoint = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // ---- Pointer handlers ----

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isActive || e.button !== 0) return;

      const pt = getCanvasPoint(e);

      // Text tool: create element and let textarea take over — no pointer capture
      if (currentTool === 'text') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedId(null);
        const textEl: TextElement = {
          id: genId(),
          type: 'text',
          x: pt.x,
          y: pt.y,
          content: '',
          fontSize: Math.max(currentWidth * 4, 16),
          color: currentColor,
          width: currentWidth,
          opacity: 1,
        };
        elementsRef.current = [...elementsRef.current, textEl];
        setEditingTextContent('');
        setEditingTextId(textEl.id);
        redraw();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setIsInteracting(true);

      switch (currentTool) {
        case 'select': {
          // First check if clicking a resize/point handle of the currently selected element
          if (selectedId) {
            const sel = elementsRef.current.find((el) => el.id === selectedId);
            if (sel) {
              // Line/arrow: check point handles first
              if (sel.type === 'line' || sel.type === 'arrow') {
                const lh = hitTestLineHandle(sel, pt.x, pt.y);
                if (lh) {
                  if (lh.type === 'midpoint') {
                    // Add new control point at midpoint
                    const a = sel.points[lh.segmentIndex];
                    const b = sel.points[lh.segmentIndex + 1];
                    const newPt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                    sel.points.splice(lh.segmentIndex + 1, 0, newPt);
                    dragStartRef.current = {
                      x: pt.x,
                      y: pt.y,
                      elSnapshot: JSON.parse(JSON.stringify(sel)),
                      lineHandle: { type: 'point', index: lh.segmentIndex + 1 },
                    };
                  } else {
                    dragStartRef.current = {
                      x: pt.x,
                      y: pt.y,
                      elSnapshot: JSON.parse(JSON.stringify(sel)),
                      lineHandle: lh,
                    };
                  }
                  redraw();
                  break;
                }
              } else {
                const handle = hitTestHandle(sel, pt.x, pt.y);
                if (handle) {
                  dragStartRef.current = {
                    x: pt.x,
                    y: pt.y,
                    elSnapshot: JSON.parse(JSON.stringify(sel)),
                    handle,
                  };
                  redraw();
                  break;
                }
              }
            }
          }
          // Find topmost hit element
          const hit = [...elementsRef.current].reverse().find((el) => hitTest(el, pt.x, pt.y));
          if (hit) {
            setSelectedId(hit.id);
            // Sync toolbar to selected element's properties
            setCurrentColor(hit.color);
            setCurrentWidth(hit.width);
            if ('fill' in hit) setCurrentFill((hit as RectElement).fill || FILL_NONE);
            dragStartRef.current = {
              x: pt.x,
              y: pt.y,
              elSnapshot: JSON.parse(JSON.stringify(hit)),
            };
          } else {
            setSelectedId(null);
          }
          redraw();
          break;
        }
        case 'pen':
        case 'eraser': {
          setSelectedId(null);
          activeElementRef.current = {
            id: genId(),
            type: currentTool,
            points: [pt],
            color: currentColor,
            width: currentWidth,
            opacity: 1,
          };
          break;
        }
        case 'rectangle': {
          setSelectedId(null);
          activeElementRef.current = {
            id: genId(),
            type: 'rectangle',
            x: pt.x,
            y: pt.y,
            w: 0,
            h: 0,
            color: currentColor,
            width: currentWidth,
            opacity: 1,
            fill: currentFill,
          };
          break;
        }
        case 'ellipse': {
          setSelectedId(null);
          activeElementRef.current = {
            id: genId(),
            type: 'ellipse',
            cx: pt.x,
            cy: pt.y,
            rx: 0,
            ry: 0,
            color: currentColor,
            width: currentWidth,
            opacity: 1,
            fill: currentFill,
          };
          break;
        }
        case 'diamond': {
          setSelectedId(null);
          activeElementRef.current = {
            id: genId(),
            type: 'diamond',
            cx: pt.x,
            cy: pt.y,
            rx: 0,
            ry: 0,
            color: currentColor,
            width: currentWidth,
            opacity: 1,
            fill: currentFill,
          };
          break;
        }
        case 'line': {
          setSelectedId(null);
          activeElementRef.current = {
            id: genId(),
            type: 'line',
            points: [{ ...pt }, { ...pt }],
            color: currentColor,
            width: currentWidth,
            opacity: 1,
          };
          break;
        }
        case 'arrow': {
          setSelectedId(null);
          activeElementRef.current = {
            id: genId(),
            type: 'arrow',
            points: [{ ...pt }, { ...pt }],
            color: currentColor,
            width: currentWidth,
            opacity: 1,
          };
          break;
        }
        // text tool handled above (before setPointerCapture)
      }
    },
    [isActive, currentTool, currentColor, currentWidth, currentFill, getCanvasPoint, redraw, commit]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pt = getCanvasPoint(e);

      // Hover cursor for resize/point handles (even when not dragging)
      if (!isInteracting && currentTool === 'select' && selectedId) {
        const sel = elementsRef.current.find((el) => el.id === selectedId);
        if (sel) {
          if (sel.type === 'line' || sel.type === 'arrow') {
            const lh = hitTestLineHandle(sel, pt.x, pt.y);
            setHoverHandle(lh ? 'tl' : null); // Reuse to trigger move cursor
          } else {
            const h = hitTestHandle(sel, pt.x, pt.y);
            setHoverHandle(h);
          }
        }
        return;
      }

      if (!isInteracting) return;
      e.preventDefault();

      // Select tool → drag / resize / point drag
      if (currentTool === 'select' && dragStartRef.current && selectedId) {
        const dx = pt.x - dragStartRef.current.x;
        const dy = pt.y - dragStartRef.current.y;
        const snap = dragStartRef.current.elSnapshot;
        const idx = elementsRef.current.findIndex((el) => el.id === selectedId);
        if (idx === -1) return;

        const el = elementsRef.current[idx];

        // Line/arrow point dragging
        if (dragStartRef.current.lineHandle && (el.type === 'line' || el.type === 'arrow')) {
          const lh = dragStartRef.current.lineHandle;
          if (lh.type === 'point') {
            const snapPts = (snap as LineElement).points;
            el.points[lh.index] = {
              x: snapPts[lh.index].x + dx,
              y: snapPts[lh.index].y + dy,
            };
          }
          redraw();
          return;
        }

        // Resize via handle
        if (dragStartRef.current.handle) {
          applyResize(el, snap, dragStartRef.current.handle, dx, dy);
          redraw();
          return;
        }

        // Move
        switch (el.type) {
          case 'pen':
          case 'eraser':
            (el as PenElement).points = (snap as PenElement).points.map((p) => ({
              x: p.x + dx,
              y: p.y + dy,
            }));
            break;
          case 'rectangle':
            (el as RectElement).x = (snap as RectElement).x + dx;
            (el as RectElement).y = (snap as RectElement).y + dy;
            break;
          case 'ellipse':
          case 'diamond':
            (el as EllipseElement).cx = (snap as EllipseElement).cx + dx;
            (el as EllipseElement).cy = (snap as EllipseElement).cy + dy;
            break;
          case 'line':
          case 'arrow':
            (el as LineElement).points = (snap as LineElement).points.map((p) => ({
              x: p.x + dx,
              y: p.y + dy,
            }));
            break;
          case 'text':
            (el as TextElement).x = (snap as TextElement).x + dx;
            (el as TextElement).y = (snap as TextElement).y + dy;
            break;
        }
        redraw();
        return;
      }

      const active = activeElementRef.current;
      if (!active) return;

      switch (active.type) {
        case 'pen':
        case 'eraser':
          active.points.push(pt);
          break;
        case 'rectangle':
          active.w = pt.x - active.x;
          active.h = pt.y - active.y;
          break;
        case 'ellipse':
        case 'diamond':
          active.rx = Math.abs(pt.x - active.cx);
          active.ry = Math.abs(pt.y - active.cy);
          break;
        case 'line':
        case 'arrow':
          active.points[active.points.length - 1] = pt;
          break;
      }
      redraw();
    },
    [isInteracting, currentTool, selectedId, getCanvasPoint, redraw]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isInteracting) return;
      e.preventDefault();
      setIsInteracting(false);

      // Select tool — commit drag
      if (currentTool === 'select') {
        dragStartRef.current = null;
        commit();
        redraw();
        return;
      }

      const active = activeElementRef.current;
      if (!active) return;
      activeElementRef.current = null;

      // Validate minimum size
      let valid = true;
      switch (active.type) {
        case 'pen':
        case 'eraser':
          valid = active.points.length >= 2;
          break;
        case 'rectangle':
          // Normalize negative w/h
          if (active.w < 0) {
            active.x += active.w;
            active.w = -active.w;
          }
          if (active.h < 0) {
            active.y += active.h;
            active.h = -active.h;
          }
          valid = active.w > 3 || active.h > 3;
          break;
        case 'ellipse':
        case 'diamond':
          valid = active.rx > 2 || active.ry > 2;
          break;
        case 'line':
        case 'arrow': {
          if (active.points.length < 2) {
            valid = false;
            break;
          }
          const p0 = active.points[0],
            p1 = active.points[active.points.length - 1];
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          valid = Math.sqrt(dx * dx + dy * dy) > 3;
          break;
        }
      }

      if (valid) {
        elementsRef.current = [...elementsRef.current, active];
        commit();
      }
      redraw();
    },
    [isInteracting, currentTool, commit, redraw]
  );

  // ---- Text editing ----

  useEffect(() => {
    if (editingTextId) {
      // Delay focus to ensure the textarea is mounted and above the canvas
      requestAnimationFrame(() => {
        textInputRef.current?.focus();
      });
    }
  }, [editingTextId]);

  const handleTextCommit = useCallback(() => {
    if (!editingTextId) return;
    const el = elementsRef.current.find((e) => e.id === editingTextId) as TextElement | undefined;
    if (el) {
      el.content = editingTextContent;
      if (!el.content.trim()) {
        // Remove empty text
        elementsRef.current = elementsRef.current.filter((e) => e.id !== editingTextId);
      }
    }
    setEditingTextId(null);
    setEditingTextContent('');
    commit();
    redraw();
  }, [editingTextId, editingTextContent, commit, redraw]);

  // ---- Actions ----

  const handleUndo = useCallback(() => {
    if (elementsRef.current.length === 0) return;
    elementsRef.current = elementsRef.current.slice(0, -1);
    setSelectedId(null);
    commit();
    redraw();
  }, [commit, redraw]);

  const handleClear = useCallback(() => {
    elementsRef.current = [];
    setSelectedId(null);
    onStrokesChange('[]');
    redraw();
  }, [onStrokesChange, redraw]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    elementsRef.current = elementsRef.current.filter((e) => e.id !== selectedId);
    setSelectedId(null);
    commit();
    redraw();
  }, [selectedId, commit, redraw]);

  const handleDuplicate = useCallback(() => {
    if (!selectedId) return;
    const el = elementsRef.current.find((e) => e.id === selectedId);
    if (!el) return;
    const clone: DrawElement = JSON.parse(JSON.stringify(el));
    clone.id = genId();
    // Offset the clone
    const b = getBounds(clone);
    const offset = 20;
    switch (clone.type) {
      case 'pen':
      case 'eraser':
        clone.points = clone.points.map((p) => ({ x: p.x + offset, y: p.y + offset }));
        break;
      case 'rectangle':
        clone.x += offset;
        clone.y += offset;
        break;
      case 'ellipse':
      case 'diamond':
        clone.cx += offset;
        clone.cy += offset;
        break;
      case 'line':
      case 'arrow':
        clone.points = clone.points.map((p: { x: number; y: number }) => ({
          x: p.x + offset,
          y: p.y + offset,
        }));
        break;
      case 'text':
        clone.x += offset;
        clone.y += offset;
        break;
    }
    elementsRef.current = [...elementsRef.current, clone];
    setSelectedId(clone.id);
    commit();
    redraw();
  }, [selectedId, commit, redraw]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      // Don't handle shortcuts while editing text
      if (editingTextId) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        handleDuplicate();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault();
          handleDelete();
        }
      }
      // Tool shortcuts
      if (e.key === 'v' || e.key === '1') setCurrentTool('select');
      if (e.key === 'p' || e.key === '2') setCurrentTool('pen');
      if (e.key === 'e' || e.key === '3') setCurrentTool('eraser');
      if (e.key === 'r' || e.key === '4') setCurrentTool('rectangle');
      if (e.key === 'o' || e.key === '5') setCurrentTool('ellipse');
      if (e.key === 'd' && !e.ctrlKey && !e.metaKey) setCurrentTool('diamond');
      if (e.key === 'l' || e.key === '6') setCurrentTool('line');
      if (e.key === 'a' || e.key === '7') setCurrentTool('arrow');
      if (e.key === 't' || e.key === '8') setCurrentTool('text');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, editingTextId, handleUndo, handleDelete, handleDuplicate, selectedId]);

  // Computed: selected element info for property editing
  const selectedEl = selectedId ? elementsRef.current.find((e) => e.id === selectedId) : null;
  const selectedHasFill =
    !!selectedEl && ['rectangle', 'ellipse', 'diamond'].includes(selectedEl.type);

  const hasElements = elementsRef.current.length > 0 || (strokesJson && strokesJson !== '[]');
  if (!isActive && !hasElements) return null;

  // Find editing text element for the floating textarea
  const editingText = editingTextId
    ? (elementsRef.current.find((e) => e.id === editingTextId) as TextElement | undefined)
    : undefined;

  const cursorClass = hoverHandle
    ? `drawing-overlay__canvas--resize-${hoverHandle}`
    : currentTool === 'select'
      ? 'drawing-overlay__canvas--select'
      : currentTool === 'text'
        ? 'drawing-overlay__canvas--text'
        : '';

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`drawing-overlay__canvas ${isActive && !editingTextId ? 'drawing-overlay__canvas--active' : ''} ${cursorClass}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={(e) => {
          if (!isActive || currentTool !== 'select' || !selectedId) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const px = e.clientX - rect.left,
            py = e.clientY - rect.top;
          const sel = elementsRef.current.find((el) => el.id === selectedId);
          if (!sel || (sel.type !== 'line' && sel.type !== 'arrow')) return;
          // Double-click on an intermediate point to remove it (keep at least 2 points)
          if (sel.points.length <= 2) return;
          for (let i = 1; i < sel.points.length - 1; i++) {
            const p = sel.points[i];
            if (Math.abs(px - p.x) <= 10 && Math.abs(py - p.y) <= 10) {
              sel.points.splice(i, 1);
              commit();
              redraw();
              break;
            }
          }
        }}
      />

      {/* Floating text input — must sit above the canvas */}
      {editingText && (
        <textarea
          ref={textInputRef}
          className="drawing-overlay__text-input"
          style={{
            left: `${editingText.x}px`,
            top: `${editingText.y}px`,
            fontSize: `${editingText.fontSize}px`,
            color: editingText.color,
            lineHeight: 1.3,
            fontFamily: 'Inter, sans-serif',
          }}
          value={editingTextContent}
          onChange={(e) => {
            setEditingTextContent(e.target.value);
            // Auto-grow the textarea
            if (textInputRef.current) {
              textInputRef.current.style.height = 'auto';
              textInputRef.current.style.height = `${textInputRef.current.scrollHeight}px`;
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onBlur={handleTextCommit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              handleTextCommit();
            }
            // Stop all key events from reaching the canvas/editor
            e.stopPropagation();
          }}
          placeholder="Type here..."
          autoFocus
        />
      )}

      {isActive && (
        <div className="drawing-overlay__toolbar">
          {/* ---- Tools ---- */}
          <div className="drawing-overlay__tool-group">
            <button
              className={`drawing-overlay__btn ${currentTool === 'select' ? 'is-active' : ''}`}
              onClick={() => setCurrentTool('select')}
              title="Select (V)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                <path d="M13 13l6 6" />
              </svg>
            </button>
            <button
              className={`drawing-overlay__btn ${currentTool === 'pen' ? 'is-active' : ''}`}
              onClick={() => setCurrentTool('pen')}
              title="Pen (P)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </button>
            <button
              className={`drawing-overlay__btn ${currentTool === 'eraser' ? 'is-active' : ''}`}
              onClick={() => setCurrentTool('eraser')}
              title="Eraser (E)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.6 1.6c.8-.8 2-.8 2.8 0L21.4 5.6c.8.8.8 2 0 2.8L11 19" />
              </svg>
            </button>

            <div className="drawing-overlay__sep" />

            <button
              className={`drawing-overlay__btn ${currentTool === 'rectangle' ? 'is-active' : ''}`}
              onClick={() => setCurrentTool('rectangle')}
              title="Rectangle (R)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            </button>
            <button
              className={`drawing-overlay__btn ${currentTool === 'ellipse' ? 'is-active' : ''}`}
              onClick={() => setCurrentTool('ellipse')}
              title="Ellipse (O)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <ellipse cx="12" cy="12" rx="10" ry="7" />
              </svg>
            </button>
            <button
              className={`drawing-overlay__btn ${currentTool === 'diamond' ? 'is-active' : ''}`}
              onClick={() => setCurrentTool('diamond')}
              title="Diamond (D)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M12 2l10 10-10 10L2 12z" />
              </svg>
            </button>
            <button
              className={`drawing-overlay__btn ${currentTool === 'line' ? 'is-active' : ''}`}
              onClick={() => setCurrentTool('line')}
              title="Line (L)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <line x1="5" y1="19" x2="19" y2="5" />
              </svg>
            </button>
            <button
              className={`drawing-overlay__btn ${currentTool === 'arrow' ? 'is-active' : ''}`}
              onClick={() => setCurrentTool('arrow')}
              title="Arrow (A)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <line x1="5" y1="19" x2="19" y2="5" />
                <polyline points="12,5 19,5 19,12" />
              </svg>
            </button>
            <button
              className={`drawing-overlay__btn ${currentTool === 'text' ? 'is-active' : ''}`}
              onClick={() => setCurrentTool('text')}
              title="Text (T)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <polyline points="4,7 4,4 20,4 20,7" />
                <line x1="9" y1="20" x2="15" y2="20" />
                <line x1="12" y1="4" x2="12" y2="20" />
              </svg>
            </button>
          </div>

          <div className="drawing-overlay__sep drawing-overlay__sep--tall" />

          {/* ---- Colors ---- */}
          <div className="drawing-overlay__tool-group">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`drawing-overlay__color ${currentColor === c ? 'is-active' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setCurrentColor(c);
                  if (selectedId) {
                    const el = elementsRef.current.find((e) => e.id === selectedId);
                    if (el) {
                      el.color = c;
                      commit();
                      redraw();
                    }
                  } else if (currentTool === 'eraser') {
                    setCurrentTool('pen');
                  }
                }}
              />
            ))}
          </div>

          <div className="drawing-overlay__sep drawing-overlay__sep--tall" />

          {/* ---- Fill (for shapes) ---- */}
          {(currentTool === 'rectangle' ||
            currentTool === 'ellipse' ||
            currentTool === 'diamond' ||
            selectedHasFill) && (
            <>
              <div className="drawing-overlay__tool-group">
                <button
                  className={`drawing-overlay__btn drawing-overlay__btn--fill ${showFillPicker ? 'is-active' : ''}`}
                  onClick={() => setShowFillPicker((v) => !v)}
                  title="Fill color"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill={currentFill === FILL_NONE ? 'none' : currentFill}
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                </button>
                {showFillPicker && (
                  <div className="drawing-overlay__fill-picker">
                    <button
                      className={`drawing-overlay__color drawing-overlay__color--none ${currentFill === FILL_NONE ? 'is-active' : ''}`}
                      onClick={() => {
                        setCurrentFill(FILL_NONE);
                        setShowFillPicker(false);
                        if (selectedId) {
                          const el = elementsRef.current.find((e) => e.id === selectedId);
                          if (el && 'fill' in el) {
                            (el as any).fill = FILL_NONE;
                            commit();
                            redraw();
                          }
                        }
                      }}
                      title="No fill"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        stroke="#999"
                        strokeWidth={2}
                        fill="none"
                      >
                        <line x1="4" y1="4" x2="20" y2="20" />
                      </svg>
                    </button>
                    {COLORS.map((c) => (
                      <button
                        key={`fill-${c}`}
                        className={`drawing-overlay__color ${currentFill === c + '33' ? 'is-active' : ''}`}
                        style={{ background: c + '33' }}
                        onClick={() => {
                          const fillColor = c + '33';
                          setCurrentFill(fillColor);
                          setShowFillPicker(false);
                          if (selectedId) {
                            const el = elementsRef.current.find((e) => e.id === selectedId);
                            if (el && 'fill' in el) {
                              (el as any).fill = fillColor;
                              commit();
                              redraw();
                            }
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="drawing-overlay__sep drawing-overlay__sep--tall" />
            </>
          )}

          {/* ---- Widths ---- */}
          <div className="drawing-overlay__tool-group">
            {WIDTHS.map((w) => (
              <button
                key={w}
                className={`drawing-overlay__width ${currentWidth === w ? 'is-active' : ''}`}
                onClick={() => {
                  setCurrentWidth(w);
                  if (selectedId) {
                    const el = elementsRef.current.find((e) => e.id === selectedId);
                    if (el) {
                      el.width = w;
                      commit();
                      redraw();
                    }
                  }
                }}
                title={`${w}px`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r={Math.min(w, 7)} fill="currentColor" />
                </svg>
              </button>
            ))}
          </div>

          <div className="drawing-overlay__sep drawing-overlay__sep--tall" />

          {/* ---- Actions ---- */}
          <div className="drawing-overlay__tool-group">
            {selectedId && (
              <>
                <button
                  className="drawing-overlay__btn"
                  onClick={handleDuplicate}
                  title="Duplicate (Ctrl+D)"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
                <button
                  className="drawing-overlay__btn drawing-overlay__btn--danger"
                  onClick={handleDelete}
                  title="Delete (Del)"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <polyline points="3,6 5,6 21,6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
                <div className="drawing-overlay__sep" />
              </>
            )}
            <button className="drawing-overlay__btn" onClick={handleUndo} title="Undo (Ctrl+Z)">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <polyline points="1,4 1,10 7,10" />
                <path d="M3.51 15a9 9 0 105.64-8.36L1 10" />
              </svg>
            </button>
            <button
              className="drawing-overlay__btn drawing-overlay__btn--danger"
              onClick={handleClear}
              title="Clear all"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
});
