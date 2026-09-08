/**
 * useVaultReinvite — REDONNER SA CHANCE À QUELQU'UN, EN UN CLIC (F03/F04).
 *
 * CE QUE LE GESTE REMPLACE. Rattraper une invitation échue demandait de
 * comprendre soi-même laquelle des deux voies prendre (la personne est-elle
 * encore dans l'espace ?), d'ouvrir un sélecteur, d'y retrouver le nom, de lire
 * une empreinte, puis d'appuyer sur un bouton qui ne portait pas le nom de ce
 * qu'il faisait. Ici, un bouton par ligne, et l'app fait le reste.
 *
 * CE QU'IL NE RACCOURCIT PAS : LA VÉRIFICATION DE CLÉ. C'est la garde qui rend
 * le partage de bout en bout autre chose qu'une promesse. Elle se déroule
 * toujours, dans le même ordre, avec les mêmes verdicts :
 *   · `ok` / `first_seen` / `no_log` → on scelle sans rien demander, exactement
 *     comme le sélecteur manuel, qui n'exige aucune confirmation pour un pair
 *     jamais vu (il n'y a rien à comparer). Automatiser ne baisse AUCUNE garde ;
 *   · `changed` → la cérémonie du numéro de sécurité se DÉPLIE sous la ligne, et
 *     le bouton devient « Confirmer et réinviter ». La comparaison hors bande
 *     reste un geste humain ;
 *   · `tampered_log` / `served_not_latest` / clé absente → refus NOMMÉ, aucun
 *     scellement. Ce sont les cas où quelqu'un a peut-être substitué la clé.
 *
 * LA CLÉ SCELLÉE EST TOUJOURS CELLE QUI VIENT D'ÊTRE VÉRIFIÉE — celle que
 * `verifyPeerKey` a rendue, ou celle de la cérémonie (`kv.sealArgs.peerKey`) —
 * jamais une clé re-téléchargée : la redemander rouvrirait la fenêtre où le
 * serveur peut en substituer une autre entre le contrôle et le scellé.
 *
 * UNE RÉ-INVITATION À LA FOIS. Chaque scellement est une écriture facturable et
 * un e-mail ; deux gestes lancés de front sur la même personne se feraient
 * refuser le second en `already_member`, et l'hôte lirait un refus là où tout
 * s'est bien passé.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../../store';
import { addMemberDirect, grantSealedManually } from '../../../../store/slices/vaultsSlice';
import { useNotification } from '../../ui/Notification';
import {
  apiInviteToVaultSpace,
  type MemberPublicKeyDTO,
} from '../../../../services/vault/vaultApi';
import { verifyPeerKey } from '../../../../services/vault/peerVerification';
import { mayAutoSeal } from '../../../../services/vault/pendingGrantSweep';
import { errorText, vaultErrorKey } from '../../../../services/vault/vaultErrorMessages';
import { usePeerKeyVerification, type PeerKeyVerification } from '../KeyVerification';
import type { AssignableVaultRole } from '../../sharing/shareDialogModel';
import type { ReissueKind } from './inviteLifecycleModel';

/** Qui l'on rattrape, et par quelle voie. */
export interface ReinviteTarget {
  email: string;
  /** Requis pour `reinvite` : on ne scelle qu'à un compte. */
  userId: string | null;
  role: AssignableVaultRole;
  kind: ReissueKind;
}

export interface VaultReinvite {
  /** L'adresse en cours de traitement — le verrou « une à la fois ». */
  busyEmail: string | null;
  /** Un geste est en cours OU une cérémonie attend : plus rien d'autre ne part. */
  locked: boolean;
  /** La personne dont la clé a changé et dont la cérémonie est dépliée. */
  ceremonyFor: ReinviteTarget | null;
  /** L'état de la cérémonie, à passer à `KeyVerificationPanel`. */
  kv: PeerKeyVerification;
  /** Lancer le rattrapage. Ne jette jamais : les refus deviennent des phrases. */
  start: (target: ReinviteTarget) => Promise<void>;
  /** Sceller après que l'hôte a coché « j'ai comparé ce numéro ». */
  confirm: () => Promise<void>;
  /** Refermer la cérémonie sans rien sceller. */
  cancel: () => void;
}

interface Options {
  /** L'espace DU COFFRE — c'est là qu'un ancien invité doit rentrer. */
  orgId: string | null;
  /** Relire la page ET réveiller les agrégats partagés. */
  onDone: () => void | Promise<void>;
}

