/**
 * Connecteurs de bases inline — CORRESPONDANCE RÉSULTAT → COLONNES.
 *
 * C'est le cœur de l'intuitivité : l'utilisateur a fabriqué SES colonnes, avec
 * ses noms et ses types, et s'attend à ce qu'un résultat aille « au bon
 * endroit » sans rien configurer.
 *
 * DEUX PASSES, le NOM d'abord :
 *  1. NOM — « Affiche », « Année de sortie », « ÉVALUATION »… comparés sans
 *     casse ni accents à une liste de synonymes FR/EN, en retenant le synonyme
 *     LE PLUS SPÉCIFIQUE (le plus long) tous champs confondus : « Nom de
 *     l'auteur » va à l'auteur, pas au titre, parce que `auteur` bat `nom`.
 *     Une colonne nommée l'emporte TOUJOURS sur son type : deux colonnes `url`
 *     nommées « Affiche » puis « Lien » reçoivent image puis fiche, quel que
 *     soit leur ordre. Une colonne dont le nom désigne un champ ne reçoit
 *     jamais rien d'autre, même si ce champ est déjà servi (« Titre » ne
 *     récolte pas le résumé).
 *  2. TYPE — pour ce qui reste : rating→note, url→fiche puis image, date→année,
 *     number→épisodes/pages, multiSelect→genres, text→titre, sous-titre, résumé
 *     (dans l'ordre des colonnes).
 *
 * DEUX RÈGLES DURES :
 *  - on ne REMPLIT QUE LES CELLULES VIDES, jamais d'écrasement ;
 *  - une colonne déjà remplie CONSOMME quand même son champ : si « Titre » est
 *    saisi, le titre ne va pas déborder dans la colonne texte suivante.
 *
 * Fonctions PURES : rien n'est écrit ici. L'appelant commite `cells` et
 * `newOptions` dans un seul changement (voir `mergeNewOptions`).
 */

import { CONNECTOR_MAX_QUERY_LENGTH } from '../../../../../../platform/connectors/connectorSources';
import type { DbProperty, DbSelectOption, PropertyType } from '../types';
import { DB_OPTION_COLORS, newId } from '../types';
import type { ConnectorResult } from './connectorResult';
import { asIsoDate, cleanGenres, foldLabel } from './connectorResult';

/** Champs d'un résultat susceptibles d'atterrir dans une colonne. */
export type ConnectorField =
  | 'title'
  | 'subtitle'
  | 'year'
  | 'rating'
  | 'genres'
  | 'count'
  | 'imageUrl'
  | 'url'
  | 'description';

export interface ConnectorCellUpdates {
  /** property id → valeur à écrire. Ne contient QUE des cellules vides. */
  cells: Record<string, unknown>;
  /** property id → options select/multiSelect à AJOUTER (genres inconnus). */
  newOptions: Record<string, DbSelectOption[]>;
  /** Champs réellement écrits (passe des noms d'abord, puis celle des types). */
  filled: ConnectorField[];
  /**
   * Champs qu'une colonne aurait pris, mais dont la cellule était DÉJÀ remplie.
   * Sert à distinguer « tout est déjà rempli » (il y avait de la place, elle
   * était prise) de « aucune colonne ne peut accueillir » (il n'y en avait pas)
   * — deux situations qui appellent deux messages différents.
   */
  skipped: ConnectorField[];
}

/**
 * Ordre de départage quand DEUX synonymes de MÊME longueur matchent un nom.
 * La spécificité prime : c'est le synonyme le plus long qui gagne d'abord.
 */
const FIELD_ORDER: ConnectorField[] = [
  'title',
  'year',
  'rating',
  'genres',
  'count',
  'imageUrl',
  'url',
  'subtitle',
  'description',
];

/**
 * Synonymes FR/EN, écrits SANS accents ni casse : ils sont comparés à des noms
 * de colonnes passés par `foldLabel` (« Évaluation » → `evaluation`).
 * Prudence volontaire : « statut », « note » au sens de note liée, « avancement »
 * n'y figurent pas — mieux vaut ne rien remplir que remplir de travers.
 */
