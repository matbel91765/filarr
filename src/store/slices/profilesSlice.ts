/**
 * Profiles Redux Slice
 *
 * Manages profile state in the renderer process.
 * Local-first: communicates via IPC with the Electron main process only.
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type {
  ProfileMetadata,
  ProfilesManifest,
  CreateProfileParams,
  UpdateProfileParams,
} from '../../types/profiles';

// ── Async Thunks ──

export const fetchManifest = createAsyncThunk('profiles/fetchManifest', async () => {
  const manifest = await window.electron.ipcRenderer.invoke('profile:getManifest');
  return manifest as ProfilesManifest;
});

export const createProfile = createAsyncThunk(
  'profiles/create',
  async (params: CreateProfileParams) => {
    const profile = await window.electron.ipcRenderer.invoke('profile:create', params);
    return profile as ProfileMetadata;
  }
);

export const updateProfile = createAsyncThunk(
  'profiles/update',
  async ({ profileId, updates }: { profileId: string; updates: UpdateProfileParams }) => {
    const profile = await window.electron.ipcRenderer.invoke('profile:update', profileId, updates);
    return profile as ProfileMetadata;
  }
);

export const deleteProfile = createAsyncThunk('profiles/delete', async (profileId: string) => {
  await window.electron.ipcRenderer.invoke('profile:delete', profileId);
  return profileId;
});

export const activateProfile = createAsyncThunk('profiles/activate', async (profileId: string) => {
  // Wipe the outgoing profile's FEK from memory BEFORE the IPC so that if
  // the renderer starts rendering list views before auth rehydrate lands,
  // it can't accidentally encrypt/decrypt with a stale key from the
  // previous profile.
  try {
    const { clearHybridCrypto } = await import('../../services/auth/hybridCrypto');
    clearHybridCrypto();
  } catch {
    /* non-fatal if module isn't loaded */
  }

  if (window.electron?.ipcRenderer) {
    await window.electron.ipcRenderer.invoke('profile:activate', profileId);
  }
  return profileId;
});

export const reorderProfiles = createAsyncThunk(
  'profiles/reorder',
  async (orderedIds: string[]) => {
    await window.electron.ipcRenderer.invoke('profile:reorder', orderedIds);
    return orderedIds;
  }
);

export const verifyPin = createAsyncThunk(
  'profiles/verifyPin',
  async ({ profileId, pin }: { profileId: string; pin: string }, { rejectWithValue }) => {
    const result = await window.electron.ipcRenderer.invoke('profile:verifyPin', profileId, pin);
    if (!result.success) {
      return rejectWithValue(result);
    }
    return { profileId };
  }
);

export const resetPin = createAsyncThunk(
  'profiles/resetPin',
  async ({ profileId, confirmName }: { profileId: string; confirmName: string }) => {
    await window.electron.ipcRenderer.invoke('profile:resetPin', profileId, confirmName);
    return profileId;
  }
);

export const updatePlan = createAsyncThunk('profiles/updatePlan', async (plan: string) => {
  const manifest = await window.electron.ipcRenderer.invoke('profile:updatePlan', plan);
  return manifest as ProfilesManifest;
});

// ── Slice ──

const profilesSlice = createSlice({
  name: 'profiles',
  initialState: {
    manifest: null as ProfilesManifest | null,
    activeProfileId: null as string | null,
    loading: false,
    error: null as string | null,
    pinVerifying: false,
    pinError: null as string | null,
    pinLockedUntil: null as number | null,
  },
  reducers: {
    clearPinError(state) {
      state.pinError = null;
      state.pinLockedUntil = null;
    },
    setActiveProfileId(state, action: PayloadAction<string | null>) {
      state.activeProfileId = action.payload;
    },
  },
  extraReducers: (builder) => {
    // fetchManifest
    builder
      .addCase(fetchManifest.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchManifest.fulfilled, (state, action) => {
        state.loading = false;
        state.manifest = action.payload;
        state.activeProfileId = action.payload.activeProfileId;
      })
      .addCase(fetchManifest.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? 'Failed to load profiles';
      });

    // createProfile
    builder.addCase(createProfile.fulfilled, (state, action) => {
      if (state.manifest) {
        state.manifest.profiles.push(action.payload);
      }
    });

    // updateProfile
    builder.addCase(updateProfile.fulfilled, (state, action) => {
      if (state.manifest) {
        const idx = state.manifest.profiles.findIndex((p) => p.id === action.payload.id);
        if (idx !== -1) {
          state.manifest.profiles[idx] = action.payload;
        }
      }
    });

    // deleteProfile
    builder.addCase(deleteProfile.fulfilled, (state, action) => {
      if (state.manifest) {
        state.manifest.profiles = state.manifest.profiles.filter((p) => p.id !== action.payload);
        // If deleted profile was active, clear activeProfileId so ProfilePicker shows
        if (state.activeProfileId === action.payload) {
          state.activeProfileId = null;
        }
      }
    });

    // activateProfile
    builder.addCase(activateProfile.fulfilled, (state, action) => {
      state.activeProfileId = action.payload;
      if (state.manifest) {
        state.manifest.activeProfileId = action.payload;
      }
    });

    // reorderProfiles
    builder.addCase(reorderProfiles.fulfilled, (state, action) => {
      if (state.manifest) {
        const orderedIds = action.payload;
        const reordered: ProfileMetadata[] = [];
        for (let i = 0; i < orderedIds.length; i++) {
          const profile = state.manifest.profiles.find((p) => p.id === orderedIds[i]);
          if (profile) {
            profile.order = i;
            reordered.push(profile);
          }
        }
        state.manifest.profiles = reordered;
      }
    });

    // verifyPin
    builder
      .addCase(verifyPin.pending, (state) => {
        state.pinVerifying = true;
        state.pinError = null;
      })
      .addCase(verifyPin.fulfilled, (state) => {
        state.pinVerifying = false;
        state.pinError = null;
        state.pinLockedUntil = null;
      })
      .addCase(verifyPin.rejected, (state, action) => {
        state.pinVerifying = false;
        const payload = action.payload as { lockedUntil?: number } | undefined;
        state.pinLockedUntil = payload?.lockedUntil ?? null;
        state.pinError = payload?.lockedUntil ? 'Profile is temporarily locked' : 'Incorrect PIN';
      });

    // resetPin
    builder.addCase(resetPin.fulfilled, (state, action) => {
      if (state.manifest) {
        const profile = state.manifest.profiles.find((p) => p.id === action.payload);
        if (profile) {
          profile.pinHash = undefined;
          profile.pinSalt = undefined;
          profile.pinAttempts = 0;
          profile.pinLockedUntil = undefined;
          profile.allowPinReset = undefined;
        }
      }
      state.pinError = null;
      state.pinLockedUntil = null;
    });

    // updatePlan
    builder.addCase(updatePlan.fulfilled, (state, action) => {
      state.manifest = action.payload;
    });
  },
});

export type ProfilesState = ReturnType<typeof profilesSlice.reducer>;
export const { clearPinError, setActiveProfileId } = profilesSlice.actions;
export default profilesSlice.reducer;
