/**
 * CalendarBlockNodeView — Filarr Notes
 *
 * Notion calendar replica with modal for item creation/editing:
 * - Header: Month Year on left, ← Today → on right
 * - 7-col grid, 5-6 rows, thin borders
 * - Today = blue filled circle badge (#2383E2)
 * - Items = horizontal bars with Notion color palette
 * - Click "+" or date → modal appears for item creation
 * - Click item → modal appears for editing
 * - Modal has: title, date, color picker, delete
 * - Drag items between dates
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { CalendarEvent } from './calendarBlockExtension';

interface CalendarBlockNodeViewProps {
  node: {
    attrs: {
      title: string;
      view: 'month' | 'week';
      startDay: number;
      year: number;
      month: number;
      events: string;
      showNotes: boolean;
      cellHeight: number;
    };
  };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
  deleteNode: () => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const NOTION_COLORS: { name: string; bg: string; text: string }[] = [
  { name: 'default', bg: '#E3E2E080', text: '#37352F' },
  { name: 'gray',    bg: '#E3E2E0', text: '#787774' },
  { name: 'brown',   bg: '#EEE0DA', text: '#64473A' },
  { name: 'orange',  bg: '#FADEC9', text: '#D9730D' },
  { name: 'yellow',  bg: '#FDECC8', text: '#DFAB01' },
  { name: 'green',   bg: '#DBEDDB', text: '#448361' },
  { name: 'blue',    bg: '#D3E5EF', text: '#2383E2' },
  { name: 'purple',  bg: '#E8DEEE', text: '#9065B0' },
  { name: 'pink',    bg: '#F5E0E9', text: '#C14C8A' },
  { name: 'red',     bg: '#FFE2DD', text: '#E03E3E' },
];

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function startOfWeek(d: Date, startDay: number): Date {
  const day = d.getDay();
  const diff = (day < startDay ? 7 : 0) + day - startDay;
  const result = new Date(d);
  result.setDate(d.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(d.getDate() + n);
  return result;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function genId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ---- Modal state ---- */
interface ModalState {
  mode: 'create' | 'edit';
  eventId?: string;
  date: string;
  title: string;
  color: string;
  anchorRect: { top: number; left: number; bottom: number };
}

