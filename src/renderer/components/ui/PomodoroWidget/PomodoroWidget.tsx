/**
 * PomodoroWidget Component
 *
 * Minuteur Pomodoro flottant — 2 etats: pilule minimisee ou carte etendue.
 *
 * Implementation notes:
 * - Le tick (1s interval) n'agit que sur le local state (`remainingMs`),
 *   pas sur Redux, pour eviter les renders a 1Hz sur tout l'app.
 * - A chaque transition (start/pause/resume/complete), on dispatche une
 *   action et on re-synchronise `remainingMs` depuis `computeRemainingMs`.
 */

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { RootState, AppDispatch } from '../../../../store';
import {
  PomodoroMode,
  startTimer,
  pauseTimer,
  resumeTimer,
  resetTimer,
  completeSession,
  skipSession,
  setMode,
  updateSettings,
  toggleWidgetMinimized,
  hideWidget,
  resetAllStats,
  selectPomodoroDurationMs,
  selectTodayFocusMinutes,
  computeRemainingMs,
} from '../../../../store/slices/pomodoroSlice';
import './PomodoroWidget.css';

// ==================== ICONS ====================

const IconPlay: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const IconPause: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </svg>
);

const IconSkip: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 6l8.5 6L6 18V6zM16 6h2v12h-2z" />
  </svg>
);

const IconReset: FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1 4v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const IconSettings: FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconMinimize: FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
  </svg>
);

const IconClose: FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

// ==================== HELPERS ====================

const formatTime = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
};

// ==================== COMPONENT ====================

