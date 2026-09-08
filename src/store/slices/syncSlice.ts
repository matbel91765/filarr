/**
 * Redux Slice — Cloud Sync Status
 *
 * Tracks sync engine state for UI indicators.
 * Updated via IPC events from the main process (sync-status-changed).
 * fileStatuses populated via sync:getAllFileStatuses (batch, no per-item IPC).
 *
 * Only active when accountMode === 'cloud'.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { nextSmoothedRate, etaSeconds, MIN_SAMPLES_FOR_ETA } from '../../utils/transferStats';

// ── Types ───────────────────────────────────────────────────────────────────

export type SyncState = 'idle' | 'syncing' | 'error' | 'offline';
export type FileStatus =
  | 'synced'
  | 'pending_upload'
  | 'pending_download'
  | 'conflict'
  | 'deleted'
  | 'cloud-only'
  // Fichier trop volumineux pour la synchronisation cloud (garde V3 > 500 Mo)
  | 'local_only';

/**
 * Live byte-level progress for a single in-flight transfer.
 * Populated from the `sync-file-status-changed` IPC emit when it carries
 * transferredBytes/totalBytes; absent for older/coarse emit paths.
 */
export interface FileTransferProgress {
  transferredBytes: number;
  totalBytes: number;
  /** Bytes at the last rate-anchor sample (for the next delta). */
  lastBytes: number;
  /** Wall-clock ms of the last rate-anchor sample. */
  lastTs: number;
  /** Smoothed transfer rate in bytes/second (0 until an interval is measured). */
  rate: number;
  /** Seconds remaining, or null while no stable rate exists / at completion boundary. */
  etaSeconds: number | null;
  /** Number of progress samples folded in (gates when an ETA becomes visible). */
  samples: number;
}

export interface SyncSliceState {
  state: SyncState;
  /**
   * Raison du dernier échec de cycle, telle que le moteur l'a nommée. Un état
   * `error` sans message rendait le bouton rouge sans le moindre indice —
   * surtout pour un cycle AUTOMATIQUE, qui n'affiche aucune bulle. Remis à
   * `null` dès qu'un cycle aboutit.
   */
  lastError: string | null;
  lastSyncAt: string | null;
  pendingItems: number;
  failedItems: number;
  conflicts: number;
  storageUsed: number;
  storageLimit: number;
  totalItemsAtSyncStart: number;
  fileStatuses: Record<string, FileStatus>;
  // Per-file live transfer progress, keyed identically to fileStatuses
  // (by fileId AND by localPath). Only holds currently in-flight transfers.
  fileProgress: Record<string, FileTransferProgress>;
  trialExpired: boolean;
}

// ── Initial State ───────────────────────────────────────────────────────────

const initialState: SyncSliceState = {
  state: 'idle',
  lastError: null,
  lastSyncAt: null,
  pendingItems: 0,
  failedItems: 0,
  conflicts: 0,
  storageUsed: 0,
  storageLimit: 0,
  totalItemsAtSyncStart: 0,
  fileStatuses: {},
  fileProgress: {},
  trialExpired: false,
};

// Statuses during which a live byte-progress entry is meaningful.
const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(['pending_upload', 'pending_download']);

// ── Slice ───────────────────────────────────────────────────────────────────

