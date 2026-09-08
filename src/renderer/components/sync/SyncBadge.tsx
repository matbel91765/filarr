/**
 * SyncBadge — Small overlay icon showing file sync status
 *
 * Reads from syncSlice.fileStatuses[fileId] via Redux (coarse status), and from
 * syncSlice.fileProgress[fileId] when a live byte-level transfer is in flight —
 * in which case it renders a determinate progress ring (percent) plus a tooltip
 * with the smoothed speed and ETA. Falls back to the static status icon when no
 * byte progress is available (older emit paths / non-transfer statuses).
 *
 * No IPC per item — all statuses batch-loaded.
 *
 * Position : ABSOLUE, dans le coin HAUT-DROIT du parent par défaut (le parent
 * doit être `relative`) — et non « bas-gauche » comme le disait l'ancien
 * en-tête, qui décrivait une version antérieure. `positionClassName` permet au
 * consommateur de la déplacer : FileCard en grille la met en bas à droite,
 * symétrique de son badge hors-ligne (bas-gauche), pour laisser le coin
 * haut-droit au groupe partage / rappel / cadenas.
 */

import React from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { RootState } from '../../../store';
import {
  formatSpeed,
  formatEta,
  percentComplete,
  type TransferLocale,
} from '../../../utils/transferStats';

/** La position par défaut — celle qu'avaient toutes les cartes avant `positionClassName`. */
const DEFAULT_POSITION_CLASS = 'absolute top-1 right-1';

interface SyncBadgeProps {
  fileId: string;
  folderId?: string;
  fileName?: string;
  /**
   * Classes de POSITION du badge (absolu par rapport au parent `relative`).
   * Défaut : `absolute top-1 right-1`. Ne porte que la position — la taille,
   * l'ombre et le fond restent ici.
   */
  positionClassName?: string;
}

const SyncBadge: React.FC<SyncBadgeProps> = ({
  fileId,
  folderId,
  fileName,
  positionClassName = DEFAULT_POSITION_CLASS,
}) => {
  const { t, i18n } = useTranslation();
  const accountMode = useSelector((state: RootState) => state.auth.accountMode);
  const fileStatuses = useSelector((state: RootState) => state.sync.fileStatuses);
  const fileProgress = useSelector((state: RootState) => state.sync.fileProgress);

  // Try multiple keys: localPath (folderId/fileName), then fileId, then fileName alone
  const localPath = folderId && fileName ? `${folderId}/${fileName}` : null;
  const status =
    (localPath && fileStatuses[localPath]) ||
    fileStatuses[fileId] ||
    (fileName && fileStatuses[fileName]) ||
    null;
  const progress =
    (localPath && fileProgress[localPath]) ||
    fileProgress[fileId] ||
    (fileName && fileProgress[fileName]) ||
    null;

  if (accountMode !== 'cloud') return null;
  if (!status || status === 'synced') return null;

  const lang: TransferLocale = i18n.language?.startsWith('en') ? 'en' : 'fr';

  // ── Live transfer with byte-level progress → determinate ring + speed/ETA ──
  const isTransfer = status === 'pending_upload' || status === 'pending_download';
  const pct =
    progress && isTransfer ? percentComplete(progress.transferredBytes, progress.totalBytes) : null;

  if (isTransfer && progress && pct !== null) {
    const color = '#3b82f6'; // blue
    const R = 9;
    const CIRC = 2 * Math.PI * R;
    const offset = CIRC * (1 - pct / 100);

    const label =
      status === 'pending_download' ? t('sync.transfer.downloading') : t('sync.transfer.uploading');
    const rounded = Math.round(pct);
    const tooltipParts: string[] = [`${label} ${lang === 'en' ? `${rounded}%` : `${rounded} %`}`];
    const speed = formatSpeed(progress.rate, lang);
    if (speed) tooltipParts.push(speed);
    const eta = formatEta(progress.etaSeconds, lang);
    if (eta) tooltipParts.push(`${eta} ${t('sync.transfer.remaining')}`);
    const tooltip = tooltipParts.join(' · ');

    return (
      <div
        className={`${positionClassName} w-4 h-4 rounded-full flex items-center justify-center z-10`}
        style={{
          backgroundColor: 'var(--color-surface)',
          boxShadow: '0 0 0 1.5px var(--color-surface)',
        }}
        title={tooltip}
        role="progressbar"
        aria-label={tooltip}
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx="12"
            cy="12"
            r={R}
            stroke="var(--color-border)"
            strokeWidth={3}
            opacity={0.4}
          />
          <circle
            cx="12"
            cy="12"
            r={R}
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
          />
        </svg>
      </div>
    );
  }

  // ── Coarse status icon (no live byte progress available) ───────────────────
  let icon: React.ReactNode;
  let color: string;
  let animate = false;
  let tooltip = '';

  switch (status) {
    case 'pending_upload':
      color = '#3b82f6'; // blue
      animate = true;
      tooltip = t('sync.badge.pendingUpload', 'Upload pending');
      icon = (
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
      );
      break;
    case 'pending_download':
      color = '#3b82f6';
      animate = true;
      tooltip = t('sync.badge.pendingDownload', 'Download pending');
      icon = (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3"
        />
      );
      break;
    case 'conflict':
      color = '#f59e0b'; // orange
      tooltip = t('sync.badge.conflict', 'Sync conflict');
      icon = (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      );
      break;
    case 'cloud-only':
      color = '#94a3b8'; // gray
      tooltip = t('sync.badge.cloudOnly', 'Available online only');
      icon = (
        <>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 13.5v6m0 0l-2-2m2 2l2-2" />
        </>
      );
      break;
    case 'deleted':
      color = '#ef4444'; // red
      tooltip = t('sync.badge.pendingDelete', 'Deletion pending');
      icon = <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />;
      break;
    case 'local_only':
      color = '#94a3b8'; // gray
      // Infobulle longue : l'explication du refus de sync (taille, portabilité) vit dans les locales
      // pour qu'un utilisateur EN ne lise plus du français en dur au survol du badge.
      tooltip = t(
        'sync.badge.localOnly',
        'File not synced (too large — 5 GB max — or not portable between devices) — kept locally only'
      );
      icon = (
        <>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5l15 15" />
        </>
      );
      break;
    default:
      return null;
  }

  return (
    <div
      className={`${positionClassName} w-4 h-4 rounded-full flex items-center justify-center z-10 ${
        animate ? 'animate-pulse' : ''
      }`}
      style={{
        backgroundColor: 'var(--color-surface)',
        boxShadow: '0 0 0 1.5px var(--color-surface)',
      }}
      title={tooltip}
    >
      <svg
        className="w-3 h-3"
        style={{ color }}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        {icon}
      </svg>
    </div>
  );
};

export default React.memo(SyncBadge);