export const PomodoroWidget: FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const state = useSelector((s: RootState) => s.pomodoro);
  const durationMs = useSelector(selectPomodoroDurationMs);
  const todayMinutes = useSelector(selectTodayFocusMinutes);

  const [remainingMs, setRemainingMs] = useState(() => computeRemainingMs(state));
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Re-sync `remainingMs` when state transitions happen
  useEffect(() => {
    setRemainingMs(computeRemainingMs(state));
  }, [
    state.status,
    state.mode,
    state.startedAt,
    state.pausedAt,
    state.elapsedBeforePause,
    durationMs,
    state,
  ]);

  // Tick while running
  useEffect(() => {
    if (state.status !== 'running') return;
    const handle = window.setInterval(() => {
      const remaining = computeRemainingMs(state);
      setRemainingMs(remaining);
      if (remaining <= 0) {
        dispatch(completeSession());
      }
    }, 1000);
    return () => window.clearInterval(handle);
  }, [state, dispatch]);

  // Fire a notification when a session completes
  const [lastCompletedAt, setLastCompletedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!state.settings.notificationsEnabled) return;
    if (
      state.status === 'idle' &&
      remainingMs === durationMs &&
      lastCompletedAt !== state.startedAt
    ) {
      // A session just auto-reset to idle (pause after focus, etc.)
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          const title =
            state.mode === 'focus'
              ? t('pomodoro.notifFocusReady', 'Focus ready')
              : t('pomodoro.notifBreakReady', 'Break ready');
          try {
            new Notification('Filarr — Pomodoro', {
              body: title,
              silent: !state.settings.soundEnabled,
            });
          } catch {
            // ignore (some Electron contexts)
          }
        }
      }
      setLastCompletedAt(state.startedAt);
    }
  }, [
    state.status,
    state.mode,
    state.startedAt,
    state.settings,
    remainingMs,
    durationMs,
    lastCompletedAt,
    t,
  ]);

  // Request notification permission on first show if enabled
  useEffect(() => {
    if (
      state.settings.notificationsEnabled &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {
        /* noop */
      });
    }
  }, [state.settings.notificationsEnabled]);

  const progress = useMemo(() => {
    if (durationMs <= 0) return 0;
    return 1 - remainingMs / durationMs;
  }, [remainingMs, durationMs]);

  // ==================== Handlers ====================

  const handlePrimary = useCallback(() => {
    if (state.status === 'running') {
      dispatch(pauseTimer());
    } else if (state.status === 'paused') {
      dispatch(resumeTimer());
    } else {
      dispatch(startTimer({ mode: state.mode }));
    }
  }, [state.status, state.mode, dispatch]);

  const handleReset = useCallback(() => {
    dispatch(resetTimer());
  }, [dispatch]);

  const handleSkip = useCallback(() => {
    dispatch(skipSession());
  }, [dispatch]);

  const handleTab = useCallback(
    (m: PomodoroMode) => {
      dispatch(setMode(m));
    },
    [dispatch]
  );

  const handleMinimize = useCallback(() => dispatch(toggleWidgetMinimized()), [dispatch]);
  const handleClose = useCallback(() => dispatch(hideWidget()), [dispatch]);

  // ==================== Visibility gate ====================

  if (!state.widgetVisible) return null;

  // ==================== Minimized pill ====================

  if (state.widgetMinimized) {
    const dotClass = `pomodoro-pill__dot pomodoro-pill__dot--${state.mode}${
      state.status === 'running' ? ' pomodoro-pill__dot--running' : ''
    }`;

    return (
      <div
        className={`pomodoro-widget pomodoro-widget--${state.widgetPosition}`}
        role="region"
        aria-label={t('pomodoro.widgetLabel', 'Pomodoro timer')}
      >
        <div className="pomodoro-pill" onClick={() => dispatch(toggleWidgetMinimized())}>
          <span className={dotClass} aria-hidden="true" />
          <span className="pomodoro-pill__time" aria-live="polite">
            {formatTime(remainingMs)}
          </span>
          <button
            type="button"
            className="pomodoro-pill__action"
            onClick={(e) => {
              e.stopPropagation();
              handlePrimary();
            }}
            aria-label={
              state.status === 'running'
                ? t('pomodoro.pause', 'Pause')
                : t('pomodoro.start', 'Start')
            }
          >
            {state.status === 'running' ? <IconPause /> : <IconPlay />}
          </button>
        </div>
      </div>
    );
  }

  // ==================== Expanded card ====================

  const ringRadius = 78;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const dashOffset = ringCircumference * (1 - progress);

  const modeLabel =
    state.mode === 'focus'
      ? t('pomodoro.modeFocus', 'Focus')
      : state.mode === 'shortBreak'
        ? t('pomodoro.modeShortBreak', 'Short break')
        : t('pomodoro.modeLongBreak', 'Long break');

  return (
    <div
      className={`pomodoro-widget pomodoro-widget--${state.widgetPosition}`}
      role="region"
      aria-label={t('pomodoro.widgetLabel', 'Pomodoro timer')}
    >
      <div className="pomodoro-card">
        <div className="pomodoro-card__header">
          <div className="pomodoro-card__title">
            <span>{t('pomodoro.title', 'Focus')}</span>
          </div>
          <div className="pomodoro-card__header-actions">
            <button
              type="button"
              className="pomodoro-card__iconbtn"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label={t('pomodoro.settings', 'Settings')}
              aria-pressed={settingsOpen}
            >
              <IconSettings />
            </button>
            <button
              type="button"
              className="pomodoro-card__iconbtn"
              onClick={handleMinimize}
              aria-label={t('pomodoro.minimize', 'Minimize')}
            >
              <IconMinimize />
            </button>
            <button
              type="button"
              className="pomodoro-card__iconbtn"
              onClick={handleClose}
              aria-label={t('pomodoro.close', 'Close')}
            >
              <IconClose />
            </button>
          </div>
        </div>

        {!settingsOpen && (
          <>
            <div className="pomodoro-card__tabs" role="tablist">
              {(['focus', 'shortBreak', 'longBreak'] as PomodoroMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={state.mode === m}
                  className={`pomodoro-card__tab${
                    state.mode === m ? ' pomodoro-card__tab--active' : ''
                  }`}
                  onClick={() => handleTab(m)}
                >
                  {m === 'focus'
                    ? t('pomodoro.modeFocus', 'Focus')
                    : m === 'shortBreak'
                      ? t('pomodoro.modeShortBreakShort', 'Short')
                      : t('pomodoro.modeLongBreakShort', 'Long')}
                </button>
              ))}
            </div>

            <div className="pomodoro-card__display">
              <div className="pomodoro-ring">
                <svg className="pomodoro-ring__svg" viewBox="0 0 180 180">
                  <circle
                    className="pomodoro-ring__track"
                    cx="90"
                    cy="90"
                    r={ringRadius}
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle
                    className={`pomodoro-ring__progress pomodoro-ring__progress--${state.mode}`}
                    cx="90"
                    cy="90"
                    r={ringRadius}
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={dashOffset}
                  />
                </svg>
                <span className="pomodoro-ring__time" aria-live="polite">
                  {formatTime(remainingMs)}
                </span>
                <span className="pomodoro-ring__label">{modeLabel}</span>
              </div>
            </div>

            <div className="pomodoro-card__controls">
              <button
                type="button"
                className="pomodoro-card__secondary-btn"
                onClick={handleReset}
                aria-label={t('pomodoro.reset', 'Reset')}
                title={t('pomodoro.reset', 'Reset')}
              >
                <IconReset />
              </button>
              <button type="button" className="pomodoro-card__primary-btn" onClick={handlePrimary}>
                {state.status === 'running'
                  ? t('pomodoro.pause', 'Pause')
                  : state.status === 'paused'
                    ? t('pomodoro.resume', 'Resume')
                    : t('pomodoro.start', 'Start')}
              </button>
              <button
                type="button"
                className="pomodoro-card__secondary-btn"
                onClick={handleSkip}
                aria-label={t('pomodoro.skip', 'Skip')}
                title={t('pomodoro.skip', 'Skip')}
              >
                <IconSkip />
              </button>
            </div>

            <div className="pomodoro-card__footer">
              <span className="pomodoro-card__stat">
                <span>{t('pomodoro.today', 'Today')}</span>
                <span className="pomodoro-card__stat-value">{state.completedFocusToday}</span>
                <span>·</span>
                <span className="pomodoro-card__stat-value">{todayMinutes}m</span>
              </span>
              <span className="pomodoro-card__stat">
                <span>{t('pomodoro.cycle', 'Cycle')}</span>
                <span className="pomodoro-card__stat-value">
                  {state.currentCycleFocusCount}/{state.settings.longBreakInterval}
                </span>
              </span>
            </div>
          </>
        )}

        {settingsOpen && (
          <div className="pomodoro-settings">
            <div className="pomodoro-settings__row">
              <label htmlFor="pomo-focus">{t('pomodoro.focusDuration', 'Focus (min)')}</label>
              <input
                id="pomo-focus"
                className="pomodoro-settings__input"
                type="number"
                min={1}
                max={120}
                value={state.settings.focusDuration}
                onChange={(e) =>
                  dispatch(
                    updateSettings({
                      focusDuration: clampInt(parseInt(e.target.value, 10), 1, 120),
                    })
                  )
                }
              />
            </div>
            <div className="pomodoro-settings__row">
              <label htmlFor="pomo-short">
                {t('pomodoro.shortBreakDuration', 'Short break (min)')}
              </label>
              <input
                id="pomo-short"
                className="pomodoro-settings__input"
                type="number"
                min={1}
                max={60}
                value={state.settings.shortBreakDuration}
                onChange={(e) =>
                  dispatch(
                    updateSettings({
                      shortBreakDuration: clampInt(parseInt(e.target.value, 10), 1, 60),
                    })
                  )
                }
              />
            </div>
            <div className="pomodoro-settings__row">
              <label htmlFor="pomo-long">
                {t('pomodoro.longBreakDuration', 'Long break (min)')}
              </label>
              <input
                id="pomo-long"
                className="pomodoro-settings__input"
                type="number"
                min={1}
                max={60}
                value={state.settings.longBreakDuration}
                onChange={(e) =>
                  dispatch(
                    updateSettings({
                      longBreakDuration: clampInt(parseInt(e.target.value, 10), 1, 60),
                    })
                  )
                }
              />
            </div>
            <div className="pomodoro-settings__row">
              <label htmlFor="pomo-interval">
                {t('pomodoro.longBreakInterval', 'Cycles before long break')}
              </label>
              <input
                id="pomo-interval"
                className="pomodoro-settings__input"
                type="number"
                min={2}
                max={10}
                value={state.settings.longBreakInterval}
                onChange={(e) =>
                  dispatch(
                    updateSettings({
                      longBreakInterval: clampInt(parseInt(e.target.value, 10), 2, 10),
                    })
                  )
                }
              />
            </div>

            <label className="pomodoro-settings__row">
              <span>{t('pomodoro.autoStartBreaks', 'Auto-start breaks')}</span>
              <input
                type="checkbox"
                className="pomodoro-settings__checkbox"
                checked={state.settings.autoStartBreaks}
                onChange={(e) => dispatch(updateSettings({ autoStartBreaks: e.target.checked }))}
              />
            </label>

            <label className="pomodoro-settings__row">
              <span>{t('pomodoro.autoStartFocus', 'Auto-start focus')}</span>
              <input
                type="checkbox"
                className="pomodoro-settings__checkbox"
                checked={state.settings.autoStartFocus}
                onChange={(e) => dispatch(updateSettings({ autoStartFocus: e.target.checked }))}
              />
            </label>

            <label className="pomodoro-settings__row">
              <span>{t('pomodoro.notifications', 'Notifications')}</span>
              <input
                type="checkbox"
                className="pomodoro-settings__checkbox"
                checked={state.settings.notificationsEnabled}
                onChange={(e) =>
                  dispatch(updateSettings({ notificationsEnabled: e.target.checked }))
                }
              />
            </label>

            <button
              type="button"
              className="pomodoro-settings__reset"
              onClick={() => dispatch(resetAllStats())}
            >
              {t('pomodoro.resetStats', 'Reset all stats')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PomodoroWidget;
