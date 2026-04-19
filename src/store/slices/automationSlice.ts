/**
 * Redux Slice pour les Regles d'Automatisation
 *
 * Gere l'etat des regles d'automatisation dans l'application,
 * incluant la creation, modification et execution des regles.
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import automationService, {
  AutomationRule,
  RuleCondition,
  RuleAction,
  RuleTrigger,
  RuleExecutionResult,
  FileContext,
  RuleTemplate,
  RULE_TEMPLATES,
} from '../../services/features/automationService';

// ==================== TYPES ====================

export interface AutomationState {
  rules: AutomationRule[];
  selectedRuleId: string | null;
  editingRule: Partial<AutomationRule> | null;
  executionLog: RuleExecutionResult[];
  templates: RuleTemplate[];
  loading: boolean;
  error: string | null;
  validationErrors: string[];
  isProcessing: boolean;
  lastProcessedFile: string | null;
}

interface SerializedError {
  message: string;
}

// ==================== INITIAL STATE ====================

const initialState: AutomationState = {
  rules: [],
  selectedRuleId: null,
  editingRule: null,
  executionLog: [],
  templates: RULE_TEMPLATES(),
  loading: false,
  error: null,
  validationErrors: [],
  isProcessing: false,
  lastProcessedFile: null,
};

// ==================== ASYNC THUNKS ====================

/**
 * Load all automation rules
 */
export const loadRules = createAsyncThunk<
  AutomationRule[],
  void,
  { rejectValue: SerializedError }
