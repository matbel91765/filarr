/**
 * useSyncStatus — React hook for sync engine status
 *
 * Reads from syncSlice Redux state (populated by IPC listeners in electronMiddleware).
 * No polling — all updates come via IPC events.
 *
 * Also fetches initial status on mount via sync:getStatus IPC.
 */

import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../store';
import { setSyncStatus, setStorageInfo, setFileStatuses } from '../store/slices/syncSlice';
import type { SyncSliceState, SyncState } from '../store/slices/syncSlice';
import { selectProfileIsCloud } from '../store/selectors/authSelectors';

/**
 * Verdict d'un cycle manuel, tel que le rendent les DEUX plateformes : le main
 * renvoie un SyncStatus (electron/sync/syncService.ts:790-800), le web un
 * compte rendu de cycle manuel (platform/web/sync/syncScheduler.ts). Seul
 * `state` est commun — c'est sur lui que l'appelant décide.
 */
export interface TriggerSyncResult {
  state: SyncState;
  error?: string;
  /** Web : un cycle tournait déjà, celui-ci l'a rejoint. */
  alreadyRunning?: boolean;
  /** Web : exécuté par l'onglet meneur à notre demande. */
  delegated?: boolean;
}

export function useSyncStatus(): SyncSliceState & {
  isCloud: boolean;
  syncProgress: number;
  triggerSync: () => Promise<TriggerSyncResult>;
} {
  const dispatch = useDispatch();
  const sync = useSelector((state: RootState) => state.sync);
  const profileIsCloud = useSelector(selectProfileIsCloud);
  const accountMode = useSelector((state: RootState) => state.auth.accountMode);
  const activeProfileId = useSelector((state: RootState) => state.profiles?.activeProfileId);

  // Listen for trial expiry notification
  useEffect(() => {
    if (accountMode !== 'cloud') return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    const onTrialExpired = () => {
      dispatch(setSyncStatus({ trialExpired: true }));
    };

    ipc.on('sync-trial-expired', onTrialExpired);
    return () => {
      ipc.removeListener('sync-trial-expired', onTrialExpired);
    };
  }, [accountMode, dispatch]);

  // Fetch initial status on mount
  useEffect(() => {
    if (accountMode !== 'cloud') return;

    window.electron?.ipcRenderer
      ?.invoke('sync:getStatus')
      .then((status: any) => {
        if (status) {
          dispatch(
            setSyncStatus({
              state: status.state || 'idle',
              lastSyncAt: status.lastSyncAt || null,
              pendingItems: status.pendingItems || 0,
              failedItems: status.failedItems || 0,
              conflicts: status.conflicts || 0,
            })
          );
          if (status.storageUsed != null) {
            dispatch(
              setStorageInfo({
                storageUsed: status.storageUsed,
                storageLimit: status.storageLimit,
              })
            );
          }
        }
      })
      .catch(() => {});

    // Fetch initial file statuses using local profile ID
    if (activeProfileId) {
      window.electron?.ipcRenderer
        ?.invoke('sync:getAllFileStatuses', activeProfileId)
        .then((statuses: Record<string, string>) => {
          if (statuses) dispatch(setFileStatuses(statuses as any));
        })
        .catch(() => {});
    }
  }, [accountMode, activeProfileId, dispatch]);

  // Calculate progress
  const syncProgress =
    sync.totalItemsAtSyncStart > 0
      ? Math.round(
          ((sync.totalItemsAtSyncStart - sync.pendingItems) / sync.totalItemsAtSyncStart) * 100
        )
      : 0;

  // Le verdict est RENDU à l'appelant : l'avaler ici (c'était le cas) laissait
  // le bouton « Synchroniser » sans le moindre retour, succès comme échec.
  const triggerSync = async (): Promise<TriggerSyncResult> => {
    try {
      const result = await window.electron?.ipcRenderer?.invoke('sync:triggerSync', '');
      if (result && typeof result === 'object') return result as TriggerSyncResult;
      return { state: 'error', error: 'Synchronisation indisponible' };
    } catch (err) {
      return { state: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  };

  return {
    ...sync,
    /**
     * ⚠ LE PROFIL, PAS LA SESSION.
     *
     * Toute la famille « synchronisation » (l'icône d'en-tête, la barre de
     * progression, le quota) passe par ce crochet. Elle lisait `accountMode`,
     * c'est-à-dire « une session est ouverte dans ce navigateur » — un fait qui
     * revient tout seul par le cookie de domaine, et qui ne dit rien de ce
     * profil-ci.
     *
     * D'où l'icône verte « Activée » sur un profil local que le moteur refuse
     * de synchroniser à chaque cycle. Voir `selectProfileIsCloud`.
     */
    isCloud: profileIsCloud,
    syncProgress,
    triggerSync,
  };
}
