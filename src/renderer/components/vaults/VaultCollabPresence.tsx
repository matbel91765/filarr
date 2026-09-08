/**
 * Who is in this vault note right now.
 *
 * Not a reuse of the personal editor's CollabPresenceBar, and the difference is
 * the feature rather than styling: that bar answers "which of MY devices", this
 * one answers "which MEMBERS", and it has to say which of them are reading
 * rather than writing. A reader whose typing will never be saved must be able to
 * see that from the room itself.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultParticipant } from './vaultNoteCollab';
import type { SessionStatus } from '../../../services/collab';

const MAX_AVATARS = 5;

export interface VaultCollabPresenceProps {
  participants: VaultParticipant[];
  status: SessionStatus;
  /** True when THIS peer is the one writing the item back. */
  responsible: boolean;
}

export const VaultCollabPresence: React.FC<VaultCollabPresenceProps> = ({
  participants,
  status,
  responsible,
}) => {
  const { t } = useTranslation();

  // "Live" is only true once the relay has finished replaying: a merely open
  // socket has not caught us up yet.
  const statusLabel =
    status === 'synced'
      ? t('teamVaults.noteEditor.live.statusLive', 'Live')
      : status === 'connected'
        ? t('teamVaults.noteEditor.live.statusSyncing', 'Syncing…')
        : status === 'offline'
          ? t('teamVaults.noteEditor.live.statusOffline', 'Offline — editing locally')
          : t('teamVaults.noteEditor.live.statusConnecting', 'Connecting…');

  const shown = participants.slice(0, MAX_AVATARS);
  const overflow = participants.length - shown.length;
  // « Untel ecrit… » — deriveVaultPresence exclut deja le pair local.
  const typing = participants.filter((p) => p.isTyping);
  const typingLabel =
    typing.length === 0
      ? null
      : typing.length === 1
        ? t('teamVaults.noteEditor.live.typingOne', '{{name}} is writing…', {
            name: typing[0].name,
          })
        : typing.length === 2
          ? t('teamVaults.noteEditor.live.typingTwo', '{{a}} and {{b}} are writing…', {
              a: typing[0].name,
              b: typing[1].name,
            })
          : t('teamVaults.noteEditor.live.typingMany', '{{count}} members are writing…', {
              count: typing.length,
            });

  const titleFor = (p: VaultParticipant): string => {
    const who = p.isLocal
      ? t('teamVaults.noteEditor.live.you', '{{name}} (you)', { name: p.name })
      : p.name;
    if (p.isReader) return t('teamVaults.noteEditor.live.readerOf', '{{who}} — read-only', { who });
    if (p.isSaver)
      return t('teamVaults.noteEditor.live.saverOf', '{{who}} — saving to the vault', { who });
    return who;
  };

  return (
    <div
      className="vault-collab-presence"
      data-status={status}
      role="group"
      aria-label={t('teamVaults.noteEditor.live.presenceLabel', 'Members editing this note')}
    >
      <div className="vault-collab-presence__avatars">
        {shown.map((p) => (
          <span
            key={p.clientId}
            className={[
              'vault-collab-presence__avatar',
              p.isLocal ? 'vault-collab-presence__avatar--self' : '',
              p.isReader ? 'vault-collab-presence__avatar--reader' : '',
              p.isSaver ? 'vault-collab-presence__avatar--saver' : '',
              p.isTyping ? 'vault-collab-presence__avatar--typing' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ backgroundColor: p.color }}
            title={titleFor(p)}
            aria-label={titleFor(p)}
          >
            {p.initial}
            {p.isReader && (
              <span className="vault-collab-presence__reader-dot" aria-hidden="true" />
            )}
          </span>
        ))}
        {overflow > 0 && (
          <span
            className="vault-collab-presence__avatar vault-collab-presence__avatar--overflow"
            title={participants
              .slice(MAX_AVATARS)
              .map((p) => p.name)
              .join(', ')}
          >
            {`+${overflow}`}
          </span>
        )}
      </div>
      <span className="vault-collab-presence__status">
        <span className="vault-collab-presence__dot" aria-hidden="true" />
        <span>{statusLabel}</span>
      </span>
      {/* Saying WHO saves is not decoration: without it, a member whose peer holds
          the pen cannot tell whether their text is on its way to the vault.

          But it may only be said when a saver actually EXISTS. A room of readers
          has none, and neither does one whose elected peer just left, for as long
          as their presence takes to expire — announcing "another member is saving"
          there tells everyone their text is on its way to the vault when nothing
          is going to write it. The presence list already knows: `isSaver` is the
          verdict of the ballot, and nobody carries it when nobody won. */}
      {participants.length > 1 && participants.some((p) => p.isSaver) && (
        <span className="vault-collab-presence__saver">
          {responsible
            ? t('teamVaults.noteEditor.live.savingHere', 'Saving from this device')
            : t('teamVaults.noteEditor.live.savingElsewhere', 'Another member is saving')}
        </span>
      )}
      {typingLabel && (
        <span className="vault-collab-presence__typing" aria-live="polite">
          {typingLabel}
        </span>
      )}
    </div>
  );
};

export default VaultCollabPresence;
