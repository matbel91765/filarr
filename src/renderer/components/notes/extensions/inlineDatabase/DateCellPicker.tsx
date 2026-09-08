/**
 * DateCellPicker — Filarr Notes / bases inline
 *
 * Sélecteur de date MAISON des cellules de type date : le calendrier natif de
 * Chromium n'a ni la police, ni les rayons, ni les couleurs du produit, et sur
 * les thèmes sombres il ne se redresse qu'à coups de `filter: invert()`.
 *
 * Grammaire visuelle reprise du calendrier du bandeau latéral (CalendarWidget) :
 * grille de 7 colonnes, en-tête de jours en capitales, cases rondes, aujourd'hui
 * pointé — mais en jetons de thème uniquement, donc lisible sur les dix thèmes.
 *
 * Le contenu est rendu DANS le popover de la table (`.inline-db__popover`) :
 * l'ancrage, la fermeture au Escape / clic extérieur / défilement et la
 * restitution du focus restent gérés une seule fois, par DatabaseTableView.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  daysInMonth,
  formatFullDate,
  formatTypedDate,
  isValidIso,
  isoParts,
  localDatePattern,
  monthGrid,
  monthYearLabel,
  parseLocalDate,
  resolveDateCommit,
  resolveLocale,
  shiftIsoDays,
  shiftMonth,
  toIso,
  todayIso,
  weekStartFor,
  weekdayLabels,
} from './cellFormats';

interface DateCellPickerProps {
  /** Valeur de la cellule (ISO `YYYY-MM-DD`), vide quand rien n'est posé */
  value: string;
  /** Écrit la cellule — `null` l'efface */
  onCommit: (iso: string | null) => void;
  /** Referme le popover (le focus revient à la cellule, côté table) */
  onClose: () => void;
}