const SYNONYMS: Record<ConnectorField, string[]> = {
  title: ['titre', 'title', 'nom', 'name', 'intitule', 'oeuvre'],
  subtitle: [
    'auteur',
    'auteurs',
    'author',
    'authors',
    'ecrivain',
    'artiste',
    'studio',
    'chaine',
    'network',
    'diffuseur',
    'editeur',
    'publisher',
    'titre original',
    'original title',
    'sous titre',
    'subtitle',
  ],
  year: [
    'annee',
    'annees',
    'year',
    'date',
    'sortie',
    'parution',
    'publication',
    'release',
    'released',
    'published',
    'premiere',
  ],
  rating: ['note', 'notes', 'rating', 'score', 'evaluation', 'etoiles', 'stars', 'appreciation'],
  genres: [
    'genre',
    'genres',
    'tag',
    'tags',
    'categorie',
    'categories',
    'category',
    'theme',
    'themes',
  ],
  count: ['episode', 'episodes', 'page', 'pages', 'nombre', 'nb', 'count', 'number', 'chapitres'],
  imageUrl: [
    'image',
    'affiche',
    'couverture',
    'cover',
    'poster',
    'jaquette',
    'vignette',
    'thumbnail',
    'illustration',
    'visuel',
    'photo',
  ],
  url: ['lien', 'liens', 'url', 'link', 'fiche', 'site', 'adresse', 'source'],
  description: [
    'resume',
    'synopsis',
    'description',
    'summary',
    'overview',
    'apercu',
    'presentation',
    'intrigue',
  ],
};

/**
 * Champs qu'un TYPE accepte, dans l'ordre où il les prend (2e passe).
 * Les types absents (select, checkbox, email, phone, progress, note,
 * createdTime, updatedTime) ne sont JAMAIS touchés sans un nom qui les désigne.
 */
const TYPE_FIELDS: Partial<Record<PropertyType, ConnectorField[]>> = {
  text: ['title', 'subtitle', 'description'],
  rating: ['rating'],
  url: ['url', 'imageUrl'],
  date: ['year'],
  number: ['count'],
  multiSelect: ['genres'],
};

/**
 * Cellule considérée vide — donc remplissable. Subtilité : pour une colonne
 * Évaluation, 0 SIGNIFIE « pas de note » (aucune étoile), donc 0 est vide ;
 * pour une colonne nombre, 0 est une vraie valeur qu'on n'écrase pas.
 */
export function isCellEmpty(value: unknown, type: PropertyType): boolean {
  if (value === undefined || value === null) return true;
  if (type === 'rating') {
    return !(typeof value === 'number' && Number.isFinite(value) && value >= 1);
  }
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return !Number.isFinite(value);
  return false;
}

/**
 * Nom de colonne → champ, ou `null`.
 *
 * Le match retenu est le synonyme LE PLUS SPÉCIFIQUE, tous champs confondus :
 * le plus long l'emporte, quel que soit l'ordre des champs. Sans cela, un nom
 * composé partirait au premier champ qui touche l'un de ses mots — « Nom de
 * l'auteur » au titre (à cause de `nom`), « Titre original du film » au titre
 * plutôt qu'au sous-titre. À longueur égale seulement, `FIELD_ORDER` départage.
 *
 * Un synonyme d'un seul mot doit matcher un MOT ENTIER du nom ; un synonyme
 * composé (« titre original ») se cherche comme sous-chaîne. Une égalité
 * parfaite est de fait le match le plus long possible, donc toujours gagnante.
 */
export function matchFieldByName(name: string): ConnectorField | null {
  const folded = foldLabel(typeof name === 'string' ? name : '');
  if (folded === '') return null;
  const words = folded.split(' ');

  let best: ConnectorField | null = null;
  let bestLength = 0;
  for (const field of FIELD_ORDER) {
    for (const syn of SYNONYMS[field]) {
      // `<=` : à longueur égale, le champ vu en premier dans FIELD_ORDER garde la main
      if (syn.length <= bestLength) continue;
      const hit = syn.includes(' ') ? folded.includes(syn) : words.includes(syn);
      if (hit) {
        best = field;
        bestLength = syn.length;
      }
    }
  }
  return best;
}

/**
 * Requête à envoyer au connecteur pour une ligne : la colonne dont le NOM
 * désigne le titre d'abord, la première colonne texte non vide seulement à
 * défaut. Sans cette priorité, une colonne « Remarques » placée avant le titre
 * enverrait des notes personnelles à l'API amont — pas ce que l'on cherche, et
 * pas ce que l'utilisateur croit envoyer.
 */
