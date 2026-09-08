/**
 * Composant racine de l'application Filarr
 *
 * Gere l'onboarding, l'ecran de lancement (auth gate) et le routing principal.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import store, { persistor, resetAppData } from './store';
import type { AppDispatch, RootState } from './store';
import { initFromLocalStorage, hydrateAuthStatus, lockApp } from './store/slices/authSlice';
import { fetchFolders } from './store/slices/foldersSlice';
import { pruneOrphanFolderTabs } from './store/slices/tabsSlice';
import { fetchManifest } from './store/slices/profilesSlice';
import {
  setTheme,
  setUseSystemTheme,
  closeModal,
  clearProfileSwitchRequest,
  hydrateDisplayPreferences,
} from './store/slices/uiSlice';
import { initOrgContext } from './store/slices/orgSlice';
import {
  loadNotesFromDisk,
  saveNotesToDisk,
  rebuildBuiltInTemplates,
} from './store/slices/notesSlice';
import i18n from './i18n/config';
import { loadLayoutFromDisk } from './store/slices/layoutSlice';
import { drainPendingFeedback } from './services/feedback/feedbackQueue';
import { registerNotesAutosaveFlush, registerNotesDirtyReset } from './store/notesAutosaveFlush';
import { useGlobalShortcuts, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTabNavigation } from './hooks/useTabNavigation';
import { usePolicyWatcher } from './hooks/usePolicyWatcher';
import { useOrgAppearance, useOrgPluginGate } from './hooks/useOrgAppearance';
import { useRetentionSweep } from './hooks/useRetentionSweep';
import { useDeviceWipe } from './hooks/useDeviceWipe';
import { CommandPalette } from './renderer/components/ui/CommandPalette';
import { PomodoroWidget } from './renderer/components/ui/PomodoroWidget';
import { ErrorBoundary } from './renderer/components/ui/ErrorBoundary';
import {
  loadDensitySettings,
  applyDensity,
  detectSystemTheme,
  onSystemThemeChange,
  loadProfileAppearance,
  applyProfileAppearance,
  defaultThemeName,
  isStoredThemeName,
} from './services/platform/themeService';
import Onboarding from './renderer/components/features/Onboarding';
import SyncConflictHandler from './renderer/components/sync/SyncConflictHandler';
import ReduxNotificationsHost from './renderer/components/notifications/ReduxNotificationsHost';
import ProfilePicker from './renderer/components/profiles/ProfilePicker';
import SpaceSelector from './renderer/components/profiles/SpaceSelector';
import { isEnterpriseHidden, hydrateEnterpriseHidden } from './config/enterprise';
import WindowDragRegion from './renderer/components/layout/WindowDragRegion';
import { setActiveProfile } from './services/core/profileStorage';
import { discardPendingCloudSession } from './services/core/pendingCloudSession';
import { initCrashReporter, setCrashReportingEnabled } from './services/platform/crashReporter';
import {
  tryRestoreFEKFromSafeStorage,
  hasDeviceKeyWrap,
  initFromDeviceKey,
  hasHybridKey,
} from './services/auth/hybridCrypto';
import { initDownloadsWatcherBridge } from './services/features/downloadsWatcherBridge';
import { initPublishKeyAdoption } from './services/publish/publishBridge';
import { initHotFoldersBridge } from './services/features/hotFoldersBridge';
import { initClipReceiver } from './services/clipper/clipReceiver';
import {
  initDesktopProtectionBridge,
  pushRendererLockState,
} from './services/features/desktopProtectionBridge';
import MiniMode from './renderer/components/mini/MiniMode';
import { FilarrBoxHost, ShellProtectHost } from './renderer/components/protect';
import { PendingInviteHost } from './renderer/components/vaults/PendingInviteHost';
import { VaultsBootstrapHost } from './renderer/components/vaults/VaultsBootstrapHost';
import { VaultHeadsWatcher } from './renderer/components/vaults/VaultHeadsWatcher';
import { PendingInviteBanner } from './renderer/components/vaults/PendingInviteBanner';
import { AccountSharingNudge } from './renderer/components/account/AccountSharingNudge';
import { OrgCoverageNotice } from './renderer/components/account/OrgCoverageNotice';
import { DeviceLimitHost } from './renderer/components/auth/DeviceLimitHost';
import { isWebPlatform } from './services/platform/isWebPlatform';

// Importer les styles globaux
import './renderer/styles/global.css';

// Importer les composants
import { Layout } from './renderer/components/layout';
import { PrivateRoute, LaunchScreen } from './renderer/components/auth';
import { NotificationProvider } from './renderer/components/ui/Notification';
import { applyAppFont, currentAppFontId } from './services/platform/appFonts';
import { applyPageWidth, currentPageWidth } from './services/platform/pageWidth';

// Composant pour initialiser les raccourcis globaux et la navigation par onglets (doit etre dans le Router)
const ShortcutsInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useKeyboardShortcuts();
  useGlobalShortcuts();
  useTabNavigation();
  useReminderClickNavigation();
  useBuiltInTemplateLanguage();
  return <>{children}</>;
};

/**
 * Rebâtit les modèles de notes INTÉGRÉS quand la langue change.
 *
 * Les Réglages appellent `i18n.changeLanguage` sans recharger l'application ;
 * or les modèles du pack « projet » résolvent leurs libellés — jusqu'au
 * CONTENU des notes qu'ils produisent — au moment où ils sont construits, une
 * seule fois à l'initialisation du magasin. Sans ce rafraîchissement, ils
 * restaient dans l'ancienne langue jusqu'au prochain démarrage, et une note
 * créée entre-temps figeait cette langue dans le document persisté.
 */
