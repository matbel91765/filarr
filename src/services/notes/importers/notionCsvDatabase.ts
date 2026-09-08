/**
 * Base de données Notion (CSV) → base de données inline Filarr.
 *
 * Une base est l'objet CENTRAL de Notion. L'export en range une par fichier
 * CSV — et jusqu'ici Filarr n'en tirait que des étiquettes : la table
 * elle-même, ses colonnes, ses types, ses lignes, tout partait à la poubelle.
 * Un utilisateur qui migrait perdait donc précisément ce pour quoi il utilisait
 * Notion.
 *
 * Ce module reconstruit une vraie base : schéma typé (le type de chaque
 * colonne est DEVINÉ à partir de ses valeurs), lignes, et une vue — kanban
 * quand une colonne de statut s'y prête, tableau sinon.
 *
 * Module PUR : aucun DOM, aucun identifiant aléatoire (voir `idFor`), donc
 * testable ligne à ligne.
 */

export interface CsvDatabase {
  /** Titre lisible, dérivé du nom de fichier. */
  title: string;
  /** Attributs du nœud `inlineDatabase`, prêts à poser dans un document. */
  attrs: Record<string, unknown>;
  rowCount: number;
  propertyCount: number;
}

type PropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'checkbox'
  | 'date'
  | 'url'
  | 'email'
  | 'phone'
  | 'person';

const OPTION_COLORS = ['blue', 'green', 'amber', 'purple', 'teal', 'pink', 'orange', 'gray'];

/**
 * Identifiants DÉTERMINISTES.
 *
 * Deux imports du même export doivent produire les mêmes octets : sinon, la
 * moindre reprise d'import ferait remonter chaque note comme modifiée. Ils
 * restent uniques par base grâce au préfixe, et l'identité de la base est de
 * toute façon re-frappée à la création de la note (`restampCopiedDbIds`).
 */
