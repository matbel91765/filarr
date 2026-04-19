/**
 * useVersionHistoryMode
 *
 * Tiny hook that persists the selected version-history UI mode in
 * localStorage. Deliberately kept outside Redux — this is a pure
 * per-device UI preference that doesn't need to be synced or
 * included in migrations.
 *
 * The string is validated on read so a manually-edited or stale
 * value can't crash the app.
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * 'palette' is reserved for the future command-palette mode
 * (see Option 5). It's allowed as a valid stored value so the
 * preference survives across the rollout without a migration.
 */
export type VersionHistoryMode = 'sidebar' | 'scrapbook' | 'scrubber' | 'palette';

const STORAGE_KEY = 'filarr.versionHistoryMode';
const VALID: VersionHistoryMode[] = ['sidebar', 'scrapbook', 'scrubber', 'palette'];
const DEFAULT_MODE: VersionHistoryMode = 'sidebar';

function readMode(): VersionHistoryMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID as string[]).includes(raw)) {
      return raw as VersionHistoryMode;
    }
  } catch {
    /* localStorage unavailable — fall back */
  }
  return DEFAULT_MODE;
}

export function useVersionHistoryMode(): [VersionHistoryMode, (mode: VersionHistoryMode) => void] {
  const [mode, setModeState] = useState<VersionHistoryMode>(readMode);

  const setMode = useCallback((next: VersionHistoryMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage unavailable — in-memory only */
    }
  }, []);

  // Keep multiple instances in sync (e.g. if the selector is rendered
  // in more than one place during a switch animation).
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && (VALID as string[]).includes(e.newValue)) {
        setModeState(e.newValue as VersionHistoryMode);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return [mode, setMode];
}