const useBuiltInTemplateLanguage = () => {
  const dispatch = useDispatch<AppDispatch>();
  useEffect(() => {
    const apply = () => {
      dispatch(rebuildBuiltInTemplates());
    };
    i18n.on('languageChanged', apply);
    return () => {
      i18n.off('languageChanged', apply);
    };
  }, [dispatch]);
};

// Hook: clicking the OS reminder notification focuses the app and jumps
// straight to the dedicated /reminders page with the matching row
// highlighted. The main process always sends `reminder-clicked` whether
// the click came from a button or the body of the toast.
const useReminderClickNavigation = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const handler = (payload: { reminderId?: string }) => {
      const id = payload?.reminderId;
      navigate(id ? `/reminders?highlight=${encodeURIComponent(id)}` : '/reminders');
    };
    ipc.on('reminder-clicked', handler);
    return () => ipc.removeListener('reminder-clicked', handler);
  }, [navigate]);
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
  const profileSwitchSpace = useSelector((state: RootState) => state.ui.profileSwitchSpace);
  const reduxActiveProfileId = useSelector((state: RootState) => state.profiles.activeProfileId);
  const isLocked = useSelector((state: RootState) => state.auth.isLocked);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null); // null = loading
  const [profileSelected, setProfileSelected] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  // The launch-time workspace chosen on the SpaceSelector. null = show the
  // selector; personal/enterprise = show the ProfilePicker filtered to it. When
  // the user hid the enterprise space at startup we skip the chooser entirely.
  const [launchSpace, setLaunchSpace] = useState<'personal' | 'enterprise' | null>(() =>
    isEnterpriseHidden() ? 'personal' : null
  );
  // When set, re-run the onboarding wizard in "add account" mode to provision a
  // NEW account of that space (enterprise accounts are provisioned this way).
  const [addAccountSpace, setAddAccountSpace] = useState<'personal' | 'enterprise' | null>(null);
  /** « J'ai déjà un compte » (login) ou « je n'en ai pas » (register). */
  const [addAccountMode, setAddAccountMode] = useState<'login' | 'register'>('login');
  /**
   * Compte qui vient d'être ajouté et dont PLUSIEURS profils sont revenus du
   * nuage : le sélecteur reprend la main, ce groupe déplié et signalé. Neutralise
   * aussi la sélection automatique — entrer d'office dans l'unique profil d'un
   * espace alors qu'on vient justement d'en ramener plusieurs serait absurde.
   */
  const [addedAccountEmail, setAddedAccountEmail] = useState<string | null>(null);

  // E9-10: org governance policy watcher — fetch/cache the policy, run the offline-grace clock, and
  // enter degraded mode (lock) when a device runs too long on a stale policy. Mounted here (above the
  // lock gate) so it keeps re-syncing even while the app is locked and can clear degraded on reconnect.
  usePolicyWatcher();
  // Apparence choisie par l'organisation (thème, police). Monté juste après le
  // veilleur de politique, dont il consomme le résultat : posé plus haut, il
  // n'aurait encore rien à appliquer.
  useOrgAppearance();
  // Et la règle des extensions, transmise au service qui les charge.
  useOrgPluginGate();
  // E9-2: apply the org retention policy (purge expired trash) on this device — only under an active
  // org policy; personal trash behaviour is unchanged.
  useRetentionSweep();
  // E9-11: execute an admin remote-wipe — sign the proof of execution + reset to logged-out.
  useDeviceWipe();

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

  /**
   * REJOUER LES RETOURS MIS DE CÔTÉ.
   *
   * L'écran des réglages empilait dans `localStorage` les retours qu'il n'avait
   * pas pu poster, et RIEN NE DÉPILAIT JAMAIS. Un utilisateur qui a écrit hors
   * ligne et n'en écrira pas d'autre attendrait indéfiniment ; le prochain envoi
   * réussi ne suffit donc pas, il faut aussi ce passage-ci.
   *
   * Silencieux et sans conséquence : un échec laisse la file exactement où elle
   * était, et rien de ce que l'utilisateur voit n'en dépend.
   */
  useEffect(() => {
    void drainPendingFeedback();
  }, []);

  // Restore the "hide enterprise space" preference from the durable disk flag
  // (in case localStorage was reset), then skip the chooser if it's on.
  useEffect(() => {
    hydrateEnterpriseHidden().then(() => {
      if (isEnterpriseHidden()) setLaunchSpace((prev) => (prev === null ? 'personal' : prev));
    });
  }, []);

  // Hydrate auth state from main process on startup + listen for changes
  useEffect(() => {
    // Initial hydration
    window.electron?.ipcRenderer
      ?.invoke('auth:getStatus')
      .then((status: any) => {
        if (status) dispatch(hydrateAuthStatus(status));
      })
      .catch(() => {});

    // Listen for auth changes (login, logout, token refresh)
    const handleAuthChange = (status: any) => {
      if (status) dispatch(hydrateAuthStatus(status));
    };
    window.electron?.ipcRenderer?.on('auth-status-changed', handleAuthChange);

    return () => {
      window.electron?.ipcRenderer?.removeListener('auth-status-changed', handleAuthChange);
    };
  }, [dispatch]);

  // La fusion du cycle de sync vient de réécrire `layout.enc` : on relit. Sans
  // ça, une disposition faite sur un autre appareil n'apparaîtrait qu'au
  // prochain démarrage. `on()` rend son propre désabonnement — `removeListener`
  // ne peut pas retrouver le wrapper créé de l'autre côté du pont.
  useEffect(() => {
    const off = window.electron?.ipcRenderer?.on('layout-updated', () => {
      void dispatch(loadLayoutFromDisk());
    });
    return () => {
      off?.();
    };
  }, [dispatch]);

  // If active profile was deleted (activeProfileId becomes null), go back to picker
  useEffect(() => {
    if (profileSelected && !reduxActiveProfileId) {
      dispatch(resetAppData());
      setProfileSelected(false);
      setLaunchSpace(isEnterpriseHidden() ? 'personal' : null);
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
        // Un espace VISÉ emmène directement à son sélecteur — c'est ce que demande
        // « créer mon espace professionnel » depuis le menu de compte. Sans cible,
        // on rend le portail, comme avant, pour que la personne rechoisisse.
        setLaunchSpace(profileSwitchSpace ?? (isEnterpriseHidden() ? 'personal' : null));
        dispatch(clearProfileSwitchRequest());
      });
    }
  }, [profileSwitchRequested, profileSwitchSpace, dispatch]);

  // Initialize crash reporter on mount
  useEffect(() => {
    const crashEnabled = store.getState().settings?.advanced?.crashReportsEnabled ?? true;
    setCrashReportingEnabled(crashEnabled);
    initCrashReporter();

    // Écoute PERMANENTE de `publish:key-adopted` : une bascule de clé achevée
    // par la reprise au démarrage doit être adoptée par le renderer même si
    // l'écran « Publier ce coffre » n'a jamais été monté. Idempotent — le
    // module s'auto-installe déjà à son chargement ; cet appel explicite rend
    // l'exigence visible au bootstrap et survivrait à un import devenu paresseux.
    initPublishKeyAdoption();

    // Expose store for dev debugging (console: __store.dispatch({type:'notes/permanentlyDeleteAllNotes'}))
    (window as any).__store = store;
  }, []);

  useEffect(() => {
    dispatch(initFromLocalStorage());

    /**
     * THÈME ET ACCENT DU PROFIL ACTIF — l'ordre de préséance a changé.
     *
     * On lisait d'abord `localStorage['theme']`, une clé COMMUNE à tous les
     * profils du poste, doublée sur disque par un drapeau tout aussi commun.
     * La bascule de profil par l'en-tête recharge la fenêtre : au retour, ce
     * cache portait encore le thème du profil qu'on venait de quitter, et
     * l'accent n'était appliqué nulle part avant l'ouverture des Réglages.
     *
     * Désormais le profil décide (`loadProfileAppearance`), et ces deux caches
     * globaux ne servent plus que de repli : un profil qui n'a jamais rien
     * choisi garde ce que la machine affichait, au lieu de sauter au blanc.
     */
    const initTheme = async () => {
      let fallback = localStorage.getItem('theme') || '';
      if (!fallback && window.electron?.ipcRenderer) {
        fallback = (await window.electron.ipcRenderer.invoke('flag:get', 'theme')) || '';
      }
      const appearance = loadProfileAppearance(
        isStoredThemeName(fallback) ? fallback : defaultThemeName()
      );
      const theme = applyProfileAppearance(appearance);
      dispatch(setUseSystemTheme(appearance.useSystemTheme));
      dispatch(setTheme(theme));
      localStorage.setItem('theme', theme);
    };
    initTheme();

    // Fonds de thème animés (« Minuit vivant »). L'attribut est posé tout de
    // suite, avant le premier rendu du Layout, pour qu'un refus enregistré ne
    // laisse pas le ciel scintiller une fraction de seconde au démarrage.
    const applyAnimatedBackground = (enabled: boolean): void => {
      if (enabled) {
        document.documentElement.removeAttribute('data-animated-bg');
      } else {
        document.documentElement.setAttribute('data-animated-bg', 'off');
      }
    };
    applyAnimatedBackground(store.getState().ui.animatedBackground);

    // Restore saved font
    //
    // Sans choix enregistre : Jakarta par defaut sur le web -- defaut
    // d'AFFICHAGE, pas une preference, donc rien n'est persiste pour lui.
    // La liste et la pose vivent dans `appFonts` : elles etaient recopiees ici
    // ET dans l'ecran des parametres, deux tables pour une seule idee.
    const fontKey = currentAppFontId(isWebPlatform() ? 'jakarta' : null);
    if (fontKey) applyAppFont(fontKey, false);

    // Restore saved page width
    //
    // Meme geste que la police : la valeur relue est REPOSEE sans etre
    // re-persistee. Sans cela, une lecture qui echoue (stockage refuse) irait
    // reecrire le defaut par-dessus un choix qu'on n'a simplement pas su lire.
    applyPageWidth(currentPageWidth(), false);

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
    let prevAnimatedBg = store.getState().ui.animatedBackground;
    const unsubscribe = store.subscribe(() => {
      const currentTheme = store.getState().ui.theme;
      if (currentTheme && currentTheme !== prevTheme) {
        prevTheme = currentTheme;
        localStorage.setItem('theme', currentTheme);
        document.documentElement.setAttribute('data-theme', currentTheme);
        // Persist to disk so the theme survives updates (localStorage can be lost)
        window.electron?.ipcRenderer?.invoke('flag:set', 'theme', currentTheme).catch(() => {});
      }
      const currentAnimatedBg = store.getState().ui.animatedBackground;
      if (currentAnimatedBg !== prevAnimatedBg) {
        prevAnimatedBg = currentAnimatedBg;
        applyAnimatedBackground(currentAnimatedBg);
      }
    });

    // Fenêtre en arrière-plan : on marque <html> pour que les fonds animés se
    // mettent en pause. Rien ne sert de faire tourner un ciel que personne ne
    // regarde, et Chromium ne bride pas de lui-même une animation compositée.
    //
    // MASQUÉ COMPTE COMME INACTIF. `blur` ne suffit pas : un onglet web caché
    // derrière un autre, une fenêtre réduite qui garde le focus du système —
    // le document est masqué sans avoir perdu le focus. `document.hidden` est
    // le signal fiable des deux côtés ; la classe suit l'union des deux.
    const syncBlurred = (): void => {
      if (document.hidden || !document.hasFocus()) {
        document.documentElement.classList.add('app-blurred');
      } else {
        document.documentElement.classList.remove('app-blurred');
      }
    };
    window.addEventListener('blur', syncBlurred);
    window.addEventListener('focus', syncBlurred);
    document.addEventListener('visibilitychange', syncBlurred);
    syncBlurred();

    return () => {
      unsubscribe();
      unsubSystem();
      window.removeEventListener('blur', syncBlurred);
      window.removeEventListener('focus', syncBlurred);
      document.removeEventListener('visibilitychange', syncBlurred);
      document.documentElement.classList.remove('app-blurred');
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

  // ── Jeu des notes SALES ────────────────────────────────────────────────────
  //
  // La sauvegarde n'envoie plus le coffre entier au processus principal, mais
  // les seules notes touchées : sur un coffre de 70 Mo, la sérialisation du tout
  // figeait le renderer ~100 ms à chaque écriture, et le debounce de 2 s ci-dessous
  // la faisait tomber pile pendant le clic qui suit un glissement.
  //
  // Savoir CE QUI a bougé sans toucher aux ~30 reducers du slice : Immer
  // renouvelle l'identité de chaque note qu'un reducer modifie, donc une
  // comparaison de références clé par clé entre l'ancien et le nouveau `byId`
  // suffit. ~6 000 comparaisons de pointeurs se comptent en dixièmes de
  // milliseconde — sans commune mesure avec ce qu'on évite.
  const dirtyNoteIdsRef = useRef<Set<string>>(new Set());
  const removedNoteIdsRef = useRef<Set<string>>(new Set());
  /**
   * PAR NOTE SALE, L'`updatedAt` DONT CETTE MODIFICATION EST PARTIE.
   *
   * Posé UNE SEULE FOIS, au moment où la note devient sale : les frappes
   * suivantes s'empilent sur la même base, puisque c'est bien de cette
   * version-là que la série descend. Vidé à chaque écriture réussie, en même
   * temps que le jeu des marques.
   *
   * À quoi ça sert : le processus principal refuse d'écrire une note dont le
   * disque porte, depuis, quelque chose de plus frais (`selectStaleDeltaEntries`).
   * Sans cette déclaration, le renderer donne un ORDRE que rien ne peut
   * vérifier — et c'est ainsi qu'une copie périmée a écrasé, puis remonté au
   * nuage, une fusion qui venait d'arriver.
   *
   * `null` = le renderer n'avait aucune copie (note neuve) : le main n'y voit
   * alors un conflit que si le disque, lui, en porte une.
   */
  const dirtyBaseRef = useRef<Map<string, string | null>>(new Map());
  /**
   * Vrai tant qu'on ne peut PAS prouver ce qui a changé : premier passage sans
   * base de comparaison, ou reprise après une écriture échouée en mode plein.
   * Dans ce cas on écrit tout — se tromper doit toujours pencher du côté « écrire
   * plus que nécessaire », jamais du côté « écrire un état partiel ».
   */
  const needsFullSaveRef = useRef<boolean>(true);

  // Mark notes as loaded once loadNotesFromDisk has actually run (observed via
  // isLoading going true → false). Simply checking `isLoading === false` is
  // not enough: the initial Redux state has isLoading=false from the start,
  // so the guard would pass before loadNotesFromDisk even fires. We track two
  // Initialize the OS downloads watcher bridge once a profile is selected.
  // Done after profile activation so FEK is loaded and addFileToFolder will
  // succeed if the watcher fires immediately.
  useEffect(() => {
    if (!profileSelected) return;
    initDownloadsWatcherBridge(store);
    initHotFoldersBridge(store);
    initClipReceiver();
    initDesktopProtectionBridge(store);
  }, [profileSelected]);

  // Protection du bureau : rapporter l'état de verrouillage au main process
  // (badge du tray, fenêtre mini). Indispensable pour les profils LOCAUX
  // (clé machine) : ils ne chargent jamais de session key main-side, donc
  // sans ce rapport le tray les croirait verrouillés en permanence. Couvre
  // le rapport initial (montage après sélection du profil) ET chaque
  // transition — le middleware pousse aussi les transitions lockApp/unlockApp
  // mais pas l'état initial d'un profil local sans écran de verrouillage.
  useEffect(() => {
    if (!profileSelected) return;
    pushRendererLockState(isLocked);
  }, [profileSelected, isLocked]);

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

    // Écriture effective de ce que le debounce retenait. Partagée entre le
    // timer et la purge forcée (`flushPendingNotesSave`) pour qu'il n'existe
    // qu'UN chemin d'écriture, avec la même garde.
    const runPendingSave = (): Promise<void> => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // CRITICAL GUARD: never save while the initial load hasn't completed.
      // Writing an empty {} at this point would overwrite real data on disk.
      if (!notesLoadedRef.current) {
        console.warn('[App] auto-save skipped: notes not yet loaded from disk');
        return Promise.resolve();
      }

      // Le jeu des marques est CONSOMMÉ ici, pas au retour de l'écriture : une
      // frappe qui arrive pendant l'écriture doit marquer la note pour la
      // PROCHAINE, pas se faire effacer par l'acquittement de celle-ci.
      const dirtyIds = Array.from(dirtyNoteIdsRef.current);
      const removedIds = Array.from(removedNoteIdsRef.current);
      const wasFull = needsFullSaveRef.current;
      // Les bases voyagent avec les notes qu'elles décrivent, et elles seules :
      // une base sans note sale ne veut rien dire pour le main.
      const baseUpdatedAt: Record<string, string | null> = {};
      for (const id of dirtyIds) {
        if (dirtyBaseRef.current.has(id)) {
          baseUpdatedAt[id] = dirtyBaseRef.current.get(id) ?? null;
        }
      }
      const previousBases = new Map(dirtyBaseRef.current);
      dirtyNoteIdsRef.current = new Set();
      removedNoteIdsRef.current = new Set();
      dirtyBaseRef.current = new Map();
      needsFullSaveRef.current = false;

      const options = wasFull ? undefined : { delta: { dirtyIds, removedIds, baseUpdatedAt } };
      return Promise.resolve(dispatch(saveNotesToDisk(options))).then((action: any) => {
        if (action?.meta?.requestStatus === 'rejected') {
          // Rien n'est parti sur le disque : les marques doivent revenir, sinon
          // la modification serait perdue pour de bon. Union avec ce qui a pu
          // être marqué entre-temps.
          for (const id of dirtyIds) dirtyNoteIdsRef.current.add(id);
          for (const id of removedIds) removedNoteIdsRef.current.add(id);
          // Les bases reviennent AVEC les marques : les remettre sans elles
          // ferait repartir la prochaine écriture sans garde, donc sans filet.
          // Une base reposée entre-temps n'est jamais remplacée — elle décrit
          // une modification plus récente, donc plus proche de la vérité.
          for (const [id, base] of previousBases) {
            if (!dirtyBaseRef.current.has(id)) dirtyBaseRef.current.set(id, base);
          }
          if (wasFull) needsFullSaveRef.current = true;
        }
      });
    };

    // La sync appelle ceci AVANT de recharger les notes du disque : sans cela,
    // un rechargement tombé dans la fenêtre de 2 s remplaçait `byId` et
    // emportait le geste en cours. Ne fait rien s'il n'y a pas d'écriture en
    // attente.
    registerNotesAutosaveFlush(() => (saveTimerRef.current ? runPendingSave() : Promise.resolve()));

    /**
     * L'ECRITURE EST ASSUREE A LA FERMETURE ET AU MASQUAGE.
     *
     * L'auto-sauvegarde attend deux secondes. Fermer la fenetre, quitter
     * l'application ou basculer sur autre chose pendant ces deux secondes
     * emportait la derniere frappe sans que rien ne le dise — le pire moment
     * pour perdre quelque chose, puisque c'est celui ou l'on croit avoir fini.
     *
     * `visibilitychange` couvre la reduction et le changement d'onglet ;
     * `beforeunload` couvre la fermeture. Les deux se contentent de vider la
     * file en attente : sans ecriture programmee, ils ne coutent rien.
     */
    const flushIfPending = () => {
      if (saveTimerRef.current) void runPendingSave();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushIfPending();
    };
    window.addEventListener('beforeunload', flushIfPending);
    document.addEventListener('visibilitychange', onVisibility);

    // `loadNotesFromDisk.fulfilled` remplace `byId` en bloc : l'état qui en sort
    // EST celui du disque. Le déclarer propre évite que le renouvellement
    // d'identité n'arme une écriture pleine de tout le coffre pour rien (le
    // middleware appelle ceci APRÈS cet abonné — voir markNotesStateClean).
    registerNotesDirtyReset(() => {
      prevNotesObjRef.current = store.getState().notes.byId;
      dirtyNoteIdsRef.current = new Set();
      removedNoteIdsRef.current = new Set();
      // Les bases décrivaient un disque que ce rechargement vient de remplacer :
      // les garder ferait refuser des écritures parfaitement légitimes.
      dirtyBaseRef.current = new Map();
      needsFullSaveRef.current = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    });

    const unsubscribe = store.subscribe(() => {
      const notesState = store.getState().notes;
      const nextById = notesState.byId;
      const prevById = prevNotesObjRef.current;
      if (nextById === prevById) return;
      prevNotesObjRef.current = nextById;

      if (!prevById) {
        // Aucune base de comparaison (premier changement observé) : on ne peut
        // rien prouver, donc on écrira tout.
        needsFullSaveRef.current = true;
      } else {
        // Immer renouvelle l'identité de CHAQUE note qu'un reducer touche, et
        // d'elle seule : la comparaison de références est donc exacte, sans que
        // les ~30 reducers du slice aient à déclarer quoi que ce soit.
        for (const id in nextById) {
          if (nextById[id] !== prevById[id]) {
            // La base n'est posée QU'À LA PREMIÈRE saleté depuis la dernière
            // écriture : c'est bien de cette version-là que toute la série de
            // frappes qui suit descend. L'écraser à chaque frappe ferait
            // déclarer comme base l'état qu'on vient soi-même de produire, et
            // la garde du main ne refuserait plus jamais rien.
            if (!dirtyBaseRef.current.has(id)) {
              const before = prevById[id];
              dirtyBaseRef.current.set(
                id,
                before && typeof before.updatedAt === 'string' ? before.updatedAt : null
              );
            }
            dirtyNoteIdsRef.current.add(id);
            removedNoteIdsRef.current.delete(id);
          }
        }
        for (const id in prevById) {
          if (nextById[id] === undefined) {
            // Suppression DÉFINITIVE (la corbeille, elle, garde la note dans
            // `byId` avec un `deletedAt` — elle passe donc par les notes sales).
            removedNoteIdsRef.current.add(id);
            dirtyNoteIdsRef.current.delete(id);
            // Une note purgée n'a plus de base à déclarer : `removedIds` n'est
            // pas gardé (voir selectStaleDeltaEntries).
            dirtyBaseRef.current.delete(id);
          }
        }
      }

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void runPendingSave();
      }, 2000); // 2s debounce
    });

    return () => {
      unsubscribe();
      window.removeEventListener('beforeunload', flushIfPending);
      document.removeEventListener('visibilitychange', onVisibility);
      registerNotesAutosaveFlush(null);
      registerNotesDirtyReset(null);
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
      // Le bandeau « choisissez un profil » a fait son office : la session en
      // attente a été adoptée (ou écartée) par `profile:activate`.
      setAddedAccountEmail(null);
      // CRITICAL: wipe any in-memory state from a previous profile before
      // the new profile's data is loaded. Without this, slices that survive
      // (tabs, trash, collections, favorites, …) leak across profiles —
      // including the previous profile's folder IDs which can then be
      // opened, viewed, and even deleted from the wrong profile.
      dispatch(resetAppData());
      setActiveProfile(profileId);
      // Le slice ui survit à resetAppData et son initialState a été calculé à
      // l'import du module, donc sous le profil précédent : sans ce rechargement
      // le chrome (barres, clic fichier, widget accueil, fonds animés) resterait
      // celui de l'autre profil pour toute la session.
      dispatch(hydrateDisplayPreferences());
      dispatch(initFromLocalStorage());
      dispatch(fetchManifest());

      // Hydrate the profile's space + org context. The space is fixed by the
      // account type (server-enforced), so we just restore it here — at
      // activation, not only when Settings opens — so enterprise gating is
      // correct app-wide from the first render.
      dispatch(initOrgContext());

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
        dispatch(lockApp('enhanced-lock'));
        setProfileSelected(true);
        setIsSwitching(false);
        return;
      }

      setProfileSelected(true);
      setIsSwitching(false);
      // ── LA CLÉ DU COFFRE D'ABORD, SON CONTENU ENSUITE ────────────────────
      //
      // Cet ordre n'est pas cosmétique. Sur le BUREAU, `notes:load` est servi
      // par le processus principal, qui détient sa propre clé : demander les
      // notes avant d'avoir installé la FEK dans le renderer ne se voyait pas.
      // Sur le WEB (app.filarr.com), c'est le renderer LUI-MÊME qui déchiffre
      // (`webStorageHandlers['notes:load']` → `decryptFileContent`) : la même
      // séquence levait « Hybrid crypto not initialized », le `.catch` posé
      // plus bas l'avalait, et l'écran des notes restait VIDE toute la session
      // — sans qu'aucun rechargement ne vienne, puisque la session n'ayant
      // jamais été verrouillée, la transition de déverrouillage (qui relance
      // folders + notes) ne se produit pas.
      //
      // Restaurer la clé ICI la rend disponible AVANT le premier déchiffrement
      // demandé, et ne coûte rien au bureau : `hybrid:loadFEK` y lit `.fek_safe`
      // en local, comme le navigateur lit son scellé de session.
      //
      // La DÉCISION de verrouillage, elle, reste où elle était — APRÈS les
      // dispatches — pour que `lockApp` ne précède jamais des canaux que la
      // porte IPC du coffre (`electron/vaultLockGate.ts`, qui garde `notes:load`,
      // `getFolders` et `layout:load`) refuserait alors sur le bureau.
      let restored = await tryRestoreFEKFromSafeStorage();
      console.info('[App] tryRestoreFEKFromSafeStorage returned:', restored);
      if (!restored && (await hasDeviceKeyWrap())) {
        // E5-4: the FEK cache is gone (logout / auto-lock / fresh launch) but this device is enrolled
        // for password-less SSO unlock — recover the FEK from the device-bound key, no vault password.
        try {
          await initFromDeviceKey();
          restored = hasHybridKey();
          console.info('[App] device-key unlock:', restored);
        } catch (e) {
          console.warn('[App] device-key unlock failed (will fall back to lock):', e);
        }
      }

      console.info('[App] dispatching fetchFolders + loadNotesFromDisk');
      dispatch(fetchFolders())
        .unwrap()
        .then((folders) => {
          console.info('[App] fetchFolders OK:', folders.length, 'folders');
          // Wipe any `/folder/<id>` tab whose id doesn't belong to the
          // newly-active profile. Without this, a persisted tab from a
          // previous profile keeps mounting FolderView, which dispatches
          // fetchFolder(id) and re-injects the foreign folder back into
          // state.folders.byId after our resetAppData wipe.
          dispatch(pruneOrphanFolderTabs(folders.map((f) => f.id)));
        })
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
      // MISE EN PAGE — réhydratation EXPLICITE, juste après `setActiveProfile`.
      // `layout` est blacklisté de redux-persist ET effacé par `resetAppData` :
      // sans ce dispatch, le profil qu'on vient d'ouvrir n'aurait aucune
      // disposition du tout. Le premier appel d'un profil neuf AMORCE le
      // conteneur à partir des préférences déjà exprimées (voir `layout:load`).
      dispatch(loadLayoutFromDisk())
        .unwrap()
        .then((res: { seeded: boolean }) =>
          console.info('[App] loadLayoutFromDisk OK, amorcé:', res?.seeded)
        )
        .catch((err) => console.error('[App] loadLayoutFromDisk FAILED:', err));

      if (!restored && enhancedLock) {
        console.info('[App] Enhanced Lock post-check: FEK restore failed → locking');
        dispatch(lockApp('enhanced-lock'));
      } else if (!restored && !hasHybridKey()) {
        // Coffre HYBRIDE sans FEK restaurable : sur web il n'y a rien au repos
        // par design (pas de safeStorage), sur desktop .fek_safe peut manquer
        // (effacé, nouveau poste). Si un wrapped key existe pour ce profil, le
        // contenu est chiffré FEK → même traitement que l'Enhanced Lock : le
        // VaultPasswordLock re-dérive la clé puis relance folders + notes.
        // Les profils purement locaux (clé machine, pas de wrapped key) ne
        // passent jamais ici — leur crypto vit côté main.
        // Un REJET n'est pas « pas de coffre » : sur le web le canal lève quand
        // la copie serveur de la clé est injoignable (réseau, 5xx) — ouvrir le
        // profil sans FEK rendrait tout illisible sans même demander le mot de
        // passe. On verrouille, l'écran de mot de passe retentera.
        const wrapped = await window.electron?.ipcRenderer
          ?.invoke('hybrid:loadWrappedKey')
          .catch(() => 'unavailable');
        if (wrapped) {
          console.info('[App] hybrid vault without restorable FEK → requiring vault password');
          dispatch(lockApp('no-key'));
        }
      }
    },
    [dispatch]
  );

  // ── L'INTENTION DE BASCULE, RELUE APRÈS LE RECHARGEMENT ──────────────────
  //
  // Le menu de compte change de profil en rechargeant la fenêtre (Header,
  // handleSwitchToProfile) : simple et sûr, mais `profileSelected` et
  // `launchSpace` sont locaux à ce composant et repartaient de zéro — portail
  // des espaces, puis sélecteur, pour rechoisir ce qu'on venait de choisir.
  // Le profil visé est DÉJÀ actif côté processus principal (`profile:activate`
  // a eu lieu avant le rechargement) ; il ne reste qu'à entrer, par le même
  // chemin que le sélecteur. Lue une fois, effacée aussitôt : une intention
  // ne vaut que pour le rechargement qu'elle précède.
  const switchIntentRef = useRef(false);
  useEffect(() => {
    if (switchIntentRef.current || showOnboarding === null) return;
    switchIntentRef.current = true;
    type SwitchIntent = { profileId?: unknown; space?: unknown };
    let intent: SwitchIntent | null = null;
    try {
      const raw = sessionStorage.getItem('filarr.switch-intent');
      sessionStorage.removeItem('filarr.switch-intent');
      intent = raw ? (JSON.parse(raw) as SwitchIntent) : null;
    } catch {
      intent = null;
    }
    if (showOnboarding || typeof intent?.profileId !== 'string' || !intent.profileId) return;
    setLaunchSpace(intent.space === 'enterprise' ? 'enterprise' : 'personal');
    void handleProfileSelected(intent.profileId);
  }, [showOnboarding, handleProfileSelected]);

  // Loading: waiting for onboarding flag check
  if (showOnboarding === null) {
    return <LoadingFallback />;
  }

  // No profile yet → onboarding first (creates profile inside)
  if (showOnboarding) {
    return (
      <>
        <PendingInviteBanner />
        <Onboarding onComplete={handleOnboardingComplete} />
      </>
    );
  }

  // Flow: Profile picker → Main app
  return (
    <ErrorBoundary>
      <NotificationProvider position="top-right" maxNotifications={5}>
        <SyncConflictHandler />
        {/* Les toasts dispatchés dans Redux par les services de fond (hot
            folders aujourd'hui) n'étaient rendus par personne : ce hôte les
            reverse dans la pile du Context. */}
        <ReduxNotificationsHost />
        {/* Avant le Router, l'écran d'acceptation ne peut pas exister : ce
            bandeau est la seule chose qui dise à l'invité que sa venue a été
            enregistrée et qu'il faut aller au bout de la création de compte. */}
        {!profileSelected && <PendingInviteBanner />}
        <LaunchScreen>
          {!profileSelected ? (
            addAccountSpace ? (
              <Onboarding
                initialSpace={addAccountSpace}
                initialAuthMode={addAccountMode}
                onComplete={() => {
                  setAddAccountSpace(null);
                  setAddedAccountEmail(null);
                  setLaunchSpace(addAccountSpace);
                }}
                onCancel={async () => {
                  // Renoncer révoque la session en attente : un jeton de
                  // rafraîchissement bien vivant ne doit pas survivre à une
                  // démarche explicitement abandonnée.
                  await discardPendingCloudSession();
                  setAddAccountSpace(null);
                  setLaunchSpace(addAccountSpace);
                }}
                onProfilesRestored={({ email }) => {
                  // Le compte en possède plusieurs : retour au sélecteur, où ils
                  // apparaissent désormais groupés sous son adresse. La session
                  // reste en attente — c'est le profil choisi qui l'adoptera.
                  setAddAccountSpace(null);
                  setLaunchSpace(addAccountSpace);
                  setAddedAccountEmail(email);
                }}
              />
            ) : launchSpace === null ? (
              <SpaceSelector onSelect={setLaunchSpace} />
            ) : (
              <ProfilePicker
                space={launchSpace}
                onChangeSpace={
                  isEnterpriseHidden()
                    ? undefined
                    : () => {
                        // Changer d'espace, c'est quitter la démarche : la
                        // session en attente n'a plus de profil à rejoindre.
                        if (addedAccountEmail) {
                          void discardPendingCloudSession();
                          setAddedAccountEmail(null);
                        }
                        setLaunchSpace(null);
                      }
                }
                onAddAccount={(space, mode) => {
                  // « J'ai déjà un compte » et « je n'en ai pas » n'ouvrent pas
                  // le même écran. Sans cette distinction, quelqu'un qui vient
                  // de créer son organisation sur le site atterrissait sur une
                  // inscription et repartait avec un SECOND compte.
                  setAddAccountMode(mode ?? 'login');
                  setAddAccountSpace(space);
                }}
                onProfileSelected={handleProfileSelected}
                highlightAccountEmail={addedAccountEmail ?? undefined}
                skipAutoSelect={isSwitching || !!addedAccountEmail}
              />
            )
          ) : (
            <Router>
              <ShortcutsInitializer>
                <CommandPaletteWrapper />
                {/* Wave 2 : draine la file d'ouvertures de conteneurs .filarr
                    (double-clic, registre) — monté uniquement déverrouillé,
                    LaunchScreen retire l'arbre entier au verrouillage. */}
                <FilarrBoxHost />
                {/* Wave 2b : draine les demandes « Protéger avec Filarr » du
                    clic droit Windows (--protect coalescé côté main) et ouvre
                    le dialogue Protéger sur place pré-rempli. Même cycle de
                    vie que FilarrBoxHost : la file survit au verrouillage. */}
                <ShellProtectHost />
                {/* Invitation reçue par e-mail : captée au chargement de la
                    page (avant tout rendu), elle attend ici que le profil soit
                    choisi et le coffre déverrouillé — accepter exige une
                    session ET la clé privée, qui ne quitte pas l'appareil. */}
                <PendingInviteHost />
                {/* L'autorité UNIQUE du chargement des coffres partagés (liste,
                    balayage des intentions, invitations reçues, « partagé
                    avec moi ») : les écrans ne font plus que lire. Même cycle
                    de vie que PendingInviteHost, pour les mêmes raisons. */}
                <VaultsBootstrapHost />
                {/* La propagation VIVANTE : ce que les AUTRES membres font
                    dans un coffre partagé arrive sans rechargement. Monté ici,
                    et ici seulement, pour la même raison que l'hôte ci-dessus :
                    un guetteur par écran, ce serait autant de minuteries
                    concurrentes que d'onglets ouverts. */}
                <VaultHeadsWatcher />
                {/* Le coup de coude vers les coffres partagés. Il ne bloque
                    rien et se tait dans la très grande majorité des cas — hors
                    mode nuage, sous cinq appareils actifs, après un écartement.
                    Monté ici, une seule fois, comme les autres hôtes. */}
                <AccountSharingNudge />
                {/* « Votre organisation ne vous couvre plus » : les quatre
                    conséquences d'une sortie d'org au même endroit, une fois,
                    plutôt qu'un 413 muet quelques jours plus tard. */}
                <OrgCoverageNotice />
                {/* Refus « trop d'appareils » : monté UNE fois, quel que soit
                    l'endroit d'où la connexion est partie. */}
                <DeviceLimitHost />
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
  // Fenêtre mini-mode (Wave 1 — Protection du bureau) : la seconde fenêtre
  // Electron charge le même index.html avec le hash '#/mini'. On branche ICI,
  // avant Provider/PersistGate/LaunchScreen : le Router n'est monté qu'après
  // la sélection de profil, donc une Route '/mini' serait inatteignable, et
  // le state Redux ne circule pas entre fenêtres de toute façon — MiniMode
  // est un arbre autonome alimenté par IPC. Jamais sur le web : pas de seconde
  // fenêtre, un hash '#/mini' fossile retombe sur l'app normale.
  if (!isWebPlatform() && window.location.hash.startsWith('#/mini')) {
    return (
      <ErrorBoundary>
        <MiniMode />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      {!isWebPlatform() && <WindowDragRegion />}
      <Provider store={store}>
        <PersistGate loading={<LoadingFallback />} persistor={persistor}>
          <AppContent />
        </PersistGate>
      </Provider>
    </ErrorBoundary>
  );
};

export default App;
