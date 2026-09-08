/**
 * IcsPreview Component
 *
 * In-app preview for iCalendar .ics files. Parses the calendar entirely in the
 * renderer with ical.js (dynamically imported so the parser stays out of the
 * main bundle — nothing leaves the device), then renders the VEVENTs as a clean,
 * date-grouped agenda list. A full month grid is intentionally out of scope.
 */

import React, { useState, useEffect, useMemo } from 'react';
import clsx from 'clsx';
import './MarkdownPreview.css';

export interface IcsPreviewProps {
  /** Calendar data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension (ics) */
  extension?: string;
  /** Additional CSS class */
  className?: string;
}

interface AgendaEvent {
  summary: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  location: string;
  description: string;
}

const FR = 'fr-FR';

const formatDayHeader = (d: Date): string =>
  d.toLocaleDateString(FR, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const formatTime = (d: Date): string =>
  d.toLocaleTimeString(FR, { hour: '2-digit', minute: '2-digit' });

// A human-readable time range for a single event row.
const formatTimeRange = (ev: AgendaEvent): string => {
  if (!ev.start) return 'Date inconnue';
  if (ev.allDay) return 'Toute la journée';
  const startStr = formatTime(ev.start);
  if (ev.end && ev.end.getTime() !== ev.start.getTime()) {
    return `${startStr} – ${formatTime(ev.end)}`;
  }
  return startStr;
};

// Group consecutive (already sorted) events by their calendar day.
interface DayGroup {
  key: string;
  label: string;
  events: AgendaEvent[];
}

const groupByDay = (events: AgendaEvent[]): DayGroup[] => {
  const groups: DayGroup[] = [];
  for (const ev of events) {
    const key = ev.start
      ? new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate()).toISOString()
      : 'unknown';
    const label = ev.start ? formatDayHeader(ev.start) : 'Sans date';
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.events.push(ev);
    } else {
      groups.push({ key, label, events: [ev] });
    }
  }
  return groups;
};

export const IcsPreview: React.FC<IcsPreviewProps> = ({ data, fileName, className }) => {
  const [events, setEvents] = useState<AgendaEvent[] | null>(null);
  const [isParsing, setIsParsing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsParsing(true);
    setError(null);
    setEvents(null);

    (async () => {
      try {
        // ical.js has no runtime deps but a large surface — keep it lazy.
        // The API lives on the module's default export.
        const mod = await import('ical.js');
        const ICAL: any = (mod as any).default ?? mod;

        const text = new TextDecoder('utf-8').decode(data);
        const jcal = ICAL.parse(text);
        const comp = new ICAL.Component(jcal);

        const vevents: any[] = comp.getAllSubcomponents('vevent');
        const parsed: AgendaEvent[] = vevents.map((v) => {
          const event: any = new ICAL.Event(v);
          let start: Date | null = null;
          let end: Date | null = null;
          let allDay = false;
          try {
            start = event.startDate ? event.startDate.toJSDate() : null;
            allDay = Boolean(event.startDate && event.startDate.isDate);
          } catch {
            /* malformed DTSTART — leave null */
          }
          try {
            end = event.endDate ? event.endDate.toJSDate() : null;
          } catch {
            /* malformed DTEND — leave null */
          }
          return {
            summary: (event.summary as string) || '(Sans titre)',
            start,
            end,
            allDay,
            location: (event.location as string) || '',
            description: (event.description as string) || '',
          };
        });

        parsed.sort((a, b) => {
          const ta = a.start ? a.start.getTime() : Infinity;
          const tb = b.start ? b.start.getTime() : Infinity;
          return ta - tb;
        });

        if (!cancelled) setEvents(parsed);
      } catch (err) {
        if (cancelled) return;
        console.error('[IcsPreview] Parse error:', err);
        setError(err instanceof Error ? err.message : 'Lecture impossible');
      } finally {
        if (!cancelled) setIsParsing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  const groups = useMemo(() => (events ? groupByDay(events) : []), [events]);

  const containerClasses = clsx('markdown-preview', className);

  return (
    <div className={containerClasses}>
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">ICS</span>
          <span className="markdown-preview__stats" title={fileName}>
            {events ? `${events.length} événement${events.length > 1 ? 's' : ''}` : fileName}
          </span>
        </div>
      </div>

      <div className="markdown-preview__container">
        {isParsing ? (
          <div className="file-preview-panel__loading">
            <div className="file-preview-panel__spinner" />
            <span>Lecture du calendrier…</span>
          </div>
        ) : error ? (
          <div className="file-preview-panel__error">
            <span>Impossible d'afficher ce calendrier</span>
            <p className="file-preview-panel__error-message">{error}</p>
          </div>
        ) : !events || events.length === 0 ? (
          <div className="file-preview-panel__error">
            <span>Aucun événement dans ce calendrier</span>
          </div>
        ) : (
          <div style={agendaStyles.list}>
            {groups.map((group) => (
              <section key={group.key} style={agendaStyles.group}>
                <h3 style={agendaStyles.dayHeader}>{group.label}</h3>
                {group.events.map((ev, i) => (
                  <div key={i} style={agendaStyles.row}>
                    <div style={agendaStyles.time}>{formatTimeRange(ev)}</div>
                    <div style={agendaStyles.content}>
                      <div style={agendaStyles.title}>{ev.summary}</div>
                      {ev.location && <div style={agendaStyles.meta}>📍 {ev.location}</div>}
                      {ev.description && (
                        <div style={agendaStyles.description}>{ev.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Inline, theme-aware styles (kept in the single .tsx per spec — no sibling CSS).
const agendaStyles: Record<string, React.CSSProperties> = {
  list: {
    padding: '16px 20px',
    maxWidth: 760,
    margin: '0 auto',
  },
  group: {
    marginBottom: 20,
  },
  dayHeader: {
    margin: '0 0 8px 0',
    fontSize: 13,
    fontWeight: 600,
    textTransform: 'capitalize',
    color: 'var(--color-text-secondary, #6b7280)',
    position: 'sticky',
    top: 0,
    background: 'var(--color-bg-primary, #ffffff)',
    padding: '4px 0',
    zIndex: 1,
  },
  row: {
    display: 'flex',
    gap: 14,
    padding: '10px 12px',
    borderLeft: '3px solid var(--color-primary-400, #60a5fa)',
    borderRadius: '0 6px 6px 0',
    background: 'var(--color-bg-secondary, #f9fafb)',
    marginBottom: 6,
  },
  time: {
    flexShrink: 0,
    width: 118,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-primary-700, #1d4ed8)',
    fontVariantNumeric: 'tabular-nums',
    paddingTop: 1,
  },
  content: {
    minWidth: 0,
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--color-text-primary, #1f2937)',
    wordBreak: 'break-word',
  },
  meta: {
    marginTop: 3,
    fontSize: 12,
    color: 'var(--color-text-secondary, #6b7280)',
    wordBreak: 'break-word',
  },
  description: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--color-text-tertiary, #9ca3af)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};

export default IcsPreview;
