/**
 * Barre de présence — qui édite cette note en ce moment.
 *
 * Volontairement discrète : un petit groupe d'avatars et un état de canal.
 * Elle ne s'affiche que lorsqu'une session existe réellement.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CollabParticipant, CollabStatus } from './collabTypes';
import './CollabPresenceBar.css';

const MAX_AVATARS = 4;

export interface CollabPresenceBarProps {
  participants: CollabParticipant[];
  status: CollabStatus;
  /** `compact` s'insère dans l'en-tête replié. */
  variant?: 'full' | 'compact';
}

export const CollabPresenceBar: React.FC<CollabPresenceBarProps> = ({
  participants,
  status,
  variant = 'full',
}) => {
  const { t } = useTranslation();

  // « en direct » n'est vrai qu'une fois le rejeu du relais terminé : tant que
  // le canal est seulement ouvert, la salle n'a pas fini de nous rattraper.
  const statusLabel =
    status === 'synced'
      ? t('notes.collab.statusLive', 'en direct')
      : status === 'connected'
        ? t('notes.collab.statusSyncing', 'synchronisation…')
        : status === 'room-full'
          ? t('notes.collab.statusRoomFull', 'salle pleine')
          : status === 'offline'
            ? t('notes.collab.statusOffline', 'hors ligne')
            : t('notes.collab.statusConnecting', 'connexion…');

  const shown = participants.slice(0, MAX_AVATARS);
  const overflow = participants.length - shown.length;

  const groupLabel = t('notes.collab.presenceLabel', 'Appareils connectés à cette note');

  return (
    <span
      className={`collab-presence collab-presence--${variant}`}
      data-status={status}
      role="group"
      aria-label={groupLabel}
    >
      <span className="collab-presence__avatars">
        {shown.map((p) => (
          <span
            key={p.clientId}
            className={`collab-presence__avatar${p.isLocal ? ' collab-presence__avatar--self' : ''}`}
            style={{ backgroundColor: p.color }}
            title={
              p.isLocal
                ? t('notes.collab.you', '{{name}} (cet appareil)', { name: p.name })
                : p.name
            }
            aria-label={p.name}
          >
            {p.initial}
          </span>
        ))}
        {overflow > 0 && (
          <span
            className="collab-presence__avatar collab-presence__avatar--overflow"
            title={participants
              .slice(MAX_AVATARS)
              .map((p) => p.name)
              .join(', ')}
          >
            {`+${overflow}`}
          </span>
        )}
      </span>
      <span className="collab-presence__status">
        <span className="collab-presence__dot" aria-hidden="true" />
        <span className="collab-presence__status-text">{statusLabel}</span>
      </span>
    </span>
  );
};

export default CollabPresenceBar;
