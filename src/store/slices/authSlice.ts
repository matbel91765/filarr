/**
 * Redux Slice — Authentication (local-only).
 *
 * Local mode only: the app is always considered authenticated; the only
 * gating mechanism is the optional PIN / vault password lock.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import profileStorage from '../../services/core/profileStorage';

export interface LocalProfile {
  name: string;
  avatarColor: string;
  createdAt: string;
  hasPin?: boolean;
  /** @deprecated kept for migration from older versions that stored the hash */
  pinHash?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  loading: boolean;
  isLocked: boolean;
  localProfile: LocalProfile | null;
}

const LOCAL_PROFILE_KEY = 'filarr-local-profile';

function loadLocalProfile(): LocalProfile | null {
  try {
    const stored = profileStorage.getItem(LOCAL_PROFILE_KEY);
    if (stored) return JSON.parse(stored);

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

const savedProfile = loadLocalProfile();

const initialState: AuthState = {
  isAuthenticated: true,
  loading: false,
  isLocked: false,
  localProfile: savedProfile,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
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

    lockApp(state) {
      state.isLocked = true;
    },

    unlockApp(state) {
      state.isLocked = false;
    },

    setAuthLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
  },
});

export const {
  initFromLocalStorage,
  setLocalProfile,
  setPin,
  lockApp,
  unlockApp,
  setAuthLoading,
} = authSlice.actions;

export default authSlice.reducer;
