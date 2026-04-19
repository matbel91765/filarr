/**
 * ActionBuilder Component
 *
 * Visual builder for creating automation rule actions.
 * Supports multiple action types with drag-drop reordering.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sanitizeHtml } from '../../../utils/sanitize';
import { useSelector, useDispatch } from 'react-redux';
import {
  addAction,
  updateAction,
  removeAction,
  reorderActions,
} from '../../../store/slices/automationSlice';
import { ACTION_TYPE_LABELS, ActionType } from '../../../services/features/automationService';
import type { RuleAction } from '../../../services/features/automationService';
import type { AutomationState } from '../../../store/slices/automationSlice';
import Button from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import Select from '../ui/Dropdown/Select';
import { InlineFolderPicker } from './InlineFolderPicker';

interface ActionBuilderProps {
  className?: string;
}

export const ActionBuilder: React.FC<ActionBuilderProps> = ({ className }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { editingRule } = useSelector((state: { automation: AutomationState }) => state.automation);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const actions = editingRule?.actions || [];

  const actionTypeOptions = Object.entries(ACTION_TYPE_LABELS()).map(([value, label]) => ({
    value,
    label,
  }));

  const getActionIcon = (type: ActionType): React.ReactNode => {
    switch (type) {
      case 'move_to_folder':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M14 8L10 4M14 8L10 12M14 8H2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'copy_to_folder':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect
              x="3"
              y="5"
              width="8"
              height="8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M5 5V3H13V11H11"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'add_tag':
      case 'remove_tag':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 3V7.172C2 7.702 2.211 8.211 2.586 8.586L7.414 13.414C8.195 14.195 9.462 14.195 10.243 13.414L13.414 10.243C14.195 9.462 14.195 8.195 13.414 7.414L8.586 2.586C8.211 2.211 7.702 2 7.172 2H3C2.448 2 2 2.448 2 3Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="5" cy="5" r="1" fill="currentColor" />
          </svg>
        );
      case 'rename':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M11 2L14 5L5 14H2V11L11 2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'delete':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path
              d="M12 4V13C12 14 11 15 10 15H6C5 15 4 14 4 13V4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M6 4V2H10V4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'archive':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 5V14H14V5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M15 2H1V5H15V2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M6 8H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );
      case 'notify':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M13 5C13 3.674 12.473 2.402 11.536 1.464C10.598 0.527 9.326 0 8 0C6.674 0 5.402 0.527 4.464 1.464C3.527 2.402 3 3.674 3 5C3 11 1 12.5 1 12.5H15C15 12.5 13 11 13 5Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
          </svg>
        );
    }
  };

  const handleAddAction = useCallback(() => {
    dispatch(addAction({ type: 'move_to_folder' as ActionType, params: {} }));
  }, [dispatch]);

  const handleTypeChange = useCallback(
    (id: string, newType: ActionType) => {
      dispatch(updateAction({ id, updates: { type: newType, params: {} } }));
    },
    [dispatch]
  );

  const handleParamChange = useCallback(
    (id: string, paramName: string, value: string) => {
      const action = actions.find((a) => a.id === id);
      if (action) {
        dispatch(
          updateAction({ id, updates: { params: { ...action.params, [paramName]: value } } })
        );
      }
    },
    [dispatch, actions]
  );

  const handleRemoveAction = useCallback(
    (id: string) => {
      dispatch(removeAction(id));
    },
    [dispatch]
  );

  const handleDragStart = (index: number) => setDraggedIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };
  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newOrder = [...actions.map((a) => a.id)];
      const [removed] = newOrder.splice(draggedIndex, 1);
      newOrder.splice(dragOverIndex, 0, removed);
      dispatch(reorderActions(newOrder));
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const renderActionParams = (action: RuleAction) => {
    switch (action.type) {
      case 'move_to_folder':
      case 'copy_to_folder':
        return (
          <div className="px-4 py-3 border-t border-[var(--color-border)]">
            <InlineFolderPicker
              label={t('automation.actions.targetFolder')}
              placeholder={t('automation.actions.selectFolder')}
              value={action.params.targetFolderId || null}
              onChange={(folderId) => handleParamChange(action.id, 'targetFolderId', folderId)}
            />
          </div>
        );
      case 'add_tag':
      case 'remove_tag':
        return (
          <div className="px-4 py-3 border-t border-[var(--color-border)]">
            <Input
              label={t('automation.actions.tagName')}
              placeholder={t('automation.actions.tagPlaceholder')}
              value={action.params.tagName || ''}
              onChange={(e) => handleParamChange(action.id, 'tagName', e.target.value)}
              size="sm"
              fullWidth
            />
          </div>
        );
      case 'rename':
        return (
          <div className="px-4 py-3 border-t border-[var(--color-border)]">
            <Input
              label={t('automation.actions.renamePattern')}
              placeholder="{{date}}_{{filename}}"
              value={action.params.pattern || ''}
              onChange={(e) => handleParamChange(action.id, 'pattern', e.target.value)}
              size="sm"
              fullWidth
              helperText={t('automation.actions.renameHelperText')}
            />
          </div>
        );
      case 'notify':
        return (
          <div className="px-4 py-3 border-t border-[var(--color-border)]">
            <Input
              label={t('automation.actions.notifyMessage')}
              placeholder={t('automation.actions.notifyPlaceholder')}
              value={action.params.message || ''}
              onChange={(e) => handleParamChange(action.id, 'message', e.target.value)}
              size="sm"
              fullWidth
            />
          </div>
        );
      case 'delete':
      case 'archive':
        return (
          <div className="px-4 py-3 border-t border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-tertiary)] italic">
              {action.type === 'delete'
                ? t('automation.actions.deleteHint')
                : t('automation.actions.archiveHint')}
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  const renderAction = (action: RuleAction, index: number) => {
    const isDragging = draggedIndex === index;
    const isDragOver = dragOverIndex === index;

    return (
      <div
        key={action.id}
        className={`bg-[var(--color-surface)] border rounded-lg overflow-hidden transition-all duration-150
          ${isDragging ? 'opacity-50 shadow-lg border-[var(--color-border)]' : 'border-[var(--color-border)]'}
          ${isDragOver ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]' : ''}
          ${!isDragging && !isDragOver ? 'hover:border-[var(--color-primary-200)]' : ''}`}
        draggable
        onDragStart={() => handleDragStart(index)}
        onDragOver={(e) => handleDragOver(e, index)}
        onDragEnd={handleDragEnd}
      >
        <div className="flex items-center gap-2 p-3 bg-[var(--color-background-secondary)]">
          <div className="flex items-center justify-center w-6 h-6 text-[var(--color-text-tertiary)] cursor-grab active:cursor-grabbing shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 6H12M4 10H12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>

          <div className="flex items-center justify-center w-6 h-6 bg-[var(--color-primary)] text-white text-xs font-semibold rounded-full shrink-0">
            {index + 1}
          </div>

          <div className="text-[var(--color-text-secondary)] shrink-0">
            {getActionIcon(action.type)}
          </div>

          <div className="flex-1">
            <Select
              options={actionTypeOptions}
              value={action.type}
              onChange={(value) => handleTypeChange(action.id, value as ActionType)}
              size="sm"
            />
          </div>

          <button
            type="button"
            onClick={() => handleRemoveAction(action.id)}
            aria-label={t('automation.actions.removeAction')}
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

        {renderActionParams(action)}
      </div>
    );
  };

  return (
    <div className={`flex flex-col gap-4 ${className || ''}`}>
      <div className="mb-1">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
          {t('automation.actions.title')}
        </h4>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {t('automation.actions.description')}
        </p>

        <details className="mt-3 border border-[var(--color-border)] rounded-lg overflow-hidden">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[var(--color-primary-600)] bg-[var(--color-background-secondary)] select-none hover:bg-[var(--color-primary-50)] transition-colors duration-150">
            {t('automation.actions.helpTitle')}
          </summary>
          <ul className="py-2 px-3 pl-6 text-xs leading-relaxed text-[var(--color-text-secondary)] list-disc">
            <li
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(t('automation.actions.helpMoveTo')) }}
            />
            <li
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(t('automation.actions.helpCopyTo')) }}
            />
            <li
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(t('automation.actions.helpAddTag')) }}
            />
            <li
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(t('automation.actions.helpRemoveTag')),
              }}
            />
            <li
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(t('automation.actions.helpRename')) }}
            />
            <li
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(t('automation.actions.helpDelete')) }}
            />
            <li
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(t('automation.actions.helpArchive')),
              }}
            />
            <li
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(t('automation.actions.helpNotify')) }}
            />
          </ul>
        </details>
      </div>

      <div className="flex flex-col gap-3">
        {actions.length === 0 ? (
          <div className="p-6 text-center bg-[var(--color-background-secondary)] border border-dashed border-[var(--color-border)] rounded-lg">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t('automation.actions.noActions')}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {t('automation.actions.noActionsHint')}
            </p>
          </div>
        ) : (
          actions
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((action, index) => renderAction(action, index))
        )}
      </div>

      <div>
        <Button variant="secondary" size="sm" onClick={handleAddAction}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3V13M3 8H13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('automation.actions.addAction')}
        </Button>
      </div>
    </div>
  );
};

export default ActionBuilder;
