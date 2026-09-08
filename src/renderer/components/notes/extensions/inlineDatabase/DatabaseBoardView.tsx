/**
 * DatabaseBoardView — Filarr Notes
 *
 * Vue kanban du bloc base de données.
 *
 * CE QUI MANQUAIT, ET POURQUOI ÇA COMPTAIT. La carte n'ouvrait rien : cliquer
 * dessus renommait son titre, point. Toute autre valeur — la progression au
 * premier chef — était donc INACCESSIBLE depuis le kanban, alors que la donnée
 * était là, visible en sous-ligne, et modifiable à deux vues de distance. La
 * fiche (`RowPanel`) existait déjà et servait la table, la galerie et le
 * calendrier ; elle sert désormais aussi le plateau.
 *
 * CE QUI EN FAIT UN KANBAN, et plus seulement des colonnes :
 *  - le PLAFOND d'en-cours par colonne, qui ne bloque rien mais qui se voit ;
 *  - le RÉSUMÉ de colonne (moyenne d'avancement, somme d'une charge, cases
 *    cochées) — l'état d'une colonne se lit sans l'ouvrir ;
 *  - les COULOIRS : un second axe de lecture (par personne, par projet) qui
 *    croise les colonnes au lieu de les remplacer ;
 *  - la progression RÉGLABLE sur la carte, sans ouvrir quoi que ce soit ;
 *  - le repli d'une colonne, la teinte des cartes, trois tailles de carte.
 *
 * Tous ces réglages appartiennent à la VUE (`DbView.board`), jamais à la base :
 * la même base se pilote « par statut, plafonné » ici et se répartit « par
 * personne » dans la vue d'à côté.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../../../i18n/config';
import type { BoardCardSize, BoardSettings } from './boardLayout';
import {
  BOARD_CARD_SIZES,
  BOARD_NONE,
  boardColumns,
  boardLanes,
  clampProgress,
  columnSummary,
  isSummarizable,
  progressFromPointer,
  rowsInLane,
  splitByColumn,
  visibleColumns,
  visibleLanes,
  wipStatus,
} from './boardLayout';
import type { DatabaseViewProps, DbProperty, DbRow, DbView, InlineDbData } from './types';
import { formatDbDate, newRow, optionColorValue, touchRow } from './types';
import { formatDecimal, resolveLocale } from './cellFormats';
import type { DbEnv } from './relations';
import { computeRollup, formatRollupResult, resolveRelation } from './relations';
import { orderedVisibleProperties } from './viewEngine';
import { RowPanel } from './RowPanel';

// MIME custom : le handler drop natif de ProseMirror ignore ce type (text/plain serait inséré comme texte)
const DB_ROW_MIME = 'application/x-filarr-db-row';
const MENU_WIDTH = 170;

const PlusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </svg>
);

const OpenIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
  >
    <path d="M9 21H5a2 2 0 01-2-2v-4" />
    <path d="M15 3h4a2 2 0 012 2v4" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 00.33 1.76l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.6 1.6 0 00-1.76-.33 1.6 1.6 0 00-1 1.47V21a2 2 0 11-4 0v-.09A1.6 1.6 0 008.9 19.4a1.6 1.6 0 00-1.76.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.6 1.6 0 004.6 15a1.6 1.6 0 00-1.47-1H3a2 2 0 110-4h.09A1.6 1.6 0 004.6 9a1.6 1.6 0 00-.33-1.76l-.06-.06a2 2 0 112.83-2.83l.06.06A1.6 1.6 0 009 4.6a1.6 1.6 0 001-1.47V3a2 2 0 114 0v.09a1.6 1.6 0 001 1.47 1.6 1.6 0 001.76-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.6 1.6 0 0019.4 9v0a1.6 1.6 0 001.47 1H21a2 2 0 110 4h-.09a1.6 1.6 0 00-1.47 1z" />
  </svg>
);

const ChevronIcon: React.FC<{ dir: 'left' | 'right' }> = ({ dir }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
  </svg>
);

/**
 * Types qu'une carte résume en une sous-LIGNE de texte.
 *
 * Progression et case à cocher n'y sont plus : elles ont désormais une
 * commande à part sur la carte, et les répéter en texte donnerait deux
 * affichages de la même valeur, dont un seul réagit au clic.
 */
function hasSubline(type: DbProperty['type']): boolean {
  return (
    type === 'date' ||
    type === 'number' ||
    type === 'rating' ||
    type === 'relation' ||
    type === 'rollup' ||
    type === 'select' ||
    type === 'multiSelect'
  );
}

