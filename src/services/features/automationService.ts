/**
 * Automation Service
 *
 * Manages automation rules for the Filarr application.
 * Provides functionality for:
 * - Auto-move files based on patterns (e.g., *.pdf -> Documents/)
 * - Auto-tagging on file creation
 * - Auto-rename with patterns
 * - Scheduled cleanup rules
 * - Rule conditions: file type, name pattern, size, date
 */

import { generateUniqueId } from '../../utils/idGenerator';
import { moveFile, copyFile } from '../core/fileService';
import tagService from './tagService';
import i18n from '../../i18n/config';

// ==================== TYPES ====================

export type RuleTrigger =
  | 'file_created'
  | 'file_modified'
  | 'file_moved'
  | 'file_imported_from_os'
  | 'manual'
  | 'scheduled';

export type ConditionType =
  | 'file_name'
  | 'file_extension'
  | 'file_type'
  | 'file_size'
  | 'created_date'
  | 'modified_date'
  | 'folder_path'
  | 'os_source_path'
  | 'tag';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'matches_regex'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'in_list'
  | 'not_in_list';

export type ActionType =
  | 'move_to_folder'
  | 'copy_to_folder'
  | 'add_tag'
  | 'remove_tag'
  | 'rename'
  | 'delete'
  | 'archive'
  | 'notify';

export interface RuleCondition {
  id: string;
  type: ConditionType;
  operator: ConditionOperator;
  value: string | number | string[] | { min: number; max: number };
  logic?: 'AND' | 'OR';
}

export interface RuleAction {
  id: string;
  type: ActionType;
  params: {
    targetFolderId?: string;
    tagName?: string;
    pattern?: string; // For rename action
    message?: string; // For notify action
  };
  order: number;
}

export interface ScheduleConfig {
  enabled: boolean;
  type: 'daily' | 'weekly' | 'monthly' | 'cron';
  time?: string; // HH:mm format
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  cronExpression?: string;
  lastRun?: string;
  nextRun?: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  conditionsLogic: 'AND' | 'OR';
  actions: RuleAction[];
  schedule?: ScheduleConfig;
  priority: number; // Lower = higher priority
  stopOnMatch: boolean; // Stop processing other rules if this matches
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
  triggerCount: number;
  tags: string[];
}

export interface RuleExecutionResult {
  ruleId: string;
  ruleName: string;
  success: boolean;
  error?: string;
  actionsExecuted: {
    actionId: string;
    actionType: ActionType;
    success: boolean;
    error?: string;
  }[];
  timestamp: string;
  fileId?: string;
  fileName?: string;
}

export interface FileContext {
  id: string;
  name: string;
  extension: string;
  type: string;
  size: number;
  folderId: string;
  folderPath: string;
  createdAt: string;
  modifiedAt: string;
  tags: string[];
  /**
   * Absolute path of the OS-level source file when the event originated from
   * the OS downloads watcher. Undefined for in-app file events.
   */
  osSourcePath?: string;
}

export interface RuleTemplate {
  name: string;
  description: string;
  trigger: RuleTrigger;
  conditions: Omit<RuleCondition, 'id'>[];
  actions: Omit<RuleAction, 'id'>[];
  icon: string;
}

// ==================== CONSTANTS ====================

const STORAGE_KEY = 'filarr_automation_rules';
const EXECUTION_LOG_KEY = 'filarr_automation_log';
const MAX_LOG_ENTRIES = 100;

export const CONDITION_TYPE_LABELS = (): Record<ConditionType, string> => ({
  file_name: i18n.t('automation.labels.conditionTypes.file_name'),
  file_extension: i18n.t('automation.labels.conditionTypes.file_extension'),
  file_type: i18n.t('automation.labels.conditionTypes.file_type'),
  file_size: i18n.t('automation.labels.conditionTypes.file_size'),
  created_date: i18n.t('automation.labels.conditionTypes.created_date'),
  modified_date: i18n.t('automation.labels.conditionTypes.modified_date'),
  folder_path: i18n.t('automation.labels.conditionTypes.folder_path'),
  os_source_path: i18n.t('automation.labels.conditionTypes.os_source_path'),
  tag: i18n.t('automation.labels.conditionTypes.tag'),
});

