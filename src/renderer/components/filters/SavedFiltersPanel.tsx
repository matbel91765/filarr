/**
 * SavedFiltersPanel Component
 *
 * Panneau affichant les filtres sauvegardes avec options de gestion.
 * Affiche les presets et filtres personnalises avec possibilite
 * d'appliquer, editer, supprimer et epingler.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import filterService, {
  SavedFilter,
  FilterResult,
} from '../../../services/search/filterService';
import type { Item } from '../../../types';
import './SavedFiltersPanel.css';

// ==================== ICONS ====================

const FilterIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="filter-icon"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z"
    />
  </svg>
);

const ImageIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
  </svg>
);

const DocumentIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

const ClockIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ScaleIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L18.75 4.97zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L5.25 4.97z" />
  </svg>
);

const VideoIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon">
    <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const MusicIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
  </svg>
);

const ArchiveIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);

const PinIcon: React.FC<{ filled?: boolean }> = ({ filled }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill={filled ? 'currentColor' : 'none'} viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon filter-icon--small">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.75V16.5L12 21V16.5L7.5 16.5V3.75" />
  </svg>
);

const PlusIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="filter-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const EditIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon filter-icon--small">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon filter-icon--small">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const CopyIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="filter-icon filter-icon--small">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
  </svg>
);

const ChevronIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`filter-chevron ${expanded ? 'filter-chevron--expanded' : ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

// ==================== HELPER ====================

const getFilterIcon = (iconName?: string): React.ReactNode => {
  switch (iconName) {
    case 'image':
      return <ImageIcon />;
    case 'document':
      return <DocumentIcon />;
    case 'clock':
      return <ClockIcon />;
    case 'scale':
      return <ScaleIcon />;
    case 'video':
      return <VideoIcon />;
    case 'music':
      return <MusicIcon />;
    case 'archive':
      return <ArchiveIcon />;
    default:
      return <FilterIcon />;
  }
};

// ==================== PROPS ====================

export interface SavedFiltersPanelProps {
  /** Items to filter (for result count) */
  items?: Item[];
  /** Callback when a filter is applied */
  onApplyFilter?: (result: FilterResult) => void;
  /** Callback to open filter builder for editing */
  onEditFilter?: (filter: SavedFilter) => void;
  /** Callback to open filter builder for creating */
  onCreateFilter?: () => void;
  /** Show as compact sidebar version */
  compact?: boolean;
  /** Additional CSS class */
  className?: string;
}

// ==================== COMPONENT ====================

