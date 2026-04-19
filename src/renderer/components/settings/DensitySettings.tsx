/**
 * Density Settings Component
 *
 * Composant de configuration de la densité d'affichage permettant:
 * - Sélection du mode de densité (Comfortable, Compact, Dense)
 * - Choix du type de vue (List, Grid, Details)
 * - Configuration des colonnes en mode liste
 * - Persistance des préférences dans localStorage
 */

import { FC, useState, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Card, { CardHeader, CardBody } from '../ui/Card/Card';
import Button from '../ui/Button/Button';
import { useNotification } from '../ui/Notification';
import {
  setDensityMode,
  setViewType,
  setListColumns,
  setGridItemSize
} from '../../../store/slices/uiSlice';
import {
  DensityMode,
  ViewType,
  DensitySettings as DensitySettingsType,
  AVAILABLE_LIST_COLUMNS,
  applyDensity,
  saveDensitySettings,
  loadDensitySettings
} from '../../../services/platform/themeService';
import type { RootState, AppDispatch } from '../../../store';
import './DensitySettings.css';

// ==================== ICONS ====================

const LayoutIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </svg>
);

const GridIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

const ListIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const DetailsIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="10" x2="20" y2="10" />
    <line x1="4" y1="14" x2="20" y2="14" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

const SpacingComfortableIcon: FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="4" rx="1" />
    <rect x="3" y="10" width="18" height="4" rx="1" />
    <rect x="3" y="17" width="18" height="4" rx="1" />
  </svg>
);

const SpacingCompactIcon: FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="3" rx="1" />
    <rect x="3" y="10" width="18" height="3" rx="1" />
    <rect x="3" y="16" width="18" height="3" rx="1" />
  </svg>
);

const SpacingDenseIcon: FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="2" rx="0.5" />
    <rect x="3" y="8" width="18" height="2" rx="0.5" />
    <rect x="3" y="12" width="18" height="2" rx="0.5" />
    <rect x="3" y="16" width="18" height="2" rx="0.5" />
    <rect x="3" y="20" width="18" height="2" rx="0.5" />
  </svg>
);

const CheckIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ==================== COMPONENT ====================

interface DensitySettingsProps {
  className?: string;
}

interface DensityOption {
  id: DensityMode;
  name: string;
  description: string;
  icon: FC;
}

interface ViewTypeOption {
  id: ViewType;
  name: string;
  icon: FC;
}

interface GridSizeOption {
  id: 'small' | 'medium' | 'large';
  name: string;
  size: string;
}

const DENSITY_OPTIONS: DensityOption[] = [
  {
    id: 'comfortable',
    name: 'Comfortable',
    description: 'Spacious layout with more padding',
    icon: SpacingComfortableIcon
  },
  {
    id: 'compact',
    name: 'Compact',
    description: 'Balanced layout for more content',
    icon: SpacingCompactIcon
  },
  {
    id: 'dense',
    name: 'Dense',
    description: 'Minimal spacing for maximum items',
    icon: SpacingDenseIcon
  }
];

const VIEW_TYPE_OPTIONS: ViewTypeOption[] = [
  { id: 'grid', name: 'Grid', icon: GridIcon },
  { id: 'list', name: 'List', icon: ListIcon },
  { id: 'details', name: 'Details', icon: DetailsIcon }
];

const GRID_SIZE_OPTIONS: GridSizeOption[] = [
  { id: 'small', name: 'Small', size: '100px' },
  { id: 'medium', name: 'Medium', size: '150px' },
  { id: 'large', name: 'Large', size: '200px' }
];

