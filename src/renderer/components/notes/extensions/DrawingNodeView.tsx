/**
 * DrawingNodeView — Filarr Notes
 *
 * React NodeView for the Drawing extension.
 * Provides a simple canvas-based drawing surface with:
 * - Pen tool (freehand drawing with adjustable color/size)
 * - Eraser tool
 * - Clear / Undo
 * - Resize handle
 *
 * Strokes are stored as JSON in the node attributes.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';

interface Stroke {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
  eraser?: boolean;
}

interface DrawingNodeViewProps {
  node: { attrs: { strokes: string; width: number; height: number } };
  updateAttributes: (attrs: Record<string, any>) => void;
  selected: boolean;
}

const COLORS = ['#1e1e2e', '#e74c3c', '#3498db', '#27ae60', '#f39c12', '#9b59b6', '#e67e22', '#1abc9c'];
const WIDTHS = [2, 4, 6, 10];

export const DrawingNodeView: React.FC<DrawingNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#1e1e2e');
  const [penWidth, setPenWidth] = useState(3);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentStroke = useRef<Stroke | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const isInitialized = useRef(false);

  // Parse stored strokes
  useEffect(() => {
    try {
      strokesRef.current = JSON.parse(node.attrs.strokes || '[]');
    } catch {
      strokesRef.current = [];
    }
    isInitialized.current = true;
    redraw();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw checkerboard background
    ctx.fillStyle = 'var(--color-surface, #fff)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke);
    }

    // Draw current stroke if active
    if (currentStroke.current) {
      drawStroke(ctx, currentStroke.current);
    }
  }, []);

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (stroke.points.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = stroke.eraser ? '#ffffff' : stroke.color;
    ctx.lineWidth = stroke.eraser ? stroke.width * 3 : stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';

    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      // Smooth curve using quadratic bezier
      const prev = stroke.points[i - 1];
      const curr = stroke.points[i];
      const midX = (prev.x + curr.x) / 2;
      const midY = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    const point = getCanvasPoint(e);
    currentStroke.current = {
      points: [point],
      color: tool === 'eraser' ? '#ffffff' : color,
      width: penWidth,
      eraser: tool === 'eraser',
    };
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentStroke.current) return;
    const point = getCanvasPoint(e);
    currentStroke.current.points.push(point);
    redraw();
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentStroke.current) return;
    setIsDrawing(false);

    if (currentStroke.current.points.length >= 2) {
      strokesRef.current.push(currentStroke.current);
      updateAttributes({ strokes: JSON.stringify(strokesRef.current) });
    }
    currentStroke.current = null;
    redraw();
  };

  const handleUndo = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    updateAttributes({ strokes: JSON.stringify(strokesRef.current) });
    redraw();
  };

  const handleClear = () => {
    strokesRef.current = [];
    updateAttributes({ strokes: '[]' });
    redraw();
  };

  // Resize via bottom-right handle
  const resizeRef = useRef(false);
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = node.attrs.width;
    const startH = node.attrs.height;

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const newW = Math.max(200, startW + ev.clientX - startX);
      const newH = Math.max(150, startH + ev.clientY - startY);
      updateAttributes({ width: Math.round(newW), height: Math.round(newH) });
    };
    const onUp = () => {
      resizeRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Redraw when size changes
  useEffect(() => {
    if (!isInitialized.current) return;
    requestAnimationFrame(redraw);
  }, [node.attrs.width, node.attrs.height, redraw]);

  return (
    <NodeViewWrapper className={`drawing-wrapper ${selected ? 'drawing-wrapper--selected' : ''}`}>
      {/* Toolbar */}
      <div className="drawing-toolbar" contentEditable={false}>
        <button
          className={`drawing-toolbar__btn ${tool === 'pen' ? 'is-active' : ''}`}
          onClick={() => setTool('pen')}
          title="Pen"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
          </svg>
        </button>
        <button
          className={`drawing-toolbar__btn ${tool === 'eraser' ? 'is-active' : ''}`}
          onClick={() => setTool('eraser')}
          title="Eraser"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M20 20H7L3 16l9.5-9.5 8 8L17 18" /><path d="M6.5 13.5L2 18" />
          </svg>
        </button>

        <span className="drawing-toolbar__sep" />

        {/* Color swatches */}
        {COLORS.map((c) => (
          <button
            key={c}
            className={`drawing-toolbar__color ${color === c ? 'is-active' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => { setColor(c); setTool('pen'); }}
            title={c}
          />
        ))}

        <span className="drawing-toolbar__sep" />

        {/* Pen widths */}
        {WIDTHS.map((w) => (
          <button
            key={w}
            className={`drawing-toolbar__width ${penWidth === w ? 'is-active' : ''}`}
            onClick={() => setPenWidth(w)}
            title={`${w}px`}
          >
            <span style={{ width: w + 2, height: w + 2, borderRadius: '50%', background: 'currentColor', display: 'block' }} />
          </button>
        ))}

        <span className="drawing-toolbar__sep" />

        <button className="drawing-toolbar__btn" onClick={handleUndo} title="Undo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="1,4 1,10 7,10" /><path d="M3.51 15a9 9 0 105.64-9.94L1 10" />
          </svg>
        </button>
        <button className="drawing-toolbar__btn" onClick={handleClear} title="Clear">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="3,6 5,6 21,6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>

      {/* Canvas */}
      <div className="drawing-canvas-container" style={{ width: node.attrs.width, height: node.attrs.height }}>
        <canvas
          ref={canvasRef}
          width={node.attrs.width}
          height={node.attrs.height}
          className="drawing-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
        />
        {/* Resize handle */}
        <div className="drawing-resize-handle" onMouseDown={handleResizeStart}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M9 1L1 9M9 5L5 9M9 8L8 9" stroke="currentColor" strokeWidth={1.5} fill="none" />
          </svg>
        </div>
      </div>
    </NodeViewWrapper>
  );
};
