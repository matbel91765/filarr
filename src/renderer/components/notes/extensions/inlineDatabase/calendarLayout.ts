/**
 * Disposition d'un mois pour la vue calendrier — logique PURE.
 *
 * Aucune date « maintenant » n'est lue ici : le mois regardé et le jour à
 * marquer sont TOUJOURS passés en argument. C'est ce qui rend la grille
 * testable, et ce qui évite qu'un calendrier change d'aspect entre deux rendus
 * du même mois.
 */

import type { DbProperty, DbRow } from './types';

/** Une case de la grille : un jour, et ce qu'il porte. */
export interface CalendarCell {
  /** `YYYY-MM-DD` */
  iso: string;
  day: number;
  /** Faux pour les jours des mois voisins qui complètent la grille. */
  inMonth: boolean;
  rows: DbRow[];
}

export interface CalendarMonth {
  year: number;
  /** 0-11, comme `Date` */
  month: number;
  /** Six semaines de sept jours : une grille de hauteur STABLE. */
  weeks: CalendarCell[][];
  /** Lignes sans date exploitable — elles ne doivent pas disparaître. */
  undated: DbRow[];
}

/** `YYYY-MM-DD` d'une date locale, sans passer par UTC (qui décale d'un jour). */
export function isoOf(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Partie date d'une cellule, ou `null` si elle n'en porte pas. */
export function cellDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** Première propriété de type date : le choix d'office d'une vue calendrier. */
export function firstDateProperty(properties: DbProperty[]): DbProperty | null {
  return properties.find((prop) => prop.type === 'date') ?? null;
}

/**
 * Construit la grille du mois.
 *
 * `weekStartsOn` : 1 = lundi (Europe), 0 = dimanche. La grille fait toujours
 * SIX semaines — un mois de cinq semaines ferait sauter la hauteur du bloc d'un
 * mois à l'autre, et le contenu sous la base danserait à chaque navigation.
 */
export function buildCalendarMonth(
  rows: DbRow[],
  datePropertyId: string,
  year: number,
  month: number,
  weekStartsOn: 0 | 1 = 1
): CalendarMonth {
  const byDate = new Map<string, DbRow[]>();
  const undated: DbRow[] = [];

  for (const row of rows) {
    const iso = datePropertyId ? cellDate(row.cells[datePropertyId]) : null;
    if (!iso) {
      undated.push(row);
      continue;
    }
    const bucket = byDate.get(iso);
    if (bucket) bucket.push(row);
    else byDate.set(iso, [row]);
  }

  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(year, month, 1 - offset);

  const weeks: CalendarCell[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const week: CalendarCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const iso = isoOf(date.getFullYear(), date.getMonth(), date.getDate());
      week.push({
        iso,
        day: date.getDate(),
        inMonth: date.getMonth() === month && date.getFullYear() === year,
        rows: byDate.get(iso) ?? [],
      });
    }
    weeks.push(week);
  }

  return { year, month, weeks, undated };
}

/** Mois précédent / suivant, sans jamais fabriquer un mois 12. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Noms des jours, dans l'ordre de la grille et dans la langue de l'app. */
export function weekdayLabels(locale: string, weekStartsOn: 0 | 1 = 1): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2024-01-07 est un dimanche : point de départ connu, sans dépendre du jour
  // où le code tourne.
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(2024, 0, 7 + ((i + weekStartsOn) % 7)))
  );
}
