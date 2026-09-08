/**
 * ColumnMenu — ce qui s'ouvre au clic sur l'en-tête d'une colonne.
 *
 * Avant, ce clic ouvrait directement l'éditeur de propriété : un nom, un type,
 * deux flèches de position, un bouton « supprimer ». Tout ce qu'on fait
 * RÉELLEMENT depuis une colonne — filtrer dessus, trier, regrouper, calculer,
 * masquer, insérer une voisine, dupliquer — vivait ailleurs, ou nulle part.
 *
 * Ce menu rassemble ces gestes au seul endroit où on les cherche. L'éditeur de
 * propriété reste, derrière « Modifier la propriété » : il porte les réglages
 * longs (options d'un choix, cible d'une relation, agrégat, formule) qui n'ont
 * pas leur place dans une liste d'actions.
 *
 * Deux pages, jamais deux fenêtres : le choix du type se fait DANS le menu (une
 * grille cherchable), parce qu'empiler un second popover sur le premier fait
 * perdre le fil de ce qu'on réglait.
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { propertyTypeLabel } from './types';
import type { DbProperty, PropertyType } from './types';
import { svgProps, typeIcon } from './typeIcons';
import { calculationsForType } from './columnCalculations';
import type { DbCalculation } from './columnCalculations';

export interface ColumnMenuProps {
  property: DbProperty;
  /** Position dans le schéma : décide des flèches et des insertions. */
  index: number;
  total: number;
  /** Calcul posé en pied de cette colonne dans la vue regardée. */
  calculation: DbCalculation;
  /** La vue regardée peut-elle regrouper (kanban) sur cette colonne ? */
  canGroup: boolean;
  /** Sens du tri actif sur cette colonne, s'il y en a un. */
  sortDirection: 'asc' | 'desc' | null;
  onRename: (name: string) => void;
  onChangeType: (type: PropertyType) => void;
  onSort: (direction: 'asc' | 'desc' | null) => void;
  onGroupBy: () => void;
  onCalculate: (calculation: DbCalculation) => void;
  onFilter: () => void;
  onHide: () => void;
  onInsert: (side: 'left' | 'right') => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onOpenAdvanced: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Types proposés, dans l'ordre du sélecteur.
 *
 * `createdTime` et `updatedTime` en sont ABSENTS : ils sont posés par le
 * système et se dérivent de la ligne. Les proposer ferait croire qu'on peut les
 * remplir.
 */
const PICKABLE: PropertyType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'checkbox',
  'date',
  'person',
  'url',
  'email',
  'phone',
  'rating',
  'progress',
  'note',
  'relation',
  'rollup',
  'formula',
];

/**
 * Icônes des ACTIONS du menu.
 *
 * Chacune dit ce que l'action FAIT — un entonnoir pour filtrer, des barres
 * décroissantes pour trier, un œil barré pour masquer. Une puce générique
 * répétée douze fois n'aide personne à retrouver la bonne ligne.
 */
const ActionIcon: React.FC<{ kind: string }> = ({ kind }) => {
  switch (kind) {
    case 'edit':
      return (
        <svg {...svgProps}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
        </svg>
      );
    case 'filter':
      return (
        <svg {...svgProps}>
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      );
    case 'sortAsc':
      return (
        <svg {...svgProps}>
          <line x1="4" y1="7" x2="10" y2="7" />
          <line x1="4" y1="12" x2="14" y2="12" />
          <line x1="4" y1="17" x2="18" y2="17" />
          <polyline points="17 10 20 7 20 17" />
        </svg>
      );
    case 'sortDesc':
      return (
        <svg {...svgProps}>
          <line x1="4" y1="7" x2="18" y2="7" />
          <line x1="4" y1="12" x2="14" y2="12" />
          <line x1="4" y1="17" x2="10" y2="17" />
          <polyline points="17 14 20 17 20 7" />
        </svg>
      );
    case 'group':
      return (
        <svg {...svgProps}>
          <rect x="3" y="4" width="7" height="16" rx="1" />
          <rect x="14" y="4" width="7" height="10" rx="1" />
        </svg>
      );
    case 'calc':
      return (
        <svg {...svgProps}>
          <polyline points="18 5 6 5 12 12 6 19 18 19" />
        </svg>
      );
    case 'hide':
      return (
        <svg {...svgProps}>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
          <circle cx="12" cy="12" r="3" />
          <line x1="3" y1="21" x2="21" y2="3" />
        </svg>
      );
    case 'insertLeft':
      return (
        <svg {...svgProps}>
          <line x1="4" y1="4" x2="4" y2="20" />
          <rect x="9" y="6" width="11" height="12" rx="1" />
          <line x1="14.5" y1="9" x2="14.5" y2="15" />
          <line x1="11.5" y1="12" x2="17.5" y2="12" />
        </svg>
      );
    case 'insertRight':
      return (
        <svg {...svgProps}>
          <line x1="20" y1="4" x2="20" y2="20" />
          <rect x="4" y="6" width="11" height="12" rx="1" />
          <line x1="9.5" y1="9" x2="9.5" y2="15" />
          <line x1="6.5" y1="12" x2="12.5" y2="12" />
        </svg>
      );
    case 'duplicate':
      return (
        <svg {...svgProps}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      );
    case 'delete':
      return (
        <svg {...svgProps}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      );
    default:
      return null;
  }
};

