/**
 * useAutoLock — Lock the app after a period of inactivity.
 *
 * Listens for user activity (mouse, keyboard, touch) on window.
 * When the timer expires, clears the FEK from renderer memory
 * and dispatches lockApp() to show the lock screen.
 *
 * Does nothing if autoLockEnabled is false or autoLockTimeout is 0.
 * Does nothing if already locked.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../store';
import { lockApp } from '../store/slices/authSlice';
import { forgetSessionSecrets } from '../services/auth/sessionTeardown';
import { purgeCollabOnKeyLoss } from '../services/collab/collabSession';
import { selectEffectiveAutoLock } from '../store/slices/governanceSlice';

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;
const DEBOUNCE_MS = 30_000; // Only reset timer every 30s max

export function useAutoLock(): void {
  const dispatch = useDispatch();
  // E9-10: the effective auto-lock = the user's setting intersected with the org's idle-timeout cap
  // (org cap is a maximum; a shorter user choice wins; an org cap forces auto-lock on). When no org
  // policy is active this is exactly the user's own security setting (non-regression).
  const { enabled: autoLockEnabled, timeoutMinutes: autoLockTimeout } =
    useSelector(selectEffectiveAutoLock);
  const isLocked = useSelector((state: RootState) => state.auth.isLocked);

  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerLock = useCallback(() => {
    void forgetSessionSecrets(dispatch, 'auto-lock');
  }, [dispatch]);

  const resetTimer = useCallback(() => {
    if (!autoLockEnabled || autoLockTimeout <= 0 || isLocked) return;

    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
    }

    lockTimerRef.current = setTimeout(triggerLock, autoLockTimeout * 60 * 1000);
  }, [autoLockEnabled, autoLockTimeout, isLocked, triggerLock]);

  // Debounced activity handler — resets the lock timer
  const handleActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityRef.current < DEBOUNCE_MS) return;
    lastActivityRef.current = now;

    // Clear any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      resetTimer();
    }, 100);
  }, [resetTimer]);

  useEffect(() => {
    if (!autoLockEnabled || autoLockTimeout <= 0 || isLocked) {
      // Clean up if disabled or locked
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
      return;
    }

    // Start the timer
    resetTimer();

    // Listen for activity
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [autoLockEnabled, autoLockTimeout, isLocked, resetTimer, handleActivity]);
}