export function rowSearchQuery(
  properties: DbProperty[],
  cells: Record<string, unknown> = {}
): string {
  if (!Array.isArray(properties)) return '';
  const source = cells && typeof cells === 'object' ? cells : {};
  const read = (prop: DbProperty): string => {
    const v = source[prop.id];
    return typeof v === 'string' ? v.trim().slice(0, CONNECTOR_MAX_QUERY_LENGTH) : '';
  };

  let fallback = '';
  for (const prop of properties) {
    if (!prop || typeof prop.id !== 'string' || prop.type !== 'text') continue;
    const text = read(prop);
    if (text === '') continue;
    if (matchFieldByName(prop.name) === 'title') return text;
    if (fallback === '') fallback = text;
  }
  return fallback;
}

interface Produced {
  value: unknown;
  /** Options à créer si — et seulement si — la valeur est réellement écrite. */
  options?: DbSelectOption[];
}

/** Identifiant d'option neuf, garanti distinct de ceux déjà en place. */
function freshOptionId(used: Set<string>): string {
  let id = newId();
  let attempt = 0;
  while (used.has(id)) {
    attempt += 1;
    id = `${newId()}-${attempt}`;
  }
  used.add(id);
  return id;
}

/**
 * Plafond d'options d'UNE colonne. Les `subject` d'OpenLibrary sont du
 * catalogage et non des genres : même filtrés, ils en produisent quelques-uns
 * de neufs par ligne, et une table de cent livres transformerait la colonne
 * Genres en liste illisible. Au-delà du plafond, on réutilise ce qui existe et
 * on n'invente plus rien — la cellule reste juste, la colonne reste lisible.
 */
export const MAX_PROPERTY_OPTIONS = 40;

/**
 * Genres → identifiants d'options : réutilise l'existant (comparaison sans
 * casse ni accents, « Sci-Fi » ≡ « sci fi ») et CRÉE le reste dans la limite du
 * plafond, en tournant dans la palette à partir du nombre d'options présentes.
 */
function resolveGenreOptions(
  prop: DbProperty,
  labels: string[]
): { ids: string[]; created: DbSelectOption[] } {
  const existing = prop.options ?? [];
  const used = new Set(existing.map((o) => o.id));
  const byLabel = new Map<string, string>();
  for (const option of existing) byLabel.set(foldLabel(option.label), option.id);

  const ids: string[] = [];
  const created: DbSelectOption[] = [];
  let colorIndex = existing.length;
  let budget = Math.max(0, MAX_PROPERTY_OPTIONS - existing.length);

  for (const label of labels) {
    const key = foldLabel(label);
    if (key === '') continue;
    let id = byLabel.get(key);
    if (id === undefined) {
      // Plafond atteint : le genre est simplement ignoré, jamais inventé
      if (budget === 0) continue;
      budget -= 1;
      id = freshOptionId(used);
      created.push({
        id,
        label,
        color: DB_OPTION_COLORS[colorIndex % DB_OPTION_COLORS.length].id,
      });
      colorIndex += 1;
      byLabel.set(key, id);
    }
    if (!ids.includes(id)) ids.push(id);
  }

  return { ids, created };
}

/** Date complète attendue par une cellule date : celle de l'amont, sinon le 1er janvier. */
function isoDateFor(result: ConnectorResult, year: number): string {
  const exact = asIsoDate(result.extra?.releaseDate);
  if (exact !== undefined && exact.startsWith(String(year))) return exact;
  return `${String(year).padStart(4, '0')}-01-01`;
}

/**
 * Valeur qu'un champ prend DANS une colonne donnée, ou `null` si le champ n'a
 * pas de valeur ou si le type de la colonne ne sait pas l'accueillir.
 */