type Page = 'main' | 'type';

export const ColumnMenu: React.FC<ColumnMenuProps> = ({
  property,
  index,
  total,
  calculation,
  canGroup,
  sortDirection,
  onRename,
  onChangeType,
  onSort,
  onGroupBy,
  onCalculate,
  onFilter,
  onHide,
  onInsert,
  onDuplicate,
  onMove,
  onOpenAdvanced,
  onDelete,
  onClose,
}) => {
  const { t } = useTranslation();
  const [page, setPage] = useState<Page>('main');
  const [typeQuery, setTypeQuery] = useState('');
  const [showCalc, setShowCalc] = useState(false);

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

  const shownTypes = useMemo(() => {
    const needle = typeQuery.trim().toLowerCase();
    if (needle === '') return PICKABLE;
    return PICKABLE.filter((type) => propertyTypeLabel(type).toLowerCase().includes(needle));
  }, [typeQuery]);

  if (page === 'type') {
    return (
      <div className="inline-db__colmenu">
        <div className="inline-db__colmenu-head">
          <button
            type="button"
            className="inline-db__colmenu-back"
            onClick={() => setPage('main')}
            aria-label={t('common.back', 'Retour')}
          >
            ‹
          </button>
          <span className="inline-db__colmenu-title">
            {t('notes.inlineDb.pickType', 'Select the type')}
          </span>
        </div>

        <input
          type="search"
          className="inline-db__colmenu-search"
          value={typeQuery}
          autoFocus
          placeholder={t('notes.inlineDb.searchType', 'Search a type…')}
          aria-label={t('notes.inlineDb.searchType', 'Search a type…')}
          onChange={(e) => setTypeQuery(e.target.value)}
        />

        <div className="inline-db__typegrid">
          {shownTypes.map((type) => (
            <button
              key={type}
              type="button"
              className={`inline-db__typeitem ${type === property.type ? 'is-on' : ''}`}
              onClick={() => {
                onChangeType(type);
                setPage('main');
              }}
            >
              <span className="inline-db__typeitem-icon" aria-hidden="true">
                {typeIcon(type)}
              </span>
              <span className="inline-db__typeitem-label">{propertyTypeLabel(type)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="inline-db__colmenu">
      <input
        className="inline-db__colmenu-name"
        value={property.name}
        aria-label={t('notes.inlineDb.propertyName', 'Property name')}
        onChange={(e) => onRename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onClose();
        }}
      />

      <button type="button" className="inline-db__colmenu-item" onClick={() => setPage('type')}>
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            {typeIcon(property.type)}
          </span>
          {t('notes.inlineDb.type', 'Type')}
        </span>
        <span className="inline-db__colmenu-value">{propertyTypeLabel(property.type)} ›</span>
      </button>

      <button type="button" className="inline-db__colmenu-item" onClick={onOpenAdvanced}>
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="edit" />
          </span>
          {t('notes.inlineDb.editProperty2', 'Edit property')}
        </span>
        <span className="inline-db__colmenu-value">›</span>
      </button>

      <div className="inline-db__colmenu-sep" role="presentation" />

      <button type="button" className="inline-db__colmenu-item" onClick={onFilter}>
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="filter" />
          </span>
          {t('notes.inlineDb.filterOnColumn', 'Filter on this column')}
        </span>
      </button>

      <button
        type="button"
        className="inline-db__colmenu-item"
        onClick={() => onSort(sortDirection === 'asc' ? null : 'asc')}
      >
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="sortAsc" />
          </span>
          {t('notes.inlineDb.sortAsc', 'Sort ascending')}
        </span>
        {sortDirection === 'asc' && <span className="inline-db__colmenu-value">✓</span>}
      </button>
      <button
        type="button"
        className="inline-db__colmenu-item"
        onClick={() => onSort(sortDirection === 'desc' ? null : 'desc')}
      >
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="sortDesc" />
          </span>
          {t('notes.inlineDb.sortDesc', 'Sort descending')}
        </span>
        {sortDirection === 'desc' && <span className="inline-db__colmenu-value">✓</span>}
      </button>

      {canGroup && (
        <button type="button" className="inline-db__colmenu-item" onClick={onGroupBy}>
          <span className="inline-db__colmenu-label">
            <span className="inline-db__colmenu-icon" aria-hidden="true">
              <ActionIcon kind="group" />
            </span>
            {t('notes.inlineDb.groupByColumn', 'Group by this column')}
          </span>
        </button>
      )}

      <button
        type="button"
        className="inline-db__colmenu-item"
        onClick={() => setShowCalc((cur) => !cur)}
      >
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="calc" />
          </span>
          {t('notes.inlineDb.calcNone', 'Calculate')}
        </span>
        <span className="inline-db__colmenu-value">
          {calculation !== 'none' ? calcLabels[calculation] : ''} ›
        </span>
      </button>
      {showCalc && (
        <div className="inline-db__colmenu-sub">
          {calculationsForType(property.type).map((entry) => (
            <button
              key={entry}
              type="button"
              className={`inline-db__colmenu-item ${entry === calculation ? 'is-on' : ''}`}
              onClick={() => {
                onCalculate(entry);
                setShowCalc(false);
              }}
            >
              {calcLabels[entry]}
            </button>
          ))}
        </div>
      )}

      <button type="button" className="inline-db__colmenu-item" onClick={onHide}>
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="hide" />
          </span>
          {t('notes.inlineDb.hideColumn', 'Hide this column')}
        </span>
      </button>

      <div className="inline-db__colmenu-sep" role="presentation" />

      <button type="button" className="inline-db__colmenu-item" onClick={() => onInsert('left')}>
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="insertLeft" />
          </span>
          {t('notes.inlineDb.insertLeft', 'Insert left')}
        </span>
      </button>
      <button type="button" className="inline-db__colmenu-item" onClick={() => onInsert('right')}>
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="insertRight" />
          </span>
          {t('notes.inlineDb.insertRight', 'Insert right')}
        </span>
      </button>
      <button type="button" className="inline-db__colmenu-item" onClick={onDuplicate}>
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="duplicate" />
          </span>
          {t('notes.inlineDb.duplicateProperty', 'Duplicate property')}
        </span>
      </button>

      <div className="inline-db__colmenu-move">
        <button
          type="button"
          className="inline-db__colmenu-arrow"
          disabled={index === 0}
          aria-label={t('notes.inlineDb.moveLeft', 'Move left')}
          onClick={() => onMove(-1)}
        >
          ←
        </button>
        <button
          type="button"
          className="inline-db__colmenu-arrow"
          disabled={index >= total - 1}
          aria-label={t('notes.inlineDb.moveRight', 'Move right')}
          onClick={() => onMove(1)}
        >
          →
        </button>
      </div>

      <div className="inline-db__colmenu-sep" role="presentation" />

      <button
        type="button"
        className="inline-db__colmenu-item inline-db__colmenu-item--danger"
        onClick={onDelete}
      >
        <span className="inline-db__colmenu-label">
          <span className="inline-db__colmenu-icon" aria-hidden="true">
            <ActionIcon kind="delete" />
          </span>
          {t('notes.inlineDb.deleteProperty', 'Delete property')}
        </span>
      </button>
    </div>
  );
};
