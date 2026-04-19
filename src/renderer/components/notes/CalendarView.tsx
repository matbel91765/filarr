/**
 * CalendarView — Filarr Notes
 *
 * Full-screen calendar with Month/Week/Day/Agenda sub-views.
 * Notes appear as colored chips on their date. Click date to create daily note.
 * Click chip to open note. Drag chip to reschedule.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { selectAllNotes, setEditingNote, updateNote } from '../../../store/slices/notesSlice';
import { createDailyNote as createDailyNoteForDate } from '../../../services/notes/noteService';
import { addNote } from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';
import './CalendarView.css';

type SubView = 'month' | 'week' | 'day' | 'agenda';

// ==================== Helpers ====================

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfWeek(d: Date, startDay = 1): Date {
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

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getNoteDate(note: Note): string {
  if (note.isDaily && note.dailyDate) return note.dailyDate;
  return note.createdAt.slice(0, 10);
}

function getNoteColor(note: Note): string {
  if (note.coverColor) return note.coverColor;
  // Use a hash of the note id for consistent coloring
  const colors = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  let hash = 0;
  for (let i = 0; i < note.id.length; i++) hash = ((hash << 5) - hash + note.id.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ==================== Note Chip ====================

interface NoteChipProps {
  note: Note;
  onOpen: (noteId: string) => void;
  onDragStart: (e: React.DragEvent, noteId: string) => void;
  compact?: boolean;
}

const NoteChip = React.memo<NoteChipProps>(({ note, onOpen, onDragStart, compact }) => {
  const color = getNoteColor(note);
  return (
    <button
      className={`calendar-chip ${compact ? 'calendar-chip--compact' : ''}`}
      style={{ '--chip-color': color } as React.CSSProperties}
      onClick={(e) => { e.stopPropagation(); onOpen(note.id); }}
      draggable
      onDragStart={(e) => onDragStart(e, note.id)}
      title={note.title || 'Untitled'}
    >
      {note.icon && <span className="calendar-chip__icon">{note.icon}</span>}
      <span className="calendar-chip__title">{note.title || 'Untitled'}</span>
    </button>
  );
});
NoteChip.displayName = 'NoteChip';

// ==================== Month View ====================

interface MonthViewProps {
  currentDate: Date;
  notesByDate: Map<string, Note[]>;
  today: Date;
  onOpenNote: (noteId: string) => void;
  onCreateDaily: (date: string) => void;
  onDragStart: (e: React.DragEvent, noteId: string) => void;
  onDrop: (date: string) => void;
  dragOver: string | null;
  setDragOver: (date: string | null) => void;
}

const MonthGrid = React.memo<MonthViewProps>(({
  currentDate, notesByDate, today, onOpenNote, onCreateDaily,
  onDragStart, onDrop, dragOver, setDragOver,
}) => {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart);
  const days: Date[] = [];
  let d = new Date(gridStart);
  // 6 rows x 7 cols = 42 cells
  for (let i = 0; i < 42; i++) {
    days.push(new Date(d));
    d = addDays(d, 1);
  }

  return (
    <div className="calendar-month">
      <div className="calendar-month__header">
        {DAY_NAMES.map(name => (
          <div key={name} className="calendar-month__day-name">{name}</div>
        ))}
      </div>
      <div className="calendar-month__grid">
        {days.map(day => {
          const key = toDateKey(day);
          const notes = notesByDate.get(key) || [];
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const isToday = isSameDay(day, today);
          const isDragOver = dragOver === key;
          const maxChips = 3;

          return (
            <div
              key={key}
              className={`calendar-month__cell ${!isCurrentMonth ? 'calendar-month__cell--other' : ''} ${isToday ? 'calendar-month__cell--today' : ''} ${isDragOver ? 'calendar-month__cell--drag-over' : ''}`}
              onClick={() => onCreateDaily(key)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => { e.preventDefault(); setDragOver(null); onDrop(key); }}
            >
              <div className="calendar-month__date">
                <span className={`calendar-month__date-num ${isToday ? 'calendar-month__date-num--today' : ''}`}>
                  {day.getDate()}
                </span>
              </div>
              <div className="calendar-month__notes">
                {notes.slice(0, maxChips).map(note => (
                  <NoteChip key={note.id} note={note} onOpen={onOpenNote} onDragStart={onDragStart} compact />
                ))}
                {notes.length > maxChips && (
                  <span className="calendar-month__more">+{notes.length - maxChips}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
MonthGrid.displayName = 'MonthGrid';

// ==================== Week View ====================

interface WeekViewProps {
  currentDate: Date;
  notesByDate: Map<string, Note[]>;
  today: Date;
  onOpenNote: (noteId: string) => void;
  onCreateDaily: (date: string) => void;
  onDragStart: (e: React.DragEvent, noteId: string) => void;
  onDrop: (date: string) => void;
  dragOver: string | null;
  setDragOver: (date: string | null) => void;
}

const WeekGrid = React.memo<WeekViewProps>(({
  currentDate, notesByDate, today, onOpenNote, onCreateDaily,
  onDragStart, onDrop, dragOver, setDragOver,
}) => {
  const weekStart = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;

  return (
    <div className="calendar-week">
      <div className="calendar-week__header">
        <div className="calendar-week__time-gutter" />
        {days.map(day => {
          const key = toDateKey(day);
          const isToday = isSameDay(day, today);
          return (
            <div key={key} className={`calendar-week__day-header ${isToday ? 'calendar-week__day-header--today' : ''}`}>
              <span className="calendar-week__day-name">{DAY_NAMES[days.indexOf(day)]}</span>
              <span className={`calendar-week__day-num ${isToday ? 'calendar-week__day-num--today' : ''}`}>{day.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div className="calendar-week__body">
        <div className="calendar-week__time-col">
          {HOURS.map(h => (
            <div key={h} className="calendar-week__time-label">
              {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
            </div>
          ))}
        </div>
        {days.map(day => {
          const key = toDateKey(day);
          const notes = notesByDate.get(key) || [];
          const isToday = isSameDay(day, today);
          const isDragOver = dragOver === key;

          return (
            <div
              key={key}
              className={`calendar-week__day-col ${isDragOver ? 'calendar-week__day-col--drag-over' : ''}`}
              onClick={() => onCreateDaily(key)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => { e.preventDefault(); setDragOver(null); onDrop(key); }}
            >
              {HOURS.map(h => (
                <div key={h} className="calendar-week__hour-slot" />
              ))}
              {/* Now line */}
              {isToday && (
                <div className="calendar-week__now-line" style={{ top: `${(nowHour / 24) * 100}%` }}>
                  <div className="calendar-week__now-dot" />
                </div>
              )}
              {/* Notes positioned by creation hour */}
              {notes.map(note => {
                const createdHour = new Date(note.createdAt).getHours();
                return (
                  <div
                    key={note.id}
                    className="calendar-week__note-block"
                    style={{ top: `${(createdHour / 24) * 100}%`, '--chip-color': getNoteColor(note) } as React.CSSProperties}
                  >
                    <NoteChip note={note} onOpen={onOpenNote} onDragStart={onDragStart} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});
WeekGrid.displayName = 'WeekGrid';

// ==================== Day View ====================

interface DayViewProps {
  currentDate: Date;
  notesByDate: Map<string, Note[]>;
  today: Date;
  onOpenNote: (noteId: string) => void;
  onCreateDaily: (date: string) => void;
  onDragStart: (e: React.DragEvent, noteId: string) => void;
  onDrop: (date: string) => void;
  dragOver: string | null;
  setDragOver: (date: string | null) => void;
}

const DayGrid = React.memo<DayViewProps>(({
  currentDate, notesByDate, today, onOpenNote, onCreateDaily,
  onDragStart, onDrop, dragOver, setDragOver,
}) => {
  const key = toDateKey(currentDate);
  const notes = notesByDate.get(key) || [];
  const isToday = isSameDay(currentDate, today);
  const isDragOver = dragOver === key;
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;

  return (
    <div className="calendar-day">
      <div className="calendar-day__header">
        <span className="calendar-day__name">{DAY_NAMES[(currentDate.getDay() + 6) % 7]}</span>
        <span className={`calendar-day__num ${isToday ? 'calendar-day__num--today' : ''}`}>{currentDate.getDate()}</span>
        <span className="calendar-day__month">{MONTH_NAMES[currentDate.getMonth()]}</span>
      </div>
      <div
        className={`calendar-day__body ${isDragOver ? 'calendar-day__body--drag-over' : ''}`}
        onClick={() => onCreateDaily(key)}
        onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => { e.preventDefault(); setDragOver(null); onDrop(key); }}
      >
        <div className="calendar-day__time-col">
          {HOURS.map(h => (
            <div key={h} className="calendar-day__time-label">
              {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
            </div>
          ))}
        </div>
        <div className="calendar-day__content-col">
          {HOURS.map(h => (
            <div key={h} className="calendar-day__hour-slot" />
          ))}
          {isToday && (
            <div className="calendar-day__now-line" style={{ top: `${(nowHour / 24) * 100}%` }}>
              <div className="calendar-day__now-dot" />
            </div>
          )}
          {notes.map(note => {
            const createdHour = new Date(note.createdAt).getHours();
            return (
              <div
                key={note.id}
                className="calendar-day__note-block"
                style={{ top: `${(createdHour / 24) * 100}%`, '--chip-color': getNoteColor(note) } as React.CSSProperties}
              >
                <NoteChip note={note} onOpen={onOpenNote} onDragStart={onDragStart} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
DayGrid.displayName = 'DayGrid';

// ==================== Agenda View ====================

interface AgendaViewProps {
  currentDate: Date;
  notesByDate: Map<string, Note[]>;
  onOpenNote: (noteId: string) => void;
}

const AgendaList = React.memo<AgendaViewProps>(({ currentDate, notesByDate, onOpenNote }) => {
  const { t } = useTranslation();
  // Show 30 days from current date
  const days: { date: Date; key: string; notes: Note[] }[] = [];
  for (let i = 0; i < 30; i++) {
    const d = addDays(currentDate, i);
    const key = toDateKey(d);
    const notes = notesByDate.get(key) || [];
    if (notes.length > 0) {
      days.push({ date: d, key, notes });
    }
  }

  if (days.length === 0) {
    return (
      <div className="calendar-agenda calendar-agenda--empty">
        <p>{t('notes.calendarNoNotes', 'No notes')}</p>
      </div>
    );
  }

  return (
    <div className="calendar-agenda">
      {days.map(({ date, key, notes }) => (
        <div key={key} className="calendar-agenda__group">
          <div className="calendar-agenda__date-header">
            <span className="calendar-agenda__date-day">{DAY_NAMES[(date.getDay() + 6) % 7]}</span>
            <span className="calendar-agenda__date-num">{date.getDate()}</span>
            <span className="calendar-agenda__date-month">{MONTH_NAMES[date.getMonth()]}</span>
          </div>
          <div className="calendar-agenda__items">
            {notes.map(note => (
              <button
                key={note.id}
                className="calendar-agenda__item"
                onClick={() => onOpenNote(note.id)}
              >
                <span className="calendar-agenda__dot" style={{ background: getNoteColor(note) }} />
                <span className="calendar-agenda__title">{note.title || 'Untitled'}</span>
                <span className="calendar-agenda__time">
                  {new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});
AgendaList.displayName = 'AgendaList';

// ==================== Main CalendarView ====================

export const CalendarView: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const allNotes = useSelector(selectAllNotes);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [subView, setSubView] = useState<SubView>('month');
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Build notesByDate map
  const notesByDate = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const note of allNotes) {
      if (note.deletedAt) continue;
      const dateKey = getNoteDate(note);
      const arr = map.get(dateKey);
      if (arr) arr.push(note);
      else map.set(dateKey, [note]);
    }
    return map;
  }, [allNotes]);

  // Navigation
  const goToday = useCallback(() => setCurrentDate(new Date()), []);

  const goPrev = useCallback(() => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (subView === 'month') d.setMonth(d.getMonth() - 1);
      else if (subView === 'week') d.setDate(d.getDate() - 7);
      else d.setDate(d.getDate() - 1);
      return d;
    });
  }, [subView]);

  const goNext = useCallback(() => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (subView === 'month') d.setMonth(d.getMonth() + 1);
      else if (subView === 'week') d.setDate(d.getDate() + 7);
      else d.setDate(d.getDate() + 1);
      return d;
    });
  }, [subView]);

  const handleOpenNote = useCallback((noteId: string) => {
    dispatch(setEditingNote(noteId));
  }, [dispatch]);

  const handleCreateDaily = useCallback((dateKey: string) => {
    // Check if a daily note already exists for this date
    const existing = allNotes.find(n => n.isDaily && n.dailyDate === dateKey && !n.deletedAt);
    if (existing) {
      dispatch(setEditingNote(existing.id));
      return;
    }
    const newNote = createDailyNoteForDate(dateKey);
    dispatch(addNote(newNote));
    dispatch(setEditingNote(newNote.id));
  }, [allNotes, dispatch]);

  const handleDragStart = useCallback((e: React.DragEvent, noteId: string) => {
    setDragNoteId(noteId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDrop = useCallback((dateKey: string) => {
    if (!dragNoteId) return;
    const note = allNotes.find(n => n.id === dragNoteId);
    if (!note) return;

    if (note.isDaily && note.dailyDate) {
      dispatch(updateNote({ id: note.id, changes: { dailyDate: dateKey } }));
    } else {
      // Move by updating createdAt to that date, keeping time
      const oldDate = new Date(note.createdAt);
      const [year, month, day] = dateKey.split('-').map(Number);
      oldDate.setFullYear(year, month - 1, day);
      dispatch(updateNote({ id: note.id, changes: { createdAt: oldDate.toISOString() } }));
    }
    setDragNoteId(null);
  }, [dragNoteId, allNotes, dispatch]);

  // Title
  const headerTitle = useMemo(() => {
    if (subView === 'month') return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    if (subView === 'week') {
      const ws = startOfWeek(currentDate);
      const we = addDays(ws, 6);
      if (ws.getMonth() === we.getMonth()) return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}\u2013${we.getDate()}, ${ws.getFullYear()}`;
      return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()} \u2013 ${MONTH_NAMES[we.getMonth()]} ${we.getDate()}, ${we.getFullYear()}`;
    }
    return `${DAY_NAMES[(currentDate.getDay() + 6) % 7]}, ${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`;
  }, [currentDate, subView]);

  return (
    <div className="calendar-view">
      {/* Header */}
      <div className="calendar-view__header">
        <div className="calendar-view__nav">
          <button className="calendar-view__nav-btn" onClick={goPrev} title="Previous">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button className="calendar-view__today-btn" onClick={goToday}>
            {t('notes.calendarToday', 'Today')}
          </button>
          <button className="calendar-view__nav-btn" onClick={goNext} title="Next">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <h2 className="calendar-view__title">{headerTitle}</h2>
        </div>
        <div className="calendar-view__tabs">
          {(['month', 'week', 'day', 'agenda'] as SubView[]).map(sv => (
            <button
              key={sv}
              className={`calendar-view__tab ${subView === sv ? 'calendar-view__tab--active' : ''}`}
              onClick={() => setSubView(sv)}
            >
              {t(`notes.calendar${sv.charAt(0).toUpperCase() + sv.slice(1)}` as any, sv.charAt(0).toUpperCase() + sv.slice(1))}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-views */}
      <div className="calendar-view__body">
        {subView === 'month' && (
          <MonthGrid
            currentDate={currentDate}
            notesByDate={notesByDate}
            today={today}
            onOpenNote={handleOpenNote}
            onCreateDaily={handleCreateDaily}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            dragOver={dragOver}
            setDragOver={setDragOver}
          />
        )}
        {subView === 'week' && (
          <WeekGrid
            currentDate={currentDate}
            notesByDate={notesByDate}
            today={today}
            onOpenNote={handleOpenNote}
            onCreateDaily={handleCreateDaily}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            dragOver={dragOver}
            setDragOver={setDragOver}
          />
        )}
        {subView === 'day' && (
          <DayGrid
            currentDate={currentDate}
            notesByDate={notesByDate}
            today={today}
            onOpenNote={handleOpenNote}
            onCreateDaily={handleCreateDaily}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            dragOver={dragOver}
            setDragOver={setDragOver}
          />
        )}
        {subView === 'agenda' && (
          <AgendaList
            currentDate={currentDate}
            notesByDate={notesByDate}
            onOpenNote={handleOpenNote}
          />
        )}
      </div>
    </div>
  );
};
