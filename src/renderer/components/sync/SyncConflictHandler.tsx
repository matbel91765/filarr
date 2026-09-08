/**
 * SyncConflictHandler — Shows toasts for sync conflicts and quota exceeded
 *
 * Uses useNotification() (React Context) to display toasts.
 * Listens to IPC events directly — electronMiddleware can't show toasts
 * because the notification system is Context-based, not Redux-based.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useNotification } from '../ui/Notification';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';

const SyncConflictHandler: React.FC = () => {
  const { notify } = useNotification();
  const accountMode = useSelector((state: RootState) => state.auth.accountMode);
  const quotaShownRef = useRef(false);
  const conflictsHandledRef = useRef(new Set<string>());

  // Stable reference for notify to avoid effect re-runs
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const showQuotaToast = useCallback(() => {
    if (quotaShownRef.current) return;
    quotaShownRef.current = true;

    notifyRef.current({
      type: 'error',
      title: 'Quota cloud atteint',
      message: "Passez au plan Solo pour plus d'espace de stockage.",
      duration: 0,
      action: {
        label: 'Voir les plans',
        onClick: () => {
          window.electron?.ipcRenderer?.send('open-external', 'https://filarr.com/pricing');
        },
      },
    });
  }, []);

  const showConflictToast = useCallback((data: any) => {
    const key = `${data?.profileId}:${data?.fileId}`;
    if (conflictsHandledRef.current.has(key)) return;
    conflictsHandledRef.current.add(key);

    notifyRef.current({
      type: 'warning',
      title: 'Conflit de synchronisation',
      message: 'Un conflit a été détecté. Une copie "_conflict_" a été créée.',
      duration: 0,
      action: {
        label: 'Garder local',
        onClick: () => {
          window.electron?.ipcRenderer
            ?.invoke('sync:resolveConflict', data?.profileId, data?.fileId, 'local')
            .catch(() => {});
        },
      },
    });
  }, []);

  // Register listeners once (not dependent on notify ref)
  useEffect(() => {
    if (accountMode !== 'cloud') return;

    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    ipc.on('sync-quota-exceeded', showQuotaToast);
    ipc.on('sync-conflict-detected', showConflictToast);

    // Reset quota flag when component remounts (e.g., mode switch)
    quotaShownRef.current = false;

    // Note: removeListener doesn't work properly with preload wrapper,
    // but listeners are cleaned up when the window reloads
  }, [accountMode, showQuotaToast, showConflictToast]);

  return null;
};

export default SyncConflictHandler;
