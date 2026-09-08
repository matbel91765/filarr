/**
 * Vue CALENDRIER d'une base inline.
 *
 * Le troisième régime, après la table et le kanban : les lignes se rangent au
 * jour porté par une propriété de type date. C'est la vue qui manquait pour
 * relire une base venue de Notion telle qu'elle y était affichée.
 *
 * Deux choix qui tiennent tout le reste :
 *  - une ligne SANS date ne disparaît pas. Elle est rangée dans une bande
 *    « sans date » sous la grille — sinon un calendrier avalerait la moitié
 *    d'une base sans rien dire, et c'est exactement le genre de perte qu'on ne
 *    voit qu'un mois plus tard ;
 *  - déplacer une carte d'un jour à l'autre ÉCRIT la date. C'est le seul geste
 *    du calendrier qui modifie les données, et il doit être évident.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveLocale } from './cellFormats';
import {
  buildCalendarMonth,
  firstDateProperty,
  isoOf,
  shiftMonth,
  weekdayLabels,
} from './calendarLayout';
import { newRow } from './types';
import { RowPanel } from './RowPanel';
import type { DatabaseViewProps, DbProperty, DbRow } from './types';

/** Texte d'une carte : la première colonne texte fait le titre. */
function cardTitle(properties: DbProperty[], row: DbRow, fallback: string): string {
  const titleProp = properties.find((prop) => prop.type === 'text') ?? properties[0];
  const value = titleProp ? row.cells[titleProp.id] : undefined;
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

interface CalendarViewProps extends DatabaseViewProps {
  /** Aujourd'hui, injecté : le composant ne lit jamais l'horloge lui-même. */
  today?: Date;
}

export const DatabaseCalendarView: React.FC<CalendarViewProps> = ({
  data,
  visibleRows,
  rowDefaults,
  activeView,
  onChange,
  today,
}) => {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const now = today ?? new Date();

  const dateProp = useMemo(() => {
    const chosen = activeView?.dateProperty
      ? data.properties.find((prop) => prop.id === activeView.dateProperty)
      : null;
    // Une propriété disparue (colonne supprimée) ne doit pas vider la vue :
    // on retombe sur la première date disponible.
    return chosen && chosen.type === 'date' ? chosen : firstDateProperty(data.properties);
  }, [activeView?.dateProperty, data.properties]);

  const [cursor, setCursor] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }));
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  /** Carte ouverte en fiche : le calendrier ne montre qu'un titre, il faut
   *  bien une issue vers le reste de la ligne. */
  const [panelRowId, setPanelRowId] = useState<string | null>(null);

  const month = useMemo(
    () => buildCalendarMonth(visibleRows, dateProp?.id ?? '', cursor.year, cursor.month),
    [visibleRows, dateProp?.id, cursor.year, cursor.month]
  );

  const todayIso = isoOf(now.getFullYear(), now.getMonth(), now.getDate());
  const untitled = t('notes.inlineDb.untitled', 'Untitled');

  const setRowDate = useCallback(
    (rowId: string, iso: string | undefined) => {
      if (!dateProp) return;
      onChange({
        ...data,
        rows: data.rows.map((row) =>
          row.id === rowId ? { ...row, cells: { ...row.cells, [dateProp.id]: iso } } : row
        ),
      });
    },
    [data, dateProp, onChange]
  );

  const addRowOn = useCallback(
    (iso: string) => {
      if (!dateProp) return;
      // `rowDefaults` : sans lui, une vue filtrée créerait une ligne invisible.
      const created = newRow(data.properties, { ...rowDefaults, [dateProp.id]: iso });
      onChange({ ...data, rows: [...data.rows, created] });
    },
    [data, dateProp, onChange, rowDefaults]
  );

  if (!dateProp) {
    return (
      <div className="inline-db__calendar-empty">
        {t(
          'notes.inlineDb.calendarNeedsDate',
          'A calendar view needs a date column. Add one, then pick it in the view options.'
        )}
      </div>
    );
  }

  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(cursor.year, cursor.month, 1)
  );

  return (
    <div className="inline-db__calendar">
      <div className="inline-db__cal-head">
        <button
          type="button"
          className="inline-db__cal-nav"
          aria-label={t('notes.inlineDb.calPrev', 'Previous month')}
          onClick={() => setCursor((cur) => shiftMonth(cur.year, cur.month, -1))}
        >
          ‹
        </button>
        <span className="inline-db__cal-month">{monthLabel}</span>
        <button
          type="button"
          className="inline-db__cal-nav"
          aria-label={t('notes.inlineDb.calNext', 'Next month')}
          onClick={() => setCursor((cur) => shiftMonth(cur.year, cur.month, 1))}
        >
          ›
        </button>
        <button
          type="button"
          className="inline-db__cal-today"
          onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
        >
          {t('notes.inlineDb.calToday', 'Today')}
        </button>
        <span className="inline-db__cal-prop">{dateProp.name}</span>
      </div>

      <div className="inline-db__cal-grid" role="grid" aria-label={monthLabel}>
        <div className="inline-db__cal-weekdays" role="row">
          {weekdayLabels(locale).map((label) => (
            <span key={label} className="inline-db__cal-weekday" role="columnheader">
              {label}
            </span>
          ))}
        </div>

        {month.weeks.map((week, weekIndex) => (
          <div className="inline-db__cal-week" role="row" key={weekIndex}>
            {week.map((cell) => (
              <div
                key={cell.iso}
                role="gridcell"
                className={`inline-db__cal-day ${cell.inMonth ? '' : 'is-outside'} ${
                  cell.iso === todayIso ? 'is-today' : ''
                }`}
                onDragOver={(e) => {
                  if (dragRowId) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragRowId) setRowDate(dragRowId, cell.iso);
                  setDragRowId(null);
                }}
              >
                <div className="inline-db__cal-daynum">
                  <span>{cell.day}</span>
                  <button
                    type="button"
                    className="inline-db__cal-add"
                    aria-label={t('notes.inlineDb.calAddOn', 'Add on {{date}}', { date: cell.iso })}
                    title={t('notes.inlineDb.calAddOn', 'Add on {{date}}', { date: cell.iso })}
                    onClick={() => addRowOn(cell.iso)}
                  >
                    +
                  </button>
                </div>

                {cell.rows.map((row) => (
                  <div
                    key={row.id}
                    className="inline-db__cal-card"
                    draggable
                    title={cardTitle(data.properties, row, untitled)}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', row.id);
                      setDragRowId(row.id);
                    }}
                    onDragEnd={() => setDragRowId(null)}
                    onClick={() => setPanelRowId(row.id)}
                  >
                    {cardTitle(data.properties, row, untitled)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {panelRowId &&
        (() => {
          const row = data.rows.find((candidate) => candidate.id === panelRowId);
          if (!row) return null;
          return (
            <RowPanel
              data={data}
              row={row}
              // Toutes les colonnes sont « visibles » ici : le calendrier n'en
              // affiche aucune, la fiche est le seul endroit ou les lire.
              visiblePropertyIds={new Set(data.properties.map((prop) => prop.id))}
              onChange={onChange}
              onClose={() => setPanelRowId(null)}
            />
          );
        })()}

      {month.undated.length > 0 && (
        <div className="inline-db__cal-undated">
          <span className="inline-db__cal-undated-label">
            {t('notes.inlineDb.calUndated', '{{count}} without a date', {
              count: month.undated.length,
            })}
          </span>
          <div className="inline-db__cal-undated-cards">
            {month.undated.map((row) => (
              <div
                key={row.id}
                className="inline-db__cal-card"
                draggable
                title={t('notes.inlineDb.calDropToSchedule', 'Drag onto a day to schedule it')}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', row.id);
                  setDragRowId(row.id);
                }}
                onDragEnd={() => setDragRowId(null)}
                onClick={() => setPanelRowId(row.id)}
              >
                {cardTitle(data.properties, row, untitled)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