export const SavedFiltersPanel: React.FC<SavedFiltersPanelProps> = ({
  items = [],
  onApplyFilter,
  onEditFilter,
  onCreateFilter,
  compact = false,
  className = '',
}) => {
  const { t } = useTranslation();

  // State
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    pinned: true,
    presets: true,
    custom: true,
  });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    filter: SavedFilter;
  } | null>(null);

  // Load filters
  useEffect(() => {
    setFilters(filterService.getAllFilters());
  }, []);

  // Categorize filters
  const categorizedFilters = useMemo(() => {
    const pinned = filters.filter(f => f.isPinned);
    const presets = filters.filter(f => f.isPreset && !f.isPinned);
    const custom = filters.filter(f => !f.isPreset && !f.isPinned);

    return { pinned, presets, custom };
  }, [filters]);

  // Handlers
  const handleApplyFilter = useCallback((filter: SavedFilter) => {
    setActiveFilterId(filter.id);

    if (onApplyFilter && items.length > 0) {
      const result = filterService.applyFilter(filter.id, items);
      onApplyFilter(result);
    }
  }, [onApplyFilter, items]);

  const handleClearFilter = useCallback(() => {
    setActiveFilterId(null);
    if (onApplyFilter) {
      onApplyFilter({
        filterId: '',
        filterName: '',
        matchedItems: items,
        totalScanned: items.length,
        executionTimeMs: 0,
      });
    }
  }, [onApplyFilter, items]);

  const handleTogglePin = useCallback((filterId: string) => {
    filterService.togglePinned(filterId);
    setFilters(filterService.getAllFilters());
  }, []);

  const handleDeleteFilter = useCallback((filterId: string) => {
    if (filterService.deleteFilter(filterId)) {
      setFilters(filterService.getAllFilters());
      if (activeFilterId === filterId) {
        handleClearFilter();
      }
    }
  }, [activeFilterId, handleClearFilter]);

  const handleDuplicateFilter = useCallback((filterId: string) => {
    filterService.duplicateFilter(filterId);
    setFilters(filterService.getAllFilters());
  }, []);

  const handleToggleSection = useCallback((section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, filter: SavedFilter) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      filter,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
    return undefined;
  }, [contextMenu]);

  // Render filter item
  const renderFilterItem = (filter: SavedFilter) => {
    const isActive = activeFilterId === filter.id;
    const matchCount = items.length > 0
      ? filterService.applyFilter(filter.id, items).matchedItems.length
      : null;

    return (
      <div
        key={filter.id}
        className={`filter-item ${isActive ? 'filter-item--active' : ''}`}
        onClick={() => handleApplyFilter(filter)}
        onContextMenu={(e) => handleContextMenu(e, filter)}
        role="button"
        tabIndex={0}
        onKeyPress={(e) => e.key === 'Enter' && handleApplyFilter(filter)}
      >
        <span
          className="filter-item__icon"
          style={{ color: filter.color }}
        >
          {getFilterIcon(filter.icon)}
        </span>

        <span className="filter-item__info">
          <span className="filter-item__name">{filter.name}</span>
          {!compact && filter.description && (
            <span className="filter-item__description">{filter.description}</span>
          )}
        </span>

        {matchCount !== null && (
          <span className="filter-item__count">{matchCount}</span>
        )}

        {!compact && (
          <div className="filter-item__actions">
            <button
              className="filter-item__action"
              onClick={(e) => {
                e.stopPropagation();
                handleTogglePin(filter.id);
              }}
              title={filter.isPinned ? t('filters.unpin', 'Desepingler') : t('filters.pin', 'Epingler')}
            >
              <PinIcon filled={filter.isPinned} />
            </button>

            {!filter.isPreset && (
              <>
                <button
                  className="filter-item__action"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditFilter?.(filter);
                  }}
                  title={t('filters.edit', 'Modifier')}
                >
                  <EditIcon />
                </button>

                <button
                  className="filter-item__action filter-item__action--danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFilter(filter.id);
                  }}
                  title={t('filters.delete', 'Supprimer')}
                >
                  <TrashIcon />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render section
  const renderSection = (
    title: string,
    sectionKey: string,
    filterList: SavedFilter[],
    showCount: boolean = true
  ) => {
    if (filterList.length === 0) return null;

    const isExpanded = expandedSections[sectionKey];

    return (
      <div className="filter-section">
        <button
          className="filter-section__header"
          onClick={() => handleToggleSection(sectionKey)}
          aria-expanded={isExpanded}
        >
          <ChevronIcon expanded={isExpanded} />
          <span className="filter-section__title">{title}</span>
          {showCount && (
            <span className="filter-section__count">{filterList.length}</span>
          )}
        </button>

        {isExpanded && (
          <div className="filter-section__list">
            {filterList.map(renderFilterItem)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`saved-filters-panel ${compact ? 'saved-filters-panel--compact' : ''} ${className}`}>
      {/* Header */}
      <div className="saved-filters-panel__header">
        <h3 className="saved-filters-panel__title">
          <FilterIcon />
          {t('filters.savedFilters', 'Filtres')}
        </h3>

        {!compact && (
          <button
            className="saved-filters-panel__create"
            onClick={onCreateFilter}
            title={t('filters.create', 'Creer un filtre')}
          >
            <PlusIcon />
          </button>
        )}
      </div>

      {/* Active filter indicator */}
      {activeFilterId && (
        <div className="saved-filters-panel__active">
          <span>{t('filters.active', 'Filtre actif:')}</span>
          <strong>{filters.find(f => f.id === activeFilterId)?.name}</strong>
          <button
            className="saved-filters-panel__clear"
            onClick={handleClearFilter}
          >
            {t('filters.clear', 'Effacer')}
          </button>
        </div>
      )}

      {/* Filter sections */}
      <div className="saved-filters-panel__content">
        {renderSection(
          t('filters.pinned', 'Epingles'),
          'pinned',
          categorizedFilters.pinned
        )}

        {renderSection(
          t('filters.presets', 'Predefinis'),
          'presets',
          categorizedFilters.presets
        )}

        {renderSection(
          t('filters.custom', 'Personnalises'),
          'custom',
          categorizedFilters.custom
        )}

        {filters.length === 0 && (
          <p className="saved-filters-panel__empty">
            {t('filters.noFilters', 'Aucun filtre sauvegarde')}
          </p>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="filter-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="filter-context-menu__item"
            onClick={() => {
              handleApplyFilter(contextMenu.filter);
              handleCloseContextMenu();
            }}
          >
            {t('filters.apply', 'Appliquer')}
          </button>

          <button
            className="filter-context-menu__item"
            onClick={() => {
              handleTogglePin(contextMenu.filter.id);
              handleCloseContextMenu();
            }}
          >
            {contextMenu.filter.isPinned
              ? t('filters.unpin', 'Desepingler')
              : t('filters.pin', 'Epingler')}
          </button>

          <button
            className="filter-context-menu__item"
            onClick={() => {
              handleDuplicateFilter(contextMenu.filter.id);
              handleCloseContextMenu();
            }}
          >
            <CopyIcon />
            {t('filters.duplicate', 'Dupliquer')}
          </button>

          {!contextMenu.filter.isPreset && (
            <>
              <button
                className="filter-context-menu__item"
                onClick={() => {
                  onEditFilter?.(contextMenu.filter);
                  handleCloseContextMenu();
                }}
              >
                <EditIcon />
                {t('filters.edit', 'Modifier')}
              </button>

              <button
                className="filter-context-menu__item filter-context-menu__item--danger"
                onClick={() => {
                  handleDeleteFilter(contextMenu.filter.id);
                  handleCloseContextMenu();
                }}
              >
                <TrashIcon />
                {t('filters.delete', 'Supprimer')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SavedFiltersPanel;
