/**
 * PendingInviteBanner — « une invitation vous attend », AVANT que l'écran
 * d'acceptation ne puisse exister.
 *
 * POURQUOI CE BANDEAU. L'invitation est captée au chargement de la page, puis
 * l'URL est immédiatement nettoyée : le lien disparaît de la barre d'adresse, de
 * l'historique et du referrer. Or l'écran d'acceptation n'est monté qu'à
 * l'intérieur du Router, après profil créé, compte créé, adresse vérifiée et
 * coffre déverrouillé. Entre les deux, l'invité — qui est le destinataire NOMINAL
 * du produit, quelqu'un qui n'a jamais utilisé Filarr — traverse l'onboarding, le
 * sélecteur d'espace et le sélecteur de profil sans le moindre signe que quelque
 * chose l'attend. Le porteur survit à tout cela ; c'est l'accusé de réception qui
 * manquait, et un invité qui abandonne en route n'a plus aucune trace de son
 * invitation ni dans l'application, ni dans son navigateur.
 *
 * Ce composant ne PROPOSE rien et n'accepte rien : il ne fait que dire qu'il faut
 * continuer. Accepter exige une session ET la clé privée de l'utilisateur, qui
 * n'existe pas encore à ce stade.
 *
 * Il lit le porteur SANS filtrer par compte, et c'est volontaire : à cet instant
 * aucun compte n'est connecté, il n'y a donc personne pour qui se taire. Rien
 * n'est nommé — ni l'espace, ni l'adresse invitée — pour la même raison.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readPendingInvite, subscribePendingInvite } from '../../../services/invites/pendingInvite';

export const PendingInviteBanner: React.FC = () => {
  const { t } = useTranslation();
  const [waiting, setWaiting] = useState(() => readPendingInvite() !== null);

  useEffect(() => subscribePendingInvite((inv) => setWaiting(inv !== null)), []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 60,
        padding: '10px 16px',
        textAlign: 'center',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--color-primary-900)',
        backgroundColor: 'var(--color-primary-100)',
        borderBottom: '1px solid var(--color-primary-200)',
      }}
    >
      {t('teamVaults.join.waitingBanner')}
    </div>
  );
};

export default PendingInviteBanner;
