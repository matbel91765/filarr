/**
 * SyncStatusIcon — Cloud sync indicator for the Header
 *
 * Visible only when accountMode === 'cloud'.
 * Shows sync state via icon color and animation.
 * Le clic ouvre le panneau d'activité (SyncActivityPanel) — le cycle manuel
 * part de son bouton, à côté de ce qui explique enfin ce que la sync a fait.
 * L'icône seule ne pouvait rien dire des transferts ni de la raison d'un échec.
 */

import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { RootState } from '../../../store';
import { setSyncEnabled } from '../../../store/slices/authSlice';
import * as authApi from '../../../services/auth/authApi';
import { useSyncStatus } from '../../../hooks/useSyncStatus';
import { NotificationContext } from '../ui/Notification';
import SyncActivityPanel, { relativeTime } from './SyncActivityPanel';

// ── Component ───────────────────────────────────────────────────────────────

const SyncStatusIcon: React.FC = () => {
  const { t } = useTranslation();
  const { isCloud, state, lastSyncAt, lastError, conflicts, failedItems, triggerSync } =
    useSyncStatus();
  const syncEnabled = useSelector((s: RootState) => s.auth.syncEnabled);
  const activeProfileId = useSelector((s: RootState) => s.profiles?.activeProfileId);
  const dispatch = useDispatch();
  // Contexte lu directement : l'icône est montée dans le Header, que des tests
  // rendent hors provider — un hook qui jette y casserait tout l'en-tête.
  const notify = React.useContext(NotificationContext);
  // Cycle manuel EN COURS de traitement — la seule chose qui rende inerte le
  // bouton « Synchroniser » du panneau (l'icône, elle, ouvre toujours).
  const [pending, setPending] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  if (!isCloud) return null;

  // Paused takes precedence over every idle/synced sub-state: when the user
  // has explicitly paused sync, the amber icon should be unambiguous, even if
  // there's a stale `lastSyncAt` that would otherwise make the icon green.
  const paused = !syncEnabled;

  // Bulle d'aide. Elle n'invite plus à « cliquer pour réessayer » : le clic
  // ouvre désormais le panneau d'activité, d'où part le cycle manuel.
  let tooltip: string;
  if (paused) {
    tooltip = t('sync.icon.paused');
  } else {
    switch (state) {
      case 'syncing':
        tooltip = t('sync.icon.syncing');
        break;
      case 'error':
        // La RAISON est dans la bulle : un cycle automatique n'affiche aucune
        // notification, le rouge seul ne disait rien de ce qui a échoué.
        tooltip = lastError ? t('sync.icon.errorWith', { error: lastError }) : t('sync.icon.error');
        break;
      case 'offline':
        tooltip = t('sync.icon.offline');
        break;
      default:
        tooltip = lastSyncAt
          ? t('sync.icon.lastSync', { time: relativeTime(lastSyncAt, t) })
          : t('sync.icon.never');
    }
  }

  // Icon color — paused uses the same amber as the "En pause" badge in
  // AccountSyncSection so the visual language is consistent across the app.
  let iconColor: string;
  if (paused) {
    iconColor = '#f59e0b';
  } else {
    switch (state) {
      case 'syncing':
        iconColor = 'var(--color-primary-500)';
        break;
      case 'error':
        iconColor = '#ef4444';
        break;
      case 'offline':
        iconColor = 'var(--color-text-tertiary)';
        break;
      default:
        iconColor = lastSyncAt ? '#10b981' : 'var(--color-text-tertiary)';
    }
  }

  const hasBadge = !paused && (conflicts > 0 || failedItems > 0);

  // Un cycle manuel doit TOUJOURS aboutir à un retour visible : succès, « déjà
  // en cours », ou l'échec nommé. Sans cela — c'était le cas sur le web, où
  // aucun état intermédiaire n'était émis — le bouton avait l'air mort.
  const handleSyncNow = async () => {
    if (paused) {
      // Resume from the header — same path as AccountSyncSection's resume row.
      await authApi.setSyncEnabled(true);
      dispatch(setSyncEnabled(true));
      return;
    }
    if (pending) return;
    setPending(true);
    try {
      const result = await triggerSync();
      if (result.state === 'error') {
        notify?.error(
          result.error
            ? t('sync.notify.failedWith', { error: result.error })
            : t('sync.notify.failed')
        );
      } else if (result.state === 'offline') {
        notify?.error(t('sync.notify.offline'));
      } else if (result.state === 'syncing' || result.alreadyRunning) {
        notify?.info(t('sync.notify.alreadyRunning'));
      } else {
        notify?.success(t('sync.notify.done'));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setPanelOpen((o) => !o)}
        className="relative w-10 h-10 flex items-center justify-center rounded-full
          hover:bg-[var(--color-hover-overlay)] transition-colors duration-150 cursor-pointer"
        title={tooltip}
        aria-label={tooltip}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
      >
        {/* Icon */}
        <svg
          className={`w-5 h-5 ${!paused && (state === 'syncing' || pending) ? 'animate-spin' : ''}`}
          style={{ color: iconColor }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          {paused ? (
            // CloudPause — two vertical bars inside a cloud outline
            <>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 11.5v5M14 11.5v5" />
            </>
          ) : state === 'offline' ? (
            // WifiOff
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 3l18 18M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12 18.75h.008v.008H12v-.008z"
            />
          ) : state === 'syncing' ? (
            // RefreshCw (spinning)
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.356v4.992"
            />
          ) : state === 'error' ? (
            // CloudX
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
            />
          ) : lastSyncAt ? (
            // CloudCheck (synced)
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
            />
          ) : (
            // Cloud (never synced)
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
            />
          )}
        </svg>

        {/* Badge dot for conflicts/failures */}
        {hasBadge && (
          <span
            className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2"
            style={{
              backgroundColor: conflicts > 0 ? '#f59e0b' : '#ef4444',
              borderColor: 'var(--color-surface)',
            }}
          />
        )}
      </button>

      {panelOpen && (
        <SyncActivityPanel
          anchorEl={buttonRef.current}
          profileId={activeProfileId ?? null}
          onClose={() => setPanelOpen(false)}
          onSyncNow={handleSyncNow}
          busy={pending}
          paused={paused}
        />
      )}
    </>
  );
};

export default React.memo(SyncStatusIcon);