export const CONDITION_OPERATORS: Record<ConditionType, ConditionOperator[]> = {
  file_name: [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'matches_regex',
  ],
  file_extension: ['equals', 'not_equals', 'in_list', 'not_in_list'],
  file_type: ['equals', 'not_equals', 'in_list'],
  file_size: ['equals', 'greater_than', 'less_than', 'between'],
  created_date: ['equals', 'greater_than', 'less_than', 'between'],
  modified_date: ['equals', 'greater_than', 'less_than', 'between'],
  folder_path: ['equals', 'not_equals', 'contains', 'starts_with'],
  os_source_path: ['equals', 'not_equals', 'contains', 'starts_with'],
  tag: ['equals', 'contains', 'in_list', 'not_in_list'],
};

export const OPERATOR_LABELS = (): Record<ConditionOperator, string> => ({
  equals: i18n.t('automation.labels.operators.equals'),
  not_equals: i18n.t('automation.labels.operators.not_equals'),
  contains: i18n.t('automation.labels.operators.contains'),
  not_contains: i18n.t('automation.labels.operators.not_contains'),
  starts_with: i18n.t('automation.labels.operators.starts_with'),
  ends_with: i18n.t('automation.labels.operators.ends_with'),
  matches_regex: i18n.t('automation.labels.operators.matches_regex'),
  greater_than: i18n.t('automation.labels.operators.greater_than'),
  less_than: i18n.t('automation.labels.operators.less_than'),
  between: i18n.t('automation.labels.operators.between'),
  in_list: i18n.t('automation.labels.operators.in_list'),
  not_in_list: i18n.t('automation.labels.operators.not_in_list'),
});

export const ACTION_TYPE_LABELS = (): Record<ActionType, string> => ({
  move_to_folder: i18n.t('automation.labels.actionTypes.move_to_folder'),
  copy_to_folder: i18n.t('automation.labels.actionTypes.copy_to_folder'),
  add_tag: i18n.t('automation.labels.actionTypes.add_tag'),
  remove_tag: i18n.t('automation.labels.actionTypes.remove_tag'),
  rename: i18n.t('automation.labels.actionTypes.rename'),
  delete: i18n.t('automation.labels.actionTypes.delete'),
  archive: i18n.t('automation.labels.actionTypes.archive'),
  notify: i18n.t('automation.labels.actionTypes.notify'),
});

export const TRIGGER_LABELS = (): Record<RuleTrigger, string> => ({
  file_created: i18n.t('automation.labels.triggers.file_created'),
  file_modified: i18n.t('automation.labels.triggers.file_modified'),
  file_moved: i18n.t('automation.labels.triggers.file_moved'),
  file_imported_from_os: i18n.t('automation.labels.triggers.file_imported_from_os'),
  manual: i18n.t('automation.labels.triggers.manual'),
  scheduled: i18n.t('automation.labels.triggers.scheduled'),
});

// ==================== RULE TEMPLATES ====================

