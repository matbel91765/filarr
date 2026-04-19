/**
 * Redux Slice pour le Pomodoro / Focus Timer
 *
 * Gere un minuteur Pomodoro classique (focus / pause courte / pause longue)
 * avec historique journalier, preferences et etat de widget.
 *
 * Le temps ecoule n'est PAS stocke par tick (trop de renders Redux), mais
 * recalcule a la volee depuis startedAt + elapsedBeforePause. Le slice
 * n'avance qu'aux transitions (start/pause/resume/complete/reset).
 */

import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import profileStorage from '../../services/core/profileStorage';

// ==================== TYPES ====================

export type PomodoroMode = 'focus' | 'shortBreak' | 'longBreak';
export type PomodoroStatus = 'idle' | 'running' | 'paused';
export type WidgetPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface PomodoroSettings {
  focusDuration: number; // minutes
  shortBreakDuration: number; // minutes
  longBreakDuration: number; // minutes
  longBreakInterval: number; // nb focus sessions before long break
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
}

export interface PomodoroHistoryEntry {
  date: string; // YYYY-MM-DD
  focusCount: number;
  totalFocusMinutes: number;
}

export interface PomodoroState {
  mode: PomodoroMode;
  status: PomodoroStatus;
  startedAt: number | null; // epoch ms when current run started
  pausedAt: number | null; // epoch ms when paused
  elapsedBeforePause: number; // ms accumulated before current pause
  currentCycleFocusCount: number; // focus sessions in current long-break cycle
  completedFocusToday: number;
  history: PomodoroHistoryEntry[];
  settings: PomodoroSettings;
  linkedNoteId: string | null;
  linkedNoteLabel: string | null;
  widgetVisible: boolean;
  widgetMinimized: boolean;
  widgetPosition: WidgetPosition;
}

// ==================== CONSTANTS ====================

const STORAGE_KEY = 'filarr_pomodoro';
const HISTORY_MAX_DAYS = 90;

const DEFAULT_SETTINGS: PomodoroSettings = {
  focusDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  longBreakInterval: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  notificationsEnabled: true,
  soundEnabled: true,
};

// ==================== PERSISTENCE ====================

interface PersistedPomodoro {
  currentCycleFocusCount: number;
  completedFocusToday: number;
  history: PomodoroHistoryEntry[];
  settings: PomodoroSettings;
  linkedNoteId: string | null;
  linkedNoteLabel: string | null;
  widgetVisible: boolean;
  widgetMinimized: boolean;
  widgetPosition: WidgetPosition;
  lastActiveDate: string;
}

const todayKey = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const loadFromStorage = (): Partial<PomodoroState> => {
  try {
    const raw = profileStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: Partial<PersistedPomodoro> = JSON.parse(raw);
    const today = todayKey();
    const lastActive = parsed.lastActiveDate || today;
    return {
      currentCycleFocusCount: parsed.currentCycleFocusCount ?? 0,
      completedFocusToday: lastActive === today ? (parsed.completedFocusToday ?? 0) : 0,
      history: (parsed.history ?? []).slice(-HISTORY_MAX_DAYS),
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      linkedNoteId: parsed.linkedNoteId ?? null,
      linkedNoteLabel: parsed.linkedNoteLabel ?? null,
      widgetVisible: parsed.widgetVisible ?? false,
      widgetMinimized: parsed.widgetMinimized ?? false,
      widgetPosition: parsed.widgetPosition ?? 'bottom-right',
    };
  } catch (error) {
    console.error('Failed to load pomodoro state:', error);
    return {};
  }
};

const saveToStorage = (state: PomodoroState): void => {
  try {
    const payload: PersistedPomodoro = {
      currentCycleFocusCount: state.currentCycleFocusCount,
      completedFocusToday: state.completedFocusToday,
      history: state.history,
      settings: state.settings,
      linkedNoteId: state.linkedNoteId,
      linkedNoteLabel: state.linkedNoteLabel,
      widgetVisible: state.widgetVisible,
      widgetMinimized: state.widgetMinimized,
      widgetPosition: state.widgetPosition,
      lastActiveDate: todayKey(),
    };
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to save pomodoro state:', error);
  }
};