function idFor(prefix: string, kind: string, key: string | number): string {
  const safe = String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${prefix}-${kind}-${safe || 'x'}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** « March 5, 2026 », « 2026/03/05 », « 05/03/2026 »… */
const LOOSE_DATE = /^[A-Za-zÀ-ÿ]{3,9}\s+\d{1,2},\s*\d{4}$|^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/;

function toIsoDate(value: string): string | null {
  if (ISO_DATE.test(value)) return value;
  if (!LOOSE_DATE.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

const NUMBER = /^-?\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$/;
const CHECKBOX = new Set(['yes', 'no', 'true', 'false', 'oui', 'non', '✓', '✗']);
const TRUTHY = new Set(['yes', 'true', 'oui', '✓']);

function toNumber(value: string): number | null {
  if (!NUMBER.test(value)) return null;
  const parsed = Number(value.replace(/[ ,](?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Type d'une colonne, deviné sur ses valeurs NON VIDES.
 *
 * Le doute profite au texte : une colonne mal typée est bien pire qu'une
 * colonne en texte — elle affiche des cellules vides là où il y avait une
 * valeur, et l'utilisateur croit à une perte de données.
 */
export function inferType(values: string[]): PropertyType {
  const filled = values.filter((v) => v.trim() !== '');
  if (filled.length === 0) return 'text';

  if (filled.every((v) => CHECKBOX.has(v.toLowerCase()))) return 'checkbox';
  if (filled.every((v) => toNumber(v) !== null)) return 'number';
  if (filled.every((v) => toIsoDate(v) !== null)) return 'date';
  if (filled.every((v) => /^https?:\/\/\S+$/i.test(v))) return 'url';
  if (filled.every((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) return 'email';
  if (filled.every((v) => /^[+()\d][\d\s().-]{5,}$/.test(v))) return 'phone';

  // Notion separe les valeurs multiples par des virgules dans le CSV.
  const pieces = filled.flatMap((v) => v.split(',').map((p) => p.trim())).filter(Boolean);
  const distinctPieces = new Set(pieces);
  const shortLabels = pieces.every((p) => p.length <= 40);

  // La virgule EST le signal : une colonne multi-valeurs se reconnait a sa
  // forme, sans avoir besoin de voir une etiquette se repeter — ce qui est
  // impossible sur une table de trois lignes.
  if (
    shortLabels &&
    distinctPieces.size <= 24 &&
    distinctPieces.size >= 2 &&
    filled.some((v) => v.includes(','))
  ) {
    return 'multiSelect';
  }

  // Sans virgule, il FAUT une repetition : sinon une colonne de titres (toutes
  // valeurs uniques) deviendrait une liste de choix aussi longue que la table.
  const distinct = new Set(filled);
  if (shortLabels && distinct.size <= 24 && distinct.size < filled.length) return 'select';

  return 'text';
}

/** Valeur de cellule dans le format qu'attend la base, ou `undefined`. */
function cellValue(
  type: PropertyType,
  raw: string,
  optionIdOf: (label: string) => string | undefined
): unknown {
  const value = raw.trim();
  if (value === '') return undefined;

  switch (type) {
    case 'checkbox':
      return TRUTHY.has(value.toLowerCase());
    case 'number':
      return toNumber(value) ?? undefined;
    case 'date':
      return toIsoDate(value) ?? undefined;
    case 'select':
      return optionIdOf(value);
    case 'person':
      // Liste de noms, comme la colonne PERSONNE de Filarr (cf. people.ts).
      return value
        .split(',')
        .map((piece) => piece.trim())
        .filter((piece) => piece !== '');
    case 'multiSelect': {
      const ids = value
        .split(',')
        .map((piece) => optionIdOf(piece.trim()))
        .filter((id): id is string => typeof id === 'string');
      return ids.length > 0 ? ids : undefined;
    }
    default:
      return value;
  }
}

/**
 * En-tetes qui designent des PERSONNES.
 *
 * Notion exporte ce type comme du texte : « Ada Lovelace, Grace Hopper ». Rien
 * dans les VALEURS ne permet de le distinguer d'une colonne de texte ordinaire
 * — c'est l'en-tete qui porte l'information, et c'est donc lui qu'on lit.
 */
const PERSON_HEADERS = new Set([
  'person',
  'personne',
  'people',
  'assignee',
  'assigned',
  'owner',
  'responsable',
  'attribue a',
  'attribué à',
  'membre',
  'members',
  'participants',
  'created by',
  'cree par',
  'créé par',
]);

/** Une colonne de statut fait un bon kanban ; rien d'autre ne le fait. */
const STATUS_HEADERS = new Set([
  'status',
  'statut',
  'state',
  'étape',
  'etape',
  'stage',
  'phase',
  'kanban',
  'progress',
  'avancement',
]);

/**
 * Construit la base à partir des lignes CSV déjà découpées.
 *
 * Rend `null` quand il n'y a rien à construire (fichier vide, en-tête seul
 * sans colonne) : un bloc de base vide dans une note ne rend service à
 * personne.
 */
export function csvToDatabase(rows: string[][], title: string, prefix: string): CsvDatabase | null {
  if (rows.length < 2) return null;
  const headers = rows[0].map((h, index) => h.trim() || `Colonne ${index + 1}`);
  if (headers.length === 0) return null;

  const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (body.length === 0) return null;

  const columns = headers.map((_, index) => body.map((row) => row[index] ?? ''));
  const types = columns.map((values, index) => {
    const inferred = inferType(values);
    // L'en-tete prime sur les valeurs pour les colonnes de personnes : le
    // contenu, lui, ressemble a du texte ou a une liste de choix.
    const header = headers[index].toLowerCase().trim();
    if (
      PERSON_HEADERS.has(header) &&
      (inferred === 'text' || inferred === 'multiSelect' || inferred === 'select')
    ) {
      return 'person' as PropertyType;
    }
    return inferred;
  });

  const properties = headers.map((name, index) => {
    const type = types[index];
    const base: Record<string, unknown> = {
      id: idFor(prefix, 'p', `${index}-${name}`),
      name,
      type,
    };

    if (type === 'select' || type === 'multiSelect') {
      const labels: string[] = [];
      for (const value of columns[index]) {
        for (const piece of value.split(',')) {
          const label = piece.trim();
          if (label && !labels.includes(label)) labels.push(label);
        }
      }
      base.options = labels.map((label, optionIndex) => ({
        id: idFor(prefix, `o${index}`, label),
        label,
        color: OPTION_COLORS[optionIndex % OPTION_COLORS.length],
      }));
    }

    return base;
  });

  const optionIdOf = (index: number) => (label: string) => {
    const options = properties[index].options as { id: string; label: string }[] | undefined;
    return options?.find((option) => option.label === label)?.id;
  };

  const dbRows = body.map((row, rowIndex) => {
    const cells: Record<string, unknown> = {};
    headers.forEach((_, index) => {
      const value = cellValue(types[index], row[index] ?? '', optionIdOf(index));
      if (value !== undefined) cells[properties[index].id as string] = value;
    });
    return { id: idFor(prefix, 'r', rowIndex + 1), cells };
  });

  // Kanban si une colonne de statut existe ET reste lisible (au-dela d'une
  // dizaine de colonnes, un tableau se lit mieux qu'un mur de colonnes).
  const statusIndex = headers.findIndex(
    (name, index) =>
      types[index] === 'select' &&
      STATUS_HEADERS.has(name.toLowerCase()) &&
      ((properties[index].options as unknown[]) ?? []).length <= 10
  );
  const isBoard = statusIndex >= 0;
  const groupBy = isBoard ? (properties[statusIndex].id as string) : '';

  const viewId = idFor(prefix, 'v', '1');
  const data = {
    properties,
    rows: dbRows,
    views: [
      {
        id: viewId,
        name: title,
        type: isBoard ? 'board' : 'table',
        filters: [],
        sorts: [],
        ...(groupBy ? { groupBy } : {}),
      },
    ],
    activeViewId: viewId,
  };

  return {
    title,
    attrs: {
      title,
      view: isBoard ? 'board' : 'table',
      groupBy,
      source: '',
      dbId: `db@v:${viewId}`,
      data: JSON.stringify(data),
    },
    rowCount: dbRows.length,
    propertyCount: properties.length,
  };
}
