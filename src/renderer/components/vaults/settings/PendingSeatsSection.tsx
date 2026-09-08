/**
 * PendingSeatsSection — LES INVITÉES, DANS L'ONGLET OÙ L'ON GÈRE LES RÔLES.
 *
 * LE DÉFAUT QU'ELLE FERME, RAPPORTÉ APRÈS UN ESSAI RÉEL : « il n'y a pas de moyen
 * de modifier le rôle d'une personne à qui on a envoyé une invitation vu qu'elle
 * apparaît pas dans la liste des membres ». Le geste EXISTAIT (le rôle d'une
 * invitation se corrige sans toucher à aucune clé), mais il n'était qu'à l'onglet
 * Invitations — c'est-à-dire ailleurs que là où on le cherche.
 *
 * ELLE EST UNE SECTION, PAS DES LIGNES DU TABLEAU, ET C'EST UNE DÉCISION.
 * Une invitée n'a pas de compte dans ce coffre, pas de clé scellée, pas de date
 * d'entrée : les colonnes du trombinoscope n'ont rien à dire d'elle, et ses
 * gestes (retirer — donc faire TOURNER K_vault —, ouvrir une cérémonie
 * d'empreinte, cocher pour un lot) portent tous sur un identifiant de compte
 * qu'elle n'a pas encore. La glisser dans le tableau aurait donné des cases à
 * cocher qui n'emportent rien et une colonne « Confiance » vide sur une personne
 * dont il n'y a, précisément, rien à vérifier. Elle est donc juste au-dessus,
 * nommée pour ce qu'elle est, avec le seul geste qui ait un sens sur une
 * promesse : corriger le rôle qu'elle produira.
 *
 * ET ELLE NE REFAIT PAS L'ONGLET INVITATIONS. On y trouve le détail — la frise
 * des relances, l'expiration, la révocation, les échues, la fiche de parcours en
 * cinq crans, le renvoi de l'invitation d'espace, l'annulation de l'accès promis.
 * Ici : qui va entrer, à quel rang, et comment lui retransmettre le lien. Le
 * renvoi est explicite plutôt que dupliqué.
 *
 * ── ELLE COUVRE LES DEUX MOITIÉS DU MÊME GESTE (défaut du 31/08) ─────────────
 *
 * Le premier correctif n'affichait que les invitations de COFFRE, et l'essai
 * réel est tombé sur l'autre moitié : la personne invitée n'étant pas encore
 * dans l'espace, le geste de l'hôte avait produit une INTENTION d'accès (0073),
 * pas une invitation de coffre — `vault_invites` était vide, et Membres restait
 * muet exactement comme avant. Or l'hôte n'a fait qu'un geste et ne voit qu'une
 * personne invitée : la section rend donc les deux genres de siège, mêlés dans
 * le même ordre alphabétique, avec le même menu de rôle.
 *
 * MAIS ELLE NE FAIT PAS SEMBLANT QU'ILS SOIENT IDENTIQUES. Chaque ligne dit ce
 * qu'elle attend — « invitée dans ce coffre » quand K_vault est déjà scellée,
 * « invitée dans votre espace, l'accès suit dès l'acceptation » quand rien ne
 * l'est encore, « dans votre espace, l'accès reste à sceller » pour celle qui a
 * répondu. Trois attentes différentes, trois gestes différents de la part de
 * l'hôte : les confondre sous une seule pastille « en attente » lui ferait
 * relancer un e-mail là où il n'a qu'à vérifier une empreinte.
 *
 * ET LE LIEN NE SE « RETROUVE » QUE LÀ OÙ IL EXISTE. Une intention n'a jamais
 * émis de porteur de coffre : c'est le lien d'ESPACE qui circule, et il se
 * relance depuis l'onglet Invitations, sous son vrai nom. C'est `seatLinkOffer`
 * qui tranche, pas ce JSX.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button } from '../../ui';
import { AdminSection, StatusBadge } from '../../settings/enterprise/AdminPrimitives';
import {
  InviteLinkPanel,
  InviteLinkRecoveryButton,
  InviteRoleSelect,
} from './PendingInviteControls';
import { seatBadgeKey, seatHintKey, type PendingSeat } from './pendingSeatsModel';
import type { PendingInviteActions } from './usePendingInviteActions';

const HourglassIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M6 3h12M6 21h12M8 3v4a4 4 0 0 0 4 4 4 4 0 0 0 4-4V3M8 21v-4a4 4 0 0 1 4-4 4 4 0 0 1 4 4v4" />
  </svg>
);

interface Props {
  seats: readonly PendingSeat[];
  actions: PendingInviteActions;
  /** Un autre geste de la page est en vol — on ne lance pas le second. */
  disabled: boolean;
  /** Aller au détail plutôt que le recopier ici. */
  onGoToInvitations?: () => void;
}

