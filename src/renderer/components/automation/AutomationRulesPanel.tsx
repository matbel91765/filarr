/**
 * AutomationRulesPanel Component
 *
 * Main panel for managing automation rules.
 * Google Drive-style layout with search, filters, grid/list toggle,
 * context menu, stats bar, and execution history.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import {
  loadRules,
  loadExecutionLog,
  clearExecutionLog,
  toggleRuleEnabled,
  deleteRule,
  duplicateRule,
  startEditingRule,
  selectRule,
} from '../../../store/slices/automationSlice';
import {
  TRIGGER_LABELS,
  ACTION_TYPE_LABELS,
  RULE_TEMPLATES,
  RuleTemplate,
  RuleTrigger,
  createRuleFromTemplate,
  executeRule as executeRuleService,
  getRuleById,
} from '../../../services/features/automationService';
import type { AutomationRule, RuleExecutionResult, FileContext } from '../../../services/features/automationService';
import type { AutomationState } from '../../../store/slices/automationSlice';
import { loadTags } from '../../../store/slices/tagsSlice';
import type { RootState } from '../../../store';
import type { FileItem, Folder } from '../../../types';
import Button from '../ui/Button/Button';
import Toggle from '../ui/Toggle/Toggle';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import RuleEditor from './RuleEditor';

// ==================== ICONS ====================

const SearchIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21L16.65 16.65" />
  </svg>
);

const GridIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

const ListIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6H20M4 12H20M4 18H20" />
  </svg>
);

const MoreDotsIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
);

const PlusIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M12 5V19M5 12H19" />
  </svg>
);

const RulesIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7L12 12L22 7L12 2Z" />
    <path d="M2 17L12 22L22 17" />
    <path d="M2 12L12 17L22 12" />
  </svg>
);

const ActiveIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
    <path d="M22 4L12 14.01L9 11.01" />
  </svg>
);

const ExecIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" />
  </svg>
);

interface AutomationRulesPanelProps {
  className?: string;
}

type StatusFilter = 'all' | 'active' | 'paused' | 'error';
type ViewMode = 'grid' | 'list';
type PanelTab = 'rules' | 'history';

export const AutomationRulesPanel: React.FC<AutomationRulesPanelProps> = ({ className }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { rules, executionLog, loading, error, selectedRuleId } = useSelector(
    (state: { automation: AutomationState }) => state.automation
  );

  const [showEditor, setShowEditor] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>('rules');

  // New feature states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [contextMenuRuleId, setContextMenuRuleId] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [executionResult, setExecutionResult] = useState<{
    ruleName: string;
    matchCount: number;
    totalCount: number;
    matchedFiles: string[];
  } | null>(null);

  useEffect(() => {
    dispatch(loadRules() as any);
    dispatch(loadExecutionLog(50) as any);
  }, [dispatch]);

  // ==================== Helpers ====================

  const getRuleStatus = useCallback(
    (rule: AutomationRule): 'active' | 'paused' | 'error' => {
      if (!rule.enabled) return 'paused';
      const recentErrors = executionLog.filter(
        (log) => log.ruleId === rule.id && !log.success
      );
      if (recentErrors.length > 2) return 'error';
      return 'active';
    },
    [executionLog]
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateShort = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
    });
  };

  // ==================== Filtered rules ====================

  const filteredRules = useMemo(() => {
    return rules.filter((rule) => {
      // Status filter
      if (statusFilter !== 'all') {
        const status = getRuleStatus(rule);
        if (status !== statusFilter) return false;
      }
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          rule.name.toLowerCase().includes(q) ||
          rule.description?.toLowerCase().includes(q) ||
          TRIGGER_LABELS()[rule.trigger]?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rules, statusFilter, searchQuery, getRuleStatus]);

  // ==================== Stats ====================

  const stats = useMemo(() => {
    const activeCount = rules.filter((r) => r.enabled).length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayExec = executionLog.filter(
      (log) => new Date(log.timestamp) >= todayStart
    ).length;
    return {
      total: rules.length,
      active: activeCount,
      todayExec,
    };
  }, [rules, executionLog]);

  // ==================== Handlers ====================

  const handleCreateRule = useCallback(() => {
    dispatch(startEditingRule(null));
    setShowEditor(true);
  }, [dispatch]);

  const handleEditRule = useCallback(
    (ruleId: string) => {
      dispatch(startEditingRule(ruleId));
      setShowEditor(true);
      closeContextMenu();
    },
    [dispatch]
  );

  const handleToggleRule = useCallback(
    (ruleId: string) => {
      dispatch(toggleRuleEnabled(ruleId) as any);
    },
    [dispatch]
  );

  const handleDeleteConfirm = useCallback((ruleId: string) => {
    setRuleToDelete(ruleId);
    setShowDeleteConfirm(true);
    closeContextMenu();
  }, []);

  const handleDeleteRule = useCallback(() => {
    if (ruleToDelete) {
      dispatch(deleteRule(ruleToDelete) as any);
      setShowDeleteConfirm(false);
      setRuleToDelete(null);
    }
  }, [dispatch, ruleToDelete]);

  const handleDuplicateRule = useCallback(
    (ruleId: string) => {
      dispatch(duplicateRule(ruleId) as any);
      closeContextMenu();
    },
    [dispatch]
  );

  const handleClearHistory = useCallback(() => {
    dispatch(clearExecutionLog() as any);
  }, [dispatch]);

  const handleSelectTemplate = useCallback(
    (template: RuleTemplate) => {
      const newRule = createRuleFromTemplate(template);
      setShowTemplates(false);
      dispatch(loadRules() as any);
      dispatch(startEditingRule(newRule.id));
      setShowEditor(true);
    },
    [dispatch]
  );

  // Execute a rule manually against all files in the system
  const allFolders = useSelector((state: RootState) => state.folders.byId);
  const allFiles = useSelector((state: RootState) => state.files.byId);

  const handleExecuteRule = useCallback(
    async (ruleId: string) => {
      setContextMenuRuleId(null);
      setContextMenuPosition(null);
      const rule = getRuleById(ruleId);
      if (!rule) return;

      // Build FileContext for each file in the system
      const fileContexts: FileContext[] = [];
      for (const [fileId, file] of Object.entries(allFiles)) {
        if (!file || (file as FileItem).deletedAt) continue;
        const f = file as FileItem;
        // folder.items can be string[] or object[] — handle both
        const parentFolder = Object.values(allFolders).find((folder: any) => {
          if (!folder?.items) return false;
          return folder.items.some((item: any) => {
            const itemId = typeof item === 'string' ? item : item?.id;
            return itemId === fileId;
          });
        }) as Folder | undefined;
        const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
        fileContexts.push({
          id: f.id,
          name: f.name,
          extension: ext,
          type: f.type || '',
          size: f.size || 0,
          folderId: parentFolder?.id || '',
          folderPath: parentFolder?.name || '',
          createdAt: f.createdAt || new Date().toISOString(),
          modifiedAt: f.updatedAt || new Date().toISOString(),
          tags: [],
        });
      }

      let matchCount = 0;
      const matchedFiles: string[] = [];
      for (const fc of fileContexts) {
        try {
          const result = await executeRuleService(rule, fc);
          if (result.success) {
            matchCount++;
            matchedFiles.push(fc.name);
          }
        } catch (err) {
          console.error('[Automation] Manual execution error:', err);
        }
      }

      // Refresh tags and execution log
      dispatch(loadTags() as any);
      dispatch(loadExecutionLog() as any);

      setExecutionResult({
        ruleName: rule.name,
        matchCount,
        totalCount: fileContexts.length,
        matchedFiles,
      });
    },
    [allFiles, allFolders, dispatch]
  );

  // Context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, ruleId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenuRuleId(ruleId);
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenuRuleId(null);
    setContextMenuPosition(null);
  }, []);

  // ==================== Status helpers ====================

  const statusDotColor = (status: 'active' | 'paused' | 'error') => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'paused': return 'bg-amber-400';
      case 'error': return 'bg-red-500';
    }
  };

  const statusBarColor = (status: 'active' | 'paused' | 'error') => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'paused': return 'bg-amber-400';
      case 'error': return 'bg-red-500';
    }
  };

  const statusLabel = (status: 'active' | 'paused' | 'error') => {
    switch (status) {
      case 'active': return t('automation.status.active');
      case 'paused': return t('automation.status.paused');
      case 'error': return t('automation.status.error');
    }
  };

  // Context menu rule object
  const contextMenuRule = useMemo(() => {
    if (!contextMenuRuleId) return null;
    return rules.find((r) => r.id === contextMenuRuleId) || null;
  }, [rules, contextMenuRuleId]);

  // ==================== Filter options ====================

  const statusFilterOptions: { value: StatusFilter; label: string }[] = useMemo(() => [
    { value: 'all', label: t('automation.filters.all') },
    { value: 'active', label: t('automation.filters.active') },
    { value: 'paused', label: t('automation.filters.paused') },
    { value: 'error', label: t('automation.filters.errors') },
  ], [t]);

  // ==================== Render ====================

  return (
    <div className={`flex flex-col w-full min-h-full bg-[var(--color-background-secondary)] ${className || ''}`}>

      {/* ===== Header Banner ===== */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border-light)] px-6 py-6">
        <div className="max-w-[1400px] mx-auto flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-normal text-[var(--color-text-primary)] mb-1">
              {t('automation.title')}
            </h1>
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t('automation.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            <Button variant="secondary" size="sm" onClick={() => setShowTemplates(true)}>
              {t('automation.templates')}
            </Button>
            <Button variant="primary" size="sm" onClick={handleCreateRule}>
              <PlusIcon />
              {t('automation.newRule')}
            </Button>
          </div>
        </div>
      </div>

      {/* ===== Content ===== */}
      <div className="max-w-[1400px] mx-auto w-full px-6 py-6 flex flex-col gap-5">

        {/* Stats Bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-center gap-3 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-500 shrink-0">
              <RulesIcon />
            </div>
            <div>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{stats.total}</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('automation.stats.totalRules')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-50 text-green-500 shrink-0">
              <ActiveIcon />
            </div>
            <div>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{stats.active}</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('automation.stats.active')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-50 text-amber-500 shrink-0">
              <ExecIcon />
            </div>
            <div>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{stats.todayExec}</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('automation.stats.executionsToday')}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-[var(--color-border)]">
          {(['rules', 'history'] as PanelTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors duration-150
                ${activeTab === tab
                  ? 'text-[var(--color-primary)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-primary)] after:rounded-t-full'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                }`}
            >
              {tab === 'rules' ? t('automation.tabs.rules') : t('automation.tabs.history')}
              {tab === 'rules' && rules.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-[var(--color-primary)] text-white">
                  {rules.length}
                </span>
              )}
              {tab === 'history' && executionLog.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-[var(--color-text-tertiary)] text-white">
                  {executionLog.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Rules Tab Content */}
        {activeTab === 'rules' && (
          <>
            {/* Toolbar: search + filter chips + view toggle */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              {/* Search */}
              <div className="relative w-full sm:w-72">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">
                  <SearchIcon />
                </span>
                <input
                  type="text"
                  placeholder={t('automation.search')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--color-border)]
                    bg-[var(--color-surface)] text-[var(--color-text-primary)]
                    placeholder:text-[var(--color-text-tertiary)]
                    focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-300)] focus:border-[var(--color-primary-300)]
                    transition-all duration-150"
                />
              </div>

              {/* Status filter chips */}
              <div className="flex items-center gap-1">
                {statusFilterOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all duration-150
                      ${statusFilter === opt.value
                        ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] border-[var(--color-primary-200)]'
                        : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-background-secondary)]'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* View toggle */}
              <div className="flex items-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-0.5 sm:ml-auto">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-md transition-all duration-150
                    ${viewMode === 'grid'
                      ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                    }`}
                  title={t('automation.viewGrid')}
                >
                  <GridIcon />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-md transition-all duration-150
                    ${viewMode === 'list'
                      ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                    }`}
                  title={t('automation.viewList')}
                >
                  <ListIcon />
                </button>
              </div>
            </div>

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-center justify-between">
                <p>{error}</p>
                <Button variant="secondary" size="sm" onClick={() => dispatch(loadRules() as any)}>
                  {t('automation.retry')}
                </Button>
              </div>
            )}

            {/* Empty state */}
            {!loading && !error && filteredRules.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center
                bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm">
                <div className="w-24 h-24 rounded-full bg-blue-50 flex items-center justify-center mb-6">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--color-primary-400)" strokeWidth="1">
                    <path d="M24 4L4 14V34L24 44L44 34V14L24 4Z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M24 44V24" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M44 14L24 24L4 14" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                {searchQuery || statusFilter !== 'all' ? (
                  <>
                    <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                      {t('automation.emptyState.noResults')}
                    </h3>
                    <p className="text-sm text-[var(--color-text-secondary)] max-w-md">
                      {t('automation.emptyState.noResultsDesc')}
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                      {t('automation.emptyState.noRules')}
                    </h3>
                    <p className="text-sm text-[var(--color-text-secondary)] max-w-md mb-6">
                      {t('automation.emptyState.noRulesDesc')}
                    </p>
                    <div className="flex gap-3">
                      <Button variant="primary" onClick={handleCreateRule}>
                        {t('automation.emptyState.createRule')}
                      </Button>
                      <Button variant="secondary" onClick={() => setShowTemplates(true)}>
                        {t('automation.emptyState.useTemplate')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ===== Grid View ===== */}
            {!loading && !error && filteredRules.length > 0 && viewMode === 'grid' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredRules.map((rule) => {
                  const status = getRuleStatus(rule);
                  return (
                    <div
                      key={rule.id}
                      onClick={() => handleEditRule(rule.id)}
                      onContextMenu={(e) => handleContextMenu(e, rule.id)}
                      className="group relative rounded-xl border cursor-pointer select-none
                        transition-all duration-200 overflow-hidden
                        bg-[var(--color-surface)] border-[var(--color-border)] shadow-sm
                        hover:shadow-lg hover:border-[var(--color-primary-200)] hover:-translate-y-0.5"
                    >
                      {/* Status color bar */}
                      <div className={`h-1 ${statusBarColor(status)}`} />

                      {/* Card body */}
                      <div className="p-4 flex flex-col gap-3">
                        {/* Title row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                              {rule.name}
                            </h3>
                            {rule.description && (
                              <p className="text-xs text-[var(--color-text-tertiary)] truncate mt-0.5">
                                {rule.description}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenu(e, rule.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded-full shrink-0
                              hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
                          >
                            <MoreDotsIcon />
                          </button>
                        </div>

                        {/* Trigger badge */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                            {TRIGGER_LABELS()[rule.trigger]}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full
                            ${status === 'active' ? 'bg-green-50 text-green-600 border border-green-200'
                              : status === 'paused' ? 'bg-amber-50 text-amber-600 border border-amber-200'
                              : 'bg-red-50 text-red-600 border border-red-200'
                            }`}
                          >
                            {statusLabel(status)}
                          </span>
                        </div>

                        {/* Stats row */}
                        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-light)]">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-[var(--color-text-tertiary)]">
                              {rule.conditions.length} {t('automation.condShort')}
                            </span>
                            <span className="text-xs text-[var(--color-text-tertiary)]">
                              {rule.actions.length} {t('automation.actShort')}
                            </span>
                            <span className="text-xs text-[var(--color-text-tertiary)]">
                              {rule.triggerCount}x
                            </span>
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Toggle
                              checked={rule.enabled}
                              onChange={() => handleToggleRule(rule.id)}
                              size="sm"
                              aria-label={rule.enabled ? t('automation.disable') : t('automation.enable')}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ===== List View ===== */}
            {!loading && !error && filteredRules.length > 0 && viewMode === 'list' && (
              <div className="flex flex-col rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] shadow-sm">
                {filteredRules.map((rule, index) => {
                  const status = getRuleStatus(rule);
                  return (
                    <div
                      key={rule.id}
                      onClick={() => handleEditRule(rule.id)}
                      onContextMenu={(e) => handleContextMenu(e, rule.id)}
                      className={`group flex items-center gap-4 px-4 py-3 cursor-pointer select-none
                        transition-colors duration-100 hover:bg-[var(--color-background-secondary)]
                        ${index !== 0 ? 'border-t border-[var(--color-border-light)]' : ''}`}
                    >
                      {/* Status dot */}
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotColor(status)}`}
                        title={statusLabel(status)}
                      />

                      {/* Name + description */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {rule.name}
                        </p>
                        {rule.description && (
                          <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                            {rule.description}
                          </p>
                        )}
                      </div>

                      {/* Trigger badge */}
                      <span className="hidden sm:inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-blue-50 text-blue-600 border border-blue-200 shrink-0">
                        {TRIGGER_LABELS()[rule.trigger]}
                      </span>

                      {/* Exec count */}
                      <span className="text-xs text-[var(--color-text-tertiary)] hidden sm:inline shrink-0 w-16 text-right">
                        {rule.triggerCount} {t('automation.execShort')}
                      </span>

                      {/* Last run */}
                      {rule.lastTriggeredAt && (
                        <span className="text-xs text-[var(--color-text-tertiary)] hidden md:inline shrink-0 w-20 text-right">
                          {formatDateShort(rule.lastTriggeredAt)}
                        </span>
                      )}

                      {/* Toggle */}
                      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                        <Toggle
                          checked={rule.enabled}
                          onChange={() => handleToggleRule(rule.id)}
                          size="sm"
                          aria-label={rule.enabled ? t('automation.disable') : t('automation.enable')}
                        />
                      </div>

                      {/* More button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleContextMenu(e, rule.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-full shrink-0
                          hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
                      >
                        <MoreDotsIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* History Tab Content */}
        {activeTab === 'history' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">
                {t('automation.history.eventsCount', { count: executionLog.length })}
              </span>
              {executionLog.length > 0 && (
                <Button variant="secondary" size="sm" onClick={handleClearHistory}>
                  {t('automation.history.clearHistory')}
                </Button>
              )}
            </div>

            {executionLog.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center
                bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm">
                <div className="w-24 h-24 rounded-full bg-blue-50 flex items-center justify-center mb-6">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--color-primary-400)" strokeWidth="1">
                    <circle cx="24" cy="24" r="20" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M24 12V24L32 28" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                  {t('automation.history.noHistory')}
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)] max-w-md">
                  {t('automation.history.noHistoryDesc')}
                </p>
              </div>
            ) : (
              <div className="flex flex-col rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] shadow-sm">
                {executionLog.map((log, index) => (
                  <div
                    key={`${log.ruleId}-${log.timestamp}-${index}`}
                    className={`flex items-start gap-3 px-4 py-3
                      ${index !== 0 ? 'border-t border-[var(--color-border-light)]' : ''}`}
                  >
                    {/* Icon */}
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 mt-0.5
                      ${log.success ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'}`}
                    >
                      {log.success ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {log.ruleName}
                        </span>
                        <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
                          {formatDate(log.timestamp)}
                        </span>
                      </div>
                      {log.fileName && (
                        <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate">
                          {t('automation.history.file', { name: log.fileName })}
                        </p>
                      )}
                      {log.error && (
                        <p className="text-xs text-red-500 mt-0.5">{log.error}</p>
                      )}
                      {log.actionsExecuted.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {log.actionsExecuted.map((action, idx) => (
                            <span
                              key={idx}
                              className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded
                                ${action.success
                                  ? 'bg-green-50 text-green-600'
                                  : 'bg-red-50 text-red-600'
                                }`}
                            >
                              {ACTION_TYPE_LABELS()[action.actionType] || action.actionType}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ===== Context Menu ===== */}
      {contextMenuPosition && contextMenuRuleId && (
        <>
          <div
          // chrome:free — voile de rejet uniforme : tout point referme.
            className="fixed inset-0 z-[999]"
            onClick={closeContextMenu}
          />
          <div
            className="fixed z-[1000] min-w-[180px] py-1 rounded-xl border border-[var(--color-border)]
              bg-[var(--color-surface)] shadow-lg"
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            <button
              onClick={() => handleExecuteRule(contextMenuRuleId)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-primary-600)]
                text-left hover:bg-[var(--color-primary-50)] transition-colors duration-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {t('automation.contextMenu.execute')}
            </button>
            <button
              onClick={() => handleEditRule(contextMenuRuleId)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-primary)]
                text-left hover:bg-[var(--color-background-secondary)] transition-colors duration-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {t('automation.contextMenu.edit')}
            </button>
            <button
              onClick={() => handleDuplicateRule(contextMenuRuleId)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-primary)]
                text-left hover:bg-[var(--color-background-secondary)] transition-colors duration-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              {t('automation.contextMenu.duplicate')}
            </button>
            <button
              onClick={() => {
                if (contextMenuRule) {
                  handleToggleRule(contextMenuRuleId);
                  closeContextMenu();
                }
              }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-primary)]
                text-left hover:bg-[var(--color-background-secondary)] transition-colors duration-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {contextMenuRule?.enabled ? (
                  <><circle cx="12" cy="12" r="10" /><path d="M4.93 4.93L19.07 19.07" /></>
                ) : (
                  <><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01L9 11.01" /></>
                )}
              </svg>
              {contextMenuRule?.enabled ? t('automation.disable') : t('automation.enable')}
            </button>
            <div className="my-1 border-t border-[var(--color-border)]" />
            <button
              onClick={() => handleDeleteConfirm(contextMenuRuleId)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-600
                text-left hover:bg-red-50 transition-colors duration-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6H5H21M19 6V20a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              {t('automation.contextMenu.delete')}
            </button>
          </div>
        </>
      )}

      {/* ===== Rule Editor Modal ===== */}
      {showEditor && (
        <RuleEditor
          isOpen={showEditor}
          onClose={() => setShowEditor(false)}
        />
      )}

      {/* ===== Templates Modal ===== */}
      <Modal
        isOpen={showTemplates}
        onClose={() => setShowTemplates(false)}
        title={t('automation.templatesModal.title')}
        size="xl"
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            {t('automation.templatesModal.description')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {RULE_TEMPLATES().map((template, index) => {
              const condCount = template.conditions.length;
              const actCount = template.actions.length;
              const triggerLabel = TRIGGER_LABELS()[template.trigger];
              const actionLabels = template.actions.map((a) => ACTION_TYPE_LABELS()[a.type]).join(', ');

              return (
                <div
                  key={index}
                  onClick={() => handleSelectTemplate(template)}
                  className="group flex flex-col gap-2.5 p-4 rounded-xl border cursor-pointer select-none
                    transition-all duration-200
                    bg-[var(--color-surface)] border-[var(--color-border)] shadow-sm
                    hover:shadow-lg hover:border-[var(--color-primary-200)] hover:-translate-y-0.5"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0">{template.icon}</span>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {template.name}
                      </h4>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                        {template.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-blue-50 text-blue-600">
                      {triggerLabel}
                    </span>
                    {condCount > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-purple-50 text-purple-600">
                        {condCount} {t('automation.condShort')}
                      </span>
                    )}
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-green-50 text-green-600">
                      {actCount} {t('automation.actShort')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </ModalBody>
      </Modal>

      {/* ===== Delete Confirmation Modal ===== */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title={t('automation.deleteModal.title')}
        size="sm"
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-primary)]">
            {t('automation.deleteModal.confirm')}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
            {t('automation.deleteModal.irreversible')}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
            {t('automation.deleteModal.cancel')}
          </Button>
          <Button variant="danger" onClick={handleDeleteRule}>
            {t('automation.deleteModal.delete')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ===== Execution Result Modal ===== */}
      <Modal
        isOpen={!!executionResult}
        onClose={() => setExecutionResult(null)}
        title={t('automation.executionResult.title')}
        size="sm"
      >
        {executionResult && (
          <>
            <ModalBody>
              <div className="flex items-center gap-3 mb-4">
                <div className={`flex items-center justify-center w-10 h-10 rounded-full ${
                  executionResult.matchCount > 0
                    ? 'bg-green-50 text-green-600'
                    : 'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]'
                }`}>
                  {executionResult.matchCount > 0 ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                      <path d="M22 4L12 14.01l-3-3" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 12h8" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {executionResult.ruleName}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {t('automation.executionResult.filesProcessed', { matched: executionResult.matchCount, total: executionResult.totalCount })}
                  </p>
                </div>
              </div>

              {executionResult.matchedFiles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
                    {t('automation.executionResult.matchedFiles')}
                  </p>
                  <ul className="max-h-48 overflow-y-auto space-y-1">
                    {executionResult.matchedFiles.map((name, i) => (
                      <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] bg-[var(--color-background-secondary)] rounded-md">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-text-tertiary)]">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <path d="M14 2v6h6" />
                        </svg>
                        <span className="truncate">{name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {executionResult.matchCount === 0 && (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('automation.executionResult.noMatch')}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="primary" onClick={() => setExecutionResult(null)}>
                {t('automation.executionResult.close')}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
};

export default AutomationRulesPanel;