/** Mois affiché au départ : celui de la valeur, sinon celui d'aujourd'hui */
function monthOf(iso: string): { year: number; month: number } {
  const p = isoParts(iso);
  if (p) return { year: p.year, month: p.month };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

const chevronProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const DateCellPicker: React.FC<DateCellPickerProps> = ({ value, onCommit, onClose }) => {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const weekStart = useMemo(() => weekStartFor(locale), [locale]);
  const today = useMemo(() => todayIso(), []);
  const hasValue = isValidIso(value);
  const anchorIso = hasValue ? value : today;

  const [view, setView] = useState(() => monthOf(anchorIso));
  // Jour parcouru au clavier (tabindex tournant) — distinct de la valeur choisie
  const [cursor, setCursor] = useState(anchorIso);
  const [typed, setTyped] = useState(() => (hasValue ? formatTypedDate(value, locale) : ''));
  const [invalid, setInvalid] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Le focus DOM ne suit le curseur QUE lorsque le clavier l'a déplacé : taper
  // une date dans le champ déplace l'aperçu sans voler le focus au champ
  const moveFocusRef = useRef(false);

  // Ouverture : la saisie au clavier doit marcher sans un clic de plus
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!moveFocusRef.current) return;
    moveFocusRef.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-iso="${cursor}"]`)
      ?.focus({ preventScroll: true });
  }, [cursor, view]);

  const days = useMemo(() => monthGrid(view.year, view.month, weekStart), [view, weekStart]);
  const weekdays = useMemo(() => weekdayLabels(locale, weekStart), [locale, weekStart]);
  const monthLabel = monthYearLabel(view.year, view.month, locale);
  const pattern = useMemo(
    () =>
      localDatePattern(locale, {
        day: t('notes.inlineDb.datePatternDay', 'DD'),
        month: t('notes.inlineDb.datePatternMonth', 'MM'),
        year: t('notes.inlineDb.datePatternYear', 'YYYY'),
      }),
    [locale, t]
  );

  const showMonthOf = useCallback((iso: string) => {
    const p = isoParts(iso);
    if (p) setView({ year: p.year, month: p.month });
  }, []);

  /**
   * Changement de mois : le curseur suit, sinon plus AUCUNE case ne porterait
   * `tabIndex=0` et la grille sortirait de l'ordre de tabulation.
   */
  const goMonth = useCallback(
    (delta: number) => {
      const next = shiftMonth(view.year, view.month, delta);
      setView(next);
      const p = isoParts(cursor);
      const day = p ? p.day : 1;
      setCursor(toIso(next.year, next.month, Math.min(day, daysInMonth(next.year, next.month))));
    },
    [view, cursor]
  );

  const pick = useCallback(
    (iso: string) => {
      onCommit(iso);
      onClose();
    },
    [onCommit, onClose]
  );

  /** Déplacement clavier dans la grille : le mois suit le curseur */
  const moveCursor = useCallback(
    (next: string) => {
      if (next === '') return;
      moveFocusRef.current = true;
      setCursor(next);
      showMonthOf(next);
    },
    [showMonthOf]
  );

  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let next: string | null = null;
      switch (e.key) {
        case 'ArrowLeft':
          next = shiftIsoDays(cursor, -1);
          break;
        case 'ArrowRight':
          next = shiftIsoDays(cursor, 1);
          break;
        case 'ArrowUp':
          next = shiftIsoDays(cursor, -7);
          break;
        case 'ArrowDown':
          next = shiftIsoDays(cursor, 7);
          break;
        case 'Home': {
          const p = isoParts(cursor);
          if (p) {
            const dow = new Date(p.year, p.month, p.day, 12).getDay();
            next = shiftIsoDays(cursor, -((dow - weekStart + 7) % 7));
          }
          break;
        }
        case 'End': {
          const p = isoParts(cursor);
          if (p) {
            const dow = new Date(p.year, p.month, p.day, 12).getDay();
            next = shiftIsoDays(cursor, 6 - ((dow - weekStart + 7) % 7));
          }
          break;
        }
        case 'PageUp':
        case 'PageDown': {
          const p = isoParts(cursor);
          if (p) {
            const m = shiftMonth(p.year, p.month, e.key === 'PageUp' ? -1 : 1);
            const grid = monthGrid(m.year, m.month, weekStart).filter((d) => d.inCurrentMonth);
            const target = grid[Math.min(p.day, grid.length) - 1];
            next = target ? target.iso : null;
          }
          break;
        }
        default:
          return;
      }
      e.preventDefault();
      if (next) moveCursor(next);
    },
    [cursor, moveCursor, weekStart]
  );

  const onTypedChange = useCallback(
    (raw: string) => {
      setTyped(raw);
      setInvalid(false);
      const iso = parseLocalDate(raw, locale, view);
      // Aperçu vivant : la grille se cale sur ce qui est en train d'être tapé
      if (iso) {
        setCursor(iso);
        showMonthOf(iso);
      }
    },
    [locale, view, showMonthOf]
  );

  const commitTyped = useCallback(
    (close: boolean) => {
      const decision = resolveDateCommit(typed, value, locale, view);
      if (decision.action === 'invalid') {
        setInvalid(true);
        return;
      }
      if (decision.action === 'clear') {
        // Effacement EXPLICITE : jamais au simple blur, qu'une flèche de mois
        // ou un clic sur « Aujourd'hui » déclenche déjà
        if (!close) return;
        onCommit(null);
        onClose();
        return;
      }
      if (decision.action === 'commit') {
        setTyped(formatTypedDate(decision.iso, locale));
        onCommit(decision.iso);
      }
      // `none` : la saisie vaut déjà la cellule — aucune écriture, donc aucune
      // entrée d'annulation ni note salie pour un geste qui ne change rien
      if (close) onClose();
    },
    [typed, value, locale, view, onCommit, onClose]
  );

  return (
    <div className="inline-db__dp">
      <div className="inline-db__dp-field">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          className={`inline-db__pe-input inline-db__dp-input${
            invalid ? ' inline-db__dp-input--invalid' : ''
          }`}
          value={typed}
          placeholder={pattern}
          aria-label={t('notes.inlineDb.dateTyped', 'Type a date ({{pattern}})', { pattern })}
          aria-invalid={invalid}
          onChange={(e) => onTypedChange(e.target.value)}
          onBlur={() => commitTyped(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitTyped(true);
            } else if (e.key === 'ArrowDown') {
              // Descendre du champ vers la grille, sans souris
              e.preventDefault();
              moveCursor(cursor);
            }
          }}
        />
        {invalid && (
          <p className="inline-db__dp-error" role="alert">
            {t('notes.inlineDb.dateInvalid', 'Date not understood — try {{pattern}}', {
              pattern,
            })}
          </p>
        )}
      </div>

      <div className="inline-db__dp-header">
        <button
          type="button"
          className="inline-db__dp-nav"
          aria-label={t('notes.inlineDb.datePrevMonth', 'Previous month')}
          onClick={() => goMonth(-1)}
        >
          <svg {...chevronProps}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="inline-db__dp-month" aria-live="polite">
          {monthLabel}
        </span>
        <button
          type="button"
          className="inline-db__dp-nav"
          aria-label={t('notes.inlineDb.dateNextMonth', 'Next month')}
          onClick={() => goMonth(1)}
        >
          <svg {...chevronProps}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div
        ref={gridRef}
        className="inline-db__dp-grid"
        role="grid"
        aria-label={t('notes.inlineDb.dateCalendar', 'Calendar')}
        onKeyDown={onGridKeyDown}
      >
        <div className="inline-db__dp-week inline-db__dp-week--head" role="row">
          {weekdays.map((w) => (
            <span key={w.long} className="inline-db__dp-weekday" role="columnheader" title={w.long}>
              {w.short}
            </span>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div key={week} className="inline-db__dp-week" role="row">
            {days.slice(week * 7, week * 7 + 7).map((d) => {
              const selected = hasValue && d.iso === value;
              const isToday = d.iso === today;
              return (
                <button
                  key={d.iso}
                  type="button"
                  role="gridcell"
                  data-iso={d.iso}
                  className={`inline-db__dp-day${
                    d.inCurrentMonth ? '' : ' inline-db__dp-day--outside'
                  }${selected ? ' inline-db__dp-day--selected' : ''}${
                    isToday ? ' inline-db__dp-day--today' : ''
                  }`}
                  tabIndex={d.iso === cursor ? 0 : -1}
                  aria-selected={selected}
                  {...(isToday ? { 'aria-current': 'date' as const } : {})}
                  aria-label={formatFullDate(d.iso, locale)}
                  onClick={() => pick(d.iso)}
                  onFocus={() => setCursor(d.iso)}
                >
                  {d.day}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="inline-db__dp-actions">
        <button type="button" className="inline-db__dp-action" onClick={() => pick(today)}>
          {t('notes.inlineDb.dateToday', 'Today')}
        </button>
        <button
          type="button"
          className="inline-db__dp-action inline-db__dp-action--clear"
          disabled={!hasValue}
          onClick={() => {
            onCommit(null);
            onClose();
          }}
        >
          {t('notes.inlineDb.clearValue', 'Clear')}
        </button>
      </div>
    </div>
  );
};
