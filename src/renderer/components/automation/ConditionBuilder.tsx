/**
 * ConditionBuilder Component
 *
 * Visual builder for creating automation rule conditions.
 * Supports various condition types, operators, and AND/OR logic groups.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sanitizeHtml } from '../../../utils/sanitize';
import { useSelector, useDispatch } from 'react-redux';
import {
  addCondition,
  updateCondition,
  removeCondition,
} from '../../../store/slices/automationSlice';
import {
  CONDITION_TYPE_LABELS,
  CONDITION_OPERATORS,
  OPERATOR_LABELS,
  ConditionType,
  ConditionOperator,
} from '../../../services/features/automationService';
import type { RuleCondition } from '../../../services/features/automationService';
import type { AutomationState } from '../../../store/slices/automationSlice';
import Button from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import Select from '../ui/Dropdown/Select';
import { InlineFolderPicker } from './InlineFolderPicker';

interface ConditionBuilderProps {
  className?: string;
}

export const ConditionBuilder: React.FC<ConditionBuilderProps> = ({ className }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { editingRule } = useSelector((state: { automation: AutomationState }) => state.automation);

  const conditions = editingRule?.conditions || [];

  const getOperatorsForType = (type: ConditionType): ConditionOperator[] => {
    return CONDITION_OPERATORS[type] || [];
  };

  const getDefaultValue = (
    type: ConditionType,
    operator: ConditionOperator
  ): string | number | string[] | { min: number; max: number } => {
    if (operator === 'between') {
      switch (type) {
        case 'file_size':
          return { min: 1048576, max: 104857600 }; // 1 Mo – 100 Mo
        default:
          return { min: 0, max: 0 };
      }
    }
    if (operator === 'in_list' || operator === 'not_in_list') {
      switch (type) {
        case 'file_extension':
          return ['pdf', 'docx', 'xlsx'];
        case 'file_type':
          return ['image', 'document'];
        case 'tag':
          return [];
        default:
          return [];
      }
    }
    switch (type) {
      case 'file_name':
        return '';
      case 'file_extension':
        return 'pdf';
      case 'file_type':
        return 'image';
      case 'file_size':
        return 10485760; // 10 Mo
      case 'created_date':
      case 'modified_date':
        return -30; // 30 jours
      case 'folder_path':
        return '';
      case 'tag':
        return '';
      default:
        return '';
    }
  };

  const getValueInputType = (
    type: ConditionType,
    operator: ConditionOperator
  ): 'text' | 'number' | 'date' | 'list' | 'range' => {
    if (operator === 'between') return 'range';
    if (operator === 'in_list' || operator === 'not_in_list') return 'list';
    switch (type) {
      case 'file_size':
        return 'number';
      case 'created_date':
      case 'modified_date':
        return 'date';
      default:
        return 'text';
    }
  };

  const handleAddCondition = useCallback(() => {
    const newCondition = {
      type: 'file_name' as ConditionType,
      operator: 'contains' as ConditionOperator,
      value: '',
      logic: conditions.length > 0 ? ('AND' as const) : undefined,
    };
    dispatch(addCondition(newCondition));
  }, [dispatch, conditions.length]);

  const handleTypeChange = useCallback(
    (id: string, newType: ConditionType) => {
      const availableOperators = getOperatorsForType(newType);
      const defaultOp = availableOperators[0];
      dispatch(
        updateCondition({
          id,
          updates: {
            type: newType,
            operator: defaultOp,
            value: getDefaultValue(newType, defaultOp),
          },
        })
      );
    },
    [dispatch]
  );

  const handleOperatorChange = useCallback(
    (
      id: string,
      operator: ConditionOperator,
      currentType: ConditionType,
      currentOperator: ConditionOperator
    ) => {
      const oldInputType = getValueInputType(currentType, currentOperator);
      const newInputType = getValueInputType(currentType, operator);
      if (oldInputType !== newInputType) {
        dispatch(
          updateCondition({
            id,
            updates: { operator, value: getDefaultValue(currentType, operator) },
          })
        );
      } else {
        dispatch(updateCondition({ id, updates: { operator } }));
      }
    },
    [dispatch]
  );

  const handleValueChange = useCallback(
    (id: string, value: string | number | string[] | { min: number; max: number }) => {
      dispatch(updateCondition({ id, updates: { value } }));
    },
    [dispatch]
  );

  const handleRemoveCondition = useCallback(
    (id: string) => {
      dispatch(removeCondition(id));
    },
    [dispatch]
  );

  const typeOptions = Object.entries(CONDITION_TYPE_LABELS()).map(([value, label]) => ({
    value,
    label,
  }));

  // Common file extensions for the dropdown
  const extensionOptions = [
    { value: 'pdf', label: 'PDF (.pdf)' },
    { value: 'doc', label: 'Word (.doc)' },
    { value: 'docx', label: 'Word (.docx)' },
    { value: 'xls', label: 'Excel (.xls)' },
    { value: 'xlsx', label: 'Excel (.xlsx)' },
    { value: 'ppt', label: 'PowerPoint (.ppt)' },
    { value: 'pptx', label: 'PowerPoint (.pptx)' },
    { value: 'txt', label: 'Text (.txt)' },
    { value: 'csv', label: 'CSV (.csv)' },
    { value: 'json', label: 'JSON (.json)' },
    { value: 'xml', label: 'XML (.xml)' },
    { value: 'html', label: 'HTML (.html)' },
    { value: 'md', label: 'Markdown (.md)' },
    { value: 'jpg', label: 'JPEG (.jpg)' },
    { value: 'jpeg', label: 'JPEG (.jpeg)' },
    { value: 'png', label: 'PNG (.png)' },
    { value: 'gif', label: 'GIF (.gif)' },
    { value: 'svg', label: 'SVG (.svg)' },
    { value: 'webp', label: 'WebP (.webp)' },
    { value: 'bmp', label: 'Bitmap (.bmp)' },
    { value: 'ico', label: 'Icon (.ico)' },
    { value: 'mp4', label: 'Video (.mp4)' },
    { value: 'avi', label: 'Video (.avi)' },
    { value: 'mov', label: 'Video (.mov)' },
    { value: 'mkv', label: 'Video (.mkv)' },
    { value: 'mp3', label: 'Audio (.mp3)' },
    { value: 'wav', label: 'Audio (.wav)' },
    { value: 'flac', label: 'Audio (.flac)' },
    { value: 'zip', label: 'Archive (.zip)' },
    { value: 'rar', label: 'Archive (.rar)' },
    { value: '7z', label: 'Archive (.7z)' },
    { value: 'tar', label: 'Archive (.tar)' },
    { value: 'gz', label: 'Archive (.gz)' },
    { value: 'js', label: 'JavaScript (.js)' },
    { value: 'ts', label: 'TypeScript (.ts)' },
    { value: 'py', label: 'Python (.py)' },
    { value: 'java', label: 'Java (.java)' },
    { value: 'css', label: 'CSS (.css)' },
    { value: 'scss', label: 'SCSS (.scss)' },
    { value: 'sql', label: 'SQL (.sql)' },
    { value: 'psd', label: 'Photoshop (.psd)' },
    { value: 'ai', label: 'Illustrator (.ai)' },
    { value: 'fig', label: 'Figma (.fig)' },
  ];

  const renderValueInput = (condition: RuleCondition) => {
    // File extension → show searchable dropdown
    if (
      condition.type === 'file_extension' &&
      (condition.operator === 'equals' || condition.operator === 'not_equals')
    ) {
      return (
        <div className="flex-1 min-w-[200px]">
          <Select
            options={extensionOptions}
            value={String(condition.value || '').replace(/^\./, '')}
            onChange={(val) => handleValueChange(condition.id, val as string)}
            placeholder={t('automation.conditions.chooseExtension')}
            size="sm"
            searchable
          />
        </div>
      );
    }

    // Folder path with exact match → show folder picker
    if (
      condition.type === 'folder_path' &&
      (condition.operator === 'equals' || condition.operator === 'not_equals')
    ) {
      return (
        <div className="flex-1 min-w-[200px]">
          <InlineFolderPicker
            placeholder={t('automation.conditions.selectFolder')}
            value={(condition.value as string) || null}
            onChange={(folderId, folder) =>
              handleValueChange(condition.id, folder ? folder.name : '')
            }
          />
        </div>
      );
    }

    const inputType = getValueInputType(condition.type, condition.operator);

    // Helper to format bytes for display
    const formatSizeHelper = (bytes: number): string => {
      if (!bytes || bytes === 0) return '';
      if (bytes >= 1073741824)
        return t('automation.conditions.sizeGB', { value: (bytes / 1073741824).toFixed(1) });
      if (bytes >= 1048576)
        return t('automation.conditions.sizeMB', { value: (bytes / 1048576).toFixed(1) });
      if (bytes >= 1024)
        return t('automation.conditions.sizeKB', { value: (bytes / 1024).toFixed(1) });
      return t('automation.conditions.sizeBytes', { value: bytes });
    };

    switch (inputType) {
      case 'number': {
        const numValue = condition.value as number;
        const isSizeCondition = condition.type === 'file_size';
        const isDateCondition =
          condition.type === 'created_date' || condition.type === 'modified_date';
        return (
          <div className="flex-1 min-w-[120px]">
            <Input
              type="number"
              placeholder={
                isSizeCondition
                  ? t('automation.conditions.sizeInBytes')
                  : isDateCondition
                    ? t('automation.conditions.daysNegativePast')
                    : t('automation.conditions.value')
              }
              value={numValue}
              onChange={(e) => handleValueChange(condition.id, parseInt(e.target.value, 10) || 0)}
              size="sm"
              helperText={
                isSizeCondition && numValue
                  ? formatSizeHelper(numValue)
                  : isDateCondition && numValue
                    ? numValue < 0
                      ? t('automation.conditions.daysPast', { count: Math.abs(numValue) })
                      : t('automation.conditions.daysFuture', { count: Math.abs(numValue) })
                    : undefined
              }
            />
          </div>
        );
      }
      case 'date':
        return (
          <Input
            type="date"
            value={condition.value as string}
            onChange={(e) => handleValueChange(condition.id, e.target.value)}
            size="sm"
          />
        );
      case 'list':
        return (
          <div className="flex-1 min-w-[200px]">
            <Input
              type="text"
              placeholder="valeur1, valeur2, valeur3"
              value={
                Array.isArray(condition.value)
                  ? condition.value.join(', ')
                  : (condition.value as string)
              }
              onChange={(e) =>
                handleValueChange(
                  condition.id,
                  e.target.value.split(',').map((v) => v.trim())
                )
              }
              size="sm"
              helperText={t('automation.conditions.separateByCommas')}
            />
          </div>
        );
      case 'range': {
        const rangeValue = (condition.value as { min: number; max: number }) || { min: 0, max: 0 };
        const isRangeSize = condition.type === 'file_size';
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Min"
                value={rangeValue.min}
                onChange={(e) =>
                  handleValueChange(condition.id, {
                    ...rangeValue,
                    min: parseInt(e.target.value, 10) || 0,
                  })
                }
                size="sm"
              />
              <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
                {t('automation.conditions.rangeAnd')}
              </span>
              <Input
                type="number"
                placeholder="Max"
                value={rangeValue.max}
                onChange={(e) =>
                  handleValueChange(condition.id, {
                    ...rangeValue,
                    max: parseInt(e.target.value, 10) || 0,
                  })
                }
                size="sm"
              />
            </div>
            {isRangeSize && (rangeValue.min || rangeValue.max) && (
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {formatSizeHelper(rangeValue.min)} – {formatSizeHelper(rangeValue.max)}
              </span>
            )}
          </div>
        );
      }
      default:
        return (
          <Input
            type="text"
            placeholder={t('automation.conditions.value')}
            value={condition.value as string}
            onChange={(e) => handleValueChange(condition.id, e.target.value)}
            size="sm"
          />
        );
    }
  };

  const renderCondition = (condition: RuleCondition, index: number) => {
    const operatorOptions = getOperatorsForType(condition.type).map((op) => ({
      value: op,
      label: OPERATOR_LABELS()[op],
    }));

    return (
      <div key={condition.id} className="flex flex-col gap-2">
        {index > 0 && (
          <div className="flex items-center justify-center py-1">
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[var(--color-primary-50)] text-[var(--color-primary-600)] rounded-full">
              {editingRule?.conditionsLogic === 'AND'
                ? t('automation.conditions.and')
                : t('automation.conditions.or')}
            </span>
          </div>
        )}

        <div className="flex items-start gap-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
          <div className="flex flex-col sm:flex-row flex-1 gap-2">
            <Select
              options={typeOptions}
              value={condition.type}
              onChange={(value) => handleTypeChange(condition.id, value as ConditionType)}
              size="sm"
            />
            <Select
              options={operatorOptions}
              value={condition.operator}
              onChange={(value) =>
                handleOperatorChange(
                  condition.id,
                  value as ConditionOperator,
                  condition.type,
                  condition.operator
                )
              }
              size="sm"
            />
            {renderValueInput(condition)}
          </div>

          <button
            type="button"
            onClick={() => handleRemoveCondition(condition.id)}
            aria-label={t('automation.conditions.removeCondition')}
            className="flex items-center justify-center w-8 h-8 shrink-0 rounded-md text-[var(--color-text-tertiary)] hover:bg-red-50 hover:text-red-500 transition-colors duration-150"
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

  const renderPreview = () => {
    if (conditions.length === 0) return null;

    const logic =
      editingRule?.conditionsLogic === 'AND'
        ? ` ${t('automation.conditions.and')} `
        : ` ${t('automation.conditions.or')} `;
    const preview = conditions
      .map((c) => {
        const typeLabel = CONDITION_TYPE_LABELS()[c.type];
        const operatorLabel = OPERATOR_LABELS()[c.operator];
        const value =
          typeof c.value === 'object' && 'min' in c.value
            ? `${c.value.min} ${t('automation.conditions.rangeAnd')} ${c.value.max}`
            : Array.isArray(c.value)
              ? c.value.join(', ')
              : c.value;
        return `${typeLabel} ${operatorLabel} "${value}"`;
      })
      .join(logic);

    return (
      <div className="p-3 bg-[var(--color-background-secondary)] rounded-lg border border-[var(--color-border)]">
        <span className="block mb-1 text-[10px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
          {t('automation.conditions.preview')}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)] font-mono break-words">
          {preview}
        </span>
      </div>
    );
  };

  return (
    <div className={`flex flex-col gap-4 ${className || ''}`}>
      <div className="mb-1">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
          {t('automation.conditions.title')}
        </h4>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {t('automation.conditions.description')}
        </p>

        <details className="mt-3 border border-[var(--color-border)] rounded-lg overflow-hidden">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[var(--color-primary-600)] bg-[var(--color-background-secondary)] select-none hover:bg-[var(--color-primary-50)] transition-colors duration-150">
            {t('automation.conditions.helpTitle')}
          </summary>
          <ul className="py-2 px-3 pl-6 text-xs leading-relaxed text-[var(--color-text-secondary)] list-disc">
            <li
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(t('automation.conditions.helpFileName')),
              }}
            />
            <li
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(t('automation.conditions.helpExtension')),
              }}
            />
            <li
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(t('automation.conditions.helpFileType')),
              }}
            />
            <li
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(t('automation.conditions.helpSize')),
              }}
            />
            <li
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(t('automation.conditions.helpDate')),
              }}
            />
            <li
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(t('automation.conditions.helpFolder')),
              }}
            />
            <li
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(t('automation.conditions.helpTag')) }}
            />
          </ul>
        </details>
      </div>

      <div className="flex flex-col gap-2">
        {conditions.length === 0 ? (
          <div className="p-6 text-center bg-[var(--color-background-secondary)] border border-dashed border-[var(--color-border)] rounded-lg">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t('automation.conditions.noConditions')}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {t('automation.conditions.noConditionsHint')}
            </p>
          </div>
        ) : (
          conditions.map((condition, index) => renderCondition(condition, index))
        )}
      </div>

      <div>
        <Button variant="secondary" size="sm" onClick={handleAddCondition}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3V13M3 8H13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('automation.conditions.addCondition')}
        </Button>
      </div>

      {renderPreview()}
    </div>
  );
};

export default ConditionBuilder;
