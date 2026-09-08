/**
 * VaultInboxBanner — ce qui ATTEND, en tête de l'accueil (lot A, C5).
 *
 * Les coffres partagés n'ont plus de section à part. Or leur page portait,
 * en plus des cartes, quatre choses qui ne sont pas des cartes : les accès
 * promis (0073), les invitations du compte, le code d'invitation armé, et
 * « Partagé avec moi ». Toutes sont des ATTENTES — une réponse à donner, une
 * clé à vérifier, un lien à reprendre, un fichier à récupérer — et une attente
 * ne se range pas dans une grille de dossiers.
 *
 * POURQUOI UN BANDEAU ET PAS UN WIDGET. Un widget se retire de l'accueil, et
 * une invitation retirée est une invitation manquée. Surtout, le prédicat
 * `isEmpty` d'un widget ne reçoit que le store : il ne voit pas le
 * localStorage où vivent les invitations armées (`pendingInvite`), donc il
 * jugerait « vide » un accueil qui a un lien à reprendre. Le bandeau, lui,
 * est monté par la page et lit les deux sources.
 *
 * Il rend `null` quand tout est vide et n'existe que pour un compte nuage :
 * hors nuage rien de tout cela n'existe (règle 13).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { Button, Input, Modal, ModalBody, ModalFooter, ModalHeader } from '../ui';
import { useNotification } from '../ui/Notification';
import {
  parseInviteLink,
  readPendingInvites,
  setPendingInvite,
  subscribePendingInvite,
  type PendingInvite,
} from '../../../services/invites/pendingInvite';
import { VaultAccessNotices } from './VaultAccessNotices';
import { NewVaultAccessNotice, useNewVaultAccess } from './NewVaultAccessNotice';
import { MyInvitationsList } from './MyInvitationsList';
import { InviteCodeEntry } from './InviteCodeEntry';
import { SharedWithMeList } from './SharedWithMeList';
import { selectSharedWithMeVisible } from '../../../store/slices/sharedWithMeSlice';

/** Au-delà de ce nombre, « Partagé avec moi » se replie derrière « voir tout ». */
const SHARED_COLLAPSE_AFTER = 3;

interface Props {
  /** Ouvrir un coffre — la suite naturelle d'une invitation acceptée. */
  onOpenVault: (vaultId: string) => void;
  /**
   * Ouvrir la FICHE d'accès de quelqu'un (F04) : un accès que le balayage n'a
   * pas pu accorder seul se règle sur la page de gestion, pas dans la grille de
   * fichiers. Facultatif — hors d'une route, le bandeau reste lisible sans le
   * bouton.
   */
  onOpenAccess?: (vaultId: string, focus: string) => void;
}

