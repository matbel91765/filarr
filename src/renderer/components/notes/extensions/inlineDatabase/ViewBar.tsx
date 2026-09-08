/**
 * ViewBar — Filarr Notes / bases inline
 *
 * Barre des vues enregistrées : onglets (choisir, ajouter, menu par onglet)
 * et les deux popovers Filtres / Trier. Même mécanique que le reste du
 * dossier : popover en `position: fixed` ancré au bouton, fermé par Escape,
 * clic extérieur ou scroll, focus rendu à l'ancre.
 *
 * Ce composant ne décide de RIEN sur les données : il émet des correctifs de
 * vue, le nœud commite (et assainit) au point unique.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DbFilter,
  DbFilterOp,
  DbProperty,
  DbSort,
  DbView,
  DbViewType,
  PropertyType,
} from './types';
import { newId, propertyTypeLabel } from './types';
import {
  isSortableType,
  movePropertyInView,
  reorderPropertyInView,
  setAllPropertiesVisible,
  opNeedsValue,
  opsForType,
  orderedVisibleProperties,
  togglePropertyVisibility,
} from './viewEngine';
import { DateCellPicker } from './DateCellPicker';
import {
  formatDecimal,
  formatDecimalPlain,
  formatDisplayDate,
  isValidIso,
  parseDecimal,
  resolveLocale,
} from './cellFormats';

/** Doit suivre `.inline-db__viewmenu` : la position est calculee sur cette
 *  largeur, une divergence collerait le menu au bord de la fenetre. */
const MENU_WIDTH = 240;
const MENU_EST_HEIGHT = 230;
const PANEL_WIDTH = 330;
const PANEL_EST_HEIGHT = 240;
const DATE_PICKER_WIDTH = 248;
const DATE_PICKER_EST_HEIGHT = 340;

interface Pos {
  top: number;
  left: number;
  /** Hauteur REELLEMENT disponible ici (cf. `anchorPos` de la table). */
  maxHeight: number;
}