export const DensitySettings: FC<DensitySettingsProps> = ({ className = '' }) => {
  const dispatch = useDispatch<AppDispatch>();
  const { success, info } = useNotification();

  // Redux state
  const density = useSelector((state: RootState) => state.ui.density);

  // Local state for column reordering
  const [selectedColumns, setSelectedColumns] = useState<string[]>(density?.listColumns || ['name', 'size', 'date', 'type']);

  // Initialize density settings on mount
  useEffect(() => {
    const savedSettings = loadDensitySettings();
    if (savedSettings) {
      setSelectedColumns(savedSettings.listColumns);
      applyDensity(savedSettings);
    }
  }, []);

  // Apply density changes
  useEffect(() => {
    if (density) {
      applyDensity(density);
      saveDensitySettings(density);
    }
  }, [density]);

  // Handle density mode change
  const handleDensityChange = useCallback((mode: DensityMode) => {
    dispatch(setDensityMode(mode));
    success(`Density set to ${mode}`);
  }, [dispatch, success]);

  // Handle view type change
  const handleViewTypeChange = useCallback((viewType: ViewType) => {
    dispatch(setViewType(viewType));
    info(`View changed to ${viewType}`);
  }, [dispatch, info]);

  // Handle grid size change
  const handleGridSizeChange = useCallback((size: 'small' | 'medium' | 'large') => {
    dispatch(setGridItemSize(size));
    info(`Grid item size set to ${size}`);
  }, [dispatch, info]);

  // Handle column toggle
  const handleColumnToggle = useCallback((columnId: string) => {
    const column = AVAILABLE_LIST_COLUMNS.find(c => c.id === columnId);
    if (column?.required) return; // Don't allow toggling required columns

    const newColumns = selectedColumns.includes(columnId)
      ? selectedColumns.filter(c => c !== columnId)
      : [...selectedColumns, columnId];

    setSelectedColumns(newColumns);
    dispatch(setListColumns(newColumns));
  }, [selectedColumns, dispatch]);

  // Handle column reorder
  const handleMoveColumn = useCallback((columnId: string, direction: 'up' | 'down') => {
    const index = selectedColumns.indexOf(columnId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= selectedColumns.length) return;

    const newColumns = [...selectedColumns];
    [newColumns[index], newColumns[newIndex]] = [newColumns[newIndex], newColumns[index]];

    setSelectedColumns(newColumns);
    dispatch(setListColumns(newColumns));
  }, [selectedColumns, dispatch]);

  return (
    <div className={`density-settings ${className}`}>
      <Card variant="outlined" padding="md">
        <CardHeader>
          <div className="density-settings__header">
            <LayoutIcon />
            <h3>Display Density</h3>
          </div>
        </CardHeader>
        <CardBody>
          {/* Density Mode Selection */}
          <div className="density-settings__section">
            <h4 className="density-settings__section-title">Density Mode</h4>
            <p className="density-settings__section-description">
              Choose how much content you want to see at once
            </p>
            <div className="density-settings__density-options">
              {DENSITY_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = density?.mode === option.id;
                return (
                  <button
                    key={option.id}
                    className={`density-settings__density-option ${isActive ? 'active' : ''}`}
                    onClick={() => handleDensityChange(option.id)}
                    aria-pressed={isActive}
                  >
                    <div className="density-settings__density-option-icon">
                      <Icon />
                    </div>
                    <div className="density-settings__density-option-info">
                      <span className="density-settings__density-option-name">{option.name}</span>
                      <span className="density-settings__density-option-desc">{option.description}</span>
                    </div>
                    {isActive && (
                      <div className="density-settings__density-option-check">
                        <CheckIcon />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* View Type Selection */}
          <div className="density-settings__section">
            <h4 className="density-settings__section-title">View Type</h4>
            <p className="density-settings__section-description">
              Choose how to display your files and folders
            </p>
            <div className="density-settings__view-options">
              {VIEW_TYPE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = density?.viewType === option.id;
                return (
                  <button
                    key={option.id}
                    className={`density-settings__view-option ${isActive ? 'active' : ''}`}
                    onClick={() => handleViewTypeChange(option.id)}
                    aria-pressed={isActive}
                  >
                    <Icon />
                    <span>{option.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grid Size (only visible when grid view is selected) */}
          {density?.viewType === 'grid' && (
            <div className="density-settings__section">
              <h4 className="density-settings__section-title">Grid Item Size</h4>
              <div className="density-settings__size-options">
                {GRID_SIZE_OPTIONS.map((option) => {
                  const isActive = density?.gridItemSize === option.id;
                  return (
                    <button
                      key={option.id}
                      className={`density-settings__size-option ${isActive ? 'active' : ''}`}
                      onClick={() => handleGridSizeChange(option.id)}
                      aria-pressed={isActive}
                    >
                      <div
                        className="density-settings__size-preview"
                        style={{ width: option.size, height: `calc(${option.size} * 0.75)` }}
                      >
                        <div className="density-settings__size-preview-icon" />
                        <div className="density-settings__size-preview-text" />
                      </div>
                      <span>{option.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* List Columns (only visible when list or details view is selected) */}
          {(density?.viewType === 'list' || density?.viewType === 'details') && (
            <div className="density-settings__section">
              <h4 className="density-settings__section-title">List Columns</h4>
              <p className="density-settings__section-description">
                Choose which columns to display in list view
              </p>
              <div className="density-settings__columns">
                {AVAILABLE_LIST_COLUMNS.map((column) => {
                  const isSelected = selectedColumns.includes(column.id);
                  const index = selectedColumns.indexOf(column.id);
                  return (
                    <div
                      key={column.id}
                      className={`density-settings__column ${isSelected ? 'selected' : ''} ${column.required ? 'required' : ''}`}
                    >
                      <label className="density-settings__column-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleColumnToggle(column.id)}
                          disabled={column.required}
                        />
                        <span className="density-settings__column-checkmark" />
                        <span className="density-settings__column-label">{column.label}</span>
                        {column.required && (
                          <span className="density-settings__column-required">(required)</span>
                        )}
                      </label>
                      {isSelected && !column.required && (
                        <div className="density-settings__column-actions">
                          <button
                            className="density-settings__column-move"
                            onClick={() => handleMoveColumn(column.id, 'up')}
                            disabled={index === 0}
                            title="Move up"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="18 15 12 9 6 15" />
                            </svg>
                          </button>
                          <button
                            className="density-settings__column-move"
                            onClick={() => handleMoveColumn(column.id, 'down')}
                            disabled={index === selectedColumns.length - 1}
                            title="Move down"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="density-settings__section">
            <h4 className="density-settings__section-title">Preview</h4>
            <div className={`density-settings__preview density-settings__preview--${density?.mode || 'comfortable'} density-settings__preview--${density?.viewType || 'grid'}`}>
              {density?.viewType === 'grid' ? (
                <div className="density-settings__preview-grid">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="density-settings__preview-grid-item">
                      <div className="density-settings__preview-grid-icon" />
                      <div className="density-settings__preview-grid-name" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="density-settings__preview-list">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="density-settings__preview-list-item">
                      <div className="density-settings__preview-list-icon" />
                      <div className="density-settings__preview-list-name" />
                      {density?.viewType === 'details' && (
                        <>
                          <div className="density-settings__preview-list-meta" />
                          <div className="density-settings__preview-list-meta" />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
};

export default DensitySettings;