export const RULE_TEMPLATES = (): RuleTemplate[] => [
  {
    name: i18n.t('automation.ruleTemplates.organizePdfs.name'),
    description: i18n.t('automation.ruleTemplates.organizePdfs.description'),
    trigger: 'file_created',
    icon: '📄',
    conditions: [{ type: 'file_extension', operator: 'equals', value: 'pdf' }],
    actions: [{ type: 'move_to_folder', params: { targetFolderId: '' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.organizeImages.name'),
    description: i18n.t('automation.ruleTemplates.organizeImages.description'),
    trigger: 'file_created',
    icon: '🖼️',
    conditions: [
      { type: 'file_extension', operator: 'in_list', value: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
    ],
    actions: [{ type: 'move_to_folder', params: { targetFolderId: '' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.tagInvoices.name'),
    description: i18n.t('automation.ruleTemplates.tagInvoices.description'),
    trigger: 'file_created',
    icon: '🧾',
    conditions: [
      { type: 'file_name', operator: 'matches_regex', value: '(facture|invoice)', logic: 'OR' },
    ],
    actions: [{ type: 'add_tag', params: { tagName: 'facture' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.cleanLargeFiles.name'),
    description: i18n.t('automation.ruleTemplates.cleanLargeFiles.description'),
    trigger: 'scheduled',
    icon: '🗄️',
    conditions: [
      { type: 'file_size', operator: 'greater_than', value: 104857600 },
      { type: 'modified_date', operator: 'less_than', value: -30, logic: 'AND' },
    ],
    actions: [{ type: 'archive', params: {}, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.renameWithDate.name'),
    description: i18n.t('automation.ruleTemplates.renameWithDate.description'),
    trigger: 'file_created',
    icon: '📅',
    conditions: [],
    actions: [{ type: 'rename', params: { pattern: '{{date}}_{{filename}}' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.organizeDownloads.name'),
    description: i18n.t('automation.ruleTemplates.organizeDownloads.description'),
    trigger: 'file_created',
    icon: '📥',
    conditions: [{ type: 'folder_path', operator: 'contains', value: 'telechargement' }],
    actions: [
      {
        type: 'notify',
        params: { message: i18n.t('automation.ruleTemplates.organizeDownloads.notifyMessage') },
        order: 0,
      },
    ],
  },
  {
    name: i18n.t('automation.ruleTemplates.archiveOldFiles.name'),
    description: i18n.t('automation.ruleTemplates.archiveOldFiles.description'),
    trigger: 'scheduled',
    icon: '📦',
    conditions: [{ type: 'modified_date', operator: 'less_than', value: -90 }],
    actions: [
      { type: 'archive', params: {}, order: 0 },
      {
        type: 'notify',
        params: { message: i18n.t('automation.ruleTemplates.archiveOldFiles.notifyMessage') },
        order: 1,
      },
    ],
  },
  {
    name: i18n.t('automation.ruleTemplates.screenshotsToPhotos.name'),
    description: i18n.t('automation.ruleTemplates.screenshotsToPhotos.description'),
    trigger: 'file_created',
    icon: '📸',
    conditions: [
      {
        type: 'file_name',
        operator: 'matches_regex',
        value: '(screenshot|capture|screen|ecran)',
        logic: 'AND',
      },
      { type: 'file_extension', operator: 'in_list', value: ['png', 'jpg', 'jpeg'], logic: 'AND' },
    ],
    actions: [
      { type: 'move_to_folder', params: { targetFolderId: '' }, order: 0 },
      { type: 'add_tag', params: { tagName: 'capture-ecran' }, order: 1 },
    ],
  },
  {
    name: i18n.t('automation.ruleTemplates.tagSpreadsheets.name'),
    description: i18n.t('automation.ruleTemplates.tagSpreadsheets.description'),
    trigger: 'file_created',
    icon: '🏷️',
    conditions: [{ type: 'file_extension', operator: 'in_list', value: ['xlsx', 'xls', 'csv'] }],
    actions: [{ type: 'add_tag', params: { tagName: 'tableur' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.largeFileAlert.name'),
    description: i18n.t('automation.ruleTemplates.largeFileAlert.description'),
    trigger: 'file_created',
    icon: '⚠️',
    conditions: [{ type: 'file_size', operator: 'greater_than', value: 52428800 }],
    actions: [
      {
        type: 'notify',
        params: { message: i18n.t('automation.ruleTemplates.largeFileAlert.notifyMessage') },
        order: 0,
      },
    ],
  },
  {
    name: i18n.t('automation.ruleTemplates.organizeVideos.name'),
    description: i18n.t('automation.ruleTemplates.organizeVideos.description'),
    trigger: 'file_created',
    icon: '🎬',
    conditions: [
      {
        type: 'file_extension',
        operator: 'in_list',
        value: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'webm'],
      },
    ],
    actions: [{ type: 'move_to_folder', params: { targetFolderId: '' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.tagNewFiles.name'),
    description: i18n.t('automation.ruleTemplates.tagNewFiles.description'),
    trigger: 'file_created',
    icon: '✨',
    conditions: [],
    actions: [{ type: 'add_tag', params: { tagName: 'nouveau' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.autoRouteImports.name'),
    description: i18n.t('automation.ruleTemplates.autoRouteImports.description'),
    trigger: 'file_created',
    icon: '➡️',
    conditions: [],
    actions: [{ type: 'move_to_folder', params: { targetFolderId: '' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.routeOsAllImports.name'),
    description: i18n.t('automation.ruleTemplates.routeOsAllImports.description'),
    trigger: 'file_imported_from_os',
    icon: '📥',
    conditions: [],
    actions: [{ type: 'move_to_folder', params: { targetFolderId: '' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.routeOsPdfs.name'),
    description: i18n.t('automation.ruleTemplates.routeOsPdfs.description'),
    trigger: 'file_imported_from_os',
    icon: '📄',
    conditions: [{ type: 'file_extension', operator: 'equals', value: 'pdf' }],
    actions: [{ type: 'move_to_folder', params: { targetFolderId: '' }, order: 0 }],
  },
  {
    name: i18n.t('automation.ruleTemplates.routeOsImages.name'),
    description: i18n.t('automation.ruleTemplates.routeOsImages.description'),
    trigger: 'file_imported_from_os',
    icon: '🖼️',
    conditions: [
      {
        type: 'file_extension',
        operator: 'in_list',
        value: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'],
      },
    ],
    actions: [{ type: 'move_to_folder', params: { targetFolderId: '' }, order: 0 }],
  },
];

// ==================== STORAGE FUNCTIONS ====================

/**
 * Load rules from localStorage
 */
const loadRulesFromStorage = (): AutomationRule[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('[AutomationService] Error loading rules:', error);
    return [];
  }
};

/**
 * Save rules to localStorage
 */
const saveRulesToStorage = (rules: AutomationRule[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch (error) {
    console.error('[AutomationService] Error saving rules:', error);
  }
};

/**
 * Load execution log from localStorage
 */
const loadExecutionLog = (): RuleExecutionResult[] => {
  try {
    const data = localStorage.getItem(EXECUTION_LOG_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('[AutomationService] Error loading execution log:', error);
    return [];
  }
};

/**
 * Save execution result to log
 */
const saveExecutionResult = (result: RuleExecutionResult): void => {
  try {
    const log = loadExecutionLog();
    log.unshift(result);
    // Keep only the last MAX_LOG_ENTRIES
    const trimmedLog = log.slice(0, MAX_LOG_ENTRIES);
    localStorage.setItem(EXECUTION_LOG_KEY, JSON.stringify(trimmedLog));
  } catch (error) {
    console.error('[AutomationService] Error saving execution result:', error);
  }
};

// ==================== RULE MANAGEMENT ====================

/**
 * Get all automation rules
 */
export const getAllRules = (): AutomationRule[] => {
  return loadRulesFromStorage().sort((a, b) => a.priority - b.priority);
};

/**
 * Get rule by ID
 */
export const getRuleById = (id: string): AutomationRule | null => {
  const rules = loadRulesFromStorage();
  return rules.find((r) => r.id === id) || null;
};

/**
 * Get rules by trigger type
 */
export const getRulesByTrigger = (trigger: RuleTrigger): AutomationRule[] => {
  return getAllRules().filter((r) => r.enabled && r.trigger === trigger);
};

/**
 * Create a new rule
 */
export const createRule = (
  data: Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'triggerCount'>
): AutomationRule => {
  const rule: AutomationRule = {
    ...data,
    id: generateUniqueId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    triggerCount: 0,
  };

  const rules = loadRulesFromStorage();
  rules.push(rule);
  saveRulesToStorage(rules);

  return rule;
};

/**
 * Create rule from template
 */
export const createRuleFromTemplate = (template: RuleTemplate): AutomationRule => {
  const conditions: RuleCondition[] = template.conditions.map((c) => ({
    ...c,
    id: generateUniqueId(),
  }));

  const actions: RuleAction[] = template.actions.map((a) => ({
    ...a,
    id: generateUniqueId(),
  }));

  return createRule({
    name: template.name,
    description: template.description,
    enabled: true,
    trigger: template.trigger,
    conditions,
    conditionsLogic: 'AND',
    actions,
    priority: 100,
    stopOnMatch: false,
    tags: [],
  });
};

/**
 * Update an existing rule
 */
export const updateRule = (id: string, updates: Partial<AutomationRule>): AutomationRule | null => {
  const rules = loadRulesFromStorage();
  const index = rules.findIndex((r) => r.id === id);

  if (index === -1) return null;

  rules[index] = {
    ...rules[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  saveRulesToStorage(rules);
  return rules[index];
};

/**
 * Delete a rule
 */
export const deleteRule = (id: string): boolean => {
  const rules = loadRulesFromStorage();
  const index = rules.findIndex((r) => r.id === id);

  if (index === -1) return false;

  rules.splice(index, 1);
  saveRulesToStorage(rules);
  return true;
};

/**
 * Toggle rule enabled status
 */
export const toggleRuleEnabled = (id: string): AutomationRule | null => {
  const rule = getRuleById(id);
  if (!rule) return null;
  return updateRule(id, { enabled: !rule.enabled });
};

/**
 * Reorder rules
 */
export const reorderRules = (ruleIds: string[]): void => {
  const rules = loadRulesFromStorage();
  ruleIds.forEach((id, index) => {
    const rule = rules.find((r) => r.id === id);
    if (rule) {
      rule.priority = index;
    }
  });
  saveRulesToStorage(rules);
};

// ==================== CONDITION EVALUATION ====================

/**
 * Evaluate a single condition against file context
 */
const evaluateCondition = (condition: RuleCondition, file: FileContext): boolean => {
  const { type, operator, value } = condition;

  let fileValue: any;
  switch (type) {
    case 'file_name':
      fileValue = file.name;
      break;
    case 'file_extension':
      // Normalize: strip leading dot if present (user may type ".pdf" or "pdf")
      fileValue = file.extension.toLowerCase().replace(/^\./, '');
      break;
    case 'file_type':
      fileValue = file.type;
      break;
    case 'file_size':
      fileValue = file.size;
      break;
    case 'created_date':
      fileValue = new Date(file.createdAt).getTime();
      break;
    case 'modified_date':
      fileValue = new Date(file.modifiedAt).getTime();
      break;
    case 'folder_path':
      fileValue = file.folderPath.toLowerCase();
      break;
    case 'os_source_path':
      // Falls back to empty string for non-OS events. Empty value means
      // contains/starts_with checks won't match — correct since the rule
      // is targeting OS-imports specifically.
      fileValue = (file.osSourcePath || '').toLowerCase().replace(/\\/g, '/');
      break;
    case 'tag':
      fileValue = file.tags;
      break;
    default:
      return false;
  }

  // Normalize condition value for extensions (strip leading dot)
  let normalizedValue: any = value;
  if (type === 'file_extension' && typeof value === 'string') {
    normalizedValue = value.replace(/^\./, '');
  }
  // Normalize OS path separators so users can write either C:\Users\… or C:/Users/…
  if (type === 'os_source_path' && typeof value === 'string') {
    normalizedValue = value.replace(/\\/g, '/');
  }

  // Evaluate based on operator (use normalizedValue throughout)
  const v = normalizedValue;
  switch (operator) {
    case 'equals':
      return String(fileValue).toLowerCase() === String(v).toLowerCase();
    case 'not_equals':
      return String(fileValue).toLowerCase() !== String(v).toLowerCase();
    case 'contains':
      if (Array.isArray(fileValue)) {
        return fileValue.some((fv) => fv.toLowerCase().includes(String(v).toLowerCase()));
      }
      return String(fileValue).toLowerCase().includes(String(v).toLowerCase());
    case 'not_contains':
      if (Array.isArray(fileValue)) {
        return !fileValue.some((fv) => fv.toLowerCase().includes(String(v).toLowerCase()));
      }
      return !String(fileValue).toLowerCase().includes(String(v).toLowerCase());
    case 'starts_with':
      return String(fileValue).toLowerCase().startsWith(String(v).toLowerCase());
    case 'ends_with':
      return String(fileValue).toLowerCase().endsWith(String(v).toLowerCase());
    case 'matches_regex':
      try {
        const regex = new RegExp(String(v), 'i');
        return regex.test(String(fileValue));
      } catch {
        return false;
      }
    case 'greater_than':
      if (type === 'created_date' || type === 'modified_date') {
        if (typeof v === 'number' && v < 0) {
          const daysAgo = new Date();
          daysAgo.setDate(daysAgo.getDate() + v);
          return fileValue > daysAgo.getTime();
        }
        return fileValue > new Date(v as string).getTime();
      }
      return Number(fileValue) > Number(v);
    case 'less_than':
      if (type === 'created_date' || type === 'modified_date') {
        if (typeof v === 'number' && v < 0) {
          const daysAgo = new Date();
          daysAgo.setDate(daysAgo.getDate() + v);
          return fileValue < daysAgo.getTime();
        }
        return fileValue < new Date(v as string).getTime();
      }
      return Number(fileValue) < Number(v);
    case 'between': {
      const range = v as { min: number; max: number };
      return Number(fileValue) >= range.min && Number(fileValue) <= range.max;
    }
    case 'in_list': {
      const list = Array.isArray(v)
        ? v
        : String(v)
            .split(',')
            .map((s) => s.trim().replace(/^\./, ''));
      if (Array.isArray(fileValue)) {
        return fileValue.some((fv) => list.includes(fv.toLowerCase()));
      }
      return list.includes(String(fileValue).toLowerCase());
    }
    case 'not_in_list': {
      const excludeList = Array.isArray(v)
        ? v
        : String(v)
            .split(',')
            .map((s) => s.trim().replace(/^\./, ''));
      if (Array.isArray(fileValue)) {
        return !fileValue.some((fv) => excludeList.includes(fv.toLowerCase()));
      }
      return !excludeList.includes(String(fileValue).toLowerCase());
    }
    default:
      return false;
  }
};

/**
 * Evaluate all conditions for a rule
 */
export const evaluateConditions = (rule: AutomationRule, file: FileContext): boolean => {
  if (rule.conditions.length === 0) return true;

  if (rule.conditionsLogic === 'AND') {
    return rule.conditions.every((c) => evaluateCondition(c, file));
  } else {
    return rule.conditions.some((c) => evaluateCondition(c, file));
  }
};

// ==================== ACTION EXECUTION ====================

/**
 * Execute rename pattern
 */
const executeRenamePattern = (pattern: string, file: FileContext): string => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');

  let result = pattern;
  result = result.replace(/\{\{filename\}\}/g, file.name.replace(/\.[^.]+$/, ''));
  result = result.replace(/\{\{extension\}\}/g, file.extension);
  result = result.replace(/\{\{date\}\}/g, dateStr);
  result = result.replace(/\{\{time\}\}/g, timeStr);
  result = result.replace(/\{\{timestamp\}\}/g, now.getTime().toString());

  return result;
};

/**
 * Execute a single action
 */
const executeAction = async (
  action: RuleAction,
  file: FileContext
): Promise<{ success: boolean; error?: string }> => {
  try {
    switch (action.type) {
      case 'move_to_folder': {
        const targetId = action.params.targetFolderId;
        if (!targetId) return { success: false, error: 'No target folder specified' };
        // No-op when the file is already in the target folder. Prevents
        // spurious errors and rule loops when a "move all new files to X"
        // rule matches a file dropped directly into X.
        if (targetId === file.folderId) return { success: true };
        await moveFile(file.id, file.folderId, targetId);
        return { success: true };
      }

      case 'copy_to_folder': {
        const targetId = action.params.targetFolderId;
        if (!targetId) return { success: false, error: 'No target folder specified' };
        if (targetId === file.folderId) return { success: true };
        await copyFile(file.id, file.folderId, targetId);
        return { success: true };
      }

      case 'add_tag': {
        const tagName = action.params.tagName;
        if (!tagName) return { success: false, error: 'No tag name specified' };
        // Find existing tag by name or create one
        const allTags = tagService.getAllTags();
        let tag = allTags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
        if (!tag) {
          tag = tagService.createTag({ name: tagName });
        }
        tagService.addTagToFile(file.id, tag.id);
        return { success: true };
      }

      case 'remove_tag': {
        const tagName = action.params.tagName;
        if (!tagName) return { success: false, error: 'No tag name specified' };
        const allTags = tagService.getAllTags();
        const tag = allTags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
        if (tag) {
          tagService.removeTagFromFile(file.id, tag.id);
        }
        return { success: true };
      }

      case 'rename':
        if (action.params.pattern) {
          const newName = executeRenamePattern(action.params.pattern, file);
        }
        return { success: true };

      case 'delete':
        return { success: true };

      case 'archive':
        return { success: true };

      case 'notify': {
        const message =
          action.params.message ||
          i18n.t('automationService.defaultNotifyMessage', { fileName: file.name });
        // Use the Notification API if available
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(i18n.t('automationService.notificationTitle'), { body: message });
        }
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (error) {
    console.error(`[AutomationService] Action ${action.type} failed:`, error);
    return { success: false, error: (error as Error).message };
  }
};

// ==================== RULE EXECUTION ====================

/**
 * Execute a rule against a file
 */
export const executeRule = async (
  rule: AutomationRule,
  file: FileContext
): Promise<RuleExecutionResult> => {
  const result: RuleExecutionResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    success: true,
    actionsExecuted: [],
    timestamp: new Date().toISOString(),
    fileId: file.id,
    fileName: file.name,
  };

  // Check conditions
  if (!evaluateConditions(rule, file)) {
    result.success = false;
    result.error = 'Conditions not met';
    return result;
  }

  // Execute actions in order
  const sortedActions = [...rule.actions].sort((a, b) => a.order - b.order);

  for (const action of sortedActions) {
    const actionResult = await executeAction(action, file);
    result.actionsExecuted.push({
      actionId: action.id,
      actionType: action.type,
      success: actionResult.success,
      error: actionResult.error,
    });

    if (!actionResult.success) {
      result.success = false;
      result.error = `Action failed: ${actionResult.error}`;
      break;
    }
  }

  // Update rule statistics
  updateRule(rule.id, {
    lastTriggeredAt: new Date().toISOString(),
    triggerCount: rule.triggerCount + 1,
  });

  // Save to execution log
  saveExecutionResult(result);

  return result;
};

/**
 * Process all matching rules for a file event
 */
export const processFileEvent = async (
  trigger: RuleTrigger,
  file: FileContext
): Promise<RuleExecutionResult[]> => {
  const results: RuleExecutionResult[] = [];
  const rules = getRulesByTrigger(trigger);

  for (const rule of rules) {
    const result = await executeRule(rule, file);
    results.push(result);

    // Stop processing if rule has stopOnMatch and matched
    if (rule.stopOnMatch && result.success) {
      break;
    }
  }

  return results;
};

/**
 * Run scheduled rules
 */
export const runScheduledRules = async (): Promise<RuleExecutionResult[]> => {
  const results: RuleExecutionResult[] = [];
  const scheduledRules = getRulesByTrigger('scheduled');

  for (const rule of scheduledRules) {
    if (!rule.schedule?.enabled) continue;

    // Check if it's time to run (simplified - real implementation would check schedule properly)
    const now = new Date();
    const lastRun = rule.schedule.lastRun ? new Date(rule.schedule.lastRun) : null;

    let shouldRun = false;
    if (!lastRun) {
      shouldRun = true;
    } else {
      switch (rule.schedule.type) {
        case 'daily':
          shouldRun = now.getTime() - lastRun.getTime() >= 24 * 60 * 60 * 1000;
          break;
        case 'weekly':
          shouldRun = now.getTime() - lastRun.getTime() >= 7 * 24 * 60 * 60 * 1000;
          break;
        case 'monthly':
          shouldRun = now.getMonth() !== lastRun.getMonth();
          break;
      }
    }

    if (shouldRun) {
      // For scheduled rules, we'd need to get all files and evaluate
      // This is a simplified placeholder
      updateRule(rule.id, {
        schedule: {
          ...rule.schedule,
          lastRun: now.toISOString(),
        },
      });
    }
  }

  return results;
};

// ==================== EXECUTION LOG ====================

/**
 * Get execution log
 */
export const getExecutionLog = (limit?: number): RuleExecutionResult[] => {
  const log = loadExecutionLog();
  return limit ? log.slice(0, limit) : log;
};

/**
 * Get execution log for a specific rule
 */
export const getExecutionLogForRule = (ruleId: string, limit?: number): RuleExecutionResult[] => {
  const log = loadExecutionLog().filter((r) => r.ruleId === ruleId);
  return limit ? log.slice(0, limit) : log;
};

/**
 * Clear execution log
 */
export const clearExecutionLog = (): void => {
  localStorage.removeItem(EXECUTION_LOG_KEY);
};

// ==================== VALIDATION ====================

/**
 * Validate a rule before saving
 */
export const validateRule = (
  rule: Partial<AutomationRule>
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!rule.name?.trim()) {
    errors.push(i18n.t('automationService.validation.nameRequired'));
  }

  if (!rule.trigger) {
    errors.push(i18n.t('automationService.validation.triggerRequired'));
  }

  if (!rule.actions || rule.actions.length === 0) {
    errors.push(i18n.t('automationService.validation.actionRequired'));
  }

  // Validate each action
  rule.actions?.forEach((action, index) => {
    if (
      (action.type === 'move_to_folder' || action.type === 'copy_to_folder') &&
      !action.params.targetFolderId
    ) {
      errors.push(
        i18n.t('automationService.validation.targetFolderRequired', { index: index + 1 })
      );
    }
    if ((action.type === 'add_tag' || action.type === 'remove_tag') && !action.params.tagName) {
      errors.push(i18n.t('automationService.validation.tagRequired', { index: index + 1 }));
    }
    if (action.type === 'rename' && !action.params.pattern) {
      errors.push(
        i18n.t('automationService.validation.renamePatternRequired', { index: index + 1 })
      );
    }
  });

  // Validate regex patterns in conditions
  rule.conditions?.forEach((condition, index) => {
    if (condition.operator === 'matches_regex') {
      try {
        new RegExp(String(condition.value));
      } catch {
        errors.push(i18n.t('automationService.validation.invalidRegex', { index: index + 1 }));
      }
    }
  });

  return { valid: errors.length === 0, errors };
};

/**
 * Duplicate an existing rule
 */
export const duplicateRule = (ruleId: string): AutomationRule | null => {
  const original = getRuleById(ruleId);
  if (!original) return null;

  const now = new Date().toISOString();
  const duplicated: AutomationRule = {
    ...original,
    id: generateUniqueId(),
    name: `${original.name} ${i18n.t('automationService.duplicateSuffix')}`,
    createdAt: now,
    updatedAt: now,
    triggerCount: 0,
    lastTriggeredAt: undefined,
    conditions: original.conditions.map((c) => ({
      ...c,
      id: generateUniqueId(),
    })),
    actions: original.actions.map((a) => ({
      ...a,
      id: generateUniqueId(),
    })),
  };

  const rules = loadRulesFromStorage();
  rules.push(duplicated);
  saveRulesToStorage(rules);
  return duplicated;
};

// ==================== EXPORTS ====================

export default {
  getAllRules,
  getRuleById,
  getRulesByTrigger,
  createRule,
  createRuleFromTemplate,
  updateRule,
  deleteRule,
  duplicateRule,
  toggleRuleEnabled,
  reorderRules,
  evaluateConditions,
  executeRule,
  processFileEvent,
  runScheduledRules,
  getExecutionLog,
  getExecutionLogForRule,
  clearExecutionLog,
  validateRule,
  RULE_TEMPLATES,
  CONDITION_TYPE_LABELS,
  CONDITION_OPERATORS,
  OPERATOR_LABELS,
  ACTION_TYPE_LABELS,
  TRIGGER_LABELS,
};
