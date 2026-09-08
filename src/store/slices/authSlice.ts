/**
 * Redux Slice — Authentication
 *
 * Supports two modes:
 *   - local:  offline-only, no account, isAuthenticated always true
 *   - cloud:  Filarr account with sync, tokens managed in main process
 *
 * IMPORTANT: Tokens are NEVER stored in Redux. Only UI state lives here.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import profileStorage from '../../services/core/profileStorage';
import type { UserDTO } from '../../types/auth';

// ── Types ───────────────────────────────────────────────────────────────────

export interface LocalProfile {
  name: string;
  avatarColor: string;
  createdAt: string;
  /** Whether a PIN is configured — the hash itself is only in profileManager (main process) */
  hasPin?: boolean;
  /** @deprecated kept for migration from older versions that stored the hash */
  pinHash?: string;
}

/**
 * POURQUOI l'ecran de verrouillage est la. Sans ce motif, les six chemins qui
 * verrouillent (inactivite, Enhanced Lock, cle absente, deconnexion, politique
 * d'organisation, geste manuel) rendent tous le meme ecran muet, et la seule
 * facon de savoir pourquoi l'application redemande le mot de passe etait de
 * lire le code.
 */
export type LockReason = 'auto-lock' | 'enhanced-lock' | 'no-key' | 'logout' | 'policy' | 'manual';

export interface AuthState {
  // Common
  isAuthenticated: boolean;
  loading: boolean;
  isLocked: boolean;
  /** Motif du dernier verrouillage. Jamais persiste, comme `isLocked`. */
  lockReason: LockReason | null;
  accountMode: 'local' | 'cloud';
  /**
   * L'ADRESSE A LAQUELLE LE PROFIL ACTIF EST RATTACHE, ou `null`.
   *
   * A ne pas confondre avec `accountMode`, qui ne parle que de la SESSION du
   * navigateur. Un profil local ouvert pendant qu'une session traine donne
   * `accountMode: 'cloud'` et `profileAttachedTo: null` -- c'est exactement
   * l'etat ou la synchronisation refuse tout, et ou l'ecran affichait pourtant
   * « activee ».
   */
  profileAttachedTo: string | null;

  // Local mode
  localProfile: LocalProfile | null;

  // Cloud mode (tokens are in safeStorage, never here)
  cloudUser: UserDTO | null;
  cloudError: string | null;
  syncEnabled: boolean;
}

// ── Local Profile Persistence ───────────────────────────────────────────────

const LOCAL_PROFILE_KEY = 'filarr-local-profile';

