/**
 * RoomFullNotice — « cette note est déjà ouverte ailleurs ».
 *
 * ═══ POURQUOI CET ENCART EXISTE ═══
 *
 * Le relais refuse un pair de plus quand le plafond de la salle est atteint, et
 * le client réessaie en boucle. Sans cet encart, la frappe en direct
 * s'arrêtait — ou ne démarrait jamais — SANS QUE RIEN NE LE DISE. On ne pouvait
 * ni comprendre, ni agir : le seul indice était l'absence d'un curseur qu'on
 * n'avait pas forcément remarqué.
 *
 * ═══ CE QU'IL DIT, ET DANS CET ORDRE ═══
 *
 * 1. QUE RIEN N'EST PERDU. C'est la première inquiétude, et elle est infondée :
 *    cet appareil enregistre et synchronise normalement. Seule la frappe
 *    partagée en direct est suspendue.
 * 2. POURQUOI. Une note personnelle se synchronise entre SES propres appareils,
 *    jusqu'à trois à la fois.
 * 3. LA SORTIE. Écrire à plusieurs, c'est un coffre partagé — où chacun garde
 *    son identité, ses droits et son historique.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

export const RoomFullNotice: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className="flex items-start gap-3 p-3 rounded-lg"
      style={{
        backgroundColor: 'var(--color-background-secondary)',
        border: '1px solid color-mix(in srgb, var(--color-warning-500) 28%, transparent)',
      }}
    >
      <span
        className="shrink-0 flex items-center justify-center rounded-lg"
        style={{
          width: 32,
          height: 32,
          backgroundColor: 'color-mix(in srgb, var(--color-warning-500) 12%, transparent)',
          color: 'var(--color-warning-on-background)',
        }}
        aria-hidden="true"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 19a4 4 0 0 0-8 0" />
          <circle cx="12" cy="10" r="3" />
          <path d="M20.5 18a6.5 6.5 0 0 0-3.2-4.4M3.5 18a6.5 6.5 0 0 1 3.2-4.4" />
        </svg>
      </span>

      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('notes.collab.roomFull.title', 'Cette note est déjà ouverte sur d’autres appareils')}
        </p>
        <p
          className="text-sm mt-1"
          style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}
        >
          {t(
            'notes.collab.roomFull.safe',
            'Cet appareil continue d’enregistrer et de se synchroniser normalement — il ne reçoit simplement pas la frappe en direct.'
          )}
        </p>
        <p
          className="text-sm mt-2"
          style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}
        >
          {t(
            'notes.collab.roomFull.why',
            'Une note personnelle se synchronise entre vos propres appareils, jusqu’à trois à la fois. Pour écrire à plusieurs en même temps, déplacez-la dans un coffre partagé : chacun y garde son identité, ses droits et son historique.'
          )}
        </p>
      </div>
    </div>
  );
};

export default RoomFullNotice;
