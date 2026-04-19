/**
 * CalendarWidget — Filarr Notes
 *
 * Monthly calendar sidebar widget linked to daily notes.
 * Days with existing daily notes show a dot indicator.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import './CalendarWidget.css';

interface CalendarWidgetProps {
  onSelectDate: (date: string) => void;
}

const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isSameDay(a: string, b: string): boolean {
  return a === b;
}

export const CalendarWidget: React.FC<CalendarWidgetProps> = ({ onSelectDate }) => {
  const today = new Date();
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const notesById = useSelector((state: any) => state.notes?.byId || {});

  // Collect all daily note dates
  const dailyNoteDates = useMemo(() => {
    const dates = new Set<string>();
    Object.values(notesById).forEach((note: any) => {
      if (note.isDaily && note.dailyDate) {
        dates.add(note.dailyDate);
      }
    });
    return dates;
  }, [notesById]);

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Monday = 0, Sunday = 6
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const days: { day: number; iso: string; isCurrentMonth: boolean }[] = [];

    // Previous month padding
    const prevMonthLast = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      const pm = viewMonth === 0 ? 11 : viewMonth - 1;
      const py = viewMonth === 0 ? viewYear - 1 : viewYear;
      days.push({ day: d, iso: toISO(py, pm, d), isCurrentMonth: false });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, iso: toISO(viewYear, viewMonth, d), isCurrentMonth: true });
    }

    // Next month padding (fill to 42 = 6 rows)
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const nm = viewMonth === 11 ? 0 : viewMonth + 1;
      const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
      days.push({ day: d, iso: toISO(ny, nm, d), isCurrentMonth: false });
    }

    return days;
  }, [viewYear, viewMonth]);

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }, [viewMonth]);

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }, [viewMonth]);

  const goToToday = useCallback(() => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }, []);

  return (
    <div className="calendar-widget">
      <div className="calendar-widget__header">
        <button className="calendar-widget__nav" onClick={prevMonth} title="Previous month">
          ‹
        </button>
        <button className="calendar-widget__month-label" onClick={goToToday} title="Go to today">
          {MONTHS[viewMonth]} {viewYear}
        </button>
        <button className="calendar-widget__nav" onClick={nextMonth} title="Next month">
          ›
        </button>
      </div>

      <div className="calendar-widget__weekdays">
        {WEEKDAYS_EN.map((d) => (
          <div key={d} className="calendar-widget__weekday">{d}</div>
        ))}
      </div>

      <div className="calendar-widget__grid">
        {calendarDays.map(({ day, iso, isCurrentMonth }, i) => {
          const isToday = isSameDay(iso, todayISO);
          const hasNote = dailyNoteDates.has(iso);

          return (
            <button
              key={i}
              className={[
                'calendar-widget__day',
                !isCurrentMonth && 'calendar-widget__day--other',
                isToday && 'calendar-widget__day--today',
                hasNote && 'calendar-widget__day--has-note',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectDate(iso)}
              title={iso}
            >
              {day}
              {hasNote && <span className="calendar-widget__dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
