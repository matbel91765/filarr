/**
 * usePendingInviteActions — LES DEUX SEULS GESTES QU'UNE INVITATION EN ATTENTE
 * ACCEPTE, tenus à UN endroit pour les DEUX écrans qui les offrent.
 *
 * POURQUOI UN HOOK PLUTÔT QUE DEUX COPIES. L'onglet Invitations portait déjà ces
 * appels ; la liste des membres les gagne (une invitée y apparaît désormais,
 * avec son rôle). Deux implémentations du même geste, c'est deux messages
 * d'erreur, deux invalidations et deux idées de ce qu'il faut recharger — elles
 * divergent au premier correctif appliqué d'un seul côté.
 *
 * ET DEPUIS LE 31/08, LE MÊME GESTE PORTE SUR DEUX OBJETS. Inviter quelqu'un
 * depuis un coffre produit une invitation de COFFRE si la personne est déjà dans
 * l'espace, et une INTENTION d'accès (0073) sinon. L'hôte n'a fait qu'un geste et
 * ne voit qu'une personne invitée : c'est ce hook qui choisit la route, à partir
 * du genre que le siège porte. Deux fonctions et non un drapeau, parce que les
 * deux identifiants sont des UUID et que les intervertir rendrait un 404 muet.
 *
 * ── CORRIGER LE RÔLE (PATCH) ────────────────────────────────────────────────
 * Le rôle d'une invitation N'EST PAS SCELLÉ : `wrapped_vault_key` reste le même
 * scellé, sous la même époque. Le rôle décide de ce qu'on aura le droit de FAIRE
 * une fois entré, jamais de ce qu'on pourra LIRE — c'est donc un simple UPDATE,
 * et le lien déjà reçu continue de mener au bon rôle. Jamais `owner` : la
 * propriété se transfère, elle ne s'invite pas.
 *
 * ET AUCUNE LIGNE D'ACTIVITÉ `role.change` NE DOIT EN SORTIR. Cet événement vise
 * une PERSONNE, pas une promesse : l'écrire ferait lire dans le fil une promotion
 * qui n'a pas eu lieu, sur quelqu'un qui n'est pas encore entré. C'est déjà la
 * décision du serveur (la taxonomie d'audit est fermée) et ce hook ne la
 * contredit pas — il n'écrit rien d'autre que le PATCH.
 *
 * ── RETROUVER LE LIEN (RESEND) ──────────────────────────────────────────────
 * LE FAIT QUI COMMANDE TOUT, et qu'il ne faut pas contourner : la table
 * `vault_invites` ne garde qu'un `token_hash` (SHA-256). Le porteur brut n'a
 * jamais existé ailleurs que dans l'e-mail et dans la réponse HTTP de l'instant.
 * « Réafficher » un lien perdu est donc IMPOSSIBLE, et inventer un stockage du
 * jeton en clair échangerait une gêne contre une faille. La seule issue honnête
 * est de RÉGÉNÉRER — ce que fait `resend`, qui rend l'URL neuve — et de dire sans
 * détour que l'ancien lien cesse de fonctionner à l'instant (invariant de l'index
 * UNIQUE sur `token_hash` : un seul porteur vivant par invitation).
 *
 * LE LIEN NE SE LOGE NULLE PART. Il vit dans l'état LOCAL de ce hook — jamais
 * Redux, jamais `localStorage`, jamais un journal ni la télémétrie. Il est
 * montré, copié, puis oublié : démonter l'écran suffit à le perdre, et c'est
 * exactement ce qu'on veut d'un porteur d'invitation.
 *
 * UN SEUL LIEN OUVERT À LA FOIS. Régénérer pour une deuxième invitation remplace
 * le premier : deux liens côte à côte, c'est l'occasion de copier celui de la
 * mauvaise personne — et ils ne portent aucune marque visible qui les distingue.
 *
 * UN WORKER QUI NE REND PAS D'URL NE DOIT PAS PASSER POUR UN SUCCÈS MUET. Un
 * worker d'avant F16 relance bien l'e-mail mais ne renvoie rien : on le DIT
 * (l'e-mail est reparti, le lien n'a pas pu être récupéré) plutôt que d'afficher
 * une zone vide qui se lirait comme une panne d'affichage.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../../ui/Notification';
import {
  apiPatchPendingGrantRole,
  apiPatchVaultInviteRole,
  apiResendVaultInvite,
} from '../../../../services/vault/vaultApi';
import { errorText, vaultErrorKey } from '../../../../services/vault/vaultErrorMessages';
import type { VaultInviteRole } from './vaultSettingsModel';

/** Le lien NEUF d'une invitation, tel qu'il vient d'être rendu — une seule fois. */
export interface FreshInviteLink {
  inviteId: string;
  url: string;
  email: string;
  /** L'échéance relue sur la ligne, jamais un TTL deviné côté client. */
  expiresAtMs: number | null;
}

