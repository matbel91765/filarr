/**
 * Redux slice — E2EE shares
 *
 * Tracks the owner's active shares plus the create-flow state machine:
 *   idle → creating (with progress) → success (URL ready) | error
 *
 * Upload progress is per-share; the modal binds to `creating` + `progress`
 * to render a progress bar. Once the share is done, the URL lands in
 * `lastCreated` for the success view, then gets cleared when the modal
 * closes (the URL never needs to persist — losing it means revoke + recreate).
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import {
  createShare as svcCreateShare,
  listShares as svcListShares,
  revokeShare as svcRevokeShare,
  type CreateShareOptions,
  type CreatedShare,
  type ShareListItem,
} from '../../services/sharing/shareService';

// ── State ──────────────────────────────────────────────────────────────────

export interface SharesState {
  items: ShareListItem[];
  lastCreated: CreatedShare | null;
  loading: boolean;
  creating: boolean;
  /** [bytesUploaded, totalBytes] — null when not actively uploading */
  progress: { uploaded: number; total: number } | null;
  revokingId: string | null;
  error: string | null;
}

const initialState: SharesState = {
  items: [],
  lastCreated: null,
  loading: false,
  creating: false,
  progress: null,
  revokingId: null,
  error: null,
};

// ── Thunks ─────────────────────────────────────────────────────────────────

export const createShareThunk = createAsyncThunk<
  CreatedShare,
  Omit<CreateShareOptions, 'onProgress'>,
  { rejectValue: string }
>('shares/create', async (opts, { rejectWithValue, dispatch }) => {
  try {
    return await svcCreateShare({
      ...opts,
      // Forward progress to the slice so the UI can render a bar without
      // having to subscribe to a separate event channel.
      onProgress: (uploaded, total) => {
        dispatch(sharesSlice.actions.setProgress({ uploaded, total }));
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return rejectWithValue(msg);
  }
});

export const loadSharesThunk = createAsyncThunk<ShareListItem[], void, { rejectValue: string }>(
  'shares/load',
  async (_, { rejectWithValue }) => {
    try {
      return await svcListShares();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return rejectWithValue(msg);
    }
  }
);

export const revokeShareThunk = createAsyncThunk<string, string, { rejectValue: string }>(
  'shares/revoke',
  async (shareId, { rejectWithValue }) => {
    try {
      await svcRevokeShare(shareId);
      return shareId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return rejectWithValue(msg);
    }
  }
);

// ── Slice ──────────────────────────────────────────────────────────────────

const sharesSlice = createSlice({
  name: 'shares',
  initialState,
  reducers: {
    setProgress(state, action: PayloadAction<{ uploaded: number; total: number }>) {
      state.progress = action.payload;
    },
    clearLastCreated(state) {
      state.lastCreated = null;
      state.progress = null;
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // create
      .addCase(createShareThunk.pending, (state) => {
        state.creating = true;
        state.progress = { uploaded: 0, total: 0 };
        state.error = null;
      })
      .addCase(createShareThunk.fulfilled, (state, action: PayloadAction<CreatedShare>) => {
        state.creating = false;
        state.progress = null;
        state.lastCreated = action.payload;
      })
      .addCase(createShareThunk.rejected, (state, action) => {
        state.creating = false;
        state.progress = null;
        state.error = action.payload || 'Failed to create share';
      })
      // load
      .addCase(loadSharesThunk.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadSharesThunk.fulfilled, (state, action: PayloadAction<ShareListItem[]>) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(loadSharesThunk.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Failed to load shares';
      })
      // revoke
      .addCase(revokeShareThunk.pending, (state, action) => {
        state.revokingId = action.meta.arg;
        state.error = null;
      })
      .addCase(revokeShareThunk.fulfilled, (state, action: PayloadAction<string>) => {
        state.revokingId = null;
        const item = state.items.find((s) => s.shareId === action.payload);
        if (item) {
          item.revokedAt = Date.now();
          item.active = false;
        }
      })
      .addCase(revokeShareThunk.rejected, (state, action) => {
        state.revokingId = null;
        state.error = action.payload || 'Failed to revoke share';
      });
  },
});

export const { setProgress, clearLastCreated, clearError } = sharesSlice.actions;
export default sharesSlice.reducer;
