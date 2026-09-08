/**
 * PendingInviteControls — les mêmes deux gestes, rendus aux deux endroits qui
 * les offrent : le menu de rôle d'une invitation, et « Retrouver le lien ».
 *
 * POURQUOI CE FICHIER EXISTE. La liste des membres montre désormais les invitées
 * en attente (c'est là qu'on cherche à changer un rôle), et l'onglet Invitations
 * garde le détail. Le même geste rendu deux fois avec deux bouts de JSX
 * divergerait au premier changement — un menu qui proposerait `owner` d'un côté,
 * une confirmation qui oublierait de dire que l'ancien lien meurt de l'autre.
 *
 * ── « RETROUVER LE LIEN » DIT LA VÉRITÉ, MÊME QUAND ELLE DÉÇOIT ─────────────
 * Un lien perdu ne se réaffiche PAS : le serveur n'en garde que le condensat
 * (SHA-256), le porteur brut n'a jamais existé ailleurs que dans l'e-mail et dans
 * la réponse HTTP de l'instant. Le seul chemin honnête est d'en fabriquer un
 * NEUF, ce qui tue l'ancien à la seconde. La confirmation le dit avant d'agir,
 * pas après : quelqu'un qui vient d'envoyer le lien par messagerie doit pouvoir
 * renoncer plutôt que de le casser sous les doigts du destinataire.
 *
 * LE BOUTON N'EST PAS OFFERT QUAND IL NE PEUT PAS ABOUTIR. Après une rotation de
 * clé, le scellé de l'invitation est daté d'une époque révolue : le serveur
 * refuse la relance (`invite_stale_epoch`) et un lien neuf pointerait vers une
 * clé morte. On affiche donc le fait et le seul chemin qui reste (révoquer puis
 * réinviter avec un scellé frais), au lieu d'un bouton qui échouera.
 *
 * LE LIEN AFFICHÉ EST CELUI DE `InviteLinkActions`, PAS UN DEUXIÈME. Copie,
 * QR, effacement du presse-papiers, phrase qui dit pour qui le carré est fait :
 * tout cela est déjà tenu là-bas, à l'émission. Un second affichage du même lien
 * divergerait au premier correctif d'hygiène.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmModal, Select } from '../../ui';
import { StatusBadge } from '../../settings/enterprise/AdminPrimitives';
import { InviteLinkActions } from '../../sharing/InviteLinkActions';
import { VAULT_INVITE_ROLES, type VaultInviteRole } from './vaultSettingsModel';
import { seatLinkOffer, type PendingSeatKind } from './pendingSeatsModel';
import type { PendingInviteActions } from './usePendingInviteActions';

interface RoleSelectProps {
  /** L'invitation visée — c'est elle que le PATCH corrige, pas une personne. */
  inviteId: string;
  /** Pour l'intitulé : des menus empilés qui disent tous « Rôle » ne disent rien. */
  email: string;
  role: VaultInviteRole;
  disabled?: boolean;
  onChange: (inviteId: string, role: VaultInviteRole) => void;
}

/**
 * Le rôle d'une invitation en attente, corrigible sur place.
 *
 * JAMAIS `owner` : la propriété se transfère (elle a son propre geste, avec sa
 * confirmation), elle ne s'invite pas — c'est aussi ce que le serveur accepte
 * (`INVITABLE_ROLES`), et proposer davantage ne ferait qu'offrir un refus.
 *
 * L'INTITULÉ NOMME LA PERSONNE. Ces menus sont empilés, un par ligne : le seul
 * mot « Rôle » répété N fois ne dit pas à une lecture d'écran de QUI on change le
 * rôle, et l'adresse est la seule chose qui les distingue.
 */
export const InviteRoleSelect: React.FC<RoleSelectProps> = ({
  inviteId,
  email,
  role,
  disabled,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <Select
      size="sm"
      ariaLabel={t('teamVaults.invites.roleLabelFor', { email })}
      options={VAULT_INVITE_ROLES.map((r) => ({ value: r, label: t(`teamVaults.role.${r}`, r) }))}
      value={role}
      disabled={disabled}
      onChange={(v) => {
        const next = (Array.isArray(v) ? v[0] : v) as VaultInviteRole;
        // Un menu qui rejoue la valeur déjà posée enverrait un PATCH pour rien,
        // et l'hôte lirait « rôle changé » là où rien n'a bougé.
        if (next !== role) onChange(inviteId, next);
      }}
    />
  );
};

interface RecoveryProps {
  inviteId: string;
  email: string;
  /** Une rotation est passée : plus aucun lien ne peut être fabriqué ici. */
  staleEpoch: boolean;
  /**
   * Le genre du siège. Une INTENTION n'a jamais émis de porteur de coffre — le
   * lien qui circule est celui de l'ESPACE, et il se relance depuis l'onglet
   * Invitations : le bouton ne s'affiche donc pas du tout, plutôt que d'envoyer
   * un identifiant d'`org_invitations` sur la route des invitations de coffre.
   */
  kind?: PendingSeatKind;
  disabled?: boolean;
  actions: PendingInviteActions;
}

/**
 * Le bouton qui rend un lien perdu — en en fabriquant un neuf, et en le disant.
 */
export const InviteLinkRecoveryButton: React.FC<RecoveryProps> = ({
  inviteId,
  email,
  staleEpoch,
  kind,
  disabled,
  actions,
}) => {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const offre = seatLinkOffer({ staleEpoch, kind });

  // Rien à retrouver ici : ce siège n'a pas de lien de coffre. Le modèle tranche,
  // pas le JSX — c'est la règle qui doit pouvoir échouer dans un test.
  if (offre === 'none') return null;

  if (offre === 'reissueFirst') {
    // Le fait, et le seul chemin qui reste. Un bouton ici ne ferait que
    // rapporter `invite_stale_epoch` après coup.
    return (
      <StatusBadge tone="warning" title={t('teamVaults.invites.staleEpochHint')}>
        {t('teamVaults.invites.staleEpochBadge')}
      </StatusBadge>
    );
  }

  return (
    <>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setAsking(true)}>
        {t('teamVaults.inviteLink.recover')}
      </Button>
      <ConfirmModal
        isOpen={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => void actions.regenerate(inviteId, email)}
        title={t('teamVaults.inviteLink.recoverTitle')}
        // La phrase porte les DEUX faits qu'on ne peut pas deviner : l'ancien
        // lien meurt à l'instant, et celui qui est perdu ne se retrouve pas.
        message={t('teamVaults.inviteLink.recoverMessage', { email })}
        confirmText={t('teamVaults.inviteLink.recoverConfirm')}
        variant="warning"
      />
    </>
  );
};

/**
 * Le lien neuf, sous la ligne à laquelle il appartient.
 *
 * Rendu par identifiant d'invitation, jamais « le dernier lien » : deux lignes
 * afficheraient sinon le même porteur, et l'hôte copierait celui de la mauvaise
 * personne — un lien d'invitation est NOMINAL, le refus qui suivrait passerait
 * pour une panne.
 */
export const InviteLinkPanel: React.FC<{ inviteId: string; actions: PendingInviteActions }> = ({
  inviteId,
  actions,
}) => {
  if (actions.link?.inviteId !== inviteId) return null;
  return (
    <div className="mt-2">
      <InviteLinkActions
        url={actions.link.url}
        email={actions.link.email}
        expiresAtMs={actions.link.expiresAtMs}
        onDismiss={actions.clearLink}
      />
    </div>
  );
};
