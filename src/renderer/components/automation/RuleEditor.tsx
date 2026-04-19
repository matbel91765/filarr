/**
 * RuleEditor Component
 *
 * Modal for creating and editing automation rules.
 * Includes rule name/description, trigger selection, condition builder,
 * action builder, and rule testing.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import {
  createRule,
  updateRule,
  cancelEditing,
  updateEditingRule,
  validateEditingRule,
} from '../../../store/slices/automationSlice';
import {
  TRIGGER_LABELS,
  RuleTrigger,
} from '../../../services/features/automationService';
import type { AutomationState } from '../../../store/slices/automationSlice';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal/Modal';
import Button from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import Select from '../ui/Dropdown/Select';
import Toggle from '../ui/Toggle/Toggle';
import ConditionBuilder from './ConditionBuilder';
import ActionBuilder from './ActionBuilder';

interface RuleEditorProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

type EditorTab = 'general' | 'conditions' | 'actions' | 'advanced';

export const RuleEditor: React.FC<RuleEditorProps> = ({ isOpen, onClose, className }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { editingRule, validationErrors, loading } = useSelector(
    (state: { automation: AutomationState }) => state.automation
  );

  const [activeTab, setActiveTab] = useState<EditorTab>('general');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  const isEditing = editingRule?.id !== undefined;

  const TABS: { key: EditorTab; label: string }[] = useMemo(() => [
    { key: 'general', label: t('automation.editor.tabs.general') },
    { key: 'conditions', label: t('automation.editor.tabs.conditions') },
    { key: 'actions', label: t('automation.editor.tabs.actions') },
    { key: 'advanced', label: t('automation.editor.tabs.advanced') },
  ], [t]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('general');
      setIsTesting(false);
      setTestResult(null);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    dispatch(cancelEditing());
    onClose();
  }, [dispatch, onClose]);

  const handleFieldChange = useCallback(
    (field: string, value: any) => {
      dispatch(updateEditingRule({ [field]: value }));
    },
    [dispatch]
  );

  const handleSave = useCallback(() => {
    dispatch(validateEditingRule());

    if (!editingRule) return;

    const validation = validationErrors.length === 0;
    if (!validation) return;

    if (isEditing && editingRule.id) {
      dispatch(
        updateRule({
          id: editingRule.id,
          updates: editingRule,
        }) as any
      );
    } else {
      dispatch(
        createRule({
          name: editingRule.name || '',
          description: editingRule.description || '',
          enabled: editingRule.enabled ?? true,
          trigger: editingRule.trigger || 'file_created',
          conditions: editingRule.conditions || [],
          conditionsLogic: editingRule.conditionsLogic || 'AND',
          actions: editingRule.actions || [],
          priority: editingRule.priority ?? 100,
          stopOnMatch: editingRule.stopOnMatch ?? false,
          tags: editingRule.tags || [],
        }) as any
      );
    }

    onClose();
  }, [dispatch, editingRule, isEditing, validationErrors, onClose]);

  const handleTestRule = useCallback(() => {
    setIsTesting(true);
    setTestResult(null);
    setTestSuccess(false);

    setTimeout(() => {
      setIsTesting(false);

      if (!editingRule) {
        setTestResult(t('automation.editor.testFailedNoRule'));
        return;
      }

      const errors: string[] = [];

      if (!editingRule.name?.trim()) {
        errors.push(t('automation.editor.testErrorNameMissing'));
      }

      if (!editingRule.trigger) {
        errors.push(t('automation.editor.testErrorNoTrigger'));
      }

      if (!editingRule.actions || editingRule.actions.length === 0) {
        errors.push(t('automation.editor.testErrorNoAction'));
      } else {
        editingRule.actions.forEach((action, i) => {
          if ((action.type === 'move_to_folder' || action.type === 'copy_to_folder') && !action.params.targetFolderId) {
            errors.push(t('automation.editor.testErrorFolderMissing', { index: i + 1, type: action.type }));
          }
          if ((action.type === 'add_tag' || action.type === 'remove_tag') && !action.params.tagName) {
            errors.push(t('automation.editor.testErrorTagMissing', { index: i + 1, type: action.type }));
          }
          if (action.type === 'rename' && !action.params.pattern) {
            errors.push(t('automation.editor.testErrorPatternMissing', { index: i + 1 }));
          }
          if (action.type === 'notify' && !action.params.message) {
            errors.push(t('automation.editor.testErrorMessageMissing', { index: i + 1 }));
          }
        });
      }

      editingRule.conditions?.forEach((condition, i) => {
        if (condition.operator === 'matches_regex') {
          try {
            new RegExp(String(condition.value));
          } catch {
            errors.push(t('automation.editor.testErrorInvalidRegex', { index: i + 1 }));
          }
        }
        if (!condition.value && condition.value !== 0) {
          errors.push(t('automation.editor.testErrorValueMissing', { index: i + 1 }));
        }
      });

      if (errors.length === 0) {
        const condCount = editingRule.conditions?.length || 0;
        const actCount = editingRule.actions?.length || 0;
        setTestSuccess(true);
        setTestResult(
          t('automation.editor.testSuccess', { condCount, actCount, trigger: TRIGGER_LABELS()[editingRule.trigger || 'file_created'] })
        );
      } else {
        setTestSuccess(false);
        setTestResult(t('automation.editor.testFailed', { count: errors.length }) + '\n- ' + errors.join('\n- '));
      }
    }, 500);
  }, [editingRule]);

  const triggerOptions = Object.entries(TRIGGER_LABELS()).map(([value, label]) => ({
    value,
    label,
  }));

  const logicOptions = useMemo(() => [
    { value: 'AND', label: t('automation.editor.logicAnd') },
    { value: 'OR', label: t('automation.editor.logicOr') },
  ], [t]);

  const getTabBadge = (tab: EditorTab): number | null => {
    if (tab === 'conditions') return editingRule?.conditions?.length || null;
    if (tab === 'actions') return editingRule?.actions?.length || null;
    return null;
  };

  if (!editingRule) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? t('automation.editRule') : t('automation.newRule')}
      size="lg"
      className={className}
    >
      <ModalBody className="flex flex-col gap-0 p-0">
        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-[var(--color-border)] px-5 bg-[var(--color-surface)]">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const badge = getTabBadge(tab.key);
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors duration-150
                  ${isActive
                    ? 'text-[var(--color-primary)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-primary)] after:rounded-t-full'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
              >
                {tab.label}
                {badge && badge > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-[var(--color-primary)] text-white">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="flex flex-col gap-4">
              <Input
                label={t('automation.editor.ruleName')}
                placeholder={t('automation.editor.ruleNamePlaceholder')}
                value={editingRule.name || ''}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                required
                fullWidth
                error={validationErrors.find((e) => e.includes('nom'))}
              />

              <Input
                label={t('automation.editor.description')}
                placeholder={t('automation.editor.descriptionPlaceholder')}
                value={editingRule.description || ''}
                onChange={(e) => handleFieldChange('description', e.target.value)}
                fullWidth
              />

              <Select
                label={t('automation.editor.trigger')}
                options={triggerOptions}
                value={editingRule.trigger || 'file_created'}
                onChange={(value) => handleFieldChange('trigger', value as RuleTrigger)}
                fullWidth
              />

              {editingRule.trigger === 'scheduled' && (
                <div className="p-3 bg-[var(--color-background-secondary)] rounded-lg border border-[var(--color-border)]">
                  <p className="text-xs text-[var(--color-text-secondary)] italic">
                    {t('automation.editor.scheduledHint')}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between p-3 bg-[var(--color-background-secondary)] rounded-lg border border-[var(--color-border)]">
                <Toggle
                  label={t('automation.editor.ruleEnabled')}
                  checked={editingRule.enabled ?? true}
                  onChange={(e) => handleFieldChange('enabled', e.target.checked)}
                  labelPosition="left"
                />
              </div>
            </div>
          )}

          {/* Conditions Tab */}
          {activeTab === 'conditions' && (
            <div className="flex flex-col gap-4">
              <div className="max-w-xs">
                <Select
                  label={t('automation.editor.conditionsLogic')}
                  options={logicOptions}
                  value={editingRule.conditionsLogic || 'AND'}
                  onChange={(value) => handleFieldChange('conditionsLogic', value)}
                />
              </div>

              <ConditionBuilder />

              {editingRule.conditions?.length === 0 && (
                <p className="text-xs text-[var(--color-text-tertiary)] italic">
                  {t('automation.editor.noConditionsHint')}
                </p>
              )}
            </div>
          )}

          {/* Actions Tab */}
          {activeTab === 'actions' && (
            <div className="flex flex-col gap-4">
              <ActionBuilder />

              {validationErrors.some((e) => e.includes('action')) && (
                <p className="text-xs text-red-500 font-medium">
                  {validationErrors.find((e) => e.includes('action'))}
                </p>
              )}
            </div>
          )}

          {/* Advanced Tab */}
          {activeTab === 'advanced' && (
            <div className="flex flex-col gap-5">
              <Input
                label={t('automation.editor.priority')}
                type="number"
                placeholder="100"
                value={editingRule.priority ?? 100}
                onChange={(e) => handleFieldChange('priority', parseInt(e.target.value, 10) || 100)}
                helperText={t('automation.editor.priorityHelperText')}
                fullWidth
              />

              <div className="flex flex-col gap-2 p-4 bg-[var(--color-background-secondary)] rounded-lg border border-[var(--color-border)]">
                <Toggle
                  label={t('automation.editor.stopOnMatch')}
                  checked={editingRule.stopOnMatch ?? false}
                  onChange={(e) => handleFieldChange('stopOnMatch', e.target.checked)}
                  labelPosition="left"
                />
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  {t('automation.editor.stopOnMatchDesc')}
                </p>
              </div>

              {editingRule.trigger === 'scheduled' && (
                <div className="flex flex-col gap-4 p-4 bg-[var(--color-background-secondary)] rounded-lg border border-[var(--color-border)]">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {t('automation.editor.scheduleConfig')}
                  </h4>
                  <Select
                    label={t('automation.editor.frequency')}
                    options={[
                      { value: 'daily', label: t('automation.editor.frequencyDaily') },
                      { value: 'weekly', label: t('automation.editor.frequencyWeekly') },
                      { value: 'monthly', label: t('automation.editor.frequencyMonthly') },
                    ]}
                    value={editingRule.schedule?.type || 'daily'}
                    onChange={(value) =>
                      handleFieldChange('schedule', {
                        ...editingRule.schedule,
                        type: value,
                        enabled: true,
                      })
                    }
                    fullWidth
                  />

                  <Input
                    label={t('automation.editor.executionTime')}
                    type="time"
                    value={editingRule.schedule?.time || '09:00'}
                    onChange={(e) =>
                      handleFieldChange('schedule', {
                        ...editingRule.schedule,
                        time: e.target.value,
                      })
                    }
                    fullWidth
                  />
                </div>
              )}

              {/* Test Rule Section */}
              <div className="flex flex-col gap-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {t('automation.editor.testRule')}
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {t('automation.editor.testRuleDesc')}
                </p>
                <div>
                  <Button
                    variant="secondary"
                    onClick={handleTestRule}
                    loading={isTesting}
                    disabled={!editingRule.name || (editingRule.actions?.length || 0) === 0}
                  >
                    {t('automation.editor.testRuleButton')}
                  </Button>
                </div>
                {testResult && (
                  <div
                    className={`p-3 rounded-lg text-xs whitespace-pre-wrap ${
                      testSuccess
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}
                  >
                    {testResult}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <div className="mx-5 mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <h4 className="text-sm font-semibold text-red-700 mb-2">{t('automation.editor.validationErrors')}</h4>
            <ul className="list-disc pl-5 text-xs text-red-600 space-y-1">
              {validationErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={handleClose}>
          {t('automation.editor.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          loading={loading}
          disabled={!editingRule.name || (editingRule.actions?.length || 0) === 0}
        >
          {isEditing ? t('automation.editor.save') : t('automation.editor.create')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default RuleEditor;