// ==================== INITIAL STATE ====================

const persisted = loadFromStorage();

const initialState: PomodoroState = {
  mode: 'focus',
  status: 'idle',
  startedAt: null,
  pausedAt: null,
  elapsedBeforePause: 0,
  currentCycleFocusCount: persisted.currentCycleFocusCount ?? 0,
  completedFocusToday: persisted.completedFocusToday ?? 0,
  history: persisted.history ?? [],
  settings: persisted.settings ?? DEFAULT_SETTINGS,
  linkedNoteId: persisted.linkedNoteId ?? null,
  linkedNoteLabel: persisted.linkedNoteLabel ?? null,
  widgetVisible: persisted.widgetVisible ?? false,
  widgetMinimized: persisted.widgetMinimized ?? false,
  widgetPosition: persisted.widgetPosition ?? 'bottom-right',
};

// ==================== HELPERS ====================

const durationMsForMode = (mode: PomodoroMode, settings: PomodoroSettings): number => {
  switch (mode) {
    case 'focus':
      return settings.focusDuration * 60_000;
    case 'shortBreak':
      return settings.shortBreakDuration * 60_000;
    case 'longBreak':
      return settings.longBreakDuration * 60_000;
  }
};

const recordFocusCompletion = (state: PomodoroState, minutes: number): void => {
  const today = todayKey();
  state.completedFocusToday += 1;
  state.currentCycleFocusCount += 1;

  const existing = state.history.find((h) => h.date === today);
  if (existing) {
    existing.focusCount += 1;
    existing.totalFocusMinutes += minutes;
  } else {
    state.history.push({ date: today, focusCount: 1, totalFocusMinutes: minutes });
    if (state.history.length > HISTORY_MAX_DAYS) {
      state.history = state.history.slice(-HISTORY_MAX_DAYS);
    }
  }
};

// ==================== SLICE ====================

