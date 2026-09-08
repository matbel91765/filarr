/**
 * cellFormats — Filarr Notes / bases inline
 *
 * Lecture et écriture des valeurs de cellule dans la LANGUE DE L'APP (jamais la
 * locale du système) : grammaire du sélecteur de date maison, et nombres saisis
 * avec le séparateur décimal de la langue.
 *
 * Module PUR — ni React, ni DOM : le popover, la table et les tests partagent
 * exactement les mêmes règles, et une régression de format se voit en test sans
 * monter le moindre composant.
 */

/** Date de référence aux trois champs distincts (22 ≠ 11 ≠ 2026) : l'ordre lu dans `formatToParts` est sans ambiguïté */
const REF_DATE = new Date(2026, 10, 22, 12, 0, 0);
/** Dimanche 7 janvier 2024 — origine des noms de jours (le 1er janvier 2024 était un lundi) */
const REF_SUNDAY = new Date(2024, 0, 7, 12, 0, 0);
/** Pivot POSIX des années à deux chiffres : 00-68 → 2000, 69-99 → 1900 */
const TWO_DIGIT_YEAR_PIVOT = 68;
const FALLBACK_LOCALE = 'en-US';

export const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateField = 'day' | 'month' | 'year';

export interface CalendarDay {
  /** Jour au format ISO `YYYY-MM-DD` */
  iso: string;
  /** Quantième affiché (1-31) */
  day: number;
  /** Mois 0-11 */
  month: number;
  year: number;
  /** Faux pour les jours de remplissage empruntés au mois voisin */
  inCurrentMonth: boolean;
}

/* ==================== Locale ==================== */

/** Étiquette de langue de l'app ramenée à quelque chose qu'Intl accepte */
export function resolveLocale(lang: string | undefined | null): string {
  const tag = (lang ?? '').trim();
  return tag === '' ? FALLBACK_LOCALE : tag;
}

/** Intl ne doit JAMAIS lancer sur une étiquette exotique : repli silencieux */
function dtf(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, opts);
  } catch {
    return new Intl.DateTimeFormat(FALLBACK_LOCALE, opts);
  }
}

function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, opts);
  } catch {
    return new Intl.NumberFormat(FALLBACK_LOCALE, opts);
  }
}

/**
 * Premier jour de la semaine (0 = dimanche). Donné par la locale quand le
 * moteur sait le dire, sinon déduit de la langue — l'anglais commence le
 * dimanche, le reste le lundi.
 */
export function weekStartFor(locale: string): number {
  type WithWeekInfo = Intl.Locale & {
    getWeekInfo?: () => { firstDay?: number };
    weekInfo?: { firstDay?: number };
  };
  try {
    const loc = new Intl.Locale(locale) as WithWeekInfo;
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    const first = info?.firstDay;
    // Convention CLDR : 1 = lundi … 7 = dimanche
    if (typeof first === 'number' && first >= 1 && first <= 7) return first === 7 ? 0 : first;
  } catch {
    /* moteur sans weekInfo : repli sur la langue */
  }
  return locale.toLowerCase().startsWith('en') ? 0 : 1;
}

/* ==================== Dates : calculs ==================== */

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0, 12).getDate();
}