function loadLocalProfile(): LocalProfile | null {
  try {
    const stored = profileStorage.getItem(LOCAL_PROFILE_KEY);
    if (stored) return JSON.parse(stored);

    // Migration: profile may have been saved under a prefixed key
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.endsWith(':' + LOCAL_PROFILE_KEY) && key.startsWith('p:')) {
        const value = localStorage.getItem(key);
        if (value) {
          localStorage.setItem(LOCAL_PROFILE_KEY, value);
          localStorage.removeItem(key);
          return JSON.parse(value);
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── Initial State ───────────────────────────────────────────────────────────

const savedProfile = loadLocalProfile();

const initialState: AuthState = {
  isAuthenticated: true,
  loading: false,
  isLocked: false,
  lockReason: null,
  accountMode: 'local',
  profileAttachedTo: null,

  localProfile: savedProfile,

  cloudUser: null,
  cloudError: null,
  syncEnabled: false,
};

// ── Slice ───────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // ── Local mode ────────────────────────────────────────────────────

    initFromLocalStorage(state) {
      const profile = loadLocalProfile();
      if (profile) {
        if (profile.pinHash) {
          profile.hasPin = true;
          delete profile.pinHash;
          profileStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
        }
      }
      state.localProfile = profile || null;
      state.isAuthenticated = true;

      if (profile?.hasPin) {
        state.isLocked = true;
      }
    },

    setLocalProfile(state, action: PayloadAction<LocalProfile>) {
      const { pinHash, ...safeProfile } = action.payload;
      const toStore = { ...safeProfile, hasPin: safeProfile.hasPin || !!pinHash };
      state.localProfile = toStore;
      state.isAuthenticated = true;
      profileStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(toStore));
    },

    setPin(state, action: PayloadAction<boolean>) {
      if (state.localProfile) {
        state.localProfile.hasPin = action.payload;
        delete state.localProfile.pinHash;
        profileStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(state.localProfile));
      }
    },

    lockApp(state, action: PayloadAction<LockReason | undefined>) {
      state.isLocked = true;
      state.lockReason = action.payload ?? null;
    },

    unlockApp(state) {
      state.isLocked = false;
      state.lockReason = null;
    },

    // ── Cloud mode ───────────────────────────────────────────────────

    setCloudAuth(state, action: PayloadAction<UserDTO>) {
      state.cloudUser = action.payload;
      state.accountMode = 'cloud';
      state.isAuthenticated = true;
      state.cloudError = null;
    },

    clearCloudAuth(state) {
      state.cloudUser = null;
      state.accountMode = 'local';
      state.cloudError = null;
      state.syncEnabled = false;
      // isAuthenticated stays true — local mode is always authenticated.
      // The persisted `sync-paused` flag in main-process filarr-flags.json
      // is cleared by the caller via `sync:setEnabled(true)` if they want a
      // fresh default for a future cloud re-login.
    },

    setAuthLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },

    setAuthError(state, action: PayloadAction<string | null>) {
      state.cloudError = action.payload;
    },

    setSyncEnabled(state, action: PayloadAction<boolean>) {
      // Pure Redux state update. The main process is the source of truth
      // for persistence + actually starting/stopping the sync daemon — see
      // `window.electron.ipcRenderer.invoke('sync:setEnabled', bool)` which
      // must be called alongside this action. Callers should use the helper
      // in authApi (`setSyncEnabled`) instead of dispatching this directly.
      state.syncEnabled = action.payload;
    },

    // ── Hydrate from main process on startup ─────────────────────────

    hydrateAuthStatus(
      state,
      action: PayloadAction<{
        isAuthenticated: boolean;
        user: UserDTO | null;
        accountMode: 'local' | 'cloud';
        syncPaused?: boolean;
        /** Absent sur le bureau, où la session VIT dans le profil. */
        profileAttachedTo?: string | null;
      }>
    ) {
      const { isAuthenticated, user, accountMode, syncPaused, profileAttachedTo } = action.payload;
      state.accountMode = accountMode;
      state.cloudUser = user;
      /**
       * ⚠ `undefined` et `null` ne disent PAS la même chose.
       *
       * `undefined` = « cette plateforme ne distingue pas les deux » : sur le
       * bureau, la session vit dans le profil, les deux faits n'en font qu'un.
       * On retombe alors sur l'adresse de la session, qui est la vérité là-bas.
       *
       * `null` = « le web a regardé, et ce profil n'est rattaché à rien ». Un
       * `?? user?.email` sur ce cas-là effacerait précisément l'information
       * qu'on vient d'ajouter.
       */
      state.profileAttachedTo =
        profileAttachedTo === undefined ? (user?.email ?? null) : profileAttachedTo;
      if (accountMode === 'cloud' && isAuthenticated) {
        // Pause flag is authoritative — comes from main-process filarr-flags.json
        state.syncEnabled = !syncPaused;
      }
    },
  },
});

export const {
  initFromLocalStorage,
  setLocalProfile,
  setPin,
  lockApp,
  unlockApp,
  setCloudAuth,
  clearCloudAuth,
  setAuthLoading,
  setAuthError,
  setSyncEnabled,
  hydrateAuthStatus,
} = authSlice.actions;

export default authSlice.reducer;