export function useVaultReinvite(vaultId: string, { orgId, onDone }: Options): VaultReinvite {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [ceremonyFor, setCeremonyFor] = useState<ReinviteTarget | null>(null);

  /**
   * La cérémonie se relance sur la personne dont la clé a bougé. Elle refait
   * l'aller-retour que `verifyPeerKey` vient de faire, et c'est VOULU : la clé
   * qui sera scellée doit être celle que l'écran a montrée à l'hôte, pas une
   * autre lue une seconde plus tôt.
   */
  const onLookupFailed = useCallback(() => error(t('teamVaults.errors.noKey')), [error, t]);
  const kv = usePeerKeyVerification(ceremonyFor?.userId ?? null, { onLookupFailed });

  const locked = busyEmail !== null || ceremonyFor !== null;

  /** Sceller K_vault à une clé DÉJÀ vérifiée, et faire entrer la personne. */
  const seal = useCallback(
    async (target: ReinviteTarget & { userId: string }, peerKey: MemberPublicKeyDTO) => {
      await dispatch(
        addMemberDirect({
          vaultId,
          userId: target.userId,
          email: target.email,
          role: target.role,
          peerKey,
          // « Réinviter » n'envoie plus d'invitation quand la personne est déjà
          // dans l'espace : c'est un avis d'accès qui part, dans notre langue.
          lang: i18n.language,
        })
      ).unwrap();
      // La pastille « en attente de votre vérification » n'a plus lieu d'être :
      // sans cela elle survivait jusqu'au prochain déverrouillage, en réclamant
      // un geste déjà fait.
      dispatch(grantSealedManually({ vaultId, userId: target.userId, email: target.email }));
      success(t('teamVaults.invite.accessGiven', { email: target.email }));
      await onDone();
    },
    [dispatch, vaultId, success, t, onDone, i18n.language]
  );

  const start = useCallback(
    async (target: ReinviteTarget) => {
      // L'annuaire n'a pas pu être lu : on ne route pas à l'aveugle. Le bouton
      // est déjà désactivé — cette garde ferme le chemin clavier.
      if (locked || target.kind === 'unknown') return;
      setBusyEmail(target.email);
      try {
        if (target.kind === 'reinviteToSpace') {
          if (!orgId) {
            error(t('teamVaults.errors.noContext'));
            return;
          }
          await apiInviteToVaultSpace(orgId, {
            email: target.email,
            // Moindre privilège : un lecteur entre en lecture, les autres en
            // éditeur — qui n'accorde AUCUN droit de gestion sur l'espace.
            role: target.role === 'viewer' ? 'viewer' : 'editor',
            lang: i18n.language,
            // L'intention (0073) repart avec : l'accès suivra tout seul à
            // l'acceptation, sans second geste de l'hôte.
            intendedVaultId: vaultId,
            intendedVaultRole: target.role,
          });
          success(t('teamVaults.members.spaceInviteSentWithAccess', { email: target.email }));
          await onDone();
          return;
        }

        if (!target.userId) {
          error(t('teamVaults.errors.noKey'));
          return;
        }
        const peer = await verifyPeerKey(target.userId);
        if (!peer) {
          // Pas de clé publiée : rien à sceller, et ce n'est pas un incident.
          error(t('teamVaults.errors.noKey'));
          return;
        }
        if (peer.status === 'changed') {
          // On ne scelle pas dans le dos de l'hôte : la cérémonie se déplie et
          // le bouton devient « Confirmer et réinviter ».
          setCeremonyFor(target);
          return;
        }
        if (!mayAutoSeal(peer.status)) {
          // `tampered_log` / `served_not_latest` : une substitution est
          // possible. Le refus est NOMMÉ — « réessayez » serait une invitation
          // à passer outre.
          error(t(vaultErrorKey(peer.status, 'teamVaults.errors.giveAccess')));
          return;
        }
        await seal({ ...target, userId: target.userId }, peer.peerKey);
      } catch (e) {
        error(
          t(
            vaultErrorKey(
              errorText(e),
              target.kind === 'reinviteToSpace'
                ? 'teamVaults.errors.invite'
                : 'teamVaults.errors.giveAccess'
            )
          )
        );
      } finally {
        setBusyEmail(null);
      }
    },
    [locked, orgId, error, t, i18n.language, vaultId, success, onDone, seal]
  );

  const confirm = useCallback(async () => {
    const target = ceremonyFor;
    if (!target?.userId || !kv.sealArgs || busyEmail) return;
    setBusyEmail(target.email);
    try {
      // Un changement de clé accepté devient la base TOFU AVANT de sceller.
      kv.pinAcceptedChange();
      await seal({ ...target, userId: target.userId }, kv.sealArgs.peerKey);
      setCeremonyFor(null);
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.giveAccess')));
    } finally {
      setBusyEmail(null);
    }
  }, [ceremonyFor, kv, busyEmail, seal, error, t]);

  const cancel = useCallback(() => setCeremonyFor(null), []);

  return { busyEmail, locked, ceremonyFor, kv, start, confirm, cancel };
}

export default useVaultReinvite;