export function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Découpe d'une valeur ISO — `null` si la date n'existe pas (31 février, mois 13…) */
export function isoParts(iso: string): { year: number; month: number; day: number } | null {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (year < 1 || month < 0 || month > 11) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidIso(iso: string): boolean {
  return isoParts(iso) !== null;
}

export function todayIso(now: Date = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Mois décalé de `delta`, année suivie (décembre + 1 = janvier de l'an prochain) */
export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Jour décalé de `delta` jours — `''` si l'entrée n'est pas une date */
export function shiftIsoDays(iso: string, delta: number): string {
  const p = isoParts(iso);
  if (!p) return '';
  // Midi et non minuit : aucun changement d'heure d'été ne peut faire basculer le quantième
  const d = new Date(p.year, p.month, p.day + delta, 12, 0, 0);
  return toIso(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Grille du mois : TOUJOURS 42 cases (6 semaines). Une hauteur constante évite
 * que le popover saute d'une ligne en changeant de mois — un calendrier qui
 * bouge sous le curseur fait tout de suite bricolage.
 */
export function monthGrid(year: number, month: number, weekStart: number): CalendarDay[] {
  const firstDow = new Date(year, month, 1, 12, 0, 0).getDay();
  const offset = (firstDow - weekStart + 7) % 7;
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - offset + i, 12, 0, 0);
    days.push({
      iso: toIso(d.getFullYear(), d.getMonth(), d.getDate()),
      day: d.getDate(),
      month: d.getMonth(),
      year: d.getFullYear(),
      inCurrentMonth: d.getMonth() === month && d.getFullYear() === year,
    });
  }
  return days;
}

/* ==================== Dates : rendu ==================== */

/** Noms des jours à partir du premier jour de la semaine de la locale */
export function weekdayLabels(
  locale: string,
  weekStart: number
): { short: string; long: string }[] {
  const shortFmt = dtf(locale, { weekday: 'short' });
  const longFmt = dtf(locale, { weekday: 'long' });
  const out: { short: string; long: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(
      REF_SUNDAY.getFullYear(),
      REF_SUNDAY.getMonth(),
      REF_SUNDAY.getDate() + ((weekStart + i) % 7),
      12,
      0,
      0
    );
    out.push({ short: shortFmt.format(d), long: longFmt.format(d) });
  }
  return out;
}

export function monthYearLabel(year: number, month: number, locale: string): string {
  return dtf(locale, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1, 12, 0, 0));
}

/** Rendu court d'une cellule : « 15 août 2026 » / « Aug 15, 2026 » */
export function formatDisplayDate(iso: string, locale: string): string {
  const p = isoParts(iso);
  if (!p) return '';
  return dtf(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(p.year, p.month, p.day, 12, 0, 0)
  );
}

/** Rendu complet, réservé aux lecteurs d'écran (chaque case du calendrier) */
export function formatFullDate(iso: string, locale: string): string {
  const p = isoParts(iso);
  if (!p) return '';
  return dtf(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(p.year, p.month, p.day, 12, 0, 0)
  );
}

/** Rendu numérique, celui que l'on RETAPE : « 15/08/2026 » / « 08/15/2026 » */
export function formatTypedDate(iso: string, locale: string): string {
  const p = isoParts(iso);
  if (!p) return '';
  return dtf(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(p.year, p.month, p.day, 12, 0, 0)
  );
}

/** Ordre des champs de la locale : fr → jour, mois, année ; en-US → mois, jour, année */
export function dateFieldOrder(locale: string): DateField[] {
  try {
    const parts = dtf(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(REF_DATE);
    const order = parts
      .map((p) => p.type)
      .filter((tpe): tpe is DateField => tpe === 'day' || tpe === 'month' || tpe === 'year');
    if (order.length === 3) return order;
  } catch {
    /* repli ci-dessous */
  }
  return ['month', 'day', 'year'];
}

/** Séparateur de la locale (« / », « . », « - »…) — sert au gabarit affiché */
export function dateFieldSeparator(locale: string): string {
  try {
    const parts = dtf(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(REF_DATE);
    const firstField = parts.findIndex((p) => p.type === 'day' || p.type === 'month');
    const sep = parts.slice(firstField + 1).find((p) => p.type === 'literal')?.value;
    const trimmed = (sep ?? '').trim();
    if (trimmed !== '') return trimmed;
  } catch {
    /* repli ci-dessous */
  }
  return '/';
}

/** Gabarit de saisie monté avec les abréviations TRADUITES : « JJ/MM/AAAA », « MM/DD/YYYY » */
export function localDatePattern(locale: string, labels: Record<DateField, string>): string {
  return dateFieldOrder(locale)
    .map((f) => labels[f])
    .join(dateFieldSeparator(locale));
}

/* ==================== Dates : analyse de la saisie ==================== */

function expandYear(value: number, digits: number): number {
  if (digits >= 3) return value;
  return value <= TWO_DIGIT_YEAR_PIVOT ? 2000 + value : 1900 + value;
}

function buildIso(year: number, month1: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
  if (!Number.isInteger(month1) || month1 < 1 || month1 > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month1 - 1)) return null;
  return toIso(year, month1 - 1, day);
}

/**
 * Date tapée au clavier → ISO, ou `null` quand rien de sûr n'en sort (on ne
 * devine JAMAIS une date approximative : une saisie non comprise laisse la
 * cellule intacte et le champ le signale).
 *
 * Accepté : l'ISO `2026-08-15` quel que soit la langue ; trois nombres dans
 * l'ordre de la langue (`15/08/2026`, `8.15.26`) ; deux nombres = jour et mois
 * de l'année en cours ; un nombre court = quantième du mois affiché ; une suite
 * de 6 ou 8 chiffres (`15082026`).
 */
export function parseLocalDate(
  input: string,
  locale: string,
  context: { year: number; month: number }
): string | null {
  const raw = input.trim();
  if (raw === '') return null;
  // L'ISO est accepté partout : c'est le format de stockage, on ne le trahit pas
  if (ISO_DATE_RE.test(raw)) return isValidIso(raw) ? raw : null;

  const groups = raw.match(/\d+/g);
  if (!groups || groups.length === 0 || groups.length > 3) return null;
  const order = dateFieldOrder(locale);
  const dayBeforeMonth = order.indexOf('day') < order.indexOf('month');

  if (groups.length === 3) {
    // Année en tête = ordre ISO même mal séparé (2026/8/15)
    if (groups[0].length === 4) {
      return buildIso(Number(groups[0]), Number(groups[1]), Number(groups[2]));
    }
    const year = expandYear(Number(groups[2]), groups[2].length);
    const a = Number(groups[0]);
    const b = Number(groups[1]);
    return dayBeforeMonth ? buildIso(year, b, a) : buildIso(year, a, b);
  }

  if (groups.length === 2) {
    // Sans année : celle du mois affiché, pas celle du calendrier grégorien courant
    const a = Number(groups[0]);
    const b = Number(groups[1]);
    return dayBeforeMonth ? buildIso(context.year, b, a) : buildIso(context.year, a, b);
  }

  const token = groups[0];
  if (token.length <= 2) {
    // Un quantième seul se lit dans le mois sous les yeux
    return buildIso(context.year, context.month + 1, Number(token));
  }
  if (token.length === 6 || token.length === 8) {
    const yearLen = token.length === 8 ? 4 : 2;
    let cursor = 0;
    const fields: Partial<Record<DateField, number>> = {};
    for (const field of order) {
      const width = field === 'year' ? yearLen : 2;
      const chunk = token.slice(cursor, cursor + width);
      cursor += width;
      fields[field] = field === 'year' ? expandYear(Number(chunk), width) : Number(chunk);
    }
    return buildIso(fields.year ?? 0, fields.month ?? 0, fields.day ?? 0);
  }
  return null;
}

/**
 * Ce qu'une saisie de date doit RÉELLEMENT produire.
 *
 * Exister séparément du composant a une raison précise : le champ commite au
 * blur, et ouvrir le popover puis cliquer une flèche de mois, « Aujourd'hui » ou
 * une case retire d'abord le focus du champ. Recommiter la même valeur à cet
 * instant coûterait une transaction ProseMirror, une entrée d'annulation, une
 * note marquée modifiée et une remontée nuage — pour un geste qui ne change
 * rien. Une valeur identique à celle de la cellule ne s'écrit donc pas.
 *
 * `clear` n'est rendu que si la cellule portait quelque chose : vider un champ
 * déjà vide n'est pas un effacement.
 */
export type DateCommit =
  | { action: 'none' }
  | { action: 'clear' }
  | { action: 'commit'; iso: string }
  /** Saisie non comprise : la cellule reste intacte, le champ le signale */
  | { action: 'invalid' };

export function resolveDateCommit(
  typed: string,
  current: string,
  locale: string,
  context: { year: number; month: number }
): DateCommit {
  const raw = typed.trim();
  const stored = isValidIso(current) ? current : '';
  if (raw === '') return stored === '' ? { action: 'none' } : { action: 'clear' };
  const iso = parseLocalDate(raw, locale, context);
  if (!iso) return { action: 'invalid' };
  return iso === stored ? { action: 'none' } : { action: 'commit', iso };
}

/* ==================== Nombres ==================== */

/** Séparateur décimal de la langue (« , » en français, « . » en anglais) */
export function decimalSeparator(locale: string): string {
  const part = nf(locale, {})
    .formatToParts(1.1)
    .find((p) => p.type === 'decimal');
  return part?.value ?? '.';
}

/** Rendu au repos d'une cellule nombre : groupes et décimale de la langue */
export function formatDecimal(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '';
  return nf(locale, { maximumFractionDigits: 10 }).format(value);
}

/**
 * Rendu SANS groupes, celui que l'on retape : la décimale reste celle de la
 * langue, mais les espaces des milliers gêneraient l'édition au clavier.
 */
export function formatDecimalPlain(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '';
  return nf(locale, { maximumFractionDigits: 10, useGrouping: false }).format(value);
}

/**
 * Nombre tapé au clavier → nombre, ou `null`. Comprend les deux séparateurs :
 * quand les deux sont là, le DERNIER est la décimale ; seul, il est décimal
 * s'il est celui de la langue, sinon un séparateur de milliers.
 * Espaces (y compris insécables et fines) ignorés : le rendu de `formatDecimal`
 * se retape donc tel quel.
 */
export function parseDecimal(input: string, locale: string): number | null {
  // Espaces (l'insécable et la fine insécable d'Intl comprises) et apostrophe
  // suisse retirés : le rendu de `formatDecimal` se retape donc tel quel
  const cleaned = input.replace(/\s/g, '').replace(/'/g, '');
  if (cleaned === '') return null;
  if (!/^[+-]?[\d.,]+$/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    const groupChar = decimalAt === lastDot ? ',' : '.';
    normalized =
      cleaned.slice(0, decimalAt).split(groupChar).join('') + '.' + cleaned.slice(decimalAt + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const char = lastDot >= 0 ? '.' : ',';
    const occurrences = cleaned.split(char).length - 1;
    const decimals = cleaned.length - cleaned.lastIndexOf(char) - 1;
    // Un séparateur unique, étranger à la langue et suivi d'exactement trois
    // chiffres, groupe les milliers (« 1,234 » en français) — sinon il décime
    const isDecimal = occurrences === 1 && (char === decimalSeparator(locale) || decimals !== 3);
    normalized = isDecimal ? cleaned.replace(char, '.') : cleaned.split(char).join('');
  } else {
    normalized = cleaned;
  }
  if (normalized === '' || normalized === '+' || normalized === '-') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
