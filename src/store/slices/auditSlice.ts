/**
 * auditSlice.ts (E7-5) — renderer state for the admin audit-log screen.
 *
 * Read-only projection of the server's tamper-evident journal (E7). Blacklisted from
 * redux-persist (server is the source of truth; no need to cache a paginated window).
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import {
  apiGetAuditEvents,
  apiVerifyAuditChain,
  type AuditEvent,
  type AuditChainStatus,
  type AuditEventsQuery,
} from '../../services/audit/auditApi';

/** Load a page; `append` adds to the list (infinite scroll), else replaces it. */
export const loadAuditEvents = createAsyncThunk(
  'audit/load',
  async (args: { query: AuditEventsQuery; append: boolean }, { rejectWithValue }) => {
    try {
      const page = await apiGetAuditEvents(args.query);
      return { ...page, append: args.append };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'Failed to load audit events');
    }
  }
);

export const checkAuditIntegrity = createAsyncThunk(
  'audit/verify',
  async (_: void, { rejectWithValue }) => {
    try {
      return await apiVerifyAuditChain();
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'Failed to verify chain');
    }
  }
);

export interface AuditState {
  events: AuditEvent[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  integrity: AuditChainStatus | null;
  verifying: boolean;
}

const initialState: AuditState = {
  events: [],
  nextCursor: null,
  loading: false,
  error: null,
  integrity: null,
  verifying: false,
};

const auditSlice = createSlice({
  name: 'audit',
  initialState,
  reducers: {
    clearAudit(state) {
      state.events = [];
      state.nextCursor = null;
      state.integrity = null;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadAuditEvents.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadAuditEvents.fulfilled, (state, action) => {
        state.loading = false;
        state.events = action.payload.append
          ? [...state.events, ...action.payload.events]
          : action.payload.events;
        state.nextCursor = action.payload.nextCursor;
      })
      .addCase(loadAuditEvents.rejected, (state, action) => {
        state.loading = false;
        state.error = (action.payload as string) ?? 'Failed to load audit events';
      })
      .addCase(checkAuditIntegrity.pending, (state) => {
        state.verifying = true;
      })
      .addCase(checkAuditIntegrity.fulfilled, (state, action) => {
        state.verifying = false;
        state.integrity = action.payload;
      })
      .addCase(checkAuditIntegrity.rejected, (state) => {
        state.verifying = false;
      });
  },
});

export const { clearAudit } = auditSlice.actions;
export default auditSlice.reducer;

// ── Selectors ──────────────────────────────────────────────────────────────
interface WithAudit {
  audit: AuditState;
}
export const selectAuditEvents = (s: WithAudit): AuditEvent[] => s.audit.events;
export const selectAuditNextCursor = (s: WithAudit): string | null => s.audit.nextCursor;
export const selectAuditLoading = (s: WithAudit): boolean => s.audit.loading;
export const selectAuditError = (s: WithAudit): string | null => s.audit.error;
export const selectAuditIntegrity = (s: WithAudit): AuditChainStatus | null => s.audit.integrity;
export const selectAuditVerifying = (s: WithAudit): boolean => s.audit.verifying;
