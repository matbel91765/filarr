/**
 * DatabaseTableView — Filarr Notes
 *
 * Vue table éditable du bloc base de données : une colonne par propriété,
 * cellules typées (état local pendant l'édition, commit au blur/valider),
 * popovers ancrés dans le bloc (éditeur de propriété, dropdown select).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import { Checkbox } from '../../../ui/Checkbox';
import type { RootState } from '../../../../../store';
import { setEditingNote, updateNoteContent } from '../../../../../store/slices/notesSlice';
import {
  heldNoteIds,
  subscribeNoteEditors,
} from '../../../../../services/notes/noteEditorRegistry';
import { useNoteOpener } from '../../../../../contexts/NoteOpenerContext';
import type {
  DatabaseViewProps,
  DbProperty,
  DbRow,
  DbView,
  InlineDbData,
  PropertyType,
} from './types';
import {
  clampColumnWidth,
  CONNECTOR_SOURCE_LABELS,
  DB_COL_MAX_WIDTH,
  DB_COL_MIN_WIDTH,
  connectorLang,
  formatDbTimestamp,
  getTmdbApiKey,
  newId,
  newRow,
  optionColorValue,
  propertyTypeLabel,
  relationIds,
  TMDB_API_KEY_URL,
  touchRow,
} from './types';
import {
  activeViewOf,
  opsForType,
  orderedVisibleProperties,
  togglePropertyVisibility,
} from './viewEngine';
import {
  calculationsForType,
  computeColumnCalculation,
  formatCalculation,
} from './columnCalculations';
import type { DbCalculation } from './columnCalculations';
import { RowPanel } from './RowPanel';
import { evaluateFormula, formatFormulaValue } from './formulaEngine';
import { initialsOf, peopleOf, personColorIndex, writePeople } from './people';
import { buildRowTree, removeRowKeepingChildren, withParent } from './rowTree';
import type { DropPlace } from './tableErgonomics';
import {
  columnWidthOf,
  columnWidthsEqual,
  fitColumnWidth,
  moveRowByOffset,
  reorderRows,
  resolveGridMove,
  withColumnWidth,
} from './tableErgonomics';
import type { DbEnv } from './relations';
import {
  computeRollup,
  countMultiLinkRows,
  formatRollupResult,
  resolveRelation,
  rowDisplayText,
  rowTitleOf,
  secondaryPropertiesOf,
  titlePropertyOf,
  trimToSingleLinks,
} from './relations';
import { appendPropertyToNoteContent, appendRowToNoteContent } from './dbIndex';
import { PropertyEditor } from './PropertyEditor';
import { ColumnMenu } from './ColumnMenu';
import { svgProps, typeIcon } from './typeIcons';
import { DateCellPicker } from './DateCellPicker';
import {
  formatDecimal,
  formatDecimalPlain,
  formatDisplayDate,
  parseDecimal,
  resolveLocale,
} from './cellFormats';
import { isWebPlatform } from '../../../../../services/platform/isWebPlatform';
// Bundlé partout (localStorage + fetch standard, aucun import web-only) — inerte sur desktop
import {
  isConnectorProxyOptedIn,
  isMetaProxyOptedIn,
  setConnectorProxyOptIn,
  setMetaProxyOptIn,
} from '../../../../../platform/web/handlers/metaHandlers';
import {
  buildConnectorRequest,
  CONNECTOR_SOURCES,
  isSelectableConnectorSourceId,
} from '../../../../../platform/connectors/connectorSources';
import type { ConnectorResult, MovieGenreNames } from './connectors';
import {
  buildCellUpdates,
  hasCellUpdates,
  MAX_CONNECTOR_RESULTS,
  mergeNewOptions,
  normalize,
  normalizeMovieGenres,
  rowSearchQuery,
} from './connectors';

/**
 * Lignes rendues d'emblee.
 *
 * Chaque ligne monte une cellule React par colonne, avec ses editeurs et ses
 * popovers : une base de deux mille lignes en montait deux mille d'un coup, et
 * la note entiere se figeait a l'ouverture. Le rendu progressif est le seul
 * levier qui ne change RIEN au modele de donnees — les lignes non rendues sont
 * toujours la, comptees, filtrees, exportees.
 */
const INITIAL_ROW_RENDER = 100;

/** Doit suivre `.inline-db__colmenu` : la position se calcule sur cette
 *  largeur, une divergence collerait le menu au bord de la fenetre. */
const EDITOR_WIDTH = 268;
const DROPDOWN_WIDTH = 220;
const NOTE_PICKER_WIDTH = 240;
const REL_PICKER_WIDTH = 260;
/* Hauteurs estimées pour retourner le popover au-dessus de l'ancre si débord bas */
const EDITOR_EST_HEIGHT = 360;
const DROPDOWN_EST_HEIGHT = 300;
const NOTE_PICKER_EST_HEIGHT = 300;
/* En-tête (base + note), recherche, lignes à deux étages, création : le
   sélecteur de relations est le plus haut des popovers de cellule */
const REL_PICKER_EST_HEIGHT = 380;
/** Lignes proposées d'un coup par le sélecteur de relation (la recherche fait le reste) */
const MAX_RELATION_RESULTS = 30;
const META_CONFIRM_WIDTH = 260;
const META_CONFIRM_EST_HEIGHT = 150;
const CONNECTOR_WIDTH = 280;
const CONNECTOR_EST_HEIGHT = 300;
const DATE_PICKER_WIDTH = 248;
const DATE_PICKER_EST_HEIGHT = 340;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE_RESULTS = 8;

/**
 * MIME du réordonnancement de lignes. Type MAISON, et distinct de celui du
 * board : le handler de drop natif de ProseMirror ignore ce qu'il ne connaît
 * pas, là où un `text/plain` serait recollé comme du texte dans la note.
 */
const DB_ROW_ORDER_MIME = 'application/x-filarr-db-row-order';
/** Colonnes de service : poignée de ligne à gauche, actions à droite (miroir du CSS) */
const GRIP_COL_WIDTH = 30;
const ACTIONS_COL_WIDTH = 44;
/** Délai en deçà duquel deux appuis sur la poignée valent un double-clic */
const DOUBLE_PRESS_MS = 350;
/** Pas du réglage de largeur au clavier (Maj = pas large) */
const RESIZE_STEP = 16;
const RESIZE_STEP_LARGE = 64;
/** Rembourrage à ajouter au texte mesuré lors d'un réajustement au contenu */
const CELL_FIT_PADDING = 24;
const HEADER_FIT_PADDING = 56;

/** Échappement d'un identifiant dans un sélecteur CSS (repli : les ids maison n'ont rien d'exotique) */
function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
}

/**
 * Texte AFFICHÉ par une cellule, tel qu'un réajustement doit le mesurer : la
 * valeur des champs de saisie (qui n'ont aucune largeur de texte propre dans le
 * DOM), sinon le texte de la cellule.
 */
function cellDisplayText(cell: HTMLElement): string {
  // En-tête : seul le NOM compte (le type ajouté pour les lecteurs d'écran
  // n'est pas à l'écran, et le mesurer élargirait la colonne pour rien)
  const colName = cell.querySelector('.inline-db__col-name');
  if (colName) return (colName.textContent ?? '').trim();
  const inputs = cell.querySelectorAll<HTMLInputElement>('input');
  if (inputs.length > 0) {
    return Array.from(inputs)
      .map((i) => (i.type === 'checkbox' ? '' : i.value))
      .filter((v) => v !== '')
      .join(' ');
  }
  return (cell.textContent ?? '').trim();
}

/**
 * Entrée en édition d'une cellule : le premier contrôle qu'elle porte prend le
 * focus, curseur en fin de saisie. Une cellule sans contrôle (agrégat, date de
 * création) n'a rien à éditer et garde le focus.
 */