>(
  'automation/loadRules',
  async (_, { rejectWithValue }) => {
    try {
      return automationService.getAllRules();
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Create a new rule
 */
export const createRule = createAsyncThunk<
  AutomationRule,
  Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'triggerCount'>,
  { rejectValue: SerializedError }
>(
  'automation/createRule',
  async (data, { rejectWithValue }) => {
    try {
      // Validate before creating
      const validation = automationService.validateRule(data);
      if (!validation.valid) {
        throw new Error(validation.errors.join(', '));
      }
      return automationService.createRule(data);
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Create rule from template
 */
export const createRuleFromTemplate = createAsyncThunk<
  AutomationRule,
  RuleTemplate,
  { rejectValue: SerializedError }
>(
  'automation/createRuleFromTemplate',
  async (template, { rejectWithValue }) => {
    try {
      return automationService.createRuleFromTemplate(template);
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Update an existing rule
 */
export const updateRule = createAsyncThunk<
  AutomationRule | null,
  { id: string; updates: Partial<AutomationRule> },
  { rejectValue: SerializedError }
>(
  'automation/updateRule',
  async ({ id, updates }, { rejectWithValue }) => {
    try {
      // Validate updates
      const currentRule = automationService.getRuleById(id);
      if (!currentRule) {
        throw new Error('Regle non trouvee');
      }

      const mergedRule = { ...currentRule, ...updates };
      const validation = automationService.validateRule(mergedRule);
      if (!validation.valid) {
        throw new Error(validation.errors.join(', '));
      }

      return automationService.updateRule(id, updates);
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Delete a rule
 */
export const deleteRule = createAsyncThunk<
  string,
  string,
  { rejectValue: SerializedError }
>(
  'automation/deleteRule',
  async (id, { rejectWithValue }) => {
    try {
      const success = automationService.deleteRule(id);
      if (!success) {
        throw new Error('Impossible de supprimer la regle');
      }
      return id;
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Toggle rule enabled status
 */
export const toggleRuleEnabled = createAsyncThunk<
  AutomationRule | null,
  string,
  { rejectValue: SerializedError }
>(
  'automation/toggleRuleEnabled',
  async (id, { rejectWithValue }) => {
    try {
      return automationService.toggleRuleEnabled(id);
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Reorder rules
 */
export const reorderRules = createAsyncThunk<
  AutomationRule[],
  string[],
  { rejectValue: SerializedError }
>(
  'automation/reorderRules',
  async (ruleIds, { rejectWithValue }) => {
    try {
      automationService.reorderRules(ruleIds);
      return automationService.getAllRules();
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Execute a rule manually
 */
export const executeRule = createAsyncThunk<
  RuleExecutionResult,
  { ruleId: string; file: FileContext },
  { rejectValue: SerializedError }
>(
  'automation/executeRule',
  async ({ ruleId, file }, { rejectWithValue }) => {
    try {
      const rule = automationService.getRuleById(ruleId);
      if (!rule) {
        throw new Error('Regle non trouvee');
      }
      return await automationService.executeRule(rule, file);
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Process file event (trigger matching rules)
 */
export const processFileEvent = createAsyncThunk<
  RuleExecutionResult[],
  { trigger: RuleTrigger; file: FileContext },
  { rejectValue: SerializedError }
>(
  'automation/processFileEvent',
  async ({ trigger, file }, { rejectWithValue }) => {
    try {
      return await automationService.processFileEvent(trigger, file);
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Run scheduled rules
 */
export const runScheduledRules = createAsyncThunk<
  RuleExecutionResult[],
  void,
  { rejectValue: SerializedError }
>(
  'automation/runScheduledRules',
  async (_, { rejectWithValue }) => {
    try {
      return await automationService.runScheduledRules();
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Load execution log
 */
export const loadExecutionLog = createAsyncThunk<
  RuleExecutionResult[],
  number | undefined,
  { rejectValue: SerializedError }
>(
  'automation/loadExecutionLog',
  async (limit, { rejectWithValue }) => {
    try {
      return automationService.getExecutionLog(limit);
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Duplicate a rule
 */
export const duplicateRule = createAsyncThunk<
  AutomationRule,
  string,
  { rejectValue: SerializedError }
>(
  'automation/duplicateRule',
  async (ruleId, { rejectWithValue }) => {
    try {
      const duplicate = automationService.duplicateRule(ruleId);
      if (!duplicate) {
        throw new Error('Regle non trouvee');
      }
      return duplicate;
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

/**
 * Clear execution log
 */
export const clearExecutionLog = createAsyncThunk<
  void,
  void,
  { rejectValue: SerializedError }
>(
  'automation/clearExecutionLog',
  async (_, { rejectWithValue }) => {
    try {
      automationService.clearExecutionLog();
      return;
    } catch (error) {
      return rejectWithValue({ message: (error as Error).message });
    }
  }
);

// ==================== SLICE ====================

const automationSlice = createSlice({
  name: 'automation',
  initialState,
  reducers: {
    /**
     * Select a rule
     */
    selectRule(state, action: PayloadAction<string | null>) {
      state.selectedRuleId = action.payload;
      state.validationErrors = [];
    },

    /**
     * Start editing a rule
     */
    startEditingRule(state, action: PayloadAction<string | null>) {
      if (action.payload) {
        const rule = state.rules.find(r => r.id === action.payload);
        if (rule) {
          state.editingRule = { ...rule };
        }
      } else {
        // New rule
        state.editingRule = {
          name: '',
          description: '',
          enabled: true,
          trigger: 'file_created',
          conditions: [],
          conditionsLogic: 'AND',
          actions: [],
          priority: 100,
          stopOnMatch: false,
          tags: [],
        };
      }
      state.validationErrors = [];
    },

    /**
     * Update editing rule
     */
    updateEditingRule(state, action: PayloadAction<Partial<AutomationRule>>) {
      if (state.editingRule) {
        state.editingRule = { ...state.editingRule, ...action.payload };
      }
    },

    /**
     * Add condition to editing rule
     */
    addCondition(state, action: PayloadAction<Omit<RuleCondition, 'id'>>) {
      if (state.editingRule) {
        const condition: RuleCondition = {
          ...action.payload,
          id: `cond-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        };
        state.editingRule.conditions = [...(state.editingRule.conditions || []), condition];
      }
    },

    /**
     * Update condition in editing rule
     */
    updateCondition(state, action: PayloadAction<{ id: string; updates: Partial<RuleCondition> }>) {
      if (state.editingRule?.conditions) {
        state.editingRule.conditions = state.editingRule.conditions.map(c =>
          c.id === action.payload.id ? { ...c, ...action.payload.updates } : c
        );
      }
    },

    /**
     * Remove condition from editing rule
     */
    removeCondition(state, action: PayloadAction<string>) {
      if (state.editingRule?.conditions) {
        state.editingRule.conditions = state.editingRule.conditions.filter(c => c.id !== action.payload);
      }
    },

    /**
     * Add action to editing rule
     */
    addAction(state, action: PayloadAction<Omit<RuleAction, 'id' | 'order'>>) {
      if (state.editingRule) {
        const existingActions = state.editingRule.actions || [];
        const newAction: RuleAction = {
          ...action.payload,
          id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          order: existingActions.length,
        };
        state.editingRule.actions = [...existingActions, newAction];
      }
    },

    /**
     * Update action in editing rule
     */
    updateAction(state, action: PayloadAction<{ id: string; updates: Partial<RuleAction> }>) {
      if (state.editingRule?.actions) {
        state.editingRule.actions = state.editingRule.actions.map(a =>
          a.id === action.payload.id ? { ...a, ...action.payload.updates } : a
        );
      }
    },

    /**
     * Remove action from editing rule
     */
    removeAction(state, action: PayloadAction<string>) {
      if (state.editingRule?.actions) {
        state.editingRule.actions = state.editingRule.actions.filter(a => a.id !== action.payload);
        // Re-order remaining actions
        state.editingRule.actions = state.editingRule.actions.map((a, index) => ({
          ...a,
          order: index,
        }));
      }
    },

    /**
     * Reorder actions in editing rule
     */
    reorderActions(state, action: PayloadAction<string[]>) {
      if (state.editingRule?.actions) {
        const actionIds = action.payload;
        const reorderedActions = actionIds
          .map((id, index) => {
            const act = state.editingRule?.actions?.find(a => a.id === id);
            return act ? { ...act, order: index } : null;
          })
          .filter((a): a is RuleAction => a !== null);
        state.editingRule.actions = reorderedActions;
      }
    },

    /**
     * Cancel editing
     */
    cancelEditing(state) {
      state.editingRule = null;
      state.validationErrors = [];
    },

    /**
     * Validate editing rule
     */
    validateEditingRule(state) {
      if (state.editingRule) {
        const validation = automationService.validateRule(state.editingRule);
        state.validationErrors = validation.errors;
      }
    },

    /**
     * Clear errors
     */
    clearErrors(state) {
      state.error = null;
      state.validationErrors = [];
    },

    /**
     * Add execution result to log
     */
    addExecutionResult(state, action: PayloadAction<RuleExecutionResult>) {
      state.executionLog.unshift(action.payload);
      // Keep only the last 100 entries in memory
      if (state.executionLog.length > 100) {
        state.executionLog = state.executionLog.slice(0, 100);
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // Load rules
      .addCase(loadRules.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadRules.fulfilled, (state, action) => {
        state.loading = false;
        state.rules = action.payload;
      })
      .addCase(loadRules.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Erreur lors du chargement des regles';
      })

      // Create rule
      .addCase(createRule.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createRule.fulfilled, (state, action) => {
        state.loading = false;
        state.rules.push(action.payload);
        state.editingRule = null;
        state.selectedRuleId = action.payload.id;
      })
      .addCase(createRule.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Erreur lors de la creation de la regle';
      })

      // Create rule from template
      .addCase(createRuleFromTemplate.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createRuleFromTemplate.fulfilled, (state, action) => {
        state.loading = false;
        state.rules.push(action.payload);
        state.selectedRuleId = action.payload.id;
      })
      .addCase(createRuleFromTemplate.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Erreur lors de la creation de la regle';
      })

      // Update rule
      .addCase(updateRule.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateRule.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload) {
          const index = state.rules.findIndex(r => r.id === action.payload!.id);
          if (index !== -1) {
            state.rules[index] = action.payload;
          }
        }
        state.editingRule = null;
      })
      .addCase(updateRule.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Erreur lors de la mise a jour de la regle';
      })

      // Delete rule
      .addCase(deleteRule.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteRule.fulfilled, (state, action) => {
        state.loading = false;
        state.rules = state.rules.filter(r => r.id !== action.payload);
        if (state.selectedRuleId === action.payload) {
          state.selectedRuleId = null;
        }
      })
      .addCase(deleteRule.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Erreur lors de la suppression de la regle';
      })

      // Duplicate rule
      .addCase(duplicateRule.fulfilled, (state, action) => {
        state.rules.push(action.payload);
        state.selectedRuleId = action.payload.id;
      })
      .addCase(duplicateRule.rejected, (state, action) => {
        state.error = action.payload?.message || 'Erreur lors de la duplication de la regle';
      })

      // Toggle rule enabled
      .addCase(toggleRuleEnabled.fulfilled, (state, action) => {
        if (action.payload) {
          const index = state.rules.findIndex(r => r.id === action.payload!.id);
          if (index !== -1) {
            state.rules[index] = action.payload;
          }
        }
      })

      // Reorder rules
      .addCase(reorderRules.fulfilled, (state, action) => {
        state.rules = action.payload;
      })

      // Execute rule
      .addCase(executeRule.pending, (state) => {
        state.isProcessing = true;
      })
      .addCase(executeRule.fulfilled, (state, action) => {
        state.isProcessing = false;
        state.executionLog.unshift(action.payload);
        state.lastProcessedFile = action.payload.fileName || null;
      })
      .addCase(executeRule.rejected, (state, action) => {
        state.isProcessing = false;
        state.error = action.payload?.message || 'Erreur lors de l\'execution de la regle';
      })

      // Process file event
      .addCase(processFileEvent.pending, (state) => {
        state.isProcessing = true;
      })
      .addCase(processFileEvent.fulfilled, (state, action) => {
        state.isProcessing = false;
        action.payload.forEach(result => {
          state.executionLog.unshift(result);
        });
        if (action.payload.length > 0) {
          state.lastProcessedFile = action.payload[0].fileName || null;
        }
      })
      .addCase(processFileEvent.rejected, (state, action) => {
        state.isProcessing = false;
        state.error = action.payload?.message || 'Erreur lors du traitement de l\'evenement';
      })

      // Load execution log
      .addCase(loadExecutionLog.fulfilled, (state, action) => {
        state.executionLog = action.payload;
      })

      // Clear execution log
      .addCase(clearExecutionLog.fulfilled, (state) => {
        state.executionLog = [];
      });
  },
});

// ==================== EXPORTS ====================

export const {
  selectRule,
  startEditingRule,
  updateEditingRule,
  addCondition,
  updateCondition,
  removeCondition,
  addAction,
  updateAction,
  removeAction,
  reorderActions,
  cancelEditing,
  validateEditingRule,
  clearErrors,
  addExecutionResult,
} = automationSlice.actions;

export default automationSlice.reducer;
