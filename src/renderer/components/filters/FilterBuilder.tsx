/**
 * FilterBuilder Component
 *
 * Interface utilisateur pour construire des filtres complexes
 * avec logique AND/OR et criteres multiples.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import filterService, {
  SavedFilter,
  FilterGroup,
  FilterCriteria,
  FilterCriteriaType,
  FilterOperator,
  FilterLogic,
} from '../../../services/search/filterService';
import './FilterBuilder.css';

// ==================== ICONS ====================

const PlusIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="builder-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="builder-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="builder-icon">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ==================== CONSTANTS ====================

const CRITERIA_TYPES: { value: FilterCriteriaType; label: string }[] = [
  { value: 'type', label: 'Type (fichier/dossier)' },
  { value: 'extension', label: 'Extension' },
  { value: 'name', label: 'Nom' },
  { value: 'size', label: 'Taille' },
  { value: 'date', label: 'Date' },
  { value: 'tag', label: 'Tag' },
  { value: 'color', label: 'Couleur' },
  { value: 'protected', label: 'Protege' },
];

const OPERATORS_BY_TYPE: Record<FilterCriteriaType, { value: FilterOperator; label: string }[]> = {
  type: [
    { value: 'equals', label: 'est' },
    { value: 'notEquals', label: 'n\'est pas' },
  ],
  extension: [
    { value: 'equals', label: 'est' },
    { value: 'notEquals', label: 'n\'est pas' },
    { value: 'in', label: 'est parmi' },
    { value: 'notIn', label: 'n\'est pas parmi' },
  ],
  name: [
    { value: 'equals', label: 'est exactement' },
    { value: 'notEquals', label: 'n\'est pas' },
    { value: 'contains', label: 'contient' },
    { value: 'notContains', label: 'ne contient pas' },
    { value: 'startsWith', label: 'commence par' },
    { value: 'endsWith', label: 'termine par' },
  ],
  size: [
    { value: 'equals', label: 'est egal a' },
    { value: 'greaterThan', label: 'est superieur a' },
    { value: 'lessThan', label: 'est inferieur a' },
    { value: 'between', label: 'est entre' },
  ],
  date: [
    { value: 'equals', label: 'est le' },
    { value: 'greaterThan', label: 'apres le' },
    { value: 'lessThan', label: 'avant le' },
    { value: 'between', label: 'entre' },
  ],
  tag: [
    { value: 'in', label: 'contient' },
    { value: 'notIn', label: 'ne contient pas' },
    { value: 'exists', label: 'existe' },
    { value: 'notExists', label: 'n\'existe pas' },
  ],
  color: [
    { value: 'equals', label: 'est' },
    { value: 'notEquals', label: 'n\'est pas' },
    { value: 'in', label: 'est parmi' },
  ],
  protected: [
    { value: 'equals', label: 'est' },
    { value: 'exists', label: 'est protege' },
    { value: 'notExists', label: 'n\'est pas protege' },
  ],
  path: [
    { value: 'contains', label: 'contient' },
    { value: 'startsWith', label: 'commence par' },
  ],
};

const DATE_PRESETS = [
  { value: 'today', label: 'Aujourd\'hui' },
  { value: 'yesterday', label: 'Hier' },
  { value: 'last7days', label: '7 derniers jours' },
  { value: 'last30days', label: '30 derniers jours' },
  { value: 'thisMonth', label: 'Ce mois' },
  { value: 'thisYear', label: 'Cette annee' },
];

const SIZE_UNITS = [
  { value: 1, label: 'octets' },
  { value: 1024, label: 'Ko' },
  { value: 1024 * 1024, label: 'Mo' },
  { value: 1024 * 1024 * 1024, label: 'Go' },
];

const EXTENSION_PRESETS = [
  { value: ['.jpg', '.jpeg', '.png', '.gif', '.webp'], label: 'Images' },
  { value: ['.pdf', '.doc', '.docx', '.txt'], label: 'Documents' },
  { value: ['.mp4', '.avi', '.mkv', '.mov'], label: 'Videos' },
  { value: ['.mp3', '.wav', '.flac', '.aac'], label: 'Audio' },
  { value: ['.zip', '.rar', '.7z', '.tar'], label: 'Archives' },
];

const COLORS = [
  '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6',
];

// ==================== PROPS ====================

export interface FilterBuilderProps {
  /** Filter to edit (null for new filter) */
  filter?: SavedFilter | null;
  /** Callback when filter is saved */
  onSave?: (filter: SavedFilter) => void;
  /** Callback when builder is closed */
  onClose?: () => void;
  /** Additional CSS class */
  className?: string;
}