function enterCell(cell: HTMLElement): void {
  // Une cellule peut porter plusieurs contrôles sans que le premier du DOM soit
  // celui qui l'ÉDITE : une cellule relation commence par ses pastilles, qui
  // ouvrent la note d'en face. Le contrôle qui ouvre un popover (`data-db-anchor`)
  // a donc la priorité — c'est ce que « entrer dans la cellule » veut dire.
  const target =
    cell.querySelector<HTMLElement>('[data-db-anchor]:not([disabled])') ??
    cell.querySelector<HTMLElement>(
      'input:not([disabled]), textarea, select, button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
  if (!target) return;
  target.focus();
  if (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number')) {
    try {
      const end = target.value.length;
      target.setSelectionRange(end, end);
    } catch {
      /* type de champ sans sélection (nombre sur certains moteurs) : le focus suffit */
    }
  }
}

/**
 * Table des genres TMDB (identifiants → noms) : un seul aller-retour par langue
 * et par session, partagé par tous les blocs. Sans elle, TMDB ne rend que des
 * numéros de genre — et on n'affiche jamais un numéro comme un genre.
 */
let movieGenresCache: { lang: string; table: MovieGenreNames } | null = null;

async function loadMovieGenres(apiKey: string, lang: string): Promise<MovieGenreNames | undefined> {
  if (movieGenresCache && movieGenresCache.lang === lang) return movieGenresCache.table;
  try {
    // Source auxiliaire de la liste blanche : requête vide admise
    const raw = await window.electron?.ipcRenderer?.invoke('connectors:lookup', {
      source: 'movieGenres',
      query: '',
      apiKey,
      lang,
    });
    if (raw === null || raw === undefined) return undefined;
    const table = normalizeMovieGenres(raw);
    if (Object.keys(table).length === 0) return undefined;
    movieGenresCache = { lang, table };
    return table;
  } catch {
    // Échec sans conséquence : la recherche continue, simplement sans genres
    return undefined;
  }
}

/* ---- Lecture douce : valeur d'un type inattendu → affichage vide, stockage intact ---- */
function strValue(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function numValue(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function dateValue(v: unknown): string {
  return typeof v === 'string' && DATE_RE.test(v) ? v : '';
}
function selectedIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function ratingValue(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5 ? v : 0;
}
function progressValue(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
}

/** Première propriété url non vide de la ligne — source du bouton ⚡ compléter */
function firstUrlCell(
  properties: DbProperty[],
  row: DbRow
): { propId: string; url: string } | null {
  for (const p of properties) {
    if (p.type !== 'url') continue;
    const v = row.cells[p.id];
    if (typeof v === 'string' && v.trim() !== '') return { propId: p.id, url: v.trim() };
  }
  return null;
}

/**
 * Lien réellement ouvrable d'une cellule url. Le schéma est VÉRIFIÉ : une
 * valeur `javascript:` ou `file:` ne devient jamais un lien cliquable, et une
 * saisie sans schéma n'est complétée en https que si elle ressemble à un
 * domaine. La valeur stockée, elle, n'est jamais réécrite.
 */
function externalHref(raw: string): string | null {
  const v = raw.trim();
  if (v === '' || /\s/.test(v)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(v);
  if (!hasScheme && !/^[\w-]+(\.[\w-]+)+/.test(v)) return null;
  try {
    const u = new URL(hasScheme ? v : `https://${v}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** L'icône mailto n'apparaît que sur une adresse plausible (sinon elle mentirait) */
function mailtoHref(raw: string): string | null {
  const v = raw.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : null;
}

/** Idem pour tel: — chiffres, espaces et ponctuation d'appel uniquement */
function telHref(raw: string): string | null {
  const v = raw.trim();
  if (!/^\+?[\d][\d\s().-]{3,}$/.test(v)) return null;
  const digits = v.replace(/[^\d+]/g, '');
  return digits.length >= 4 ? `tel:${digits}` : null;
}

/** Pastille de résultat : la CSP interdit les vignettes distantes, on prend l'initiale. */
function resultInitial(title: string): string {
  const c = title.trim().charAt(0);
  return c === '' ? '?' : c;
}

const pillStyle = (color: string): React.CSSProperties =>
  ({ '--inline-db-option-color': optionColorValue(color) }) as React.CSSProperties;

interface DraftInputProps {
  /** Valeur éditée (celle que l'on retape) */
  value: string;
  /** Rendu au repos quand il diffère de la saisie — nombre mis en forme, p. ex. */
  display?: string;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  inputMode?: 'text' | 'decimal' | 'url' | 'email' | 'tel';
  autoFocus?: boolean;
  onCommit: (raw: string) => void;
  /** Appelé après le blur (commit OU annulation) — sortie du mode édition progress */
  onDone?: () => void;
}

/**
 * Input à état local : commit au blur/Enter, Escape annule sans committer.
 *
 * Toujours `type="text"` — un `type="number"` rendrait les flèches de Chromium,
 * refuserait la virgule décimale des langues qui l'emploient et changerait la
 * valeur à la molette. Le clavier logiciel est guidé par `inputMode`, la mise en
 * forme par `display` : on montre le nombre habillé au repos et la valeur nue
 * dès qu'on le modifie.
 */
const DraftInput: React.FC<DraftInputProps> = ({
  value,
  display,
  placeholder,
  className,
  ariaLabel,
  inputMode,
  autoFocus,
  onCommit,
  onDone,
}) => {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(!!autoFocus);
  const cancelRef = useRef(false);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      type="text"
      className={className}
      value={editing ? draft : (display ?? value)}
      placeholder={placeholder}
      inputMode={inputMode}
      spellCheck={inputMode === undefined || inputMode === 'text'}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (cancelRef.current) {
          cancelRef.current = false;
          setDraft(value);
          onDone?.();
          return;
        }
        if (draft !== value) onCommit(draft);
        onDone?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          cancelRef.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

interface PopoverPos {
  top: number;
  left: number;
  /**
   * Hauteur maximale REELLEMENT disponible a cet endroit de l'ecran.
   *
   * Retourner le popover vers le haut ne suffit pas : quand ni le haut ni le
   * bas n'offrent la hauteur estimee (fenetre courte, barre des taches), il
   * debordait de l'ecran — et le debordement etant HORS du conteneur defilant,
   * les dernieres entrees devenaient inatteignables. Borne, le contenu defile
   * a l'interieur.
   */
  maxHeight: number;
}

/**
 * Ce qui, dans l'état d'interface, ne concerne QU'UNE ligne : popover ouvert,
 * étoile survolée, cellule d'avancement en édition.
 *
 * Des identifiants NUS plutôt que les objets d'état de la vue : une ligne
 * mémoïsée les compare à l'ancienne d'un coup d'œil, et survoler une étoile
 * cesse de re-rendre les trois cents autres lignes.
 */
interface RowUi {
  dropdownPropId: string | null;
  notePropId: string | null;
  relPropId: string | null;
  datePropId: string | null;
  progressPropId: string | null;
  ratingPropId: string | null;
  ratingValue: number;
}

/**
 * Cellule « lien vers une note ». Composant à part parce qu'il s'abonne à CETTE
 * note-là : lire `notes.byId` en entier depuis la table la ferait re-rendre au
 * moindre changement d'une note quelconque du coffre.
 */
const NoteLinkCell: React.FC<{
  noteId: string;
  onOpen: (noteId: string) => void;
  onUnlink: () => void;
}> = ({ noteId, onOpen, onUnlink }) => {
  const { t } = useTranslation();
  const linked = useSelector((s: RootState) => s.notes.byId[noteId]);
  const exists = !!linked && !linked.deletedAt;
  return (
    <div className="inline-db__note-cell">
      {exists ? (
        <button
          type="button"
          className="inline-db__note-open"
          title={t('notes.inlineDb.openNote', 'Open note')}
          onClick={() => onOpen(noteId)}
        >
          {linked.title || t('notes.inlineDb.untitled', 'Untitled')}
        </button>
      ) : (
        <span className="inline-db__note-missing">
          {t('notes.inlineDb.noteNotFound', 'Note not found')}
        </span>
      )}
      <button
        type="button"
        className="inline-db__note-unlink"
        aria-label={t('notes.inlineDb.unlinkNote', 'Unlink note')}
        onClick={onUnlink}
      >
        <svg {...svgProps}>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  );
};

interface DbTableRowProps {
  row: DbRow;
  rowIndex: number;
  properties: DbProperty[];
  /** Colonne tabulable de CETTE ligne (tabindex tournant), `null` ailleurs */
  focusCol: number | null;
  dragging: boolean;
  dropPlace: DropPlace | null;
  manualOrder: boolean;
  /* État d'interface de la ligne, en identifiants nus (cf. RowUi) */
  dropdownPropId: string | null;
  notePropId: string | null;
  relPropId: string | null;
  datePropId: string | null;
  progressPropId: string | null;
  ratingPropId: string | null;
  ratingValue: number;
  /* ⚡ Compléter — tout est décidé par la table, la ligne ne fait que rendre */
  showMeta: boolean;
  metaBusy: boolean;
  metaHasError: boolean;
  metaHasPopup: boolean;
  metaExpanded: boolean | undefined;
  metaLabel: string;
  metaTitle: string;
  /* Libellés (la ligne n'appelle pas i18n : trois cents abonnements de plus) */
  gripLabel: string;
  gripTitle: string;
  deleteLabel: string;
  /* Rappels d'identité STABLE : c'est ce qui rend la mémoïsation utile */
  renderCell: (prop: DbProperty, row: DbRow, ui: RowUi) => React.ReactNode;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLTableCellElement>, row: number, col: number) => void;
  onCellKeyDownCapture: (e: React.KeyboardEvent<HTMLTableCellElement>) => void;
  onCellFocus: (row: number, col: number) => void;
  onRowDragStart: (e: React.DragEvent<HTMLButtonElement>, rowId: string) => void;
  onRowDragEnd: () => void;
  onRowDragOver: (e: React.DragEvent<HTMLTableRowElement>, rowId: string) => void;
  onRowDrop: (e: React.DragEvent<HTMLTableRowElement>, rowId: string) => void;
  onGripKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, rowId: string) => void;
  onMetaClick: (row: DbRow, e: React.MouseEvent<HTMLButtonElement>) => void;
  onDeleteRow: (rowId: string) => void;
  onDuplicateRow: (rowId: string) => void;
  duplicateLabel: string;
  onOpenRow: (rowId: string) => void;
  openLabel: string;
  /** Profondeur dans l'arbre des sous-elements (0 = racine). */
  depth: number;
  /** A des enfants : porte le chevron de pliage. */
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: (rowId: string) => void;
  collapseLabel: string;
}

/**
 * UNE ligne de la table, mémoïsée.
 *
 * Toutes ses entrées sont des valeurs simples ou des rappels d'identité stable :
 * la comparaison superficielle de `React.memo` suffit donc, et un geste qui ne
 * concerne qu'une ligne (ouvrir un popover, survoler une étoile, déplacer le
 * focus, survoler un bord de dépôt) cesse de re-rendre les trois cents autres.
 */
const DbTableRow = React.memo<DbTableRowProps>(function DbTableRow({
  row,
  rowIndex,
  properties,
  focusCol,
  dragging,
  dropPlace,
  manualOrder,
  dropdownPropId,
  notePropId,
  relPropId,
  datePropId,
  progressPropId,
  ratingPropId,
  ratingValue: hoverRating,
  showMeta,
  metaBusy,
  metaHasError,
  metaHasPopup,
  metaExpanded,
  metaLabel,
  metaTitle,
  gripLabel,
  gripTitle,
  deleteLabel,
  renderCell,
  onCellKeyDown,
  onCellKeyDownCapture,
  onCellFocus,
  onRowDragStart,
  onRowDragEnd,
  onRowDragOver,
  onRowDrop,
  onGripKeyDown,
  onMetaClick,
  onDeleteRow,
  onDuplicateRow,
  duplicateLabel,
  onOpenRow,
  openLabel,
  depth,
  hasChildren,
  collapsed,
  onToggleCollapse,
  collapseLabel,
}) {
  const ui: RowUi = {
    dropdownPropId,
    notePropId,
    relPropId,
    datePropId,
    progressPropId,
    ratingPropId,
    ratingValue: hoverRating,
  };
  return (
    <tr
      className={`inline-db__row${dragging ? ' inline-db__row--dragging' : ''}${
        dropPlace ? ` inline-db__row--drop-${dropPlace}` : ''
      }`}
      onDragOver={(e) => onRowDragOver(e, row.id)}
      onDrop={(e) => onRowDrop(e, row.id)}
    >
      <td className="inline-db__cell inline-db__grip-cell">
        <span className="inline-db__row-number" aria-hidden="true">
          {rowIndex + 1}
        </span>
        <button
          type="button"
          className="inline-db__row-grip"
          draggable={manualOrder}
          disabled={!manualOrder}
          aria-label={gripLabel}
          title={gripTitle}
          onDragStart={(e) => onRowDragStart(e, row.id)}
          onDragEnd={onRowDragEnd}
          onKeyDown={(e) => onGripKeyDown(e, row.id)}
        >
          <svg {...svgProps} width={12} height={12} aria-hidden="true">
            <circle cx="9" cy="6" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="15" cy="6" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="9" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="9" cy="18" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="15" cy="18" r="1.6" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </td>
      {properties.map((prop, colIndex) => (
        // L'INDENTATION porte sur la premiere colonne seulement : decaler toute
        // la rangee desalignerait les colonnes entre parent et enfant.
        <td
          key={prop.id}
          data-db-col={prop.id}
          data-db-cell={`${rowIndex}-${colIndex}`}
          // Tabindex tournant : une seule cellule tabulable, les flèches font le
          // reste — et la tabulation, elle, sort de la table
          tabIndex={colIndex === focusCol ? 0 : -1}
          className={`inline-db__cell ${
            prop.type === 'checkbox' ? 'inline-db__cell--checkbox' : 'inline-db__cell--input'
          }`}
          onKeyDown={(e) => onCellKeyDown(e, rowIndex, colIndex)}
          onKeyDownCapture={onCellKeyDownCapture}
          onFocus={() => onCellFocus(rowIndex, colIndex)}
        >
          {colIndex === 0 && (depth > 0 || hasChildren) && (
            <span
              className="inline-db__subtree"
              style={{ paddingLeft: `${depth * 14}px` }}
              contentEditable={false}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className={`inline-db__subtree-caret ${collapsed ? 'is-collapsed' : ''}`}
                  aria-label={collapseLabel}
                  aria-expanded={!collapsed}
                  title={collapseLabel}
                  onClick={() => onToggleCollapse(row.id)}
                >
                  ▾
                </button>
              ) : (
                // Meme largeur qu'un chevron : sans elle, une ligne sans enfant
                // se decalerait d'un cran par rapport a ses freres.
                <span className="inline-db__subtree-spacer" aria-hidden="true" />
              )}
            </span>
          )}
          {renderCell(prop, row, ui)}
        </td>
      ))}
      <td className="inline-db__cell inline-db__row-actions">
        {showMeta && (
          <button
            type="button"
            className={`inline-db__row-meta${metaBusy ? ' inline-db__row-meta--busy' : ''}${
              metaHasError ? ' inline-db__row-meta--error' : ''
            }`}
            data-db-anchor=""
            disabled={metaBusy}
            aria-haspopup={metaHasPopup ? 'dialog' : undefined}
            aria-expanded={metaExpanded}
            aria-label={metaLabel}
            title={metaTitle}
            onClick={(e) => onMetaClick(row, e)}
          >
            {metaBusy ? (
              <span className="inline-db__spinner" aria-hidden="true" />
            ) : (
              <svg {...svgProps} width={13} height={13}>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          className="inline-db__row-action"
          aria-label={openLabel}
          title={openLabel}
          onClick={() => onOpenRow(row.id)}
        >
          <svg {...svgProps} width={12} height={12} aria-hidden="true">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <button
          type="button"
          className="inline-db__row-action"
          aria-label={duplicateLabel}
          title={duplicateLabel}
          onClick={() => onDuplicateRow(row.id)}
        >
          <svg {...svgProps} width={12} height={12} aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        </button>
        <button
          type="button"
          className="inline-db__row-delete"
          aria-label={deleteLabel}
          onClick={() => onDeleteRow(row.id)}
        >
          <svg {...svgProps} width={13} height={13}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </td>
      <td className="inline-db__cell inline-db__filler-cell" />
    </tr>
  );
});

/**
 * Pourquoi un résultat n'a rien rempli. `allFilled` : des colonnes savaient
 * l'accueillir, elles étaient déjà remplies. `noColumn` : aucune colonne de la
 * table ne peut recevoir quoi que ce soit de ce résultat.
 */
type ConnectorNotice = 'allFilled' | 'noColumn';

/** États du popover du ⚡ quand une source est choisie (un seul à la fois) */
type ConnectorPanel =
  | { kind: 'loading' }
  // La liste RESTE affichée après un remplissage sans effet : essayer le
  // résultat suivant ne doit pas coûter un nouvel aller-retour réseau
  | { kind: 'results'; results: ConnectorResult[]; notice?: ConnectorNotice }
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'noTitle' }
  | { kind: 'missingKey' };

export const DatabaseTableView: React.FC<DatabaseViewProps> = ({
  data,
  visibleRows,
  groupBy,
  rowDefaults,
  source,
  linkCtx,
  dbCatalog,
  activeView,
  onChange,
  onGroupByChange,
}) => {
  const { t, i18n } = useTranslation();
  // Formats de date et de nombre pris sur la LANGUE DE L'APP, jamais sur la
  // locale du système : deux utilisateurs de la même note lisent la même chose
  const locale = resolveLocale(i18n.language);
  const dispatch = useDispatch();
  const notesById = useSelector((s: RootState) => s.notes.byId);
  /**
   * Notes TENUES par un éditeur monté. Créer une ligne dans une base qui vit là
   * serait écrire sous les pieds de ProseMirror : son document en mémoire
   * réécrit la note entière à la frappe suivante, et la ligne disparaîtrait sans
   * un mot.
   *
   * Un ENSEMBLE, et non `state.notes.editingNoteId` : l'application ouvre
   * plusieurs notes à la fois (vue scindée, notes atteintes par une route) et
   * cet identifiant unique n'en désigne qu'une — les autres passaient pour
   * libres alors qu'un panneau les tenait.
   */
  const heldNotes = useSyncExternalStore(subscribeNoteEditors, heldNoteIds, heldNoteIds);
  /** Ouverture d'une note par le chemin du panneau (cf. NoteOpenerContext) */
  const openNote = useNoteOpener();
  const goToNote = useCallback(
    (noteId: string) => {
      if (openNote) openNote(noteId);
      else dispatch(setEditingNote(noteId));
    },
    [openNote, dispatch]
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Ancre du popover ouvert : le focus lui est restitué à la fermeture
  const anchorElRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const [editorFor, setEditorFor] = useState<{ propId: string; pos: PopoverPos } | null>(null);

  /**
   * Colonne dont le MENU est ouvert. L'editeur de propriete (`editorFor`) n'est
   * plus atteint directement : il vit derriere « Modifier la propriete », ou il
   * porte ce qui est long a regler (options, relation, agregat, formule).
   */
  const [colMenuFor, setColMenuFor] = useState<{ propId: string; pos: PopoverPos } | null>(null);

  const [dropdownFor, setDropdownFor] = useState<{
    rowId: string;
    propId: string;
    pos: PopoverPos;
  } | null>(null);
  const [notePickerFor, setNotePickerFor] = useState<{
    rowId: string;
    propId: string;
    pos: PopoverPos;
  } | null>(null);
  const [noteQuery, setNoteQuery] = useState('');
  const noteSearchRef = useRef<HTMLInputElement>(null);
  // Sélecteur des lignes liées d'une cellule relation
  const [relPickerFor, setRelPickerFor] = useState<{
    rowId: string;
    propId: string;
    pos: PopoverPos;
  } | null>(null);
  const [relQuery, setRelQuery] = useState('');
  const relSearchRef = useRef<HTMLInputElement>(null);
  // Sélecteur de date maison d'une cellule (aucun calendrier de Chromium)
  const [datePickerFor, setDatePickerFor] = useState<{
    rowId: string;
    propId: string;
    pos: PopoverPos;
  } | null>(null);
  // Cellule progress en cours d'édition (bascule barre → input)
  const [progressEditFor, setProgressEditFor] = useState<{ rowId: string; propId: string } | null>(
    null
  );
  // Étoile survolée d'une cellule évaluation : aperçu avant clic
  const [ratingHover, setRatingHover] = useState<{
    rowId: string;
    propId: string;
    value: number;
  } | null>(null);
  // Compléter depuis le lien (QW-13) : confirmation opt-in web, chargement, échec transitoire
  // `intent` distingue les deux usages du ⚡ (lien Open Graph / recherche dans une source)
  const [metaConfirmFor, setMetaConfirmFor] = useState<{
    rowId: string;
    pos: PopoverPos;
    intent: 'link' | 'source';
  } | null>(null);
  const [metaFetchingRowId, setMetaFetchingRowId] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<{
    rowId: string;
    kind: 'unreachable' | 'nothing' | 'nofill';
  } | null>(null);
  const metaErrorTimerRef = useRef<number | null>(null);
  const metaAcceptRef = useRef<HTMLButtonElement>(null);
  // Sélecteur de résultats du connecteur (⚡ avec source choisie)
  const [connectorFor, setConnectorFor] = useState<{
    rowId: string;
    pos: PopoverPos;
    panel: ConnectorPanel;
  } | null>(null);
  const connectorRef = useRef<HTMLDivElement>(null);
  /**
   * Colonne en cours de réglage. SEULE son identité passe par l'état de React
   * (elle habille l'en-tête et coupe les transitions) : la largeur, elle, est
   * peinte directement dans le DOM à chaque mouvement — repasser par React à
   * chaque pixel re-rendrait la table entière, lignes comprises.
   */
  const [resizingPropId, setResizingPropId] = useState<string | null>(null);
  const resizeRef = useRef<{
    propId: string;
    startX: number;
    width: number;
    /** Largeur au moment de la prise : sert à corriger la largeur mini de la table */
    startWidth: number;
    baseMinWidth: number;
  } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  /** Largeur mini CALCULÉE de la table, relue par le geste de redimensionnement */
  const tableMinWidthRef = useRef(0);
  const lastResizeDownRef = useRef(0);
  // Cellule que le clavier vise (roving tabindex : une seule cellule tabulable)
  const [focusCell, setFocusCell] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  // Réordonnancement : ligne saisie, puis bord visé sous le curseur. Les deux
  // sont DOUBLÉS d'une ref : les gestes qui les relisent restent d'identité
  // stable, sinon un simple survol re-rendrait toutes les lignes mémoïsées.
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const draggedRowIdRef = useRef<string | null>(null);
  const [dropHint, setDropHint] = useState<{ rowId: string; place: DropPlace } | null>(null);
  const dropHintRef = useRef<{ rowId: string; place: DropPlace } | null>(null);
  dropHintRef.current = dropHint;
  // Données au présent pour les continuations async (le fetch survit aux re-rendus)
  const dataRef = useRef(data);
  dataRef.current = data;
  /**
   * Commit d'identité STABLE. `onChange` vient du nœud TipTap et se refabrique
   * à chaque rendu : les gestes qui en dépendent changeraient d'identité tout
   * aussi souvent, et aucune ligne mémoïsée ne pourrait alors être épargnée.
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const commitData = useCallback((next: InlineDbData) => onChangeRef.current(next), []);
  /** Ordre MONTRÉ au présent — même raison que `commitData` */
  const visibleRowsRef = useRef(visibleRows);
  visibleRowsRef.current = visibleRows;

  /**
   * Environnement des relations et des agrégats : le schéma de CETTE base (une
   * cellule rollup y retrouve la relation qu'elle suit) et la résolution des
   * bases visées. Tout est local et déjà déchiffré ; aucun appel réseau n'est
   * fait pour lire une relation.
   */
  const env = useMemo<DbEnv>(
    () => ({ properties: data.properties, ...(linkCtx ? { ctx: linkCtx } : {}) }),
    [data.properties, linkCtx]
  );
  const catalog = dbCatalog ?? [];
  /**
   * Identité de CETTE base : elle voyage par le contexte de liaison, qui est
   * fabriqué une fois par le bloc. Les rétroliens en ont besoin (vérifier que la
   * relation d'en face pointe bien ici), et la création de ligne aussi (viser
   * sa propre base est une écriture locale, pas une écriture chez le voisin).
   */
  const selfDbId = linkCtx?.selfDbId ?? '';

  // Source du bloc : une valeur hors liste blanche — ou une source interne
  // absente du sélecteur — vaut « aucune » (le ⚡ redevient « depuis le lien »)
  const sourceId = isSelectableConnectorSourceId(source) ? source : null;
  const sourceLabelEntry = sourceId ? CONNECTOR_SOURCE_LABELS[sourceId] : undefined;
  const sourceLabel = sourceLabelEntry
    ? t(sourceLabelEntry.key, sourceLabelEntry.fallback)
    : (sourceId ?? '');

  // Coordonnées viewport (popover en position: fixed), clampées ; retourné au-dessus si débord bas
  const anchorPos = useCallback((el: HTMLElement, width: number, estHeight: number): PopoverPos => {
    const rect = el.getBoundingClientRect();
    const MARGIN = 8;
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4));

    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    // On bascule vers le haut seulement s'il y a VRAIMENT plus de place la-haut.
    const above = spaceBelow < estHeight && spaceAbove > spaceBelow;
    const available = Math.max(160, above ? spaceAbove : spaceBelow);
    const height = Math.min(estHeight, available);
    const top = above ? Math.max(4, rect.top - height - 4) : rect.bottom + 4;

    return { top, left, maxHeight: available };
  }, []);

  // Fermeture des popovers : Escape / clic extérieur / scroll (les ancres DU BLOC gèrent leur toggle)
  useEffect(() => {
    if (
      !editorFor &&
      !colMenuFor &&
      !dropdownFor &&
      !notePickerFor &&
      !relPickerFor &&
      !metaConfirmFor &&
      !connectorFor &&
      !datePickerFor
    )
      return;
    const closeAll = () => {
      setEditorFor(null);
      // Le menu de colonne suit le meme sort : Echap, clic dehors, defilement.
      setColMenuFor(null);
      setDropdownFor(null);
      setNotePickerFor(null);
      setRelPickerFor(null);
      setMetaConfirmFor(null);
      setConnectorFor(null);
      setDatePickerFor(null);
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (
        target &&
        wrapRef.current?.contains(target) &&
        (target.closest('.inline-db__popover') || target.closest('[data-db-anchor]'))
      )
        return;
      closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    const onScroll = (e: Event) => {
      // scroll interne au popover (liste d'options) : on ne ferme pas
      if (e.target instanceof Element && e.target.closest('.inline-db__popover')) return;
      closeAll();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [
    editorFor,
    colMenuFor,
    dropdownFor,
    notePickerFor,
    relPickerFor,
    metaConfirmFor,
    connectorFor,
    datePickerFor,
  ]);

  // À l'ouverture du dropdown : focus sur l'option sélectionnée (ou la première)
  useEffect(() => {
    if (!dropdownFor) return;
    const el = dropdownRef.current;
    if (!el) return;
    const target =
      el.querySelector<HTMLButtonElement>('.inline-db__dropdown-item[aria-selected="true"]') ??
      el.querySelector<HTMLButtonElement>('.inline-db__dropdown-item');
    target?.focus();
  }, [dropdownFor]);

  // À l'ouverture du sélecteur de note : focus sur la recherche
  useEffect(() => {
    if (notePickerFor) noteSearchRef.current?.focus();
  }, [notePickerFor]);

  // Idem pour le sélecteur de lignes liées
  useEffect(() => {
    if (relPickerFor) relSearchRef.current?.focus();
  }, [relPickerFor]);

  // À l'ouverture de la confirmation opt-in : focus sur Continuer
  useEffect(() => {
    if (metaConfirmFor) metaAcceptRef.current?.focus();
  }, [metaConfirmFor]);

  // Le ⚡ est disabled pendant la recherche : le focus est tombé sur body. On le
  // remet dans le popover — 1er résultat s'il y en a, sinon le dialogue lui-même
  // (message lu, Escape referme et l'ancre récupère le focus).
  useEffect(() => {
    const el = connectorRef.current;
    if (!connectorFor || !el) return;
    if (connectorFor.panel.kind === 'loading') return;
    const first =
      connectorFor.panel.kind === 'results'
        ? el.querySelector<HTMLButtonElement>('.inline-db__connector-item')
        : null;
    (first ?? el).focus({ preventScroll: true });
  }, [connectorFor]);

  // Purge du timer d'échec transitoire au démontage
  useEffect(
    () => () => {
      if (metaErrorTimerRef.current !== null) window.clearTimeout(metaErrorTimerRef.current);
    },
    []
  );

  // À la fermeture (Escape/choix/scroll) : focus restitué à l'ancre si personne ne l'a pris
  useEffect(() => {
    const open = !!(
      editorFor ||
      dropdownFor ||
      notePickerFor ||
      relPickerFor ||
      metaConfirmFor ||
      connectorFor ||
      datePickerFor
    );
    if (!open && wasOpenRef.current) {
      if (document.activeElement === document.body) {
        anchorElRef.current?.focus({ preventScroll: true });
      }
      anchorElRef.current = null;
    }
    wasOpenRef.current = open;
  }, [
    editorFor,
    dropdownFor,
    notePickerFor,
    relPickerFor,
    metaConfirmFor,
    connectorFor,
    datePickerFor,
  ]);

  // Navigation clavier du listbox select/multiSelect (Enter = clic natif des boutons)
  const onDropdownKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(
      dropdownRef.current?.querySelectorAll<HTMLButtonElement>(
        '.inline-db__dropdown-item, .inline-db__dropdown-clear'
      ) ?? []
    );
    if (items.length === 0) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next].focus();
  }, []);

  /* ---- Mutations de propriétés ---- */
  const updateProperty = useCallback(
    (next: DbProperty) => {
      // Options supprimées → purge des cellules dans le même commit
      // (cascade de schéma : n'horodate pas les lignes, aligné sur deleteProperty)
      const prev = data.properties.find((p) => p.id === next.id);
      const nextIds = new Set((next.options ?? []).map((o) => o.id));
      const removed = new Set(
        (prev?.options ?? []).map((o) => o.id).filter((id) => !nextIds.has(id))
      );
      let rows = data.rows;
      if (removed.size > 0) {
        rows = data.rows.map((r) => {
          const v = r.cells[next.id];
          if (typeof v === 'string' && removed.has(v)) {
            const cells = { ...r.cells };
            delete cells[next.id];
            return { ...r, cells };
          }
          if (Array.isArray(v)) {
            const filtered = v.filter((x) => !(typeof x === 'string' && removed.has(x)));
            if (filtered.length !== v.length) {
              const cells = { ...r.cells };
              if (filtered.length > 0) cells[next.id] = filtered;
              else delete cells[next.id];
              return { ...r, cells };
            }
          }
          return r;
        });
      }
      // Défaut orphelin (option supprimée, ou type qui ne porte plus d'options) → effacé ici même
      const keepsOptions = next.type === 'select' || next.type === 'multiSelect';
      const sanitized =
        next.defaultOptionId && (!keepsOptions || !nextIds.has(next.defaultOptionId))
          ? { ...next, defaultOptionId: undefined }
          : next;
      // `...data` obligatoire : reconstruire l'objet perdrait les vues enregistrées
      onChange({
        ...data,
        properties: data.properties.map((p) => (p.id === next.id ? sanitized : p)),
        rows,
      });
    },
    [data, onChange]
  );

  const deleteProperty = useCallback(
    (propId: string) => {
      onChange({
        ...data,
        properties: data.properties.filter((p) => p.id !== propId),
        rows: data.rows.map((r) => {
          if (!(propId in r.cells)) return r;
          const cells = { ...r.cells };
          delete cells[propId];
          return { ...r, cells };
        }),
      });
      if (groupBy === propId) onGroupByChange('');
      setEditorFor(null);
    },
    [data, groupBy, onChange, onGroupByChange]
  );

  const addProperty = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const id = newId();
      const name = t('notes.inlineDb.newPropertyName', 'Column {{n}}', {
        n: data.properties.length + 1,
      });
      onChange({ ...data, properties: [...data.properties, { id, name, type: 'text' }] });
      setDropdownFor(null);
      setNotePickerFor(null);
      setRelPickerFor(null);
      setConnectorFor(null);
      setDatePickerFor(null);
      anchorElRef.current = e.currentTarget;
      setEditorFor({
        propId: id,
        pos: anchorPos(e.currentTarget, EDITOR_WIDTH, EDITOR_EST_HEIGHT),
      });
    },
    [data, onChange, t, anchorPos]
  );

  const toggleEditor = useCallback(
    (prop: DbProperty, e: React.MouseEvent<HTMLButtonElement>) => {
      const pos = anchorPos(e.currentTarget, EDITOR_WIDTH, EDITOR_EST_HEIGHT);
      anchorElRef.current = e.currentTarget;
      setDropdownFor(null);
      setNotePickerFor(null);
      setRelPickerFor(null);
      setConnectorFor(null);
      setDatePickerFor(null);
      setEditorFor(null);
      // Le MENU d'abord : l'editeur de propriete est desormais derriere
      // « Modifier la propriete » (cf. ColumnMenu).
      setColMenuFor((cur) => (cur?.propId === prop.id ? null : { propId: prop.id, pos }));
    },
    [anchorPos]
  );

  /** Décale une propriété d'un cran (le popover reste ouvert, même ancre) */
  const moveProperty = useCallback(
    (propId: string, dir: -1 | 1) => {
      const idx = data.properties.findIndex((p) => p.id === propId);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= data.properties.length) return;
      const properties = [...data.properties];
      [properties[idx], properties[j]] = [properties[j], properties[idx]];
      onChange({ ...data, properties });
      // L'ancre bouge avec sa colonne : re-ancre le popover fixed après le re-rendu
      const anchor = anchorElRef.current;
      if (anchor) {
        requestAnimationFrame(() => {
          setEditorFor((cur) =>
            cur && cur.propId === propId
              ? { ...cur, pos: anchorPos(anchor, EDITOR_WIDTH, EDITOR_EST_HEIGHT) }
              : cur
          );
        });
      }
    },
    [data, onChange, anchorPos]
  );

  /* ---- Mutations de lignes / cellules ---- */
  const setCell = useCallback(
    (rowId: string, propId: string, value: unknown) => {
      const cur = dataRef.current;
      commitData({
        ...cur,
        rows: cur.rows.map((r) => {
          if (r.id !== rowId) return r;
          const cells = { ...r.cells };
          if (value === undefined) delete cells[propId];
          else cells[propId] = value;
          // updatedAt centralisé : seul point de modification de cells de la table
          return touchRow({ ...r, cells });
        }),
      });
    },
    [commitData]
  );

  const toggleCollapse = useCallback((rowId: string) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const deleteRow = useCallback(
    (rowId: string) => {
      const cur = dataRef.current;
      // Les sous-elements REMONTENT d'un cran au lieu d'etre supprimes avec
      // leur parent : une suppression en cascade efface des lignes que
      // l'utilisateur n'a pas designees, et ne se voit qu'apres coup.
      commitData({ ...cur, rows: removeRowKeepingChildren(cur.rows, rowId) });
    },
    [commitData]
  );

  /** Cree une ligne rattachee a `parentId`. */
  const addSubRow = useCallback(
    (parentId: string) => {
      const cur = dataRef.current;
      const created = withParent(newRow(cur.properties, rowDefaults), parentId);
      const at = cur.rows.findIndex((candidate) => candidate.id === parentId);
      const rows = [...cur.rows];
      rows.splice(at < 0 ? rows.length : at + 1, 0, created);
      commitData({ ...cur, rows });
      // Une branche repliee doit s'ouvrir : sinon la ligne creee n'apparait pas.
      setCollapsed((prev) => {
        if (!prev.has(parentId)) return prev;
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    },
    [commitData, rowDefaults]
  );

  /** Rattache (ou detache) une ligne. Les cycles sont exclus en amont. */
  const setRowParent = useCallback(
    (rowId: string, parentId: string | undefined) => {
      const cur = dataRef.current;
      commitData({
        ...cur,
        rows: cur.rows.map((candidate) =>
          candidate.id === rowId ? withParent(candidate, parentId) : candidate
        ),
      });
    },
    [commitData]
  );

  /**
   * Duplique une ligne JUSTE EN DESSOUS de l'originale.
   *
   * Identifiant neuf, cellules COPIEES en profondeur : une valeur multi-choix
   * est un tableau, et le partager entre deux lignes ferait bouger l'une quand
   * on modifie l'autre.
   */
  const duplicateRow = useCallback(
    (rowId: string) => {
      const cur = dataRef.current;
      const index = cur.rows.findIndex((r) => r.id === rowId);
      if (index < 0) return;
      const source = cur.rows[index];
      const copy = {
        ...source,
        id: newId(),
        cells: Object.fromEntries(
          Object.entries(source.cells).map(([key, value]) => [
            key,
            Array.isArray(value) ? [...value] : value,
          ])
        ),
      };
      const rows = [...cur.rows];
      rows.splice(index + 1, 0, copy);
      commitData({ ...cur, rows });
    },
    [commitData]
  );

  /** Cree une ligne pre-remplie par un modele. */
  const addRowFromTemplate = useCallback(
    (templateId: string) => {
      const cur = dataRef.current;
      const template = (cur.rowTemplates ?? []).find((entry) => entry.id === templateId);
      if (!template) return;
      // `rowDefaults` d'abord : un modele complete la vue, il ne la contredit
      // pas — sinon la ligne creee serait invisible dans la vue filtree.
      commitData({
        ...cur,
        rows: [...cur.rows, newRow(cur.properties, { ...rowDefaults, ...template.cells })],
      });
      setRowTemplateMenu(null);
    },
    [commitData, rowDefaults]
  );

  /** Fige une ligne existante comme modele. */
  const saveRowAsTemplate = useCallback(
    (rowId: string, name: string) => {
      const cur = dataRef.current;
      const row = cur.rows.find((candidate) => candidate.id === rowId);
      if (!row) return;
      // Les cellules sont COPIEES en profondeur : un multi-choix partage entre
      // le modele et sa ligne d'origine les ferait bouger ensemble.
      const cells = Object.fromEntries(
        Object.entries(row.cells).map(([key, value]) => [
          key,
          Array.isArray(value) ? [...value] : value,
        ])
      );
      commitData({
        ...cur,
        rowTemplates: [...(cur.rowTemplates ?? []), { id: newId(), name, cells }],
      });
    },
    [commitData]
  );

  const deleteRowTemplate = useCallback(
    (templateId: string) => {
      const cur = dataRef.current;
      const kept = (cur.rowTemplates ?? []).filter((entry) => entry.id !== templateId);
      commitData({ ...cur, rowTemplates: kept.length > 0 ? kept : undefined });
    },
    [commitData]
  );

  /** Insere une colonne vide a gauche ou a droite de `propId`. */
  const insertPropertyBeside = useCallback(
    (propId: string, side: 'left' | 'right') => {
      const cur = dataRef.current;
      const at = cur.properties.findIndex((p2) => p2.id === propId);
      if (at < 0) return;
      const name = t('notes.inlineDb.newPropertyN', {
        defaultValue: 'Column {{n}}',
        n: cur.properties.length + 1,
      });
      const properties = [...cur.properties];
      properties.splice(side === 'left' ? at : at + 1, 0, { id: newId(), name, type: 'text' });
      commitData({ ...cur, properties });
    },
    [commitData, t]
  );

  /**
   * Duplique une colonne AVEC ses valeurs.
   *
   * Dupliquer une colonne vide serait une surprise : ce qu'on duplique, c'est
   * une colonne remplie dont on veut une variante.
   */
  const duplicateProperty = useCallback(
    (propId: string) => {
      const cur = dataRef.current;
      const at = cur.properties.findIndex((p2) => p2.id === propId);
      if (at < 0) return;
      const source = cur.properties[at];
      const copyId = newId();
      const copy = {
        ...source,
        id: copyId,
        name: t('notes.inlineDb.copyOf', { defaultValue: '{{name}} (copy)', name: source.name }),
      };
      const properties = [...cur.properties];
      properties.splice(at + 1, 0, copy);
      const rows = cur.rows.map((row) => {
        const value = row.cells[source.id];
        if (value === undefined) return row;
        return {
          ...row,
          // Copie en profondeur d'un multi-choix : partager le tableau ferait
          // bouger les deux colonnes ensemble.
          cells: { ...row.cells, [copyId]: Array.isArray(value) ? [...value] : value },
        };
      });
      commitData({ ...cur, properties, rows });
    },
    [commitData, t]
  );

  /** Pose (ou retire) un tri sur une colonne, dans la vue regardee. */
  const setColumnSort = useCallback(
    (propId: string, direction: 'asc' | 'desc' | null) => {
      const cur = dataRef.current;
      const target = activeView ?? activeViewOf(cur);
      const sorts =
        direction === null
          ? target.sorts.filter((sort) => sort.propertyId !== propId)
          : [
              { propertyId: propId, direction },
              ...target.sorts.filter((sort) => sort.propertyId !== propId),
            ];
      const views = (cur.views ?? [target]).map((v) => (v.id === target.id ? { ...v, sorts } : v));
      commitData({ ...cur, views });
    },
    [activeView, commitData]
  );

  /** Ajoute un filtre VIDE sur la colonne : l'utilisateur le complete ensuite. */
  const addFilterOnColumn = useCallback(
    (propId: string) => {
      const cur = dataRef.current;
      const prop = cur.properties.find((p2) => p2.id === propId);
      if (!prop) return;
      const target = activeView ?? activeViewOf(cur);
      const ops = opsForType(prop.type);
      if (ops.length === 0) return;
      const filters = [...target.filters, { id: newId(), propertyId: propId, op: ops[0] }];
      const views = (cur.views ?? [target]).map((v) =>
        v.id === target.id ? { ...v, filters } : v
      );
      commitData({ ...cur, views });
    },
    [activeView, commitData]
  );

  /** Masque la colonne dans la vue regardee. */
  const hideColumn = useCallback(
    (propId: string) => {
      const cur = dataRef.current;
      const target = activeView ?? activeViewOf(cur);
      const next = togglePropertyVisibility(target, cur.properties, propId);
      if (next === target) return; // derniere colonne visible : refus
      const views = (cur.views ?? [target]).map((v) => (v.id === target.id ? next : v));
      commitData({ ...cur, views });
    },
    [activeView, commitData]
  );

  /** Regroupe le kanban sur cette colonne (et bascule la vue en kanban). */
  const groupByColumn = useCallback(
    (propId: string) => {
      const cur = dataRef.current;
      const target = activeView ?? activeViewOf(cur);
      const views = (cur.views ?? [target]).map((v) =>
        v.id === target.id ? { ...v, type: 'board' as const, groupBy: propId } : v
      );
      commitData({ ...cur, views });
    },
    [activeView, commitData]
  );

  const addRow = useCallback(() => {
    // rowDefaults : sans lui, une vue filtrée créerait une ligne invisible
    const cur = dataRef.current;
    commitData({ ...cur, rows: [...cur.rows, newRow(cur.properties, rowDefaults)] });
  }, [commitData, rowDefaults]);

  /* ==================== Ergonomie du tableau ====================
   * Largeurs de colonnes, réordonnancement des lignes et navigation clavier.
   * Tout ce qui décide est dans `tableErgonomics` (pur, testé) ; ici ne
   * restent que le geste, la mesure du DOM et le commit au point unique. */

  /**
   * Vue à corriger. Le bloc la passe (l'onglet regardé peut n'être qu'une
   * préférence locale) ; sans elle, repli sur celle qu'enregistre le document.
   */
  const view = activeView ?? activeViewOf(data);
  /**
   * Branches repliees — etat LOCAL, jamais ecrit dans le document : plier une
   * branche est un geste de lecture, pas un reglage partage.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  /** Menu des modeles de ligne, ouvert depuis « Nouvelle ligne ». */
  const [rowTemplateMenu, setRowTemplateMenu] = useState<PopoverPos | null>(null);

  /** Ligne ouverte en fiche (cf. RowPanel), par identifiant. */
  const [panelRowId, setPanelRowId] = useState<string | null>(null);

  /** Colonne dont le menu de calcul est ouvert, et sa position a l'ecran. */
  const [calcMenuFor, setCalcMenuFor] = useState<{ propId: string; pos: PopoverPos } | null>(null);

  /** Combien de lignes on rend pour l'instant (cf. INITIAL_ROW_RENDER). */
  const [renderLimit, setRenderLimit] = useState(INITIAL_ROW_RENDER);

  /**
   * Lignes REELLEMENT montees. `visibleRows` reste la reference pour tout ce
   * qui COMPTE (le total affiche en pied de table) : rendre moins n'est pas
   * montrer moins de donnees, c'est en dessiner moins a la fois.
   */
  /**
   * Lignes mises a PLAT depuis l'arbre des sous-elements, puis bornees.
   *
   * L'ordre decide par la vue (filtres puis tris) est respecte a chaque niveau :
   * trier classe les FRERES entre eux, il ne detache jamais un enfant.
   */
  const tree = useMemo(() => buildRowTree(visibleRows, collapsed), [visibleRows, collapsed]);

  const renderedRows = useMemo(
    () => (tree.length > renderLimit ? tree.slice(0, renderLimit) : tree),
    [tree, renderLimit]
  );

  /**
   * Colonnes REELLEMENT affichees, dans l'ordre de la vue.
   *
   * `data.properties` reste la reference pour tout ce qui MODIFIE le schema
   * (ajouter, editer, supprimer une colonne) : masquer n'est pas supprimer, et
   * une colonne masquee doit garder sa place dans le schema comme dans ses
   * cellules.
   */
  const shownProperties = useMemo(
    () => orderedVisibleProperties(data.properties, activeView ?? null),
    [data.properties, activeView]
  );

  /** Un tri actif DÉRIVE l'ordre : le réordonnancement à la main n'y aurait aucun effet visible */
  const manualOrder = view.sorts.length === 0;

  const patchActiveView = useCallback(
    (patch: Partial<DbView>) => {
      const cur = dataRef.current;
      const list = cur.views ?? [];
      // Vue absente de la liste (base d'avant les vues, migrée au vol) : on l'y pose
      const views = list.some((v) => v.id === view.id)
        ? list.map((v) => (v.id === view.id ? { ...v, ...patch } : v))
        : [...list, { ...view, ...patch }];
      onChange({ ...cur, views });
    },
    [view, onChange]
  );

  /** Largeur RANGÉE d'une colonne (celle du geste en cours est peinte dans le DOM) */
  const widthOf = useCallback(
    (prop: DbProperty): number => columnWidthOf(view, prop.id, prop.type),
    [view]
  );

  /** Écriture d'une largeur — silencieuse quand elle ne change rien (clic sans glissé) */
  const commitWidth = useCallback(
    (propId: string, px: number | null) => {
      const next = withColumnWidth(view, propId, px);
      if (columnWidthsEqual(view.columnWidths, next)) return;
      patchActiveView({ columnWidths: next });
    },
    [view, patchActiveView]
  );

  /**
   * Réajustement au contenu (double-appui sur la poignée, ou Entrée). La mesure
   * passe par une sonde hors flux à la police de la cellule : le texte d'un
   * `input` n'a aucune largeur propre dans le DOM, il faut le poser quelque
   * part pour le mesurer.
   */
  const autoFitColumn = useCallback(
    (prop: DbProperty) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const cells = Array.from(
        wrap.querySelectorAll<HTMLElement>(`[data-db-col="${cssEscape(prop.id)}"]`)
      );
      if (cells.length === 0) return;
      const probe = document.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText =
        'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;pointer-events:none';
      wrap.appendChild(probe);
      const measures: number[] = [];
      try {
        for (const cell of cells) {
          const text = cellDisplayText(cell);
          if (text === '') continue;
          const style = window.getComputedStyle(cell.firstElementChild ?? cell);
          probe.style.fontFamily = style.fontFamily;
          probe.style.fontSize = style.fontSize;
          probe.style.fontWeight = style.fontWeight;
          probe.style.letterSpacing = style.letterSpacing;
          probe.textContent = text;
          // Rembourrage de la cellule + place de la poignée dans l'en-tête
          const extra = cell.tagName === 'TH' ? HEADER_FIT_PADDING : CELL_FIT_PADDING;
          measures.push(probe.getBoundingClientRect().width + extra);
        }
      } finally {
        probe.remove();
      }
      commitWidth(prop.id, fitColumnWidth(measures, prop.type));
    },
    [commitWidth]
  );

  /**
   * Largeur peinte DIRECTEMENT dans le DOM : la colonne du `colgroup`, la
   * largeur mini de la table (sinon elle cesserait de défiler pendant le geste)
   * et la valeur annoncée de la poignée. Aucun rendu React n'est déclenché — un
   * glissé sur une table de trois cents lignes en produisait un par pixel.
   */
  const paintWidth = useCallback((propId: string, px: number) => {
    const st = resizeRef.current;
    const wrap = wrapRef.current;
    if (!wrap) return;
    // Attribut PROPRE au colgroup : `data-db-col` sert déjà au réajustement au
    // contenu, qui parcourt les cellules et n'a rien à faire d'un `<col>`
    const key = cssEscape(propId);
    const col = wrap.querySelector<HTMLElement>(`col[data-db-colw="${key}"]`);
    if (col) col.style.width = `${px}px`;
    if (tableRef.current && st) {
      tableRef.current.style.minWidth = `${st.baseMinWidth - st.startWidth + px}px`;
    }
    const handle = wrap.querySelector<HTMLElement>(`[data-db-resizer="${key}"]`);
    handle?.setAttribute('aria-valuenow', String(px));
  }, []);

  /** Peinture au plus une fois par frame : la souris émet bien plus d'événements */
  const schedulePaint = useCallback(() => {
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const st = resizeRef.current;
      if (st) paintWidth(st.propId, st.width);
    });
  }, [paintWidth]);

  const cancelScheduledPaint = useCallback(() => {
    if (resizeFrameRef.current === null) return;
    window.cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = null;
  }, []);

  // Frame en attente au démontage : elle toucherait un DOM disparu
  useEffect(() => cancelScheduledPaint, [cancelScheduledPaint]);

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>, prop: DbProperty) => {
      if (e.button !== 0) return;
      // Le pointeur appartient à la poignée : ni ouverture de l'éditeur, ni sélection de texte
      e.preventDefault();
      e.stopPropagation();
      // Deux appuis rapprochés = réajustement au contenu. Détecté ici PLUTÔT
      // que via dblclick seul : couper le défaut du pointeur peut avaler les
      // événements souris de compatibilité dont dblclick est tiré.
      const now = Date.now();
      const doubled = now - lastResizeDownRef.current < DOUBLE_PRESS_MS;
      lastResizeDownRef.current = now;
      if (doubled) {
        autoFitColumn(prop);
        return;
      }
      const width = columnWidthOf(view, prop.id, prop.type);
      resizeRef.current = {
        propId: prop.id,
        startX: e.clientX,
        width,
        startWidth: width,
        baseMinWidth: tableMinWidthRef.current,
      };
      setResizingPropId(prop.id);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [view, autoFitColumn]
  );

  const moveResize = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const st = resizeRef.current;
      if (!st) return;
      // La largeur de départ reste le repère : le delta se lit toujours depuis le clic
      resizeRef.current = {
        ...st,
        startX: e.clientX,
        width: clampColumnWidth(st.width + (e.clientX - st.startX)),
      };
      schedulePaint();
    },
    [schedulePaint]
  );

  const endResize = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const st = resizeRef.current;
      cancelScheduledPaint();
      resizeRef.current = null;
      setResizingPropId(null);
      if (!st) return;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      commitWidth(st.propId, st.width);
    },
    [cancelScheduledPaint, commitWidth]
  );

  /** Réglage au clavier : la largeur bouge en vif, et ne s'écrit qu'une fois la touche relâchée */
  const nudgeWidth = useCallback(
    (prop: DbProperty, delta: number) => {
      const st = resizeRef.current;
      const same = st && st.propId === prop.id;
      const base = same ? st.width : columnWidthOf(view, prop.id, prop.type);
      const width = clampColumnWidth(base + delta);
      resizeRef.current = same
        ? { ...st, width }
        : {
            propId: prop.id,
            startX: 0,
            width,
            startWidth: base,
            baseMinWidth: tableMinWidthRef.current,
          };
      setResizingPropId(prop.id);
      // Peint tout de suite : au clavier, un pas doit se voir à l'appui
      paintWidth(prop.id, width);
    },
    [paintWidth, view]
  );

  const endNudge = useCallback(() => {
    const st = resizeRef.current;
    if (!st) return;
    cancelScheduledPaint();
    resizeRef.current = null;
    setResizingPropId(null);
    commitWidth(st.propId, st.width);
  }, [cancelScheduledPaint, commitWidth]);

  const onResizerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>, prop: DbProperty) => {
      const step = e.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
      if (e.key === 'ArrowLeft') nudgeWidth(prop, -step);
      else if (e.key === 'ArrowRight') nudgeWidth(prop, step);
      else if (e.key === 'Enter' || e.key === ' ') autoFitColumn(prop);
      else if (e.key === 'Backspace' || e.key === 'Delete') commitWidth(prop.id, null);
      else return;
      // Les flèches appartiennent à la poignée : ni scroll, ni curseur du document
      e.preventDefault();
      e.stopPropagation();
    },
    [nudgeWidth, autoFitColumn, commitWidth]
  );

  /* ---- Réordonnancement des lignes ---- */
  /**
   * Le déplacement ne se VOIT que pour qui regarde l'écran : sans annonce, un
   * lecteur d'écran ne sait pas ce qui vient de se passer. Le message porte un
   * numéro d'ordre pour que deux déplacements de suite vers la même place se
   * relisent quand même (un texte identique n'est pas ré-annoncé).
   */
  const [reorderNotice, setReorderNotice] = useState<{ seq: number; text: string } | null>(null);
  const reorderSeqRef = useRef(0);

  const applyRowOrder = useCallback(
    (rows: DbRow[] | null, movedRowId: string) => {
      // `null` = l'ordre ne bouge pas : aucun commit, la note ne se salit pas,
      // et rien n'est annoncé (il ne s'est rien passé)
      if (!rows) return;
      commitData({ ...dataRef.current, rows });
      const visible = new Set(visibleRowsRef.current.map((r) => r.id));
      const order = rows.filter((r) => visible.has(r.id)).map((r) => r.id);
      const at = order.indexOf(movedRowId);
      if (at < 0) return;
      reorderSeqRef.current += 1;
      setReorderNotice({
        seq: reorderSeqRef.current,
        text: t('notes.inlineDb.rowMoved', 'Row moved to position {{n}} of {{total}}', {
          n: at + 1,
          total: order.length,
        }),
      });
    },
    [commitData, t]
  );

  const onRowDragStart = useCallback((e: React.DragEvent<HTMLButtonElement>, rowId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    // MIME maison : le drop natif de ProseMirror ignore ce type (text/plain serait
    // recollé comme du texte au milieu de la note)
    e.dataTransfer.setData(DB_ROW_ORDER_MIME, rowId);
    const tr = e.currentTarget.closest('tr');
    if (tr) e.dataTransfer.setDragImage(tr, 12, 12);
    draggedRowIdRef.current = rowId;
    setDraggedRowId(rowId);
  }, []);

  const onRowDragOver = useCallback((e: React.DragEvent<HTMLTableRowElement>, rowId: string) => {
    if (!e.dataTransfer.types.includes(DB_ROW_ORDER_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Survoler sa propre ligne ne promet rien : aucun bord d'insertion
    if (rowId === draggedRowIdRef.current) {
      setDropHint((cur) => (cur === null ? cur : null));
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const place: DropPlace = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropHint((cur) =>
      cur && cur.rowId === rowId && cur.place === place ? cur : { rowId, place }
    );
  }, []);

  const onRowDrop = useCallback(
    (e: React.DragEvent<HTMLTableRowElement>, rowId: string) => {
      if (!e.dataTransfer.types.includes(DB_ROW_ORDER_MIME)) return;
      e.preventDefault();
      const dragged = e.dataTransfer.getData(DB_ROW_ORDER_MIME);
      const hint = dropHintRef.current;
      const place = hint?.rowId === rowId ? hint.place : 'after';
      setDropHint(null);
      draggedRowIdRef.current = null;
      setDraggedRowId(null);
      if (dragged) applyRowOrder(reorderRows(dataRef.current.rows, dragged, rowId, place), dragged);
    },
    [applyRowOrder]
  );

  const onRowDragEnd = useCallback(() => {
    draggedRowIdRef.current = null;
    setDraggedRowId(null);
    setDropHint(null);
  }, []);

  /** Repli clavier du glissé : la poignée déplace la ligne d'un cran */
  const onGripKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, rowId: string) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      e.stopPropagation();
      applyRowOrder(
        moveRowByOffset(
          dataRef.current.rows,
          visibleRowsRef.current.map((r) => r.id),
          rowId,
          e.key === 'ArrowUp' ? -1 : 1
        ),
        rowId
      );
    },
    [applyRowOrder]
  );

  /* ---- Navigation clavier dans la grille ---- */
  const focusCellAt = useCallback((row: number, col: number) => {
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-db-cell="${row}-${col}"]`);
    if (!el) return;
    setFocusCell({ row, col });
    el.focus();
  }, []);

  const onCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableCellElement>, row: number, col: number) => {
      // En édition, les touches appartiennent au champ : on ne s'en mêle pas
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        e.stopPropagation();
        enterCell(e.currentTarget);
        return;
      }
      const move = resolveGridMove(
        e.key,
        { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey },
        { row, col },
        // Bornes sur les colonnes AFFICHEES : masquer une colonne sans le dire
        // ici enverrait la fleche droite sur une cellule qui n'existe pas, et
        // le focus disparaitrait de la table.
        { rows: renderedRows.length, cols: shownProperties.length }
      );
      // La tabulation en fait partie : la grille ne la retient pas, le focus
      // sort de la table par le chemin habituel (aucun piège à focus)
      if (move === null) return;
      e.preventDefault();
      e.stopPropagation();
      focusCellAt(move.row, move.col);
    },
    [renderedRows.length, shownProperties.length, focusCellAt]
  );

  /**
   * Échap sort du champ et rend le focus à la cellule. En phase de CAPTURE :
   * les éditeurs arrêtent la propagation d'Échap (annuler une saisie ne doit
   * pas fermer le popover), la phase montante ne verrait donc rien.
   */
  const onCellKeyDownCapture = useCallback((e: React.KeyboardEvent<HTMLTableCellElement>) => {
    if (e.key !== 'Escape' || e.target === e.currentTarget) return;
    const td = e.currentTarget;
    requestAnimationFrame(() => {
      // Le champ a rendu la main (blur) : personne d'autre n'a pris le focus
      if (document.activeElement === document.body || document.activeElement === null) td.focus();
    });
  }, []);

  const onCellFocus = useCallback((row: number, col: number) => {
    setFocusCell((cur) => (cur.row === row && cur.col === col ? cur : { row, col }));
  }, []);

  // Une colonne (ou une ligne) supprimée laisserait la grille sans cellule
  // tabulable : la cible est ramenée dans les bornes à chaque rendu
  const rovingRow = Math.min(focusCell.row, Math.max(0, renderedRows.length - 1));
  const rovingCol = Math.min(focusCell.col, Math.max(0, shownProperties.length - 1));

  /** Largeur minimale de la table : au-delà, elle défile (les colonnes ne se rognent pas) */
  const tableMinWidth =
    GRIP_COL_WIDTH +
    ACTIONS_COL_WIDTH +
    shownProperties.reduce((sum, prop) => sum + widthOf(prop), 0);
  // Repère du geste de redimensionnement, qui repeint cette largeur sans React
  tableMinWidthRef.current = tableMinWidth;

  /* ---- Compléter depuis le lien (QW-13 v1) ----
   * Contrat privacy : la requête ne part QUE sur geste explicite de
   * l'utilisateur (clic ⚡, précédé sur web d'un opt-in) ; seule l'URL du
   * lien transite — jamais le contenu de la note ; l'URL n'est pas
   * journalisée côté serveur (contrat du proxy). */
  const flagMetaError = useCallback((rowId: string, kind: 'unreachable' | 'nothing' | 'nofill') => {
    setMetaError({ rowId, kind });
    if (metaErrorTimerRef.current !== null) window.clearTimeout(metaErrorTimerRef.current);
    metaErrorTimerRef.current = window.setTimeout(() => setMetaError(null), 4000);
  }, []);

  /** Remplit UNIQUEMENT les cellules vides de la ligne — commit unique horodaté */
  const applyMetadata = useCallback(
    (
      rowId: string,
      sourcePropId: string,
      meta: { title: string; description: string; image: string }
    ) => {
      const cur = dataRef.current;
      const row = cur.rows.find((r) => r.id === rowId);
      if (!row) return;
      const cells = { ...row.cells };
      const isEmpty = (propId: string) => {
        const v = cells[propId];
        return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
      };
      let changed = false;
      // title/description → 1re et 2e propriétés text vides, dans l'ordre des colonnes
      const emptyText = cur.properties.filter((p) => p.type === 'text' && isEmpty(p.id));
      if (meta.title && emptyText.length > 0) {
        cells[emptyText[0].id] = meta.title;
        changed = true;
      }
      if (meta.description && emptyText.length > 1) {
        cells[emptyText[1].id] = meta.description;
        changed = true;
      }
      if (meta.image) {
        const imgProp = cur.properties.find(
          (p) => p.type === 'url' && p.id !== sourcePropId && isEmpty(p.id)
        );
        if (imgProp) {
          cells[imgProp.id] = meta.image;
          changed = true;
        }
      }
      if (!changed) return false;
      onChange({
        ...cur,
        rows: cur.rows.map((r) => (r.id === rowId ? touchRow({ ...r, cells }) : r)),
      });
      return true;
    },
    [onChange]
  );

  const runFetchMeta = useCallback(
    async (rowId: string) => {
      const cur = dataRef.current;
      const row = cur.rows.find((r) => r.id === rowId);
      const link = row ? firstUrlCell(cur.properties, row) : null;
      if (!link) return;
      // Capturé avant le premier await : la fermeture du popover de
      // confirmation vide anchorElRef pendant le fetch
      const anchor = anchorElRef.current;
      setMetaError(null);
      setMetaFetchingRowId(rowId);
      try {
        // Desktop : ipcMain fetchPageMetadata (garde SSRF) ; web : proxy Worker opt-in
        const meta = (await window.electron?.ipcRenderer?.invoke('fetchPageMetadata', link.url)) as
          | { title?: string; description?: string; image?: string }
          | null
          | undefined;
        // null = la page n'a pas pu être lue (site bloquant les serveurs, réseau…)
        if (meta === null || meta === undefined) {
          flagMetaError(rowId, 'unreachable');
          return;
        }
        const title = (meta.title ?? '').trim();
        const description = (meta.description ?? '').trim();
        const image = (meta.image ?? '').trim();
        if (!title && !description && !image) {
          flagMetaError(rowId, 'nothing');
          return;
        }
        if (!applyMetadata(rowId, link.propId, { title, description, image })) {
          flagMetaError(rowId, 'nofill');
        }
      } catch {
        flagMetaError(rowId, 'unreachable');
      } finally {
        setMetaFetchingRowId(null);
        // L'ancre ⚡ était disabled pendant le fetch (focus tombé sur body) :
        // restitution une frame plus tard, quand elle est réactivée
        if (anchor) {
          requestAnimationFrame(() => {
            if (
              anchor.isConnected &&
              (document.activeElement === document.body || document.activeElement === null)
            ) {
              anchor.focus({ preventScroll: true });
            }
          });
        }
      }
    },
    [applyMetadata, flagMetaError]
  );

  /* ---- Compléter depuis la source du bloc (connecteurs) ----
   * Même contrat privacy que le lien : rien ne part sans clic ⚡ (et, sur web,
   * sans opt-in) ; seuls les quelques mots du titre de la ligne voyagent — et
   * la clé TMDB quand la source l'exige, jamais le contenu de la note. */
  const runConnectorSearch = useCallback(
    async (rowId: string, pos: PopoverPos) => {
      if (!sourceId) return;
      const cur = dataRef.current;
      const row = cur.rows.find((r) => r.id === rowId);
      if (!row) return;
      // Pas de titre → message d'aide, ZÉRO requête
      const query = rowSearchQuery(cur.properties, row.cells);
      if (query === '') {
        setConnectorFor({ rowId, pos, panel: { kind: 'noTitle' } });
        return;
      }
      const apiKey = CONNECTOR_SOURCES[sourceId].requiresApiKey ? getTmdbApiKey() : '';
      const lang = connectorLang();
      // Pré-vol avec la validation PARTAGÉE (la requête fabriquée est jetée) :
      // une clé absente ou malformée est expliquée ici, ZÉRO requête — sinon le
      // transport la rejetterait en silence et on afficherait « panne réseau »
      const preflight = buildConnectorRequest({ source: sourceId, query, apiKey, lang });
      if (!preflight.ok) {
        const keyProblem =
          preflight.error === 'missing_api_key' || preflight.error === 'invalid_api_key';
        setConnectorFor({
          rowId,
          pos,
          panel: keyProblem ? { kind: 'missingKey' } : { kind: 'error' },
        });
        return;
      }
      setMetaError(null);
      setConnectorFor({ rowId, pos, panel: { kind: 'loading' } });
      setMetaFetchingRowId(rowId);
      try {
        // Desktop : appel direct par le processus principal ; web : proxy Worker.
        // Les deux rendent le JSON amont BRUT, ou null — jamais de throw.
        const raw = await window.electron?.ipcRenderer?.invoke('connectors:lookup', {
          source: sourceId,
          query,
          ...(apiKey === '' ? {} : { apiKey }),
          lang,
        });
        if (raw === null || raw === undefined) {
          setConnectorFor((c) => (c && c.rowId === rowId ? { ...c, panel: { kind: 'error' } } : c));
          return;
        }
        // TMDB ne rend que des identifiants de genre : la table les nomme
        const movieGenres = sourceId === 'movies' ? await loadMovieGenres(apiKey, lang) : undefined;
        const results = normalize(sourceId, raw, { movieGenres }).slice(0, MAX_CONNECTOR_RESULTS);
        setConnectorFor((c) =>
          c && c.rowId === rowId
            ? {
                ...c,
                panel: results.length > 0 ? { kind: 'results', results } : { kind: 'empty' },
              }
            : c
        );
      } catch {
        setConnectorFor((c) => (c && c.rowId === rowId ? { ...c, panel: { kind: 'error' } } : c));
      } finally {
        setMetaFetchingRowId(null);
      }
    },
    [sourceId]
  );

  /**
   * Résultat choisi : cellules vides remplies et options de sélection créées
   * (genres) dans UN SEUL commit — une seule entrée d'historique, une seule
   * écriture de la note.
   */
  const applyConnectorResult = useCallback(
    (rowId: string, result: ConnectorResult) => {
      const cur = dataRef.current;
      const row = cur.rows.find((r) => r.id === rowId);
      if (!row) {
        setConnectorFor(null);
        return;
      }
      const updates = buildCellUpdates(result, cur.properties, row.cells);
      // Rien à écrire : on le dit SANS retirer la liste (le résultat suivant
      // reste à un clic), et on distingue « déjà rempli » — des colonnes
      // savaient l'accueillir — de « aucune colonne ne peut le recevoir »
      if (!hasCellUpdates(updates)) {
        const notice: ConnectorNotice = updates.skipped.length > 0 ? 'allFilled' : 'noColumn';
        setConnectorFor((c) =>
          c && c.rowId === rowId && c.panel.kind === 'results'
            ? { ...c, panel: { ...c.panel, notice } }
            : c
        );
        return;
      }
      // Options de genres créées ET cellules écrites dans LE MÊME changement,
      // sinon les cellules pointeraient un instant sur des options fantômes
      onChange({
        ...cur,
        properties: mergeNewOptions(cur.properties, updates.newOptions),
        rows: cur.rows.map((r) =>
          r.id === rowId ? touchRow({ ...r, cells: { ...r.cells, ...updates.cells } }) : r
        ),
      });
      setConnectorFor(null);
    },
    [onChange]
  );

  const onMetaClick = useCallback(
    (row: DbRow, e: React.MouseEvent<HTMLButtonElement>) => {
      if (metaFetchingRowId !== null) return;
      const anchor = e.currentTarget;
      // Source choisie : le ⚡ cherche dans la source au lieu de lire le lien
      if (sourceId) {
        // Re-clic sur la même ancre : referme (même geste que les autres popovers)
        if (connectorFor?.rowId === row.id || metaConfirmFor?.rowId === row.id) {
          setConnectorFor(null);
          setMetaConfirmFor(null);
          return;
        }
        anchorElRef.current = anchor;
        setEditorFor(null);
        setDropdownFor(null);
        setNotePickerFor(null);
        setRelPickerFor(null);
        setDatePickerFor(null);
        // Web sans opt-in CONNECTEURS : consentement d'abord — celui des aperçus
        // de liens ne vaut pas accord pour envoyer des termes de recherche
        if (isWebPlatform() && !isConnectorProxyOptedIn()) {
          setConnectorFor(null);
          setMetaConfirmFor({
            rowId: row.id,
            pos: anchorPos(anchor, META_CONFIRM_WIDTH, META_CONFIRM_EST_HEIGHT),
            intent: 'source',
          });
          return;
        }
        setMetaConfirmFor(null);
        void runConnectorSearch(row.id, anchorPos(anchor, CONNECTOR_WIDTH, CONNECTOR_EST_HEIGHT));
        return;
      }
      // Web sans opt-in : consentement d'abord — aucune requête ne part sans lui
      if (isWebPlatform() && !isMetaProxyOptedIn()) {
        const pos = anchorPos(anchor, META_CONFIRM_WIDTH, META_CONFIRM_EST_HEIGHT);
        anchorElRef.current = anchor;
        setEditorFor(null);
        setDropdownFor(null);
        setNotePickerFor(null);
        setRelPickerFor(null);
        setDatePickerFor(null);
        setMetaConfirmFor((c) =>
          c && c.rowId === row.id ? null : { rowId: row.id, pos, intent: 'link' }
        );
        return;
      }
      // Ancre mémorisée aussi sur le chemin direct : runFetchMeta lui rend le focus
      anchorElRef.current = anchor;
      void runFetchMeta(row.id);
    },
    [
      metaFetchingRowId,
      anchorPos,
      runFetchMeta,
      sourceId,
      connectorFor,
      metaConfirmFor,
      runConnectorSearch,
    ]
  );

  const toggleDropdown = useCallback(
    (row: DbRow, prop: DbProperty, e: React.MouseEvent<HTMLButtonElement>) => {
      const pos = anchorPos(e.currentTarget, DROPDOWN_WIDTH, DROPDOWN_EST_HEIGHT);
      anchorElRef.current = e.currentTarget;
      setEditorFor(null);
      setNotePickerFor(null);
      setRelPickerFor(null);
      setConnectorFor(null);
      setDatePickerFor(null);
      setDropdownFor((cur) =>
        cur && cur.rowId === row.id && cur.propId === prop.id
          ? null
          : { rowId: row.id, propId: prop.id, pos }
      );
    },
    [anchorPos]
  );

  const toggleNotePicker = useCallback(
    (row: DbRow, prop: DbProperty, e: React.MouseEvent<HTMLButtonElement>) => {
      const pos = anchorPos(e.currentTarget, NOTE_PICKER_WIDTH, NOTE_PICKER_EST_HEIGHT);
      anchorElRef.current = e.currentTarget;
      setEditorFor(null);
      setDropdownFor(null);
      setConnectorFor(null);
      setRelPickerFor(null);
      setDatePickerFor(null);
      setNoteQuery('');
      setNotePickerFor((cur) =>
        cur && cur.rowId === row.id && cur.propId === prop.id
          ? null
          : { rowId: row.id, propId: prop.id, pos }
      );
    },
    [anchorPos]
  );

  const toggleRelPicker = useCallback(
    (row: DbRow, prop: DbProperty, e: React.MouseEvent<HTMLButtonElement>) => {
      const pos = anchorPos(e.currentTarget, REL_PICKER_WIDTH, REL_PICKER_EST_HEIGHT);
      anchorElRef.current = e.currentTarget;
      setEditorFor(null);
      setDropdownFor(null);
      setNotePickerFor(null);
      setConnectorFor(null);
      setDatePickerFor(null);
      setRelQuery('');
      setRelPickerFor((cur) =>
        cur && cur.rowId === row.id && cur.propId === prop.id
          ? null
          : { rowId: row.id, propId: prop.id, pos }
      );
    },
    [anchorPos]
  );

  /** Sélecteur de date : même bascule que les autres popovers (re-clic = ferme) */
  const toggleDatePicker = useCallback(
    (row: DbRow, prop: DbProperty, e: React.MouseEvent<HTMLButtonElement>) => {
      const pos = anchorPos(e.currentTarget, DATE_PICKER_WIDTH, DATE_PICKER_EST_HEIGHT);
      anchorElRef.current = e.currentTarget;
      setEditorFor(null);
      setDropdownFor(null);
      setNotePickerFor(null);
      setRelPickerFor(null);
      setConnectorFor(null);
      setDatePickerFor((cur) =>
        cur && cur.rowId === row.id && cur.propId === prop.id
          ? null
          : { rowId: row.id, propId: prop.id, pos }
      );
    },
    [anchorPos]
  );

  /**
   * Bascule d'un lien. La cellule garde les identifiants dans l'ORDRE des
   * clics ; vidée, elle disparaît (une cellule absente et un tableau vide
   * doivent se lire pareil).
   *
   * Colonne « un seul lien » : le choix REMPLACE ce qui était là — y compris
   * quand la cellule en portait plusieurs (contrainte posée après coup). Rien
   * n'est effacé ailleurs : les autres lignes gardent leurs liens jusqu'à ce
   * qu'on les touche, ou qu'on demande la réduction depuis l'éditeur de colonne.
   */
  const toggleRelationLink = useCallback(
    (rowId: string, propId: string, targetRowId: string) => {
      const cur = dataRef.current;
      const row = cur.rows.find((r) => r.id === rowId);
      if (!row) return;
      const single = cur.properties.find((p) => p.id === propId)?.single === true;
      const ids = relationIds(row.cells[propId]);
      const next = ids.includes(targetRowId)
        ? ids.filter((id) => id !== targetRowId)
        : single
          ? [targetRowId]
          : [...ids, targetRowId];
      setCell(rowId, propId, next.length > 0 ? next : undefined);
    },
    [setCell]
  );

  /**
   * CRÉE UNE LIGNE DANS LA BASE VISÉE, sans quitter la cellule, et la lie.
   *
   * Trois situations, trois traitements — parce que le contenu d'une base ne
   * vit pas au même endroit selon où elle est :
   *  - la base VISÉE EST CELLE-CI (relation vers soi) : simple mutation locale,
   *    ligne et lien dans le même commit ;
   *  - la base vit dans une AUTRE note : sa note est réécrite dans le store
   *    (même geste que la propagation des renommages), puis le lien est posé ici ;
   *  - la base vit dans la note OUVERTE dans l'éditeur, mais dans un autre bloc :
   *    on renonce. Là, c'est le document en mémoire de ProseMirror qui fait foi,
   *    et il écraserait la ligne à la frappe suivante — mieux vaut le dire que
   *    faire disparaître une ligne dix secondes plus tard.
   *
   * Rend `false` quand rien n'a été créé : l'appelant affiche alors pourquoi.
   */
  const createRelationRow = useCallback(
    (rowId: string, prop: DbProperty, title: string): boolean => {
      const cur = dataRef.current;
      const targetDbId = prop.targetDbId ?? '';
      const trimmed = title.trim();
      if (targetDbId === '' || trimmed === '' || prop.direction === 'in') return false;

      // Base courante : tout est déjà là, une seule écriture suffit
      if (targetDbId === selfDbId) {
        const titleProp = titlePropertyOf(cur.properties);
        if (!titleProp) return false;
        const created = newRow(cur.properties, { ...rowDefaults, [titleProp.id]: trimmed });
        const ids = relationIds(cur.rows.find((r) => r.id === rowId)?.cells[prop.id]);
        const nextIds = prop.single === true ? [created.id] : [...ids, created.id];
        onChange({
          ...cur,
          rows: [...cur.rows, created].map((r) =>
            r.id === rowId ? touchRow({ ...r, cells: { ...r.cells, [prop.id]: nextIds } }) : r
          ),
        });
        return true;
      }

      const target = linkCtx?.getDb(targetDbId);
      const noteId = target?.noteId ?? '';
      if (!target || noteId === '') return false;
      // Note tenue par UN éditeur, quel que soit le panneau : sa version en
      // mémoire gagnerait
      if (heldNotes.has(noteId)) return false;
      const note = notesById[noteId];
      if (!note || note.deletedAt) return false;
      const titleProp = titlePropertyOf(target.properties);
      if (!titleProp) return false;

      const created = newRow(target.properties, { [titleProp.id]: trimmed });
      const content = appendRowToNoteContent(note.content ?? '', targetDbId, created);
      if (content === null) return false;
      // `plainText` ne bouge pas : une base vit dans les attrs du nœud, elle
      // n'apporte aucun texte au document (et c'est lui que la recherche lit)
      dispatch(updateNoteContent({ id: noteId, content, plainText: note.plainText ?? '' }));
      toggleRelationLink(rowId, prop.id, created.id);
      return true;
    },
    [dispatch, heldNotes, linkCtx, notesById, onChange, rowDefaults, selfDbId, toggleRelationLink]
  );

  /**
   * Réduction à un seul lien par ligne, sur DEMANDE (bouton de l'éditeur de
   * colonne). Cascade de schéma comme la suppression d'options : les lignes ne
   * sont pas horodatées pour autant.
   */
  const keepFirstLinkOnly = useCallback(
    (propId: string) => {
      const cur = dataRef.current;
      const { rows, changed } = trimToSingleLinks(cur.rows, propId);
      if (changed === 0) return;
      onChange({ ...cur, rows });
    },
    [onChange]
  );

  /**
   * ÉTAT DE LA COLONNE MIROIR d'une relation sortante : la colonne de
   * rétroliens, dans la base visée, qui montre l'autre côté du lien.
   *
   * `none` : rien à proposer (relation non configurée, base illisible).
   * `exists` : la base visée la porte déjà.
   * `blocked` : la base visée vit dans une note qu'un éditeur tient — son
   *   document en mémoire écraserait l'écriture (cf. `createRelationRow`).
   * `available` : un clic suffit.
   */
  const backlinkColumnState = useCallback(
    (prop: DbProperty): 'none' | 'exists' | 'blocked' | 'available' => {
      const targetDbId = prop.targetDbId ?? '';
      if (prop.type !== 'relation' || prop.direction === 'in' || targetDbId === '') return 'none';
      if (selfDbId === '') return 'none';
      const target = linkCtx?.getDb(targetDbId);
      if (!target) return 'none';
      const mirrors = target.properties.some(
        (p) =>
          p.type === 'relation' &&
          p.direction === 'in' &&
          p.targetDbId === selfDbId &&
          p.sourcePropertyId === prop.id
      );
      if (mirrors) return 'exists';
      if (targetDbId === selfDbId) return 'available';
      const noteId = target.noteId ?? '';
      if (noteId === '' || !notesById[noteId] || notesById[noteId].deletedAt) return 'none';
      return heldNotes.has(noteId) ? 'blocked' : 'available';
    },
    [heldNotes, linkCtx, notesById, selfDbId]
  );

  /**
   * POSE LA COLONNE DE RÉTROLIENS DANS LA BASE VISÉE — l'équivalent de la
   * propriété miroir de Notion, en un clic, depuis ce côté-ci du lien.
   *
   * Ce qui est écrit là-bas ne stocke RIEN : c'est une colonne calculée, qui se
   * relit depuis cette relation-ci. Elle ne peut donc pas diverger, et la
   * supprimer ne perd aucune donnée. C'est ce qui rend cette écriture unique
   * acceptable, là où un vrai miroir demanderait de réécrire la note d'en face
   * à CHAQUE lien posé.
   */
  const createBacklinkColumn = useCallback(
    (prop: DbProperty): boolean => {
      if (backlinkColumnState(prop) !== 'available') return false;
      const targetDbId = prop.targetDbId ?? '';
      const target = linkCtx?.getDb(targetDbId);
      if (!target) return false;
      const selfLabel = (linkCtx?.getDb(selfDbId)?.label ?? '').trim();
      const created: DbProperty = {
        id: newId(),
        name:
          selfLabel !== ''
            ? selfLabel
            : t('notes.inlineDb.relationBacklinkColumn', 'Backlinks · {{name}}', {
                name: prop.name,
              }),
        type: 'relation',
        direction: 'in',
        targetDbId: selfDbId,
        sourcePropertyId: prop.id,
      };

      // Relation vers SOI : la colonne miroir vit dans cette base-ci
      if (targetDbId === selfDbId) {
        const cur = dataRef.current;
        onChange({ ...cur, properties: [...cur.properties, created] });
        return true;
      }

      const noteId = target.noteId ?? '';
      const note = notesById[noteId];
      if (!note) return false;
      const content = appendPropertyToNoteContent(note.content ?? '', targetDbId, created);
      if (content === null) return false;
      // `plainText` ne bouge pas : une base vit dans les attrs du nœud
      dispatch(updateNoteContent({ id: noteId, content, plainText: note.plainText ?? '' }));
      return true;
    },
    [backlinkColumnState, dispatch, linkCtx, notesById, onChange, selfDbId, t]
  );

  /** Retire les identifiants qui ne désignent plus aucune ligne (geste explicite) */
  const dropMissingLinks = useCallback(
    (rowId: string, propId: string, missing: string[]) => {
      if (missing.length === 0) return;
      const cur = dataRef.current;
      const row = cur.rows.find((r) => r.id === rowId);
      if (!row) return;
      const gone = new Set(missing);
      const kept = relationIds(row.cells[propId]).filter((id) => !gone.has(id));
      setCell(rowId, propId, kept.length > 0 ? kept : undefined);
    },
    [setCell]
  );

  /* ---- Rendu d'une cellule selon le type de sa propriété ----
   * `ui` porte l'état d'interface de CETTE ligne (cf. RowUi) : sans lui, la
   * fonction dépendrait des popovers ouverts et changerait d'identité à chaque
   * geste, ce qui re-rendrait toutes les lignes mémoïsées d'un coup. */
  const renderCell = useCallback(
    (prop: DbProperty, row: DbRow, ui: RowUi): React.ReactNode => {
      const value = row.cells[prop.id];
      const cellLabel = t('notes.inlineDb.editCell', 'Edit {{name}}', { name: prop.name });
      // Invite discrète des cellules vides : effacée au repos, révélée au survol
      // de la ligne et au focus clavier (voir .inline-db__cell-hint)
      const emptyHint = t('notes.inlineDb.cellEmpty', 'Empty');
      switch (prop.type) {
        case 'person': {
          // Saisie par NOMS separes par des virgules : sans annuaire local, il
          // n'y a rien de plus honnete a proposer (cf. people.ts). Les
          // pastilles s'affichent des que la cellule n'est plus en cours de
          // saisie.
          const names = peopleOf(value);
          return (
            <div className="inline-db__cell-flex inline-db__cell-people">
              {names.length > 0 && (
                <span className="inline-db__people" aria-hidden="true">
                  {names.slice(0, 3).map((name) => (
                    <span
                      key={name}
                      className={`inline-db__person inline-db__person--c${personColorIndex(name, 8)}`}
                      title={name}
                    >
                      {initialsOf(name)}
                    </span>
                  ))}
                  {names.length > 3 && (
                    <span className="inline-db__person inline-db__person--more">
                      +{names.length - 3}
                    </span>
                  )}
                </span>
              )}
              <DraftInput
                className="inline-db__cell-input"
                value={names.join(', ')}
                placeholder={emptyHint}
                ariaLabel={cellLabel}
                onCommit={(raw) => setCell(row.id, prop.id, writePeople(raw.split(',')))}
              />
            </div>
          );
        }
        case 'text':
          return (
            <DraftInput
              className="inline-db__cell-input"
              value={strValue(value)}
              placeholder={emptyHint}
              ariaLabel={cellLabel}
              onCommit={(raw) => setCell(row.id, prop.id, raw === '' ? undefined : raw)}
            />
          );
        case 'url': {
          const v = strValue(value);
          const href = externalHref(v);
          const linkLabel = t('notes.inlineDb.openLink', 'Open link');
          return (
            <div className="inline-db__cell-flex">
              <DraftInput
                className="inline-db__cell-input inline-db__cell-input--url"
                value={v}
                placeholder={emptyHint}
                inputMode="url"
                ariaLabel={cellLabel}
                onCommit={(raw) => setCell(row.id, prop.id, raw === '' ? undefined : raw)}
              />
              {href !== null && (
                <a
                  className="inline-db__cell-linkout"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={linkLabel}
                  title={linkLabel}
                  onClick={(e) => {
                    // Desktop : la navigation de la fenêtre est bloquée, on passe
                    // par le canal qui ouvre le navigateur du système
                    if (window.electron) {
                      e.preventDefault();
                      window.electron?.ipcRenderer?.send('open-external', href);
                    }
                  }}
                >
                  {typeIcon('url')}
                </a>
              )}
            </div>
          );
        }
        case 'number': {
          const n = numValue(value);
          return (
            <DraftInput
              className="inline-db__cell-input inline-db__cell-input--number"
              value={n === null ? '' : formatDecimalPlain(n, locale)}
              display={n === null ? '' : formatDecimal(n, locale)}
              placeholder={emptyHint}
              inputMode="decimal"
              ariaLabel={cellLabel}
              onCommit={(raw) => {
                const parsed = parseDecimal(raw, locale);
                setCell(row.id, prop.id, parsed === null ? undefined : parsed);
              }}
            />
          );
        }
        case 'checkbox':
          return (
            <span className="inline-db__cell-check">
              <Checkbox
                size="sm"
                checked={value === true}
                aria-label={cellLabel}
                containerClassName="inline-db__cell-checkbox"
                onChange={(e) => setCell(row.id, prop.id, e.target.checked)}
              />
            </span>
          );
        case 'date': {
          const iso = dateValue(value);
          const open = ui.datePropId === prop.id;
          return (
            <button
              type="button"
              className="inline-db__cell-btn inline-db__date-btn"
              data-db-anchor=""
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label={cellLabel}
              onClick={(e) => toggleDatePicker(row, prop, e)}
            >
              {iso !== '' ? (
                <span className="inline-db__date-value">{formatDisplayDate(iso, locale)}</span>
              ) : (
                <span className="inline-db__cell-hint">
                  {t('notes.inlineDb.datePick', 'Pick a date')}
                </span>
              )}
            </button>
          );
        }
        case 'select': {
          const opt =
            typeof value === 'string' ? prop.options?.find((o) => o.id === value) : undefined;
          const open = ui.dropdownPropId === prop.id;
          return (
            <button
              type="button"
              className="inline-db__cell-btn"
              data-db-anchor=""
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={cellLabel}
              onClick={(e) => toggleDropdown(row, prop, e)}
            >
              {opt ? (
                <span className="inline-db__option-pill" style={pillStyle(opt.color)}>
                  {opt.label || t('notes.inlineDb.untitled', 'Untitled')}
                </span>
              ) : (
                <span className="inline-db__cell-hint">
                  {t('notes.inlineDb.selectEmpty', 'Select…')}
                </span>
              )}
            </button>
          );
        }
        case 'multiSelect': {
          const ids = selectedIds(value);
          const opts = (prop.options ?? []).filter((o) => ids.includes(o.id));
          const open = ui.dropdownPropId === prop.id;
          return (
            <button
              type="button"
              className="inline-db__cell-btn"
              data-db-anchor=""
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={cellLabel}
              onClick={(e) => toggleDropdown(row, prop, e)}
            >
              {opts.length === 0 ? (
                <span className="inline-db__cell-hint">
                  {t('notes.inlineDb.selectEmpty', 'Select…')}
                </span>
              ) : (
                opts.map((o) => (
                  <span key={o.id} className="inline-db__option-pill" style={pillStyle(o.color)}>
                    {o.label || t('notes.inlineDb.untitled', 'Untitled')}
                  </span>
                ))
              )}
            </button>
          );
        }
        case 'email':
        case 'phone': {
          const v = strValue(value);
          // L'icône n'apparaît QUE sur une valeur réellement appelable/écrivable :
          // un lien mort ferait plus bricolage qu'une cellule sans icône
          const href = prop.type === 'email' ? mailtoHref(v) : telHref(v);
          const linkLabel =
            prop.type === 'email'
              ? t('notes.inlineDb.sendEmail', 'Send an email')
              : t('notes.inlineDb.callPhone', 'Call this number');
          return (
            <div className="inline-db__cell-flex">
              <DraftInput
                className="inline-db__cell-input"
                value={v}
                placeholder={emptyHint}
                inputMode={prop.type === 'email' ? 'email' : 'tel'}
                ariaLabel={cellLabel}
                onCommit={(raw) => setCell(row.id, prop.id, raw === '' ? undefined : raw)}
              />
              {href !== null && (
                <a
                  className="inline-db__cell-linkout"
                  href={href}
                  aria-label={linkLabel}
                  title={linkLabel}
                  onClick={(e) => {
                    // Desktop : will-navigate bloque mailto/tel — on passe par le canal open-external
                    if (window.electron) {
                      e.preventDefault();
                      window.electron?.ipcRenderer?.send('open-external', href);
                    }
                  }}
                >
                  {typeIcon(prop.type)}
                </a>
              )}
            </div>
          );
        }
        case 'rating': {
          const current = ratingValue(value);
          const preview = ui.ratingPropId === prop.id ? ui.ratingValue : 0;
          const shown = preview > 0 ? preview : current;
          const setRating = (k: number) => setCell(row.id, prop.id, k === 0 ? undefined : k);
          return (
            <div
              className={`inline-db__stars${preview > 0 ? ' inline-db__stars--preview' : ''}`}
              role="group"
              aria-label={cellLabel}
              onMouseLeave={() => setRatingHover(null)}
              onKeyDown={(e) => {
                // Une évaluation se règle aux flèches, comme un curseur
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setRating(Math.min(5, current + 1));
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  setRating(Math.max(0, current - 1));
                } else if (e.key === 'Backspace' || e.key === 'Delete') {
                  e.preventDefault();
                  setRating(0);
                }
              }}
            >
              {[1, 2, 3, 4, 5].map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`inline-db__star ${k <= shown ? 'inline-db__star--on' : ''}`}
                  aria-label={t('notes.inlineDb.starLabel', '{{count}} stars out of 5', {
                    count: k,
                  })}
                  aria-pressed={k <= current}
                  // Tabulation tournante : une cellule évaluation = un seul arrêt
                  tabIndex={k === Math.max(1, current) ? 0 : -1}
                  onMouseEnter={() => setRatingHover({ rowId: row.id, propId: prop.id, value: k })}
                  onClick={() => setRating(k === current ? 0 : k)}
                >
                  <svg
                    width={14}
                    height={14}
                    viewBox="0 0 24 24"
                    fill={k <= shown ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polygon points="12 2.5 15.09 8.76 22 9.77 17 14.64 18.18 21.52 12 18.27 5.82 21.52 7 14.64 2 9.77 8.91 8.76" />
                  </svg>
                </button>
              ))}
            </div>
          );
        }
        case 'progress': {
          const n = progressValue(value);
          const editing = ui.progressPropId === prop.id;
          if (editing) {
            return (
              <span className="inline-db__progress-edit">
                <DraftInput
                  className="inline-db__cell-input inline-db__cell-input--number"
                  value={n === null ? '' : formatDecimalPlain(n, locale)}
                  inputMode="decimal"
                  ariaLabel={cellLabel}
                  autoFocus
                  onCommit={(raw) => {
                    const parsed = parseDecimal(raw, locale);
                    setCell(
                      row.id,
                      prop.id,
                      parsed === null ? undefined : Math.max(0, Math.min(100, parsed))
                    );
                  }}
                  onDone={() => setProgressEditFor(null)}
                />
              </span>
            );
          }
          return (
            <button
              type="button"
              className={`inline-db__progress-btn${
                n === null ? ' inline-db__progress-btn--empty' : ''
              }`}
              aria-label={cellLabel}
              onClick={() => setProgressEditFor({ rowId: row.id, propId: prop.id })}
            >
              {/* La piste reste dessinée à vide : une cellule sans valeur doit
                  montrer où cliquer, pas un trou dans la colonne */}
              <span className="inline-db__progress-track" aria-hidden="true">
                <span className="inline-db__progress-fill" style={{ width: `${n ?? 0}%` }} />
              </span>
              {n !== null ? (
                <span className="inline-db__progress-value">
                  {t('notes.inlineDb.percent', '{{n}}%', { n: Math.round(n) })}
                </span>
              ) : (
                <span className="inline-db__progress-value inline-db__cell-hint">{emptyHint}</span>
              )}
            </button>
          );
        }
        case 'note': {
          const noteId = strValue(value);
          const open = ui.notePropId === prop.id;
          if (!noteId) {
            return (
              <button
                type="button"
                className="inline-db__note-btn"
                data-db-anchor=""
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={t('notes.inlineDb.linkNote', 'Link a note')}
                onClick={(e) => toggleNotePicker(row, prop, e)}
              >
                <span className="inline-db__cell-hint">
                  {t('notes.inlineDb.linkNote', 'Link a note')}
                </span>
              </button>
            );
          }
          return (
            <NoteLinkCell
              noteId={noteId}
              onOpen={goToNote}
              onUnlink={() => setCell(row.id, prop.id, undefined)}
            />
          );
        }
        case 'relation': {
          const res = resolveRelation(prop, row, env);
          const open = ui.relPropId === prop.id;
          // Rétroliens : colonne CALCULÉE, jamais modifiable ici — ce qu'elle
          // montre se change dans la base d'en face
          const backlink = prop.direction === 'in';
          // Aucune cible choisie : on le dit, sans ouvrir un sélecteur vide
          if (res.status === 'unset') {
            return (
              <span className="inline-db__rel-hint">
                {backlink
                  ? t(
                      'notes.inlineDb.relationNoSource',
                      'Pick the column that points here, in the column settings'
                    )
                  : t('notes.inlineDb.relationNoTarget', 'Pick a database in the column settings')}
              </span>
            );
          }
          // Base introuvable : la VALEUR reste stockée, on affiche seulement
          // qu'on ne sait pas la lire (note fermée, supprimée, bloc effacé)
          if (res.status === 'unavailable') {
            return (
              <span
                className="inline-db__rel-unavailable"
                title={t(
                  'notes.inlineDb.relationUnavailableHelp',
                  'The target database is not in this vault (or its note has been deleted). The links are kept as they are.'
                )}
              >
                {res.ids.length > 0
                  ? t(
                      'notes.inlineDb.relationUnavailableKept',
                      'Database unavailable ({{count}})',
                      {
                        count: res.ids.length,
                      }
                    )
                  : t('notes.inlineDb.relationUnavailable', 'Database unavailable')}
              </span>
            );
          }
          // La note qui porte la base visée : c'est elle qu'ouvre une pastille.
          // Absente (base d'une note jamais enregistrée, contexte d'export), la
          // pastille reste lisible — elle n'ouvre simplement rien.
          const hostNoteId = res.target.noteId ?? '';
          const hostNoteTitle =
            (res.target.noteTitle ?? '').trim() || t('notes.inlineDb.untitled', 'Untitled');
          const openRowLabel = t('notes.inlineDb.relationOpenRow', 'Open in « {{note}} »', {
            note: hostNoteTitle,
          });
          return (
            <div className="inline-db__rel-cell">
              {res.links.map((l) => {
                const title = l.title || t('notes.inlineDb.untitled', 'Untitled');
                return hostNoteId !== '' ? (
                  <button
                    key={l.rowId}
                    type="button"
                    className="inline-db__rel-pill inline-db__rel-pill--open"
                    title={openRowLabel}
                    aria-label={`${title} — ${openRowLabel}`}
                    onClick={() => goToNote(hostNoteId)}
                  >
                    {title}
                  </button>
                ) : (
                  <span key={l.rowId} className="inline-db__rel-pill">
                    {title}
                  </span>
                );
              })}
              {res.missing.length > 0 && (
                <span
                  className="inline-db__rel-pill inline-db__rel-pill--missing"
                  title={t(
                    'notes.inlineDb.relationMissingHelp',
                    'Kept links whose row no longer exists in the target database — open this cell to remove them.'
                  )}
                >
                  {t('notes.inlineDb.relationMissing', '{{count}} not found', {
                    count: res.missing.length,
                  })}
                </span>
              )}
              {/* Le bouton d'édition occupe TOUT le reste de la cellule : cliquer
                  à côté des pastilles ouvre le sélecteur, comme avant */}
              {backlink ? (
                res.links.length === 0 && (
                  <span className="inline-db__rel-fill inline-db__cell-hint">
                    {t('notes.inlineDb.relationNoBacklink', 'No backlink')}
                  </span>
                )
              ) : (
                <button
                  type="button"
                  className="inline-db__rel-fill"
                  data-db-anchor=""
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-label={cellLabel}
                  onClick={(e) => toggleRelPicker(row, prop, e)}
                >
                  {res.links.length === 0 && res.missing.length === 0 && (
                    <span className="inline-db__cell-hint">
                      {t('notes.inlineDb.relationPick', 'Link rows')}
                    </span>
                  )}
                </button>
              )}
            </div>
          );
        }
        case 'formula': {
          // DERIVEE, jamais lue dans `cells` : une valeur stockee survivrait au
          // changement de la formule et afficherait un chiffre perime.
          const evaluated = evaluateFormula(prop.formula ?? '', {
            properties: env.properties,
            row,
          });
          const shown = formatFormulaValue(evaluated, locale);
          return (
            <span
              className={`inline-db__cell-rollup ${
                evaluated.ok ? '' : 'inline-db__cell-formula--error'
              }`}
              title={evaluated.ok ? shown : evaluated.error.message}
            >
              {shown}
            </span>
          );
        }
        case 'rollup': {
          const res = computeRollup(prop, row, env);
          if (res.status === 'unavailable') {
            return (
              <span
                className="inline-db__cell-rollup inline-db__cell-rollup--unavailable"
                title={t('notes.inlineDb.rollupUnavailable', 'Target database unavailable')}
              >
                —
              </span>
            );
          }
          // Agrégat impossible (relation absente, types incompatibles) : vide,
          // jamais un zéro qui passerait pour un résultat. Une liste de valeurs se
          // relit en entier au survol — la colonne est souvent plus étroite qu'elle.
          const rollupText = formatRollupResult(res);
          return (
            <span
              className={`inline-db__cell-rollup ${
                res.status === 'text' ? 'inline-db__cell-rollup--text' : ''
              }`}
              title={res.status === 'text' ? rollupText : undefined}
            >
              {rollupText}
            </span>
          );
        }
        case 'createdTime':
        case 'updatedTime':
          return (
            <span className="inline-db__cell-time">
              {formatDbTimestamp(prop.type === 'createdTime' ? row.createdAt : row.updatedAt)}
            </span>
          );
        default:
          return null;
      }
    },
    [
      env,
      goToNote,
      locale,
      setCell,
      setProgressEditFor,
      setRatingHover,
      t,
      toggleDatePicker,
      toggleDropdown,
      toggleNotePicker,
      toggleRelPicker,
    ]
  );

  const editorProp = editorFor ? data.properties.find((p) => p.id === editorFor.propId) : undefined;
  const editorPropIndex = editorProp
    ? data.properties.findIndex((p) => p.id === editorProp.id)
    : -1;
  const ddProp = dropdownFor ? data.properties.find((p) => p.id === dropdownFor.propId) : undefined;
  const ddRow = dropdownFor ? data.rows.find((r) => r.id === dropdownFor.rowId) : undefined;
  const ddValue = ddProp && ddRow ? ddRow.cells[ddProp.id] : undefined;
  const dateProp = datePickerFor
    ? data.properties.find((p) => p.id === datePickerFor.propId)
    : undefined;
  const dateRow = datePickerFor ? data.rows.find((r) => r.id === datePickerFor.rowId) : undefined;

  // Résultats du sélecteur de note : titres du coffre, corbeille exclue, 8 max
  const noteResults = (() => {
    if (!notePickerFor) return [];
    const q = noteQuery.trim().toLowerCase();
    return Object.values(notesById)
      .filter((n) => !n.deletedAt && (q === '' || (n.title || '').toLowerCase().includes(q)))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, MAX_NOTE_RESULTS);
  })();

  /* ---- Sélecteur de lignes liées ---- */
  const relProp = relPickerFor
    ? data.properties.find((p) => p.id === relPickerFor.propId)
    : undefined;
  const relRow = relPickerFor ? data.rows.find((r) => r.id === relPickerFor.rowId) : undefined;
  const relRes = relProp && relRow ? resolveRelation(relProp, relRow, env) : undefined;
  const relSelected = new Set(relRes?.status === 'ok' ? relRes.links.map((l) => l.rowId) : []);
  /**
   * Deux colonnes de plus que le titre, pour reconnaître une ligne sans ouvrir
   * la base d'en face : une pastille de sélection, une date… (cf.
   * `secondaryPropertiesOf`, qui décide de l'ordre de préférence).
   */
  const relSecondary =
    relRes?.status === 'ok' ? secondaryPropertiesOf(relRes.target.properties) : [];
  const relTargetEnv: DbEnv | undefined =
    relRes?.status === 'ok'
      ? { properties: relRes.target.properties, ...(linkCtx ? { ctx: linkCtx } : {}) }
      : undefined;
  const relTrimmedQuery = relQuery.trim();
  // Lignes proposées : celles de la base visée, recherche sur le titre.
  // Une ligne sans titre reste choisissable (elle s'affiche « Sans titre »).
  const relResults = (() => {
    if (!relRes || relRes.status !== 'ok') return [];
    const q = relTrimmedQuery.toLowerCase();
    const props = relRes.target.properties;
    return relRes.target.rows
      .filter((r) => q === '' || rowTitleOf(props, r).toLowerCase().includes(q))
      .slice(0, MAX_RELATION_RESULTS)
      .map((r) => ({ id: r.id, title: rowTitleOf(props, r), row: r }));
  })();
  /**
   * Créer la ligne cherchée : proposé dès que la recherche ne tombe pas
   * EXACTEMENT sur un titre existant (sinon on inviterait à faire un doublon
   * de ce qui est déjà sous les yeux). La cible doit pouvoir accueillir un
   * titre — sans colonne texte, la ligne créée serait anonyme.
   */
  const relCanCreate =
    relRes?.status === 'ok' &&
    relProp !== undefined &&
    relProp.direction !== 'in' &&
    relTrimmedQuery !== '' &&
    !!titlePropertyOf(relRes.target.properties) &&
    !relRes.target.rows.some(
      (r) => rowTitleOf(relRes.target.properties, r).toLowerCase() === relTrimmedQuery.toLowerCase()
    );
  /** La base visée vit-elle dans une note qu'un éditeur tient ? (création impossible) */
  const relTargetLocked =
    relRes?.status === 'ok' &&
    (relProp?.targetDbId ?? '') !== selfDbId &&
    heldNotes.has(relRes.target.noteId ?? '');

  // Web sans accord préalable : le clic ⚡ ouvre d'abord la confirmation
  const metaNeedsOptIn = isWebPlatform() && !isMetaProxyOptedIn();

  /* Libellés communs à toutes les lignes : calculés ICI, jamais dans la ligne
     mémoïsée — trois cents abonnements i18n de plus n'apporteraient rien */
  const metaLabel = sourceId
    ? t('notes.inlineDb.fillFromSource', 'Fill from {{source}}', { source: sourceLabel })
    : t('notes.inlineDb.fillFromLink', 'Fill from link');
  const metaUnreachableLabel = t(
    'notes.inlineDb.fillFromLinkUnreachable',
    'Could not reach the page (the site may block servers) — try from the desktop app'
  );
  const metaNoFillLabel = t(
    'notes.inlineDb.fillFromLinkNoEmpty',
    'No empty cell to fill on this row'
  );
  const metaNothingLabel = t('notes.inlineDb.fillFromLinkNothing', 'Nothing found on this page');
  const gripTitle = manualOrder
    ? t('notes.inlineDb.reorderRowHint', 'Drag to move this row · arrow keys move it one step')
    : t(
        'notes.inlineDb.reorderBlockedBySort',
        'A sort is on: rows follow it. Remove the sort to order them by hand.'
      );
  const deleteRowLabel = t('notes.inlineDb.deleteRow', 'Delete row');
  const duplicateRowLabel = t('notes.inlineDb.duplicateRow', 'Duplicate row');
  const openRowLabel = t('notes.inlineDb.openRow', 'Open as a page');
  const collapseLabel = t('notes.inlineDb.toggleSubItems', 'Show or hide sub-items');

  /** Libelle de chaque calcul, dans la langue de l'app. */
  const calcLabels: Record<DbCalculation, string> = useMemo(
    () => ({
      none: t('notes.inlineDb.calcNone', 'Calculate'),
      count: t('notes.inlineDb.calcCount', 'Count all'),
      notEmpty: t('notes.inlineDb.calcNotEmpty', 'Not empty'),
      empty: t('notes.inlineDb.calcEmpty', 'Empty'),
      unique: t('notes.inlineDb.calcUnique', 'Unique values'),
      percentNotEmpty: t('notes.inlineDb.calcPercentNotEmpty', '% not empty'),
      sum: t('notes.inlineDb.calcSum', 'Sum'),
      avg: t('notes.inlineDb.calcAvg', 'Average'),
      median: t('notes.inlineDb.calcMedian', 'Median'),
      min: t('notes.inlineDb.calcMin', 'Min'),
      max: t('notes.inlineDb.calcMax', 'Max'),
      range: t('notes.inlineDb.calcRange', 'Range'),
      checked: t('notes.inlineDb.calcChecked', 'Checked'),
      percentChecked: t('notes.inlineDb.calcPercentChecked', '% checked'),
    }),
    [t]
  );

  /** Pose (ou retire) le calcul d'une colonne dans la VUE regardee. */
  const setCalculation = useCallback(
    (propId: string, calculation: DbCalculation) => {
      const cur = dataRef.current;
      const target = activeView ?? activeViewOf(cur);
      const next = { ...(target.calculations ?? {}) };
      if (calculation === 'none') delete next[propId];
      else next[propId] = calculation;
      const views = (cur.views ?? [target]).map((v) =>
        v.id === target.id
          ? { ...v, calculations: Object.keys(next).length > 0 ? next : undefined }
          : v
      );
      commitData({ ...cur, views });
      setCalcMenuFor(null);
    },
    [activeView, commitData]
  );

  return (
    <div className="inline-db__table-wrap" ref={wrapRef}>
      {/* Région polie : le déplacement d'une ligne ne se voit pas au clavier ni
          au lecteur d'écran. Le contenu est remonté sous une clé qui change,
          pour que deux annonces identiques soient bien relues toutes les deux. */}
      <div className="inline-db__sr-only" role="status" aria-live="polite" aria-atomic="true">
        {reorderNotice && <span key={reorderNotice.seq}>{reorderNotice.text}</span>}
      </div>
      <div
        className={`inline-db__table${resizingPropId !== null ? ' inline-db__table--resizing' : ''}`}
      >
        <table
          ref={tableRef}
          className="inline-db__table-el"
          role="grid"
          // Somme des largeurs posées : en dessous, la table défile au lieu de
          // rogner les colonnes réglées
          style={{ minWidth: `${tableMinWidth}px` }}
        >
          {/* Largeurs POSÉES colonne par colonne (mise en page fixe) : la dernière
              colonne, sans largeur, absorbe la place qui reste */}
          <colgroup>
            <col className="inline-db__gcol-grip" />
            {shownProperties.map((prop) => (
              <col key={prop.id} data-db-colw={prop.id} style={{ width: `${widthOf(prop)}px` }} />
            ))}
            <col className="inline-db__gcol-add" />
            <col className="inline-db__gcol-filler" />
          </colgroup>
          <thead>
            <tr>
              <th className="inline-db__col-header inline-db__grip-col" scope="col">
                <span className="inline-db__sr-only">
                  {t('notes.inlineDb.rowOrderColumn', 'Row order')}
                </span>
              </th>
              {shownProperties.map((prop) => {
                const width = widthOf(prop);
                const typeName = propertyTypeLabel(prop.type);
                const propName = prop.name || t('notes.inlineDb.untitled', 'Untitled');
                return (
                  <th
                    key={prop.id}
                    data-db-col={prop.id}
                    className={`inline-db__col-header inline-db__col-header--prop${
                      resizingPropId === prop.id ? ' inline-db__col-header--resizing' : ''
                    }`}
                    scope="col"
                  >
                    <button
                      type="button"
                      className="inline-db__col-btn"
                      data-db-anchor=""
                      aria-haspopup="dialog"
                      aria-expanded={editorFor?.propId === prop.id}
                      aria-label={t('notes.inlineDb.editProperty', 'Edit property {{name}}', {
                        name: propName,
                      })}
                      // Le type de la colonne est une information : l'icône seule ne le dit à personne
                      title={t('notes.inlineDb.columnHeaderTitle', '{{name}} · {{type}}', {
                        name: propName,
                        type: typeName,
                      })}
                      onClick={(e) => toggleEditor(prop, e)}
                    >
                      <span className="inline-db__col-icon" aria-hidden="true">
                        {typeIcon(prop.type)}
                      </span>
                      <span className="inline-db__col-name">{propName}</span>
                      <span className="inline-db__sr-only">{` · ${typeName}`}</span>
                    </button>
                    <span
                      className="inline-db__col-resizer"
                      data-db-resizer={prop.id}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t('notes.inlineDb.resizeColumn', 'Resize column {{name}}', {
                        name: propName,
                      })}
                      title={t(
                        'notes.inlineDb.resizeColumnHint',
                        'Drag to resize · double-click to fit the content'
                      )}
                      aria-valuenow={width}
                      aria-valuemin={DB_COL_MIN_WIDTH}
                      aria-valuemax={DB_COL_MAX_WIDTH}
                      tabIndex={0}
                      onPointerDown={(e) => startResize(e, prop)}
                      onPointerMove={moveResize}
                      onPointerUp={endResize}
                      onPointerCancel={endResize}
                      onDoubleClick={() => autoFitColumn(prop)}
                      onKeyDown={(e) => onResizerKeyDown(e, prop)}
                      onKeyUp={endNudge}
                      onBlur={endNudge}
                    />
                  </th>
                );
              })}
              <th className="inline-db__col-header inline-db__add-col" scope="col">
                <button
                  type="button"
                  className="inline-db__add-col-btn"
                  data-db-anchor=""
                  aria-label={t('notes.inlineDb.addProperty', 'Add a property')}
                  title={t('notes.inlineDb.addProperty', 'Add a property')}
                  onClick={addProperty}
                >
                  <svg {...svgProps} width={13} height={13}>
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </th>
              {/* Colonne de remplissage : elle mange la place restante pour que
                  les colonnes réglées gardent EXACTEMENT leur largeur */}
              <th className="inline-db__col-header inline-db__filler-col" scope="col" />
            </tr>
          </thead>
          <tbody>
            {/* RENDU seul : les lignes masquées par un filtre restent dans data.rows */}
            {renderedRows.map(({ row, depth, hasChildren }, rowIndex) => {
              // Source choisie : le ⚡ est proposé sur TOUTE ligne (il cherche un
              // titre) ; sans source, il n'apparaît que si la ligne porte un lien
              const rowLink = firstUrlCell(data.properties, row);
              const rowMetaError = metaError?.rowId === row.id ? metaError.kind : null;
              return (
                <DbTableRow
                  key={row.id}
                  row={row}
                  rowIndex={rowIndex}
                  properties={shownProperties}
                  focusCol={rowIndex === rovingRow ? rovingCol : null}
                  dragging={draggedRowId === row.id}
                  dropPlace={dropHint?.rowId === row.id ? dropHint.place : null}
                  manualOrder={manualOrder}
                  dropdownPropId={dropdownFor?.rowId === row.id ? dropdownFor.propId : null}
                  notePropId={notePickerFor?.rowId === row.id ? notePickerFor.propId : null}
                  relPropId={relPickerFor?.rowId === row.id ? relPickerFor.propId : null}
                  datePropId={datePickerFor?.rowId === row.id ? datePickerFor.propId : null}
                  progressPropId={progressEditFor?.rowId === row.id ? progressEditFor.propId : null}
                  ratingPropId={ratingHover?.rowId === row.id ? ratingHover.propId : null}
                  ratingValue={ratingHover?.rowId === row.id ? ratingHover.value : 0}
                  showMeta={sourceId !== null || rowLink !== null}
                  metaBusy={metaFetchingRowId === row.id}
                  metaHasError={rowMetaError !== null}
                  metaHasPopup={sourceId !== null || metaNeedsOptIn}
                  metaExpanded={
                    sourceId
                      ? connectorFor?.rowId === row.id || metaConfirmFor?.rowId === row.id
                      : metaNeedsOptIn
                        ? metaConfirmFor?.rowId === row.id
                        : undefined
                  }
                  metaLabel={metaLabel}
                  metaTitle={
                    rowMetaError === 'unreachable'
                      ? metaUnreachableLabel
                      : rowMetaError === 'nofill'
                        ? metaNoFillLabel
                        : rowMetaError === 'nothing'
                          ? metaNothingLabel
                          : metaLabel
                  }
                  gripLabel={t('notes.inlineDb.reorderRow', 'Move row {{n}}', {
                    n: rowIndex + 1,
                  })}
                  gripTitle={gripTitle}
                  deleteLabel={deleteRowLabel}
                  renderCell={renderCell}
                  onCellKeyDown={onCellKeyDown}
                  onCellKeyDownCapture={onCellKeyDownCapture}
                  onCellFocus={onCellFocus}
                  onRowDragStart={onRowDragStart}
                  onRowDragEnd={onRowDragEnd}
                  onRowDragOver={onRowDragOver}
                  onRowDrop={onRowDrop}
                  onGripKeyDown={onGripKeyDown}
                  onMetaClick={onMetaClick}
                  onDeleteRow={deleteRow}
                  onDuplicateRow={duplicateRow}
                  duplicateLabel={duplicateRowLabel}
                  onOpenRow={setPanelRowId}
                  openLabel={openRowLabel}
                  depth={depth}
                  hasChildren={hasChildren}
                  collapsed={collapsed.has(row.id)}
                  onToggleCollapse={toggleCollapse}
                  collapseLabel={collapseLabel}
                />
              );
            })}
          </tbody>
          <tfoot>
            {/* Ligne des CALCULS : un pied par colonne, calcule sur les lignes
                que la vue montre — filtrer change donc le total, ce qui est le
                seul comportement qui parle de ce qu'on a sous les yeux. */}
            <tr className="inline-db__calc-row">
              <td className="inline-db__calc-cell inline-db__calc-cell--grip" />
              {shownProperties.map((prop) => {
                const calculation = (activeView ?? activeViewOf(data)).calculations?.[prop.id];
                const result = calculation
                  ? computeColumnCalculation(prop, visibleRows, calculation)
                  : null;
                const shown = result ? formatCalculation(result, locale) : '';
                return (
                  <td key={prop.id} className="inline-db__calc-cell">
                    <button
                      type="button"
                      className={`inline-db__calc-btn ${shown ? 'is-set' : ''}`}
                      data-db-anchor=""
                      aria-haspopup="menu"
                      title={
                        calculation
                          ? calcLabels[calculation]
                          : t('notes.inlineDb.calcNone', 'Calculate')
                      }
                      onClick={(e) =>
                        setCalcMenuFor((cur) =>
                          cur?.propId === prop.id
                            ? null
                            : { propId: prop.id, pos: anchorPos(e.currentTarget, 190, 320) }
                        )
                      }
                    >
                      {shown ? (
                        <>
                          <span className="inline-db__calc-label">
                            {calculation ? calcLabels[calculation] : ''}
                          </span>
                          <span className="inline-db__calc-value">{shown}</span>
                        </>
                      ) : (
                        <span className="inline-db__calc-placeholder">
                          {t('notes.inlineDb.calcNone', 'Calculate')}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
              <td className="inline-db__calc-cell" />
              <td className="inline-db__calc-cell" />
            </tr>
            <tr>
              <td className="inline-db__footer-cell" colSpan={shownProperties.length + 3}>
                <div className="inline-db__footer">
                  <span className="inline-db__add-row-group">
                    <button type="button" className="inline-db__add-row-btn" onClick={addRow}>
                      <svg {...svgProps} width={13} height={13}>
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      {t('notes.inlineDb.newRow', 'New row')}
                    </button>
                    {(data.rowTemplates ?? []).length > 0 && (
                      <button
                        type="button"
                        className="inline-db__add-row-caret"
                        data-db-anchor=""
                        aria-haspopup="menu"
                        aria-label={t('notes.inlineDb.rowTemplates', 'Row templates')}
                        title={t('notes.inlineDb.rowTemplates', 'Row templates')}
                        onClick={(e) =>
                          setRowTemplateMenu((cur) =>
                            cur ? null : anchorPos(e.currentTarget, 220, 260)
                          )
                        }
                      >
                        ▾
                      </button>
                    )}
                  </span>
                  {/* Compte des lignes MONTRÉES : celles qu'un filtre écarte sont
                      annoncées par la barre des vues, jamais comptées deux fois */}
                  {renderedRows.length < visibleRows.length && (
                    <button
                      type="button"
                      className="inline-db__add-row-btn"
                      onClick={() => setRenderLimit((limit) => limit + INITIAL_ROW_RENDER)}
                    >
                      {t('notes.inlineDb.showMoreRows', {
                        defaultValue: 'Show {{count}} more',
                        count: Math.min(
                          INITIAL_ROW_RENDER,
                          visibleRows.length - renderedRows.length
                        ),
                      })}
                    </button>
                  )}
                  {/* Compte des lignes MONTRÉES : celles qu'un filtre écarte sont
                      annoncées par la barre des vues, jamais comptées deux fois */}
                  <span className="inline-db__row-count">
                    {renderedRows.length < visibleRows.length
                      ? t('notes.inlineDb.rowCountPartial', {
                          defaultValue: '{{shown}} of {{total}} rows',
                          shown: renderedRows.length,
                          total: visibleRows.length,
                        })
                      : t('notes.inlineDb.rowCount', {
                          defaultValue: '{{count}} rows',
                          count: visibleRows.length,
                        })}
                  </span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {colMenuFor &&
        (() => {
          const prop = data.properties.find((p2) => p2.id === colMenuFor.propId);
          if (!prop) return null;
          const view = activeView ?? activeViewOf(data);
          const index = data.properties.findIndex((p2) => p2.id === prop.id);
          const sort = view.sorts.find((entry) => entry.propertyId === prop.id);
          return (
            <div
              className="inline-db__popover"
              style={{
                top: colMenuFor.pos.top,
                left: colMenuFor.pos.left,
                maxHeight: colMenuFor.pos.maxHeight,
              }}
              role="dialog"
              aria-label={prop.name}
            >
              <ColumnMenu
                property={prop}
                index={index}
                total={data.properties.length}
                calculation={view.calculations?.[prop.id] ?? 'none'}
                canGroup={prop.type === 'select'}
                sortDirection={sort ? sort.direction : null}
                onRename={(name) => updateProperty({ ...prop, name })}
                onChangeType={(type) => updateProperty({ ...prop, type })}
                onSort={(direction) => setColumnSort(prop.id, direction)}
                onGroupBy={() => {
                  groupByColumn(prop.id);
                  setColMenuFor(null);
                }}
                onCalculate={(calculation) => setCalculation(prop.id, calculation)}
                onFilter={() => {
                  addFilterOnColumn(prop.id);
                  setColMenuFor(null);
                }}
                onHide={() => {
                  hideColumn(prop.id);
                  setColMenuFor(null);
                }}
                onInsert={(side) => {
                  insertPropertyBeside(prop.id, side);
                  setColMenuFor(null);
                }}
                onDuplicate={() => {
                  duplicateProperty(prop.id);
                  setColMenuFor(null);
                }}
                onMove={(dir) => moveProperty(prop.id, dir)}
                onOpenAdvanced={() => {
                  setColMenuFor(null);
                  setEditorFor({ propId: prop.id, pos: colMenuFor.pos });
                }}
                onDelete={() => {
                  deleteProperty(prop.id);
                  setColMenuFor(null);
                }}
                onClose={() => setColMenuFor(null)}
              />
            </div>
          );
        })()}

      {editorFor && editorProp && (
        <div
          className="inline-db__popover inline-db__popover--editor"
          style={{
            top: editorFor.pos.top,
            left: editorFor.pos.left,
            maxHeight: editorFor.pos.maxHeight,
          }}
          role="dialog"
          aria-label={t('notes.inlineDb.editProperty', 'Edit property {{name}}', {
            name: editorProp.name,
          })}
        >
          <PropertyEditor
            property={editorProp}
            properties={data.properties}
            catalog={catalog}
            selfDbId={selfDbId}
            multiLinkRowCount={
              editorProp.type === 'relation' ? countMultiLinkRows(data.rows, editorProp.id) : 0
            }
            backlinkColumn={backlinkColumnState(editorProp)}
            onCreateBacklinkColumn={() => createBacklinkColumn(editorProp)}
            onChange={updateProperty}
            onKeepFirstLinkOnly={() => keepFirstLinkOnly(editorProp.id)}
            onDelete={() => deleteProperty(editorProp.id)}
            onClose={() => setEditorFor(null)}
          />
        </div>
      )}

      {dropdownFor &&
        ddProp &&
        ddRow &&
        (ddProp.type === 'select' || ddProp.type === 'multiSelect') && (
          <div
            ref={dropdownRef}
            className="inline-db__popover inline-db__dropdown"
            style={{
              top: dropdownFor.pos.top,
              left: dropdownFor.pos.left,
              maxHeight: dropdownFor.pos.maxHeight,
            }}
            role="listbox"
            aria-multiselectable={ddProp.type === 'multiSelect'}
            aria-label={ddProp.name}
            onKeyDown={onDropdownKeyDown}
          >
            {(ddProp.options ?? []).length === 0 && (
              <div className="inline-db__dropdown-empty">
                {t(
                  'notes.inlineDb.noOptions',
                  'No options yet — add some from the column settings'
                )}
              </div>
            )}
            {(ddProp.options ?? []).map((opt) => {
              const selected =
                ddProp.type === 'select'
                  ? ddValue === opt.id
                  : selectedIds(ddValue).includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="inline-db__dropdown-item"
                  onClick={() => {
                    if (ddProp.type === 'select') {
                      setCell(ddRow.id, ddProp.id, selected ? undefined : opt.id);
                      setDropdownFor(null);
                    } else {
                      const ids = selectedIds(ddValue);
                      const next = selected ? ids.filter((x) => x !== opt.id) : [...ids, opt.id];
                      setCell(ddRow.id, ddProp.id, next.length > 0 ? next : undefined);
                    }
                  }}
                >
                  <span className="inline-db__option-pill" style={pillStyle(opt.color)}>
                    {opt.label || t('notes.inlineDb.untitled', 'Untitled')}
                  </span>
                  {selected && (
                    <svg {...svgProps} className="inline-db__dropdown-check">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
            {ddProp.type === 'select' && typeof ddValue === 'string' && (
              <button
                type="button"
                className="inline-db__dropdown-clear"
                onClick={() => {
                  setCell(ddRow.id, ddProp.id, undefined);
                  setDropdownFor(null);
                }}
              >
                {t('notes.inlineDb.clearValue', 'Clear')}
              </button>
            )}
          </div>
        )}

      {datePickerFor && dateProp && dateRow && (
        <div
          className="inline-db__popover inline-db__datepicker"
          style={{
            top: datePickerFor.pos.top,
            left: datePickerFor.pos.left,
            maxHeight: datePickerFor.pos.maxHeight,
          }}
          role="dialog"
          aria-label={t('notes.inlineDb.datePick', 'Pick a date')}
        >
          <DateCellPicker
            value={dateValue(dateRow.cells[dateProp.id])}
            onCommit={(iso) => setCell(dateRow.id, dateProp.id, iso ?? undefined)}
            onClose={() => setDatePickerFor(null)}
          />
        </div>
      )}

      {panelRowId &&
        (() => {
          const row = data.rows.find((candidate) => candidate.id === panelRowId);
          if (!row) return null;
          // Navigation d'une ligne a l'autre DANS L'ORDRE AFFICHE : suivre
          // l'ordre de stockage sauterait au hasard une fois la vue triee.
          const order = visibleRows.map((candidate) => candidate.id);
          const at = order.indexOf(row.id);
          return (
            <RowPanel
              data={data}
              row={row}
              visiblePropertyIds={new Set(shownProperties.map((prop) => prop.id))}
              onChange={commitData}
              onClose={() => setPanelRowId(null)}
              onSaveAsTemplate={(name) => saveRowAsTemplate(row.id, name)}
              onAddSubRow={() => addSubRow(row.id)}
              onSetParent={(parentId: string | undefined) => setRowParent(row.id, parentId)}
              onStep={
                at < 0
                  ? undefined
                  : (delta) => {
                      const next = order[at + delta];
                      if (next) setPanelRowId(next);
                    }
              }
            />
          );
        })()}

      {rowTemplateMenu && (
        <div
          className="inline-db__popover inline-db__calcmenu"
          style={{
            top: rowTemplateMenu.top,
            left: rowTemplateMenu.left,
            maxHeight: rowTemplateMenu.maxHeight,
          }}
          role="menu"
          aria-label={t('notes.inlineDb.rowTemplates', 'Row templates')}
        >
          {(data.rowTemplates ?? []).map((template) => (
            <span key={template.id} className="inline-db__tplrow">
              <button
                type="button"
                role="menuitem"
                className="inline-db__calcmenu-item"
                onClick={() => addRowFromTemplate(template.id)}
              >
                {template.name}
              </button>
              <button
                type="button"
                className="inline-db__pe-icon-btn"
                aria-label={t('notes.inlineDb.deleteRowTemplate', 'Delete this template')}
                title={t('notes.inlineDb.deleteRowTemplate', 'Delete this template')}
                onClick={() => deleteRowTemplate(template.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {calcMenuFor && (
        <div
          className="inline-db__popover inline-db__calcmenu"
          style={{
            top: calcMenuFor.pos.top,
            left: calcMenuFor.pos.left,
            maxHeight: calcMenuFor.pos.maxHeight,
          }}
          role="menu"
          aria-label={t('notes.inlineDb.calcNone', 'Calculate')}
        >
          {(() => {
            const prop = data.properties.find((p2) => p2.id === calcMenuFor.propId);
            if (!prop) return null;
            const current = (activeView ?? activeViewOf(data)).calculations?.[prop.id] ?? 'none';
            // Seuls les calculs qui ONT UN SENS pour ce type : proposer une
            // somme sur du texte pour afficher « — » ensuite ferait croire a
            // une panne.
            return calculationsForType(prop.type).map((calculation) => (
              <button
                key={calculation}
                type="button"
                role="menuitemradio"
                aria-checked={current === calculation}
                className={`inline-db__calcmenu-item ${current === calculation ? 'is-on' : ''}`}
                onClick={() => setCalculation(prop.id, calculation)}
              >
                {calcLabels[calculation]}
              </button>
            ));
          })()}
        </div>
      )}

      {notePickerFor && (
        <div
          className="inline-db__popover inline-db__notepicker"
          style={{
            top: notePickerFor.pos.top,
            left: notePickerFor.pos.left,
            maxHeight: notePickerFor.pos.maxHeight,
          }}
          role="dialog"
          aria-label={t('notes.inlineDb.linkNote', 'Link a note')}
        >
          <input
            ref={noteSearchRef}
            className="inline-db__pe-input"
            value={noteQuery}
            placeholder={t('notes.inlineDb.searchNotes', 'Search notes…')}
            aria-label={t('notes.inlineDb.searchNotes', 'Search notes…')}
            onChange={(e) => setNoteQuery(e.target.value)}
          />
          <div className="inline-db__notepicker-list">
            {noteResults.length === 0 && (
              <div className="inline-db__dropdown-empty">
                {t('notes.inlineDb.noNotesFound', 'No matching notes')}
              </div>
            )}
            {noteResults.map((n) => (
              <button
                key={n.id}
                type="button"
                className="inline-db__notepicker-item"
                onClick={() => {
                  setCell(notePickerFor.rowId, notePickerFor.propId, n.id);
                  setNotePickerFor(null);
                }}
              >
                {n.title || t('notes.inlineDb.untitled', 'Untitled')}
              </button>
            ))}
          </div>
        </div>
      )}

      {relPickerFor && relProp && relRes?.status === 'ok' && (
        <div
          className="inline-db__popover inline-db__notepicker inline-db__relpicker"
          style={{
            top: relPickerFor.pos.top,
            left: relPickerFor.pos.left,
            maxHeight: relPickerFor.pos.maxHeight,
          }}
          role="dialog"
          aria-label={t('notes.inlineDb.relationPick', 'Link rows')}
        >
          {/* D'OÙ viennent ces lignes : deux bases peuvent porter le même nom,
              celui de la note tranche */}
          <div className="inline-db__relpicker-head">
            <span className="inline-db__relpicker-db">
              {(relRes.target.label ?? '').trim() || t('notes.inlineDb.untitled', 'Untitled')}
            </span>
            {(relRes.target.noteTitle ?? '').trim() !== '' && (
              <span className="inline-db__relpicker-note">
                {t('notes.inlineDb.relationInNote', 'in « {{note}} »', {
                  note: relRes.target.noteTitle,
                })}
              </span>
            )}
          </div>
          <input
            ref={relSearchRef}
            className="inline-db__pe-input"
            value={relQuery}
            placeholder={t('notes.inlineDb.relationSearch', 'Search rows…')}
            aria-label={t('notes.inlineDb.relationSearch', 'Search rows…')}
            onChange={(e) => setRelQuery(e.target.value)}
            onKeyDown={(e) => {
              // Entrée = créer ce qu'on vient de taper, quand rien ne
              // correspond : le geste attendu après une recherche infructueuse
              if (e.key !== 'Enter' || !relCanCreate || relTargetLocked) return;
              e.preventDefault();
              if (createRelationRow(relPickerFor.rowId, relProp, relTrimmedQuery)) setRelQuery('');
            }}
          />
          <div
            className="inline-db__notepicker-list"
            role="listbox"
            aria-multiselectable={relProp.single !== true}
          >
            {relResults.length === 0 && (
              <div className="inline-db__dropdown-empty">
                {relRes.target.rows.length === 0
                  ? t('notes.inlineDb.relationEmptyTarget', 'The target database has no rows yet')
                  : t('notes.inlineDb.relationNoResults', 'No matching row')}
              </div>
            )}
            {relResults.map((r) => {
              const selected = relSelected.has(r.id);
              const title = r.title || t('notes.inlineDb.untitled', 'Untitled');
              return (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="inline-db__notepicker-item inline-db__relpicker-item"
                  onClick={() => toggleRelationLink(relPickerFor.rowId, relPickerFor.propId, r.id)}
                >
                  <span className="inline-db__relpicker-main">
                    <span className="inline-db__relpicker-label">{title}</span>
                    {relSecondary.length > 0 && (
                      <span className="inline-db__relpicker-sub">
                        {relSecondary.map((sp) => {
                          // Une sélection garde sa couleur : c'est à elle qu'on
                          // reconnaît la ligne, pas à son libellé
                          if (sp.type === 'select') {
                            const opt = (sp.options ?? []).find((o) => o.id === r.row.cells[sp.id]);
                            return opt ? (
                              <span
                                key={sp.id}
                                className="inline-db__option-pill inline-db__relpicker-pill"
                                style={pillStyle(opt.color)}
                                title={sp.name}
                              >
                                {opt.label || t('notes.inlineDb.untitled', 'Untitled')}
                              </span>
                            ) : null;
                          }
                          const text = rowDisplayText(sp, r.row, relTargetEnv);
                          return text === '' ? null : (
                            <span key={sp.id} className="inline-db__relpicker-meta" title={sp.name}>
                              {text}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>
                  {selected && (
                    <svg {...svgProps} className="inline-db__dropdown-check">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          {/* Créer la ligne qu'on cherchait : la base visée vit dans une AUTRE
              note, qui est réécrite dans la foulée (cf. `createRelationRow`) */}
          {relCanCreate &&
            (relTargetLocked ? (
              <p className="inline-db__relpicker-blocked">
                {t(
                  'notes.inlineDb.relationCreateBlocked',
                  'This database is in the note you have open — add the row from its own block.'
                )}
              </p>
            ) : (
              <button
                type="button"
                className="inline-db__relpicker-create"
                onClick={() => {
                  if (createRelationRow(relPickerFor.rowId, relProp, relTrimmedQuery)) {
                    setRelQuery('');
                  }
                }}
              >
                <svg {...svgProps} width={12} height={12}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t('notes.inlineDb.relationCreateRow', 'Create « {{title}} »', {
                  title: relTrimmedQuery,
                })}
              </button>
            ))}
          {relProp.single === true && (
            <p className="inline-db__relpicker-note-line">
              {t(
                'notes.inlineDb.relationSingleActive',
                'One link at a time — your pick replaces the current one.'
              )}
            </p>
          )}
          {relRes.missing.length > 0 && (
            <button
              type="button"
              className="inline-db__relpicker-clean"
              onClick={() =>
                dropMissingLinks(relPickerFor.rowId, relPickerFor.propId, relRes.missing)
              }
            >
              {t('notes.inlineDb.relationDropMissing', 'Remove {{count}} links not found', {
                count: relRes.missing.length,
              })}
            </button>
          )}
        </div>
      )}

      {connectorFor && (
        <div
          ref={connectorRef}
          className="inline-db__popover inline-db__connector"
          style={{
            top: connectorFor.pos.top,
            left: connectorFor.pos.left,
            maxHeight: connectorFor.pos.maxHeight,
          }}
          role="dialog"
          // Cible du focus quand le popover ne porte pas de résultat cliquable
          tabIndex={-1}
          aria-label={t('notes.inlineDb.fillFromSource', 'Fill from {{source}}', {
            source: sourceLabel,
          })}
        >
          {connectorFor.panel.kind === 'loading' && (
            <div className="inline-db__connector-loading">
              <span className="inline-db__spinner" aria-hidden="true" />
              {t('notes.inlineDb.connectorSearching', 'Searching…')}
            </div>
          )}

          {connectorFor.panel.kind === 'results' && (
            <>
              <div className="inline-db__connector-title">
                {t('notes.inlineDb.connectorResultsTitle', 'Choose a result')}
              </div>
              {/* Le message coiffe la liste au lieu de la remplacer */}
              {connectorFor.panel.notice !== undefined && (
                <p className="inline-db__connector-msg" role="status">
                  {connectorFor.panel.notice === 'allFilled'
                    ? t(
                        'notes.inlineDb.connectorNothingToFill',
                        'Every cell this result could fill is already filled'
                      )
                    : t(
                        'notes.inlineDb.connectorNoColumn',
                        'No column of this table can hold this result — add a Year, Rating or Genres column, then try again.'
                      )}
                </p>
              )}
              <div className="inline-db__connector-list">
                {connectorFor.panel.results.map((r) => {
                  // Vignettes distantes exclues par la CSP (img-src 'self' blob: data:)
                  const meta = [r.year ? String(r.year) : '', r.subtitle ?? '']
                    .filter((s) => s !== '')
                    .join(' · ');
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className="inline-db__connector-item"
                      onClick={() => applyConnectorResult(connectorFor.rowId, r)}
                    >
                      <span className="inline-db__connector-avatar" aria-hidden="true">
                        {resultInitial(r.title)}
                      </span>
                      <span className="inline-db__connector-text">
                        <span className="inline-db__connector-name">{r.title}</span>
                        {meta !== '' && <span className="inline-db__connector-meta">{meta}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {connectorFor.panel.kind === 'noTitle' && (
            <p className="inline-db__connector-msg">
              {t(
                'notes.inlineDb.connectorNoTitle',
                'Type a title in the first column, then click ⚡ again.'
              )}
            </p>
          )}

          {connectorFor.panel.kind === 'empty' && (
            <p className="inline-db__connector-msg">
              {t('notes.inlineDb.connectorNoResults', 'Nothing found for this title')}
            </p>
          )}

          {connectorFor.panel.kind === 'error' && (
            <p className="inline-db__connector-msg inline-db__connector-msg--error">
              {t(
                'notes.inlineDb.connectorError',
                'Search failed — check your connection, then try again'
              )}
            </p>
          )}

          {connectorFor.panel.kind === 'missingKey' && (
            <>
              <p className="inline-db__connector-msg">
                {t(
                  'notes.inlineDb.connectorMissingKey',
                  'The Movies source needs a valid free TMDB key. Add or fix it in Settings → Privacy, then click ⚡ again.'
                )}
              </p>
              <button
                type="button"
                className="inline-db__connector-action"
                onClick={() =>
                  window.electron?.ipcRenderer?.send('open-external', TMDB_API_KEY_URL)
                }
              >
                {t('notes.inlineDb.connectorGetKey', 'Get a free key')}
              </button>
            </>
          )}
        </div>
      )}

      {metaConfirmFor && (
        <div
          className="inline-db__popover inline-db__meta-confirm"
          style={{
            top: metaConfirmFor.pos.top,
            left: metaConfirmFor.pos.left,
            maxHeight: metaConfirmFor.pos.maxHeight,
          }}
          role="dialog"
          aria-label={
            metaConfirmFor.intent === 'source'
              ? t('notes.inlineDb.metaOptinSearchTitle', 'Search {{source}}', {
                  source: sourceLabel,
                })
              : t('notes.inlineDb.metaOptinTitle', 'Fill from link')
          }
        >
          <div className="inline-db__meta-confirm-title">
            {metaConfirmFor.intent === 'source'
              ? t('notes.inlineDb.metaOptinSearchTitle', 'Search {{source}}', {
                  source: sourceLabel,
                })
              : t('notes.inlineDb.metaOptinTitle', 'Fill from link')}
          </div>
          <p className="inline-db__meta-confirm-body">
            {metaConfirmFor.intent === 'source'
              ? t(
                  'notes.inlineDb.metaOptinSearchBody',
                  'Turns on source lookups via our servers. What is sent: the few words searched (the title in this row), and your TMDB key if you have set one — never the content of your notes, and nothing is logged. This is a separate permission from link previews: allowing it here does not turn those on. Can be turned off in Settings → Privacy → Security.'
                )
              : t(
                  'notes.inlineDb.metaOptinBody',
                  'Turns on link previews via our servers (⚡ fill, pasted link titles, bookmark previews): only the URL is sent — never the content of your notes, and it is never logged. Can be turned off in Settings → Privacy.'
                )}
          </p>
          <div className="inline-db__meta-confirm-actions">
            <button
              type="button"
              className="inline-db__meta-confirm-btn"
              onClick={() => setMetaConfirmFor(null)}
            >
              {t('notes.inlineDb.metaOptinCancel', 'Cancel')}
            </button>
            <button
              ref={metaAcceptRef}
              type="button"
              className="inline-db__meta-confirm-btn inline-db__meta-confirm-btn--primary"
              onClick={() => {
                const { rowId, intent, pos } = metaConfirmFor;
                // Accord explicite mémorisé — et UNIQUEMENT celui qui est
                // demandé ici : les deux relais ont deux interrupteurs
                if (intent === 'source') setConnectorProxyOptIn(true);
                else setMetaProxyOptIn(true);
                setMetaConfirmFor(null);
                if (intent === 'source') {
                  // Le sélecteur de résultats est plus large que la confirmation :
                  // on ré-ancre sur le ⚡ tant qu'il est connu
                  const anchor = anchorElRef.current;
                  void runConnectorSearch(
                    rowId,
                    anchor ? anchorPos(anchor, CONNECTOR_WIDTH, CONNECTOR_EST_HEIGHT) : pos
                  );
                  return;
                }
                void runFetchMeta(rowId);
              }}
            >
              {t('notes.inlineDb.metaOptinAccept', 'Continue')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