/**
 * Sous-ligne discrète d'une carte — null si rien à montrer.
 *
 * Relations et agrégats se lisent comme dans la table : les titres des lignes
 * liées, la valeur calculée de l'agrégat. Une base visée introuvable ne montre
 * RIEN plutôt qu'un chiffre faux (les liens, eux, restent stockés).
 */
function sublineFor(prop: DbProperty, row: DbRow, env?: DbEnv | null): string | null {
  const v = row.cells[prop.id];
  if (prop.type === 'relation') {
    const res = resolveRelation(prop, row, env);
    if (res.status !== 'ok') return null;
    const titles = res.links.map((l) => l.title).filter((s) => s !== '');
    return titles.length > 0 ? `${prop.name} · ${titles.join(', ')}` : null;
  }
  if (prop.type === 'rollup') {
    // Agrégat chiffré comme agrégat textuel (« liste des valeurs ») : c'est le
    // même rendu que la table, par le même formateur
    const text = formatRollupResult(computeRollup(prop, row, env));
    return text !== '' ? `${prop.name} · ${text}` : null;
  }
  if (prop.type === 'select' || prop.type === 'multiSelect') {
    const ids = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    const labels = ids
      .map((id) => prop.options?.find((option) => option.id === id)?.label)
      .filter((label): label is string => typeof label === 'string');
    return labels.length > 0 ? labels.join(' · ') : null;
  }
  // Nombre et date mis en forme comme dans la table : séparateurs et mois de la
  // langue de l'app, jamais un ISO brut ni un point décimal anglais
  if (prop.type === 'number')
    return typeof v === 'number' && Number.isFinite(v)
      ? `${prop.name} · ${formatDecimal(v, resolveLocale(i18n.language))}`
      : null;
  if (prop.type === 'date') {
    const shown = typeof v === 'string' ? formatDbDate(v) : '';
    return shown !== '' ? shown : null;
  }
  if (prop.type === 'rating')
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5
      ? `${prop.name} · ${v}/5`
      : null;
  return null;
}

/**
 * Barre de progression RÉGLABLE, sur la carte.
 *
 * C'est le défaut que ce remaniement ferme : la progression se lisait sur le
 * kanban et ne s'y réglait pas. Elle se règle au clic, au glissement et aux
 * flèches — un plateau se pilote souvent d'une seule main sur le clavier.
 */
const CardProgress: React.FC<{
  label: string;
  value: number;
  readOnly: boolean;
  onCommit: (next: number) => void;
  onTweakingChange: (tweaking: boolean) => void;
}> = ({ label, value, readOnly, onCommit, onTweakingChange }) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? value;

  const valueAt = useCallback((clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return progressFromPointer(clientX, rect);
  }, []);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      // Le glissement d'une barre et le glissement d'une CARTE partent du même
      // bouton : sans ce drapeau, régler l'avancement décrocherait la carte de
      // sa colonne.
      onTweakingChange(true);
      const first = valueAt(e.clientX);
      if (first !== null) setPreview(first);

      const move = (ev: MouseEvent) => {
        const next = valueAt(ev.clientX);
        if (next !== null) setPreview(next);
      };
      const up = (ev: MouseEvent) => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        onTweakingChange(false);
        const next = valueAt(ev.clientX);
        setPreview(null);
        if (next !== null && next !== value) onCommit(next);
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    },
    [readOnly, valueAt, value, onCommit, onTweakingChange]
  );

  return (
    <div className="inline-db__card-progress">
      <div className="inline-db__card-progress-head">
        <span className="inline-db__card-progress-label">{label}</span>
        <span className="inline-db__card-progress-value">
          {i18n.t('notes.inlineDb.percent', { defaultValue: '{{n}}%', n: shown })}
        </span>
      </div>
      <div
        ref={barRef}
        className={`inline-db__card-progress-bar ${readOnly ? '' : 'is-editable'}`}
        role="slider"
        tabIndex={readOnly ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        aria-readonly={readOnly}
        onMouseDown={startDrag}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (readOnly) return;
          const step = e.shiftKey ? 25 : 5;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            onCommit(clampProgress(value + step));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            onCommit(clampProgress(value - step));
          } else if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            onCommit(0);
          } else if (e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            onCommit(100);
          }
        }}
      >
        <span className="inline-db__card-progress-fill" style={{ width: `${shown}%` }} />
      </div>
    </div>
  );
};