function produceValue(
  field: ConnectorField,
  result: ConnectorResult,
  prop: DbProperty
): Produced | null {
  const type = prop.type;

  switch (field) {
    case 'title':
    case 'subtitle':
    case 'description': {
      const raw =
        field === 'title'
          ? result.title
          : field === 'subtitle'
            ? result.subtitle
            : result.description;
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (text === '') return null;
      return type === 'text' ? { value: text } : null;
    }

    case 'year': {
      const year = result.year;
      if (typeof year !== 'number' || !Number.isFinite(year)) return null;
      if (type === 'date') return { value: isoDateFor(result, Math.trunc(year)) };
      if (type === 'number') return { value: Math.trunc(year) };
      if (type === 'text') return { value: String(Math.trunc(year)) };
      return null;
    }

    case 'rating': {
      const rating = result.rating;
      if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0) return null;
      const stars = Math.min(5, Math.max(1, Math.round(rating)));
      if (type === 'rating' || type === 'number') return { value: stars };
      // Une colonne « Note » en barre de progression : 4 étoiles → 80 %
      if (type === 'progress') return { value: stars * 20 };
      return null;
    }

    case 'count': {
      const count = result.count;
      if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
      if (type === 'number') return { value: Math.trunc(count) };
      if (type === 'text') return { value: String(Math.trunc(count)) };
      return null;
    }

    case 'imageUrl':
    case 'url': {
      const raw = field === 'url' ? result.url : result.imageUrl;
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (value === '' || !/^https?:\/\//i.test(value)) return null;
      return type === 'url' || type === 'text' ? { value } : null;
    }

    case 'genres': {
      const genres = cleanGenres(result.genres);
      if (!genres) return null;
      if (type === 'multiSelect') {
        const { ids, created } = resolveGenreOptions(prop, genres);
        return ids.length > 0 ? { value: ids, options: created } : null;
      }
      if (type === 'select') {
        // Une colonne à choix unique ne prend que le genre principal
        const { ids, created } = resolveGenreOptions(prop, genres.slice(0, 1));
        return ids.length > 0 ? { value: ids[0], options: created } : null;
      }
      if (type === 'text') return { value: genres.join(', ') };
      return null;
    }

    default:
      return null;
  }
}

/**
 * Cellules à écrire pour un résultat, sur une ligne existante.
 *
 * @param existingCells cellules ACTUELLES de la ligne — seules les vides sont
 *        remplies, et une cellule déjà remplie consomme quand même son champ.
 */
export function buildCellUpdates(
  result: ConnectorResult,
  properties: DbProperty[],
  existingCells: Record<string, unknown> = {}
): ConnectorCellUpdates {
  const updates: ConnectorCellUpdates = { cells: {}, newOptions: {}, filled: [], skipped: [] };
  if (!result || typeof result !== 'object' || !Array.isArray(properties)) return updates;
  const cells = existingCells && typeof existingCells === 'object' ? existingCells : {};

  const takenFields = new Set<ConnectorField>();
  const claimedProps = new Set<string>();

  const place = (prop: DbProperty, field: ConnectorField): boolean => {
    if (takenFields.has(field)) return false;
    const produced = produceValue(field, result, prop);
    if (produced === null) return false;

    takenFields.add(field);
    claimedProps.add(prop.id);
    // Colonne déjà remplie : le champ est servi, on n'écrase RIEN
    if (!isCellEmpty(cells[prop.id], prop.type)) {
      updates.skipped.push(field);
      return true;
    }

    updates.cells[prop.id] = produced.value;
    if (produced.options && produced.options.length > 0) {
      updates.newOptions[prop.id] = produced.options;
    }
    updates.filled.push(field);
    return true;
  };

  // 1re passe — le nom décide, et verrouille la colonne quoi qu'il arrive
  for (const prop of properties) {
    if (!prop || typeof prop.id !== 'string') continue;
    const field = matchFieldByName(prop.name);
    if (field === null) continue;
    claimedProps.add(prop.id);
    place(prop, field);
  }

  // 2e passe — le type ramasse ce qui reste, dans l'ordre des colonnes
  for (const prop of properties) {
    if (!prop || typeof prop.id !== 'string' || claimedProps.has(prop.id)) continue;
    for (const field of TYPE_FIELDS[prop.type] ?? []) {
      if (place(prop, field)) break;
    }
  }

  return updates;
}

/** Y a-t-il quelque chose à commiter ? */
export function hasCellUpdates(updates: ConnectorCellUpdates): boolean {
  return updates.filled.length > 0;
}

/**
 * Schéma enrichi des options créées — à commiter DANS LE MÊME changement que
 * les cellules, sans quoi les genres pointeraient sur des options fantômes.
 */
export function mergeNewOptions(
  properties: DbProperty[],
  newOptions: Record<string, DbSelectOption[]>
): DbProperty[] {
  if (Object.keys(newOptions).length === 0) return properties;
  return properties.map((prop) => {
    const added = newOptions[prop.id];
    if (!added || added.length === 0) return prop;
    return { ...prop, options: [...(prop.options ?? []), ...added] };
  });
}