const pomodoroSlice = createSlice({
  name: 'pomodoro',
  initialState,
  reducers: {
    startTimer(state, action: PayloadAction<{ mode?: PomodoroMode } | undefined>) {
      const nextMode = action.payload?.mode ?? state.mode;
      state.mode = nextMode;
      state.status = 'running';
      state.startedAt = Date.now();
      state.pausedAt = null;
      state.elapsedBeforePause = 0;
      saveToStorage(state);
    },

    pauseTimer(state) {
      if (state.status !== 'running') return;
      state.status = 'paused';
      state.pausedAt = Date.now();
      if (state.startedAt !== null) {
        state.elapsedBeforePause += state.pausedAt - state.startedAt;
      }
      state.startedAt = null;
    },

    resumeTimer(state) {
      if (state.status !== 'paused') return;
      state.status = 'running';
      state.startedAt = Date.now();
      state.pausedAt = null;
    },

    resetTimer(state) {
      state.status = 'idle';
      state.startedAt = null;
      state.pausedAt = null;
      state.elapsedBeforePause = 0;
    },

    /**
     * Called when the current period finishes naturally (timer reached 0).
     * Advances to the next mode according to the long-break schedule.
     */
    completeSession(state) {
      if (state.mode === 'focus') {
        recordFocusCompletion(state, state.settings.focusDuration);
        const nextMode: PomodoroMode =
          state.currentCycleFocusCount >= state.settings.longBreakInterval
            ? 'longBreak'
            : 'shortBreak';
        if (nextMode === 'longBreak') state.currentCycleFocusCount = 0;
        state.mode = nextMode;
        state.status = state.settings.autoStartBreaks ? 'running' : 'idle';
      } else {
        state.mode = 'focus';
        state.status = state.settings.autoStartFocus ? 'running' : 'idle';
      }
      state.startedAt = state.status === 'running' ? Date.now() : null;
      state.pausedAt = null;
      state.elapsedBeforePause = 0;
      saveToStorage(state);
    },

    /**
     * Skip the current period without recording completion.
     */
    skipSession(state) {
      if (state.mode === 'focus') {
        const nextMode: PomodoroMode =
          state.currentCycleFocusCount >= state.settings.longBreakInterval
            ? 'longBreak'
            : 'shortBreak';
        if (nextMode === 'longBreak') state.currentCycleFocusCount = 0;
        state.mode = nextMode;
      } else {
        state.mode = 'focus';
      }
      state.status = 'idle';
      state.startedAt = null;
      state.pausedAt = null;
      state.elapsedBeforePause = 0;
      saveToStorage(state);
    },

    setMode(state, action: PayloadAction<PomodoroMode>) {
      state.mode = action.payload;
      state.status = 'idle';
      state.startedAt = null;
      state.pausedAt = null;
      state.elapsedBeforePause = 0;
    },

    updateSettings(state, action: PayloadAction<Partial<PomodoroSettings>>) {
      state.settings = { ...state.settings, ...action.payload };
      saveToStorage(state);
    },

    linkNote(state, action: PayloadAction<{ id: string; label: string } | null>) {
      if (action.payload) {
        state.linkedNoteId = action.payload.id;
        state.linkedNoteLabel = action.payload.label;
      } else {
        state.linkedNoteId = null;
        state.linkedNoteLabel = null;
      }
      saveToStorage(state);
    },

    showWidget(state) {
      state.widgetVisible = true;
      state.widgetMinimized = false;
      saveToStorage(state);
    },

    hideWidget(state) {
      state.widgetVisible = false;
      saveToStorage(state);
    },

    toggleWidgetMinimized(state) {
      state.widgetMinimized = !state.widgetMinimized;
      saveToStorage(state);
    },

    setWidgetPosition(state, action: PayloadAction<WidgetPosition>) {
      state.widgetPosition = action.payload;
      saveToStorage(state);
    },

    /**
     * Reset the daily counter when the date rolls over without a running timer.
     */
    rolloverDay(state) {
      state.completedFocusToday = 0;
      saveToStorage(state);
    },

    resetAllStats(state) {
      state.completedFocusToday = 0;
      state.currentCycleFocusCount = 0;
      state.history = [];
      saveToStorage(state);
    },
  },
});

// ==================== SELECTORS ====================

export const selectPomodoro = (state: { pomodoro: PomodoroState }) => state.pomodoro;

export const selectPomodoroDurationMs = createSelector(
  (state: { pomodoro: PomodoroState }) => state.pomodoro.mode,
  (state: { pomodoro: PomodoroState }) => state.pomodoro.settings,
  (mode, settings) => durationMsForMode(mode, settings)
);

export const selectTodayFocusMinutes = createSelector(
  (state: { pomodoro: PomodoroState }) => state.pomodoro.history,
  (history) => {
    const today = todayKey();
    return history.find((h) => h.date === today)?.totalFocusMinutes ?? 0;
  }
);

// ==================== ACTIONS EXPORT ====================

export const {
  startTimer,
  pauseTimer,
  resumeTimer,
  resetTimer,
  completeSession,
  skipSession,
  setMode,
  updateSettings,
  linkNote,
  showWidget,
  hideWidget,
  toggleWidgetMinimized,
  setWidgetPosition,
  rolloverDay,
  resetAllStats,
} = pomodoroSlice.actions;

export default pomodoroSlice.reducer;

// ==================== UTILS (export for component) ====================

export const computeRemainingMs = (state: PomodoroState): number => {
  const total = durationMsForMode(state.mode, state.settings);
  if (state.status === 'idle') return total;
  if (state.status === 'paused') {
    return Math.max(0, total - state.elapsedBeforePause);
  }
  // running
  if (state.startedAt === null) return total;
  const running = Date.now() - state.startedAt;
  return Math.max(0, total - state.elapsedBeforePause - running);
};

export { durationMsForMode };
