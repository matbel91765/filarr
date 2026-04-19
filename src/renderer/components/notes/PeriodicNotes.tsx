/**
 * PeriodicNotes — Filarr Notes
 *
 * Panel for creating/viewing weekly, monthly, and quarterly notes.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import './PeriodicNotes.css';

interface PeriodicNotesProps {
  onSelectNote: (noteId: string) => void;
  onCreateNote: (title: string, type: 'weekly' | 'monthly' | 'quarterly') => void;
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getWeekRange(date: Date): string {
  const monday = new Date(date);
  const dow = monday.getDay() || 7;
  monday.setDate(monday.getDate() - dow + 1);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(monday)} - ${fmt(sunday)}`;
}

function getQuarter(month: number): number {
  return Math.floor(month / 3) + 1;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type PeriodType = 'weekly' | 'monthly' | 'quarterly';

export const PeriodicNotes: React.FC<PeriodicNotesProps> = ({ onSelectNote, onCreateNote }) => {
  const [activeTab, setActiveTab] = useState<PeriodType>('weekly');
  const notesById = useSelector((state: any) => state.notes?.byId || {});

  const today = new Date();
  const currentWeek = getISOWeek(today);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentQuarter = getQuarter(currentMonth);

  // Current period info
  const currentPeriodTitle = useMemo(() => {
    switch (activeTab) {
      case 'weekly':
        return `Week ${currentWeek}, ${currentYear} (${getWeekRange(today)})`;
      case 'monthly':
        return `${MONTHS[currentMonth]} ${currentYear}`;
      case 'quarterly':
        return `Q${currentQuarter} ${currentYear}`;
    }
  }, [activeTab, currentWeek, currentYear, currentMonth, currentQuarter]);

  // Find existing periodic notes by title pattern
  const periodicNotes = useMemo(() => {
    const notes = Object.values(notesById) as any[];
    const patterns: Record<PeriodType, RegExp> = {
      weekly: /^Week \d+, \d{4}/,
      monthly: new RegExp(`^(${MONTHS.join('|')}) \\d{4}$`),
      quarterly: /^Q[1-4] \d{4}$/,
    };
    return notes
      .filter((n) => patterns[activeTab].test(n.title || ''))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 20);
  }, [notesById, activeTab]);

  const handleCreate = useCallback(() => {
    onCreateNote(currentPeriodTitle, activeTab);
  }, [currentPeriodTitle, activeTab, onCreateNote]);

  // Check if current period note already exists
  const currentExists = useMemo(() => {
    return periodicNotes.some((n: any) => n.title === currentPeriodTitle);
  }, [periodicNotes, currentPeriodTitle]);

  return (
    <div className="periodic-notes">
      <div className="periodic-notes__tabs">
        {(['weekly', 'monthly', 'quarterly'] as const).map((tab) => (
          <button
            key={tab}
            className={`periodic-notes__tab ${activeTab === tab ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'weekly' ? 'Weekly' : tab === 'monthly' ? 'Monthly' : 'Quarterly'}
          </button>
        ))}
      </div>

      <div className="periodic-notes__current">
        <div className="periodic-notes__current-label">Current</div>
        <div className="periodic-notes__current-title">{currentPeriodTitle}</div>
        {!currentExists ? (
          <button className="periodic-notes__create-btn" onClick={handleCreate}>
            + Create
          </button>
        ) : (
          <button
            className="periodic-notes__open-btn"
            onClick={() => {
              const note = periodicNotes.find((n: any) => n.title === currentPeriodTitle);
              if (note) onSelectNote(note.id);
            }}
          >
            Open
          </button>
        )}
      </div>

      {periodicNotes.length > 0 && (
        <div className="periodic-notes__list">
          <div className="periodic-notes__list-label">Recent</div>
          {periodicNotes.map((note: any) => (
            <button
              key={note.id}
              className="periodic-notes__item"
              onClick={() => onSelectNote(note.id)}
            >
              <span className="periodic-notes__item-title">{note.title}</span>
              <span className="periodic-notes__item-date">
                {new Date(note.createdAt).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
