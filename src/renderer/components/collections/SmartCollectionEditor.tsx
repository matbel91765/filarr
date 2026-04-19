/**
 * SmartCollectionEditor Component
 *
 * Modal for creating and editing smart collections.
 * Uses condition builder pattern for defining criteria.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import {
  createSmartCollection,
  updateCollection,
} from '../../../store/slices/collectionsSlice';
import type { CollectionsState } from '../../../store/slices/collectionsSlice';
import type {
  SmartCollectionCriteria,
  SmartCollectionRule,
  SmartCollectionField,
  SmartCollectionOperator,
  VirtualCollection,
} from '../../../types';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import Button from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import Select from '../ui/Dropdown/Select';

interface SmartCollectionEditorProps {
  /** Modal is open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Collection to edit (if editing) */
  collection?: VirtualCollection;
  /** Additional CSS class */
  className?: string;
}

// Operators by field type
const OPERATORS_BY_FIELD: Record<SmartCollectionField, SmartCollectionOperator[]> = {
  name: ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'matchesRegex', 'isEmpty', 'isNotEmpty'],
  extension: ['equals', 'notEquals', 'inList', 'isEmpty', 'isNotEmpty'],
  size: ['equals', 'notEquals', 'greaterThan', 'lessThan', 'between'],
  createdAt: ['equals', 'greaterThan', 'lessThan', 'between', 'withinLast'],
  modifiedAt: ['equals', 'greaterThan', 'lessThan', 'between', 'withinLast'],
  tags: ['hasAny', 'hasAll', 'isEmpty', 'isNotEmpty'],
  folder: ['equals', 'notEquals', 'contains', 'startsWith'],
  type: ['equals', 'notEquals', 'inList'],
  content: ['contains', 'notContains', 'matchesRegex'],
  isFavorite: ['isTrue', 'isFalse'],
  description: ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'],
};

// Available colors
const COLLECTION_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
];

/**
 * SmartCollectionEditor Component
 */
