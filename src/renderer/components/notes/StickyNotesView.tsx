/**
 * StickyNotesView — Filarr Notes
 *
 * Free-form 2D canvas with positioned sticky note cards.
 * Supports drag, zoom/pan, and color assignment.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { selectFilteredNotes, setEditingNote, updateNote } from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';
import './StickyNotesView.css';

// ==================== Constants ====================

const STICKY_COLORS_LIGHT = [
  '#fef08a', // yellow
  '#bbf7d0', // green
  '#bfdbfe', // blue
  '#ddd6fe', // purple
  '#fecdd3', // pink
  '#fed7aa', // orange
];

const STICKY_COLORS_DARK = [
  '#78713a', // muted yellow
  '#2d6b4a', // muted green
  '#2c4a6e', // muted blue
  '#4a3d7a', // muted purple
  '#6b3040', // muted pink
  '#6b4a2d', // muted orange
];

function getStickyColors(): string[] {
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? STICKY_COLORS_DARK
    : STICKY_COLORS_LIGHT;
}

const DEFAULT_SIZE = { w: 200, h: 160 };
const GRID_SNAP = 20;

// ==================== Helpers ====================

function getStickyPos(note: Note, index: number): { x: number; y: number } {
  // Use coverColor to encode position as "x,y" or fall back to grid layout
  if (note.coverColor && note.coverColor.includes(',')) {
    const [x, y] = note.coverColor.split(',').map(Number);
    if (!isNaN(x) && !isNaN(y)) return { x, y };
  }
  // Grid fallback
  const cols = 4;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: 40 + col * (DEFAULT_SIZE.w + 20), y: 40 + row * (DEFAULT_SIZE.h + 20) };
}

function getStickyColor(note: Note, index: number): string {
  const colors = getStickyColors();
  // Use icon field for color index
  if (note.icon && /^\d$/.test(note.icon)) {
    return colors[parseInt(note.icon)] || colors[0];
  }
  return colors[index % colors.length];
}

// ==================== Component ====================

export const StickyNotesView: React.FC = React.memo(function StickyNotesView() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const notes = useSelector(selectFilteredNotes);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState<{
    noteId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Handle zoom via wheel — native listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.3, Math.min(3, z * delta)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Start panning (middle click or shift+click on canvas)
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        setPanning(true);
        panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      }
    },
    [pan]
  );

  // Handle mouse move for panning and sticky dragging
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (panning) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
      }
      if (dragging) {
        const dx = (e.clientX - dragging.startX) / zoom;
        const dy = (e.clientY - dragging.startY) / zoom;
        const newX = Math.round((dragging.origX + dx) / GRID_SNAP) * GRID_SNAP;
        const newY = Math.round((dragging.origY + dy) / GRID_SNAP) * GRID_SNAP;
        // Update position in real-time (store in coverColor as "x,y")
        dispatch(
          updateNote({
            id: dragging.noteId,
            changes: { coverColor: `${newX},${newY}` },
          })
        );
      }
    },
    [panning, dragging, zoom, dispatch]
  );

  const handleMouseUp = useCallback(() => {
    setPanning(false);
    setDragging(null);
  }, []);

  // Start sticky drag
  const handleStickyMouseDown = useCallback(
    (e: React.MouseEvent, noteId: string, pos: { x: number; y: number }) => {
      if (e.button !== 0 || e.shiftKey) return;
      e.stopPropagation();
      setDragging({
        noteId,
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      });
    },
    []
  );

  return (
    <div
      className="sticky-notes-view"
      ref={canvasRef}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="sticky-notes-view__canvas"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {notes.map((note, i) => {
          const pos = getStickyPos(note, i);
          const color = getStickyColor(note, i);
          return (
            <div
              key={note.id}
              className={`sticky-note ${dragging?.noteId === note.id ? 'sticky-note--dragging' : ''}`}
              style={{
                left: pos.x,
                top: pos.y,
                width: DEFAULT_SIZE.w,
                minHeight: DEFAULT_SIZE.h,
                background: color,
              }}
              onMouseDown={(e) => handleStickyMouseDown(e, note.id, pos)}
              onDoubleClick={() => dispatch(setEditingNote(note.id))}
            >
              <div className="sticky-note__title">
                {note.title || t('notes.untitled', 'Untitled')}
              </div>
              <div className="sticky-note__text">{note.plainText?.slice(0, 120) || ''}</div>
              <div className="sticky-note__footer">
                {note.wordCount} {t('notes.words', 'words')}
              </div>
            </div>
          );
        })}
      </div>

      {/* Zoom indicator */}
      <div className="sticky-notes-view__zoom">{Math.round(zoom * 100)}%</div>
    </div>
  );
});

export default StickyNotesView;