export const PendingSeatsSection: React.FC<Props> = ({
  seats,
  actions,
  disabled,
  onGoToInvitations,
}) => {
  const { t } = useTranslation();
  // Pas de section vide : « personne n'attend » est déjà ce que dit le tableau
  // au-dessous, et un cadre vide de plus se lirait comme une panne de lecture.
  if (seats.length === 0) return null;

  return (
    <AdminSection
      title={t('teamVaults.settings.pendingSeats.title', { count: seats.length })}
      description={t('teamVaults.settings.pendingSeats.hint')}
      icon={<HourglassIcon />}
      actions={
        onGoToInvitations && (
          <Button variant="ghost" size="sm" onClick={onGoToInvitations}>
            {t('teamVaults.settings.pendingSeats.seeDetail')}
          </Button>
        )
      }
    >
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {seats.map((seat) => (
          <li key={seat.inviteId} className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              {/* La teinte prend l'ADRESSE pour graine : il n'y a pas encore
                  d'identifiant de compte, et la couleur changerait le jour de
                  l'acceptation si on lui en inventait un. */}
              <Avatar label={seat.email} seed={seat.email} size="sm" title={null} />
              <span className="truncate" style={{ color: 'var(--color-text-primary)' }}>
                {seat.email}
              </span>
              {/* CE QUI LA DISTINGUE D'UN MEMBRE, et qui doit rester lisible même
                  quand la ligne se replie : elle n'a pas encore de clé. La
                  pastille dit LAQUELLE des deux attentes, parce qu'elles
                  n'appellent pas le même geste de l'hôte. */}
              <StatusBadge tone="info" title={t(seatHintKey(seat))}>
                {t(seatBadgeKey(seat))}
              </StatusBadge>
              {seat.urgent && (
                <StatusBadge tone="warning" title={t('teamVaults.invites.expiringHint')}>
                  {t('teamVaults.invites.expiringBadge')}
                </StatusBadge>
              )}
              <span className="ml-auto flex items-center gap-1.5 shrink-0">
                <InviteRoleSelect
                  inviteId={seat.inviteId}
                  email={seat.email}
                  role={seat.role}
                  disabled={disabled || actions.busy}
                  // LE GENRE DU SIÈGE CHOISIT LA ROUTE, et c'est le seul endroit
                  // où il le fait. Les deux identifiants sont des UUID : envoyer
                  // celui d'une intention au PATCH des invitations de coffre
                  // rendrait `invite_not_found`, que l'hôte lirait comme la
                  // disparition de la personne qu'il vient d'inviter.
                  onChange={(id, role) =>
                    void (seat.kind === 'accessIntent'
                      ? actions.changeIntentRole(id, role)
                      : actions.changeRole(id, role))
                  }
                />
                <InviteLinkRecoveryButton
                  inviteId={seat.inviteId}
                  email={seat.email}
                  staleEpoch={seat.staleEpoch}
                  kind={seat.kind}
                  disabled={disabled || actions.busy}
                  actions={actions}
                />
              </span>
            </div>
            {/* L'échéance vient de la ligne, jamais d'un TTL deviné ici : un
                coffre réglé à deux jours rendrait « sept » plausible et faux.
                Sur une intention, c'est celle du porteur d'ESPACE — le seul lien
                vivant — et elle s'efface quand le serveur ne l'a pas datée. */}
            {seat.expiresAtMs !== null && (
              <span className="text-xs text-[var(--color-text-tertiary)] pl-8">
                {t('teamVaults.members.pendingExpires', {
                  date: new Date(seat.expiresAtMs).toLocaleDateString(),
                })}
              </span>
            )}
            <InviteLinkPanel inviteId={seat.inviteId} actions={actions} />
          </li>
        ))}
      </ul>
    </AdminSection>
  );
};

export default PendingSeatsSection;