export const SmartCollectionEditor: React.FC<SmartCollectionEditorProps> = ({
  isOpen,
  onClose,
  collection,
  className,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { isLoading } = useSelector(
    (state: { collections: CollectionsState }) => state.collections
  );

  const isEditing = !!collection;

  // Field labels (memoized for i18n)
  const FIELD_LABELS: Record<SmartCollectionField, string> = useMemo(() => ({
    name: t('collections.fields.fileName'),
    extension: t('collections.fields.extension'),
    size: t('collections.fields.size'),
    createdAt: t('collections.fields.createdAt'),
    modifiedAt: t('collections.fields.modifiedAt'),
    tags: t('collections.fields.tags'),
    folder: t('collections.fields.folder'),
    type: t('collections.fields.type'),
    content: t('collections.fields.content'),
    isFavorite: t('collections.fields.isFavorite'),
    description: t('collections.fields.description'),
  }), [t]);

  // Operator labels (memoized for i18n)
  const OPERATOR_LABELS: Record<SmartCollectionOperator, string> = useMemo(() => ({
    equals: t('collections.operators.equals'),
    notEquals: t('collections.operators.notEquals'),
    contains: t('collections.operators.contains'),
    notContains: t('collections.operators.notContains'),
    startsWith: t('collections.operators.startsWith'),
    endsWith: t('collections.operators.endsWith'),
    greaterThan: t('collections.operators.greaterThan'),
    lessThan: t('collections.operators.lessThan'),
    between: t('collections.operators.between'),
    isEmpty: t('collections.operators.isEmpty'),
    isNotEmpty: t('collections.operators.notEmpty'),
    matchesRegex: t('collections.operators.regex'),
    inList: t('collections.operators.inList'),
    hasAny: t('collections.operators.hasOne'),
    hasAll: t('collections.operators.hasAll'),
    isTrue: t('collections.operators.yes'),
    isFalse: t('collections.operators.no'),
    withinLast: t('collections.operators.inLast'),
  }), [t]);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLLECTION_COLORS[0]);
  const [matchType, setMatchType] = useState<'all' | 'any'>('all');
  const [rules, setRules] = useState<SmartCollectionRule[]>([]);
  const [sortBy, setSortBy] = useState<'name' | 'dateCreated' | 'dateModified' | 'size'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [limit, setLimit] = useState<number | undefined>(undefined);
  const [errors, setErrors] = useState<string[]>([]);

  // Initialize form when editing
  useEffect(() => {
    if (collection && isOpen) {
      setName(collection.name);
      setDescription(collection.description || '');
      setColor(collection.color);
      if (collection.criteria) {
        setMatchType(collection.criteria.matchType);
        setRules(collection.criteria.rules);
        setSortBy(collection.criteria.sortBy as any);
        setSortOrder(collection.criteria.sortOrder);
        setLimit(collection.criteria.limit);
      }
    } else if (isOpen) {
      // Reset form for new collection
      setName('');
      setDescription('');
      setColor(COLLECTION_COLORS[Math.floor(Math.random() * COLLECTION_COLORS.length)]);
      setMatchType('all');
      setRules([]);
      setSortBy('name');
      setSortOrder('asc');
      setLimit(undefined);
      setErrors([]);
    }
  }, [collection, isOpen]);

  // Generate unique ID
  const generateId = () => `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Add a new rule
  const handleAddRule = useCallback(() => {
    const newRule: SmartCollectionRule = {
      id: generateId(),
      field: 'name',
      operator: 'contains',
      value: '',
      isNegated: false,
    };
    setRules([...rules, newRule]);
  }, [rules]);

  // Update a rule
  const handleUpdateRule = useCallback(
    (id: string, updates: Partial<SmartCollectionRule>) => {
      setRules(rules.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule)));
    },
    [rules]
  );

  // Remove a rule
  const handleRemoveRule = useCallback(
    (id: string) => {
      setRules(rules.filter((rule) => rule.id !== id));
    },
    [rules]
  );

  // Handle field change (reset operator to first available)
  const handleFieldChange = useCallback(
    (id: string, field: SmartCollectionField) => {
      const availableOperators = OPERATORS_BY_FIELD[field];
      handleUpdateRule(id, {
        field,
        operator: availableOperators[0],
        value: '',
      });
    },
    [handleUpdateRule]
  );

  // Validate form
  const validate = useCallback(() => {
    const newErrors: string[] = [];

    if (!name.trim()) {
      newErrors.push(t('collections.smartEditor.errors.nameRequired'));
    }

    if (rules.length === 0) {
      newErrors.push(t('collections.smartEditor.errors.ruleRequired'));
    }

    rules.forEach((rule, index) => {
      if (
        !['isEmpty', 'isNotEmpty'].includes(rule.operator) &&
        (rule.value === '' || rule.value === null || rule.value === undefined)
      ) {
        newErrors.push(t('collections.smartEditor.errors.ruleValueRequired', { index: index + 1 }));
      }
    });

    setErrors(newErrors);
    return newErrors.length === 0;
  }, [name, rules]);

  // Handle save
  const handleSave = useCallback(() => {
    if (!validate()) return;

    const criteria: SmartCollectionCriteria = {
      rules,
      matchType,
      sortBy,
      sortOrder,
      limit,
    };

    if (isEditing && collection) {
      dispatch(
        updateCollection({
          id: collection.id,
          updates: {
            name: name.trim(),
            description: description.trim() || undefined,
            color,
            criteria,
          },
        }) as any
      );
    } else {
      dispatch(
        createSmartCollection({
          name: name.trim(),
          criteria,
          description: description.trim() || undefined,
          color,
        }) as any
      );
    }

    onClose();
  }, [
    validate,
    isEditing,
    collection,
    dispatch,
    name,
    description,
    color,
    rules,
    matchType,
    sortBy,
    sortOrder,
    limit,
    onClose,
  ]);

  // Render value input based on field type
  const renderValueInput = (rule: SmartCollectionRule) => {
    // Boolean operators don't need a value
    if (['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'].includes(rule.operator)) {
      return null;
    }

    // withinLast operator - duration picker in days
    if (rule.operator === 'withinLast') {
      const presets = [
        { value: 1, label: t('collections.smartEditor.presets.24h') },
        { value: 7, label: t('collections.smartEditor.presets.7days') },
        { value: 30, label: t('collections.smartEditor.presets.30days') },
        { value: 90, label: t('collections.smartEditor.presets.90days') },
        { value: 365, label: t('collections.smartEditor.presets.1year') },
      ];
      return (
        <div className="flex items-center gap-2 flex-1">
          <div className="flex gap-1 flex-wrap">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => handleUpdateRule(rule.id, { value: p.value })}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  Number(rule.value) === p.value
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] border-[var(--color-primary-200)]'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-background-secondary)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Input
            type="number"
            placeholder={t('collections.smartEditor.days')}
            value={rule.value as number}
            onChange={(e) => handleUpdateRule(rule.id, { value: parseInt(e.target.value, 10) || 0 })}
            size="sm"
            className="w-20"
          />
          <span className="text-xs text-[var(--color-text-secondary)] shrink-0">{t('collections.smartEditor.days')}</span>
        </div>
      );
    }

    // Size field - number input with units
    if (rule.field === 'size') {
      if (rule.operator === 'between') {
        const value = Array.isArray(rule.value) ? rule.value : [0, 0];
        return (
          <div className="flex items-center gap-2 flex-1">
            <Input
              type="number"
              placeholder={t('collections.smartEditor.minBytes')}
              value={value[0]}
              onChange={(e) =>
                handleUpdateRule(rule.id, {
                  value: [parseInt(e.target.value, 10) || 0, value[1]],
                })
              }
              size="sm"
            />
            <span className="text-xs text-[var(--color-text-secondary)] shrink-0">{t('collections.smartEditor.and')}</span>
            <Input
              type="number"
              placeholder={t('collections.smartEditor.maxBytes')}
              value={value[1]}
              onChange={(e) =>
                handleUpdateRule(rule.id, {
                  value: [value[0], parseInt(e.target.value, 10) || 0],
                })
              }
              size="sm"
            />
          </div>
        );
      }
      return (
        <Input
          type="number"
          placeholder={t('collections.smartEditor.sizeInBytes')}
          value={rule.value as number}
          onChange={(e) => handleUpdateRule(rule.id, { value: parseInt(e.target.value, 10) || 0 })}
          size="sm"
          className="flex-1 min-w-[100px]"
        />
      );
    }

    // Date fields
    if (['createdAt', 'modifiedAt'].includes(rule.field)) {
      if (rule.operator === 'between') {
        const value = Array.isArray(rule.value) ? rule.value : ['', ''];
        return (
          <div className="flex items-center gap-2 flex-1">
            <Input
              type="date"
              value={value[0]}
              onChange={(e) => handleUpdateRule(rule.id, { value: [e.target.value, value[1]] })}
              size="sm"
            />
            <span className="text-xs text-[var(--color-text-secondary)] shrink-0">{t('collections.smartEditor.and')}</span>
            <Input
              type="date"
              value={value[1]}
              onChange={(e) => handleUpdateRule(rule.id, { value: [value[0], e.target.value] })}
              size="sm"
            />
          </div>
        );
      }
      return (
        <Input
          type="date"
          value={rule.value as string}
          onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
          size="sm"
          className="flex-1 min-w-[100px]"
        />
      );
    }

    // List operators
    if (['inList', 'hasAny', 'hasAll'].includes(rule.operator)) {
      return (
        <Input
          placeholder={t('collections.smartEditor.listPlaceholder')}
          value={Array.isArray(rule.value) ? rule.value.join(', ') : (rule.value as string)}
          onChange={(e) =>
            handleUpdateRule(rule.id, {
              value: e.target.value.split(',').map((v) => v.trim()),
            })
          }
          size="sm"
          className="flex-1 min-w-[200px]"
          helperText={t('collections.smartEditor.listHelperText')}
        />
      );
    }

    // Default text input
    return (
      <Input
        placeholder={t('collections.smartEditor.value')}
        value={rule.value as string}
        onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
        size="sm"
        className="flex-1 min-w-[100px]"
      />
    );
  };

  // Render a single rule row
  const renderRule = (rule: SmartCollectionRule, index: number) => {
    const fieldOptions = Object.entries(FIELD_LABELS).map(([value, label]) => ({
      value,
      label,
    }));

    const operatorOptions = OPERATORS_BY_FIELD[rule.field].map((op) => ({
      value: op,
      label: OPERATOR_LABELS[op],
    }));

    return (
      <div key={rule.id} className="flex flex-col gap-2">
        {index > 0 && (
          <div className="flex items-center py-1">
            <span className="inline-flex items-center justify-center px-2 py-0.5 bg-[var(--color-primary-50)] text-[var(--color-primary-600)] text-[11px] font-semibold uppercase tracking-wider rounded">
              {matchType === 'all' ? t('collections.smartEditor.andConnector') : t('collections.smartEditor.orConnector')}
            </span>
          </div>
        )}

        <div className="flex items-start gap-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg sm:flex-wrap">
          <Select
            options={fieldOptions}
            value={rule.field}
            onChange={(value) => handleFieldChange(rule.id, value as SmartCollectionField)}
            size="sm"
            className="min-w-[140px] shrink-0 sm:flex-1 sm:min-w-[120px]"
          />

          <Select
            options={operatorOptions}
            value={rule.operator}
            onChange={(value) =>
              handleUpdateRule(rule.id, { operator: value as SmartCollectionOperator })
            }
            size="sm"
            className="min-w-[160px] shrink-0 sm:flex-1 sm:min-w-[120px]"
          />

          {renderValueInput(rule)}

          <button
            type="button"
            className="flex items-center justify-center w-8 h-8 p-0 border-none bg-transparent text-[var(--color-text-tertiary)] rounded-lg shrink-0 cursor-pointer transition-colors hover:bg-red-50 hover:text-red-500"
            onClick={() => handleRemoveRule(rule.id)}
            aria-label={t('collections.smartEditor.removeRule')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M12 4L4 12M4 4L12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // Match type options
  const matchTypeOptions = [
    { value: 'all', label: t('collections.smartEditor.allConditionsOption') },
    { value: 'any', label: t('collections.smartEditor.anyConditionOption') },
  ];

  // Sort by options
  const sortByOptions = [
    { value: 'name', label: t('collections.fields.name') },
    { value: 'dateCreated', label: t('collections.fields.createdAt') },
    { value: 'dateModified', label: t('collections.fields.modifiedAt') },
    { value: 'size', label: t('collections.fields.size') },
  ];

  // Sort order options
  const sortOrderOptions = [
    { value: 'asc', label: t('collections.sort.ascending') },
    { value: 'desc', label: t('collections.sort.descending') },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? t('collections.smartEditor.editTitle') : t('collections.smartEditor.createTitle')}
      size="lg"
      className={className}
    >
      <ModalBody className="flex flex-col max-h-[60vh] overflow-y-auto !p-0">
        {/* Basic Info */}
        <div className="p-5 border-b border-[var(--color-border)]">
          <h4 className="m-0 mb-4 text-[15px] font-semibold text-[var(--color-text-primary)]">
            {t('collections.smartEditor.information')}
          </h4>

          <Input
            label={t('collections.createModal.name')}
            placeholder={t('collections.smartEditor.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
            error={errors.find((e) => e.includes(t('collections.createModal.name').toLowerCase()))}
          />

          <Input
            label={t('collections.createModal.description')}
            placeholder={t('collections.createModal.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
          />

          <div className="mt-4">
            <label className="block mb-2 text-sm font-medium text-[var(--color-text-primary)]">
              {t('collections.smartEditor.color')}
            </label>
            <div className="flex gap-2 flex-wrap">
              {COLLECTION_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`w-8 h-8 p-0 rounded-lg cursor-pointer transition-transform hover:scale-110 border-2 ${
                    color === c
                      ? 'border-[var(--color-text-primary)]'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                  aria-label={`${t('collections.smartEditor.color')} ${c}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Rules */}
        <div className="p-5 border-b border-[var(--color-border)]">
          <h4 className="m-0 mb-4 text-[15px] font-semibold text-[var(--color-text-primary)]">
            {t('collections.smartEditor.rules')}
          </h4>

          <Select
            label={t('collections.smartEditor.logic')}
            options={matchTypeOptions}
            value={matchType}
            onChange={(value) => setMatchType(value as 'all' | 'any')}
            fullWidth
          />

          <div className="flex flex-col gap-3 my-4">
            {rules.length === 0 ? (
              <div className="p-6 text-center bg-[var(--color-background-secondary)] border border-dashed border-[var(--color-border)] rounded-xl">
                <p className="m-0 text-sm text-[var(--color-text-secondary)]">
                  {t('collections.smartEditor.noRules')}
                </p>
                <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
                  {t('collections.smartEditor.noRulesHint')}
                </p>
              </div>
            ) : (
              rules.map((rule, index) => renderRule(rule, index))
            )}
          </div>

          <Button variant="secondary" size="sm" onClick={handleAddRule}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3V13M3 8H13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t('collections.smartEditor.addRule')}
          </Button>
        </div>

        {/* Sort and Limit */}
        <div className="p-5">
          <h4 className="m-0 mb-4 text-[15px] font-semibold text-[var(--color-text-primary)]">
            {t('collections.smartEditor.sortAndLimit')}
          </h4>

          <div className="flex gap-4 mb-4 sm:flex-col sm:gap-3">
            <Select
              label={t('collections.smartEditor.sortBy')}
              options={sortByOptions}
              value={sortBy}
              onChange={(value) => setSortBy(value as any)}
              className="flex-1"
            />

            <Select
              label={t('collections.smartEditor.order')}
              options={sortOrderOptions}
              value={sortOrder}
              onChange={(value) => setSortOrder(value as 'asc' | 'desc')}
              className="flex-1"
            />
          </div>

          <Input
            label={t('collections.smartEditor.limitLabel')}
            type="number"
            placeholder={t('collections.smartEditor.noLimit')}
            value={limit || ''}
            onChange={(e) => setLimit(e.target.value ? parseInt(e.target.value, 10) : undefined)}
            helperText={t('collections.smartEditor.limitHelperText')}
            fullWidth
          />
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="mx-4 mb-4 p-4 bg-red-50 border border-red-300 rounded-lg">
            <h4 className="m-0 mb-2 text-sm font-semibold text-red-600">{t('collections.smartEditor.errorsTitle')}:</h4>
            <ul className="m-0 pl-4">
              {errors.map((error, index) => (
                <li key={index} className="mb-1 text-[13px] text-red-600">
                  {error}
                </li>
              ))}
            </ul>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {t('collections.createModal.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          loading={isLoading}
          disabled={!name.trim() || rules.length === 0}
        >
          {isEditing ? t('collections.smartEditor.save') : t('collections.createModal.create')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default SmartCollectionEditor;