export const CalendarBlockNodeView: React.FC<CalendarBlockNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
}) => {
  const { title: calTitle, startDay, year, month, events: eventsJson, cellHeight } = node.attrs;

  const [editingTitle, setEditingTitle] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [dragEventId, setDragEventId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeStartRef = useRef<{ y: number; startHeight: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const modalTitleRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const events = useMemo<CalendarEvent[]>(() => {
    try { return JSON.parse(eventsJson); } catch { return []; }
  }, [eventsJson]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const arr = map.get(ev.date);
      if (arr) arr.push(ev);
      else map.set(ev.date, [ev]);
    }
    return map;
  }, [events]);

  // Focus title input when modal opens
  useEffect(() => {
    if (modal && modalTitleRef.current) {
      modalTitleRef.current.focus();
      if (modal.mode === 'edit') modalTitleRef.current.select();
    }
  }, [modal]);

  // Close modal on outside click
  useEffect(() => {
    if (!modal) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        commitModal();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modal]);

  // Close on Escape
  useEffect(() => {
    if (!modal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modal]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStartRef.current = { y: e.clientY, startHeight: cellHeight || 120 };
    setResizing(true);

    const onMove = (me: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const delta = me.clientY - resizeStartRef.current.y;
      // Divide by number of visible rows (~5) to get per-cell height change
      const newHeight = Math.max(80, Math.min(300, resizeStartRef.current.startHeight + delta / 5));
      updateAttributes({ cellHeight: Math.round(newHeight) });
    };
    const onUp = () => {
      setResizing(false);
      resizeStartRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [cellHeight, updateAttributes]);

  const today = useMemo(() => new Date(), []);

  const getEventColor = useCallback((colorName: string) => {
    return NOTION_COLORS.find(c => c.name === colorName) || NOTION_COLORS[0];
  }, []);

  // CRUD
  const addEvent = useCallback((date: string, text: string, color: string) => {
    if (!text.trim()) return;
    const newEvent: CalendarEvent = { id: genId(), date, text: text.trim(), color: color || 'default' };
    updateAttributes({ events: JSON.stringify([...events, newEvent]) });
  }, [events, updateAttributes]);

  const updateEvent = useCallback((id: string, changes: Partial<CalendarEvent>) => {
    const updated = events.map(ev => ev.id === id ? { ...ev, ...changes } : ev);
    updateAttributes({ events: JSON.stringify(updated) });
  }, [events, updateAttributes]);

  const deleteEvent = useCallback((id: string) => {
    updateAttributes({ events: JSON.stringify(events.filter(ev => ev.id !== id)) });
  }, [events, updateAttributes]);

  const moveEvent = useCallback((eventId: string, newDate: string) => {
    updateEvent(eventId, { date: newDate });
  }, [updateEvent]);

  // Commit modal (save changes)
  const commitModal = useCallback(() => {
    if (!modal) return;
    if (modal.mode === 'create') {
      if (modal.title.trim()) {
        addEvent(modal.date, modal.title, modal.color);
      }
    } else if (modal.mode === 'edit' && modal.eventId) {
      if (modal.title.trim()) {
        updateEvent(modal.eventId, { text: modal.title.trim(), color: modal.color, date: modal.date });
      } else {
        deleteEvent(modal.eventId);
      }
    }
    setModal(null);
  }, [modal, addEvent, updateEvent, deleteEvent]);

  // Open modal for creating
  const openCreateModal = useCallback((dateKey: string, anchorEl: HTMLElement) => {
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const top = anchorRect.bottom - (wrapperRect?.top || 0) + 4;
    const left = anchorRect.left - (wrapperRect?.left || 0);
    setModal({
      mode: 'create',
      date: dateKey,
      title: '',
      color: 'default',
      anchorRect: { top, left, bottom: anchorRect.bottom },
    });
  }, []);

  // Open modal for editing
  const openEditModal = useCallback((ev: CalendarEvent, anchorEl: HTMLElement) => {
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const top = anchorRect.bottom - (wrapperRect?.top || 0) + 4;
    const left = anchorRect.left - (wrapperRect?.left || 0);
    setModal({
      mode: 'edit',
      eventId: ev.id,
      date: ev.date,
      title: ev.text,
      color: ev.color,
      anchorRect: { top, left, bottom: anchorRect.bottom },
    });
  }, []);

  // Navigation
  const goPrev = useCallback(() => {
    const prev = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    updateAttributes({ month: prev, year: prevYear });
  }, [month, year, updateAttributes]);

  const goNext = useCallback(() => {
    const next = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    updateAttributes({ month: next, year: nextYear });
  }, [month, year, updateAttributes]);

  const goToday = useCallback(() => {
    const now = new Date();
    updateAttributes({ year: now.getFullYear(), month: now.getMonth() });
  }, [updateAttributes]);

  // Build grid
  const orderedDayNames = useMemo(() => {
    const rotated = [];
    for (let i = 0; i < 7; i++) rotated.push(DAY_NAMES[(startDay + i) % 7]);
    return rotated;
  }, [startDay]);

  const gridDays = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const gridStart = startOfWeek(firstOfMonth, startDay);
    const days: Date[] = [];
    let d = new Date(gridStart);
    for (let i = 0; i < 42; i++) {
      days.push(new Date(d));
      d = addDays(d, 1);
    }
    if (days.length > 35 && days[35].getMonth() !== month) return days.slice(0, 35);
    return days;
  }, [year, month, startDay]);

  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < gridDays.length; i += 7) {
      result.push(gridDays.slice(i, i + 7));
    }
    return result;
  }, [gridDays]);

  return (
    <NodeViewWrapper
      className={`ncal ${selected ? 'ncal--selected' : ''}`}
      data-calendar-block=""
      contentEditable={false}
    >
      <div ref={wrapperRef} style={{ position: 'relative' }}>
        {/* ---- Toolbar ---- */}
        <div className="ncal__toolbar">
          <div className="ncal__toolbar-left">
            {editingTitle ? (
              <input
                className="ncal__title-input"
                value={calTitle}
                onChange={e => updateAttributes({ title: e.target.value })}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingTitle(false); }}
                placeholder={`${MONTH_NAMES[month]} ${year}`}
                autoFocus
              />
            ) : (
              <button className="ncal__month-label" onClick={() => setEditingTitle(true)} title="Click to rename">
                {calTitle || `${MONTH_NAMES[month]} ${year}`}
              </button>
            )}
          </div>
          <div className="ncal__toolbar-right">
            <button className="ncal__icon-btn" onClick={goPrev} title="Previous month">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button className="ncal__text-btn" onClick={goToday}>Today</button>
            <button className="ncal__icon-btn" onClick={goNext} title="Next month">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
        </div>

        {/* ---- Day name headers ---- */}
        <div className="ncal__dayrow">
          {orderedDayNames.map((name, i) => (
            <div key={`${name}-${i}`} className="ncal__dayname">{name}</div>
          ))}
        </div>

        {/* ---- Month grid ---- */}
        <div className="ncal__body">
          {weeks.map((week, wi) => (
            <div key={wi} className="ncal__week">
              {week.map(day => {
                const key = toDateKey(day);
                const isCurrentMonth = day.getMonth() === month;
                const isToday = isSameDay(day, today);
                const cellEvents = eventsByDate.get(key) || [];
                const isDragOver = dragOverDate === key;
                const maxVisible = 3;
                const overflow = cellEvents.length > maxVisible ? cellEvents.length - maxVisible : 0;

                return (
                  <div
                    key={key}
                    className={`ncal__cell ${!isCurrentMonth ? 'ncal__cell--other' : ''} ${isDragOver ? 'ncal__cell--dragover' : ''}`}
                    style={{ minHeight: `${cellHeight || 120}px` }}
                    onDragOver={e => { e.preventDefault(); setDragOverDate(key); }}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={e => {
                      e.preventDefault();
                      setDragOverDate(null);
                      if (dragEventId) { moveEvent(dragEventId, key); setDragEventId(null); }
                    }}
                  >
                    <div className="ncal__cell-top">
                      <span className={`ncal__datenum ${isToday ? 'ncal__datenum--today' : ''}`}>
                        {day.getDate()}
                      </span>
                      <button
                        className="ncal__plus-btn"
                        onClick={e => { e.stopPropagation(); openCreateModal(key, e.currentTarget); }}
                        title="New"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                    </div>

                    <div className="ncal__items">
                      {cellEvents.slice(0, maxVisible).map(ev => {
                        const c = getEventColor(ev.color);
                        return (
                          <button
                            key={ev.id}
                            className="ncal__item"
                            style={{ '--ncal-item-bg': c.bg, '--ncal-item-text': c.text } as React.CSSProperties}
                            onClick={e => { e.stopPropagation(); openEditModal(ev, e.currentTarget); }}
                            draggable
                            onDragStart={() => setDragEventId(ev.id)}
                            onDragEnd={() => setDragEventId(null)}
                            title={ev.text}
                          >
                            <span className="ncal__item-title">{ev.text || 'Untitled'}</span>
                          </button>
                        );
                      })}

                      {overflow > 0 && (
                        <span className="ncal__more">+{overflow} more</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ---- Resize handle ---- */}
        <div
          className={`ncal__resize-handle ${resizing ? 'ncal__resize-handle--active' : ''}`}
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        >
          <span className="ncal__resize-grip" />
        </div>

        {/* ---- Modal (Notion-style peek card) ---- */}
        {modal && (
          <div
            ref={modalRef}
            className="ncal__modal"
            style={{ top: modal.anchorRect.top, left: Math.max(0, Math.min(modal.anchorRect.left, 400)) }}
          >
            {/* Title input */}
            <input
              ref={modalTitleRef}
              className="ncal__modal-title"
              value={modal.title}
              onChange={e => setModal({ ...modal, title: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') commitModal();
                if (e.key === 'Escape') setModal(null);
              }}
              placeholder="Untitled"
            />

            {/* Properties */}
            <div className="ncal__modal-props">
              {/* Date */}
              <div className="ncal__modal-prop">
                <span className="ncal__modal-prop-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Date
                </span>
                <input
                  type="date"
                  className="ncal__modal-date"
                  value={modal.date}
                  onChange={e => setModal({ ...modal, date: e.target.value })}
                />
              </div>

              {/* Color / Tag */}
              <div className="ncal__modal-prop">
                <span className="ncal__modal-prop-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  Color
                </span>
                <div className="ncal__modal-colors">
                  {NOTION_COLORS.map(nc => (
                    <button
                      key={nc.name}
                      className={`ncal__modal-color-btn ${modal.color === nc.name ? 'ncal__modal-color-btn--active' : ''}`}
                      style={{ background: nc.bg, borderColor: modal.color === nc.name ? nc.text : 'transparent' }}
                      onClick={() => setModal({ ...modal, color: nc.name })}
                      title={nc.name}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="ncal__modal-actions">
              {modal.mode === 'edit' && (
                <button
                  className="ncal__modal-delete"
                  onClick={() => { if (modal.eventId) deleteEvent(modal.eventId); setModal(null); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                  Delete
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="ncal__modal-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button className="ncal__modal-save" onClick={commitModal}>
                {modal.mode === 'create' ? 'Add' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};
