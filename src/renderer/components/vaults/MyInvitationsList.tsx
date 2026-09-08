/**
 * MyInvitationsList — la boîte de réception d'invitations du COMPTE.
 *
 * LA MOITIÉ MANQUANTE DU PARCOURS. L'invitée n'apprenait une invitation de
 * coffre que par l'e-mail : perdu, filtré, ouvert dans le mauvais navigateur —
 * et il n'existait plus AUCUN chemin, pendant que l'hôte la voyait « en
 * attente » sept jours. Ici, le compte voit ce qui l'attend (GET /me), accepte
 * par identifiant — sans jeton à recopier — ou REFUSE, une réponse que le
 * produit ne savait pas porter et que l'hôte lit dans son accusé.
 *
 * CE QUE CETTE LISTE N'EST PAS : elle ne remplace ni le lien e-mail (seul
 * porteur pour un compte pas encore créé) ni InviteCodeEntry (seul chemin des
 * invitations d'ESPACE, dont le jeton ne vit que dans l'e-mail). Elle vit à
 * côté des deux.
 *
 * `stale` : une rotation de clé est passée depuis l'émission — le scellé est
 * mort et le serveur répondrait 409. On le DIT, plutôt que d'offrir un bouton
 * qui ne peut qu'échouer ; le refus reste possible (il ne touche pas au scellé).
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button } from '../ui';
import type { AppDispatch, RootState } from '../../../store';
import {
  fetchMyInvitations,
  acceptMyInvitation,
  declineMyInvitation,
} from '../../../store/slices/vaultsSlice';
import { joinErrorKey } from '../../../services/vault/vaultErrorMessages';

interface Props {
  /** Sélectionner le coffre fraîchement accepté — la suite naturelle du oui. */
  onAccepted?: (vaultId: string) => void;
}

export const MyInvitationsList: React.FC<Props> = ({ onAccepted }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const invitations = useSelector((s: RootState) => s.vaults.myInvitations);
  const signedIn = useSelector((s: RootState) => !!s.auth.cloudUser);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'accept' | 'decline' | null>(null);
  const [errorByInvite, setErrorByInvite] = useState<Record<string, string>>({});

  // Rafraîchie à chaque montage de l'écran des coffres : c'est le moment où la
  // question « quelque chose m'attend-il ? » se pose. Pas de sondage périodique
  // — une invitation n'est pas un message instantané.
  useEffect(() => {
    if (signedIn) void dispatch(fetchMyInvitations());
  }, [dispatch, signedIn]);

  if (!signedIn || invitations.length === 0) return null;

  const accept = async (inviteId: string) => {
    setBusyId(inviteId);
    setBusyAction('accept');
    setErrorByInvite((e) => ({ ...e, [inviteId]: '' }));
    const r = await dispatch(acceptMyInvitation({ inviteId }));
    setBusyId(null);
    setBusyAction(null);
    if (acceptMyInvitation.fulfilled.match(r)) {
      onAccepted?.(r.payload.vaultId);
    } else {
      const code = (r.payload as string) ?? 'invite_invalid';
      setErrorByInvite((e) => ({ ...e, [inviteId]: code }));
      // Un verdict TERMINAL du serveur (réglée, révoquée…) : la ligne ne
      // reviendra pas — relire la liste la fait disparaître avec son erreur.
      if (code === 'invite_invalid' || code === 'invite_expired') {
        void dispatch(fetchMyInvitations());
      }
    }
  };

  const decline = async (inviteId: string) => {
    setBusyId(inviteId);
    setBusyAction('decline');
    setErrorByInvite((e) => ({ ...e, [inviteId]: '' }));
    const r = await dispatch(declineMyInvitation({ inviteId }));
    setBusyId(null);
    setBusyAction(null);
    if (declineMyInvitation.rejected.match(r)) {
      setErrorByInvite((e) => ({ ...e, [inviteId]: (r.payload as string) ?? 'unknown' }));
    }
  };

  return (
    <div className="mb-2" data-testid="my-invitations">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-[var(--color-text-tertiary)] m-0 mb-1.5">
        {t('teamVaults.join.mine.title', { count: invitations.length })}
      </p>
      <ul className="list-none m-0 p-0 space-y-1.5">
        {invitations.map((inv) => {
          const busy = busyId === inv.id;
          const errCode = errorByInvite[inv.id];
          return (
            <li
              key={inv.id}
              className="rounded-lg border border-[var(--color-border-light)] px-2.5 py-2 text-xs"
            >
              <p className="m-0 font-medium text-[var(--color-text-primary)] truncate">
                {inv.orgName || t('teamVaults.join.mine.unnamedSpace')}
              </p>
              <p className="m-0 mt-0.5 text-[var(--color-text-tertiary)]">
                {inv.invitedByEmail
                  ? t('teamVaults.join.mine.from', { email: inv.invitedByEmail })
                  : t(`teamVaults.role.${inv.role}`, inv.role)}
                {' · '}
                {t('teamVaults.join.mine.expires', {
                  date: new Date(inv.expiresAt).toLocaleDateString(),
                })}
              </p>
              {inv.stale ? (
                // Le scellé est mort (rotation depuis l'émission) : accepter ne
                // peut qu'échouer en 409 — on remplace le bouton par la phrase.
                <p className="m-0 mt-1 text-[var(--color-warning-700)]">
                  {t('teamVaults.join.mine.stale')}
                </p>
              ) : null}
              {errCode ? (
                <p role="alert" className="m-0 mt-1 text-[var(--color-error-600)]">
                  {t(joinErrorKey(errCode, 'teamVaults.join.mine.acceptFailed'))}
                </p>
              ) : null}
              <div className="flex gap-1.5 mt-1.5">
                {!inv.stale && (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy && busyAction === 'accept'}
                    disabled={busy}
                    onClick={() => void accept(inv.id)}
                  >
                    {t('teamVaults.join.mine.accept')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy && busyAction === 'decline'}
                  disabled={busy}
                  onClick={() => void decline(inv.id)}
                >
                  {t('teamVaults.join.mine.decline')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default MyInvitationsList;