const svgProps = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const CloseIcon = () => (
  <svg {...svgProps}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

const PlusIcon = () => (
  <svg {...svgProps}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ChevronIcon = () => (
  <svg {...svgProps} width={11} height={11}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ColumnsIcon = () => (
  <svg {...svgProps} width={13} height={13}>
    <rect x="3" y="4" width="5" height="16" rx="1" />
    <rect x="10" y="4" width="5" height="16" rx="1" />
    <rect x="17" y="4" width="4" height="16" rx="1" />
  </svg>
);

const SearchIcon = () => (
  <svg {...svgProps} width={13} height={13}>
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
);

const EyeIcon = ({ off }: { off?: boolean }) => (
  <svg {...svgProps} width={13} height={13}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
    {off && <line x1="3" y1="21" x2="21" y2="3" />}
  </svg>
);

const FilterIcon = () => (
  <svg {...svgProps} width={13} height={13}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

const SortIcon = () => (
  <svg {...svgProps} width={13} height={13}>
    <line x1="4" y1="7" x2="15" y2="7" />
    <line x1="4" y1="12" x2="12" y2="12" />
    <line x1="4" y1="17" x2="9" y2="17" />
    <polyline points="17 14 20 17 20 6" />
  </svg>
);

/**
 * Champ à état local : commit au blur/Enter, Escape annule sans fermer le
 * popover.
 *
 * Toujours `type="text"`, comme les cellules de la table : un `type="number"`
 * rendrait les flèches de Chromium, refuserait la virgule décimale des langues
 * qui l'emploient et changerait la valeur à la molette. `display` montre le
 * nombre habillé au repos, `inputMode` guide le clavier logiciel.
 */
const DraftField: React.FC<{
  value: string;
  /** Rendu au repos quand il diffère de la saisie (nombre mis en forme) */
  display?: string;
  inputMode?: 'text' | 'decimal';
  ariaLabel: string;
  className?: string;
  autoFocus?: boolean;
  onCommit: (raw: string) => void;
}> = ({ value, display, inputMode, ariaLabel, className, autoFocus, onCommit }) => {
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
          return;
        }
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          // Escape annule la saisie ; il ne doit pas fermer le popover
          e.stopPropagation();
          cancelRef.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

export interface ViewBarProps {
  views: DbView[];
  activeView: DbView;
  properties: DbProperty[];
  /** Lignes que les filtres de la vue active écartent (elles restent en base) */
  hiddenCount: number;
  /** Recherche rapide — EPHEMERE, jamais ecrite dans le document. */
  search: string;
  onSearchChange: (value: string) => void;
  onSelectView: (viewId: string) => void;
  onAddView: () => void;
  onPatchView: (viewId: string, patch: Partial<DbView>) => void;
  onDuplicateView: (viewId: string) => void;
  onDeleteView: (viewId: string) => void;
}

export const ViewBar: React.FC<ViewBarProps> = ({
  views,
  activeView,
  properties,
  hiddenCount,
  search,
  onSearchChange,
  onSelectView,
  onAddView,
  onPatchView,
  onDuplicateView,
  onDeleteView,
}) => {
  const { t, i18n } = useTranslation();
  // Formats pris sur la LANGUE DE L'APP, jamais sur la locale du système
  const locale = resolveLocale(i18n.language);
  const wrapRef = useRef<HTMLDivElement>(null);
  const anchorElRef = useRef<HTMLElement | null>(null);
  const dateAnchorRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const [menuFor, setMenuFor] = useState<{ viewId: string; pos: Pos } | null>(null);
  const [panelFor, setPanelFor] = useState<{
    kind: 'filters' | 'sorts' | 'properties';
    pos: Pos;
  } | null>(null);
  // Sélecteur de date d'un filtre (le panneau des filtres reste ouvert dessous)
  const [datePickerFor, setDatePickerFor] = useState<{ filterId: string; pos: Pos } | null>(null);

  /** Colonnes de type date : les seules qui peuvent porter un calendrier. */
  const dateProperties = properties.filter((prop) => prop.type === 'date');

  /** Colonne en cours de deplacement dans le panneau (glisser-deposer). */
  const [dragPropId, setDragPropId] = useState<string | null>(null);
  const [dropPropId, setDropPropId] = useState<string | null>(null);

  /** Colonnes masquees dans la vue regardee : le chiffre porte par le bouton. */
  const hiddenPropCount = (activeView.hiddenPropertyIds ?? []).filter((id) =>
    properties.some((prop) => prop.id === id)
  ).length;

  const opLabels: Record<DbFilterOp, string> = useMemo(
    () => ({
      contains: t('notes.inlineDb.opContains', 'Contains'),
      notContains: t('notes.inlineDb.opNotContains', 'Does not contain'),
      equals: t('notes.inlineDb.opEquals', 'Is exactly'),
      eq: t('notes.inlineDb.opEq', '='),
      neq: t('notes.inlineDb.opNeq', '≠'),
      gt: t('notes.inlineDb.opGt', '>'),
      lt: t('notes.inlineDb.opLt', '<'),
      gte: t('notes.inlineDb.opGte', '≥'),
      lte: t('notes.inlineDb.opLte', '≤'),
      is: t('notes.inlineDb.opIs', 'Is'),
      isNot: t('notes.inlineDb.opIsNot', 'Is not'),
      isChecked: t('notes.inlineDb.opIsChecked', 'Checked'),
      isUnchecked: t('notes.inlineDb.opIsUnchecked', 'Unchecked'),
      before: t('notes.inlineDb.opBefore', 'Before'),
      after: t('notes.inlineDb.opAfter', 'After'),
      on: t('notes.inlineDb.opOn', 'On'),
      isEmpty: t('notes.inlineDb.opIsEmpty', 'Is empty'),
      isNotEmpty: t('notes.inlineDb.opIsNotEmpty', 'Is not empty'),
    }),
    [t]
  );

  const propsById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);
  const sortableProps = useMemo(
    () => properties.filter((p) => isSortableType(p.type)),
    [properties]
  );

  const anchorPos = useCallback((el: HTMLElement, width: number, estHeight: number): Pos => {
    const rect = el.getBoundingClientRect();
    const MARGIN = 8;
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4));

    // Meme regle que la table : borner, pas seulement basculer. Un menu plus
    // haut que la place disponible debordait de l'ecran sans pouvoir defiler.
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    const above = spaceBelow < estHeight && spaceAbove > spaceBelow;
    const available = Math.max(160, above ? spaceAbove : spaceBelow);
    const height = Math.min(estHeight, available);
    const top = above ? Math.max(4, rect.top - height - 4) : rect.bottom + 4;

    return { top, left, maxHeight: available };
  }, []);

  // Fermeture : Escape / clic extérieur / scroll (les ancres gèrent leur bascule)
  useEffect(() => {
    if (!menuFor && !panelFor && !datePickerFor) return;
    const closeAll = () => {
      setMenuFor(null);
      setPanelFor(null);
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
  }, [menuFor, panelFor, datePickerFor]);

  // À la fermeture : focus rendu à l'ancre si personne ne l'a pris
  useEffect(() => {
    const open = !!(menuFor || panelFor || datePickerFor);
    if (!open && wasOpenRef.current) {
      if (document.activeElement === document.body) {
        anchorElRef.current?.focus({ preventScroll: true });
      }
      anchorElRef.current = null;
    }
    wasOpenRef.current = open;
  }, [menuFor, panelFor, datePickerFor]);

  const toggleMenu = useCallback(
    (viewId: string, e: React.MouseEvent<HTMLButtonElement>) => {
      const pos = anchorPos(e.currentTarget, MENU_WIDTH, MENU_EST_HEIGHT);
      anchorElRef.current = e.currentTarget;
      setPanelFor(null);
      setMenuFor((cur) => (cur?.viewId === viewId ? null : { viewId, pos }));
    },
    [anchorPos]
  );

  const togglePanel = useCallback(
    (kind: 'filters' | 'sorts' | 'properties', e: React.MouseEvent<HTMLButtonElement>) => {
      const pos = anchorPos(e.currentTarget, PANEL_WIDTH, PANEL_EST_HEIGHT);
      anchorElRef.current = e.currentTarget;
      setMenuFor(null);
      setDatePickerFor(null);
      setPanelFor((cur) => (cur?.kind === kind ? null : { kind, pos }));
    },
    [anchorPos]
  );

  /**
   * Sélecteur de date d'un filtre. `anchorElRef` n'est PAS repris : il garde le
   * bouton qui a ouvert le panneau, à qui le focus doit revenir quand tout se
   * ferme — le bouton de date, lui, aura disparu avec le panneau.
   */
  const toggleFilterDate = useCallback(
    (filterId: string, e: React.MouseEvent<HTMLButtonElement>) => {
      const pos = anchorPos(e.currentTarget, DATE_PICKER_WIDTH, DATE_PICKER_EST_HEIGHT);
      dateAnchorRef.current = e.currentTarget;
      setMenuFor(null);
      setDatePickerFor((cur) => (cur?.filterId === filterId ? null : { filterId, pos }));
    },
    [anchorPos]
  );

  /** Fermeture du seul calendrier : le panneau reste ouvert, le focus rentre dedans */
  const closeFilterDate = useCallback(() => {
    setDatePickerFor(null);
    dateAnchorRef.current?.focus({ preventScroll: true });
  }, []);

  /* ---- Correctifs de filtres / tris de la vue active ---- */
  const setFilters = useCallback(
    (filters: DbFilter[]) => onPatchView(activeView.id, { filters }),
    [activeView.id, onPatchView]
  );
  const setSorts = useCallback(
    (sorts: DbSort[]) => onPatchView(activeView.id, { sorts }),
    [activeView.id, onPatchView]
  );

  const addFilter = useCallback(() => {
    const prop = properties[0];
    if (!prop) return;
    const op = opsForType(prop.type)[0];
    setFilters([...activeView.filters, { id: newId(), propertyId: prop.id, op }]);
  }, [properties, activeView.filters, setFilters]);

  const patchFilter = useCallback(
    (filterId: string, patch: Partial<DbFilter>) => {
      setFilters(
        activeView.filters.map((f) => {
          if (f.id !== filterId) return f;
          const next = { ...f, ...patch };
          // Une valeur mise à undefined doit VRAIMENT disparaître de l'objet
          if ('value' in patch && patch.value === undefined) delete next.value;
          return next;
        })
      );
    },
    [activeView.filters, setFilters]
  );

  const changeFilterProperty = useCallback(
    (filterId: string, propertyId: string) => {
      const prop = propsById.get(propertyId);
      if (!prop) return;
      // Changer de propriété rebat l'opérateur et jette la valeur de l'ancienne famille
      patchFilter(filterId, {
        propertyId,
        op: opsForType(prop.type)[0],
        value: undefined,
      });
    },
    [propsById, patchFilter]
  );

  const removeFilter = useCallback(
    (filterId: string) => setFilters(activeView.filters.filter((f) => f.id !== filterId)),
    [activeView.filters, setFilters]
  );

  const addSort = useCallback(() => {
    const used = new Set(activeView.sorts.map((s) => s.propertyId));
    const prop = sortableProps.find((p) => !used.has(p.id));
    if (!prop) return;
    setSorts([...activeView.sorts, { propertyId: prop.id, direction: 'asc' }]);
  }, [activeView.sorts, sortableProps, setSorts]);

  const patchSort = useCallback(
    (index: number, patch: Partial<DbSort>) => {
      setSorts(activeView.sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    },
    [activeView.sorts, setSorts]
  );

  const removeSort = useCallback(
    (index: number) => setSorts(activeView.sorts.filter((_, i) => i !== index)),
    [activeView.sorts, setSorts]
  );

  /* ---- Éditeur de la valeur d'un filtre (selon la famille du type) ---- */
  const renderFilterValue = (filter: DbFilter, prop: DbProperty): React.ReactNode => {
    if (!opNeedsValue(filter.op)) return <span className="inline-db__filter-novalue" />;
    const label = t('notes.inlineDb.filterValueAria', 'Value for {{name}}', { name: prop.name });
    const type: PropertyType = prop.type;

    if (type === 'select' || type === 'multiSelect') {
      const options = prop.options ?? [];
      return (
        <select
          className="inline-db__filter-select"
          aria-label={label}
          value={typeof filter.value === 'string' ? filter.value : ''}
          onChange={(e) =>
            patchFilter(filter.id, { value: e.target.value === '' ? undefined : e.target.value })
          }
        >
          <option value="">{t('notes.inlineDb.filterPickOption', 'Choose…')}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label || t('notes.inlineDb.untitled', 'Untitled')}
            </option>
          ))}
        </select>
      );
    }

    // L'agrégat se compare comme le nombre qu'il rend (jamais comme du texte).
    // Analyse décimale de la langue : « 1,5 » vaut 1,5 en français.
    if (type === 'number' || type === 'rating' || type === 'progress' || type === 'rollup') {
      const n =
        typeof filter.value === 'number' && Number.isFinite(filter.value) ? filter.value : null;
      return (
        <DraftField
          className="inline-db__filter-input"
          ariaLabel={label}
          inputMode="decimal"
          value={n === null ? '' : formatDecimalPlain(n, locale)}
          display={n === null ? '' : formatDecimal(n, locale)}
          onCommit={(raw) => {
            const parsed = parseDecimal(raw, locale);
            patchFilter(filter.id, { value: parsed === null ? undefined : parsed });
          }}
        />
      );
    }

    if (type === 'date' || type === 'createdTime' || type === 'updatedTime') {
      const iso = typeof filter.value === 'string' && isValidIso(filter.value) ? filter.value : '';
      const open = datePickerFor?.filterId === filter.id;
      // Sélecteur MAISON, comme les cellules : le calendrier de Chromium n'a ni
      // la police ni les couleurs du produit, et il ignore la langue de l'app
      return (
        <button
          type="button"
          className="inline-db__filter-input inline-db__filter-date"
          data-db-anchor=""
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          onClick={(e) => toggleFilterDate(filter.id, e)}
        >
          {iso !== '' ? (
            formatDisplayDate(iso, locale)
          ) : (
            <span className="inline-db__filter-date-hint">
              {t('notes.inlineDb.datePick', 'Pick a date')}
            </span>
          )}
        </button>
      );
    }

    // relation comprise : la saisie porte sur les TITRES des lignes liées
    return (
      <DraftField
        className="inline-db__filter-input"
        ariaLabel={label}
        value={typeof filter.value === 'string' ? filter.value : ''}
        onCommit={(raw) => patchFilter(filter.id, { value: raw === '' ? undefined : raw })}
      />
    );
  };

  /** Valeur du filtre dont le calendrier est ouvert ('' = aucune date posée) */
  const filterDateValue = (() => {
    if (!datePickerFor) return '';
    const raw = activeView.filters.find((f) => f.id === datePickerFor.filterId)?.value;
    return typeof raw === 'string' && isValidIso(raw) ? raw : '';
  })();

  const menuView = menuFor ? views.find((v) => v.id === menuFor.viewId) : undefined;
  const filterCount = activeView.filters.length;
  const sortCount = activeView.sorts.length;
  const canAddSort = sortableProps.length > activeView.sorts.length;

  return (
    <div className="inline-db__viewbar" ref={wrapRef}>
      <div className="inline-db__viewtabs">
        {views.map((view) => {
          const active = view.id === activeView.id;
          const name = view.name || t('notes.inlineDb.untitled', 'Untitled');
          return (
            <span
              key={view.id}
              className={`inline-db__viewtab-wrap ${
                active ? 'inline-db__viewtab-wrap--active' : ''
              }`}
            >
              <button
                type="button"
                className="inline-db__viewtab"
                aria-pressed={active}
                onClick={() => onSelectView(view.id)}
              >
                {name}
              </button>
              <button
                type="button"
                className="inline-db__viewtab-menu"
                data-db-anchor=""
                aria-haspopup="dialog"
                aria-expanded={menuFor?.viewId === view.id}
                aria-label={t('notes.inlineDb.viewOptions', 'Options for view {{name}}', { name })}
                title={t('notes.inlineDb.viewOptions', 'Options for view {{name}}', { name })}
                onClick={(e) => toggleMenu(view.id, e)}
              >
                <ChevronIcon />
              </button>
            </span>
          );
        })}
        <button
          type="button"
          className="inline-db__viewtab-add"
          aria-label={t('notes.inlineDb.addView', 'Add a view')}
          title={t('notes.inlineDb.addView', 'Add a view')}
          onClick={onAddView}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="inline-db__viewbar-tools">
        {hiddenCount > 0 && (
          <span className="inline-db__hidden-count" role="status">
            {t('notes.inlineDb.hiddenRows', '{{count}} rows hidden', { count: hiddenCount })}
          </span>
        )}
        <button
          type="button"
          className={`inline-db__tool-btn ${filterCount > 0 ? 'inline-db__tool-btn--on' : ''}`}
          data-db-anchor=""
          aria-haspopup="dialog"
          aria-expanded={panelFor?.kind === 'filters'}
          onClick={(e) => togglePanel('filters', e)}
        >
          <FilterIcon />
          {t('notes.inlineDb.filters', 'Filters')}
          {filterCount > 0 && <span className="inline-db__tool-count">{filterCount}</span>}
        </button>
        <button
          type="button"
          className={`inline-db__tool-btn ${sortCount > 0 ? 'inline-db__tool-btn--on' : ''}`}
          data-db-anchor=""
          aria-haspopup="dialog"
          aria-expanded={panelFor?.kind === 'sorts'}
          onClick={(e) => togglePanel('sorts', e)}
        >
          <SortIcon />
          {t('notes.inlineDb.sort', 'Sort')}
          {sortCount > 0 && <span className="inline-db__tool-count">{sortCount}</span>}
        </button>
        {/* Le reglage des colonnes ne veut rien dire sur un kanban : une carte
            n'a pas de colonnes. Mieux vaut pas de bouton qu'un bouton sans effet. */}
        {(activeView.type === 'table' || activeView.type === 'gallery') && (
          <button
            type="button"
            className={`inline-db__tool-btn ${hiddenPropCount > 0 ? 'inline-db__tool-btn--on' : ''}`}
            data-db-anchor=""
            aria-haspopup="dialog"
            aria-expanded={panelFor?.kind === 'properties'}
            onClick={(e) => togglePanel('properties', e)}
          >
            <ColumnsIcon />
            {t('notes.inlineDb.properties', 'Properties')}
            {hiddenPropCount > 0 && (
              <span className="inline-db__tool-count">{hiddenPropCount}</span>
            )}
          </button>
        )}
        <label className="inline-db__search">
          <SearchIcon />
          <input
            type="search"
            className="inline-db__search-input"
            value={search}
            placeholder={t('notes.inlineDb.searchPlaceholder', 'Search…')}
            aria-label={t('notes.inlineDb.search', 'Search this database')}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>
      </div>

      {menuFor && menuView && (
        <div
          className="inline-db__popover inline-db__viewmenu"
          style={{ top: menuFor.pos.top, left: menuFor.pos.left, maxHeight: menuFor.pos.maxHeight }}
          role="dialog"
          aria-label={t('notes.inlineDb.viewOptions', 'Options for view {{name}}', {
            name: menuView.name,
          })}
        >
          <div className="inline-db__pe-field">
            <label className="inline-db__pe-label" htmlFor={`db-view-name-${menuView.id}`}>
              {t('notes.inlineDb.viewName', 'View name')}
            </label>
            <DraftField
              className="inline-db__pe-input"
              ariaLabel={t('notes.inlineDb.viewName', 'View name')}
              value={menuView.name}
              autoFocus
              onCommit={(raw) => {
                const v = raw.trim();
                if (v !== '') onPatchView(menuView.id, { name: v });
              }}
            />
          </div>

          <div className="inline-db__pe-field">
            <span className="inline-db__pe-label">{t('notes.inlineDb.viewType', 'Layout')}</span>
            <div className="inline-db__viewmenu-types">
              {(['table', 'board', 'calendar', 'gallery'] as DbViewType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`inline-db__viewmenu-type ${
                    menuView.type === type ? 'inline-db__viewmenu-type--active' : ''
                  }`}
                  aria-pressed={menuView.type === type}
                  onClick={() => onPatchView(menuView.id, { type })}
                >
                  {type === 'table'
                    ? t('notes.inlineDb.table', 'Table')
                    : type === 'board'
                      ? t('notes.inlineDb.board', 'Board')
                      : type === 'calendar'
                        ? t('notes.inlineDb.calendar', 'Calendar')
                        : t('notes.inlineDb.gallery', 'Gallery')}
                </button>
              ))}
            </div>
          </div>

          {/* La colonne de date d'un calendrier : sans elle, la vue retombe sur
              la premiere colonne de type date — mais la designer explicitement
              est le seul moyen d'en choisir une autre. */}
          {menuView.type === 'calendar' && (
            <div className="inline-db__pe-field">
              <span className="inline-db__pe-label">
                {t('notes.inlineDb.calendarDate', 'Date column')}
              </span>
              {dateProperties.length === 0 ? (
                <span className="inline-db__viewpanel-hint">
                  {t('notes.inlineDb.calendarNoDate', 'This database has no date column yet.')}
                </span>
              ) : (
                <select
                  className="inline-db__pe-select"
                  value={menuView.dateProperty ?? dateProperties[0].id}
                  onChange={(e) => onPatchView(menuView.id, { dateProperty: e.target.value })}
                >
                  {dateProperties.map((prop) => (
                    <option key={prop.id} value={prop.id}>
                      {prop.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="inline-db__pe-divider" role="presentation" />

          <button
            type="button"
            className="inline-db__viewmenu-item"
            onClick={() => {
              onDuplicateView(menuView.id);
              setMenuFor(null);
            }}
          >
            {t('notes.inlineDb.duplicateView', 'Duplicate view')}
          </button>
          <button
            type="button"
            className="inline-db__viewmenu-item inline-db__viewmenu-item--danger"
            disabled={views.length <= 1}
            title={
              views.length <= 1
                ? t('notes.inlineDb.deleteViewLast', 'A database keeps at least one view')
                : undefined
            }
            onClick={() => {
              onDeleteView(menuView.id);
              setMenuFor(null);
            }}
          >
            {t('notes.inlineDb.deleteView', 'Delete view')}
          </button>
        </div>
      )}

      {panelFor?.kind === 'filters' && (
        <div
          className="inline-db__popover inline-db__viewpanel"
          style={{
            top: panelFor.pos.top,
            left: panelFor.pos.left,
            maxHeight: panelFor.pos.maxHeight,
          }}
          role="dialog"
          aria-label={t('notes.inlineDb.filters', 'Filters')}
        >
          <div className="inline-db__viewpanel-head">
            <span className="inline-db__viewpanel-title">
              {t('notes.inlineDb.filters', 'Filters')}
            </span>
            <button
              type="button"
              className="inline-db__pe-icon-btn"
              aria-label={t('notes.inlineDb.close', 'Close')}
              onClick={() => setPanelFor(null)}
            >
              <CloseIcon />
            </button>
          </div>

          {activeView.filters.length === 0 ? (
            <p className="inline-db__viewpanel-empty">
              {t('notes.inlineDb.noFilters', 'No filter yet — this view shows every row.')}
            </p>
          ) : (
            <p className="inline-db__viewpanel-hint">
              {t(
                'notes.inlineDb.filtersAndHint',
                'A row shows up when it matches every condition.'
              )}
            </p>
          )}

          <div className="inline-db__filter-list">
            {activeView.filters.map((filter, index) => {
              const prop = propsById.get(filter.propertyId);
              if (!prop) return null;
              return (
                <div key={filter.id} className="inline-db__filter-row">
                  <span className="inline-db__filter-join">
                    {index === 0
                      ? t('notes.inlineDb.filterWhere', 'Where')
                      : t('notes.inlineDb.filterAnd', 'and')}
                  </span>
                  <select
                    className="inline-db__filter-select"
                    aria-label={t('notes.inlineDb.filterPropertyAria', 'Filtered property')}
                    value={filter.propertyId}
                    onChange={(e) => changeFilterProperty(filter.id, e.target.value)}
                  >
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || t('notes.inlineDb.untitled', 'Untitled')}
                      </option>
                    ))}
                  </select>
                  <select
                    className="inline-db__filter-select"
                    aria-label={t('notes.inlineDb.filterOperatorAria', 'Condition')}
                    value={filter.op}
                    onChange={(e) =>
                      patchFilter(filter.id, {
                        op: e.target.value as DbFilterOp,
                        // L'opérateur change de nature : la valeur d'avant ne veut plus rien dire
                        value: undefined,
                      })
                    }
                  >
                    {opsForType(prop.type).map((op) => (
                      <option key={op} value={op}>
                        {opLabels[op]}
                      </option>
                    ))}
                  </select>
                  {renderFilterValue(filter, prop)}
                  <button
                    type="button"
                    className="inline-db__pe-icon-btn"
                    aria-label={t('notes.inlineDb.removeFilter', 'Remove filter')}
                    onClick={() => removeFilter(filter.id)}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="inline-db__viewpanel-add"
            disabled={properties.length === 0}
            onClick={addFilter}
          >
            <PlusIcon />
            {t('notes.inlineDb.addFilter', 'Add a filter')}
          </button>
        </div>
      )}

      {panelFor?.kind === 'sorts' && (
        <div
          className="inline-db__popover inline-db__viewpanel"
          style={{
            top: panelFor.pos.top,
            left: panelFor.pos.left,
            maxHeight: panelFor.pos.maxHeight,
          }}
          role="dialog"
          aria-label={t('notes.inlineDb.sort', 'Sort')}
        >
          <div className="inline-db__viewpanel-head">
            <span className="inline-db__viewpanel-title">{t('notes.inlineDb.sort', 'Sort')}</span>
            <button
              type="button"
              className="inline-db__pe-icon-btn"
              aria-label={t('notes.inlineDb.close', 'Close')}
              onClick={() => setPanelFor(null)}
            >
              <CloseIcon />
            </button>
          </div>

          {activeView.sorts.length === 0 ? (
            <p className="inline-db__viewpanel-empty">
              {t('notes.inlineDb.noSorts', 'No sort yet — rows keep their own order.')}
            </p>
          ) : (
            <p className="inline-db__viewpanel-hint">
              {t('notes.inlineDb.sortsHint', 'Applied in order; empty values always come last.')}{' '}
              {/* Dit ici plutôt que découvert là-bas : un tri éteint la poignée de la table */}
              {t(
                'notes.inlineDb.sortsBlockReorder',
                'While a sort is on, rows cannot be moved by hand.'
              )}
            </p>
          )}

          <div className="inline-db__filter-list">
            {activeView.sorts.map((sort, index) => {
              const prop = propsById.get(sort.propertyId);
              if (!prop) return null;
              const used = new Set(
                activeView.sorts.filter((_, i) => i !== index).map((s) => s.propertyId)
              );
              return (
                <div key={`${sort.propertyId}-${index}`} className="inline-db__filter-row">
                  <span className="inline-db__filter-join">{index + 1}</span>
                  <select
                    className="inline-db__filter-select"
                    aria-label={t('notes.inlineDb.sortPropertyAria', 'Sorted property')}
                    value={sort.propertyId}
                    onChange={(e) => patchSort(index, { propertyId: e.target.value })}
                  >
                    {sortableProps
                      .filter((p) => !used.has(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || t('notes.inlineDb.untitled', 'Untitled')}
                        </option>
                      ))}
                  </select>
                  <select
                    className="inline-db__filter-select"
                    aria-label={t('notes.inlineDb.sortDirectionAria', 'Direction')}
                    value={sort.direction}
                    onChange={(e) =>
                      patchSort(index, { direction: e.target.value as DbSort['direction'] })
                    }
                  >
                    <option value="asc">{t('notes.inlineDb.sortAsc', 'Ascending')}</option>
                    <option value="desc">{t('notes.inlineDb.sortDesc', 'Descending')}</option>
                  </select>
                  <button
                    type="button"
                    className="inline-db__pe-icon-btn"
                    aria-label={t('notes.inlineDb.removeSort', 'Remove sort')}
                    onClick={() => removeSort(index)}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="inline-db__viewpanel-add"
            disabled={!canAddSort}
            onClick={addSort}
          >
            <PlusIcon />
            {t('notes.inlineDb.addSort', 'Add a sort')}
          </button>
        </div>
      )}

      {panelFor?.kind === 'properties' && (
        <div
          className="inline-db__popover inline-db__viewpanel"
          style={{
            top: panelFor.pos.top,
            left: panelFor.pos.left,
            maxHeight: panelFor.pos.maxHeight,
          }}
          role="dialog"
          aria-label={t('notes.inlineDb.properties', 'Properties')}
        >
          <div className="inline-db__viewpanel-head">
            <span className="inline-db__viewpanel-title">
              {t('notes.inlineDb.properties', 'Properties')}
            </span>
            <button
              type="button"
              className="inline-db__pe-icon-btn"
              aria-label={t('notes.inlineDb.close', 'Close')}
              onClick={() => setPanelFor(null)}
            >
              <CloseIcon />
            </button>
          </div>

          <p className="inline-db__viewpanel-hint">
            {t('notes.inlineDb.propertiesHint', 'Hiding a column never deletes its data.')}
          </p>

          <div className="inline-db__prop-bulk">
            <button
              type="button"
              className="inline-db__prop-bulk-btn"
              onClick={() =>
                onPatchView(activeView.id, setAllPropertiesVisible(activeView, properties, true))
              }
            >
              {t('notes.inlineDb.showAllColumns', 'Show all')}
            </button>
            <button
              type="button"
              className="inline-db__prop-bulk-btn"
              onClick={() =>
                onPatchView(activeView.id, setAllPropertiesVisible(activeView, properties, false))
              }
            >
              {t('notes.inlineDb.hideAllColumns', 'Hide all but the first')}
            </button>
          </div>

          <div className="inline-db__proplist">
            {orderedVisibleProperties(properties, { propertyOrder: activeView.propertyOrder }).map(
              (prop, index, list) => {
                const isHidden = (activeView.hiddenPropertyIds ?? []).includes(prop.id);
                return (
                  <div
                    key={prop.id}
                    className={`inline-db__proprow ${dropPropId === prop.id ? 'is-drop' : ''} ${
                      dragPropId === prop.id ? 'is-dragging' : ''
                    }`}
                    onDragOver={(e) => {
                      if (!dragPropId || dragPropId === prop.id) return;
                      e.preventDefault();
                      setDropPropId(prop.id);
                    }}
                    onDragLeave={() => setDropPropId((cur) => (cur === prop.id ? null : cur))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragPropId && dragPropId !== prop.id) {
                        onPatchView(
                          activeView.id,
                          reorderPropertyInView(activeView, properties, dragPropId, prop.id)
                        );
                      }
                      setDragPropId(null);
                      setDropPropId(null);
                    }}
                  >
                    <span
                      className="inline-db__prop-grip"
                      draggable
                      aria-hidden="true"
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        // Sans donnee, Firefox refuse de demarrer le glisser.
                        e.dataTransfer.setData('text/plain', prop.id);
                        setDragPropId(prop.id);
                      }}
                      onDragEnd={() => {
                        setDragPropId(null);
                        setDropPropId(null);
                      }}
                    >
                      <svg {...svgProps} width={11} height={11}>
                        <circle cx="9" cy="6" r="1.6" fill="currentColor" stroke="none" />
                        <circle cx="15" cy="6" r="1.6" fill="currentColor" stroke="none" />
                        <circle cx="9" cy="12" r="1.6" fill="currentColor" stroke="none" />
                        <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
                        <circle cx="9" cy="18" r="1.6" fill="currentColor" stroke="none" />
                        <circle cx="15" cy="18" r="1.6" fill="currentColor" stroke="none" />
                      </svg>
                    </span>
                    <button
                      type="button"
                      className={`inline-db__prop-toggle ${isHidden ? 'is-hidden' : ''}`}
                      aria-pressed={!isHidden}
                      title={
                        isHidden
                          ? t('notes.inlineDb.showColumn', 'Show this column')
                          : t('notes.inlineDb.hideColumn', 'Hide this column')
                      }
                      onClick={() =>
                        onPatchView(
                          activeView.id,
                          togglePropertyVisibility(activeView, properties, prop.id)
                        )
                      }
                    >
                      <EyeIcon off={isHidden} />
                      <span className="inline-db__prop-name">{prop.name}</span>
                      <span className="inline-db__prop-type">{propertyTypeLabel(prop.type)}</span>
                    </button>
                    <span className="inline-db__prop-move">
                      <button
                        type="button"
                        className="inline-db__pe-icon-btn"
                        disabled={index === 0}
                        aria-label={t('notes.inlineDb.moveUp', 'Move up')}
                        onClick={() =>
                          onPatchView(
                            activeView.id,
                            movePropertyInView(activeView, properties, prop.id, -1)
                          )
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="inline-db__pe-icon-btn"
                        disabled={index === list.length - 1}
                        aria-label={t('notes.inlineDb.moveDown', 'Move down')}
                        onClick={() =>
                          onPatchView(
                            activeView.id,
                            movePropertyInView(activeView, properties, prop.id, 1)
                          )
                        }
                      >
                        ↓
                      </button>
                    </span>
                  </div>
                );
              }
            )}
          </div>
        </div>
      )}

      {datePickerFor && (
        <div
          className="inline-db__popover inline-db__datepicker"
          style={{
            top: datePickerFor.pos.top,
            left: datePickerFor.pos.left,
            maxHeight: datePickerFor.pos.maxHeight,
          }}
          role="dialog"
          aria-label={t('notes.inlineDb.dateCalendar', 'Calendar')}
        >
          <DateCellPicker
            value={filterDateValue}
            onCommit={(iso) =>
              patchFilter(datePickerFor.filterId, { value: iso === null ? undefined : iso })
            }
            onClose={closeFilterDate}
          />
        </div>
      )}
    </div>
  );
};
