/**
 * NoteSyncBadge — sync state indicator for a single note.
 *
 * Two variants: `compact` (tiny colored dot for list items) and
 * `full` (icon + label for the editor header). Hidden entirely when
 * the user is not in cloud mode — the badge is meaningless locally.
 *
 * Derives state from Redux + `getNoteSyncState`; no IPC, no per-note
 * server call. See `noteSyncState.ts` for why per-note cloud status
 * can't exist in Filarr (single encrypted blob).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import type { Note } from '../../../types/notes';
import { getNoteSyncState, type NoteSyncState } from '../../../services/notes/noteSyncState';
import './NoteSyncBadge.css';

interface NoteSyncBadgeProps {
  note: Pick<Note, 'updatedAt'>;
  variant?: 'compact' | 'full';
}

const ICON_SIZE_FULL = 14;
const ICON_SIZE_COMPACT = 8;

const SyncedIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SyncingIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="note-sync-badge__spin"
  >
    <path d="M21 12a9 9 0 11-3-6.7" />
    <polyline points="21 4 21 10 15 10" />
  </svg>
);

const PendingIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15.5a4.5 4.5 0 00-4.5-4.5 6 6 0 10-11.5 2 4 4 0 00.5 8H17a4 4 0 004-3.5z" />
    <line x1="12" y1="12" x2="12" y2="16" />
    <line x1="12" y1="8" x2="12" y2="8.01" />
  </svg>
);

const OfflineIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15.5a4.5 4.5 0 00-4.5-4.5 6 6 0 10-11.5 2 4 4 0 00.5 8H17a4 4 0 004-3.5z" />
    <line x1="3" y1="3" x2="21" y2="21" />
  </svg>
);

const ICON_MAP: Record<NoteSyncState, React.FC<{ size: number }>> = {
  synced: SyncedIcon,
  syncing: SyncingIcon,
  pending: PendingIcon,
  offline: OfflineIcon,
};

export const NoteSyncBadge: React.FC<NoteSyncBadgeProps> = ({ note, variant = 'full' }) => {
  const { t } = useTranslation();
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const syncState = useSelector((s: RootState) => s.sync.state);
  const lastSyncAt = useSelector((s: RootState) => s.sync.lastSyncAt);
  /**
   * L'ACCUSÉ DU MOTEUR pour l'entrée des notes. C'est lui qui prime sur toute
   * comparaison d'horloge — voir `noteSyncState.ts` pour les deux mensonges que
   * la déduction produisait.
   */
  const notesEntryStatus = useSelector((s: RootState) => s.sync.fileStatuses['meta:notes']);

  if (accountMode !== 'cloud') return null;

  const state = getNoteSyncState(note, { state: syncState, lastSyncAt, notesEntryStatus });

  const labels: Record<NoteSyncState, string> = {
    // « À jour » plutôt que « Synchronisée » : c'est plus court, et surtout ça
    // décrit un ÉTAT plutôt qu'un événement passé.
    synced: t('notes.syncBadge.synced', 'À jour'),
    syncing: t('notes.syncBadge.syncing', 'Envoi'),
    pending: t('notes.syncBadge.pending', 'En attente'),
    offline: t('notes.syncBadge.offline', 'Hors ligne'),
  };

  /**
   * La bulle EXPLIQUE ce que l'etiquette se contente de nommer.
   *
   * « Non synchronisee » sur un compte a jour se lit comme une panne, alors que
   * l'etat dit seulement « ces modifications-ci n'ont pas encore ete envoyees »
   * — le cycle passe toutes les cinq minutes. Le survol le dit en toutes
   * lettres, sans quoi la question revient a chaque fois.
   */
  /**
   * LA BULLE EXPLIQUE CE QUE L'ÉTIQUETTE SE CONTENTE DE NOMMER.
   *
   * « En attente » sur un compte à jour se lit comme une panne, alors que l'état
   * dit seulement « ces modifications-ci ne sont pas encore parties ». Chaque
   * état porte donc sa phrase, et chacune dit ce qui se passe MAINTENANT —
   * jamais un délai qu'on ne peut pas tenir.
   */
  const hints: Partial<Record<NoteSyncState, string>> = {
    synced: t('notes.syncBadge.syncedHint', 'Le nuage a cette version.'),
    syncing: t('notes.syncBadge.syncingHint', 'Envoi en cours…'),
    pending: t(
      'notes.syncBadge.pendingHint',
      'Enregistré sur cet appareil. L’envoi part dans quelques secondes.'
    ),
    offline: t(
      'notes.syncBadge.offlineHint',
      'Hors ligne. Tout repartira à la reconnexion, dans l’ordre.'
    ),
  };

  const label = labels[state];
  const hint = hints[state] ?? label;
  const Icon = ICON_MAP[state];
  const size = variant === 'compact' ? ICON_SIZE_COMPACT : ICON_SIZE_FULL;

  if (variant === 'compact') {
    return (
      <span
        className={`note-sync-badge note-sync-badge--compact note-sync-badge--${state}`}
        title={hint}
        aria-label={label}
      >
        <Icon size={size} />
      </span>
    );
  }

  return (
    <span
      className={`note-sync-badge note-sync-badge--full note-sync-badge--${state}`}
      title={hint}
    >
      <Icon size={size} />
      <span className="note-sync-badge__label">{label}</span>
    </span>
  );
};

export default NoteSyncBadge;
