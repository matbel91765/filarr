/**
 * CalendarView — Filarr Notes
 *
 * Full-screen calendar with Month/Week/Day/Agenda sub-views.
 * Notes appear as colored chips on their date. Click date to create daily note.
 * Click chip to open note. Drag chip to reschedule.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18nInstance from '../../../i18n/config';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { selectAllNotes, setEditingNote, updateNote } from '../../../store/slices/notesSlice';
import { createDailyNote as createDailyNoteForDate } from '../../../services/notes/noteService';
import { addNote } from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';
import './CalendarView.css';

import * as profileStorage from '../../../services/core/profileStorage';
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
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getNoteDate(note: Note): string {
  if (note.isDaily && note.dailyDate) return note.dailyDate;
  // Calendar-scheduled date wins over creation date so a note dragged to
  // another day actually appears there without losing its real createdAt.
  if (note.scheduledDate) return note.scheduledDate;
  return note.createdAt.slice(0, 10);
}

// Match anything that *looks* like a CSS color value. The Sticky view
// historically reuses `coverColor` as raw "x,y" position storage (see
// matbel91765/filarr#19), so we can't trust the field — passing "120,40"
// down to `--chip-color` produces an invalid CSS value, which silently
// strips the chip background and leaves white text on the cell background
// (unreadable on warm themes like crepuscule / sakura).
const CSS_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|[a-z]+)$/i;
function isValidCssColor(value: string): boolean {
  return CSS_COLOR_RE.test(value.trim());
}

function getNoteColor(note: Note): string {
  if (note.coverColor && isValidCssColor(note.coverColor)) {
    return note.coverColor;
  }
  // Use a hash of the note id for consistent coloring
  const colors = [
    '#3b82f6',
    '#ef4444',
    '#22c55e',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
    '#f97316',
  ];
  let hash = 0;
  for (let i = 0; i < note.id.length; i++) hash = ((hash << 5) - hash + note.id.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

// Localized month/weekday names (was hardcoded English, so FR users saw
// "January"/"Mon"). Computed per app language and cached per-locale, and read
// through getters at render time so switching language mid-session (which
// re-renders the t()-subscribed tree) updates the calendar too — a plain
// module const would freeze at the startup language.
const _calNameCache: Record<string, { months: string[]; days: string[] }> = {};
function getCalNames(): { months: string[]; days: string[] } {
  const loc = i18nInstance.language || 'en';
  if (!_calNameCache[loc]) {
    _calNameCache[loc] = {
      months: Array.from({ length: 12 }, (_, m) =>
        new Intl.DateTimeFormat(loc, { month: 'long' }).format(new Date(2021, m, 15))
      ),
      // Monday-first short weekday names (2021-11-01 is a Monday).
      days: Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(new Date(2021, 10, 1 + i))
      ),
    };
  }
  return _calNameCache[loc];
}
const getMonthNames = (): string[] => getCalNames().months;
const getDayNames = (): string[] => getCalNames().days;
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
      onClick={(e) => {
        e.stopPropagation();
        onOpen(note.id);
      }}
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

const MonthGrid = React.memo<MonthViewProps>(
  ({
    currentDate,
    notesByDate,
    today,
    onOpenNote,
    onCreateDaily,
    onDragStart,
    onDrop,
    dragOver,
    setDragOver,
  }) => {
    // Subscribe to language so this memoized grid re-renders (with fresh
    // localized day names) when the app language changes mid-session.
    useTranslation();
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
          {getDayNames().map((name) => (
            <div key={name} className="calendar-month__day-name">
              {name}
            </div>
          ))}
        </div>
        <div className="calendar-month__grid">
          {days.map((day) => {
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
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(key);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  onDrop(key);
                }}
              >
                <div className="calendar-month__date">
                  <span
                    className={`calendar-month__date-num ${isToday ? 'calendar-month__date-num--today' : ''}`}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <div className="calendar-month__notes">
                  {notes.slice(0, maxChips).map((note) => (
                    <NoteChip
                      key={note.id}
                      note={note}
                      onOpen={onOpenNote}
                      onDragStart={onDragStart}
                      compact
                    />
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
  }
);
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

const WeekGrid = React.memo<WeekViewProps>(
  ({
    currentDate,
    notesByDate,
    today,
    onOpenNote,
    onCreateDaily,
    onDragStart,
    onDrop,
    dragOver,
    setDragOver,
  }) => {
    useTranslation(); // re-render on mid-session language change (localized day names)
    const weekStart = startOfWeek(currentDate);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const now = new Date();
    const nowHour = now.getHours() + now.getMinutes() / 60;

    return (
      <div className="calendar-week">
        <div className="calendar-week__header">
          <div className="calendar-week__time-gutter" />
          {days.map((day) => {
            const key = toDateKey(day);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={key}
                className={`calendar-week__day-header ${isToday ? 'calendar-week__day-header--today' : ''}`}
              >
                <span className="calendar-week__day-name">{getDayNames()[days.indexOf(day)]}</span>
                <span
                  className={`calendar-week__day-num ${isToday ? 'calendar-week__day-num--today' : ''}`}
                >
                  {day.getDate()}
                </span>
              </div>
            );
          })}
        </div>
        <div className="calendar-week__body">
          <div className="calendar-week__time-col">
            {HOURS.map((h) => (
              <div key={h} className="calendar-week__time-label">
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          {days.map((day) => {
            const key = toDateKey(day);
            const notes = notesByDate.get(key) || [];
            const isToday = isSameDay(day, today);
            const isDragOver = dragOver === key;

            return (
              <div
                key={key}
                className={`calendar-week__day-col ${isDragOver ? 'calendar-week__day-col--drag-over' : ''}`}
                onClick={() => onCreateDaily(key)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(key);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  onDrop(key);
                }}
              >
                {HOURS.map((h) => (
                  <div key={h} className="calendar-week__hour-slot" />
                ))}
                {/* Now line */}
                {isToday && (
                  <div
                    className="calendar-week__now-line"
                    style={{ top: `${(nowHour / 24) * 100}%` }}
                  >
                    <div className="calendar-week__now-dot" />
                  </div>
                )}
                {/* Notes positioned by creation hour */}
                {notes.map((note) => {
                  const createdHour = new Date(note.createdAt).getHours();
                  return (
                    <div
                      key={note.id}
                      className="calendar-week__note-block"
                      style={
                        {
                          top: `${(createdHour / 24) * 100}%`,
                          '--chip-color': getNoteColor(note),
                        } as React.CSSProperties
                      }
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
  }
);
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

const DayGrid = React.memo<DayViewProps>(
  ({
    currentDate,
    notesByDate,
    today,
    onOpenNote,
    onCreateDaily,
    onDragStart,
    onDrop,
    dragOver,
    setDragOver,
  }) => {
    useTranslation(); // re-render on mid-session language change (localized names)
    const key = toDateKey(currentDate);
    const notes = notesByDate.get(key) || [];
    const isToday = isSameDay(currentDate, today);
    const isDragOver = dragOver === key;
    const now = new Date();
    const nowHour = now.getHours() + now.getMinutes() / 60;

    return (
      <div className="calendar-day">
        <div className="calendar-day__header">
          <span className="calendar-day__name">
            {getDayNames()[(currentDate.getDay() + 6) % 7]}
          </span>
          <span className={`calendar-day__num ${isToday ? 'calendar-day__num--today' : ''}`}>
            {currentDate.getDate()}
          </span>
          <span className="calendar-day__month">{getMonthNames()[currentDate.getMonth()]}</span>
        </div>
        <div
          className={`calendar-day__body ${isDragOver ? 'calendar-day__body--drag-over' : ''}`}
          onClick={() => onCreateDaily(key)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(key);
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(null);
            onDrop(key);
          }}
        >
          <div className="calendar-day__time-col">
            {HOURS.map((h) => (
              <div key={h} className="calendar-day__time-label">
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          <div className="calendar-day__content-col">
            {HOURS.map((h) => (
              <div key={h} className="calendar-day__hour-slot" />
            ))}
            {isToday && (
              <div className="calendar-day__now-line" style={{ top: `${(nowHour / 24) * 100}%` }}>
                <div className="calendar-day__now-dot" />
              </div>
            )}
            {notes.map((note) => {
              const createdHour = new Date(note.createdAt).getHours();
              return (
                <div
                  key={note.id}
                  className="calendar-day__note-block"
                  style={
                    {
                      top: `${(createdHour / 24) * 100}%`,
                      '--chip-color': getNoteColor(note),
                    } as React.CSSProperties
                  }
                >
                  <NoteChip note={note} onOpen={onOpenNote} onDragStart={onDragStart} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);
DayGrid.displayName = 'DayGrid';

// ==================== Agenda View ====================

interface AgendaViewProps {
  currentDate: Date;
  notesByDate: Map<string, Note[]>;
  onOpenNote: (noteId: string) => void;
}

const AGENDA_STORAGE_KEY = 'filarr.calendar.agendaRange.v1';
const AGENDA_DEFAULT_PAST = 7;
const AGENDA_DEFAULT_FUTURE = 30;
const AGENDA_LOAD_STEP = 30;

interface AgendaRange {
  past: number;
  future: number;
}

function loadAgendaRange(): AgendaRange {
  try {
    const raw = profileStorage.getItemWithLegacyFallback(AGENDA_STORAGE_KEY);
    if (!raw) return { past: AGENDA_DEFAULT_PAST, future: AGENDA_DEFAULT_FUTURE };
    const parsed = JSON.parse(raw);
    return {
      past:
        typeof parsed?.past === 'number' && parsed.past >= 0 ? parsed.past : AGENDA_DEFAULT_PAST,
      future:
        typeof parsed?.future === 'number' && parsed.future >= 0
          ? parsed.future
          : AGENDA_DEFAULT_FUTURE,
    };
  } catch {
    return { past: AGENDA_DEFAULT_PAST, future: AGENDA_DEFAULT_FUTURE };
  }
}

function persistAgendaRange(range: AgendaRange): void {
  try {
    profileStorage.setItem(AGENDA_STORAGE_KEY, JSON.stringify(range));
  } catch {
    // Best effort — quota / disabled storage just falls back to defaults next launch.
  }
}

const AgendaList = React.memo<AgendaViewProps>(({ currentDate, notesByDate, onOpenNote }) => {
  const { t } = useTranslation();
  // Hydrate user-controlled range from localStorage so "Load more" choices
  // survive across sessions. Reset on `currentDate` change so navigating to
  // a different reference day doesn't carry over an oversized window.
  const [range, setRange] = useState<AgendaRange>(() => loadAgendaRange());
  useEffect(() => {
    persistAgendaRange(range);
  }, [range]);

  const days: { date: Date; key: string; notes: Note[] }[] = [];
  // Past first (oldest → most recent), then current day onwards.
  for (let i = -range.past; i < range.future; i++) {
    const d = addDays(currentDate, i);
    const key = toDateKey(d);
    const notes = notesByDate.get(key) || [];
    if (notes.length > 0) {
      days.push({ date: d, key, notes });
    }
  }

  return (
    <div className="calendar-agenda">
      {/* Load-more-past button — only shown when there's still room to grow */}
      <div className="calendar-agenda__range-action" style={{ textAlign: 'center', padding: 8 }}>
        <button
          onClick={() => setRange((r) => ({ ...r, past: r.past + AGENDA_LOAD_STEP }))}
          style={{
            padding: '6px 14px',
            fontSize: '0.75rem',
            border: '1px solid var(--color-border)',
            borderRadius: 999,
            background: 'var(--color-surface)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          {t('notes.calendarLoadMorePast', 'Load {{count}} more past days', {
            count: AGENDA_LOAD_STEP,
          })}
        </button>
      </div>

      {days.length === 0 ? (
        <div className="calendar-agenda--empty">
          <p>{t('notes.calendarNoNotes', 'No notes in this range')}</p>
        </div>
      ) : (
        days.map(({ date, key, notes }) => (
          <div key={key} className="calendar-agenda__group">
            <div className="calendar-agenda__date-header">
              <span className="calendar-agenda__date-day">
                {getDayNames()[(date.getDay() + 6) % 7]}
              </span>
              <span className="calendar-agenda__date-num">{date.getDate()}</span>
              <span className="calendar-agenda__date-month">
                {getMonthNames()[date.getMonth()]}
              </span>
            </div>
            <div className="calendar-agenda__items">
              {notes.map((note) => (
                <button
                  key={note.id}
                  className="calendar-agenda__item"
                  onClick={() => onOpenNote(note.id)}
                >
                  <span
                    className="calendar-agenda__dot"
                    style={{ background: getNoteColor(note) }}
                  />
                  <span className="calendar-agenda__title">{note.title || 'Untitled'}</span>
                  <span className="calendar-agenda__time">
                    {new Date(note.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      <div className="calendar-agenda__range-action" style={{ textAlign: 'center', padding: 8 }}>
        <button
          onClick={() => setRange((r) => ({ ...r, future: r.future + AGENDA_LOAD_STEP }))}
          style={{
            padding: '6px 14px',
            fontSize: '0.75rem',
            border: '1px solid var(--color-border)',
            borderRadius: 999,
            background: 'var(--color-surface)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          {t('notes.calendarLoadMoreFuture', 'Load {{count}} more future days', {
            count: AGENDA_LOAD_STEP,
          })}
        </button>
      </div>
    </div>
  );
});
AgendaList.displayName = 'AgendaList';

// ==================== Day Modal ====================

interface DayInfo {
  dailyNote: Note | null;
  notesOfDay: Note[];
  editsOfDay: Note[];
}

/**
 * Derive what's relevant for a given day from the full note list.
 *  - dailyNote: a daily note tied to that exact date (one max).
 *  - notesOfDay: notes "anchored" to the day — daily, scheduled there, or
 *                created there. The day they belong to.
 *  - editsOfDay: notes modified on that day but not anchored to it. Lets
 *                the user see "what did I work on this day" even if the
 *                notes themselves live on other days.
 */
function getDayInfo(allNotes: Note[], dateKey: string): DayInfo {
  let dailyNote: Note | null = null;
  const anchoredIds = new Set<string>();
  const notesOfDay: Note[] = [];
  const editsOfDay: Note[] = [];

  for (const note of allNotes) {
    if (note.deletedAt) continue;
    const isDaily = note.isDaily && note.dailyDate === dateKey;
    const isScheduled = note.scheduledDate === dateKey;
    const isCreatedHere =
      !note.isDaily && !note.scheduledDate && (note.createdAt || '').slice(0, 10) === dateKey;
    const isEditedHere = (note.updatedAt || '').slice(0, 10) === dateKey;

    if (isDaily) dailyNote = note;
    if (isDaily || isScheduled || isCreatedHere) {
      anchoredIds.add(note.id);
      notesOfDay.push(note);
    } else if (isEditedHere) {
      editsOfDay.push(note);
    }
  }

  // Sort each list deterministically
  notesOfDay.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  editsOfDay.sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
  void anchoredIds; // intentionally unused — kept for potential future cross-checks
  return { dailyNote, notesOfDay, editsOfDay };
}

interface DayModalProps {
  dateKey: string;
  allNotes: Note[];
  onOpenNote: (id: string) => void;
  onCreateDaily: (dateKey: string) => void;
  onClose: () => void;
}

const DayModal: React.FC<DayModalProps> = ({
  dateKey,
  allNotes,
  onOpenNote,
  onCreateDaily,
  onClose,
}) => {
  const { t } = useTranslation();
  const { dailyNote, notesOfDay, editsOfDay } = useMemo(
    () => getDayInfo(allNotes, dateKey),
    [allNotes, dateKey]
  );

  // Close on Escape — modal works as an overlay but is rendered inline so
  // we manage our own escape handler here.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Format the header date (e.g. "Wednesday, April 29, 2026")
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayLabel = `${getDayNames()[(date.getDay() + 6) % 7]}, ${getMonthNames()[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;

  const renderNoteRow = (note: Note, showTime: boolean) => (
    <button
      key={note.id}
      className="calendar-day-modal__row"
      onClick={() => {
        onOpenNote(note.id);
        onClose();
      }}
    >
      <span className="calendar-day-modal__dot" style={{ background: getNoteColor(note) }} />
      {note.icon && <span className="calendar-day-modal__icon">{note.icon}</span>}
      <span className="calendar-day-modal__title">
        {note.title || t('notes.untitled', 'Untitled')}
      </span>
      {showTime && note.updatedAt && (
        <span className="calendar-day-modal__time">
          {new Date(note.updatedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      )}
    </button>
  );

  return (
    <div
      className="calendar-day-modal__overlay"
      onClick={(e) => {
        // Only close on overlay clicks, not when interacting with the dialog.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="calendar-day-modal" role="dialog" aria-modal="true" aria-label={dayLabel}>
        <div className="calendar-day-modal__header">
          <h3 className="calendar-day-modal__date">{dayLabel}</h3>
          <button className="calendar-day-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="calendar-day-modal__body">
          {/* Notes anchored to this day */}
          <section className="calendar-day-modal__section">
            <h4 className="calendar-day-modal__section-title">
              {t('notes.calendarDayNotes', 'Notes du jour')}
              <span className="calendar-day-modal__count">{notesOfDay.length}</span>
            </h4>
            {notesOfDay.length === 0 ? (
              <p className="calendar-day-modal__empty">
                {t('notes.calendarDayNoNotes', 'Aucune note pour ce jour.')}
              </p>
            ) : (
              <div className="calendar-day-modal__list">
                {notesOfDay.map((n) => renderNoteRow(n, false))}
              </div>
            )}
          </section>

          {/* Notes edited on this day but anchored elsewhere */}
          {editsOfDay.length > 0 && (
            <section className="calendar-day-modal__section">
              <h4 className="calendar-day-modal__section-title">
                {t('notes.calendarDayEdits', 'Modifiées ce jour-là')}
                <span className="calendar-day-modal__count">{editsOfDay.length}</span>
              </h4>
              <div className="calendar-day-modal__list">
                {editsOfDay.map((n) => renderNoteRow(n, true))}
              </div>
            </section>
          )}
        </div>

        <div className="calendar-day-modal__footer">
          <button
            className="calendar-day-modal__primary"
            onClick={() => {
              onCreateDaily(dateKey);
              onClose();
            }}
          >
            {dailyNote
              ? t('notes.calendarDayOpenDaily', 'Ouvrir la note quotidienne')
              : t('notes.calendarDayCreateDaily', 'Créer la note quotidienne')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== Main CalendarView ====================

interface CalendarViewProps {
  /**
   * When provided (mounted under NotesView in calendar mode), clicking
   * a note here switches NotesView back to list mode and focuses the
   * note in the editor — same UX as Masonry/Kanban/etc. Falls back to
   * a plain `setEditingNote` dispatch when absent (legacy/standalone).
   */
  onOpenNote?: (id: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({ onOpenNote }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const allNotes = useSelector(selectAllNotes);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [subView, setSubView] = useState<SubView>('month');
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Modal state: which day the user clicked. When non-null the day-detail
  // modal is open. Replaces the old "click immediately creates a daily
  // note" behavior, which was both surprising and the only way to access
  // the daily-note creation flow.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (subView === 'month') d.setMonth(d.getMonth() - 1);
      else if (subView === 'week') d.setDate(d.getDate() - 7);
      else d.setDate(d.getDate() - 1);
      return d;
    });
  }, [subView]);

  const goNext = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (subView === 'month') d.setMonth(d.getMonth() + 1);
      else if (subView === 'week') d.setDate(d.getDate() + 7);
      else d.setDate(d.getDate() + 1);
      return d;
    });
  }, [subView]);

  const handleOpenNote = useCallback(
    (noteId: string) => {
      if (onOpenNote) {
        onOpenNote(noteId);
      } else {
        dispatch(setEditingNote(noteId));
      }
    },
    [dispatch, onOpenNote]
  );

  const handleCreateDaily = useCallback(
    (dateKey: string) => {
      // Check if a daily note already exists for this date
      const existing = allNotes.find((n) => n.isDaily && n.dailyDate === dateKey && !n.deletedAt);
      if (existing) {
        if (onOpenNote) onOpenNote(existing.id);
        else dispatch(setEditingNote(existing.id));
        return;
      }
      const newNote = createDailyNoteForDate(dateKey);
      dispatch(addNote(newNote));
      if (onOpenNote) onOpenNote(newNote.id);
      else dispatch(setEditingNote(newNote.id));
    },
    [allNotes, dispatch, onOpenNote]
  );

  // Cell click: open the day-detail modal AND sync `currentDate` to
  // that cell. Without the sync, clicking Oct 22 in Month view then
  // switching to Week view would show the week of whatever
  // `currentDate` happened to be (e.g. today, or the day the user
  // navigated to via prev/next), not the week containing the
  // inspected day. Fixes the workflow described in #17 — drill from
  // wide view to detailed view without losing the user's focus point.
  const handleSelectDay = useCallback((dateKey: string) => {
    setSelectedDay(dateKey);
    const [y, m, d] = dateKey.split('-').map(Number);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      setCurrentDate(new Date(y, m - 1, d));
    }
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, noteId: string) => {
    setDragNoteId(noteId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDrop = useCallback(
    (dateKey: string) => {
      if (!dragNoteId) return;
      const note = allNotes.find((n) => n.id === dragNoteId);
      if (!note) return;

      if (note.isDaily && note.dailyDate) {
        dispatch(updateNote({ id: note.id, changes: { dailyDate: dateKey } }));
      } else {
        // Set the dedicated scheduledDate field — never touch createdAt.
        // The previous behavior rewrote createdAt to position the note,
        // which silently destroyed the real creation timestamp and broke
        // chronology elsewhere in the app.
        dispatch(updateNote({ id: note.id, changes: { scheduledDate: dateKey } }));
      }
      setDragNoteId(null);
    },
    [dragNoteId, allNotes, dispatch]
  );

  // Title
  const headerTitle = useMemo(() => {
    if (subView === 'month')
      return `${getMonthNames()[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    if (subView === 'week') {
      const ws = startOfWeek(currentDate);
      const we = addDays(ws, 6);
      if (ws.getMonth() === we.getMonth())
        return `${getMonthNames()[ws.getMonth()]} ${ws.getDate()}\u2013${we.getDate()}, ${ws.getFullYear()}`;
      return `${getMonthNames()[ws.getMonth()]} ${ws.getDate()} \u2013 ${getMonthNames()[we.getMonth()]} ${we.getDate()}, ${we.getFullYear()}`;
    }
    return `${getDayNames()[(currentDate.getDay() + 6) % 7]}, ${getMonthNames()[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`;
  }, [currentDate, subView]);

  return (
    <div className="calendar-view">
      {/* Header */}
      <div className="calendar-view__header">
        <div className="calendar-view__nav">
          <button className="calendar-view__nav-btn" onClick={goPrev} title="Previous">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button className="calendar-view__today-btn" onClick={goToday}>
            {t('notes.calendarToday', 'Today')}
          </button>
          <button className="calendar-view__nav-btn" onClick={goNext} title="Next">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <h2 className="calendar-view__title">{headerTitle}</h2>
        </div>
        <div className="calendar-view__tabs">
          {(['month', 'week', 'day', 'agenda'] as SubView[]).map((sv) => (
            <button
              key={sv}
              className={`calendar-view__tab ${subView === sv ? 'calendar-view__tab--active' : ''}`}
              onClick={() => setSubView(sv)}
            >
              {t(
                `notes.calendar${sv.charAt(0).toUpperCase() + sv.slice(1)}` as any,
                sv.charAt(0).toUpperCase() + sv.slice(1)
              )}
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
            onCreateDaily={handleSelectDay}
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
            onCreateDaily={handleSelectDay}
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
            onCreateDaily={handleSelectDay}
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

      {selectedDay && (
        <DayModal
          dateKey={selectedDay}
          allNotes={allNotes}
          onOpenNote={handleOpenNote}
          onCreateDaily={handleCreateDaily}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
};