export const DatabaseBoardView: React.FC<DatabaseViewProps> = ({
  data,
  visibleRows,
  groupBy,
  rowDefaults,
  linkCtx,
  activeView,
  onChange,
  onGroupByChange,
}) => {
  const { t } = useTranslation();

  /** Environnement des relations et des agrégats — voir DatabaseTableView */
  const env = useMemo<DbEnv>(
    () => ({ properties: data.properties, ...(linkCtx ? { ctx: linkCtx } : {}) }),
    [data.properties, linkCtx]
  );

  const board: BoardSettings = useMemo(() => activeView?.board ?? {}, [activeView]);

  /**
   * Écriture d'un réglage de plateau dans la VUE active.
   *
   * Sans vue enregistrée (base d'avant les vues, non encore migrée à l'écrit),
   * on n'invente rien : le réglage est simplement sans effet plutôt que d'aller
   * s'écrire dans une vue fabriquée au vol, dont l'identifiant changerait au
   * prochain rendu.
   */
  const patchBoard = useCallback(
    (patch: Partial<BoardSettings>) => {
      const views = data.views;
      const targetId = activeView?.id;
      if (!views || !targetId || !views.some((v) => v.id === targetId)) return;
      const next: DbView[] = views.map((v) =>
        v.id === targetId ? { ...v, board: { ...(v.board ?? {}), ...patch } } : v
      );
      onChange({ ...data, views: next });
    },
    [data, activeView, onChange]
  );

  const selectProps = useMemo(
    () => data.properties.filter((p) => p.type === 'select'),
    [data.properties]
  );

  const summarizableProps = useMemo(
    () => data.properties.filter(isSummarizable),
    [data.properties]
  );

  // groupBy vide ou pointant vers une propriété disparue/non-select →
  // repli purement dérivé au rendu (l'attr n'est écrit QUE sur action utilisateur)
  const groupProp = useMemo(
    () => selectProps.find((p) => p.id === groupBy) ?? selectProps[0],
    [selectProps, groupBy]
  );

  const laneProp = useMemo(
    () =>
      board.swimlaneBy && board.swimlaneBy !== groupProp?.id
        ? selectProps.find((p) => p.id === board.swimlaneBy)
        : undefined,
    [board.swimlaneBy, selectProps, groupProp]
  );

  const summaryProp = useMemo(
    () => summarizableProps.find((p) => p.id === board.summaryBy),
    [summarizableProps, board.summaryBy]
  );

  const titleProp = useMemo(
    () => data.properties.find((p) => p.type === 'text'),
    [data.properties]
  );

  /** Progression montrée sur la carte : la première de la base, s'il y en a une. */
  const progressProp = useMemo(
    () => data.properties.find((p) => p.type === 'progress'),
    [data.properties]
  );

  const checkboxProp = useMemo(
    () => data.properties.find((p) => p.type === 'checkbox'),
    [data.properties]
  );

  const subProps = useMemo(
    () =>
      data.properties
        .filter(
          (p) =>
            p.id !== titleProp?.id &&
            p.id !== groupProp?.id &&
            p.id !== laneProp?.id &&
            hasSubline(p.type)
        )
        .slice(0, board.cardSize === 'tall' ? 4 : board.cardSize === 'compact' ? 1 : 2),
    [data.properties, titleProp, groupProp, laneProp, board.cardSize]
  );

  const noneLabel = t('notes.inlineDb.noValue', 'No value');

  const columns = useMemo(
    () => boardColumns(groupProp, noneLabel, optionColorValue),
    [groupProp, noneLabel]
  );

  const lanes = useMemo(
    () => visibleLanes(boardLanes(laneProp, noneLabel, optionColorValue), visibleRows, laneProp),
    [laneProp, noneLabel, visibleRows]
  );

  /** Répartition GLOBALE : elle décide quelles colonnes le plateau affiche. */
  const byColumn = useMemo(
    () => splitByColumn(visibleRows, groupProp, columns),
    [visibleRows, groupProp, columns]
  );

  const shownColumns = useMemo(
    () => visibleColumns(columns, byColumn, board.hideEmpty === true),
    [columns, byColumn, board.hideEmpty]
  );

  const collapsed = useMemo(() => new Set(board.collapsed ?? []), [board.collapsed]);

  const visiblePropertyIds = useMemo(
    () => new Set(orderedVisibleProperties(data.properties, activeView ?? null).map((p) => p.id)),
    [data.properties, activeView]
  );

  // ---- Édition inline du titre de carte ----
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');

  /** Ligne ouverte EN FICHE — l'issue vers toutes les autres propriétés. */
  const [panelRowId, setPanelRowId] = useState<string | null>(null);

  /**
   * Une commande de carte est en cours de manipulation : la carte ne se glisse
   * plus.
   *
   * L'état ET une ref : `draggable` se lit au rendu suivant, mais le navigateur
   * peut avoir démarré le glisser AVANT que React ait repeint. La ref, elle, est
   * à jour dès le `mousedown` — sans elle, régler l'avancement décrocherait la
   * carte de sa colonne une fois sur trois.
   */
  const [tweaking, setTweaking] = useState(false);
  const tweakingRef = useRef(false);
  const beginTweak = useCallback((value: boolean) => {
    tweakingRef.current = value;
    setTweaking(value);
  }, []);

  const startTitleEdit = useCallback(
    (row: DbRow) => {
      if (!titleProp) return;
      const v = row.cells[titleProp.id];
      setEditingRowId(row.id);
      setTitleDraft(typeof v === 'string' ? v : '');
    },
    [titleProp]
  );

  const commitTitleEdit = useCallback(() => {
    if (!editingRowId || !titleProp) {
      setEditingRowId(null);
      return;
    }
    const trimmed = titleDraft.trim();
    const row = data.rows.find((r) => r.id === editingRowId);
    const current =
      row && typeof row.cells[titleProp.id] === 'string' ? row.cells[titleProp.id] : '';
    if (row && trimmed !== current) {
      const next: InlineDbData = {
        ...data,
        rows: data.rows.map((r) =>
          r.id === editingRowId
            ? touchRow({ ...r, cells: { ...r.cells, [titleProp.id]: trimmed } })
            : r
        ),
      };
      onChange(next);
    }
    setEditingRowId(null);
    setTitleDraft('');
  }, [editingRowId, titleProp, titleDraft, data, onChange]);

  const cancelTitleEdit = useCallback(() => {
    setEditingRowId(null);
    setTitleDraft('');
  }, []);

  /** Écriture d'une cellule depuis la carte (progression, case à cocher). */
  const setCell = useCallback(
    (rowId: string, propertyId: string, value: unknown) => {
      onChange({
        ...data,
        rows: data.rows.map((r) =>
          r.id === rowId ? touchRow({ ...r, cells: { ...r.cells, [propertyId]: value } }) : r
        ),
      });
    },
    [data, onChange]
  );

  // ---- Déplacement d'une ligne vers une colonne (drop OU menu ⋯) ----
  const moveRow = useCallback(
    (rowId: string, optionId: string | null, laneId?: string | null) => {
      if (!groupProp) return;
      // Déjà dans la colonne cible → aucun commit (ni onChange, ni horodatage)
      let changed = false;
      const rows = data.rows.map((r) => {
        if (r.id !== rowId) return r;
        const cells = { ...r.cells };
        const targetCol = optionId === null ? undefined : optionId;
        if (cells[groupProp.id] !== targetCol) {
          changed = true;
          if (targetCol === undefined) delete cells[groupProp.id];
          else cells[groupProp.id] = targetCol;
        }
        // Déposer dans un COULOIR change aussi le second axe : sinon la carte
        // reviendrait visuellement d'où elle vient au premier rendu, ce qui se
        // lit comme un dépôt refusé.
        if (laneProp && laneId !== undefined) {
          const targetLane = laneId === null || laneId === BOARD_NONE ? undefined : laneId;
          if (cells[laneProp.id] !== targetLane) {
            changed = true;
            if (targetLane === undefined) delete cells[laneProp.id];
            else cells[laneProp.id] = targetLane;
          }
        }
        if (!changed) return r;
        return touchRow({ ...r, cells });
      });
      if (!changed) return;
      onChange({ ...data, rows });
    },
    [data, groupProp, laneProp, onChange]
  );

  // ---- Drag & drop HTML5 (modèle KanbanView) ----
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, rowId: string) => {
    if (tweakingRef.current) {
      e.preventDefault();
      return;
    }
    setDraggedRowId(rowId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DB_ROW_MIME, rowId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, cellKey: string) => {
    if (!e.dataTransfer.types.includes(DB_ROW_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetCol(cellKey);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTargetCol(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, colId: string, laneId: string) => {
      e.preventDefault();
      setDropTargetCol(null);
      setDraggedRowId(null);
      const rowId = e.dataTransfer.getData(DB_ROW_MIME);
      if (!rowId) return;
      moveRow(rowId, colId === BOARD_NONE ? null : colId, laneProp ? laneId : undefined);
    },
    [moveRow, laneProp]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedRowId(null);
    setDropTargetCol(null);
  }, []);

  // ---- Menu ⋯ (repli clavier du drag & drop) — en fixed, coordonnées viewport ----
  const [cardMenu, setCardMenu] = useState<{ rowId: string; top: number; left: number } | null>(
    null
  );
  const menuRowId = cardMenu?.rowId ?? null;
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!cardMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCardMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCardMenu(null);
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && menuRef.current?.contains(e.target)) return;
      setCardMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [cardMenu]);

  // ---- Réglages du plateau ----
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node))
        setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

  // ---- Nouvelle carte en pied de colonne ----
  const addCard = useCallback(
    (optionId: string | null, laneId: string | null) => {
      // Défauts du schéma, puis pré-remplissage des filtres de la vue, puis la
      // colonne cliquée qui a le dernier mot — y compris « Sans valeur »
      // (undefined = on laisse la cellule vide)
      const row: DbRow = newRow(data.properties, {
        ...rowDefaults,
        ...(groupProp ? { [groupProp.id]: optionId ?? undefined } : {}),
        ...(laneProp && laneId !== null && laneId !== BOARD_NONE ? { [laneProp.id]: laneId } : {}),
      });
      onChange({ ...data, rows: [...data.rows, row] });
      if (titleProp) {
        setEditingRowId(row.id);
        setTitleDraft('');
      }
    },
    [data, groupProp, laneProp, titleProp, rowDefaults, onChange]
  );

  const toggleCollapsed = useCallback(
    (columnId: string) => {
      const next = new Set(collapsed);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      patchBoard({ collapsed: [...next] });
    },
    [collapsed, patchBoard]
  );

  // Aucune propriété select : état vide propre, pas de crash
  if (!groupProp) {
    return (
      <div className="inline-db__board-empty">
        {t('notes.inlineDb.noSelectProperty', 'Add a select property to group cards on the board.')}
      </div>
    );
  }

  const cardSize: BoardCardSize = board.cardSize ?? 'regular';

  const renderCard = (row: DbRow) => {
    const rawTitle = titleProp ? row.cells[titleProp.id] : undefined;
    const cardTitle = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : '';
    const isEditing = editingRowId === row.id;
    const sublines = subProps
      .map((p) => ({ id: p.id, text: sublineFor(p, row, env) }))
      .filter((s): s is { id: string; text: string } => s.text !== null);
    const columnColor = columns.find((c) => c.id === row.cells[groupProp.id])?.color ?? null;
    const progressValue =
      progressProp && typeof row.cells[progressProp.id] === 'number'
        ? clampProgress(row.cells[progressProp.id] as number)
        : progressProp
          ? 0
          : null;

    return (
      <div
        key={row.id}
        className={`inline-db__card inline-db__card--${cardSize} ${
          draggedRowId === row.id ? 'inline-db__card--dragging' : ''
        } ${board.colorCards && columnColor ? 'inline-db__card--tinted' : ''}`}
        style={
          board.colorCards && columnColor
            ? ({ '--inline-db-option-color': columnColor } as React.CSSProperties)
            : undefined
        }
        draggable={!isEditing && !tweaking}
        role="button"
        tabIndex={isEditing ? -1 : 0}
        aria-label={cardTitle || t('notes.inlineDb.untitled', 'Untitled')}
        onDragStart={(e) => handleDragStart(e, row.id)}
        onDragEnd={handleDragEnd}
        onClick={() => {
          // Le corps de la carte OUVRE la fiche : c'est par elle qu'on atteint
          // la progression, l'échéance, les liens — tout ce que le plateau ne
          // montre pas. Le titre, lui, garde le renommage au clic (ci-dessous).
          if (!isEditing) setPanelRowId(row.id);
        }}
        onKeyDown={(e) => {
          if (isEditing) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setPanelRowId(row.id);
          } else if (e.key === 'F2') {
            e.preventDefault();
            startTitleEdit(row);
          }
        }}
      >
        {isEditing ? (
          <input
            className="inline-db__card-title-input"
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitTitleEdit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitTitleEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelTitleEdit();
              }
            }}
          />
        ) : (
          <div
            className={`inline-db__card-title ${cardTitle ? '' : 'inline-db__card-title--empty'}`}
            title={t('notes.inlineDb.renameCard', 'Cliquer pour renommer')}
            onClick={(e) => {
              e.stopPropagation();
              startTitleEdit(row);
            }}
          >
            {cardTitle || t('notes.inlineDb.untitled', 'Untitled')}
          </div>
        )}

        {checkboxProp && cardSize !== 'compact' && (
          <label
            className="inline-db__card-check"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={row.cells[checkboxProp.id] === true}
              onChange={(e) => setCell(row.id, checkboxProp.id, e.target.checked)}
            />
            <span>{checkboxProp.name}</span>
          </label>
        )}

        {sublines.map((s) => (
          <div key={s.id} className="inline-db__card-sub">
            {s.text}
          </div>
        ))}

        {progressProp && progressValue !== null && cardSize !== 'compact' && (
          <CardProgress
            label={progressProp.name}
            value={progressValue}
            readOnly={false}
            onCommit={(next) => setCell(row.id, progressProp.id, next)}
            onTweakingChange={beginTweak}
          />
        )}

        <div className="inline-db__card-actions">
          <button
            type="button"
            className="inline-db__card-icon-btn"
            title={t('notes.inlineDb.openRow', 'Ouvrir la fiche')}
            aria-label={t('notes.inlineDb.openRow', 'Ouvrir la fiche')}
            onClick={(e) => {
              e.stopPropagation();
              setPanelRowId(row.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            }}
          >
            <OpenIcon />
          </button>
          <button
            type="button"
            className="inline-db__card-icon-btn"
            aria-haspopup="menu"
            aria-expanded={menuRowId === row.id}
            title={t('notes.inlineDb.moveCard', 'Move to…')}
            aria-label={t('notes.inlineDb.moveCard', 'Move to…')}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setCardMenu((prev) => {
                if (prev?.rowId === row.id) return null;
                const estHeight = columns.length * 28 + 10;
                const left = Math.max(4, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 4));
                let top = rect.bottom + 4;
                if (top + estHeight > window.innerHeight - 4)
                  top = Math.max(4, rect.top - estHeight - 4);
                return { rowId: row.id, top, left };
              });
            }}
            onKeyDown={(e) => {
              // Enter/Espace seulement : Escape doit atteindre le listener document (fermeture)
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            }}
          >
            <DotsIcon />
          </button>
        </div>

        {cardMenu && cardMenu.rowId === row.id && (
          <div
            className="inline-db__card-menu"
            role="menu"
            ref={menuRef}
            style={{ top: cardMenu.top, left: cardMenu.left }}
          >
            {columns.map((col) => {
              const current =
                col.id === BOARD_NONE
                  ? typeof row.cells[groupProp.id] !== 'string' ||
                    !(groupProp.options ?? []).some((o) => o.id === row.cells[groupProp.id])
                  : row.cells[groupProp.id] === col.id;
              return (
                <button
                  key={col.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  className="inline-db__card-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveRow(row.id, col.id === BOARD_NONE ? null : col.id);
                    setCardMenu(null);
                  }}
                >
                  <span
                    className="inline-db__column-dot"
                    style={
                      col.color
                        ? ({ '--inline-db-option-color': col.color } as React.CSSProperties)
                        : undefined
                    }
                  />
                  <span className="inline-db__card-menu-label">{col.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderColumn = (
    col: { id: string; label: string; color: string | null },
    laneId: string,
    rows: DbRow[]
  ) => {
    const cellKey = `${laneId}::${col.id}`;
    const isCollapsed = collapsed.has(col.id);
    const limit = board.wipLimits?.[col.id];
    const status = wipStatus(rows.length, limit);
    const summary = columnSummary(rows, summaryProp);

    if (isCollapsed) {
      return (
        <button
          key={cellKey}
          type="button"
          className="inline-db__column inline-db__column--collapsed"
          title={t('notes.inlineDb.expandColumn', 'Déplier la colonne')}
          onClick={() => toggleCollapsed(col.id)}
        >
          <span
            className="inline-db__column-dot"
            style={
              col.color
                ? ({ '--inline-db-option-color': col.color } as React.CSSProperties)
                : undefined
            }
          />
          <span className="inline-db__column-count">{rows.length}</span>
          <span className="inline-db__column-title-vertical">{col.label}</span>
        </button>
      );
    }

    return (
      <div
        key={cellKey}
        className={`inline-db__column ${
          dropTargetCol === cellKey ? 'inline-db__column--drop-target' : ''
        } ${status === 'over' ? 'inline-db__column--over-wip' : ''}`}
        onDragOver={(e) => handleDragOver(e, cellKey)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, col.id, laneId)}
      >
        <div className="inline-db__column-header">
          <span
            className="inline-db__column-dot"
            style={
              col.color
                ? ({ '--inline-db-option-color': col.color } as React.CSSProperties)
                : undefined
            }
          />
          <span className="inline-db__column-title">{col.label}</span>
          <span
            className={`inline-db__column-count ${
              status ? `inline-db__column-count--${status}` : ''
            }`}
            title={
              limit
                ? t('notes.inlineDb.wipTitle', {
                    defaultValue: '{{count}} carte(s) pour un plafond de {{limit}}',
                    count: rows.length,
                    limit,
                  })
                : undefined
            }
          >
            {limit ? `${rows.length}/${limit}` : rows.length}
          </span>
          <button
            type="button"
            className="inline-db__column-collapse"
            title={t('notes.inlineDb.collapseColumn', 'Replier la colonne')}
            aria-label={t('notes.inlineDb.collapseColumn', 'Replier la colonne')}
            onClick={() => toggleCollapsed(col.id)}
          >
            <ChevronIcon dir="left" />
          </button>
        </div>

        {summary && summaryProp && (
          <div className="inline-db__column-summary">
            <span className="inline-db__column-summary-label">
              {summary.kind === 'progress'
                ? t('notes.inlineDb.summaryAvg', {
                    defaultValue: '{{name}} · moyenne',
                    name: summaryProp.name,
                  })
                : summary.kind === 'number'
                  ? t('notes.inlineDb.summarySum', {
                      defaultValue: '{{name}} · total',
                      name: summaryProp.name,
                    })
                  : summaryProp.name}
            </span>
            <span className="inline-db__column-summary-value">
              {summary.kind === 'progress'
                ? t('notes.inlineDb.percent', { defaultValue: '{{n}}%', n: summary.value })
                : summary.kind === 'checkbox'
                  ? `${summary.value}/${summary.contributing}`
                  : formatDecimal(summary.value, resolveLocale(i18n.language))}
            </span>
            {summary.ratio !== null && (
              <span className="inline-db__column-summary-bar">
                <span
                  className="inline-db__column-summary-fill"
                  style={{ width: `${summary.ratio}%` }}
                />
              </span>
            )}
          </div>
        )}

        <div className="inline-db__column-cards">{rows.map(renderCard)}</div>
        <button
          type="button"
          className="inline-db__new-card-btn"
          onClick={() => addCard(col.id === BOARD_NONE ? null : col.id, laneId)}
        >
          <PlusIcon />
          <span>{t('notes.inlineDb.newCard', 'New card')}</span>
        </button>
      </div>
    );
  };

  return (
    <div className="inline-db__board-area">
      <div className="inline-db__board-toolbar">
        <label className="inline-db__board-groupby">
          <span className="inline-db__board-groupby-label">
            {t('notes.inlineDb.groupBy', 'Group by')}
          </span>
          <select
            className="inline-db__board-select"
            value={groupProp.id}
            onChange={(e) => onGroupByChange(e.target.value)}
          >
            {selectProps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <div className="inline-db__board-settings-anchor" ref={settingsRef}>
          <button
            type="button"
            className="inline-db__board-settings-btn"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            title={t('notes.inlineDb.boardOptions', 'Options du plateau')}
            aria-label={t('notes.inlineDb.boardOptions', 'Options du plateau')}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <GearIcon />
          </button>

          {settingsOpen && (
            <div className="inline-db__board-settings" role="dialog">
              <div className="inline-db__board-settings-group">
                <span className="inline-db__board-settings-label">
                  {t('notes.inlineDb.swimlanes', 'Couloirs (second axe)')}
                </span>
                <select
                  className="inline-db__board-select"
                  value={board.swimlaneBy ?? ''}
                  onChange={(e) => patchBoard({ swimlaneBy: e.target.value || undefined })}
                >
                  <option value="">{t('notes.inlineDb.none', 'Aucun')}</option>
                  {selectProps
                    .filter((p) => p.id !== groupProp.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="inline-db__board-settings-group">
                <span className="inline-db__board-settings-label">
                  {t('notes.inlineDb.columnSummary', 'Résumé de colonne')}
                </span>
                <select
                  className="inline-db__board-select"
                  value={board.summaryBy ?? ''}
                  onChange={(e) => patchBoard({ summaryBy: e.target.value || undefined })}
                >
                  <option value="">{t('notes.inlineDb.none', 'Aucun')}</option>
                  {summarizableProps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {summarizableProps.length === 0 && (
                  <span className="inline-db__board-settings-hint">
                    {t(
                      'notes.inlineDb.noSummarizable',
                      'Ajoutez une colonne progression, nombre ou case à cocher.'
                    )}
                  </span>
                )}
              </div>

              <div className="inline-db__board-settings-group">
                <span className="inline-db__board-settings-label">
                  {t('notes.inlineDb.cardSize', 'Taille des cartes')}
                </span>
                <div className="inline-db__board-seg">
                  {BOARD_CARD_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className="inline-db__board-seg-btn"
                      aria-pressed={cardSize === size}
                      onClick={() =>
                        patchBoard({ cardSize: size === 'regular' ? undefined : size })
                      }
                    >
                      {size === 'compact'
                        ? t('notes.inlineDb.cardCompact', 'Compacte')
                        : size === 'tall'
                          ? t('notes.inlineDb.cardTall', 'Détaillée')
                          : t('notes.inlineDb.cardRegular', 'Normale')}
                    </button>
                  ))}
                </div>
              </div>

              <label className="inline-db__board-settings-check">
                <input
                  type="checkbox"
                  checked={board.colorCards === true}
                  onChange={(e) => patchBoard({ colorCards: e.target.checked || undefined })}
                />
                <span>{t('notes.inlineDb.colorCards', 'Teinter les cartes')}</span>
              </label>

              <label className="inline-db__board-settings-check">
                <input
                  type="checkbox"
                  checked={board.hideEmpty === true}
                  onChange={(e) => patchBoard({ hideEmpty: e.target.checked || undefined })}
                />
                <span>{t('notes.inlineDb.hideEmptyColumns', 'Masquer les colonnes vides')}</span>
              </label>

              <div className="inline-db__board-settings-group">
                <span className="inline-db__board-settings-label">
                  {t('notes.inlineDb.wipLimits', 'Plafonds d’en-cours')}
                </span>
                <span className="inline-db__board-settings-hint">
                  {t(
                    'notes.inlineDb.wipHint',
                    'Un dépassement se signale, il ne bloque jamais un dépôt.'
                  )}
                </span>
                {columns.map((col) => (
                  <label key={col.id} className="inline-db__board-wip-row">
                    <span
                      className="inline-db__column-dot"
                      style={
                        col.color
                          ? ({ '--inline-db-option-color': col.color } as React.CSSProperties)
                          : undefined
                      }
                    />
                    <span className="inline-db__board-wip-name">{col.label}</span>
                    <input
                      type="number"
                      min={0}
                      className="inline-db__board-wip-input"
                      placeholder="—"
                      value={board.wipLimits?.[col.id] ?? ''}
                      onChange={(e) => {
                        const raw = Number.parseInt(e.target.value, 10);
                        const limits = { ...(board.wipLimits ?? {}) };
                        if (!Number.isFinite(raw) || raw <= 0) delete limits[col.id];
                        else limits[col.id] = raw;
                        patchBoard({
                          wipLimits: Object.keys(limits).length > 0 ? limits : undefined,
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {lanes.map((lane) => {
        const laneRows = rowsInLane(visibleRows, laneProp, lane.id);
        const laneByColumn = splitByColumn(laneRows, groupProp, columns);
        return (
          <div key={lane.id} className="inline-db__lane">
            {laneProp && (
              <div className="inline-db__lane-header">
                <span
                  className="inline-db__column-dot"
                  style={
                    lane.color
                      ? ({ '--inline-db-option-color': lane.color } as React.CSSProperties)
                      : undefined
                  }
                />
                <span className="inline-db__lane-title">{lane.label || noneLabel}</span>
                <span className="inline-db__column-count">{laneRows.length}</span>
              </div>
            )}
            <div className="inline-db__board">
              {shownColumns.map((col) => renderColumn(col, lane.id, laneByColumn[col.id] ?? []))}
            </div>
          </div>
        );
      })}

      {panelRowId &&
        (() => {
          const row = data.rows.find((candidate) => candidate.id === panelRowId);
          if (!row) return null;
          return (
            <RowPanel
              data={data}
              row={row}
              visiblePropertyIds={visiblePropertyIds}
              onChange={onChange}
              onClose={() => setPanelRowId(null)}
            />
          );
        })()}
    </div>
  );
};
