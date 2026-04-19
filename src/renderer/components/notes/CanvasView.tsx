/**
 * CanvasView — Filarr Notes
 *
 * Infinite 2D canvas for arranging note cards with connections.
 * DOM-based rendering with CSS transforms for pan/zoom.
 * SVG overlay for connection lines between cards.
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { selectFilteredNotes, setEditingNote } from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';
import './CanvasView.css';

// ==================== Constants ====================

const CARD_W = 220;
const CARD_H = 140;
const GRID = 20;

// ==================== Helpers ====================

function parseCanvasPos(note: Note, index: number): { x: number; y: number } {
  if (note.coverColor && note.coverColor.includes(',')) {
    const [x, y] = note.coverColor.split(',').map(Number);
    if (!isNaN(x) && !isNaN(y)) return { x, y };
  }
  const cols = 4;
  return {
    x: 60 + (index % cols) * (CARD_W + 30),
    y: 60 + Math.floor(index / cols) * (CARD_H + 30),
  };
}

// ==================== Icons ====================

const ZoomInIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const ZoomOutIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const FitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M8 3H5a2 2 0 00-2 2v3" /><path d="M21 8V5a2 2 0 00-2-2h-3" />
    <path d="M3 16v3a2 2 0 002 2h3" /><path d="M16 21h3a2 2 0 002-2v-3" />
  </svg>
);

// ==================== Component ====================

export const CanvasView: React.FC = React.memo(function CanvasView() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const notes = useSelector(selectFilteredNotes);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // Build note positions map
  const notePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    notes.forEach((n, i) => map.set(n.id, parseCanvasPos(n, i)));
    return map;
  }, [notes]);

  // Build connections
  const connections = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const note of notes) {
      const from = notePositions.get(note.id);
      if (!from) continue;
      for (const targetId of note.linkedNoteIds) {
        const to = notePositions.get(targetId);
        if (!to) continue;
        lines.push({
          x1: from.x + CARD_W / 2,
          y1: from.y + CARD_H / 2,
          x2: to.x + CARD_W / 2,
          y2: to.y + CARD_H / 2,
        });
      }
    }
    return lines;
  }, [notes, notePositions]);

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        setIsPanning(true);
        panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      }
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setPan({
        x: panStart.current.px + (e.clientX - panStart.current.x),
        y: panStart.current.py + (e.clientY - panStart.current.y),
      });
    },
    [isPanning]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Handle zoom via wheel — native listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.2, Math.min(3, z * delta)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      className="canvas-view"
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="canvas-view__world"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* SVG connections */}
        <svg className="canvas-view__connections" width="8000" height="8000">
          {connections.map((c, i) => (
            <line
              key={i}
              x1={c.x1}
              y1={c.y1}
              x2={c.x2}
              y2={c.y2}
              stroke="var(--color-primary-300, #87ceeb)"
              strokeWidth={1.5}
              opacity={0.5}
            />
          ))}
        </svg>

        {/* Note cards */}
        {notes.map((note, i) => {
          const pos = notePositions.get(note.id) || { x: 0, y: 0 };
          return (
            <div
              key={note.id}
              className="canvas-card"
              style={{
                left: pos.x,
                top: pos.y,
                width: CARD_W,
                minHeight: CARD_H,
              }}
              onClick={() => dispatch(setEditingNote(note.id))}
            >
              <div className="canvas-card__title">
                {note.title || 'Untitled'}
              </div>
              <div className="canvas-card__preview">
                {note.plainText?.slice(0, 100)}
              </div>
              <div className="canvas-card__meta">
                {note.wordCount} {t('notes.words', 'words')}
                {note.linkedNoteIds.length > 0 && (
                  <> &middot; {note.linkedNoteIds.length} links</>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="canvas-view__toolbar">
        <button
          className="canvas-view__toolbar-btn"
          onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
          title="Zoom in"
        >
          <ZoomInIcon />
        </button>
        <button
          className="canvas-view__toolbar-btn"
          onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}
          title="Zoom out"
        >
          <ZoomOutIcon />
        </button>
        <button
          className="canvas-view__toolbar-btn"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          title="Reset view"
        >
          <FitIcon />
        </button>
        <span className="canvas-view__zoom-label">{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
});

export default CanvasView;
