/**
 * Composant racine de l'application Filarr
 *
 * Gere l'onboarding, l'ecran de lancement (auth gate) et le routing principal.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import store, { persistor, resetAppData } from './store';
import type { AppDispatch, RootState } from './store';
import { initFromLocalStorage, lockApp } from './store/slices/authSlice';
import { fetchFolders } from './store/slices/foldersSlice';
import { fetchManifest } from './store/slices/profilesSlice';
import { setTheme, closeModal, clearProfileSwitchRequest } from './store/slices/uiSlice';
import { loadNotesFromDisk, saveNotesToDisk } from './store/slices/notesSlice';
import { useGlobalShortcuts, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTabNavigation } from './hooks/useTabNavigation';
import { CommandPalette } from './renderer/components/ui/CommandPalette';
import { PomodoroWidget } from './renderer/components/ui/PomodoroWidget';
import { ErrorBoundary } from './renderer/components/ui/ErrorBoundary';
import {
  loadDensitySettings,
  applyDensity,
  loadThemePreferences,
  detectSystemTheme,
  onSystemThemeChange,
} from './services/platform/themeService';
import Onboarding from './renderer/components/features/Onboarding';
import ProfilePicker from './renderer/components/profiles/ProfilePicker';
import WindowDragRegion from './renderer/components/layout/WindowDragRegion';
import { setActiveProfile } from './services/core/profileStorage';
import { tryRestoreFEKFromSafeStorage } from './services/auth/hybridCrypto';

// Importer les styles globaux
import './renderer/styles/global.css';

// Importer les composants
import { Layout } from './renderer/components/layout';
import { PrivateRoute, LaunchScreen } from './renderer/components/auth';
import { NotificationProvider } from './renderer/components/ui/Notification';

// Composant pour initialiser les raccourcis globaux et la navigation par onglets (doit etre dans le Router)
const ShortcutsInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useKeyboardShortcuts();
  useGlobalShortcuts();
  useTabNavigation();
  return <>{children}</>;
};

// Composant pour afficher la palette de commande en reponse au modal Redux
const CommandPaletteWrapper: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const modal = useSelector((state: RootState) => state.ui.modal);
  const isOpen = modal.type === 'commandPalette';

  return <CommandPalette isOpen={isOpen} onClose={() => dispatch(closeModal())} />;
};

// Composant de chargement
const LoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center h-screen bg-background">
    <div className="text-center">
      <div
        className="animate-spin"
        style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          style={{ color: 'var(--color-primary-600)' }}
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
          <path
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            opacity="0.75"
          />
        </svg>
      </div>
      <p className="text-primary font-medium">Chargement de Filarr...</p>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const profileSwitchRequested = useSelector((state: RootState) => state.ui.profileSwitchRequested);
  const reduxActiveProfileId = useSelector((state: RootState) => state.profiles.activeProfileId);
  const isLocked = useSelector((state: RootState) => state.auth.isLocked);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null); // null = loading
  const [profileSelected, setProfileSelected] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // After any unlock transition (PIN, vault password, auto-lock recovery, etc.),
  // reload the folders + notes. When Enhanced Lock fired at startup, the
  // initial fetches may have run while the FEK wasn't yet available, producing
  // empty results. Rerunning them here — once we're unlocked AND the profile
  // is selected — is an idempotent safety net that guarantees the UI reflects
  // the actual on-disk state.
  const prevLockedRef = useRef(isLocked);
  useEffect(() => {
    const wasLocked = prevLockedRef.current;
    prevLockedRef.current = isLocked;
    if (wasLocked && !isLocked && profileSelected) {
      console.info('[App] unlock transition → re-dispatching fetchFolders + loadNotesFromDisk');
      dispatch(fetchFolders())
        .unwrap()
        .then((folders) =>
          console.info('[App] post-unlock fetchFolders OK:', folders.length, 'folders')
        )
        .catch((err) => console.error('[App] post-unlock fetchFolders FAILED:', err));
      dispatch(loadNotesFromDisk())
        .unwrap()
        .then((data: any) =>
          console.info(
            '[App] post-unlock loadNotesFromDisk OK, notes count:',
            data ? Object.keys(data.byId || {}).length : 'null payload'
          )
        )
        .catch((err) => console.error('[App] post-unlock loadNotesFromDisk FAILED:', err));
    }
  }, [isLocked, profileSelected, dispatch]);

  // Check onboarding flag on mount (before showing anything)
  useEffect(() => {
    async function checkOnboarding() {
      try {
        const flagValue = await window.electron?.ipcRenderer?.invoke(
          'flag:get',
          'onboarding-complete'
        );
        setShowOnboarding(flagValue !== 'true');
      } catch {
        // Fallback to localStorage
        setShowOnboarding(localStorage.getItem('filarr-onboarding-complete') !== 'true');
      }
    }
    checkOnboarding();
  }, []);

  // If active profile was deleted (activeProfileId becomes null), go back to picker
  useEffect(() => {
    if (profileSelected && !reduxActiveProfileId) {
      dispatch(resetAppData());
      setProfileSelected(false);
    }
  }, [reduxActiveProfileId, profileSelected, dispatch]);

  // Handle profile switch request from Header
  useEffect(() => {
    if (profileSwitchRequested) {
      // Save current notes to disk, then reset — must await to avoid
      // the auto-save cleanup overwriting good data with empty state
      dispatch(saveNotesToDisk()).then(() => {
        dispatch(resetAppData());
        setProfileSelected(false);
        setIsSwitching(true);
        dispatch(clearProfileSwitchRequest());
      });
    }
  }, [profileSwitchRequested, dispatch]);

  // Expose store for dev debugging (console: __store.dispatch({type:'notes/permanentlyDeleteAllNotes'}))
  useEffect(() => {
    (window as any).__store = store;
  }, []);

  useEffect(() => {
    dispatch(initFromLocalStorage());

    // Initialiser le theme — respecter le mode systeme si active
    const themePrefs = loadThemePreferences();
    const initTheme = async () => {
      let theme: string;
      if (themePrefs.useSystemTheme) {
        theme = detectSystemTheme();
      } else {
        // localStorage first, then disk flag as fallback (survives updates)
        theme = localStorage.getItem('theme') || '';
        if (!theme && window.electron?.ipcRenderer) {
          theme = (await window.electron.ipcRenderer.invoke('flag:get', 'theme')) || 'light';
        }
        if (!theme) theme = 'light';
      }
      dispatch(
        setTheme(
          theme as
            | 'light'
            | 'dark'
            | 'space'
            | 'lofi'
            | 'sky'
            | 'aurora'
            | 'sakura'
            | 'crepuscule'
            | 'foret'
            | 'custom'
        )
      );
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
    };
    initTheme();

    // Restore saved font
    const savedFont = localStorage.getItem('filarr-font');
    if (savedFont) {
      const fontMap: Record<string, string> = {
        inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        system:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif",
        geist: "'Geist', 'Inter', -apple-system, sans-serif",
        mono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
        georgia: "'Georgia', 'Times New Roman', serif",
        nunito: "'Nunito', 'Inter', -apple-system, sans-serif",
        'space-grotesk': "'Space Grotesk', 'Inter', -apple-system, sans-serif",
      };
      const fontValue = fontMap[savedFont];
      if (fontValue) {
        document.documentElement.style.setProperty('--font-family-base', fontValue);
        document.documentElement.style.setProperty('--font-family-display', fontValue);
      }
    }

    // Initialiser la densite depuis les parametres sauvegardes
    const savedDensity = loadDensitySettings();
    applyDensity(savedDensity);

    // Ecouter les changements de theme OS (pour le mode systeme)
    const unsubSystem = onSystemThemeChange((isDark) => {
      if (store.getState().ui.useSystemTheme) {
        const newTheme = isDark ? 'dark' : 'light';
        dispatch(setTheme(newTheme));
        document.documentElement.setAttribute('data-theme', newTheme);
      }
    });

    // Ecouter les changements de theme Redux
    let prevTheme = store.getState().ui.theme;
    const unsubscribe = store.subscribe(() => {
      const currentTheme = store.getState().ui.theme;
      if (currentTheme && currentTheme !== prevTheme) {
        prevTheme = currentTheme;
        localStorage.setItem('theme', currentTheme);
        document.documentElement.setAttribute('data-theme', currentTheme);
        // Persist to disk so the theme survives updates (localStorage can be lost)
        window.electron?.ipcRenderer?.invoke('flag:set', 'theme', currentTheme).catch(() => {});
      }
    });

    return () => {
      unsubscribe();
      unsubSystem();
    };
  }, [dispatch]);

  // Debounced auto-save: persist notes to encrypted disk whenever they change.
  //
  // SAFETY: this effect is guarded to NEVER overwrite notes.enc with an empty
  // state. Scenarios that previously caused data loss:
  //   1. App starts → state.notes.byId = {} initially
  //   2. redux-persist hydrates other slices (unrelated) → store.subscribe fires
  //   3. prevRef goes from null → {} → save timer starts
  //   4. loadNotesFromDisk is slow (Enhanced Lock blocks on vault password)
  //   5. 2s timer fires before load completes → empty {} written to disk
  //   6. 30KB of real notes overwritten with empty JSON — data loss
  //
  // Guard: only save when `notesLoaded` is true AND the current state has at
  // least one note OR the user has explicitly deleted all notes. Distinguish
  // "we've loaded and state is legitimately empty" from "we haven't loaded
  // yet so state is just at its initial empty value".
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNotesObjRef = useRef<any>(null);
  const notesLoadedRef = useRef<boolean>(false);

  // Mark notes as loaded once loadNotesFromDisk has actually run (observed via
  // isLoading going true → false). Simply checking `isLoading === false` is
  // not enough: the initial Redux state has isLoading=false from the start,
  // so the guard would pass before loadNotesFromDisk even fires. We track two
  // transitions: first `isLoading` must have been true (load started), then
  // it must go back to false (load completed, success or failure).
  const hasStartedLoadRef = useRef(false);
  useEffect(() => {
    if (!profileSelected) return;
    const unsub = store.subscribe(() => {
      const s = store.getState().notes;
      if (s.isLoading === true) {
        hasStartedLoadRef.current = true;
      }
      if (!notesLoadedRef.current && hasStartedLoadRef.current && s.isLoading === false) {
        notesLoadedRef.current = true;
        console.info('[App] notes marked as loaded — auto-save unlocked');
      }
    });
    return unsub;
  }, [profileSelected]);

  useEffect(() => {
    if (!profileSelected) return;

    const unsubscribe = store.subscribe(() => {
      const notesState = store.getState().notes;
      if (notesState.byId === prevNotesObjRef.current) return;
      prevNotesObjRef.current = notesState.byId;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const latest = store.getState().notes;
        // CRITICAL GUARD: never save while the initial load hasn't completed.
        // Writing an empty {} at this point would overwrite real data on disk.
        if (!notesLoadedRef.current) {
          console.warn('[App] auto-save skipped: notes not yet loaded from disk');
          return;
        }
        dispatch(saveNotesToDisk());
        void latest;
      }, 2000); // 2s debounce
    });

    return () => {
      unsubscribe();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        // Flush pending save on unmount — only if load completed and there's
        // actual data (avoids overwriting good data with empty state after
        // resetAppData or before initial load).
        const notesState = store.getState().notes;
        if (notesLoadedRef.current && notesState.allIds.length > 0) {
          dispatch(saveNotesToDisk());
        }
      }
    };
  }, [profileSelected, dispatch]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  const handleProfileSelected = useCallback(
    async (profileId: string) => {
      console.info('[App] handleProfileSelected start:', profileId);
      setActiveProfile(profileId);
      dispatch(initFromLocalStorage());
      dispatch(fetchManifest());

      let enhancedLock = false;
      let fekOnDisk = false;
      let fekSource: string | null = null;
      try {
        enhancedLock =
          (await window.electron?.ipcRenderer?.invoke('security:getEnhancedLock', profileId)) ===
          true;
        const fekStatus = (await window.electron?.ipcRenderer?.invoke('security:fekStatus')) as
          | { active?: boolean; source?: string | null }
          | undefined;
        fekOnDisk = fekStatus?.active === true;
        fekSource = fekStatus?.source ?? null;
      } catch (err) {
        console.warn('[App] Enhanced Lock pre-check failed:', err);
      }
      console.info('[App] pre-check:', { profileId, enhancedLock, fekOnDisk, fekSource });

      if (enhancedLock && !fekOnDisk) {
        console.info('[App] Enhanced Lock active + no FEK on disk → requiring vault password');
        dispatch(lockApp());
        setProfileSelected(true);
        setIsSwitching(false);
        return;
      }

      setProfileSelected(true);
      setIsSwitching(false);
      console.info('[App] dispatching fetchFolders + loadNotesFromDisk');
      dispatch(fetchFolders())
        .unwrap()
        .then((folders) => console.info('[App] fetchFolders OK:', folders.length, 'folders'))
        .catch((err) => console.error('[App] fetchFolders FAILED:', err));
      dispatch(loadNotesFromDisk())
        .unwrap()
        .then((data: any) =>
          console.info(
            '[App] loadNotesFromDisk OK, notes count:',
            data ? Object.keys(data.byId || {}).length : 'null payload'
          )
        )
        .catch((err) => console.error('[App] loadNotesFromDisk FAILED:', err));

      const restored = await tryRestoreFEKFromSafeStorage();
      console.info('[App] tryRestoreFEKFromSafeStorage returned:', restored);
      if (!restored && enhancedLock) {
        console.info('[App] Enhanced Lock post-check: FEK restore failed → locking');
        dispatch(lockApp());
      }
    },
    [dispatch]
  );

  // Loading: waiting for onboarding flag check
  if (showOnboarding === null) {
    return <LoadingFallback />;
  }

  // No profile yet → onboarding first (creates profile inside)
  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  // Flow: Profile picker → Main app
  return (
    <ErrorBoundary>
      <NotificationProvider position="top-right" maxNotifications={5}>
        <LaunchScreen>
          {!profileSelected ? (
            <ProfilePicker onProfileSelected={handleProfileSelected} skipAutoSelect={isSwitching} />
          ) : (
            <Router>
              <ShortcutsInitializer>
                <CommandPaletteWrapper />
                <PomodoroWidget />
                <Routes>
                  {/* Redirect old auth routes */}
                  <Route path="/welcome" element={<Navigate to="/" replace />} />

                  {/* All routes render Layout */}
                  <Route
                    path="*"
                    element={
                      <PrivateRoute>
                        <Layout />
                      </PrivateRoute>
                    }
                  />
                </Routes>
              </ShortcutsInitializer>
            </Router>
          )}
        </LaunchScreen>
      </NotificationProvider>
    </ErrorBoundary>
  );
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <WindowDragRegion />
      <Provider store={store}>
        <PersistGate loading={<LoadingFallback />} persistor={persistor}>
          <AppContent />
        </PersistGate>
      </Provider>
    </ErrorBoundary>
  );
};

export default App;
