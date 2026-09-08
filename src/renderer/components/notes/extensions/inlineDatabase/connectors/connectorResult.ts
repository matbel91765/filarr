/**
 * Connecteurs de bases inline — RÉSULTAT NORMALISÉ commun aux quatre sources.
 *
 * Les quatre amonts (OpenLibrary, AniList, TVMaze, TMDB) rendent des formes
 * totalement différentes. Tout ce qui suit les ramène à UNE seule forme, que la
 * correspondance vers les colonnes (`cellMapping`) consomme sans jamais savoir
 * d'où vient le résultat.
 *
 * DEUX RÈGLES NON NÉGOCIABLES, tenues par les helpers de ce fichier :
 *  1. TOLÉRANCE — une réponse inattendue rend `[]`, jamais une exception : les
 *     réponses amont sont des données étrangères, pas un contrat.
 *  2. AUCUN HTML — TVMaze (`summary`) et AniList (`description`) renvoient du
 *     balisage ; `stripHtml` rend du texte nu, et les URLs ne survivent que si
 *     elles sont http(s) (rien qui puisse devenir un `href` exécutable).
 */

/** Résultat d'une recherche, identique quelle que soit la source. */
export interface ConnectorResult {
  /** `source:idAmont` — stable, sert de clé de liste */
  id: string;
  title: string;
  /** Auteurs, titre original, chaîne… selon la source */
  subtitle?: string;
  year?: number;
  imageUrl?: string;
  /** Fiche publique amont */
  url?: string;
  description?: string;
  /** 0-5. ABSENT quand la source ne donne pas de note (0 = « pas de note ») */
  rating?: number;
  genres?: string[];
  /** Épisodes (séries/anime) ou pages (livres) */
  count?: number;
  /** Miettes propres à la source (`releaseDate`, `status`, `genreIds`…) */
  extra?: Record<string, unknown>;
}

/** Les quatre sources bornent déjà à 5 amont ; on reborne ici par sécurité. */
export const MAX_CONNECTOR_RESULTS = 5;

/** Un résumé remplit une cellule de tableau, pas une page : on écrête. */
export const MAX_DESCRIPTION_LENGTH = 800;

/** Les sujets OpenLibrary se comptent en centaines : on garde les premiers. */
export const MAX_GENRES = 6;

/** Au-delà, ce n'est plus un genre mais une phrase (sujets OpenLibrary). */
const MAX_GENRE_LENGTH = 40;

// ==================== Lecture douce du JSON amont ====================

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Chaîne non vide, écrêtée — sinon `undefined` (jamais `''` dans un résultat). */
export function asText(value: unknown, max = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return undefined;
  return clampText(trimmed, max);
}

export function asPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

/** Année plausible uniquement : un `first_publish_year` fantaisiste ne passe pas. */
export function asYear(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const year = Math.trunc(n);
  return year >= 1000 && year <= 3000 ? year : undefined;
}

/** `1993-09-10` → 1993 (TVMaze `premiered`, TMDB `release_date`). */
export function yearFromDate(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(value.trim());
  return m ? asYear(m[1]) : undefined;
}

/** Date complète `YYYY-MM-DD` seule acceptée par les cellules de type date. */
export function asIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * URL amont retenue seulement si http(s) : ces valeurs finissent dans des
 * cellules `url` rendues en `href`/`src`. Rien d'autre n'entre.
 */
export function asHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 2000) return undefined;
  return /^https?:\/\/[^\s<>"']+$/i.test(trimmed) ? trimmed : undefined;
}

export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Note amont → 0-5 entier. `undefined` quand la source n'a PAS de note ; une
 * note existante ne retombe jamais à 0, car 0 veut dire « pas de note » dans
 * nos colonnes Évaluation (une note de 0,4/10 vaut donc 1 étoile).
 */
export function toRating5(value: unknown, scaleMax: number): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0 || scaleMax <= 0) return undefined;
  const scaled = Math.round((n / scaleMax) * 5);
  return Math.min(5, Math.max(1, scaled));
}

/** Genres propres : sans doublon (casse et accents ignorés), bornés. */
export function cleanGenres(value: unknown): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of asArray(value)) {
    if (typeof item !== 'string') continue;
    const label = item.trim().replace(/\s+/g, ' ');
    if (label === '' || label.length > MAX_GENRE_LENGTH) continue;
    const key = foldLabel(label);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_GENRES) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Clé de comparaison des libellés : sans casse ni accents ni ponctuation. */
export function foldLabel(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ==================== Dé-balisage ====================

const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * HTML amont → texte nu, sur une seule ligne (une cellule n'a pas de
 * paragraphes). Deux passes de dé-balisage : la seconde attrape ce qu'une
 * entité cachait (`&lt;script&gt;`), pour que la sortie ne contienne JAMAIS de
 * balise, même si l'amont a tenté de la faire passer encodée.
 */
export function stripHtml(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  let text = value.replace(SCRIPT_STYLE_RE, ' ').replace(COMMENT_RE, ' ').replace(TAG_RE, ' ');
  text = decodeEntities(text).replace(TAG_RE, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** Résumé prêt pour une cellule : dé-balisé, écrêté, `undefined` si vide. */
export function toDescription(value: unknown): string | undefined {
  const text = stripHtml(value);
  return text === '' ? undefined : clampText(text, MAX_DESCRIPTION_LENGTH);
}