// ==================== COMPONENT ====================

export const FilterBuilder: React.FC<FilterBuilderProps> = ({
  filter,
  onSave,
  onClose,
  className = '',
}) => {
  const { t } = useTranslation();

  // Form state
  const [name, setName] = useState(filter?.name || '');
  const [description, setDescription] = useState(filter?.description || '');
  const [color, setColor] = useState(filter?.color || '#3B82F6');
  const [logic, setLogic] = useState<FilterLogic>(filter?.group.logic || 'AND');
  const [criteria, setCriteria] = useState<FilterCriteria[]>(
    (filter?.group.criteria.filter(c => !('logic' in c)) as FilterCriteria[]) || []
  );

  // Validation
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Generate unique ID
  const generateId = () => `crit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Add new criteria
  const handleAddCriteria = useCallback(() => {
    const newCriteria: FilterCriteria = {
      id: generateId(),
      type: 'name',
      operator: 'contains',
      value: '',
    };
    setCriteria(prev => [...prev, newCriteria]);
  }, []);

  // Remove criteria
  const handleRemoveCriteria = useCallback((id: string) => {
    setCriteria(prev => prev.filter(c => c.id !== id));
  }, []);

  // Update criteria
  const handleUpdateCriteria = useCallback((id: string, updates: Partial<FilterCriteria>) => {
    setCriteria(prev => prev.map(c =>
      c.id === id ? { ...c, ...updates } : c
    ));
  }, []);

  // Handle type change (reset operator and value)
  const handleTypeChange = useCallback((id: string, type: FilterCriteriaType) => {
    const operators = OPERATORS_BY_TYPE[type];
    const defaultOperator = operators[0]?.value || 'equals';

    let defaultValue: any = '';
    if (type === 'type') defaultValue = 'file';
    if (type === 'protected') defaultValue = true;
    if (type === 'size') defaultValue = 0;

    handleUpdateCriteria(id, {
      type,
      operator: defaultOperator,
      value: defaultValue,
      secondValue: undefined,
    });
  }, [handleUpdateCriteria]);

  // Validate form
  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = t('filters.errors.nameRequired', 'Le nom est requis');
    }

    if (criteria.length === 0) {
      newErrors.criteria = t('filters.errors.criteriaRequired', 'Au moins un critere est requis');
    }

    criteria.forEach((c, index) => {
      if (c.value === '' || c.value === null || c.value === undefined) {
        if (c.operator !== 'exists' && c.operator !== 'notExists') {
          newErrors[`criteria_${index}`] = t('filters.errors.valueRequired', 'La valeur est requise');
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, criteria, t]);

  // Save filter
  const handleSave = useCallback(() => {
    if (!validate()) return;

    const group: FilterGroup = {
      id: filter?.group.id || generateId(),
      logic,
      criteria,
    };

    let savedFilter: SavedFilter;

    if (filter) {
      // Update existing
      savedFilter = filterService.updateFilter(filter.id, {
        name,
        description,
        color,
        group,
      })!;
    } else {
      // Create new
      savedFilter = filterService.createFilter({
        name,
        description,
        color,
        group,
      });
    }

    onSave?.(savedFilter);
    onClose?.();
  }, [filter, name, description, color, logic, criteria, validate, onSave, onClose]);

  // Render value input based on criteria type
  const renderValueInput = (c: FilterCriteria, index: number) => {
    const hasError = errors[`criteria_${index}`];

    switch (c.type) {
      case 'type':
        return (
          <select
            className={`builder-input builder-select ${hasError ? 'builder-input--error' : ''}`}
            value={c.value}
            onChange={(e) => handleUpdateCriteria(c.id, { value: e.target.value })}
          >
            <option value="file">{t('filters.file', 'Fichier')}</option>
            <option value="folder">{t('filters.folder', 'Dossier')}</option>
          </select>
        );

      case 'extension':
        if (c.operator === 'in' || c.operator === 'notIn') {
          return (
            <div className="builder-value-group">
              <select
                className={`builder-input builder-select ${hasError ? 'builder-input--error' : ''}`}
                value=""
                onChange={(e) => {
                  const preset = EXTENSION_PRESETS.find(p => p.label === e.target.value);
                  if (preset) {
                    handleUpdateCriteria(c.id, { value: preset.value });
                  }
                }}
              >
                <option value="">{t('filters.selectPreset', 'Preselection...')}</option>
                {EXTENSION_PRESETS.map(p => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
              <input
                type="text"
                className={`builder-input ${hasError ? 'builder-input--error' : ''}`}
                placeholder=".pdf, .doc, .txt"
                value={Array.isArray(c.value) ? c.value.join(', ') : c.value}
                onChange={(e) => {
                  const extensions = e.target.value.split(',').map(ext => ext.trim());
                  handleUpdateCriteria(c.id, { value: extensions });
                }}
              />
            </div>
          );
        }
        return (
          <input
            type="text"
            className={`builder-input ${hasError ? 'builder-input--error' : ''}`}
            placeholder=".pdf"
            value={c.value}
            onChange={(e) => handleUpdateCriteria(c.id, { value: e.target.value })}
          />
        );

      case 'name':
        return (
          <input
            type="text"
            className={`builder-input ${hasError ? 'builder-input--error' : ''}`}
            placeholder={t('filters.namePlaceholder', 'Texte a rechercher...')}
            value={c.value}
            onChange={(e) => handleUpdateCriteria(c.id, { value: e.target.value })}
          />
        );

      case 'size': {
        const sizeUnit = SIZE_UNITS.find(u => (c.value as number) % u.value === 0 && (c.value as number) / u.value >= 1) || SIZE_UNITS[0];
        const sizeValue = (c.value as number) / sizeUnit.value;

        return (
          <div className="builder-value-group">
            <input
              type="number"
              className={`builder-input builder-input--number ${hasError ? 'builder-input--error' : ''}`}
              min="0"
              value={sizeValue}
              onChange={(e) => handleUpdateCriteria(c.id, { value: parseFloat(e.target.value) * sizeUnit.value })}
            />
            <select
              className="builder-input builder-select"
              value={sizeUnit.value}
              onChange={(e) => handleUpdateCriteria(c.id, { value: sizeValue * parseInt(e.target.value) })}
            >
              {SIZE_UNITS.map(u => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
            {c.operator === 'between' && (
              <>
                <span className="builder-separator">{t('filters.and', 'et')}</span>
                <input
                  type="number"
                  className="builder-input builder-input--number"
                  min="0"
                  value={(c.secondValue as number) / sizeUnit.value || 0}
                  onChange={(e) => handleUpdateCriteria(c.id, { secondValue: parseFloat(e.target.value) * sizeUnit.value })}
                />
                <select
                  className="builder-input builder-select"
                  value={sizeUnit.value}
                  onChange={(e) => handleUpdateCriteria(c.id, { secondValue: ((c.secondValue as number) / sizeUnit.value) * parseInt(e.target.value) })}
                >
                  {SIZE_UNITS.map(u => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        );
      }

      case 'date':
        return (
          <div className="builder-value-group">
            <select
              className={`builder-input builder-select ${hasError ? 'builder-input--error' : ''}`}
              value={DATE_PRESETS.find(p => p.value === c.value)?.value || 'custom'}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  handleUpdateCriteria(c.id, { value: new Date().toISOString().split('T')[0] });
                } else {
                  handleUpdateCriteria(c.id, { value: e.target.value });
                }
              }}
            >
              {DATE_PRESETS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
              <option value="custom">{t('filters.customDate', 'Date personnalisee')}</option>
            </select>
            {!DATE_PRESETS.find(p => p.value === c.value) && (
              <input
                type="date"
                className="builder-input"
                value={typeof c.value === 'string' && c.value.includes('-') ? c.value.split('T')[0] : ''}
                onChange={(e) => handleUpdateCriteria(c.id, { value: e.target.value })}
              />
            )}
            {c.operator === 'between' && (
              <>
                <span className="builder-separator">{t('filters.and', 'et')}</span>
                <input
                  type="date"
                  className="builder-input"
                  value={typeof c.secondValue === 'string' ? c.secondValue.split('T')[0] : ''}
                  onChange={(e) => handleUpdateCriteria(c.id, { secondValue: e.target.value })}
                />
              </>
            )}
          </div>
        );

      case 'tag':
        if (c.operator === 'exists' || c.operator === 'notExists') {
          return null;
        }
        return (
          <input
            type="text"
            className={`builder-input ${hasError ? 'builder-input--error' : ''}`}
            placeholder={t('filters.tagPlaceholder', 'tag1, tag2, tag3')}
            value={Array.isArray(c.value) ? c.value.join(', ') : c.value}
            onChange={(e) => {
              const tags = e.target.value.split(',').map(tag => tag.trim());
              handleUpdateCriteria(c.id, { value: tags });
            }}
          />
        );

      case 'color':
        return (
          <div className="builder-color-picker">
            {COLORS.map(col => (
              <button
                key={col}
                type="button"
                className={`builder-color-option ${c.value === col ? 'builder-color-option--selected' : ''}`}
                style={{ backgroundColor: col }}
                onClick={() => handleUpdateCriteria(c.id, { value: col })}
              />
            ))}
          </div>
        );

      case 'protected':
        if (c.operator === 'exists' || c.operator === 'notExists') {
          return null;
        }
        return (
          <select
            className={`builder-input builder-select ${hasError ? 'builder-input--error' : ''}`}
            value={c.value ? 'true' : 'false'}
            onChange={(e) => handleUpdateCriteria(c.id, { value: e.target.value === 'true' })}
          >
            <option value="true">{t('filters.yes', 'Oui')}</option>
            <option value="false">{t('filters.no', 'Non')}</option>
          </select>
        );

      default:
        return (
          <input
            type="text"
            className={`builder-input ${hasError ? 'builder-input--error' : ''}`}
            value={c.value}
            onChange={(e) => handleUpdateCriteria(c.id, { value: e.target.value })}
          />
        );
    }
  };

  // Render criteria row
  const renderCriteriaRow = (c: FilterCriteria, index: number) => {
    const operators = OPERATORS_BY_TYPE[c.type] || [];

    return (
      <div key={c.id} className="builder-criteria">
        {index > 0 && (
          <div className="builder-logic-indicator">
            <span className="builder-logic-label">
              {logic === 'AND' ? t('filters.and', 'ET') : t('filters.or', 'OU')}
            </span>
          </div>
        )}

        <div className="builder-criteria-row">
          {/* Type selector */}
          <select
            className="builder-input builder-select"
            value={c.type}
            onChange={(e) => handleTypeChange(c.id, e.target.value as FilterCriteriaType)}
          >
            {CRITERIA_TYPES.map(type => (
              <option key={type.value} value={type.value}>
                {t(`filters.types.${type.value}`, type.label)}
              </option>
            ))}
          </select>

          {/* Operator selector */}
          <select
            className="builder-input builder-select"
            value={c.operator}
            onChange={(e) => handleUpdateCriteria(c.id, { operator: e.target.value as FilterOperator })}
          >
            {operators.map(op => (
              <option key={op.value} value={op.value}>
                {t(`filters.operators.${op.value}`, op.label)}
              </option>
            ))}
          </select>

          {/* Value input */}
          {renderValueInput(c, index)}

          {/* Remove button */}
          <button
            type="button"
            className="builder-criteria-remove"
            onClick={() => handleRemoveCriteria(c.id)}
            title={t('filters.removeCriteria', 'Supprimer ce critere')}
          >
            <TrashIcon />
          </button>
        </div>

        {errors[`criteria_${index}`] && (
          <span className="builder-error">{errors[`criteria_${index}`]}</span>
        )}
      </div>
    );
  };

  return (
    <div className={`filter-builder ${className}`}>
      {/* Header */}
      <div className="filter-builder__header">
        <h2 className="filter-builder__title">
          {filter
            ? t('filters.editFilter', 'Modifier le filtre')
            : t('filters.createFilter', 'Creer un filtre')}
        </h2>
        <button
          type="button"
          className="filter-builder__close"
          onClick={onClose}
          title={t('common.close', 'Fermer')}
        >
          <CloseIcon />
        </button>
      </div>

      {/* Form */}
      <div className="filter-builder__content">
        {/* Name & Description */}
        <div className="builder-field">
          <label className="builder-label">
            {t('filters.filterName', 'Nom du filtre')} *
          </label>
          <input
            type="text"
            className={`builder-input ${errors.name ? 'builder-input--error' : ''}`}
            placeholder={t('filters.namePlaceholder', 'Mon filtre')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name && <span className="builder-error">{errors.name}</span>}
        </div>

        <div className="builder-field">
          <label className="builder-label">
            {t('filters.filterDescription', 'Description')}
          </label>
          <input
            type="text"
            className="builder-input"
            placeholder={t('filters.descriptionPlaceholder', 'Description optionnelle...')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Color picker */}
        <div className="builder-field">
          <label className="builder-label">
            {t('filters.filterColor', 'Couleur')}
          </label>
          <div className="builder-color-picker">
            {COLORS.map(col => (
              <button
                key={col}
                type="button"
                className={`builder-color-option ${color === col ? 'builder-color-option--selected' : ''}`}
                style={{ backgroundColor: col }}
                onClick={() => setColor(col)}
              />
            ))}
          </div>
        </div>

        {/* Logic selector */}
        <div className="builder-field">
          <label className="builder-label">
            {t('filters.logicLabel', 'Logique de combinaison')}
          </label>
          <div className="builder-logic-toggle">
            <button
              type="button"
              className={`builder-logic-btn ${logic === 'AND' ? 'builder-logic-btn--active' : ''}`}
              onClick={() => setLogic('AND')}
            >
              {t('filters.matchAll', 'Tous les criteres (ET)')}
            </button>
            <button
              type="button"
              className={`builder-logic-btn ${logic === 'OR' ? 'builder-logic-btn--active' : ''}`}
              onClick={() => setLogic('OR')}
            >
              {t('filters.matchAny', 'Au moins un critere (OU)')}
            </button>
          </div>
        </div>

        {/* Criteria list */}
        <div className="builder-field">
          <label className="builder-label">
            {t('filters.criteria', 'Criteres')} *
          </label>

          {errors.criteria && <span className="builder-error">{errors.criteria}</span>}

          <div className="builder-criteria-list">
            {criteria.map((c, index) => renderCriteriaRow(c, index))}

            {criteria.length === 0 && (
              <p className="builder-empty">
                {t('filters.noCriteria', 'Aucun critere. Ajoutez-en un pour commencer.')}
              </p>
            )}
          </div>

          <button
            type="button"
            className="builder-add-btn"
            onClick={handleAddCriteria}
          >
            <PlusIcon />
            {t('filters.addCriteria', 'Ajouter un critere')}
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="filter-builder__footer">
        <button
          type="button"
          className="builder-btn builder-btn--secondary"
          onClick={onClose}
        >
          {t('common.cancel', 'Annuler')}
        </button>
        <button
          type="button"
          className="builder-btn builder-btn--primary"
          onClick={handleSave}
        >
          {filter
            ? t('common.save', 'Enregistrer')
            : t('filters.createFilter', 'Creer le filtre')}
        </button>
      </div>
    </div>
  );
};

export default FilterBuilder;