const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    setSyncStatus(
      state,
      action: PayloadAction<{
        state?: SyncState;
        /** Raison de l'échec, quand `state === 'error'`. */
        error?: string | null;
        lastSyncAt?: string | null;
        pendingItems?: number;
        failedItems?: number;
        conflicts?: number;
        trialExpired?: boolean;
      }>
    ) {
      if (!action.payload) return;
      if (action.payload.state !== undefined) state.state = action.payload.state;
      // Le message suit l'état : il arrive avec l'échec, et TOUT état non-`error`
      // l'efface (sinon une vieille raison collerait au bouton pour toujours).
      if (action.payload.error !== undefined) {
        state.lastError = action.payload.error ?? null;
      } else if (action.payload.state !== undefined && action.payload.state !== 'error') {
        state.lastError = null;
      }
      if (action.payload.lastSyncAt !== undefined) state.lastSyncAt = action.payload.lastSyncAt;
      if (action.payload.pendingItems !== undefined)
        state.pendingItems = action.payload.pendingItems;
      if (action.payload.failedItems !== undefined) state.failedItems = action.payload.failedItems;
      if (action.payload.conflicts !== undefined) state.conflicts = action.payload.conflicts;
      if (action.payload.trialExpired !== undefined)
        state.trialExpired = action.payload.trialExpired;

      // Capture totalItems when we first receive a non-zero pendingItems during syncing
      const pending = action.payload.pendingItems;
      if (
        action.payload.state === 'syncing' &&
        pending !== undefined &&
        pending > 0 &&
        state.totalItemsAtSyncStart === 0
      ) {
        state.totalItemsAtSyncStart = pending;
      }

      // Reset totalItems when sync completes
      if (action.payload.state === 'idle' && pending === 0) {
        state.totalItemsAtSyncStart = 0;
      }
    },

    setStorageInfo(state, action: PayloadAction<{ storageUsed: number; storageLimit: number }>) {
      state.storageUsed = action.payload.storageUsed;
      state.storageLimit = action.payload.storageLimit;
    },

    setFileStatuses(state, action: PayloadAction<Record<string, FileStatus>>) {
      state.fileStatuses = action.payload;
    },

    /**
     * Fold a byte-level progress sample for an in-flight transfer, keyed by one
     * or more identifiers (fileId + localPath). Computes a smoothed rate + ETA
     * incrementally. Drops the entry once the transfer leaves the in-flight set
     * or reaches completion, so the badge falls back to the coarse status.
     *
     * Monotonic-safe: ignores negative byte deltas (retry), guards divide-by-zero
     * (0-byte / completion), and only advances the rate anchor on a positive
     * time interval so duplicate samples don't undercount the rate.
     */
    setFileProgress(
      state,
      action: PayloadAction<{
        keys: string[];
        status?: string;
        transferredBytes: number;
        totalBytes: number;
        at: number;
      }>
    ) {
      const { keys, status, transferredBytes, totalBytes, at } = action.payload;
      if (!keys || keys.length === 0) return;

      const inFlight = status === undefined || IN_FLIGHT_STATUSES.has(status);
      const complete = totalBytes > 0 && transferredBytes >= totalBytes;

      for (const key of keys) {
        if (!key) continue;

        // Left the in-flight set or finished → drop the live entry.
        if (!inFlight || complete) {
          delete state.fileProgress[key];
          continue;
        }

        const prev = state.fileProgress[key];

        // New file, or a reset/retry (bytes went backwards) → reseed, no rate yet.
        if (!prev || transferredBytes < prev.transferredBytes) {
          state.fileProgress[key] = {
            transferredBytes,
            totalBytes,
            lastBytes: transferredBytes,
            lastTs: at,
            rate: 0,
            etaSeconds: null,
            samples: 1,
          };
          continue;
        }

        // Only advance the rate anchor on a real (positive) interval; percent
        // (transferredBytes) always tracks the latest sample.
        const dtMs = at - prev.lastTs;
        let rate = prev.rate;
        let lastBytes = prev.lastBytes;
        let lastTs = prev.lastTs;
        let samples = prev.samples;
        if (dtMs > 0 && transferredBytes >= prev.lastBytes) {
          rate = nextSmoothedRate(prev.rate, prev.lastBytes, prev.lastTs, transferredBytes, at);
          lastBytes = transferredBytes;
          lastTs = at;
          samples = prev.samples + 1;
        }

        const eta =
          samples >= MIN_SAMPLES_FOR_ETA ? etaSeconds(totalBytes - transferredBytes, rate) : null;

        state.fileProgress[key] = {
          transferredBytes,
          totalBytes,
          lastBytes,
          lastTs,
          rate,
          etaSeconds: eta,
          samples,
        };
      }
    },

    resetSync() {
      return initialState;
    },
  },
});

export const { setSyncStatus, setStorageInfo, setFileStatuses, setFileProgress, resetSync } =
  syncSlice.actions;

export default syncSlice.reducer;