export interface PendingInviteActions {
  /** Un geste est en vol : les deux écrans désactivent leurs contrôles. */
  busy: boolean;
  /** Le lien en cours d'affichage, s'il y en a un. */
  link: FreshInviteLink | null;
  /** Ranger le lien — l'hôte l'a copié, ou renonce. */
  clearLink: () => void;
  /**
   * Régénérer le porteur et RENDRE l'URL. L'ancien lien meurt à l'instant : les
   * appelants doivent l'avoir dit AVANT d'appeler.
   *
   * `successKey` existe parce que le MÊME appel porte deux gestes nommés
   * différemment — « Relancer / Prolonger » (l'e-mail repart) et « Retrouver le
   * lien » (l'URL réapparaît) : l'accusé doit nommer ce qu'on vient de demander,
   * pas ce que le serveur a fait techniquement. Les deux phrases disent, elles,
   * la même chose de l'ancien lien : il ne fonctionne plus.
   */
  regenerate: (inviteId: string, email: string, successKey?: string) => Promise<void>;
  /** Corriger le rôle d'une invitation en attente. Ne touche à aucune clé. */
  changeRole: (inviteId: string, role: VaultInviteRole) => Promise<void>;
  /**
   * Corriger le rang PROMIS d'une intention d'accès (0073) — l'autre moitié du
   * même geste humain, et l'autre route.
   *
   * L'IDENTIFIANT N'EST PAS DU MÊME MONDE : c'est une ligne `org_invitations`,
   * pas une invitation de coffre. Les deux sont des UUID, et les envoyer à la
   * mauvaise route rendrait un 404 que rien à l'écran n'expliquerait — c'est
   * pourquoi ce sont DEUX fonctions et non un drapeau, et pourquoi le siège
   * porte son genre jusqu'ici.
   */
  changeIntentRole: (inviteId: string, role: VaultInviteRole) => Promise<void>;
}

interface Options {
  /** Relire la page ET réveiller les agrégats partagés — voir `useVaultManagement`. */
  onDone: () => void | Promise<void>;
  /** La langue de l'e-mail relancé : celle dans laquelle l'hôte écrit maintenant. */
  lang: string;
}

export function usePendingInviteActions(
  vaultId: string,
  { onDone, lang }: Options
): PendingInviteActions {
  const { t } = useTranslation();
  const { success, error } = useNotification();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<FreshInviteLink | null>(null);

  const clearLink = useCallback(() => setLink(null), []);

  const regenerate = useCallback(
    async (inviteId: string, email: string, successKey?: string) => {
      setBusy(true);
      try {
        const relancée = await apiResendVaultInvite(vaultId, inviteId, lang);
        if (relancée.inviteUrl) {
          const échéance = relancée.invite?.expiresAt ? Date.parse(relancée.invite.expiresAt) : NaN;
          setLink({
            inviteId,
            url: relancée.inviteUrl,
            email,
            expiresAtMs: Number.isFinite(échéance) ? échéance : null,
          });
          success(t(successKey ?? 'teamVaults.inviteLink.regenerated'));
        } else {
          // L'e-mail est bien reparti — mais le lien, lui, ne reviendra pas :
          // le serveur n'en garde que le condensat. Le dire vaut mieux qu'une
          // zone vide sous la ligne.
          setLink(null);
          success(t('teamVaults.inviteLink.regeneratedNoUrl'));
        }
        // Le porteur ET la date ont changé : la ligne affichée est périmée.
        await onDone();
      } catch (e) {
        // `invite_stale_epoch`, `rate_limited`, `invite_not_found`, `vault_frozen` :
        // chacun a sa phrase dans la table partagée. Le repli ne sert que pour un
        // refus qu'on n'a pas su classer.
        error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.generic')));
      } finally {
        setBusy(false);
      }
    },
    [vaultId, lang, success, error, t, onDone]
  );

  const changeRole = useCallback(
    async (inviteId: string, role: VaultInviteRole) => {
      setBusy(true);
      try {
        await apiPatchVaultInviteRole(vaultId, inviteId, role);
        success(t('teamVaults.invites.roleChanged', { role: t(`teamVaults.role.${role}`, role) }));
        await onDone();
      } catch (e) {
        error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.roleChangeFailed')));
      } finally {
        setBusy(false);
      }
    },
    [vaultId, success, error, t, onDone]
  );

  /**
   * LA MÊME CORRECTION, SUR L'AUTRE MOITIÉ DU PARCOURS.
   *
   * Un rang promis (0073) n'est pas encore un rôle : rien n'est scellé, la
   * personne n'a peut-être même pas de compte. Le corriger reste pourtant le
   * MÊME geste vu de l'hôte, avec le MÊME accusé — d'où la phrase partagée avec
   * `changeRole`, plutôt qu'une seconde qui dirait la même chose autrement.
   *
   * LA ROUTE, ELLE, DIFFÈRE, et c'est tout l'enjeu de la séparation : envoyer un
   * identifiant d'`org_invitations` à `PATCH /vaults/:id/invites/:inviteId`
   * rendrait `invite_not_found`, un refus que l'hôte lirait comme la disparition
   * de la personne qu'il vient d'inviter.
   */
  const changeIntentRole = useCallback(
    async (inviteId: string, role: VaultInviteRole) => {
      setBusy(true);
      try {
        await apiPatchPendingGrantRole(vaultId, inviteId, role);
        success(t('teamVaults.invites.roleChanged', { role: t(`teamVaults.role.${role}`, role) }));
        await onDone();
      } catch (e) {
        // `intent_not_found` a sa phrase dans la table partagée : la promesse a
        // été honorée ou retirée entre l'affichage et le clic, et l'écran relit
        // plutôt que d'affirmer laquelle des deux.
        error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.roleChangeFailed')));
      } finally {
        setBusy(false);
      }
    },
    [vaultId, success, error, t, onDone]
  );

  return { busy, link, clearLink, regenerate, changeRole, changeIntentRole };
}

export default usePendingInviteActions;