export const VaultInboxBanner: React.FC<Props> = ({ onOpenVault, onOpenAccess }) => {
  const { t } = useTranslation();
  const signedIn = useSelector((s: RootState) => !!s.auth.cloudUser);
  // L'identifiant du compte : le registre « déjà vu » des coffres lui est indexé
  // — le registre de l'un ne doit rien dire des coffres de l'autre.
  const cloudUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const noticeCount = useSelector(
    (s: RootState) => s.vaults.awaitingHost.length + s.vaults.blockedGrants.length
  );
  const invitationCount = useSelector((s: RootState) => s.vaults.myInvitations.length);
  // « Partagé avec moi » n'apparaît que s'il y a QUELQUE CHOSE : des entrées
  // lues, ou des entrées qui attendent la clé. Jamais une section à zéro —
  // c'était le bandeau « déverrouillez » à chaque lancement, sans aucun partage.
  const showShared = useSelector(selectSharedWithMeVisible);

  /**
   * Les invitations ARMÉES vivent hors du store : on s'abonne au module, qui
   * ne livre que la tête, et on relit la liste entière à chaque signal — le
   * même geste que `InviteCodeEntry`.
   */
  const [pending, setPending] = useState<PendingInvite[]>(() => readPendingInvites());
  useEffect(() => subscribePendingInvite(() => setPending(readPendingInvites())), []);

  /**
   * CE QUI VIENT D'ARRIVER SANS QU'ON AIT RIEN À ACCEPTER (F06). Appelé ICI et
   * pas dans le composant d'affichage : le bandeau décide seul de rendre `null`,
   * et cette décision doit compter le neuf. Deux instances du calcul auraient
   * deux registres « déjà vu » en mémoire, qui divergeraient au premier
   * « Écarter ».
   */
  const newAccess = useNewVaultAccess(cloudUserId);

  if (!signedIn) return null;

  const showNotices = noticeCount > 0;
  const showInvitations = invitationCount > 0;
  const showInviteCode = pending.length > 0;
  const showNewAccess = newAccess.vaults.length > 0;

  if (!showNotices && !showInvitations && !showInviteCode && !showShared && !showNewAccess)
    return null;

  return (
    <section
      aria-label={t('home.inbox.title', 'À traiter')}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-6 py-4 flex flex-col gap-4"
    >
      {/* Sa place est ici, à côté des accès promis et des invitations : c'est la
          même question (« quelque chose m'attend-il ? »). */}
      {showNewAccess && <NewVaultAccessNotice access={newAccess} onOpenVault={onOpenVault} />}
      {showNotices && <VaultAccessNotices onOpenAccess={onOpenAccess} />}
      {showInvitations && <MyInvitationsList onAccepted={onOpenVault} />}
      {/* `InviteCodeEntry` porte ses propres marges horizontales (px-6) :
          on les annule pour qu'il s'aligne sur les autres sections. */}
      {showInviteCode && (
        <div className="-mx-6">
          <InviteCodeEntry />
        </div>
      )}
      {showShared && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] m-0 mb-2">
            {t('sharedWithMe.title')}
          </h3>
          <SharedWithMeList collapseAfter={SHARED_COLLAPSE_AFTER} />
        </div>
      )}
    </section>
  );
};

/**
 * InviteCodeModal — « J'ai un code d'invitation… », ouvrable PAR PROGRAMME.
 *
 * `InviteCodeEntry` est un bloc autonome (son bouton, sa fenêtre) qu'on ne
 * peut pas ouvrir depuis un menu. Le bouton « Nouveau » de la grille et le
 * menu de fond ont besoin de la fenêtre seule : la voici, avec la même règle
 * que l'entrée — coller un lien à la main est un geste EXPLICITE de CE compte,
 * il lève la sourdine qu'il avait pu poser (`unmuteFor`). Elle ne fait
 * qu'ARMER l'invitation : `PendingInviteHost` la reprend et l'accepte.
 */
export const InviteCodeModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const { success } = useNotification();
  const email = useSelector((s: RootState) => s.auth.cloudUser?.email ?? null);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const close = useCallback(() => {
    setValue('');
    setInvalid(false);
    onClose();
  }, [onClose]);

  const submit = useCallback(() => {
    const parsed = parseInviteLink(value);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setPendingInvite(parsed, { unmuteFor: email });
    // L'accusé de réception : la fenêtre d'acceptation n'arrive pas toujours
    // tout de suite (coffre encore verrouillé), il faut le dire ici.
    success(t('teamVaults.join.entry.armed'));
    close();
  }, [value, email, success, t, close]);

  return (
    <Modal isOpen={isOpen} onClose={close} size="sm">
      <ModalHeader onClose={close} closeLabel={t('common.close')}>
        {t('teamVaults.join.entry.title')}
      </ModalHeader>
      <ModalBody>
        <p className="text-sm text-[var(--color-text-secondary)] mt-0 mb-3">
          {t('teamVaults.join.entry.desc')}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-0 mb-3">
          {t('teamVaults.join.entry.linkForVault')}
        </p>
        <Input
          label={t('teamVaults.join.entry.label')}
          placeholder={t('teamVaults.join.entry.placeholder')}
          value={value}
          fullWidth
          autoFocus
          data-autofocus
          error={invalid ? t('teamVaults.join.entry.invalid') : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={close}>
          {t('teamVaults.join.later')}
        </Button>
        <Button variant="primary" onClick={submit} disabled={!value.trim()}>
          {t('teamVaults.join.entry.submit')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default VaultInboxBanner;
